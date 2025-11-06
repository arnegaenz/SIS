// src/reporting/consoleReport.mjs
// Console reporting helpers for aggregated results.

export function printSessionSummary(
  sessionSummary,
  ssoSummary,
  nonSsoSummary
) {
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
}

export function printPlacementSummary(
  placementSummary,
  ssoPlacements,
  nonSsoPlacements,
  merchantSummary
) {
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
}
