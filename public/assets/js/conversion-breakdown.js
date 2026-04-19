// Conversion Breakdown dashboard — admin-only.
// Fetches /api/conversion-breakdown and renders 6 conversion points grouped by
// MOTIVATION (CS) / EXPERIENCE (UX) / EXECUTION (Eng), plus a time-window
// comparison strip and a source adoption scoreboard.

const CAT_ORDER = ["activation", "campaign", "card_controls", "other", "untagged"];
const CAT_LABEL = {
  activation: "Activation",
  campaign: "Campaign",
  card_controls: "Card Controls",
  other: "Other",
  untagged: "Untagged",
};
const CAT_COLOR = {
  activation: "#0ea5e9",
  campaign: "#8b5cf6",
  card_controls: "#f59e0b",
  other: "#64748b",
  untagged: "#cbd5e1",
};
const STEP_LABELS = {
  step1_sees_cu: "1. Sees CardUpdatr",
  step2_merchant_continue: "2. Merchant select - Continue",
  step3_user_data: "3. User data [non-SSO, reached page]",
  step4_cred_entered: "4. Credentials entered",
  step5_linked: "5. Account linked (per job)",
  step6_placed: "6. Card placed (per job)",
};
const STEP_ORDER = [
  "step1_sees_cu",
  "step2_merchant_continue",
  "step3_user_data",
  "step4_cred_entered",
  "step5_linked",
  "step6_placed",
];
const WINDOW_KEYS = ["30d", "60d", "90d", "6mo", "9mo", "12mo"];

const state = {
  loading: false,
  data: null,
  lastAppliedStamp: 0,
  openCats: new Set(),
};

let inFlightController = null;

/* ────────────── filter plumbing ────────────── */

function getFilterState() {
  return window.__FILTER_STATE || {};
}

function buildQueryParams() {
  const fs = getFilterState();
  const params = new URLSearchParams();

  // Date range — filters.js writes start/end into URL as date params on some
  // pages; for v1 default to rolling 90d if none present.
  const startEl = document.getElementById("cbStartDate");
  const endEl = document.getElementById("cbEndDate");
  const includeTestsEl = document.getElementById("cbIncludeTests");
  const url = new URLSearchParams(window.location.search);
  const start = (startEl && startEl.value) || url.get("start") || url.get("date_from") || defaultStart();
  const end = (endEl && endEl.value) || url.get("end") || url.get("date_to") || todayIso();
  params.set("start", start);
  params.set("end", end);
  params.set("includeTests", includeTestsEl && includeTestsEl.checked ? "true" : "false");

  if (fs.fis && fs.fis.size) {
    params.set("fi_list", Array.from(fs.fis).join(","));
  }
  if (fs.partnerSetNormalized && fs.partnerSetNormalized.size) {
    params.set("partner_list", Array.from(fs.partnerSetNormalized).join(","));
  }
  if (fs.integrationSetNormalized && fs.integrationSetNormalized.size) {
    const set = new Set(Array.from(fs.integrationSetNormalized).map((s) => s.toUpperCase().replace(/[_-]/g, "")));
    const hasSso = set.has("SSO") || set.has("CU2SSO");
    const hasNonSso = set.has("NONSSO");
    if (hasSso && !hasNonSso) params.set("fi_scope", "sso_only");
    else if (hasNonSso && !hasSso) params.set("fi_scope", "non_sso_only");
  }
  if (fs.instanceSetNormalized && fs.instanceSetNormalized.size) {
    params.set("instance_list", Array.from(fs.instanceSetNormalized).join(","));
  }
  return params;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

function applyDatePreset(preset) {
  const startEl = document.getElementById("cbStartDate");
  const endEl = document.getElementById("cbEndDate");
  if (!startEl || !endEl) return;
  const end = new Date();
  let start = new Date();
  const days = { last30: 30, last60: 60, last90: 90, last180: 180, last270: 270, last365: 365 }[preset];
  if (days) start.setDate(end.getDate() - (days - 1));
  else if (preset === "ytd") start = new Date(end.getFullYear(), 0, 1);
  else return;
  startEl.value = start.toISOString().slice(0, 10);
  endEl.value = end.toISOString().slice(0, 10);
}

function initDateControls() {
  const preset = document.getElementById("cbDatePreset");
  const startEl = document.getElementById("cbStartDate");
  const endEl = document.getElementById("cbEndDate");
  const includeTestsEl = document.getElementById("cbIncludeTests");
  if (preset && !startEl.value) applyDatePreset(preset.value || "last30");
  if (preset) preset.addEventListener("change", () => {
    if (preset.value) applyDatePreset(preset.value);
    fetchData();
  });
  if (startEl) startEl.addEventListener("change", () => { if (preset) preset.value = ""; fetchData(); });
  if (endEl) endEl.addEventListener("change", () => { if (preset) preset.value = ""; fetchData(); });
  if (includeTestsEl) includeTestsEl.addEventListener("change", () => fetchData());
}

/* ────────────── fetch ────────────── */

async function fetchData() {
  if (inFlightController) inFlightController.abort();
  inFlightController = new AbortController();
  state.loading = true;
  setKpisLoading();
  try {
    const token = window.sisAuth && window.sisAuth.getToken && window.sisAuth.getToken();
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    const url = "/api/conversion-breakdown?" + buildQueryParams().toString();
    const res = await fetch(url, { headers, signal: inFlightController.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    state.data = json;
    render();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("[conversion-breakdown] fetch failed", err);
    renderError(err && err.message ? err.message : "Failed to load");
  } finally {
    state.loading = false;
  }
}

/* ────────────── render ────────────── */

function setKpisLoading() {
  ["kpiCoverage", "kpiSessions", "kpiOverall", "kpiJobsPerSess"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "…";
  });
}

function renderError(msg) {
  const el = document.getElementById("cbMotivation");
  if (el) el.innerHTML = `<div class="cb-empty">Error: ${escapeHtml(msg)}</div>`;
}

function render() {
  if (!state.data) return;
  renderKpis();
  renderTimeWindows();
  renderMotivation();
  renderExperience();
  renderExecution();
  renderLists();
}

function renderKpis() {
  const d = state.data;
  const cov = d.source_coverage_pct;
  const br = d.source_coverage_breakdown || {};
  document.getElementById("kpiCoverage").textContent =
    cov == null ? "—" : fmtPct(cov);
  document.getElementById("kpiCoverageSub").textContent =
    `${br.tagged || 0} tagged / ${br.partial || 0} partial / ${br.untagged || 0} untagged`;

  const sessions = (d.overall && d.overall.sessions) || 0;
  document.getElementById("kpiSessions").textContent = fmtNum(sessions);
  document.getElementById("kpiSessionsSub").textContent =
    `SM sessions in window`;

  const overall = d.overall && d.overall.overall_conv_pct;
  document.getElementById("kpiOverall").textContent =
    overall == null ? "—" : fmtPct(overall);

  const jps = d.overall && d.overall.jobs_per_session;
  document.getElementById("kpiJobsPerSess").textContent =
    jps == null ? "—" : Number(jps).toFixed(2);
}

function renderTimeWindows() {
  const tb = document.querySelector("#cbWindowsTable tbody");
  if (!tb) return;
  const tw = state.data.time_windows || {};
  const rows = STEP_ORDER.map((step) => {
    const tds = WINDOW_KEYS.map((w) => {
      const v = tw[w] && tw[w][step];
      return `<td class="num">${v == null ? "—" : fmtPct(v)}</td>`;
    }).join("");
    return `<tr><td class="step">${escapeHtml(STEP_LABELS[step])}</td>${tds}</tr>`;
  }).join("");
  tb.innerHTML = rows;
}

function renderMotivation() {
  const root = document.getElementById("cbMotivation");
  const mot = state.data.motivation || {};
  const byCat = mot.by_category || {};
  const total = CAT_ORDER.reduce((acc, c) => acc + ((byCat[c] && byCat[c].sessions) || 0), 0);

  if (!total) {
    root.innerHTML = `<div class="cb-empty">No sessions in this window.</div>`;
    return;
  }

  const segs = CAT_ORDER.map((c) => {
    const s = (byCat[c] && byCat[c].sessions) || 0;
    if (!s) return "";
    const pct = (s / total) * 100;
    return `<div class="cb-stacked-seg" style="width:${pct}%;background:${CAT_COLOR[c]};" title="${escapeHtml(CAT_LABEL[c])}: ${fmtNum(s)} (${pct.toFixed(1)}%)">${pct >= 8 ? CAT_LABEL[c] : ""}</div>`;
  }).join("");

  const legend = CAT_ORDER.map((c) =>
    `<span><span class="cb-legend-dot" style="background:${CAT_COLOR[c]};"></span>${escapeHtml(CAT_LABEL[c])}</span>`
  ).join("");

  const rows = CAT_ORDER.map((c) => {
    const s = (byCat[c] && byCat[c].sessions) || 0;
    const pct = total ? (s / total) * 100 : 0;
    const byType = (byCat[c] && byCat[c].by_type) || {};
    const typeKeys = Object.keys(byType).sort((a, b) => (byType[b].sessions || 0) - (byType[a].sessions || 0));
    const isOpen = state.openCats.has("mot:" + c);
    const accordion = typeKeys.length
      ? `<button class="cb-accordion-toggle" data-acc="mot:${c}">${isOpen ? "▾" : "▸"} ${typeKeys.length} source_type${typeKeys.length > 1 ? "s" : ""}</button>
         ${isOpen ? `<div class="cb-accordion-body">${typeKeys.map((t) => {
           const ts = byType[t].sessions || 0;
           return `<div class="cb-muted">${escapeHtml(t)}: ${fmtNum(ts)}</div>`;
         }).join("")}</div>` : ""}`
      : `<span class="cb-muted">—</span>`;
    return `
      <div class="cb-cat-row">
        <span class="cb-cat-swatch" style="background:${CAT_COLOR[c]};"></span>
        <span class="cb-cat-label">${escapeHtml(CAT_LABEL[c])}</span>
        <span class="cb-cat-bar"><span class="cb-cat-bar-fill" style="width:${pct.toFixed(1)}%;background:${CAT_COLOR[c]};"></span></span>
        <span class="cb-cat-val">${fmtNum(s)} (${pct.toFixed(1)}%)</span>
      </div>
      <div style="margin:2px 0 6px 138px;">${accordion}</div>
    `;
  }).join("");

  root.innerHTML = `
    <div class="cb-stacked-bar">${segs}</div>
    <div class="cb-legend">${legend}</div>
    <div style="margin-top:10px;">${rows}</div>
  `;
  wireAccordions(root);
}

function renderExperience() {
  const root = document.getElementById("cbExperience");
  const exp = state.data.experience || {};
  const steps = [
    { key: "step2_merchant_continue", label: "Step 2: Merchant select → Continue" },
    { key: "step3_user_data", label: "Step 3: Reached user data page (non-SSO)" },
    { key: "step4_cred_entered", label: "Step 4: Credentials entered" },
  ];
  const blocks = steps.map(({ key, label }) => {
    const byCat = (exp[key] && exp[key].by_category) || {};
    const rows = CAT_ORDER.map((c) => {
      const entry = byCat[c];
      if (!entry || !entry.denominator) {
        return `<tr><td><span class="cb-cat-swatch" style="background:${CAT_COLOR[c]};display:inline-block;margin-right:6px;"></span>${escapeHtml(CAT_LABEL[c])}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`;
      }
      const convPct = entry.conv_pct == null ? "—" : fmtPct(entry.conv_pct);
      return `<tr>
        <td><span class="cb-cat-swatch" style="background:${CAT_COLOR[c]};display:inline-block;margin-right:6px;"></span>${escapeHtml(CAT_LABEL[c])}</td>
        <td class="num">${fmtNum(entry.numerator)}</td>
        <td class="num">${fmtNum(entry.denominator)}</td>
        <td class="num">${convPct}</td>
      </tr>`;
    }).join("");
    return `
      <div style="margin-bottom:14px;">
        <h4>${escapeHtml(label)}</h4>
        <table class="cb-table">
          <thead><tr><th>Source Category</th><th class="num">Num</th><th class="num">Denom</th><th class="num">Conv %</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");
  root.innerHTML = blocks;
}

function renderExecution() {
  const root = document.getElementById("cbExecution");
  const ex = state.data.execution || {};
  const steps = [
    { key: "step5_linked", label: "Step 5: Credentials → account linked (per job)" },
    { key: "step6_placed", label: "Step 6: Linked → card placed (per job)" },
  ];
  const blocks = steps.map(({ key, label }) => {
    const byCat = (ex[key] && ex[key].by_category) || {};
    const catRows = CAT_ORDER.map((c) => {
      const entry = byCat[c];
      if (!entry || !entry.denominator) {
        return `<tr><td>${escapeHtml(CAT_LABEL[c])}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`;
      }
      return `<tr>
        <td><span class="cb-cat-swatch" style="background:${CAT_COLOR[c]};display:inline-block;margin-right:6px;"></span>${escapeHtml(CAT_LABEL[c])}</td>
        <td class="num">${fmtNum(entry.numerator)}</td>
        <td class="num">${fmtNum(entry.denominator)}</td>
        <td class="num">${entry.conv_pct == null ? "—" : fmtPct(entry.conv_pct)}</td>
      </tr>`;
    }).join("");
    const byMerchant = (ex[key] && ex[key].by_merchant) || [];
    const topMerchants = byMerchant.slice(0, 10);
    const merchantRows = topMerchants.map((m) =>
      `<tr>
        <td>${escapeHtml(m.merchant || "—")}</td>
        <td class="num">${fmtNum(m.numerator)}</td>
        <td class="num">${fmtNum(m.denominator)}</td>
        <td class="num">${m.conv_pct == null ? "—" : fmtPct(m.conv_pct)}</td>
      </tr>`
    ).join("");
    return `
      <div style="margin-bottom:14px;">
        <h4>${escapeHtml(label)}</h4>
        <table class="cb-table" style="margin-bottom:8px;">
          <thead><tr><th>Source Category</th><th class="num">Success</th><th class="num">Total</th><th class="num">Rate</th></tr></thead>
          <tbody>${catRows}</tbody>
        </table>
        ${merchantRows ? `
        <div class="cb-muted" style="margin-top:6px;">Top merchants (by job volume):</div>
        <table class="cb-table">
          <thead><tr><th>Merchant</th><th class="num">Success</th><th class="num">Total</th><th class="num">Rate</th></tr></thead>
          <tbody>${merchantRows}</tbody>
        </table>` : ""}
      </div>`;
  }).join("");
  root.innerHTML = blocks;
}

function renderLists() {
  const lists = state.data.fi_lists || {};
  renderList("cbListRetrofit", lists.cs_retrofit || []);
  renderList("cbListEscalation", lists.integration_escalation || []);
  renderList("cbListRegressions", lists.regressions || [], true);
}

function renderList(id, items, isRegression) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="cb-empty">No FIs in this bucket.</div>`;
    return;
  }
  const rows = items.map((it) => {
    const extra = isRegression
      ? `<td class="num">${it.days_quiet == null ? "—" : it.days_quiet}d</td>`
      : `<td class="num">${escapeHtml(it.traffic_first_seen || "—")}</td>`;
    return `<tr>
      <td>${escapeHtml(it.fi_name || it.fi_key || "—")}</td>
      ${extra}
      <td class="num">${fmtNum(it.volume || 0)}</td>
      <td class="num">${it.coverage_pct == null ? "0%" : fmtPct(it.coverage_pct)}</td>
    </tr>`;
  }).join("");
  const header = isRegression
    ? `<tr><th>FI</th><th class="num">Days Quiet</th><th class="num">Volume</th><th class="num">Coverage</th></tr>`
    : `<tr><th>FI</th><th class="num">First Seen</th><th class="num">Volume</th><th class="num">Coverage</th></tr>`;
  el.innerHTML = `<table class="cb-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

function wireAccordions(root) {
  root.querySelectorAll("[data-acc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-acc");
      if (state.openCats.has(key)) state.openCats.delete(key);
      else state.openCats.add(key);
      renderMotivation();
    });
  });
}

/* ────────────── utils ────────────── */

function fmtNum(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString();
}
function fmtPct(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return "—";
  return num.toFixed(1) + "%";
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* ────────────── init ────────────── */

// Hook the pageId-based apply hook that filters.js looks for — we install
// window.applyFilters before initFilters runs, so every filter change triggers
// a re-fetch.
window.applyFilters = function () {
  fetchData();
};

async function init() {
  initDateControls();
  // Kick filters.js with our page id.
  if (window.initFilters) {
    await window.initFilters("conversion-breakdown");
  } else {
    // Fallback: wait for filters.js to load, then init
    const tryInit = () => {
      if (window.initFilters) window.initFilters("conversion-breakdown");
      else setTimeout(tryInit, 50);
    };
    tryInit();
  }
  // filters.js calls apply() at end of initFilters -> applyFilters -> fetch.
  // But some code paths skip; fetch defensively.
  setTimeout(() => { if (!state.data) fetchData(); }, 500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
