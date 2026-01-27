import { google } from "googleapis";

const PROD_GA_PROPERTY = "328054560";
const PROD_GA_KEYFILE = "./secrets/ga-service-account.json";

async function getAnalyticsClient({ keyFile }) {
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return google.analyticsdata({ version: "v1beta", auth });
}

async function searchForAlkamitech() {
  console.log("\n=== Searching for developer.dev.alkamitech.com ===\n");

  const analyticsData = await getAnalyticsClient({
    keyFile: PROD_GA_KEYFILE,
  });

  const today = new Date().toISOString().split("T")[0];

  console.log("Checking PRODUCTION property (328054560) for today...");

  const response = await analyticsData.properties.runReport({
    property: `properties/${PROD_GA_PROPERTY}`,
    requestBody: {
      dateRanges: [{ startDate: today, endDate: today }],
      dimensions: [
        { name: "hostName" },
        { name: "pagePath" },
      ],
      metrics: [{ name: "screenPageViews" }],
      dimensionFilter: {
        filter: {
          fieldName: "hostName",
          stringFilter: {
            matchType: "CONTAINS",
            value: "alkamitech",
          },
        },
      },
      limit: 100,
    },
  });

  const rows = response.data.rows || [];

  console.log(`\nFound ${rows.length} rows with "alkamitech" in hostname:\n`);

  rows.forEach((row) => {
    const host = row.dimensionValues[0].value;
    const page = row.dimensionValues[1].value;
    const views = row.metricValues[0].value;
    console.log(`  ${host}${page} - ${views} views`);
  });

  if (rows.length === 0) {
    console.log("  (No data found - may need to check different dates or test property)");
  }
}

searchForAlkamitech().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
