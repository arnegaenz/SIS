// src/index.mjs
import path from "path";
import { fileURLToPath } from "url";

import { loginWithSdk } from "./api.mjs";
import { aggregateSessions } from "./aggregateSessions.mjs";
import { aggregateCardPlacements } from "./aggregateCPR.mjs";
import { summarizeMerchantFailures } from "./reporting/merchantFailures.mjs";
import { loadSsoFis, loadInstances } from "./utils/config.mjs";
import { fetchSessionsForInstance } from "./fetch/fetchSessions.mjs";
import { fetchPlacementsForInstance } from "./fetch/fetchPlacements.mjs";

// for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  console.log("Sessions by FI (combined):");
  const sortedSessions = Object.entries(sessionSummary).sort(
    (a, b) => b[1].totalSessions - a[1].totalSessions
  );
  for (const [fi, rec] of sortedSessions) {
    const jobPct =
      rec.totalSessions > 0
        ? ((rec.withJobs / rec.totalSessions) * 100).toFixed(1)
        : "0.0";
    const successPct =
      rec.withJobs > 0
        ? ((rec.successfulSessions / rec.withJobs) * 100).toFixed(1)
        : "0.0";

    console.log(
      `- ${fi}: ${rec.totalSessions} sessions | ${rec.withJobs} with jobs (${jobPct}%) | ${rec.successfulSessions} successful (${successPct}% of job sessions)`
    );
  }

  // ----- sessions by SSO / NON-SSO -----
  console.log("\nSessions by SSO grouping (combined):");
  const ssoJobPct =
    ssoSummary.total > 0
      ? ((ssoSummary.withJobs / ssoSummary.total) * 100).toFixed(1)
      : "0.0";
  const ssoSuccessPct =
    ssoSummary.withJobs > 0
      ? ((ssoSummary.successful / ssoSummary.withJobs) * 100).toFixed(1)
      : "0.0";
  console.log(
    `- SSO: ${ssoSummary.total} total | ${ssoSummary.withJobs} with jobs (${ssoJobPct}%) | ${ssoSummary.successful} successful (${ssoSuccessPct}% of job sessions)`
  );

  const nonJobPct =
    nonSsoSummary.total > 0
      ? ((nonSsoSummary.withJobs / nonSsoSummary.total) * 100).toFixed(1)
      : "0.0";
  const nonSuccessPct =
    nonSsoSummary.withJobs > 0
      ? ((nonSsoSummary.successful / nonSsoSummary.withJobs) * 100).toFixed(1)
      : "0.0";
  console.log(
    `- NON-SSO: ${nonSsoSummary.total} total | ${nonSsoSummary.withJobs} with jobs (${nonJobPct}%) | ${nonSsoSummary.successful} successful (${nonSuccessPct}% of job sessions)`
  );

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

  console.log("\nCard placement summary by FI (combined):");
  const sortedPlacements = Object.entries(placementSummary).sort(
    (a, b) => b[1].total - a[1].total
  );
  for (const [fi, info] of sortedPlacements) {
    const pct =
      info.total > 0
        ? ((info.success / info.total) * 100).toFixed(1)
        : "0.0";
    console.log(
      `- ${fi}: total=${info.total}, success=${info.success}, failed=${info.failed}, success%=${pct}`
    );
  }

  // placement SSO vs non-SSO
  console.log("\nCard placements by SSO grouping (combined):");
  const ssoPlacePct =
    ssoPlacements.total > 0
      ? ((ssoPlacements.success / ssoPlacements.total) * 100).toFixed(1)
      : "0.0";
  console.log(
    `- SSO: ${ssoPlacements.total} placements | ${ssoPlacements.success} success | ${ssoPlacements.failed} failed | success%=${ssoPlacePct}`
  );
  const nonPlacePct =
    nonSsoPlacements.total > 0
      ? ((nonSsoPlacements.success / nonSsoPlacements.total) * 100).toFixed(1)
      : "0.0";
  console.log(
    `- NON-SSO: ${nonSsoPlacements.total} placements | ${nonSsoPlacements.success} success | ${nonSsoPlacements.failed} failed | success%=${nonPlacePct}`
  );

  // merchant breakdown (still combined)
  console.log("\nCard placement summary by merchant (combined):");
  const sortedMerchants = Object.entries(merchantSummary).sort(
    (a, b) => b[1].total - a[1].total
  );
  for (const [merchant, info] of sortedMerchants) {
    const pct =
      info.total > 0
        ? ((info.success / info.total) * 100).toFixed(1)
        : "0.0";
    console.log(
      `- ${merchant}: total=${info.total}, success=${info.success}, failed=${info.failed}, success%=${pct}`
    );
  }

  summarizeMerchantFailures(allPlacementsCombined, SSO_SET);
}

main().catch((err) => {
  console.error("Request failed:");
  console.error(err);
});
