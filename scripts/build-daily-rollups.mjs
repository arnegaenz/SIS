import {
  bucketGaRowsByFiForDay,
  bucketSisSessionsByFiForDay,
  bucketSisPlacementsByFiForDay,
  buildDailyDocument,
  writeDailyFile,
} from "../src/lib/daily-rollups.mjs";
import { runSisFetch } from "../src/index.mjs";
import { fetchGaRowsForDay } from "../src/ga.mjs";

const DAILY_DIR = "./data/daily";
const FORCE_GA_TO_TODAY =
  String(process.env.FORCE_GA_TO_TODAY || "").toLowerCase() === "true";

function nextDayStr(isoDate) {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

async function fetchGaRowsForSisDay(day) {
  const gaDate = FORCE_GA_TO_TODAY
    ? new Date().toISOString().slice(0, 10)
    : day;

  const rows = await fetchGaRowsForDay({ date: gaDate });

  if (FORCE_GA_TO_TODAY) {
    return rows.map((row) => ({ ...row, date: day }));
  }

  return rows;
}

async function main() {
  console.log("Running SIS fetch to get date window + SIS rows...");
  const {
    startDate,
    endDate,
    sessionsByDay,
    placementsByDay,
  } = await runSisFetch();

  console.log(`Building daily files from ${startDate} → ${endDate}`);
  let day = startDate;
  while (day <= endDate) {
    let gaRows = [];
    try {
      gaRows = await fetchGaRowsForSisDay(day);
    } catch (err) {
      console.warn(`⚠️ GA fetch failed for ${day}:`, err.message || err);
    }
    const gaByFi = bucketGaRowsByFiForDay(gaRows, day);
    const sessionsByFi = bucketSisSessionsByFiForDay(sessionsByDay, day);
    const placementsByFi = bucketSisPlacementsByFiForDay(placementsByDay, day);
    const doc = buildDailyDocument({
      day,
      gaByFi,
      sessionsByFi,
      placementsByFi,
    });
    await writeDailyFile(DAILY_DIR, day, doc);
    console.log("✅ wrote", `${DAILY_DIR}/${day}.json`);
    day = nextDayStr(day);
  }

  console.log("All daily roll-ups complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
