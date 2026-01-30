import { google } from "googleapis";

const GA_PROPERTY = "328054560"; // prod property
const GA_KEYFILE = "./secrets/ga-service-account.json";

async function exploreRealtimeData() {
  const auth = new google.auth.GoogleAuth({
    keyFile: GA_KEYFILE,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });

  console.log("=== GA4 Realtime API Exploration ===");
  console.log("Property ID:", GA_PROPERTY, "\n");

  // Try fetching with ALL available realtime dimensions
  const allDimensions = [
    "appVersion",
    "audienceId",
    "audienceName",
    "audienceResourceName",
    "city",
    "cityId",
    "country",
    "countryId",
    "deviceCategory",
    "eventName",
    "minutesAgo",
    "platform",
    "streamId",
    "streamName",
    "unifiedScreenName",
  ];

  for (const dim of allDimensions) {
    try {
      console.log("\n--- Testing dimension:", dim, "---");
      const response = await analyticsData.properties.runRealtimeReport({
        property: "properties/" + GA_PROPERTY,
        requestBody: {
          dimensions: [{ name: dim }],
          metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
          limit: 10,
        },
      });

      const rows = response.data.rows || [];
      console.log("Rows returned:", rows.length);
      if (rows.length > 0) {
        console.log("Sample values:");
        rows.slice(0, 5).forEach((row, i) => {
          const dimVal = row.dimensionValues?.[0]?.value;
          const users = row.metricValues?.[0]?.value;
          const views = row.metricValues?.[1]?.value;
          console.log("  " + (i+1) + ". \"" + dimVal + "\" - " + users + " users, " + views + " views");
        });
      }
    } catch (err) {
      console.log("Error:", err.message);
    }
  }

  // Also try a combined query with the most useful dimensions
  console.log("\n\n=== Combined Query (unifiedScreenName + minutesAgo + eventName) ===");
  try {
    const response = await analyticsData.properties.runRealtimeReport({
      property: "properties/" + GA_PROPERTY,
      requestBody: {
        dimensions: [
          { name: "unifiedScreenName" },
          { name: "minutesAgo" },
          { name: "eventName" },
        ],
        metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
        limit: 50,
      },
    });

    const rows = response.data.rows || [];
    console.log("Total rows:", rows.length);
    console.log("\nRaw response dimensionHeaders:", JSON.stringify(response.data.dimensionHeaders, null, 2));
    console.log("\nRaw response metricHeaders:", JSON.stringify(response.data.metricHeaders, null, 2));
    console.log("\nFirst 10 rows:");
    rows.slice(0, 10).forEach((row, i) => {
      console.log((i+1) + ". " + JSON.stringify(row));
    });
  } catch (err) {
    console.log("Error:", err.message);
  }
}

exploreRealtimeData().catch(console.error);
