import {
  formatNumber,
  formatPercent,
  formatRate,
  buildDateRange,
  downloadCsv,
  createMultiSelect,
  sortRows,
  attachSortHandlers,
  isKioskMode,
  initKioskMode,
  startAutoRefresh,
  healthColor,
  opsHealthColor,
} from "./dashboard-utils.js";

const TIME_WINDOWS = [3, 30, 90, 180];

/* ── DOM Cache ── */
const els = {
  timeWindow: document.getElementById("timeWindow"),
  fiScope: document.getElementById("fiScope"),
  exportCsv: document.getElementById("exportCsv"),
  systemHealthBanner: document.getElementById("systemHealthBanner"),
  kpiActiveFis: document.getElementById("kpiActiveFis"),
  kpiNetworkRate: document.getElementById("kpiNetworkRate"),
  kpiTotalSessions: document.getElementById("kpiTotalSessions"),
  kpiTotalPlacements: document.getElementById("kpiTotalPlacements"),
  kpiTrendSummary: document.getElementById("kpiTrendSummary"),
  tierDistribution: document.getElementById("tierDistribution"),
  scoreDistribution: document.getElementById("scoreDistribution"),
  warningsTitle: document.getElementById("warningsTitle"),
  earlyWarnings: document.getElementById("earlyWarnings"),
  fiCardGrid: document.getElementById("fiCardGrid"),
  fiTable: document.getElementById("fiTable"),
  fiTableMeta: document.getElementById("fiTableMeta"),
};

/* ── State ── */
const state = {
  windowDays: 30,
  fiScope: "all",
  partnerList: [],
  tierList: [],
  data: null,
  opsData: null,
  registry: [],
  loading: false,
  fiSortKey: "score",
  fiSortDir: "desc",
  includeTests: false,
  enrichedFis: [],
};

let currentController = null;
let weeklyTrends = new Map();
let fiRegistryMap = new Map();
let alertsExpanded = false;

/* ── Multi-selects ── */
const partnerSelect = createMultiSelect(document.getElementById("partnerSelect"), {
  placeholder: "All partners",
  onChange: (values) => {
    state.partnerList = values;
    applyFiltersAndRender();
  },
});

const tierSelect = createMultiSelect(document.getElementById("tierSelect"), {
  placeholder: "All tiers",
  onChange: (values) => {
    state.tierList = values;
    applyFiltersAndRender();
  },
});

// Populate tier filter options
tierSelect.setOptions([
  { value: "1", label: "Tier 1 - Activation" },
  { value: "1.5", label: "Tier 1.5 - Campaign>Activation" },
  { value: "2", label: "Tier 2 - Campaigns" },
  { value: "2.5", label: "Tier 2.5 - Discovery>Campaign" },
  { value: "3", label: "Tier 3 - Incidental" },
]);

/* ── Time Windows ── */
function initTimeWindows() {
  TIME_WINDOWS.forEach((days) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${days}d`;
    if (days === state.windowDays) button.classList.add("active");
    button.addEventListener("click", () => {
      state.windowDays = days;
      Array.from(els.timeWindow.children).forEach((child) =>
        child.classList.toggle("active", child === button)
      );
      fetchAll();
    });
    els.timeWindow.appendChild(button);
  });
}

function setLoading(isLoading) {
  state.loading = isLoading;
  if (els.exportCsv) els.exportCsv.disabled = isLoading || !state.data;
  if (els.fiTableMeta) els.fiTableMeta.textContent = isLoading ? "Loading..." : "";
}

/* ── FI Registry ── */
async function loadFiRegistry() {
  const sources = [
    "/fi-registry",
    "../assets/data/fi_registry.json",
    "/assets/data/fi_registry.json",
    "/fi_registry.json",
  ];
  for (const url of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const values = Array.isArray(json) ? json : Object.values(json || {});
      state.registry = values;
      const partners = new Set();
      values.forEach((entry) => {
        if (!entry) return;
        const key = (entry.fi_lookup_key || entry.fi_name || "").toString().trim();
        if (!key) return;
        if (fiRegistryMap.has(key)) return;
        fiRegistryMap.set(key, {
          integration_type: (entry.integration_type || "").toString().toUpperCase(),
          partner: entry.partner || "",
          fi_name: entry.fi_name || key,
          cardholder_total: Number(entry.cardholder_total || entry.total) || 0,
        });
        if (entry.partner) partners.add(entry.partner);
      });
      // Populate partner filter
      partnerSelect.setOptions(
        Array.from(partners)
          .sort()
          .map((p) => ({ label: p, value: p }))
      );
      return;
    } catch (err) {
      // continue
    }
  }
}

/* ── Weekly Trends (4 weekly buckets) ── */
async function fetchWeeklyTrends() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weeks = [];
  for (let w = 0; w < 4; w++) {
    const wEnd = new Date(end);
    wEnd.setUTCDate(end.getUTCDate() - w * 7);
    const wStart = new Date(wEnd);
    wStart.setUTCDate(wEnd.getUTCDate() - 6);
    weeks.push({
      date_from: wStart.toISOString().slice(0, 10),
      date_to: wEnd.toISOString().slice(0, 10),
    });
  }

  try {
    const results = await Promise.all(
      weeks.map((w) =>
        fetch("/api/metrics/funnel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date_from: w.date_from, date_to: w.date_to, includeTests: state.includeTests }),
        }).then((r) => (r.ok ? r.json() : { by_fi: [] }))
      )
    );

    const fiWeeks = new Map();
    results.forEach((result, weekIdx) => {
      const byFi = result.by_fi || [];
      byFi.forEach((row) => {
        const key = row.fi_lookup_key || row.fi_name || "";
        if (!key) return;
        if (!fiWeeks.has(key)) fiWeeks.set(key, { weeks: new Array(4).fill(null) });
        const sm = row.SM_Sessions || 0;
        const success = row.Success_Sessions || 0;
        fiWeeks.get(key).weeks[weekIdx] = {
          sm,
          success,
          rate: sm > 0 ? success / sm : 0,
        };
      });
    });

    fiWeeks.forEach((data, key) => {
      const filled = data.weeks.map((w) => w || { sm: 0, success: 0, rate: 0 });
      const recent = filled[0];
      const prior = filled[1];

      let trend = "flat";
      if (recent.sm > 0 && prior.sm > 0) {
        const delta = recent.rate - prior.rate;
        if (delta > 0.02) trend = "up";
        else if (delta < -0.02) trend = "down";
      } else if (recent.sm > 0 && prior.sm === 0) {
        trend = "up";
      } else if (recent.sm === 0 && prior.sm > 0) {
        trend = "down";
      }

      data.trend = trend;
      weeklyTrends.set(key, data);
    });
  } catch (err) {
    console.warn("[portfolio] trend fetch failed", err);
  }
}

/* ── Main Fetch ── */
async function fetchAll() {
  if (currentController) currentController.abort();
  currentController = new AbortController();
  const { date_from, date_to } = buildDateRange(state.windowDays);
  const payload = {
    date_from,
    date_to,
    fi_scope: state.fiScope,
    includeTests: state.includeTests,
  };

  setLoading(true);
  try {
    const [funnelRes, opsRes] = await Promise.all([
      fetch("/api/metrics/funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: currentController.signal,
      }),
      fetch("/api/metrics/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: currentController.signal,
      }),
    ]);

    if (!funnelRes.ok) throw new Error(funnelRes.statusText);
    if (!opsRes.ok) throw new Error(opsRes.statusText);

    const [funnelData, opsData] = await Promise.all([funnelRes.json(), opsRes.json()]);
    state.data = funnelData;
    state.opsData = opsData;

    // Also fetch weekly trends (non-blocking for display)
    await fetchWeeklyTrends();

    enrichAndRender();
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("[portfolio] fetch failed", err);
    }
    state.data = null;
    state.opsData = null;
    renderEmpty();
  } finally {
    setLoading(false);
  }
}

/* ── Engagement Score Formula ── */
function computeEngagementScore(fi, allFis) {
  const maxSessions = Math.max(...allFis.map((f) => f.SM_Sessions || 0), 1);

  // Success score: (rate / 0.27) * 100, capped at 100 — 40% weight
  const successScore = Math.min(100, (fi.successRate / 0.27) * 100);

  // Trend score — 20% weight
  let trendScore = 50;
  if (fi.trend === "up") trendScore = 100;
  else if (fi.trend === "down") trendScore = 0;

  // Reach score — 20% weight (50 if no data)
  let reachScore = 50;
  if (fi.monthlyReachPct !== null && fi.monthlyReachPct > 0) {
    reachScore = Math.min(100, (fi.monthlyReachPct / 2.5) * 100);
  }

  // Volume score — 20% weight (log scale)
  const sessions = fi.SM_Sessions || 0;
  const volumeScore = maxSessions > 1 ? (Math.log(sessions + 1) / Math.log(maxSessions + 1)) * 100 : 0;

  return Math.round(successScore * 0.4 + trendScore * 0.2 + reachScore * 0.2 + volumeScore * 0.2);
}

function scoreColor(score) {
  if (score >= 75) return "green";
  if (score >= 50) return "amber";
  if (score >= 25) return "orange";
  return "red";
}

function scoreTooltip(fi) {
  const successComponent = Math.min(100, (fi.successRate / 0.27) * 100);
  const trendComponent = fi.trend === "up" ? 100 : fi.trend === "down" ? 0 : 50;
  let reachComponent = 50;
  if (fi.monthlyReachPct !== null && fi.monthlyReachPct > 0) {
    reachComponent = Math.min(100, (fi.monthlyReachPct / 2.5) * 100);
  }
  const reachNote = fi.monthlyReachPct !== null ? `${fi.monthlyReachPct.toFixed(2)}%` : "no data (using 50)";
  return `Engagement Score: ${fi.score}/100. Breakdown: Success Rate component = ${successComponent.toFixed(0)}/100 (${formatPercent(fi.successRate)} vs 27% ceiling, 40% weight) | Trend component = ${trendComponent}/100 (${fi.trend}, 20% weight) | Reach component = ${reachComponent.toFixed(0)}/100 (monthly reach ${reachNote} vs 2.5% ceiling, 20% weight) | Volume component = log-scaled sessions (20% weight). Color: Green >=75, Amber >=50, Orange >=25, Red <25.`;
}

function healthDotTooltip(rate) {
  const pct = (rate * 100).toFixed(1);
  if (rate >= 0.15) return `Engagement Health: GREEN (${pct}% success rate). This FI is performing well — success rate is at or above 15%. The 15% threshold separates healthy engagement from areas needing attention.`;
  if (rate >= 0.05) return `Engagement Health: AMBER (${pct}% success rate). This FI's success rate is between 5-15%. There is room for improvement — consider reviewing traffic sources and whether activation flow is enabled.`;
  return `Engagement Health: RED (${pct}% success rate). This FI's success rate is below 5%. This typically indicates Tier 3 (incidental) traffic with no activation flow or campaign outreach. Immediate attention recommended.`;
}

function systemFlagTooltip(fi) {
  return `SYSTEM ALERT: ${(fi.jobFailRate * 100).toFixed(1)}% of card placement jobs are failing at merchants for this FI. ${fi.jobsFailed} failed out of ${fi.jobsTotal} total jobs. Failures can be caused by merchant site changes, credential issues, or CardSavr system errors. Check the Operations Dashboard for merchant-level breakdown. Threshold: >15% = warning flag shown.`;
}

function sparklineTooltip(fi) {
  if (!fi.trendData || !fi.trendData.weeks) return "4-week session volume sparkline. No trend data available.";
  const filled = fi.trendData.weeks.map((w) => w || { sm: 0, success: 0, rate: 0 });
  const labels = ["This week", "Last week", "2 wks ago", "3 wks ago"];
  const detail = filled.map((w, i) => `${labels[i]}: ${w.sm} sessions, ${(w.rate * 100).toFixed(1)}% success`).join(" | ");
  return `4-week session volume sparkline (left=oldest, right=most recent). Green line = volume trending up, Red = down. ${detail}`;
}

/* ── Enrich FI Data ── */
function enrichAndRender() {
  if (!state.data) return;

  const byFi = state.data.by_fi || [];
  const opsOverall = state.opsData?.overall || {};
  const opsByFi = state.opsData?.by_fi_instance || [];
  const opsByMerchant = state.opsData?.by_merchant || [];

  // Build ops lookup: aggregate by fi_lookup_key (may appear multiple times with different instances)
  const opsMap = new Map();
  opsByFi.forEach((row) => {
    const key = row.fi_lookup_key || row.fi_name || "";
    if (!key) return;
    if (!opsMap.has(key)) {
      opsMap.set(key, { jobsTotal: 0, jobsFailed: 0 });
    }
    const entry = opsMap.get(key);
    entry.jobsTotal += row.Jobs_Total || 0;
    entry.jobsFailed += row.Jobs_Failed || 0;
  });

  // Enrich each FI
  const enriched = byFi.map((row) => {
    const key = row.fi_lookup_key || row.fi_name || "";
    const sm = row.SM_Sessions || 0;
    const ce = row.CE_Sessions || 0;
    const success = row.Success_Sessions || 0;
    const successRate = sm > 0 ? success / sm : 0;

    const reg = fiRegistryMap.get(key) || {};
    const trendData = weeklyTrends.get(key);
    const trend = trendData ? trendData.trend : "flat";

    const cardholders = reg.cardholder_total || 0;
    const monthlyReachPct = cardholders > 0 ? (sm / cardholders) * 100 : null;

    const ops = opsMap.get(key) || { jobsTotal: 0, jobsFailed: 0 };
    const jobFailRate = ops.jobsTotal > 0 ? ops.jobsFailed / ops.jobsTotal : 0;

    // Classify tier using session success rate percentage
    const classifyTier = window.EngagementInsights?.classifyTier;
    const tierInfo = classifyTier ? classifyTier(successRate * 100) : { tier: 0, label: "Unknown", color: "#94a3b8", zone: "unknown" };

    return {
      ...row,
      fi_name: row.fi_name || key,
      fi_lookup_key: key,
      SM_Sessions: sm,
      CE_Sessions: ce,
      Success_Sessions: success,
      successRate,
      integration_type: reg.integration_type || "",
      partner: reg.partner || "",
      cardholder_total: cardholders,
      monthlyReachPct,
      trend,
      trendData,
      tierInfo,
      tier: tierInfo.tier,
      jobsTotal: ops.jobsTotal,
      jobsFailed: ops.jobsFailed,
      jobFailRate,
      opsOverall,
      opsByMerchant,
      score: 0, // computed below
    };
  });

  // Compute engagement scores (needs all FIs for max sessions)
  enriched.forEach((fi) => {
    fi.score = computeEngagementScore(fi, enriched);
  });

  // Compute early warnings
  enriched.forEach((fi) => {
    fi.warnings = computeWarnings(fi);
  });

  state.enrichedFis = enriched;

  applyFiltersAndRender();
}

/* ── Early Warning Logic ── */
function computeWarnings(fi) {
  const warnings = [];
  const trendData = fi.trendData;

  // Engagement decline: 2+ consecutive weeks with rate drop >2pp
  if (trendData && trendData.weeks) {
    const filled = trendData.weeks.map((w) => w || { sm: 0, success: 0, rate: 0 });
    let consecutiveDeclines = 0;
    for (let i = 0; i < filled.length - 1; i++) {
      const curr = filled[i];
      const prev = filled[i + 1];
      if (curr.sm > 0 && prev.sm > 0 && (prev.rate - curr.rate) > 0.02) {
        consecutiveDeclines++;
      } else {
        break;
      }
    }
    if (consecutiveDeclines >= 3) {
      warnings.push({ type: "danger", category: "engagement", text: `${fi.fi_name} — engagement declining for ${consecutiveDeclines}+ consecutive weeks` });
    } else if (consecutiveDeclines >= 2) {
      warnings.push({ type: "warn", category: "engagement", text: `${fi.fi_name} — engagement declining for ${consecutiveDeclines} consecutive weeks` });
    }

    // Gone dark: zero sessions this week but active last week
    if (filled[0].sm === 0 && filled[1].sm > 0) {
      warnings.push({ type: "warn", category: "engagement", text: `${fi.fi_name} — zero sessions this week (was active last week)` });
    }
  }

  // System health
  if (fi.jobFailRate > 0.30) {
    warnings.push({ type: "danger", category: "system", text: `${fi.fi_name} — ${(fi.jobFailRate * 100).toFixed(1)}% job failure rate` });
  } else if (fi.jobFailRate > 0.15) {
    warnings.push({ type: "warn", category: "system", text: `${fi.fi_name} — ${(fi.jobFailRate * 100).toFixed(1)}% job failure rate` });
  }

  return warnings;
}

/* ── Filter + Render ── */
function applyFiltersAndRender() {
  let fis = state.enrichedFis;

  // Filter by partner
  if (state.partnerList.length > 0) {
    const set = new Set(state.partnerList);
    fis = fis.filter((fi) => set.has(fi.partner));
  }

  // Filter by tier
  if (state.tierList.length > 0) {
    const set = new Set(state.tierList.map(Number));
    fis = fis.filter((fi) => set.has(fi.tier));
  }

  // Filter by scope
  if (state.fiScope === "sso_only") {
    fis = fis.filter((fi) => fi.integration_type === "SSO");
  } else if (state.fiScope === "non_sso_only") {
    fis = fis.filter((fi) => fi.integration_type && fi.integration_type !== "SSO");
  }

  if (isKioskMode()) {
    renderKioskView(fis);
  } else {
    renderAll(fis);
  }
}

/* ── Render: Regular View ── */
function renderAll(fis) {
  renderSystemHealthBanner();
  renderKpis(fis);
  renderTierDistribution(fis);
  renderScoreDistribution(fis);
  renderWarnings(fis);
  renderFiGrid(fis);
  renderFiTable(fis);
}

function renderEmpty() {
  els.kpiActiveFis.textContent = "-";
  els.kpiNetworkRate.textContent = "-";
  els.kpiTotalSessions.textContent = "-";
  els.kpiTotalPlacements.textContent = "-";
  els.kpiTrendSummary.textContent = "-";
  if (els.fiCardGrid) els.fiCardGrid.innerHTML = '<div class="empty-state">No data for this view.</div>';
  const tbody = els.fiTable?.querySelector("tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No data.</td></tr>';
}

/* ── System Health Banner ── */
function renderSystemHealthBanner() {
  const banner = els.systemHealthBanner;
  if (!banner || !state.opsData) return;

  const overall = state.opsData.overall || {};
  const total = overall.Jobs_Total || 0;
  const success = overall.Jobs_Success || 0;
  const rate = total > 0 ? success / total : 1;
  const color = opsHealthColor(rate);

  banner.className = `system-health-banner ${color}`;
  banner.style.display = "flex";

  const dot = banner.querySelector(".health-dot");
  if (dot) dot.className = `health-dot ${color}`;

  banner.title = `Network-wide job success rate: ${(rate * 100).toFixed(1)}%. This measures the percentage of individual card placement jobs that succeed across all merchants and all FIs. Green (>=85%) = network operating normally. Amber (70-85%) = some merchants experiencing elevated failures. Red (<70%) = significant system degradation — check Operations Dashboard immediately. Based on ${formatNumber(total)} total jobs in this window.`;

  const label = banner.querySelector(".system-health-banner__label");
  if (label) label.textContent = `Network Job Success: ${(rate * 100).toFixed(1)}%`;

  const detail = banner.querySelector(".system-health-banner__detail");
  if (detail) {
    if (color !== "green") {
      // Show top impacted merchants
      const merchants = (state.opsData.by_merchant || [])
        .filter((m) => (m.Jobs_Failed || 0) > 0)
        .sort((a, b) => (b.Jobs_Failed || 0) - (a.Jobs_Failed || 0))
        .slice(0, 5)
        .map((m) => m.merchant_name || m.Merchant || "Unknown");
      detail.textContent = merchants.length > 0 ? `Top impacted: ${merchants.join(", ")}` : "";
    } else {
      detail.textContent = `${formatNumber(total)} jobs processed`;
    }
  }
}

/* ── KPIs ── */
function renderKpis(fis) {
  const activeFis = fis.filter((fi) => (fi.SM_Sessions || 0) > 0).length;
  const totalSm = fis.reduce((s, fi) => s + (fi.SM_Sessions || 0), 0);
  const totalSuccess = fis.reduce((s, fi) => s + (fi.Success_Sessions || 0), 0);
  const networkRate = totalSm > 0 ? totalSuccess / totalSm : 0;
  const totalPlacements = state.data?.overall?.Jobs_Success || 0;

  // Trend summary
  let up = 0, down = 0, flat = 0;
  fis.forEach((fi) => {
    if (fi.trend === "up") up++;
    else if (fi.trend === "down") down++;
    else flat++;
  });

  els.kpiActiveFis.textContent = formatNumber(activeFis);
  els.kpiNetworkRate.textContent = formatPercent(networkRate);
  els.kpiTotalSessions.textContent = formatNumber(totalSm);
  els.kpiTotalPlacements.textContent = formatNumber(totalPlacements);
  els.kpiTrendSummary.innerHTML = `<span style="color:#22c55e">${up}</span> <span style="font-size:0.6em;color:var(--muted)">/</span> <span style="color:#ef4444">${down}</span> <span style="font-size:0.6em;color:var(--muted)">/</span> <span style="color:#64748b">${flat}</span>`;
  els.kpiTrendSummary.title = `${up} up / ${down} down / ${flat} flat`;
}

/* ── Tier Distribution ── */
function renderTierDistribution(fis) {
  const container = els.tierDistribution;
  if (!container) return;

  const buckets = [
    { key: "1", label: "Tier 1", color: "#22c55e", count: 0, desc: "Card Activation Flow (>=21% success). Peak cardholder motivation." },
    { key: "1.5", label: "Tier 1.5", color: "#84cc16", count: 0, desc: "Campaign-to-Activation transition (12-21%). Mix of prompted and motivated." },
    { key: "2", label: "Tier 2", color: "#f59e0b", count: 0, desc: "SMS & Targeted Campaigns (8-12%). Manufactured motivation via outreach." },
    { key: "2.5", label: "Tier 2.5", color: "#f97316", count: 0, desc: "Discovery-to-Campaign transition (3-8%). Some outreach, not consistent." },
    { key: "3", label: "Tier 3", color: "#ef4444", count: 0, desc: "Incidental Discovery (<3%). Browsing only, no prompt or urgency." },
  ];

  fis.forEach((fi) => {
    const bucket = buckets.find((b) => Number(b.key) === fi.tier);
    if (bucket) bucket.count++;
  });

  const total = fis.length || 1;

  // Stacked bar
  const barHtml = buckets
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `<div class="tier-dist-bar__segment" style="width:${(b.count / total) * 100}%;background:${b.color};" title="${b.label}: ${b.count} FIs (${((b.count / total) * 100).toFixed(0)}% of portfolio). ${b.desc}">${b.count > 0 ? b.count : ""}</div>`
    )
    .join("");

  // Legend
  const legendHtml = buckets
    .map(
      (b) =>
        `<span class="tier-dist-legend__item" title="${b.desc} — ${b.count} FIs in this tier."><span class="tier-dist-legend__dot" style="background:${b.color}"></span>${b.label} (${b.count})</span>`
    )
    .join("");

  container.innerHTML = `
    <div class="tier-dist-bar">${barHtml}</div>
    <div class="tier-dist-legend">${legendHtml}</div>
  `;
}

/* ── Score Distribution ── */
function renderScoreDistribution(fis) {
  const container = els.scoreDistribution;
  if (!container) return;

  const buckets = [
    { label: "0-24", color: "#ef4444", count: 0, desc: "Critical — these FIs have very low conversion, minimal volume, and/or declining trends. Likely Tier 3 incidental traffic with no activation strategy." },
    { label: "25-49", color: "#f97316", count: 0, desc: "Needs attention — below-average engagement. May have some campaign activity but not consistent, or decent volume but poor conversion." },
    { label: "50-74", color: "#f59e0b", count: 0, desc: "Moderate engagement — performing reasonably but with clear room to grow. Typically Tier 2 FIs with active campaigns or Tier 3 FIs with high volume." },
    { label: "75-100", color: "#22c55e", count: 0, desc: "Strong engagement — high conversion rate, positive trends, good reach. Typically Tier 1 or strong Tier 2 FIs with activation flow or effective campaigns." },
  ];

  fis.forEach((fi) => {
    if (fi.score >= 75) buckets[3].count++;
    else if (fi.score >= 50) buckets[2].count++;
    else if (fi.score >= 25) buckets[1].count++;
    else buckets[0].count++;
  });

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  const barsHtml = buckets
    .map(
      (b) => {
        const h = Math.max(4, (b.count / maxCount) * 70);
        return `<div class="score-dist-bar" style="height:${h}px;background:${b.color};" title="Score ${b.label}: ${b.count} FIs. ${b.desc}"><span class="score-dist-bar__count">${b.count}</span></div>`;
      }
    )
    .join("");

  const labelsHtml = buckets.map((b) => `<span title="${b.desc}">${b.label}</span>`).join("");

  container.innerHTML = `
    <div class="score-dist-bars">${barsHtml}</div>
    <div class="score-dist-labels">${labelsHtml}</div>
  `;
}

/* ── Early Warnings ── */
function renderWarnings(fis) {
  const container = els.earlyWarnings;
  const title = els.warningsTitle;
  if (!container) return;

  const allWarnings = [];
  fis.forEach((fi) => {
    (fi.warnings || []).forEach((w) => allWarnings.push(w));
  });

  if (!allWarnings.length) {
    container.innerHTML = "";
    if (title) title.style.display = "none";
    return;
  }

  if (title) title.style.display = "";

  const COLLAPSED_COUNT = 3;
  const visible = alertsExpanded ? allWarnings : allWarnings.slice(0, COLLAPSED_COUNT);
  const hasMore = allWarnings.length > COLLAPSED_COUNT;

  const warningTooltips = {
    engagement: "ENGAGEMENT warning: Detected from week-over-week session success rate trends. Decline = rate dropped >2 percentage points for 2+ consecutive weeks. Gone dark = zero sessions this week after being active last week. These may indicate a campaign ended, integration issue, or traffic source change.",
    system: "SYSTEM warning: Detected from job-level failure rates in the Ops pipeline. Warn (>15%) = elevated merchant failures worth monitoring. Danger (>30%) = significant failures likely impacting cardholder experience. Check the Operations Dashboard for merchant-level breakdown.",
  };

  let html = visible
    .map(
      (w) =>
        `<div class="warning-item ${w.type}" title="${warningTooltips[w.category] || ''}">
          <span class="warning-item__type ${w.category}" title="${w.category === 'engagement' ? 'Engagement-related warning — based on session success rate trends across weekly buckets.' : 'System-related warning — based on job failure rates from the placement pipeline.'}">${w.category.toUpperCase()}</span>
          <span>${w.text}</span>
        </div>`
    )
    .join("");

  if (hasMore) {
    const remaining = allWarnings.length - COLLAPSED_COUNT;
    html += `<div class="kiosk-alerts__expand" id="warningsExpandToggle">${
      alertsExpanded
        ? '<span class="partner-grid__expand-arrow">&#9650;</span> Show less'
        : `<span class="partner-grid__expand-arrow">&#9660;</span> Show ${remaining} more`
    }</div>`;
  }

  container.innerHTML = html;

  if (hasMore) {
    document.getElementById("warningsExpandToggle")?.addEventListener("click", () => {
      alertsExpanded = !alertsExpanded;
      renderWarnings(fis);
    });
  }
}

/* ── Sparkline SVG ── */
function buildSparklineSvg(weeks, size = "card") {
  const points = [...weeks].reverse().map((w) => (w ? w.sm : 0));
  const max = Math.max(...points, 1);
  const isLarge = size === "large";
  const w = isLarge ? 280 : 80;
  const h = isLarge ? 80 : 32;
  const strokeW = isLarge ? 2.5 : 2;
  const pad = isLarge ? 6 : 3;
  const dotR = isLarge ? 4 : 0;
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((val, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (val / max) * (h - pad * 2);
    return { x: parseFloat(x.toFixed(1)), y: parseFloat(y.toFixed(1)) };
  });
  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const color = points[points.length - 1] >= points[points.length - 2] ? "#22c55e" : "#ef4444";
  const fillD = pathD + ` L${coords[coords.length - 1].x},${h - pad} L${coords[0].x},${h - pad} Z`;
  const fillOpacity = isLarge ? "0.12" : "0.08";

  let dots = "";
  if (dotR > 0) {
    dots = coords.map((c) => `<circle cx="${c.x}" cy="${c.y}" r="${dotR}" fill="${color}" />`).join("");
  }

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;display:block;"><path d="${fillD}" fill="${color}" opacity="${fillOpacity}"/><path d="${pathD}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}

function trendArrow(trend) {
  if (trend === "up") return `<span style="color:#22c55e;font-size:0.85rem;" title="Trending UP: Session success rate improved by more than 2 percentage points compared to the prior week. This FI's cardholders are converting better week-over-week.">&#9650;</span>`;
  if (trend === "down") return `<span style="color:#ef4444;font-size:0.85rem;" title="Trending DOWN: Session success rate declined by more than 2 percentage points compared to the prior week. Investigate whether traffic source changed (e.g. campaign ended) or if there are system issues.">&#9660;</span>`;
  return `<span style="color:#64748b;font-size:0.7rem;" title="FLAT: Session success rate is within +/- 2 percentage points of the prior week. No significant week-over-week change in conversion quality.">&#9644;</span>`;
}

const TIER_TOOLTIPS = {
  tier1: "Tier 1 — Card Activation Flow (>=21% success rate). These cardholders just received a new card and have urgent motivation to update their payment info. 1 in 4 completes. This is the gold standard.",
  tier2to1: "Tier 1.5 — Campaign-to-Activation Transition (12-21% success rate). This FI is between campaign-driven and activation-driven traffic. Likely has a mix of motivated and prompted cardholders. Push toward activation flow integration to reach Tier 1.",
  tier2: "Tier 2 — SMS & Targeted Campaigns (8-12% success rate). Cardholders are prompted via SMS, email, or targeted campaigns. Manufactured motivation. ~1 in 10 acts. Good engagement but room to grow by adding activation flow triggers.",
  tier3to2: "Tier 2.5 — Discovery-to-Campaign Transition (3-8% success rate). This FI is between incidental discovery and campaign-driven traffic. Some outreach is happening but not consistently. Recommend structured campaign cadence to reach Tier 2.",
  tier3: "Tier 3 — Incidental Discovery (<3% success rate). Cardholders are browsing online banking with no specific prompt or urgency. Curiosity-only traffic. <1 in 33 completes. This is the starting line — not a verdict. Every FI can move up with the right activation strategy.",
  unknown: "Tier data unavailable. Insufficient session data to classify this FI's motivation tier.",
};

function tierBadgeHtml(tierInfo) {
  const classMap = { tier1: "tier1", tier2to1: "tier1_5", tier2: "tier2", tier3to2: "tier2_5", tier3: "tier3" };
  const cls = classMap[tierInfo.zone] || "tier3";
  const tooltip = TIER_TOOLTIPS[tierInfo.zone] || TIER_TOOLTIPS.unknown;
  return `<span class="tier-badge ${cls}" title="${tooltip}">T${tierInfo.tier}</span>`;
}

function integrationBadge(fi) {
  if (!fi.integration_type) return "";
  const isSSO = fi.integration_type === "SSO";
  const label = isSSO ? "SSO" : "Non-SSO";
  const cls = isSSO ? "badge-sso" : "badge-nonsso";
  const tooltip = isSSO
    ? "SSO Integration: CardUpdatr is embedded in online banking with Single Sign-On. The cardholder is pre-authenticated — no need to enter card details. This reduces friction dramatically and enables Tier 1 (activation flow) conversion rates of 21%+."
    : "Non-SSO Integration: CardUpdatr runs standalone or without pre-authentication. The cardholder must manually enter their card number and details. Higher friction typically results in Tier 2-3 conversion rates. Consider SSO integration to unlock Tier 1 potential.";
  return `<span class="integration-badge ${cls}" title="${tooltip}">${label}</span>`;
}

/* ── FI Card Grid ── */
function renderFiGrid(fis) {
  const container = els.fiCardGrid;
  if (!container) return;
  container.innerHTML = "";

  const sorted = [...fis].sort((a, b) => b.score - a.score);

  sorted.forEach((fi) => {
    const card = document.createElement("div");
    card.className = "partner-card";

    const sm = fi.SM_Sessions || 0;
    const success = fi.Success_Sessions || 0;
    const rate = fi.successRate;
    const color = healthColor(rate);
    const sparkline = fi.trendData ? buildSparklineSvg(fi.trendData.weeks) : "";
    const sColor = scoreColor(fi.score);

    let systemFlag = "";
    if (fi.jobFailRate > 0.15) {
      systemFlag = `<span class="system-flag">${(fi.jobFailRate * 100).toFixed(0)}% fail</span>`;
    }

    card.title = `Click to view detailed breakdown for ${fi.fi_name}: weekly trends, system health, tier diagnosis, and recommended engagement actions.`;
    card.innerHTML = `
      <div class="partner-card__header">
        <span class="partner-card__name" title="${fi.fi_name} (${fi.fi_lookup_key})${fi.partner ? ' — Partner: ' + fi.partner : ''}${fi.cardholder_total ? ' — ' + formatNumber(fi.cardholder_total) + ' cardholders on file' : ''}">${fi.fi_name}</span>
        <span class="partner-card__badges">
          ${tierBadgeHtml(fi.tierInfo)}
          ${integrationBadge(fi)}
          ${trendArrow(fi.trend)}
          <span class="health-dot ${color}" title="${healthDotTooltip(rate)}"></span>
        </span>
      </div>
      <div class="partner-card__metrics">
        <div class="partner-card__metric" title="${scoreTooltip(fi)}">
          <span class="score-circle score-circle--small ${sColor}">${fi.score}</span>
          <span class="partner-card__metric-label">Score</span>
        </div>
        <div class="partner-card__metric" title="Select Merchant (SM) sessions: ${formatNumber(sm)} cardholders opened CardUpdatr at ${fi.fi_name} in this time window. Each session = one cardholder reaching the merchant selection page.">
          <span class="partner-card__metric-value">${formatNumber(sm)}</span>
          <span class="partner-card__metric-label">Sessions</span>
        </div>
        <div class="partner-card__metric" title="Session Success Rate: ${formatRate(success, sm)} — ${formatNumber(success)} out of ${formatNumber(sm)} sessions resulted in at least one successful card placement at a merchant.">
          <span class="partner-card__metric-value">${formatRate(success, sm)}</span>
          <span class="partner-card__metric-label">Success</span>
        </div>
        <div class="partner-card__metric" style="margin-left:auto;" title="${sparklineTooltip(fi)}">
          ${sparkline}
          <span class="partner-card__metric-label">4-wk vol</span>
        </div>
      </div>
      ${systemFlag ? `<div style="margin-top:2px;" title="${systemFlagTooltip(fi)}">${systemFlag}</div>` : ""}
    `;

    card.addEventListener("click", () => renderDetailModal(fi));
    container.appendChild(card);
  });

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">No FIs match current filters.</div>';
  }
}

/* ── FI Performance Table ── */
function renderFiTable(fis) {
  const tbody = els.fiTable?.querySelector("tbody");
  if (!tbody) return;

  if (!fis.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No FI data for this view.</td></tr>';
    if (els.fiTableMeta) els.fiTableMeta.textContent = "No FI rows";
    return;
  }

  const sorted = sortRows(fis, state.fiSortKey, state.fiSortDir);
  tbody.innerHTML = "";

  sorted.forEach((fi) => {
    const tr = document.createElement("tr");
    const jobHealthColor = fi.jobFailRate > 0.30 ? "red" : fi.jobFailRate > 0.15 ? "amber" : "green";
    const jobHealthLabel = fi.jobsTotal > 0 ? `${(fi.jobFailRate * 100).toFixed(1)}% fail` : "-";

    const jobHealthTooltip = fi.jobsTotal > 0
      ? `Job failure rate: ${(fi.jobFailRate * 100).toFixed(1)}%. ${formatNumber(fi.jobsFailed)} failed out of ${formatNumber(fi.jobsTotal)} total placement jobs. Green = <15% failure (healthy). Amber = 15-30% (elevated). Red = >30% (degraded). Check Operations Dashboard for merchant-level detail.`
      : "No job data available for this FI in the selected time window.";

    tr.innerHTML = `
      <td title="${fi.fi_name} (${fi.fi_lookup_key})${fi.partner ? ' — Partner: ' + fi.partner : ''}">${fi.fi_name}</td>
      <td>${tierBadgeHtml(fi.tierInfo)}</td>
      <td title="${scoreTooltip(fi)}"><span class="score-circle score-circle--small ${scoreColor(fi.score)}">${fi.score}</span></td>
      <td title="${formatNumber(fi.SM_Sessions || 0)} Select Merchant sessions — cardholders who opened CardUpdatr and reached the merchant selection page.">${formatNumber(fi.SM_Sessions || 0)}</td>
      <td title="Session Success Rate: ${formatPercent(fi.successRate)}. ${formatNumber(fi.Success_Sessions || 0)} of ${formatNumber(fi.SM_Sessions || 0)} sessions had at least one successful card placement.">${formatPercent(fi.successRate)}</td>
      <td>${trendArrow(fi.trend)}</td>
      <td title="${jobHealthTooltip}"><span class="health-dot ${jobHealthColor}" style="margin-right:4px;"></span>${jobHealthLabel}</td>
      <td>${integrationBadge(fi)}</td>
      <td title="${fi.partner || 'No partner assigned'}">${fi.partner}</td>
    `;
    tbody.appendChild(tr);
  });

  if (els.fiTableMeta) els.fiTableMeta.textContent = `${fis.length} FIs`;
}

/* ── Detail Modal ── */
function renderDetailModal(fi) {
  // Remove existing modal
  const existing = document.getElementById("portfolioDetailModal");
  if (existing) existing.remove();

  const sm = fi.SM_Sessions || 0;
  const ce = fi.CE_Sessions || 0;
  const success = fi.Success_Sessions || 0;
  const sColor = scoreColor(fi.score);
  const subtitle = [fi.integration_type === "SSO" ? "SSO" : fi.integration_type ? "Non-SSO" : "", fi.partner].filter(Boolean).join(" \u00b7 ");

  // Stats grid
  const reachLabel = fi.monthlyReachPct !== null ? `${fi.monthlyReachPct.toFixed(2)}%` : "N/A";
  const jobSuccessRate = fi.jobsTotal > 0 ? formatRate(fi.jobsTotal - fi.jobsFailed, fi.jobsTotal) : "-";

  // Weekly trend
  let weeklyHtml = "";
  if (fi.trendData && fi.trendData.weeks) {
    const largeSparkline = buildSparklineSvg(fi.trendData.weeks, "large");
    const weekLabels = ["4 wks ago", "3 wks ago", "2 wks ago", "This week"];
    const weeksReversed = [...fi.trendData.weeks].reverse();
    const weekRows = weeksReversed
      .map((w, i) => {
        const wk = w || { sm: 0, success: 0, rate: 0 };
        return `<tr>
          <td>${weekLabels[i]}</td>
          <td>${formatNumber(wk.sm)}</td>
          <td>${formatNumber(wk.success)}</td>
          <td>${(wk.rate * 100).toFixed(1)}%</td>
        </tr>`;
      })
      .join("");

    weeklyHtml = `
      <div class="detail-modal__weekly">
        <div class="detail-modal__weekly-title" title="Session volume and success rate for each of the last 4 weeks (7-day windows). The sparkline shows session volume trend (green = growing, red = declining). The table shows SM sessions, successful sessions, and success rate per week. Week-over-week trend direction (up/down/flat) is determined by comparing the most recent week's success rate to the prior week, with a 2 percentage point threshold.">4-Week Trend</div>
        <div class="detail-modal__weekly-chart" title="Session volume sparkline — each point represents one week's total SM sessions. Left = oldest (4 weeks ago), right = most recent. Line color: green if most recent week >= prior week, red if declining.">${largeSparkline}</div>
        <table class="detail-modal__weekly-table">
          <thead><tr>
            <th title="7-day window, ending on the indicated relative date.">Week</th>
            <th title="Select Merchant (SM) sessions — cardholders who opened CardUpdatr in this 7-day window.">Sessions</th>
            <th title="Sessions where at least one card was successfully updated at a merchant.">Successes</th>
            <th title="Session Success Rate = Successes / Sessions. This is the primary conversion quality metric used for tier classification and trend detection.">Rate</th>
          </tr></thead>
          <tbody>${weekRows}</tbody>
        </table>
      </div>
    `;
  }

  // System health section
  let systemHtml = "";
  if (fi.jobsTotal > 0) {
    const failColor = fi.jobFailRate > 0.30 ? "red" : fi.jobFailRate > 0.15 ? "amber" : "green";
    // Find top failing merchants for this FI from ops data
    let merchantDetail = "";
    if (fi.jobFailRate > 0.05 && fi.opsByMerchant) {
      // We only have network-wide merchant data, note that in display
      merchantDetail = `<div style="font-size:0.75rem;color:var(--muted);margin-top:4px;">See Operations Dashboard for merchant-level detail.</div>`;
    }
    systemHtml = `
      <div class="detail-modal__section-title" title="Job-level system health for this FI. Each 'job' is one card placement attempt at one merchant. A single cardholder session can produce multiple jobs (e.g. updating Netflix + Amazon = 2 jobs). Job failures are caused by merchant site changes, credential issues, or CardSavr system errors — they are NOT caused by cardholders abandoning. Green (<15% fail) = healthy. Amber (15-30%) = elevated. Red (>30%) = degraded.">System Health</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;" title="Job failure rate for ${fi.fi_name}: ${(fi.jobFailRate * 100).toFixed(1)}%. This means ${formatNumber(fi.jobsFailed)} out of ${formatNumber(fi.jobsTotal)} individual card placement attempts failed. Compare with network average on the System Health banner above.">
        <span class="health-dot ${failColor}"></span>
        <span style="font-weight:600;">${(fi.jobFailRate * 100).toFixed(1)}% failure rate</span>
        <span style="color:var(--muted);font-size:0.78rem;">(${formatNumber(fi.jobsFailed)} of ${formatNumber(fi.jobsTotal)} jobs)</span>
      </div>
      ${merchantDetail}
    `;
  }

  // Tier diagnosis
  const tierHtml = `
    <div class="detail-modal__section-title" title="The Motivation Spectrum classifies FI traffic by cardholder motivation at the moment of encounter. Tier is determined by Session Success Rate — not product quality. The core thesis: conversion rate is determined by cardholder motivation, and there is a validated 7.7x gap between Tier 1 (activation) and Tier 3 (incidental) traffic. Every FI can move up tiers with the right strategy.">Tier Diagnosis</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      ${tierBadgeHtml(fi.tierInfo)}
      <span style="font-weight:600;">${fi.tierInfo.label}</span>
    </div>
    <div style="font-size:0.78rem;color:var(--muted);" title="Session Success Rate determines tier classification. This rate measures what percentage of CardUpdatr sessions result in at least one successful card placement. Tiers: >=21% = Tier 1, >=12% = Tier 1.5, >=8% = Tier 2, >=3% = Tier 2.5, <3% = Tier 3.">Based on ${formatPercent(fi.successRate)} session success rate</div>
  `;

  // Recommended actions
  let actionsHtml = "";
  const evaluateActions = window.EngagementInsights?.evaluateActions;
  if (evaluateActions) {
    try {
      const metricsCtx = {
        sessionSuccessPct: fi.successRate * 100,
        monthlyReachPct: fi.monthlyReachPct,
        selCredPct: ce > 0 && sm > 0 ? (ce / sm) * 100 : null,
        credCompletionPct: ce > 0 ? (success / ce) * 100 : null,
        bestWeekRate: null,
        totalSessions: sm,
      };
      const result = evaluateActions(metricsCtx);
      const actions = result.actions || [];
      if (actions.length > 0) {
        actionsHtml = `
          <div class="detail-modal__section-title" title="Prioritized engagement recommendations generated by the Insights Engine based on this FI's tier, success rate, reach, and conversion funnel data. These are the same actions shown on the Cardholder Engagement Dashboard. Up to 3 shown here — see the full Engagement Playbook for implementation details, copy templates, and channel-specific guidance.">Recommended Actions</div>
          <div class="detail-modal__actions">
            ${actions
              .slice(0, 3)
              .map(
                (a) => `
              <div class="detail-modal__action" title="Impact: ${a.impact || 'See Engagement Playbook for detailed implementation guidance, including SMS/email templates, landing page recommendations, and timing strategies.'}">
                <div class="detail-modal__action-headline">${a.headline}</div>
                <div class="detail-modal__action-detail">${a.detail}</div>
              </div>
            `
              )
              .join("")}
          </div>
        `;
      }
    } catch (err) {
      console.warn("[portfolio] evaluateActions failed", err);
    }
  }

  const overlay = document.createElement("div");
  overlay.id = "portfolioDetailModal";
  overlay.className = "detail-modal-overlay";
  overlay.innerHTML = `
    <div class="detail-modal">
      <div class="detail-modal__header">
        <div>
          <span class="detail-modal__name">${fi.fi_name}</span>
          <span class="health-dot ${healthColor(fi.successRate)}" style="margin-left:8px;"></span>
          <span class="detail-modal__tier-badge">${tierBadgeHtml(fi.tierInfo)} <span class="score-circle score-circle--small ${sColor}">${fi.score}</span></span>
          ${subtitle ? `<div class="detail-modal__subtitle">${subtitle}</div>` : ""}
        </div>
        <button class="detail-modal__close" type="button">&times;</button>
      </div>
      <div class="detail-modal__stats">
        <div class="partner-detail-panel__stat" title="Select Merchant (SM) Sessions: The number of times cardholders at ${fi.fi_name} opened CardUpdatr and reached the merchant selection page. This is the top of the conversion funnel — every cardholder journey starts here.">
          <span class="partner-detail-panel__stat-value">${formatNumber(sm)}</span>
          <span class="partner-detail-panel__stat-label">SM Sessions</span>
        </div>
        <div class="partner-detail-panel__stat" title="Credential Entry (CE) Sessions: Cardholders who selected a merchant and proceeded to enter their login credentials. SM-to-CE drop-off indicates friction at the merchant selection step (${sm > 0 ? ((ce/sm)*100).toFixed(1) : 0}% of SM sessions reached CE).">
          <span class="partner-detail-panel__stat-value">${formatNumber(ce)}</span>
          <span class="partner-detail-panel__stat-label">CE Sessions</span>
        </div>
        <div class="partner-detail-panel__stat" title="Successful Sessions: Cardholders who completed at least one card update at a merchant. This is the bottom of the funnel — the core outcome metric. ${success} out of ${sm} sessions succeeded.">
          <span class="partner-detail-panel__stat-value">${formatNumber(success)}</span>
          <span class="partner-detail-panel__stat-label">Successes</span>
        </div>
        <div class="partner-detail-panel__stat" title="Session Success Rate: ${formatRate(success, sm)} of sessions resulted in at least one successful card placement. This is the primary conversion quality metric. Tier 1 FIs achieve >=21%, Tier 2 achieves 8-12%, Tier 3 is <3%.">
          <span class="partner-detail-panel__stat-value">${formatRate(success, sm)}</span>
          <span class="partner-detail-panel__stat-label">Success Rate</span>
        </div>
        <div class="partner-detail-panel__stat" title="Total Jobs: Individual card placement attempts across all merchants. One session can produce multiple jobs if the cardholder updates cards at multiple merchants (e.g. Netflix + Amazon + Spotify in one session). ${formatNumber(fi.jobsTotal)} jobs from ${formatNumber(sm)} sessions = ${sm > 0 ? (fi.jobsTotal / sm).toFixed(1) : 0} jobs per session.">
          <span class="partner-detail-panel__stat-value">${formatNumber(fi.jobsTotal)}</span>
          <span class="partner-detail-panel__stat-label">Total Jobs</span>
        </div>
        <div class="partner-detail-panel__stat" title="Job Success Rate: Percentage of individual card placement jobs that completed successfully. Different from Session Success Rate — this measures per-merchant outcomes, not per-cardholder outcomes. Failures here are typically caused by merchant site changes or credential issues. Green >=85%, Amber >=70%, Red <70%.">
          <span class="partner-detail-panel__stat-value">${jobSuccessRate}</span>
          <span class="partner-detail-panel__stat-label">Job Success Rate</span>
        </div>
        <div class="partner-detail-panel__stat" title="Monthly Reach %: What percentage of this FI's total cardholders used CardUpdatr in this time window. Calculated as SM Sessions / Total Cardholders on File (${formatNumber(fi.cardholder_total || 0)}). Target: 2.5% monthly reach means CardUpdatr is being encountered by cardholders at the rate of natural card replacement (~25% annual portfolio turnover). N/A means no cardholder count is on file for this FI.">
          <span class="partner-detail-panel__stat-value">${reachLabel}</span>
          <span class="partner-detail-panel__stat-label">Monthly Reach %</span>
        </div>
        <div class="partner-detail-panel__stat" title="${scoreTooltip(fi)}">
          <span class="partner-detail-panel__stat-value">${fi.score}</span>
          <span class="partner-detail-panel__stat-label">Engagement Score</span>
        </div>
      </div>
      ${weeklyHtml}
      ${systemHtml}
      ${tierHtml}
      ${actionsHtml}
    </div>
  `;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDetailModal();
  });
  overlay.querySelector(".detail-modal__close").addEventListener("click", closeDetailModal);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function closeDetailModal() {
  const modal = document.getElementById("portfolioDetailModal");
  if (modal) {
    modal.classList.remove("open");
    setTimeout(() => modal.remove(), 200);
  }
}

/* ── Kiosk Mode ── */
function initKioskLayout() {
  // Hide normal dashboard sections
  const normalSections = document.querySelectorAll(".dashboard-toolbar, .portfolio-kpi-row, .portfolio-distributions, .section-title, .table-wrap, .portfolio-warnings, #systemHealthBanner");
  normalSections.forEach((el) => (el.style.display = "none"));
  if (els.fiCardGrid) els.fiCardGrid.style.display = "none";
  if (els.warningsTitle) els.warningsTitle.style.display = "none";

  // Show kiosk containers
  const kioskAlerts = document.getElementById("kioskAlerts");
  const kioskGrid = document.getElementById("kioskPartnerGrid");
  if (kioskAlerts) kioskAlerts.style.display = "";
  if (kioskGrid) kioskGrid.style.display = "";

  // Section title
  const gridTitle = document.createElement("div");
  gridTitle.className = "kiosk-section-title";
  gridTitle.textContent = "All FIs";
  gridTitle.style.marginTop = "8px";
  if (kioskGrid) kioskGrid.parentNode.insertBefore(gridTitle, kioskGrid);

  // Test toggle in kiosk header
  const headerStatus = document.querySelector(".kiosk-header__status");
  if (headerStatus) {
    const label = document.createElement("label");
    label.className = "kiosk-test-toggle";
    label.innerHTML = '<input type="checkbox" id="kioskIncludeTests" /> Include test data';
    headerStatus.insertBefore(label, headerStatus.firstChild);
    document.getElementById("kioskIncludeTests")?.addEventListener("change", (e) => {
      state.includeTests = e.target.checked;
      fetchAll();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetailModal();
  });
}

function renderKioskView(fis) {
  const kioskAlerts = document.getElementById("kioskAlerts");
  const kioskGrid = document.getElementById("kioskPartnerGrid");

  // Render KPI row in kiosk
  renderKioskKpis(fis);

  // Render alerts
  if (kioskAlerts) {
    const allWarnings = [];
    fis.forEach((fi) => (fi.warnings || []).forEach((w) => allWarnings.push(w)));

    if (!allWarnings.length) {
      kioskAlerts.innerHTML = "";
    } else {
      const COLLAPSED_COUNT = 3;
      const visible = alertsExpanded ? allWarnings : allWarnings.slice(0, COLLAPSED_COUNT);
      const hasMore = allWarnings.length > COLLAPSED_COUNT;

      let html = visible
        .map(
          (w) =>
            `<div class="kiosk-alert ${w.type}"><span class="warning-item__type ${w.category}">${w.category.toUpperCase()}</span> ${w.text}</div>`
        )
        .join("");

      if (hasMore) {
        const remaining = allWarnings.length - COLLAPSED_COUNT;
        html += `<div class="kiosk-alerts__expand" id="kioskWarningsExpand">${
          alertsExpanded
            ? '<span class="partner-grid__expand-arrow">&#9650;</span> Show less'
            : `<span class="partner-grid__expand-arrow">&#9660;</span> Show ${remaining} more`
        }</div>`;
      }

      kioskAlerts.innerHTML = html;
      if (hasMore) {
        document.getElementById("kioskWarningsExpand")?.addEventListener("click", () => {
          alertsExpanded = !alertsExpanded;
          renderKioskView(fis);
        });
      }
    }
  }

  // Render grid
  if (kioskGrid) {
    kioskGrid.innerHTML = "";
    const sorted = [...fis].sort((a, b) => b.score - a.score);
    sorted.forEach((fi) => {
      const card = document.createElement("div");
      card.className = "partner-card";

      const sm = fi.SM_Sessions || 0;
      const success = fi.Success_Sessions || 0;
      const color = healthColor(fi.successRate);
      const sparkline = fi.trendData ? buildSparklineSvg(fi.trendData.weeks) : "";
      const sColor = scoreColor(fi.score);

      card.title = `Click to view detailed breakdown for ${fi.fi_name}: weekly trends, system health, tier diagnosis, and recommended engagement actions.`;
      card.innerHTML = `
        <div class="partner-card__header">
          <span class="partner-card__name" title="${fi.fi_name} (${fi.fi_lookup_key})${fi.partner ? ' — Partner: ' + fi.partner : ''}">${fi.fi_name}</span>
          <span class="partner-card__badges">
            ${tierBadgeHtml(fi.tierInfo)}
            ${trendArrow(fi.trend)}
            <span class="health-dot ${color}" title="${healthDotTooltip(fi.successRate)}"></span>
          </span>
        </div>
        <div class="partner-card__metrics">
          <div class="partner-card__metric" title="${scoreTooltip(fi)}">
            <span class="score-circle score-circle--small ${sColor}">${fi.score}</span>
            <span class="partner-card__metric-label">Score</span>
          </div>
          <div class="partner-card__metric" title="${formatNumber(sm)} Select Merchant sessions at ${fi.fi_name}.">
            <span class="partner-card__metric-value">${formatNumber(sm)}</span>
            <span class="partner-card__metric-label">Sessions</span>
          </div>
          <div class="partner-card__metric" title="Session Success Rate: ${formatRate(success, sm)} — ${formatNumber(success)} of ${formatNumber(sm)} sessions.">
            <span class="partner-card__metric-value">${formatRate(success, sm)}</span>
            <span class="partner-card__metric-label">Success</span>
          </div>
          <div class="partner-card__metric" style="margin-left:auto;" title="${sparklineTooltip(fi)}">
            ${sparkline}
            <span class="partner-card__metric-label">4-wk vol</span>
          </div>
        </div>
      `;

      card.addEventListener("click", () => renderDetailModal(fi));
      kioskGrid.appendChild(card);
    });
  }
}

let kioskKpiRow = null;

function renderKioskKpis(fis) {
  if (!kioskKpiRow) {
    kioskKpiRow = document.createElement("div");
    kioskKpiRow.className = "kiosk-kpi-row";
    const shell = document.querySelector(".dashboard-shell");
    const kioskAlerts = document.getElementById("kioskAlerts");
    if (shell && kioskAlerts) {
      shell.insertBefore(kioskKpiRow, kioskAlerts);
    }
  }

  const activeFis = fis.filter((fi) => (fi.SM_Sessions || 0) > 0).length;
  const totalSm = fis.reduce((s, fi) => s + (fi.SM_Sessions || 0), 0);
  const totalSuccess = fis.reduce((s, fi) => s + (fi.Success_Sessions || 0), 0);
  const networkRate = totalSm > 0 ? totalSuccess / totalSm : 0;
  const totalPlacements = state.data?.overall?.Jobs_Success || 0;

  // System health
  const opsOverall = state.opsData?.overall || {};
  const opsTotal = opsOverall.Jobs_Total || 0;
  const opsSuccess = opsOverall.Jobs_Success || 0;
  const opsRate = opsTotal > 0 ? opsSuccess / opsTotal : 1;
  const opsColor = opsHealthColor(opsRate);

  kioskKpiRow.innerHTML = `
    <div class="card" title="Number of FIs with at least 1 CardUpdatr session (Select Merchant page view) in the last 30 days.">
      <h3>Active FIs</h3>
      <div class="kpi-value">${formatNumber(activeFis)}</div>
    </div>
    <div class="card" title="Weighted average success rate across all FIs. Total successful sessions (${formatNumber(totalSuccess)}) / Total SM sessions (${formatNumber(totalSm)}). Not a simple average of per-FI rates — FIs with more volume contribute proportionally more.">
      <h3>Network Success Rate</h3>
      <div class="kpi-value">${formatPercent(networkRate)}</div>
    </div>
    <div class="card" title="Total Select Merchant (SM) sessions across all FIs in the last 30 days. Each session = one cardholder opening CardUpdatr and reaching the merchant selection page.">
      <h3>Total Sessions</h3>
      <div class="kpi-value">${formatNumber(totalSm)}</div>
    </div>
    <div class="card" title="Total successful card placements (cards updated at merchants) across all FIs. One session can produce multiple placements if the cardholder updates multiple merchants.">
      <h3>Total Placements</h3>
      <div class="kpi-value">${formatNumber(totalPlacements)}</div>
    </div>
    <div class="card" title="Network-wide job success rate: ${(opsRate * 100).toFixed(1)}%. Measures the percentage of individual card placement jobs that succeed across all merchants. Green (>=85%) = healthy. Amber (70-85%) = elevated failures. Red (<70%) = degraded. Based on ${formatNumber(opsTotal)} total jobs.">
      <h3>System Health</h3>
      <div class="kpi-value"><span class="health-dot ${opsColor}" style="margin-right:6px;"></span>${(opsRate * 100).toFixed(1)}%</div>
    </div>
  `;
}

/* ── CSV Export ── */
function handleExportCsv() {
  const fis = state.enrichedFis;
  if (!fis.length) return;

  const header = [
    "FI Name",
    "FI Lookup Key",
    "Tier",
    "Tier Label",
    "Engagement Score",
    "SM Sessions",
    "CE Sessions",
    "Success Sessions",
    "Success Rate",
    "Trend",
    "Monthly Reach %",
    "Jobs Total",
    "Jobs Failed",
    "Job Failure Rate",
    "Integration Type",
    "Partner",
  ];

  const body = fis.map((fi) => [
    fi.fi_name || "",
    fi.fi_lookup_key || "",
    fi.tier,
    fi.tierInfo.label || "",
    fi.score,
    fi.SM_Sessions || 0,
    fi.CE_Sessions || 0,
    fi.Success_Sessions || 0,
    formatPercent(fi.successRate),
    fi.trend,
    fi.monthlyReachPct !== null ? fi.monthlyReachPct.toFixed(2) + "%" : "N/A",
    fi.jobsTotal || 0,
    fi.jobsFailed || 0,
    fi.jobsTotal > 0 ? formatPercent(fi.jobFailRate) : "N/A",
    fi.integration_type || "",
    fi.partner || "",
  ]);

  const ts = new Date().toISOString().replace(/[:]/g, "");
  downloadCsv(`cs-portfolio-${state.windowDays}d-${ts}.csv`, [header, ...body]);
}

/* ── Sort Handlers ── */
function bindSortHandlers() {
  attachSortHandlers(els.fiTable, (key) => {
    if (state.fiSortKey === key) {
      state.fiSortDir = state.fiSortDir === "asc" ? "desc" : "asc";
    } else {
      state.fiSortKey = key;
      state.fiSortDir = "desc";
    }
    applyFiltersAndRender();
  });
}

/* ── Init ── */
function init() {
  const kiosk = isKioskMode();

  if (kiosk) {
    initKioskMode("CS Portfolio Dashboard — Last 30 Days", 300);
    initKioskLayout();
    state.windowDays = 30;
    loadFiRegistry().then(() => {
      startAutoRefresh(async () => {
        await fetchAll();
      }, 300000); // 5 minutes
    });
  } else {
    initTimeWindows();
    bindSortHandlers();
    loadFiRegistry().then(() => fetchAll());

    els.fiScope?.addEventListener("change", (event) => {
      state.fiScope = event.target.value || "all";
      applyFiltersAndRender();
    });

    els.exportCsv?.addEventListener("click", handleExportCsv);

    const testCheckbox = document.getElementById("includeTestsCheckbox");
    if (testCheckbox) {
      testCheckbox.addEventListener("change", (e) => {
        state.includeTests = e.target.checked;
        fetchAll();
      });
    }

    const kioskToggle = document.getElementById("kioskToggle");
    if (kioskToggle) {
      kioskToggle.addEventListener("click", () => {
        const url = new URL(window.location);
        url.searchParams.set("kiosk", "1");
        window.location.href = url.toString();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDetailModal();
    });
  }
}

/* ── Touch-friendly tooltips (iPad/mobile) ── */
function initTouchTooltips() {
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!isTouchDevice) return;

  let activeTooltip = null;
  let longPressTimer = null;

  function showTooltip(text, x, y) {
    dismissTooltip();
    const tip = document.createElement("div");
    tip.className = "touch-tooltip";
    tip.innerHTML = `<button class="touch-tooltip__close" type="button">&times;</button>${text}`;
    document.body.appendChild(tip);

    // Position: try to center horizontally near tap, keep on screen
    const rect = tip.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 12;
    const maxY = window.innerHeight - rect.height - 12;
    tip.style.left = Math.max(12, Math.min(x - rect.width / 2, maxX)) + "px";
    tip.style.top = Math.max(12, Math.min(y + 16, maxY)) + "px";

    requestAnimationFrame(() => tip.classList.add("visible"));

    tip.querySelector(".touch-tooltip__close").addEventListener("click", (e) => {
      e.stopPropagation();
      dismissTooltip();
    });

    activeTooltip = tip;

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      if (activeTooltip === tip) dismissTooltip();
    }, 8000);
  }

  function dismissTooltip() {
    if (activeTooltip) {
      activeTooltip.classList.remove("visible");
      const tip = activeTooltip;
      activeTooltip = null;
      setTimeout(() => tip.remove(), 150);
    }
  }

  // Long-press (500ms) on any element with a title attribute shows the tooltip
  document.addEventListener("touchstart", (e) => {
    const target = e.target.closest("[title]");
    if (!target || !target.title) return;

    const text = target.title;
    const touch = e.touches[0];
    const tx = touch.clientX;
    const ty = touch.clientY;

    longPressTimer = setTimeout(() => {
      e.preventDefault();
      showTooltip(text, tx, ty);
    }, 500);
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });

  document.addEventListener("touchmove", () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });

  // Dismiss on tap anywhere outside tooltip
  document.addEventListener("click", (e) => {
    if (activeTooltip && !activeTooltip.contains(e.target)) {
      dismissTooltip();
    }
  });
}

initTouchTooltips();
init();
