import { google } from "googleapis";

const TEST_GA_PROPERTY = "332183682";
const PROD_GA_PROPERTY = "328054560";
const TEST_GA_KEYFILE = "./secrets/ga-test.json";
const PROD_GA_KEYFILE = "./secrets/ga-service-account.json";

async function getAnalyticsClient({ keyFile }) {
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return google.analyticsdata({ version: "v1beta", auth });
}

async function searchProperty(propertyId, keyFile, label, daysBack = 7) {
  console.log(`\n=== Searching ${label} (${propertyId}) ===\n`);

  const analyticsData = await getAnalyticsClient({ keyFile });

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  console.log(`Date range: ${startDateStr} to ${endDateStr}`);
  console.log(`Searching for hostnames containing "alkamitech"...\n`);

  try {
    const response = await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
        dimensions: [
          { name: "date" },
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
        limit: 1000,
      },
    });

    const rows = response.data.rows || [];

    console.log(`Found ${rows.length} rows with "alkamitech" in hostname\n`);

    if (rows.length > 0) {
      console.log("Results:");
      rows.forEach((row) => {
        const date = row.dimensionValues[0].value;
        const host = row.dimensionValues[1].value;
        const page = row.dimensionValues[2].value;
        const views = row.metricValues[0].value;
        console.log(`  ${date}: ${host}${page} - ${views} views`);
      });
    } else {
      console.log("(No data found)");
    }

    console.log("");
  } catch (error) {
    console.error(`Error: ${error.message}\n`);
  }
}

async function main() {
  console.log("\n=== Wide Date Range Search for developer.dev.alkamitech.com ===");
  console.log("Searching past 7 days in both properties...");

  await searchProperty(TEST_GA_PROPERTY, TEST_GA_KEYFILE, "TEST Property", 7);
  await searchProperty(PROD_GA_PROPERTY, PROD_GA_KEYFILE, "PRODUCTION Property", 7);

  console.log("\n=== Summary ===");
  console.log("Looking for: developer.dev.alkamitech.com/StrivveCardUpdatr");
  console.log("Expected in: ACME Bank - GA4 data stream (Stream ID: 3816778826, Measurement ID: G-SG78E3WFCT)");
  console.log("\nIf no results found:");
  console.log("  1. Data may still be processing (GA4 can have 24-48 hour delay)");
  console.log("  2. ACME Bank stream may be in a different/third GA property not configured in .env");
  console.log("  3. Data stream configuration may have changed\n");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
