import { readRaw } from "../src/lib/rawStorage.mjs";

function parseDate(d) {
  return new Date(`${d}T00:00:00Z`);
}

function enumerateDates(start, end) {
  const out = [];
  let cur = parseDate(start);
  const stop = parseDate(end);
  while (cur <= stop) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}

const startArg = process.argv[2];
const endArg = process.argv[3] || startArg;

if (!startArg || !/^\d{4}-\d{2}-\d{2}$/.test(startArg)) {
  console.error("Usage: node scripts/debug-hourly-sessions.mjs YYYY-MM-DD [YYYY-MM-DD]");
  process.exit(1);
}

const startDate = startArg;
const endDate = endArg;

const dates = enumerateDates(startDate, endDate);
const hourly = {}; // { "2025-11-12 03": 18 }

for (const date of dates) {
  const raw = readRaw("sessions", date);
  if (!raw || !Array.isArray(raw.sessions)) continue;

  for (const s of raw.sessions) {
    const ts =
      s.created_on ||
      s.job_created_on ||
      s.job_ready_on ||
      null;

    if (!ts || typeof ts !== "string") continue;

    // hourKey = "YYYY-MM-DD HH"
    const hourKey = ts.slice(0, 13).replace("T", " ");
    hourly[hourKey] = (hourly[hourKey] || 0) + 1;
  }
}

// Print sorted output
const sortedKeys = Object.keys(hourly).sort();
console.log(`Hourly session counts (${startDate} → ${endDate}):\n`);
for (const k of sortedKeys) {
  console.log(`${k}: ${hourly[k]}`);
}
