import { fetchRawRange } from "./fetch-raw.mjs";
import { buildDailyFromRawRange } from "./build-daily-from-raw.mjs";

function isoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function yesterdayUtc() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return isoDateUtc(d);
}

function parseArgs(argv = []) {
  const args = new Set(argv);
  const dateArg = argv.find((v) => v.startsWith("--date="));
  const date = dateArg ? dateArg.split("=")[1] : "";
  const forceRaw = args.has("--force");
  return { date, forceRaw };
}

async function run() {
  const { date, forceRaw } = parseArgs(process.argv.slice(2));
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : yesterdayUtc();

  console.log(`[refresh-yesterday] Start for ${day}${forceRaw ? " (force raw)" : ""}`);
  await fetchRawRange({
    startDate: day,
    endDate: day,
    forceRaw,
    strict: true,
    onStatus: (message) => console.log(`[refresh-yesterday] ${message}`),
  });
  await buildDailyFromRawRange({ startDate: day, endDate: day });
  console.log(`[refresh-yesterday] Done for ${day}`);
}

run().catch((err) => {
  console.error("[refresh-yesterday] Failed:", err);
  process.exit(1);
});
