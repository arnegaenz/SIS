import { google } from "googleapis";

const TEST_GA_PROPERTY = "332183682";
const TEST_GA_KEYFILE = "./secrets/ga-test.json";

async function getAnalyticsClient({ keyFile }) {
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return google.analyticsdata({ version: "v1beta", auth });
}

async function searchForAlkamitech() {
  console.log("\n=== Searching for developer.dev.alkamitech.com in TEST property ===\n");

  const analyticsData = await getAnalyticsClient({
    keyFile: TEST_GA_KEYFILE,
  });

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = yesterday.toISOString().split("T")[0];

  console.log(`Checking TEST property (${TEST_GA_PROPERTY}) for today and yesterday...`);
  console.log(`Yesterday: ${yesterdayDate}`);
  console.log(`Today: ${today}\n`);

  // Check both yesterday and today
  for (const date of [yesterdayDate, today]) {
    console.log(`\n--- Checking ${date} ---`);

    const response = await analyticsData.properties.runReport({
      property: `properties/${TEST_GA_PROPERTY}`,
      requestBody: {
        dateRanges: [{ startDate: date, endDate: date }],
        dimensions: [
          { name: "hostName" },
          { name: "pagePath" },
          { name: "hour" },
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

    console.log(`Found ${rows.length} rows with "alkamitech" in hostname:\n`);

    if (rows.length > 0) {
      rows.forEach((row) => {
        const host = row.dimensionValues[0].value;
        const page = row.dimensionValues[1].value;
        const hour = row.dimensionValues[2].value;
        const views = row.metricValues[0].value;
        console.log(`  Hour ${hour}: ${host}${page} - ${views} views`);
      });
    } else {
      console.log("  (No data found)");
    }
  }

  console.log("\n");
}

searchForAlkamitech().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
