// src/index.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  loginWithSdk,
  getSessionsPage,
  getCardPlacementPage,
} from "./api.mjs";
import { aggregateSessions } from "./aggregateSessions.mjs";
import { aggregateCardPlacements } from "./aggregateCPR.mjs";
import { summarizeMerchantFailures } from "./reporting/merchantFailures.mjs";

// for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- helpers to load JSON files ----------

function loadSsoFis() {
  const ssoPath = path.join(__dirname, "sso_fis.json");
  try {
    const raw = fs.readFileSync(ssoPath, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      console.log(`Loaded ${arr.length} SSO FIs from sso_fis.json`);
      return new Set(arr.map((x) => x.toLowerCase()));
    }
  } catch (e) {
    console.log("No sso_fis.json found or bad JSON — treating all as NON-SSO.");
  }
  return new Set();
}

function loadInstances() {
  const instPath = path.join(__dirname, "instances.json");
  try {
    const raw = fs.readFileSync(instPath, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) {
      console.log(`Loaded ${arr.length} instance(s) from instances.json`);
      return arr;
    }
  } catch (e) {
    // ignore, we'll fall back
  }

  // fallback to env
  console.log("No instances.json — using .env values as single instance.");
  return [
    {
      name: "default",
      CARDSAVR_INSTANCE: process.env.CARDSAVR_INSTANCE,
      USERNAME: process.env.USERNAME,
      PASSWORD: process.env.PASSWORD,
      API_KEY: process.env.API_KEY,
      APP_NAME: process.env.APP_NAME,
    },
  ];
}

function extractPlacementRows(resp) {
  if (!resp) return [];

  if (Array.isArray(resp.body)) return resp.body;
  if (Array.isArray(resp.card_placement_results)) return resp.card_placement_results;
  if (Array.isArray(resp.results)) return resp.results;

  const body = resp.body;
  if (body && typeof body === "object") {
    if (Array.isArray(body.card_placement_results)) return body.card_placement_results;
    if (Array.isArray(body.results)) return body.results;
    if (Array.isArray(body.items)) return body.items;
  }

  if (Array.isArray(resp)) return resp;
  return [];
}

async function main() {
  // 1) config
  const SSO_SET = loadSsoFis();
  const instances = loadInstances();

  // change these to whatever you’re testing
  const startDate = "2025-10-01";
  const endDate = "2025-10-31";

  // 2) accumulators for ALL instances
  const allSessionsCombined = [];
  const allPlacementsCombined = [];

  // also dedupe across instances, just in case
  const seenSessionIds = new Set();
  const seenPlacementIds = new Set();

  // 3) loop over each instance
  for (const instance of instances) {
    console.log(`\n===== Fetching from instance: ${instance.name} =====`);

    const instanceSessions = [];
    const instancePlacements = [];

    const { session } = await loginWithSdk(instance);

    // ---------- SESSIONS PAGING ----------
    console.log(`Fetching sessions from ${startDate} to ${endDate}...`);
    let sessionPagingHeaderJson = null;
    while (true) {
      const resp = await getSessionsPage(
        session,
        startDate,
        endDate,
        sessionPagingHeaderJson
      );
      const rows = Array.isArray(resp.body) ? resp.body : [];
      for (const s of rows) {
        const globalId = `${instance.name}-${
          s.id ?? s.session_id ?? `sess-${allSessionsCombined.length}`
        }`;
        if (!seenSessionIds.has(globalId)) {
          seenSessionIds.add(globalId);
          allSessionsCombined.push(s);
          instanceSessions.push(s);
        }
      }
      const rawHeader = resp.headers?.get
        ? resp.headers.get("x-cardsavr-paging")
        : resp.headers?.["x-cardsavr-paging"];
      if (!rawHeader) break;
      const paging = JSON.parse(rawHeader);
      const { page, page_length, total_results } = paging;
      if (page * page_length >= total_results) break;
      const nextPaging = { ...paging, page: page + 1 };
      sessionPagingHeaderJson = JSON.stringify(nextPaging);
    }
    console.log(
      `✅ Finished fetching sessions for ${instance.name}: ${instanceSessions.length} from this instance | ${allSessionsCombined.length} total across instances`
    );

    // ---------- CARD PLACEMENTS PAGING ----------
    console.log(
      `Fetching card placement results from ${startDate} to ${endDate}...`
    );

    const MAX_PLACEMENT_PAGES = 500; // hard ceiling so we never spin forever
    let instancePlacementCounter = 0;

    // first page
    const firstPlacementResp = await getCardPlacementPage(
      session,
      startDate,
      endDate,
      { page: 1 }
    );

    // normalize body
    const firstRows = extractPlacementRows(firstPlacementResp);
    for (const r of firstRows) {
      const baseId =
        r.id ||
        r.result_id ||
        r.place_card_on_single_site_job_id ||
        `row-${instance.name}-${instancePlacementCounter++}`;

      const dedupeKey = `${instance.name}:${baseId}`;

      if (!seenPlacementIds.has(dedupeKey)) {
        seenPlacementIds.add(dedupeKey);
        allPlacementsCombined.push({ ...r, _instance: instance.name });
      }
    }

    // look at paging header to see how many pages exist
    const rawPlacementHeader = firstPlacementResp.headers?.get
      ? firstPlacementResp.headers.get("x-cardsavr-paging")
      : firstPlacementResp.headers?.["x-cardsavr-paging"];
    if (!rawPlacementHeader) {
      // no paging header, so we’re done for this instance
      console.log(
        `✅ Finished fetching card placements for ${instance.name}: ${firstRows.length} from this instance | ${allPlacementsCombined.length} total across instances`
      );
    } else {
      const paging = JSON.parse(rawPlacementHeader);
      let pagingMeta = paging;
      const pageLength = Number(pagingMeta.page_length) || firstRows.length || 25;
      const totalResults = Number(pagingMeta.total_results) || firstRows.length;
      const totalPages =
        pageLength > 0 ? Math.ceil(totalResults / pageLength) : 1;

      let currentPage = Number(pagingMeta.page) || 1;

      while (
        currentPage < totalPages &&
        currentPage < MAX_PLACEMENT_PAGES
      ) {
        const nextPage = currentPage + 1;
        const requestPaging = {
          ...pagingMeta,
          page: nextPage,
        };

        const resp = await getCardPlacementPage(
          session,
          startDate,
          endDate,
          requestPaging
        );

        const rows = extractPlacementRows(resp);

        for (const r of rows) {
          const baseId =
            r.id ||
            r.result_id ||
            r.place_card_on_single_site_job_id ||
            `row-${instance.name}-${instancePlacementCounter++}`;

          const dedupeKey = `${instance.name}:${baseId}`;

          if (!seenPlacementIds.has(dedupeKey)) {
            seenPlacementIds.add(dedupeKey);
            allPlacementsCombined.push({ ...r, _instance: instance.name });
          }
        }

        if (nextPage % 10 === 0) {
          console.log(
            `  ...fetched card placements page ${nextPage} of ${totalPages} for ${instance.name}`
          );
        }

        const nextHeader = resp.headers?.get
          ? resp.headers.get("x-cardsavr-paging")
          : resp.headers?.["x-cardsavr-paging"];
        if (!nextHeader) {
          break;
        }
        try {
          pagingMeta = JSON.parse(nextHeader);
        } catch {
          pagingMeta.page = nextPage;
        }
        const reportedPage = Number(pagingMeta.page);
        if (!Number.isFinite(reportedPage) || reportedPage <= currentPage) {
          break;
        }
        currentPage = reportedPage;
      }

      console.log(
        `✅ Finished fetching card placements for ${instance.name}: ${totalResults} reported by server | ${allPlacementsCombined.length} total across instances`
      );
    }
  }

  // 4) now we have ALL SESSIONS and ALL CARD PLACEMENTS from ALL instances
  console.log(
    `\n✅ Unique sessions fetched (all instances): ${allSessionsCombined.length}`
  );

  // ----- aggregate sessions by FI -----
  const {
    sessionSummary,
    ssoSummary,
    nonSsoSummary,
  } = aggregateSessions(allSessionsCombined, SSO_SET);

  console.log("Sessions by FI (combined):");
  const sortedSessions = Object.entries(sessionSummary).sort(
    (a, b) => b[1].totalSessions - a[1].totalSessions
  );
  for (const [fi, rec] of sortedSessions) {
    const jobPct =
      rec.totalSessions > 0
        ? ((rec.withJobs / rec.totalSessions) * 100).toFixed(1)
        : "0.0";
    const successPct =
      rec.withJobs > 0
        ? ((rec.successfulSessions / rec.withJobs) * 100).toFixed(1)
        : "0.0";

    console.log(
      `- ${fi}: ${rec.totalSessions} sessions | ${rec.withJobs} with jobs (${jobPct}%) | ${rec.successfulSessions} successful (${successPct}% of job sessions)`
    );
  }

  // ----- sessions by SSO / NON-SSO -----
  console.log("\nSessions by SSO grouping (combined):");
  const ssoJobPct =
    ssoSummary.total > 0
      ? ((ssoSummary.withJobs / ssoSummary.total) * 100).toFixed(1)
      : "0.0";
  const ssoSuccessPct =
    ssoSummary.withJobs > 0
      ? ((ssoSummary.successful / ssoSummary.withJobs) * 100).toFixed(1)
      : "0.0";
  console.log(
    `- SSO: ${ssoSummary.total} total | ${ssoSummary.withJobs} with jobs (${ssoJobPct}%) | ${ssoSummary.successful} successful (${ssoSuccessPct}% of job sessions)`
  );

  const nonJobPct =
    nonSsoSummary.total > 0
      ? ((nonSsoSummary.withJobs / nonSsoSummary.total) * 100).toFixed(1)
      : "0.0";
  const nonSuccessPct =
    nonSsoSummary.withJobs > 0
      ? ((nonSsoSummary.successful / nonSsoSummary.withJobs) * 100).toFixed(1)
      : "0.0";
  console.log(
    `- NON-SSO: ${nonSsoSummary.total} total | ${nonSsoSummary.withJobs} with jobs (${nonJobPct}%) | ${nonSsoSummary.successful} successful (${nonSuccessPct}% of job sessions)`
  );

  // ------------- CARD PLACEMENT SUMMARIES -------------
  console.log(
    `\n✅ Card placement results fetched (all instances): ${allPlacementsCombined.length}`
  );

  const {
    placementSummary,
    ssoPlacements,
    nonSsoPlacements,
    merchantSummary,
  } = aggregateCardPlacements(allPlacementsCombined, SSO_SET);

  console.log("\nCard placement summary by FI (combined):");
  const sortedPlacements = Object.entries(placementSummary).sort(
    (a, b) => b[1].total - a[1].total
  );
  for (const [fi, info] of sortedPlacements) {
    const pct =
      info.total > 0
        ? ((info.success / info.total) * 100).toFixed(1)
        : "0.0";
    console.log(
      `- ${fi}: total=${info.total}, success=${info.success}, failed=${info.failed}, success%=${pct}`
    );
  }

  // placement SSO vs non-SSO
  console.log("\nCard placements by SSO grouping (combined):");
  const ssoPlacePct =
    ssoPlacements.total > 0
      ? ((ssoPlacements.success / ssoPlacements.total) * 100).toFixed(1)
      : "0.0";
  console.log(
    `- SSO: ${ssoPlacements.total} placements | ${ssoPlacements.success} success | ${ssoPlacements.failed} failed | success%=${ssoPlacePct}`
  );
  const nonPlacePct =
    nonSsoPlacements.total > 0
      ? ((nonSsoPlacements.success / nonSsoPlacements.total) * 100).toFixed(1)
      : "0.0";
  console.log(
    `- NON-SSO: ${nonSsoPlacements.total} placements | ${nonSsoPlacements.success} success | ${nonSsoPlacements.failed} failed | success%=${nonPlacePct}`
  );

  // merchant breakdown (still combined)
  console.log("\nCard placement summary by merchant (combined):");
  const sortedMerchants = Object.entries(merchantSummary).sort(
    (a, b) => b[1].total - a[1].total
  );
  for (const [merchant, info] of sortedMerchants) {
    const pct =
      info.total > 0
        ? ((info.success / info.total) * 100).toFixed(1)
        : "0.0";
    console.log(
      `- ${merchant}: total=${info.total}, success=${info.success}, failed=${info.failed}, success%=${pct}`
    );
  }

  summarizeMerchantFailures(allPlacementsCombined, SSO_SET);
}

main().catch((err) => {
  console.error("Request failed:");
  console.error(err);
});
