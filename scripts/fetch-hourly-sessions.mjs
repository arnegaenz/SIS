import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { loginWithSdk } from "../src/api.mjs";
import { loadInstances } from "../src/utils/config.mjs";
import { readRaw, ensureRawDirs } from "../src/lib/rawStorage.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SRC_DIR = path.resolve("src");
const ROOT_DIR = path.resolve(".");
const HOURLY_DIR = path.resolve("raw", "sessions_hourly");

function parseDateArg(value, label) {
  if (!value || !DATE_RE.test(value)) {
    throw new Error(`Invalid ${label} "${value}". Use YYYY-MM-DD.`);
  }
  return value;
}

function enumerateDates(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    throw new Error(`Invalid date range ${startDate} → ${endDate}.`);
  }
  const out = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

function ensureHourlyDir() {
  fs.mkdirSync(HOURLY_DIR, { recursive: true });
}

function hourParts(date, hour) {
  const hh = hour.toString().padStart(2, "0");
  return {
    hh,
    label: `${date} ${hh}:00`,
    key: `${date}-${hh}`,
    start: `${date}T${hh}:00:00Z`,
    end: `${date}T${hh}:59:59Z`,
  };
}

function extractPagingHeader(resp) {
  if (!resp || !resp.headers) return null;
  if (typeof resp.headers.get === "function") {
    return resp.headers.get("x-cardsavr-paging");
  }
  return (
    resp.headers["x-cardsavr-paging"] ||
    resp.headers["X-Cardsavr-Paging"] ||
    null
  );
}

function normalizeSessionRows(resp) {
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp.body)) return resp.body;
  if (resp && Array.isArray(resp.cardholder_sessions)) {
    return resp.cardholder_sessions;
  }
  return [];
}

function collectRows(rows, instanceName, seen, contextKey) {
  const added = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const idCandidate =
      row.id ??
      row.session_id ??
      row.sessionId ??
      row.uuid ??
      row.cardholder_session_id ??
      null;
    const dedupKey = idCandidate
      ? `${instanceName}-${idCandidate}`
      : `${instanceName}-${contextKey}-auto-${seen.size + added.length}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    added.push({ ...row, _instance: instanceName });
  }
  return added;
}

async function getSessionForInstance(instance, cache) {
  const key =
    instance?.name ||
    instance?.CARDSAVR_INSTANCE ||
    instance?.USERNAME ||
    "default";
  if (cache.has(key)) return cache.get(key);
  const { session } = await loginWithSdk(instance);
  cache.set(key, session);
  return session;
}

async function fetchSessionsForHour(session, instanceName, start, end, seen) {
  const query = {
    created_on_min: start,
    created_on_max: end,
  };

  const contextKey = `${start}-${end}`;
  const collected = [];

  const firstResp = await session.get("cardholder_sessions", query, {});
  collected.push(
    ...collectRows(
      normalizeSessionRows(firstResp),
      instanceName,
      seen,
      contextKey
    )
  );

  let rawHeader = extractPagingHeader(firstResp);
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
    if (
      pageLength === 0 ||
      totalResults === 0 ||
      page * pageLength >= totalResults
    ) {
      break;
    }
    const nextPaging = { ...paging, page: page + 1 };
    const resp = await session.get("cardholder_sessions", query, {
      "x-cardsavr-paging": JSON.stringify(nextPaging),
    });
    collected.push(
      ...collectRows(
        normalizeSessionRows(resp),
        instanceName,
        seen,
        contextKey
      )
    );
    rawHeader = extractPagingHeader(resp);
  }

  return collected;
}

function hasValidSessionsPayload(entry) {
  return entry && Array.isArray(entry.sessions);
}

function hourlyFilePath(key) {
  return path.join(HOURLY_DIR, `${key}.json`);
}

async function fetchHourlySessions(startDate, endDate) {
  const instances = loadInstances(ROOT_DIR);
  const sessionCache = new Map();
  const dates = enumerateDates(startDate, endDate);
  ensureRawDirs();
  ensureHourlyDir();

  for (const date of dates) {
    for (let hour = 0; hour < 24; hour += 1) {
      const parts = hourParts(date, hour);
      const existing = readRaw("sessions_hourly", parts.key);
      if (hasValidSessionsPayload(existing)) {
        console.log(`[${parts.label}] skipped (exists)`);
        continue;
      }

      const combined = [];
      const seen = new Set();

      for (const instance of instances) {
        const instanceName =
          instance?.name ||
          instance?.CARDSAVR_INSTANCE ||
          instance?.USERNAME ||
          "default";
        try {
          const session = await getSessionForInstance(instance, sessionCache);
          const rows = await fetchSessionsForHour(
            session,
            instanceName,
            parts.start,
            parts.end,
            seen
          );
          combined.push(...rows);
        } catch (err) {
          console.warn(
            `[${parts.label}] ${instanceName} error: ${
              err?.message || err
            }`
          );
        }
      }

      fs.writeFileSync(
        hourlyFilePath(parts.key),
        JSON.stringify(
          {
            date,
            hour: parts.hh,
            sessions: combined,
          },
          null,
          2
        )
      );

      console.log(`[${parts.label}] ok (${combined.length} sessions)`);
    }
  }
}

async function run() {
  const startArg = parseDateArg(process.argv[2], "startDate");
  const endArg = parseDateArg(process.argv[3] || startArg, "endDate");
  await fetchHourlySessions(startArg, endArg);
  console.log(`Hourly session fetch complete for ${startArg} → ${endArg}`);
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  run().catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
  });
}
