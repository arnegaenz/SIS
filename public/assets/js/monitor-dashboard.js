import {
  isKioskMode,
  initKioskMode,
  startAutoRefresh,
  formatRelativeTime,
} from "./dashboard-utils.js";

/* ── Constants ── */
const REFRESH_KIOSK_MS = 30 * 1000;
const REFRESH_NORMAL_MS = 60 * 1000;
const RT_THRESHOLDS = { green: 1000, yellow: 3000 }; // ms
const MERCHANT_FAIL_THRESHOLD = 0.50;
const MERCHANT_MIN_JOBS = 3;

/* ── DOM Cache ── */
const els = {
  toolbar: document.getElementById("monitorToolbar"),
  kioskEnterBtn: document.getElementById("kioskEnterBtn"),
  lastUpdated: document.getElementById("lastUpdated"),
  banner: document.getElementById("overallBanner"),
  instanceGrid: document.getElementById("instanceGrid"),
  pipelineStatus: document.getElementById("pipelineStatus"),
  trafficAlerts: document.getElementById("trafficAlerts"),
  trafficBadge: document.getElementById("trafficBadge"),
  merchantAlerts: document.getElementById("merchantAlerts"),
  merchantBadge: document.getElementById("merchantBadge"),
};

/* ── Helpers ── */
function statusColor(ms, failed) {
  if (failed) return "red";
  if (ms > RT_THRESHOLDS.yellow) return "red";
  if (ms > RT_THRESHOLDS.green) return "yellow";
  return "green";
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pipelineFreshness(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "red";
  if (ageMs < 15 * 60 * 1000) return "green";
  if (ageMs < 30 * 60 * 1000) return "yellow";
  return "red";
}

function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "unknown";
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ${mins % 60}m ago`;
  return `${(hrs / 24).toFixed(1)}d ago`;
}

/** Build a tiny SVG sparkline from an array of numbers */
function sparklineSvg(values, width = 60, height = 20, color = "#48bb78") {
  if (!values || values.length < 2) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = (i * step).toFixed(1);
    const y = (height - ((v - min) / range) * (height - 2) - 1).toFixed(1);
    return `${x},${y}`;
  }).join(" ");
  return `<svg class="mon-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Compute a bar width percentage for a response time relative to threshold */
function rtBarPct(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  // Scale: 0-3000ms = 0-100%
  return Math.min(100, Math.round((ms / 3000) * 100));
}

function rtBarColor(ms) {
  if (!Number.isFinite(ms)) return "#fc8181";
  if (ms <= RT_THRESHOLDS.green) return "#48bb78";
  if (ms <= RT_THRESHOLDS.yellow) return "#ecc94b";
  return "#fc8181";
}

/* ── Data Fetching ── */
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/* ── Global state for banner computation ── */
let _bannerState = { down: 0, warnings: 0 };

/* ── Render: Overall Status Banner ── */
function renderBanner() {
  const el = els.banner;
  if (!el) return;
  const { down, warnings } = _bannerState;

  let level, text;
  if (down > 0) {
    level = "red";
    text = `${down} SYSTEM${down > 1 ? "S" : ""} DOWN`;
  } else if (warnings > 0) {
    level = "yellow";
    text = `${warnings} WARNING${warnings > 1 ? "S" : ""} DETECTED`;
  } else {
    level = "green";
    text = "ALL SYSTEMS OPERATIONAL";
  }

  el.className = `monitor-banner monitor-banner--${level}`;
  el.innerHTML = `
    <div class="monitor-banner__dot monitor-banner__dot--${level}"></div>
    <div class="monitor-banner__text">${text}</div>
  `;
}

/* ── Render: Instance Status Board ── */
function renderInstances(data) {
  const grid = els.instanceGrid;
  if (!data || !data.instances || data.instances.length === 0) {
    grid.innerHTML = `<div class="mon-empty">No instance data available</div>`;
    return;
  }

  const history = data.history || [];
  const uptime = data.uptime || {};

  // Update last-updated timestamp
  if (data.lastCheck && els.lastUpdated) {
    els.lastUpdated.textContent = `Last check: ${formatRelativeTime(data.lastCheck)}`;
  }

  // Count issues for banner
  let instanceDown = 0;
  let instanceWarn = 0;

  grid.innerHTML = data.instances.map(inst => {
    const feColor = inst.frontend ? statusColor(inst.frontend.ms, inst.frontend.status === "red") : "red";
    const beColor = inst.backend ? statusColor(inst.backend.ms, inst.backend.status === "red") : "red";
    const overallColor = (feColor === "red" || beColor === "red") ? "red"
      : (feColor === "yellow" || beColor === "yellow") ? "yellow" : "green";

    if (overallColor === "red") instanceDown++;
    else if (overallColor === "yellow") instanceWarn++;

    // Active FI count from cached activity data
    const activityData = _instanceActivity?.instances?.[inst.name];
    const activeFis = activityData?.fis?.length || 0;
    const todaySessions = activityData?.total_sessions || 0;

    const uptimePct = uptime[inst.name] ?? 100;
    const uptimeColor = uptimePct >= 100 ? "#48bb78" : uptimePct >= 75 ? "#ecc94b" : "#fc8181";

    // Build sparkline data from history
    const feHistory = history.map(h => {
      const found = h.instances.find(i => i.name === inst.name);
      return found?.frontendMs ?? null;
    }).filter(v => v !== null);
    const beHistory = history.map(h => {
      const found = h.instances.find(i => i.name === inst.name);
      return found?.backendMs ?? null;
    }).filter(v => v !== null);

    // Tooltip content
    const feUrl = inst.frontend?.url || "";
    const feError = inst.frontend?.error || "";
    const beError = inst.backend?.error || "";
    let tooltip = feUrl ? `URL: ${feUrl}` : "";
    if (feError) tooltip += `\nFE Error: ${feError}`;
    if (beError) tooltip += `\nBE Error: ${beError}`;

    return `
      <div class="mon-instance-card mon-instance-card--${overallColor}" data-instance="${escHtml(inst.name)}" style="cursor:pointer;" title="${escHtml(tooltip)}">
        <div class="mon-instance-card__top">
          <span class="mon-instance-card__name">${escHtml(inst.name)}</span>
          <span class="mon-dot mon-dot--${overallColor} ${overallColor === "red" ? "mon-dot--pulse" : ""}"></span>
        </div>
        <div class="mon-instance-card__metrics">
          <div class="mon-instance-card__metric">
            <div class="mon-instance-card__metric-header">
              <span class="mon-dot mon-dot--sm mon-dot--${feColor}"></span>
              <span class="mon-label">Frontend</span>
              <span class="mon-value">${formatMs(inst.frontend?.ms)}</span>
            </div>
            <div class="mon-rt-bar"><div class="mon-rt-bar__fill" style="width:${rtBarPct(inst.frontend?.ms)}%;background:${rtBarColor(inst.frontend?.ms)}"></div></div>
          </div>
          <div class="mon-instance-card__metric">
            <div class="mon-instance-card__metric-header">
              <span class="mon-dot mon-dot--sm mon-dot--${beColor}"></span>
              <span class="mon-label">Backend</span>
              <span class="mon-value">${formatMs(inst.backend?.ms)}</span>
            </div>
            <div class="mon-rt-bar"><div class="mon-rt-bar__fill" style="width:${rtBarPct(inst.backend?.ms)}%;background:${rtBarColor(inst.backend?.ms)}"></div></div>
          </div>
        </div>
        <div class="mon-instance-card__footer">
          <div class="mon-instance-card__sparkline">
            ${sparklineSvg(feHistory.length >= 2 ? feHistory : beHistory, 60, 20, overallColor === "green" ? "#48bb78" : overallColor === "yellow" ? "#ecc94b" : "#fc8181")}
          </div>
          <span style="font-size:0.7rem;color:var(--muted);">${activeFis} FIs · ${todaySessions} sessions</span>
          <span class="mon-instance-card__uptime" style="color:${uptimeColor}">${uptimePct}%</span>
        </div>
      </div>
    `;
  }).join("");

  _bannerState.down = instanceDown;
  _bannerState.warnings = instanceWarn;

  // Bind click handlers for instance detail
  grid.querySelectorAll(".mon-instance-card[data-instance]").forEach(card => {
    card.addEventListener("click", () => {
      const instName = card.dataset.instance;
      showInstanceDetail(instName);
    });
  });
}

/* ── Instance Detail Panel ── */
let _instanceActivity = null;

async function showInstanceDetail(instName) {
  const titleEl = document.getElementById("instanceDetailTitle");
  const detailEl = document.getElementById("instanceDetail");
  if (!titleEl || !detailEl) return;

  titleEl.style.display = "";
  detailEl.style.display = "";
  titleEl.textContent = `INSTANCE: ${instName.toUpperCase()}`;

  // Fetch activity data if not cached
  if (!_instanceActivity) {
    detailEl.innerHTML = `<div class="mon-loading">Loading activity data...</div>`;
    try {
      _instanceActivity = await fetchJson("/api/instance-activity");
    } catch {
      detailEl.innerHTML = `<div class="mon-error">Failed to load activity data</div>`;
      return;
    }
  }

  const instData = _instanceActivity?.instances?.[instName];
  if (!instData || instData.fis.length === 0) {
    detailEl.innerHTML = `<div class="mon-empty">No active FIs on this instance today</div>`;
    return;
  }

  detailEl.innerHTML = `
    <div style="display:flex;gap:24px;margin-bottom:16px;">
      <div>
        <div style="font-size:1.8rem;font-weight:700;color:var(--text);">${instData.total_sessions}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Sessions Today</div>
      </div>
      <div>
        <div style="font-size:1.8rem;font-weight:700;color:var(--text);">${instData.total_placements}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Placements Today</div>
      </div>
      <div>
        <div style="font-size:1.8rem;font-weight:700;color:var(--accent, #63b3ed);">${instData.fis.length}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Active FIs</div>
      </div>
    </div>
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr;padding:8px 14px;background:var(--panel-light);font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);">
        <span>FI</span><span>Sessions</span><span>Placements</span><span>Last Seen</span>
      </div>
      ${instData.fis.map(fi => `
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr;padding:8px 14px;border-top:1px solid var(--border);font-size:0.8rem;">
          <span style="color:var(--text);font-weight:500;">${escHtml(fi.fi_name)}</span>
          <span style="color:var(--text);">${fi.sessions}</span>
          <span style="color:var(--text);">${fi.placements}</span>
          <span style="color:var(--muted);">${fi.last_seen ? formatRelativeTime(fi.last_seen) : "—"}</span>
        </div>
      `).join("")}
    </div>
  `;

  // Scroll to detail
  detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── Render: Pipeline Status ── */
function renderPipeline(data) {
  const el = els.pipelineStatus;
  if (!data) {
    el.innerHTML = `<div class="mon-empty">Pipeline status unavailable</div>`;
    return;
  }

  const items = [];

  if (data.placements_cache) {
    const age = data.placements_cache.age_ms;
    const color = pipelineFreshness(age);
    const pct = Math.min(100, Math.round((age / (30 * 60 * 1000)) * 100));
    items.push({ label: "Placements Cache", color, detail: formatAge(age), pct,
      sub: data.placements_cache.last_update ? new Date(data.placements_cache.last_update).toLocaleTimeString() : "" });
  }

  if (data.sessions_cache) {
    const age = data.sessions_cache.age_ms;
    const color = pipelineFreshness(age);
    const pct = Math.min(100, Math.round((age / (30 * 60 * 1000)) * 100));
    items.push({ label: "Sessions Cache", color, detail: formatAge(age), pct,
      sub: data.sessions_cache.last_update ? new Date(data.sessions_cache.last_update).toLocaleTimeString() : "" });
  }

  if (data.ga_realtime) {
    const count = data.ga_realtime.snapshots || 0;
    const lastSnap = data.ga_realtime.last_snapshot;
    let age = Infinity;
    if (lastSnap) age = Date.now() - new Date(lastSnap).getTime();
    const color = count === 0 ? "red" : pipelineFreshness(age);
    const pct = count === 0 ? 100 : Math.min(100, Math.round((age / (30 * 60 * 1000)) * 100));
    items.push({ label: "GA Realtime", color, detail: count > 0 ? `${count} snapshots` : "No snapshots", pct,
      sub: lastSnap ? formatRelativeTime(lastSnap) : "" });
  }

  if (data.instance_failures) {
    const failures = data.instance_failures;
    const color = failures.length === 0 ? "green" : failures.length <= 2 ? "yellow" : "red";
    const pct = failures.length === 0 ? 0 : Math.min(100, failures.length * 25);
    items.push({ label: "Instance Connectivity", color,
      detail: failures.length === 0 ? "All OK" : `${failures.length} failing`, pct,
      sub: failures.length > 0 ? failures.join(", ") : "" });
  }

  if (items.length === 0) {
    el.innerHTML = `<div class="mon-empty">No pipeline data</div>`;
    return;
  }

  const colorHex = { green: "#48bb78", yellow: "#ecc94b", red: "#fc8181" };

  el.innerHTML = items.map(item => `
    <div class="mon-pipeline-card mon-pipeline-card--${item.color}">
      <div class="mon-pipeline-card__header">
        <span class="mon-dot mon-dot--${item.color}"></span>
        <span class="mon-pipeline-card__label">${escHtml(item.label)}</span>
      </div>
      <div class="mon-pipeline-card__value">${escHtml(item.detail)}</div>
      <div class="mon-freshness-bar"><div class="mon-freshness-bar__fill" style="width:${item.pct}%;background:${colorHex[item.color]}"></div></div>
      ${item.sub ? `<div class="mon-pipeline-card__sub">${escHtml(item.sub)}</div>` : ""}
    </div>
  `).join("");
}

/* ── Render: Traffic Anomalies ── */
function renderTrafficAlerts(data) {
  _lastTrafficData = data;
  const el = els.trafficAlerts;
  if (!data || !data.fis) {
    el.innerHTML = `<div class="mon-empty">No traffic data available</div>`;
    if (els.trafficBadge) els.trafficBadge.textContent = "0";
    return;
  }

  const anomalies = data.fis.filter(fi =>
    fi.status === "dark" || fi.status === "low" || fi.status === "declining"
  );

  if (els.trafficBadge) els.trafficBadge.textContent = String(anomalies.length);

  // Add traffic anomalies to banner warnings
  _bannerState.warnings += anomalies.filter(f => f.status === "low" || f.status === "declining").length;
  _bannerState.down += anomalies.filter(f => f.status === "dark").length;

  if (anomalies.length === 0) {
    el.innerHTML = `<div class="mon-all-clear">All FIs reporting normal traffic</div>`;
    return;
  }

  const order = { dark: 0, low: 1, declining: 2 };
  anomalies.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  el.innerHTML = anomalies.map(fi => {
    const isDark = fi.status === "dark";
    const color = isDark ? "red" : "yellow";
    const statusText = isDark ? "DARK" : fi.status === "low" ? "LOW" : "DECLINING";
    const hoursSince = fi.hours_since_last != null ? `${Math.round(fi.hours_since_last)}h ago` : "";
    const baselinePct = fi.pct_of_baseline != null ? `${Math.round(fi.pct_of_baseline)}% of baseline` : "";

    // Daily counts sparkline
    const dailyCounts = fi.daily_counts || [];
    const sparkColor = isDark ? "#fc8181" : "#ecc94b";
    const spark = sparklineSvg(dailyCounts.slice(-7), 50, 16, sparkColor);

    return `
      <div class="mon-alert-row mon-alert-row--${color}" data-fi-key="${escHtml(fi.fi_lookup_key || fi.fi_name || "")}" style="cursor:pointer;" title="Click for details">
        <span class="mon-alert-badge mon-alert-badge--${color}">${statusText}</span>
        <span class="mon-alert-name">${escHtml(fi.fi_name || fi.fi_key || "")}</span>
        <span class="mon-alert-partner">${escHtml(fi.partner || "")}</span>
        <span class="mon-alert-spark">${spark}</span>
        <span class="mon-alert-detail">${escHtml(hoursSince)}${hoursSince && baselinePct ? " | " : ""}${escHtml(baselinePct)}</span>
      </div>
    `;
  }).join("");

  // Bind click handlers
  el.querySelectorAll(".mon-alert-row[data-fi-key]").forEach(row => {
    row.addEventListener("click", () => {
      const fiKey = row.dataset.fiKey;
      const fi = (_lastTrafficData?.fis || []).find(f => (f.fi_lookup_key || f.fi_name) === fiKey);
      if (fi) showFiModal(fi);
    });
  });
}

/* ── Render: Merchant Alerts ── */
function renderMerchantAlerts(opsData) {
  const el = els.merchantAlerts;
  if (!opsData || !opsData.by_merchant) {
    el.innerHTML = `<div class="mon-empty">No merchant data available</div>`;
    if (els.merchantBadge) els.merchantBadge.textContent = "0";
    return;
  }

  const alerts = [];
  for (const m of opsData.by_merchant) {
    const total = m.Jobs_Total || 0;
    if (total < MERCHANT_MIN_JOBS) continue;
    const failed = m.Jobs_Failed || 0;
    const failRate = total > 0 ? failed / total : 0;
    if (failRate < MERCHANT_FAIL_THRESHOLD) continue;

    alerts.push({
      name: m.merchant_name || "Unknown",
      failRate,
      total,
      failures: failed,
      success: m.Jobs_Success || 0,
      topError: m.top_error_code || "-",
    });
  }

  alerts.sort((a, b) => b.failRate - a.failRate);

  if (els.merchantBadge) els.merchantBadge.textContent = String(alerts.length);

  // Add merchant alerts to banner
  _bannerState.warnings += alerts.length;

  if (alerts.length === 0) {
    el.innerHTML = `<div class="mon-all-clear">No merchants above ${Math.round(MERCHANT_FAIL_THRESHOLD * 100)}% failure rate</div>`;
    return;
  }

  el.innerHTML = alerts.slice(0, 20).map(a => {
    const pct = (a.failRate * 100).toFixed(1);
    const color = a.failRate >= 0.80 ? "red" : "yellow";
    const successPct = a.total > 0 ? Math.round((a.success / a.total) * 100) : 0;
    const failPct = 100 - successPct;

    return `
      <div class="mon-alert-row mon-alert-row--${color}" data-merchant="${escHtml(a.name)}" style="cursor:pointer;" title="Click for details">
        <span class="mon-merchant-pct mon-merchant-pct--${color}">${pct}%</span>
        <span class="mon-alert-name">${escHtml(a.name)}</span>
        <span class="mon-merchant-ratio">${a.failures}/${a.total}</span>
        <div class="mon-fail-bar">
          <div class="mon-fail-bar__success" style="width:${successPct}%"></div>
          <div class="mon-fail-bar__fail" style="width:${failPct}%"></div>
        </div>
        <span class="mon-alert-detail">${escHtml(a.topError)}</span>
      </div>
    `;
  }).join("");

  // Bind click handlers for merchant detail modal
  el.querySelectorAll(".mon-alert-row[data-merchant]").forEach(row => {
    row.addEventListener("click", () => {
      const merchantName = row.dataset.merchant;
      const alert = alerts.find(a => a.name === merchantName);
      if (alert) showMerchantModal(alert);
    });
  });
}

/* ── Merchant Detail Modal ── */
let _lastFeedEvents = [];
let _lastTrafficData = null;

function showMerchantModal(alert) {
  const overlay = document.getElementById("monitorModalOverlay");
  const nameEl = document.getElementById("monitorModalName");
  const subEl = document.getElementById("monitorModalSubtitle");
  const contentEl = document.getElementById("monitorModalContent");
  if (!overlay || !contentEl) return;

  nameEl.textContent = alert.name;
  const pct = (alert.failRate * 100).toFixed(1);
  subEl.textContent = `${pct}% failure rate — ${alert.failures} of ${alert.total} jobs failed`;

  // Find feed events for this merchant — only system-side results (success + failed), exclude abandoned/cancelled
  const merchantEvents = _lastFeedEvents.filter(evt =>
    (evt.merchant || "").toLowerCase() === alert.name.toLowerCase()
    && (evt.status === "success" || evt.status === "failed")
  );

  let eventsHtml = "";
  if (merchantEvents.length > 0) {
    const rows = merchantEvents.map(evt => {
      const evtDate = evt.timestamp ? new Date(evt.timestamp) : null;
      const time = evtDate
        ? evtDate.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + evtDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";
      const statusCls = evt.status === "success" ? "color:#48bb78" : evt.status === "cancelled" ? "color:#ecc94b" : "color:#fc8181";
      const termLabel = evt.termination_type && evt.status !== "success"
        ? `<span style="font-family:monospace;font-size:0.72rem;color:var(--muted);margin-left:6px;">${escHtml(evt.termination_type)}</span>`
        : "";
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.8rem;">
          <span style="color:var(--muted);min-width:110px;font-variant-numeric:tabular-nums;">${time}</span>
          <span style="color:var(--text);flex:1;">${escHtml(evt.fi_name || "")}</span>
          <span style="font-weight:600;${statusCls};text-transform:uppercase;">${evt.status || ""}</span>
          ${termLabel}
        </div>
      `;
    }).join("");

    eventsHtml = `
      <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin:16px 0 8px;">Job History (${merchantEvents.length} events)</div>
      <div class="detail-modal__scrollable">${rows}</div>
    `;
  } else {
    eventsHtml = `<div style="color:var(--muted);font-size:0.8rem;margin-top:16px;">No recent events found for this merchant.</div>`;
  }

  contentEl.innerHTML = `
    <div style="display:flex;gap:24px;margin-bottom:12px;">
      <div>
        <div style="font-size:2rem;font-weight:700;color:#fc8181;">${pct}%</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Failure Rate</div>
      </div>
      <div>
        <div style="font-size:2rem;font-weight:700;color:var(--text);">${alert.total}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Total Jobs</div>
      </div>
      <div>
        <div style="font-size:2rem;font-weight:700;color:#48bb78;">${alert.success}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Successful</div>
      </div>
      <div>
        <div style="font-size:2rem;font-weight:700;color:#fc8181;">${alert.failures}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Failed</div>
      </div>
    </div>
    <div style="font-size:0.8rem;color:var(--muted);margin-bottom:8px;">Top Error: <span style="font-family:monospace;color:var(--text);">${escHtml(alert.topError)}</span></div>
    ${eventsHtml}
  `;

  overlay.style.display = "";
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function closeMonitorModal() {
  const overlay = document.getElementById("monitorModalOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  setTimeout(() => { overlay.style.display = "none"; }, 200);
}

// Modal close handlers
document.getElementById("monitorModalClose")?.addEventListener("click", closeMonitorModal);
document.getElementById("monitorModalOverlay")?.addEventListener("click", (e) => {
  if (e.target.id === "monitorModalOverlay") closeMonitorModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMonitorModal();
});

/* ── FI Detail Modal ── */
function showFiModal(fi) {
  const overlay = document.getElementById("monitorModalOverlay");
  const nameEl = document.getElementById("monitorModalName");
  const subEl = document.getElementById("monitorModalSubtitle");
  const contentEl = document.getElementById("monitorModalContent");
  if (!overlay || !contentEl) return;

  const statusColors = { dark: "#fc8181", low: "#ecc94b", sleeping: "#818cf8", normal: "#48bb78" };
  const statusColor = statusColors[fi.status] || "#a0aec0";

  nameEl.textContent = fi.fi_name || fi.fi_lookup_key || "Unknown FI";
  subEl.textContent = `${fi.partner || "Unknown"} · ${fi.instance || fi.integration_type || ""}`;

  // Stats
  const dailyCounts = fi.daily_counts || [];
  const last7 = dailyCounts.slice(-7);
  const weekTotal = last7.reduce((s, c) => s + c, 0);
  const weekAvg = last7.length > 0 ? (weekTotal / last7.length).toFixed(1) : "0";

  // Bar chart SVG — 7 days with baseline
  const baseline = fi.baseline_median || 0;
  const maxVal = Math.max(...last7, baseline, 1);
  const chartW = 500, chartH = 140, padL = 40, padR = 10, padT = 10, padB = 24;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const barW = last7.length > 0 ? Math.min(50, (plotW - (last7.length - 1) * 6) / last7.length) : 40;

  let barsHtml = "";
  last7.forEach((val, i) => {
    const barH = Math.max(1, (val / maxVal) * plotH);
    const x = padL + i * (barW + 6);
    const y = padT + plotH - barH;
    const isToday = i === last7.length - 1;
    const fill = isToday ? statusColor : "var(--accent, #63b3ed)";
    const opacity = isToday ? 1 : 0.5;
    barsHtml += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${fill}" opacity="${opacity}" />`;
    if (val > 0) barsHtml += `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" fill="var(--muted)" font-size="9">${val}</text>`;
    const label = isToday ? "Today" : `-${last7.length - 1 - i}d`;
    barsHtml += `<text x="${x + barW/2}" y="${chartH - 6}" text-anchor="middle" fill="var(--muted)" font-size="9">${label}</text>`;
  });

  // Baseline line
  const baselineY = padT + plotH - Math.max(1, (baseline / maxVal) * plotH);
  const lineEnd = padL + (last7.length - 1) * (barW + 6) + barW;
  const baselineHtml = baseline > 0
    ? `<line x1="${padL}" y1="${baselineY}" x2="${lineEnd}" y2="${baselineY}" stroke="#ecc94b" stroke-width="1.5" stroke-dasharray="6,3" /><text x="${lineEnd + 4}" y="${baselineY + 3}" fill="#ecc94b" font-size="9">median ${baseline}/day</text>`
    : "";

  contentEl.innerHTML = `
    <div style="display:flex;gap:24px;margin-bottom:16px;flex-wrap:wrap;">
      <div>
        <div style="font-size:2rem;font-weight:700;color:${statusColor};text-transform:uppercase;">${fi.status}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Current Status</div>
      </div>
      <div>
        <div style="font-size:2rem;font-weight:700;color:var(--text);">${fi.today_sessions || 0}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Sessions Today</div>
      </div>
      <div>
        <div style="font-size:2rem;font-weight:700;color:var(--text);">${fi.baseline_median || 0}/day</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Baseline (Median)</div>
      </div>
      <div>
        <div style="font-size:2rem;font-weight:700;color:var(--text);">${fi.pct_of_baseline != null ? fi.pct_of_baseline + "%" : "—"}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">% of Baseline</div>
      </div>
      <div>
        <div style="font-size:2rem;font-weight:700;color:var(--text);">${fi.hours_since_last != null ? fi.hours_since_last + "h" : "—"}</div>
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Since Last Session</div>
      </div>
    </div>
    <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px;">7-Day Session Trend (avg ${weekAvg}/day)</div>
    <svg width="100%" height="${chartH}" viewBox="0 0 ${chartW + 60} ${chartH}" style="display:block;margin-bottom:12px;">
      ${barsHtml}
      ${baselineHtml}
    </svg>
  `;

  overlay.style.display = "";
  requestAnimationFrame(() => overlay.classList.add("open"));
}

/* ── Help Tooltips ── */
document.querySelectorAll(".monitor-help").forEach(helpBtn => {
  const text = helpBtn.getAttribute("title");
  helpBtn.removeAttribute("title"); // prevent native tooltip
  helpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Close any open tooltip
    document.querySelectorAll(".monitor-help-tooltip").forEach(t => t.remove());
    // Create and show tooltip
    const tip = document.createElement("div");
    tip.className = "monitor-help-tooltip";
    tip.textContent = text;
    helpBtn.appendChild(tip);
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".monitor-help-tooltip").forEach(t => t.remove());
});

/* ── Main Fetch ── */
async function fetchAll() {
  // Reset banner state
  _bannerState = { down: 0, warnings: 0 };

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateTo = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dateFrom = new Date(now);
  dateFrom.setDate(dateFrom.getDate() - 7);
  const dateFromStr = `${dateFrom.getFullYear()}-${pad(dateFrom.getMonth() + 1)}-${pad(dateFrom.getDate())}`;

  const results = await Promise.allSettled([
    fetchJson("/api/system-health"),
    fetchJson("/api/pipeline-status"),
    fetchJson("/api/instance-activity"),
  ]);

  // Instance health
  if (results[0].status === "fulfilled") {
    renderInstances(results[0].value);
  } else {
    els.instanceGrid.innerHTML = `<div class="mon-error">Failed to load instance status: ${escHtml(results[0].reason?.message)}</div>`;
  }

  // Pipeline
  if (results[1].status === "fulfilled") {
    renderPipeline(results[1].value);
  } else {
    els.pipelineStatus.innerHTML = `<div class="mon-error">Failed to load pipeline: ${escHtml(results[1].reason?.message)}</div>`;
  }

  // Cache instance activity for detail panel
  if (results[2].status === "fulfilled") {
    _instanceActivity = results[2].value;
  }

  // Update banner (after all sections have set their counts)
  renderBanner();

  // Update timestamp
  if (els.lastUpdated) {
    els.lastUpdated.textContent = `Updated: ${now.toLocaleTimeString()}`;
  }
}

/* ── Init ── */
if (isKioskMode()) {
  if (els.toolbar) els.toolbar.style.display = "none";
  initKioskMode("System Monitor", 30);
  startAutoRefresh(fetchAll, REFRESH_KIOSK_MS);
} else {
  fetchAll();

  if (els.kioskEnterBtn) {
    els.kioskEnterBtn.addEventListener("click", () => {
      const url = new URL(window.location);
      url.searchParams.set("kiosk", "1");
      window.location.href = url.toString();
    });
  }

  setInterval(fetchAll, REFRESH_NORMAL_MS);
}
