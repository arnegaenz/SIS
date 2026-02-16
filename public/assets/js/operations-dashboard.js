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

const state = {
  windowDays: 30,
  fiScope: "all",
  fiList: [],
  instanceList: [],
  merchantList: [],
  data: null,
  loading: false,
  merchantSortKey: "Jobs_Failed",
  merchantSortDir: "desc",
  fiSortKey: "Jobs_Failed",
  fiSortDir: "desc",
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

function renderKioskKpis(overall, byMerchant) {
  if (!kioskEls.kpiRow) return;
  const total = overall.Jobs_Total || 0;
  const success = overall.Jobs_Success || 0;
  const failed = overall.Jobs_Failed || 0;
  const activeMerchants = byMerchant.filter((m) => (m.Jobs_Total || 0) > 0).length;

  kioskEls.kpiRow.innerHTML = `
    <div class="card">
      <h3>Total Jobs</h3>
      <div class="kpi-value">${formatNumber(total)}</div>
    </div>
    <div class="card">
      <h3>Success Rate</h3>
      <div class="kpi-value" style="color:${total > 0 && success / total >= 0.85 ? "#22c55e" : total > 0 && success / total >= 0.70 ? "#f59e0b" : "#ef4444"}">${formatRate(success, total)}</div>
    </div>
    <div class="card">
      <h3>Failure Rate</h3>
      <div class="kpi-value">${formatRate(failed, total)}</div>
    </div>
    <div class="card">
      <h3>Active Merchants</h3>
      <div class="kpi-value">${formatNumber(activeMerchants)}</div>
    </div>
  `;
}

function renderMerchantHealthGrid(rows) {
  if (!kioskEls.merchantGrid) return;
  const sorted = [...rows]
    .filter((r) => (r.Jobs_Total || 0) > 0)
    .sort((a, b) => (a.failure_rate || 0) > (b.failure_rate || 0) ? -1 : 1);

  kioskEls.merchantGrid.innerHTML = sorted
    .slice(0, 30)
    .map((row) => {
      const successRate = row.Jobs_Total > 0 ? (row.Jobs_Success || 0) / row.Jobs_Total : 1;
      const color = opsHealthColor(successRate);
      return `
        <div class="merchant-tile">
          <div class="merchant-tile__header">
            <span class="merchant-tile__name">${row.merchant_name || "Unknown"}</span>
            <span class="health-dot ${color}"></span>
          </div>
          <div class="merchant-tile__stats">
            <span><span class="merchant-tile__stat-value">${formatNumber(row.Jobs_Total || 0)}</span> jobs</span>
            <span><span class="merchant-tile__stat-value">${formatPercent(row.failure_rate || 0)}</span> fail</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderVolumeSparkline(byDay) {
  if (!kioskEls.volumeChart) return;
  if (!byDay.length) {
    kioskEls.volumeChart.innerHTML = `<div class="empty-state">No daily data.</div>`;
    return;
  }

  const width = kioskEls.volumeChart.clientWidth || 500;
  const height = 180;
  const padding = 36;
  const maxVal = Math.max(...byDay.map((d) => d.Jobs_Total || 0), 1);
  const stepX = byDay.length > 1 ? (width - padding * 2) / (byDay.length - 1) : 0;

  // Success area
  const successPoints = byDay.map((d, i) => {
    const x = padding + i * stepX;
    const y = height - padding - ((d.Jobs_Success || 0) / maxVal) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  // Total area
  const totalPoints = byDay.map((d, i) => {
    const x = padding + i * stepX;
    const y = height - padding - ((d.Jobs_Total || 0) / maxVal) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const totalPath = `M${totalPoints.join(" L")}`;
  const successPath = `M${successPoints.join(" L")}`;
  const totalArea = `${totalPath} L${(padding + (byDay.length - 1) * stepX).toFixed(1)},${height - padding} L${padding},${height - padding} Z`;
  const successArea = `${successPath} L${(padding + (byDay.length - 1) * stepX).toFixed(1)},${height - padding} L${padding},${height - padding} Z`;

  // Date labels
  const labels = byDay
    .filter((_, i) => i === 0 || i === byDay.length - 1 || i === Math.floor(byDay.length / 2))
    .map((d, idx, arr) => {
      const i = idx === 0 ? 0 : idx === arr.length - 1 ? byDay.length - 1 : Math.floor(byDay.length / 2);
      const x = padding + i * stepX;
      return `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="#64748b" font-size="10">${(d.date || "").slice(5)}</text>`;
    })
    .join("");

  kioskEls.volumeChart.innerHTML = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <path d="${totalArea}" fill="rgba(122,162,255,0.12)" />
      <path d="${totalPath}" fill="none" stroke="#7aa2ff" stroke-width="2" />
      <path d="${successArea}" fill="rgba(34,197,94,0.12)" />
      <path d="${successPath}" fill="none" stroke="#22c55e" stroke-width="2" />
      ${labels}
    </svg>
    <div class="legend" style="margin-top:6px;">
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
    const events = data.events || [];
    if (!events.length) {
      kioskEls.eventList.innerHTML = `<div class="empty-state">No recent events.</div>`;
      return;
    }
    kioskEls.eventList.innerHTML = events
      .map((evt) => {
        const statusClass = evt.status === "success" ? "success" : evt.status === "pending" ? "pending" : "failed";
        return `
          <div class="event-feed__item">
            <span class="event-feed__time">${formatRelativeTime(evt.timestamp)}</span>
            <span class="event-feed__merchant">${evt.merchant || "Unknown"}</span>
            <span class="event-feed__fi">${evt.fi_name || ""}</span>
            <span class="event-feed__status ${statusClass}">${evt.status || "unknown"}</span>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.warn("[ops-kiosk] event feed failed", err);
  }
}

function initKioskLayout() {
  // Hide normal dashboard sections
  const normalSections = document.querySelectorAll(
    ".dashboard-grid, .dashboard-grid.two, .section-title, .table-wrap"
  );
  normalSections.forEach((el) => (el.style.display = "none"));

  // Show kiosk containers
  if (kioskEls.kpiRow) kioskEls.kpiRow.style.display = "";
  if (kioskEls.split) kioskEls.split.style.display = "";
}

function renderKioskView() {
  if (!state.data) return;
  const overall = state.data.overall || {};
  const byMerchant = addFailureRates(state.data.by_merchant || []);
  const byDay = state.data.by_day || [];

  renderKioskKpis(overall, byMerchant);
  renderMerchantHealthGrid(byMerchant);
  renderVolumeSparkline(byDay);
}

async function kioskRefresh() {
  await fetchMetrics();
  await fetchEventFeed();
}

/* ── Init ── */

function init() {
  const kiosk = isKioskMode();

  if (kiosk) {
    initKioskMode("Operations Command Center", 30);
    initKioskLayout();
    state.windowDays = 7;
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
    fetchMetrics();
  }
}

init();
