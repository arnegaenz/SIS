/**
 * Strivve-branded PDF report template for the Cardholder Engagement Dashboard.
 * Customer-facing: shows only positive metrics (no failure breakdowns).
 * Returns a self-contained HTML string ready for Puppeteer rendering.
 */

const fmt = (n) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "0";

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
  } = data;

  const m = metrics || {};

  // ── Key Metrics cards (positive only) ──
  const successRate = m.totalSessions > 0
    ? ((m.sessionsWithSuccessfulJobs / m.totalSessions) * 100).toFixed(1) + "%"
    : "—";

  const metricCards = [
    {
      label: "CardUpdatr Launches",
      value: fmt(m.totalGaSelect),
      sub: "Google Analytics",
    },
    {
      label: "User Data Page Views",
      value: fmt(m.totalGaUser),
      sub: pct(m.totalGaUser, m.totalGaSelect) + " of launches",
    },
    {
      label: "Credential Entry Views",
      value: fmt(m.totalGaCred),
      sub: pct(m.totalGaCred, m.totalGaSelect) + " of launches",
    },
    {
      label: "Total Sessions",
      value: fmt(m.totalSessions),
      sub: pct(m.totalSessions, m.totalGaSelect) + " of launches",
    },
    {
      cls: "session",
      label: "Select Merchants (Sessions)",
      value: fmt(m.totalCsSelect),
      sub: fmt(m.totalCsSelect) + " of " + fmt(m.totalSessions) + " sessions",
    },
    {
      cls: "session",
      label: "User Data (Sessions)",
      value: fmt(m.totalCsUser),
      sub: pct(m.totalCsUser, m.totalCsSelect) + " of sessions @select",
    },
    {
      cls: "session",
      label: "Credential Entry (Sessions)",
      value: fmt(m.totalCsCred),
      sub: pct(m.totalCsCred, m.totalCsSelect) + " of sessions @select",
    },
    {
      cls: "highlight",
      label: "Sessions w/ Successful Placements",
      value: fmt(m.sessionsWithSuccessfulJobs),
      sub: pct(m.sessionsWithSuccessfulJobs, m.totalSessions) + " of sessions",
    },
    {
      cls: "highlight",
      label: "Success Rate",
      value: successRate,
      sub: "Sessions w/ success ÷ Total sessions",
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
    <div class="section-title">Performance Highlights <span class="section-sub">(Best 7-Day Windows)</span></div>
    <table class="report-table">
      <thead>
        <tr>
          <th>Highlight</th>
          <th>FI</th>
          <th>Integration</th>
          <th>Window</th>
          <th class="num">Launches</th>
          <th class="num">Sessions</th>
          <th class="num">Successful Sessions</th>
          <th class="num">Launch&rarr;Success %</th>
          <th class="num">Session Success %</th>
          <th class="num">Placements</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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
    <div class="section-title">${partnerSummary.partner || "Partner"} Integration Mix
      <span class="section-sub">${partnerSummary.rows.length} integration types</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>Integration</th>
          <th class="num">FIs</th>
          <th class="num">Launches</th>
          <th class="num">Launch&rarr;Success %</th>
          <th class="num">Sessions</th>
          <th class="num">Successful Sessions</th>
          <th class="num">Session Success %</th>
        </tr>
      </thead>
      <tbody>${pRows}${totalRow}</tbody>
    </table>`;
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

  <div class="report-header">
    <div class="brand">Strivve Insights Service</div>
    <h1>Cardholder Engagement Report</h1>
    <div class="subtitle">Card-on-File Program Performance</div>
    <div class="date-range">${startDate} &rarr; ${endDate}</div>
    ${filterContext ? `<div class="filter-ctx">${filterContext}</div>` : ""}
    ${shareUrl ? `<a class="dashboard-link" href="${shareUrl}">View Live Dashboard &rarr;</a>` : ""}
  </div>

  <div class="report-body">
    <div class="section-title">Key Metrics</div>
    <div class="stats-grid">${metricsHtml}</div>

    ${highlightsHtml}

    ${partnerHtml}
  </div>

  <div class="report-footer">
    <span>Generated ${generatedAt} &middot; Data: Strivve Insights Service</span>
    <span>Confidential</span>
  </div>

</body>
</html>`;
}
