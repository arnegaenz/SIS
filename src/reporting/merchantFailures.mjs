// src/reporting/merchantFailures.mjs
// Provides reporting for merchant-level card placement failures.

function getMerchantKey(result) {
  return (
    result?.merchant_site_hostname ||
    (result?.merchant_site_id ? `merchant_${result.merchant_site_id}` : "UNKNOWN")
  );
}

function getFiKey(result) {
  return (
    result?.fi_lookup_key ||
    result?.fi_name ||
    result?.financial_institution_lookup_key ||
    "UNKNOWN"
  )
    .toString()
    .toLowerCase();
}

function createBucket() {
  return {
    total: 0,
    success: 0,
    failed: 0,
    byStatus: {},
    byTermination: {},
  };
}

function bumpBucket(bucket, status, termination, isSuccess) {
  bucket.total += 1;
  if (isSuccess) {
    bucket.success += 1;
  } else {
    bucket.failed += 1;
  }

  bucket.byStatus[status] = (bucket.byStatus[status] || 0) + 1;
  if (termination) {
    bucket.byTermination[termination] =
      (bucket.byTermination[termination] || 0) + 1;
  }
}

function formatBreakdown(map) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");
}

export function summarizeMerchantFailures(
  allPlacementsCombined = [],
  ssoSet = new Set()
) {
  const merchantSummary = {};

  for (const placement of allPlacementsCombined) {
    if (!placement || typeof placement !== "object") continue;

    const merchant = getMerchantKey(placement);
    const status = (placement.status || "UNKNOWN").toString().toUpperCase();
    const termination = (placement.termination_type || "")
      .toString()
      .toUpperCase();
    const isSuccess =
      status === "SUCCESSFUL" || termination === "BILLABLE";
    const fiKey = getFiKey(placement);
    const bucketKey = ssoSet.has(fiKey) ? "sso" : "nonSso";

    if (!merchantSummary[merchant]) {
      merchantSummary[merchant] = {
        overall: createBucket(),
        sso: createBucket(),
        nonSso: createBucket(),
      };
    }

    const merchantBuckets = merchantSummary[merchant];
    bumpBucket(merchantBuckets.overall, status, termination, isSuccess);
    bumpBucket(merchantBuckets[bucketKey], status, termination, isSuccess);
  }

  const merchantsSorted = Object.entries(merchantSummary).sort(
    (a, b) => b[1].overall.total - a[1].overall.total
  );

  console.log("\nTop merchant card placement outcomes (top 20):");
  for (const [merchant, buckets] of merchantsSorted.slice(0, 20)) {
    const overall = buckets.overall;
    const successPct =
      overall.total > 0
        ? ((overall.success / overall.total) * 100).toFixed(1)
        : "0.0";
    console.log(
      `- ${merchant}: total=${overall.total}, success=${overall.success}, failed=${overall.failed}, success%=${successPct}`
    );

    const overallStatus = formatBreakdown(overall.byStatus);
    const overallTermination = formatBreakdown(overall.byTermination);
    console.log(`  statuses: ${overallStatus || "none"}`);
    console.log(`  terminations: ${overallTermination || "none"}`);

    const sso = buckets.sso;
    if (sso.total > 0) {
      const ssoPct = ((sso.success / sso.total) * 100).toFixed(1);
      console.log(
        `  SSO -> total=${sso.total}, success=${sso.success}, failed=${sso.failed}, success%=${ssoPct}`
      );
      const ssoStatus = formatBreakdown(sso.byStatus);
      const ssoTermination = formatBreakdown(sso.byTermination);
      console.log(`    statuses: ${ssoStatus || "none"}`);
      console.log(`    terminations: ${ssoTermination || "none"}`);
    }

    const nonSso = buckets.nonSso;
    if (nonSso.total > 0) {
      const nonPct = ((nonSso.success / nonSso.total) * 100).toFixed(1);
      console.log(
        `  NON-SSO -> total=${nonSso.total}, success=${nonSso.success}, failed=${nonSso.failed}, success%=${nonPct}`
      );
      const nonStatus = formatBreakdown(nonSso.byStatus);
      const nonTermination = formatBreakdown(nonSso.byTermination);
      console.log(`    statuses: ${nonStatus || "none"}`);
      console.log(`    terminations: ${nonTermination || "none"}`);
    }
  }
}
