// src/reporting/merchantHealth.mjs

function getHealthIndicator(successPct) {
  if (successPct < 50) return "🔴 RED";
  if (successPct < 70) return "🟡 YELLOW";
  return "🟢 GREEN";
}

export function printMerchantHealth(merchantSummary = {}) {
  console.log("\nMerchant health overview:");

  const rows = Object.entries(merchantSummary)
    .map(([merchant, stats]) => {
      const total = stats.total || 0;
      const success = stats.success || 0;
      const failed = stats.failed || 0;
      const successPct = total > 0 ? (success / total) * 100 : 0;
      const indicator = getHealthIndicator(successPct);
      return {
        merchant,
        total,
        success,
        failed,
        successPct,
        indicator,
      };
    })
    .sort((a, b) => b.total - a.total);

  let redCount = 0;
  let yellowCount = 0;
  let greenCount = 0;

  for (const row of rows) {
    if (row.indicator.includes("RED")) redCount += 1;
    else if (row.indicator.includes("YELLOW")) yellowCount += 1;
    else greenCount += 1;
  }

  console.log(
    "Merchant | total | success | failed | success% | health"
  );
  console.log(
    "---------------------------------------------------------"
  );

  for (const row of rows) {
    console.log(
      `${row.merchant} | ${row.total} | ${row.success} | ${row.failed} | ${row.successPct.toFixed(
        1
      )}% | ${row.indicator}`
    );
  }

  console.log(
    `\nOverall merchant health: ${redCount} RED, ${yellowCount} YELLOW, ${greenCount} GREEN`
  );
}
