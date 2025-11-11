// src/index.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { loginWithSdk } from "./api.mjs";
import { loadSsoFis, loadInstances } from "./utils/config.mjs";
import { fetchSessionsForInstance } from "./fetch/fetchSessions.mjs";
import { fetchPlacementsForInstance } from "./fetch/fetchPlacements.mjs";
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

function summarizeSessionsByDay(allSessions) {
  const byKey = new Map();
  for (const session of allSessions || []) {
    const fiKey = (
      session.financial_institution_lookup_key ||
      session.fi_lookup_key ||
      session.fi_name ||
      "unknown_fi"
    )
      .toString()
      .toLowerCase();
    if (!fiKey) continue;
    const dateValue =
      session.created_on || session.created_at || session.session_created_on;
    const day = toDateOnlyString(dateValue);
    if (!day) continue;
    const key = `${fiKey}|${day}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        date: day,
        fi_lookup_key: fiKey,
        total_sessions: 0,
        sessions_with_jobs: 0,
        sessions_with_success: 0,
      });
    }
    const bucket = byKey.get(key);
    bucket.total_sessions += 1;
    const totalJobs = Number(session.total_jobs) || 0;
    const successfulJobs = Number(session.successful_jobs) || 0;
    if (totalJobs > 0) bucket.sessions_with_jobs += 1;
    if (successfulJobs > 0) bucket.sessions_with_success += 1;
  }
  return Array.from(byKey.values());
}

function summarizePlacementsByDay(allPlacements) {
  const byKey = new Map();
  for (const placement of allPlacements || []) {
    const fiKey = (
      placement.fi_lookup_key ||
      placement.fi_name ||
      placement.financial_institution_lookup_key ||
      "unknown_fi"
    )
      .toString()
      .toLowerCase();
    if (!fiKey) continue;
    const placementDate = parsePlacementDate(placement);
    if (!placementDate) continue;
    const day = formatDate(placementDate);
    const termination = (
      placement.termination_type ||
      placement.termination ||
      placement.status ||
      "UNKNOWN"
    )
      .toString()
      .toUpperCase();
    const status = (placement.status || "").toString().toUpperCase();
    const success =
      status === "SUCCESSFUL" || termination === "BILLABLE";
    const key = `${fiKey}|${day}|${termination}|${success ? "Y" : "N"}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        date: day,
        fi_lookup_key: fiKey,
        termination,
        count: 0,
        success,
      });
    }
    const bucket = byKey.get(key);
    bucket.count += 1;
  }
  return Array.from(byKey.values());
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

export async function runSisFetch() {
  const SSO_SET = loadSsoFis(__dirname);
  const instances = loadInstances(__dirname);

  const startDateUtc = new Date(Date.UTC(2023, 0, 1));
  const endDateUtc = new Date();

  const startDate = formatDate(startDateUtc);
  const endDate = formatDate(endDateUtc);

  const allSessionsCombined = [];
  const allPlacementsCombined = [];
  const seenSessionIds = new Set();
  const seenPlacementIds = new Set();

  for (const instance of instances) {
    console.log(`\n===== Fetching from instance: ${instance.name} =====`);

    const { session } = await loginWithSdk(instance);

    await fetchSessionsForInstance(
      session,
      instance.name,
      startDate,
      endDate,
      seenSessionIds,
      allSessionsCombined
    );

    await fetchPlacementsForInstance(
      session,
      instance.name,
      startDate,
      endDate,
      seenPlacementIds,
      allPlacementsCombined
    );
  }

  const sessionsByDay = summarizeSessionsByDay(allSessionsCombined);
  const placementsByDay = summarizePlacementsByDay(allPlacementsCombined);

  return {
    startDate,
    endDate,
    ssoSet: SSO_SET,
    allSessionsCombined,
    allPlacementsCombined,
    sessionsByDay,
    placementsByDay,
  };
}

async function main() {
  const {
    startDate,
    endDate,
    ssoSet,
    allSessionsCombined,
    allPlacementsCombined,
  } = await runSisFetch();

  const SSO_SET = ssoSet;

  const startDateUtc = new Date(`${startDate}T00:00:00Z`);
  const endDateUtc = new Date(`${endDate}T00:00:00Z`);

  // 4) now we have ALL SESSIONS and ALL CARD PLACEMENTS from ALL instances
  console.log(
    `\n✅ Unique sessions fetched (all instances): ${allSessionsCombined.length}`
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
    `\n✅ Card placement results fetched (all instances): ${allPlacementsCombined.length}`
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
    console.log("Fetching GA4 CardUpdatr funnel aligned to SIS date window...");
    const gaRows = await fetchGAFunnelByDay({
      startDate,
      endDate,
      propertyId: gaPropertyId,
      keyFile: gaKeyFile,
    });

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
