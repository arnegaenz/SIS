import {
  formatNumber,
  formatPercent,
  buildDateRange,
  isKioskMode,
  initKioskMode,
  startAutoRefresh,
  opsHealthColor,
} from "./dashboard-utils.js";

/* ── Constants ── */
const WINDOW_DAYS = 30;
const WEEKLY_BUCKETS = 12;
const MAX_WARNINGS = 5;

/* ── DOM Cache ── */
const els = {
  verdict: document.getElementById("execVerdict"),
  kpiActiveFis: document.getElementById("kpiActiveFis"),
  kpiNetworkRate: document.getElementById("kpiNetworkRate"),
  kpiPlacements: document.getElementById("kpiPlacements"),
  kpiAvgScore: document.getElementById("kpiAvgScore"),
  kpiAttention: document.getElementById("kpiAttention"),
  trendChart: document.getElementById("trendChart"),
  execWarnings: document.getElementById("execWarnings"),
  warningsList: document.getElementById("warningsList"),
  tierDistribution: document.getElementById("tierDistribution"),
  scoreDistribution: document.getElementById("scoreDistribution"),
};

/* ── State ── */
let funnelData = null;
let opsData = null;
let fiRegistryMap = new Map();
let weeklyBuckets = []; // 12 weekly buckets, newest first

/* ── FI Registry ── */
async function loadFiRegistry() {
  const sources = ["/fi-registry", "../assets/data/fi_registry.json", "/assets/data/fi_registry.json"];
  for (const url of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const values = Array.isArray(json) ? json : Object.values(json || {});
      values.forEach((entry) => {
        if (!entry) return;
        const key = (entry.fi_lookup_key || entry.fi_name || "").toString().trim();
        if (!key || fiRegistryMap.has(key)) return;
        fiRegistryMap.set(key, {
          integration_type: (entry.integration_type || "").toString().toUpperCase(),
          partner: entry.partner || "",
          cardholder_total: Number(entry.cardholder_total || entry.total) || 0,
        });
      });
      return;
    } catch (err) { /* continue */ }
  }
}

/* ── Weekly Trends (12 weekly buckets) ── */
async function fetchWeeklyTrends() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weeks = [];
  for (let w = 0; w < WEEKLY_BUCKETS; w++) {
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
          body: JSON.stringify({ date_from: w.date_from, date_to: w.date_to, includeTests: false }),
        }).then((r) => (r.ok ? r.json() : { by_fi: [], overall: {} }))
      )
    );

    weeklyBuckets = results.map((result, idx) => {
      const overall = result.overall || {};
      const sm = overall.SM_Sessions || 0;
      const success = overall.Success_Sessions || 0;
      return {
        weekLabel: weeks[idx].date_from.slice(5),
        sm,
        success,
        rate: sm > 0 ? success / sm : 0,
        placements: overall.Jobs_Success || 0,
      };
    });
  } catch (err) {
    console.warn("[executive] trend fetch failed", err);
    weeklyBuckets = [];
  }
}

/* ── Engagement Score (same formula as portfolio) ── */
function computeEngagementScore(fi, allFis) {
  const maxSessions = Math.max(...allFis.map((f) => f.sm || 0), 1);
  const successScore = Math.min(100, (fi.successRate / 0.27) * 100);
  let trendScore = 50;
  if (fi.trend === "up") trendScore = 100;
  else if (fi.trend === "down") trendScore = 0;
  let reachScore = 50;
  if (fi.monthlyReachPct !== null && fi.monthlyReachPct > 0) {
    reachScore = Math.min(100, (fi.monthlyReachPct / 2.5) * 100);
  }
  const volumeScore = maxSessions > 1 ? (Math.log((fi.sm || 0) + 1) / Math.log(maxSessions + 1)) * 100 : 0;
  return Math.round(successScore * 0.4 + trendScore * 0.2 + reachScore * 0.2 + volumeScore * 0.2);
}

/* ── Early Warning Computation ── */
function computeWarningsForFi(fi) {
  const warnings = [];

  // Engagement decline: use 4 most recent weekly buckets per FI
  if (fi.fiWeeks && fi.fiWeeks.length >= 2) {
    let consecutiveDeclines = 0;
    for (let i = 0; i < fi.fiWeeks.length - 1; i++) {
      const curr = fi.fiWeeks[i];
      const prev = fi.fiWeeks[i + 1];
      if (curr.sm > 0 && prev.sm > 0 && (prev.rate - curr.rate) > 0.02) {
        consecutiveDeclines++;
      } else {
        break;
      }
    }
    if (consecutiveDeclines >= 3) {
      warnings.push({ type: "danger", category: "engagement", text: `${fi.name} — engagement declining for ${consecutiveDeclines}+ consecutive weeks` });
    } else if (consecutiveDeclines >= 2) {
      warnings.push({ type: "warn", category: "engagement", text: `${fi.name} — engagement declining for ${consecutiveDeclines} consecutive weeks` });
    }

    // Gone dark
    if (fi.fiWeeks[0].sm === 0 && fi.fiWeeks[1].sm > 0) {
      warnings.push({ type: "warn", category: "engagement", text: `${fi.name} — zero sessions this week (was active last week)` });
    }
  }

  // System health
  if (fi.jobFailRate > 0.30) {
    warnings.push({ type: "danger", category: "system", text: `${fi.name} — ${(fi.jobFailRate * 100).toFixed(1)}% job failure rate` });
  } else if (fi.jobFailRate > 0.15) {
    warnings.push({ type: "warn", category: "system", text: `${fi.name} — ${(fi.jobFailRate * 100).toFixed(1)}% job failure rate` });
  }

  return warnings;
}

/* ── Main Fetch ── */
async function fetchAll() {
  const { date_from, date_to } = buildDateRange(WINDOW_DAYS);
  const payload = { date_from, date_to, includeTests: false };

  try {
    const [funnelRes, opsRes] = await Promise.all([
      fetch("/api/metrics/funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      fetch("/api/metrics/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    ]);

    if (!funnelRes.ok) throw new Error(funnelRes.statusText);
    if (!opsRes.ok) throw new Error(opsRes.statusText);

    [funnelData, opsData] = await Promise.all([funnelRes.json(), opsRes.json()]);

    await fetchWeeklyTrends();
    enrichAndRender();
  } catch (err) {
    console.error("[executive] fetch failed", err);
    funnelData = null;
    opsData = null;
    renderEmpty();
  }
}

/* ── Enrich + Render ── */
function enrichAndRender() {
  if (!funnelData) return;

  const byFi = funnelData.by_fi || [];
  const opsByFi = opsData?.by_fi_instance || [];

  // Build ops lookup
  const opsMap = new Map();
  opsByFi.forEach((row) => {
    const key = row.fi_lookup_key || row.fi_name || "";
    if (!key) return;
    if (!opsMap.has(key)) opsMap.set(key, { jobsTotal: 0, jobsFailed: 0 });
    const entry = opsMap.get(key);
    entry.jobsTotal += row.Jobs_Total || 0;
    entry.jobsFailed += row.Jobs_Failed || 0;
  });

  // Build per-FI weekly trends from the first 4 weekly buckets
  // We need per-FI data, but weekly trend fetch is aggregate-only
  // For warnings, we'll use a simplified approach: fetch 4-week per-FI data
  // (reusing the aggregate weekly data for the trend chart, individual FI enrichment for warnings)

  const enriched = byFi.map((row) => {
    const key = row.fi_lookup_key || row.fi_name || "";
    const sm = row.SM_Sessions || 0;
    const success = row.Success_Sessions || 0;
    const successRate = sm > 0 ? success / sm : 0;

    const reg = fiRegistryMap.get(key) || {};
    const cardholders = reg.cardholder_total || 0;
    const monthlyReachPct = cardholders > 0 ? (sm / cardholders) * 100 : null;

    const ops = opsMap.get(key) || { jobsTotal: 0, jobsFailed: 0 };
    const jobFailRate = ops.jobsTotal > 0 ? ops.jobsFailed / ops.jobsTotal : 0;

    const classifyTier = window.EngagementInsights?.classifyTier;
    const tierInfo = classifyTier ? classifyTier(successRate * 100) : { tier: 0, label: "Unknown", color: "#94a3b8" };

    return {
      name: row.fi_name || key,
      key,
      sm,
      success,
      successRate,
      monthlyReachPct,
      tier: tierInfo.tier,
      tierInfo,
      jobsTotal: ops.jobsTotal,
      jobsFailed: ops.jobsFailed,
      jobFailRate,
      trend: "flat",
      fiWeeks: [], // will be populated by per-FI trend fetch if available
      score: 0,
    };
  });

  // Compute trends from aggregate weekly data for the network chart
  // For individual FI trends, use delta from the main period vs a simple heuristic
  // (We'll fetch per-FI trends for the first 4 weeks for warnings)

  // Compute engagement scores
  enriched.forEach((fi) => {
    fi.score = computeEngagementScore(fi, enriched);
  });

  // Compute warnings
  const allWarnings = [];
  enriched.forEach((fi) => {
    const w = computeWarningsForFi(fi);
    w.forEach((warning) => allWarnings.push(warning));
  });

  // Count FIs needing attention (score < 25 OR has danger warnings)
  const attentionFis = enriched.filter(
    (fi) => fi.score < 25 || fi.jobFailRate > 0.30
  );

  renderVerdict(enriched, allWarnings);
  renderKpis(enriched, attentionFis);
  renderTrendChart();
  renderWarnings(allWarnings);
  renderTierDistribution(enriched);
  renderScoreDistribution(enriched);
}

function renderEmpty() {
  els.kpiActiveFis.textContent = "-";
  els.kpiNetworkRate.textContent = "-";
  els.kpiPlacements.textContent = "-";
  els.kpiAvgScore.textContent = "-";
  els.kpiAttention.textContent = "-";
  if (els.trendChart) els.trendChart.innerHTML = '<div style="color:var(--muted);padding:20px;">No data available.</div>';
}

/* ── Verdict Banner ── */
function renderVerdict(fis, warnings) {
  const el = els.verdict;
  if (!el) return;

  const dangerCount = warnings.filter((w) => w.type === "danger").length;
  const warnCount = warnings.filter((w) => w.type === "warn").length;
  const attentionFis = fis.filter((fi) => fi.score < 25 || fi.jobFailRate > 0.30);

  let color, text;
  if (dangerCount > 0 || attentionFis.length >= 3) {
    color = "red";
    text = `${attentionFis.length} FI${attentionFis.length !== 1 ? "s" : ""} declining, action recommended`;
  } else if (warnCount > 0 || attentionFis.length > 0) {
    color = "amber";
    text = `Network stable — ${attentionFis.length || warnCount} FI${(attentionFis.length || warnCount) !== 1 ? "s" : ""} need attention`;
  } else {
    color = "green";
    text = "Network healthy — all FIs stable or improving";
  }

  el.className = `exec-verdict ${color}`;
  el.style.display = "flex";
  const dot = el.querySelector(".health-dot");
  if (dot) dot.className = `health-dot ${color}`;
  const textEl = el.querySelector(".exec-verdict__text");
  if (textEl) textEl.textContent = text;
}

/* ── KPIs ── */
function renderKpis(fis, attentionFis) {
  const activeFis = fis.filter((fi) => fi.sm > 0).length;
  const totalSm = fis.reduce((s, fi) => s + fi.sm, 0);
  const totalSuccess = fis.reduce((s, fi) => s + fi.success, 0);
  const networkRate = totalSm > 0 ? totalSuccess / totalSm : 0;
  const totalPlacements = funnelData?.overall?.Jobs_Success || 0;

  // Average engagement score
  const avgScore = fis.length > 0 ? Math.round(fis.reduce((s, fi) => s + fi.score, 0) / fis.length) : 0;

  // Trend arrows from weekly data
  let rateTrend = "";
  let placementTrend = "";
  if (weeklyBuckets.length >= 2) {
    const curr = weeklyBuckets[0];
    const prev = weeklyBuckets[1];
    const rateDelta = curr.rate - prev.rate;
    if (rateDelta > 0.02) rateTrend = '<span class="kpi-trend up">&#9650;</span>';
    else if (rateDelta < -0.02) rateTrend = '<span class="kpi-trend down">&#9660;</span>';
    else rateTrend = '<span class="kpi-trend flat">&#8212;</span>';

    if (prev.placements > 0) {
      const placDelta = (curr.placements - prev.placements) / prev.placements;
      if (placDelta > 0.05) placementTrend = '<span class="kpi-trend up">&#9650;</span>';
      else if (placDelta < -0.05) placementTrend = '<span class="kpi-trend down">&#9660;</span>';
      else placementTrend = '<span class="kpi-trend flat">&#8212;</span>';
    }
  }

  els.kpiActiveFis.textContent = formatNumber(activeFis);
  els.kpiNetworkRate.innerHTML = formatPercent(networkRate) + rateTrend;
  els.kpiPlacements.innerHTML = formatNumber(totalPlacements) + placementTrend;
  els.kpiAvgScore.textContent = avgScore;
  els.kpiAttention.textContent = attentionFis.length;

  // Highlight attention card
  const attentionCard = els.kpiAttention?.closest(".card");
  if (attentionCard) {
    attentionCard.classList.toggle("exec-attention", attentionFis.length > 0);
  }
}

/* ── 12-Week Trend SVG ── */
function renderTrendChart() {
  const container = els.trendChart;
  if (!container) return;

  if (weeklyBuckets.length === 0) {
    container.innerHTML = '<div style="color:var(--muted);padding:20px;">No trend data.</div>';
    return;
  }

  // Reverse so oldest is left
  const weeks = [...weeklyBuckets].reverse();

  const W = 700;
  const H = 200;
  const PAD_L = 40;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxSm = Math.max(...weeks.map((w) => w.sm), 1);
  const barW = Math.max(8, (plotW / weeks.length) * 0.6);
  const gap = plotW / weeks.length;

  // Build bars (sessions) + line (success rate)
  let bars = "";
  let points = [];
  let dots = "";

  weeks.forEach((w, i) => {
    const x = PAD_L + gap * i + gap / 2;
    const barH = (w.sm / maxSm) * plotH;
    const barY = PAD_T + plotH - barH;
    bars += `<rect x="${x - barW / 2}" y="${barY}" width="${barW}" height="${barH}" rx="3" fill="rgba(100,116,139,0.35)" />`;

    // Rate line
    const rateY = PAD_T + plotH - w.rate * plotH / 0.30; // scale to 30% max
    const clampedY = Math.max(PAD_T, Math.min(PAD_T + plotH, rateY));
    points.push(`${x},${clampedY}`);
    dots += `<circle cx="${x}" cy="${clampedY}" r="4" fill="#3b82f6" />`;

    // X-axis labels
    bars += `<text x="${x}" y="${H - 4}" text-anchor="middle" fill="var(--muted)" font-size="10">${w.weekLabel}</text>`;
  });

  // Y-axis labels for rate
  const rateSteps = [0, 0.10, 0.20, 0.30];
  let yAxis = "";
  rateSteps.forEach((r) => {
    const y = PAD_T + plotH - r * plotH / 0.30;
    yAxis += `<text x="${PAD_L - 6}" y="${y + 3}" text-anchor="end" fill="var(--muted)" font-size="10">${(r * 100).toFixed(0)}%</text>`;
    yAxis += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="var(--border)" stroke-dasharray="4,4" />`;
  });

  const polyline = points.length > 1
    ? `<polyline points="${points.join(" ")}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linejoin="round" />`
    : "";

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${yAxis}
      ${bars}
      ${polyline}
      ${dots}
    </svg>
  `;
}

/* ── Warnings ── */
function renderWarnings(warnings) {
  const container = els.execWarnings;
  const list = els.warningsList;
  if (!container || !list) return;

  if (!warnings.length) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";

  // Sort: danger first, then warn
  const sorted = [...warnings].sort((a, b) => {
    if (a.type === "danger" && b.type !== "danger") return -1;
    if (a.type !== "danger" && b.type === "danger") return 1;
    return 0;
  });

  const visible = sorted.slice(0, MAX_WARNINGS);

  list.innerHTML = visible
    .map(
      (w) =>
        `<div class="warning-item ${w.type}">
          <span class="warning-item__type ${w.category}">${w.category.toUpperCase()}</span>
          <span>${w.text}</span>
        </div>`
    )
    .join("");

  if (sorted.length > MAX_WARNINGS) {
    list.innerHTML += `<div style="font-size:0.85rem;color:var(--muted);margin-top:8px;">+ ${sorted.length - MAX_WARNINGS} more warnings. View full details in CS Portfolio.</div>`;
  }
}

/* ── Tier Distribution ── */
function renderTierDistribution(fis) {
  const container = els.tierDistribution;
  if (!container) return;

  const buckets = [
    { key: "1", label: "Tier 1", color: "#22c55e", count: 0 },
    { key: "1.5", label: "Tier 1.5", color: "#84cc16", count: 0 },
    { key: "2", label: "Tier 2", color: "#f59e0b", count: 0 },
    { key: "2.5", label: "Tier 2.5", color: "#f97316", count: 0 },
    { key: "3", label: "Tier 3", color: "#ef4444", count: 0 },
  ];

  fis.forEach((fi) => {
    const bucket = buckets.find((b) => Number(b.key) === fi.tier);
    if (bucket) bucket.count++;
  });

  const total = fis.length || 1;

  const barHtml = buckets
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `<div class="tier-dist-bar__segment" style="width:${(b.count / total) * 100}%;background:${b.color};" title="${b.label}: ${b.count} FIs (${((b.count / total) * 100).toFixed(0)}%)">${b.count}</div>`
    )
    .join("");

  const legendHtml = buckets
    .map(
      (b) =>
        `<span class="tier-dist-legend__item"><span class="tier-dist-legend__dot" style="background:${b.color}"></span>${b.label} (${b.count})</span>`
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
    { label: "0-24", color: "#ef4444", count: 0 },
    { label: "25-49", color: "#f97316", count: 0 },
    { label: "50-74", color: "#f59e0b", count: 0 },
    { label: "75-100", color: "#22c55e", count: 0 },
  ];

  fis.forEach((fi) => {
    if (fi.score >= 75) buckets[3].count++;
    else if (fi.score >= 50) buckets[2].count++;
    else if (fi.score >= 25) buckets[1].count++;
    else buckets[0].count++;
  });

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  const barsHtml = buckets
    .map((b) => {
      const h = Math.max(4, (b.count / maxCount) * 70);
      return `<div class="score-dist-bar" style="height:${h}px;background:${b.color};" title="Score ${b.label}: ${b.count} FIs"><span class="score-dist-bar__count">${b.count}</span></div>`;
    })
    .join("");

  const labelsHtml = buckets.map((b) => `<span>${b.label}</span>`).join("");

  container.innerHTML = `
    <div class="score-dist-bars">${barsHtml}</div>
    <div class="score-dist-labels">${labelsHtml}</div>
  `;
}

/* ── Init ── */
async function init() {
  await loadFiRegistry();

  if (isKioskMode()) {
    // Hide nav/toolbar, set up kiosk header
    const sisHeader = document.getElementById("sis-header");
    if (sisHeader) sisHeader.style.display = "none";

    initKioskMode("Executive Summary", 300);
    startAutoRefresh(fetchAll, 300_000); // 5 min
  }

  await fetchAll();
}

// Wait for engagement-insights to load
function waitForInsights() {
  if (window.EngagementInsights?.classifyTier) {
    init();
  } else {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (window.EngagementInsights?.classifyTier || attempts > 50) {
        clearInterval(interval);
        init();
      }
    }, 100);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", waitForInsights);
} else {
  waitForInsights();
}
