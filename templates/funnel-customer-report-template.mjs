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

// Compute number of calendar days between two YYYY-MM-DD strings, inclusive.
function dayDiffInclusive(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

// HTML-escape a query-param value (for href attributes).
function qp(v) {
  return encodeURIComponent(String(v || ""));
}

// Build a deep-link URL to the live dashboard at a specific anchor with the
// matching date range + FI key preserved. The dashboard's applyDeepLinkFromUrl()
// consumes ?date_from= / ?date_to= / ?fi= and scrolls to the hash.
function buildSectionLink(dashboardUrl, fiKey, anchor, from, to) {
  if (!dashboardUrl) return null;
  const parts = [];
  if (from) parts.push(`date_from=${qp(from)}`);
  if (to) parts.push(`date_to=${qp(to)}`);
  if (fiKey) parts.push(`fi=${qp(fiKey)}`);
  const qs = parts.length ? "?" + parts.join("&") : "";
  return `${dashboardUrl}${qs}#${anchor}`;
}

// Render a section heading that is a clickable deep-link but visually
// indistinguishable from the standard .section-title styling.
function renderLinkedSectionTitle(label, href, sub) {
  const subHtml = sub ? ` <span class="section-sub">${sub}</span>` : "";
  if (!href) return `<div class="section-title">${label}${subHtml}</div>`;
  return `<div class="section-title"><a class="section-title-link" href="${href}">${label}${subHtml}</a></div>`;
}

// Aggregate metric rendering for multi-granularity bucket tables.
function renderGranularityRows(buckets) {
  return buckets.map(b => {
    const visits = b.visits || 0;
    const cr = visits > 0 ? ((b.converted || 0) / visits * 100) : null;
    const crDisplay = cr !== null ? fmtDec(cr) + "%" : "—";
    const adoptDisplay = b.adoptionPct != null && Number.isFinite(b.adoptionPct)
      ? fmtDec(b.adoptionPct) + "%"
      : "—";
    return `
      <tr>
        <td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">${b.label || ""}</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(visits)}</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(b.started || 0)}</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(b.converted || 0)}</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(b.cardsUpdated || 0)}</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${crDisplay}</td>
        <td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${adoptDisplay}</td>
      </tr>`;
  }).join("");
}

function renderGranularitySection({ title, granularityKey, buckets, narrative, dashboardUrl, fiKey, from, to, breakBefore }) {
  if (!buckets || !buckets.length) return "";
  const href = buildSectionLink(dashboardUrl, fiKey, `pdf-${granularityKey}`, from, to);
  const tableBody = renderGranularityRows(buckets);
  const breakStyle = breakBefore ? "page-break-before:always;break-before:page;" : "";
  return `
    <div class="page-section granularity-section" style="${breakStyle}">
      ${renderLinkedSectionTitle(title, href)}
      ${narrative ? `<div class="granularity-narrative">${narrative}</div>` : ""}
      <table class="report-table">
        <thead><tr>
          <th>Period</th>
          <th class="num">Visits</th>
          <th class="num">Started updating</th>
          <th class="num">Cardholders who converted</th>
          <th class="num">Cards updated</th>
          <th class="num">Conversion rate</th>
          <th class="num">Adoption %</th>
        </tr></thead>
        <tbody>${tableBody}</tbody>
      </table>
    </div>`;
}

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
    granularities,
    dashboardUrl,
    fiKey,
  } = data;

  const DEFAULT_DASHBOARD_URL = "https://34-220-57-7.sslip.io/funnel-customer.html";
  const resolvedDashboardUrl = dashboardUrl || DEFAULT_DASHBOARD_URL;

  const m = metrics || {};
  const ins = insights || {};

  // ── Key Metrics cards (positive only) ──
  const successRate = m.totalSessions > 0
    ? ((m.sessionsWithSuccessfulJobs / m.totalSessions) * 100).toFixed(1) + "%"
    : "—";

  const metricCards = [
    {
      cls: "ga",
      label: "CardUpdatr Visits",
      value: fmt(m.totalGaSelect),
      sub: "Google Analytics",
    },
    {
      cls: "ga",
      label: "User Data Page Views",
      value: fmt(m.totalGaUser),
      sub: pct(m.totalGaUser, m.totalGaSelect) + " of visits",
    },
    {
      cls: "ga",
      label: "Started Updating (Views)",
      value: fmt(m.totalGaCred),
      sub: pct(m.totalGaCred, m.totalGaSelect) + " of visits",
    },
    {
      label: "CardUpdatr Visits",
      value: fmt(m.totalSessions),
      sub: pct(m.totalSessions, m.totalGaSelect) + " of visits",
    },
    {
      cls: "session",
      label: "Browsed Merchants",
      value: fmt(m.totalCsSelect),
      sub: fmt(m.totalCsSelect) + " of " + fmt(m.totalSessions) + " visits",
    },
    {
      cls: "session",
      label: "User Data (Visits)",
      value: fmt(m.totalCsUser),
      sub: pct(m.totalCsUser, m.totalCsSelect) + " of visits at Merchant Select",
    },
    {
      cls: "session",
      label: "Started Updating (Visits)",
      value: fmt(m.totalCsCred),
      sub: pct(m.totalCsCred, m.totalCsSelect) + " of visits at Merchant Select",
    },
    {
      cls: "highlight",
      label: "Cardholders Who Converted",
      value: fmt(m.sessionsWithSuccessfulJobs),
      sub: pct(m.sessionsWithSuccessfulJobs, m.totalSessions) + " of visits",
    },
    {
      cls: "highlight",
      label: "Conversion Rate",
      value: successRate,
      sub: "Cardholders who converted ÷ Total visits",
    },
    {
      cls: "success",
      label: "Cards Updated",
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
    <div class="section-title">Cardholder Journey</div>
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
      { label: "Organic only", min: 0, max: 3, color: "#ef4444" },
      { label: "", min: 3, max: 8, color: "#f97316" },
      { label: "Campaign-driven", min: 8, max: 12, color: "#eab308" },
      { label: "", min: 12, max: 21, color: "#84cc16" },
      { label: "Activation-embedded", min: 21, max: 30, color: "#22c55e" },
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
    <div class="section-title">Channel Mix Spectrum</div>
    <div style="position:relative;display:flex;border-radius:6px;overflow:visible;margin-bottom:28px;">
      ${zoneHtml}
      ${markers}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:8px;color:#94a3b8;margin-bottom:6px;">
      <span>0%</span><span>Organic only</span><span>Campaign-driven</span><span>Activation-embedded</span><span>27%+</span>
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
        <th class="num">Conversion rate</th>
        <th class="num">Projected Card Updates</th>
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

  // ── Card Replacement Reach Math ──
  let reachMathHtml = "";
  if (ins.reachMath && ins.reachMath.totalCardholders > 0) {
    const rm = ins.reachMath;
    const gapLine = rm.gap > 0
      ? `<div style="margin-top:8px;padding:6px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:9px;color:#1e40af;font-weight:600;">Opportunity: ${fmt(rm.gap)} additional high-intent cardholders/month could be reached through activation-embedded integration.</div>`
      : "";
    reachMathHtml = `
    <div class="page-section">
    <div class="section-title">Card Replacement Opportunity</div>

    <div style="display:flex;gap:12px;margin-bottom:10px;">
      <div style="flex:1;text-align:center;padding:10px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div style="font-size:16px;font-weight:800;color:#0f172a;">${fmt(rm.monthlyPool)}</div>
        <div style="font-size:8px;color:#64748b;">Cards replaced/month</div>
        <div style="font-size:7px;color:#94a3b8;">~2.5% of ${fmt(rm.totalCardholders)}</div>
      </div>
      <div style="flex:1;text-align:center;padding:10px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div style="font-size:16px;font-weight:800;color:#0f172a;">${fmt(rm.monthlyReach)}</div>
        <div style="font-size:8px;color:#64748b;">Currently visiting CU</div>
      </div>
      <div style="flex:1;text-align:center;padding:10px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div style="font-size:16px;font-weight:800;color:#0f172a;">${fmt(rm.potentialPlacements)}</div>
        <div style="font-size:8px;color:#64748b;">Potential card updates/mo</div>
        <div style="font-size:7px;color:#94a3b8;">At Activation-embedded (21%)</div>
      </div>
    </div>
    <div style="font-size:9px;line-height:1.5;color:#334155;">Every month, ~${fmt(rm.monthlyPool)} cardholders receive a replacement card at peak motivation. ${rm.gap > 0 ? `Currently reaching about ${rm.pctReached}% of this natural pool.` : "Your current reach is strong."}</div>
    ${gapLine}
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
        const srVal = typeof h.successRatio === "number"
            ? (h.successRatio * 100).toFixed(1) + "%"
            : typeof h.sessionSuccessRatio === "number"
            ? (h.sessionSuccessRatio * 100).toFixed(1) + "%"
            : "—";
        const srDisplay = h.isEstimated ? "~" + srVal : srVal;
        const srStyle = h.isEstimated ? ' style="font-style:italic"' : "";
        return `
      <tr>
        <td class="hl-label">${h.label || ""}</td>
        <td>${h.fi || ""}${h.instance ? " <span class='muted'>(" + h.instance + ")</span>" : ""}</td>
        <td>${h.integration || ""}</td>
        <td class="nowrap">${dateRange}</td>
        <td class="num">${fmt(h.sel)}</td>
        <td class="num">${fmt(h.sessions)}</td>
        <td class="num">${fmt(h.sess_with_success)}</td>
        <td class="num"${srStyle}>${srDisplay}</td>
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
          <th>Channel</th>
          <th>Window</th>
          <th class="num">Visits (GA)</th>
          <th class="num">Visits</th>
          <th class="num">Cardholders Who Converted</th>
          <th class="num">Conversion rate</th>
          <th class="num">Cards updated</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
  }

  // ── Partner Integration Mix table ──
  let partnerHtml = "";
  if (partnerSummary && partnerSummary.rows && partnerSummary.rows.length) {
    const fmtSr = (v, est) => {
      if (v == null || !Number.isFinite(v)) return "—";
      const s = v.toFixed(1) + "%";
      return est ? "~" + s : s;
    };
    const pRows = partnerSummary.rows
      .map(
        (r) => {
          const srStyle = r.isEstimated ? ' style="font-style:italic"' : "";
          return `
      <tr>
        <td>${r.integration || ""}</td>
        <td class="num">${r.fiCount || 0}</td>
        <td class="num">${fmt(r.ga_select)}</td>
        <td class="num">${fmt(r.sessions)}</td>
        <td class="num">${fmt(r.sess_with_success)}</td>
        <td class="num"${srStyle}>${fmtSr(r.successPct, r.isEstimated)}</td>
      </tr>`;
        }
      )
      .join("");

    const totals = partnerSummary.totals || {};
    const tSrStyle = totals.isEstimated ? ' style="font-style:italic"' : "";
    const totalRow = `
      <tr class="total-row">
        <td><strong>Total</strong></td>
        <td class="num"><strong>${totals.fiCount || ""}</strong></td>
        <td class="num"><strong>${fmt(totals.ga_select)}</strong></td>
        <td class="num"><strong>${fmt(totals.sessions)}</strong></td>
        <td class="num"><strong>${fmt(totals.sess_with_success)}</strong></td>
        <td class="num"${tSrStyle}><strong>${fmtSr(totals.successPct, totals.isEstimated)}</strong></td>
      </tr>`;

    partnerHtml = `
    <div class="page-section">
    <div class="section-title">${partnerSummary.partner || "Partner"} Channel Mix
      <span class="section-sub">${partnerSummary.rows.length} channels</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>Channel</th>
          <th class="num">FIs</th>
          <th class="num">Visits (GA)</th>
          <th class="num">Visits</th>
          <th class="num">Cardholders Who Converted</th>
          <th class="num">Conversion rate</th>
        </tr>
      </thead>
      <tbody>${pRows}${totalRow}</tbody>
    </table>
    </div>`;
  }

  // ── Multi-Granularity Sections (Summary / Quarterly / Monthly / Weekly / Daily) ──
  // Thresholds are enforced both on the client (which decides what to send) AND
  // here in the template as a safety net — so a manually-crafted payload
  // can't accidentally push a 10-year daily table into a PDF.
  let granularityHtml = "";
  if (granularities && typeof granularities === "object") {
    const rangeDays = dayDiffInclusive(startDate, endDate);
    const blocks = [];

    // Summary — always render when provided.
    if (granularities.summary) {
      const s = granularities.summary;
      const href = buildSectionLink(resolvedDashboardUrl, fiKey, "pdf-summary", startDate, endDate);
      const visits = s.visits || 0;
      const cr = visits > 0 ? (s.converted || 0) / visits * 100 : null;
      const crDisplay = cr !== null ? fmtDec(cr) + "%" : "—";
      const adoptDisplay = s.adoptionPct != null && Number.isFinite(s.adoptionPct)
        ? fmtDec(s.adoptionPct) + "%"
        : "—";
      const cardsPerMonthDisplay = s.cardsPerMonth != null && Number.isFinite(s.cardsPerMonth)
        ? fmtDec(s.cardsPerMonth)
        : "—";
      const reachingMonthlyDisplay = s.reachingMonthly != null && Number.isFinite(s.reachingMonthly)
        ? fmt(s.reachingMonthly)
        : "—";
      blocks.push(`
      <div class="page-section granularity-section" style="page-break-before:always;break-before:page;">
        ${renderLinkedSectionTitle("Summary", href, `${startDate} &rarr; ${endDate}`)}
        <div class="granularity-narrative">
          Across this window, <strong>${fmt(visits)}</strong> cardholder visits produced
          <strong>${fmt(s.converted || 0)}</strong> conversions and
          <strong>${fmt(s.cardsUpdated || 0)}</strong> card updates — a
          <strong>${crDisplay}</strong> conversion rate at
          <strong>${adoptDisplay}</strong> monthly adoption.
        </div>
        <table class="report-table">
          <tbody>
            <tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">Visits</td><td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(visits)}</td></tr>
            <tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">Started updating</td><td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(s.started || 0)}</td></tr>
            <tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">Cardholders who converted</td><td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(s.converted || 0)}</td></tr>
            <tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">Cards updated</td><td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${fmt(s.cardsUpdated || 0)}</td></tr>
            <tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">Conversion rate</td><td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${crDisplay}</td></tr>
            <tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">Adoption %</td><td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${adoptDisplay}</td></tr>
            <tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">Cardholders reached (monthly)</td><td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${reachingMonthlyDisplay}</td></tr>
            <tr><td style="padding:5px 7px;border-bottom:1px solid #e2e8f0;font-weight:600;">Avg card updates / month</td><td class="num" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;">${cardsPerMonthDisplay}</td></tr>
          </tbody>
        </table>
      </div>`);
    }

    // Quarterly: only when range is ≥180 days.
    if (rangeDays >= 180 && Array.isArray(granularities.quarterly) && granularities.quarterly.length) {
      blocks.push(renderGranularitySection({
        title: "Quarterly View",
        granularityKey: "quarterly",
        buckets: granularities.quarterly,
        narrative: "Calendar quarters with at least one day of activity. Use this to frame multi-quarter trend stories.",
        dashboardUrl: resolvedDashboardUrl,
        fiKey, from: startDate, to: endDate, breakBefore: true,
      }));
    }

    // Monthly: ≥90 days.
    if (rangeDays >= 90 && Array.isArray(granularities.monthly) && granularities.monthly.length) {
      blocks.push(renderGranularitySection({
        title: "Monthly View",
        granularityKey: "monthly",
        buckets: granularities.monthly,
        narrative: "Calendar months within the window. Best lens for campaign-level comparison and month-over-month pacing.",
        dashboardUrl: resolvedDashboardUrl,
        fiKey, from: startDate, to: endDate, breakBefore: true,
      }));
    }

    // Weekly: ≥28 days.
    if (rangeDays >= 28 && Array.isArray(granularities.weekly) && granularities.weekly.length) {
      blocks.push(renderGranularitySection({
        title: "Weekly View",
        granularityKey: "weekly",
        buckets: granularities.weekly,
        narrative: "Seven-day windows (Sunday &rarr; Saturday). Useful for spotting rhythm changes and campaign bursts.",
        dashboardUrl: resolvedDashboardUrl,
        fiKey, from: startDate, to: endDate, breakBefore: true,
      }));
    }

    // Daily: only when range is ≤90 days (too noisy beyond that).
    if (rangeDays <= 90 && Array.isArray(granularities.daily) && granularities.daily.length) {
      blocks.push(renderGranularitySection({
        title: "Daily View",
        granularityKey: "daily",
        buckets: granularities.daily,
        narrative: "Day-by-day activity. Use this for incident timelines, outage correlation, and day-of-week effects.",
        dashboardUrl: resolvedDashboardUrl,
        fiKey, from: startDate, to: endDate, breakBefore: true,
      }));
    }

    granularityHtml = blocks.join("");
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
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;">Conversion rate</div>
          <div style="font-size:20px;font-weight:800;color:#2563eb;">${fmtDec(latestQ.metrics.sessionSuccessPct)}%</div>
          ${srChange !== null ? `<div style="font-size:10px;color:${parseFloat(srChange) >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">${parseFloat(srChange) >= 0 ? '&#9650;' : '&#9660;'} ${Math.abs(parseFloat(srChange))}pp QoQ</div>` : ""}
          <div style="margin-top:6px;">${sparkSuccessRate}</div>
        </div>
        <div style="flex:1;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;">Cards Updated</div>
          <div style="font-size:20px;font-weight:800;color:#16a34a;">${fmt(latestQ.metrics.successfulPlacements)}</div>
          ${placeChange !== null ? `<div style="font-size:10px;color:${parseFloat(placeChange) >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">${parseFloat(placeChange) >= 0 ? '&#9650;' : '&#9660;'} ${Math.abs(parseFloat(placeChange))}% QoQ</div>` : ""}
          <div style="margin-top:6px;">${sparkPlacements}</div>
        </div>
      </div>
      ${latestQ.tierLabel ? `<div style="font-size:11px;color:#475569;margin-bottom:8px;">Current Channel Mix: <strong style="color:#0f172a;">${latestQ.tierLabel}</strong></div>` : ""}
      ${qbrNarrativeBlocks}
      ${qbr.summary ? `<div style="margin-top:10px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;line-height:1.6;color:#334155;">${qbr.summary}</div>` : ""}
    </div>`;

    // Trend table
    const metricRows = [
      { label: "Total visits", key: "totalSessions", format: "num" },
      { label: "Cardholders who converted", key: "sessionsWithSuccess", format: "num" },
      { label: "Conversion rate", key: "sessionSuccessPct", format: "pct" },
      { label: "Cards updated", key: "successfulPlacements", format: "num" },
      { label: "GA Visits", key: "gaSelect", format: "num" },
      { label: "Monthly adoption %", key: "monthlyReachPct", format: "pct" },
      { label: "Avg updates per cardholder", key: "avgCardsPerSession", format: "dec" },
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
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;margin-bottom:4px;">Conversion Rate Trend</div>
          ${sparkSuccessRate}
        </div>
        <div style="flex:1;text-align:center;">
          <div style="font-size:9px;font-weight:600;color:#475569;text-transform:uppercase;margin-bottom:4px;">Cards Updated Trend</div>
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

  /* ── Section-title deep-link (looks like a heading, is clickable in PDF) ── */
  .section-title-link {
    color: inherit;
    text-decoration: none;
    display: inline-block;
    width: 100%;
  }
  .section-title-link:hover { text-decoration: none; }

  /* ── Granularity narrative paragraph ── */
  .granularity-narrative {
    font-size: 11px;
    line-height: 1.55;
    color: #334155;
    margin: 0 0 8px;
    padding: 8px 12px;
    background: #f8fafc;
    border-left: 3px solid #0ea5e9;
    border-radius: 4px;
  }
  .granularity-narrative strong { color: #0f172a; }

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

    ${granularityHtml}

    ${funnelHtml}

    ${narrativesHtml}

    ${spectrumHtml}

    ${actionsHtml}

    ${projectionHtml}

    ${reachMathHtml}

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
