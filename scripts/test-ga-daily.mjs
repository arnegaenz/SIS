import "dotenv/config";
import { GoogleAuth } from "google-auth-library";

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || "328054560";
const KEY_FILE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account-key.json";

async function run() {
  console.log(`Fetching GA4 daily data for property: ${PROPERTY_ID}`);

  const auth = new GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });

  const client = await auth.getClient();
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`;

  // Query last 7 days, grouped by date + host + page
  const body = {
    dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
    dimensions: [{ name: "date" }, { name: "hostName" }, { name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }],
    orderBys: [
      { dimension: { dimensionName: "date" } },
      { metric: { metricName: "screenPageViews" }, desc: true },
    ],
    limit: 10000,
  };

  const res = await client.request({ url, method: "POST", data: body });
  const rows = res.data.rows || [];
  if (!rows.length) {
    console.log("No GA rows returned for that filter.");
    return;
  }

  function parseCardupdatrHost(host) {
    if (!host || !host.includes(".cardupdatr.app")) return null;
    const base = host.replace(".cardupdatr.app", "");
    const parts = base.split(".");

    // Normal case: fi.instance.cardupdatr.app
    if (parts.length === 2) {
      let [fi_lookup_key, instance_raw] = parts;
      const instance =
        instance_raw === "digitalonboarding" ? "digital-onboarding" : instance_raw;
      return { fi_lookup_key, instance };
    }

    // Single part like advancial-prod
    if (parts.length === 1) {
      const only = parts[0];
      return { fi_lookup_key: only, instance: only };
    }

    return null;
  }

  console.log("Daily GA CardUpdatr Page Views (last 7 days):");
  for (const row of rows) {
    const date = row.dimensionValues[0].value;
    const host = row.dimensionValues[1].value;
    const path = row.dimensionValues[2].value;
    const views = Number(row.metricValues[0].value || 0);

    const parsed = parseCardupdatrHost(host);
    if (!parsed) continue;

    const { fi_lookup_key, instance } = parsed;
    console.log(`${date} | ${fi_lookup_key}@${instance} | ${path} : ${views}`);
  }
}

run().catch((err) => {
  console.error("⚠️ Error:", err);
  process.exit(1);
});
