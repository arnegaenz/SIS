// Supported Sites Status Report — PDF template
// Rendered server-side via Puppeteer

/**
 * @param {{ active: Array, limited: Array, maintenance: Array, generated: string }} data
 * @returns {string} Self-contained HTML for Puppeteer PDF rendering
 */
export function buildSupportedSitesReportHtml(data) {
  const { active, limited, maintenance, generated } = data;

  const activeCount = active.length;
  const limitedCount = limited.length;
  const maintenanceCount = maintenance.length;

  function tierLabel(tier) {
    if (tier === 1) return "Tier 1";
    if (tier === 2) return "Tier 2";
    if (tier === 3) return "Tier 3";
    return "—";
  }

  function buildTableRows(sites) {
    // Group by tier
    const tiers = [1, 2, 3];
    let html = "";
    for (const t of tiers) {
      const group = sites.filter((s) => s.tier === t);
      if (!group.length) continue;
      // Sort alphabetically within tier
      group.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      html += `<tr class="tier-divider"><td colspan="3">Tier ${t}</td></tr>`;
      for (const site of group) {
        const rowClass = t === 1 ? ' class="tier1-row"' : "";
        html += `<tr${rowClass}>
          <td class="site-name">${site.name || "—"}</td>
          <td class="site-host">${site.host || "—"}</td>
          <td class="site-tier">${tierLabel(site.tier)}</td>
        </tr>`;
      }
    }
    // Sites with null/undefined/other tier
    const other = sites.filter((s) => ![1, 2, 3].includes(s.tier));
    if (other.length) {
      other.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      html += `<tr class="tier-divider"><td colspan="3">Other</td></tr>`;
      for (const site of other) {
        html += `<tr>
          <td class="site-name">${site.name || "—"}</td>
          <td class="site-host">${site.host || "—"}</td>
          <td class="site-tier">${tierLabel(site.tier)}</td>
        </tr>`;
      }
    }
    return html;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {
    size: Letter;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    font-size: 13px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ---- Header (matches Cardholder Engagement report) ---- */
  .report-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #fff;
    padding: 30px 44px 24px;
  }
  .report-header .brand {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #0ea5e9;
    margin-bottom: 2px;
  }
  .report-header h1 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.01em;
    margin-bottom: 2px;
  }
  .report-header .subtitle {
    color: #94a3b8;
    font-size: 15px;
    font-weight: 400;
    margin-bottom: 12px;
  }
  .report-header .intro {
    font-size: 13px;
    line-height: 1.6;
    color: #94a3b8;
    max-width: 640px;
  }

  /* ---- Summary Bar ---- */
  .summary-bar {
    display: flex;
    gap: 0;
    margin: 0 44px;
    transform: translateY(-18px);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.10);
  }
  .summary-item {
    flex: 1;
    padding: 14px 20px;
    text-align: center;
    color: #fff;
    font-weight: 600;
  }
  .summary-item .count {
    font-size: 28px;
    font-weight: 700;
    display: block;
    line-height: 1.2;
  }
  .summary-item .label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.9;
  }
  .summary-active { background: #16a34a; }
  .summary-limited { background: #d97706; }
  .summary-maintenance { background: #64748b; }

  /* ---- Content ---- */
  .content {
    padding: 12px 44px 40px;
  }

  /* ---- Narrative ---- */
  .narrative {
    margin-bottom: 20px;
    page-break-inside: avoid;
  }
  .narrative h2 {
    font-size: 18px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 3px;
  }
  .narrative .subtitle {
    font-size: 13px;
    color: #64748b;
    margin-bottom: 12px;
  }
  .narrative h3 {
    font-size: 14px;
    font-weight: 700;
    color: #1e293b;
    margin: 12px 0 5px;
  }
  .narrative p {
    font-size: 12.5px;
    line-height: 1.6;
    color: #334155;
    margin-bottom: 5px;
  }
  .eco-grid {
    display: flex;
    gap: 10px;
    margin: 6px 0 8px;
  }
  .eco-grid-item {
    flex: 1;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 10px;
  }
  .eco-grid-item h4 {
    font-size: 12.5px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 3px;
  }
  .eco-grid-item p {
    font-size: 11.5px;
    color: #475569;
    margin: 0;
    line-height: 1.5;
  }
  .priority-list {
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .priority-list li {
    font-size: 12px;
    line-height: 1.55;
    color: #334155;
    padding: 4px 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .priority-list li:last-child { border-bottom: none; }
  .priority-list strong { color: #0ea5e9; }
  .rollout-box {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 6px;
    padding: 10px 12px;
    margin-top: 8px;
  }
  .rollout-box h3 {
    margin-top: 0;
    font-size: 14px;
    color: #0c4a6e;
  }
  .rollout-box p {
    font-size: 12px;
    line-height: 1.55;
    color: #0c4a6e;
  }

  /* ---- Sections ---- */
  .section {
    margin-bottom: 24px;
    page-break-inside: avoid;
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 6px;
    margin-bottom: 6px;
    font-size: 15px;
    font-weight: 700;
    color: #fff;
  }
  .section-header.active { background: #16a34a; }
  .section-header.limited { background: #d97706; }
  .section-header.maintenance { background: #64748b; }
  .section-header .icon { font-size: 16px; }

  .section-note {
    font-size: 12px;
    color: #64748b;
    font-style: italic;
    margin-bottom: 6px;
    padding-left: 2px;
  }

  /* ---- Tables ---- */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  thead th {
    text-align: left;
    padding: 7px 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
    border-bottom: 2px solid #e2e8f0;
    font-weight: 600;
  }
  tbody td {
    padding: 6px 10px;
    border-bottom: 1px solid #f1f5f9;
  }
  .tier-divider td {
    padding: 7px 10px 5px;
    font-size: 11px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #cbd5e1;
    background: #f8fafc;
  }
  .tier1-row .site-name {
    font-weight: 600;
  }
  .site-host {
    color: #64748b;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 11.5px;
  }
  .site-tier {
    color: #64748b;
    font-size: 12px;
    text-align: center;
  }
  thead th:last-child {
    text-align: center;
  }

  /* ---- Footer ---- */
  .report-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 10px 44px;
    font-size: 10px;
    color: #94a3b8;
    text-align: center;
    border-top: 1px solid #e2e8f0;
  }
</style>
</head>
<body>

  <!-- Header -->
  <div class="report-header">
    <div class="brand">Strivve CardUpdatr&trade;</div>
    <h1>Supported Sites Status Report</h1>
    <div class="subtitle">Generated ${generated}</div>
  </div>

  <!-- Summary Bar -->
  <div class="summary-bar">
    <div class="summary-item summary-active">
      <span class="count">${activeCount}</span>
      <span class="label">Active</span>
    </div>
    <div class="summary-item summary-limited">
      <span class="count">${limitedCount}</span>
      <span class="label">Limited Availability</span>
    </div>
    <div class="summary-item summary-maintenance">
      <span class="count">${maintenanceCount}</span>
      <span class="label">In Maintenance</span>
    </div>
  </div>

  <div class="content">

    <!-- Living Ecosystem Narrative -->
    <div class="narrative">
      <h2>Strivve Supported Sites: A Living Ecosystem</h2>
      <p class="subtitle">How Strivve monitors, tests, and prioritizes our broad portfolio of merchant sites to deliver reliable card placement.</p>

      <h3>The Big Idea</h3>
      <p>Every merchant site Strivve supports is a living, dynamic entity. Sites can and do go up and down at any time due to merchant-side changes &mdash; UI redesigns, security updates, fraud detection changes, rate limiting, and platform migrations. This is normal. What matters is how quickly we detect it, how we respond, and how we prioritize.</p>
      <p>Strivve is always aware of site status changes. We prioritize resolution starting with our highest-impact sites, informed by customer feedback, cross-customer popularity, and payments industry research.</p>

      <h3>How We Stay on Top of It</h3>
      <div class="eco-grid">
        <div class="eco-grid-item">
          <h4>Bi-Weekly Automated Testing</h4>
          <p>Supported sites are tested on a rigorous bi-weekly cycle to verify end-to-end card placement for CardUpdatr and CardSavr.</p>
        </div>
        <div class="eco-grid-item">
          <h4>Production Telemetry</h4>
          <p>Every cardholder interaction is instrumented. Real production usage gives us more coverage than any manual testing could.</p>
        </div>
        <div class="eco-grid-item">
          <h4>Watchlist Protocol</h4>
          <p>Any site failure triggers immediate daily monitoring for a week. We decide to temporarily pull or keep a site based on real data.</p>
        </div>
      </div>

      <h3>How We Prioritize</h3>
      <ul class="priority-list">
        <li><strong>Customer Feedback</strong> &mdash; Your reports directly influence what gets fixed first. We want to hear from you.</li>
        <li><strong>Cross-Customer Popularity</strong> &mdash; The most-used sites across all Strivve partners are prioritized first.</li>
        <li><strong>Payments Research</strong> &mdash; We proactively track industry trends to add and prioritize emerging merchant sites.</li>
        <li><strong>Campaign Support</strong> &mdash; Planning a promotion featuring specific sites? Let us know at helpdesk@strivve.com and we&rsquo;ll put extra eyes on those sites throughout your campaign.</li>
      </ul>

      <div class="rollout-box">
        <h3>What This Means for You</h3>
        <p>If you see a site listed as &ldquo;Limited&rdquo; or &ldquo;In Maintenance,&rdquo; Strivve is already aware and actively working on it. A temporarily unavailable site is not an abandoned site &mdash; our team works every day to correct, improve, and restore sites. The same site may be fully operational tomorrow, and a different site may rotate out briefly next week. That is the nature of a living ecosystem.</p>
        <p>Your cardholders still see the full list of available merchants and can update any active site in the meantime. Site availability fluctuations do not affect the overall CardUpdatr experience. Questions? Contact us at helpdesk@strivve.com</p>
      </div>
    </div>

    <!-- Section 1: Active -->
    <div class="section">
      <div class="section-header active">
        <span class="icon">&#x2713;</span> Active Sites
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:42%">Site Name</th>
            <th style="width:40%">Host</th>
            <th style="width:18%">Tier</th>
          </tr>
        </thead>
        <tbody>
          ${buildTableRows(active)}
        </tbody>
      </table>
    </div>

    <!-- Section 2: Limited Availability -->
    <div class="section">
      <div class="section-header limited">
        <span class="icon">&#x26A0;</span> Limited Availability
      </div>
      <div class="section-note">These sites are operational with intermittent reliability. Strivve is actively monitoring.</div>
      <table>
        <thead>
          <tr>
            <th style="width:42%">Site Name</th>
            <th style="width:40%">Host</th>
            <th style="width:18%">Tier</th>
          </tr>
        </thead>
        <tbody>
          ${buildTableRows(limited)}
        </tbody>
      </table>
    </div>

    <!-- Section 3: In Maintenance -->
    <div class="section">
      <div class="section-header maintenance">
        <span class="icon">&#x1F527;</span> Currently in Maintenance
      </div>
      <div class="section-note">High-priority sites currently undergoing maintenance or restoration. Tier 3 maintenance sites are omitted for brevity.</div>
      <table>
        <thead>
          <tr>
            <th style="width:42%">Site Name</th>
            <th style="width:40%">Host</th>
            <th style="width:18%">Tier</th>
          </tr>
        </thead>
        <tbody>
          ${buildTableRows(maintenance)}
        </tbody>
      </table>
    </div>

  </div>

  <!-- Footer -->
  <div class="report-footer">
    Strivve, Inc. &copy;2026 Proprietary and Confidential. All Rights Reserved.
  </div>

</body>
</html>`;
}
