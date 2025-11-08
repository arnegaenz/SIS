// src/aggregators/aggregateCardPlacements.mjs
// Aggregates card placement results by FI, SSO grouping, and merchant.

export function aggregateCardPlacements(
  allPlacements = [],
  ssoSet = new Set()
) {
  const placementSummary = {};
  const merchantSummary = {};
  const baseAggregate = () => ({ total: 0, success: 0, failed: 0 });
  const ssoPlacements = baseAggregate();
  const nonSsoPlacements = baseAggregate();
  const cardsavrPlacements = baseAggregate();

  for (const result of allPlacements) {
    if (!result || typeof result !== "object") continue;

    const fiKey = (
      result.fi_lookup_key ||
      result.fi_name ||
      result.financial_institution_lookup_key ||
      "UNKNOWN"
    )
      .toString()
      .toLowerCase();

    const status = (result.status || "UNKNOWN").toString().toUpperCase();
    const termination = (result.termination_type || "")
      .toString()
      .toUpperCase();
    const isSuccess = status === "SUCCESSFUL" || termination === "BILLABLE";

    if (!placementSummary[fiKey]) {
      placementSummary[fiKey] = {
        total: 0,
        success: 0,
        failed: 0,
        byStatus: {},
        byTermination: {},
      };
    }

    const fiBucket = placementSummary[fiKey];
    fiBucket.total += 1;
    if (isSuccess) {
      fiBucket.success += 1;
    } else {
      fiBucket.failed += 1;
    }
    fiBucket.byStatus[status] = (fiBucket.byStatus[status] || 0) + 1;
    if (termination) {
      fiBucket.byTermination[termination] =
        (fiBucket.byTermination[termination] || 0) + 1;
    }

    const merchantKey =
      result.merchant_site_hostname ||
      (result.merchant_site_id
        ? `merchant_${result.merchant_site_id}`
        : "UNKNOWN");

    if (!merchantSummary[merchantKey]) {
      merchantSummary[merchantKey] = { total: 0, success: 0, failed: 0 };
    }

    const merchantBucket = merchantSummary[merchantKey];
    merchantBucket.total += 1;
    if (isSuccess) {
      merchantBucket.success += 1;
    } else {
      merchantBucket.failed += 1;
    }
    const instanceName = (result._instance || "").toString().toLowerCase();
    const targetBucket =
      instanceName === "ondot"
        ? cardsavrPlacements
        : ssoSet.has(fiKey)
        ? ssoPlacements
        : nonSsoPlacements;
    targetBucket.total += 1;
    if (isSuccess) {
      targetBucket.success += 1;
    } else {
      targetBucket.failed += 1;
    }
  }

  return {
    placementSummary,
    ssoPlacements,
    nonSsoPlacements,
    cardsavrPlacements,
    merchantSummary,
  };
}
