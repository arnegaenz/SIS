import { fetchGaRowsForDay } from "../src/ga.mjs";

const day = process.argv[2];
if (!day) {
  console.error("Usage: node scripts/test-ga-day.mjs YYYY-MM-DD");
  process.exit(1);
}

(async () => {
  try {
    const rows = await fetchGaRowsForDay({ date: day });
    console.log(`Fetched ${rows.length} GA rows for ${day}`);
    for (const row of rows) {
      console.log(
        `${row.date} | ${row.host} | ${row.page} | fi=${row.fi_key} | views=${row.views}`
      );
    }
  } catch (err) {
    console.error("GA fetch failed:", err.message || err);
    process.exit(1);
  }
})();
