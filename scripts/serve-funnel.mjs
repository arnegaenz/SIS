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
const PORT = 8787;

const updateClients = new Set();

let currentUpdateJob = {
  running: false,
  startedAt: null,
  finishedAt: null,
  startDate: null,
  endDate: null,
  lastMessage: null,
  error: null,
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

async function startUpdateJobIfNeeded() {
  if (currentUpdateJob.running) {
    return;
  }

  const endDate = todayIsoDate();
  const startDate = isoAddDays(endDate, -29);

  currentUpdateJob = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    startDate,
    endDate,
    lastMessage: `Starting update for ${startDate} → ${endDate}`,
    error: null,
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
      message: `Fetching raw for ${startDate} → ${endDate}...`,
    });

    await fetchRawRange({
      startDate,
      endDate,
      onStatus: (message) =>
        broadcastUpdate("progress", { phase: "raw", message }),
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
    send(res, 200, buf, mime(path.extname(fp)));
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

async function readPlacementDay(day) {
  try {
    const fp = path.join(RAW_PLACEMENTS_DIR, `${day}.json`);
    const raw = await fs.readFile(fp, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
  // merchant => { totals, daily: dayKey => {billable, siteFail, total} }
  const merchants = Object.create(null);

  for (const day of days) {
    const raw = await readPlacementDay(day);
    if (!raw || raw.error || !Array.isArray(raw.placements)) continue;

    for (const pl of raw.placements) {
      // Identify merchant
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
      if (!merchants[merchant]) {
        merchants[merchant] = {
          prod: createPlacementStore(),
          test: createPlacementStore(),
          testInstanceSet: new Set(),
        };
      }
      const bucket = merchants[merchant];
      const targetStore = isTestInstance ? bucket.test : bucket.prod;
      if (isTestInstance) {
        if (instanceName) {
          bucket.testInstanceSet.add(instanceName);
        }
      }

      // Determine termination class
      const term = (pl.termination_type || "").toString().toUpperCase();
      const status = (pl.status || "").toString().toUpperCase();
      const rule =
        TERMINATION_RULES[term] ||
        TERMINATION_RULES[status] ||
        TERMINATION_RULES.UNKNOWN;

      targetStore.total += 1;

      // Day attribution (prefer actual placement timestamps; fallback = file day)
      const dKey = placementDay(pl) || day;
      const d = ensureDailyEntry(targetStore, dKey);
      d.total += 1;

      if (rule.includeInHealth) {
        if (rule.severity === "success") {
          targetStore.billable += 1;
          d.billable += 1;
        } else {
          targetStore.siteFailures += 1;
          d.siteFailures += 1;
        }
      } else if (rule.includeInUx) {
        targetStore.userFlowIssues += 1;
        d.userFlowIssues += 1;
      } else {
        // treat unknown as site failure for conservative health
        targetStore.siteFailures += 1;
        d.siteFailures += 1;
      }
    }
  }

  const rows = [];
  for (const [merchant, stats] of Object.entries(merchants)) {
    const prodStats = summarizeStore(stats.prod, days);
    const testStats = summarizeStore(stats.test, days);
    const testInstances = Array.from(stats.testInstanceSet || []);
    const hasTestTraffic = testStats.total > 0;

    rows.push({
      merchant,
      total: prodStats.total,
      billable: prodStats.billable,
      siteFailures: prodStats.siteFailures,
      userFlowIssues: prodStats.userFlowIssues,
      overallHealthPct: prodStats.overallHealthPct,
      days: prodStats.days,
      prod_stats: prodStats,
      test_stats: testStats,
      is_test: hasTestTraffic,
      has_test_fi: hasTestTraffic,
      has_prod_fi: prodStats.total > 0,
      test_traffic: testStats.total,
      prod_traffic: prodStats.total,
      test_instances: testInstances,
    });
  }

  // Sort by total volume desc
  rows.sort((a, b) => (b.total || 0) - (a.total || 0));

  return { start: startIso, end: endIso, days, merchants: rows };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const search = parsedUrl.search;
  const queryParams = new URLSearchParams(search || "");

  if (pathname === "/run-update/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 5000\n\n");

    updateClients.add(res);

    sseSend(res, "snapshot", {
      running: currentUpdateJob.running,
      startedAt: currentUpdateJob.startedAt,
      finishedAt: currentUpdateJob.finishedAt,
      startDate: currentUpdateJob.startDate,
      endDate: currentUpdateJob.endDate,
      lastMessage: currentUpdateJob.lastMessage,
      error: currentUpdateJob.error,
    });

    if (!currentUpdateJob.running) {
      startUpdateJobIfNeeded().catch((err) => {
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

      const next = { ...registry[key] };
      if ("integration_type" in updates) {
        next.integration_type = normalizeIntegration(updates.integration_type);
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
   * Returns { start, end, days: [iso...], merchants: [{ merchant, total, ..., days:[{day,color,pct,...}]}] }
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

  if (pathname === "/maintenance" || pathname === "/maintenance.html") {
    const fp = path.join(PUBLIC_DIR, "maintenance.html");
    if (await fileExists(fp)) return serveFile(res, fp);
  }

  // Serve anything under /public/*
  if (pathname.startsWith("/public/")) {
    const rel = pathname.slice("/public/".length);
    const fp = path.join(PUBLIC_DIR, rel);
    if (await fileExists(fp)) return serveFile(res, fp);
    return send(res, 404, { error: "asset not found", path: fp });
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
