import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { fetchGaRowsForDay } from "../src/ga.mjs";
import { loginWithSdk } from "../src/api.mjs";
import { loadInstances } from "../src/utils/config.mjs";
import { fetchSessionsForInstance } from "../src/fetch/fetchSessions.mjs";
import { fetchPlacementsForInstance } from "../src/fetch/fetchPlacements.mjs";
import {
  ensureRawDirs,
  rawExists,
  writeRaw,
  readRaw,
} from "../src/lib/rawStorage.mjs";

const SRC_DIR = path.resolve("src");
const DAILY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_GA_PROPERTY = process.env.GA_PROPERTY_ID || "328054560";
const DEFAULT_GA_KEYFILE =
  process.env.GA_KEYFILE || "./secrets/ga-service-account.json";
const REFRESH_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateDiffInDays(older, newer) {
  if (!older || !newer) return Infinity;
  const start = new Date(`${older}T00:00:00Z`);
  const end = new Date(`${newer}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Infinity;
  return (end - start) / MS_PER_DAY;
}

function validateIsoDate(value) {
  if (!DAILY_FORMAT.test(value)) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD.`);
  }
  return value;
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(end)) {
    throw new Error("Unable to parse date range.");
  }
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

export function parseDateArgs(argv = []) {
  if (argv.length === 0) {
    const today = todayUtc();
    return { startDate: today, endDate: today, dates: [today] };
  }

  if (argv.length === 1) {
    const day = validateIsoDate(argv[0]);
    return { startDate: day, endDate: day, dates: [day] };
  }

  if (argv.length === 2) {
    const startDate = validateIsoDate(argv[0]);
    const endDate = validateIsoDate(argv[1]);
    if (startDate > endDate) {
      throw new Error(
        `Start date ${startDate} must be <= end date ${endDate}.`
      );
    }
    return { startDate, endDate, dates: enumerateDates(startDate, endDate) };
  }

  throw new Error("Usage: node scripts/fetch-raw.mjs [startDate] [endDate]");
}

function gaRequestForDate(date) {
  return {
    propertyId: DEFAULT_GA_PROPERTY,
    keyFile: path.resolve(DEFAULT_GA_KEYFILE),
    date,
    dimensions: ["date", "hostName", "pagePath"],
    metrics: ["screenPageViews"],
  };
}

async function getSessionForInstance(instance, cache) {
  const instanceName =
    instance?.name ||
    instance?.CARDSAVR_INSTANCE ||
    instance?.USERNAME ||
    "default";
  if (cache.has(instanceName)) {
    return cache.get(instanceName);
  }
  const { session } = await loginWithSdk(instance);
  cache.set(instanceName, session);
  return session;
}

async function collectSessionsForDay(date, instances, cache) {
  const combined = [];
  const seenIds = new Set();
  for (const instance of instances) {
    const sdkSession = await getSessionForInstance(instance, cache);
    await fetchSessionsForInstance(
      sdkSession,
      instance.name || instance.CARDSAVR_INSTANCE || "default",
      date,
      date,
      seenIds,
      combined
    );
  }
  return combined;
}

async function collectPlacementsForDay(date, instances, cache) {
  const combined = [];
  const errors = [];
  const seenIds = new Set();
  for (const instance of instances) {
    const instanceName =
      instance.name || instance.CARDSAVR_INSTANCE || "default";
    try {
      const sdkSession = await getSessionForInstance(instance, cache);
      await fetchPlacementsForInstance(
        sdkSession,
        instanceName,
        date,
        date,
        seenIds,
        combined
      );
    } catch (err) {
      const msg = err?.message || String(err);
      console.warn(
        `[${date}] Placements error for ${instanceName}: ${msg}`
      );
      errors.push({ instance: instanceName, error: msg });
    }
  }
  return { placements: combined, errors };
}

async function fetchGaRaw(date) {
  const request = gaRequestForDate(date);
  const rows = await fetchGaRowsForDay({
    date: request.date,
    propertyId: request.propertyId,
    keyFile: request.keyFile,
  });
  return { date, rows, count: rows.length, request };
}

async function fetchSessionsRaw(date, instances, cache) {
  const sessions = await collectSessionsForDay(date, instances, cache);
  return { date, sessions, count: sessions.length };
}

async function fetchPlacementsRaw(date, instances, cache) {
  const { placements, errors } = await collectPlacementsForDay(
    date,
    instances,
    cache
  );
  return { date, placements, errors, count: placements.length };
}

function logSkip(date, type, onStatus) {
  const msg = `[${date}] ${type}: skipped (already exists)`;
  if (onStatus) onStatus(msg);
  console.log(msg);
}

function logWrite(date, type, status, onStatus) {
  const msg = `[${date}] ${type}: ${status}`;
  if (onStatus) onStatus(msg);
  console.log(msg);
}

function logRefetch(date, type, reason, onStatus) {
  const suffix = reason ? ` (reason: ${reason})` : "";
  const msg = `[${date}] ${type}: refreshing${suffix}`;
  if (onStatus) onStatus(msg);
  console.log(msg);
}

function shouldRefreshRaw(type, date) {
  const raw = readRaw(type, date);
  if (!raw) {
    return { refresh: true, reason: "missing cache" };
  }
  if (raw.error) {
    return { refresh: true, reason: "previous error" };
  }
  let rows = null;
  if (type === "ga") {
    rows = Array.isArray(raw.rows) ? raw.rows : null;
  } else if (type === "sessions") {
    rows = Array.isArray(raw.sessions) ? raw.sessions : null;
  } else if (type === "placements") {
    rows = Array.isArray(raw.placements) ? raw.placements : null;
  }
  if (!rows || rows.length === 0) {
    return { refresh: true, reason: "zero rows" };
  }
  const diff = isoDateDiffInDays(date, todayUtc());
  if (diff < REFRESH_WINDOW_DAYS) {
    return {
      refresh: true,
      reason: `within ${REFRESH_WINDOW_DAYS} days`,
    };
  }
  return { refresh: false, reason: null };
}

export async function fetchRawRange({ startDate, endDate, onStatus }) {
  const instances = loadInstances(SRC_DIR);
  const sessionCache = new Map();
  const dates = enumerateDates(startDate, endDate);
  ensureRawDirs();

  for (const date of dates) {
    console.log(`\n=== ${date} ===`);

    const hasGa = rawExists("ga", date);
    const { refresh: shouldRefreshGa, reason: gaReason } = hasGa
      ? shouldRefreshRaw("ga", date)
      : { refresh: true, reason: "missing cache" };
    if (shouldRefreshGa) {
      if (hasGa) {
        logRefetch(date, "GA", gaReason, onStatus);
      }
      try {
        const payload = await fetchGaRaw(date);
        writeRaw("ga", date, payload);
        logWrite(date, "GA", `fetched ${payload.rows.length} rows`, onStatus);
      } catch (err) {
        const warnMsg = `[${date}] GA error: ${err.message || err}`;
        if (onStatus) onStatus(warnMsg);
        console.warn(warnMsg);
        writeRaw("ga", date, {
          date,
          error: err.message || String(err),
          rows: [],
          count: 0,
          request: gaRequestForDate(date),
        });
      }
    } else {
      logSkip(date, "GA", onStatus);
    }

    const hasSessions = rawExists("sessions", date);
    const { refresh: shouldRefreshSessions, reason: sessionsReason } = hasSessions
      ? shouldRefreshRaw("sessions", date)
      : { refresh: true, reason: "missing cache" };
    if (shouldRefreshSessions) {
      if (hasSessions) {
        logRefetch(date, "Sessions", sessionsReason, onStatus);
      }
      try {
        const payload = await fetchSessionsRaw(date, instances, sessionCache);
        writeRaw("sessions", date, payload);
        logWrite(
          date,
          "Sessions",
          `fetched ${payload.sessions.length}`,
          onStatus
        );
      } catch (err) {
        const warnMsg = `[${date}] Sessions error: ${err.message || err}`;
        if (onStatus) onStatus(warnMsg);
        console.warn(warnMsg);
        writeRaw("sessions", date, {
          date,
          error: err.message || String(err),
          sessions: [],
          count: 0,
        });
      }
    } else {
      logSkip(date, "Sessions", onStatus);
    }

    const hasPlacements = rawExists("placements", date);
    const { refresh: shouldRefreshPlacements, reason: placementsReason } =
      hasPlacements
        ? shouldRefreshRaw("placements", date)
        : { refresh: true, reason: "missing cache" };
    if (shouldRefreshPlacements) {
      if (hasPlacements) {
        logRefetch(date, "Placements", placementsReason, onStatus);
      }
      try {
        const payload = await fetchPlacementsRaw(date, instances, sessionCache);
        writeRaw("placements", date, payload);
        logWrite(
          date,
          "Placements",
          `fetched ${payload.placements.length}`,
          onStatus
        );
      } catch (err) {
        const warnMsg = `[${date}] Placements error: ${err.message || err}`;
        if (onStatus) onStatus(warnMsg);
        console.warn(warnMsg);
        writeRaw("placements", date, {
          date,
          error: err.message || String(err),
          placements: [],
          count: 0,
        });
      }
    } else {
      logSkip(date, "Placements", onStatus);
    }
  }
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  try {
    const { startDate, endDate } = parseDateArgs(process.argv.slice(2));
    fetchRawRange({ startDate, endDate }).catch((err) => {
      console.error("fetch-raw failed:", err);
      process.exitCode = 1;
    });
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  }
}
