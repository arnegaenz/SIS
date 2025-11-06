// src/api.mjs
import "dotenv/config";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// this was working on your machine earlier
const { CardsavrSession } = require(
  "@strivve/strivve-sdk/lib/cardsavr/CardsavrJSLibrary-2.0"
);

// -------------------------
// LOGIN
// -------------------------
export async function loginWithSdk(overrides = {}) {
  const CARDSAVR_INSTANCE =
    overrides.CARDSAVR_INSTANCE || process.env.CARDSAVR_INSTANCE;
  const API_KEY = overrides.API_KEY || process.env.API_KEY;
  const APP_NAME = overrides.APP_NAME || process.env.APP_NAME;
  const USERNAME = overrides.USERNAME || process.env.USERNAME;
  const PASSWORD = overrides.PASSWORD || process.env.PASSWORD;

  if (!CARDSAVR_INSTANCE || !API_KEY || !APP_NAME || !USERNAME || !PASSWORD) {
    throw new Error(
      "Missing Cardsavr config. Check .env or instances.json entry."
    );
  }

  console.log(
    `Logging in with Strivve SDK to ${CARDSAVR_INSTANCE} as ${USERNAME} (app: ${APP_NAME})...`
  );

  const session = new CardsavrSession(CARDSAVR_INSTANCE, API_KEY, APP_NAME);
  await session.init(USERNAME, PASSWORD);
  console.log("✅ SDK login succeeded.");

  return { session };
}

/**
 * Normalize whatever the SDK gives us into:
 *   { rows: [...], raw: <original> }
 */
function normalizeSessionResponse(resp) {
  let rows = [];

  if (Array.isArray(resp)) {
    rows = resp;
  } else if (resp && Array.isArray(resp.body)) {
    rows = resp.body;
  } else if (resp && Array.isArray(resp.cardholder_sessions)) {
    rows = resp.cardholder_sessions;
  } else {
    rows = [];
  }

  return { rows, raw: resp };
}

// -------------------------
// GET SESSIONS (one page)
// -------------------------
export async function getSessionsPage(
  session,
  startDate,
  endDate,
  pagingHeaderJson
) {
  const queryObj = {
    created_on_min: `${startDate}T00:00:00Z`,
    created_on_max: `${endDate}T23:59:59Z`,
  };

  const headers = {};
  if (pagingHeaderJson) {
    headers["x-cardsavr-paging"] = pagingHeaderJson;
  }

  // TRY 1: the “normal” way that worked earlier
  try {
    const resp = await session.get("cardholder_sessions", queryObj, headers);
    const { rows } = normalizeSessionResponse(resp);
    // if we actually got rows or we have a paging header, return it
    if (rows.length > 0 || pagingHeaderJson) {
      return resp;
    }
    // otherwise fall through to try #2
    console.log(
      "Sessions TRY 1 returned no rows; will try path-with-query form..."
    );
  } catch (err) {
    console.log("Sessions TRY 1 errored, will try path-with-query form...");
  }

  // TRY 2: some servers like the query in the path
  const queryStr = `created_on_min=${encodeURIComponent(
    queryObj.created_on_min
  )}&created_on_max=${encodeURIComponent(queryObj.created_on_max)}`;
  const pathWithQuery = `cardholder_sessions?${queryStr}`;

  const resp2 = await session.get(pathWithQuery, {}, headers);
  return resp2;
}

// -------------------------
// GET CARD PLACEMENT (one page)
// -------------------------
export async function getCardPlacementPage(
  session,
  startDate,
  endDate,
  pagingHeader = {}
) {
  const queryObj = {
    created_on_min: `${startDate}T00:00:00Z`,
    created_on_max: `${endDate}T23:59:59Z`,
  };

  // this one we know exists on your session
  const safePagingHeader =
    pagingHeader && typeof pagingHeader === "object" ? pagingHeader : {};

  const resp = await session.getCardPlacementResults(
    queryObj,
    safePagingHeader
  );
  return resp;
}
