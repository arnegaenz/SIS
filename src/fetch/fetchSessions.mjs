// src/fetch/fetchSessions.mjs
import { getSessionsPage } from "../api.mjs";

export async function fetchSessionsForInstance(
  session,
  instanceName,
  startDate,
  endDate,
  seenSessionIds,
  allSessionsCombined
) {
  console.log(`Fetching sessions from ${startDate} to ${endDate}...`);

  const instanceSessions = [];
  let sessionPagingHeaderJson = null;

  const collectRows = (rows) => {
    for (const s of rows) {
      const baseId = s.id ?? s.session_id ?? `sess-${allSessionsCombined.length}`;
      const globalId = `${instanceName}-${baseId}`;
      if (!seenSessionIds.has(globalId)) {
        seenSessionIds.add(globalId);
        allSessionsCombined.push(s);
        instanceSessions.push(s);
      }
    }
  };

  const firstResp = await getSessionsPage(
    session,
    startDate,
    endDate,
    sessionPagingHeaderJson
  );

  const normalize = (resp) =>
    Array.isArray(resp?.body)
      ? resp.body
      : Array.isArray(resp?.cardholder_sessions)
      ? resp.cardholder_sessions
      : Array.isArray(resp)
      ? resp
      : [];

  const firstRows = normalize(firstResp);

  if (firstRows.length === 0) {
    console.log("Sessions TRY 1 returned no rows; will try path-with-query form...");
    try {
      const secondResp = await session.get(
        `/cardholder_sessions?created_on_min=${encodeURIComponent(
          `${startDate}T00:00:00Z`
        )}&created_on_max=${encodeURIComponent(`${endDate}T23:59:59Z`)}`
      );
      const secondRows = normalize(secondResp);
      if (secondRows.length === 0) {
        console.log("Sessions TRY 2 also returned no rows — treating as empty for this instance.");
        return instanceSessions;
      }
      collectRows(secondRows);
      console.log(
        `✅ Finished fetching sessions for ${instanceName}: ${instanceSessions.length} from this instance | ${allSessionsCombined.length} total across instances`
      );
      return instanceSessions;
    } catch (err) {
      console.log("Sessions TRY 2 (path-with-query) failed, likely unsupported on this instance.");
      return instanceSessions;
    }
  }

  collectRows(firstRows);

  let rawHeader = firstResp?.headers?.get
    ? firstResp.headers.get("x-cardsavr-paging")
    : firstResp?.headers?.["x-cardsavr-paging"];

  while (rawHeader) {
    const paging = JSON.parse(rawHeader);
    const { page, page_length, total_results } = paging;
    if (page * page_length >= total_results) break;

    const nextPaging = { ...paging, page: page + 1 };
    const resp = await getSessionsPage(
      session,
      startDate,
      endDate,
      JSON.stringify(nextPaging)
    );
    const rows = normalize(resp);
    collectRows(rows);
    rawHeader = resp?.headers?.get
      ? resp.headers.get("x-cardsavr-paging")
      : resp?.headers?.["x-cardsavr-paging"];
  }

  console.log(
    `✅ Finished fetching sessions for ${instanceName}: ${instanceSessions.length} from this instance | ${allSessionsCombined.length} total across instances`
  );

  return instanceSessions;
}
