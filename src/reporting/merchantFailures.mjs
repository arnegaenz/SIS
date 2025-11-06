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

  return merchantsSorted;
}
