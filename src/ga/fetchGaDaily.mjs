import "dotenv/config";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

const analyticsDataClient = new BetaAnalyticsDataClient();

function toGaDate(date) {
  return date;
}

export async function fetchGaDailyByHostAndPath(startDate, endDate) {
  const propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID;
  if (!propertyId) {
    console.warn(
      "GA4: GOOGLE_ANALYTICS_PROPERTY_ID not set; skipping GA fetch."
    );
    return [];
  }

  const [response] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [
      {
        startDate: toGaDate(startDate),
        endDate: toGaDate(endDate),
      },
    ],
    dimensions: [
      { name: "date" },
      { name: "hostName" },
      { name: "pagePath" },
    ],
    metrics: [{ name: "screenPageViews" }],
    orderBys: [
      {
        metric: {
          metricName: "screenPageViews",
        },
        desc: true,
      },
    ],
    limit: 100000,
  });

  const rows = (response.rows || []).map((r) => {
    const date = r.dimensionValues?.[0]?.value ?? "";
    const host = r.dimensionValues?.[1]?.value ?? "";
    const path = r.dimensionValues?.[2]?.value ?? "";
    const pageViews = Number(r.metricValues?.[0]?.value ?? "0");
    return {
      date,
      host,
      path,
      pageViews,
    };
  });

  return rows;
}

export default {
  fetchGaDailyByHostAndPath,
};
