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

async function checkFreshData() {
  console.log("\n=== Checking for Fresh Data in Test Property ===\n");
  console.log("Looking for data sent since 7am PT this morning (2026-01-20)");
  console.log("Current time: ~2:35pm PT (7.5 hours later)\n");

  const analyticsData = await getAnalyticsClient({
    keyFile: TEST_GA_KEYFILE,
  });

  const today = new Date().toISOString().split("T")[0];

  console.log(`--- Standard Report (Today: ${today}) ---\n`);

  const standardResponse = await analyticsData.properties.runReport({
    property: `properties/${TEST_GA_PROPERTY}`,
    requestBody: {
      dateRanges: [{ startDate: today, endDate: today }],
      dimensions: [
        { name: "hostName" },
        { name: "pagePath" },
        { name: "hour" },
      ],
      metrics: [{ name: "screenPageViews" }],
      limit: 1000,
    },
  });

  const standardRows = standardResponse.data.rows || [];

  console.log(`Standard API - Total rows today: ${standardRows.length}`);

  if (standardRows.length > 0) {
    console.log("\nAll hostnames found:");
    const hostnames = new Set(standardRows.map((row) => row.dimensionValues[0].value));
    hostnames.forEach((host) => {
      console.log(`  - ${host}`);
    });

    console.log("\nHourly breakdown:");
    const hourCounts = {};
    standardRows.forEach((row) => {
      const hour = row.dimensionValues[2].value;
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    Object.entries(hourCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([hour, count]) => {
        const hourNum = parseInt(hour);
        const ptHour = (hourNum - 8 + 24) % 24; // Convert UTC to PT (rough approximation)
        console.log(`  Hour ${hour} (UTC) / ~${ptHour} (PT): ${count} rows`);
      });

    // Check for developer.dev.alkamitech.com
    const alkamiRows = standardRows.filter((row) =>
      row.dimensionValues[0].value.includes("alkamitech")
    );
    if (alkamiRows.length > 0) {
      console.log("\n✅ Found alkamitech data!");
      alkamiRows.forEach((row) => {
        const host = row.dimensionValues[0].value;
        const page = row.dimensionValues[1].value;
        const hour = row.dimensionValues[2].value;
        const views = row.metricValues[0].value;
        console.log(`  Hour ${hour}: ${host}${page} - ${views} views`);
      });
    } else {
      console.log("\n❌ No alkamitech data found yet in standard reports");
    }
  } else {
    console.log("❌ No data at all for today in standard reports");
  }

  console.log("\n--- Real-Time Report (Last 30 Minutes) ---\n");

  try {
    const realtimeResponse = await analyticsData.properties.runRealtimeReport({
      property: `properties/${TEST_GA_PROPERTY}`,
      requestBody: {
        dimensions: [
          { name: "unifiedScreenName" },
          { name: "minutesAgo" },
        ],
        metrics: [{ name: "screenPageViews" }],
        limit: 1000,
      },
    });

    const realtimeRows = realtimeResponse.data.rows || [];

    console.log(`Real-time API - Total rows (last 30 min): ${realtimeRows.length}`);

    if (realtimeRows.length > 0) {
      console.log("\nReal-time activity:");
      realtimeRows.slice(0, 20).forEach((row) => {
        const screen = row.dimensionValues[0].value;
        const minutesAgo = row.dimensionValues[1].value;
        const views = row.metricValues[0].value;
        console.log(`  ${minutesAgo} min ago: ${screen} - ${views} views`);
      });
    } else {
      console.log("❌ No real-time data in the last 30 minutes");
    }
  } catch (error) {
    console.log(`Real-time check failed: ${error.message}`);
  }

  console.log("\n=== Summary ===\n");
  console.log("Developer switched from ACME Bank property to Test Property at 7am PT");
  console.log("Current check: 2:35pm PT (7.5 hours later)\n");

  if (standardRows.length === 0) {
    console.log("❌ NO DATA YET - This is expected due to GA4's processing delay");
    console.log("\nGA4 Processing Timeline:");
    console.log("  - Real-time API: Shows data from last 30 minutes only");
    console.log("  - Standard API: Can have 24-48 hour processing delay");
    console.log("  - Data sent at 7am PT may not appear until tomorrow or the next day");
    console.log("\nRecommendation:");
    console.log("  - Check again tomorrow (2026-01-21) for today's data");
    console.log("  - If urgent, have developer send new test traffic and check real-time API");
  } else {
    const alkamiFound = standardRows.some((row) =>
      row.dimensionValues[0].value.includes("alkamitech")
    );
    if (alkamiFound) {
      console.log("✅ SUCCESS - New data has arrived and includes developer.dev.alkamitech.com");
    } else {
      console.log("⚠️  PARTIAL - Some data arrived but no alkamitech hostname yet");
      console.log("   This could mean:");
      console.log("   - Developer hasn't sent test traffic to alkamitech yet today");
      console.log("   - alkamitech data is still processing");
    }
  }

  console.log("");
}

checkFreshData().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
