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
  monitorTotals: document.getElementById("monitorTotals"),
  monitorFeed: document.getElementById("monitorFeed"),
  trafficMap: document.getElementById("trafficMap"),
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
            ${sparklineSvg(feHistory.length >= 2 ? feHistory : beHistory, 80, 24, overallColor === "green" ? "#48bb78" : overallColor === "yellow" ? "#ecc94b" : "#fc8181")}
          </div>
          <span style="font-size:0.75rem;color:var(--muted);font-weight:600;">${activeFis} FIs · ${todaySessions} sessions</span>
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

/* ── Instance Detail Modal ── */
let _instanceActivity = null;

function showInstanceDetail(instName) {
  const overlay = document.getElementById("monitorModalOverlay");
  const nameEl = document.getElementById("monitorModalName");
  const subEl = document.getElementById("monitorModalSubtitle");
  const contentEl = document.getElementById("monitorModalContent");
  if (!overlay || !contentEl) return;

  const instData = _instanceActivity?.instances?.[instName];

  nameEl.textContent = instName;
  subEl.textContent = instData
    ? `${instData.total_sessions} sessions · ${instData.total_placements} placements · ${instData.fis.length} active FIs`
    : "No activity data";

  if (!instData || instData.fis.length === 0) {
    contentEl.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:16px 0;">No active FIs on this instance today.</div>`;
  } else {
    contentEl.innerHTML = `
      <div style="display:flex;gap:24px;margin-bottom:16px;">
        <div>
          <div style="font-size:2rem;font-weight:700;color:var(--text);">${instData.total_sessions}</div>
          <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Sessions Today</div>
        </div>
        <div>
          <div style="font-size:2rem;font-weight:700;color:var(--text);">${instData.total_placements}</div>
          <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Placements Today</div>
        </div>
        <div>
          <div style="font-size:2rem;font-weight:700;color:var(--accent, #63b3ed);">${instData.fis.length}</div>
          <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Active FIs</div>
        </div>
      </div>
      <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px;">Active FIs</div>
      <div class="detail-modal__scrollable">
        <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;">
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr;padding:8px 14px;background:var(--panel-light);font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);">
            <span>FI</span><span>Sessions</span><span>Placements</span><span>Last Seen</span>
          </div>
          ${instData.fis.map(fi => `
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr;padding:8px 14px;border-top:1px solid var(--border);font-size:0.8rem;">
              <span style="color:var(--text);font-weight:500;">${escHtml(fi.fi_name)}</span>
              <span style="color:var(--text);">${fi.sessions}</span>
              <span style="color:var(--text);">${fi.placements}</span>
              <span style="color:var(--muted);">${fi.last_seen ? formatRelativeTime(fi.last_seen) : "\u2014"}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  overlay.style.display = "";
  requestAnimationFrame(() => overlay.classList.add("open"));
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

/* ── Instance Badge Color Palette ── */
const INST_COLORS = [
  "rgba(99,179,237,0.25)",  // blue
  "rgba(72,187,120,0.25)",  // green
  "rgba(237,137,54,0.25)",  // orange
  "rgba(159,122,234,0.25)", // purple
  "rgba(236,201,75,0.25)",  // yellow
  "rgba(252,129,129,0.25)", // red
  "rgba(56,178,172,0.25)",  // teal
  "rgba(237,100,166,0.25)", // pink
  "rgba(144,205,244,0.25)", // light blue
  "rgba(154,230,180,0.25)", // light green
];

function instColorIndex(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % INST_COLORS.length;
}

/* ── Render: System Totals Strip ── */
function renderTotals(feedSummary) {
  const el = els.monitorTotals;
  if (!el) return;

  // Compute from _instanceActivity if available, with feed summary as fallback
  let totalSessions = 0, totalPlacements = 0, activeFis = 0, activeInstances = 0;

  if (_instanceActivity?.instances) {
    const fiSet = new Set();
    for (const [, inst] of Object.entries(_instanceActivity.instances)) {
      totalSessions += inst.total_sessions || 0;
      totalPlacements += inst.total_placements || 0;
      if (inst.total_sessions > 0) activeInstances++;
      for (const fi of (inst.fis || [])) {
        if (fi.fi_key) fiSet.add(fi.fi_key);
      }
    }
    activeFis = fiSet.size;
  }

  // Overlay feed summary numbers if available (more accurate for jobs)
  if (feedSummary) {
    if (feedSummary.unique_sessions > totalSessions) totalSessions = feedSummary.unique_sessions;
    if (feedSummary.total_jobs > totalPlacements) totalPlacements = feedSummary.total_jobs;
  }

  const cards = [
    { value: totalSessions, label: "Sessions" },
    { value: totalPlacements, label: "Placements" },
    { value: activeFis, label: "Active FIs" },
    { value: activeInstances, label: "Active Instances" },
  ];

  el.innerHTML = cards.map(c => `
    <div class="mon-totals-card">
      <span class="mon-totals-card__value">${c.value.toLocaleString()}</span>
      <span class="mon-totals-card__label">${c.label}</span>
    </div>
  `).join("");
}

/* ── Render: Live Activity Feed ── */
function renderActivityFeed(feedData) {
  const el = els.monitorFeed;
  if (!el) return;

  if (!feedData || !feedData.events || feedData.events.length === 0) {
    el.innerHTML = `<div class="mon-empty">No recent activity</div>`;
    return;
  }

  const events = feedData.events.slice(0, 50);

  const statusClasses = {
    success: "mon-feed-status--success",
    failed: "mon-feed-status--failed",
    cancelled: "mon-feed-status--cancelled",
    abandoned: "mon-feed-status--abandoned",
    session: "mon-feed-status--session",
  };

  const statusLabels = {
    success: "SUCCESS",
    failed: "FAILED",
    cancelled: "CANCELLED",
    abandoned: "ABANDONED",
    session: "SESSION",
  };

  el.innerHTML = events.map(evt => {
    const time = evt.timestamp ? formatRelativeTime(evt.timestamp) : "";
    const inst = evt.instance || "unknown";
    const colorIdx = instColorIndex(inst);
    const bgColor = INST_COLORS[colorIdx];
    const statusCls = statusClasses[evt.status] || "mon-feed-status--session";
    const statusLabel = statusLabels[evt.status] || evt.status?.toUpperCase() || "";
    const merchant = evt.merchant ? escHtml(evt.merchant) : "";
    const fiName = evt.fi_name ? escHtml(evt.fi_name) : "";
    const termType = evt.termination_type && evt.status === "failed"
      ? `<span class="mon-feed-term">${escHtml(evt.termination_type)}</span>` : "";

    return `
      <div class="mon-feed-row">
        <span class="mon-feed-time">${time}</span>
        <span class="mon-inst-badge" style="background:${bgColor}">${escHtml(inst)}</span>
        <span class="mon-feed-fi">${fiName}</span>
        <span class="mon-feed-merchant">${merchant || "\u2014"}</span>
        <span class="mon-feed-status ${statusCls}">${statusLabel}</span>
        ${termType}
      </div>
    `;
  }).join("");
}

/* ── US City Coordinates (Albers-like projection, 960x600 viewBox) ── */
const US_CITIES = {
  // Northeast
  "New York": {x:852,y:185},"Brooklyn": {x:854,y:187},"Manhattan": {x:851,y:184},
  "Queens": {x:855,y:185},"Bronx": {x:853,y:182},"Staten Island": {x:849,y:189},
  "Newark": {x:845,y:188},"Jersey City": {x:847,y:186},"Paterson": {x:843,y:181},
  "Elizabeth": {x:846,y:190},"Trenton": {x:838,y:198},"Philadelphia": {x:832,y:200},
  "Pittsburgh": {x:780,y:210},"Buffalo": {x:775,y:160},"Rochester": {x:790,y:155},
  "Syracuse": {x:800,y:160},"Albany": {x:825,y:165},"Yonkers": {x:850,y:183},
  "Boston": {x:875,y:165},"Worcester": {x:868,y:162},"Springfield": {x:855,y:168},
  "Cambridge": {x:874,y:164},"Lowell": {x:872,y:160},"Providence": {x:870,y:172},
  "Bridgeport": {x:858,y:178},"New Haven": {x:860,y:175},"Stamford": {x:855,y:180},
  "Hartford": {x:860,y:170},"Waterbury": {x:857,y:173},
  // Mid-Atlantic
  "Baltimore": {x:820,y:210},"Washington": {x:815,y:218},"Arlington": {x:813,y:217},
  "Alexandria": {x:814,y:220},"Richmond": {x:810,y:240},"Virginia Beach": {x:825,y:248},
  "Norfolk": {x:822,y:250},"Chesapeake": {x:823,y:252},"Newport News": {x:818,y:247},
  "Hampton": {x:820,y:248},"Wilmington": {x:833,y:203},
  // Southeast
  "Charlotte": {x:790,y:278},"Raleigh": {x:805,y:262},"Durham": {x:802,y:260},
  "Greensboro": {x:795,y:265},"Winston-Salem": {x:790,y:268},"Fayetteville": {x:800,y:272},
  "Charleston": {x:798,y:295},"Columbia": {x:795,y:285},"Greenville": {x:782,y:280},
  "Atlanta": {x:760,y:300},"Augusta": {x:780,y:295},"Savannah": {x:790,y:305},
  "Macon": {x:768,y:308},"Columbus": {x:752,y:310},
  "Jacksonville": {x:785,y:325},"Miami": {x:790,y:405},"Tampa": {x:765,y:370},
  "Orlando": {x:778,y:360},"St. Petersburg": {x:763,y:375},"Fort Lauderdale": {x:792,y:398},
  "Hialeah": {x:789,y:403},"Tallahassee": {x:740,y:325},"Cape Coral": {x:770,y:385},
  "Port St. Lucie": {x:785,y:380},"Pembroke Pines": {x:791,y:400},
  "Hollywood": {x:791,y:399},"Gainesville": {x:770,y:340},"Clearwater": {x:764,y:372},
  // Deep South
  "Nashville": {x:720,y:275},"Memphis": {x:680,y:290},"Knoxville": {x:745,y:270},
  "Chattanooga": {x:740,y:285},"Clarksville": {x:715,y:270},
  "Birmingham": {x:720,y:300},"Montgomery": {x:725,y:315},"Huntsville": {x:718,y:285},
  "Mobile": {x:710,y:335},"New Orleans": {x:695,y:345},"Baton Rouge": {x:685,y:340},
  "Shreveport": {x:660,y:315},"Lafayette": {x:680,y:340},
  "Jackson": {x:695,y:315},"Little Rock": {x:665,y:290},
  // Midwest
  "Chicago": {x:690,y:195},"Aurora": {x:688,y:198},"Naperville": {x:686,y:200},
  "Joliet": {x:688,y:202},"Rockford": {x:680,y:185},"Springfield": {x:675,y:225},
  "Peoria": {x:672,y:215},"Detroit": {x:740,y:190},"Grand Rapids": {x:720,y:178},
  "Warren": {x:742,y:188},"Sterling Heights": {x:743,y:187},"Ann Arbor": {x:735,y:192},
  "Lansing": {x:728,y:185},"Flint": {x:735,y:182},"Dearborn": {x:739,y:191},
  "Cleveland": {x:765,y:195},"Cincinnati": {x:745,y:225},"Columbus": {x:755,y:215},
  "Toledo": {x:745,y:195},"Akron": {x:762,y:200},"Dayton": {x:745,y:220},
  "Indianapolis": {x:720,y:225},"Fort Wayne": {x:725,y:205},"Evansville": {x:710,y:245},
  "South Bend": {x:715,y:195},
  "Milwaukee": {x:690,y:180},"Madison": {x:680,y:180},"Green Bay": {x:688,y:165},
  "Minneapolis": {x:650,y:155},"St. Paul": {x:653,y:156},"Rochester": {x:658,y:170},
  "Duluth": {x:645,y:130},"St. Louis": {x:680,y:245},"Kansas City": {x:635,y:240},
  "Springfield": {x:665,y:260},"Columbia": {x:660,y:245},
  "Des Moines": {x:640,y:200},"Cedar Rapids": {x:652,y:195},"Davenport": {x:660,y:200},
  "Omaha": {x:610,y:205},"Lincoln": {x:615,y:210},
  "Wichita": {x:610,y:255},"Overland Park": {x:637,y:242},"Topeka": {x:625,y:240},
  "Sioux Falls": {x:610,y:170},"Fargo": {x:610,y:135},
  // Mountain West
  "Denver": {x:470,y:245},"Colorado Springs": {x:465,y:260},"Aurora": {x:473,y:247},
  "Fort Collins": {x:465,y:230},"Lakewood": {x:468,y:248},"Pueblo": {x:462,y:270},
  "Boulder": {x:467,y:240},
  "Salt Lake City": {x:380,y:215},"West Valley City": {x:378,y:217},"Provo": {x:382,y:225},
  "West Jordan": {x:379,y:219},"Orem": {x:381,y:223},"Ogden": {x:380,y:208},
  "Boise": {x:330,y:170},"Meridian": {x:332,y:172},"Nampa": {x:328,y:174},
  "Billings": {x:435,y:135},"Missoula": {x:365,y:125},"Great Falls": {x:395,y:118},
  "Helena": {x:380,y:125},
  "Cheyenne": {x:470,y:218},"Casper": {x:445,y:195},
  "Albuquerque": {x:430,y:310},"Las Cruces": {x:415,y:340},"Rio Rancho": {x:428,y:308},
  "Santa Fe": {x:435,y:300},
  // Southwest
  "Phoenix": {x:340,y:340},"Tucson": {x:345,y:360},"Mesa": {x:343,y:342},
  "Chandler": {x:342,y:345},"Scottsdale": {x:341,y:338},"Gilbert": {x:344,y:344},
  "Glendale": {x:338,y:339},"Tempe": {x:341,y:341},"Peoria": {x:337,y:337},
  "Surprise": {x:335,y:336},
  "Las Vegas": {x:310,y:300},"Henderson": {x:315,y:305},"North Las Vegas": {x:310,y:297},
  "Reno": {x:275,y:215},"Sparks": {x:278,y:214},
  "El Paso": {x:405,y:345},
  // Texas
  "Houston": {x:620,y:355},"San Antonio": {x:575,y:355},"Dallas": {x:600,y:310},
  "Austin": {x:585,y:340},"Fort Worth": {x:595,y:308},"Arlington": {x:598,y:310},
  "Corpus Christi": {x:585,y:375},"Plano": {x:602,y:305},"Laredo": {x:560,y:375},
  "Lubbock": {x:535,y:300},"Irving": {x:599,y:309},"Garland": {x:603,y:308},
  "Frisco": {x:601,y:302},"McKinney": {x:603,y:300},"Amarillo": {x:530,y:278},
  "Grand Prairie": {x:597,y:312},"Brownsville": {x:570,y:390},"Killeen": {x:585,y:325},
  "Pasadena": {x:622,y:357},"Midland": {x:520,y:315},"McAllen": {x:565,y:385},
  "Beaumont": {x:640,y:345},"Abilene": {x:555,y:305},"Round Rock": {x:586,y:338},
  "Odessa": {x:515,y:318},"Waco": {x:590,y:320},"Richardson": {x:602,y:307},
  "Tyler": {x:625,y:310},"College Station": {x:600,y:335},
  // Pacific Northwest
  "Seattle": {x:225,y:80},"Tacoma": {x:222,y:90},"Spokane": {x:310,y:75},
  "Vancouver": {x:220,y:98},"Bellevue": {x:228,y:82},"Kent": {x:226,y:88},
  "Everett": {x:226,y:75},"Renton": {x:227,y:86},"Olympia": {x:218,y:95},
  "Portland": {x:225,y:110},"Salem": {x:220,y:120},"Eugene": {x:215,y:135},
  "Gresham": {x:228,y:112},"Hillsboro": {x:222,y:111},"Bend": {x:245,y:140},
  "Beaverton": {x:223,y:112},
  // California
  "Los Angeles": {x:210,y:340},"San Diego": {x:230,y:365},"San Jose": {x:195,y:290},
  "San Francisco": {x:185,y:270},"Fresno": {x:215,y:295},"Sacramento": {x:200,y:260},
  "Long Beach": {x:215,y:345},"Oakland": {x:188,y:272},"Bakersfield": {x:220,y:315},
  "Anaheim": {x:218,y:345},"Santa Ana": {x:220,y:347},"Riverside": {x:240,y:345},
  "Stockton": {x:202,y:268},"Irvine": {x:222,y:350},"Chula Vista": {x:232,y:368},
  "Fremont": {x:192,y:278},"San Bernardino": {x:238,y:342},"Modesto": {x:205,y:272},
  "Fontana": {x:236,y:340},"Moreno Valley": {x:242,y:348},"Glendale": {x:212,y:338},
  "Huntington Beach": {x:219,y:350},"Santa Clarita": {x:215,y:330},
  "Garden Grove": {x:220,y:348},"Oceanside": {x:228,y:360},
  "Rancho Cucamonga": {x:234,y:338},"Ontario": {x:235,y:340},
  "Santa Rosa": {x:185,y:258},"Elk Grove": {x:201,y:262},"Corona": {x:238,y:346},
  "Lancaster": {x:225,y:325},"Palmdale": {x:222,y:323},"Salinas": {x:190,y:290},
  "Pomona": {x:230,y:342},"Hayward": {x:190,y:275},"Escondido": {x:232,y:362},
  "Sunnyvale": {x:194,y:282},"Torrance": {x:214,y:348},"Pasadena": {x:215,y:340},
  "Roseville": {x:202,y:257},"Concord": {x:192,y:270},"Visalia": {x:218,y:300},
  "Thousand Oaks": {x:205,y:340},"Santa Clara": {x:194,y:284},
  "Victorville": {x:235,y:332},"Simi Valley": {x:208,y:335},"Vallejo": {x:190,y:265},
  "Berkeley": {x:188,y:271},"El Monte": {x:218,y:342},"Downey": {x:216,y:346},
  "Costa Mesa": {x:220,y:349},"Inglewood": {x:212,y:344},"Carlsbad": {x:228,y:362},
  // Hawaii (offset below mainland)
  "Honolulu": {x:330,y:510},
  // Alaska (offset to bottom-left)
  "Anchorage": {x:170,y:490},"Fairbanks": {x:190,y:470},"Juneau": {x:230,y:480},
};

/** Simplified continental US outline path (Albers-like projection, 960x600 viewBox) */
const US_OUTLINE_PATH = `M48.6,11.2L51.2,6.7L54.4,10.1L59.7,14.7L63.9,15.9L70.4,19.1L72.2,18.6L73.3,20.8L77.9,20.6L77.1,22.8L77.9,26.3L71.2,32.0L75.0,31.0L76.8,28.6L79.9,26.9L79.6,30.6L78.3,34.0L74.3,41.8L79.4,40.1L79.4,34.6L81.3,29.6L85.1,25.4L82.0,19.2L84.6,19.1L82.9,15.0L81.1,15.1L81.0,13.0L84.3,14.6L85.8,8.4L82.7,6.5L82.2,2.4L83.4,1.7L98.3,6.0L151.3,19.6L208.9,32.1L272.8,43.2L388.2,50.3L503.5,59.4L503.4,50.5L506.4,50.8L508.5,52.6L511.5,65.2L513.1,66.1L517.3,66.1L518.0,67.2L524.0,67.6L524.7,70.1L529.8,69.3L531.5,67.4L537.2,67.3L541.2,69.1L541.5,70.8L544.7,71.1L547.1,76.2L548.6,73.1L551.8,72.8L552.7,75.0L557.3,76.3L557.4,78.2L559.8,78.3L559.8,79.8L564.7,78.6L570.2,74.6L572.3,77.8L582.1,77.0L586.3,79.6L590.9,79.1L585.0,83.3L576.3,86.8L571.3,90.4L567.4,94.2L562.2,100.8L553.2,108.5L555.3,111.4L562.0,109.3L570.4,104.7L572.6,104.2L574.0,105.7L572.0,108.9L571.2,112.6L574.5,110.2L579.4,113.0L585.8,110.0L589.4,106.4L595.0,105.5L599.4,101.9L602.3,101.1L603.0,99.2L607.9,95.2L610.6,91.7L613.8,89.8L619.7,88.9L621.2,90.5L617.4,91.1L617.8,92.0L613.5,95.8L610.5,101.3L610.7,106.2L613.7,102.0L620.6,102.3L623.0,103.4L628.1,110.2L630.3,110.8L634.7,109.5L635.7,110.9L639.4,111.1L639.0,108.7L641.1,110.4L647.7,104.8L658.2,103.5L661.5,101.5L666.4,100.5L665.3,102.3L665.9,107.2L669.6,107.7L672.2,106.5L673.0,108.0L678.5,104.5L680.4,105.0L680.1,107.0L681.1,112.5L682.2,114.3L685.7,116.3L687.4,115.5L686.2,113.6L690.1,113.4L692.1,115.6L690.9,117.5L681.9,117.1L677.8,118.7L673.0,116.4L672.0,119.1L672.8,121.1L670.7,120.9L667.4,118.1L662.3,116.9L659.1,117.1L657.0,120.3L653.4,120.7L653.1,121.8L648.5,121.3L646.6,122.8L646.2,125.5L642.2,129.0L640.8,128.9L643.4,124.3L639.3,124.7L638.7,127.9L637.1,128.6L635.6,125.5L635.2,128.5L633.5,129.8L631.5,135.5L627.4,142.9L627.5,146.3L625.3,146.7L622.2,152.7L621.5,156.4L622.8,157.1L625.8,154.3L628.1,149.4L631.3,147.6L633.4,141.3L635.3,140.6L636.1,138.1L636.7,142.8L634.7,145.8L631.0,155.9L630.2,161.3L630.9,164.6L629.0,166.5L628.0,171.8L628.9,176.5L626.6,183.9L626.3,187.1L628.6,196.3L629.6,197.4L629.1,201.3L629.5,208.7L632.5,213.7L634.2,219.0L637.9,223.4L641.3,223.5L646.1,221.1L651.1,216.3L652.8,210.8L654.6,207.7L655.9,202.9L656.1,196.4L655.0,189.5L651.5,182.8L648.3,175.1L649.7,171.9L647.8,166.1L651.2,158.8L651.5,153.6L650.6,150.7L653.2,149.3L653.1,145.9L655.2,143.8L657.3,144.0L659.8,138.2L661.0,141.4L660.0,146.0L661.1,147.9L662.6,142.4L662.4,148.1L664.0,143.7L663.6,135.8L667.0,133.1L670.6,132.1L667.6,130.5L666.8,128.3L669.3,124.9L668.0,123.9L671.8,122.7L677.2,125.3L681.3,125.2L684.2,128.2L686.6,128.0L692.0,130.4L693.7,130.1L698.4,137.3L696.1,136.5L695.9,139.6L698.0,140.7L699.3,144.4L699.5,153.2L696.3,155.7L696.2,160.3L692.3,162.4L691.0,168.1L692.0,169.8L696.0,171.3L701.7,161.5L707.2,158.5L710.3,159.9L712.4,162.9L715.5,172.2L716.4,177.1L718.8,181.8L718.4,191.3L716.0,193.8L716.5,190.2L713.4,191.6L712.9,197.4L710.2,199.3L709.1,206.8L705.4,212.0L705.6,214.2L707.7,214.2L715.1,217.6L716.5,215.7L720.7,218.8L723.2,219.6L730.8,215.3L735.5,215.3L739.9,210.2L746.6,204.9L757.1,199.0L766.8,191.3L772.1,185.6L775.2,183.5L776.3,180.1L779.2,177.3L777.2,173.6L775.7,173.1L773.6,167.0L782.7,162.6L789.0,161.4L795.7,161.4L799.1,162.8L801.3,161.4L808.5,160.1L812.4,157.5L816.1,152.5L819.1,151.7L817.9,145.4L818.7,142.1L814.4,140.7L814.6,136.7L820.3,131.5L821.9,127.6L827.7,118.7L832.3,114.2L834.5,112.9L845.5,111.0L862.2,106.4L874.7,103.6L887.4,100.0L888.0,94.3L889.1,92.6L891.9,93.2L894.8,90.9L896.3,92.5L896.2,87.6L898.8,88.1L896.7,85.5L898.4,81.3L900.6,79.1L899.7,77.9L901.6,75.1L899.8,71.4L899.7,65.0L901.5,62.5L900.7,56.0L907.6,35.7L910.6,35.6L911.6,39.4L914.3,40.5L918.5,36.6L921.5,35.7L923.3,33.6L932.0,37.9L939.3,61.3L941.2,68.7L944.7,69.3L947.2,68.6L947.1,71.4L949.2,73.5L948.8,76.0L952.2,78.7L954.8,77.0L960,83.9L957.8,88.6L955.5,87.8L952.9,95.0L949.4,93.6L948.9,96.9L946.5,99.8L944.0,99.2L944.0,102.1L941.4,103.2L937.9,101.0L939.5,103.6L938.7,106.4L939.8,109.5L934.2,103.9L933.3,99.6L932.0,103.5L931.2,109.8L932.8,111.7L930.5,114.6L925.6,116.8L924.4,119.7L921.7,122.2L920.0,120.9L916.8,124.3L917.1,126.9L914.8,128.2L914.8,132.5L912.8,134.0L913.1,136.3L911.2,144.4L913.0,149.1L916.2,149.1L915.7,151.1L912.4,152.8L913.3,153.6L911.3,156.5L911.8,159.4L913.7,158.3L916.0,159.2L919.0,162.1L918.6,164.7L921.4,165.3L922.3,167.8L927.6,168.8L931.3,165.5L928.4,160.9L931.2,163.0L933.2,167.8L926.6,171.0L924.8,173.6L922.1,174.5L921.6,170.5L919.9,170.4L919.2,173.2L917.4,173.9L917.4,176.5L913.7,178.8L911.0,178.6L911.6,175.1L908.5,172.3L909.4,174.8L908.7,177.2L909.4,182.1L903.5,185.2L901.8,184.9L894.9,188.5L886.4,191.0L885.9,189.9L883.0,194.2L879.2,196.2L879.2,197.3L875.2,199.6L874.7,202.9L878.2,200.2L882.7,200.1L883.9,198.4L892.3,195.9L896.1,191.1L898.2,192.9L901.2,193.4L904.7,191.0L897.0,197.5L884.6,206.3L878.9,208.8L875.2,209.5L872.6,211.2L870.4,210.3L867.3,213.8L873.1,215.3L874.2,229.7L871.8,238.2L867.7,244.2L866.2,250.0L863.3,251.9L863.7,246.6L858.2,245.8L850.9,242.2L853.3,245.2L855.2,250.7L860.2,255.8L861.8,255.6L864.6,264.3L863.9,271.2L862.0,277.8L860.3,278.4L859.0,281.8L858.8,288.7L857.0,295.7L855.1,297.4L853.1,294.5L853.2,286.3L856.1,278.8L856.1,277.0L852.2,278.9L851.6,272.0L848.3,270.3L845.8,272.5L841.6,267.4L842.7,263.9L846.7,264.5L840.3,260.9L842.6,259.3L841.3,256.7L839.2,259.3L839.6,255.0L841.5,254.9L839.5,252.2L840.3,247.9L842.4,245.8L842.9,241.6L840.8,242.5L841.1,244.9L836.4,251.6L838.1,255.7L836.6,259.5L838.2,267.0L841.4,270.6L840.8,272.3L843.6,275.4L844.1,277.8L841.4,275.4L841.0,276.8L838.5,274.7L834.7,274.9L831.1,273.0L829.8,270.9L826.9,273.6L824.4,270.9L826.0,274.4L830.3,272.5L831.9,276.0L838.3,276.3L840.7,278.7L846.3,280.8L845.4,282.9L845.4,287.7L848.6,292.4L848.4,294.3L845.5,292.7L846.7,296.6L849.6,299.4L847.3,302.6L843.2,299.9L842.1,297.7L840.3,298.8L842.9,301.9L846.7,304.5L849.7,304.2L849.1,302.5L855.3,302.1L863.7,318.7L869.3,326.2L864.7,322.1L860.4,313.1L856.5,311.7L859.3,314.5L863.0,320.8L859.9,317.3L858.5,319.0L854.9,317.1L857.9,319.9L851.3,324.4L847.2,324.8L847.8,327.3L856.5,324.1L859.7,324.2L859.3,326.8L861.1,330.8L860.7,325.5L863.4,323.4L865.6,326.2L865.9,332.0L863.8,332.6L860.4,339.2L853.9,339.5L851.4,336.7L852.1,339.5L843.3,338.2L854.7,342.0L853.7,346.1L850.0,350.0L850.9,350.9L856.3,346.5L859.7,348.7L857.7,350.9L856.4,355.5L863.0,344.6L863.6,344.9L859.6,350.7L856.7,357.6L853.6,355.8L847.2,357.9L844.2,359.8L838.5,365.4L834.6,372.2L833.5,379.8L829.1,379.2L825.3,380.2L819.5,383.7L816.0,388.2L813.9,392.3L813.4,398.9L810.6,404.2L807.4,404.0L806.9,407.2L802.3,411.6L800.0,415.5L797.7,416.2L794.1,419.5L791.2,420.4L792.3,423.4L789.0,425.6L784.7,431.1L783.7,435.9L781.5,439.4L781.3,444.3L780.1,447.1L780.2,451.8L778.4,453.8L779.1,459.0L778.5,462.3L781.5,472.8L785.8,483.7L788.7,489.3L794.7,498.8L804.1,509.6L805.5,512.3L804.5,516.5L806.0,520.8L811.1,528.3L815.1,536.0L819.8,543.7L821.9,548.5L822.6,553.1L823.6,573.8L821.7,573.6L820.5,578.2L820.7,584.0L823.6,580.5L821.4,586.9L818.9,589.8L819.5,586.4L806.3,590.2L804.1,588.1L804.4,584.4L800.0,578.0L797.7,576.2L792.3,574.3L791.0,575.5L787.9,570.5L785.5,564.1L782.0,561.1L780.2,562.4L779.0,559.0L780.2,555.0L779.3,551.5L777.3,552.8L778.4,555.6L776.3,556.5L764.6,541.1L767.0,538.1L769.8,532.4L763.2,528.9L762.7,530.8L765.9,533.4L763.7,536.5L760.4,533.1L759.1,525.0L760.5,525.5L762.1,519.4L761.5,513.5L759.7,510.1L760.3,508.8L757.3,503.5L753.3,503.4L749.5,501.3L747.6,498.2L744.1,496.7L743.4,493.2L740.7,492.3L738.3,488.8L729.9,484.8L725.1,485.5L723.4,487.8L724.2,490.3L720.3,490.5L713.9,495.4L709.1,496.4L710.9,499.2L707.2,497.5L704.6,498.2L705.3,494.6L703.8,492.7L691.8,486.1L684.0,484.0L677.3,483.9L664.3,486.8L654.4,489.9L651.9,485.9L650.8,480.2L649.4,479.7L647.8,484.1L647.5,488.3L642.7,487.2L640.8,488.9L632.3,487.8L628.5,488.7L622.1,491.8L621.6,493.5L618.3,494.4L614.4,497.3L614.1,499.5L616.3,499.1L617.9,501.2L621.0,496.0L623.6,499.7L622.7,505.7L618.0,506.3L617.8,508.2L621.6,512.1L627.9,512.5L630.5,516.5L629.7,520.7L626.5,516.5L624.4,518.0L619.1,514.5L615.0,514.1L607.6,520.0L604.9,515.4L603.1,514.2L600.1,515.1L598.1,519.6L595.8,521.6L592.5,518.6L589.8,518.6L584.8,516.3L586.2,514.8L589.3,517.1L586.3,512.9L584.7,514.1L584.2,511.3L582.1,512.4L578.6,506.4L573.9,507.3L573.1,504.3L568.7,506.7L566.9,506.5L568.9,509.7L564.7,511.7L558.7,510.7L547.3,506.8L535.9,507.9L534.0,509.3L528.0,510.1L515.0,516.6L519.7,512.0L515.8,513.1L516.7,507.7L510.5,510.1L510.3,512.4L512.4,513.9L512.9,518.2L508.7,521.4L507.8,523.3L514.2,517.4L516.1,517.6L510.2,522.0L503.0,528.6L485.9,537.3L481.4,541.3L477.5,543.5L469.8,550.7L463.6,561.7L461.9,568.0L462.3,576.3L465.3,587.6L461.4,576.1L461.3,568.9L462.2,563.4L464.9,556.9L471.5,546.4L478.0,542.1L481.4,540.7L481.2,539L477.7,541.2L474.2,539.7L474.0,543.4L471.2,545.7L469.1,544.2L465.5,546.7L468.8,546.1L469.4,547.6L466.0,552.4L460.5,551.3L462.2,554.4L464.6,555.5L461.2,564.1L459.6,563.2L456.4,565.2L460.9,565.4L459.9,575.9L460.9,583.5L463.6,588.4L463.7,592.6L466.2,593.2L466.3,595.7L462.0,596.3L461.5,598.2L457.1,595.9L455.7,594.0L452.6,593.0L444.2,593.0L438.7,589.0L434.7,588.6L431.2,585.4L425.2,583.7L422.3,574.2L418.7,569.9L419.1,564.7L417.1,563.2L418.4,559.1L416.0,555.5L413.9,555.1L410.5,551.7L409.6,547.4L406.7,543.5L402.5,540.1L400.7,533.0L398.7,531.2L395.6,520.9L393.3,517.3L389.1,514.3L388.3,512.1L384.4,510.5L384.6,508.1L380.3,504.2L375.6,504.4L370.3,502.9L368.8,503.4L363.9,500.9L362,503.4L356.7,503.8L353.0,508.5L350.9,515.6L348.8,516.0L346.0,520.4L342.6,520.3L337.9,516.3L334.0,514.7L331.9,512.5L325.9,509.6L323.8,506.3L319.1,503.0L316.3,496.1L316.3,488.8L313.9,484.3L313.3,480.7L311.4,477.8L304.0,473.2L300.5,467.5L297.3,465.2L294.3,460.3L289.6,457.4L286.8,450.9L284.0,449.3L251.3,445.4L250.0,455.8L193.9,447.7L170.5,434.2L126.6,408.1L127.3,405.3L129.4,403.3L100.5,399.9L82.8,397.8L81.2,394.2L82.2,389.5L82.0,383.5L79.8,377.9L75.7,372.0L69.5,365.2L67.7,366.2L65.0,364.7L66.0,362.5L64.2,357.4L59.2,357.0L52.3,351.9L51.9,348.8L47.6,344.2L41.7,342.8L37.2,340.1L30.9,339.1L28.6,335.2L30.9,329.1L30.1,327.8L32.0,323.0L28.0,318.9L29.4,316.6L25.5,308.9L24.1,307.9L19.1,293.5L16.8,290.6L16.9,285.9L17.9,282.4L18.9,283.5L21.7,279.4L20.0,274.7L17.0,274.4L13.2,267.5L14.4,263.8L13.4,259.6L15.1,253.8L17.1,253.6L16.5,258.8L20.4,263.2L20.4,257.8L18.3,254.6L19.2,253.3L17.7,250.1L21.1,249.1L19.5,246.2L17.6,246.4L17.6,249.4L15.0,252.8L11.1,247.4L7.9,246.2L10.2,240.9L8.8,235.6L6.1,232.0L4.8,227.9L1.6,221.2L3.1,219.1L2.9,211.6L5.2,207.4L5.7,200.9L3.5,195.5L0,188.7L0.4,184.5L7.1,176.6L9.4,172.8L9.4,170.0L13.0,163.8L13.4,156.6L12.2,155.2L14.4,150.4L12.9,147.8L13.8,139.6L15.4,137.0L14.6,130.1L17.3,127.0L20.3,121.3L25.9,113.4L28.5,108.2L35.0,92.0L35.4,89.4L39.5,81.6L43.6,70.3L44.7,63.7L46.4,61.2L46.5,57.2L47.5,59.2L50.5,59.6L53.6,58.7L51.2,57.1L48.4,57.7L46.7,55.4L45.5,56.2L48.5,49.5L47.2,54.0L50.2,51.1L49.8,48.5L52.3,47.3L48.5,45.5L48.9,41.8L53.4,42.1L49.5,39.1L50.0,32.9L49.2,31.0L50.1,25.4L49.8,20.0L48.2,17.8Z`;

/* ── Render: Traffic Map ── */
function renderTrafficMap(gaData) {
  const el = els.trafficMap;
  if (!el) return;

  // Extract by_city from latest snapshot
  let byCity = [];
  if (gaData?.latest?.summary?.by_city) {
    byCity = gaData.latest.summary.by_city;
  } else if (gaData?.snapshots?.length > 0) {
    const latest = gaData.snapshots[gaData.snapshots.length - 1];
    byCity = latest?.summary?.by_city || [];
  }

  // Aggregate users by city (in case of duplicates across snapshots)
  // Use latest snapshot only — already done above

  // Separate US vs international
  const usDots = [];
  const intlCounts = {};
  let intlTotal = 0;

  for (const entry of byCity) {
    const city = entry.city || "";
    const country = entry.country || "";
    const users = entry.users || 0;
    if (!city || users <= 0) continue;

    if (country === "United States" || country === "US" || country === "USA") {
      const coords = US_CITIES[city];
      if (coords) {
        usDots.push({ city, users, x: coords.x, y: coords.y });
      }
      // Skip cities not in lookup — they're small/uncommon
    } else {
      intlTotal += users;
      const label = country || "Unknown";
      intlCounts[label] = (intlCounts[label] || 0) + users;
    }
  }

  // Build SVG
  const dots = usDots.map(d => {
    const r = Math.max(4, Math.min(20, d.users * 3));
    // Stagger animation delay for visual interest
    const delay = (Math.abs(d.x * 7 + d.y * 13) % 2000) / 1000;
    return `<circle class="monitor-map-dot" cx="${d.x}" cy="${d.y}" r="${r}" style="animation-delay:${delay.toFixed(1)}s">
      <title>${escHtml(d.city)}: ${d.users} user${d.users !== 1 ? "s" : ""}</title>
    </circle>`;
  }).join("\n");

  const svg = `<svg class="monitor-map-svg" viewBox="0 0 960 600" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    <path d="${US_OUTLINE_PATH}" fill="rgba(255,255,255,0.03)" stroke="var(--muted)" stroke-width="1.5" stroke-linejoin="round" stroke-opacity="0.35"/>
    ${dots}
  </svg>`;

  // International text
  let intlHtml = "";
  if (intlTotal > 0) {
    const parts = Object.entries(intlCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([country, count]) => `${escHtml(country)}: ${count}`)
      .join(", ");
    intlHtml = `<div class="monitor-map-international">${intlTotal} international user${intlTotal !== 1 ? "s" : ""} (${parts})</div>`;
  }

  // Empty state
  let emptyHtml = "";
  if (byCity.length === 0) {
    emptyHtml = `<div class="monitor-map-empty">No geographic data available — waiting for GA realtime snapshots</div>`;
  } else if (usDots.length === 0 && intlTotal === 0) {
    emptyHtml = `<div class="monitor-map-empty">No mappable traffic in current snapshot</div>`;
  }

  el.innerHTML = svg + intlHtml + emptyHtml;
}

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

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const results = await Promise.allSettled([
    fetchJson("/api/system-health"),
    fetchJson("/api/pipeline-status"),
    fetchJson("/api/instance-activity"),
    fetchJson(`/api/metrics/ops-feed?tz=${encodeURIComponent(tz)}&days=1`),
    fetchJson("/api/ga-realtime-timeline?hours=1"),
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

  // Ops feed — totals + live activity
  const feedData = results[3].status === "fulfilled" ? results[3].value : null;
  renderTotals(feedData?.summary || null);
  renderActivityFeed(feedData);

  // Cache feed events for merchant modal cross-reference
  if (feedData?.events) {
    _lastFeedEvents = feedData.events;
  }

  // Traffic Map
  if (results[4].status === "fulfilled") {
    renderTrafficMap(results[4].value);
  } else {
    renderTrafficMap(null);
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
