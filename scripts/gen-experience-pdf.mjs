import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const outDir = path.join(ROOT, "public", "exports");
await fs.mkdir(outDir, { recursive: true });

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 680px; margin: 0 auto; padding: 40px 32px; font-size: 13px; line-height: 1.7; }
  h1 { font-size: 22px; margin: 0 0 4px 0; color: #0f172a; }
  .subtitle { font-size: 13px; color: #64748b; margin-bottom: 28px; }
  h2 { font-size: 15px; margin: 24px 0 8px 0; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  p { margin: 6px 0; color: #334155; }
  ul { margin: 6px 0 6px 18px; padding: 0; }
  li { margin-bottom: 4px; color: #334155; }
  code { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 3px; padding: 1px 4px; font-size: 11.5px; color: #0f172a; }
  .flow { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; margin: 10px 0; font-family: 'SF Mono', Menlo, monospace; font-size: 11.5px; line-height: 1.9; white-space: pre-wrap; color: #0f172a; }
  .phase { display: flex; align-items: flex-start; gap: 8px; margin: 5px 0; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; margin-top: 3px; }
  .phase-text { flex: 1; }
  .phase-name { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0; }
  th { text-align: left; padding: 6px 10px; background: #f1f5f9; border: 1px solid #e2e8f0; font-weight: 600; font-size: 11px; color: #475569; }
  td { padding: 6px 10px; border: 1px solid #e2e8f0; color: #334155; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
  .logo { color: #2563eb; font-weight: 700; }
</style></head>
<body>

<h1>Cardholder Experience &mdash; Technical Reference</h1>
<p class="subtitle">How the timing data is sourced, computed, and displayed &bull; Strivve Insights Platform</p>

<h2>Data Flow</h2>
<div class="flow">SIS API  &rarr;  /troubleshoot/day endpoint  &rarr;  Raw sessions + placements
                                            &darr;
Each session contains:
  &bull; clickstream[] &mdash; array of { url, page_title, at (timestamp) }
  &bull; jobs[]        &mdash; array of mapped placements with timing fields</div>
<p>The <code>/troubleshoot/day</code> endpoint fetches raw session and placement data from the SIS API for a given date range, joins them by session ID, and returns the combined result. Placement data is mapped through <code>mapPlacementToJob()</code> which normalizes fields and computes derived values.</p>

<h2>Clickstream Phases (Page Timing)</h2>
<p>Time-on-page is computed as the gap between consecutive clickstream entries. Each CardUpdatr page is classified by URL pattern:</p>
<div style="margin:10px 0;">
  <div class="phase"><div class="swatch" style="background:#3b82f6"></div><div class="phase-text"><span class="phase-name">Select Merchants</span> &mdash; <code>/select-merchants</code> &mdash; Cardholder picks which merchants to update their card on.</div></div>
  <div class="phase"><div class="swatch" style="background:#8b5cf6"></div><div class="phase-text"><span class="phase-name">User Data Collection</span> &mdash; <code>/user-data-collection</code> &mdash; Cardholder enters personal information. Skipped entirely in SSO integrations.</div></div>
  <div class="phase"><div class="swatch" style="background:#ec4899"></div><div class="phase-text"><span class="phase-name">Credential Entry</span> &mdash; <code>/credential-entry</code> &mdash; Cardholder enters their login credentials for each selected merchant.</div></div>
</div>
<p><strong>Duration calculation:</strong> next page timestamp &minus; current page timestamp. Values are capped at 30 minutes; sessions left idle longer are excluded from timing analysis.</p>

<h2>Job Phases (Per-Merchant Timing)</h2>
<p>Each job (one merchant placement attempt) carries 4 timestamps from the SIS API. Three timing phases are derived from consecutive pairs:</p>
<div class="flow">job_created_on &rarr; job_ready_on &rarr; account_linked_on &rarr; completed_on
     &boxur;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&boxul;    &boxur;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&boxul;    &boxur;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&mdash;&boxul;
     Queue + Startup      Account Linking        Card Placement</div>

<div style="margin:10px 0;">
  <div class="phase"><div class="swatch" style="background:#f59e0b"></div><div class="phase-text"><span class="phase-name">Queue + Startup</span> (<code>job_created_on</code> &rarr; <code>job_ready_on</code>)<br/>Job is queued, a Virtual Browser Session (VBS) spins up, and the browser navigates to the merchant site. This phase is primarily infrastructure &mdash; no cardholder interaction. High variance due to queue depth and merchant site load times.</div></div>
  <div class="phase"><div class="swatch" style="background:#f97316"></div><div class="phase-text"><span class="phase-name">Account Linking</span> (<code>job_ready_on</code> &rarr; <code>account_linked_on</code>)<br/>The VBS enters the cardholder&rsquo;s credentials, processes the login flow (including any MFA/TFA challenges), and confirms account access. This is pure automation &mdash; no cardholder wait. Only populated for jobs where login succeeds.</div></div>
  <div class="phase"><div class="swatch" style="background:#22c55e"></div><div class="phase-text"><span class="phase-name">Card Placement</span> (<code>account_linked_on</code> &rarr; <code>completed_on</code>)<br/>The VBS navigates to payment settings and updates the card on file. Pure automation. Only populated when account linking succeeded.</div></div>
</div>

<h2>Null Handling</h2>
<ul>
  <li><code>account_linked_on</code> is <strong>null</strong> for failed jobs (login timeout, bad credentials, TFA failure, etc.). These jobs only contribute Queue + Startup timing.</li>
  <li>When <code>account_linked_on</code> is null but <code>completed_on</code> exists, the entire <code>ready_on</code> &rarr; <code>completed_on</code> span is displayed as a single Account Linking segment, since we cannot determine where login ended and placement began.</li>
  <li>Clickstream may be empty for sessions where the cardholder dropped off before reaching the merchant selection page.</li>
  <li>All phase durations are capped at 1 hour; values exceeding this are excluded as anomalies.</li>
</ul>

<h2>Observed Distributions</h2>
<p>Based on a 14-day sample (Feb 13&ndash;26, 2026) across all FIs and integrations:</p>
<table>
  <tr><th>Phase</th><th>Median</th><th>P25</th><th>P75</th><th>P90</th><th>Avg</th><th>Std Dev</th><th>CV</th><th>N</th></tr>
  <tr><td>Queue + Startup</td><td>17s</td><td>9s</td><td>36s</td><td>74s</td><td>32s</td><td>42s</td><td>133%</td><td>23,714</td></tr>
  <tr><td>Account Linking</td><td>54s</td><td>28s</td><td>93s</td><td>156s</td><td>73s</td><td>68s</td><td>92%</td><td>16,141</td></tr>
  <tr><td>Card Placement</td><td>46s</td><td>28s</td><td>66s</td><td>101s</td><td>55s</td><td>44s</td><td>79%</td><td>26,904</td></tr>
</table>
<p><strong>Note:</strong> Queue + Startup has the highest coefficient of variation (133%), consistent with variable queue depths and differing merchant site complexity. Account Linking variance (92%) reflects the wide range of merchant login flows (simple password vs. MFA vs. security questions).</p>

<h2>Filters &amp; Toggles</h2>
<ul>
  <li><strong>FI / Partner / Instance / Integration</strong> &mdash; Standard filter bar from the shared filter system. Multi-select FI filtering is applied client-side after the API fetch.</li>
  <li><strong>Session toggle</strong> &mdash; All / Successful (at least one <code>BILLABLE</code> job) / Failed (has jobs but none successful) / No Jobs (zero job attempts in the session).</li>
  <li><strong>Integration toggle</strong> &mdash; All / SSO (source integration contains &ldquo;sso&rdquo; or &ldquo;fi_&rdquo;) / Non-SSO (everything else).</li>
  <li>Toggling re-renders all sections from cached session data without re-fetching from the API.</li>
</ul>

<h2>CSV Export Format</h2>
<p>One row per job (or one row per session when the session has zero jobs). Columns:</p>
<div class="flow">session_id, fi_key, instance, integration, created_on,
session_duration_s,
page_select_merchants_s, page_user_data_s, page_credential_entry_s,
total_jobs, successful_jobs, failed_jobs,
merchant, job_status, termination,
job_queue_startup_s, job_account_linking_s, job_card_placement_s, job_total_s</div>
<p>The CSV respects the current session and integration toggle filters at the time of download.</p>

<h2>Key Implementation Details</h2>
<ul>
  <li><strong>Clickstream timestamp field:</strong> The server normalizes clickstream entries to <code>{ url, page_title, at }</code>. The client reads <code>entry.at || entry.timestamp || entry.time</code> for compatibility.</li>
  <li><strong>Page classification:</strong> URL substring matching &mdash; <code>/select-merchant</code>, <code>/user-data</code> or <code>/data-collection</code>, <code>/credential</code> or <code>/cred-entry</code>.</li>
  <li><strong>mapPlacementToJob():</strong> Server-side function in <code>serve-funnel.mjs</code> that maps raw SIS placement records to normalized job objects. The <code>account_linked_on</code> field was added to enable the 3-phase decomposition.</li>
  <li><strong>Session duration:</strong> Earliest timestamp (first clickstream event or first job created) to latest timestamp (last job completed or last clickstream event). Capped at 2 hours.</li>
</ul>

<div class="footer">
  <span class="logo">Strivve</span> Insights Platform &bull; Cardholder Experience Technical Reference &bull; Generated Feb 27, 2026
</div>

</body></html>`;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0" });
const outPath = path.join(outDir, "experience-technical-reference.pdf");
await page.pdf({
  path: outPath,
  format: "A4",
  margin: { top: "20mm", bottom: "20mm", left: "16mm", right: "16mm" },
  printBackground: true,
});
await browser.close();
console.log("PDF saved to", outPath);
