import { google } from "googleapis";
import { writeFileSync } from "fs";

// Configuration
const TEST_GA_PROPERTY = "332183682";
const TEST_GA_KEYFILE = "./secrets/ga-test.json";
const OUTPUT_FILE = "./ga-test-review-output.json";

// Get today's and yesterday's dates in YYYY-MM-DD format
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);

const todayDate = today.toISOString().split("T")[0];
const yesterdayDate = yesterday.toISOString().split("T")[0];

// Constants from src/ga.mjs
const CARDUPDATR_SUFFIX = ".cardupdatr.app";
const CARDUPDATR_PAGES = [
  "/select-merchants",
  "/user-data-collection",
  "/credential-entry",
];

// Utility functions from src/ga.mjs
function isCardupdatrPage(pathname = "") {
  if (!pathname) return false;
  return CARDUPDATR_PAGES.some((prefix) => pathname.startsWith(prefix));
}

function resolveFiFromHost(host = "") {
  if (!host.endsWith(CARDUPDATR_SUFFIX)) return null;

  const prefix = host.slice(0, -CARDUPDATR_SUFFIX.length);
  if (!prefix) return null;

  const parts = prefix.split(".");
  if (parts.length === 1) {
    return {
      fi_key: parts[0],
      instance: parts[0],
    };
  }

  const fi_key = parts[0];
  const instance = parts[1] || parts[0];

  if (fi_key === "default" && instance === "advancial-prod") {
    return {
      fi_key: "advancial-prod",
      instance,
    };
  }

  return {
    fi_key,
    instance,
  };
}

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

function processRows(rawData, date, showFiltered = false) {
  const rows = rawData.rows || [];
  const filtered = [];

  const processed = rows
    .map((row) => {
      const host = row.dimensionValues?.[1]?.value || "";
      const page = row.dimensionValues?.[2]?.value || "";

      // Check if page matches cardupdatr pages
      if (!isCardupdatrPage(page)) {
        if (showFiltered) {
          filtered.push({ reason: "Non-cardupdatr page", host, page });
        }
        return null;
      }

      // Parse FI and instance from host
      const fi = resolveFiFromHost(host);
      if (!fi) {
        if (showFiltered) {
          filtered.push({ reason: "Invalid host", host, page });
        }
        return null;
      }

      return {
        date,
        host,
        page,
        hour: row.dimensionValues?.[3]?.value || "",
        views: Number(row.metricValues?.[0]?.value || "0"),
        active_users: Number(row.metricValues?.[1]?.value || "0"),
        fi_key: fi.fi_key.toLowerCase(),
        instance: fi.instance,
      };
    })
    .filter(Boolean);

  return { processed, filtered };
}

function calculateSummary(processedRows) {
  const uniqueHosts = new Set(processedRows.map((r) => r.host));
  const uniqueFiKeys = new Set(processedRows.map((r) => r.fi_key));
  const uniqueInstances = new Set(processedRows.map((r) => r.instance));
  const totalViews = processedRows.reduce((sum, row) => sum + row.views, 0);
  const totalActiveUsers = processedRows.reduce(
    (sum, row) => sum + row.active_users,
    0
  );

  // Funnel stage breakdown
  const funnelBreakdown = {};
  processedRows.forEach((row) => {
    if (!funnelBreakdown[row.page]) {
      funnelBreakdown[row.page] = { count: 0, views: 0 };
    }
    funnelBreakdown[row.page].count++;
    funnelBreakdown[row.page].views += row.views;
  });

  return {
    totalRows: processedRows.length,
    uniqueHosts: uniqueHosts.size,
    uniqueFiKeys: uniqueFiKeys.size,
    uniqueInstances: uniqueInstances.size,
    totalViews,
    totalActiveUsers,
    funnelBreakdown,
  };
}

async function fetchAndReviewGAData() {
  console.log("\n=== Google Analytics Test Property Review (Past 24 Hours) ===");
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
  const yesterdayResult = processRows(yesterdayRawData, yesterdayDate, true);
  const yesterdaySummary = calculateSummary(yesterdayResult.processed);

  console.log(`\n=== YESTERDAY (${yesterdayDate}) ===`);
  console.log(`Raw rows from GA: ${yesterdayRawData.rows?.length || 0}`);
  console.log(`Processed rows: ${yesterdayResult.processed.length}`);
  console.log(`Filtered out: ${yesterdayResult.filtered.length}`);
  if (yesterdayResult.filtered.length > 0) {
    console.log("\nFiltered rows:");
    yesterdayResult.filtered.forEach((f) => {
      console.log(`  - ${f.reason}: ${f.host} ${f.page}`);
    });
  }
  console.log(`Total Views: ${yesterdaySummary.totalViews}`);
  console.log(`Total Active Users: ${yesterdaySummary.totalActiveUsers}`);

  // Fetch today's data
  console.log("\n--- Fetching Today's Data ---");
  const todayRawData = await fetchDataForDate(analyticsData, todayDate);
  const todayResult = processRows(todayRawData, todayDate, true);
  const todaySummary = calculateSummary(todayResult.processed);

  console.log(`\n=== TODAY (${todayDate}) ===`);
  console.log(`Raw rows from GA: ${todayRawData.rows?.length || 0}`);
  console.log(`Processed rows: ${todayResult.processed.length}`);
  console.log(`Filtered out: ${todayResult.filtered.length}`);
  if (todayResult.filtered.length > 0) {
    console.log("\nFiltered rows:");
    todayResult.filtered.forEach((f) => {
      console.log(`  - ${f.reason}: ${f.host} ${f.page}`);
    });
  }
  console.log(`Total Views: ${todaySummary.totalViews}`);
  console.log(`Total Active Users: ${todaySummary.totalActiveUsers}`);
  if (todayResult.processed.length === 0) {
    console.log("⚠️  Note: Today's data may not be available yet due to GA processing delay");
  }

  // Combine all rows
  const allProcessedRows = [...yesterdayResult.processed, ...todayResult.processed];
  const combinedSummary = calculateSummary(allProcessedRows);

  console.log(`\n=== COMBINED (Past 24 Hours) ===`);
  console.log(`Total Rows: ${allProcessedRows.length}`);
  console.log(`Unique Hosts: ${combinedSummary.uniqueHosts}`);
  console.log(`Unique FI Keys: ${combinedSummary.uniqueFiKeys}`);
  console.log(`Unique Instances: ${combinedSummary.uniqueInstances}`);
  console.log(`Total Views: ${combinedSummary.totalViews}`);
  console.log(`Total Active Users: ${combinedSummary.totalActiveUsers}`);

  console.log("\nFunnel Stage Breakdown:");
  Object.entries(combinedSummary.funnelBreakdown)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([page, stats]) => {
      console.log(`  ${page}: ${stats.count} rows, ${stats.views} views`);
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
    yesterday: {
      rawApiResponse: yesterdayRawData,
      processedRows: yesterdayResult.processed,
      filteredRows: yesterdayResult.filtered,
      summary: yesterdaySummary,
    },
    today: {
      rawApiResponse: todayRawData,
      processedRows: todayResult.processed,
      filteredRows: todayResult.filtered,
      summary: todaySummary,
    },
    combined: {
      processedRows: allProcessedRows,
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
