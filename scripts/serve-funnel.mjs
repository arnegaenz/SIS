import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import url from "url";
import { TERMINATION_RULES } from "../src/config/terminationMap.mjs";
import { isTestInstanceName } from "../src/config/testInstances.mjs";
import { loadSsoFis } from "../src/utils/config.mjs";
import { fetchRawRange } from "./fetch-raw.mjs";
import { buildDailyFromRawRange } from "./build-daily-from-raw.mjs";
import {
  getCardPlacementPage,
  getMerchantSitesPage,
  getSessionsPage,
  loginWithSdk,
} from "../src/api.mjs";
import {
  groupSessionsBySource,
  computeSourceKpis,
  buildDailySeries,
  buildMerchantSeries,
} from "../src/lib/analytics/sources.mjs";
import { fetchGaRowsForDay, resolveFiFromHost } from "../src/ga.mjs";
const { URLSearchParams } = url;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve repo root:  scripts/  -> repo/
const ROOT = path.resolve(path.join(__dirname, ".."));
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DAILY_DIR = path.join(DATA_DIR, "daily");
const RAW_DIR = path.join(ROOT, "raw");
const RAW_PLACEMENTS_DIR = path.join(RAW_DIR, "placements");
const SYNTHETIC_DIR = path.join(DATA_DIR, "synthetic");
const SYNTHETIC_JOBS_FILE = path.join(SYNTHETIC_DIR, "jobs.json");
const FI_REGISTRY_FILE = path.join(ROOT, "fi_registry.json");
const INSTANCES_FILES = [
  path.join(ROOT, "secrets", "instances.json"),
];
const GA_CREDENTIALS = [
  {
    name: "prod",
    label: "Production",
    file: path.join(ROOT, "secrets", "ga-service-account.json"),
    envProperty: "GA_PROPERTY_ID",
    defaultProperty: "328054560",
  },
  {
    name: "test",
    label: "Test",
    file: path.join(ROOT, "secrets", "ga-test.json"),
    envProperty: "GA_TEST_PROPERTY_ID",
    defaultProperty: process.env.GA_TEST_PROPERTY_ID || "",
  },
];
// Backwards-compatible constant (older endpoints).
const GA_SERVICE_ACCOUNT_FILE = GA_CREDENTIALS[0].file;
const PORT = 8787;
const FI_ALL_VALUE = "__all__";
const PARTNER_ALL_VALUE = "__all_partners__";
const INSTANCE_ALL_VALUE = "__all_instances__";
const SSO_FI_SET = loadSsoFis(path.join(ROOT, "src"));
const SERVER_STARTED_AT = new Date().toISOString();
const BUILD_COMMIT = (() => {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
})();
const BUILD_COMMITTED_AT = (() => {
  try {
    return execSync("git log -1 --format=%cI", {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
})();

const SYNTHETIC_RUNNER_MODE = (process.env.SYNTHETIC_RUNNER || "").toLowerCase();
const SYNTHETIC_SCHEDULER_MS = 5000;

const updateClients = new Set();

let currentUpdateJob = {
  running: false,
  startedAt: null,
  finishedAt: null,
  startDate: null,
  endDate: null,
  lastMessage: null,
  error: null,
  forceRaw: false,
};

// ========== SERVER LOGS CAPTURE ==========
const MAX_LOG_LINES = 2000;
const serverLogs = [];

function captureLog(level, ...args) {
  const timestamp = new Date().toISOString();
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');

  serverLogs.push({
    timestamp,
    level,
    message
  });

  // Keep only last MAX_LOG_LINES
  if (serverLogs.length > MAX_LOG_LINES) {
    serverLogs.shift();
  }
}

// Intercept console methods
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
  captureLog('info', ...args);
  originalLog(...args);
};

console.error = (...args) => {
  captureLog('error', ...args);
  originalError(...args);
};

console.warn = (...args) => {
  captureLog('warn', ...args);
  originalWarn(...args);
};

console.log('Server logs capture initialized');
// ========== END SERVER LOGS CAPTURE ==========

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIsoDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isDayComplete(dateStr) {
  if (!dateStr) return false;
  const dayEndUTC = new Date(`${dateStr}T23:59:59.999Z`);
  return new Date() > dayEndUTC;
}

function isoAddDays(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d)) return isoDate;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function defaultUpdateRange() {
  const endDate = todayIsoDate();
  const startDate = isoAddDays(endDate, -29);
  return { startDate, endDate };
}

function currentUpdateSnapshot() {
  const defaults = defaultUpdateRange();
  return {
    running: currentUpdateJob.running,
    startedAt: currentUpdateJob.startedAt,
    finishedAt: currentUpdateJob.finishedAt,
    startDate: currentUpdateJob.startDate || defaults.startDate,
    endDate: currentUpdateJob.endDate || defaults.endDate,
    lastMessage: currentUpdateJob.lastMessage,
    error: currentUpdateJob.error,
    forceRaw: currentUpdateJob.forceRaw || false,
    defaultRange: defaults,
  };
}

function normalizeUpdateRange(startDate, endDate) {
  const isIso = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const validEnd = isIso(endDate) ? endDate : todayIsoDate();
  let validStart = isIso(startDate) ? startDate : isoAddDays(validEnd, -29);
  // ensure start <= end
  if (new Date(`${validStart}T00:00:00Z`) > new Date(`${validEnd}T00:00:00Z`)) {
    validStart = isoAddDays(validEnd, -29);
  }
  return { startDate: validStart, endDate: validEnd };
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastUpdate(event, data) {
  if (event === "progress" && data && data.message) {
    currentUpdateJob.lastMessage = data.message;
  }
  for (const res of updateClients) {
    try {
      sseSend(res, event, data);
    } catch {
      // Ignore write errors; connection cleanup handled on close.
    }
  }
}

async function startUpdateJobIfNeeded(range = {}) {
  if (currentUpdateJob.running) {
    return;
  }

  const { startDate, endDate } = normalizeUpdateRange(
    range.startDate,
    range.endDate
  );

  currentUpdateJob = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    startDate,
    endDate,
    lastMessage: `Starting update for ${startDate} → ${endDate}`,
    error: null,
    forceRaw: Boolean(range.forceRaw),
  };

  broadcastUpdate("init", {
    startedAt: currentUpdateJob.startedAt,
    startDate,
    endDate,
    message: currentUpdateJob.lastMessage,
  });

  try {
    broadcastUpdate("progress", {
      phase: "raw",
      message: `Fetching raw for ${startDate} → ${endDate}${range.forceRaw ? " (forced refetch)" : ""}...`,
    });

    const strict = isDayComplete(endDate);

    await fetchRawRange({
      startDate,
      endDate,
      onStatus: (message) =>
        broadcastUpdate("progress", { phase: "raw", message }),
      forceRaw: Boolean(range.forceRaw),
      strict,
    });

    broadcastUpdate("progress", {
      phase: "daily",
      message: `Rebuilding daily rollups for ${startDate} → ${endDate}...`,
    });

    await buildDailyFromRawRange({ startDate, endDate });

    currentUpdateJob.running = false;
    currentUpdateJob.finishedAt = new Date().toISOString();
    currentUpdateJob.lastMessage = "Update completed.";

    broadcastUpdate("done", {
      finishedAt: currentUpdateJob.finishedAt,
      startDate,
      endDate,
      message: currentUpdateJob.lastMessage,
    });
  } catch (err) {
    currentUpdateJob.running = false;
    currentUpdateJob.finishedAt = new Date().toISOString();
    currentUpdateJob.error = err?.message || String(err);
    currentUpdateJob.lastMessage = `Update failed: ${currentUpdateJob.error}`;

    const failures = Array.isArray(err?.failures) ? err.failures : [];
    const instanceNames = failures
      .map((f) => f?.instanceName)
      .filter(Boolean);
    const uniqueNames = Array.from(new Set(instanceNames));
    const cancelMessage = uniqueNames.length
      ? `Refresh cancelled — please fix credentials for: ${uniqueNames.join(", ")}`
      : `Refresh cancelled — ${currentUpdateJob.error}`;

    broadcastUpdate("job_error", {
      finishedAt: currentUpdateJob.finishedAt,
      startDate,
      endDate,
      error: currentUpdateJob.error,
      message: cancelMessage,
      failures,
    });
  }
}

const mime = (ext) =>
  ({
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8",
  }[ext] || "application/octet-stream");

const setCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-SIS-ADMIN-KEY, Authorization");
};

const send = (res, code, body, type) => {
  setCors(res);
  res.statusCode = code;
  if (type) res.setHeader("Content-Type", type);
  if (typeof body === "object" && !(body instanceof Uint8Array)) {
    res.setHeader("Content-Type", type || "application/json; charset=utf-8");
    res.end(JSON.stringify(body, null, 2));
  } else {
    res.end(body);
  }
};

// Session-based admin authorization (replaces old admin key)
async function requireFullAccess(req, res, queryParams) {
  const auth = await validateSession(req, queryParams);
  if (!auth) {
    send(res, 401, { error: "Authentication required" });
    return null;
  }
  // admin and internal (Strivve team) have full data access
  const level = auth.user.access_level;
  if (level !== "admin" && level !== "internal") {
    send(res, 403, { error: "Full access required" });
    return null;
  }
  return auth;
}

function redactInstanceEntry(entry = {}) {
  return {
    name: entry.name || "",
    CARDSAVR_INSTANCE: entry.CARDSAVR_INSTANCE || "",
    APP_NAME: entry.APP_NAME || "",
    has_username: Boolean(entry.USERNAME),
    has_password: Boolean(entry.PASSWORD),
    has_api_key: Boolean(entry.API_KEY),
  };
}

function redactQueryForLogs(search = "") {
  if (!search) return "";
  try {
    const params = new URLSearchParams(search);
    ["adminKey", "admin_key", "admin"].forEach((k) => {
      if (params.has(k)) params.set(k, "[redacted]");
    });
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  } catch {
    return search;
  }
}

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(Buffer.concat(chunks).toString("utf8"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });

async function fileExists(fp) {
  try {
    await fs.access(fp);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Magic Link Authentication
// ============================================================================

const USERS_FILE = path.join(ROOT, "secrets", "users.json");
const SESSIONS_FILE = path.join(ROOT, "secrets", "sessions.json");
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "arne@strivve.com";
const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME || "SIS Metrics Dashboard";
const MAGIC_LINK_BASE = process.env.SIS_MAGIC_LINK_BASE || "http://localhost:8787";
const MAGIC_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateMagicToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function generateSessionToken() {
  return `sess_${crypto.randomBytes(32).toString("base64url")}`;
}

async function loadUsersFile() {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    const parsed = JSON.parse(data);
    return parsed.users || [];
  } catch (err) {
    console.warn("[auth] Could not load users file:", err.message);
    return [];
  }
}

async function loadSessionsFile() {
  try {
    const data = await fs.readFile(SESSIONS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return { magic_tokens: {}, sessions: {}, updated_at: new Date().toISOString() };
  }
}

async function saveSessionsFile(sessions) {
  sessions.updated_at = new Date().toISOString();
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf8");
}

async function storeMagicToken(token, data) {
  const sessions = await loadSessionsFile();
  sessions.magic_tokens = sessions.magic_tokens || {};
  sessions.magic_tokens[token] = data;
  await saveSessionsFile(sessions);
}

async function getMagicToken(token) {
  if (!token) return null;
  const sessions = await loadSessionsFile();
  return sessions.magic_tokens?.[token] || null;
}

async function deleteMagicToken(token) {
  if (!token) return;
  const sessions = await loadSessionsFile();
  if (sessions.magic_tokens?.[token]) {
    delete sessions.magic_tokens[token];
    await saveSessionsFile(sessions);
  }
}

async function storeSession(token, data) {
  const sessions = await loadSessionsFile();
  sessions.sessions = sessions.sessions || {};
  sessions.sessions[token] = data;
  await saveSessionsFile(sessions);
}

async function getSession(token) {
  if (!token) return null;
  const sessions = await loadSessionsFile();
  return sessions.sessions?.[token] || null;
}

async function deleteSession(token) {
  if (!token) return;
  const sessions = await loadSessionsFile();
  if (sessions.sessions?.[token]) {
    delete sessions.sessions[token];
    await saveSessionsFile(sessions);
  }
}

async function updateSessionLastUsed(token) {
  if (!token) return;
  const sessions = await loadSessionsFile();
  if (sessions.sessions?.[token]) {
    sessions.sessions[token].last_used_at = new Date().toISOString();
    await saveSessionsFile(sessions);
  }
}

function extractSessionToken(req, queryParams) {
  // Check Authorization header first
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  // Fall back to query param (for EventSource which can't set headers)
  const tokenParam = queryParams?.get?.("token") || "";
  if (tokenParam && tokenParam.startsWith("sess_")) {
    return tokenParam;
  }
  return null;
}

/**
 * Normalize user access fields for backward compatibility.
 * - Renames "full" access_level to "admin"
 * - Ensures instance_keys, partner_keys, fi_keys exist with proper defaults
 */
function normalizeUserAccessFields(user) {
  // Handle legacy "full" access_level
  let accessLevel = user.access_level;
  if (accessLevel === "full") {
    accessLevel = "admin";
  }

  // Handle legacy fi_keys-only format
  let instanceKeys = user.instance_keys;
  let partnerKeys = user.partner_keys;
  let fiKeys = user.fi_keys;

  if (instanceKeys === undefined && partnerKeys === undefined) {
    // Legacy user: only has fi_keys
    if (fiKeys === "*") {
      instanceKeys = "*";
      partnerKeys = "*";
    } else {
      instanceKeys = [];
      partnerKeys = [];
    }
  }

  // Ensure defaults
  if (instanceKeys === undefined) instanceKeys = [];
  if (partnerKeys === undefined) partnerKeys = [];
  if (fiKeys === undefined) fiKeys = [];

  return {
    access_level: accessLevel,
    instance_keys: instanceKeys,
    partner_keys: partnerKeys,
    fi_keys: fiKeys,
  };
}

async function validateSession(req, queryParams) {
  const token = extractSessionToken(req, queryParams);
  if (!token) return null;

  const sessionData = await getSession(token);
  if (!sessionData || new Date(sessionData.expires_at) < new Date()) {
    if (sessionData) await deleteSession(token);
    return null;
  }

  const users = await loadUsersFile();
  const user = users.find(
    (u) => u.email.toLowerCase() === sessionData.email.toLowerCase() && u.enabled
  );
  if (!user) return null;

  // Update last_used_at (non-blocking)
  updateSessionLastUsed(token).catch(() => {});

  // Normalize access fields for backward compatibility
  const accessFields = normalizeUserAccessFields(user);

  return {
    session: sessionData,
    user: {
      email: user.email,
      name: user.name,
      access_level: accessFields.access_level,
      instance_keys: accessFields.instance_keys,
      partner_keys: accessFields.partner_keys,
      fi_keys: accessFields.fi_keys,
    },
  };
}

async function sendMagicLinkEmail(email, name, magicLink) {
  if (!SENDGRID_API_KEY) {
    console.log("[auth] No SENDGRID_API_KEY - magic link for", email, ":", magicLink);
    return;
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email, name: name || email }] }],
      from: { email: SENDGRID_FROM_EMAIL, name: SENDGRID_FROM_NAME },
      subject: "Your Sign-In Link for SIS Metrics",
      content: [
        {
          type: "text/html",
          value: `
            <p>Hi ${name || "there"},</p>
            <p>Click the button below to sign in to SIS Metrics Dashboard:</p>
            <p><a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;">Sign In</a></p>
            <p>Or copy this link: ${magicLink}</p>
            <p>This link expires in 15 minutes.</p>
            <p>If you didn't request this, you can ignore this email.</p>
          `,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendGrid error: ${res.status} ${text}`);
  }
}

// Cleanup expired tokens/sessions every hour
setInterval(async () => {
  try {
    const sessions = await loadSessionsFile();
    const now = new Date();
    let changed = false;

    for (const [token, data] of Object.entries(sessions.magic_tokens || {})) {
      if (new Date(data.expires_at) < now) {
        delete sessions.magic_tokens[token];
        changed = true;
      }
    }

    for (const [token, data] of Object.entries(sessions.sessions || {})) {
      if (new Date(data.expires_at) < now) {
        delete sessions.sessions[token];
        changed = true;
      }
    }

    if (changed) {
      await saveSessionsFile(sessions);
      console.log("[auth] Cleaned expired tokens/sessions");
    }
  } catch (err) {
    console.error("[auth] Cleanup error:", err);
  }
}, 60 * 60 * 1000);

// ============================================================================
// End Magic Link Authentication
// ============================================================================

let synthState = {
  loaded: false,
  jobs: [],
  saving: Promise.resolve(),
};
let synthSchedulerTimer = null;
let synthRunnerActive = false;

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function parsePositiveInt(value, fallback = null) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function normalizeIsoDate(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function addDaysIso(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function computeCampaignMaxRuns(startIso, endIso, runsPerDay) {
  if (!startIso || !endIso || !runsPerDay) return null;
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
  return days * runsPerDay;
}

async function ensureSynthStore() {
  await fs.mkdir(SYNTHETIC_DIR, { recursive: true });
  if (!(await fileExists(SYNTHETIC_JOBS_FILE))) {
    const payload = { jobs: [], updated_at: new Date().toISOString() };
    await fs.writeFile(SYNTHETIC_JOBS_FILE, JSON.stringify(payload, null, 2));
  }
}

async function loadSynthJobs() {
  if (synthState.loaded) return synthState.jobs;
  try {
    await ensureSynthStore();
    const raw = await fs.readFile(SYNTHETIC_JOBS_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const jobs = Array.isArray(parsed) ? parsed : parsed.jobs;
    synthState.jobs = Array.isArray(jobs) ? jobs : [];
    synthState.loaded = true;
    return synthState.jobs;
  } catch (err) {
    console.error("[synth] Failed to load jobs:", err);
    synthState.jobs = [];
    synthState.loaded = true;
    return synthState.jobs;
  }
}

function saveSynthJobs() {
  synthState.saving = synthState.saving
    .then(async () => {
      await ensureSynthStore();
      const payload = { jobs: synthState.jobs, updated_at: new Date().toISOString() };
      await fs.writeFile(SYNTHETIC_JOBS_FILE, JSON.stringify(payload, null, 2));
    })
    .catch((err) => {
      console.error("[synth] Failed to persist jobs:", err);
    });
  return synthState.saving;
}

function synthJobDefaults(payload = {}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const createdDate = nowIso.slice(0, 10);
  const mode = payload.mode === "campaign" ? "campaign" : "one_shot";
  const testerName = (payload.tester_name || "").toString().trim();
  const fiHostEnv = (payload.fi_host_env || "").toString().trim();
  const integrationFlow = (payload.integration_flow || "").toString().trim();
  const testCardPreset = (payload.test_card_preset || "").toString().trim();
  const sourceType = (payload.source_type || "").toString().trim();
  const sourceCategory = (payload.source_category || "").toString().trim();
  const sourceSubcategory = (payload.source_subcategory || "").toString().trim();

  const totalRuns = parsePositiveInt(payload.total_runs);
  const runsPerDay = parsePositiveInt(payload.runs_per_day);
  let endDate = normalizeIsoDate(payload.end_date);
  const durationDays = parsePositiveInt(payload.duration_days);
  if (!endDate && durationDays) {
    endDate = addDaysIso(createdDate, Math.max(0, durationDays - 1));
  }

  const targetSuccessRate = clampNumber(payload.target_success_rate, 0, 100, 90);
  const targetFailRate = clampNumber(payload.target_fail_rate, 0, 100, 10);
  const abandonSelectMerchantRate = clampNumber(
    payload.abandon_select_merchant_rate,
    0,
    100,
    0
  );
  let abandonUserDataRate = clampNumber(payload.abandon_user_data_rate, 0, 100, 0);
  const isSsoFlow = integrationFlow.toLowerCase().includes("_sso");
  if (isSsoFlow) abandonUserDataRate = 0;
  const abandonCredentialEntryRate = clampNumber(
    payload.abandon_credential_entry_rate,
    0,
    100,
    0
  );
  const targetRateTotal = targetSuccessRate + targetFailRate;

  const jobNameParts = [];
  if (sourceSubcategory) jobNameParts.push(sourceSubcategory);
  if (fiHostEnv) jobNameParts.push(fiHostEnv);
  if (integrationFlow) jobNameParts.push(integrationFlow);
  const jobName = jobNameParts.join(" • ") || "Synthetic Job";

  return {
    mode,
    testerName,
    fiHostEnv,
    integrationFlow,
    testCardPreset,
    sourceType,
    sourceCategory,
    sourceSubcategory,
    totalRuns,
    runsPerDay,
    endDate,
    durationDays,
    targetSuccessRate,
    targetFailRate,
    abandonSelectMerchantRate,
    abandonUserDataRate,
    abandonCredentialEntryRate,
    createdDate,
    createdAt: nowIso,
    jobName,
  };
}

function buildSynthJob(payload = {}) {
  const defaults = synthJobDefaults(payload);
  if (!defaults.fiHostEnv) return { error: "fi_host_env is required" };
  if (!defaults.integrationFlow) return { error: "integration_flow is required" };
  if (!defaults.testCardPreset) return { error: "test_card_preset is required" };

  if (defaults.mode === "one_shot" && !defaults.totalRuns) {
    return { error: "total_runs is required for one_shot mode" };
  }
  if (defaults.mode === "campaign") {
    if (!defaults.runsPerDay) return { error: "runs_per_day is required for campaign mode" };
    if (!defaults.endDate) return { error: "end_date or duration_days is required for campaign mode" };
  }
  if (defaults.targetRateTotal > 100) {
    return { error: "target_success_rate + target_fail_rate must be <= 100" };
  }

  const id = `synth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const maxRuns =
    defaults.mode === "campaign"
      ? computeCampaignMaxRuns(defaults.createdDate, defaults.endDate, defaults.runsPerDay)
      : defaults.totalRuns;

  return {
    job: {
      id,
      job_name: defaults.jobName,
      tester_name: defaults.testerName,
      fi_host_env: defaults.fiHostEnv,
      integration_flow: defaults.integrationFlow,
      test_card_preset: defaults.testCardPreset,
      source_type: defaults.sourceType,
      source_category: defaults.sourceCategory,
      source_subcategory: defaults.sourceSubcategory,
      mode: defaults.mode,
      total_runs: defaults.totalRuns || 0,
      runs_per_day: defaults.runsPerDay || 0,
      end_date: defaults.endDate || "",
      duration_days: defaults.durationDays || 0,
      target_success_rate: defaults.targetSuccessRate,
      target_fail_rate: defaults.targetFailRate,
      abandon_select_merchant_rate: defaults.abandonSelectMerchantRate,
      abandon_user_data_rate: defaults.abandonUserDataRate,
      abandon_credential_entry_rate: defaults.abandonCredentialEntryRate,
      target_rate_total: defaults.targetRateTotal,
      created_at: defaults.createdAt,
      last_run_at: "",
      next_run_at: defaults.createdAt,
      due: false,
      status: "queued",
      attempted: 0,
      placements_success: 0,
      placements_failed: 0,
      placements_abandoned: 0,
      abandon_select_merchant: 0,
      abandon_user_data: 0,
      abandon_credential_entry: 0,
      max_runs: maxRuns || null,
    },
  };
}

function computeNextRunIso(job, fromDate = new Date()) {
  if (!job || job.mode !== "campaign") return "";
  const runsPerDay = parsePositiveInt(job.runs_per_day);
  if (!runsPerDay) return "";
  const intervalMs = Math.max(1, Math.round(86400000 / runsPerDay));
  const next = new Date(fromDate.getTime() + intervalMs);
  return next.toISOString();
}

function jobEndDateReached(job, now) {
  if (!job?.end_date) return false;
  const end = new Date(`${job.end_date}T23:59:59.999Z`);
  return Number.isFinite(end.getTime()) && now > end;
}

function simulateCounts(job, attempts) {
  const selectMerchantRate =
    clampNumber(job.abandon_select_merchant_rate, 0, 100, 0) / 100;
  const userDataRate = clampNumber(job.abandon_user_data_rate, 0, 100, 0) / 100;
  const credentialRate =
    clampNumber(job.abandon_credential_entry_rate, 0, 100, 0) / 100;
  let successRate = clampNumber(job.target_success_rate, 0, 100, 90) / 100;
  let failRate = clampNumber(job.target_fail_rate, 0, 100, 10) / 100;

  const selectAbandon = Math.round(attempts * selectMerchantRate);
  const afterSelect = Math.max(0, attempts - selectAbandon);
  const userDataAbandon = Math.round(afterSelect * userDataRate);
  const afterUserData = Math.max(0, afterSelect - userDataAbandon);
  const credentialAbandon = Math.round(afterUserData * credentialRate);
  const credentialAttempts = Math.max(0, afterUserData - credentialAbandon);

  const totalRate = successRate + failRate;
  if (totalRate > 1) {
    successRate /= totalRate;
    failRate /= totalRate;
  }

  let success = Math.round(credentialAttempts * successRate);
  let fail = Math.round(credentialAttempts * failRate);
  const remainder = credentialAttempts - success - fail;
  if (remainder !== 0) success += remainder;

  const abandon = selectAbandon + userDataAbandon + credentialAbandon;

  return {
    success,
    fail,
    abandon,
    abandon_select_merchant: selectAbandon,
    abandon_user_data: userDataAbandon,
    abandon_credential_entry: credentialAbandon,
  };
}

const synthRunnerAdapter = {
  mode: SYNTHETIC_RUNNER_MODE || "disabled",
  async runDue(jobs = []) {
    if (this.mode === "sim") {
      return runSynthSimRunner(jobs);
    }
    if (this.mode) {
      // TODO: invoke external synthetic runner via CLI or HTTP without assuming paths.
      // This is the integration boundary for the separate Playwright-based tool.
      return { updated: false, message: "external runner not wired" };
    }
    return { updated: false, message: "runner disabled" };
  },
};

async function runSynthSimRunner(jobs = []) {
  let updated = false;
  for (const job of jobs) {
    if (!job?.due) continue;
    if (job.status === "canceled" || job.status === "completed" || job.status === "paused") {
      job.due = false;
      updated = true;
      continue;
    }

    const now = new Date();
    job.status = "running";
    job.due = false;

    let attempts = 0;
    if (job.mode === "one_shot") {
      attempts = Math.max(0, job.total_runs - job.attempted);
    } else {
      attempts = 1;
    }

    if (attempts > 0) {
      const results = simulateCounts(job, attempts);
      job.attempted += attempts;
        job.placements_success += results.success;
        job.placements_failed += results.fail;
        job.placements_abandoned += results.abandon;
        job.abandon_select_merchant += results.abandon_select_merchant || 0;
        job.abandon_user_data += results.abandon_user_data || 0;
        job.abandon_credential_entry += results.abandon_credential_entry || 0;
      job.last_run_at = now.toISOString();
    }

    if (job.mode === "one_shot") {
      job.status = "completed";
      job.next_run_at = "";
    } else {
      job.status = "queued";
      if (jobEndDateReached(job, now) || (job.max_runs && job.attempted >= job.max_runs)) {
        job.status = "completed";
        job.next_run_at = "";
      } else {
        job.next_run_at = computeNextRunIso(job, now);
      }
    }

    updated = true;
  }
  return { updated };
}

async function runSynthScheduler() {
  await loadSynthJobs();
  const now = new Date();
  let changed = false;

  for (const job of synthState.jobs) {
    if (!job) continue;
    if (job.status === "canceled" || job.status === "completed" || job.status === "paused") {
      if (job.due) {
        job.due = false;
        changed = true;
      }
      continue;
    }
    if (job.status === "running") {
      if (job.due) {
        job.due = false;
        changed = true;
      }
      continue;
    }

    if (job.mode === "one_shot" && job.attempted >= job.total_runs) {
      job.status = "completed";
      job.next_run_at = "";
      job.due = false;
      changed = true;
      continue;
    }

    if (job.mode === "campaign") {
      if (jobEndDateReached(job, now) || (job.max_runs && job.attempted >= job.max_runs)) {
        job.status = "completed";
        job.next_run_at = "";
        job.due = false;
        changed = true;
        continue;
      }
    }

    if (!job.next_run_at) {
      job.next_run_at = job.mode === "campaign" ? computeNextRunIso(job, now) : now.toISOString();
      changed = true;
    }

    if (job.next_run_at) {
      const next = new Date(job.next_run_at);
      if (!Number.isNaN(next.getTime()) && now >= next) {
        if (!job.due) {
          job.due = true;
          changed = true;
        }
        if (job.status !== "queued" && job.status !== "running") {
          job.status = "queued";
          changed = true;
        }
      }
    }
  }

  if (changed) await saveSynthJobs();

  if (synthRunnerActive) return;
  synthRunnerActive = true;
  try {
    const dueJobs = synthState.jobs.filter((job) => job?.due);
    const result = await synthRunnerAdapter.runDue(dueJobs);
    if (result?.updated) await saveSynthJobs();
  } finally {
    synthRunnerActive = false;
  }
}

function startSynthScheduler() {
  if (synthSchedulerTimer) return;
  synthSchedulerTimer = setInterval(() => {
    runSynthScheduler().catch((err) => {
      console.error("[synth] Scheduler error:", err);
    });
  }, SYNTHETIC_SCHEDULER_MS);
  runSynthScheduler().catch((err) => {
    console.error("[synth] Scheduler bootstrap error:", err);
  });
}

async function serveFile(res, fp) {
  try {
    const buf = await fs.readFile(fp);
    setCors(res);
    res.writeHead(200, {
      "Content-Type": mime(path.extname(fp)),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    });
    res.end(buf);
  } catch (e) {
    send(res, 500, { error: e.message, file: fp });
  }
}

async function pickUiEntry() {
  const heatmap = path.join(PUBLIC_DIR, "heatmap.html");
  const funnel = path.join(PUBLIC_DIR, "funnel.html");
  const landing = path.join(PUBLIC_DIR, "index.html");
  if (await fileExists(landing)) return landing;
  if (await fileExists(heatmap)) return heatmap;
  if (await fileExists(funnel)) return funnel;
  // last-ditch inline page so you always see *something*
  return null;
}

async function listDaily() {
  try {
    const files = await fs.readdir(DAILY_DIR);
    return files.filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

async function loadDaily(dateStr) {
  const fp = path.join(DAILY_DIR, `${dateStr}.json`);
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

function isoOnly(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function parseIso(value, fallback) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return value;
}
function daysBetween(start, end) {
  const out = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  // guard
  if (Number.isNaN(cur) || Number.isNaN(stop) || cur > stop) return out;
  while (cur <= stop) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}
// site-health color from pct (0..100) or null if no-signal
function colorFromHealth(pct) {
  if (pct === null) return "#e5e7eb"; // gray-200 (no signal)
  if (pct >= 80) return "#22c55e"; // green-500
  if (pct >= 50) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

async function loadInstanceMetaMap() {
  const map = new Map();
  try {
    const raw = await fs.readFile(FI_REGISTRY_FILE, "utf8");
    const json = JSON.parse(raw);
    const normalizeIntegration = (value) => {
      if (!value) return "UNKNOWN";
      const upper = value.toString().trim().toUpperCase();
      if (upper === "SSO") return "SSO";
      if (upper === "NON-SSO") return "NON-SSO";
      if (upper === "CARDSAVR" || upper === "CARD-SAVR") return "CardSavr";
      if (upper === "TEST") return "TEST";
      return "UNKNOWN";
    };
    for (const [key, entry] of Object.entries(json || {})) {
      const fiName = entry.fi_name || key.split("__")[0] || key;
      const integration = normalizeIntegration(entry.integration_type);
      const partner = entry.partner || "Unknown";
      const instValue = entry.instance || null;
      if (!instValue) continue;
      const inst = instValue.toString().trim().toLowerCase();
      if (!inst) continue;
      map.set(inst, { fi: fiName, integration, partner });
    }
  } catch {
    // if registry missing, fall back to unknown metadata
  }
  return map;
}
// Extract a best-effort placement date for day-bucketing:
function placementDay(p) {
  const keys = [
    "completed_on",
    "account_linked_on",
    "job_ready_on",
    "job_created_on",
    "created_on",
  ];
  for (const k of keys) {
    const v = p?.[k];
    if (v) {
      const t = new Date(v);
      if (!Number.isNaN(t)) return t.toISOString().slice(0, 10);
    }
  }
  return null;
}

async function readInstancesFile() {
  for (const candidate of INSTANCES_FILES) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw Object.assign(new Error("secrets/instances.json must be an array"), {
          status: 400,
        });
      }
      return { entries: parsed, path: candidate };
    } catch (err) {
      if (err.code === "ENOENT") {
        // try next candidate
        continue;
      }
      throw err;
    }
  }
  return { entries: [], path: INSTANCES_FILES[0] };
}

const normalizeInstanceEntry = (entry = {}) => {
  const cleaned = (value) =>
    value === null || value === undefined ? "" : value.toString().trim();
  const next = {
    name: cleaned(entry.name),
    CARDSAVR_INSTANCE: cleaned(entry.CARDSAVR_INSTANCE),
    USERNAME: cleaned(entry.USERNAME),
    PASSWORD: cleaned(entry.PASSWORD),
    API_KEY: cleaned(entry.API_KEY),
    APP_NAME: cleaned(entry.APP_NAME),
  };
  if (!next.name) {
    throw Object.assign(new Error("Instance name is required"), {
      status: 400,
    });
  }
  if (!next.CARDSAVR_INSTANCE) {
    throw Object.assign(new Error("CARDSAVR_INSTANCE is required"), {
      status: 400,
    });
  }
  return next;
};

async function writeInstancesFile(entries) {
  console.log("[writeInstancesFile] Starting write, entries count:", entries.length);
  const sorted = [...entries].sort((a, b) =>
    (a?.name || "").localeCompare(b?.name || "")
  );
  let target = INSTANCES_FILES[0];
  console.log("[writeInstancesFile] Default target:", target);
  for (const candidate of INSTANCES_FILES) {
    try {
      await fs.access(candidate);
      target = candidate;
      console.log("[writeInstancesFile] Found existing file:", target);
      break;
    } catch {
      // missing, keep searching
      console.log("[writeInstancesFile] File not found:", candidate);
    }
  }
  console.log("[writeInstancesFile] Writing to:", target);
  await fs.writeFile(target, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  console.log("[writeInstancesFile] Write completed successfully");
  return { entries: sorted, path: target };
}

function getGaCredentialConfig(name) {
  const key = (name || "").toString().trim().toLowerCase();
  const cfg = GA_CREDENTIALS.find((c) => c.name === key) || null;
  if (!cfg) {
    throw Object.assign(new Error("Unknown GA credential name"), { status: 400 });
  }
  return cfg;
}

function validateGaServiceAccountJson(obj) {
  if (!obj || typeof obj !== "object") {
    throw Object.assign(new Error("Missing JSON object"), { status: 400 });
  }
  const type = (obj.type || "").toString();
  const clientEmail = (obj.client_email || "").toString();
  const privateKey = (obj.private_key || "").toString();
  if (type !== "service_account") {
    throw Object.assign(new Error("Invalid GA credential: expected type=service_account"), {
      status: 400,
    });
  }
  if (!clientEmail || !privateKey) {
    throw Object.assign(new Error("Invalid GA credential: missing client_email or private_key"), {
      status: 400,
    });
  }
  return obj;
}

async function readGaCredentialSummary(name) {
  const cfg = getGaCredentialConfig(name);
  try {
    const raw = await fs.readFile(cfg.file, "utf8");
    const obj = JSON.parse(raw || "{}");
    const stat = await fs.stat(cfg.file).catch(() => null);
    return {
      name: cfg.name,
      label: cfg.label,
      exists: true,
      path: cfg.file,
      updatedAt: stat ? stat.mtime.toISOString() : null,
      summary: {
        type: obj?.type || null,
        projectId: obj?.project_id || null,
        clientEmail: obj?.client_email || null,
        hasPrivateKey: !!obj?.private_key,
      },
    };
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return {
        name: cfg.name,
        label: cfg.label,
        exists: false,
        path: cfg.file,
        updatedAt: null,
        summary: null,
      };
    }
    throw err;
  }
}

async function readGaCredentialContent(name) {
  const cfg = getGaCredentialConfig(name);
  const summary = await readGaCredentialSummary(name);
  if (!summary.exists) return { ...summary, json: null, jsonText: "" };
  const raw = await fs.readFile(cfg.file, "utf8");
  const obj = JSON.parse(raw || "{}");
  return { ...summary, json: obj, jsonText: JSON.stringify(obj, null, 2) };
}

async function writeGaCredentialFile(name, payload) {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("Payload must be a JSON object"), { status: 400 });
  }
  const cfg = getGaCredentialConfig(name);

  let obj = null;
  if (payload.json && typeof payload.json === "object") {
    obj = payload.json;
  } else if (typeof payload.jsonText === "string") {
    obj = JSON.parse(payload.jsonText || "{}");
  } else {
    obj = payload;
  }
  validateGaServiceAccountJson(obj);

  await fs.mkdir(path.dirname(cfg.file), { recursive: true });
  await fs.writeFile(cfg.file, JSON.stringify(obj, null, 2) + "\n", "utf8");
  return readGaCredentialContent(cfg.name);
}

async function deleteGaCredentialFile(name) {
  const cfg = getGaCredentialConfig(name);
  try {
    await fs.unlink(cfg.file);
  } catch (err) {
    if (err && err.code === "ENOENT") return readGaCredentialSummary(cfg.name);
    throw err;
  }
  return readGaCredentialSummary(cfg.name);
}

function pickSs01Instance(instances = []) {
  const lowerName = (v) => (v || "").toString().trim().toLowerCase();
  const match = instances.find(
    (entry) =>
      lowerName(entry?.name) === "ss01" ||
      lowerName(entry?.CARDSAVR_INSTANCE || "").includes("ss01")
  );
  return match || instances[0] || null;
}

async function fetchMerchantSitesFromSs01() {
  const { entries } = await readInstancesFile();
  const ss01 = pickSs01Instance(entries);
  if (!ss01) {
    throw new Error("No ss01 instance credentials found.");
  }

  const { session } = await loginWithSdk(ss01);
  const sites = [];
  let pagingMeta = null;
  let guard = 0;
  while (guard < 200) {
    const headers = pagingMeta
      ? { "x-cardsavr-paging": JSON.stringify(pagingMeta) }
      : {};
    const resp = await getMerchantSitesPage(session, headers);
    const rows =
      Array.isArray(resp?.body) ||
      Array.isArray(resp?.merchant_sites) ||
      Array.isArray(resp?.items)
        ? resp.body || resp.merchant_sites || resp.items
        : Array.isArray(resp)
        ? resp
        : [];
    sites.push(
      ...rows.map((r) => ({
        id: r.id,
        name: r.name || r.display_name || "",
        host: r.host || r.hostname || "",
        tags: Array.isArray(r.tags) ? r.tags : [],
        tier: r.tier ?? null,
      }))
    );

    const pagingHeader = resp?.headers?.get
      ? resp.headers.get("x-cardsavr-paging")
      : resp?.headers?.["x-cardsavr-paging"];

    if (!pagingHeader) break;
    try {
      pagingMeta = JSON.parse(pagingHeader);
    } catch {
      break;
    }
    const total = Number(pagingMeta.total_results) || rows.length;
    const pageLen = Number(pagingMeta.page_length) || rows.length || 25;
    const totalPages = pageLen > 0 ? Math.ceil(total / pageLen) : 1;
    const nextPage = (Number(pagingMeta.page) || pagingMeta.page || 1) + 1;
    if (nextPage > totalPages) break;
    pagingMeta.page = nextPage;
    if (!pagingMeta.page_length) pagingMeta.page_length = pageLen;
    guard += 1;
  }

  return sites;
}

async function fetchAllFinancialInstitutions(progressCallback = null) {
  const { entries } = await readInstancesFile();

  const allFis = [];
  const instanceStatuses = {};
  const instanceNames = entries.map(e => e.name);
  const totalInstances = entries.length;
  let currentInstanceIndex = 0;

  for (const inst of entries) {
    currentInstanceIndex++;
    if (progressCallback) {
      progressCallback({
        type: 'progress',
        current: currentInstanceIndex,
        total: totalInstances,
        instance: inst.name,
        fisLoaded: allFis.length
      });
    }
    try {
      console.log(`Fetching FIs from ${inst.name}...`);
      const { session } = await loginWithSdk(inst);

      let pagingMeta = null;
      let guard = 0;
      let lastPage = 0;

      while (guard < 200) {
        let resp;
        try {
          if (pagingMeta) {
            console.log(`[${inst.name}] Fetching page with paging:`, JSON.stringify(pagingMeta));
            // Pass paging as second parameter (header), not as query params
            resp = await session.getFinancialInstitutions({}, pagingMeta);
          } else {
            console.log(`[${inst.name}] Fetching first page (no paging)`);
            resp = await session.getFinancialInstitutions({});
          }
        } catch (err) {
          console.error(`[${inst.name}] SDK call failed:`, err);
          throw err;
        }

        // Check for pagination header first
        const pagingHeader = resp?.headers?.get
          ? resp.headers.get("x-cardsavr-paging")
          : resp?.headers?.["x-cardsavr-paging"];

        let currentPage = 1;
        if (pagingHeader) {
          try {
            const parsedPaging = JSON.parse(pagingHeader);
            currentPage = Number(parsedPaging.page) || 1;
          } catch {
            // ignore parse error
          }
        }

        // Check if API returned same page as last time (ignoring our page request)
        if (lastPage > 0 && currentPage === lastPage) {
          console.log(`[${inst.name}] API returned page ${currentPage} again (ignoring pagination), stopping without adding duplicates`);
          break;
        }

        // Track the page we just received
        lastPage = currentPage;

        // Normalize response structure
        const rows = Array.isArray(resp?.body)
          ? resp.body
          : Array.isArray(resp?.financial_institutions)
          ? resp.financial_institutions
          : Array.isArray(resp)
          ? resp
          : [];

        // Enrich each FI with instance name and send progress update
        for (const fi of rows) {
          allFis.push({ ...fi, _instance: inst.name });
          // Send progress update after each FI added
          if (progressCallback) {
            progressCallback({
              type: 'progress',
              current: currentInstanceIndex,
              total: totalInstances,
              instance: inst.name,
              fisLoaded: allFis.length
            });
          }
        }

        console.log(`[${inst.name}] Fetched ${rows.length} FIs (total so far: ${allFis.filter(f => f._instance === inst.name).length})`);

        if (!pagingHeader) {
          console.log(`[${inst.name}] No paging header found, stopping pagination`);
          break;
        }

        console.log(`[${inst.name}] Paging header:`, pagingHeader);

        try {
          pagingMeta = JSON.parse(pagingHeader);
        } catch {
          break;
        }

        const total = Number(pagingMeta.total_results) || rows.length;
        const pageLen = Number(pagingMeta.page_length) || rows.length || 25;
        const totalPages = pageLen > 0 ? Math.ceil(total / pageLen) : 1;
        const nextPage = currentPage + 1;

        console.log(`[${inst.name}] Paging: page ${currentPage}, total_results=${total}, page_length=${pageLen}, totalPages=${totalPages}`);

        if (nextPage > totalPages) {
          console.log(`[${inst.name}] Reached last page, stopping pagination`);
          break;
        }

        // Create new paging object for next request
        pagingMeta = {
          ...pagingMeta,
          page: nextPage,
          page_length: pagingMeta.page_length || pageLen
        };
        guard += 1;
      }

      instanceStatuses[inst.name] = 'success';
      console.log(`✅ Fetched FIs from ${inst.name}: ${allFis.filter(f => f._instance === inst.name).length} records`);

    } catch (err) {
      console.error(`❌ Failed to fetch FIs from ${inst.name}:`, err.message);
      instanceStatuses[inst.name] = 'error';
    }
  }

  return {
    fis: allFis,
    instances: instanceNames,
    instanceStatuses,
    fetchedAt: new Date().toISOString(),
    totalCount: allFis.length
  };
}

async function readPlacementDay(day) {
  try {
    const fp = path.join(RAW_PLACEMENTS_DIR, `${day}.json`);
    const raw = await fs.readFile(fp, "utf8");
    const data = JSON.parse(raw);
    console.log(`📂 Read placements for ${day}: ${data.placements?.length || 0} records`);
    return data;
  } catch {
    return null;
  }
}

async function readSessionDay(day) {
  try {
    const fp = path.join(RAW_DIR, "sessions", `${day}.json`);
    const raw = await fs.readFile(fp, "utf8");
    const data = JSON.parse(raw);
    console.log(`📂 Read sessions for ${day}: ${data.sessions?.length || 0} records`);
    return data;
  } catch {
    return null;
  }
}

async function listRawDays(type = "sessions") {
  const dir = path.join(RAW_DIR, type);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

function normalizeFiKey(value) {
  return value ? value.toString().trim().toLowerCase() : "";
}

function normalizeIntegration(value) {
  if (!value) return "UNKNOWN";
  const upper = value.toString().trim().toUpperCase();
  if (upper === "NON-SSO" || upper === "NON_SSO" || upper.includes("NONSSO")) return "NON-SSO";
  if (upper.includes("SSO")) return "SSO";
  if (upper.includes("CARDSAVR") || upper.includes("CARD-SAVR")) return "CardSavr";
  if (upper === "TEST") return "TEST";
  return "UNKNOWN";
}

function canonicalInstance(value) {
  if (!value) return "";
  return value.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeInstanceKey(value) {
  const normalized = canonicalInstance(value);
  return normalized || "unknown";
}

function makeFiInstanceKey(fiKey, instanceValue) {
  return `${normalizeFiKey(fiKey)}__${normalizeInstanceKey(instanceValue)}`;
}

function parseListParam(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => (entry || "").toString().trim())
      .filter(Boolean);
  }
  return value
    .toString()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSourceToken(value) {
  if (!value) return "";
  return value.toString().trim().toLowerCase();
}

/**
 * Compute the set of FI lookup keys a user can access based on their access configuration.
 * Returns null if user has unrestricted access (admin or any wildcard).
 * Returns Set<string> of normalized fi_lookup_keys otherwise.
 *
 * Uses UNION semantics: user can access an FI if it matches ANY of their access criteria.
 */
function computeAllowedFis(userContext, fiRegistry) {
  if (!userContext) return null; // No user context = unrestricted

  // Admin and internal users always have full data access
  if (userContext.access_level === "admin" || userContext.access_level === "internal") {
    return null;
  }

  // Check for wildcard access on any dimension
  const hasFullInstanceAccess = userContext.instance_keys === "*";
  const hasFullPartnerAccess = userContext.partner_keys === "*";
  const hasFullFiAccess = userContext.fi_keys === "*";

  // If any dimension is "*", user has full access
  if (hasFullInstanceAccess || hasFullPartnerAccess || hasFullFiAccess) {
    return null;
  }

  // Normalize access arrays
  const instanceKeys = Array.isArray(userContext.instance_keys)
    ? new Set(userContext.instance_keys.map((k) => normalizeInstanceKey(k)))
    : new Set();
  const partnerKeys = Array.isArray(userContext.partner_keys)
    ? new Set(userContext.partner_keys.map((k) => (k || "").toString().trim().toLowerCase()))
    : new Set();
  const fiKeys = Array.isArray(userContext.fi_keys)
    ? new Set(userContext.fi_keys.map((k) => normalizeFiKey(k)))
    : new Set();

  // If all dimensions are empty, no access
  if (instanceKeys.size === 0 && partnerKeys.size === 0 && fiKeys.size === 0) {
    return new Set(); // empty = no access
  }

  // Build allowed FI set from registry using UNION logic
  const allowed = new Set();

  // Add directly specified FIs
  for (const fi of fiKeys) {
    allowed.add(fi);
  }

  // Add FIs matching instance or partner criteria from registry
  if (fiRegistry && typeof fiRegistry === "object") {
    for (const entry of Object.values(fiRegistry)) {
      if (!entry || !entry.fi_lookup_key) continue;
      const fiKey = normalizeFiKey(entry.fi_lookup_key);

      // Check instance match
      if (instanceKeys.size > 0 && entry.instance) {
        if (instanceKeys.has(normalizeInstanceKey(entry.instance))) {
          allowed.add(fiKey);
          continue;
        }
      }

      // Check partner match
      if (partnerKeys.size > 0 && entry.partner) {
        const normalizedPartner = entry.partner.toString().trim().toLowerCase();
        if (partnerKeys.has(normalizedPartner)) {
          allowed.add(fiKey);
        }
      }
    }
  }

  return allowed;
}

function parseMetricsFilters(queryParams, payload = null, userContext = null, fiRegistry = null) {
  const query = Object.fromEntries(queryParams.entries());
  const body = payload && typeof payload === "object" ? payload : {};
  const dateFrom =
    body.date_from ||
    body.start ||
    body.startDate ||
    query.date_from ||
    query.start ||
    query.startDate ||
    "";
  const dateTo =
    body.date_to ||
    body.end ||
    body.endDate ||
    query.date_to ||
    query.end ||
    query.endDate ||
    "";

  const fiScopeRaw =
    body.fi_scope ||
    body.fiScope ||
    query.fi_scope ||
    query.fiScope ||
    "all";
  const fiScope = fiScopeRaw.toString().trim().toLowerCase() || "all";

  let fiList = parseListParam(body.fi_list || body.fiList || query.fi_list || query.fiList);
  const sourceTypeList = parseListParam(
    body.source_type_list || body.sourceTypeList || query.source_type_list || query.sourceTypeList
  );
  const sourceCategoryList = parseListParam(
    body.source_category_list ||
      body.sourceCategoryList ||
      query.source_category_list ||
      query.sourceCategoryList
  );
  const instanceList = parseListParam(
    body.instance_list || body.instanceList || query.instance_list || query.instanceList
  );
  const merchantList = parseListParam(
    body.merchant_list || body.merchantList || query.merchant_list || query.merchantList
  );

  // ENFORCE USER FI RESTRICTIONS (instance, partner, or specific FIs)
  const allowedFis = computeAllowedFis(userContext, fiRegistry);
  if (allowedFis !== null) {
    // User has restricted access
    if (fiList.length === 0) {
      // User requested all - restrict to their allowed FIs
      fiList = Array.from(allowedFis);
    } else {
      // User requested specific - filter to intersection
      fiList = fiList.filter((fi) => allowedFis.has(normalizeFiKey(fi)));
    }

    // If no overlap, use a placeholder that matches nothing
    if (fiList.length === 0) {
      fiList = ["__no_access__"];
    }
  }

  return {
    date_from: dateFrom,
    date_to: dateTo,
    fi_scope: fiScope,
    fi_list: fiList,
    source_type_list: sourceTypeList,
    source_category_list: sourceCategoryList,
    instance_list: instanceList,
    merchant_list: merchantList,
  };
}

function resolveDateRange(filters) {
  const start = normalizeIsoDate(filters.date_from);
  const end = normalizeIsoDate(filters.date_to);
  if (!start || !end) {
    throw Object.assign(new Error("date_from and date_to must be YYYY-MM-DD"), { status: 400 });
  }
  if (new Date(`${start}T00:00:00Z`) > new Date(`${end}T00:00:00Z`)) {
    throw Object.assign(new Error("date_from must be on or before date_to"), { status: 400 });
  }
  return { start, end };
}

function extractSourceFromPlacement(placement) {
  if (!placement || typeof placement !== "object") return null;
  const source = placement.source || {};
  const custom = placement.custom_data || {};
  const digital = custom.digital_onboarding || {};
  const sourceType =
    source.type ||
    source.source_type ||
    custom.source_type ||
    (digital && Object.keys(digital).length ? "digital_onboarding" : "");
  const sourceCategory =
    source.category ||
    source.source_category ||
    custom.source_category ||
    digital.slug ||
    digital.journey_id ||
    "";
  if (!sourceType && !sourceCategory) return null;
  return {
    source_type: sourceType ? sourceType.toString().trim() : "",
    source_category: sourceCategory ? sourceCategory.toString().trim() : "",
  };
}

function extractSourceFromSession(session, fallback) {
  if (!session || typeof session !== "object") return fallback || null;
  const source = session.source || {};
  const custom = session.custom_data || {};
  const sourceType =
    source.type || source.source_type || custom.source_type || (fallback?.source_type || "");
  const sourceCategory =
    source.category ||
    source.source_category ||
    custom.source_category ||
    (fallback?.source_category || "");
  if (!sourceType && !sourceCategory) return null;
  return {
    source_type: sourceType ? sourceType.toString().trim() : "",
    source_category: sourceCategory ? sourceCategory.toString().trim() : "",
  };
}

function hasClickstreamMatch(clickstream, matcher) {
  if (!Array.isArray(clickstream)) return false;
  return clickstream.some((step) => {
    const url = (step?.url || "").toString().toLowerCase();
    const title = (step?.page_title || "").toString().toLowerCase();
    return matcher(url, title);
  });
}

function resolveSessionFunnelFlags(session) {
  const clickstream = Array.isArray(session?.clickstream) ? session.clickstream : [];
  const reachedSelectMerchant = hasClickstreamMatch(clickstream, (url, title) =>
    url.includes("select-merchant") || title.includes("select merchant")
  );
  const reachedCredentialEntry = hasClickstreamMatch(clickstream, (url, title) =>
    url.includes("credential-entry") || title.includes("credential entry")
  );
  return {
    reachedSelectMerchant,
    reachedCredentialEntry,
    successfulJobs: Number.isFinite(session?.successful_jobs) ? session.successful_jobs : 0,
  };
}

function resolveSessionJobCounts(session) {
  const totalJobs = Number.isFinite(session?.total_jobs)
    ? session.total_jobs
    : Number.isFinite(session?.failed_jobs) || Number.isFinite(session?.successful_jobs)
    ? Math.max(0, (session?.failed_jobs || 0) + (session?.successful_jobs || 0))
    : 0;
  const successfulJobs = Number.isFinite(session?.successful_jobs)
    ? session.successful_jobs
    : 0;
  const failedJobs = Number.isFinite(session?.failed_jobs)
    ? session.failed_jobs
    : Math.max(0, totalJobs - successfulJobs);
  const normalizedTotal = Math.max(totalJobs, successfulJobs + failedJobs);
  return {
    total: Math.max(0, normalizedTotal),
    success: Math.max(0, successfulJobs),
    failed: Math.max(0, failedJobs),
  };
}

function formatSourceKey(sourceType, sourceCategory) {
  const type = sourceType || "unknown";
  const category = sourceCategory || "unknown";
  return `${type}__${category}`;
}

const CANCELLED_TERMINATIONS = new Set(["CANCELED", "CANCELLED"]);
const ABANDON_TERMINATIONS = new Set([
  "NEVER_STARTED",
  "TIMEOUT_CREDENTIALS",
  "TIMEOUT_TFA",
  "ABANDONED_QUICKSTART",
  "ACCOUNT_SETUP_INCOMPLETE",
  "USER_DATA_FAILURE",
  "TOO_MANY_LOGIN_FAILURES",
  "ACCOUNT_LOCKED",
  "PASSWORD_RESET_REQUIRED",
  "INVALID_CARD_DETAILS",
]);

function categorizeJobStatus(job) {
  if (!job) return "failed";
  if (job.is_success) return "success";
  const term = (job.termination || "").toString().trim().toUpperCase();
  const status = (job.status || "").toString().trim().toUpperCase();
  if (CANCELLED_TERMINATIONS.has(term) || status.includes("CANCEL")) return "cancelled";
  if (
    ABANDON_TERMINATIONS.has(term) ||
    status.includes("ABANDON") ||
    status.includes("TIMEOUT")
  ) {
    return "abandoned";
  }
  return "failed";
}

function clampNonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function dateKeyFromValue(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (value) {
    const str = value.toString();
    if (str.length >= 10) return str.slice(0, 10);
  }
  return fallback || "";
}

function normalizeFiInstanceKey(value) {
  if (!value) return "";
  const raw = value.toString().trim();
  if (!raw) return "";
  if (!raw.includes("__")) {
    return makeFiInstanceKey(raw, "unknown");
  }
  const [fiPart, instPart] = raw.split("__");
  return makeFiInstanceKey(fiPart, instPart);
}

function formatInstanceDisplay(value) {
  if (!value) return "unknown";
  const base = value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return base || "unknown";
}

function medianFromFrequencyMap(freqMap, totalCount) {
  if (!totalCount) return null;
  const lowerIndex = Math.floor((totalCount - 1) / 2);
  const upperIndex = Math.floor(totalCount / 2);
  const sortedKeys = Array.from(freqMap.keys()).sort((a, b) => a - b);
  let cursor = 0;
  let lowerValue = null;
  let upperValue = null;
  for (const key of sortedKeys) {
    const count = freqMap.get(key) || 0;
    if (!count) continue;
    const start = cursor;
    const end = cursor + count - 1;
    if (lowerValue === null && lowerIndex >= start && lowerIndex <= end) {
      lowerValue = key;
    }
    if (upperValue === null && upperIndex >= start && upperIndex <= end) {
      upperValue = key;
    }
    if (lowerValue !== null && upperValue !== null) break;
    cursor += count;
  }
  if (lowerValue === null || upperValue === null) return null;
  return (lowerValue + upperValue) / 2;
}

async function loadFiRegistrySafe() {
  try {
    const raw = await fs.readFile(FI_REGISTRY_FILE, "utf8");
    const data = JSON.parse(raw);
    const count = Object.keys(data).length;
    console.log(`📂 Loaded FI registry: ${count} FIs`);
    return data;
  } catch (err) {
    console.warn(`⚠️  Failed to load FI registry: ${err.message}`);
    return {};
  }
}

function buildFiMetaMap(fiRegistry = {}) {
  const map = new Map();
  for (const entry of Object.values(fiRegistry)) {
    if (!entry || typeof entry !== "object") continue;
    const fiKey = normalizeFiKey(entry.fi_lookup_key || entry.fi_name);
    if (!fiKey) continue;
    const integration = normalizeIntegration(entry.integration_type);
    const partner = entry.partner || "Unknown";
    map.set(fiKey, {
      fi: entry.fi_name || fiKey,
      integration,
      partner,
    });
  }
  return map;
}

function mapPlacementToJob(placement, fiFallback, instanceFallback) {
  const termination = (placement?.termination_type || placement?.termination || placement?.status || "UNKNOWN")
    .toString()
    .trim()
    .toUpperCase() || "UNKNOWN";
  const terminationRule = TERMINATION_RULES[termination] || TERMINATION_RULES.UNKNOWN;
  const created = placement.job_created_on || placement.created_on || null;
  const completed =
    placement.completed_on ||
    placement.account_linked_on ||
    placement.last_updated_on ||
    null;
  let durationMs = null;
  if (created && completed) {
    const start = new Date(created);
    const end = new Date(completed);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      durationMs = end - start;
    }
  }
  const instance =
    placement._instance ||
    placement.instance ||
    placement.instance_name ||
    placement.org_name ||
    instanceFallback ||
    "";
  const fi = normalizeFiKey(
    placement.fi_lookup_key ||
      placement.financial_institution_lookup_key ||
      placement.fi_name ||
      fiFallback
  );
  const jobId =
    placement.id ||
    placement.result_id ||
    placement.place_card_on_single_site_job_id ||
    placement.job_id ||
    null;
  const merchant =
    placement.merchant_site_hostname ||
    (placement.merchant_site_id
      ? `merchant_${placement.merchant_site_id}`
      : "unknown");
  return {
    id: jobId,
    merchant,
    termination,
    termination_label: terminationRule?.label || termination,
    severity: terminationRule?.severity || "unknown",
    status: placement.status || "",
    status_message: placement.status_message || "",
    created_on: created || null,
    ready_on: placement.job_ready_on || null,
    completed_on: completed,
    duration_ms: durationMs,
    instance: formatInstanceDisplay(instance),
    fi_key: fi || fiFallback || "",
    source_integration: placement.source?.integration || null,
    is_success:
      termination === "BILLABLE" ||
      (placement.status || "").toString().toUpperCase() === "SUCCESSFUL",
  };
}

function mapSessionToTroubleshootEntry(session, placementMap, fiMeta, instanceMeta) {
  const agentId =
    session.agent_session_id ||
    session.session_id ||
    session.id ||
    session.cuid ||
    null;
  const instanceRaw =
    session._instance || session.instance || session.instance_name || session.org_name || "";
  const instanceDisplay = formatInstanceDisplay(instanceRaw || "unknown");
  const normalizedInstance = canonicalInstance(instanceDisplay);
  const instanceLookup = instanceMeta.get(instanceDisplay.toLowerCase());
  const fiFromInstance = instanceLookup?.fi || null;
  const fiLookupRaw =
    session.financial_institution_lookup_key ||
    session.fi_lookup_key ||
    session.fi_name ||
    null;
  const fiKey = normalizeFiKey(
    fiLookupRaw || fiFromInstance || session.fi_name || null
  );
  const fiEntry = fiMeta.get(fiKey);
  const partner = instanceLookup?.partner || fiEntry?.partner || "Unknown";
  const placementsRaw = agentId ? placementMap.get(agentId) || [] : [];
  const jobs = placementsRaw
    .map((pl) => mapPlacementToJob(pl, fiKey, instanceDisplay))
    .sort((a, b) => {
      if (!a.created_on || !b.created_on) return 0;
      return a.created_on.localeCompare(b.created_on);
    });
  const jobIntegrationRaw = jobs.find((j) => j.source_integration)?.source_integration || null;
  const jobIntegrationNormalized = normalizeIntegration(jobIntegrationRaw);
  const sourceIntegrationRaw = session.source?.integration || null;
  const sourceIntegrationNormalized = normalizeIntegration(sourceIntegrationRaw);
  let integrationNormalized = sourceIntegrationNormalized;
  let integrationRaw = sourceIntegrationRaw;
  if (integrationNormalized === "UNKNOWN" && jobIntegrationRaw) {
    integrationNormalized = jobIntegrationNormalized;
    integrationRaw = jobIntegrationRaw;
  }
  if (integrationNormalized === "UNKNOWN" && fiEntry?.integration) {
    integrationNormalized = normalizeIntegration(fiEntry.integration);
    if (!integrationRaw) integrationRaw = fiEntry.integration;
  }
  const displayIntegration =
    integrationNormalized !== "UNKNOWN"
      ? integrationNormalized
      : integrationRaw
      ? integrationRaw.toString()
      : "UNKNOWN";
  const totalJobs = session.total_jobs ?? jobs.length;
  const successfulJobs = session.successful_jobs ?? jobs.filter((j) => j.is_success).length;
  const failedJobs =
    session.failed_jobs ??
    (Number.isFinite(totalJobs) ? Math.max(0, totalJobs - successfulJobs) : jobs.length - successfulJobs);

  return {
    id: session.id || session.session_id || agentId || session.cuid || null,
    cuid: session.cuid || null,
    agent_session_id: agentId,
    fi_key: fiKey || fiFromInstance || "unknown_fi",
    fi_lookup_key: fiLookupRaw || null,
    fi_name: fiEntry?.fi || session.fi_name || fiKey || "Unknown FI",
    partner,
    integration: integrationNormalized,
    integration_raw: integrationRaw || null,
    integration_display: displayIntegration || integrationNormalized || "UNKNOWN",
    instance: instanceDisplay,
    is_test: isTestInstanceName(instanceDisplay),
    created_on: session.created_on || null,
    closed_on: session.closed_on || null,
    total_jobs: totalJobs,
    successful_jobs: successfulJobs,
    failed_jobs: failedJobs,
    clickstream: Array.isArray(session.clickstream)
      ? session.clickstream.map((step) => ({
          url: step.url || "",
          page_title: step.page_title || "",
          at: step.timestamp || step.time || null,
        }))
      : [],
    jobs,
    source: {
      integration: session.source?.integration || null,
      device: session.source?.device || null,
    },
    placements_raw: placementsRaw,
  };
}

function buildTroubleshootPayload(date, sessionsRaw, placementsRaw, fiMeta, instanceMeta) {
  const placementMap = new Map();
  const placements = Array.isArray(placementsRaw?.placements) ? placementsRaw.placements : [];
  for (const pl of placements) {
    const key =
      pl.agent_session_id ||
      pl.session_id ||
      pl.cardholder_session_id ||
      pl.cuid ||
      null;
    if (!key) continue;
    const list = placementMap.get(key) || [];
    list.push(pl);
    placementMap.set(key, list);
  }

  const sessions = Array.isArray(sessionsRaw?.sessions) ? sessionsRaw.sessions : [];
  const rows = sessions.map((s) =>
    mapSessionToTroubleshootEntry(s, placementMap, fiMeta, instanceMeta)
  );

  const totals = summarizeTroubleshootSessions(rows);

  return {
    date,
    totals,
    sessions: rows,
    placements: placements.length,
  };
}

function summarizeTroubleshootSessions(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.sessions += 1;
      const jobCount = Array.isArray(row.jobs) ? row.jobs.length : 0;
      if (jobCount > 0) acc.sessions_with_jobs += 1;
      const successes = row.jobs.filter((j) => j.is_success).length;
      if (successes > 0) acc.sessions_with_success += 1;
      acc.jobs += jobCount;
      acc.jobs_success += successes;
      acc.jobs_failure += Math.max(0, jobCount - successes);
      for (const job of row.jobs) {
        const term = job.termination || "UNKNOWN";
        acc.by_termination[term] = (acc.by_termination[term] || 0) + 1;
      }
      return acc;
    },
    {
      sessions: 0,
      sessions_with_jobs: 0,
      sessions_with_success: 0,
      jobs: 0,
      jobs_success: 0,
      jobs_failure: 0,
      by_termination: {},
    }
  );
}

async function loadTroubleshootRange(startDate, endDate) {
  const days = daysBetween(startDate, endDate);
  const sessions = [];
  const placements = [];
  for (const day of days) {
    const s = await readSessionDay(day);
    if (s?.sessions) sessions.push(...s.sessions);
    const p = await readPlacementDay(day);
    if (p?.placements) placements.push(...p.placements);
  }
  return { sessions, placements };
}

async function buildTroubleshootOptions() {
  const [days, fiRegistry] = await Promise.all([
    listRawDays("sessions"),
    loadFiRegistrySafe(),
  ]);
  const fiMeta = buildFiMetaMap(fiRegistry);
  const fiOptions = Array.from(fiMeta.entries()).map(([key, entry]) => ({
    key,
    label: entry.fi || key,
    partner: entry.partner || "Unknown",
    integration: entry.integration || "UNKNOWN",
  }));
  const partnerSet = new Set(fiOptions.map((fi) => fi.partner || "Unknown"));
  const integrationSet = new Set(fiOptions.map((fi) => fi.integration || "UNKNOWN"));
  const instanceSet = new Set();
  for (const entry of Object.values(fiRegistry)) {
    const primary = entry.instance ? formatInstanceDisplay(entry.instance) : null;
    if (primary) instanceSet.add(primary);
  }
  return {
    days,
    defaultDate: days[days.length - 1] || todayIsoDate(),
    fi: fiOptions.sort((a, b) => a.label.localeCompare(b.label)),
    partners: Array.from(partnerSet).sort(),
    integrations: Array.from(integrationSet)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    instances: Array.from(instanceSet).sort(),
  };
}

function createPlacementStore() {
  return {
    total: 0,
    billable: 0,
    siteFailures: 0,
    userFlowIssues: 0,
    daily: Object.create(null),
  };
}

function ensureDailyEntry(store, day) {
  if (!store.daily[day]) {
    store.daily[day] = {
      billable: 0,
      siteFailures: 0,
      userFlowIssues: 0,
      total: 0,
    };
  }
  return store.daily[day];
}

function summarizeStore(store, days) {
  const dayCells = days.map((day) => {
    const entry = store.daily[day] || {
      billable: 0,
      siteFailures: 0,
      userFlowIssues: 0,
      total: 0,
    };
    const billable = entry.billable || 0;
    const siteFailures = entry.siteFailures || 0;
    const userFlowIssues = entry.userFlowIssues || 0;
    const total = entry.total || 0;
    const denom = billable + siteFailures;
    const pct =
      denom > 0 ? Number(((billable / denom) * 100).toFixed(1)) : null;
    return {
      day,
      billable,
      siteFail: siteFailures,
      siteFailures,
      userFlowIssues,
      total,
      pct,
    };
  });

  const overallDenom = (store.billable || 0) + (store.siteFailures || 0);
  const overallHealthPct =
    overallDenom > 0
      ? Number(((store.billable / overallDenom) * 100).toFixed(1))
      : null;

  return {
    total: store.total || 0,
    billable: store.billable || 0,
    siteFailures: store.siteFailures || 0,
    userFlowIssues: store.userFlowIssues || 0,
    overallHealthPct,
    days: dayCells,
  };
}

async function buildGlobalMerchantHeatmap(startIso, endIso) {
  // Build day list
  const days = daysBetween(startIso, endIso);
  const slices = [];
  const instanceMeta = await loadInstanceMetaMap();

  for (const day of days) {
    const raw = await readPlacementDay(day);
    if (!raw || raw.error || !Array.isArray(raw.placements)) continue;

    for (const pl of raw.placements) {
      const merchant =
        pl.merchant_site_hostname ||
        (pl.merchant_site_id ? `merchant_${pl.merchant_site_id}` : "UNKNOWN");
      const instanceName =
        pl._instance ||
        pl.instance ||
        pl.instance_name ||
        pl.org_name ||
        "";
      const isTestInstance = isTestInstanceName(instanceName);
      const meta = instanceMeta.get(instanceName?.toLowerCase?.() || "");
      const fiKey = normalizeFiKey(
        pl.fi_lookup_key || pl.fi_name || meta?.fi || "unknown_fi"
      );

      const term = (pl.termination_type || "").toString().toUpperCase();
      const status = (pl.status || "").toString().toUpperCase();
      const rule =
        TERMINATION_RULES[term] ||
        TERMINATION_RULES[status] ||
        TERMINATION_RULES.UNKNOWN;

      const dKey = placementDay(pl) || day;

      const slice = {
        day: dKey,
        merchant,
        fi: fiKey || "unknown_fi",
        is_test: isTestInstance,
        total: 1,
        billable: 0,
        siteFailures: 0,
        userFlowIssues: 0,
      };
      if (rule.includeInHealth) {
        if (rule.severity === "success") {
          slice.billable = 1;
        } else {
          slice.siteFailures = 1;
        }
      } else if (rule.includeInUx) {
        slice.userFlowIssues = 1;
      } else {
        slice.siteFailures = 1;
      }
      slices.push(slice);
    }
  }

  return { start: startIso, end: endIso, days, slices };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const search = parsedUrl.search;
  const queryParams = new URLSearchParams(search || "");

  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Log all HTTP requests (except asset/static files to reduce noise)
  const skipLogging = pathname.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/);
  if (!skipLogging && pathname !== "/server-logs") {
    const queryStr = redactQueryForLogs(search);
    console.log(`${req.method} ${pathname}${queryStr}`);
  }

  // ========== Auth Endpoints ==========

  if (pathname === "/auth/request-link" && req.method === "POST") {
    try {
      const rawBody = await readRequestBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const email = (body.email || "").trim().toLowerCase();

      if (!email) {
        return send(res, 400, { ok: false, error: "Email is required" });
      }

      const users = await loadUsersFile();
      const user = users.find(
        (u) => u.email.toLowerCase() === email && u.enabled
      );

      // Always return same response to prevent email enumeration
      const successMessage = "If that email is registered, you'll receive a link shortly.";

      if (!user) {
        console.log("[auth] Login attempt for unknown email:", email);
        return send(res, 200, { ok: true, message: successMessage });
      }

      const token = generateMagicToken();
      const expiresAt = new Date(Date.now() + MAGIC_TOKEN_EXPIRY_MS).toISOString();

      await storeMagicToken(token, {
        email: user.email,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
      });

      const magicLink = `${MAGIC_LINK_BASE}/login.html?token=${token}`;

      try {
        await sendMagicLinkEmail(user.email, user.name, magicLink);
        console.log("[auth] Magic link sent to:", user.email);
      } catch (emailErr) {
        console.error("[auth] Failed to send email:", emailErr);
        // Still return success to prevent enumeration
      }

      return send(res, 200, { ok: true, message: successMessage });
    } catch (err) {
      console.error("[auth] request-link error:", err);
      return send(res, 500, { ok: false, error: "Unable to process request" });
    }
  }

  if (pathname === "/auth/verify" && req.method === "GET") {
    try {
      const token = queryParams.get("token");

      if (!token) {
        return send(res, 400, { ok: false, error: "Token is required" });
      }

      const magicData = await getMagicToken(token);
      if (!magicData || new Date(magicData.expires_at) < new Date()) {
        if (magicData) await deleteMagicToken(token);
        return send(res, 401, { ok: false, error: "Invalid or expired link" });
      }

      const users = await loadUsersFile();
      const user = users.find(
        (u) => u.email.toLowerCase() === magicData.email.toLowerCase() && u.enabled
      );

      if (!user) {
        await deleteMagicToken(token);
        return send(res, 401, { ok: false, error: "User not found or disabled" });
      }

      const sessionToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS).toISOString();

      await storeSession(sessionToken, {
        email: user.email,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
        last_used_at: new Date().toISOString(),
        user_agent: req.headers["user-agent"] || "",
      });

      // Delete used magic token (one-time use)
      await deleteMagicToken(token);

      // Update user's last_login and login_count
      try {
        const allUsers = await loadUsersFile();
        const userIdx = allUsers.findIndex(u => u.email.toLowerCase() === user.email.toLowerCase());
        if (userIdx !== -1) {
          allUsers[userIdx].last_login = new Date().toISOString();
          allUsers[userIdx].login_count = (allUsers[userIdx].login_count || 0) + 1;
          const usersData = { users: allUsers, updated_at: new Date().toISOString() };
          await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2), "utf8");
        }
      } catch (loginTrackErr) {
        console.warn("[auth] Could not update login stats:", loginTrackErr.message);
      }

      console.log("[auth] Session created for:", user.email);

      const accessFields = normalizeUserAccessFields(user);
      return send(res, 200, {
        ok: true,
        session_token: sessionToken,
        user: {
          email: user.email,
          name: user.name,
          access_level: accessFields.access_level,
          instance_keys: accessFields.instance_keys,
          partner_keys: accessFields.partner_keys,
          fi_keys: accessFields.fi_keys,
        },
      });
    } catch (err) {
      console.error("[auth] verify error:", err);
      return send(res, 500, { ok: false, error: "Unable to verify" });
    }
  }

  if (pathname === "/auth/me" && req.method === "GET") {
    const session = await validateSession(req, queryParams);
    if (!session) {
      return send(res, 401, { ok: false, error: "Not authenticated" });
    }
    return send(res, 200, { ok: true, user: session.user });
  }

  if (pathname === "/auth/logout" && req.method === "POST") {
    const token = extractSessionToken(req);
    if (token) {
      await deleteSession(token);
      console.log("[auth] Session logged out");
    }
    return send(res, 200, { ok: true });
  }

  // ========== End Auth Endpoints ==========

  // ========== Activity Logging ==========
  const ACTIVITY_LOG_FILE = path.join(DATA_DIR, "activity.log");
  const SHARED_VIEWS_LOG_FILE = path.join(DATA_DIR, "shared-views.log");

  if (pathname === "/analytics/log" && req.method === "POST") {
    try {
      const session = await validateSession(req, queryParams);
      if (!session) return send(res, 401, { ok: false });

      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const page = (payload.page || "").replace(/^\//, "");
      const fi = payload.fi || "";

      const logLine = JSON.stringify({
        ts: new Date().toISOString(),
        email: session.user.email,
        type: "pageview",
        page,
        fi,
      }) + "\n";

      await fs.appendFile(ACTIVITY_LOG_FILE, logLine);
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error("[analytics] log error:", err);
      return send(res, 500, { ok: false });
    }
  }

  if (pathname === "/analytics/activity" && req.method === "GET") {
    const auth = await validateSession(req, queryParams);
    if (!auth) return send(res, 401, { error: "Authentication required" });
    if (auth.user.access_level !== "admin" && auth.user.access_level !== "full") {
      return send(res, 403, { error: "Admin access required" });
    }

    try {
      const content = await fs.readFile(ACTIVITY_LOG_FILE, "utf8").catch(() => "");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries = lines.map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      return send(res, 200, { entries });
    } catch (err) {
      console.error("[analytics] read error:", err);
      return send(res, 500, { error: "Failed to read activity log" });
    }
  }

  // ========== Shared Link Tracking ==========

  // POST /api/share-log — authenticated user creates a shared link
  if (pathname === "/api/share-log" && req.method === "POST") {
    try {
      const session = await validateSession(req, queryParams);
      if (!session) return send(res, 401, { ok: false });

      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const sid = (payload.sid || "").slice(0, 16);
      const url = (payload.url || "").slice(0, 2000);

      if (!sid) return send(res, 400, { ok: false, error: "Missing sid" });

      const logLine = JSON.stringify({
        ts: new Date().toISOString(),
        type: "create",
        email: session.user.email,
        sid,
        url,
      }) + "\n";

      await fs.appendFile(SHARED_VIEWS_LOG_FILE, logLine);
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error("[share-log] create error:", err);
      return send(res, 500, { ok: false });
    }
  }

  // GET /api/share-log/view — unauthenticated view tracking (fire-and-forget from client)
  if (pathname === "/api/share-log/view" && req.method === "GET") {
    try {
      const sid = (queryParams.get("sid") || "").slice(0, 16);
      if (!sid) return send(res, 400, { ok: false });

      const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
      const ua = (req.headers["user-agent"] || "").slice(0, 300);
      const referrer = (req.headers["referer"] || "").slice(0, 500);

      const logLine = JSON.stringify({
        ts: new Date().toISOString(),
        type: "view",
        sid,
        ip,
        ua,
        referrer,
      }) + "\n";

      await fs.appendFile(SHARED_VIEWS_LOG_FILE, logLine);
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error("[share-log] view error:", err);
      return send(res, 500, { ok: false });
    }
  }

  // GET /analytics/shared-views — admin-only, read shared link log
  if (pathname === "/analytics/shared-views" && req.method === "GET") {
    const auth = await validateSession(req, queryParams);
    if (!auth) return send(res, 401, { error: "Authentication required" });
    if (auth.user.access_level !== "admin" && auth.user.access_level !== "full") {
      return send(res, 403, { error: "Admin access required" });
    }

    try {
      const content = await fs.readFile(SHARED_VIEWS_LOG_FILE, "utf8").catch(() => "");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries = lines.map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      return send(res, 200, { entries });
    } catch (err) {
      console.error("[share-log] read error:", err);
      return send(res, 500, { error: "Failed to read shared views log" });
    }
  }

  // ========== End Shared Link Tracking ==========

  // ========== End Activity Logging ==========

  if (pathname === "/run-update/status") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    return send(res, 200, currentUpdateSnapshot());
  }

  if (pathname === "/run-update/start") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    const qsStart = queryParams.get("start") || queryParams.get("startDate");
    const qsEnd = queryParams.get("end") || queryParams.get("endDate");
    const forceRaw = queryParams.get("forceRaw") === "true";
    try {
      await startUpdateJobIfNeeded({ startDate: qsStart, endDate: qsEnd, forceRaw });
    } catch (err) {
      console.error("Update job failed:", err);
    }
    return send(res, 200, currentUpdateSnapshot());
  }

  if (pathname === "/run-update/stream") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    setCors(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    res.write("retry: 5000\n\n");
    res.write(": stream-open\n\n");

    updateClients.add(res);

    sseSend(res, "snapshot", currentUpdateSnapshot());

    // Send keepalive pings every 15 seconds to prevent timeout
    const keepaliveInterval = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch (err) {
        clearInterval(keepaliveInterval);
      }
    }, 15000);

    if (!currentUpdateJob.running) {
      const qsStart = queryParams.get("start") || queryParams.get("startDate");
      const qsEnd = queryParams.get("end") || queryParams.get("endDate");
      const forceRaw = queryParams.get("forceRaw") === "true";
      const autoRefetch = queryParams.get("autoRefetch") === "1";

      if (autoRefetch) {
        console.log("[SSE] Auto-refetch triggered for incomplete dates");
      }

      startUpdateJobIfNeeded({ startDate: qsStart, endDate: qsEnd, forceRaw }).catch((err) => {
        console.error("Update job failed:", err);
      });
    }

    req.on("close", () => {
      clearInterval(keepaliveInterval);
      updateClients.delete(res);
    });

    return;
  }

  if (pathname === "/api/synth/jobs" && req.method === "GET") {
    await loadSynthJobs();
    return send(res, 200, {
      jobs: synthState.jobs,
      runner_mode: SYNTHETIC_RUNNER_MODE || "disabled",
    });
  }

  // Lightweight endpoint for runner to check if there's work to do
  if (pathname === "/api/synth/status" && req.method === "GET") {
    await loadSynthJobs();
    const dueJobs = synthState.jobs.filter(
      (job) => job?.due && job.status !== "canceled" && job.status !== "completed"
    );
    return send(res, 200, {
      has_due_jobs: dueJobs.length > 0,
      due_count: dueJobs.length,
      total_count: synthState.jobs.length,
    });
  }

  if (pathname === "/api/synth/jobs" && req.method === "POST") {
    try {
      const rawBody = await readRequestBody(req);
      let payload = {};
      try {
        payload = JSON.parse(rawBody || "{}");
      } catch (err) {
        return send(res, 400, { error: "Invalid JSON payload" });
      }
      const { job, error } = buildSynthJob(payload || {});
      if (error) return send(res, 400, { error });
      await loadSynthJobs();
      synthState.jobs.unshift(job);
      await saveSynthJobs();
      return send(res, 200, { job });
    } catch (err) {
      return send(res, 500, { error: err?.message || "Unable to create job" });
    }
  }

  const synthCancelMatch = pathname.match(/^\/api\/synth\/jobs\/([^/]+)\/cancel$/);
  if (synthCancelMatch && req.method === "POST") {
    await loadSynthJobs();
    const jobId = synthCancelMatch[1];
    const job = synthState.jobs.find((entry) => entry?.id === jobId);
    if (!job) return send(res, 404, { error: "Job not found" });
    job.status = "canceled";
    job.due = false;
    job.next_run_at = "";
    job.canceled_at = new Date().toISOString();
    await saveSynthJobs();
    return send(res, 200, { job });
  }

  const synthPauseMatch = pathname.match(/^\/api\/synth\/jobs\/([^/]+)\/pause$/);
  if (synthPauseMatch && req.method === "POST") {
    await loadSynthJobs();
    const jobId = synthPauseMatch[1];
    const job = synthState.jobs.find((entry) => entry?.id === jobId);
    if (!job) return send(res, 404, { error: "Job not found" });
    if (job.status === "completed" || job.status === "canceled") {
      return send(res, 400, { error: "Job is already finished" });
    }
    job.status = "paused";
    job.due = false;
    job.next_run_at = "";
    job.paused_at = new Date().toISOString();
    await saveSynthJobs();
    return send(res, 200, { job });
  }

  const synthContinueMatch = pathname.match(/^\/api\/synth\/jobs\/([^/]+)\/continue$/);
  if (synthContinueMatch && req.method === "POST") {
    await loadSynthJobs();
    const jobId = synthContinueMatch[1];
    const job = synthState.jobs.find((entry) => entry?.id === jobId);
    if (!job) return send(res, 404, { error: "Job not found" });
    if (job.status === "completed" || job.status === "canceled") {
      return send(res, 400, { error: "Job is already finished" });
    }
    job.status = "queued";
    if (!job.next_run_at) job.next_run_at = new Date().toISOString();
    job.due = false;
    job.paused_at = "";
    await saveSynthJobs();
    return send(res, 200, { job });
  }

  const synthResultsMatch = pathname.match(/^\/api\/synth\/jobs\/([^/]+)\/results$/);
  if (synthResultsMatch && req.method === "POST") {
    await loadSynthJobs();
    let payload = {};
    try {
      const rawBody = await readRequestBody(req);
      payload = JSON.parse(rawBody || "{}");
    } catch (err) {
      return send(res, 400, { error: "Invalid JSON payload" });
    }
    const jobId = synthResultsMatch[1];
    const job = synthState.jobs.find((entry) => entry?.id === jobId);
    if (!job) return send(res, 404, { error: "Job not found" });
    if (job.status === "canceled" || job.status === "completed" || job.status === "paused") {
      return send(res, 200, { job, ignored: true });
    }

    const inc = (value) => Math.max(0, Number(value) || 0);
    const attempts = inc(payload.attempted);
    const success = inc(payload.placements_success);
    const fail = inc(payload.placements_failed);
    const abandon = inc(payload.placements_abandoned);
    const abandonSelect = inc(payload.abandon_select_merchant);
    const abandonUser = inc(payload.abandon_user_data);
    const abandonCredential = inc(payload.abandon_credential_entry);
    const finishedAt = payload.last_run_at ? new Date(payload.last_run_at) : new Date();
    const nextStatus = (payload.status || "").toString().trim().toLowerCase();

    job.attempted += attempts;
    job.placements_success += success;
    job.placements_failed += fail;
    job.placements_abandoned += abandon;
    job.abandon_select_merchant += abandonSelect;
    job.abandon_user_data += abandonUser;
    job.abandon_credential_entry += abandonCredential;
    job.last_run_at = finishedAt.toISOString();
    job.due = false;

    if (nextStatus === "running") {
      job.status = "running";
      job.due = false;
    }

    if (job.mode === "one_shot" && job.attempted >= job.total_runs) {
      job.status = "completed";
      job.next_run_at = "";
    } else if (job.mode === "campaign") {
      if (jobEndDateReached(job, finishedAt) || (job.max_runs && job.attempted >= job.max_runs)) {
        job.status = "completed";
        job.next_run_at = "";
      } else if (nextStatus !== "running") {
        job.status = "queued";
        job.next_run_at = computeNextRunIso(job, finishedAt);
      }
    } else if (nextStatus !== "running") {
      job.status = "queued";
    }

    await saveSynthJobs();
    return send(res, 200, { job });
  }

  // Check raw data metadata status
  if (pathname === "/api/check-raw-data") {
    const qsStart = queryParams.get("start");
    const qsEnd = queryParams.get("end");

    if (!qsStart || !qsEnd) {
      return send(res, 400, { error: "Missing start or end date" });
    }

    try {
      const { checkRawDataStatus } = await import("../src/lib/rawStorage.mjs");
      const dailySet = new Set((await listDaily()).map((f) => f.replace(/\.json$/i, "")));
      const datesToRefetch = [];
      const reasons = {};

      const start = new Date(qsStart);
      const end = new Date(qsEnd);

      // Enumerate dates in range
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];

        // Check all three types (sessions, placements, ga)
        const sessionStatus = checkRawDataStatus("sessions", dateStr);
        const placementStatus = checkRawDataStatus("placements", dateStr);
        const gaStatus = checkRawDataStatus("ga", dateStr);
        const dailyMissing = !dailySet.has(dateStr);

        const needsRefetch =
          sessionStatus.needsRefetch ||
          placementStatus.needsRefetch ||
          gaStatus.needsRefetch ||
          dailyMissing;

        if (needsRefetch) {
          datesToRefetch.push(dateStr);
          reasons[dateStr] = {
            sessions: sessionStatus.reason,
            placements: placementStatus.reason,
            ga: gaStatus.reason,
            daily: dailyMissing ? "Daily rollup missing" : "Daily rollup present",
          };
        }
      }

      return send(res, 200, { datesToRefetch, reasons });
    } catch (err) {
      console.error("[API] check-raw-data error:", err);
      return send(res, 500, { error: err.message });
    }
  }

  // Diagnostics
  if (pathname === "/__diag") {
    const diag = {
      now: new Date().toISOString(),
      startedAt: SERVER_STARTED_AT,
      commit: BUILD_COMMIT,
      root: ROOT,
      public_dir: PUBLIC_DIR,
      data_dir: DATA_DIR,
      daily_dir: DAILY_DIR,
      public_files: await (async () => {
        try {
          return await fs.readdir(PUBLIC_DIR);
        } catch {
          return "(missing)";
        }
      })(),
      daily_sample: (await listDaily()).slice(0, 5),
      requested: pathname,
    };
    return send(res, 200, diag);
  }
  if (pathname === "/build-info") {
    return send(res, 200, {
      committedAt: BUILD_COMMITTED_AT,
      commit: BUILD_COMMIT,
    });
  }

  // JSON helpers
  if (pathname === "/list-daily") {
    const days = await listDaily();
    return send(res, 200, { files: days, days });
  }
  if (pathname === "/data-freshness") {
    try {
      const { checkRawDataStatus } = await import("../src/lib/rawStorage.mjs");
      const [rawSessionDays, rawPlacementDays, dailyDays] = await Promise.all([
        listRawDays("sessions"),
        listRawDays("placements"),
        listDaily(),
      ]);

      const latest = (arr = []) => (arr.length ? arr[arr.length - 1] : null);
      const earliest = (arr = []) => (arr.length ? arr[0] : null);

      // Get all dates that have any raw data (sessions or placements)
      const allRawDates = Array.from(
        new Set([...(rawSessionDays || []), ...(rawPlacementDays || [])])
      ).sort();

      // Categorize dates by completeness
      const completeDates = [];
      const incompleteDates = [];

      for (const dateStr of allRawDates) {
        // Read metadata directly to check isComplete flag
        const { readRawWithMetadata } = await import("../src/lib/rawStorage.mjs");
        const { metadata: sessionMeta } = readRawWithMetadata("sessions", dateStr);
        const { metadata: placementMeta } = readRawWithMetadata("placements", dateStr);

        // A date is complete only if both sessions and placements are complete.
        // If either side is missing or incomplete, treat as incomplete.
        const sessionComplete = sessionMeta && sessionMeta.isComplete === true;
        const placementComplete = placementMeta && placementMeta.isComplete === true;
        const hasAny = Boolean(sessionMeta || placementMeta);

        if (hasAny && sessionComplete && placementComplete) {
          completeDates.push(dateStr);
        } else if (hasAny) {
          incompleteDates.push(dateStr);
        }
      }

      const today = todayIsoDate();
      const age = (iso) => {
        if (!iso) return null;
        const ms = new Date(`${today}T00:00:00Z`) - new Date(`${iso}T00:00:00Z`);
        return Math.floor(ms / 86400000);
      };

      const completeStart = earliest(completeDates);
      const completeEnd = latest(completeDates);
      const overallStart = earliest(allRawDates);
      const overallEnd = latest(allRawDates);

      // Clean up daily dates (remove .json extension)
      const dailyDatesClean = dailyDays.map(d => d.replace(/\.json$/i, ""));
      const dailyEarliest = earliest(dailyDatesClean);
      const dailyLatest = latest(dailyDatesClean);

      return send(res, 200, {
        // Legacy fields for backward compatibility
        rawLatest: completeEnd,
        rawAgeDays: age(completeEnd),
        dailyLatest,
        dailyAgeDays: age(dailyLatest),

        // New detailed fields
        complete: {
          start: completeStart,
          end: completeEnd,
          count: completeDates.length,
        },
        incomplete: {
          dates: incompleteDates,
          count: incompleteDates.length,
        },
        overall: {
          start: overallStart,
          end: overallEnd,
          count: allRawDates.length,
        },
        daily: {
          start: dailyEarliest,
          end: dailyLatest,
          count: dailyDatesClean.length,
        },
      });
    } catch (err) {
      return send(res, 500, { error: err?.message || "Unable to load freshness" });
    }
  }
  if (pathname === "/merchant-sites") {
    try {
      const sites = await fetchMerchantSitesFromSs01();
      return send(res, 200, { count: sites.length, sites });
    } catch (err) {
      const message = err?.message || "Unable to load merchant sites";
      console.error("merchant-sites fetch failed", err);
      return send(res, 500, { error: message });
    }
  }
  if (pathname === "/fi-api-data") {
    try {
      console.log("Fetching FI data from all instances...");
      const data = await fetchAllFinancialInstitutions();
      console.log(`✅ FI API data fetch complete: ${data.totalCount} FIs total`);
      return send(res, 200, data);
    } catch (err) {
      const message = err?.message || "Unable to load FI API data";
      console.error("FI API data fetch failed", err);
      return send(res, 500, { error: message });
    }
  }

  if (pathname === "/fi-api-data-stream") {
    try {
      setCors(res);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      console.log("Streaming FI data from all instances...");
      const data = await fetchAllFinancialInstitutions(sendEvent);
      console.log(`✅ FI API data fetch complete: ${data.totalCount} FIs total`);

      // Send final data
      sendEvent({ type: 'complete', data });
      res.end();
    } catch (err) {
      const message = err?.message || "Unable to load FI API data";
      console.error("FI API data fetch failed", err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
      res.end();
    }
    return;
  }

  if (pathname === "/server-logs") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const query = new URLSearchParams(parsedUrl.searchParams);
      const limit = parseInt(query.get('limit')) || 500;
      const level = query.get('level') || null;

      let logs = serverLogs.slice();

      // Filter by level if specified
      if (level && level !== 'all') {
        logs = logs.filter(log => log.level === level);
      }

      // Return most recent logs (last N)
      const recentLogs = logs.slice(-limit);

      return send(res, 200, {
        logs: recentLogs,
        totalCount: serverLogs.length,
        maxLines: MAX_LOG_LINES
      });
    } catch (err) {
      console.error("Server logs fetch failed", err);
      return send(res, 500, { error: err.message });
    }
  }

  // Placement details endpoint for expandable breakdown
  if (pathname === "/api/placement-details") {
    try {
      const query = new URLSearchParams(parsedUrl.searchParams);
      const type = query.get('type'); // 'success', 'system', or 'ux'
      const startDate = query.get('startDate');
      const endDate = query.get('endDate');
      const fiFilter = query.get('fi') || '__all__';
      const partnerFilter = query.get('partner') || '__all_partners__';
      const integrationFilter = query.get('integration') || '(all)';
      const instanceFilter = query.get('instance') || 'All';
      const includeTest = query.get('includeTest') === 'true';
      const limit = parseInt(query.get('limit')) || 50;
      const showAll = query.get('showAll') === 'true';

      // Validate required params
      if (!type || !startDate || !endDate) {
        return send(res, 400, { error: 'Missing required parameters: type, startDate, endDate' });
      }

      if (!['success', 'system', 'ux', 'nojobs', 'sysrate', 'overall'].includes(type)) {
        return send(res, 400, { error: 'Invalid type. Must be success, system, ux, nojobs, sysrate, or overall' });
      }

      // Load FI registry for integration type lookups
      let fiRegistry = {};
      try {
        const raw = await fs.readFile(FI_REGISTRY_FILE, "utf8");
        fiRegistry = JSON.parse(raw);
      } catch (err) {
        console.warn("Could not load FI registry:", err.message);
      }

      // Get date range
      const dates = [];
      const start = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T00:00:00Z`);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
      }

      // Handle "nojobs" type separately - show sessions without jobs
      if (type === 'nojobs') {
        const instanceMeta = await loadInstanceMetaMap();
        const fiMeta = buildFiMetaMap(fiRegistry);
        const noJobSessions = [];

        for (const date of dates) {
          const sessionData = await readSessionDay(date);
          if (!sessionData?.sessions) continue;

          for (const session of sessionData.sessions) {
            // Skip sessions that have jobs
            const totalJobs = session.total_jobs ?? 0;
            if (totalJobs > 0) continue;

            // Apply filters
            const instanceRaw = session._instance || session.instance || session.instance_name || session.org_name || "";
            const instanceDisplay = formatInstanceDisplay(instanceRaw || "unknown");

            // Test instance filter
            if (!includeTest && isTestInstanceName(instanceDisplay)) continue;

            // Instance filter
            if (instanceFilter !== 'All') {
              const normalizedInstance = canonicalInstance(instanceDisplay);
              const normalizedFilter = canonicalInstance(instanceFilter);
              if (normalizedInstance !== normalizedFilter) continue;
            }

            // FI filter
            const fiKey = normalizeFiKey(session.financial_institution_lookup_key || session.fi_lookup_key || session.fi_name || '');
            if (fiFilter !== '__all__') {
              const allowedFis = fiFilter.split(',').map(f => normalizeFiKey(f.trim()));
              if (!allowedFis.includes(fiKey)) continue;
            }

            // Integration filter
            const fiEntry = fiMeta.get(fiKey);
            const integration = normalizeIntegration(session.source?.integration || fiEntry?.integration || 'UNKNOWN');
            if (integrationFilter !== '(all)') {
              if (integration !== normalizeIntegration(integrationFilter)) continue;
            }

            // Determine last page visited
            const clickstream = Array.isArray(session.clickstream) ? session.clickstream : [];
            const lastPage = clickstream.length > 0 ? clickstream[clickstream.length - 1] : null;
            const lastUrl = lastPage?.url || lastPage?.page_title || 'Unknown';

            // Calculate session duration
            const createdOn = session.created_on ? new Date(session.created_on) : null;
            const closedOn = session.closed_on ? new Date(session.closed_on) : null;
            const durationMs = (createdOn && closedOn) ? closedOn - createdOn : null;

            noJobSessions.push({
              date,
              sessionId: session.agent_session_id || session.id || session.cuid,
              cuid: session.cuid,
              fi: fiEntry?.fi || session.fi_name || fiKey || 'Unknown',
              fiKey,
              integration,
              instance: instanceDisplay,
              lastPage: lastUrl,
              clickstreamLength: clickstream.length,
              clickstream,
              createdOn: session.created_on,
              closedOn: session.closed_on,
              durationMs,
              _rawSession: session
            });
          }
        }

        // Group by last page visited
        const pageGroups = {};
        for (const sess of noJobSessions) {
          const page = sess.lastPage;
          if (!pageGroups[page]) {
            pageGroups[page] = [];
          }
          pageGroups[page].push(sess);
        }

        // Sort pages by frequency
        const sortedPages = Object.keys(pageGroups).sort((a, b) => {
          return pageGroups[b].length - pageGroups[a].length;
        });

        const resultLimit = showAll ? Infinity : limit;
        const results = [];
        let totalCount = 0;

        for (const page of sortedPages) {
          const sessions = pageGroups[page];
          totalCount += sessions.length;

          if (results.length < resultLimit) {
            results.push({
              page: page,
              count: sessions.length,
              sessions: sessions
            });
          }
        }

        return send(res, 200, {
          type: 'nojobs',
          total: totalCount,
          pageCount: sortedPages.length,
          showing: results.length,
          hasMore: results.length < sortedPages.length,
          results
        });
      }

      // Collect all placements matching criteria
      const allPlacements = [];

      // Load sessions for each date to match with placements
      const sessionsByDate = {};
      for (const date of dates) {
        const sessionData = await readSessionDay(date);
        if (sessionData?.sessions) {
          // Index sessions by agent_session_id for fast lookup
          sessionsByDate[date] = {};
          for (const session of sessionData.sessions) {
            const sessionId = session.agent_session_id || session.id;
            if (sessionId) {
              sessionsByDate[date][sessionId] = session;
            }
          }
        }
      }

      for (const date of dates) {
        const placementFile = path.join(RAW_PLACEMENTS_DIR, `${date}.json`);

        try {
          const raw = await fs.readFile(placementFile, 'utf8');
          const data = JSON.parse(raw);
          const placements = data.placements || [];

          for (const placement of placements) {
            // Apply filters
            const fiKey = normalizeFiKey(placement.fi_lookup_key || placement.fi_name || '');
            const instance = placement._instance || '';
            const terminationType = placement.termination_type || 'UNKNOWN';

            // Test instance filter
            if (!includeTest && isTestInstanceName(instance)) {
              continue;
            }

            // Instance filter
            if (instanceFilter !== 'All') {
              const normalizedInstance = canonicalInstance(formatInstanceDisplay(instance));
              const normalizedFilter = canonicalInstance(instanceFilter);
              if (normalizedInstance !== normalizedFilter) {
                continue;
              }
            }

            // FI filter (handle comma-separated list)
            if (fiFilter !== '__all__') {
              const allowedFis = fiFilter.split(',').map(f => normalizeFiKey(f.trim()));
              if (!allowedFis.includes(fiKey)) {
                continue;
              }
            }

            // Categorize by termination type (but don't filter yet - we need all types for counts)
            const rule = TERMINATION_RULES[terminationType] || TERMINATION_RULES.UNKNOWN;
            let placementType = 'system'; // default

            if (rule.severity === 'success') {
              placementType = 'success';
            } else if (rule.includeInUx) {
              placementType = 'ux';
            } else if (rule.includeInHealth && rule.severity !== 'success') {
              placementType = 'system';
            }
            // Note: We're NOT filtering by type here - we collect all placements to show full counts

            // Derive integration type
            let integrationType = 'NON-SSO';
            if (placement.source?.integration) {
              const srcInt = placement.source.integration.toString().toLowerCase();
              if (srcInt.includes('sso')) integrationType = 'SSO';
              else if (srcInt.includes('cardsavr')) integrationType = 'CardSavr';
            } else if (fiRegistry[fiKey]) {
              const regInt = (fiRegistry[fiKey].integration_type || '').toString().toLowerCase();
              if (regInt === 'sso') integrationType = 'SSO';
              else if (regInt === 'cardsavr') integrationType = 'CardSavr';
            }

            // Integration filter
            if (integrationFilter !== '(all)') {
              const normalizedInt = integrationType.toUpperCase().replace(/[^A-Z]/g, '');
              const filterInt = integrationFilter.toUpperCase().replace(/[^A-Z]/g, '');
              if (normalizedInt !== filterInt) {
                continue;
              }
            }

            // Find matching session
            const sessionId = placement.agent_session_id;
            const matchingSession = sessionId && sessionsByDate[date]?.[sessionId];

            // Add to results with necessary fields + raw data + session
            allPlacements.push({
              merchant: placement.merchant_site_hostname || 'Unknown',
              fi: placement.fi_name || 'Unknown',
              instance: instance || 'unknown',
              integration: integrationType,
              terminationType: terminationType,
              placementType: placementType, // success, system, or ux
              status: placement.status || '',
              statusMessage: placement.status_message || '',
              jobId: placement.id || placement.place_card_on_single_site_job_id || '',
              createdOn: placement.job_created_on || placement.created_on || '',
              completedOn: placement.completed_on || '',
              timeElapsed: placement.time_elapsed || 0,
              date: date,
              _raw: placement, // Include full raw placement object
              _session: matchingSession || null, // Include matching session if found
            });
          }
        } catch (err) {
          // Skip missing files
          if (err.code !== 'ENOENT') {
            console.error(`Error reading placements for ${date}:`, err);
          }
        }
      }

      // Group by merchant and count all placement types
      const merchantGroups = {};
      for (const placement of allPlacements) {
        const merchant = placement.merchant;
        if (!merchantGroups[merchant]) {
          merchantGroups[merchant] = {
            allPlacements: [],
            successCount: 0,
            systemCount: 0,
            uxCount: 0
          };
        }
        merchantGroups[merchant].allPlacements.push(placement);

        // Count this placement based on its placementType
        if (placement.placementType === 'success') {
          merchantGroups[merchant].successCount++;
        } else if (placement.placementType === 'ux') {
          merchantGroups[merchant].uxCount++;
        } else {
          merchantGroups[merchant].systemCount++;
        }
      }

      // Debug: Log first merchant's counts
      const firstMerchant = Object.keys(merchantGroups)[0];
      if (firstMerchant) {
        console.log(`[DEBUG] First merchant "${firstMerchant}":`, {
          total: merchantGroups[firstMerchant].allPlacements.length,
          success: merchantGroups[firstMerchant].successCount,
          system: merchantGroups[firstMerchant].systemCount,
          ux: merchantGroups[firstMerchant].uxCount,
          sampleTypes: merchantGroups[firstMerchant].allPlacements.slice(0, 5).map(p => p.placementType)
        });
      }

      // Sort merchants by frequency (most common first) based on current type's count
      const sortedMerchants = Object.keys(merchantGroups).sort((a, b) => {
        const countA = type === 'success' ? merchantGroups[a].successCount :
                       type === 'ux' ? merchantGroups[a].uxCount :
                       type === 'sysrate' ? (merchantGroups[a].successCount + merchantGroups[a].systemCount) :
                       type === 'overall' ? (merchantGroups[a].successCount + merchantGroups[a].systemCount + merchantGroups[a].uxCount) :
                       merchantGroups[a].systemCount;
        const countB = type === 'success' ? merchantGroups[b].successCount :
                       type === 'ux' ? merchantGroups[b].uxCount :
                       type === 'sysrate' ? (merchantGroups[b].successCount + merchantGroups[b].systemCount) :
                       type === 'overall' ? (merchantGroups[b].successCount + merchantGroups[b].systemCount + merchantGroups[b].uxCount) :
                       merchantGroups[b].systemCount;
        return countB - countA;
      });

      // Build response with top 50 or all
      const resultLimit = showAll ? Infinity : limit;
      const results = [];
      let totalCount = 0;

      for (const merchant of sortedMerchants) {
        const group = merchantGroups[merchant];

        // Filter placements to only show the requested type
        // sysrate includes both success and system placements
        // overall includes all placement types (success + system + ux)
        const typedPlacements = type === 'overall'
          ? group.allPlacements
          : type === 'sysrate'
          ? group.allPlacements.filter(p => p.placementType === 'success' || p.placementType === 'system')
          : group.allPlacements.filter(p => p.placementType === type);
        const typeCount = typedPlacements.length;

        // Skip merchants with zero of the requested type
        if (typeCount === 0) continue;

        totalCount += typeCount;

        if (results.length < resultLimit) {
          results.push({
            merchant: merchant,
            count: typeCount, // Count for the requested type
            successCount: group.successCount,
            systemCount: group.systemCount,
            uxCount: group.uxCount,
            placements: typedPlacements, // Show all placements for this merchant
          });
        }
      }

      return send(res, 200, {
        type,
        total: totalCount,
        merchantCount: sortedMerchants.length,
        showing: results.length,
        hasMore: results.length < sortedMerchants.length,
        results,
      });

    } catch (err) {
      console.error('Placement details fetch failed:', err);
      return send(res, 500, { error: err.message });
    }
  }

  // Data version endpoint for cache invalidation
  if (pathname === "/api/data-version") {
    try {
      // Get list of available daily files
      const files = await fs.readdir(DAILY_DIR).catch(() => []);
      const dailyFiles = files.filter(f => f.endsWith('.json')).sort();

      // Create version from file list + file stats.
      // This invalidates the cache when daily files are rewritten (e.g. force refresh),
      // not just when files are added/removed.
      const statParts = [];
      for (const name of dailyFiles) {
        try {
          const stat = await fs.stat(path.join(DAILY_DIR, name));
          statParts.push(`${name}:${stat.size}:${stat.mtimeMs}`);
        } catch {
          statParts.push(`${name}:?`);
        }
      }
      const fileListHash = statParts.join('|');
      let version = 0;
      for (let i = 0; i < fileListHash.length; i++) {
        version = ((version << 5) - version) + fileListHash.charCodeAt(i);
        version = version & version; // Convert to 32bit integer
      }

      return send(res, 200, {
        version: Math.abs(version),
        fileCount: dailyFiles.length,
        dateRange: dailyFiles.length > 0 ? {
          start: dailyFiles[0].replace('.json', ''),
          end: dailyFiles[dailyFiles.length - 1].replace('.json', '')
        } : null
      });
    } catch (err) {
      console.error('Data version check failed:', err);
      return send(res, 500, { error: err.message });
    }
  }

  if (pathname === "/fi-registry") {
    try {
      const raw = await fs.readFile(FI_REGISTRY_FILE, "utf8");
      return send(res, 200, JSON.parse(raw));
    } catch (err) {
      const status = err.code === "ENOENT" ? 404 : 500;
      return send(res, status, { error: "fi_registry.json not found" });
    }
  }
  if (pathname === "/fi-registry/update" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || "{}");
      if (!payload || typeof payload !== "object") {
        return send(res, 400, { error: "Invalid payload" });
      }
      const { key, updates } = payload;
      if (!key || typeof updates !== "object" || Array.isArray(updates)) {
        return send(res, 400, { error: "Missing key or updates" });
      }
      const raw = await fs.readFile(FI_REGISTRY_FILE, "utf8").catch((err) => {
        if (err.code === "ENOENT") {
          throw Object.assign(new Error("fi_registry.json not found"), { status: 404 });
        }
        throw err;
      });
      const registry = JSON.parse(raw);
      const isNewEntry = !registry[key];

      const normalizeIntegration = (value) => {
        if (!value) return "non-sso";
        const rawVal = value.toString().trim().toLowerCase();
        if (rawVal === "sso") return "sso";
        if (rawVal === "cardsavr" || rawVal === "card-savr") return "cardsavr";
        if (rawVal === "test") return "test";
        if (rawVal === "unknown") return "unknown";
        return "non-sso";
      };
      const normalizeCardholders = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const cleaned = value.toString().replace(/,/g, "").trim();
        if (!cleaned) return null;
        const num = Number(cleaned);
        if (!Number.isFinite(num) || num < 0) {
          throw Object.assign(new Error("Cardholder total must be a positive number"), {
            status: 400,
          });
        }
        return String(Math.round(num));
      };
      const normalizeAsOf = (value) => {
        if (!value) return null;
        const str = value.toString().trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
          throw Object.assign(new Error("cardholder_as_of must be YYYY-MM-DD"), {
            status: 400,
          });
        }
        return str;
      };
      const normalizeSource = (value) => {
        if (!value) return null;
        return value.toString().trim();
      };
      const normalizeFreeText = (value) => {
        if (value === undefined) return undefined;
        const str = value === null ? "" : value.toString().trim();
        return str === "" ? null : str;
      };
      const normalizeFiName = (value) => {
        if (value === undefined) return undefined;
        const str = value === null ? "" : value.toString().trim();
        if (!str) {
          throw Object.assign(new Error("fi_name is required"), { status: 400 });
        }
        return str;
      };
      const normalizeFiLookupKey = (value, fallback) => {
        const raw = value === undefined ? fallback : value;
        if (raw === undefined) return undefined;
        const str = raw === null ? "" : raw.toString().trim();
        if (!str) {
          throw Object.assign(new Error("fi_lookup_key is required"), { status: 400 });
        }
        return str;
      };
      const normalizePartner = (value) => {
        if (!value) return null;
        const rawVal = value.toString().trim().toLowerCase();
        const canonical =
          {
            alkami: "Alkami",
            "digital-onboarding": "DigitalOnboarding",
            digitalonboarding: "DigitalOnboarding",
            pscu: "PSCU",
            marquis: "Marquis",
            msu: "MSU",
            advancial: "Advancial",
            "advancial-prod": "Advancial",
            cardsavr: "CardSavr",
            direct: "Direct",
          }[rawVal] || rawVal;
        return canonical
          .replace(/(^|\s|-)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
      };
      const normalizeInstance = (value) => {
        if (!value) return null;
        const str = value.toString().trim();
        return str || null;
      };
      const canonicalLookupKey = (value) =>
        value ? value.toString().trim().toLowerCase() : "";
      const canonicalInstance = (value) =>
        value ? value.toString().trim().toLowerCase() : "";

      const next = { ...(registry[key] || {}) };
      if (isNewEntry) {
        const fallbackInstance = key.includes("__") ? key.split("__")[1] : null;
        const instanceValue = normalizeInstance(updates.instance || fallbackInstance || "unknown");
        if (instanceValue) {
          next.instance = instanceValue;
        }
      }
      if ("integration_type" in updates) {
        next.integration_type = normalizeIntegration(updates.integration_type);
      } else if (isNewEntry && !next.integration_type) {
        next.integration_type = normalizeIntegration(next.integration_type);
      }
      if ("fi_name" in updates) {
        const fiName = normalizeFiName(updates.fi_name);
        if (fiName !== undefined) next.fi_name = fiName;
      } else if (isNewEntry && !next.fi_name) {
        const fallbackFi = key.includes("__") ? key.split("__")[0] : null;
        if (fallbackFi) next.fi_name = normalizeFiName(fallbackFi);
      }
      if ("fi_lookup_key" in updates) {
        const fiLookup = normalizeFiLookupKey(updates.fi_lookup_key, next.fi_lookup_key);
        if (fiLookup !== undefined) next.fi_lookup_key = fiLookup;
      } else if (isNewEntry && !next.fi_lookup_key) {
        const fallbackLookup = key.includes("__") ? key.split("__")[0] : null;
        const fiLookup = normalizeFiLookupKey(fallbackLookup, next.fi_lookup_key);
        if (fiLookup !== undefined) next.fi_lookup_key = fiLookup;
      }
      if ("partner" in updates) {
        next.partner = normalizePartner(updates.partner);
      }
      if ("cardholder_total" in updates) {
        next.cardholder_total = normalizeCardholders(updates.cardholder_total);
      }
      if ("cardholder_source" in updates) {
        next.cardholder_source = normalizeSource(updates.cardholder_source);
      }
      if ("cardholder_as_of" in updates) {
        next.cardholder_as_of = normalizeAsOf(updates.cardholder_as_of);
      }
      if ("core_vendor" in updates) {
        next.core_vendor = normalizeFreeText(updates.core_vendor);
      }
      if ("core_product" in updates) {
        next.core_product = normalizeFreeText(updates.core_product);
      }
      if ("debit_processor" in updates) {
        next.debit_processor = normalizeFreeText(updates.debit_processor);
      }
      if ("credit_processor" in updates) {
        next.credit_processor = normalizeFreeText(updates.credit_processor);
      }
      if ("traffic_first_seen_sso" in updates) {
        const val = updates.traffic_first_seen_sso;
        if (!val || val === "") {
          next.traffic_first_seen_sso = null;
        } else {
          const str = val.toString().trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            throw Object.assign(new Error("traffic_first_seen_sso must be YYYY-MM-DD"), { status: 400 });
          }
          next.traffic_first_seen_sso = str;
        }
      }

      const targetLookup = canonicalLookupKey(next.fi_lookup_key || next.fi_name || key);
      const targetInstance = canonicalInstance(
        next.instance || (Array.isArray(next.instances) ? next.instances[0] : "")
      );
      for (const [otherKey, otherEntry] of Object.entries(registry)) {
        if (otherKey === key) continue;
        const otherLookup = canonicalLookupKey(
          otherEntry?.fi_lookup_key || otherEntry?.fi_name || otherKey
        );
        const otherInstance = canonicalInstance(
          otherEntry?.instance ||
            (Array.isArray(otherEntry?.instances) ? otherEntry.instances[0] : "")
        );
        if (
          targetLookup &&
          otherLookup &&
          targetInstance &&
          otherInstance &&
          targetLookup === otherLookup &&
          targetInstance === otherInstance
        ) {
          return send(res, 409, {
            error: "Duplicate fi_lookup_key for this instance.",
            conflict: {
              key: otherKey,
              fi_lookup_key: otherEntry?.fi_lookup_key || null,
              instance:
                otherEntry?.instance ||
                (Array.isArray(otherEntry?.instances) ? otherEntry.instances[0] : null),
            },
          });
        }
      }

      if (isNewEntry) {
        registry[key] = next;
      }

      registry[key] = next;
      await fs.writeFile(
        FI_REGISTRY_FILE,
        JSON.stringify(registry, null, 2) + "\n",
        "utf8"
      );
      return send(res, 200, { key, entry: next });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err.message || "Unable to update registry" });
    }
  }
  if (pathname === "/fi-registry/delete" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const key = payload?.key;
      if (!key) {
        return send(res, 400, { error: "Missing key" });
      }
      const raw = await fs.readFile(FI_REGISTRY_FILE, "utf8").catch((err) => {
        if (err.code === "ENOENT") {
          throw Object.assign(new Error("fi_registry.json not found"), { status: 404 });
        }
        throw err;
      });
      const registry = JSON.parse(raw);
      if (!registry[key]) {
        return send(res, 404, { error: "Registry entry not found", key });
      }
      delete registry[key];
      await fs.writeFile(
        FI_REGISTRY_FILE,
        JSON.stringify(registry, null, 2) + "\n",
        "utf8"
      );
      return send(res, 200, { deleted: key, registrySize: Object.keys(registry).length });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err.message || "Unable to delete registry entry" });
    }
  }
  if (pathname === "/troubleshoot/options") {
    try {
      const opts = await buildTroubleshootOptions();
      return send(res, 200, opts);
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to load options" });
    }
  }
  if (pathname === "/troubleshoot/day") {
    const startParam =
      queryParams.get("start") ||
      queryParams.get("startDate") ||
      queryParams.get("date") ||
      queryParams.get("day");
    const endParam = queryParams.get("end") || queryParams.get("endDate") || startParam;
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!startParam || !isoRe.test(startParam)) {
      return send(res, 400, { error: "start date query param must be YYYY-MM-DD" });
    }
    if (!endParam || !isoRe.test(endParam)) {
      return send(res, 400, { error: "end date query param must be YYYY-MM-DD" });
    }
    const startDate = startParam;
    const endDate = endParam;
    if (new Date(`${startDate}T00:00:00Z`) > new Date(`${endDate}T00:00:00Z`)) {
      return send(res, 400, { error: "start date must be on or before end date" });
    }
    const includeTests = queryParams.get("includeTests") === "true";
    const fiFilter = queryParams.get("fi") || FI_ALL_VALUE;
    const partnerFilter = queryParams.get("partner") || PARTNER_ALL_VALUE;
    const instanceFilter = queryParams.get("instance") || INSTANCE_ALL_VALUE;
    const rawIntegrationFilter = queryParams.get("integration") || "(all)";
    const integrationFilter =
      rawIntegrationFilter === "(all)" ? "(all)" : normalizeIntegration(rawIntegrationFilter);
    try {
      const [rangeData, fiRegistry, instanceMeta] = await Promise.all([
        loadTroubleshootRange(startDate, endDate),
        loadFiRegistrySafe(),
        loadInstanceMetaMap(),
      ]);
      if (!rangeData.sessions.length && !rangeData.placements.length) {
        return send(res, 404, { error: "No raw data found for date range", startDate, endDate });
      }
      const fiMeta = buildFiMetaMap(fiRegistry);
      const payload = buildTroubleshootPayload(
        `${startDate} → ${endDate}`,
        { sessions: rangeData.sessions },
        { placements: rangeData.placements },
        fiMeta,
        instanceMeta
      );
      const filteredSessions = payload.sessions.filter((row) => {
        if (!includeTests && row.is_test) return false;
        if (fiFilter && fiFilter !== FI_ALL_VALUE) {
          if (normalizeFiKey(row.fi_key) !== normalizeFiKey(fiFilter)) return false;
        }
        if (integrationFilter !== "(all)" && row.integration !== integrationFilter) {
          return false;
        }
        if (partnerFilter && partnerFilter !== PARTNER_ALL_VALUE) {
          if ((row.partner || "Unknown") !== partnerFilter) return false;
        }
        if (instanceFilter && instanceFilter !== INSTANCE_ALL_VALUE) {
          if (canonicalInstance(row.instance) !== canonicalInstance(instanceFilter)) return false;
        }
        return true;
      });
      const totals = summarizeTroubleshootSessions(filteredSessions);
      return send(res, 200, {
        date: payload.date,
        startDate,
        endDate,
        totals,
        sessions: filteredSessions,
        placements: payload.placements,
        filters: {
          fi: fiFilter,
          integration: rawIntegrationFilter,
          partner: partnerFilter,
          instance: instanceFilter,
          includeTests,
        },
      });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to load troubleshooting data" });
    }
  }

  // Raw sessions API (used by UX Paths page)
  if (pathname === "/api/sessions/raw" && req.method === "GET") {
    const startParam =
      queryParams.get("start") ||
      queryParams.get("startDate") ||
      queryParams.get("date") ||
      queryParams.get("day");
    const endParam = queryParams.get("end") || queryParams.get("endDate") || startParam;
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!startParam || !isoRe.test(startParam)) {
      return send(res, 400, { error: "start query param must be YYYY-MM-DD" });
    }
    if (!endParam || !isoRe.test(endParam)) {
      return send(res, 400, { error: "end query param must be YYYY-MM-DD" });
    }
    const startDate = startParam;
    const endDate = endParam;
    if (new Date(`${startDate}T00:00:00Z`) > new Date(`${endDate}T00:00:00Z`)) {
      return send(res, 400, { error: "start date must be on or before end date" });
    }

    const days = daysBetween(startDate, endDate);
    // Guardrail: UX Paths is meant for short windows; prevent accidental huge payloads.
    const maxDays = Number(queryParams.get("maxDays") || 120);
    if (days.length > maxDays) {
      return send(res, 413, {
        error: `Requested ${days.length} days; maxDays=${maxDays}. Narrow the date range or pass a higher maxDays.`,
        startDate,
        endDate,
        days: days.length,
        maxDays,
      });
    }

    try {
      const sessions = [];
      for (const day of days) {
        const s = await readSessionDay(day);
        if (s?.sessions) sessions.push(...s.sessions);
      }
      return send(res, 200, {
        startDate,
        endDate,
        days,
        count: sessions.length,
        sessions,
      });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to load raw sessions" });
    }
  }

  if (pathname === "/instances") {
    try {
      const { entries, path: foundAt } = await readInstancesFile();
      const auth = await validateSession(req, queryParams);
      const isFullAccess = auth?.user?.access_level === "admin" || auth?.user?.access_level === "full";
      const payload = isFullAccess ? entries : entries.map(redactInstanceEntry);
      return send(res, 200, { instances: payload, path: foundAt, redacted: !isFullAccess });
    } catch (err) {
      console.error("instances load failed", err);
      const status = err?.status || 500;
      return send(res, status, { error: err.message || "Unable to read instances" });
    }
  }
  if (pathname === "/ga/service-account" && req.method === "GET") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const data = await readGaCredentialSummary("prod");
      return send(res, 200, data);
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to read GA credential" });
    }
  }
  if (pathname === "/ga/service-account" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const saved = await writeGaCredentialFile("prod", payload);
      return send(res, 200, saved);
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to save GA credential" });
    }
  }
  if (pathname === "/ga/service-account/delete" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const saved = await deleteGaCredentialFile("prod");
      return send(res, 200, saved);
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to delete GA credential" });
    }
  }
  if (pathname === "/ga/service-account/test" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const date =
        payload?.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
          ? payload.date
          : yesterdayIsoDate();
      const propertyId = (payload?.propertyId || process.env.GA_PROPERTY_ID || "328054560").toString();

      const summary = await readGaCredentialSummary("prod");
      if (!summary.exists) {
        return send(res, 400, { ok: false, error: "GA credential not configured. Upload JSON first." });
      }
      const rows = await fetchGaRowsForDay({
        date,
        propertyId,
        keyFile: GA_SERVICE_ACCOUNT_FILE,
      });
      const fiSet = new Set((rows || []).map((r) => r && r.fi_key).filter(Boolean));
      return send(res, 200, {
        ok: true,
        date,
        propertyId,
        rows: Array.isArray(rows) ? rows.length : 0,
        fis: fiSet.size,
        sample: Array.isArray(rows) ? rows.slice(0, 3) : [],
      });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { ok: false, error: err?.message || "GA test failed" });
    }
  }
  if (pathname === "/ga/credentials" && req.method === "GET") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const credentials = await Promise.all(GA_CREDENTIALS.map((c) => readGaCredentialSummary(c.name)));
      return send(res, 200, { credentials });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to list GA credentials" });
    }
  }
  if (pathname === "/ga/credential" && req.method === "GET") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const name = queryParams.get("name") || "";
      const data = await readGaCredentialContent(name);
      return send(res, 200, data);
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to read GA credential" });
    }
  }
  if (pathname === "/ga/credential/save" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const name = payload?.name || "";
      const saved = await writeGaCredentialFile(name, payload);
      return send(res, 200, saved);
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to save GA credential" });
    }
  }
  if (pathname === "/ga/credential/delete" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const name = payload?.name || "";
      const saved = await deleteGaCredentialFile(name);
      return send(res, 200, saved);
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to delete GA credential" });
    }
  }
  if (pathname === "/ga/credential/test" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const name = payload?.name || "";
      const cfg = getGaCredentialConfig(name);
      const summary = await readGaCredentialSummary(cfg.name);
      if (!summary.exists) {
        return send(res, 400, { ok: false, error: "GA credential not configured. Upload or paste JSON first." });
      }
      const date =
        payload?.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
          ? payload.date
          : yesterdayIsoDate();
      const envPropertyId = process.env[cfg.envProperty] || "";
      const propertyId = (payload?.propertyId || envPropertyId || cfg.defaultProperty || "328054560").toString();

      const rows = await fetchGaRowsForDay({
        date,
        propertyId,
        keyFile: cfg.file,
      });
      const fiSet = new Set((rows || []).map((r) => r && r.fi_key).filter(Boolean));
      return send(res, 200, {
        ok: true,
        name: cfg.name,
        date,
        propertyId,
        rows: Array.isArray(rows) ? rows.length : 0,
        fis: fiSet.size,
        sample: Array.isArray(rows) ? rows.slice(0, 3) : [],
      });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { ok: false, error: err?.message || "GA test failed" });
    }
  }
  if (pathname === "/instances/test" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const date =
        payload?.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
          ? payload.date
          : yesterdayIsoDate();

      const { entries } = await readInstancesFile();
      const normalized = entries.map(normalizeInstanceEntry);

      const results = [];
      const failures = [];
      for (const instance of normalized) {
        const instanceName = instance.name || "default";
        try {
          const { session } = await loginWithSdk(instance);
          await getSessionsPage(session, date, date, null);
          await getCardPlacementPage(session, date, date, null);
          results.push({ instanceName, ok: true });
        } catch (err) {
          const msg = err?.message || String(err);
          results.push({ instanceName, ok: false, error: msg });
          failures.push({ instanceName, error: msg });
        }
      }

      return send(res, 200, {
        ok: failures.length === 0,
        date,
        tested: results.length,
        failures: failures.length,
        failingInstances: failures.map((f) => f.instanceName),
        results,
      });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to test instances" });
    }
  }
  // ========== User Management Endpoints ==========
  if (pathname === "/api/users" && req.method === "GET") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const users = await loadUsersFile();
      // Don't expose sensitive fields
      const safeUsers = users.map(u => ({
        email: u.email,
        name: u.name,
        access_level: u.access_level,
        instance_keys: u.instance_keys,
        partner_keys: u.partner_keys,
        fi_keys: u.fi_keys,
        enabled: u.enabled,
        notes: u.notes,
        created_at: u.created_at,
        last_login: u.last_login || null,
        login_count: u.login_count || 0
      }));
      return send(res, 200, { users: safeUsers });
    } catch (err) {
      return send(res, 500, { error: err.message || "Unable to load users" });
    }
  }

  if (pathname === "/api/users/save" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const { user, originalEmail } = payload;

      if (!user || !user.email) {
        return send(res, 400, { error: "Email is required" });
      }

      const email = user.email.toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return send(res, 400, { error: "Invalid email format" });
      }

      const users = await loadUsersFile();
      const existingIdx = users.findIndex(u => u.email.toLowerCase() === email);
      const originalIdx = originalEmail ? users.findIndex(u => u.email.toLowerCase() === originalEmail.toLowerCase()) : -1;

      // If editing and email changed, check new email doesn't exist
      if (originalEmail && originalEmail.toLowerCase() !== email && existingIdx !== -1) {
        return send(res, 400, { error: "A user with this email already exists" });
      }

      // If adding new, check email doesn't exist
      if (!originalEmail && existingIdx !== -1) {
        return send(res, 400, { error: "A user with this email already exists" });
      }

      // Normalize access keys input - wildcards no longer supported, must be explicit arrays
      const normalizeAccessKeys = (value) => {
        if (value === "*") {
          // Wildcards no longer supported - treat as empty (no access)
          return [];
        }
        if (Array.isArray(value)) {
          const filtered = value.map((v) => (v || "").toString().trim()).filter(Boolean);
          return filtered;
        }
        if (typeof value === "string" && value.trim()) {
          if (value.trim() === "*") return []; // Wildcards no longer supported
          return value.split(",").map((v) => v.trim()).filter(Boolean);
        }
        return [];
      };

      const userData = {
        email,
        name: user.name || "",
        access_level: ["admin", "full", "internal", "limited"].includes(user.access_level) ? user.access_level : "limited",
        instance_keys: normalizeAccessKeys(user.instance_keys),
        partner_keys: normalizeAccessKeys(user.partner_keys),
        fi_keys: normalizeAccessKeys(user.fi_keys),
        enabled: user.enabled !== false,
        notes: user.notes || "",
        created_at: originalIdx !== -1 ? users[originalIdx].created_at : new Date().toISOString()
      };

      if (originalIdx !== -1) {
        // Update existing user
        users[originalIdx] = userData;
      } else {
        // Add new user
        users.push(userData);
      }

      // Save to file
      const usersData = { users, updated_at: new Date().toISOString() };
      await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2), "utf8");

      console.log(`[users] ${originalEmail ? "Updated" : "Added"} user: ${email}`);
      return send(res, 200, { ok: true, user: userData });
    } catch (err) {
      console.error("[users] Save error:", err);
      return send(res, 500, { error: err.message || "Unable to save user" });
    }
  }

  if (pathname === "/api/users/delete" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const { email } = payload;

      if (!email) {
        return send(res, 400, { error: "Email is required" });
      }

      const users = await loadUsersFile();
      const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());

      if (idx === -1) {
        return send(res, 404, { error: "User not found" });
      }

      users.splice(idx, 1);

      // Save to file
      const usersData = { users, updated_at: new Date().toISOString() };
      await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2), "utf8");

      console.log(`[users] Deleted user: ${email}`);
      return send(res, 200, { ok: true, deleted: email });
    } catch (err) {
      console.error("[users] Delete error:", err);
      return send(res, 500, { error: err.message || "Unable to delete user" });
    }
  }
  // GET /api/user-access-options - Returns all available instances/partners/FIs for user management
  if (pathname === "/api/user-access-options" && req.method === "GET") {
    if (!(await requireFullAccess(req, res, queryParams))) return;

    try {
      const fiRegistry = await loadFiRegistrySafe();
      const instances = new Set();
      const partners = new Set();
      const fis = [];

      for (const entry of Object.values(fiRegistry)) {
        if (!entry || !entry.fi_lookup_key) continue;
        instances.add(entry.instance || "unknown");
        partners.add(entry.partner || "Unknown");
        fis.push({
          key: normalizeFiKey(entry.fi_lookup_key),
          label: entry.fi_name || entry.fi_lookup_key,
          instance: entry.instance,
        });
      }

      return send(res, 200, {
        instances: Array.from(instances).sort(),
        partners: Array.from(partners).filter(p => p !== "Unknown").sort().concat(["Unknown"]),
        fis: fis.sort((a, b) => (a.label || "").localeCompare(b.label || "")),
      });
    } catch (err) {
      console.error("[user-access-options] Error:", err);
      return send(res, 500, { error: err.message || "Unable to load access options" });
    }
  }

  // ========== End User Management Endpoints ==========

  // ========== Access Control Endpoints ==========

  // GET /api/filter-options - Returns user-scoped filter dropdown options
  if (pathname === "/api/filter-options" && req.method === "GET") {
    const isViewMode = queryParams.get("view") === "1";
    const session = isViewMode ? null : await validateSession(req, queryParams);
    if (!session && !isViewMode) {
      return send(res, 401, { error: "Authentication required" });
    }

    try {
      const fiRegistry = await loadFiRegistrySafe();
      const userContext = session ? session.user : { access_level: "internal", instance_keys: "*", partner_keys: "*", fi_keys: "*" };
      const accessFields = normalizeUserAccessFields(userContext);

      // Build instance/partner allow-sets for direct filtering
      const userInstanceKeys = Array.isArray(accessFields.instance_keys)
        ? new Set(accessFields.instance_keys.map((k) => normalizeInstanceKey(k)))
        : null; // null = unrestricted
      const userPartnerKeys = Array.isArray(accessFields.partner_keys) && accessFields.partner_keys.length > 0
        ? new Set(accessFields.partner_keys.map((k) => (k || "").toString().trim().toLowerCase()))
        : null;
      const userFiKeys = Array.isArray(accessFields.fi_keys) && accessFields.fi_keys.length > 0
        ? new Set(accessFields.fi_keys.map((k) => normalizeFiKey(k)))
        : null;

      const isUnrestricted = isViewMode ||
        accessFields.access_level === "admin" || accessFields.access_level === "internal" ||
        accessFields.instance_keys === "*" || accessFields.partner_keys === "*" || accessFields.fi_keys === "*";

      // Build scoped options
      const instances = new Set();
      const partners = new Set();
      const fis = [];

      for (const entry of Object.values(fiRegistry)) {
        if (!entry || !entry.fi_lookup_key) continue;
        const fiKey = normalizeFiKey(entry.fi_lookup_key);

        if (!isUnrestricted) {
          // Check each dimension; entry must match at least one specified dimension
          const instanceMatch = userInstanceKeys && userInstanceKeys.size > 0 && entry.instance
            ? userInstanceKeys.has(normalizeInstanceKey(entry.instance))
            : false;
          const partnerMatch = userPartnerKeys && userPartnerKeys.size > 0 && entry.partner
            ? userPartnerKeys.has((entry.partner || "").toString().trim().toLowerCase())
            : false;
          const fiMatch = userFiKeys && userFiKeys.size > 0
            ? userFiKeys.has(fiKey)
            : false;

          if (!instanceMatch && !partnerMatch && !fiMatch) continue;
        }

        instances.add(entry.instance || "unknown");
        partners.add(entry.partner || "Unknown");
        fis.push({
          key: fiKey,
          label: entry.fi_name || fiKey,
          instance: entry.instance,
          partner: entry.partner || "Unknown",
        });
      }

      return send(res, 200, {
        instances: Array.from(instances).sort(),
        partners: Array.from(partners).filter((p) => p !== "Unknown").sort().concat(["Unknown"]),
        fis: fis.sort((a, b) => (a.label || "").localeCompare(b.label || "")),
        access: {
          is_admin: !isViewMode && (userContext.access_level === "admin" || userContext.access_level === "full" || userContext.access_level === "internal"),
          is_view_mode: isViewMode,
          instance_keys: userContext.instance_keys,
          partner_keys: userContext.partner_keys,
          fi_keys: userContext.fi_keys,
        },
      });
    } catch (err) {
      console.error("[filter-options] Error:", err);
      return send(res, 500, { error: err.message || "Unable to load filter options" });
    }
  }

  // POST /api/access-preview - Returns count of FIs for given access config
  if (pathname === "/api/access-preview" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;

    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || "{}");

      const fiRegistry = await loadFiRegistrySafe();

      // Build a mock user context from the payload
      const mockUserContext = {
        access_level: "limited", // Not admin, so access rules apply
        instance_keys: payload.instance_keys ?? [],
        partner_keys: payload.partner_keys ?? [],
        fi_keys: payload.fi_keys ?? [],
      };

      const allowedFis = computeAllowedFis(mockUserContext, fiRegistry);

      // If null, user would have full access
      if (allowedFis === null) {
        const totalFis = Object.values(fiRegistry).filter((e) => e && e.fi_lookup_key).length;
        return send(res, 200, { count: totalFis, unlimited: true });
      }

      return send(res, 200, { count: allowedFis.size, unlimited: false });
    } catch (err) {
      console.error("[access-preview] Error:", err);
      return send(res, 500, { error: err.message || "Unable to compute access preview" });
    }
  }

  // ========== End Access Control Endpoints ==========

  if (pathname === "/api/metrics/funnel") {
    // Validate session
    const session = await validateSession(req, queryParams);
    if (!session) {
      return send(res, 401, { error: "Authentication required" });
    }
    const userContext = session.user;

    let payload = null;
    if (req.method === "POST") {
      try {
        const rawBody = await readRequestBody(req);
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch (err) {
        return send(res, 400, { error: "Invalid JSON payload" });
      }
    }
    try {
      const fiRegistry = await loadFiRegistrySafe();
      const filters = parseMetricsFilters(queryParams, payload, userContext, fiRegistry);
      const { start, end } = resolveDateRange(filters);
      const days = daysBetween(start, end);
      const fiMeta = buildFiMetaMap(fiRegistry);
      const instanceMeta = await loadInstanceMetaMap();
      const fiList = filters.fi_list.map((fi) => normalizeFiKey(fi)).filter(Boolean);
      const fiSet = fiList.length ? new Set(fiList) : null;
      const sourceTypeSet = new Set(
        filters.source_type_list.map((value) => normalizeSourceToken(value)).filter(Boolean)
      );
      const sourceCategorySet = new Set(
        filters.source_category_list.map((value) => normalizeSourceToken(value)).filter(Boolean)
      );
      const instanceSet = filters.instance_list.length
        ? new Set(filters.instance_list.map((value) => normalizeInstanceKey(value)))
        : null;

      const makeCounters = () => ({
        SM_Sessions: 0,
        CE_Sessions: 0,
        Success_Sessions: 0,
        Jobs_Total: 0,
        Jobs_Success: 0,
        Jobs_Failed: 0,
      });
      const addCounters = (target, delta) => {
        target.SM_Sessions += delta.SM_Sessions;
        target.CE_Sessions += delta.CE_Sessions;
        target.Success_Sessions += delta.Success_Sessions;
        target.Jobs_Total += delta.Jobs_Total;
        target.Jobs_Success += delta.Jobs_Success;
        target.Jobs_Failed += delta.Jobs_Failed;
      };

      const overall = makeCounters();
      const byFi = new Map();
      const bySso = new Map();
      const bySource = new Map();
      const byDay = new Map();

      for (const day of days) {
        const [sessionsRaw, placementsRaw] = await Promise.all([
          readSessionDay(day),
          readPlacementDay(day),
        ]);
        if (!sessionsRaw || sessionsRaw.error) continue;
        const sessions = Array.isArray(sessionsRaw.sessions) ? sessionsRaw.sessions : [];
        const placementSourceMap = new Map();
        const placements = Array.isArray(placementsRaw?.placements) ? placementsRaw.placements : [];
        for (const placement of placements) {
          const key =
            placement.agent_session_id ||
            placement.session_id ||
            placement.cardholder_session_id ||
            placement.cuid ||
            null;
          if (!key) continue;
          if (placementSourceMap.has(key)) continue;
          const sourceInfo = extractSourceFromPlacement(placement);
          if (sourceInfo) placementSourceMap.set(key, sourceInfo);
        }

        for (const session of sessions) {
          const agentId =
            session.agent_session_id ||
            session.session_id ||
            session.id ||
            session.cuid ||
            null;
          const instanceRaw =
            session._instance || session.instance || session.instance_name || session.org_name || "";
          const instanceDisplay = formatInstanceDisplay(instanceRaw || "unknown");
          if (instanceSet && !instanceSet.has(normalizeInstanceKey(instanceDisplay))) continue;

          const instanceLookup = instanceMeta.get(instanceDisplay.toLowerCase());
          const fiLookupRaw =
            session.financial_institution_lookup_key ||
            session.fi_lookup_key ||
            session.fi_name ||
            null;
          const fiKey = normalizeFiKey(
            fiLookupRaw || instanceLookup?.fi || session.fi_name || ""
          );
          if (fiSet && !fiSet.has(fiKey)) continue;

          const isSso = SSO_FI_SET.has(fiKey);
          if (filters.fi_scope === "sso_only" && !isSso) continue;
          if (filters.fi_scope === "non_sso_only" && isSso) continue;

          const sourceFallback = agentId ? placementSourceMap.get(agentId) : null;
          const sourceInfo = extractSourceFromSession(session, sourceFallback);
          const sourceType = normalizeSourceToken(sourceInfo?.source_type || "unknown");
          const sourceCategory = normalizeSourceToken(sourceInfo?.source_category || "unknown");
          if (sourceTypeSet.size && !sourceTypeSet.has(sourceType)) continue;
          if (sourceCategorySet.size && !sourceCategorySet.has(sourceCategory)) continue;

          const fiName =
            fiMeta.get(fiKey)?.fi ||
            session.fi_name ||
            fiLookupRaw ||
            fiKey ||
            "Unknown FI";
          const flags = resolveSessionFunnelFlags(session);
          const jobs = resolveSessionJobCounts(session);
          const dayKey = dateKeyFromValue(session.created_on, day);

          const row = {
            SM_Sessions: flags.reachedSelectMerchant ? 1 : 0,
            CE_Sessions: flags.reachedCredentialEntry ? 1 : 0,
            Success_Sessions: flags.successfulJobs > 0 ? 1 : 0,
            Jobs_Total: clampNonNegative(jobs.total),
            Jobs_Success: clampNonNegative(jobs.success),
            Jobs_Failed: clampNonNegative(jobs.failed),
          };

          addCounters(overall, row);

          const fiEntry = byFi.get(fiKey) || {
            fi_name: fiName,
            fi_lookup_key: fiKey,
            ...makeCounters(),
          };
          addCounters(fiEntry, row);
          byFi.set(fiKey, fiEntry);

          const segment = isSso ? "SSO" : "Non-SSO";
          const ssoEntry = bySso.get(segment) || { segment, ...makeCounters() };
          addCounters(ssoEntry, row);
          bySso.set(segment, ssoEntry);

          const sourceKey = formatSourceKey(sourceType, sourceCategory);
          const sourceEntry = bySource.get(sourceKey) || {
            source_type: sourceType || "unknown",
            source_category: sourceCategory || "unknown",
            ...makeCounters(),
          };
          addCounters(sourceEntry, row);
          bySource.set(sourceKey, sourceEntry);

          const dayEntry = byDay.get(dayKey) || {
            date: dayKey,
            ...makeCounters(),
          };
          addCounters(dayEntry, row);
          byDay.set(dayKey, dayEntry);
        }
      }

      return send(res, 200, {
        filters: {
          ...filters,
          date_from: start,
          date_to: end,
        },
        overall,
        by_fi: Array.from(byFi.values()),
        by_sso_segment: Array.from(bySso.values()),
        by_source: Array.from(bySource.values()),
        by_day: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
      });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to build funnel metrics" });
    }
  }
  if (pathname === "/api/metrics/ops") {
    // Validate session
    const session = await validateSession(req, queryParams);
    if (!session) {
      return send(res, 401, { error: "Authentication required" });
    }
    const userContext = session.user;

    let payload = null;
    if (req.method === "POST") {
      try {
        const rawBody = await readRequestBody(req);
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch (err) {
        return send(res, 400, { error: "Invalid JSON payload" });
      }
    }
    try {
      const fiRegistry = await loadFiRegistrySafe();
      const filters = parseMetricsFilters(queryParams, payload, userContext, fiRegistry);
      const { start, end } = resolveDateRange(filters);
      const days = daysBetween(start, end);
      const fiMeta = buildFiMetaMap(fiRegistry);
      const fiList = filters.fi_list.map((fi) => normalizeFiKey(fi)).filter(Boolean);
      const fiSet = fiList.length ? new Set(fiList) : null;
      const instanceSet = filters.instance_list.length
        ? new Set(filters.instance_list.map((value) => normalizeInstanceKey(value)))
        : null;
      const merchantSet = filters.merchant_list.length
        ? new Set(filters.merchant_list.map((value) => normalizeSourceToken(value)))
        : null;

      const overall = {
        Jobs_Total: 0,
        Jobs_Success: 0,
        Jobs_Failed: 0,
        Jobs_Cancelled: 0,
        Jobs_Abandoned: 0,
      };
      const statusCounts = new Map([
        ["success", 0],
        ["failed", 0],
        ["cancelled", 0],
        ["abandoned", 0],
      ]);
      const byDay = new Map();
      const byMerchant = new Map();
      const byFiInstance = new Map();
      const errorCodes = new Map();

      for (const day of days) {
        const placementsRaw = await readPlacementDay(day);
        if (!placementsRaw || placementsRaw.error) continue;
        const placements = Array.isArray(placementsRaw.placements) ? placementsRaw.placements : [];
        for (const placement of placements) {
          const job = mapPlacementToJob(placement, placement.fi_lookup_key || placement.fi, placement._instance);
          const instanceDisplay = formatInstanceDisplay(job.instance || placement._instance || "unknown");
          if (instanceSet && !instanceSet.has(normalizeInstanceKey(instanceDisplay))) continue;

          const fiKey = normalizeFiKey(job.fi_key || placement.fi_lookup_key || placement.fi_name || "");
          if (fiSet && !fiSet.has(fiKey)) continue;
          const isSso = SSO_FI_SET.has(fiKey);
          if (filters.fi_scope === "sso_only" && !isSso) continue;
          if (filters.fi_scope === "non_sso_only" && isSso) continue;

          const merchant = (job.merchant || "unknown").toString();
          if (merchantSet && !merchantSet.has(normalizeSourceToken(merchant))) continue;

          const status = categorizeJobStatus(job);
          const dayKey = dateKeyFromValue(job.created_on || placement.job_created_on || placement.created_on, day);

          overall.Jobs_Total += 1;
          statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
          if (status === "success") overall.Jobs_Success += 1;
          if (status === "cancelled") overall.Jobs_Cancelled += 1;
          if (status === "abandoned") overall.Jobs_Abandoned += 1;
          if (status === "failed") overall.Jobs_Failed += 1;

          const dayEntry = byDay.get(dayKey) || { date: dayKey, Jobs_Total: 0, Jobs_Failed: 0 };
          dayEntry.Jobs_Total += 1;
          if (status === "failed") dayEntry.Jobs_Failed += 1;
          byDay.set(dayKey, dayEntry);

          const merchantEntry = byMerchant.get(merchant) || {
            merchant_name: merchant,
            Jobs_Total: 0,
            Jobs_Failed: 0,
            Jobs_Success: 0,
            top_error_code: null,
            __errorCodes: new Map(),
          };
          merchantEntry.Jobs_Total += 1;
          if (status === "success") merchantEntry.Jobs_Success += 1;
          if (status === "failed") {
            merchantEntry.Jobs_Failed += 1;
            const code =
              (job.termination || job.status || "UNKNOWN").toString().trim().toUpperCase() ||
              "UNKNOWN";
            merchantEntry.__errorCodes.set(
              code,
              (merchantEntry.__errorCodes.get(code) || 0) + 1
            );
            errorCodes.set(code, (errorCodes.get(code) || 0) + 1);
          }
          byMerchant.set(merchant, merchantEntry);

          const fiName =
            fiMeta.get(fiKey)?.fi ||
            placement.fi_name ||
            placement.fi_lookup_key ||
            fiKey ||
            "Unknown FI";
          const fiInstanceKey = makeFiInstanceKey(fiKey, instanceDisplay);
          const fiEntry = byFiInstance.get(fiInstanceKey) || {
            fi_name: fiName,
            fi_lookup_key: fiKey,
            instance: instanceDisplay || null,
            Jobs_Total: 0,
            Jobs_Failed: 0,
            Jobs_Success: 0,
          };
          fiEntry.Jobs_Total += 1;
          if (status === "success") fiEntry.Jobs_Success += 1;
          if (status === "failed") fiEntry.Jobs_Failed += 1;
          byFiInstance.set(fiInstanceKey, fiEntry);
        }
      }

      const byMerchantRows = Array.from(byMerchant.values()).map((row) => {
        let topError = null;
        let topCount = 0;
        for (const [code, count] of row.__errorCodes.entries()) {
          if (count > topCount) {
            topCount = count;
            topError = code;
          }
        }
        return {
          merchant_name: row.merchant_name,
          Jobs_Total: row.Jobs_Total,
          Jobs_Failed: row.Jobs_Failed,
          Jobs_Success: row.Jobs_Success,
          top_error_code: topError,
        };
      });

      const topErrorCodes = Array.from(errorCodes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([code, count]) => ({ error_code: code, count }));

      return send(res, 200, {
        filters: {
          ...filters,
          date_from: start,
          date_to: end,
        },
        overall,
        status_breakdown: Array.from(statusCounts.entries()).map(([status, count]) => ({
          status,
          count,
        })),
        by_day: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
        by_merchant: byMerchantRows,
        by_fi_instance: Array.from(byFiInstance.values()),
        top_error_codes: topErrorCodes,
      });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to build ops metrics" });
    }
  }
	  if (pathname === "/sessions/jobs-stats") {
      let payload = null;
      if (req.method === "POST") {
        try {
          const rawBody = await readRequestBody(req);
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch (err) {
          return send(res, 400, { error: "Invalid JSON payload" });
        }
      }
	    const startParam =
	      (payload?.start || payload?.startDate || payload?.date) ||
	      queryParams.get("start") ||
	      queryParams.get("startDate") ||
      queryParams.get("date");
    const endParam =
      (payload?.end || payload?.endDate) ||
      queryParams.get("end") ||
      queryParams.get("endDate") ||
      startParam;
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!startParam || !isoRe.test(startParam)) {
      return send(res, 400, { error: "start date query param must be YYYY-MM-DD" });
    }
    if (!endParam || !isoRe.test(endParam)) {
      return send(res, 400, { error: "end date query param must be YYYY-MM-DD" });
    }
    if (new Date(`${startParam}T00:00:00Z`) > new Date(`${endParam}T00:00:00Z`)) {
      return send(res, 400, { error: "start date must be on or before end date" });
    }

	    const includeTests =
        (payload?.includeTests === true) ||
        (payload?.includeTests === "true") ||
        queryParams.get("includeTests") === "true";
	    const partnerFilter = (payload?.partner || queryParams.get("partner") || "").toString();
	    const instanceFilter = (payload?.instance || queryParams.get("instance") || "").toString();
	    const integrationFilter = (payload?.integration || queryParams.get("integration") || "").toString();
	    const fiInstancesParam =
	      (Array.isArray(payload?.fiInstances) ? payload.fiInstances.join(",") : payload?.fiInstances) ||
        queryParams.get("fiInstances") ||
        queryParams.get("fi_instances") ||
        "";
	    const fiInstanceSet = fiInstancesParam
	      ? new Set(
	          fiInstancesParam
	            .split(",")
	            .map((v) => normalizeFiInstanceKey(v))
	            .filter(Boolean)
	        )
	      : null;
	    const fiParam = (payload?.fi || queryParams.get("fi") || "").toString();
	    const fiList = fiParam
	      ? fiParam
	          .split(",")
          .map((v) => normalizeFiKey(v))
          .filter(Boolean)
      : [];
    const fiSet = fiList.length ? new Set(fiList) : null;

    try {
      const [fiRegistry, instanceMeta] = await Promise.all([
        loadFiRegistrySafe(),
        loadInstanceMetaMap(),
      ]);
	      const fiMeta = buildFiMetaMap(fiRegistry);
	      const days = daysBetween(startParam, endParam);
	      const freq = new Map();
	      let daysWithSessionFiles = 0;
	      let sessionsScanned = 0;
	      let sessionsWithJobs = 0;
	      let totalJobs = 0;

      const placementMap = new Map(); // empty; integration still resolved via session.source + registry

	      for (const day of days) {
	        const sessionsRaw = await readSessionDay(day);
	        if (!sessionsRaw || sessionsRaw.error) continue;
	        daysWithSessionFiles += 1;
	        const sessions = Array.isArray(sessionsRaw.sessions) ? sessionsRaw.sessions : [];
	        for (const session of sessions) {
	          const entry = mapSessionToTroubleshootEntry(session, placementMap, fiMeta, instanceMeta);
	          sessionsScanned += 1;
	          if (!includeTests && entry.is_test) continue;
	          if (fiInstanceSet) {
	            const key = makeFiInstanceKey(entry.fi_key, entry.instance);
	            if (!fiInstanceSet.has(key)) continue;
	          }
	          if (fiSet && !fiSet.has(normalizeFiKey(entry.fi_key))) continue;
	          if (partnerFilter && partnerFilter !== "(all)" && entry.partner !== partnerFilter) continue;
	          if (integrationFilter && integrationFilter !== "(all)" && entry.integration !== normalizeIntegration(integrationFilter)) continue;
	          if (
	            instanceFilter &&
            instanceFilter !== "(all)" &&
            canonicalInstance(entry.instance) !== canonicalInstance(instanceFilter)
          ) {
            continue;
          }

          const jobs = Number(entry.total_jobs) || 0;
          if (jobs <= 0) continue;
          sessionsWithJobs += 1;
          totalJobs += jobs;
          freq.set(jobs, (freq.get(jobs) || 0) + 1);
        }
      }

      const median = medianFromFrequencyMap(freq, sessionsWithJobs);
      const distribution = Array.from(freq.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([jobsPerSession, sessions]) => ({
          jobsPerSession,
          sessions,
        }));
      const sessionsWithoutJobs = Math.max(0, sessionsScanned - sessionsWithJobs);
	      return send(res, 200, {
	        startDate: startParam,
	        endDate: endParam,
	        includeTests,
	        filters: {
	          fiInstances: fiInstanceSet ? Array.from(fiInstanceSet) : null,
	          fi: fiList,
	          partner: partnerFilter || null,
	          integration: integrationFilter || null,
	          instance: instanceFilter || null,
	        },
	        daysWithSessionFiles,
	        sessionsScanned,
	        sessionsWithJobs,
          sessionsWithoutJobs,
	        totalJobs,
          distribution,
	        medianJobsPerSessionWithJobs: median,
	      });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err?.message || "Unable to compute job stats" });
    }
  }
  if (pathname === "/instances/save" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || "{}");
      console.log("[instances/save] Received save request for:", payload?.entry?.name);
      if (!payload || typeof payload !== "object") {
        return send(res, 400, { error: "Invalid payload" });
      }
      const { entry, originalName } = payload;
      if (!entry || typeof entry !== "object") {
        return send(res, 400, { error: "Missing entry" });
      }
      const normalized = normalizeInstanceEntry(entry);
      console.log("[instances/save] RAW entry from client:", entry);
      console.log("[instances/save] Normalized entry:", {
        name: normalized.name,
        url: normalized.CARDSAVR_INSTANCE,
        username: normalized.USERNAME,
        password: normalized.PASSWORD,
        apikey_first20: normalized.API_KEY?.substring(0, 20) || ''
      });
      const { entries: current } = await readInstancesFile();
      console.log("[instances/save] Current entries count:", current.length);
      const existingPscu = current.find(e => e.name === 'pscu');
      if (existingPscu && normalized.name === 'pscu') {
        console.log("[instances/save] Existing PSCU in file PASSWORD:", existingPscu.PASSWORD);
        console.log("[instances/save] New PSCU PASSWORD from form:", normalized.PASSWORD);
      }
      const targetName = originalName || normalized.name;
      const existingIdx = current.findIndex((inst) => inst?.name === targetName);
      console.log("[instances/save] Target:", targetName, "existing index:", existingIdx);
      const conflict = current.findIndex(
        (inst, idx) => inst?.name === normalized.name && idx !== existingIdx
      );
      if (conflict >= 0) {
        console.log("[instances/save] Conflict detected at index:", conflict);
        return send(res, 409, { error: "An instance with that name already exists." });
      }

      if (existingIdx >= 0) {
        current[existingIdx] = normalized;
        console.log("[instances/save] Updated existing entry at index:", existingIdx);
      } else {
        current.push(normalized);
        console.log("[instances/save] Added new entry");
      }

      console.log("[instances/save] Writing file...");
      const { entries: saved, path: savedPath } = await writeInstancesFile(current);
      console.log("[instances/save] File written successfully to:", savedPath);
      console.log("[instances/save] Saved entries count:", saved.length);
      return send(res, 200, { entry: normalized, instances: saved, path: savedPath });
    } catch (err) {
      console.error("[instances/save] Error:", err);
      const status = err?.status || 500;
      return send(res, status, { error: err.message || "Unable to save instance" });
    }
  }
  if (pathname === "/instances/delete" && req.method === "POST") {
    if (!(await requireFullAccess(req, res, queryParams))) return;
    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || "{}");
      if (!payload || typeof payload !== "object" || !payload.name) {
        return send(res, 400, { error: "Missing instance name" });
      }
      const { entries: current } = await readInstancesFile();
      const idx = current.findIndex((inst) => inst?.name === payload.name);
      if (idx === -1) {
        return send(res, 404, { error: "Instance not found" });
      }
      current.splice(idx, 1);
      const { entries: saved, path: savedPath } = await writeInstancesFile(current);
      return send(res, 200, { deleted: payload.name, instances: saved, path: savedPath });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err.message || "Unable to delete instance" });
    }
  }
  if (pathname === "/api/realtime") {
    try {
      const instance = queryParams.get("instance");
      // Support both minutes (preferred for realtime) and hours (backwards compat)
      const minutesParam = queryParams.get("minutes");
      const hoursParam = queryParams.get("hours");

      let minutes;
      if (minutesParam) {
        // Allow up to 4 hours (240 minutes) for realtime queries
        minutes = Math.min(240, Math.max(1, parseInt(minutesParam) || 30));
      } else if (hoursParam) {
        minutes = Math.min(1440, Math.max(1, parseInt(hoursParam) * 60));
      } else {
        minutes = 30; // Default to 30 minutes for realtime
      }

      if (!instance) {
        return send(res, 400, { error: "Missing instance query param" });
      }

      // Read instances file to get credentials
      const { entries } = await readInstancesFile();
      const instanceConfig = entries.find(e => e.name === instance);
      if (!instanceConfig) {
        return send(res, 404, { error: `Instance "${instance}" not found` });
      }

      // Calculate time range based on minutes
      const now = new Date();
      const startTime = new Date(now.getTime() - minutes * 60 * 1000);

      // Get date strings in YYYY-MM-DD format
      const startDate = startTime.toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);

      console.log(`[realtime] Fetching live data for ${instance}: ${startDate} to ${endDate} (last ${minutes} minutes)`);

      // Login to instance
      const { session } = await loginWithSdk(instanceConfig);

      // Fetch sessions with pagination - using exact pattern from fetchSessions.mjs
      const sessionsData = [];

      // Use actual ISO timestamps for precise time range filtering
      const startTimeIso = startTime.toISOString();
      const endTimeIso = now.toISOString();

      const firstSessionResp = await session.get("cardholder_sessions", {
        created_on_min: startTimeIso,
        created_on_max: endTimeIso,
      }, {});

      const firstSessions = Array.isArray(firstSessionResp?.body) ? firstSessionResp.body :
                           Array.isArray(firstSessionResp) ? firstSessionResp : [];
      sessionsData.push(...firstSessions);

      let rawHeader = firstSessionResp?.headers?.get
        ? firstSessionResp.headers.get("x-cardsavr-paging")
        : firstSessionResp?.headers?.["x-cardsavr-paging"];

      while (rawHeader) {
        let paging;
        try {
          paging = JSON.parse(rawHeader);
        } catch {
          break;
        }

        const page = Number(paging.page) || 1;
        const pageLength = Number(paging.page_length) || 0;
        const totalResults = Number(paging.total_results) || 0;

        if (pageLength === 0 || page * pageLength >= totalResults) break;

        const nextPage = page + 1;
        const nextPaging = { ...paging, page: nextPage };
        const resp = await session.get("cardholder_sessions", {
          created_on_min: startTimeIso,
          created_on_max: endTimeIso,
        }, { "x-cardsavr-paging": JSON.stringify(nextPaging) });

        const rows = Array.isArray(resp?.body) ? resp.body : Array.isArray(resp) ? resp : [];
        sessionsData.push(...rows);

        rawHeader = resp?.headers?.get
          ? resp.headers.get("x-cardsavr-paging")
          : resp?.headers?.["x-cardsavr-paging"];
      }

      // Fetch placements with pagination - using exact pattern from fetchPlacements.mjs
      const placementsData = [];

      const firstPlacementResp = await session.getCardPlacementResults({
        created_on_min: startTimeIso,
        created_on_max: endTimeIso,
      }, {});

      const extractPlacementRows = (resp) => {
        if (!resp) return [];
        if (Array.isArray(resp.body)) return resp.body;
        if (Array.isArray(resp.card_placement_results)) return resp.card_placement_results;
        if (Array.isArray(resp)) return resp;
        return [];
      };

      const firstPlacements = extractPlacementRows(firstPlacementResp);
      placementsData.push(...firstPlacements);

      const rawPlacementHeader = firstPlacementResp.headers?.get
        ? firstPlacementResp.headers.get("x-cardsavr-paging")
        : firstPlacementResp.headers?.["x-cardsavr-paging"];

      if (rawPlacementHeader) {
        let pagingMeta = JSON.parse(rawPlacementHeader);
        const pageLength = Number(pagingMeta.page_length) || firstPlacements.length || 25;
        const totalResults = Number(pagingMeta.total_results) || firstPlacements.length;
        const totalPages = pageLength > 0 ? Math.ceil(totalResults / pageLength) : 1;

        let currentPage = Number(pagingMeta.page) || 1;

        while (currentPage < totalPages && currentPage < 500) {
          const nextPage = currentPage + 1;
          const requestPaging = { ...pagingMeta, page: nextPage };

          const resp = await session.getCardPlacementResults({
            created_on_min: startTimeIso,
            created_on_max: endTimeIso,
          }, { "x-cardsavr-paging": JSON.stringify(requestPaging) });

          const rows = extractPlacementRows(resp);
          placementsData.push(...rows);

          const nextHeader = resp.headers?.get
            ? resp.headers.get("x-cardsavr-paging")
            : resp.headers?.["x-cardsavr-paging"];

          if (!nextHeader) break;

          try {
            pagingMeta = JSON.parse(nextHeader);
          } catch {
            pagingMeta.page = nextPage;
          }

          const reportedPage = Number(pagingMeta.page);
          if (!Number.isFinite(reportedPage) || reportedPage <= currentPage) break;
          currentPage = reportedPage;
        }
      }

      console.log(`[realtime] Fetched ${sessionsData.length} sessions, ${placementsData.length} placements`);

      // Group placements by session ID using same logic as troubleshoot endpoint
      const placementMap = new Map();
      placementsData.forEach(p => {
        const key = p.agent_session_id || p.session_id || p.cardholder_session_id || p.cuid || null;
        if (!key) return;
        if (!placementMap.has(key)) {
          placementMap.set(key, []);
        }
        placementMap.get(key).push(p);
      });

      // Merge placements into sessions as enriched jobs
      const enrichedSessions = sessionsData.map(session => {
        const agentId = session.agent_session_id || session.session_id || session.id || session.cuid || null;
        const sessionPlacements = agentId ? placementMap.get(agentId) || [] : [];
        const jobs = sessionPlacements
          .map(p => mapPlacementToJob(p, session.fi_lookup_key || session.fi, instance))
          .sort((a, b) => {
            if (!a.created_on || !b.created_on) return 0;
            return a.created_on.localeCompare(b.created_on);
          });

        return {
          ...session,
          jobs,
          placements_raw: sessionPlacements,
        };
      });

      // Sort sessions newest to oldest
      enrichedSessions.sort((a, b) => {
        const aTime = a.created_on || a.closed_on || '';
        const bTime = b.created_on || b.closed_on || '';
        return bTime.localeCompare(aTime); // Reverse order for newest first
      });

      // Also keep enriched placements for filter population
      const enrichedPlacements = placementsData.map(p =>
        mapPlacementToJob(p, p.fi_lookup_key || p.fi, instance)
      );

      return send(res, 200, {
        instance,
        timeRange: { minutes, hours: Math.ceil(minutes / 60), start: startTime.toISOString(), end: now.toISOString() },
        sessions: enrichedSessions,
        placements: enrichedPlacements,
      });
    } catch (err) {
      console.error("[realtime] Error:", err);
      const status = err?.status || 500;
      return send(res, status, { error: err.message || "Unable to fetch realtime data" });
    }
  }

  // GA4 Realtime API endpoint - fetches page activity from GA4
  if (pathname === "/api/realtime-ga") {
    try {
      const minutes = Math.min(30, Math.max(1, parseInt(queryParams.get("minutes") || "30")));
      const credentialName = queryParams.get("credential") || "prod";

      // Check if GA credentials exist
      const cfg = GA_CREDENTIALS.find((c) => c.name === credentialName);
      if (!cfg) {
        return send(res, 400, { error: `Unknown GA credential: ${credentialName}` });
      }

      const credentialExists = await fileExists(cfg.file);
      if (!credentialExists) {
        return send(res, 200, {
          available: false,
          reason: "GA credentials not configured",
          credentialName,
          rows: [],
          summary: null,
        });
      }

      // Get property ID
      const propertyId = process.env[cfg.envProperty] || cfg.defaultProperty;
      if (!propertyId) {
        return send(res, 200, {
          available: false,
          reason: "GA property ID not configured",
          credentialName,
          rows: [],
          summary: null,
        });
      }

      // Fetch GA4 Realtime data
      const { google } = await import("googleapis");
      const auth = new google.auth.GoogleAuth({
        keyFile: cfg.file,
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      });
      const analyticsData = google.analyticsdata({ version: "v1beta", auth });

      console.log(`[realtime-ga] Fetching realtime data from property ${propertyId} (last ${minutes} minutes)`);

      const response = await analyticsData.properties.runRealtimeReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dimensions: [
            { name: "unifiedScreenName" },
            { name: "minutesAgo" },
          ],
          metrics: [
            { name: "screenPageViews" },
            { name: "activeUsers" },
          ],
          limit: 10000,
        },
      });

      const allRows = (response.data.rows || []).map((row) => {
        const screenName = row.dimensionValues?.[0]?.value || "";
        const minutesAgo = parseInt(row.dimensionValues?.[1]?.value || "0");
        const views = Number(row.metricValues?.[0]?.value || "0");
        const activeUsers = Number(row.metricValues?.[1]?.value || "0");

        return {
          screen_name: screenName,
          minutes_ago: minutesAgo,
          views,
          active_users: activeUsers,
        };
      });

      // Filter to requested time window
      const rows = allRows.filter(row => row.minutes_ago <= minutes);

      // Compute summary
      const summary = {
        total_views: rows.reduce((sum, r) => sum + r.views, 0),
        total_active_users: rows.reduce((sum, r) => sum + r.active_users, 0),
        unique_screens: new Set(rows.map(r => r.screen_name)).size,
      };

      console.log(`[realtime-ga] Fetched ${rows.length} rows: ${summary.total_views} views, ${summary.total_active_users} active users`);

      return send(res, 200, {
        available: true,
        credentialName,
        propertyId,
        minutes,
        fetchedAt: new Date().toISOString(),
        rows,
        summary,
      });
    } catch (err) {
      console.error("[realtime-ga] Error:", err);
      return send(res, 200, {
        available: false,
        reason: err.message || "GA4 Realtime API error",
        rows: [],
        summary: null,
      });
    }
  }

  if (pathname === "/daily") {
    const dateStr = queryParams.get("date");
    if (!dateStr) {
      return send(res, 400, { error: "Missing date query param" });
    }
    try {
      const data = await loadDaily(dateStr);
      return send(res, 200, data);
    } catch (e) {
      return send(res, 404, { error: "daily not found", date: dateStr });
    }
  }
  if (pathname === "/daily-range") {
    const start = queryParams.get("start");
    const end = queryParams.get("end");
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!start || !isoRe.test(start)) {
      return send(res, 400, { error: "start query param must be YYYY-MM-DD" });
    }
    if (!end || !isoRe.test(end)) {
      return send(res, 400, { error: "end query param must be YYYY-MM-DD" });
    }
    if (new Date(`${start}T00:00:00Z`) > new Date(`${end}T00:00:00Z`)) {
      return send(res, 400, { error: "start date must be on or before end date" });
    }
    try {
      const days = daysBetween(start, end);
      const entries = {};
      for (const day of days) {
        try {
          entries[day] = await loadDaily(day);
        } catch {
          // Skip missing days.
        }
      }
      return send(res, 200, { start, end, days, entries });
    } catch (e) {
      return send(res, 500, { error: e?.message || "Unable to load daily range" });
    }
  }
  if (pathname.startsWith("/daily/") && pathname.endsWith(".json")) {
    try {
      const dateStr = path.basename(pathname).replace(".json", "");
      return send(res, 200, await loadDaily(dateStr));
    } catch (e) {
      return send(res, 404, { error: "daily not found", path: pathname });
    }
  }

  /**
   * GET /merchant-heatmap?start=YYYY-MM-DD&end=YYYY-MM-DD
  * Returns { start, end, days: [iso...], slices: [{ day, merchant, fi, is_test, total, billable, siteFailures, userFlowIssues }] }
   */
  if (req.method === "GET" && pathname === "/merchant-heatmap") {
    const query = Object.fromEntries(queryParams.entries());
    // default = last 90 days
    const today = new Date();
    const endDefault = isoOnly(today);
    const startDefault = isoOnly(new Date(today.getTime() - 89 * 86400000));
    const start = parseIso(query.start, startDefault);
    const end = parseIso(query.end, endDefault);

    try {
      setCors(res);
      const payload = await buildGlobalMerchantHeatmap(start, end);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(payload));
    } catch (e) {
      setCors(res);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e?.message || String(e) }));
    }
    return;
  }

  if (pathname === "/sources/summary") {
    const defaults = defaultUpdateRange();
    const start = parseIso(queryParams.get("start"), defaults.startDate);
    const end = parseIso(queryParams.get("end"), defaults.endDate);
    if (!start || !end) {
      return send(res, 400, { error: "start and end must be YYYY-MM-DD" });
    }
    if (new Date(`${start}T00:00:00Z`) > new Date(`${end}T00:00:00Z`)) {
      return send(res, 400, { error: "start date must be on or before end date" });
    }
    const rawFi = queryParams.get("fi");
    if (!rawFi) {
      return send(res, 400, { error: "fi query parameter is required" });
    }
    const fiKey = normalizeFiKey(rawFi);
    if (!fiKey) {
      return send(res, 400, { error: "Invalid fi value" });
    }
    const includeTests = queryParams.get("includeTests") === "true";
    const days = daysBetween(start, end);
    if (!days.length) {
      return send(res, 400, { error: "Invalid date range" });
    }
    const sessions = [];
    const placements = [];
    for (const day of days) {
      const daySessions = await readSessionDay(day);
      if (daySessions?.sessions) {
        sessions.push(...daySessions.sessions);
      }
      const dayPlacements = await readPlacementDay(day);
      if (dayPlacements?.placements) {
        placements.push(...dayPlacements.placements);
      }
    }
    const fiRegistry = await loadFiRegistrySafe();
    const fiMeta = buildFiMetaMap(fiRegistry);
    const instanceMeta = await loadInstanceMetaMap();
    const payload = buildTroubleshootPayload(
      `${start} → ${end}`,
      { sessions },
      { placements },
      fiMeta,
      instanceMeta
    );
    const normalizedSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const filteredSessions = normalizedSessions.filter((session) => {
      if (!includeTests && session.is_test) return false;
      return session.fi_key === fiKey;
    });
    const grouped = groupSessionsBySource(filteredSessions);
    const kpis = computeSourceKpis(grouped);
    const daily = buildDailySeries(grouped, days);
    const merchants = buildMerchantSeries(filteredSessions);
    const fiEntry = fiMeta.get(fiKey);
    return send(res, 200, {
      start,
      end,
      fi: fiKey,
      fiName: fiEntry?.fi || fiKey,
      includeTests,
      counts: {
        sessions: filteredSessions.length,
        days: days.length,
      },
      days,
      kpis,
      daily,
      merchants,
    });
  }

  if (pathname === "/" || pathname === "/index.html") {
    const fp = path.join(PUBLIC_DIR, "index.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  if (pathname === "/heatmap" || pathname === "/heatmap.html") {
    const fp = path.join(PUBLIC_DIR, "heatmap.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  if (pathname === "/funnel" || pathname === "/funnel.html") {
    const fp = path.join(PUBLIC_DIR, "funnel.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  if (pathname === "/sources" || pathname === "/sources.html") {
    const fp = path.join(PUBLIC_DIR, "sources.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  if (pathname === "/troubleshoot" || pathname === "/troubleshoot.html") {
    const fp = path.join(PUBLIC_DIR, "troubleshoot.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  if (pathname === "/maintenance" || pathname === "/maintenance.html") {
    const fp = path.join(PUBLIC_DIR, "maintenance.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  if (
    pathname === "/dashboards/customer-success" ||
    pathname === "/dashboards/customer-success.html"
  ) {
    const fp = path.join(PUBLIC_DIR, "dashboards", "customer-success.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  if (pathname === "/dashboards/operations" || pathname === "/dashboards/operations.html") {
    const fp = path.join(PUBLIC_DIR, "dashboards", "operations.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  // Serve static assets from public (CSS/JS/data/etc)
  const relPath = pathname.replace(/^\/+/, "");
  const staticCandidates = [path.join(PUBLIC_DIR, relPath)];
  if (relPath.startsWith("public/")) {
    staticCandidates.push(path.join(PUBLIC_DIR, relPath.slice("public/".length)));
  }
  for (const staticPath of staticCandidates) {
    if (staticPath.startsWith(PUBLIC_DIR) && (await fileExists(staticPath))) {
      return serveFile(res, staticPath);
    }
  }

  // UI entry (SPA fallback): "/" and any unknown path -> heatmap.html or funnel.html
  const entry = await pickUiEntry();
  if (entry) {
    return serveFile(res, entry);
  } else {
    // Inline notice if neither file exists
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>SIS Server</title>
<style>body{background:#0b0f14;color:#e6edf3;font:16px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial}</style>
</head><body>
  <h1>SIS server running</h1>
  <p>Could not find <code>public/heatmap.html</code> or <code>public/funnel.html</code>.</p>
  <p>Public dir: <code>${PUBLIC_DIR}</code></p>
  <p>Visit <a href="/__diag">/__diag</a> to inspect paths.</p>
</body></html>`;
    return send(res, 200, html, "text/html; charset=utf-8");
  }
});

server.listen(PORT, () => {
  console.log(`> SIS server on http://localhost:${PORT}`);
  console.log(`> UI dir: ${PUBLIC_DIR}`);
  console.log(`> Data dir: ${DATA_DIR}`);
  console.log(`> Daily dir: ${DAILY_DIR}`);
  if (SYNTHETIC_RUNNER_MODE === "sim") {
    console.log("> Synthetic runner: simulated");
  } else if (SYNTHETIC_RUNNER_MODE) {
    console.log(`> Synthetic runner: ${SYNTHETIC_RUNNER_MODE}`);
  } else {
    console.log("> Synthetic runner: disabled");
  }
  startSynthScheduler();
});
