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

  while (true) {
    const resp = await getSessionsPage(
      session,
      startDate,
      endDate,
      sessionPagingHeaderJson
    );

    const rows = Array.isArray(resp?.body)
      ? resp.body
      : Array.isArray(resp?.cardholder_sessions)
      ? resp.cardholder_sessions
      : Array.isArray(resp)
      ? resp
      : [];

    for (const s of rows) {
      const baseId = s.id ?? s.session_id ?? `sess-${allSessionsCombined.length}`;
      const globalId = `${instanceName}-${baseId}`;
      if (!seenSessionIds.has(globalId)) {
        seenSessionIds.add(globalId);
        allSessionsCombined.push(s);
        instanceSessions.push(s);
      }
    }

    const rawHeader = resp?.headers?.get
      ? resp.headers.get("x-cardsavr-paging")
      : resp?.headers?.["x-cardsavr-paging"];

    if (!rawHeader) break;

    const paging = JSON.parse(rawHeader);
    const { page, page_length, total_results } = paging;

    if (page * page_length >= total_results) break;

    const nextPaging = { ...paging, page: page + 1 };
    sessionPagingHeaderJson = JSON.stringify(nextPaging);
  }

  console.log(
    `✅ Finished fetching sessions for ${instanceName}: ${instanceSessions.length} from this instance | ${allSessionsCombined.length} total across instances`
  );

  return instanceSessions;
}
