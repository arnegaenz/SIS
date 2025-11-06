// src/index.mjs
import path from "path";
import { fileURLToPath } from "url";

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
import { TERMINATION_RULES } from "./config/terminationMap.mjs";

// for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIN_ATTEMPTS = 5;

function pct(num, den) {
  if (!den) return "0.0%";
  return ((num / den) * 100).toFixed(1) + "%";
}

async function main() {
  // 1) config
  const SSO_SET = loadSsoFis(__dirname);
  const instances = loadInstances(__dirname);

  // change these to whatever you’re testing
  const startDate = "2025-10-01";
  const endDate = "2025-10-31";

  // 2) accumulators for ALL instances
  const allSessionsCombined = [];
  const allPlacementsCombined = [];

  // also dedupe across instances, just in case
  const seenSessionIds = new Set();
  const seenPlacementIds = new Set();

  // 3) loop over each instance
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

  // 4) now we have ALL SESSIONS and ALL CARD PLACEMENTS from ALL instances
  console.log(
    `\n✅ Unique sessions fetched (all instances): ${allSessionsCombined.length}`
  );

  // ----- aggregate sessions by FI -----
  const {
    sessionSummary,
    ssoSummary,
    nonSsoSummary,
  } = aggregateSessions(allSessionsCombined, SSO_SET);

  printSessionSummary(sessionSummary, ssoSummary, nonSsoSummary);

  // ------------- CARD PLACEMENT SUMMARIES -------------
  console.log(
    `\n✅ Card placement results fetched (all instances): ${allPlacementsCombined.length}`
  );

  const {
    placementSummary,
    ssoPlacements,
    nonSsoPlacements,
    merchantSummary,
  } = aggregateCardPlacements(allPlacementsCombined, SSO_SET);

  printPlacementSummary(
    placementSummary,
    ssoPlacements,
    nonSsoPlacements,
    merchantSummary
  );

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

    if (rule.includeInHealth) {
      if (rule.severity === "success") {
        bucket.billable += 1;
      } else {
        bucket.siteFailures += 1;
      }
    } else if (rule.includeInUx) {
      bucket.userFlowIssues += 1;
    } else {
      bucket.siteFailures += 1;
    }
  }

  const sortedMerchants = Object.entries(merchantHealthSummary)
    .map(([merchant, stats]) => {
      const total = stats.total || 0;
      const billable = stats.billable || 0;
      const siteFailures = stats.siteFailures || 0;
      const userFlowIssues = stats.userFlowIssues || 0;

      const siteDenom = billable + siteFailures;
      const siteOkPct =
        siteDenom > 0
          ? Number(((billable / siteDenom) * 100).toFixed(1))
          : 0;

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
          siteOkPct,
          userFrictionPct,
          uxEmoji,
        },
      ];
    })
    .sort((a, b) => b[1].total - a[1].total);

  console.log("\nMerchant placement health (combined):");
  const lowVolumeMerchants = [];
  for (const [merchant, info] of sortedMerchants) {
    if (info.total < MIN_ATTEMPTS) {
      lowVolumeMerchants.push({ name: merchant, total: info.total });
      continue;
    }

    const siteOkPct = info.siteOkPct ?? 0;
    const uxPct = info.userFrictionPct ?? 0;
    const healthEmoji =
      siteOkPct >= 90
        ? "🟢"
        : siteOkPct >= 60
        ? "🟡"
        : siteOkPct >= 30
        ? "🟠"
        : "🔴";

    console.log(
      `${healthEmoji} ${merchant.padEnd(20)} | total ${info.total
        .toString()
        .padEnd(3)} | billable ${info.billable} (${pct(
        info.billable,
        info.total
      )}) | site OK ${
        info.siteOkPct === 0 && info.siteFailures === 0 && info.billable === 0
          ? "—"
          : `${siteOkPct}%`
      } | UX ${info.uxEmoji} ${uxPct}%`
    );
  }

  if (lowVolumeMerchants.length > 0) {
    console.log(
      `\n(${lowVolumeMerchants.length} low-volume merchants omitted: < ${MIN_ATTEMPTS} attempts each)`
    );
  }

}

main().catch((err) => {
  console.error("Request failed:");
  console.error(err);
});
