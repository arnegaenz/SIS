/**
 * Global KPI thresholds helper (client-only).
 *
 * How to use:
 *  - Maintenance editor: `const t = loadThresholds()` and write via `saveThresholds(t)`
 *  - Funnel page: `const t = loadThresholds()` and apply status classes based on rates
 *
 * Storage:
 *  - localStorage key `sis.globalThresholds`
 *  - Values are stored as ratios (0–1), UI should convert percent ↔ ratio.
 */

export const STORAGE_KEY = "sis.globalThresholds";

export const DEFAULT_THRESHOLDS = Object.freeze({
  enableViewsPerCardholderColoring: false,
  viewsPerCardholderBadMax: 0.005,
  viewsPerCardholderWarnMax: 0.01,

  sessionsWithJobsBadMax: 0.1,
  sessionsWithJobsWarnMax: 0.3,

  sessionsWithSuccessBadMax: 0.03,
  sessionsWithSuccessWarnMax: 0.08,

  abandonGoodMax: 0.7,
  abandonWarnMax: 0.9,

  gaCoverageBadMax: 0.4,
  gaCoverageWarnMax: 0.7,
});

const NUM_KEYS = Object.freeze([
  "viewsPerCardholderBadMax",
  "viewsPerCardholderWarnMax",
  "sessionsWithJobsBadMax",
  "sessionsWithJobsWarnMax",
  "sessionsWithSuccessBadMax",
  "sessionsWithSuccessWarnMax",
  "abandonGoodMax",
  "abandonWarnMax",
  "gaCoverageBadMax",
  "gaCoverageWarnMax",
]);

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isRatio(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function pickKnownKeys(obj) {
  const out = {};
  for (const k of Object.keys(DEFAULT_THRESHOLDS)) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

function validateOrdering(t) {
  const pairs = [
    ["viewsPerCardholderBadMax", "viewsPerCardholderWarnMax"],
    ["sessionsWithJobsBadMax", "sessionsWithJobsWarnMax"],
    ["sessionsWithSuccessBadMax", "sessionsWithSuccessWarnMax"],
    ["gaCoverageBadMax", "gaCoverageWarnMax"],
  ];
  for (const [badKey, warnKey] of pairs) {
    if (t[warnKey] < t[badKey]) {
      return `${warnKey} must be >= ${badKey}`;
    }
  }
  if (t.abandonWarnMax < t.abandonGoodMax) {
    return "abandonWarnMax must be >= abandonGoodMax";
  }
  return null;
}

export function validateThresholds(candidate, opts = {}) {
  const partial = !!opts.partial;
  if (!isPlainObject(candidate)) {
    return { ok: false, message: "Thresholds must be a JSON object." };
  }

  const known = pickKnownKeys(candidate);
  const cleaned = { ...(partial ? {} : DEFAULT_THRESHOLDS) };

  if (Object.prototype.hasOwnProperty.call(known, "enableViewsPerCardholderColoring")) {
    const v = known.enableViewsPerCardholderColoring;
    if (typeof v !== "boolean") {
      return { ok: false, message: "enableViewsPerCardholderColoring must be boolean." };
    }
    cleaned.enableViewsPerCardholderColoring = v;
  } else if (!partial) {
    cleaned.enableViewsPerCardholderColoring = DEFAULT_THRESHOLDS.enableViewsPerCardholderColoring;
  }

  for (const k of NUM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(known, k)) {
      if (!partial) cleaned[k] = DEFAULT_THRESHOLDS[k];
      continue;
    }
    const n = Number(known[k]);
    if (!isRatio(n)) {
      return { ok: false, message: `${k} must be a number between 0 and 1.` };
    }
    cleaned[k] = n;
  }

  const ordering = validateOrdering(cleaned);
  if (ordering) return { ok: false, message: ordering };

  return { ok: true, cleaned };
}

export function loadThresholds() {
  let override = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) override = JSON.parse(raw);
  } catch (e) {
    try {
      console.warn("[SIS] Failed to parse global thresholds, using defaults.", e);
    } catch (_) {}
    override = null;
  }

  if (!override) return { ...DEFAULT_THRESHOLDS };

  const validated = validateThresholds(override, { partial: true });
  if (!validated.ok) {
    try {
      console.warn("[SIS] Ignoring invalid global thresholds override:", validated.message);
    } catch (_) {}
    return { ...DEFAULT_THRESHOLDS };
  }

  return { ...DEFAULT_THRESHOLDS, ...validated.cleaned };
}

export function saveThresholds(obj) {
  const validated = validateThresholds(obj, { partial: false });
  if (!validated.ok) throw new Error(validated.message || "Invalid thresholds.");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(validated.cleaned));
  return validated.cleaned;
}

export function clearThresholds() {
  localStorage.removeItem(STORAGE_KEY);
}

export function percentToRatio(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  const r = n / 100;
  if (!isRatio(r)) return null;
  return r;
}

export function ratioToPercent(ratio) {
  const n = Number(ratio);
  if (!Number.isFinite(n)) return null;
  return n * 100;
}

// Optional global access for non-module scripts.
try {
  if (typeof window !== "undefined") {
    window.SIS_GLOBAL_THRESHOLDS = window.SIS_GLOBAL_THRESHOLDS || {};
    Object.assign(window.SIS_GLOBAL_THRESHOLDS, {
      STORAGE_KEY,
      DEFAULT_THRESHOLDS,
      loadThresholds,
      saveThresholds,
      clearThresholds,
      validateThresholds,
      percentToRatio,
      ratioToPercent,
    });
  }
} catch (_) {}

