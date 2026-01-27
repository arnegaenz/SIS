import { google } from "googleapis";
import { writeFileSync } from "fs";

// Configuration
const TEST_GA_PROPERTY = "332183682";
const TEST_GA_KEYFILE = "./secrets/ga-test.json";
const OUTPUT_FILE = "./ga-test-review-output-raw.json";

// Get today's and yesterday's dates in YYYY-MM-DD format
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);

const todayDate = today.toISOString().split("T")[0];
const yesterdayDate = yesterday.toISOString().split("T")[0];

async function getAnalyticsClient({ keyFile }) {
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return google.analyticsdata({ version: "v1beta", auth });
}

async function fetchDataForDate(analyticsData, date) {
  const response = await analyticsData.properties.runReport({
    property: `properties/${TEST_GA_PROPERTY}`,
    requestBody: {
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [
        { name: "date" },
        { name: "hostName" },
        { name: "pagePath" },
        { name: "hour" },
      ],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      limit: 10000,
    },
  });

  return response.data;
}

function processAllRows(rawData, date) {
  const rows = rawData.rows || [];

  // NO FILTERING - return everything
  return rows.map((row) => {
    return {
      date,
      host: row.dimensionValues?.[1]?.value || "",
      page: row.dimensionValues?.[2]?.value || "",
      hour: row.dimensionValues?.[3]?.value || "",
      views: Number(row.metricValues?.[0]?.value || "0"),
      active_users: Number(row.metricValues?.[1]?.value || "0"),
    };
  });
}

function calculateSummary(processedRows) {
  const uniqueHosts = new Set(processedRows.map((r) => r.host));
  const uniquePages = new Set(processedRows.map((r) => r.page));
  const totalViews = processedRows.reduce((sum, row) => sum + row.views, 0);
  const totalActiveUsers = processedRows.reduce(
    (sum, row) => sum + row.active_users,
    0
  );

  // Page breakdown
  const pageBreakdown = {};
  processedRows.forEach((row) => {
    if (!pageBreakdown[row.page]) {
      pageBreakdown[row.page] = { count: 0, views: 0, active_users: 0 };
    }
    pageBreakdown[row.page].count++;
    pageBreakdown[row.page].views += row.views;
    pageBreakdown[row.page].active_users += row.active_users;
  });

  // Host breakdown
  const hostBreakdown = {};
  processedRows.forEach((row) => {
    if (!hostBreakdown[row.host]) {
      hostBreakdown[row.host] = { count: 0, views: 0, active_users: 0 };
    }
    hostBreakdown[row.host].count++;
    hostBreakdown[row.host].views += row.views;
    hostBreakdown[row.host].active_users += row.active_users;
  });

  return {
    totalRows: processedRows.length,
    uniqueHosts: uniqueHosts.size,
    uniquePages: uniquePages.size,
    totalViews,
    totalActiveUsers,
    pageBreakdown,
    hostBreakdown,
  };
}

async function fetchAndReviewGAData() {
  console.log("\n=== Google Analytics RAW Data Review (NO FILTERING) ===");
  console.log(`Yesterday: ${yesterdayDate}`);
  console.log(`Today: ${todayDate}`);
  console.log(`Property ID: ${TEST_GA_PROPERTY}`);
  console.log(`Key File: ${TEST_GA_KEYFILE}`);

  // Fetch raw GA data
  const analyticsData = await getAnalyticsClient({
    keyFile: TEST_GA_KEYFILE,
  });

  // Fetch yesterday's data
  console.log("\n--- Fetching Yesterday's Data ---");
  const yesterdayRawData = await fetchDataForDate(analyticsData, yesterdayDate);
  const yesterdayProcessedRows = processAllRows(yesterdayRawData, yesterdayDate);
  const yesterdaySummary = calculateSummary(yesterdayProcessedRows);

  console.log(`\n=== YESTERDAY (${yesterdayDate}) ===`);
  console.log(`Total Rows: ${yesterdayProcessedRows.length}`);
  console.log(`Unique Hosts: ${yesterdaySummary.uniqueHosts}`);
  console.log(`Unique Pages: ${yesterdaySummary.uniquePages}`);
  console.log(`Total Views: ${yesterdaySummary.totalViews}`);
  console.log(`Total Active Users: ${yesterdaySummary.totalActiveUsers}`);

  // Fetch today's data
  console.log("\n--- Fetching Today's Data ---");
  const todayRawData = await fetchDataForDate(analyticsData, todayDate);
  const todayProcessedRows = processAllRows(todayRawData, todayDate);
  const todaySummary = calculateSummary(todayProcessedRows);

  console.log(`\n=== TODAY (${todayDate}) ===`);
  console.log(`Total Rows: ${todayProcessedRows.length}`);
  console.log(`Unique Hosts: ${todaySummary.uniqueHosts}`);
  console.log(`Unique Pages: ${todaySummary.uniquePages}`);
  console.log(`Total Views: ${todaySummary.totalViews}`);
  console.log(`Total Active Users: ${todaySummary.totalActiveUsers}`);
  if (todayProcessedRows.length === 0) {
    console.log("⚠️  Note: Today's data may not be available yet due to GA processing delay");
  }

  // Combine all rows
  const allProcessedRows = [...yesterdayProcessedRows, ...todayProcessedRows];
  const combinedSummary = calculateSummary(allProcessedRows);

  console.log(`\n=== COMBINED (Past 24 Hours) ===`);
  console.log(`Total Rows: ${allProcessedRows.length}`);
  console.log(`Unique Hosts: ${combinedSummary.uniqueHosts}`);
  console.log(`Unique Pages: ${combinedSummary.uniquePages}`);
  console.log(`Total Views: ${combinedSummary.totalViews}`);
  console.log(`Total Active Users: ${combinedSummary.totalActiveUsers}`);

  console.log("\nAll Unique Hosts:");
  Object.entries(combinedSummary.hostBreakdown)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([host, stats]) => {
      console.log(`  ${host}: ${stats.count} rows, ${stats.views} views, ${stats.active_users} users`);
    });

  console.log("\nAll Unique Pages:");
  Object.entries(combinedSummary.pageBreakdown)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([page, stats]) => {
      console.log(`  ${page}: ${stats.count} rows, ${stats.views} views, ${stats.active_users} users`);
    });

  console.log("\n");

  // Save to file
  const output = {
    dateRange: {
      yesterday: yesterdayDate,
      today: todayDate,
    },
    propertyId: TEST_GA_PROPERTY,
    keyFile: TEST_GA_KEYFILE,
    note: "This is RAW unfiltered data - no host or page filtering applied",
    yesterday: {
      rawApiResponse: yesterdayRawData,
      allRows: yesterdayProcessedRows,
      summary: yesterdaySummary,
    },
    today: {
      rawApiResponse: todayRawData,
      allRows: todayProcessedRows,
      summary: todaySummary,
    },
    combined: {
      allRows: allProcessedRows,
      summary: combinedSummary,
    },
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✓ Output saved to: ${OUTPUT_FILE}\n`);
}

// Run the script
fetchAndReviewGAData().catch((error) => {
  console.error("Error fetching GA data:", error);
  process.exit(1);
});
