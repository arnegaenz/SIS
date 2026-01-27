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

async function testDataFreshness() {
  console.log("\n=== Testing GA Data Freshness ===\n");

  const analyticsData = await getAnalyticsClient({
    keyFile: TEST_GA_KEYFILE,
  });

  const now = new Date();

  // Test multiple time ranges
  const timeRanges = [
    { label: "Today", startDate: 0, endDate: 0 },
    { label: "1 hour ago to now", startDate: 0, endDate: 0 }, // Same as today
    { label: "Yesterday", startDate: 1, endDate: 1 },
    { label: "2 days ago", startDate: 2, endDate: 2 },
    { label: "3 days ago", startDate: 3, endDate: 3 },
  ];

  for (const range of timeRanges) {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - range.startDate);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - range.endDate);

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    try {
      const response = await analyticsData.properties.runReport({
        property: `properties/${TEST_GA_PROPERTY}`,
        requestBody: {
          dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
          dimensions: [{ name: "date" }],
          metrics: [{ name: "screenPageViews" }],
          limit: 1,
        },
      });

      const rowCount = response.data.rows?.length || 0;
      const totalViews = rowCount > 0
        ? Number(response.data.rows[0].metricValues[0].value)
        : 0;

      console.log(`${range.label} (${startDateStr}): ${rowCount > 0 ? '✅ HAS DATA' : '❌ NO DATA'} - ${totalViews} views`);
    } catch (error) {
      console.log(`${range.label} (${startDateStr}): ❌ ERROR - ${error.message}`);
    }
  }

  console.log("\n=== Conclusion ===");
  console.log("If 'Today' shows data, the delay is less than documented!");
  console.log("The freshest date with data shows the actual processing lag.\n");
}

testDataFreshness().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
