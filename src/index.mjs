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

async function main() {
  // 1) config
  const SSO_SET = loadSsoFis(__dirname);
  const instances = loadInstances(__dirname);

  // rolling 30-day window ending today (UTC)
  const endDateObj = new Date();
  const endDateUtc = new Date(
    Date.UTC(
      endDateObj.getUTCFullYear(),
      endDateObj.getUTCMonth(),
      endDateObj.getUTCDate()
    )
  );
  const startDateUtc = new Date(endDateUtc);
  startDateUtc.setUTCDate(startDateUtc.getUTCDate() - 29);
  const endDateInclusiveUtc = new Date(
    endDateUtc.getTime() + 24 * 60 * 60 * 1000 - 1
  );
  const sevenDayStartUtc = new Date(endDateUtc);
  sevenDayStartUtc.setUTCDate(sevenDayStartUtc.getUTCDate() - 6);

  const startDate = formatDate(startDateUtc);
  const endDate = formatDate(endDateUtc);

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
        total7: 0,
        billable: 0,
        billable7: 0,
        siteFailures: 0,
        userFlowIssues: 0,
        siteFailures7: 0,
        userFlowIssues7: 0,
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

    const placementDate = parsePlacementDate(placement);
    if (
      placementDate &&
      placementDate >= sevenDayStartUtc &&
      placementDate <= endDateInclusiveUtc
    ) {
      bucket.total7 += 1;
      if (rule.includeInHealth) {
        if (rule.severity === "success") {
          bucket.billable7 += 1;
        } else {
          bucket.siteFailures7 += 1;
        }
      } else if (rule.includeInUx) {
        bucket.userFlowIssues7 += 1;
      } else {
        bucket.siteFailures7 += 1;
      }
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
          : null;

      const userFrictionPct =
        total > 0
          ? Number(((userFlowIssues / total) * 100).toFixed(1))
          : 0;

      const siteDenom7 = stats.billable7 + stats.siteFailures7;
      const siteOkPct7 =
        siteDenom7 > 0
          ? Number(((stats.billable7 / siteDenom7) * 100).toFixed(1))
          : null;

      let uxEmoji = "🟢";
      if (userFrictionPct >= 50) uxEmoji = "🔴";
      else if (userFrictionPct >= 25) uxEmoji = "🟡";

      return [
        merchant,
        {
          total,
          total7: stats.total7 || 0,
          billable,
          billablePct: total > 0 ? ((billable / total) * 100).toFixed(1) : "0.0",
          siteFailures,
          userFlowIssues,
          siteOkPct,
          siteOkPct7,
          userFrictionPct,
          uxEmoji,
          billable7: stats.billable7,
          siteFailures7: stats.siteFailures7,
          userFlowIssues7: stats.userFlowIssues7 || 0,
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

    const siteOkPct = info.siteOkPct;
    const uxPct = info.userFrictionPct ?? 0;
    let healthEmoji = "⚪️";
    if (siteOkPct !== null) {
      healthEmoji =
        siteOkPct >= 80 ? "🟢" : siteOkPct >= 50 ? "🟠" : "🔴";
    }

    const siteOkText =
      siteOkPct === null ? "   —  " : `${siteOkPct.toFixed(1)}%`.padStart(6);
    const uxText =
      info.total === 0 ? "   —  " : `${uxPct.toFixed(1)}%`.padStart(6);

    const totalText = info.total.toString().padEnd(4);
    const billableText = info.billable.toString().padEnd(4);
    const billablePctText = pct(info.billable, info.total).padStart(6);

    const siteDenom7 = info.billable7 + info.siteFailures7;
    const siteOkPct7 =
      siteDenom7 > 0 ? (info.billable7 / siteDenom7) * 100 : null;
    let siteTrendArrow = "→";
    if (siteOkPct7 !== null && siteOkPct !== null && siteDenom7 > 0) {
      const diff = siteOkPct7 - siteOkPct;
      if (diff >= 5) siteTrendArrow = "↑";
      else if (diff >= 2) siteTrendArrow = "↗";
      else if (diff <= -5) siteTrendArrow = "↓";
      else if (diff <= -2) siteTrendArrow = "↘";
    }

    const total7 = info.total7 ?? 0;
    const uxPct7 =
      total7 > 0
        ? Number(((info.userFlowIssues7 / total7) * 100).toFixed(1))
        : null;
    let uxTrendArrow = "→";
    if (uxPct7 !== null && total7 > 0) {
      const diff = uxPct7 - uxPct;
      if (diff >= 5) uxTrendArrow = "↑";
      else if (diff >= 2) uxTrendArrow = "↗";
      else if (diff <= -5) uxTrendArrow = "↓";
      else if (diff <= -2) uxTrendArrow = "↘";
    }

    console.log(
      `${healthEmoji} ${siteTrendArrow} ${formatMerchantName(
        merchant
      )} | total ${totalText} | billable ${billableText} (${billablePctText}) | site OK ${siteOkText} | UX ${info.uxEmoji} ${uxTrendArrow} ${uxText}`
    );
  }

  if (lowVolumeMerchants.length > 0) {
    console.log(
      `\n(${lowVolumeMerchants.length} low-volume merchants omitted: < ${MIN_ATTEMPTS} attempts each)`
    );
  }

  console.log("\nLegend:");
  console.log("  Site health emoji: 🟢 ≥80% OK, 🟠 50–79%, 🔴 <50%, ⚪️ no signal yet");
  console.log("  UX emoji: 🟢 <25% user friction, 🟡 25–49%, 🔴 ≥50%");
  console.log(
    "  Trend arrows (site & UX): ↑ ≥5pp change, ↗ +2–4pp, ↘ −2–4pp, ↓ ≤ −5pp, → stable"
  );
  console.log(
    "    (Site arrow points up when reliability improves; UX arrow up means friction got worse.)"
  );
  console.log("\n");

}

main().catch((err) => {
  console.error("Request failed:");
  console.error(err);
});
