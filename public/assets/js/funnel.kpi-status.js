import { loadThresholds } from "./global-thresholds.js";

function warn(msg, err) {
  try {
    console.warn("[SIS] " + msg, err || "");
  } catch (_) {}
}

const STATUS_CLASSES = ["kpi-good", "kpi-warn", "kpi-bad", "kpi-neutral"];

function setStatusClass(cardEl, status) {
  if (!cardEl) return;
  for (const cls of STATUS_CLASSES) cardEl.classList.remove(cls);
  const next = status && STATUS_CLASSES.includes(status) ? status : "kpi-neutral";
  cardEl.classList.add(next);
  if (next === "kpi-neutral") {
    cardEl.removeAttribute("title");
  } else {
    cardEl.setAttribute("title", "Status thresholds configurable in Maintenance");
  }
}

function statusHigherBetter(rate, badMax, warnMax) {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "kpi-neutral";
  if (rate < badMax) return "kpi-bad";
  if (rate < warnMax) return "kpi-warn";
  return "kpi-good";
}

function statusLowerBetter(rate, goodMax, warnMax) {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "kpi-neutral";
  if (rate <= goodMax) return "kpi-good";
  if (rate <= warnMax) return "kpi-warn";
  return "kpi-bad";
}

export function applyFunnelKpiStatuses(metrics) {
  try {
    const t = loadThresholds();

    const totalSessions = Number(metrics && metrics.totalSessions) || 0;
    const sessionsWithJobs = Number(metrics && metrics.sessionsWithJobs) || 0;
    const sessionsWithSuccess = Number(metrics && metrics.sessionsWithSuccessfulJobs) || 0;
    const sessionsWithoutJobs = Number(metrics && metrics.sessionsWithoutJobs) || 0;
    const uniqueViews = Number(metrics && metrics.totalGaSelect) || 0;
    const cardholderCount = Number(metrics && metrics.cardholderCount) || 0;

    const withJobsRate = totalSessions > 0 ? sessionsWithJobs / totalSessions : NaN;
    const successRate = totalSessions > 0 ? sessionsWithSuccess / totalSessions : NaN;
    const abandonRate = totalSessions > 0 ? sessionsWithoutJobs / totalSessions : NaN;

    const viewsPerCardholderRate =
      t.enableViewsPerCardholderColoring && cardholderCount > 0
        ? uniqueViews / cardholderCount
        : NaN;

    const elTotalSessions = document.getElementById("convMetricTotalSessions");
    const elWithJobs = document.getElementById("convMetricWithJobs");
    const elSuccess = document.getElementById("convMetricSuccessfulSessions");
    const elNoJobs = document.getElementById("convMetricNoJobs");
    const elUniqueViews = document.getElementById("convMetricGaSelect");

    setStatusClass(elTotalSessions && elTotalSessions.closest(".conversion-metric"), "kpi-neutral");
    setStatusClass(
      elWithJobs && elWithJobs.closest(".conversion-metric"),
      statusHigherBetter(withJobsRate, t.sessionsWithJobsBadMax, t.sessionsWithJobsWarnMax)
    );
    setStatusClass(
      elSuccess && elSuccess.closest(".conversion-metric"),
      statusHigherBetter(
        successRate,
        t.sessionsWithSuccessBadMax,
        t.sessionsWithSuccessWarnMax
      )
    );
    setStatusClass(
      elNoJobs && elNoJobs.closest(".conversion-metric"),
      statusLowerBetter(abandonRate, t.abandonGoodMax, t.abandonWarnMax)
    );
    setStatusClass(
      elUniqueViews && elUniqueViews.closest(".conversion-metric"),
      statusHigherBetter(
        viewsPerCardholderRate,
        t.viewsPerCardholderBadMax,
        t.viewsPerCardholderWarnMax
      )
    );
  } catch (e) {
    warn("Failed to apply KPI statuses.", e);
  }
}

try {
  if (typeof window !== "undefined") {
    window.SIS_applyFunnelKpiStatuses = applyFunnelKpiStatuses;
  }
} catch (_) {}
