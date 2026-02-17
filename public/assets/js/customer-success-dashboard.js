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
} from "./dashboard-utils.js";

const TIME_WINDOWS = [3, 30, 90, 180];

const els = {
  timeWindow: document.getElementById("timeWindow"),
  fiScope: document.getElementById("fiScope"),
  exportOverall: document.getElementById("exportOverall"),
  exportSources: document.getElementById("exportSources"),
  funnelChart: document.getElementById("funnelChart"),
  funnelRates: document.getElementById("funnelRates"),
  ssoComparison: document.getElementById("ssoComparison"),
  fiTable: document.getElementById("fiTable"),
  fiTableMeta: document.getElementById("fiTableMeta"),
  sourceTable: document.getElementById("sourceTable"),
  sourceTableMeta: document.getElementById("sourceTableMeta"),
  kpiSmSessions: document.getElementById("kpiSmSessions"),
  kpiSmToSuccess: document.getElementById("kpiSmToSuccess"),
  kpiJobsSuccessRate: document.getElementById("kpiJobsSuccessRate"),
  kpiJobsPerCe: document.getElementById("kpiJobsPerCe"),
  kpiSmSessionsDelta: document.getElementById("kpiSmSessionsDelta"),
  kpiSmToSuccessDelta: document.getElementById("kpiSmToSuccessDelta"),
  kpiJobsSuccessRateDelta: document.getElementById("kpiJobsSuccessRateDelta"),
  kpiJobsPerCeDelta: document.getElementById("kpiJobsPerCeDelta"),
};

const state = {
  windowDays: 30,
  fiScope: "all",
  fiList: [],
  sourceTypes: [],
  sourceCategories: [],
  data: null,
  loading: false,
  fiSortKey: "SM_Sessions",
  fiSortDir: "desc",
  sourceSortKey: "SM_Sessions",
  sourceSortDir: "desc",
  includeTests: false,
};

const fiSelect = createMultiSelect(document.getElementById("fiSelect"), {
  placeholder: "All FIs",
  onChange: (values) => {
    state.fiList = values;
    fetchMetrics();
  },
});
const sourceTypeSelect = createMultiSelect(document.getElementById("sourceTypeSelect"), {
  placeholder: "All types",
  onChange: (values) => {
    state.sourceTypes = values;
    fetchMetrics();
  },
});
const sourceCategorySelect = createMultiSelect(
  document.getElementById("sourceCategorySelect"),
  {
    placeholder: "All categories",
    onChange: (values) => {
      state.sourceCategories = values;
      fetchMetrics();
    },
  }
);

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
  if (els.exportOverall) els.exportOverall.disabled = isLoading || !state.data;
  if (els.exportSources) els.exportSources.disabled = isLoading || !state.data;
  if (els.fiTableMeta) els.fiTableMeta.textContent = isLoading ? "Loading…" : "";
  if (els.sourceTableMeta) els.sourceTableMeta.textContent = isLoading ? "Loading…" : "";
}

function formatDelta() {
  return "";
}

function normalizeRows(rows = []) {
  return rows.map((row) => {
    const sm = row.SM_Sessions || 0;
    const ce = row.CE_Sessions || 0;
    const success = row.Success_Sessions || 0;
    const jobsTotal = row.Jobs_Total || 0;
    return {
      ...row,
      sm_to_ce: sm > 0 ? ce / sm : 0,
      ce_to_success: ce > 0 ? success / ce : 0,
      sm_to_success: sm > 0 ? success / sm : 0,
      jobs_per_ce: ce > 0 ? jobsTotal / ce : 0,
    };
  });
}

function renderKpis(overall) {
  const sm = overall.SM_Sessions || 0;
  const ce = overall.CE_Sessions || 0;
  const success = overall.Success_Sessions || 0;
  const jobsTotal = overall.Jobs_Total || 0;
  const jobsSuccess = overall.Jobs_Success || 0;
  els.kpiSmSessions.textContent = formatNumber(sm);
  els.kpiSmToSuccess.textContent = formatRate(success, sm);
  els.kpiJobsSuccessRate.textContent = formatRate(jobsSuccess, jobsTotal);
  els.kpiJobsPerCe.textContent = ce > 0 ? (jobsTotal / ce).toFixed(2) : "-";

  const delta = formatDelta();
  els.kpiSmSessionsDelta.textContent = delta;
  els.kpiSmToSuccessDelta.textContent = delta;
  els.kpiJobsSuccessRateDelta.textContent = delta;
  els.kpiJobsPerCeDelta.textContent = delta;
}

function renderFunnel(overall) {
  const steps = [
    { label: "Select Merchant", value: overall.SM_Sessions || 0 },
    { label: "Credential Entry", value: overall.CE_Sessions || 0 },
    { label: "Success", value: overall.Success_Sessions || 0 },
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);
  els.funnelChart.innerHTML = "";
  steps.forEach((step) => {
    const row = document.createElement("div");
    row.className = "funnel-row";
    const label = document.createElement("div");
    label.className = "funnel-label";
    label.textContent = step.label;
    const bar = document.createElement("div");
    bar.className = "funnel-bar";
    const width = step.value > 0 ? Math.max(6, (step.value / max) * 100) : 0;
    bar.style.width = `${width}%`;
    const metric = document.createElement("div");
    metric.className = "funnel-metric";
    metric.textContent = formatNumber(step.value);
    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(metric);
    els.funnelChart.appendChild(row);
  });

  const sm = overall.SM_Sessions || 0;
  const ce = overall.CE_Sessions || 0;
  const success = overall.Success_Sessions || 0;
  els.funnelRates.innerHTML = `
    <span><i style="background: var(--accent);"></i>SM→CE ${formatRate(ce, sm)}</span>
    <span><i style="background: var(--accent-2);"></i>CE→Success ${formatRate(success, ce)}</span>
    <span><i style="background: #0ea5e9;"></i>SM→Success ${formatRate(success, sm)}</span>
  `;
}

function renderSsoComparison(bySso = []) {
  const segments = new Map(bySso.map((row) => [row.segment, row]));
  const renderMini = (label, row) => {
    const sm = row?.SM_Sessions || 0;
    const ce = row?.CE_Sessions || 0;
    const success = row?.Success_Sessions || 0;
    return `
      <div class="mini-funnel">
        <h4>${label}</h4>
        <div class="funnel-row">
          <div class="funnel-label">SM</div>
          <div class="funnel-metric">${formatNumber(sm)}</div>
        </div>
        <div class="funnel-row">
          <div class="funnel-label">CE</div>
          <div class="funnel-metric">${formatNumber(ce)}</div>
        </div>
        <div class="funnel-row">
          <div class="funnel-label">Success</div>
          <div class="funnel-metric">${formatNumber(success)}</div>
        </div>
        <div class="kpi-sub">SM→Success ${formatRate(success, sm)}</div>
      </div>
    `;
  };
  els.ssoComparison.innerHTML =
    renderMini("SSO FIs", segments.get("SSO")) +
    renderMini("Non-SSO FIs", segments.get("Non-SSO"));
}

function renderFiTable(rows) {
  const tbody = els.fiTable.querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No FI data for this view.</td></tr>`;
    els.fiTableMeta.textContent = "No FI rows";
    return;
  }
  const sorted = sortRows(rows, state.fiSortKey, state.fiSortDir);
  tbody.innerHTML = "";
  sorted.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.fi_name || ""}</td>
      <td>${row.fi_lookup_key || ""}</td>
      <td>${formatNumber(row.SM_Sessions || 0)}</td>
      <td>${formatNumber(row.CE_Sessions || 0)}</td>
      <td>${formatNumber(row.Success_Sessions || 0)}</td>
      <td>${formatPercent(row.sm_to_ce)}</td>
      <td>${formatPercent(row.ce_to_success)}</td>
      <td>${formatPercent(row.sm_to_success)}</td>
      <td>${Number.isFinite(row.jobs_per_ce) && row.jobs_per_ce > 0 ? row.jobs_per_ce.toFixed(2) : "-"}</td>
    `;
    tbody.appendChild(tr);
  });
  els.fiTableMeta.textContent = `${rows.length} FIs`;
}

function renderSourceTable(rows) {
  const tbody = els.sourceTable.querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No source data for this view.</td></tr>`;
    els.sourceTableMeta.textContent = "No sources";
    return;
  }
  const sorted = sortRows(rows, state.sourceSortKey, state.sourceSortDir).slice(0, 10);
  tbody.innerHTML = "";
  sorted.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.source_type || "unknown"}</td>
      <td>${row.source_category || "unknown"}</td>
      <td>${formatNumber(row.SM_Sessions || 0)}</td>
      <td>${formatNumber(row.Success_Sessions || 0)}</td>
      <td>${formatPercent(row.sm_to_success)}</td>
    `;
    tbody.appendChild(tr);
  });
  els.sourceTableMeta.textContent = `Top ${Math.min(10, rows.length)} sources`;
}

function updateSourceFilters(bySource = []) {
  const types = new Map();
  const categories = new Map();
  bySource.forEach((row) => {
    const type = row.source_type || "unknown";
    const category = row.source_category || "unknown";
    types.set(type, type);
    categories.set(category, category);
  });
  sourceTypeSelect.setOptions(
    Array.from(types.keys())
      .sort()
      .map((value) => ({ label: value, value }))
  );
  sourceCategorySelect.setOptions(
    Array.from(categories.keys())
      .sort()
      .map((value) => ({ label: value, value }))
  );
}

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
        // Store full registry info for kiosk use
        fiRegistryMap.set(key, {
          integration_type: (entry.integration_type || "").toString().toUpperCase(),
          partner: entry.partner || "",
          fi_name: entry.fi_name || key,
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
    source_type_list: state.sourceTypes,
    source_category_list: state.sourceCategories,
    includeTests: state.includeTests,
  };
  setLoading(true);
  try {
    const res = await fetch("/api/metrics/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: currentController.signal,
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    state.data = data;
    const overall = data.overall || {};
    const byFi = normalizeRows(data.by_fi || []);
    const bySource = normalizeRows(data.by_source || []);

    if (isKioskMode()) {
      renderKioskView();
    } else {
      renderKpis(overall);
      renderFunnel(overall);
      renderSsoComparison(data.by_sso_segment || []);
      renderFiTable(byFi);
      renderSourceTable(bySource);
      updateSourceFilters(data.by_source || []);
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("[customer-success] fetch failed", err);
    }
    state.data = null;
    renderFiTable([]);
    renderSourceTable([]);
    renderKpis({});
    els.funnelChart.innerHTML = `<div class="empty-state">No data for this view.</div>`;
    els.ssoComparison.innerHTML = "";
  } finally {
    setLoading(false);
  }
}

function handleExportFi() {
  if (!state.data) return;
  const rows = normalizeRows(state.data.by_fi || []);
  if (!rows.length) return;
  const header = [
    "FI Name",
    "FI Lookup Key",
    "SM Sessions",
    "CE Sessions",
    "Success Sessions",
    "% SM→CE",
    "% CE→Success",
    "% SM→Success",
    "Jobs per CE Session",
  ];
  const body = rows.map((row) => [
    row.fi_name || "",
    row.fi_lookup_key || "",
    row.SM_Sessions || 0,
    row.CE_Sessions || 0,
    row.Success_Sessions || 0,
    formatPercent(row.sm_to_ce),
    formatPercent(row.ce_to_success),
    formatPercent(row.sm_to_success),
    Number.isFinite(row.jobs_per_ce) ? row.jobs_per_ce.toFixed(2) : "-",
  ]);
  const ts = new Date().toISOString().replace(/[:]/g, "");
  downloadCsv(`customer-success-fi-breakdown-${state.windowDays}d-${ts}.csv`, [header, ...body]);
}

function handleExportSources() {
  if (!state.data) return;
  const rows = normalizeRows(state.data.by_source || []);
  if (!rows.length) return;
  const header = [
    "Source Type",
    "Source Category",
    "SM Sessions",
    "Success Sessions",
    "% SM→Success",
  ];
  const body = rows.map((row) => [
    row.source_type || "unknown",
    row.source_category || "unknown",
    row.SM_Sessions || 0,
    row.Success_Sessions || 0,
    formatPercent(row.sm_to_success),
  ]);
  const ts = new Date().toISOString().replace(/[:]/g, "");
  downloadCsv(`customer-success-sources-${state.windowDays}d-${ts}.csv`, [header, ...body]);
}

function bindSortHandlers() {
  attachSortHandlers(els.fiTable, (key) => {
    if (state.fiSortKey === key) {
      state.fiSortDir = state.fiSortDir === "asc" ? "desc" : "asc";
    } else {
      state.fiSortKey = key;
      state.fiSortDir = "desc";
    }
    renderFiTable(normalizeRows(state.data?.by_fi || []));
  });
  attachSortHandlers(els.sourceTable, (key) => {
    if (state.sourceSortKey === key) {
      state.sourceSortDir = state.sourceSortDir === "asc" ? "desc" : "asc";
    } else {
      state.sourceSortKey = key;
      state.sourceSortDir = "desc";
    }
    renderSourceTable(normalizeRows(state.data?.by_source || []));
  });
}

/* ── Kiosk Mode: Partner Grid + Detail Panel + Alerts ── */

const kioskEls = {
  alerts: document.getElementById("kioskAlerts"),
  partnerGrid: document.getElementById("kioskPartnerGrid"),
  detailPanel: document.getElementById("kioskDetailPanel"),
  detailPanelName: document.getElementById("detailPanelName"),
  detailPanelHealth: document.getElementById("detailPanelHealth"),
  detailPanelStats: document.getElementById("detailPanelStats"),
  detailPanelFunnel: document.getElementById("detailPanelFunnel"),
  detailPanelClose: document.getElementById("detailPanelClose"),
};

let selectedFi = null;
let weeklyTrends = new Map(); // fi_lookup_key → { weeks: [{sm, success, rate}], trend: "up"|"down"|"flat" }
let fiRegistryMap = new Map(); // fi_lookup_key → { integration_type, partner, fi_name }

async function fetchWeeklyTrends() {
  // Fetch 4 weekly buckets for per-FI trend data
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

    // Build per-FI weekly data (index 0 = most recent week)
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

    // Determine trend for each FI
    fiWeeks.forEach((data, key) => {
      const filled = data.weeks.map((w) => w || { sm: 0, success: 0, rate: 0 });
      // Compare most recent week (0) vs prior week (1)
      const recent = filled[0];
      const prior = filled[1];
      const recentSm = recent.sm;
      const priorSm = prior.sm;

      let trend = "flat";
      if (recentSm > 0 && priorSm > 0) {
        const delta = recent.rate - prior.rate;
        if (delta > 0.02) trend = "up";
        else if (delta < -0.02) trend = "down";
      } else if (recentSm > 0 && priorSm === 0) {
        trend = "up";
      } else if (recentSm === 0 && priorSm > 0) {
        trend = "down";
      }

      data.trend = trend;
      weeklyTrends.set(key, data);
    });
  } catch (err) {
    console.warn("[cs-kiosk] trend fetch failed", err);
  }
}

function buildSparklineSvg(weeks, size = "card") {
  // weeks[0] = most recent, weeks[3] = oldest — reverse for left-to-right chronological
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

  // Fill area under line (subtle)
  const fillD = pathD + ` L${coords[coords.length - 1].x},${h - pad} L${coords[0].x},${h - pad} Z`;
  const fillOpacity = isLarge ? "0.12" : "0.08";

  let dots = "";
  if (dotR > 0) {
    dots = coords.map((c) => `<circle cx="${c.x}" cy="${c.y}" r="${dotR}" fill="${color}" />`).join("");
  }

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;display:block;"><path d="${fillD}" fill="${color}" opacity="${fillOpacity}"/><path d="${pathD}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}

function trendArrow(trend) {
  if (trend === "up") return `<span style="color:#22c55e;font-size:0.85rem;" title="Trending up">&#9650;</span>`;
  if (trend === "down") return `<span style="color:#ef4444;font-size:0.85rem;" title="Trending down">&#9660;</span>`;
  return `<span style="color:#64748b;font-size:0.7rem;" title="Flat">&#9644;</span>`;
}

function integrationBadge(fiKey) {
  const reg = fiRegistryMap.get(fiKey);
  if (!reg || !reg.integration_type) return "";
  const type = reg.integration_type;
  const isSSO = type === "SSO";
  const label = isSSO ? "SSO" : "Non-SSO";
  const cls = isSSO ? "badge-sso" : "badge-nonsso";
  return `<span class="integration-badge ${cls}">${label}</span>`;
}

function buildPartnerCard(row, rows) {
  const sm = row.SM_Sessions || 0;
  const success = row.Success_Sessions || 0;
  const rate = sm > 0 ? success / sm : 0;
  const color = healthColor(rate);
  const key = row.fi_lookup_key || row.fi_name || "";
  const trendData = weeklyTrends.get(key);
  const trend = trendData ? trendData.trend : "flat";
  const sparkline = trendData ? buildSparklineSvg(trendData.weeks) : "";

  const card = document.createElement("div");
  card.className = `partner-card${selectedFi === row.fi_lookup_key ? " selected" : ""}`;
  card.innerHTML = `
    <div class="partner-card__header">
      <span class="partner-card__name">${row.fi_name || row.fi_lookup_key || "Unknown"}</span>
      <span style="display:flex;align-items:center;gap:6px;">${integrationBadge(key)} ${trendArrow(trend)} <span class="health-dot ${color}"></span></span>
    </div>
    <div class="partner-card__metrics">
      <div class="partner-card__metric">
        <span class="partner-card__metric-value">${formatNumber(sm)}</span>
        <span class="partner-card__metric-label">Sessions</span>
      </div>
      <div class="partner-card__metric">
        <span class="partner-card__metric-value">${formatRate(success, sm)}</span>
        <span class="partner-card__metric-label">Success</span>
      </div>
      <div class="partner-card__metric">
        <span class="partner-card__metric-value">${formatNumber(success)}</span>
        <span class="partner-card__metric-label">Successes</span>
      </div>
      <div class="partner-card__metric" style="margin-left:auto;">
        ${sparkline}
        <span class="partner-card__metric-label">4-wk vol</span>
      </div>
    </div>
  `;
  card.addEventListener("click", () => {
    selectedFi = row.fi_lookup_key;
    renderKioskView();
    renderDetailModal(row);
  });
  return card;
}

function renderPartnerGrid(rows) {
  if (!kioskEls.partnerGrid) return;
  kioskEls.partnerGrid.innerHTML = "";
  const sorted = [...rows].sort((a, b) => (b.SM_Sessions || 0) - (a.SM_Sessions || 0));

  sorted.forEach((row) => {
    kioskEls.partnerGrid.appendChild(buildPartnerCard(row, rows));
  });
}

function renderDetailModal(row) {
  // Remove any existing modal
  const existing = document.getElementById("kioskDetailModal");
  if (existing) existing.remove();

  const sm = row.SM_Sessions || 0;
  const ce = row.CE_Sessions || 0;
  const success = row.Success_Sessions || 0;
  const jobsTotal = row.Jobs_Total || 0;
  const jobsSuccess = row.Jobs_Success || 0;
  const rate = sm > 0 ? success / sm : 0;
  const key = row.fi_lookup_key || row.fi_name || "";
  const reg = fiRegistryMap.get(key);
  const intLabel = reg ? (reg.integration_type === "SSO" ? "SSO" : "Non-SSO") : "";
  const partnerLabel = reg && reg.partner ? reg.partner : "";
  const subtitle = [intLabel, partnerLabel].filter(Boolean).join(" · ");

  // Mini funnel
  const steps = [
    { label: "Select Merchant", value: sm },
    { label: "Credential Entry", value: ce },
    { label: "Success", value: success },
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);
  const funnelHtml = steps.map((step) => {
    const width = step.value > 0 ? Math.max(6, (step.value / max) * 100) : 0;
    return `<div class="funnel-row"><div class="funnel-label">${step.label}</div><div class="funnel-bar" style="width:${width}%"></div><div class="funnel-metric">${formatNumber(step.value)}</div></div>`;
  }).join("");

  // Weekly trend section
  const trendData = weeklyTrends.get(key);
  let weeklyHtml = "";
  if (trendData && trendData.weeks) {
    const largeSparkline = buildSparklineSvg(trendData.weeks, "large");
    // weeks[0] = most recent, [3] = oldest — show oldest first (left to right)
    const weekLabels = ["4 wks ago", "3 wks ago", "2 wks ago", "This week"];
    const weeksReversed = [...trendData.weeks].reverse();
    const weekRows = weeksReversed.map((w, i) => {
      const wk = w || { sm: 0, success: 0, rate: 0 };
      const ratePct = (wk.rate * 100).toFixed(1);
      return `<tr>
        <td>${weekLabels[i]}</td>
        <td>${formatNumber(wk.sm)}</td>
        <td>${formatNumber(wk.success)}</td>
        <td>${ratePct}%</td>
      </tr>`;
    }).join("");

    weeklyHtml = `
      <div class="detail-modal__weekly">
        <div class="detail-modal__weekly-title">4-Week Trend</div>
        <div class="detail-modal__weekly-chart">${largeSparkline}</div>
        <table class="detail-modal__weekly-table">
          <thead><tr><th>Week</th><th>Sessions</th><th>Successes</th><th>Rate</th></tr></thead>
          <tbody>${weekRows}</tbody>
        </table>
      </div>
    `;
  }

  const overlay = document.createElement("div");
  overlay.id = "kioskDetailModal";
  overlay.className = "detail-modal-overlay";
  overlay.innerHTML = `
    <div class="detail-modal">
      <div class="detail-modal__header">
        <div>
          <span class="detail-modal__name">${row.fi_name || row.fi_lookup_key || "Unknown"}</span>
          <span class="health-dot ${healthColor(rate)}" style="margin-left:8px;"></span>
          ${subtitle ? `<div class="detail-modal__subtitle">${subtitle}</div>` : ""}
        </div>
        <button class="detail-modal__close" type="button">&times;</button>
      </div>
      <div class="detail-modal__stats">
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatNumber(sm)}</span>
          <span class="partner-detail-panel__stat-label">SM Sessions</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatNumber(ce)}</span>
          <span class="partner-detail-panel__stat-label">CE Sessions</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatNumber(success)}</span>
          <span class="partner-detail-panel__stat-label">Successes</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatRate(success, sm)}</span>
          <span class="partner-detail-panel__stat-label">SM → Success</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatRate(ce, sm)}</span>
          <span class="partner-detail-panel__stat-label">SM → CE</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatRate(success, ce)}</span>
          <span class="partner-detail-panel__stat-label">CE → Success</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatNumber(jobsTotal)}</span>
          <span class="partner-detail-panel__stat-label">Total Jobs</span>
        </div>
        <div class="partner-detail-panel__stat">
          <span class="partner-detail-panel__stat-value">${formatRate(jobsSuccess, jobsTotal)}</span>
          <span class="partner-detail-panel__stat-label">Jobs Success</span>
        </div>
      </div>
      ${weeklyHtml}
      <div class="detail-modal__funnel">${funnelHtml}</div>
    </div>
  `;

  // Close on backdrop click or close button
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDetailModal();
  });
  overlay.querySelector(".detail-modal__close").addEventListener("click", closeDetailModal);

  document.body.appendChild(overlay);
  // Trigger animation
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function closeDetailModal() {
  const modal = document.getElementById("kioskDetailModal");
  if (modal) {
    modal.classList.remove("open");
    setTimeout(() => modal.remove(), 200);
  }
  selectedFi = null;
  if (state.data) {
    renderPartnerGrid(normalizeRows(state.data.by_fi || []));
  }
}

let alertsExpanded = false;

function renderAlerts(rows) {
  if (!kioskEls.alerts) return;
  const alerts = [];

  rows.forEach((row) => {
    const sm = row.SM_Sessions || 0;
    const success = row.Success_Sessions || 0;
    const rate = sm > 0 ? success / sm : 0;
    const name = row.fi_name || row.fi_lookup_key || "Unknown";

    if (sm > 10 && rate < 0.03) {
      alerts.push({
        type: "danger",
        text: `${name} — ${formatRate(success, sm)} success rate across ${formatNumber(sm)} sessions`,
      });
    } else if (sm === 0) {
      alerts.push({
        type: "warn",
        text: `${name} — zero sessions in this window`,
      });
    }
  });

  if (!alerts.length) {
    kioskEls.alerts.innerHTML = "";
    return;
  }

  const COLLAPSED_COUNT = 3;
  const visible = alertsExpanded ? alerts : alerts.slice(0, COLLAPSED_COUNT);
  const hasMore = alerts.length > COLLAPSED_COUNT;

  let html = visible
    .map(
      (a) => `<div class="kiosk-alert ${a.type}"><span class="health-dot ${a.type === "danger" ? "red" : "amber"}"></span>${a.text}</div>`
    )
    .join("");

  if (hasMore) {
    const remaining = alerts.length - COLLAPSED_COUNT;
    html += `<div class="kiosk-alerts__expand" id="alertsExpandToggle">${
      alertsExpanded
        ? '<span class="partner-grid__expand-arrow">&#9650;</span> Show less'
        : `<span class="partner-grid__expand-arrow">&#9660;</span> Show ${remaining} more`
    }</div>`;
  }

  kioskEls.alerts.innerHTML = html;

  if (hasMore) {
    document.getElementById("alertsExpandToggle").addEventListener("click", () => {
      alertsExpanded = !alertsExpanded;
      renderAlerts(rows);
    });
  }
}

function initKioskLayout() {
  // Hide normal dashboard sections
  const normalSections = document.querySelectorAll(".dashboard-grid, .section-title, .table-wrap");
  normalSections.forEach((el) => (el.style.display = "none"));
  const chartSections = document.querySelectorAll('.dashboard-grid.two');
  chartSections.forEach((el) => (el.style.display = "none"));

  // Hide old detail panel (we use modal now)
  if (kioskEls.detailPanel) kioskEls.detailPanel.style.display = "none";

  // Show kiosk containers
  if (kioskEls.alerts) kioskEls.alerts.style.display = "";
  if (kioskEls.partnerGrid) kioskEls.partnerGrid.style.display = "";

  // Add "All FIs" section title before the grid
  const gridTitle = document.createElement("div");
  gridTitle.className = "kiosk-section-title";
  gridTitle.textContent = "All FIs";
  gridTitle.style.marginTop = "8px";
  kioskEls.partnerGrid.parentNode.insertBefore(gridTitle, kioskEls.partnerGrid);

  // Add "Include test data" checkbox to kiosk header
  const headerStatus = document.querySelector(".kiosk-header__status");
  if (headerStatus) {
    const label = document.createElement("label");
    label.className = "kiosk-test-toggle";
    label.innerHTML = `<input type="checkbox" id="kioskIncludeTests" /> Include test data`;
    headerStatus.insertBefore(label, headerStatus.firstChild);
    document.getElementById("kioskIncludeTests").addEventListener("change", (e) => {
      state.includeTests = e.target.checked;
      fetchWeeklyTrends().then(() => fetchMetrics());
    });
  }

  // ESC key closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetailModal();
  });
}

function renderKioskView() {
  if (!state.data) return;
  const byFi = normalizeRows(state.data.by_fi || []);
  renderAlerts(byFi);
  renderPartnerGrid(byFi);
}

/* ── Init ── */

function init() {
  const kiosk = isKioskMode();

  if (kiosk) {
    initKioskMode("CS Portfolio Dashboard — Last 30 Days", 300);
    initKioskLayout();
    state.windowDays = 30;
    loadFiRegistry();
    startAutoRefresh(async () => {
      await fetchWeeklyTrends();
      await fetchMetrics();
    }, 300000); // 5 minutes
  } else {
    initTimeWindows();
    bindSortHandlers();
    loadFiRegistry();
    els.fiScope.addEventListener("change", (event) => {
      state.fiScope = event.target.value || "all";
      fetchMetrics();
    });
    els.exportOverall.addEventListener("click", handleExportFi);
    els.exportSources.addEventListener("click", handleExportSources);
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
  }
}

init();
