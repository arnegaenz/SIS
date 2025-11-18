import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readRaw } from "../src/lib/rawStorage.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Normalize FI lookup keys so we can safely compare.
 */
function normalizeFiKey(value) {
  if (!value) return "";
  return value.toString().trim().toLowerCase();
}

/**
 * Enumerate all YYYY-MM-DD dates between start and end (inclusive).
 */
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

/**
 * Decide whether a placement is considered "successful" from a billing perspective.
 * Mirrors how we treat BILLABLE/SUCCESSFUL in SIS.
 */
function isSuccessPlacement(p) {
  const term = (p.termination_type || "").toString().toUpperCase();
  const status = (p.status || "").toString().toUpperCase();

  if (term === "BILLABLE") return true;
  if (status === "SUCCESSFUL") return true;
  return false;
}

/**
 * Extract FI lookup key from a placement row.
 */
function getPlacementFiKey(p) {
  return normalizeFiKey(
    p.fi_lookup_key ||
      p.financial_institution_lookup_key ||
      p.fi_name ||
      p.financial_institution ||
      p.org_name
  );
}

/**
 * Load one daily rollup JSON if it exists, otherwise return null.
 */
function loadDailyJson(date) {
  const dailyPath = path.join(__dirname, "..", "data", "daily", `${date}.json`);
  try {
    const raw = fs.readFileSync(dailyPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Optionally load placements-by-fi aggregated output (if index.mjs has been run).
 */
function loadFunnelPlacementsByFi() {
  const funnelPath = path.join(__dirname, "..", "output", "placements-by-fi.json");
  try {
    const raw = fs.readFileSync(funnelPath, "utf8");
    const json = JSON.parse(raw);
    const result = {};
    for (const [fiKey, stats] of Object.entries(json)) {
      const norm = normalizeFiKey(fiKey);
      if (!norm) continue;
      result[norm] = {
        total: Number(stats.total || 0),
        success: Number(
          stats.billable ??
            stats.success ??
            stats.successful ??
            0
        ),
      };
    }
    return result;
  } catch {
    return null;
  }
}

async function main() {
  const [, , fiArg, startArg, endArg] = process.argv;

  if (!fiArg || !startArg) {
    console.error(
      "Usage: node scripts/audit-placements.mjs <fi_lookup_key|ALL> <start-YYYY-MM-DD> [end-YYYY-MM-DD]"
    );
    process.exit(1);
  }

  const fiFilter = normalizeFiKey(fiArg);
  const startDate = startArg;
  const endDate = endArg || startArg;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(`Invalid start date "${startDate}". Use YYYY-MM-DD.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`Invalid end date "${endDate}". Use YYYY-MM-DD.`);
  }
  if (startDate > endDate) {
    throw new Error(`Start date ${startDate} must be <= end date ${endDate}.`);
  }

  const dates = enumerateDates(startDate, endDate);

  const rawTotals = Object.create(null);
  const dailyTotals = Object.create(null);

  // --- 1) Walk raw/placements and count placements directly from CardSavr API cache ---
  for (const date of dates) {
    const raw = readRaw("placements", date);
    const placements =
      raw && !raw.error && Array.isArray(raw.placements)
        ? raw.placements
        : [];

    for (const p of placements) {
      const fiKey = getPlacementFiKey(p);
      if (!fiKey) continue;
      if (fiFilter && fiFilter !== "all" && fiKey !== fiFilter) continue;

      if (!rawTotals[fiKey]) {
        rawTotals[fiKey] = { total: 0, success: 0 };
      }
      rawTotals[fiKey].total += 1;
      if (isSuccessPlacement(p)) {
        rawTotals[fiKey].success += 1;
      }
    }

    // --- 2) Walk data/daily/<date>.json rollups for the same FI(s) ---
    const dailyJson = loadDailyJson(date);
    if (!dailyJson || !dailyJson.fi) continue;

    for (const [fiKeyRaw, stats] of Object.entries(dailyJson.fi)) {
      const fiKey = normalizeFiKey(fiKeyRaw);
      if (!fiKey) continue;
      if (fiFilter && fiFilter !== "all" && fiKey !== fiFilter) continue;

      const placements = stats.placements || {};
      const dailyTotal = Number(
        placements.total_placements ?? placements.total ?? 0
      );
      const dailySuccess = Number(
        placements.successful_placements ??
          placements.success ??
          0
      );

      if (!dailyTotals[fiKey]) {
        dailyTotals[fiKey] = { total: 0, success: 0 };
      }
      dailyTotals[fiKey].total += dailyTotal;
      dailyTotals[fiKey].success += dailySuccess;
    }
  }

  // --- 3) Optionally compare against aggregated placements-by-fi (if present) ---
  const funnelTotals = loadFunnelPlacementsByFi() || {};

  const allFiKeys = new Set([
    ...Object.keys(rawTotals),
    ...Object.keys(dailyTotals),
    ...Object.keys(funnelTotals),
  ]);

  // Grand totals across all included FIs (respecting the FI filter)
  const grandTotals = {
    raw: { total: 0, success: 0 },
    daily: { total: 0, success: 0 },
    funnel: { total: 0, success: 0 },
  };

  // For the compact summary table
  const summaryRows = [];

  console.log(`Audit window: ${startDate} → ${endDate}`);
  console.log(
    `FI filter: ${fiFilter && fiFilter !== "all" ? fiFilter : "ALL (per FI)"}`
  );
  console.log("");
  console.log(
    [
      "fi_lookup_key",
      "raw_success",
      "raw_total",
      "daily_success",
      "daily_total",
      "funnel_success",
      "funnel_total",
      "notes",
    ].join(",")
  );

  for (const fiKey of Array.from(allFiKeys).sort()) {
    // Skip any empty FI keys
    if (!fiKey) continue;

    const raw = rawTotals[fiKey] || { total: 0, success: 0 };
    const daily = dailyTotals[fiKey] || { total: 0, success: 0 };
    const funnel = funnelTotals[fiKey] || { total: 0, success: 0 };

    const notes = [];
    if (raw.success !== daily.success) notes.push("RAW!=DAILY");
    if (daily.success !== funnel.success) notes.push("DAILY!=FUNNEL");
    if (raw.success === 0 && daily.success === 0 && funnel.success === 0) {
      notes.push("no-success-data");
    }

    // Accumulate into grand totals
    grandTotals.raw.total += raw.total;
    grandTotals.raw.success += raw.success;
    grandTotals.daily.total += daily.total;
    grandTotals.daily.success += daily.success;
    grandTotals.funnel.total += funnel.total;
    grandTotals.funnel.success += funnel.success;

    console.log(
      [
        fiKey,
        raw.success,
        raw.total,
        daily.success,
        daily.total,
        funnel.success,
        funnel.total,
        notes.join("|"),
      ].join(",")
    );

    // Capture per-FI totals for the compact RAW/ROLLUP/FUNNEL table
    summaryRows.push({
      fiKey,
      rawTotal: raw.total || 0,
      rollupTotal: daily.total || 0,
      funnelTotal: funnel.total || 0,
    });
  }

  // Print a blank line and then a grand-total row for the CSV
  console.log("");
  console.log(
    [
      "TOTAL",
      grandTotals.raw.success,
      grandTotals.raw.total,
      grandTotals.daily.success,
      grandTotals.daily.total,
      grandTotals.funnel.success,
      grandTotals.funnel.total,
      "",
    ].join(",")
  );

  // Now print the compact RAW / ROLLUP / FUNNEL summary table
  console.log("");
  console.log("Summary (totals only; RAW vs ROLLUP vs FUNNEL)");
  console.log("FI\tRAW\tROLLUP\tFUNNEL\tOK?");

  for (const row of summaryRows.sort((a, b) =>
    a.fiKey.localeCompare(b.fiKey)
  )) {
    const { fiKey, rawTotal, rollupTotal, funnelTotal } = row;
    const ok = rawTotal === rollupTotal && rollupTotal === funnelTotal;
    console.log(
      `${fiKey}\t${rawTotal}\t${rollupTotal}\t${funnelTotal}\t${ok ? "✔" : "✖"}`
    );
  }

  console.log("");
  console.log(
    "Tip: compare raw_success with your external transaction CSV (SUCCESSFUL/BILLABLE) for the same FI + date range."
  );
}

main().catch((err) => {
  console.error("Audit failed:", err);
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
