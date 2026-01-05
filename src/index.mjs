// src/index.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { loadSsoFis } from "./utils/config.mjs";
import {
  printSessionSummary,
  printPlacementSummary,
} from "./reporting/consoleReport.mjs";
import { aggregateSessions } from "./aggregators/aggregateSessions.mjs";
import { aggregateCardPlacements } from "./aggregators/aggregateCardPlacements.mjs";
import { updateFiRegistry } from "./utils/fiRegistry.mjs";
import { TERMINATION_RULES } from "./config/terminationMap.mjs";
import {
  fetchGAFunnelByDay,
  aggregateGAFunnelByFI,
  printGAFunnelReport,
} from "./ga.mjs";
import { readRaw } from "./lib/rawStorage.mjs";
import { fetchRawRange } from "../scripts/fetch-raw.mjs";
import { buildDailyFromRawRange } from "../scripts/build-daily-from-raw.mjs";

// NOTE: for historical backfills, run:
//   node scripts/fetch-raw.mjs 2020-01-01 2025-11-11
//   node scripts/build-daily-from-raw.mjs 2020-01-01 2025-11-11
// index.mjs should normally only do "today".

// for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIN_ATTEMPTS = 5;

function pct(num, den) {
  if (!den) return "0.0%";
  return ((num / den) * 100).toFixed(1) + "%";
}

function formatMerchantName(name, width = 20) {
  if (name.length <= width) {
    return name.padEnd(width, " ");
  }
  return `${name.slice(0, width - 3)}...`;
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parsePlacementDate(placement) {
  const candidates = [
    placement.completed_on,
    placement.account_linked_on,
    placement.job_ready_on,
    placement.job_created_on,
    placement.created_on,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
  }
  return null;
}

function toDateOnlyString(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const str = value.toString();
  if (!str) return "";
  if (str.length >= 10) {
    return str.slice(0, 10);
  }
  return "";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeFiKey(value) {
  if (!value) return "";
  return value.toString().trim().toLowerCase();
}

function canonicalInstance(value) {
  if (!value) return "";
  return value.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function loadRawArrayOrEmpty(type, date, field) {
  const raw = readRaw(type, date);
  if (!raw) {
    console.warn(
      `[${date}] raw/${type}/${date}.json not found; continuing with empty ${field}.`
    );
    return [];
  }
  if (raw.error) {
    console.warn(
      `[${date}] raw/${type}/${date}.json recorded error: ${raw.error}`
    );
    return [];
  }
  if (!Array.isArray(raw[field])) {
    console.warn(
      `[${date}] raw/${type}/${date}.json missing ${field} array; continuing empty.`
    );
    return [];
  }
  return raw[field];
}

function loadGaRowsFromCache(date) {
  const raw = readRaw("ga", date);
  const rawTest = readRaw("ga-test", date);
  if (!raw && !rawTest) {
    console.warn(
      `[${date}] raw/ga/${date}.json not found; GA funnel will fetch live if needed.`
    );
    return null;
  }
  if (raw?.error) {
    console.warn(
      `[${date}] raw/ga/${date}.json recorded error: ${raw.error}`
    );
  }
  if (rawTest?.error) {
    console.warn(
      `[${date}] raw/ga-test/${date}.json recorded error: ${rawTest.error}`
    );
  }
  const prodRows = Array.isArray(raw?.rows) ? raw.rows : [];
  const testRows = Array.isArray(rawTest?.rows) ? rawTest.rows : [];
  const combined = [...prodRows, ...testRows];
  if (!combined.length) {
    console.warn(
      `[${date}] GA rows missing; GA funnel will fetch live if needed.`
    );
    return null;
  }
  const fallbackDate = raw?.date || rawTest?.date || date;
  return combined.map((row) => ({
    date: row.date || fallbackDate || date,
    host: row.host || row.hostname || "",
    pagePath: row.pagePath || row.page || "",
    views: Number(row.views) || 0,
    is_test: Boolean(row.is_test),
  }));
}

function computeTrendArrow(dailyStats = {}, selector) {
  if (typeof selector !== "function") return "";
  const values = Object.entries(dailyStats)
    .map(([day, stats]) => ({
      day,
      value: selector(stats || {}),
    }))
    .filter(
      ({ value }) =>
        value !== null && value !== undefined && Number.isFinite(value)
    )
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  if (values.length < 7) return "";

  const recent = values[values.length - 1].value;
  const baselineValues = [];
  for (let i = values.length - 2; i >= 0 && baselineValues.length < 6; i -= 1) {
    baselineValues.push(values[i].value);
  }
  if (baselineValues.length < 6) return "";

  const baseline =
    baselineValues.reduce((sum, val) => sum + val, 0) /
    baselineValues.length;

  if (!Number.isFinite(recent) || !Number.isFinite(baseline)) return "";

  const delta = recent - baseline;
  const absDelta = Math.abs(delta);
  if (absDelta < 2) return "→";
  if (delta >= 10) return "↑";
  if (delta <= -10) return "↓";
  if (delta >= 2) return "↗";
  if (delta <= -2) return "↘";
  return "→";
}

function parseDateArg(value, fallback) {
  if (!value) return fallback;
  const iso = value.toString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  throw new Error(`Invalid date "${value}". Use YYYY-MM-DD.`);
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

function normalizeAdvancialSession(session) {
  if (!session || typeof session !== "object") return session;
  const fiKeyRaw =
    session.financial_institution_lookup_key ||
    session.fi_lookup_key ||
    session.financial_institution ||
    null;
  const instanceRaw =
    session._instance ||
    session.instance ||
    session.instance_name ||
    null;
  const fiNorm = normalizeFiKey(fiKeyRaw);
  const instNorm = canonicalInstance(instanceRaw);
  let updated = session;

  if (fiNorm === "default" && instNorm === "advancialprod") {
    updated = {
      ...updated,
      financial_institution_lookup_key: "advancial-prod",
      fi_lookup_key: "advancial-prod",
      financial_institution: "advancial-prod",
    };
  }
  if (normalizeFiKey(updated.financial_institution_lookup_key) === "advancial-prod" && instNorm === "default") {
    updated = {
      ...updated,
      _instance: "advancial-prod",
      instance: "advancial-prod",
      instance_name: "advancial-prod",
    };
  }
  return updated;
}

function normalizeAdvancialPlacement(placement) {
  if (!placement || typeof placement !== "object") return placement;
  const fiKeyRaw =
    placement.fi_lookup_key ||
    placement.financial_institution_lookup_key ||
    placement.fi_name ||
    placement.financial_institution ||
    null;
  const instanceRaw =
    placement._instance ||
    placement.instance ||
    placement.instance_name ||
    placement.org_name ||
    null;
  const fiNorm = normalizeFiKey(fiKeyRaw);
  const instNorm = canonicalInstance(instanceRaw);
  let updated = placement;

  if (fiNorm === "default" && instNorm === "advancialprod") {
    updated = {
      ...updated,
      fi_lookup_key: "advancial-prod",
      financial_institution_lookup_key: "advancial-prod",
      fi_name: "advancial-prod",
    };
  }
  if (normalizeFiKey(updated.fi_lookup_key) === "advancial-prod" && instNorm === "default") {
    updated = {
      ...updated,
      _instance: "advancial-prod",
      instance: "advancial-prod",
      instance_name: "advancial-prod",
    };
  }
  return updated;
}

async function main() {
  const today = todayIsoDate();
  const cliStart = parseDateArg(process.argv[2], today);
  const cliEnd = parseDateArg(process.argv[3], cliStart);
  const useCacheOnly =
    process.env.CACHE_ONLY === "true" || process.argv.includes("--cache-only");
  if (cliStart > cliEnd) {
    throw new Error(`Start date ${cliStart} must be <= end date ${cliEnd}.`);
  }
  const startDate = cliStart;
  const endDate = cliEnd;
  const dates = enumerateDates(startDate, endDate);

  if (useCacheOnly) {
    console.log(
      `Cache-only mode: reusing existing raw/daily files for ${startDate} → ${endDate} (no logins or fetches).`
    );
  } else {
    console.log(`Preparing raw + daily cache for ${startDate} → ${endDate}...`);
    await fetchRawRange({ startDate, endDate });
    await buildDailyFromRawRange({ startDate, endDate });
    console.log(`Daily rollup ready at data/daily/${startDate}.json ... ${endDate}.json`);
  }

  const SSO_SET = loadSsoFis(__dirname);
  const allSessionsCombined = dates
    .flatMap((date) => loadRawArrayOrEmpty("sessions", date, "sessions"))
    .map(normalizeAdvancialSession);
  const allPlacementsCombined = dates
    .flatMap((date) => loadRawArrayOrEmpty("placements", date, "placements"))
    .map(normalizeAdvancialPlacement);
  const gaRowsFromCache = dates.flatMap((date) => loadGaRowsFromCache(date) || []);

  // 4) now we have ALL SESSIONS and ALL CARD PLACEMENTS from ALL instances
  console.log(
    `\n✅ Unique sessions available (raw cache): ${allSessionsCombined.length}`
  );

  // ----- aggregate sessions by FI -----
  const {
    sessionSummary,
    ssoSummary,
    cardsavrSummary,
    nonSsoSummary,
  } = aggregateSessions(allSessionsCombined, SSO_SET);
  const sessionsByFI = sessionSummary;

  printSessionSummary(
    sessionSummary,
    nonSsoSummary,
    ssoSummary,
    cardsavrSummary
  );

  // ------------- CARD PLACEMENT SUMMARIES -------------
  console.log(
    `\n✅ Card placement results available (raw cache): ${allPlacementsCombined.length}`
  );

  const {
    placementSummary,
    ssoPlacements,
    cardsavrPlacements,
    nonSsoPlacements,
    merchantSummary,
  } = aggregateCardPlacements(allPlacementsCombined, SSO_SET);
  const cardPlacementsByFI = placementSummary;

  printPlacementSummary(
    placementSummary,
    nonSsoPlacements,
    ssoPlacements,
    cardsavrPlacements,
    merchantSummary
  );

  const outputDir = path.join(__dirname, "..", "output");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "sessions-by-fi.json"),
    JSON.stringify(sessionsByFI, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outputDir, "placements-by-fi.json"),
    JSON.stringify(cardPlacementsByFI, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outputDir, "date-window.json"),
    JSON.stringify({ start: startDate, end: endDate }, null, 2),
    "utf8"
  );

  updateFiRegistry(allSessionsCombined, allPlacementsCombined, SSO_SET);

  let fiRegistry = {};
  try {
    const fiRegistryPath = path.join(__dirname, "..", "fi_registry.json");
    const rawRegistry = fs.readFileSync(fiRegistryPath, "utf8");
    fiRegistry = JSON.parse(rawRegistry);
  } catch (err) {
    console.warn(
      "Unable to load fi_registry.json for GA funnel alignment:",
      err.message
    );
  }
  const fiRegistryLookupByKey = {};
  for (const entry of Object.values(fiRegistry)) {
    if (!entry || typeof entry !== "object") continue;
    const lookupKey = (
      entry.fi_lookup_key ||
      entry.fi_name ||
      ""
    )
      .toString()
      .toLowerCase();
    if (lookupKey && !fiRegistryLookupByKey[lookupKey]) {
      fiRegistryLookupByKey[lookupKey] = entry;
    }
  }

  // === GA4 CARDUPDATR FUNNEL INTEGRATION ===
  try {
    const gaKeyFile = path.resolve("./secrets/ga-service-account.json");
    const gaPropertyId = process.env.GA_PROPERTY_ID || "328054560";

    console.log("");
    let gaRows = Array.isArray(gaRowsFromCache) ? gaRowsFromCache : null;
    if (gaRows) {
      console.log("Using GA raw cache for GA4 CardUpdatr funnel...");
    } else {
      console.log(
        "GA raw cache unavailable; fetching GA4 CardUpdatr funnel aligned to SIS date window..."
      );
      gaRows = await fetchGAFunnelByDay({
        startDate,
        endDate,
        propertyId: gaPropertyId,
        keyFile: gaKeyFile,
      });
    }

    const gaByFI = aggregateGAFunnelByFI(gaRows, fiRegistry);

    const grouped = {
      SSO: [],
      "NON-SSO": [],
      CardSavr: [],
      UNKNOWN: [],
    };

    for (const [fiKey, gaObj] of Object.entries(gaByFI)) {
      const integration_type = (
        gaObj.integration_type ||
        fiRegistryLookupByKey[fiKey]?.integration_type ||
        "UNKNOWN"
      ).toUpperCase();

      const sisSessions = sessionsByFI[fiKey]?.totalSessions || 0;
      const sisPlacements = cardPlacementsByFI[fiKey]?.total || 0;

      const merged = {
        fi_lookup_key: fiKey,
        ga_select: gaObj.select,
        ga_user: gaObj.user,
        ga_cred: gaObj.cred,
        sis_sessions: sisSessions,
        sis_placements: sisPlacements,
      };

      if (integration_type === "SSO") {
        grouped.SSO.push(merged);
      } else if (integration_type === "NON-SSO") {
        grouped["NON-SSO"].push(merged);
      } else if (integration_type === "CARDSAVR") {
        grouped.CardSavr.push(merged);
      } else {
        grouped.UNKNOWN.push(merged);
      }
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => (b.ga_select || 0) - (a.ga_select || 0));
    }

    printGAFunnelReport(grouped);
  } catch (err) {
    console.error("GA4 integration failed:", err.message || err);
  }

  const merchantHealthSummary = {};
  for (const placement of allPlacementsCombined) {
    const merchant =
      placement.merchant_site_hostname ||
      (placement.merchant_site_id
        ? `merchant_${placement.merchant_site_id}`
        : "UNKNOWN");

    if (!merchantHealthSummary[merchant]) {
      merchantHealthSummary[merchant] = {
        total: 0,
        billable: 0,
        siteFailures: 0,
        userFlowIssues: 0,
        daily: Object.create(null),
      };
    }

    const termination = (placement.termination_type || "")
      .toString()
      .toUpperCase();
    const status = (placement.status || "").toString().toUpperCase();
    const rule =
      TERMINATION_RULES[termination] ||
      TERMINATION_RULES[status] ||
      TERMINATION_RULES.UNKNOWN;

    const bucket = merchantHealthSummary[merchant];
    bucket.total += 1;

    const placementDate = parsePlacementDate(placement);
    let dailyBucket = null;
    if (placementDate) {
      const dayKey = formatDate(placementDate);
      const daily = bucket.daily;
      if (!daily[dayKey]) {
        daily[dayKey] = {
          total: 0,
          billable: 0,
          siteFailures: 0,
          userFlowIssues: 0,
        };
      }
      dailyBucket = daily[dayKey];
      dailyBucket.total += 1;
    }

    if (rule.includeInHealth) {
      if (rule.severity === "success") {
        bucket.billable += 1;
        if (dailyBucket) dailyBucket.billable += 1;
      } else {
        bucket.siteFailures += 1;
        if (dailyBucket) dailyBucket.siteFailures += 1;
      }
    } else if (rule.includeInUx) {
      bucket.userFlowIssues += 1;
      if (dailyBucket) dailyBucket.userFlowIssues += 1;
    } else {
      bucket.siteFailures += 1;
      if (dailyBucket) dailyBucket.siteFailures += 1;
    }
  }

  const sortedMerchants = Object.entries(merchantHealthSummary)
    .map(([merchant, stats]) => {
      const total = stats.total || 0;
      const billable = stats.billable || 0;
      const siteFailures = stats.siteFailures || 0;
      const userFlowIssues = stats.userFlowIssues || 0;

      const siteDenom = billable + siteFailures;
      const healthPct =
        siteDenom > 0
          ? Number(((billable / siteDenom) * 100).toFixed(1))
          : null;

      const userFrictionPct =
        total > 0
          ? Number(((userFlowIssues / total) * 100).toFixed(1))
          : 0;

      let uxEmoji = "🟢";
      if (userFrictionPct >= 50) uxEmoji = "🔴";
      else if (userFrictionPct >= 25) uxEmoji = "🟡";

      return [
        merchant,
        {
          total,
          billable,
          billablePct: total > 0 ? ((billable / total) * 100).toFixed(1) : "0.0",
          siteFailures,
          userFlowIssues,
          healthPct,
          siteOkPct: healthPct,
          userFrictionPct,
          uxEmoji,
          daily: stats.daily || Object.create(null),
        },
      ];
    })
    .sort((a, b) => b[1].total - a[1].total);

  console.log(
    `\nMerchant placement health (combined): ${startDate} → ${endDate}`
  );
  const lowVolumeMerchants = [];
  for (const [merchant, info] of sortedMerchants) {
    if (info.total < MIN_ATTEMPTS) {
      lowVolumeMerchants.push({ name: merchant, total: info.total });
      continue;
    }

    const healthPct = info.healthPct;
    const uxPct = info.userFrictionPct ?? 0;
    let healthEmoji = "⚪️";
    if (healthPct !== null) {
      healthEmoji =
        healthPct >= 80 ? "🟢" : healthPct >= 50 ? "🟠" : "🔴";
    }

    const severeUx = uxPct >= 80;
    if (severeUx && healthEmoji === "🟢") {
      healthEmoji = "🔴";
    }

    const healthText =
      healthPct === null ? "   —  " : `${healthPct.toFixed(1)}%`.padStart(6);
    const healthLabel = "health ";
    const uxText =
      info.total === 0 ? "   —  " : `${uxPct.toFixed(1)}%`.padStart(6);
    const uxWarning = severeUx ? "⚠️" : " ";
    const uxEmojiDisplay = info.uxEmoji;

    const totalText = info.total.toString().padEnd(4);
    const billableText = info.billable.toString().padEnd(4);
    const billablePctText = pct(info.billable, info.total).padStart(6);

    const siteTrendArrow =
      computeTrendArrow(info.daily, (dayStats) => {
        const billableDay = Number(dayStats.billable) || 0;
        const siteFailDay = Number(dayStats.siteFailures) || 0;
        const denom = billableDay + siteFailDay;
        if (denom === 0) return null;
        return (billableDay / denom) * 100;
      }) || " ";

    const uxTrendArrow =
      computeTrendArrow(info.daily, (dayStats) => {
        const totalDay = Number(dayStats.total) || 0;
        if (totalDay === 0) return null;
        const uxIssuesDay = Number(dayStats.userFlowIssues) || 0;
        return (uxIssuesDay / totalDay) * 100;
      }) || " ";

    console.log(
      `${healthEmoji} ${siteTrendArrow} ${formatMerchantName(
        merchant
      )} | total ${totalText} | billable ${billableText} (${billablePctText}) | ${healthLabel}${healthText} | UX ${uxWarning} ${uxEmojiDisplay} ${uxTrendArrow} ${uxText}`
    );
  }

  if (lowVolumeMerchants.length > 0) {
    console.log(
      `\n(${lowVolumeMerchants.length} low-volume merchants omitted: < ${MIN_ATTEMPTS} attempts each)`
    );
  }

  console.log("\nLegend:");
  console.log(
    "  Health emoji: 🟢 ≥80% healthy, 🟠 50–79%, 🔴 <50%, ⚪️ no signal yet"
  );
  console.log("  UX emoji: 🟢 <25% user friction, 🟡 25–49%, 🔴 ≥50%");
  console.log(
    "  Trend arrows (site & UX): ↑/↓ latest day ≥10pp from prior 6-day avg, ↗/↘ between 2–10pp, → within ±2pp"
  );
  console.log(
    "    Needs ≥7 days of signals; blank arrow means insufficient data. Site arrow up = reliability improved; UX up = friction worsened."
  );
  console.log(
    "    UX ⚠️ marker means friction ≥80% and forced the overall health column to red."
  );
  console.log("    (Health = % of merchant sessions without system/network errors)");
  console.log("\n");

}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((err) => {
    console.error("Request failed:");
    console.error(err);
  });
}
