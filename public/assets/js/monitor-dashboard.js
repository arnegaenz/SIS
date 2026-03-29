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
      <div class="mon-totals-card__value">${c.value.toLocaleString()}</div>
      <div class="mon-totals-card__label">${c.label}</div>
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
const US_OUTLINE_PATH = `M 170,120 L 225,65 235,68 248,62 260,65 280,58 300,62 310,68 325,60
  340,65 360,60 380,72 395,65 410,55 425,58 440,50 460,55 475,52 490,58 510,52
  520,55 535,50 550,55 565,52 580,58 600,55 615,60 630,58 645,62 660,58 670,65
  682,60 695,65 710,60 725,65 740,58 755,62 770,55 785,60 800,65 810,55 820,60
  835,65 845,58 855,62 860,72 870,80 880,75 890,85 895,95 892,105 888,115
  885,130 890,140 895,155 892,165 888,175 882,185 875,170 870,168 865,178
  858,182 852,190 845,195 840,200 835,205 830,210 825,215 820,222 825,230
  830,240 828,248 825,255 820,260 815,270 810,275 805,268 800,270 798,280
  795,290 798,300 792,308 790,318 786,328 785,335 780,345 775,358 770,365
  768,375 766,385 770,395 778,400 790,410 785,418 775,412 765,400 758,390
  752,378 748,370 740,358 730,345 720,340 710,338 700,345 695,350 685,345
  675,340 665,338 655,342 645,348 635,352 625,358 618,365 612,370 608,378
  600,382 592,380 585,378 578,382 570,388 565,395 555,392 545,385 540,375
  535,365 530,355 525,345 520,330 518,318 515,310 510,300 505,290 498,280
  490,272 480,265 472,258 465,250 458,245 450,240 440,238 430,240 420,245
  415,252 410,260 405,275 400,290 395,300 388,310 380,318 370,325 360,330
  350,340 342,348 338,358 335,368 330,375 320,370 310,360 300,348 290,340
  280,335 268,330 260,340 250,350 240,355 230,360 222,368 220,375 215,380
  210,370 205,360 200,345 195,330 188,315 185,300 180,285 175,270 170,255
  168,240 165,225 163,210 160,195 158,180 160,165 163,150 168,135 170,120 Z`;

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
