import { google } from "googleapis";
import { writeFileSync } from "fs";

// Configuration
const TEST_GA_PROPERTY = "332183682";
const TEST_GA_KEYFILE = "./secrets/ga-test.json";
const OUTPUT_FILE = "./ga-test-review-output-realtime.json";

async function getAnalyticsClient({ keyFile }) {
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return google.analyticsdata({ version: "v1beta", auth });
}

async function fetchRealtimeData(analyticsData) {
  console.log("\n--- Fetching Real-Time Data (Last 30 Minutes) ---");

  const response = await analyticsData.properties.runRealtimeReport({
    property: `properties/${TEST_GA_PROPERTY}`,
    requestBody: {
      dimensions: [
        { name: "unifiedScreenName" }, // Page title/path
        { name: "minutesAgo" }, // How many minutes ago
      ],
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
      ],
      limit: 10000,
    },
  });

  return response.data;
}

async function fetchStandardData(analyticsData) {
  console.log("\n--- Fetching Standard Report (Today) ---");

  const today = new Date().toISOString().split("T")[0];

  const response = await analyticsData.properties.runReport({
    property: `properties/${TEST_GA_PROPERTY}`,
    requestBody: {
      dateRanges: [{ startDate: today, endDate: today }],
      dimensions: [
        { name: "date" },
        { name: "hostName" },
        { name: "pagePath" },
        { name: "hour" },
      ],
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
      ],
      limit: 10000,
    },
  });

  return response.data;
}

function processRealtimeRows(rawData) {
  const rows = rawData.rows || [];

  return rows.map((row) => {
    return {
      screen_name: row.dimensionValues?.[0]?.value || "",
      minutes_ago: row.dimensionValues?.[1]?.value || "",
      views: Number(row.metricValues?.[0]?.value || "0"),
      active_users: Number(row.metricValues?.[1]?.value || "0"),
    };
  });
}

function processStandardRows(rawData) {
  const rows = rawData.rows || [];

  return rows.map((row) => {
    return {
      date: row.dimensionValues?.[0]?.value || "",
      host: row.dimensionValues?.[1]?.value || "",
      page: row.dimensionValues?.[2]?.value || "",
      hour: row.dimensionValues?.[3]?.value || "",
      views: Number(row.metricValues?.[0]?.value || "0"),
      active_users: Number(row.metricValues?.[1]?.value || "0"),
    };
  });
}

async function compareRealtimeVsStandard() {
  console.log("\n=== Comparing Real-Time vs Standard GA Reports ===");
  console.log(`Property ID: ${TEST_GA_PROPERTY}`);
  console.log(`Key File: ${TEST_GA_KEYFILE}`);

  const analyticsData = await getAnalyticsClient({
    keyFile: TEST_GA_KEYFILE,
  });

  // Fetch real-time data
  const realtimeRawData = await fetchRealtimeData(analyticsData);
  const realtimeRows = processRealtimeRows(realtimeRawData);

  console.log(`\n=== REAL-TIME DATA (Last 30 Minutes) ===`);
  console.log(`Total Rows: ${realtimeRows.length}`);
  console.log(`Total Views: ${realtimeRows.reduce((sum, r) => sum + r.views, 0)}`);
  console.log(`Total Active Users: ${realtimeRows.reduce((sum, r) => sum + r.active_users, 0)}`);

  if (realtimeRows.length > 0) {
    console.log("\nSample Real-Time Rows:");
    realtimeRows.slice(0, 10).forEach((row) => {
      console.log(`  ${row.minutes_ago} min ago: ${row.screen_name} - ${row.views} views, ${row.active_users} users`);
    });
  }

  // Fetch standard data
  const standardRawData = await fetchStandardData(analyticsData);
  const standardRows = processStandardRows(standardRawData);

  console.log(`\n=== STANDARD REPORT (Today) ===`);
  console.log(`Total Rows: ${standardRows.length}`);
  console.log(`Total Views: ${standardRows.reduce((sum, r) => sum + r.views, 0)}`);
  console.log(`Total Active Users: ${standardRows.reduce((sum, r) => sum + r.active_users, 0)}`);

  if (standardRows.length > 0) {
    console.log("\nSample Standard Rows:");
    standardRows.slice(0, 5).forEach((row) => {
      console.log(`  Hour ${row.hour}: ${row.host}${row.page} - ${row.views} views, ${row.active_users} users`);
    });
  }

  console.log(`\n=== COMPARISON ===`);
  console.log(`Real-time has ${realtimeRows.length} rows (last 30 min)`);
  console.log(`Standard has ${standardRows.length} rows (all of today so far)`);
  console.log(`\n⚠️  Real-time data is MUCH fresher but only covers last 30 minutes`);
  console.log(`⚠️  Standard data covers the full day but has 24-48 hour delay`);

  // Save to file
  const output = {
    fetchedAt: new Date().toISOString(),
    propertyId: TEST_GA_PROPERTY,
    realtime: {
      note: "Data from the last 30 minutes - very fresh but limited time window",
      rawApiResponse: realtimeRawData,
      allRows: realtimeRows,
      totalRows: realtimeRows.length,
      totalViews: realtimeRows.reduce((sum, r) => sum + r.views, 0),
      totalActiveUsers: realtimeRows.reduce((sum, r) => sum + r.active_users, 0),
    },
    standard: {
      note: "Data from today - covers full day but may have 24-48 hour delay",
      rawApiResponse: standardRawData,
      allRows: standardRows,
      totalRows: standardRows.length,
      totalViews: standardRows.reduce((sum, r) => sum + r.views, 0),
      totalActiveUsers: standardRows.reduce((sum, r) => sum + r.active_users, 0),
    },
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✓ Output saved to: ${OUTPUT_FILE}\n`);
}

// Run the script
compareRealtimeVsStandard().catch((error) => {
  console.error("Error fetching GA data:", error);
  process.exit(1);
});
