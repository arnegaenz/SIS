import "dotenv/config";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

const propertyId = process.env.GA_PROPERTY_ID || "328054560";
const client = new BetaAnalyticsDataClient();

async function run() {
  console.log(`Fetching GA4 data for property: ${propertyId}`);

  try {
    const [response] = await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      dimensions: [{ name: "hostName" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      limit: 10000,
    });

    if (!response.rows || response.rows.length === 0) {
      console.log("No GA rows returned for that query.");
      return;
    }

    console.log("Top host/page combos (last 7 days):");
    for (const row of response.rows) {
      const host = row.dimensionValues?.[0]?.value || "(no host)";
      const path = row.dimensionValues?.[1]?.value || "(no path)";
      const views = row.metricValues?.[0]?.value || "0";
      console.log(`${host}${path} : ${views}`);
    }

    console.log("\nCardUpdatr-looking hosts only:");
    for (const row of response.rows) {
      const host = row.dimensionValues?.[0]?.value || "";
      if (!host.includes(".cardupdatr.")) continue;
      const path = row.dimensionValues?.[1]?.value || "(no path)";
      const views = row.metricValues?.[0]?.value || "0";
      console.log(`${host}${path} : ${views}`);
    }
  } catch (err) {
    console.error("⚠️ Error calling GA4:", err.message);
  }
}

run();
