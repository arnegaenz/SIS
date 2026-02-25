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
  formatRelativeTime,
  opsHealthColor,
  trafficHealthColor,
} from "./dashboard-utils.js";

const TIME_WINDOWS = [3, 30, 90, 180];

const STATUS_COLORS = {
  success: "#22c55e",
  failed: "#ef4444",
  cancelled: "#f59e0b",
  abandoned: "#64748b",
};

const els = {
  timeWindow: document.getElementById("timeWindow"),
  fiScope: document.getElementById("fiScope"),
  exportOps: document.getElementById("exportOps"),
  kpiTotalJobs: document.getElementById("kpiTotalJobs"),
  kpiSuccessRate: document.getElementById("kpiSuccessRate"),
  kpiFailureRate: document.getElementById("kpiFailureRate"),
  kpiTopMerchant: document.getElementById("kpiTopMerchant"),
  kpiTopMerchantDetail: document.getElementById("kpiTopMerchantDetail"),
  failureLineChart: document.getElementById("failureLineChart"),
  statusStack: document.getElementById("statusStack"),
  statusLegend: document.getElementById("statusLegend"),
  merchantTable: document.getElementById("merchantTable"),
  merchantTableMeta: document.getElementById("merchantTableMeta"),
  fiInstanceTable: document.getElementById("fiInstanceTable"),
  fiInstanceTableMeta: document.getElementById("fiInstanceTableMeta"),
};

const trafficEls = {
  section: document.getElementById("trafficHealthSection"),
  banner: document.getElementById("trafficHealthBanner"),
  grid: document.getElementById("trafficHealthGrid"),
  kioskWrap: document.getElementById("kioskTrafficHealth"),
  kioskBanner: document.getElementById("kioskTrafficBanner"),
  kioskGrid: document.getElementById("kioskTrafficGrid"),
  detailOverlay: document.getElementById("trafficDetailOverlay"),
  detailModal: document.getElementById("trafficDetailModal"),
  detailName: document.getElementById("trafficDetailName"),
  detailSubtitle: document.getElementById("trafficDetailSubtitle"),
  detailStats: document.getElementById("trafficDetailStats"),
  detailChart: document.getElementById("trafficDetailChart"),
  detailClose: document.getElementById("trafficDetailClose"),
};

const state = {
  windowDays: 30,
  fiScope: "all",
  fiList: [],
  instanceList: [],
  merchantList: [],
  data: null,
  trafficHealth: null,
  loading: false,
  merchantSortKey: "Jobs_Failed",
  merchantSortDir: "desc",
  fiSortKey: "Jobs_Failed",
  fiSortDir: "desc",
  includeTests: false,
  trafficShowNormal: false,
  trafficShowSleeping: false,
  feedFilters: {
    statuses: new Set(["success", "failed", "cancelled", "abandoned"]),
    merchants: new Set(),
    fis: new Set(),
    excludeDevInstance: true,
  },
};

const fiSelect = createMultiSelect(document.getElementById("fiSelect"), {
  placeholder: "All FIs",
  onChange: (values) => {
    state.fiList = values;
    fetchMetrics();
  },
});
const instanceSelect = createMultiSelect(document.getElementById("instanceSelect"), {
  placeholder: "All instances",
  onChange: (values) => {
    state.instanceList = values;
    fetchMetrics();
  },
});
const merchantSelect = createMultiSelect(document.getElementById("merchantSelect"), {
  placeholder: "All merchants",
  onChange: (values) => {
    state.merchantList = values;
    fetchMetrics();
  },
});

let currentController = null;

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
      fetchMetrics();
    });
    els.timeWindow.appendChild(button);
  });
}

function setLoading(isLoading) {
  state.loading = isLoading;
  if (els.exportOps) els.exportOps.disabled = isLoading || !state.data;
  if (els.merchantTableMeta) els.merchantTableMeta.textContent = isLoading ? "Loading…" : "";
  if (els.fiInstanceTableMeta) els.fiInstanceTableMeta.textContent = isLoading ? "Loading…" : "";
}

function renderKpis(overall, byMerchant) {
  const total = overall.Jobs_Total || 0;
  const success = overall.Jobs_Success || 0;
  const failed = overall.Jobs_Failed || 0;
  els.kpiTotalJobs.textContent = formatNumber(total);
  els.kpiSuccessRate.textContent = formatRate(success, total);
  els.kpiFailureRate.textContent = formatRate(failed, total);

  const top = byMerchant
    .map((row) => ({
      name: row.merchant_name,
      rate: row.Jobs_Total > 0 ? row.Jobs_Failed / row.Jobs_Total : 0,
    }))
    .sort((a, b) => b.rate - a.rate)[0];
  if (top && top.name) {
    els.kpiTopMerchant.textContent = top.name;
    els.kpiTopMerchantDetail.textContent = `Failure rate ${formatPercent(top.rate)}`;
  } else {
    els.kpiTopMerchant.textContent = "-";
    els.kpiTopMerchantDetail.textContent = "";
  }
}

function renderLineChart(byDay = []) {
  if (!byDay.length) {
    els.failureLineChart.innerHTML = `<div class="empty-state">No daily data.</div>`;
    return;
  }
  const width = els.failureLineChart.clientWidth || 600;
  const height = 220;
  const padding = 32;
  const points = byDay.map((row, idx) => {
    const rate = row.Jobs_Total > 0 ? row.Jobs_Failed / row.Jobs_Total : 0;
    return { index: idx, rate };
  });
  const maxRate = Math.max(...points.map((p) => p.rate), 0.05);
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const path = points
    .map((p, idx) => {
      const x = padding + idx * stepX;
      const y = height - padding - (p.rate / maxRate) * (height - padding * 2);
      return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  els.failureLineChart.innerHTML = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="failLine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="#ef4444" />
          <stop offset="100%" stop-color="#f97316" />
        </linearGradient>
      </defs>
      <rect x="${padding}" y="${padding}" width="${width - padding * 2}" height="${height - padding * 2}" fill="none" stroke="#e2e8f0" />
      <path d="${path}" fill="none" stroke="url(#failLine)" stroke-width="3" />
    </svg>
  `;
}

function renderStatusBreakdown(statusBreakdown = [], overall) {
  const total = overall.Jobs_Total || 0;
  const map = new Map(statusBreakdown.map((row) => [row.status, row.count]));
  const order = ["success", "failed", "cancelled", "abandoned"];
  els.statusStack.innerHTML = "";
  order.forEach((key) => {
    const count = map.get(key) || 0;
    const pct = total > 0 ? (count / total) * 100 : 0;
    const span = document.createElement("span");
    span.style.width = `${pct}%`;
    span.style.background = STATUS_COLORS[key];
    els.statusStack.appendChild(span);
  });
  els.statusLegend.innerHTML = order
    .map((key) => {
      const count = map.get(key) || 0;
      return `<span><i style="background:${STATUS_COLORS[key]}"></i>${key} ${formatRate(count, total)}</span>`;
    })
    .join("");
}

function addFailureRates(rows = []) {
  return rows.map((row) => ({
    ...row,
    failure_rate: row.Jobs_Total > 0 ? row.Jobs_Failed / row.Jobs_Total : 0,
  }));
}

function renderMerchantTable(rows) {
  const tbody = els.merchantTable.querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No merchant data for this view.</td></tr>`;
    els.merchantTableMeta.textContent = "No merchants";
    return;
  }
  const sorted = sortRows(rows, state.merchantSortKey, state.merchantSortDir).slice(0, 20);
  tbody.innerHTML = "";
  sorted.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.merchant_name || ""}</td>
      <td>${formatNumber(row.Jobs_Total || 0)}</td>
      <td>${formatNumber(row.Jobs_Failed || 0)}</td>
      <td>${formatPercent(row.failure_rate)}</td>
      <td>${row.top_error_code || "-"}</td>
    `;
    if (row.failure_rate > 0.2) tr.classList.add("hot");
    tbody.appendChild(tr);
  });
  els.merchantTableMeta.textContent = `${rows.length} merchants`;
}

function renderFiInstanceTable(rows) {
  const tbody = els.fiInstanceTable.querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No FI data for this view.</td></tr>`;
    els.fiInstanceTableMeta.textContent = "No FI entries";
    return;
  }
  const sorted = sortRows(rows, state.fiSortKey, state.fiSortDir);
  tbody.innerHTML = "";
  sorted.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.fi_name || ""}</td>
      <td>${row.instance || ""}</td>
      <td>${formatNumber(row.Jobs_Total || 0)}</td>
      <td>${formatNumber(row.Jobs_Failed || 0)}</td>
      <td>${formatPercent(row.failure_rate)}</td>
    `;
    if (row.failure_rate > 0.2) tr.classList.add("hot");
    tbody.appendChild(tr);
  });
  els.fiInstanceTableMeta.textContent = `${rows.length} FI entries`;
}

function updateMerchantFilters(byMerchant = []) {
  const options = byMerchant
    .map((row) => row.merchant_name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ label: value, value }));
  merchantSelect.setOptions(options);
}

function updateInstanceFilters(byFiInstance = []) {
  const instanceMap = new Map();
  byFiInstance.forEach((row) => {
    if (!row.instance) return;
    if (!instanceMap.has(row.instance)) instanceMap.set(row.instance, row.instance);
  });
  const options = Array.from(instanceMap.values())
    .sort()
    .map((value) => ({ label: value, value }));
  if (options.length) instanceSelect.setOptions(options);
}

async function loadInstances() {
  try {
    const res = await fetch("/instances");
    if (!res.ok) return;
    const json = await res.json();
    const entries = Array.isArray(json.instances) ? json.instances : [];
    const options = entries
      .map((entry) => entry.name || entry.instance || entry.id)
      .filter(Boolean)
      .map((value) => ({ label: value, value }));
    if (options.length) instanceSelect.setOptions(options);
  } catch (err) {
    console.warn("[operations] failed to load instances", err);
  }
}

async function loadFiRegistry() {
  const sources = [
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
      const map = new Map();
      values.forEach((entry) => {
        if (!entry) return;
        const key = (entry.fi_lookup_key || entry.fi_name || "").toString().trim();
        if (!key) return;
        if (map.has(key)) return;
        map.set(key, {
          value: key,
          label: entry.fi_name || key,
        });
      });
      const options = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
      fiSelect.setOptions(options);
      return;
    } catch (err) {
      // continue
    }
  }
  fiSelect.setOptions([{ value: "unknown", label: "Unknown FI" }]);
}

async function fetchMetrics() {
  if (currentController) currentController.abort();
  currentController = new AbortController();
  const { date_from, date_to } = buildDateRange(state.windowDays);
  const payload = {
    date_from,
    date_to,
    fi_scope: state.fiScope,
    fi_list: state.fiList,
    instance_list: state.instanceList,
    merchant_list: state.merchantList,
    includeTests: state.includeTests,
  };
  setLoading(true);
  try {
    const res = await fetch("/api/metrics/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: currentController.signal,
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    state.data = data;

    const overall = data.overall || {};
    const byDay = data.by_day || [];
    const byMerchant = addFailureRates(data.by_merchant || []);
    const byFiInstance = addFailureRates(data.by_fi_instance || []);

    if (isKioskMode()) {
      renderKioskView();
    } else {
      renderKpis(overall, byMerchant);
      renderLineChart(byDay);
      renderStatusBreakdown(data.status_breakdown || [], overall);
      renderMerchantTable(byMerchant);
      renderFiInstanceTable(byFiInstance);
      updateMerchantFilters(byMerchant);
      updateInstanceFilters(byFiInstance);
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("[operations] fetch failed", err);
    }
    state.data = null;
    renderMerchantTable([]);
    renderFiInstanceTable([]);
    els.failureLineChart.innerHTML = `<div class="empty-state">No data for this view.</div>`;
    els.statusStack.innerHTML = "";
    els.statusLegend.innerHTML = "";
    renderKpis({}, []);
  } finally {
    setLoading(false);
  }
}

function handleExportOps() {
  if (!state.data) return;
  const rows = addFailureRates(state.data.by_merchant || []);
  if (!rows.length) return;
  const header = [
    "Merchant",
    "Jobs Total",
    "Jobs Failed",
    "Failure Rate",
    "Top Error Code",
  ];
  const body = rows.map((row) => [
    row.merchant_name || "",
    row.Jobs_Total || 0,
    row.Jobs_Failed || 0,
    formatPercent(row.failure_rate),
    row.top_error_code || "-",
  ]);
  const ts = new Date().toISOString().replace(/[:]/g, "");
  downloadCsv(`operations-merchants-${state.windowDays}d-${ts}.csv`, [header, ...body]);
}

function bindSortHandlers() {
  attachSortHandlers(els.merchantTable, (key) => {
    if (state.merchantSortKey === key) {
      state.merchantSortDir = state.merchantSortDir === "asc" ? "desc" : "asc";
    } else {
      state.merchantSortKey = key;
      state.merchantSortDir = "desc";
    }
    renderMerchantTable(addFailureRates(state.data?.by_merchant || []));
  });
  attachSortHandlers(els.fiInstanceTable, (key) => {
    if (state.fiSortKey === key) {
      state.fiSortDir = state.fiSortDir === "asc" ? "desc" : "asc";
    } else {
      state.fiSortKey = key;
      state.fiSortDir = "desc";
    }
    renderFiInstanceTable(addFailureRates(state.data?.by_fi_instance || []));
  });
}

/* ── Kiosk Mode: Merchant Health Grid + Event Feed + Volume Chart ── */

const kioskEls = {
  kpiRow: document.getElementById("kioskKpiRow"),
  split: document.getElementById("kioskSplit"),
  merchantGrid: document.getElementById("kioskMerchantGrid"),
  volumeChart: document.getElementById("kioskVolumeChart"),
  eventList: document.getElementById("kioskEventList"),
};

let priorOverall = null;
let priorByDay = [];
let merchantTrends = new Map(); // merchant_name → { priorFailRate, trend }

async function fetchOpsTrends() {
  // Compare this week (last 7d) vs prior week (8-14d ago)
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const priorEnd = new Date(end);
  priorEnd.setUTCDate(end.getUTCDate() - 7);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorEnd.getUTCDate() - 6);

  try {
    const res = await fetch("/api/metrics/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date_from: priorStart.toISOString().slice(0, 10),
        date_to: priorEnd.toISOString().slice(0, 10),
        includeTests: state.includeTests,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    priorOverall = data.overall || {};
    priorByDay = (data.by_day || []).slice().sort((a, b) => a.date.localeCompare(b.date));

    // Build per-merchant prior failure rates
    merchantTrends.clear();
    const priorMerchants = data.by_merchant || [];
    priorMerchants.forEach((m) => {
      const name = m.merchant_name || "";
      if (!name) return;
      const total = m.Jobs_Total || 0;
      const failed = m.Jobs_Failed || 0;
      merchantTrends.set(name, {
        priorFailRate: total > 0 ? failed / total : 0,
        priorTotal: total,
      });
    });
  } catch (err) {
    console.warn("[ops-kiosk] trend fetch failed", err);
  }
}

function opsTrendArrow(currentRate, priorRate, invertColor) {
  // invertColor: for failure rate, "up" is bad (red), "down" is good (green)
  const delta = currentRate - priorRate;
  if (Math.abs(delta) < 0.02) return `<span style="color:#64748b;font-size:0.7rem;" title="Flat (${formatPercent(delta, 1)})">&#9644;</span>`;
  if (delta > 0) {
    const color = invertColor ? "#ef4444" : "#22c55e";
    return `<span style="color:${color};font-size:0.85rem;" title="${invertColor ? "Worse" : "Better"} (${formatPercent(delta, 1)})">&#9650;</span>`;
  }
  const color = invertColor ? "#22c55e" : "#ef4444";
  return `<span style="color:${color};font-size:0.85rem;" title="${invertColor ? "Better" : "Worse"} (${formatPercent(delta, 1)})">&#9660;</span>`;
}

function kpiDelta(current, prior, label) {
  if (!Number.isFinite(prior) || prior === 0) return "";
  const delta = current - prior;
  const pctChange = prior > 0 ? delta / prior : 0;
  const sign = delta >= 0 ? "+" : "";
  return `<div class="kpi-delta" style="color:#a8b3cf;font-size:0.75rem;margin-top:4px;">${sign}${formatPercent(pctChange, 1)} vs prior wk</div>`;
}

function buildKpiSparkline(values, priorValues, color, isRate) {
  if (!values.length) return "";
  const w = 260, h = 56, pad = 4;
  // Prior week average (single horizontal line)
  const priorAvg = (priorValues && priorValues.length)
    ? priorValues.reduce((s, v) => s + v, 0) / priorValues.length
    : null;
  const allVals = priorAvg != null ? [...values, priorAvg] : values;
  const max = Math.max(...allVals, isRate ? 1 : 1);
  const min = isRate ? 0 : Math.min(...allVals, 0);
  const range = max - min || 1;

  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });

  const firstX = pad;
  const lastX = pad + ((values.length - 1) / Math.max(values.length - 1, 1)) * (w - pad * 2);
  const areaPath = `M${pts[0]} ${pts.slice(1).map(p => `L${p}`).join(" ")} L${lastX},${h - pad} L${firstX},${h - pad} Z`;

  let avgLine = "";
  if (priorAvg != null) {
    const avgY = pad + (1 - (priorAvg - min) / range) * (h - pad * 2);
    avgLine = `<line x1="${pad}" y1="${avgY}" x2="${w - pad}" y2="${avgY}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.45" stroke-dasharray="6,4" />`;
  }

  return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${areaPath}" fill="${color}" fill-opacity="0.12" />
    ${avgLine}
    <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

function renderKioskKpis(overall, byMerchant, byDay) {
  if (!kioskEls.kpiRow) return;
  const total = overall.Jobs_Total || 0;
  const success = overall.Jobs_Success || 0;
  const failed = overall.Jobs_Failed || 0;
  const activeMerchants = byMerchant.filter((m) => (m.Jobs_Total || 0) > 0).length;
  const successRate = total > 0 ? success / total : 0;
  const failRate = total > 0 ? failed / total : 0;

  const pTotal = priorOverall?.Jobs_Total || 0;
  const pSuccess = priorOverall?.Jobs_Success || 0;
  const pFailed = priorOverall?.Jobs_Failed || 0;
  const pSuccessRate = pTotal > 0 ? pSuccess / pTotal : 0;
  const pFailRate = pTotal > 0 ? pFailed / pTotal : 0;

  const successTrend = pTotal > 0 ? opsTrendArrow(successRate, pSuccessRate, false) : "";
  const failTrend = pTotal > 0 ? opsTrendArrow(failRate, pFailRate, true) : "";

  // Build daily sparkline data — current week
  const sorted = (byDay || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const dailyJobs = sorted.map(d => d.Jobs_Total || 0);
  const dailySuccessRate = sorted.map(d => d.Jobs_Total > 0 ? (d.Jobs_Success || 0) / d.Jobs_Total : 0);
  const dailyFailRate = sorted.map(d => d.Jobs_Total > 0 ? (d.Jobs_Failed || 0) / d.Jobs_Total : 0);
  const dailyMerchants = sorted.map(d => d.merchants_active || 0);

  // Prior week daily data (dashed comparison line)
  const priorJobs = priorByDay.map(d => d.Jobs_Total || 0);
  const priorSuccessRate = priorByDay.map(d => d.Jobs_Total > 0 ? (d.Jobs_Success || 0) / d.Jobs_Total : 0);
  const priorFailRate = priorByDay.map(d => d.Jobs_Total > 0 ? (d.Jobs_Failed || 0) / d.Jobs_Total : 0);
  const priorMerchants = priorByDay.map(d => d.merchants_active || 0);

  // Build verbose tooltips
  const avgDailyJobs = dailyJobs.length ? (dailyJobs.reduce((a, b) => a + b, 0) / dailyJobs.length).toFixed(1) : "0";
  const priorAvgDailyJobs = priorJobs.length ? (priorJobs.reduce((a, b) => a + b, 0) / priorJobs.length).toFixed(1) : "N/A";
  const peakDay = sorted.length ? sorted.reduce((best, d) => (d.Jobs_Total || 0) > (best.Jobs_Total || 0) ? d : best, sorted[0]) : null;
  const lowDay = sorted.length ? sorted.reduce((worst, d) => (d.Jobs_Total || 0) < (worst.Jobs_Total || 0) ? d : worst, sorted[0]) : null;

  const tipJobs = [
    `TOTAL JOBS (7-Day Window)`,
    `Total placement jobs across all merchants and FIs.`,
    ``,
    `This week: ${formatNumber(total)} jobs (${avgDailyJobs}/day avg)`,
    `Prior week: ${formatNumber(pTotal)} jobs (${priorAvgDailyJobs}/day avg)`,
    peakDay ? `Peak day: ${peakDay.date} (${formatNumber(peakDay.Jobs_Total)} jobs)` : "",
    lowDay ? `Lowest day: ${lowDay.date} (${formatNumber(lowDay.Jobs_Total)} jobs)` : "",
    ``,
    `Sparkline: solid line = this week daily volume.`,
    `Dashed line = prior week daily average.`,
    `Above the line = higher volume than last week.`,
  ].filter(Boolean).join("\n");

  const bestSuccessDay = sorted.length ? sorted.reduce((best, d) => {
    const r = d.Jobs_Total > 0 ? (d.Jobs_Success || 0) / d.Jobs_Total : 0;
    const br = best.Jobs_Total > 0 ? (best.Jobs_Success || 0) / best.Jobs_Total : 0;
    return r > br ? d : best;
  }, sorted[0]) : null;
  const worstSuccessDay = sorted.length ? sorted.reduce((worst, d) => {
    const r = d.Jobs_Total > 0 ? (d.Jobs_Success || 0) / d.Jobs_Total : 1;
    const wr = worst.Jobs_Total > 0 ? (worst.Jobs_Success || 0) / worst.Jobs_Total : 1;
    return r < wr ? d : worst;
  }, sorted[0]) : null;

  const tipSuccess = [
    `SUCCESS RATE`,
    `Percentage of placement jobs that completed successfully.`,
    ``,
    `This week: ${formatRate(success, total)} (${formatNumber(success)} of ${formatNumber(total)} jobs)`,
    `Prior week: ${pTotal > 0 ? formatRate(pSuccess, pTotal) : "N/A"} (${formatNumber(pSuccess)} of ${formatNumber(pTotal)} jobs)`,
    bestSuccessDay ? `Best day: ${bestSuccessDay.date} (${formatPercent(bestSuccessDay.Jobs_Total > 0 ? bestSuccessDay.Jobs_Success / bestSuccessDay.Jobs_Total : 0)})` : "",
    worstSuccessDay ? `Worst day: ${worstSuccessDay.date} (${formatPercent(worstSuccessDay.Jobs_Total > 0 ? worstSuccessDay.Jobs_Success / worstSuccessDay.Jobs_Total : 1)})` : "",
    ``,
    `Thresholds: Green >= 85% | Amber >= 70% | Red < 70%`,
    `Sparkline: solid line = daily success rate.`,
    `Dashed line = prior week daily average rate.`,
  ].filter(Boolean).join("\n");

  const tipFail = [
    `FAILURE RATE`,
    `Percentage of placement jobs that failed (credential errors, site issues, timeouts).`,
    ``,
    `This week: ${formatRate(failed, total)} (${formatNumber(failed)} of ${formatNumber(total)} jobs)`,
    `Prior week: ${pTotal > 0 ? formatRate(pFailed, pTotal) : "N/A"} (${formatNumber(pFailed)} of ${formatNumber(pTotal)} jobs)`,
    `Cancelled: ${formatNumber(overall.Jobs_Cancelled || 0)} | Abandoned: ${formatNumber(overall.Jobs_Abandoned || 0)}`,
    ``,
    `Rising failure rate may indicate merchant site changes,`,
    `credential flow issues, or degraded infrastructure.`,
    `Sparkline: solid line = daily failure rate.`,
    `Dashed line = prior week daily average rate.`,
  ].filter(Boolean).join("\n");

  const avgDailyMerchants = dailyMerchants.length ? (dailyMerchants.reduce((a, b) => a + b, 0) / dailyMerchants.length).toFixed(1) : "0";
  const tipMerchants = [
    `ACTIVE MERCHANTS`,
    `Number of distinct merchant sites with at least one placement job.`,
    ``,
    `This week: ${formatNumber(activeMerchants)} active merchants`,
    `Daily average: ${avgDailyMerchants} merchants/day`,
    `Total merchants in system: ${formatNumber(byMerchant.length)}`,
    ``,
    `A drop in active merchants may indicate site outages`,
    `or reduced cardholder activity at specific retailers.`,
    `Sparkline: solid line = daily active merchant count.`,
    `Dashed line = prior week daily average.`,
  ].filter(Boolean).join("\n");

  kioskEls.kpiRow.innerHTML = `
    <div class="card kpi-spark-card" title="${tipJobs}">
      <div class="kpi-spark-left">
        <h3>Total Jobs (7d)</h3>
        <div class="kpi-value">${formatNumber(total)}</div>
        ${kpiDelta(total, pTotal, "jobs")}
      </div>
      <div class="kpi-spark-right">${buildKpiSparkline(dailyJobs, priorJobs, "#60a5fa", false)}</div>
    </div>
    <div class="card kpi-spark-card" title="${tipSuccess}">
      <div class="kpi-spark-left">
        <h3>Success Rate ${successTrend}</h3>
        <div class="kpi-value" style="color:${successRate >= 0.85 ? "#22c55e" : successRate >= 0.70 ? "#f59e0b" : "#ef4444"}">${formatRate(success, total)}</div>
        ${pTotal > 0 ? `<div class="kpi-delta" style="color:#a8b3cf;font-size:0.75rem;margin-top:4px;">Prior wk: ${formatRate(pSuccess, pTotal)}</div>` : ""}
      </div>
      <div class="kpi-spark-right">${buildKpiSparkline(dailySuccessRate, priorSuccessRate, "#22c55e", true)}</div>
    </div>
    <div class="card kpi-spark-card" title="${tipFail}">
      <div class="kpi-spark-left">
        <h3>Failure Rate ${failTrend}</h3>
        <div class="kpi-value">${formatRate(failed, total)}</div>
        ${pTotal > 0 ? `<div class="kpi-delta" style="color:#a8b3cf;font-size:0.75rem;margin-top:4px;">Prior wk: ${formatRate(pFailed, pTotal)}</div>` : ""}
      </div>
      <div class="kpi-spark-right">${buildKpiSparkline(dailyFailRate, priorFailRate, "#ef4444", true)}</div>
    </div>
    <div class="card kpi-spark-card" title="${tipMerchants}">
      <div class="kpi-spark-left">
        <h3>Active Merchants</h3>
        <div class="kpi-value">${formatNumber(activeMerchants)}</div>
      </div>
      <div class="kpi-spark-right">${buildKpiSparkline(dailyMerchants, priorMerchants, "#a78bfa", false)}</div>
    </div>
  `;
}

function renderMerchantHealthGrid(rows) {
  if (!kioskEls.merchantGrid) return;
  const sorted = [...rows]
    .filter((r) => (r.Jobs_Total || 0) > 0)
    .sort((a, b) => (b.Jobs_Total || 0) - (a.Jobs_Total || 0));

  kioskEls.merchantGrid.innerHTML = "";
  sorted.slice(0, 30).forEach((row) => {
    const successRate = row.Jobs_Total > 0 ? (row.Jobs_Success || 0) / row.Jobs_Total : 1;
    const failRate = row.failure_rate || 0;
    const color = opsHealthColor(successRate);
    const name = row.merchant_name || "Unknown";
    const prior = merchantTrends.get(name);
    const trend = prior ? opsTrendArrow(failRate, prior.priorFailRate, true) : "";

    const severity = failRate >= 0.4 ? 'merchant-tile--danger' : failRate > 0.15 ? 'merchant-tile--warn' : '';

    // Build verbose tooltip
    const priorFailStr = prior ? formatPercent(prior.priorFailRate) : "N/A";
    const priorTotalStr = prior ? formatNumber(prior.priorTotal) : "N/A";
    const trendLabel = prior
      ? (Math.abs(failRate - prior.priorFailRate) < 0.02 ? "Stable" : failRate > prior.priorFailRate ? "Worsening" : "Improving")
      : "No prior data";
    const severityLabel = failRate >= 0.4 ? "CRITICAL (>=40% failure)"
      : failRate > 0.15 ? "ELEVATED (>15% failure)"
      : successRate >= 0.85 ? "HEALTHY (>=85% success)"
      : "MODERATE";
    const topErr = row.top_error_code || "None";
    const tipMerch = [
      `${name.toUpperCase()}`,
      `Status: ${severityLabel}`,
      ``,
      `This week:`,
      `  Total jobs: ${formatNumber(row.Jobs_Total || 0)}`,
      `  Successful: ${formatNumber(row.Jobs_Success || 0)} (${formatPercent(successRate)})`,
      `  Failed: ${formatNumber(row.Jobs_Failed || 0)} (${formatPercent(failRate)})`,
      `  Top error: ${topErr}`,
      ``,
      `Prior week:`,
      `  Total jobs: ${priorTotalStr}`,
      `  Failure rate: ${priorFailStr}`,
      `  Trend: ${trendLabel}`,
      ``,
      `Click to open detail modal with full breakdown,`,
      `week-over-week comparison, and recent activity.`,
    ].join("\n");

    const tile = document.createElement("div");
    tile.className = `merchant-tile ${severity}`;
    tile.title = tipMerch;
    tile.innerHTML = `
      <div class="merchant-tile__header">
        <span class="merchant-tile__name">${name}</span>
        <span style="display:flex;align-items:center;gap:4px;">${trend} <span class="health-dot ${color}"></span></span>
      </div>
      <div class="merchant-tile__metrics">
        <div class="merchant-tile__metric">
          <span class="merchant-tile__metric-value">${formatNumber(row.Jobs_Total || 0)}</span>
          <span class="merchant-tile__metric-label">Jobs</span>
        </div>
        <div class="merchant-tile__metric">
          <span class="merchant-tile__metric-value">${formatPercent(successRate)}</span>
          <span class="merchant-tile__metric-label">Success</span>
        </div>
        <div class="merchant-tile__metric">
          <span class="merchant-tile__metric-value">${formatNumber(row.Jobs_Failed || 0)}</span>
          <span class="merchant-tile__metric-label">Failed</span>
        </div>
        <div class="merchant-tile__metric">
          <span class="merchant-tile__metric-value">${formatPercent(failRate)}</span>
          <span class="merchant-tile__metric-label">Fail Rate</span>
        </div>
      </div>
    `;
    tile.addEventListener("click", () => renderMerchantDetailModal(row, prior));
    kioskEls.merchantGrid.appendChild(tile);
  });
}

function renderMerchantDetailModal(row, prior) {
  const existing = document.getElementById("merchantDetailModal");
  if (existing) existing.remove();

  const name = row.merchant_name || "Unknown";
  const total = row.Jobs_Total || 0;
  const success = row.Jobs_Success || 0;
  const failed = row.Jobs_Failed || 0;
  const other = Math.max(0, total - success - failed);
  const failRate = row.failure_rate || 0;
  const successRate = total > 0 ? success / total : 1;
  const color = opsHealthColor(successRate);
  const topError = row.top_error_code || "None";

  // Bar widths
  const successPct = total > 0 ? (success / total) * 100 : 100;
  const failPct = total > 0 ? (failed / total) * 100 : 0;
  const otherPct = total > 0 ? (other / total) * 100 : 0;

  // Week-over-week comparison
  let wowHtml = "";
  if (prior) {
    const priorFailRate = prior.priorFailRate || 0;
    const priorTotal = prior.priorTotal || 0;
    const delta = failRate - priorFailRate;
    const deltaSign = delta >= 0 ? "+" : "";
    const deltaColor = Math.abs(delta) < 0.02 ? "#64748b" : delta > 0 ? "#ef4444" : "#22c55e";
    const deltaLabel = Math.abs(delta) < 0.02 ? "Stable" : delta > 0 ? "Worsening" : "Improving";
    wowHtml = `
      <div class="detail-modal__section-title">Week-over-Week</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:2px;">Prior Week</div>
          <div style="font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;">${formatPercent(priorFailRate)} fail</div>
          <div style="font-size:0.75rem;color:var(--muted);">${formatNumber(priorTotal)} jobs</div>
        </div>
        <div>
          <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:2px;">This Week</div>
          <div style="font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;">${formatPercent(failRate)} fail</div>
          <div style="font-size:0.75rem;color:var(--muted);">${formatNumber(total)} jobs</div>
        </div>
        <div>
          <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:2px;">Trend</div>
          <div style="font-weight:700;color:${deltaColor};font-variant-numeric:tabular-nums;">${deltaSign}${(delta * 100).toFixed(1)}pp</div>
          <div style="font-size:0.75rem;color:${deltaColor};">${deltaLabel}</div>
        </div>
      </div>
    `;
  }

  // Top error section
  const errorHtml = topError !== "None" ? `
    <div class="detail-modal__section-title">Top Error Code</div>
    <div style="font-family:monospace;font-size:0.85rem;color:var(--text);padding:8px 12px;background:var(--bg);border-radius:8px;margin-bottom:16px;">${topError}</div>
  ` : "";

  // Recent events for this merchant from today's feed
  const feedEvents = (state.feedEvents || []).filter(
    (evt) => (evt.merchant || "").toLowerCase() === name.toLowerCase()
  );
  const recentEvents = feedEvents.slice(0, 10);
  let eventsHtml = "";
  if (recentEvents.length) {
    const eventRows = recentEvents.map((evt) => {
      const statusCls = evt.status === "success" ? "color:#22c55e" : evt.status === "pending" ? "color:#f59e0b" : "color:#ef4444";
      const time = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const termLabel = evt.termination_type && evt.status !== "success" ? `<span style="font-family:monospace;font-size:0.72rem;color:var(--muted);margin-left:6px;">${evt.termination_type}</span>` : "";
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:0.75rem;color:var(--muted);min-width:48px;font-variant-numeric:tabular-nums;">${time}</span>
          <span style="font-size:0.78rem;color:var(--text);flex:1;">${evt.fi_name || ""}</span>
          <span style="font-size:0.75rem;font-weight:600;${statusCls};text-transform:uppercase;">${evt.status || ""}</span>
          ${termLabel}
        </div>
      `;
    }).join("");
    const countNote = feedEvents.length > 10 ? ` <span style="color:var(--muted);font-weight:400;">(showing 10 of ${feedEvents.length})</span>` : "";
    eventsHtml = `
      <div class="detail-modal__section-title">Recent Activity (24h)${countNote}</div>
      <div style="margin-bottom:16px;">${eventRows}</div>
    `;
  } else {
    eventsHtml = `
      <div class="detail-modal__section-title">Recent Activity (24h)</div>
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:16px;">No events for this merchant in the last 24 hours.</div>
    `;
  }

  const overlay = document.createElement("div");
  overlay.id = "merchantDetailModal";
  overlay.className = "detail-modal-overlay";
  overlay.innerHTML = `
    <div class="detail-modal">
      <div class="detail-modal__header">
        <div>
          <span class="detail-modal__name">${name}</span>
          <span class="health-dot ${color}" style="margin-left:8px;"></span>
          ${failRate >= 0.4 ? '<span style="margin-left:8px;background:#ef4444;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">CRITICAL</span>' : failRate > 0.15 ? '<span style="margin-left:8px;background:#f59e0b;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">ELEVATED</span>' : ''}
        </div>
        <button class="detail-modal__close" type="button">&times;</button>
      </div>
      <div class="merchant-modal__bar">
        <div class="merchant-modal__bar-success" style="width:${successPct}%;" title="Success: ${formatNumber(success)} (${formatPercent(successRate)})"></div>
        <div class="merchant-modal__bar-other" style="width:${otherPct}%;" title="Other: ${formatNumber(other)}"></div>
        <div class="merchant-modal__bar-fail" style="width:${failPct}%;" title="Failed: ${formatNumber(failed)} (${formatPercent(failRate)})"></div>
      </div>
      <div style="display:flex;gap:16px;font-size:0.75rem;color:var(--muted);margin-bottom:20px;">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#22c55e;margin-right:4px;vertical-align:middle;"></span>Success ${formatPercent(successRate)}</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#ef4444;margin-right:4px;vertical-align:middle;"></span>Failed ${formatPercent(failRate)}</span>
        ${other > 0 ? `<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#64748b;margin-right:4px;vertical-align:middle;"></span>Other ${formatPercent(other / total)}</span>` : ""}
      </div>
      <div class="detail-modal__stats">
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatNumber(total)}</span>
          <span class="partner-detail-panel__stat-label">Total Jobs</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatNumber(success)}</span>
          <span class="partner-detail-panel__stat-label">Successful</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatNumber(failed)}</span>
          <span class="partner-detail-panel__stat-label">Failed</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatPercent(successRate)}</span>
          <span class="partner-detail-panel__stat-label">Success Rate</span>
        </div>
      </div>
      ${wowHtml}
      ${errorHtml}
      ${eventsHtml}
    </div>
  `;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeMerchantModal();
  });
  overlay.querySelector(".detail-modal__close").addEventListener("click", closeMerchantModal);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function closeMerchantModal() {
  const modal = document.getElementById("merchantDetailModal");
  if (modal) {
    modal.classList.remove("open");
    setTimeout(() => modal.remove(), 200);
  }
}

function renderVolumeSparkline(byDay) {
  if (!kioskEls.volumeChart) return;
  // Add tooltip to volume chart container
  const totalVol = byDay.reduce((s, d) => s + (d.Jobs_Total || 0), 0);
  const totalSuccess = byDay.reduce((s, d) => s + (d.Jobs_Success || 0), 0);
  const totalFailed = byDay.reduce((s, d) => s + (d.Jobs_Failed || 0), 0);
  const volTip = [
    `PLACEMENT VOLUME (${byDay.length} days)`,
    `Daily placement job volume across all merchants and FIs.`,
    ``,
    `Total jobs: ${formatNumber(totalVol)}`,
    `Successful: ${formatNumber(totalSuccess)} (${totalVol > 0 ? formatPercent(totalSuccess / totalVol) : "0%"})`,
    `Failed: ${formatNumber(totalFailed)} (${totalVol > 0 ? formatPercent(totalFailed / totalVol) : "0%"})`,
    ``,
    `Green area = successful placements.`,
    `Gray area = total placements (gap = failed + cancelled).`,
    `Y-axis = job count. X-axis = date.`,
  ].join("\n");
  kioskEls.volumeChart.title = volTip;

  if (!byDay.length) {
    kioskEls.volumeChart.innerHTML = `<div class="empty-state">No daily data.</div>`;
    return;
  }

  const vw = 500;
  const vh = 180;
  const padL = 44; // left padding for Y-axis labels
  const padR = 12;
  const padT = 12;
  const padB = 24; // bottom for date labels
  const maxVal = Math.max(...byDay.map((d) => d.Jobs_Total || 0), 1);
  const plotW = vw - padL - padR;
  const plotH = vh - padT - padB;
  const stepX = byDay.length > 1 ? plotW / (byDay.length - 1) : 0;

  // Success area
  const successPoints = byDay.map((d, i) => {
    const x = padL + i * stepX;
    const y = padT + plotH - ((d.Jobs_Success || 0) / maxVal) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  // Total area
  const totalPoints = byDay.map((d, i) => {
    const x = padL + i * stepX;
    const y = padT + plotH - ((d.Jobs_Total || 0) / maxVal) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const totalPath = `M${totalPoints.join(" L")}`;
  const successPath = `M${successPoints.join(" L")}`;
  const baselineY = padT + plotH;
  const rightX = padL + (byDay.length - 1) * stepX;
  const totalArea = `${totalPath} L${rightX.toFixed(1)},${baselineY} L${padL},${baselineY} Z`;
  const successArea = `${successPath} L${rightX.toFixed(1)},${baselineY} L${padL},${baselineY} Z`;

  // Y-axis ticks (0, mid, max)
  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  const yTickSvg = yTicks.map((val) => {
    const y = padT + plotH - (val / maxVal) * plotH;
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${vw - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,3" />
      <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#64748b" font-size="9" font-variant="tabular-nums">${formatNumber(val)}</text>
    `;
  }).join("");

  // Date labels
  const dateIndices = [0, Math.floor(byDay.length / 2), byDay.length - 1];
  const dateLabelSvg = dateIndices.map((i) => {
    const x = padL + i * stepX;
    return `<text x="${x.toFixed(1)}" y="${vh - 4}" text-anchor="middle" fill="#64748b" font-size="9">${(byDay[i].date || "").slice(5)}</text>`;
  }).join("");

  kioskEls.volumeChart.innerHTML = `
    <svg width="100%" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" style="display:block;">
      ${yTickSvg}
      <path d="${totalArea}" fill="rgba(122,162,255,0.12)" />
      <path d="${totalPath}" fill="none" stroke="#7aa2ff" stroke-width="2" />
      <path d="${successArea}" fill="rgba(34,197,94,0.12)" />
      <path d="${successPath}" fill="none" stroke="#22c55e" stroke-width="2" />
      ${dateLabelSvg}
    </svg>
    <div class="legend" style="margin-top:4px;">
      <span><i style="background:#7aa2ff"></i>Total Jobs</span>
      <span><i style="background:#22c55e"></i>Successful</span>
    </div>
  `;
}

async function fetchEventFeed() {
  if (!kioskEls.eventList) return;
  try {
    const res = await fetch("/api/metrics/ops-feed");
    if (!res.ok) return;
    const data = await res.json();
    state.feedEvents = data.events || [];
    updateFeedFilterOptions();
    renderFilteredFeed();
  } catch (err) {
    console.warn("[ops-kiosk] event feed failed", err);
  }
}

function renderFilteredFeed() {
  if (!kioskEls.eventList) return;
  const { statuses, merchants, fis, excludeDevInstance } = state.feedFilters;
  const events = (state.feedEvents || []).filter((evt) => {
    if (excludeDevInstance && evt.instance === "customer-dev") return false;
    if (!statuses.has(evt.status || "unknown")) return false;
    if (merchants.size > 0 && !merchants.has(evt.merchant || "Unknown")) return false;
    if (fis.size > 0 && !fis.has(evt.fi_name || "")) return false;
    return true;
  });
  const colHeader = `<div class="event-feed__item event-feed__item--header">
    <span class="event-feed__time">Time</span>
    <span class="event-feed__merchant">Merchant</span>
    <span class="event-feed__fi">FI</span>
    <span class="event-feed__status">Status</span>
  </div>`;
  if (!events.length) {
    kioskEls.eventList.innerHTML = colHeader + `<div class="empty-state">No events match filters.</div>`;
    return;
  }
  kioskEls.eventList.innerHTML = colHeader + events
    .map((evt) => {
      const s = evt.status || "unknown";
      const statusClass = s === "success" ? "success" : s === "cancelled" ? "cancelled" : s === "abandoned" ? "abandoned" : s === "pending" ? "pending" : "failed";
      const fullTime = evt.timestamp ? new Date(evt.timestamp).toLocaleString() : "Unknown";
      const termInfo = evt.termination_type ? `Termination: ${evt.termination_type}` : "No termination code";
      const evtTip = `${evt.merchant || "Unknown"} — ${evt.fi_name || "Unknown FI"}\nStatus: ${s}\nTimestamp: ${fullTime}\n${termInfo}\n\nThis is a single card placement job. Each job represents\none cardholder attempting to update their card at this merchant.`;
      return `
        <div class="event-feed__item" title="${evtTip.replace(/"/g, '&quot;')}">
          <span class="event-feed__time">${formatRelativeTime(evt.timestamp)}</span>
          <span class="event-feed__merchant">${evt.merchant || "Unknown"}</span>
          <span class="event-feed__fi">${evt.fi_name || ""}</span>
          <span class="event-feed__status ${statusClass}">${s}</span>
        </div>
      `;
    })
    .join("");
}

function updateFeedFilterOptions() {
  const merchantSet = new Set();
  const fiSet = new Set();
  (state.feedEvents || []).forEach((evt) => {
    if (evt.merchant) merchantSet.add(evt.merchant);
    if (evt.fi_name) fiSet.add(evt.fi_name);
  });
  renderMiniSelectOptions("feedMerchantSelect", Array.from(merchantSet).sort(), state.feedFilters.merchants);
  renderMiniSelectOptions("feedFiSelect", Array.from(fiSet).sort(), state.feedFilters.fis);
}

function renderMiniSelectOptions(containerId, options, selectedSet) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const optionsEl = container.querySelector(".feed-mini-select__options");
  if (!optionsEl) return;
  const searchEl = container.querySelector(".feed-mini-select__search");
  const query = (searchEl?.value || "").toLowerCase();
  const filtered = query ? options.filter((o) => o.toLowerCase().includes(query)) : options;
  optionsEl.innerHTML = filtered
    .map((val) => {
      const checked = selectedSet.has(val) ? "checked" : "";
      return `<label class="feed-mini-select__option"><input type="checkbox" value="${val.replace(/"/g, "&quot;")}" ${checked} />${val}</label>`;
    })
    .join("");
}

function updateClearBtnVisibility() {
  const clearBtn = document.getElementById("feedClearBtn");
  if (!clearBtn) return;
  const isDefault = state.feedFilters.statuses.size === 4 && state.feedFilters.merchants.size === 0 && state.feedFilters.fis.size === 0;
  clearBtn.style.display = isDefault ? "none" : "";
}

function updateMiniSelectBtnState(id, selectedSet) {
  const container = document.getElementById(id);
  if (!container) return;
  const btn = container.querySelector(".feed-mini-select__btn");
  if (btn) btn.classList.toggle("has-selection", selectedSet.size > 0);
}

function initFeedFilters() {
  const pillsEl = document.getElementById("feedStatusPills");
  if (!pillsEl) return;

  const FEED_STATUSES = [
    { key: "success", label: "OK", color: "#22c55e" },
    { key: "failed", label: "Fail", color: "#ef4444" },
    { key: "cancelled", label: "Cxl", color: "#f59e0b" },
    { key: "abandoned", label: "Abn", color: "#64748b" },
  ];
  pillsEl.innerHTML = FEED_STATUSES.map((s) =>
    `<button type="button" class="feed-status-pill active" data-status="${s.key}"><span class="feed-status-pill__dot" style="background:${s.color}"></span>${s.label}</button>`
  ).join("");

  pillsEl.addEventListener("click", (e) => {
    const pill = e.target.closest(".feed-status-pill");
    if (!pill) return;
    const key = pill.dataset.status;
    const { statuses } = state.feedFilters;
    if (statuses.has(key)) {
      if (statuses.size <= 1) return;
      statuses.delete(key);
      pill.classList.remove("active");
    } else {
      statuses.add(key);
      pill.classList.add("active");
    }
    updateClearBtnVisibility();
    renderFilteredFeed();
  });

  ["feedMerchantSelect", "feedFiSelect"].forEach((id) => {
    const container = document.getElementById(id);
    if (!container) return;
    const btn = container.querySelector(".feed-mini-select__btn");
    const panel = container.querySelector(".feed-mini-select__panel");
    const searchInput = container.querySelector(".feed-mini-select__search");
    const setRef = id === "feedMerchantSelect" ? state.feedFilters.merchants : state.feedFilters.fis;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = container.classList.contains("open");
      document.querySelectorAll(".feed-mini-select.open").forEach((el) => el.classList.remove("open"));
      if (!wasOpen) {
        container.classList.add("open");
        searchInput.value = "";
        updateFeedFilterOptions();
        searchInput.focus();
      }
    });

    searchInput.addEventListener("input", () => {
      const src = id === "feedMerchantSelect"
        ? [...new Set((state.feedEvents || []).map((e) => e.merchant).filter(Boolean))].sort()
        : [...new Set((state.feedEvents || []).map((e) => e.fi_name).filter(Boolean))].sort();
      renderMiniSelectOptions(id, src, setRef);
    });

    panel.addEventListener("change", (e) => {
      if (e.target.type !== "checkbox") return;
      if (e.target.checked) setRef.add(e.target.value); else setRef.delete(e.target.value);
      updateMiniSelectBtnState(id, setRef);
      updateClearBtnVisibility();
      renderFilteredFeed();
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".feed-mini-select")) {
      document.querySelectorAll(".feed-mini-select.open").forEach((el) => el.classList.remove("open"));
    }
  });

  // Exclude customer-dev checkbox
  const excludeDevCb = document.getElementById("feedExcludeDev");
  if (excludeDevCb) {
    excludeDevCb.checked = state.feedFilters.excludeDevInstance;
    excludeDevCb.addEventListener("change", () => {
      state.feedFilters.excludeDevInstance = excludeDevCb.checked;
      renderFilteredFeed();
    });
  }

  const clearBtn = document.getElementById("feedClearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.feedFilters.statuses = new Set(["success", "failed", "cancelled", "abandoned"]);
      state.feedFilters.merchants.clear();
      state.feedFilters.fis.clear();
      state.feedFilters.excludeDevInstance = true;
      if (excludeDevCb) excludeDevCb.checked = true;
      pillsEl.querySelectorAll(".feed-status-pill").forEach((p) => p.classList.add("active"));
      updateMiniSelectBtnState("feedMerchantSelect", state.feedFilters.merchants);
      updateMiniSelectBtnState("feedFiSelect", state.feedFilters.fis);
      updateClearBtnVisibility();
      renderFilteredFeed();
    });
  }
}

function initKioskLayout() {
  // Hide normal dashboard sections
  const normalSections = document.querySelectorAll(
    ".dashboard-grid, .dashboard-grid.two, .section-title, .table-wrap, #trafficHealthSection, .dashboard-shell > section"
  );
  normalSections.forEach((el) => (el.style.display = "none"));

  // Show kiosk containers
  if (kioskEls.kpiRow) kioskEls.kpiRow.style.display = "";
  if (kioskEls.split) kioskEls.split.style.display = "";

  // Init event feed filters
  initFeedFilters();

  // Add "Include test data" checkbox to kiosk header
  const headerStatus = document.querySelector(".kiosk-header__status");
  if (headerStatus) {
    const label = document.createElement("label");
    label.className = "kiosk-test-toggle";
    label.innerHTML = `<input type="checkbox" id="kioskIncludeTests" /> Include test data`;
    headerStatus.insertBefore(label, headerStatus.firstChild);
    document.getElementById("kioskIncludeTests").addEventListener("change", (e) => {
      state.includeTests = e.target.checked;
      kioskRefresh();
    });
  }
}

function renderKioskView() {
  if (!state.data) return;
  const overall = state.data.overall || {};
  const byMerchant = addFailureRates(state.data.by_merchant || []);
  const byDay = state.data.by_day || [];

  renderKioskKpis(overall, byMerchant, byDay);
  renderMerchantHealthGrid(byMerchant);
  renderVolumeSparkline(byDay);
  requestAnimationFrame(capRightColumnHeight);
}

function capRightColumnHeight() {
  const rightCol = document.querySelector(".kiosk-main-split__right");
  const merchantGrid = document.getElementById("kioskMerchantGrid");
  if (!rightCol || !merchantGrid) return;
  const tiles = merchantGrid.querySelectorAll(".merchant-tile");
  if (!tiles.length) return;

  // Measure one tile height + gap to compute 4-row cap for merchant grid
  const firstRect = tiles[0].getBoundingClientRect();
  const tileH = firstRect.height;
  const gap = 10;
  const fourRowHeight = tileH * 4 + gap * 3;
  merchantGrid.style.maxHeight = fourRowHeight + "px";

  // Cap right column: measure from split top to merchant grid bottom (after cap)
  const splitRect = document.querySelector(".kiosk-main-split").getBoundingClientRect();
  const gridRect = merchantGrid.getBoundingClientRect();
  const targetHeight = gridRect.top - splitRect.top + fourRowHeight;
  rightCol.style.maxHeight = targetHeight + "px";
}

async function kioskRefresh() {
  await fetchOpsTrends();
  await Promise.all([fetchMetrics(), fetchTrafficHealth()]);
  await fetchEventFeed();
}

/* ── Traffic Health ── */

async function fetchTrafficHealth() {
  try {
    const res = await fetch("/api/traffic-health");
    if (!res.ok) return;
    const data = await res.json();
    state.trafficHealth = data;
    if (isKioskMode()) {
      renderKioskTrafficHealth(data);
    } else {
      renderTrafficHealth(data);
    }
  } catch (err) {
    console.warn("[operations] traffic health fetch failed", err);
  }
}

function buildTrafficSparkline(dailyCounts, baseline, status) {
  const count = dailyCounts.length;
  if (!count) return "";
  const maxVal = Math.max(...dailyCounts, baseline, 1);
  const w = 120;
  const h = 32;
  const barW = Math.max(2, (w - (count - 1) * 2) / count);
  const bars = dailyCounts
    .map((val, i) => {
      const barH = Math.max(1, (val / maxVal) * (h - 2));
      const x = i * (barW + 2);
      const y = h - barH;
      const isToday = i === count - 1;
      let fill;
      if (isToday) {
        fill = status === "dark" ? "#ef4444" : status === "low" ? "#f59e0b" : status === "sleeping" ? "#818cf8" : "#22c55e";
      } else {
        fill = "var(--muted)";
      }
      return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="1" fill="${fill}" opacity="${isToday ? 1 : 0.35}" />`;
    })
    .join("");

  // Dashed baseline line
  const baselineY = h - Math.max(1, (baseline / maxVal) * (h - 2));
  const lineW = count * (barW + 2) - 2;
  const baselineLine = baseline > 0
    ? `<line x1="0" y1="${baselineY}" x2="${lineW}" y2="${baselineY}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3,2" opacity="0.5" />`
    : "";

  return `<svg class="traffic-tile__sparkline" width="${lineW}" height="${h}" viewBox="0 0 ${lineW} ${h}">${bars}${baselineLine}</svg>`;
}

function renderTrafficHealthBanner(data, bannerEl) {
  if (!bannerEl) return;
  const { dark, low, sleeping } = data.summary;
  const threshold = data.min_volume_threshold || 5;
  const isAdmin = window.sisAuth && ["admin", "full", "internal"].includes(window.sisAuth.getAccessLevel?.());
  const thresholdText = isAdmin
    ? `<a href="../maintenance.html#trafficHealthSettingsCard" style="color:inherit;text-decoration:underline;text-decoration-style:dotted;">${threshold}+ sessions/day</a>`
    : `${threshold}+ sessions/day`;
  const sleepingNote = sleeping > 0 ? `, ${sleeping} sleeping` : "";
  const monitorNote = `<span style="font-weight:400;font-size:0.75rem;opacity:0.8;margin-left:6px;">(${data.summary.total_monitored} FIs averaging ${thresholdText}${sleepingNote})</span>`;

  if (dark === 0 && low === 0) {
    bannerEl.innerHTML = `<div class="traffic-health-banner all-clear">All clear — ${data.summary.total_monitored} FIs reporting normal traffic ${monitorNote}</div>`;
  } else if (dark > 0) {
    const parts = [];
    if (dark > 0) parts.push(`${dark} dark`);
    if (low > 0) parts.push(`${low} low`);
    bannerEl.innerHTML = `<div class="traffic-health-banner has-issues">${parts.join(", ")} ${monitorNote}</div>`;
  } else {
    bannerEl.innerHTML = `<div class="traffic-health-banner has-warnings">${low} low volume ${monitorNote}</div>`;
  }
}

function renderTrafficTile(fi) {
  const sparkline = buildTrafficSparkline(fi.daily_counts, fi.baseline_median, fi.status);
  let statsHtml;
  let zzzIndicator = "";
  if (fi.status === "dark") {
    const hoursAgo = fi.hours_since_last != null ? `${fi.hours_since_last}h ago` : "unknown";
    statsHtml = `DARK &mdash; last session <strong>${hoursAgo}</strong>`;
  } else if (fi.status === "low") {
    statsHtml = `Today: <strong>${fi.today_sessions}</strong> sessions (<strong>${fi.pct_of_baseline}%</strong> of baseline)`;
  } else if (fi.status === "sleeping") {
    const tierNote = fi.fingerprint_tier === 1 && fi.expected_cumulative != null
      ? ` (expect ~${fi.expected_cumulative} by now)`
      : "";
    statsHtml = `Quiet period${tierNote}`;
    zzzIndicator = `<span class="zzz-indicator">zzz</span>`;
  } else {
    statsHtml = `Today: <strong>${fi.today_sessions}</strong> sessions (<strong>${fi.pct_of_baseline}%</strong> of baseline)`;
  }

  // Build verbose tooltip
  const statusExplain = fi.status === "dark"
    ? "DARK: Zero sessions detected. This FI may have an outage, integration issue, or has gone offline."
    : fi.status === "low"
    ? "LOW: Session volume is significantly below the 14-day baseline. Could indicate reduced traffic, partial outage, or campaign ending."
    : fi.status === "sleeping"
    ? "SLEEPING: Expected quiet period — historically near-zero traffic at this hour. No action needed."
    : "NORMAL: Session volume is within expected range based on the 14-day rolling baseline.";
  const lastSessionStr = fi.hours_since_last != null ? `${fi.hours_since_last} hours ago` : "Unknown";
  const dailyCounts = fi.daily_counts || [];
  const recentDays = dailyCounts.slice(-3).map((c, i) => `Day ${dailyCounts.length - 2 + i}: ${c} sessions`).join("\n  ");
  const tipFi = [
    `${fi.fi_name.toUpperCase()}`,
    `Partner: ${fi.partner}`,
    `Instance: ${fi.instance || "N/A"}`,
    `Integration: ${fi.integration_type || "N/A"}`,
    ``,
    statusExplain,
    ``,
    `Today's sessions: ${fi.today_sessions}`,
    `Today projected: ${fi.today_projected} sessions`,
    `% of baseline: ${fi.pct_of_baseline}%`,
    `Last session: ${lastSessionStr}`,
    ``,
    `14-Day Baseline:`,
    `  Median: ${fi.baseline_median} sessions/day`,
    `  Average: ${fi.baseline_avg} sessions/day`,
    `  Yesterday: ${fi.yesterday_sessions} sessions`,
    ``,
    `Recent daily counts:`,
    `  ${recentDays}`,
    ``,
    `Sparkline: bars = daily session counts (14 days).`,
    `Dashed line = baseline median.`,
    `Click to open detail modal with full 15-day chart.`,
  ].join("\n");

  const badgeLabel = fi.status === "sleeping" ? "Sleeping" : fi.status.toUpperCase();
  return `
    <div class="traffic-tile status-${fi.status}" data-fi-key="${fi.fi_lookup_key}" title="${tipFi.replace(/"/g, '&quot;')}">
      <div class="traffic-tile__header">
        <span class="traffic-tile__name">${fi.fi_name}</span>
        <span style="display:flex;align-items:center;gap:4px;">
          ${zzzIndicator}
          <span class="traffic-tile__status-badge ${fi.status}">${badgeLabel}</span>
        </span>
      </div>
      <div class="traffic-tile__partner">${fi.partner}</div>
      <div class="traffic-tile__stats">${statsHtml}</div>
      ${sparkline}
    </div>
  `;
}

function sortFisByAvgSessions(fis) {
  return fis.slice().sort((a, b) => (b.baseline_avg || 0) - (a.baseline_avg || 0));
}

function renderTrafficHealth(data) {
  if (!data || !data.fis) return;
  renderTrafficHealthBanner(data, trafficEls.banner);

  const anomalies = sortFisByAvgSessions(data.fis.filter(f => f.status === "dark" || f.status === "low"));
  const sleeping = sortFisByAvgSessions(data.fis.filter(f => f.status === "sleeping"));
  const normals = sortFisByAvgSessions(data.fis.filter(f => f.status === "normal"));

  let html = anomalies.map(renderTrafficTile).join("");

  // Show sleeping tiles collapsed by default (not actionable)
  if (sleeping.length > 0) {
    if (state.trafficShowSleeping) {
      html += sleeping.map(renderTrafficTile).join("");
      html += `<div class="traffic-health-expand" id="trafficToggleSleeping">Hide ${sleeping.length} sleeping FIs</div>`;
    } else {
      html += `<div class="traffic-health-expand" id="trafficToggleSleeping">Show ${sleeping.length} sleeping FIs</div>`;
    }
  }

  if (normals.length > 0) {
    if (state.trafficShowNormal) {
      html += normals.map(renderTrafficTile).join("");
      html += `<div class="traffic-health-expand" id="trafficToggleNormal">Hide ${normals.length} normal FIs</div>`;
    } else {
      html += `<div class="traffic-health-expand" id="trafficToggleNormal">Show ${normals.length} normal FIs</div>`;
    }
  }

  if (trafficEls.grid) {
    trafficEls.grid.innerHTML = html;

    // Bind toggles
    const sleepingToggle = document.getElementById("trafficToggleSleeping");
    if (sleepingToggle) {
      sleepingToggle.addEventListener("click", () => {
        state.trafficShowSleeping = !state.trafficShowSleeping;
        renderTrafficHealth(state.trafficHealth);
      });
    }
    const toggle = document.getElementById("trafficToggleNormal");
    if (toggle) {
      toggle.addEventListener("click", () => {
        state.trafficShowNormal = !state.trafficShowNormal;
        renderTrafficHealth(state.trafficHealth);
      });
    }

    // Bind tile clicks → detail modal
    trafficEls.grid.querySelectorAll(".traffic-tile").forEach(tile => {
      tile.addEventListener("click", () => {
        const fiKey = tile.dataset.fiKey;
        const fi = data.fis.find(f => f.fi_lookup_key === fiKey);
        if (fi) renderTrafficDetailModal(fi, data);
      });
    });
  }
}

function renderKioskTrafficHealth(data) {
  if (!data || !data.fis) return;
  renderTrafficHealthBanner(data, trafficEls.kioskBanner);

  if (trafficEls.kioskGrid) {
    // In kiosk mode, sort: dark → low → normal → sleeping (sleeping last, not actionable)
    const kioskStatusOrder = { dark: 0, low: 1, normal: 2, sleeping: 3 };
    const sorted = data.fis.slice().sort((a, b) => {
      const so = (kioskStatusOrder[a.status] ?? 9) - (kioskStatusOrder[b.status] ?? 9);
      if (so !== 0) return so;
      return (b.baseline_avg || 0) - (a.baseline_avg || 0);
    });
    trafficEls.kioskGrid.innerHTML = sorted.map(renderTrafficTile).join("");

    trafficEls.kioskGrid.querySelectorAll(".traffic-tile").forEach(tile => {
      tile.addEventListener("click", () => {
        const fiKey = tile.dataset.fiKey;
        const fi = data.fis.find(f => f.fi_lookup_key === fiKey);
        if (fi) renderTrafficDetailModal(fi, data);
      });
    });
  }
}

function renderTrafficDetailModal(fi, data) {
  if (!trafficEls.detailOverlay) return;

  trafficEls.detailName.textContent = fi.fi_name;
  trafficEls.detailSubtitle.textContent = `${fi.partner} · ${fi.instance || fi.integration_type}`;

  // Stats grid
  const statItems = [
    { label: "Status", value: fi.status.toUpperCase(), color: trafficHealthColor(fi.status) },
    { label: "Today", value: `${fi.today_sessions} sessions` },
    { label: "Projected", value: `${fi.today_projected} sessions` },
    { label: "Baseline (median)", value: `${fi.baseline_median}/day` },
    { label: "Baseline (avg)", value: `${fi.baseline_avg}/day` },
    { label: "Yesterday", value: `${fi.yesterday_sessions} sessions` },
    { label: "% of Baseline", value: `${fi.pct_of_baseline}%` },
    { label: "Hours Since Last", value: fi.hours_since_last != null ? `${fi.hours_since_last}h` : "N/A" },
  ];

  trafficEls.detailStats.innerHTML = statItems
    .map(s => {
      const colorStyle = s.color ? ` style="color:${s.color === 'red' ? '#ef4444' : s.color === 'amber' ? '#f59e0b' : s.color === 'indigo' ? '#818cf8' : '#22c55e'}"` : "";
      return `
        <div class="partner-detail-panel__stat">
          <div class="partner-detail-panel__stat-value"${colorStyle}>${s.value}</div>
          <div class="partner-detail-panel__stat-label">${s.label}</div>
        </div>
      `;
    })
    .join("");

  // Bar chart: 15 daily counts with baseline line
  const counts = fi.daily_counts;
  const baseline = fi.baseline_median;
  const maxVal = Math.max(...counts, baseline, 1);
  const chartW = 560;
  const chartH = 160;
  const padding = 30;
  const barCount = counts.length;
  const barW = Math.max(8, (chartW - padding * 2 - (barCount - 1) * 4) / barCount);
  const usableH = chartH - padding - 10;

  let bars = "";
  counts.forEach((val, i) => {
    const barH = Math.max(1, (val / maxVal) * usableH);
    const x = padding + i * (barW + 4);
    const y = chartH - padding - barH;
    const isToday = i === barCount - 1;
    let fill;
    if (isToday) {
      fill = fi.status === "dark" ? "#ef4444" : fi.status === "low" ? "#f59e0b" : fi.status === "sleeping" ? "#818cf8" : "#22c55e";
    } else {
      fill = "var(--accent)";
    }
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${fill}" opacity="${isToday ? 1 : 0.4}" />`;
    // Value label on top
    if (val > 0) {
      bars += `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" fill="var(--muted)" font-size="9">${val}</text>`;
    }
  });

  // Baseline dashed line
  const baselineY = chartH - padding - Math.max(1, (baseline / maxVal) * usableH);
  const lineX2 = padding + (barCount - 1) * (barW + 4) + barW;
  const baselineLine = `<line x1="${padding}" y1="${baselineY}" x2="${lineX2}" y2="${baselineY}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="6,3" />`;
  const baselineLabel = `<text x="${lineX2 + 4}" y="${baselineY + 3}" fill="#f59e0b" font-size="9">median</text>`;

  // Day labels (first, middle, last)
  const hoursInfo = data.hours_elapsed_today != null ? `${data.hours_elapsed_today}h elapsed today` : "";
  const dayLabels = [0, Math.floor(barCount / 2), barCount - 1].map(i => {
    const x = padding + i * (barW + 4) + barW / 2;
    const label = i === barCount - 1 ? "Today" : `-${barCount - 1 - i}d`;
    return `<text x="${x}" y="${chartH - 6}" text-anchor="middle" fill="var(--muted)" font-size="9">${label}</text>`;
  }).join("");

  trafficEls.detailChart.innerHTML = `
    <svg width="100%" height="${chartH}" viewBox="0 0 ${chartW + 40} ${chartH}">
      ${bars}
      ${baselineLine}
      ${baselineLabel}
      ${dayLabels}
    </svg>
    ${hoursInfo ? `<div style="text-align:right;font-size:0.72rem;color:var(--muted);margin-top:4px;">${hoursInfo}</div>` : ""}
  `;

  // Show modal
  trafficEls.detailOverlay.style.display = "";
  requestAnimationFrame(() => trafficEls.detailOverlay.classList.add("open"));
}

function closeTrafficDetail() {
  if (!trafficEls.detailOverlay) return;
  trafficEls.detailOverlay.classList.remove("open");
  setTimeout(() => { trafficEls.detailOverlay.style.display = "none"; }, 200);
}

// Bind modal close handlers
if (trafficEls.detailClose) {
  trafficEls.detailClose.addEventListener("click", closeTrafficDetail);
}
if (trafficEls.detailOverlay) {
  trafficEls.detailOverlay.addEventListener("click", (e) => {
    if (e.target === trafficEls.detailOverlay) closeTrafficDetail();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTrafficDetail();
});

/* ── Init ── */

function init() {
  const kiosk = isKioskMode();

  if (kiosk) {
    initKioskMode("Operations Command Center", 30);
    initKioskLayout();
    state.windowDays = 8;
    loadFiRegistry();
    startAutoRefresh(kioskRefresh, 30000); // 30 seconds
  } else {
    initTimeWindows();
    bindSortHandlers();
    loadFiRegistry();
    loadInstances();
    els.fiScope.addEventListener("change", (event) => {
      state.fiScope = event.target.value || "all";
      fetchMetrics();
    });
    els.exportOps.addEventListener("click", handleExportOps);
    // Include test data checkbox
    const testCheckbox = document.getElementById("includeTestsCheckbox");
    if (testCheckbox) {
      testCheckbox.addEventListener("change", (e) => {
        state.includeTests = e.target.checked;
        fetchMetrics();
      });
    }
    // Kiosk view toggle
    const kioskToggle = document.getElementById("kioskToggle");
    if (kioskToggle) {
      kioskToggle.addEventListener("click", () => {
        const url = new URL(window.location);
        url.searchParams.set("kiosk", "1");
        window.location.href = url.toString();
      });
    }
    fetchMetrics();
    fetchTrafficHealth();
  }
}

init();
