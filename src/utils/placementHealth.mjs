// src/utils/placementHealth.mjs

const USER_FLOW_CODES = new Set([
  "USER_DATA_FAILURE",
  "NEVER_STARTED",
  "TIMEOUT_TFA",
  "TIMEOUT_CREDENTIALS",
  "ACCOUNT_SETUP_INCOMPLETE",
  "CANCELED",
  "ABANDONED_QUICKSTART",
  "TOO_MANY_LOGIN_FAILURES",
  "PASSWORD_RESET_REQUIRED",
  "ACCOUNT_LOCKED",
]);

const COLOR_GREEN = "\x1b[32m";
const COLOR_YELLOW = "\x1b[33m";
const COLOR_RED = "\x1b[31m";
const COLOR_RESET = "\x1b[0m";

function getColorForPct(healthyPct) {
  if (healthyPct >= 80) return { color: COLOR_GREEN, emoji: "🟢" };
  if (healthyPct >= 60) return { color: COLOR_YELLOW, emoji: "🟡" };
  return { color: COLOR_RED, emoji: "🔴" };
}

export function classifyPlacementHealth(placement = {}) {
  const termination = (placement.termination_type || "")
    .toString()
    .toUpperCase();
  const status = (placement.status || "").toString().toUpperCase();

  if (termination === "BILLABLE") {
    return "HEALTHY";
  }

  if (USER_FLOW_CODES.has(termination) || USER_FLOW_CODES.has(status)) {
    return "USER_FLOW";
  }

  return "SITE_FAILURE";
}

export function formatHealthSummary(merchantSummary = {}) {
  console.log("\nMerchant placement health (color-coded):");

  const rows = Object.entries(merchantSummary)
    .map(([merchant, stats]) => {
      const total = stats.total || 0;
      const healthy = stats.healthy || 0;
      const siteFailures = stats.siteFailures || 0;
      const userFlow = stats.userFlow || 0;
      const healthyPct = total > 0 ? (healthy / total) * 100 : 0;
      const sitePct = total > 0 ? (siteFailures / total) * 100 : 0;
      const { color, emoji } = getColorForPct(healthyPct);
      return {
        merchant,
        total,
        healthy,
        siteFailures,
        userFlow,
        healthyPct,
        sitePct,
        color,
        emoji,
      };
    })
    .sort((a, b) => b.total - a.total);

  for (const row of rows) {
    const line = `${row.emoji} ${row.merchant}: total=${row.total}, healthy=${row.healthy} (${row.healthyPct.toFixed(
      1
    )}%), site_failures=${row.siteFailures} (${row.sitePct.toFixed(
      1
    )}%), user_flow=${row.userFlow}`;
    console.log(`  ${row.color}${line}${COLOR_RESET}`);
  }
}
