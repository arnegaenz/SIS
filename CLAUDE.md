# SIS / CardUpdatr Dashboard — Project Context

## Deployment Info
- **SSH Key**: `~/.ssh/LightsailDefaultKey-us-west-2.pem`
- **Server**: `ubuntu@34.220.57.7`
- **Path**: `/home/ubuntu/strivve-metrics/`
- **PM2 Process**: `sis-api` (NOT sis-metrics)
- **Deploy command**: `scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem <local-file> ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/<path> && ssh -i ~/.ssh/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 "pm2 restart sis-api"`

## End-of-Session Protocol ("lock it down")
When the user says "lock it down", "end the session", or similar — run this checklist before signing off:
1. **Commit all changes**: `git status`, stage relevant files, commit with a clear message summarizing the session's work
2. **Verify deployment**: Confirm all changed files that were deployed during the session are committed locally (no drift between server and repo)
3. **Update build history**: Add a dated entry to the `# Build History` section of this file documenting what was built/changed
4. **Testing checklist review**: Run through the Pre-Deployment Testing Checklist below for any deployed changes, and discuss whether new checks should be added
5. **Update MEMORY.md**: If any new patterns, gotchas, or conventions were discovered during the session, record them

## Pre-Deployment Testing Checklist
**Run through these checks before deploying any changes. This is a living checklist — review and update after each working session.**

### Share Link Verification
After any change to filters, data fetching, share link generation, or view-mode rendering:
1. **Filter preservation**: Generate a share link with specific filters (partner, instance, FI, integration type, date range). Open the link in a new incognito/private window. Verify all filters are reflected in the URL params and applied on load.
2. **FI data isolation**: With a single FI or partner selected, generate a share link. Open it and confirm ONLY that FI/partner's data appears — no cross-FI or cross-partner leakage in tables, charts, or insights.
3. **View-mode lockdown**: Shared links should be read-only. Confirm filter controls are hidden/disabled, no edit capabilities exposed, and the expiration notice displays correctly.
4. **Page coverage**: If the change touches shared infrastructure (filters.js, passcode-gate.js, serve-funnel.mjs), test share links on ALL pages that support them: `funnel-customer.html`, `funnel.html`, `supported-sites.html`.

### Session Checklist Review
At the end of each working session, briefly discuss:
- Did today's changes introduce any new testable surfaces?
- Should any new checks be added to this list?

## Key Files
- `scripts/serve-funnel.mjs` - Main server (very large, ~6100+ lines)
- `public/assets/js/passcode-gate.js` - Auth, session, activity logging
- `public/assets/js/engagement-insights.js` - Insights engine (narratives, spectrum, actions, projections)
- `public/assets/js/action-library.js` - ACTION_LIBRARY data + lookup helpers (loaded before engagement-insights.js)
- `public/assets/js/filters.js` - Filter bar, multi-select dropdowns, scope logic
- `public/assets/js/nav.js` - Navigation with access control
- `public/funnel.html` - Internal FI Funnel page (HTML + CSS + JS, very large ~6900 lines)
- `public/funnel-customer.html` - Customer-facing Cardholder Engagement Dashboard (~5100 lines)
- `public/resources/engagement-playbook.html` - Full engagement playbook page (auto-generated from ACTION_LIBRARY)
- `public/dashboards/portfolio.html` - CS Portfolio Dashboard (Phase 3 — engagement scores, tiers, warnings)
- `public/assets/js/portfolio-dashboard.js` - Portfolio dashboard module (ES6, ~750 lines)
- `templates/funnel-report-template.mjs` - Internal PDF template
- `templates/funnel-customer-report-template.mjs` - Customer PDF template
- `src/config/terminationMap.mjs` - Termination type definitions with labels
- `public/login.html` - Magic link login page
- `secrets/users.json` - User data with access levels, login stats
- `fi_registry.json` - FI registry (fi_lookup_key, instance, partner, integration_type)
- `public/campaign-builder.html` - Campaign URL Builder page (form → tracked CardUpdatr launch URL + QR code)
- `public/assets/js/campaign-builder.js` - Campaign builder module (IIFE, ~400 lines)
- `public/assets/js/qrcode.min.js` - QR code generator library (qrcode-generator by Kazuhiko Arase, MIT)
- `assets/images/StrivveLogo.png` - Strivve logo (used in playbook page + PDF, base64-embedded)
- `public/dashboards/executive.html` - Executive Summary dashboard (verdict, KPIs, 12-week trend, warnings, distributions, kiosk mode)
- `public/assets/js/executive-dashboard.js` - Executive dashboard module (ES6, ~350 lines)
- `public/assets/js/synthetic-traffic.js` - Synthetic traffic job management + correlated sessions modal
- `public/supported-sites.html` - Supported Sites page (Living Ecosystem narrative + merchant sites table, ~1200 lines)
- `templates/supported-sites-report-template.mjs` - Supported Sites PDF template (Puppeteer-rendered)

## Critical Lessons (Hard-Won)
- **Do NOT expose window.applyFilters** — causes race condition that breaks ALL users
- **NEVER use top-level `return` in inline `<script>` blocks** — Safari throws `SyntaxError: Return statements are only valid inside functions` at parse time, killing the ENTIRE script. Use IIFE wrapper or flag pattern instead. Chrome/Firefox tolerate it, Safari does not.
- **FI keys not unique across instances** — always filter by partner/instance composite
- **`calculateConversionMetrics()` sums from visibleRows** — can't be used for date-subsetting
- **`assignMeta()` whitelists fields** — new registry fields must be added there
- **Customer page `getCardholderMap()` returns `{}`** — cardholders come from registry `total` field fallback
- **Never trust client-side expiration** — share link `expires` query params can be stripped/edited. Use server-side validation via `GET /api/share-validate?sid=xxx` (checks share log creation time + admin TTL)

## Access Control System
- **Admin pages**: users.html, synthetic-traffic.html, maintenance.html, activity-log.html, shared-views.html, logs.html
- **Executive user pages**: funnel-customer.html, executive.html, supported-sites.html (redirects elsewhere → executive dashboard)
- **Executive user redirect**: → dashboards/executive.html
- **Executive user nav**: "Dashboards" group with Executive Summary + Cardholder Engagement
- **Limited user pages**: funnel.html, funnel-customer.html, campaign-builder.html, supported-sites.html
- **Limited user redirect**: → funnel-customer.html (NOT funnel.html)
- **Limited user nav**: "Dashboards" group with Cardholder Engagement + Campaign URL Builder
- **Limited user filters**: Partner + FI visible; Instance + Integration hidden
- Access levels: admin, full (legacy=admin), internal (all except admin pages), executive, limited
- **View-as switcher**: Admin/full users can preview other roles. Uses `sisAuth.getRealAccessLevel()` to check true level (not overridden). Switching navigates to role's default page.
- **Homepage (index.html)**: Thin redirect stub — admin/internal→portfolio, limited→funnel-customer, executive→executive dashboard

## Architecture Patterns
- IIFE wrapper on engine module (avoids global variable collision)
- Insights computed client-side, sent as `insightsPayload` to server for PDF
- Admin detection: `window.sisAuth.getAccessLevel()` — admin/full/internal
- Admin visibility: `body.show-admin-overlay .admin-overlay` CSS pattern
- QBR mode: `body.qbr-mode .qbr-section` CSS pattern
- Filter hints: `applyInsightFilter()` + `window.__FILTER_SET()`
- `page-section` CSS class with `page-break-inside: avoid` for PDF layout
- Customer page uses `window.__FILTER_STATE` with pageId `"funnel-customer"`
- `getVisibleRows()` checks `shared.page === "funnel-customer"` (not `"funnel"`)

## Related Repos
- **arg-fcu**: Contains traffic runner at `tools/traffic-runner/`, hosted on GitHub Pages (arg-fcu.com)
  - **Traffic runner deployment**: `scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem <files> ubuntu@34.220.57.7:/home/ubuntu/traffic-runner/` then `pm2 restart traffic-runner`
  - **PM2 process**: `traffic-runner` (runs `runner-loop.mjs`, polls every 30s, spawns fresh `run-sis-jobs.js` each cycle)
  - **Logs**: `pm2 logs traffic-runner --lines N`
  - **Error screenshots**: `/home/ubuntu/traffic-runner/run-*-error.png` (on exception), `timeout-debug.png` (on timeout, captured before overlay close)
  - **arg-fcu.com pages**: Deploy via `git push` to main (GitHub Pages)

## Known Issues
- `[analytics] log error: ReferenceError: readBody is not defined` - seen in logs, separate bug
- FI lookup keys not unique across instances — always filter by partner/instance composite

---

# The Product

**CardUpdatr** is Strivve's product that lets cardholders update their payment card across multiple merchants (Netflix, Amazon, etc.) in one session. It's sold to financial institutions (credit unions, banks) through integration partners (Alkami, etc.). The **Customer Engagement Dashboard** (`public/funnel-customer.html`) is the partner-facing analytics page showing how cardholders are using CardUpdatr at each FI.

---

# Key Strategic Frameworks

## Motivation Spectrum (Validated with Data)
The core thesis: CardUpdatr's conversion rate is determined by cardholder motivation at the moment of encounter, not product quality or technology.

- **Tier 1 — Activation (21-27%)**: Cardholder just got a new card. Urgent need. 1 in 4 completes.
- **Tier 2 — Campaigns (8-12%)**: Cardholder prompted via SMS/email. Manufactured motivation. 1 in 10 acts.
- **Tier 3 — Incidental (<3%)**: Cardholder browsing online banking. No prompt, no urgency. Curiosity only.
- **7.7x conversion gap** between motivated and incidental traffic (validated across multiple FIs)

### Tier Classification
`classifyTier()` uses **Session Success Rate**, NOT Monthly Reach %.
- >=21% → Tier 1 (Card Activation Flow)
- >=12% → Tier 1.5 (Campaign → Activation transition)
- >=8% → Tier 2 (SMS & Targeted Campaigns)
- >=3% → Tier 2.5 (Discovery → Campaign transition)
- <3% → Tier 3 (Incidental Discovery)

### Non-SSO Tier Classification
`classifyNonSSOTier()` — shifted thresholds because every non-SSO "visit" already represents a committed cardholder (they entered card data manually before seeing merchants).
- >=35% → Tier 1 (Card Activation Flow)
- >=25% → Tier 1.5 (Campaign → Activation transition)
- >=15% → Tier 2 (Targeted Campaigns)
- >=8% → Tier 2.5 (Discovery → Campaign transition)
- <8% → Tier 3 (Organic Discovery)

## Benchmarking Philosophy
Always benchmark against best-of-best performance (aspirational ceiling), never averages. Use the partner's own best-week/best-quarter data as proof their cardholders CAN convert. Named FI references (MSUFCU, Cape Cod Five, Kemba, ORNL) are admin-only — customer-facing benchmarks are anonymized.

## Tone & Framing Directive
All partner-facing content follows engagement-positive tone:
1. Lead with what's working, then show opportunity
2. Frame gaps as opportunity, not failure
3. Use their best performance as the anchor
4. Declining trends framed as controllable, not alarming
5. Tier 3 is a starting line, not a verdict
6. Projections should feel exciting, not hypothetical
7. Never blame the partner
8. Always include a path forward

**Admin view stays unvarnished** — Strivve employees need the real story.

---

# Build History

## Feb 24, 2026

### Traffic Health Monitoring — Live FI Outage Detection + Email Alerts
- **Problem**: A major partner went dark for 36+ hours with zero visibility. Weekly batch data was too slow to detect outages.
- **New endpoint**: `GET /api/traffic-health` — hybrid approach: 14-day baseline from daily session files + live CardSavr API queries across all 8 instances for today's counts. 2-minute cache TTL.
- **Status classification**: Per-FI status: **dark** (zero sessions + 6h elapsed), **low** (projected <50% baseline + 6h elapsed), **normal**. Volume filter (configurable min sessions/day) excludes naturally low-volume FIs.
- **Operations Dashboard integration**: Traffic Health section with clickable FI tiles (status badges, inline SVG sparklines, partner name). Detail modal with 15-day bar chart + stats. Kiosk mode with pulsing red borders on dark FIs. Summary banner shows monitored count + threshold (admin hyperlink).
- **Email alerts**: Background monitor runs every 15 minutes, checks cached traffic health data, sends styled HTML emails via SendGrid when FIs exceed dark/low thresholds. Per-FI cooldown tracking prevents alert spam. Clears alerts when FIs recover.
- **Admin settings** (`maintenance.html`): Two cards — (1) min daily sessions threshold for monitoring scope, (2) alert configuration with toggle switch, recipient email pill management, dark/low/cooldown hour thresholds.
- **Bug fixes**: Hoisted `_trafficHealthCache` from request handler closure to module level (caused `ReferenceError` on settings save + invisible to background monitor). Fixed GET endpoint to return all settings fields (was only returning `minDailySessions`).
- **Files**: `scripts/serve-funnel.mjs` (endpoint + background monitor + settings API), `public/dashboards/operations.html` (DOM containers), `public/assets/js/operations-dashboard.js` (fetch/render/modal/kiosk), `public/assets/css/dashboards.css` (tile grid + animations), `public/assets/js/dashboard-utils.js` (`trafficHealthColor`), `public/maintenance.html` (admin settings cards)

### Troubleshoot Page — Newest-First Sort + UTC Tooltips
- **Sort fix**: Troubleshoot endpoint (`/troubleshoot/day`) now sorts sessions newest-first, matching realtime page behavior. Previously returned sessions in file-chronological order (oldest-first).
- **UTC tooltips**: Hovering over Opened, Closed, Created, or Completed timestamps on `troubleshoot.html` now shows the raw UTC value (e.g. `UTC: 2026-02-23T11:18:45.657Z`) — useful when cross-referencing server logs or API responses.
- **Files**: `scripts/serve-funnel.mjs` (server-side sort), `public/troubleshoot.html` (title attributes)

### Share Link Filter Preservation
- **Instance + integration filters**: Share link generation on `funnel-customer.html` now includes `instance` and `integration` URL params when those filters are active (previously only `partner` was captured)

### Process: Pre-Deployment Testing Checklist + End-of-Session Protocol
- Added `## Pre-Deployment Testing Checklist` to CLAUDE.md — share link verification steps (filter preservation, FI data isolation, view-mode lockdown, page coverage)
- Added `## End-of-Session Protocol` — "lock it down" checklist: commit, verify deployment, update build history, testing review, update memory

### Low-Volume Guardrails for Insights Engine
- **Threshold**: `LOW_VOLUME_THRESHOLD = 30` sessions — below this, suppress conversion-quality analysis and replace with traffic-growth messaging
- **Low-volume narratives**: 2 replacement narratives (headline explaining statistical noise + reach narrative focusing on activation flows and campaigns) replace all 50+ standard narrative rules
- **Low-volume actions**: 4 traffic-growth priorities (increase encounters, activation flows, campaigns, source tracking) replace tier-based diagnosis
- **Spectrum diagnosis**: Returns `isLowVolume: true` with "insufficient data" message instead of tier classification; gauge SVG hidden, diagnosis text shown
- **Projections**: Returns empty scenarios at low volume (section hidden)
- **bestWeek_gap guard**: Requires `bestWeekSessions >= 10` before making "demand is proven" claims (both standard and non-SSO override)
- **avgCards narratives**: Require `sessionsWithSuccess >= 10` before claiming placement depth patterns
- **credCompletion narratives**: Require `credSessions >= 10` before making completion rate claims
- **Funnel interstitials**: Suppress qualitative labels ("Strong follow-through", severity colors, "See insights →" links) when either side of a transition has <10 observations — show neutral "X% drop-off" instead
- **Best windows fix**: "Most Successful Placements" filter now requires `minVisits` (was `() => true`)
- **Metrics context**: `isLowVolume`, `bestWeekSessions` added; `LOW_VOLUME_THRESHOLD` exported from `window.EngagementInsights`
- **Files**: `engagement-insights.js` (engine), `funnel-customer.html` (rendering gates)

### PRE-RELEASE Watermark
- **Stock-photo-style diagonal watermark** across all pages via `body::before` in `sis-shared.css`
- **Style**: Blurred outline block letters (SVG `feGaussianBlur` + `stroke`, no `fill`), 140px font, -30° rotation, `letter-spacing: 20`
- **Opacity**: 12% light / 14% dark — barely visible, doesn't compete with content
- **Tiling**: Two text rows per 1800×1100 SVG tile, `background-repeat: repeat`, `pointer-events: none`
- **Dark mode**: White stroke variant at slightly higher opacity
- **Removal**: Delete the `Pre-Release Watermark` CSS block from `sis-shared.css` when the product exits pre-release

## Feb 23, 2026

### Shared Links Admin — Open Button + Page Column
- **Open button**: Each shared link row now has an "Open" button that opens the exact report in a new tab with the original filters, date range, and FI scope — as an authenticated admin view (strips `view`, `sid`, `expires` params)
- **Page column**: Color-coded pill showing which page was shared (Customer = green, Funnel = blue, Sites = purple, Other = gray)
- **Use case**: When someone comments on a shared report, admins can instantly load the same view to see exactly what the recipient saw
- **File**: `public/shared-views.html`

### Supported Sites Page — New Partner-Facing Page
- **New page**: `public/supported-sites.html` — Living Ecosystem narrative + merchant sites table with status classification, sorting, filtering, CSV/PDF export, share links
- **New PDF template**: `templates/supported-sites-report-template.mjs` — Puppeteer-rendered, branded header, summary bar, narrative section, tier-grouped site tables
- **Route**: `/supported-sites` added in serve-funnel.mjs
- **Nav**: Added to Partner Analytics group (admin/internal), limited nav, executive nav
- **Access**: Added to `LIMITED_PAGES` and `EXECUTIVE_PAGES` in passcode-gate.js
- **Removed**: Merchant sites card from `maintenance.html` (HTML, CSS, ~420 lines JS)

**Living Ecosystem narrative**: Big Idea, How We Stay on Top of It (3 cards: Automated Testing, Production Telemetry, Watchlist Protocol), How We Prioritize (4 items including Campaign Support), What This Means for You. Framed for active live FIs, not pre-launch rollout.

**Merchant sites table**:
- Status classification from tags: down/disabled → Down, limited/beta/degraded → Limited, unrestricted/prod → Up
- **Admin view**: All 5 columns (Name, Host, Status, Tags, Tier), status toggle pills + dynamic tag pills sorted by frequency with "..." overflow for remaining tags, full sort controls (primary/secondary on every column)
- **Limited/view-mode view**: 4 columns (Tags hidden), status toggle pills only (Up + Limited active, Maintenance off by default), sort controls hidden, Tier column centered. Down sites filtered to Tier 1-2 only.
- `body.limited-view` CSS class controls column hiding + width redistribution

**Status toggle pills**: Up (green), Limited (amber), Maintenance (red) — toggle on/off to filter table. Admin also gets inline tag pills (blue) computed dynamically from loaded data, plus "..." button opening overflow dropdown. OR logic for tag pills (site has ANY active tag).

**PDF button**: Fixed-width during generation (locks `minWidth`), CSS `@keyframes btn-fill` left-to-right sweep animation instead of spinner.

### Share Links — Server-Side Expiration
- **Security fix**: Share link `expires` query param was client-side only — anyone could strip or edit it to bypass expiration
- **New endpoint**: `GET /api/share-validate?sid=xxx` (unauthenticated) — looks up `sid` in share log, finds creation timestamp, checks against admin-configured TTL from `share-settings.json`, returns `{ valid: true/false, expiresIn: "2 days" }`
- **Clean URLs**: Share links now just `?view=1&sid=abc123` — no `expires` param. Server is sole authority on validity.
- **Client validation**: Synchronous XHR to `/api/share-validate` blocks page render until server confirms validity. Invalid/unknown/expired → expired screen.
- **Shared view UX**: Nav bar stays visible (shows "Read-only view" + "Log in to explore" link), compact blue notice bar shows "link expires in X" instead of large branded header
- **Also patched**: `funnel-customer.html` and `funnel.html` — missing `expires` param now treated as expired (`!__effectiveExpires || Date.now() > __effectiveExpires`)
- **Note**: funnel-customer and funnel still use client-side `expires` param; only supported-sites uses full server-side validation. Migration is a follow-up.

## Feb 22, 2026

### Customer Dashboard Card Layout Cleanup & Table Width Fix
- **Row 1 label**: Added "Key Metrics" label before the headline KPI cards (was the only unlabeled row)
- **GA Sel→Cred % card**: New 4th card in GA Page Views row showing `(ga_cred / ga_select * 100)%` — fills the empty slot
- **Session Milestones hidden for non-SSO**: Wrapped in `<div id="sessionMilestonesRow" class="perf-grid-subsection">` (`display: contents` → `display: none` toggle). Non-SSO sessions start after card data entry, making session milestones meaningless
- **Engagement Depth hidden for non-SSO**: Same wrapper pattern (`id="engagementDepthRow"`), same hide logic
- **Outcomes row removed**: Total Sessions and Avg Cards cards were redundant. Avg cards moved to Cards Updated card subtitle ("X.XX avg per successful cardholder")
- **Table headers shortened**: All 4 multi-FI tables + single-FI table: FI, Inst, Type, @Select, UD Views, Cred Views, GA %, Est. Lnch, Reach %, Sel→U %, Sel→C %, Successful, Rate, Placed
- **Table CSS fixed**: `white-space: nowrap` moved from `.fi-table` to `.fi-table td` only (headers can now wrap). Header font 10px→11px
- **Outcomes color swatch removed** from data source legend

### QBR Monthly Detail — Launches Column & Alignment
- **Launches column added**: Uses blended top-of-funnel (`mMetrics.totalCardholders` = SSO sessions + non-SSO estimated launches), stored alongside metrics context in months array
- **Column alignment**: Changed from `text-align: right` to `text-align: center` for all data columns (Month stays left-aligned)

### QBR Executive Summary — Rate/Volume Mismatch Fix
- **Bug**: Opening line showed `m.totalSessions` as "visits" but used `effectiveRate` (which divides by `estimatedLaunches` for non-SSO) — volume and rate had different denominators, producing nonsensical text like "75 visits... 0.3% success rate"
- **Fix**: Uses `latest.rawMetrics.totalCardholders` (blended top-of-funnel) instead of `m.totalSessions`. Text changed from "made X visits" to "X cardholders launched CardUpdatr"
- **File**: `engagement-insights.js` line ~1473

### Non-SSO Calibrated Metrics — Best Windows & PDF Template
- **Best windows**: `computeBestWindows()` now computes per-window calibrated `successRatio` (launch-based) for non-SSO FIs, with `isEstimated` flag for display
- **PDF template**: Uses `successRatio` (calibrated) over `sessionSuccessRatio`, shows `~` prefix for estimated values
- **File**: `funnel-customer.html` (computeBestWindows), `funnel-customer-report-template.mjs`

## Feb 21, 2026

### Site Reorganization Phase 3 — Homepage Kill, Executive Access Level & Dashboard
- **Home link removed** from nav entirely (4-group nav makes it redundant)
- **index.html → redirect stub**: Reads `sis_user` from localStorage, redirects by access level (admin/internal→portfolio, limited→funnel-customer, executive→executive dashboard). Uses `window.location.replace()` to stay out of browser history.
- **Executive access level** added across the stack:
  - `passcode-gate.js`: `EXECUTIVE_PAGES`, `isExecutiveAllowedPage()`, executive in `checkPageAccess()` + `getAccessLevel()` view-as
  - `nav.js`: Executive nav group (Executive Summary + Cardholder Engagement), "Executive" in view-as switcher
  - `login.html`: Executive redirect to executive dashboard, admin/internal default changed from index.html to portfolio
  - `users.html`: Executive in filter/edit dropdowns, `.badge-executive` (purple), reference table row, sort order
  - `serve-funnel.mjs`: `/dashboards/executive` route
  - `funnel-customer.html`: Executive users get same scoped data as limited
- **Executive Summary dashboard** (`dashboards/executive.html` + `executive-dashboard.js`):
  - Network Health Verdict banner (green/amber/red based on warnings + attention FIs)
  - 5-card KPI row: Active FIs, Network Success Rate, Successful Placements, Portfolio Engagement Score, FIs Needing Attention
  - 12-week SVG trend chart (volume bars + success rate line)
  - Early warnings section (engagement declines, gone dark, system health)
  - Tier + score distributions (horizontal stacked bars)
  - Kiosk mode (`?kiosk=1`): dark mode forced, 5-min auto-refresh, no nav
- **View-as switcher fixes**:
  - Was disappearing when override active — `getRealAccessLevel()` was calling `getAccessLevel()` (includes overrides). Fixed by exposing `sisAuth.getRealAccessLevel()` from passcode-gate.
  - Switching roles now navigates to the role's default page instead of just reloading
- **Campaign URL Builder** added to limited user pages (`LIMITED_PAGES` in passcode-gate + limited nav group)

### Synthetic Traffic — Session Cards & Job List UX
- **Enriched session cards** in correlated sessions modal: full troubleshoot-level detail per session
  - Severity-based job badges (`jobBadgeClass()`: success/warn/fail/neutral)
  - Partner pill in header, outcome badge (color-coded)
  - Rich meta: source integration, device, FI key, CUID, session ID
  - Full per-job cards: termination_label, merchant, status, timestamps, duration_ms, instance, status_message
  - "No placements/jobs recorded" empty state
  - CSS: `.synth-badge.warn`/`.neutral`, `.synth-job-header`, `.synth-job-merchant`, `.synth-job-meta`, `.synth-job-message`
- **Collapsed card UX**: Session cards default collapsed with chevron toggle, expand in place
  - Fixed CSS bug: `.session-details` had `display:none` overridden by `display:flex` on next line, making details always visible with scrollbars
  - Raw JSON `pre` uses opaque `var(--panel-bg)` background, `pre-wrap` word wrapping, no inner scroll constraints
  - Only the modal body scrolls — no scrollbars on individual cards
- **Progressive job list**: Replaced "Hide completed/canceled" checkbox with smart defaults
  - Always shows all active jobs + fills to 10 with most recent inactive
  - "Show more (N remaining)" link loads next 10 incrementally
  - Status line: "Showing 3 active + 7 recent of 34 jobs."
- **Files**: `synthetic-traffic.html` (CSS), `assets/js/synthetic-traffic.js` (renderSessionCard, renderJobs, jobBadgeClass, formatDurationMs)

### Calibrated Launch Metrics for Non-SSO Funnel Interpretation
- **Problem**: Non-SSO session metrics are misleading — a "session" starts AFTER card data entry, so session success rate measures conversion from an already-committed audience, not true top of funnel
- **Solution**: Use GA calibration rate (`ga_user / cs_user`) to estimate true launches from `ga_select`, giving a real top-of-funnel metric comparable to SSO session counts
- **Engine changes** (`engagement-insights.js`):
  - `buildMetricsContext()`: computes `gaCalibrationRate`, `estimatedLaunches` (`ga_select / gaCalibrationRate`), `launchSuccessPct` (`sessionsWithSuccess / estimatedLaunches`)
  - Monthly reach uses per-row calibrated estimated launches for non-SSO FIs
  - `evaluateActions()`: uses `launchSuccessPct` with `classifyTier()` (SSO thresholds 3/8/12/21%) when calibrated; falls back to `classifyNonSSOTier()` when not
  - `NONSSO_NARRATIVE_OVERRIDES`: show both launch-based and session-based rates; reach narratives show per-FI GA tracking rate
  - `buildNonSSOSpectrumDiagnosis()`: uses launch-based rates with SSO-scale diagnosis when calibrated
  - `computeProjections()`: uses `estimatedLaunches` as volume base with SSO thresholds (8%/21%) when calibrated
- **Dashboard changes** (`funnel-customer.html`):
  - Non-SSO table: new "Est. Launches" and "Launch → Success %" columns with sorting, color coding (green ≥21%, amber ≥8%, red <8%)
  - `computeEstLaunches()`, `computeLaunchSuccessRate()` helper functions
  - Spectrum gauge uses SSO scale (0–30%) with "Launch: X%" marker when calibrated
  - Calibration banner dynamically shows per-FI GA tracking rate or generic fallback
- **Graceful fallback**: When `cs_user` is unavailable, everything falls back to pre-existing session-based behavior with generic 15–30% GA undercount disclaimer

### Synthetic Traffic → Funnel Data Correlation
- **New endpoint**: `GET /api/synth/jobs/:id/sessions` — scans raw session/placement files, matches by source `type` + `category` + `sub_category` + date range, returns enriched troubleshoot-level session detail
- **Source matching**: Uses `normalizeSourceToken()` for case-insensitive comparison; `sub_category` read from `session.source.sub_category` (CardSavr API field, not extracted by `extractSourceFromSession`)
- **count_only mode**: `?count_only=true` short-circuits on first match, returns `{ has_data: true/false }` — used for background availability checks
- **Reuses**: `mapSessionToTroubleshootEntry()`, `summarizeTroubleshootSessions()`, `extractSourceFromSession()`, `readSessionDay()`, `readPlacementDay()` — no new data functions
- **View Sessions button**: Eye icon on job rows with `attempted > 0`, color-coded via background `count_only` checks — green (has matching sessions), dim gray (no sessions in raw data), pending (checking)
- **Sessions modal**: Source filter badges, summary counters (sessions/success/jobs), job-vs-raw counter comparison (green check / red X), individual session cards with clickstream timeline pills, placement cards with status badges, source verification items, collapsible raw JSON
- **Performance**: `?max_days=N` (default 30, max 90) limits scan range; truncation shows "Load more" button; `count_only` skips placement loading and enrichment
- **Files**: `scripts/serve-funnel.mjs` (endpoint), `public/synthetic-traffic.html` (modal HTML + CSS), `public/assets/js/synthetic-traffic.js` (button, modal logic, background checker)

### Campaign URL Builder — New Page
- **New page**: `public/campaign-builder.html` — form-based tool to build tracked CardUpdatr launch URLs with `#settings=` hash encoding
- **New module**: `public/assets/js/campaign-builder.js` — IIFE-wrapped, ~400 lines
- **New library**: `public/assets/js/qrcode.min.js` — qrcode-generator (MIT, Kazuhiko Arase)
- **Route**: `/campaign-builder` added in serve-funnel.mjs
- **Nav**: "Tools" group added between Ops and Admin in nav.js (admin + full + internal access)

**Form panels (3 collapsible cards):**
1. **Configuration**: Hostname (required, protocol auto-stripped), Top Sites (chip input with domain validation), Merchant Site Tags (single `<select>` dropdown, default "demo"), Overlay Mode toggle
2. **Source Tracking**: Source Type (select), Category (select), Sub-Category (free text). Device/Grant/CardID omitted — device is auto-detected by page load
3. **Styling** (collapsed by default): Card Description, Button Color (text + color picker sync), Border Color (text + color picker sync), Button Border Radius

**Output section (always visible):**
- Generated URL with Copy button + Open in New Tab
- QR code (canvas-rendered, 256px, PNG download)
- Collapsible JSON preview with Copy button

**Presets**: Save/Load/Delete via localStorage (`sis_campaign_presets` key)

**Settings JSON structure:**
```json
{
  "config": {
    "top_sites": ["amazon.com"],
    "merchant_site_tags": "demo",
    "overlay": true
  },
  "user": {
    "source": { "type": "email", "category": "campaign", "sub_category": "spring-2026" }
  },
  "style": { "card_description": "Your Visa Debit Card", "button_color": "#1E40AF" }
}
```
- Hostname is in the URL domain only (not duplicated in settings JSON)
- `merchant_site_tags` is a plain string (not array) — matches CardUpdatr client expectations
- Only non-empty sections/fields included in output
- No server API needed — purely client-side

**Key lessons:**
- CardUpdatr `config.merchant_site_tags` expects a plain string (e.g. `"demo"`), not an array
- Hostname must not appear in both the URL domain AND the settings JSON — only in the URL
- `stripProtocol()` handles users pasting full URLs (e.g. `https://fi.cardupdatr.app`) into hostname field

## Feb 20, 2026

### SSO vs Non-SSO Insights Engine Split
- **Engine**: `classifyNonSSOTier()` with shifted thresholds (8/15/25/35% vs 3/8/12/21%) — every non-SSO visit represents a committed cardholder who already entered card data
- **Narrative overrides**: `NONSSO_NARRATIVE_OVERRIDES` in engagement-insights.js — suppresses selCred rules (irrelevant for non-SSO), overrides sessSuccess rules with post-commitment framing, adds GA undercount caveats to reach rules
- **Action overrides**: `NONSSO_ACTION_RULES` — "Time prompts to card activation moments" (always), "Consider SSO integration upgrade" (tier 2+)
- **Spectrum diagnosis**: `buildNonSSOSpectrumDiagnosis()` — reframes diagnosis text for committed cardholder traffic
- **Projections**: `computeProjections()` now integration-context-aware — non-SSO uses 15% campaign / 35% activation thresholds
- **Integration context**: `buildMetricsContext()` accepts `opts.integrationContext` ('combined'|'sso'|'nonsso'), passed through to all engine functions
- **Customer page breakdown**: New `#integrationBreakdownSection` in `funnel-customer.html` — when both SSO and non-SSO FIs are in view, renders separate narratives, spectrum gauges (non-SSO uses 0–50% scale), actions, and projections per type
- **GA disclaimer**: Non-SSO block shows banner noting 15–30% GA undercount from Safari ITP and ad blockers
- **Single-type hiding**: When only SSO or only non-SSO FIs are in the data, breakdown section is hidden (combined view IS the single-type view)
- **Dark mode**: Full `[data-theme="dark"]` overrides for breakdown blocks, badges, and disclaimer
- **PDF prep**: `window.__integrationBreakdown` stores split contexts for future PDF template extension

### GA Tracking Rate % Column — FI Detail Tables
- **New column**: "GA Rate %" added to all 4 multi-FI tables (SSO, NON-SSO, CardSavr, UNKNOWN) and single-FI time breakdown tables in `funnel-customer.html`
- **Formula**: SSO → `ga_select / cs_select`, Non-SSO → `ga_user / cs_user` — compares GA-reported counts against server-side session counts (100% accurate, no browser blocking)
- **Helper**: `computeGaRate(row, integration)` returns `{ value, display, cls }`
- **Color thresholds**: green >=85%, amber 70-84%, red <70%
- **Position**: After "Credential Views", before "Monthly Reach %"
- **Sortable**: `ga_rate` case in both `getSortValue()` and `getSingleSortValue()`
- **Totals row**: Weighted aggregate GA rate with color coding
- **Dark mode**: Full `[data-theme="dark"]` overrides for `.ga-good`, `.ga-warn`, `.ga-low`

### Dark Mode Fix — `--hover-bg` CSS Variable
- `users.html` filter bar was white in dark mode — `var(--hover-bg, #f9fafb)` fell back to light color because `--hover-bg` was never defined in `sis-shared.css`
- Added `--hover-bg` to both themes in `sis-shared.css`: light `#f9fafb`, dark `rgba(255, 255, 255, 0.04)`

### Dark Mode FOUC Fix — All Pages
- Added inline `<script>` in `<head>` of all 13 remaining pages to read `sis-theme` from localStorage before CSS loads, preventing flash of unstyled content

### Traffic Runner — Non-SSO Flow Support
- **Problem**: All synthetic jobs using `overlay_nosso` (or `embedded_nosso`) failed because the Playwright runner had no logic for the **user data page** (card/billing entry form) that appears between merchant selection and credential entry in non-SSO CardUpdatr flows
- **Root cause chain** (3 bugs found iteratively):
  1. **Missing user data handler**: Runner skipped the card entry form entirely → timed out waiting for credential fields
  2. **Expired test card**: `config.json` had `expDate: "12/25"` (December 2025, expired) → form validation blocked Continue → fixed to `"12/28"`
  3. **Wrong success detection text**: Runner looked for `"Success"` but non-SSO completion shows `"Update complete."` → jobs were actually succeeding but being recorded as timeouts
- **Files changed** (in `arg-fcu/tools/traffic-runner/`):
  - `run-tests.js`: Added non-SSO detection (`testFlow.includes("nosso")`), card/billing form filling by label, Continue click to advance to credential entry. Added timeout debug screenshots inside `runSingle()` before overlay close
  - `config.json`: Added `cardData` block (test Visa `4111111111111111`, Anaheim CA address), changed `finalState.success.text` from `"Success"` to `"Update complete"`, changed `expDate` to `"12/28"`
- **SSO flows unaffected**: `isNonSSO` check only triggers when test flow name includes `nosso`
- **Deployment**: Files SCP'd to `/home/ubuntu/traffic-runner/`, PM2 `traffic-runner` process restarted (each poll cycle spawns fresh `node run-tests.js`)
- **Merchant search note**: Non-SSO flow doesn't have a "Search for sites" label → 30s timeout on search (caught silently), falls back to clicking merchant tile text directly

### Merchant Site Tags — Demo Only
- **Change**: `integration-test.html` and `playground.html` switched from `["demo", "prod"]` to `["demo"]` only
- `integration-test.html`: Hardcoded `merchant_site_tags` and `tags` changed to demo-only
- `playground.html`: Unchecked `prod` checkbox default in merchant site tags multi-select
- **Deployed via**: GitHub Pages (arg-fcu repo, `git push` to main)

### Synthetic Traffic — Test Preset + Cascading Funnel Disable
- **Test preset**: source type `test`, category `other`, campaign mode, 25 runs/day, 2 days, 50/50 success/fail, zero abandon rates
- **Cascading disable logic**: upstream abandon rate at 100% disables all downstream funnel fields
  - Select Merchant 100% → User Data, Cred Entry, Success, Fail disabled
  - User Data 100% → Cred Entry, Success, Fail disabled
  - Cred Entry 100% → Success, Fail disabled
  - Respects SSO disable on User Data (won't re-enable if SSO flow selected)
- **Files**: `synthetic-traffic.html` (dropdown option), `assets/js/synthetic-traffic.js` (preset data + `updateFunnelCascade()`)

## Feb 17, 2026

### Admin-Configurable Share Link Expiration
- **Server endpoints**: `GET /api/share-settings` (public read, returns `{ ttlHours }`), `POST /api/share-settings` (admin-only, saves to `data/share-settings.json`)
- **Admin UI**: New "Share Link Settings" card on `maintenance.html` — number input for hours (0.01–8760), Save button, status display
- **Share link generation**: Both `funnel.html` and `funnel-customer.html` fetch TTL from `/api/share-settings` on load, generate `expires` timestamp param instead of `created`
- **Backward compat**: View check reads `expires` param; falls back to `created` + 3-day default for legacy links
- **Countdown display**: Presentation header shows "Link expires in X hours/days" computed from `expires` timestamp
- **Safari fix**: Top-level `return;` in inline `<script>` blocks caused `SyntaxError` in Safari, killing all page JS. Fixed with IIFE wrapper (funnel-customer.html) and flag pattern + small IIFE (funnel.html — broader IIFE broke `applyFilters` scoping)
- **Config file**: `data/share-settings.json` stores `{ ttlHours: 72 }` (default), persists across server restarts

### Customer-Facing Content Audit & Hardening
- **Benchmark proof text**: Removed time-specific references from `campaignWeeksSustained.proof` — was "6 separate weeks in 2025 and 3 in 2024", now "Multiple weeks sustained this range across hundreds of visits". Specific year/count detail preserved in `_admin` block only.
- **Full audit result**: All named FI references, specific dates, and year references confirmed isolated in `_admin` blocks. `scaleProof` fallback in `getBenchmarkDisplay()` uses anonymized language ("One partner") — safe even if it leaked.
- **Share link date controls**: Presentation mode header now has date range preset dropdown (7/14/30/60/90d, YTD, custom), date inputs, and Update button for live re-query
- **Monthly reach calc fix**: `buildMetricsContext()` now uses pre-resolved `row.cardholders` instead of re-looking up the registry (avoids key normalization mismatches)

## Feb 16, 2026

### Phase 3 — CS Portfolio Dashboard (Completed)
- **New page**: `public/dashboards/portfolio.html` — single-pane-of-glass view of entire FI book of business
- **New module**: `public/assets/js/portfolio-dashboard.js` — ES6 module (~750 lines)
- **Route**: `/dashboards/portfolio` added in serve-funnel.mjs
- **Nav**: "CS Portfolio" added to Conversions group in nav.js (admin + internal only)
- **No new API endpoints** — parallel-fetches existing `/api/metrics/funnel`, `/api/metrics/ops`, `/fi-registry` + 4 weekly trend windows via `Promise.all`

**Page sections (regular view):**
1. **System Health Banner**: Network-wide job success rate from ops, color-coded (green >=85%, amber >=70%, red <70%), top impacted merchants when degraded
2. **Portfolio KPIs** (5-card row): Active FIs, Network Success Rate (weighted avg), Total Sessions, Total Placements, Trend Summary (X up / Y down / Z flat)
3. **Tier Distribution + Score Distribution** (2-col): Horizontal stacked bar by tier count, 4-bucket histogram by score range
4. **Early Warnings**: Multi-week engagement decline (rate down >2pp for 2+ weeks), gone dark (zero sessions after active), system health (job failure >15%/30%). ENGAGEMENT vs SYSTEM labels, collapsible
5. **FI Card Grid**: Every FI as a card with tier badge, score circle, health dot, trend arrow, sparkline, SSO/Non-SSO badge, system flag. Sorted by engagement score. Click opens detail modal
6. **FI Performance Table**: Sortable columns (FI, Tier, Score, Sessions, Success Rate, Trend, System Health, Type, Partner)
7. **Detail Modal**: Stats grid (SM/CE/Success sessions, rates, jobs, reach, score), 4-week trend sparkline + table, system health section, tier diagnosis from `classifyTier()`, recommended actions from `evaluateActions()`

**Engagement Score formula (0-100):**
- Success Rate: 40% weight — `min(100, (rate / 0.27) * 100)`
- Trend: 20% weight — up=100, flat=50, down=0
- Monthly Reach: 20% weight — `min(100, (reach / 2.5) * 100)` or 50 if no data
- Volume: 20% weight — `log(sessions+1) / log(maxSessions+1) * 100`
- Colors: >=75 green, >=50 amber, >=25 orange, <25 red

**Kiosk mode** (`?kiosk=1`): KPI row, early warnings, FI card grid, 5-min auto-refresh, detail modal on click

**Filters**: Time window (3/30/90/180d), FI Scope (SSO/Non-SSO), Partner multi-select, Tier multi-select, Include test data toggle

**CSV export**: All enriched FI data (name, tier, score, sessions, rates, trends, jobs, reach, partner)

**Verbose tooltips**: Every element has detailed title attributes explaining formulas, thresholds, and strategic context. Touch-friendly: long-press (500ms) on iPad/mobile shows floating popup with close button and 8s auto-dismiss

### Phase 2 — Share Links, QBR Mode, QBR PDF (Completed)
- **Share Link Presentation Mode**: `shareLinkBtn` generates URL with encoded filters + date range, opens in `share-presentation-mode` (nav/admin hidden, branded header with partner name)
- **Share Link Tracking**: `POST /api/share-log` logs creation + views, `GET /analytics/shared-views` admin endpoint, `shared-views.html` admin page
- **QBR Range Preset**: Dropdown option auto-sets date range to last completed quarter, `qbr-mode` body class toggles QBR sections
- **QBR 4-Quarter Trend Data**: `buildQBRQuarterlyData()` builds quarterly buckets, `renderQBRTrendTable()`, `renderQBRSparklines()`, `renderQBRYoY()`, `renderQBRMonthlyDetail()`, `renderQBRExecutiveSummary()`
- **QBR PDF Export**: Server detects `isQBR` flag, template renders cover page, executive summary, trend tables, sparklines, admin section. Filename: `qbr-{dates}.pdf`
- **QBR Event Logging**: `POST /api/qbr-log` + `GET /analytics/qbr-events` endpoints
- **Share + QBR Integration**: Share links preserve QBR mode via `qbr=1` param, shared views render QBR content when present

### Command Center Dashboards (Kiosk Mode)
- **Approach**: Added `?kiosk=1` query parameter to existing dashboards — no code duplication
- **CS Portfolio** (`/dashboards/customer-success.html?kiosk=1`): Partner grid with health indicators, detail panel on click, alert section for low-performing FIs, 5-min auto-refresh, header shows "Last 30 Days"
  - **Weekly trends**: Fetches 4 weekly buckets per FI, compares success rate week-over-week. Each partner card shows trend arrow (green up / red down / gray flat, 2pp threshold) and 4-week session volume sparkline
- **Ops Command Center** (`/dashboards/operations.html?kiosk=1`): KPI row, merchant health grid (sorted by most jobs), placement volume sparkline, live event feed, 30-sec auto-refresh
  - **Week-over-week trends**: Fetches prior week for comparison. KPI cards show delta % and prior week values. Success/failure rate KPIs have trend arrows. Each merchant tile shows failure rate trend arrow vs prior week (green = improving, red = worsening, 2pp threshold)
- **New endpoint**: `GET /api/metrics/ops-feed` — returns last 50 placement events from today (timestamp, merchant, fi_name, status, termination_type)
- **Shared kiosk infra**: `dashboard-utils.js` — `isKioskMode()`, `initKioskMode()`, `startAutoRefresh()`, `formatRelativeTime()`, `healthColor()`, `opsHealthColor()`
- **CSS**: `.kiosk-mode` body class, `.kiosk-header`, `.partner-grid`, `.partner-card`, `.partner-detail-panel`, `.merchant-health-grid`, `.merchant-tile`, `.event-feed`, `.health-dot`, `.kiosk-alert`
- Dark theme forced, nav/toolbar hidden, full-viewport layout
- Health thresholds: CS uses >=15%/5% (green/amber/red), Ops uses >=85%/70%

### Engagement Playbook — Full Page + PDF Export
- **New page**: `public/resources/engagement-playbook.html` — auto-generated from ACTION_LIBRARY (now tracked in git)
- **Route**: `/resources/engagement-playbook` — explicit route added in serve-funnel.mjs (was missing, fell through to SPA fallback)
- **PDF export**: `POST /api/export-pdf-playbook` — Puppeteer-rendered, reads action-library.js server-side
- Strivve branded header with embedded base64 logo from `assets/images/StrivveLogo.png`
- 6 sections: Activation, Campaigns, Visibility, Optimization, Scaling, Member Services
- All channels and all examples (not preview-limited like dashboard drawers)
- Sticky nav with IntersectionObserver scroll highlighting
- Copy-to-clipboard per example, tags display, print-friendly CSS
- Dashboard drawer "See all N channels..." links now point to playbook with `#section` anchors

### Playbook Section Descriptions
- **New data**: `PLAYBOOK_SECTIONS` in `action-library.js` — title + description paragraph for each of the 6 sections
- **Helper**: `getPlaybookSection(sectionKey)` exposed via `window.ActionLibrary` and `window.EngagementInsights`
- Descriptions render on full playbook page (blue info box above each section's channels)
- Descriptions render in dashboard "How to implement" drawers (`.library-section-intro`)
- Content drawn from Strivve TopWallet Playbook reference docs (`assets/reference/`)
- Reference PDFs checked into repo: `assets/reference/TopWallet Playbook.pdf`, `assets/reference/TopWalletTools.pdf`

### Monthly Reach % Precision + Editable Member Count
- `fmtPct()` helper in engagement-insights.js: 2 decimal places when <1%, 1 decimal otherwise
- Fixed `Number()` coercion bug in `buildMetricsContext()` for cardholder_total
- Added `totalCardholders` and `fiCountWithCardholders` to metrics context
- Single-FI reach narrative shows "Based on X,XXX cardholders on file." with "(update)" link
- **Inline cardholder edit**: any user can update count in-memory for their session view only (does NOT persist)
- Submission logged server-side: `POST /api/cardholder-count-submission` → activity.log + admin-notifications.json
- **Admin notification banner**: `GET /api/admin-notifications` + `POST /api/admin-notifications/dismiss`
  - Admin/internal users see dismissible banner on funnel-customer page showing pending submissions

### Action Library — Expandable Implementation Resources
- **New file**: `public/assets/js/action-library.js` — single source of truth for all copy/messaging templates
- **Version format**: `3.0.YY.MM.DD` (e.g., `3.0.26.02.16`) — manual bump on content change, no date display
- Expandable "How to implement" drawer on each Recommended Action card (accordion, one open at a time)
- Copy buttons with channel-aware formatting (email → "Subject: headline\n\nbody", SMS → body only)
- Admin overlay shows library stats per action (channel count, example count, playbook section)
- PDF export excludes drawers, adds note with playbook version
- `ACTION_LIBRARY_MAP` maps ACTION_RULES rule IDs → library keys by action index
- `evaluateActions()` now returns `ruleId` and `actionIndex` on each action for library lookup
- `getLibraryEntry()` resolves `sharedWith` references (e.g. low_reach_activation_comms → tier3_activation)
- Dashboard shows preview: first 2 channels, first 2 examples per channel; playbook page renders all

## Feb 15, 2026

### Phase 1 — Insights Engine
Transformed the dashboard from a passive metrics display into a **diagnostic advisory tool**.

**Capabilities built:**
1. **Narrative Rules Engine** — 50+ modular condition/template rules that auto-generate contextual insight paragraphs based on partner data
2. **Motivation Spectrum Diagnosis** — Classifies partner traffic into 3 tiers based on Session Success Rate
3. **Benchmarking Layer** — Hardcoded validated benchmarks from network data (always aspirational ceiling, never averages)
4. **Prescriptive Actions** — Prioritized recommendations mapped to diagnosis with expandable implementation library
5. **Value Projections** — "What if" scenarios using partner's own session volume at campaign-tier (8%) and activation-flow (21%) rates
6. **Admin Overlay** — Internal talking points, named FI references, objection responses. Triple-gated: JS access check + JS rendering guard + CSS visibility toggle
7. **QBR Infrastructure** — Quarter-over-quarter analysis with 4-quarter trend data, event logging endpoints (`POST /api/qbr-log`, `GET /analytics/qbr-events`)
8. **PDF Export** — Insights payload computed client-side, sent to server, rendered via template

### Cleanup Pass
- 1 bug fix: `credCompletion_low` division by zero guard
- 5 tone rewrites: credCompletion_low, reach_low, qbr_worst_is_latest, qbr_declining_success, avgCards_low
- 5 gap fills: both volume + conversion declining QBR narrative, Tier 2→1 transition zone diagnosis (12-21%), QBR tier declined narrative, YoY/monthly narratives moved to engine, best-quarter projection in QBR mode

### UX Enhancements
- **Partner-facing terminology**: All "session" language replaced with "CardUpdatr visits," "cardholder success rate," "successful cardholders" etc. — 60+ edits across 3 files
- **Performance Highlights rework**: Volume-oriented highlights replaced with conversion-quality focused ones
- **Funnel interstitials**: Larger text, contextual labels, clickable "See insights →" links
- **Scroll highlight UX**: 3-pulse amber/gold animation, 80px scroll offset, background color wash
- **Interactive filter hints**: All 4 hints fully wired — SSO filter action + external docs link, weekly period scroll, FI detail scroll, date range filter

## Feb 13, 2026

### Cardholder Engagement Dashboard (Customer-Facing Page)
- **New page**: `public/funnel-customer.html` — positive-only metrics, no failures/termination data
- **New template**: `templates/funnel-customer-report-template.mjs` — customer-branded PDF
- **Server**: Page route `/funnel-customer` + `POST /api/export-pdf-customer` endpoint
- **Access**: Limited users redirected here (not funnel.html); admin/internal see it under Conversions nav

**What's on the page:**
- 7 metric cards (no Total Placements — it confused customers): CardUpdatr Launches, User Data Page Views, Credential Entry Views, Total Sessions, Sessions w/ Successful Placements (highlight), Success Rate (highlight), Successful Placements (success, sub: "Cards updated at merchants")
- **FI Performance Detail** tables grouped by integration type (SSO, NON-SSO, CardSavr, Other)
  - Columns: FI, Instance, Integration, GA Select, GA User, GA Cred, Monthly Reach %, Sel→User %, Sel→Cred %, Sel→Success %, Sessions, Sess w/ Success, Sess→Success %, Placements
  - Monthly Reach % highlighted: green if >=2.5%, orange if >0% but <2.5%
  - Sortable columns, totals row per group, default sort by GA Select desc
  - **Excluded**: Sess w/ Jobs, Sess→Jobs %, Sources Missing, all failure data
- Performance Highlights (best 7-day windows, no sources_missing column)
- Partner Integration Mix table
- Export CSV (with Monthly Reach %), Export PDF, Share link

**Key design decisions:**
- "Total Placements" card removed — showing 88 successful next to 320 total confused customers ("what happened to the other 232?")
- Sess w/ Jobs excluded — raises "what about the rest?" question
- Sources Missing excluded — internal data quality concern
- Monthly Reach % is key metric — FIs should push up to 2.5%

**Customer page data functions (copied from funnel.html, simplified):**
- `fetchRegistry()`, `fetchDailyList()`, `fetchDailyRange()`, `fetchDaily()` — identical
- `aggregateData()` — identical
- `getVisibleRows()` — checks `"funnel-customer"` page id
- `computeBestWindows()` — identical (render without sources_missing)
- `buildPartnerSummaryData()` — identical
- `calculateMetrics()` — simplified from `calculateConversionMetrics()`, no uxByType/systemByType
- Test data always excluded (`includeTests = false`, no checkbox)

## Feb 12, 2026
- Job Outcome Breakdown enhancements (Overall/System Success Rate, merchant breakdown)
- Users page filtering & sorting
- Nav bar user info (name + Sign Out)
- Sticky filter header, deferred apply, composite error filter
- Per-termination-type breakdown, Pre-SSO vs Post-SSO breakdown
- Editable First SSO Seen, limited user partner scoping, cross-partner data fix

## Narrative Rules Audit (Completed)
Full audit in `narrative-rules-audit.md` in project root. 50 narrative templates total:
- 14 Performance Insights rules (13 original + bestWeek_gap)
- 5 Spectrum Diagnosis templates
- 6 Action rule groups → 13 individual actions
- 12 QBR narrative rules
- 1 composite QBR Executive Summary
- 3 Value Projection scenarios
- 3 inline narratives (YoY, monthly, funnel)
- All conditions verified mutually exclusive, admin content triple-gated

---

# What's Pending / Queued

### Card Replacement Reach Math (Discussed, Not Yet Built)
- ~25% annual portfolio turnover from expirations, ~3-5% lost/stolen = ~28-30% annual (2.3-2.5% monthly)
- These are Tier 1 motivation cardholders at peak urgency
- Framing: "You have ~1,000 cardholders per month at peak motivation. How many encounter CardUpdatr at that moment?"
- Could become a calculator widget or narrative rule

---

# Infrastructure — Mac Pro Always-On Server

An old Mac Pro tower (connected to two 27" Thunderbolt displays) will serve as:
1. **Always-on Claude Code server** — SSH in from iPad via Termius + Tailscale from anywhere
2. **CS command center** (left 27" display) — Customer Success portfolio dashboard
3. **Ops command center** (right 27" display) — Real-time operations dashboard

**Setup**: Tailscale + Homebrew + Node.js + Claude Code, prevent sleep, auto-login on restart, kiosk-mode browsers
**iPad access**: Tailscale + Termius → SSH → `cd ~/project && claude`

**Current status (Feb 16, 2026)**:
- GitHub SSH key configured (`~/.ssh/id_ed25519`, titled "TrashCanMachine")
- Lightsail SSH key configured (`~/.ssh/LightsailDefaultKey-us-west-2.pem`)
- Git remote switched to SSH (`git@github.com:arnegaenz/sis.git`)
- Claude Code can push/pull GitHub and deploy to Lightsail independently
- macOS 12 — Homebrew Tier 3, some packages fail to compile (poppler blocked by outdated Xcode CLT)

---

# Reference Partner Data (NASA FCU)

Used throughout design as the working example:
- 90-day window (Nov 17, 2025 - Feb 14, 2026): 223 launches, 789 sessions, 2.5% success, 22 placements
- Select→Credential: 12.7% (vs 18.3% for motivated traffic)
- Best 7-day window: 8.0% (Jan 14-20, 2026)
- Monthly reach: 0.1%
- Integration: SSO via Alkami
- Full-year 2025: 11.6% success, 140 placements — decline in H2 mirrors MSUFCU pattern when activation pushes tapered

---

# Workflow

**Strategic thinking and prompt creation** → Claude Chat
**Implementation** → Claude Code (VS Code / CoWork / terminal)
**Audit and review** → Claude Code generates audit docs, brought back to Claude Chat for analysis
**Iteration** → Fixes/enhancements designed in Claude Chat, handed to Claude Code
