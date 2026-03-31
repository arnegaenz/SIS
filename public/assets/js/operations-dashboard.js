import {
  formatNumber,
  formatPercent,
  formatRate,
  buildDateRange,
  formatLocalDate,
  getLocalTimezone,
  createTimezoneSelect,
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
  partnerList: [],
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
    statuses: new Set(["success", "failed", "cancelled"]),
    merchants: new Set(),
    fis: new Set(),
    excludeDevInstance: true,
  },
  // Command center state
  feedEvents: [],
  gaTimeline: null,
  healthData: null,
};

/* ── Command Center — View Rotation Engine ── */

const VIEW_NAMES = {
  "1day": "1-DAY PULSE",
  "3day": "3-DAY MOMENTUM",
  "7day": "7-DAY RHYTHM",
};

const viewRotation = {
  views: ["1day", "3day", "7day"],
  currentIndex: 0,
  mode: "auto",
  cycleMs: 15000,
  resumeMs: 60000,
  cycleTimer: null,
  resumeTimer: null,
  progressRaf: null,
  cycleStartTime: 0,
};

function startViewCycle() {
  viewRotation.mode = "auto";
  viewRotation.cycleStartTime = performance.now();
  clearTimeout(viewRotation.cycleTimer);
  cancelAnimationFrame(viewRotation.progressRaf);

  const fillEl = document.getElementById("phCycleProgressFill");
  const pushEl = document.getElementById("phCycleProgressPush");
  const isFillPhase = viewRotation.phase !== "push";
  viewRotation.phase = isFillPhase ? "fill" : "push";

  // Reset both bars instantly
  if (fillEl) { fillEl.style.transition = "none"; fillEl.style.width = isFillPhase ? "0%" : "100%"; }
  if (pushEl) { pushEl.style.transition = "none"; pushEl.style.width = isFillPhase ? "0%" : "0%"; }

  function animateProgress() {
    const elapsed = performance.now() - viewRotation.cycleStartTime;
    const pct = Math.min(100, (elapsed / viewRotation.cycleMs) * 100);
    if (isFillPhase) {
      // Blue fills left to right
      if (fillEl) fillEl.style.width = pct + "%";
    } else {
      // Background pushes left to right over the blue
      if (pushEl) pushEl.style.width = pct + "%";
    }
    if (pct < 100) {
      viewRotation.progressRaf = requestAnimationFrame(animateProgress);
    }
  }
  viewRotation.progressRaf = requestAnimationFrame(animateProgress);

  viewRotation.cycleTimer = setTimeout(async () => {
    // Alternate phase
    viewRotation.phase = isFillPhase ? "push" : "fill";
    if (!isFillPhase) {
      if (fillEl) { fillEl.style.transition = "none"; fillEl.style.width = "0%"; }
      if (pushEl) { pushEl.style.transition = "none"; pushEl.style.width = "0%"; }
    }

    // Determine next view
    if (viewRotation.views.length > 1) {
      const nextIndex = (viewRotation.currentIndex + 1) % viewRotation.views.length;
      viewRotation.currentIndex = nextIndex;
      const viewKey = viewRotation.views[nextIndex];
      const labelEl = document.getElementById("phViewLabel");
      if (labelEl) labelEl.textContent = VIEW_NAMES[viewKey] || viewKey;
    }

    // Fetch ALL data for the new view, then render everything at once
    await commandCenterRefresh();
    startViewCycle();
  }, viewRotation.cycleMs);
}

function pauseViewCycle() {
  viewRotation.mode = "manual";
  clearTimeout(viewRotation.cycleTimer);
  cancelAnimationFrame(viewRotation.progressRaf);
  clearTimeout(viewRotation.resumeTimer);

  const fillEl = document.getElementById("phCycleProgressFill");
  const pushEl = document.getElementById("phCycleProgressPush");
  if (fillEl) fillEl.style.width = "0%";
  if (pushEl) { pushEl.style.transition = "none"; pushEl.style.width = "0%"; }

  updatePlayPauseButton();
}

const VIEW_WINDOW_DAYS = { "1day": 1, "3day": 3, "7day": 7 };

function transitionToView(index) {
  if (index === viewRotation.currentIndex) return;
  viewRotation.currentIndex = index;
  const viewKey = viewRotation.views[index];

  // Update view label
  const labelEl = document.getElementById("phViewLabel");
  if (labelEl) labelEl.textContent = VIEW_NAMES[viewKey] || viewKey;

  // Update tile titles
  const volTitle = document.getElementById("kioskVolTitle");
  const days = VIEW_WINDOW_DAYS[viewKey] || 7;
  if (volTitle) volTitle.textContent = `Placement Volume (${days === 1 ? "24 hours" : days + " days"})`;

  const healthTitle = document.getElementById("kioskHealthTitle");
  if (healthTitle) healthTitle.textContent = `Partner Traffic Health`;

  // Crossfade the content area
  const bottom = document.querySelector(".kiosk-1d__bottom");
  if (bottom) {
    bottom.style.opacity = "0";
    bottom.style.transform = "translateX(-20px)";
    setTimeout(() => {
      renderViewTiles(viewKey);
      bottom.style.transition = "opacity 500ms ease, transform 500ms ease";
      bottom.style.opacity = "1";
      bottom.style.transform = "translateX(0)";
    }, 50);
    setTimeout(() => { bottom.style.transition = ""; }, 600);
  } else {
    renderViewTiles(viewKey);
  }
}

function handleArrowKey(direction) {
  const len = viewRotation.views.length;
  if (len <= 1) return;
  pauseViewCycle();
  const nextIndex = (viewRotation.currentIndex + direction + len) % len;
  viewRotation.currentIndex = nextIndex;
  const viewKey = viewRotation.views[nextIndex];
  const labelEl = document.getElementById("phViewLabel");
  if (labelEl) labelEl.textContent = VIEW_NAMES[viewKey] || viewKey;
  commandCenterRefresh();
}

function togglePlayPause(e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  if (viewRotation.mode === "auto") {
    pauseViewCycle();
    clearTimeout(viewRotation.resumeTimer); // don't auto-resume after explicit pause
  } else {
    clearTimeout(viewRotation.resumeTimer);
    startViewCycle();
  }
  updatePlayPauseButton();
}

function updatePlayPauseButton() {
  const btn = document.getElementById("phPlayPause");
  if (!btn) return;
  if (viewRotation.mode === "auto") {
    btn.innerHTML = '<svg width="20" height="22" viewBox="0 0 20 22"><rect x="2" y="1" width="5" height="20" rx="1" fill="currentColor"/><rect x="13" y="1" width="5" height="20" rx="1" fill="currentColor"/></svg>';
    btn.classList.remove("paused");
    btn.title = "Pause rotation (spacebar)";
  } else {
    btn.innerHTML = '<svg width="20" height="22" viewBox="0 0 20 22"><polygon points="3,1 3,21 19,11" fill="currentColor"/></svg>';
    btn.classList.add("paused");
    btn.title = "Resume rotation (spacebar)";
  }
}

/* ── Command Center — Persistent Header ── */

function animateValue(el, target, duration) {
  duration = duration || 300;
  const text = el.textContent || "";
  const isPercent = text.includes("%") || el.closest("[id*='Rate']") || el.closest("[id*='System']");
  let start = parseFloat(text.replace(/[^0-9.-]/g, "")) || 0;
  // Always animate at least 15% swing so it feels alive
  if (Math.abs(target - start) < target * 0.15 && target > 0) {
    start = target * 0.85;
  }
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const val = start + (target - start) * eased;
    if (isPercent) {
      el.textContent = val.toFixed(1) + "%";
    } else {
      el.textContent = formatNumber(Math.round(val));
    }
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Termination types caused by cardholder (not system) — used for linked/system-rate calc
const UX_TERMINATIONS = new Set([
  "USER_DATA_FAILURE", "NEVER_STARTED", "TIMEOUT_CREDENTIALS", "TIMEOUT_TFA",
  "ABANDONED_QUICKSTART", "CANCELED", "CANCELLED", "ACCOUNT_SETUP_INCOMPLETE",
  "TOO_MANY_LOGIN_FAILURES", "ACCOUNT_LOCKED", "PASSWORD_RESET_REQUIRED", "INVALID_CARD_DETAILS",
]);

// Recompute summary from events, respecting the includeTests filter
function computeFilteredSummary() {
  const allEvts = state.allFeedEvents || [];
  const uniqueSessionIds = new Set();
  let totalJobs = 0, totalSuccess = 0, totalFailed = 0, totalCancelled = 0, totalAbandoned = 0, totalBrowseOnly = 0, totalLinked = 0;
  for (const evt of allEvts) {
    if (!state.includeTests && evt.instance === "customer-dev") continue;
    if (evt.session_id) uniqueSessionIds.add(evt.session_id);
    if (evt.status === "success") {
      totalJobs++; totalSuccess++; totalLinked++;
    } else if (evt.status === "failed") {
      totalJobs++; totalFailed++;
      const term = (evt.termination_type || "").trim().toUpperCase();
      if (!UX_TERMINATIONS.has(term)) totalLinked++;
    } else if (evt.status === "cancelled") {
      totalJobs++; totalCancelled++;
    } else if (evt.status === "abandoned") {
      totalJobs++; totalAbandoned++;
    } else if (evt.status === "session") {
      totalBrowseOnly++;
    }
  }
  return {
    unique_sessions: uniqueSessionIds.size,
    total_jobs: totalJobs,
    jobs_linked: totalLinked,
    jobs_success: totalSuccess,
    jobs_failed: totalFailed,
    jobs_cancelled: totalCancelled,
    jobs_abandoned: totalAbandoned,
    browse_only_sessions: totalBrowseOnly,
    total_events: allEvts.length,
  };
}

function renderPersistentHeader(opsData, healthData, gaTimeline) {
  // KPIs recomputed from filtered events (respects includeTests toggle)
  const summary = computeFilteredSummary();
  const currentDays = VIEW_WINDOW_DAYS[viewRotation.views[viewRotation.currentIndex]] || 1;

  // Window label
  const windowLabelEl = document.getElementById("phWindowLabel");
  const windowLabels = { 1: "24 HOURS", 3: "3 DAYS", 7: "7 DAYS" };
  if (windowLabelEl) windowLabelEl.textContent = windowLabels[currentDays] || `${currentDays} DAYS`;
  const todaySessions = summary.unique_sessions;
  const todayJobs = summary.total_jobs;
  const todaySuccess = summary.jobs_success;
  const todayFailed = summary.jobs_failed;
  const todayTotal = summary.total_jobs;

  const sessionsEl = document.querySelector("#phSessions .kiosk-ph__kpi-value");
  const placementsEl = document.querySelector("#phPlacements .kiosk-ph__kpi-value");
  const successEl = document.querySelector("#phSuccessRate .kiosk-ph__kpi-value");

  if (sessionsEl) animateValue(sessionsEl, todaySessions, 300);
  if (placementsEl) animateValue(placementsEl, todayJobs, 300);

  const todayLinked = summary.jobs_linked;
  const linkedEl = document.querySelector("#phLinked .kiosk-ph__kpi-value");
  if (linkedEl) animateValue(linkedEl, todayLinked, 300);

  const successRate = todayTotal > 0 ? todaySuccess / todayTotal * 100 : 0;
  if (successEl) {
    animateValue(successEl, successRate, 300);
    successEl.style.color = todayTotal > 0 ? (successRate >= 70 ? "#48bb78" : successRate >= 50 ? "#ecc94b" : "#fc8181") : "var(--muted)";
  }

  const successfulEl = document.querySelector("#phSuccessful .kiosk-ph__kpi-value");
  if (successfulEl) {
    animateValue(successfulEl, todaySuccess, 300);
    successfulEl.style.color = "#48bb78";
  }

  // System success rate from feed summary (24h, matches other KPIs)
  const systemEl = document.querySelector("#phSystemRate .kiosk-ph__kpi-value");
  if (todayLinked > 0) {
    const sysRate = todaySuccess / todayLinked * 100;
    if (systemEl) {
      animateValue(systemEl, sysRate, 300);
      systemEl.style.color = sysRate >= 70 ? "#48bb78" : sysRate >= 50 ? "#ecc94b" : "#fc8181";
    }
  }

  // Health dot
  if (healthData) {
    const dot = document.querySelector(".kiosk-ph__health-dot");
    const label = document.querySelector(".kiosk-ph__health-label");
    if (dot) {
      dot.className = "kiosk-ph__health-dot status-" + healthData.overall;
    }
    if (label) {
      const labels = { green: "Healthy", yellow: "Warning", red: "Critical" };
      label.textContent = labels[healthData.overall] || "Unknown";
    }
    renderHealthSignals(healthData.signals || []);
  }

  // Clock
  updateCommandCenterClock();
}

function renderHealthSignals(signals) {
  const container = document.getElementById("phHealthSignals");
  if (!container) return;
  container.innerHTML = signals.map(s => `
    <div class="kiosk-health-panel__signal">
      <span class="kiosk-health-panel__signal-dot status-${s.status}" style="background:${
        s.status === "green" ? "#48bb78" : s.status === "yellow" ? "#ecc94b" : "#fc8181"
      }"></span>
      <span class="kiosk-health-panel__signal-name">${s.name}</span>
      <span class="kiosk-health-panel__signal-detail">${s.detail}</span>
    </div>
  `).join("");
}

function updateCommandCenterClock() {
  const clockEl = document.getElementById("phClock");
  if (!clockEl) return;
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/* ── Command Center — 1-Day Timeline ── */

function render1DayTimeline(feedEvents, gaTimeline, gaHourly, timelineDays) {
  const container = document.getElementById("timeline1Day");
  const legendEl = document.getElementById("timeline1DayLegend");
  if (!container) return;

  const days = timelineDays || 1;
  const totalHours = days * 24;
  const now = new Date();
  const cutoff = new Date(now.getTime() - totalHours * 60 * 60 * 1000);

  // Set gap based on number of hours
  const gap = days === 1 ? 2 : days === 3 ? 1 : 0;
  container.style.gap = gap + "px";

  // Update title
  const titleEl = container.closest(".kiosk-1d__timeline-wrap")?.querySelector(".kiosk-section-title");
  if (titleEl) titleEl.textContent = days === 1 ? "Activity Timeline \u2014 Today" : `Activity Timeline \u2014 ${days} Days`;

  // Build hourly slots as a rolling window
  const slots = [];
  for (let i = 0; i < totalHours; i++) {
    const slotTime = new Date(cutoff.getTime() + i * 60 * 60 * 1000);
    slots.push({
      start: slotTime,
      label: slotTime.toLocaleTimeString("en-US", { hour: "numeric", hour12: true }).replace(" ", "").toLowerCase(),
      // Top: CardSavr sessions/jobs (hangs down from top)
      cardsavr: { success: 0, failed: 0, cancelled: 0, abandoned: 0, session: 0, total: 0 },
      // Bottom: GA data (standard + realtime, grows up from bottom)
      ga: { active_users: 0, views: 0, mobile: 0, desktop: 0, tablet: 0, source: "",
            select_merchants: 0, user_data: 0, credential_entry: 0 },
    });
  }

  // Bucket CardSavr feed events
  for (const evt of (feedEvents || [])) {
    if (!evt.timestamp) continue;
    const evtTime = new Date(evt.timestamp);
    if (evtTime < cutoff || evtTime > now) continue;
    const slotIdx = Math.min(totalHours - 1, Math.floor((evtTime - cutoff) / (60 * 60 * 1000)));
    if (slots[slotIdx].cardsavr[evt.status] !== undefined) {
      slots[slotIdx].cardsavr[evt.status]++;
      slots[slotIdx].cardsavr.total++;
    }
  }

  // First: fill GA slots from standard hourly data (priority source)
  if (gaHourly && gaHourly.hourly) {
    for (const row of gaHourly.hourly) {
      // Standard GA hours are in UTC — convert to local for slot matching
      const utcDate = new Date(row.utc_timestamp || (row.date + "T" + String(row.hour).padStart(2, "0") + ":30:00"));
      if (utcDate < cutoff || utcDate > now) continue;
      const slotIdx = Math.min(totalHours - 1, Math.floor((utcDate - cutoff) / (60 * 60 * 1000)));
      const users = row.users || row.active_users || 0;
      slots[slotIdx].ga.views += row.views || 0;
      slots[slotIdx].ga.active_users += users;
      const dev = (row.device || "").toLowerCase();
      if (dev === "mobile") slots[slotIdx].ga.mobile += users;
      else if (dev === "desktop") slots[slotIdx].ga.desktop += users;
      else if (dev === "tablet") slots[slotIdx].ga.tablet += users;
      if (!slots[slotIdx].ga.source) slots[slotIdx].ga.source = "standard";
    }
  }

  // Bucket funnel page breakdown from standard GA
  if (gaHourly && gaHourly.funnel) {
    for (const row of gaHourly.funnel) {
      const utcDate = new Date(row.utc_timestamp || (row.date + "T" + String(row.hour).padStart(2, "0") + ":30:00"));
      if (utcDate < cutoff || utcDate > now) continue;
      const slotIdx = Math.min(totalHours - 1, Math.floor((utcDate - cutoff) / (60 * 60 * 1000)));
      slots[slotIdx].ga.select_merchants += row.select_merchants || 0;
      slots[slotIdx].ga.user_data += row.user_data || 0;
      slots[slotIdx].ga.credential_entry += row.credential_entry || 0;
    }
  }

  // Then: fill remaining empty GA slots from realtime snapshots (averaged per hour)
  if (gaTimeline && gaTimeline.snapshots) {
    const rtBuckets = Array.from({ length: totalHours }, () => ({ users: [], views: [], mobile: [], desktop: [], tablet: [] }));
    for (const snap of gaTimeline.snapshots) {
      if (!snap.time) continue;
      const snapTime = new Date(snap.time);
      if (snapTime < cutoff || snapTime > now) continue;
      const slotIdx = Math.min(totalHours - 1, Math.floor((snapTime - cutoff) / (60 * 60 * 1000)));
      if (snap.summary) {
        rtBuckets[slotIdx].users.push(snap.summary.active_users || 0);
        rtBuckets[slotIdx].views.push(snap.summary.total_views || 0);
        const dev = snap.summary.by_device || {};
        rtBuckets[slotIdx].mobile.push(dev.mobile || 0);
        rtBuckets[slotIdx].desktop.push(dev.desktop || 0);
        rtBuckets[slotIdx].tablet.push(dev.tablet || 0);
      }
    }
    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    for (let i = 0; i < totalHours; i++) {
      const rt = rtBuckets[i];
      if (rt.users.length === 0) continue;
      // Realtime fills in if standard hasn't covered this slot
      if (slots[i].ga.source !== "standard") {
        slots[i].ga.active_users = avg(rt.users);
        slots[i].ga.views = avg(rt.views);
        slots[i].ga.source = "realtime";
      }
      // Device data always comes from realtime (standard doesn't have it yet)
      if (!slots[i].ga.mobile && !slots[i].ga.desktop && !slots[i].ga.tablet) {
        slots[i].ga.mobile = avg(rt.mobile);
        slots[i].ga.desktop = avg(rt.desktop);
        slots[i].ga.tablet = avg(rt.tablet);
      }
    }
  }

  // Find max for each half (independent scaling)
  let maxCardSavr = 1, maxGa = 1;
  for (const slot of slots) {
    if (slot.cardsavr.total > maxCardSavr) maxCardSavr = slot.cardsavr.total;
    const gaVal = slot.ga.active_users || slot.ga.views || 0;
    if (gaVal > maxGa) maxGa = gaVal;
  }

  // Build HTML
  let html = '<div class="kiosk-1d__midline-upper"></div><div class="kiosk-1d__midline-lower"></div>';
  for (let i = 0; i < totalHours; i++) {
    const slot = slots[i];
    const isFuture = slot.start > now;

    // Build unified tooltip for the whole column
    const cs = slot.cardsavr;
    const ga = slot.ga;
    const tipParts = [`${slot.label}`];
    if (cs.total > 0) {
      tipParts.push(`\nCardSavr: ${cs.total} events`);
      if (cs.success) tipParts.push(`  Success: ${cs.success}`);
      if (cs.failed) tipParts.push(`  Failed: ${cs.failed}`);
      if (cs.cancelled) tipParts.push(`  Cancelled: ${cs.cancelled}`);
      if (cs.abandoned) tipParts.push(`  Abandoned: ${cs.abandoned}`);
      if (cs.session) tipParts.push(`  Browse-only: ${cs.session}`);
    } else if (!isFuture) {
      tipParts.push(`\nCardSavr: no events`);
    }
    if (ga.active_users > 0 || ga.views > 0) {
      const src = ga.source === "realtime" ? " (realtime)" : ga.source === "standard" ? " (GA)" : "";
      tipParts.push(`\nGA Traffic${src}: ${ga.active_users} users, ${ga.views} views`);
      if (ga.select_merchants || ga.user_data || ga.credential_entry) {
        tipParts.push(`  Select Merchants: ${ga.select_merchants}  User Data: ${ga.user_data}  Credentials: ${ga.credential_entry}`);
      }
      if (ga.mobile || ga.desktop || ga.tablet) {
        tipParts.push(`  Mobile: ${ga.mobile}  Desktop: ${ga.desktop}  Tablet: ${ga.tablet}`);
      }
    } else if (!isFuture) {
      tipParts.push(`\nGA Traffic: no data`);
    }
    const tooltip = tipParts.join("\n").replace(/"/g, "&quot;");

    // Top half: CardSavr bars hanging down
    let topHtml = '<div class="kiosk-1d__bar-top">';
    if (!isFuture && cs.total > 0) {
      const heightPct = (cs.total / maxCardSavr) * 100;
      for (const s of ["session", "abandoned", "cancelled", "failed", "success"]) {
        if (cs[s] > 0) {
          const segPct = (cs[s] / cs.total) * heightPct;
          topHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--${s}" style="height:${segPct}%"></div>`;
        }
      }
    }
    topHtml += "</div>";

    // Bottom half: GA bars growing up, split by device if available
    let bottomHtml = '<div class="kiosk-1d__bar-bottom">';
    const gaVal = ga.active_users || ga.views || 0;
    if (!isFuture && gaVal > 0) {
      const heightPct = (gaVal / maxGa) * 100;
      const funnelTotal = ga.select_merchants + ga.user_data + ga.credential_entry;
      if (ga.source === "standard") {
        // Standard GA — funnel page breakdown if available, purple fallback otherwise
        if (funnelTotal > 0) {
          const sm = ga.select_merchants, ud = ga.user_data, ce = ga.credential_entry;
          if (ce > 0) bottomHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--credential-entry" style="height:${(ce/funnelTotal)*heightPct}%"></div>`;
          if (ud > 0) bottomHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--user-data" style="height:${(ud/funnelTotal)*heightPct}%"></div>`;
          if (sm > 0) bottomHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--select-merchants" style="height:${(sm/funnelTotal)*heightPct}%"></div>`;
        } else {
          bottomHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--ga-standard" style="height:${heightPct}%"></div>`;
        }
      } else {
        // Realtime — device breakdown
        const m = ga.mobile || 0, d = ga.desktop || 0, t = ga.tablet || 0;
        const deviceTotal = m + d + t;
        if (deviceTotal > 0) {
          if (m > 0) bottomHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--mobile" style="height:${(m/deviceTotal)*heightPct}%"></div>`;
          if (d > 0) bottomHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--desktop" style="height:${(d/deviceTotal)*heightPct}%"></div>`;
          if (t > 0) bottomHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--tablet" style="height:${(t/deviceTotal)*heightPct}%"></div>`;
        } else {
          bottomHtml += `<div class="kiosk-1d__bar-segment kiosk-1d__bar-segment--ga-standard" style="height:${heightPct}%"></div>`;
        }
      }
    }
    bottomHtml += "</div>";

    const labelFreq = days === 1 ? 3 : days === 3 ? 12 : 24;
    const showLabel = i % labelFreq === 0 || i === totalHours - 1;
    html += `<div class="kiosk-1d__hour" title="${tooltip}" style="${isFuture ? 'opacity:0.15' : ''}">
      ${topHtml}
      <div class="kiosk-1d__label-channel">
        ${showLabel ? `<span class="kiosk-1d__hour-label">${slot.label}</span>` : ""}
      </div>
      ${bottomHtml}
    </div>`;
  }

  // "Now" marker at right edge
  html += `<div class="kiosk-1d__now-marker" style="right:0">
    <span class="kiosk-1d__now-label">NOW</span>
  </div>`;

  container.innerHTML = html;

  // Legend
  if (legendEl) {
    legendEl.innerHTML = `
      <span class="kiosk-1d__legend-item" style="font-weight:600;color:var(--text);margin-right:4px">Sessions/Jobs:</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#48bb78"></span>Success</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#fc8181"></span>Failed</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#ecc94b"></span>Cancelled</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#a0aec0"></span>Abandoned</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#63b3ed"></span>Browse</span>
      <span style="margin:0 8px;border-left:1px solid var(--border);height:12px;display:inline-block"></span>
      <span class="kiosk-1d__legend-item" style="font-weight:600;color:var(--text);margin-right:4px">GA Funnel:</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#9f7aea"></span>Select</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#b794f4"></span>User Data</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#d6bcfa"></span>Credentials</span>
      <span style="margin:0 4px;border-left:1px solid var(--border);height:12px;display:inline-block"></span>
      <span class="kiosk-1d__legend-item" style="font-weight:600;color:var(--text);margin-right:4px">Realtime:</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#63b3ed"></span>Mobile</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#a0aec0"></span>Desktop</span>
      <span class="kiosk-1d__legend-item"><span class="kiosk-1d__legend-dot" style="background:#4fd1c5"></span>Tablet</span>
    `;
  }
}

function renderViewTiles(viewKey) {
  const days = VIEW_WINDOW_DAYS[viewKey] || 7;
  const opsData = state.data;

  if (opsData) {
    // Volume chart from feed events (same source of truth as header)
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const feedJobs = (state.allFeedEvents || []).filter(evt => {
      if (!evt.timestamp || evt.status === "session") return false;
      const t = new Date(evt.timestamp);
      return t >= cutoff && t <= now;
    });

    if (days === 1) {
      // 1-day: 4 buckets of 6 hours each, labeled with actual times
      const fmt = (h) => new Date(now.getTime() - h * 60 * 60 * 1000)
        .toLocaleTimeString("en-US", { hour: "numeric", hour12: true }).replace(" ", "").toLowerCase();
      const buckets = [
        { date: fmt(24) + "-" + fmt(18), Jobs_Total: 0, Jobs_Success: 0, Jobs_Failed: 0 },
        { date: fmt(18) + "-" + fmt(12), Jobs_Total: 0, Jobs_Success: 0, Jobs_Failed: 0 },
        { date: fmt(12) + "-" + fmt(6), Jobs_Total: 0, Jobs_Success: 0, Jobs_Failed: 0 },
        { date: fmt(6) + "-now", Jobs_Total: 0, Jobs_Success: 0, Jobs_Failed: 0 },
      ];
      for (const evt of feedJobs) {
        const hoursAgo = (now - new Date(evt.timestamp)) / (60 * 60 * 1000);
        const idx = hoursAgo >= 18 ? 0 : hoursAgo >= 12 ? 1 : hoursAgo >= 6 ? 2 : 3;
        buckets[idx].Jobs_Total++;
        if (evt.status === "success") buckets[idx].Jobs_Success++;
        if (evt.status === "failed") buckets[idx].Jobs_Failed++;
      }
      renderVolumeSparkline(buckets);
    } else {
      // 3-day / 7-day: use ops by_day data (covers full window)
      const byDay = opsData.by_day || [];
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const filteredDays = byDay.filter(d => d.date >= cutoffDate);
      renderVolumeSparkline(filteredDays);
    }

    // Re-render merchant grid filtered by window
    const byMerchantByDay = opsData.by_merchant_by_day || [];
    if (byMerchantByDay.length > 0) {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const filtered = byMerchantByDay.filter(d => d.date >= cutoffDate);
      // Re-aggregate by merchant
      const merchantMap = new Map();
      for (const row of filtered) {
        const entry = merchantMap.get(row.merchant_name) || {
          merchant_name: row.merchant_name, Jobs_Total: 0, Jobs_Success: 0, Jobs_Failed: 0,
        };
        entry.Jobs_Total += row.Jobs_Total || 0;
        entry.Jobs_Success += row.Jobs_Success || 0;
        entry.Jobs_Failed += row.Jobs_Failed || 0;
        merchantMap.set(row.merchant_name, entry);
      }
      renderMerchantHealthGrid(addFailureRates(Array.from(merchantMap.values())));
    } else {
      renderMerchantHealthGrid(addFailureRates(opsData.by_merchant || []));
    }
  }

  // Traffic health re-render with window context
  if (state.trafficHealth) {
    renderKioskTrafficHealth(state.trafficHealth, days);
  }

}

/* ── Command Center — Data Fetching ── */

async function fetchGaRealtimeTimeline(hours) {
  try {
    const h = hours || 24;
    const res = await fetch(`/api/ga-realtime-timeline?hours=${h}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchGaHourly(days) {
  try {
    const d = days || VIEW_WINDOW_DAYS[viewRotation.views[viewRotation.currentIndex]] || 1;
    const res = await fetch(`/api/ga-hourly?days=${d}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchHealthComposite() {
  try {
    const tz = encodeURIComponent(getLocalTimezone());
    const res = await fetch(`/api/ops-health-composite?tz=${tz}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* ── Command Center — Init & Refresh ── */

function initCommandCenter() {
  // Hide normal dashboard sections
  const normalSections = document.querySelectorAll(
    ".dashboard-grid, .dashboard-grid.two, .section-title, .table-wrap, #trafficHealthSection, .dashboard-shell > section"
  );
  normalSections.forEach((el) => (el.style.display = "none"));

  // Show command center containers
  const header = document.getElementById("kioskPersistentHeader");
  const viewport = document.getElementById("kioskViewport");
  if (header) header.style.display = "";
  if (viewport) viewport.style.display = "";

  // Init event feed filters
  initFeedFilters();

  // Add "Include test data" checkbox to persistent header
  const headerRight = document.querySelector(".kiosk-ph__right");
  if (headerRight) {
    const label = document.createElement("label");
    label.className = "kiosk-test-toggle";
    label.style.fontSize = "0.7rem";
    label.innerHTML = `<input type="checkbox" id="kioskIncludeTests" /> Include test data`;
    headerRight.insertBefore(label, headerRight.firstChild);
    document.getElementById("kioskIncludeTests").addEventListener("change", (e) => {
      state.includeTests = e.target.checked;
      commandCenterRefresh();
    });
  }

  // Health dot click handler
  const healthEl = document.getElementById("phHealth");
  const healthPanel = document.getElementById("kioskHealthPanel");
  if (healthEl && healthPanel) {
    healthEl.addEventListener("click", (e) => {
      e.stopPropagation();
      healthPanel.style.display = healthPanel.style.display === "none" ? "" : "none";
    });
    document.addEventListener("click", () => {
      healthPanel.style.display = "none";
    });
  }

  // Arrow key handling
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { handleArrowKey(1); updatePlayPauseButton(); e.preventDefault(); }
    if (e.key === "ArrowLeft") { handleArrowKey(-1); updatePlayPauseButton(); e.preventDefault(); }
    if (e.key === " ") { togglePlayPause(); e.preventDefault(); }
  });

  // Play/pause button
  const ppBtn = document.getElementById("phPlayPause");
  if (ppBtn) {
    ppBtn.addEventListener("click", togglePlayPause);
  }

  // Exit kiosk button
  const exitBtn = document.getElementById("phExitKiosk");
  if (exitBtn) {
    exitBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = new URL(window.location);
      url.searchParams.delete("kiosk");
      window.location.href = url.toString();
    });
  }

  // Any interaction pauses rotation, resumes after 1 minute of inactivity
  function handleInteraction(e) {
    // Don't interfere with controls
    if (e.target.closest && (
      e.target.closest(".kiosk-ph__playpause") ||
      e.target.closest(".detail-modal__close") ||
      e.target.closest(".detail-modal-overlay") ||
      e.target.closest(".kiosk-ph__health") ||
      e.target.closest("button") ||
      e.target.closest("input") ||
      e.target.closest("label")
    )) return;
    if (viewRotation.mode === "auto") {
      pauseViewCycle();
      updatePlayPauseButton();
      clearTimeout(viewRotation.resumeTimer);
      viewRotation.resumeTimer = setTimeout(() => {
        startViewCycle();
        updatePlayPauseButton();
      }, viewRotation.resumeMs);
    }
  }
  document.addEventListener("click", handleInteraction);
  document.addEventListener("scroll", handleInteraction, true);

  // Clock update interval
  setInterval(updateCommandCenterClock, 1000);
}

async function commandCenterRefresh() {
  const currentViewDays = VIEW_WINDOW_DAYS[viewRotation.views[viewRotation.currentIndex]] || 1;
  await fetchOpsTrends();
  const [_opsResult, healthData, gaTimeline, gaHourly] = await Promise.all([
    fetchMetrics(),
    fetchHealthComposite(),
    fetchGaRealtimeTimeline(currentViewDays * 24),
    fetchGaHourly(currentViewDays),
  ]);
  try {
    const headerRes = await fetch(`/api/metrics/ops-feed?tz=${encodeURIComponent(getLocalTimezone())}&days=${currentViewDays}`);
    if (headerRes.ok) {
      const headerData = await headerRes.json();
      state.headerSummary = headerData.summary || null;
      state.allFeedEvents = headerData.allEvents || headerData.events || [];
      state.feedEvents = headerData.allEvents || headerData.events || [];
      state.feedSummary = headerData.summary || null;
      updateFeedFilterOptions();
      renderFilteredFeed();
    }
  } catch {}
  await fetchTrafficHealth();

  state.gaTimeline = gaTimeline;
  state.gaHourly = gaHourly;
  state.healthData = healthData;

  const opsData = state.data;
  renderPersistentHeader(opsData, healthData, gaTimeline);
  const timelineDays = VIEW_WINDOW_DAYS[viewRotation.views[viewRotation.currentIndex]] || 1;
  render1DayTimeline(state.allFeedEvents, gaTimeline, gaHourly, timelineDays);

  // Render tiles for current view window
  const currentView = viewRotation.views[viewRotation.currentIndex];
  renderViewTiles(currentView);
}

const fiSelect = createMultiSelect(document.getElementById("fiSelect"), {
  placeholder: "All FIs",
  onChange: (values) => {
    state.fiList = values;
    fetchMetrics();
  },
});
const partnerSelect = createMultiSelect(document.getElementById("partnerSelect"), {
  placeholder: "All partners",
  onChange: (values) => {
    state.partnerList = values;
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
      const fiMap = new Map();
      const partnerSet = new Set();
      values.forEach((entry) => {
        if (!entry) return;
        const key = (entry.fi_lookup_key || entry.fi_name || "").toString().trim();
        if (key) {
          if (!fiMap.has(key)) fiMap.set(key, { value: key, label: entry.fi_name || key });
        }
        const partner = (entry.partner || "").toString().trim();
        if (partner && partner !== "Unknown" && partner !== "null") partnerSet.add(partner);
      });
      const fiOptions = Array.from(fiMap.values()).sort((a, b) => a.label.localeCompare(b.label));
      fiSelect.setOptions(fiOptions);
      const partnerOptions = Array.from(partnerSet).sort().map(p => ({ value: p, label: p }));
      if (partnerOptions.length) partnerSelect.setOptions(partnerOptions);
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
    partner_list: state.partnerList,
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
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const priorEnd = new Date(end);
  priorEnd.setDate(end.getDate() - 7);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorEnd.getDate() - 6);

  try {
    const res = await fetch("/api/metrics/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date_from: formatLocalDate(priorStart),
        date_to: formatLocalDate(priorEnd),
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

  // Recent events for this merchant from today's feed (respecting feed filters)
  // When "Include test data" is checked, show customer-dev events too
  // Store merchant name for re-render on toggle
  window._merchantModalName = name;
  window._merchantModalShowAll = false;

  function renderMerchantEvents(showAll) {
    const skipDev = !state.includeTests;
    const allEvents = (state.feedEvents || []).filter(
      (evt) => (evt.merchant || "").toLowerCase() === name.toLowerCase()
        && !(skipDev && evt.instance === "customer-dev")
    );
    const filtered = showAll ? allEvents : allEvents.filter(evt => evt.status === "success" || evt.status === "failed");
    const cvd = VIEW_WINDOW_DAYS[viewRotation.views[viewRotation.currentIndex]] || 1;

    if (filtered.length) {
      const eventRows = filtered.map((evt) => {
        const statusCls = evt.status === "success" ? "color:#22c55e" : evt.status === "cancelled" ? "color:#ecc94b" : evt.status === "abandoned" ? "color:#a0aec0" : "color:#ef4444";
        const evtDate = evt.timestamp ? new Date(evt.timestamp) : null;
        const time = evtDate ? (cvd > 1
          ? evtDate.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + evtDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : evtDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : "";
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
      return `
        <div class="detail-modal__section-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Recent Activity <span style="color:var(--muted);font-weight:400;">(${filtered.length}${!showAll && allEvents.length > filtered.length ? " of " + allEvents.length : ""} events)</span></span>
          <label style="font-size:0.72rem;font-weight:400;text-transform:none;letter-spacing:0;cursor:pointer;color:var(--muted);"><input type="checkbox" id="merchantShowAll" ${showAll ? "checked" : ""} style="margin-right:4px;" />Show all</label>
        </div>
        <div class="detail-modal__scrollable">${eventRows}</div>
      `;
    }
    return `
      <div class="detail-modal__section-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>Recent Activity</span>
        <label style="font-size:0.72rem;font-weight:400;text-transform:none;letter-spacing:0;cursor:pointer;color:var(--muted);"><input type="checkbox" id="merchantShowAll" ${showAll ? "checked" : ""} style="margin-right:4px;" />Show all</label>
      </div>
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:16px;">No ${showAll ? "" : "system "}events for this merchant.</div>
    `;
  }

  const eventsContainer = document.createElement("div");
  eventsContainer.id = "merchantEventsContainer";
  eventsContainer.innerHTML = renderMerchantEvents(false);

  // Re-render on toggle
  function bindShowAllToggle() {
    const cb = document.getElementById("merchantShowAll");
    if (cb) {
      cb.addEventListener("change", () => {
        window._merchantModalShowAll = cb.checked;
        eventsContainer.innerHTML = renderMerchantEvents(cb.checked);
        bindShowAllToggle();
      });
    }
  }

  let eventsHtml;
  // We'll append the container after setting innerHTML, so use a placeholder
  const eventsPlaceholder = `<div id="merchantEventsPlaceholder"></div>`;
  eventsHtml = eventsPlaceholder;

  // We need to inject the container after the modal content is set
  setTimeout(() => {
    const ph = document.getElementById("merchantEventsPlaceholder");
    if (ph) {
      ph.replaceWith(eventsContainer);
      bindShowAllToggle();
    }
  }, 0);

  // Keep eventsHtml for the template below
  const _eventsHtml = eventsHtml;

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

  // Date labels — show all for small datasets, pick 3 for larger ones
  const isDateFormat = byDay.length > 0 && /^\d{4}-/.test(byDay[0].date || "");
  const dateIndices = byDay.length <= 5
    ? byDay.map((_, i) => i)
    : [0, Math.floor(byDay.length / 2), byDay.length - 1];
  const dateLabelSvg = dateIndices.map((i) => {
    const x = padL + i * stepX;
    const label = isDateFormat ? (byDay[i].date || "").slice(5) : (byDay[i].date || "");
    return `<text x="${x.toFixed(1)}" y="${vh - 4}" text-anchor="middle" fill="#64748b" font-size="${isDateFormat ? 9 : 7.5}">${label}</text>`;
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

async function fetchEventFeed(days) {
  const eventList = kioskEls.eventList || document.getElementById("kioskEventList");
  if (!eventList) return;
  try {
    const feedDays = days || VIEW_WINDOW_DAYS[viewRotation.views[viewRotation.currentIndex]] || 1;
    const res = await fetch(`/api/metrics/ops-feed?tz=${encodeURIComponent(getLocalTimezone())}&days=${feedDays}`);
    if (!res.ok) return;
    const data = await res.json();
    state.feedEvents = data.allEvents || data.events || [];
    state.allFeedEvents = data.allEvents || data.events || [];
    state.feedSummary = data.summary || null;
    updateFeedFilterOptions();
    renderFilteredFeed();
  } catch (err) {
    console.warn("[ops-kiosk] event feed failed", err);
  }
}

function renderFilteredFeed() {
  const feedListEl = kioskEls.eventList || document.getElementById("kioskEventList");
  if (!feedListEl) return;
  const { statuses, merchants, fis } = state.feedFilters;
  const allEvts = state.feedEvents || [];
  const events = allEvts.filter((evt) => {
    if (!state.includeTests && evt.instance === "customer-dev") return false;
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
    feedListEl.innerHTML = colHeader + `<div class="empty-state">No events match filters.</div>`;
    return;
  }
  feedListEl.innerHTML = colHeader + events
    .map((evt) => {
      const s = evt.status || "unknown";
      const statusClass = s === "success" ? "success" : s === "session" ? "session" : s === "cancelled" ? "cancelled" : s === "abandoned" ? "abandoned" : s === "pending" ? "pending" : "failed";
      const fullTime = evt.timestamp ? new Date(evt.timestamp).toLocaleString() : "Unknown";
      const isSession = s === "session";
      const termInfo = isSession ? "" : evt.termination_type ? `Termination: ${evt.termination_type}` : "No termination code";
      const evtTip = isSession
        ? `${evt.fi_name || "Unknown FI"}\nStatus: session (no jobs)\nTimestamp: ${fullTime}\n\nA cardholder launched CardUpdatr but did not proceed\nto update any cards during this session.`
        : `${evt.merchant || "Unknown"} — ${evt.fi_name || "Unknown FI"}\nStatus: ${s}\nTimestamp: ${fullTime}\n${termInfo}\n\nThis is a single card placement job. Each job represents\none cardholder attempting to update their card at this merchant.`;
      return `
        <div class="event-feed__item" title="${evtTip.replace(/"/g, '&quot;')}">
          <span class="event-feed__time">${formatRelativeTime(evt.timestamp)}</span>
          <span class="event-feed__merchant">${evt.merchant || (isSession ? "\u2014" : "Unknown")}</span>
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
  const isDefault = state.feedFilters.statuses.size === 5 && state.feedFilters.merchants.size === 0 && state.feedFilters.fis.size === 0;
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
    { key: "session", label: "Sess", color: "#8b5cf6" },
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
      state.feedFilters.statuses = new Set(["success", "failed", "cancelled", "abandoned", "session"]);
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
    const res = await fetch(`/api/traffic-health?tz=${encodeURIComponent(getLocalTimezone())}`);
    if (!res.ok) return;
    const data = await res.json();
    state.trafficHealth = data;
    if (isKioskMode()) {
      const currentView = viewRotation.views[viewRotation.currentIndex];
      renderKioskTrafficHealth(data, VIEW_WINDOW_DAYS[currentView] || 7);
    } else {
      renderTrafficHealth(data);
    }
  } catch (err) {
    console.warn("[operations] traffic health fetch failed", err);
  }
}

// Build per-day SESSION outcome map for a given FI from feed events
// Each session is classified as: hadSuccess, hadFailuresOnly, or browseOnly
function buildFiDailySessionOutcomes(fiName) {
  const evts = (state.allFeedEvents || []).filter(evt => {
    if (!state.includeTests && evt.instance === "customer-dev") return false;
    return evt.fi_name === fiName;
  });

  // Group events by session_id, track best outcome per session
  const sessions = new Map(); // session_id → { date, hadSuccess, hadJobs }
  for (const evt of evts) {
    if (!evt.timestamp || !evt.session_id) continue;
    const d = new Date(evt.timestamp);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    if (!sessions.has(evt.session_id)) {
      sessions.set(evt.session_id, { date: dateStr, hadSuccess: false, hadJobs: false });
    }
    const sess = sessions.get(evt.session_id);
    if (evt.status !== "session") {
      sess.hadJobs = true;
      if (evt.status === "success") sess.hadSuccess = true;
    }
  }

  // Bucket session outcomes by day
  const byDay = new Map(); // dateStr → { success: N, failed: N }  (browse-only is implicit)
  for (const [, sess] of sessions) {
    if (!byDay.has(sess.date)) byDay.set(sess.date, { success: 0, failed: 0 });
    const bucket = byDay.get(sess.date);
    if (sess.hadSuccess) bucket.success++;
    else if (sess.hadJobs) bucket.failed++;
    // browse-only sessions are not counted — they're the remainder
  }
  return byDay;
}

// Get local date strings for the last N days (aligned to daily_counts tail)
function getRecentDateStrings(n) {
  const dates = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return dates;
}

function buildTrafficSparkline(dailyCounts, baseline, status, windowDays, fiName, dailyDates) {
  const trimmed = dailyCounts.slice(-7);
  const count = trimmed.length;
  if (!count) return "";
  const highlightDays = windowDays || 1;
  const maxVal = Math.max(...dailyCounts, baseline, 1);
  const w = 120;
  const h = 32;
  const barW = Math.max(2, (w - (count - 1) * 2) / count);

  // Get per-day session outcomes if fiName provided
  const outcomeMap = fiName ? buildFiDailySessionOutcomes(fiName) : null;
  const dateStrings = dailyDates ? dailyDates.slice(-7) : (fiName ? getRecentDateStrings(count) : []);

  const bars = trimmed
    .map((val, i) => {
      const totalBarH = Math.max(1, (val / maxVal) * (h - 2));
      const x = i * (barW + 2);
      const isInWindow = i >= count - highlightDays;
      const baseOpacity = isInWindow ? 1 : 0.35;

      // Default fill for browse-only portion
      let sessionFill;
      if (isInWindow) {
        sessionFill = status === "dark" ? "#ef4444" : status === "low" ? "#f59e0b" : status === "sleeping" ? "#818cf8" : "#22c55e";
      } else {
        sessionFill = "var(--muted)";
      }

      // Stack sessions by outcome: success (green), failed (red), browse-only (status color)
      const dayOutcome = outcomeMap && dateStrings[i] ? outcomeMap.get(dateStrings[i]) : null;
      if (dayOutcome && val > 0) {
        const sessWithOutcomes = dayOutcome.success + dayOutcome.failed;
        if (sessWithOutcomes > 0) {
          const pxPerSession = totalBarH / val;
          const browseOnly = Math.max(0, val - sessWithOutcomes);
          let rects = "";
          let yPos = h; // start from bottom

          // Success sessions at the very bottom
          if (dayOutcome.success > 0) {
            const segH = dayOutcome.success * pxPerSession;
            yPos -= segH;
            rects += `<rect x="${x}" y="${yPos}" width="${barW}" height="${segH}" rx="0" fill="#48bb78" opacity="${baseOpacity}" />`;
          }

          // Failed sessions above success
          if (dayOutcome.failed > 0) {
            const segH = dayOutcome.failed * pxPerSession;
            yPos -= segH;
            rects += `<rect x="${x}" y="${yPos}" width="${barW}" height="${segH}" rx="0" fill="#fc8181" opacity="${baseOpacity}" />`;
          }

          // Browse-only sessions on top
          if (browseOnly > 0) {
            const segH = browseOnly * pxPerSession;
            yPos -= segH;
            rects += `<rect x="${x}" y="${yPos}" width="${barW}" height="${segH}" rx="1" fill="${sessionFill}" opacity="${baseOpacity}" />`;
          }
          return rects;
        }
      }

      // No job data — plain bar
      const y = h - totalBarH;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${totalBarH}" rx="1" fill="${sessionFill}" opacity="${baseOpacity}" />`;
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

function renderTrafficHealthBanner(data, bannerEl, windowDays) {
  if (!bannerEl) return;
  const days = windowDays || 1;
  const { dark, low, sleeping } = data.summary;
  const threshold = data.min_volume_threshold || 5;
  const isAdmin = window.sisAuth && ["admin", "full", "core", "internal", "siteops", "support", "cs"].includes(window.sisAuth.getAccessLevel?.());
  const thresholdText = isAdmin
    ? `<a href="../maintenance.html#trafficHealthSettingsCard" style="color:inherit;text-decoration:underline;text-decoration-style:dotted;">${threshold}+ sessions/day</a>`
    : `${threshold}+ sessions/day`;
  const sleepingNote = sleeping > 0 ? `, ${sleeping} sleeping` : "";
  const monitorNote = `<span style="font-weight:400;font-size:0.75rem;opacity:0.8;margin-left:6px;">(${data.summary.total_monitored} FIs averaging ${thresholdText}${sleepingNote})</span>`;
  const windowLabel = days === 1 ? "today" : `last ${days} days`;

  if (dark === 0 && low === 0) {
    bannerEl.innerHTML = `<div class="traffic-health-banner all-clear">All clear — ${data.summary.total_monitored} FIs reporting normal traffic ${windowLabel} ${monitorNote}</div>`;
  } else if (dark > 0) {
    const parts = [];
    if (dark > 0) parts.push(`${dark} dark`);
    if (low > 0) parts.push(`${low} low`);
    bannerEl.innerHTML = `<div class="traffic-health-banner has-issues">${parts.join(", ")} ${windowLabel} ${monitorNote}</div>`;
  } else {
    bannerEl.innerHTML = `<div class="traffic-health-banner has-warnings">${low} low volume ${windowLabel} ${monitorNote}</div>`;
  }
}

function renderTrafficTile(fi, windowDays) {
  const days = windowDays || 1;
  const effectiveStatus = (days > 1 && fi._windowStatus) ? fi._windowStatus : fi.status;
  const sparkline = buildTrafficSparkline(fi.daily_counts, fi.baseline_median, effectiveStatus, windowDays, fi.fi_name, fi.daily_dates);
  const dailyCounts = fi.daily_counts || [];

  // Compute session total for the window
  let windowSessions, windowLabel;
  if (days === 1) {
    windowSessions = fi.today_sessions;
    windowLabel = "Today";
  } else {
    windowSessions = dailyCounts.slice(-days).reduce((s, c) => s + c, 0);
    windowLabel = `${days}d`;
  }

  // Compute window % of baseline
  const windowAvg = days > 1 && dailyCounts.length > 0
    ? windowSessions / Math.min(days, dailyCounts.length)
    : null;
  const windowPct = windowAvg != null && fi.baseline_avg > 0
    ? Math.round((windowAvg / fi.baseline_avg) * 100)
    : null;

  let statsHtml;
  let zzzIndicator = "";
  if (effectiveStatus === "dark" && days === 1) {
    const hoursAgo = fi.hours_since_last != null ? `${fi.hours_since_last}h ago` : "unknown";
    statsHtml = `DARK &mdash; last session <strong>${hoursAgo}</strong>`;
  } else if (effectiveStatus === "sleeping" && days === 1) {
    const tierNote = fi.fingerprint_tier === 1 && fi.expected_cumulative != null
      ? ` (expect ~${fi.expected_cumulative} by now)`
      : "";
    statsHtml = `Quiet period${tierNote}`;
    zzzIndicator = `<span class="zzz-indicator">zzz</span>`;
  } else if (effectiveStatus === "dark" && days > 1) {
    statsHtml = `${windowLabel}: <strong>0</strong> sessions`;
  } else if (effectiveStatus === "low" && days === 1) {
    statsHtml = `Today: <strong>${fi.today_sessions}</strong> sessions (<strong>${fi.pct_of_baseline}%</strong> of baseline, proj)`;
  } else if (effectiveStatus === "low" && days > 1) {
    const pctStr = windowPct != null ? ` (<strong>${windowPct}%</strong> of baseline)` : "";
    statsHtml = `${windowLabel}: <strong>${windowSessions}</strong> sessions${pctStr}`;
  } else {
    const pctNote = days === 1
      ? ` (<strong>${fi.pct_of_baseline}%</strong> of baseline, proj)`
      : windowPct != null ? ` (<strong>${windowPct}%</strong> of baseline)` : "";
    statsHtml = `${windowLabel}: <strong>${windowSessions}</strong> sessions${pctNote}`;
  }

  // Build verbose tooltip
  const statusExplain = effectiveStatus === "dark"
    ? "DARK: Zero sessions detected. This FI may have an outage, integration issue, or has gone offline."
    : effectiveStatus === "low"
    ? "LOW: Session volume is significantly below the 14-day baseline. Could indicate reduced traffic, partial outage, or campaign ending."
    : effectiveStatus === "sleeping"
    ? "SLEEPING: Expected quiet period — historically near-zero traffic at this hour. No action needed."
    : "NORMAL: Session volume is within expected range based on the 14-day rolling baseline.";
  const lastSessionStr = fi.hours_since_last != null ? `${fi.hours_since_last} hours ago` : "Unknown";
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
    `% of baseline (projected): ${fi.pct_of_baseline}%`,
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

  const badgeLabel = effectiveStatus === "sleeping" ? "Sleeping" : effectiveStatus.toUpperCase();
  return `
    <div class="traffic-tile status-${effectiveStatus}" data-fi-key="${fi.fi_lookup_key}" title="${tipFi.replace(/"/g, '&quot;')}">
      <div class="traffic-tile__header">
        <span class="traffic-tile__name">${fi.fi_name}</span>
        <span style="display:flex;align-items:center;gap:4px;">
          ${zzzIndicator}
          <span class="traffic-tile__status-badge ${effectiveStatus}">${badgeLabel}</span>
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

  let html = anomalies.map(fi => renderTrafficTile(fi)).join("");

  // Show sleeping tiles collapsed by default (not actionable)
  if (sleeping.length > 0) {
    if (state.trafficShowSleeping) {
      html += sleeping.map(fi => renderTrafficTile(fi)).join("");
      html += `<div class="traffic-health-expand" id="trafficToggleSleeping">Hide ${sleeping.length} sleeping FIs</div>`;
    } else {
      html += `<div class="traffic-health-expand" id="trafficToggleSleeping">Show ${sleeping.length} sleeping FIs</div>`;
    }
  }

  if (normals.length > 0) {
    if (state.trafficShowNormal) {
      html += normals.map(fi => renderTrafficTile(fi)).join("");
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

function reclassifyForWindow(fi, windowDays) {
  if (windowDays <= 1) return fi; // 1-day view uses server status as-is
  const dailyCounts = fi.daily_counts || [];
  const windowCounts = dailyCounts.slice(-windowDays);
  const windowTotal = windowCounts.reduce((s, c) => s + c, 0);
  const windowAvg = windowCounts.length > 0 ? windowTotal / windowCounts.length : 0;
  const baselineAvg = fi.baseline_avg || 0;

  // Reclassify based on window aggregate vs baseline
  let status;
  if (windowTotal === 0) {
    status = "dark";
  } else if (baselineAvg > 0 && windowAvg < baselineAvg * 0.4) {
    status = "low";
  } else {
    status = "normal";
  }
  // No "sleeping" in multi-day views — it's a momentary state, not a window state
  return { ...fi, _windowStatus: status, _windowSessions: windowTotal, _windowAvg: windowAvg };
}

function renderKioskTrafficHealth(data, windowDays) {
  if (!data || !data.fis) return;
  const days = windowDays || 1;

  // Reclassify FIs for the current window
  const reclassified = data.fis.map(fi => reclassifyForWindow(fi, days));

  // Recompute banner summary from window-aware statuses
  if (days > 1) {
    const windowSummary = { ...data.summary, dark: 0, low: 0, sleeping: 0, normal: 0 };
    for (const fi of reclassified) {
      const ws = fi._windowStatus || fi.status;
      windowSummary[ws] = (windowSummary[ws] || 0) + 1;
    }
    renderTrafficHealthBanner({ ...data, summary: windowSummary }, trafficEls.kioskBanner, days);
  } else {
    renderTrafficHealthBanner(data, trafficEls.kioskBanner, days);
  }

  if (trafficEls.kioskGrid) {
    // Sort by window status: dark → low → normal; within status, by baseline desc
    const kioskStatusOrder = { dark: 0, low: 1, normal: 2, sleeping: 3 };
    const sorted = reclassified.slice().sort((a, b) => {
      const aStatus = a._windowStatus || a.status;
      const bStatus = b._windowStatus || b.status;
      const so = (kioskStatusOrder[aStatus] ?? 9) - (kioskStatusOrder[bStatus] ?? 9);
      if (so !== 0) return so;
      return (b.baseline_avg || 0) - (a.baseline_avg || 0);
    });
    trafficEls.kioskGrid.innerHTML = sorted.map(fi => renderTrafficTile(fi, days)).join("");

    trafficEls.kioskGrid.querySelectorAll(".traffic-tile").forEach(tile => {
      tile.addEventListener("click", () => {
        const fiKey = tile.dataset.fiKey;
        const fi = reclassified.find(f => f.fi_lookup_key === fiKey);
        if (fi) renderTrafficDetailModal(fi, data, days);
      });
    });
  }
}

function renderTrafficDetailModal(fi, data, windowDays) {
  if (!trafficEls.detailOverlay) return;
  const days = windowDays || 1;
  const windowLabel = days === 1 ? "Today" : `${days}d`;
  const dailyCounts = fi.daily_counts || [];
  const windowSessions = days === 1 ? fi.today_sessions : dailyCounts.slice(-days).reduce((s, c) => s + c, 0);

  // Pause rotation while modal is open, remember previous state
  viewRotation.modeBeforeModal = viewRotation.mode;
  if (viewRotation.mode === "auto") pauseViewCycle();

  trafficEls.detailName.textContent = fi.fi_name;
  trafficEls.detailSubtitle.textContent = `${fi.partner} · ${fi.instance || fi.integration_type}`;

  // Stats grid
  const statItems = [
    { label: "Status", value: fi.status.toUpperCase(), color: trafficHealthColor(fi.status) },
    { label: windowLabel, value: `${windowSessions} sessions` },
    { label: "Projected", value: days === 1 ? `${fi.today_projected} sessions` : "—" },
    { label: "Baseline (median)", value: `${fi.baseline_median}/day` },
    { label: "Baseline (avg)", value: `${fi.baseline_avg}/day` },
    { label: "Yesterday", value: `${fi.yesterday_sessions} sessions` },
    { label: "% of Baseline (proj)", value: days === 1 ? `${fi.pct_of_baseline}%` : "—" },
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

  // Bar chart: daily counts with baseline line, highlight window
  const counts = (fi.daily_counts || []).slice(-7);
  const baseline = fi.baseline_median;
  const maxVal = Math.max(...counts, baseline, 1);
  const chartW = 560;
  const chartH = 160;
  const padding = 30;
  const barCount = counts.length;
  const barW = Math.max(8, (chartW - padding * 2 - (barCount - 1) * 4) / barCount);
  const usableH = chartH - padding - 10;

  // Get per-day session outcomes for stacked bars
  const modalOutcomeMap = buildFiDailySessionOutcomes(fi.fi_name);
  const modalDateStrings = fi.daily_dates ? fi.daily_dates.slice(-barCount) : getRecentDateStrings(barCount);

  let bars = "";
  counts.forEach((val, i) => {
    const totalBarH = Math.max(1, (val / maxVal) * usableH);
    const x = padding + i * (barW + 4);
    const isInWindow = i >= barCount - days;
    const baseOpacity = isInWindow ? 1 : 0.4;

    let sessionFill;
    if (isInWindow) {
      sessionFill = fi.status === "dark" ? "#ef4444" : fi.status === "low" ? "#f59e0b" : fi.status === "sleeping" ? "#818cf8" : "#22c55e";
    } else {
      sessionFill = "var(--accent)";
    }

    const dayOutcome = modalDateStrings[i] ? modalOutcomeMap.get(modalDateStrings[i]) : null;
    if (dayOutcome && val > 0) {
      const sessWithOutcomes = dayOutcome.success + dayOutcome.failed;
      if (sessWithOutcomes > 0) {
        const pxPerSession = totalBarH / val;
        const browseOnly = Math.max(0, val - sessWithOutcomes);
        let yPos = chartH - padding; // start from bottom

        // Success sessions at the very bottom
        if (dayOutcome.success > 0) {
          const segH = dayOutcome.success * pxPerSession;
          yPos -= segH;
          bars += `<rect x="${x}" y="${yPos}" width="${barW}" height="${segH}" rx="0" fill="#48bb78" opacity="${baseOpacity}" />`;
        }

        // Failed sessions above success
        if (dayOutcome.failed > 0) {
          const segH = dayOutcome.failed * pxPerSession;
          yPos -= segH;
          bars += `<rect x="${x}" y="${yPos}" width="${barW}" height="${segH}" rx="0" fill="#fc8181" opacity="${baseOpacity}" />`;
        }

        // Browse-only sessions on top
        if (browseOnly > 0) {
          const segH = browseOnly * pxPerSession;
          yPos -= segH;
          bars += `<rect x="${x}" y="${yPos}" width="${barW}" height="${segH}" rx="3" fill="${sessionFill}" opacity="${baseOpacity}" />`;
        }

        // Value label on top
        if (val > 0) {
          bars += `<text x="${x + barW / 2}" y="${chartH - padding - totalBarH - 4}" text-anchor="middle" fill="var(--muted)" font-size="9">${val}</text>`;
        }
        return;
      }
    }

    // No job data — plain bar
    const y = chartH - padding - totalBarH;
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${totalBarH}" rx="3" fill="${sessionFill}" opacity="${baseOpacity}" />`;
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

  // ── Session Outcome Legend (colors match stacked bars above) ──
  let totalSuccessSess = 0, totalFailedSess = 0;
  for (const [, d] of modalOutcomeMap) {
    totalSuccessSess += d.success; totalFailedSess += d.failed;
  }
  const totalWithJobs = totalSuccessSess + totalFailedSess;
  const totalSessions = counts.reduce((a, b) => a + b, 0);
  const browseOnlySess = Math.max(0, totalSessions - totalWithJobs);

  let outcomeHtml = "";
  if (totalWithJobs > 0 || totalSessions > 0) {
    const legendItems = [
      { count: totalSuccessSess, color: "#48bb78", label: "Had success" },
      { count: totalFailedSess, color: "#fc8181", label: "Tried, no success" },
      { count: browseOnlySess, color: "#22c55e", label: "Browse only" },
    ].filter(s => s.count > 0);

    const legend = legendItems.map(s =>
      `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;">` +
      `<span style="width:8px;height:8px;border-radius:2px;background:${s.color};display:inline-block;"></span>` +
      `<span style="color:var(--muted);font-size:0.7rem;">${s.label}: ${s.count}</span></span>`
    ).join("");

    outcomeHtml = `
      <div style="margin-top:8px;line-height:1.6;">
        <span style="font-size:0.7rem;font-weight:600;color:var(--muted);margin-right:8px;">${totalSessions} sessions:</span>${legend}
      </div>
    `;
  }

  trafficEls.detailChart.innerHTML = `
    <svg width="100%" height="${chartH}" viewBox="0 0 ${chartW + 40} ${chartH}">
      ${bars}
      ${baselineLine}
      ${baselineLabel}
      ${dayLabels}
    </svg>
    ${hoursInfo ? `<div style="text-align:right;font-size:0.72rem;color:var(--muted);margin-top:4px;">${hoursInfo}</div>` : ""}
    ${outcomeHtml}
  `;

  // Show modal
  trafficEls.detailOverlay.style.display = "";
  requestAnimationFrame(() => trafficEls.detailOverlay.classList.add("open"));
}

function closeTrafficDetail() {
  if (!trafficEls.detailOverlay) return;
  trafficEls.detailOverlay.classList.remove("open");
  setTimeout(() => { trafficEls.detailOverlay.style.display = "none"; }, 200);
  // Restore previous play/pause state
  if (viewRotation.modeBeforeModal === "auto") {
    startViewCycle();
    updatePlayPauseButton();
  }
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
    initKioskMode("Success Dashboard", 30);
    initCommandCenter();
    state.windowDays = 8;
    loadFiRegistry();
    startViewCycle();
    commandCenterRefresh(); // initial data load
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
    // Timezone select
    const tzWrap = document.getElementById("tzSelectWrap");
    if (tzWrap) createTimezoneSelect(tzWrap);
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
