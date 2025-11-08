// src/aggregators/aggregateSessions.mjs
// Aggregates session records by FI and SSO groupings.

export function aggregateSessions(allSessions = [], ssoSet = new Set()) {
  const sessionSummary = {};
  const fiMeta = {};

  for (const session of allSessions) {
    if (!session || typeof session !== "object") continue;

    const fiKey = (
      session.financial_institution_lookup_key || "UNKNOWN"
    )
      .toString()
      .toLowerCase();

    const totalJobs = Number(session.total_jobs) || 0;
    const successfulJobs = Number(session.successful_jobs) || 0;

    if (!fiMeta[fiKey]) {
      fiMeta[fiKey] = {
        hasCardSavr: false,
      };
    }

    const instanceName = (session._instance || "")
      .toString()
      .toLowerCase();
    if (instanceName === "ondot") {
      fiMeta[fiKey].hasCardSavr = true;
    }

    if (!sessionSummary[fiKey]) {
      sessionSummary[fiKey] = {
        totalSessions: 0,
        withJobs: 0,
        successfulSessions: 0,
      };
    }

    const bucket = sessionSummary[fiKey];
    bucket.totalSessions += 1;
    if (totalJobs > 0) bucket.withJobs += 1;
    if (successfulJobs > 0) bucket.successfulSessions += 1;
  }

  const baseAggregate = () => ({ total: 0, withJobs: 0, successful: 0 });
  const ssoSummary = baseAggregate();
  const cardsavrSummary = baseAggregate();
  const nonSsoSummary = baseAggregate();

  for (const [fiKey, record] of Object.entries(sessionSummary)) {
    const meta = fiMeta[fiKey] || {};
    const target = meta.hasCardSavr
      ? cardsavrSummary
      : ssoSet.has(fiKey)
      ? ssoSummary
      : nonSsoSummary;
    target.total += record.totalSessions;
    target.withJobs += record.withJobs;
    target.successful += record.successfulSessions;
  }

  return { sessionSummary, ssoSummary, cardsavrSummary, nonSsoSummary };
}
