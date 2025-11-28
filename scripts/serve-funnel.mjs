import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import url from "url";
import { TERMINATION_RULES } from "../src/config/terminationMap.mjs";
import { isTestInstanceName } from "../src/config/testInstances.mjs";
import { fetchRawRange } from "./fetch-raw.mjs";
import { buildDailyFromRawRange } from "./build-daily-from-raw.mjs";
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
const FI_REGISTRY_FILE = path.join(ROOT, "fi_registry.json");
const INSTANCES_FILES = [
  path.join(ROOT, "src", "instances.json"),
  path.join(ROOT, "instances.json"),
];
const PORT = 8787;
const FI_ALL_VALUE = "__all__";
const PARTNER_ALL_VALUE = "__all_partners__";
const INSTANCE_ALL_VALUE = "__all_instances__";

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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
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

    await fetchRawRange({
      startDate,
      endDate,
      onStatus: (message) =>
        broadcastUpdate("progress", { phase: "raw", message }),
      forceRaw: Boolean(range.forceRaw),
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

    broadcastUpdate("error", {
      finishedAt: currentUpdateJob.finishedAt,
      startDate,
      endDate,
      error: currentUpdateJob.error,
      message: currentUpdateJob.lastMessage,
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

const send = (res, code, body, type) => {
  res.statusCode = code;
  if (type) res.setHeader("Content-Type", type);
  if (typeof body === "object" && !(body instanceof Uint8Array)) {
    res.setHeader("Content-Type", type || "application/json; charset=utf-8");
    res.end(JSON.stringify(body, null, 2));
  } else {
    res.end(body);
  }
};

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

async function serveFile(res, fp) {
  try {
    const buf = await fs.readFile(fp);
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
      const instances = Array.isArray(entry.instances) ? entry.instances : [];
      const instValue = entry.instance || null;
      const candidates = instValue ? [instValue, ...instances] : instances;
      candidates
        .filter(Boolean)
        .map((v) => v.toString().trim().toLowerCase())
        .forEach((inst) => {
          if (!inst) return;
          map.set(inst, { fi: fiName, integration, partner });
        });
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
        throw Object.assign(new Error("instances.json must be an array"), {
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
  const sorted = [...entries].sort((a, b) =>
    (a?.name || "").localeCompare(b?.name || "")
  );
  let target = INSTANCES_FILES[0];
  for (const candidate of INSTANCES_FILES) {
    try {
      await fs.access(candidate);
      target = candidate;
      break;
    } catch {
      // missing, keep searching
    }
  }
  await fs.writeFile(target, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  return { entries: sorted, path: target };
}

async function readPlacementDay(day) {
  try {
    const fp = path.join(RAW_PLACEMENTS_DIR, `${day}.json`);
    const raw = await fs.readFile(fp, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readSessionDay(day) {
  try {
    const fp = path.join(RAW_DIR, "sessions", `${day}.json`);
    const raw = await fs.readFile(fp, "utf8");
    return JSON.parse(raw);
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

function formatInstanceDisplay(value) {
  if (!value) return "unknown";
  const base = value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return base || "unknown";
}

async function loadFiRegistrySafe() {
  try {
    const raw = await fs.readFile(FI_REGISTRY_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
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
    const list = Array.isArray(entry.instances) ? entry.instances : [];
    if (primary) instanceSet.add(primary);
    list.forEach((inst) => instanceSet.add(formatInstanceDisplay(inst)));
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

  if (pathname === "/run-update/status") {
    return send(res, 200, currentUpdateSnapshot());
  }

  if (pathname === "/run-update/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 5000\n\n");

    updateClients.add(res);

    sseSend(res, "snapshot", currentUpdateSnapshot());

    if (!currentUpdateJob.running) {
      const qsStart = queryParams.get("start") || queryParams.get("startDate");
      const qsEnd = queryParams.get("end") || queryParams.get("endDate");
      const forceRaw = queryParams.get("forceRaw") === "true";
      startUpdateJobIfNeeded({ startDate: qsStart, endDate: qsEnd, forceRaw }).catch((err) => {
        console.error("Update job failed:", err);
      });
    }

    req.on("close", () => {
      updateClients.delete(res);
    });

    return;
  }

  // Diagnostics
  if (pathname === "/__diag") {
    const diag = {
      now: new Date().toISOString(),
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

  // JSON helpers
  if (pathname === "/list-daily") {
    const days = await listDaily();
    return send(res, 200, { files: days, days });
  }
  if (pathname === "/data-freshness") {
    try {
      const [rawSessionDays, rawPlacementDays, dailyDays] = await Promise.all([
        listRawDays("sessions"),
        listRawDays("placements"),
        listDaily(),
      ]);
      const latest = (arr = []) => (arr.length ? arr[arr.length - 1] : null);
      const rawLatest = latest(
        rawSessionDays.length && rawPlacementDays.length
          ? rawSessionDays.filter((d) => rawPlacementDays.includes(d))
          : rawSessionDays.length
          ? rawSessionDays
          : rawPlacementDays
      );
      const dailyLatest = latest(dailyDays);
      const today = todayIsoDate();
      const age = (iso) => {
        if (!iso) return null;
        const ms = new Date(`${today}T00:00:00Z`) - new Date(`${iso}T00:00:00Z`);
        return Math.floor(ms / 86400000);
      };
      return send(res, 200, {
        rawLatest,
        rawAgeDays: age(rawLatest),
        dailyLatest,
        dailyAgeDays: age(dailyLatest),
      });
    } catch (err) {
      return send(res, 500, { error: err?.message || "Unable to load freshness" });
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
      if (!registry[key]) {
        return send(res, 404, { error: "Registry entry not found", key });
      }

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
      const canonicalLookupKey = (value) =>
        value ? value.toString().trim().toLowerCase() : "";
      const canonicalInstance = (value) =>
        value ? value.toString().trim().toLowerCase() : "";

      const next = { ...registry[key] };
      if ("integration_type" in updates) {
        next.integration_type = normalizeIntegration(updates.integration_type);
      }
      if ("fi_name" in updates) {
        const fiName = normalizeFiName(updates.fi_name);
        if (fiName !== undefined) next.fi_name = fiName;
      }
      if ("fi_lookup_key" in updates) {
        const fiLookup = normalizeFiLookupKey(updates.fi_lookup_key, next.fi_lookup_key);
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
  if (pathname === "/instances") {
    try {
      const { entries, path: foundAt } = await readInstancesFile();
      return send(res, 200, { instances: entries, path: foundAt });
    } catch (err) {
      console.error("instances load failed", err);
      const status = err?.status || 500;
      return send(res, status, { error: err.message || "Unable to read instances" });
    }
  }
  if (pathname === "/instances/save" && req.method === "POST") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || "{}");
      if (!payload || typeof payload !== "object") {
        return send(res, 400, { error: "Invalid payload" });
      }
      const { entry, originalName } = payload;
      if (!entry || typeof entry !== "object") {
        return send(res, 400, { error: "Missing entry" });
      }
      const normalized = normalizeInstanceEntry(entry);
      const { entries: current } = await readInstancesFile();
      const targetName = originalName || normalized.name;
      const existingIdx = current.findIndex((inst) => inst?.name === targetName);
      const conflict = current.findIndex(
        (inst, idx) => inst?.name === normalized.name && idx !== existingIdx
      );
      if (conflict >= 0) {
        return send(res, 409, { error: "An instance with that name already exists." });
      }

      if (existingIdx >= 0) {
        current[existingIdx] = normalized;
      } else {
        current.push(normalized);
      }

      const { entries: saved, path: savedPath } = await writeInstancesFile(current);
      return send(res, 200, { entry: normalized, instances: saved, path: savedPath });
    } catch (err) {
      const status = err?.status || 500;
      return send(res, status, { error: err.message || "Unable to save instance" });
    }
  }
  if (pathname === "/instances/delete" && req.method === "POST") {
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
      const payload = await buildGlobalMerchantHeatmap(start, end);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(payload));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e?.message || String(e) }));
    }
    return;
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

  if (pathname === "/troubleshoot" || pathname === "/troubleshoot.html") {
    const fp = path.join(PUBLIC_DIR, "troubleshoot.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  if (pathname === "/maintenance" || pathname === "/maintenance.html") {
    const fp = path.join(PUBLIC_DIR, "maintenance.html");
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
});
