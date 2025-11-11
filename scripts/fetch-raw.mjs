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
} from "../src/lib/rawStorage.mjs";

const SRC_DIR = path.resolve("src");
const DAILY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_GA_PROPERTY = process.env.GA_PROPERTY_ID || "328054560";
const DEFAULT_GA_KEYFILE =
  process.env.GA_KEYFILE || "./secrets/ga-service-account.json";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
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
  const seenIds = new Set();
  for (const instance of instances) {
    const sdkSession = await getSessionForInstance(instance, cache);
    await fetchPlacementsForInstance(
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

async function fetchGaRaw(date) {
  const request = gaRequestForDate(date);
  const rows = await fetchGaRowsForDay({
    date: request.date,
    propertyId: request.propertyId,
    keyFile: request.keyFile,
  });
  return { date, rows, request };
}

async function fetchSessionsRaw(date, instances, cache) {
  const sessions = await collectSessionsForDay(date, instances, cache);
  return { date, sessions };
}

async function fetchPlacementsRaw(date, instances, cache) {
  const placements = await collectPlacementsForDay(date, instances, cache);
  return { date, placements };
}

function logSkip(date, type) {
  console.log(`[${date}] ${type}: skipped (already exists)`);
}

function logWrite(date, type, status) {
  console.log(`[${date}] ${type}: ${status}`);
}

export async function fetchRawRange({ startDate, endDate }) {
  const instances = loadInstances(SRC_DIR);
  const sessionCache = new Map();
  const dates = enumerateDates(startDate, endDate);
  ensureRawDirs();

  for (const date of dates) {
    console.log(`\n=== ${date} ===`);

    if (rawExists("ga", date)) {
      logSkip(date, "GA");
    } else {
      try {
        const payload = await fetchGaRaw(date);
        writeRaw("ga", date, payload);
        logWrite(date, "GA", `fetched ${payload.rows.length} rows`);
      } catch (err) {
        console.warn(`[${date}] GA error: ${err.message || err}`);
        writeRaw("ga", date, {
          date,
          error: err.message || String(err),
          rows: [],
          request: gaRequestForDate(date),
        });
      }
    }

    if (rawExists("sessions", date)) {
      logSkip(date, "Sessions");
    } else {
      try {
        const payload = await fetchSessionsRaw(date, instances, sessionCache);
        writeRaw("sessions", date, payload);
        logWrite(date, "Sessions", `fetched ${payload.sessions.length}`);
      } catch (err) {
        console.warn(`[${date}] Sessions error: ${err.message || err}`);
        writeRaw("sessions", date, {
          date,
          error: err.message || String(err),
          sessions: [],
        });
      }
    }

    if (rawExists("placements", date)) {
      logSkip(date, "Placements");
    } else {
      try {
        const payload = await fetchPlacementsRaw(date, instances, sessionCache);
        writeRaw("placements", date, payload);
        logWrite(date, "Placements", `fetched ${payload.placements.length}`);
      } catch (err) {
        console.warn(`[${date}] Placements error: ${err.message || err}`);
        writeRaw("placements", date, {
          date,
          error: err.message || String(err),
          placements: [],
        });
      }
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
