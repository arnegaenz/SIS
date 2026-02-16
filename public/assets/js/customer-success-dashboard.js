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
    source_type_list: state.sourceTypes,
    source_category_list: state.sourceCategories,
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

function renderPartnerGrid(rows) {
  if (!kioskEls.partnerGrid) return;
  kioskEls.partnerGrid.innerHTML = "";
  const sorted = [...rows].sort((a, b) => (b.SM_Sessions || 0) - (a.SM_Sessions || 0));

  sorted.forEach((row) => {
    const sm = row.SM_Sessions || 0;
    const success = row.Success_Sessions || 0;
    const rate = sm > 0 ? success / sm : 0;
    const color = healthColor(rate);

    const card = document.createElement("div");
    card.className = `partner-card${selectedFi === row.fi_lookup_key ? " selected" : ""}`;
    card.innerHTML = `
      <div class="partner-card__header">
        <span class="partner-card__name">${row.fi_name || row.fi_lookup_key || "Unknown"}</span>
        <span class="health-dot ${color}"></span>
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
      </div>
    `;
    card.addEventListener("click", () => {
      selectedFi = row.fi_lookup_key;
      renderPartnerGrid(rows); // re-render to update selected state
      renderDetailPanel(row);
    });
    kioskEls.partnerGrid.appendChild(card);
  });
}

function renderDetailPanel(row) {
  if (!kioskEls.detailPanel) return;
  const sm = row.SM_Sessions || 0;
  const ce = row.CE_Sessions || 0;
  const success = row.Success_Sessions || 0;
  const jobsTotal = row.Jobs_Total || 0;
  const jobsSuccess = row.Jobs_Success || 0;
  const rate = sm > 0 ? success / sm : 0;

  kioskEls.detailPanelName.textContent = row.fi_name || row.fi_lookup_key || "Unknown";
  kioskEls.detailPanelHealth.innerHTML = `<span class="health-dot ${healthColor(rate)}"></span>`;

  kioskEls.detailPanelStats.innerHTML = `
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
  `;

  // Mini funnel
  const steps = [
    { label: "Select Merchant", value: sm },
    { label: "Credential Entry", value: ce },
    { label: "Success", value: success },
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);
  kioskEls.detailPanelFunnel.innerHTML = steps
    .map((step) => {
      const width = step.value > 0 ? Math.max(6, (step.value / max) * 100) : 0;
      return `
        <div class="funnel-row">
          <div class="funnel-label">${step.label}</div>
          <div class="funnel-bar" style="width:${width}%"></div>
          <div class="funnel-metric">${formatNumber(step.value)}</div>
        </div>
      `;
    })
    .join("");

  kioskEls.detailPanel.classList.add("open");
}

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

  // Show max 5 alerts
  kioskEls.alerts.innerHTML = alerts
    .slice(0, 5)
    .map(
      (a) => `<div class="kiosk-alert ${a.type}"><span class="health-dot ${a.type === "danger" ? "red" : "amber"}"></span>${a.text}</div>`
    )
    .join("");
}

function initKioskLayout() {
  // Hide normal dashboard sections
  const normalSections = document.querySelectorAll(".dashboard-grid, .section-title, .table-wrap");
  normalSections.forEach((el) => (el.style.display = "none"));
  // Also hide the chart panels section
  const chartSections = document.querySelectorAll('.dashboard-grid.two');
  chartSections.forEach((el) => (el.style.display = "none"));

  // Show kiosk containers
  if (kioskEls.alerts) kioskEls.alerts.style.display = "";
  if (kioskEls.partnerGrid) kioskEls.partnerGrid.style.display = "";

  // Detail panel close button
  if (kioskEls.detailPanelClose) {
    kioskEls.detailPanelClose.addEventListener("click", () => {
      selectedFi = null;
      kioskEls.detailPanel.classList.remove("open");
      if (state.data) renderPartnerGrid(normalizeRows(state.data.by_fi || []));
    });
  }
}

function renderKioskView() {
  if (!state.data) return;
  const byFi = normalizeRows(state.data.by_fi || []);
  renderPartnerGrid(byFi);
  renderAlerts(byFi);

  // If an FI was selected, refresh its panel too
  if (selectedFi) {
    const match = byFi.find((r) => r.fi_lookup_key === selectedFi);
    if (match) renderDetailPanel(match);
  }
}

/* ── Init ── */

function init() {
  const kiosk = isKioskMode();

  if (kiosk) {
    initKioskMode("CS Portfolio Dashboard — Last 30 Days", 300);
    initKioskLayout();
    state.windowDays = 30;
    loadFiRegistry();
    startAutoRefresh(fetchMetrics, 300000); // 5 minutes
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
    fetchMetrics();
  }
}

init();
