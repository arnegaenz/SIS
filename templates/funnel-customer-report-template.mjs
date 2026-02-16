/**
 * Strivve-branded PDF report template for the Cardholder Engagement Dashboard.
 * Customer-facing: shows only positive metrics (no failure breakdowns).
 * Includes engagement insights: narratives, motivation spectrum, actions, projections.
 * Returns a self-contained HTML string ready for Puppeteer rendering.
 */

const fmt = (n) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "0";

const fmtDec = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
};

const pct = (num, den) =>
  den > 0 ? ((num / den) * 100).toFixed(1) + "%" : "—";

export function buildCustomerReportHtml(data) {
  const {
    startDate,
    endDate,
    filterContext,
    generatedAt,
    metrics,
    highlights,
    partnerSummary,
    shareUrl,
    insights,
  } = data;

  const m = metrics || {};
  const ins = insights || {};

  // ── Key Metrics cards (positive only) ──
  const successRate = m.totalSessions > 0
    ? ((m.sessionsWithSuccessfulJobs / m.totalSessions) * 100).toFixed(1) + "%"
    : "—";

  const metricCards = [
    {
      cls: "ga",
      label: "CardUpdatr Launches",
      value: fmt(m.totalGaSelect),
      sub: "Google Analytics",
    },
    {
      cls: "ga",
      label: "User Data Page Views",
      value: fmt(m.totalGaUser),
      sub: pct(m.totalGaUser, m.totalGaSelect) + " of launches",
    },
    {
      cls: "ga",
      label: "Credential Entry Views",
      value: fmt(m.totalGaCred),
      sub: pct(m.totalGaCred, m.totalGaSelect) + " of launches",
    },
    {
      label: "CardUpdatr Visits",
      value: fmt(m.totalSessions),
      sub: pct(m.totalSessions, m.totalGaSelect) + " of launches",
    },
    {
      cls: "session",
      label: "Merchant Browsing (Visits)",
      value: fmt(m.totalCsSelect),
      sub: fmt(m.totalCsSelect) + " of " + fmt(m.totalSessions) + " visits",
    },
    {
      cls: "session",
      label: "User Data (Visits)",
      value: fmt(m.totalCsUser),
      sub: pct(m.totalCsUser, m.totalCsSelect) + " of visits @select",
    },
    {
      cls: "session",
      label: "Credential Entry (Visits)",
      value: fmt(m.totalCsCred),
      sub: pct(m.totalCsCred, m.totalCsSelect) + " of visits @select",
    },
    {
      cls: "highlight",
      label: "Successful Cardholders",
      value: fmt(m.sessionsWithSuccessfulJobs),
      sub: pct(m.sessionsWithSuccessfulJobs, m.totalSessions) + " of visits",
    },
    {
      cls: "highlight",
      label: "Success Rate",
      value: successRate,
      sub: "Successful cardholders ÷ Total visits",
    },
    {
      cls: "success",
      label: "Successful Placements",
      value: fmt(m.successful),
      sub: "Cards updated at merchants",
    },
  ];

  const metricsHtml = metricCards
    .map(
      (c) => `
    <div class="stat-card${c.cls ? " " + c.cls : ""}">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value">${c.value}</div>
      ${c.sub ? `<div class="stat-sub">${c.sub}</div>` : ""}
    </div>`
    )
    .join("");

  // ── Funnel Visualization ──
  let funnelHtml = "";
  if (ins.funnel && ins.funnel.length) {
    const stages = ins.funnel;
    const maxVal = Math.max(...stages.map(s => s.value || 0), 1);
    const stageCards = stages.map((stage, i) => {
      const widthPct = Math.max(30, Math.round((stage.value / maxVal) * 100));
      const dropPct = i > 0 && stages[i - 1].value > 0
        ? ((1 - stage.value / stages[i - 1].value) * 100)
        : null;
      let dropBadge = "";
      if (dropPct !== null) {
        const ratio = stages[i - 1].value > 0 ? stage.value / stages[i - 1].value : 0;
        if (ratio > 1.05) {
          // Expansion: downstream > upstream
          const expansionPct = ((ratio - 1) * 100).toFixed(0);
          dropBadge = `<span style="font-size:8px;font-weight:600;color:#2563eb;background:#dbeafe;padding:1px 5px;border-radius:3px;">+${expansionPct}% expansion</span>`;
        } else if (ratio >= 0.95) {
          dropBadge = `<span style="font-size:8px;font-weight:600;color:#64748b;background:#f1f5f9;padding:1px 5px;border-radius:3px;">~equal</span>`;
        } else {
          const dropColor = dropPct > 80 ? "#dc2626" : dropPct > 50 ? "#d97706" : "#16a34a";
          const dropBg = dropPct > 80 ? "#fee2e2" : dropPct > 50 ? "#fef3c7" : "#dcfce7";
          dropBadge = `<span style="font-size:8px;font-weight:600;color:${dropColor};background:${dropBg};padding:1px 5px;border-radius:3px;">${dropPct.toFixed(0)}% conversion opportunity</span>`;
        }
      }
      return `
      <div style="flex:1;text-align:center;">
        <div style="background:${stage.color};border:1px solid ${stage.borderColor};border-radius:6px;padding:10px 6px;">
          <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${stage.textColor};">${stage.label}</div>
          <div style="font-size:16px;font-weight:800;color:${stage.textColor};margin-top:2px;">${fmt(stage.value)}</div>
        </div>
        ${dropBadge ? `<div style="margin-top:3px;">${dropBadge}</div>` : ""}
      </div>`;
    });

    funnelHtml = `
    <div class="page-section">
    <div class="section-title">Cardholder Journey Funnel</div>
    <div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:8px;">
      ${stageCards.join('<div style="display:flex;align-items:center;padding:0 2px;color:#cbd5e1;font-size:14px;">→</div>')}
    </div>
    </div>`;
  }

  // ── Performance Insights (Narratives) ──
  let narrativesHtml = "";
  if (ins.narratives && ins.narratives.length) {
    const blocks = ins.narratives.map(n => {
      let benchmarkRef = "";
      if (n.benchmarks && n.benchmarks.length) {
        benchmarkRef = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;font-size:9px;color:#64748b;">` +
          n.benchmarks.map(b => `<strong>${b.value}</strong> — ${b.description}`).join("<br>") +
          `</div>`;
      }
      return `
      <div class="insight-block">
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;margin-bottom:3px;">${n.sectionLabel}</div>
        <div>${n.html}</div>
        ${benchmarkRef}
      </div>`;
    }).join("");

    narrativesHtml = `
    <div class="page-section">
    <div class="section-title">Performance Insights</div>
    ${blocks}
    </div>`;
  }

  // ── Motivation Spectrum ──
  let spectrumHtml = "";
  if (ins.spectrum) {
    const sp = ins.spectrum;
    const maxScale = 30;
    const zones = [
      { label: "Tier 3", min: 0, max: 3, color: "#ef4444" },
      { label: "", min: 3, max: 8, color: "#f97316" },
      { label: "Tier 2", min: 8, max: 12, color: "#eab308" },
      { label: "", min: 12, max: 21, color: "#84cc16" },
      { label: "Tier 1", min: 21, max: 30, color: "#22c55e" },
    ];
    const zoneHtml = zones.map(z => {
      const w = ((z.max - z.min) / maxScale) * 100;
      return `<div style="width:${w}%;height:32px;background:${z.color};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:rgba(255,255,255,0.9);">${z.label}</div>`;
    }).join("");

    const currentPos = Math.min((sp.currentRate || 0) / maxScale, 1) * 100;
    let markers = `<div style="position:absolute;left:${currentPos}%;top:-4px;width:2px;height:40px;background:#0f172a;border-radius:1px;"></div>
      <div style="position:absolute;left:${currentPos}%;top:36px;transform:translateX(-50%);font-size:8px;font-weight:700;color:#0f172a;white-space:nowrap;background:#fff;padding:0 3px;border:1px solid #e2e8f0;border-radius:3px;">Current: ${fmtDec(sp.currentRate)}%</div>`;

    if (sp.bestRate && sp.bestRate > (sp.currentRate || 0) * 1.1) {
      const bestPos = Math.min(sp.bestRate / maxScale, 1) * 100;
      markers += `<div style="position:absolute;left:${bestPos}%;top:-4px;width:2px;height:40px;background:#2563eb;border-radius:1px;"></div>
        <div style="position:absolute;left:${bestPos}%;top:36px;transform:translateX(-50%);font-size:8px;font-weight:700;color:#2563eb;white-space:nowrap;background:#fff;padding:0 3px;border:1px solid #93c5fd;border-radius:3px;">Best: ${fmtDec(sp.bestRate)}%</div>`;
    }

    spectrumHtml = `
    <div class="page-section">
    <div class="section-title">Cardholder Motivation Spectrum</div>
    <div style="position:relative;display:flex;border-radius:6px;overflow:visible;margin-bottom:28px;">
      ${zoneHtml}
      ${markers}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:8px;color:#94a3b8;margin-bottom:6px;">
      <span>0%</span><span>Incidental Discovery</span><span>Campaigns</span><span>Activation Flow</span><span>27%+</span>
    </div>
    ${sp.diagnosisHtml ? `<div style="font-size:11px;line-height:1.6;color:#334155;margin-bottom:4px;">${sp.diagnosisHtml}</div>` : ""}
    </div>`;
  }

  // ── Recommended Actions ──
  let actionsHtml = "";
  if (ins.actions && ins.actions.length) {
    const items = ins.actions.map((a, i) => {
      const bgColor = a.impact === "high" ? "#2563eb" : "#f59e0b";
      return `
      <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;">
        <div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:${bgColor};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">${i + 1}</div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#0f172a;">${a.headline}</div>
          <div style="font-size:10px;color:#64748b;line-height:1.5;">${a.detail}</div>
        </div>
      </div>`;
    }).join("");

    const libMeta = ins.libraryMeta || {};
    const versionNote = libMeta.version
      ? ` (Playbook v${libMeta.version})`
      : '';

    actionsHtml = `
    <div class="page-section">
    <div class="section-title">Recommended Actions</div>
    ${items}
    <div style="font-size:9px;color:#94a3b8;margin-top:8px;font-style:italic;">Implementation resources with ready-to-use messaging templates are available in the interactive dashboard.${versionNote}</div>
    </div>`;
  }

  // ── Growth Opportunity (Projections) ──
  let projectionHtml = "";
  if (ins.projection && ins.projection.scenarios && ins.projection.scenarios.length) {
    const proj = ins.projection;
    const rows = proj.scenarios.map(s => {
      const mult = s.multiplier && s.multiplier > 1
        ? `<span style="color:#16a34a;font-weight:700;">${fmtDec(s.multiplier)}×</span>`
        : "—";
      return `
      <tr style="color:#1e40af;">
        <td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${s.label}</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmtDec(s.rate)}%</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">~${fmt(s.projectedPlacements)}</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${mult}</td>
      </tr>`;
    }).join("");

    projectionHtml = `
    <div class="page-section">
    <div class="section-title">Growth Opportunity</div>
    <table class="report-table">
      <thead><tr>
        <th>Scenario</th>
        <th class="num">Success Rate</th>
        <th class="num">Projected Placements</th>
        <th class="num">vs Current</th>
      </tr></thead>
      <tbody>
        <tr style="font-weight:600;background:#f8fafc;">
          <td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">Current performance</td>
          <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${proj.current.successRate !== null ? fmtDec(proj.current.successRate) + "%" : "—"}</td>
          <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(proj.current.placements)}</td>
          <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">—</td>
        </tr>
        ${rows}
      </tbody>
    </table>
    <div style="font-size:8px;color:#94a3b8;font-style:italic;">Projections based on current volume of ${fmt(proj.current.sessions)} CardUpdatr visits over ${proj.current.days} days.</div>
    </div>`;
  }

  // ── Highlights table (no sources_missing) ──
  const validHighlights = (highlights || []).filter((h) => h && !h.empty);
  let highlightsHtml = "";
  if (validHighlights.length) {
    const rows = validHighlights
      .map((h) => {
        const dateRange =
          h.start === h.end ? h.start : `${h.start} &rarr; ${h.end}`;
        const selSuccessPct =
          typeof h.selSuccessRatio === "number"
            ? (h.selSuccessRatio * 100).toFixed(1) + "%"
            : h.sel && h.sess_with_success
            ? (((h.sess_with_success || 0) / h.sel) * 100).toFixed(1) + "%"
            : "—";
        const sessSuccessPct =
          typeof h.sessionSuccessRatio === "number"
            ? (h.sessionSuccessRatio * 100).toFixed(1) + "%"
            : "—";
        return `
      <tr>
        <td class="hl-label">${h.label || ""}</td>
        <td>${h.fi || ""}${h.instance ? " <span class='muted'>(" + h.instance + ")</span>" : ""}</td>
        <td>${h.integration || ""}</td>
        <td class="nowrap">${dateRange}</td>
        <td class="num">${fmt(h.sel)}</td>
        <td class="num">${fmt(h.sessions)}</td>
        <td class="num">${fmt(h.sess_with_success)}</td>
        <td class="num">${selSuccessPct}</td>
        <td class="num">${sessSuccessPct}</td>
        <td class="num">${fmt(h.placements)}</td>
      </tr>`;
      })
      .join("");

    highlightsHtml = `
    <div class="page-section">
    <div class="section-title">Performance Highlights <span class="section-sub">(Best 7-Day Windows)</span></div>
    <table class="report-table">
      <thead>
        <tr>
          <th>Highlight</th>
          <th>FI</th>
          <th>Integration</th>
          <th>Window</th>
          <th class="num">Launches</th>
          <th class="num">Visits</th>
          <th class="num">Successful Cardholders</th>
          <th class="num">Success Rate</th>
          <th class="num">Cardholder Success %</th>
          <th class="num">Placements</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
  }

  // ── Partner Integration Mix table ──
  let partnerHtml = "";
  if (partnerSummary && partnerSummary.rows && partnerSummary.rows.length) {
    const pRows = partnerSummary.rows
      .map(
        (r) => `
      <tr>
        <td>${r.integration || ""}</td>
        <td class="num">${r.fiCount || 0}</td>
        <td class="num">${fmt(r.ga_select)}</td>
        <td class="num">${r.selSuccessPct != null ? r.selSuccessPct.toFixed(1) + "%" : "—"}</td>
        <td class="num">${fmt(r.sessions)}</td>
        <td class="num">${fmt(r.sess_with_success)}</td>
        <td class="num">${r.sessionSuccessPct != null ? r.sessionSuccessPct.toFixed(1) + "%" : "—"}</td>
      </tr>`
      )
      .join("");

    const totals = partnerSummary.totals || {};
    const totalRow = `
      <tr class="total-row">
        <td><strong>Total</strong></td>
        <td class="num"><strong>${totals.fiCount || ""}</strong></td>
        <td class="num"><strong>${fmt(totals.ga_select)}</strong></td>
        <td class="num"><strong>${totals.selSuccessPct != null ? totals.selSuccessPct.toFixed(1) + "%" : ""}</strong></td>
        <td class="num"><strong>${fmt(totals.sessions)}</strong></td>
        <td class="num"><strong>${fmt(totals.sess_with_success)}</strong></td>
        <td class="num"><strong>${totals.sessionSuccessPct != null ? totals.sessionSuccessPct.toFixed(1) + "%" : ""}</strong></td>
      </tr>`;

    partnerHtml = `
    <div class="page-section">
    <div class="section-title">${partnerSummary.partner || "Partner"} Integration Mix
      <span class="section-sub">${partnerSummary.rows.length} integration types</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>Integration</th>
          <th class="num">FIs</th>
          <th class="num">Launches</th>
          <th class="num">Success Rate</th>
          <th class="num">Visits</th>
          <th class="num">Successful Cardholders</th>
          <th class="num">Cardholder Success %</th>
        </tr>
      </thead>
      <tbody>${pRows}${totalRow}</tbody>
    </table>
    </div>`;
  }

  // ── QBR Content (when quarters data exists) ──
  const qbr = ins.qbr || null;
  let qbrCoverHtml = "";
  let qbrExecSummaryHtml = "";
  let qbrTrendHtml = "";
  let qbrAdminHtml = "";

  if (qbr && qbr.quarters && qbr.quarters.length) {
    const quarters = qbr.quarters;
    const firstQ = quarters[0];
    const lastQ = quarters[quarters.length - 1];

    // Cover page
    qbrCoverHtml = `
    <div class="qbr-cover">
      <div class="qbr-cover-brand">Strivve CardUpdatr&trade;</div>
      <div class="qbr-cover-title">Quarterly Business Review</div>
      <div class="qbr-cover-subtitle">Cardholder Engagement Analysis</div>
      <div class="qbr-cover-range">${firstQ.quarter} &mdash; ${lastQ.quarter}</div>
      ${filterContext ? `<div class="qbr-cover-context">${filterContext}</div>` : ""}
      <div class="qbr-cover-date">Prepared ${generatedAt}</div>
      <div class="qbr-cover-footer">Prepared by Strivve CardUpdatr&trade; Platform</div>
    </div>`;

    // Executive summary
    const latestQ = quarters[quarters.length - 1];
    const prevQ = quarters.length > 1 ? quarters[quarters.length - 2] : null;
    const sessChange = prevQ && prevQ.metrics.totalSessions > 0
      ? ((latestQ.metrics.totalSessions - prevQ.metrics.totalSessions) / prevQ.metrics.totalSessions * 100).toFixed(1)
      : null;
    const srChange = prevQ
      ? (latestQ.metrics.sessionSuccessPct - prevQ.metrics.sessionSuccessPct).toFixed(1)
      : null;
    const placeChange = prevQ && prevQ.metrics.successfulPlacements > 0
      ? ((latestQ.metrics.successfulPlacements - prevQ.metrics.successfulPlacements) / prevQ.metrics.successfulPlacements * 100).toFixed(1)
      : null;

    const qbrNarrativeBlocks = (qbr.narratives || []).slice(0, 5).map(n => `
      <div class="insight-block">${n.html}</div>
    `).join("");

    const sparkSessions = qbr.sparklines?.sessions || "";
    const sparkSuccessRate = qbr.sparklines?.successRate || "";
    const sparkPlacements = qbr.sparklines?.placements || "";

    qbrExecSummaryHtml = `
    <div class="page-section" style="page-break-before:always;">
      <div class="section-title">Executive Summary</div>
      <div style="display:flex;gap:12px;margin-bottom:12px;">
        <div style="flex:1;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;">Latest Quarter Visits</div>
          <div style="font-size:20px;font-weight:800;color:#0f172a;">${fmt(latestQ.metrics.totalSessions)}</div>
          ${sessChange !== null ? `<div style="font-size:10px;color:${parseFloat(sessChange) >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">${parseFloat(sessChange) >= 0 ? '&#9650;' : '&#9660;'} ${Math.abs(parseFloat(sessChange))}% QoQ</div>` : ""}
          <div style="margin-top:6px;">${sparkSessions}</div>
        </div>
        <div style="flex:1;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;">Success Rate</div>
          <div style="font-size:20px;font-weight:800;color:#2563eb;">${fmtDec(latestQ.metrics.sessionSuccessPct)}%</div>
          ${srChange !== null ? `<div style="font-size:10px;color:${parseFloat(srChange) >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">${parseFloat(srChange) >= 0 ? '&#9650;' : '&#9660;'} ${Math.abs(parseFloat(srChange))}pp QoQ</div>` : ""}
          <div style="margin-top:6px;">${sparkSuccessRate}</div>
        </div>
        <div style="flex:1;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;">Successful Placements</div>
          <div style="font-size:20px;font-weight:800;color:#16a34a;">${fmt(latestQ.metrics.successfulPlacements)}</div>
          ${placeChange !== null ? `<div style="font-size:10px;color:${parseFloat(placeChange) >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">${parseFloat(placeChange) >= 0 ? '&#9650;' : '&#9660;'} ${Math.abs(parseFloat(placeChange))}% QoQ</div>` : ""}
          <div style="margin-top:6px;">${sparkPlacements}</div>
        </div>
      </div>
      ${latestQ.tierLabel ? `<div style="font-size:11px;color:#475569;margin-bottom:8px;">Current Performance Tier: <strong style="color:#0f172a;">${latestQ.tierLabel}</strong></div>` : ""}
      ${qbrNarrativeBlocks}
      ${qbr.summary ? `<div style="margin-top:10px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;line-height:1.6;color:#334155;">${qbr.summary}</div>` : ""}
    </div>`;

    // Trend table
    const metricRows = [
      { label: "Total Visits", key: "totalSessions", format: "num" },
      { label: "Successful Cardholders", key: "sessionsWithSuccess", format: "num" },
      { label: "Success Rate", key: "sessionSuccessPct", format: "pct" },
      { label: "Successful Placements", key: "successfulPlacements", format: "num" },
      { label: "GA Launches", key: "gaSelect", format: "num" },
      { label: "Monthly Reach %", key: "monthlyReachPct", format: "pct" },
      { label: "Avg Cards/Cardholder", key: "avgCardsPerSession", format: "dec" },
    ];

    const qHeaders = quarters.map(q => `<th class="num" style="min-width:80px;">${q.quarter}</th>`).join("");
    const trendRows = metricRows.map(mr => {
      const cells = quarters.map((q, qi) => {
        const val = q.metrics[mr.key];
        let display;
        if (mr.format === "pct") display = val !== null && val !== undefined ? fmtDec(val) + "%" : "—";
        else if (mr.format === "dec") display = fmtDec(val);
        else display = fmt(val);

        // QoQ change indicator
        let change = "";
        if (qi > 0) {
          const prev = quarters[qi - 1].metrics[mr.key];
          if (prev != null && val != null && prev !== 0) {
            const diff = mr.format === "pct" ? val - prev : ((val - prev) / prev) * 100;
            const arrow = diff > 0 ? "&#9650;" : diff < 0 ? "&#9660;" : "&#8596;";
            const color = diff > 0 ? "#16a34a" : diff < 0 ? "#dc2626" : "#94a3b8";
            change = ` <span style="font-size:8px;color:${color};">${arrow}</span>`;
          }
        }
        return `<td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${display}${change}</td>`;
      }).join("");
      return `<tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">${mr.label}</td>${cells}</tr>`;
    }).join("");

    qbrTrendHtml = `
    <div class="page-section" style="page-break-before:always;">
      <div class="section-title">Four-Quarter Trend Analysis</div>
      <table class="report-table">
        <thead><tr><th>Metric</th>${qHeaders}</tr></thead>
        <tbody>${trendRows}</tbody>
      </table>
      <div style="margin-top:12px;display:flex;gap:16px;">
        <div style="flex:1;text-align:center;">
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;margin-bottom:4px;">Visits Trend</div>
          ${sparkSessions}
        </div>
        <div style="flex:1;text-align:center;">
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;margin-bottom:4px;">Success Rate Trend</div>
          ${sparkSuccessRate}
        </div>
        <div style="flex:1;text-align:center;">
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;margin-bottom:4px;">Placements Trend</div>
          ${sparkPlacements}
        </div>
      </div>
    </div>`;

    // Admin appendix
    if (qbr.isAdmin && qbr.adminInsights) {
      const ai = qbr.adminInsights;
      const tpHtml = (ai.talkingPoints || []).map(tp => `
        <div style="margin-bottom:8px;padding:8px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;">
          <div style="font-size:10px;font-weight:700;color:#0f172a;">${tp.headline || tp.label || ""}</div>
          <div style="font-size:10px;color:#475569;line-height:1.5;">${tp.detail || tp.text || ""}</div>
        </div>
      `).join("");

      const objHtml = (ai.objections || []).map(obj => `
        <div style="margin-bottom:8px;padding:8px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;">
          <div style="font-size:10px;font-weight:700;color:#dc2626;">"${obj.objection || ""}"</div>
          <div style="font-size:10px;color:#0f172a;font-weight:600;margin-top:3px;">${obj.response || ""}</div>
          ${obj.detail ? `<div style="font-size:9px;color:#64748b;margin-top:2px;">${obj.detail}</div>` : ""}
        </div>
      `).join("");

      const benchHtml = (ai.benchmarkRefs || []).map(b => `
        <div style="margin-bottom:4px;font-size:10px;color:#334155;">
          <strong>${b.value || ""}</strong> — ${b.description || ""}
        </div>
      `).join("");

      qbrAdminHtml = `
      <div style="page-break-before:always;position:relative;">
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:72px;font-weight:800;color:rgba(239,68,68,0.06);white-space:nowrap;pointer-events:none;z-index:0;">INTERNAL ONLY</div>
        <div style="position:relative;z-index:1;">
          <div class="section-title" style="color:#dc2626;border-color:#dc2626;">
            <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:9px;margin-right:6px;">INTERNAL</span>
            Admin Appendix — Talking Points &amp; Objection Responses
          </div>
          ${tpHtml ? `<div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:700;color:#0f172a;margin-bottom:6px;">Talking Points</div>${tpHtml}</div>` : ""}
          ${objHtml ? `<div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:700;color:#0f172a;margin-bottom:6px;">Objection Responses</div>${objHtml}</div>` : ""}
          ${benchHtml ? `<div><div style="font-size:10px;font-weight:700;color:#0f172a;margin-bottom:6px;">Benchmark References</div>${benchHtml}</div>` : ""}
        </div>
      </div>`;
    }
  }

  // ── Full HTML document ──
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: #fff;
    color: #0f172a;
    font-size: 12px;
    line-height: 1.4;
  }

  /* ── Header ── */
  .report-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #fff;
    padding: 30px 44px 24px;
  }
  .report-header .brand {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #0ea5e9;
    margin-bottom: 2px;
  }
  .report-header h1 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.01em;
    margin-bottom: 2px;
  }
  .report-header .subtitle {
    color: #94a3b8;
    font-size: 13px;
    font-weight: 400;
  }
  .report-header .date-range {
    display: inline-block;
    margin-top: 12px;
    background: rgba(14, 165, 233, 0.12);
    border: 1px solid rgba(14, 165, 233, 0.3);
    border-radius: 20px;
    padding: 5px 16px;
    font-size: 13px;
    font-weight: 600;
    color: #38bdf8;
  }
  .report-header .filter-ctx {
    color: #64748b;
    font-size: 11px;
    margin-top: 6px;
  }

  /* ── Body ── */
  .report-body { padding: 20px 44px 12px; }

  /* ── Section titles ── */
  .section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #0f172a;
    border-bottom: 2px solid #0ea5e9;
    padding-bottom: 4px;
    margin: 22px 0 10px;
  }
  .section-title:first-child { margin-top: 0; }
  .section-sub {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: #64748b;
    font-size: 10px;
  }

  /* ── Key Metrics grid ── */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 4px;
  }
  .stat-card {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 6px;
    padding: 10px 10px 8px;
    text-align: center;
  }
  .stat-card.highlight {
    background: #eff6ff;
    border: 1px solid #93c5fd;
  }
  .stat-card.highlight .stat-value { color: #2563eb; }
  .stat-card.success {
    background: #f0fdf4;
    border: 1px solid #86efac;
  }
  .stat-card.success .stat-value { color: #16a34a; }
  .stat-card.ga {
    background: #f5f3ff;
    border: 1px solid #c4b5fd;
  }
  .stat-card.ga .stat-value { color: #7c3aed; }
  .stat-card.session {
    background: #fffbeb;
    border: 1px solid #fcd34d;
  }
  .stat-card.session .stat-value { color: #92400e; }
  .stat-label {
    font-size: 9px;
    font-weight: 600;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat-value {
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
    margin-top: 1px;
    line-height: 1.2;
  }
  .stat-sub {
    font-size: 9px;
    color: #64748b;
    margin-top: 1px;
  }

  /* ── Insight blocks ── */
  .insight-block {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 6px;
    font-size: 11px;
    line-height: 1.6;
    color: #334155;
  }
  .insight-block strong { color: #0f172a; }

  /* ── Tables ── */
  .report-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-bottom: 4px;
  }
  .report-table th {
    background: #f1f5f9;
    text-align: left;
    padding: 5px 7px;
    font-weight: 700;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 2px solid #e2e8f0;
    color: #334155;
  }
  .report-table td {
    padding: 5px 7px;
    border-bottom: 1px solid #e2e8f0;
  }
  .report-table tbody tr:nth-child(even) { background: #f8fafc; }
  .report-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .report-table .hl-label { font-weight: 600; font-size: 10px; }
  .report-table .total-row td { border-top: 2px solid #cbd5e1; background: #f1f5f9; }
  .nowrap { white-space: nowrap; }
  .muted { color: #94a3b8; font-size: 9px; }

  /* ── Page-break control ── */
  .page-section {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .section-title {
    page-break-after: avoid;
    break-after: avoid;
  }
  .report-table {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .stats-grid {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* ── Dashboard link ── */
  .dashboard-link {
    display: inline-block;
    margin-top: 10px;
    font-size: 11px;
    font-weight: 600;
    color: #0ea5e9;
    text-decoration: none;
    border: 1px solid rgba(14, 165, 233, 0.3);
    border-radius: 16px;
    padding: 4px 14px;
    transition: background 0.15s;
  }
  .dashboard-link:hover {
    background: rgba(14, 165, 233, 0.08);
  }

  /* ── QBR Cover Page ── */
  .qbr-cover {
    page-break-after: always;
    break-after: always;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%);
    color: #fff;
    text-align: center;
    padding: 60px 44px;
  }
  .qbr-cover-brand {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #0ea5e9;
    margin-bottom: 24px;
  }
  .qbr-cover-title {
    font-size: 36px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.15;
    margin-bottom: 8px;
  }
  .qbr-cover-subtitle {
    font-size: 16px;
    font-weight: 400;
    color: #94a3b8;
    margin-bottom: 28px;
  }
  .qbr-cover-range {
    display: inline-block;
    background: rgba(14, 165, 233, 0.12);
    border: 1px solid rgba(14, 165, 233, 0.3);
    border-radius: 20px;
    padding: 8px 24px;
    font-size: 15px;
    font-weight: 600;
    color: #38bdf8;
    margin-bottom: 16px;
  }
  .qbr-cover-context {
    font-size: 13px;
    color: #64748b;
    margin-bottom: 8px;
  }
  .qbr-cover-date {
    font-size: 12px;
    color: #475569;
    margin-bottom: 32px;
  }
  .qbr-cover-footer {
    font-size: 11px;
    color: #64748b;
    letter-spacing: 0.05em;
  }

  /* ── Footer ── */
  .report-footer {
    margin: 18px 44px 0;
    padding: 10px 0;
    border-top: 1px solid #e2e8f0;
    font-size: 9px;
    color: #94a3b8;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>

  ${qbrCoverHtml}

  <div class="report-header">
    <div class="brand">Strivve CardUpdatr&trade;</div>
    <h1>${qbr ? "Quarterly Business Review" : "Cardholder Engagement Report"}</h1>
    <div class="subtitle">Card-on-File Program Performance</div>
    <div class="date-range">${startDate} &rarr; ${endDate}</div>
    ${filterContext ? `<div class="filter-ctx">${filterContext}</div>` : ""}
    ${shareUrl ? `<a class="dashboard-link" href="${shareUrl}">View Live Dashboard &rarr;</a>` : ""}
  </div>

  <div class="report-body">
    <div class="page-section">
    <div class="section-title">Key Metrics</div>
    <div class="stats-grid">${metricsHtml}</div>
    </div>

    ${funnelHtml}

    ${narrativesHtml}

    ${spectrumHtml}

    ${actionsHtml}

    ${projectionHtml}

    ${highlightsHtml}

    ${partnerHtml}

    ${qbrExecSummaryHtml}

    ${qbrTrendHtml}

    ${qbrAdminHtml}
  </div>

  <div class="report-footer">
    <span>Generated ${generatedAt} &middot; Strivve CardUpdatr&trade; Platform</span>
    <span>${qbr && qbr.isAdmin ? "INTERNAL — CONFIDENTIAL" : "Confidential"}</span>
  </div>

</body>
</html>`;
}
