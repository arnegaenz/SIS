import { google } from "googleapis";

const TEST_GA_PROPERTY = "332183682";
const PROD_GA_PROPERTY = "328054560";
const TEST_GA_KEYFILE = "./secrets/ga-test.json";
const PROD_GA_KEYFILE = "./secrets/ga-service-account.json";

async function getAdminClient({ keyFile }) {
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return google.analyticsadmin({ version: "v1beta", auth });
}

async function listDataStreams(propertyId, keyFile, label) {
  console.log(`\n=== Data Streams for ${label} (${propertyId}) ===\n`);

  try {
    const analyticsAdmin = await getAdminClient({ keyFile });

    const response = await analyticsAdmin.properties.dataStreams.list({
      parent: `properties/${propertyId}`,
    });

    const streams = response.data.dataStreams || [];

    if (streams.length === 0) {
      console.log("No data streams found.\n");
      return;
    }

    console.log(`Found ${streams.length} data stream(s):\n`);

    streams.forEach((stream, index) => {
      console.log(`Stream ${index + 1}:`);
      console.log(`  Name: ${stream.displayName || stream.name}`);
      console.log(`  Stream ID: ${stream.name?.split('/').pop() || 'N/A'}`);
      console.log(`  Type: ${stream.type || 'N/A'}`);

      if (stream.webStreamData) {
        console.log(`  Measurement ID: ${stream.webStreamData.measurementId || 'N/A'}`);
        console.log(`  Default URI: ${stream.webStreamData.defaultUri || 'N/A'}`);
      }

      console.log("");
    });
  } catch (error) {
    console.error(`Error listing data streams: ${error.message}`);
    if (error.code === 403) {
      console.log("  (Permission denied - may need Admin API access)\n");
    }
  }
}

async function main() {
  console.log("\n=== Listing All Data Streams ===");

  await listDataStreams(TEST_GA_PROPERTY, TEST_GA_KEYFILE, "TEST Property");
  await listDataStreams(PROD_GA_PROPERTY, PROD_GA_KEYFILE, "PRODUCTION Property");

  console.log("Looking for:");
  console.log("  - ACME Bank - GA4");
  console.log("  - Stream ID: 3816778826");
  console.log("  - Measurement ID: G-SG78E3WFCT");
  console.log("  - Stream URL: http://acmebank.customer-dev.cardupdatr.app\n");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
