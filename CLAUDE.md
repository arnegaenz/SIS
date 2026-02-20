# SIS / CardUpdatr Dashboard — Project Context

## Deployment Info
- **SSH Key**: `~/.ssh/LightsailDefaultKey-us-west-2.pem`
- **Server**: `ubuntu@34.220.57.7`
- **Path**: `/home/ubuntu/strivve-metrics/`
- **PM2 Process**: `sis-api` (NOT sis-metrics)
- **Deploy command**: `scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem <local-file> ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/<path> && ssh -i ~/.ssh/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 "pm2 restart sis-api"`

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
- `assets/images/StrivveLogo.png` - Strivve logo (used in playbook page + PDF, base64-embedded)

## Critical Lessons (Hard-Won)
- **Do NOT expose window.applyFilters** — causes race condition that breaks ALL users
- **NEVER use top-level `return` in inline `<script>` blocks** — Safari throws `SyntaxError: Return statements are only valid inside functions` at parse time, killing the ENTIRE script. Use IIFE wrapper or flag pattern instead. Chrome/Firefox tolerate it, Safari does not.
- **FI keys not unique across instances** — always filter by partner/instance composite
- **`calculateConversionMetrics()` sums from visibleRows** — can't be used for date-subsetting
- **`assignMeta()` whitelists fields** — new registry fields must be added there
- **Customer page `getCardholderMap()` returns `{}`** — cardholders come from registry `total` field fallback

## Access Control System
- **Admin pages**: users.html, synthetic-traffic.html, maintenance.html, activity-log.html, shared-views.html, logs.html
- **Limited user pages**: funnel.html, funnel-customer.html, troubleshoot.html, realtime.html
- **Limited user redirect**: → funnel-customer.html (NOT funnel.html)
- **Limited user nav**: "Dashboards" group with Cardholder Engagement link
- **Limited user filters**: Partner + FI visible; Instance + Integration hidden
- Access levels: admin, full (legacy=admin), internal (all except admin pages), limited

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

## Card Replacement Reach Math (Discussed, Not Yet Built)
- ~25% annual portfolio turnover from expirations (cards expire every 4 years)
- ~3-5% additional from lost/stolen
- **Total: ~28-30% annual, or 2.3-2.5% monthly** receiving new card numbers
- These are Tier 1 motivation cardholders — peak urgency
- Framing: "You have ~1,000 cardholders per month at peak motivation. How many encounter CardUpdatr at that moment?"

---

# Build History

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

## QUEUED: Synthetic Traffic → Funnel Data Correlation

### Goal
Enable viewing synthetic job results alongside actual funnel metrics — look at a synthetic job's source metadata (type, category, subcategory) and find matching sessions/placements in the dashboard.

### Current State
- **Source data flows end-to-end**: Traffic runner passes `source.{type, category, subCategory}` → integration test page → CardSavr API → raw session/placement JSON files
- **Raw files retain source**: `raw/sessions/{date}.json` and `raw/placements/{date}.json` contain full source objects
- **Daily rollups DO NOT include source**: `data/daily/{date}.json` only has aggregated metrics (GA views, session counts, placement counts by termination type) — source metadata is stripped during aggregation
- **On-demand extraction exists**: `/api/metrics/funnel` and `/troubleshoot/day` endpoints extract source from raw files at request time
- **Synthetic jobs stored separately**: `/data/synthetic/jobs.json` has per-job aggregate counters (attempted, success, failed, abandoned) + source metadata, but no link to individual sessions/placements

### Implementation Options
1. **"View Sessions" on synthetic job rows** — query raw data filtered by job's source type + category + subcategory + date range (created_at → last_run_at), show matching sessions inline or in modal
2. **Source filter on troubleshoot/sources page** — add source_type/category filter dropdowns for manual cross-referencing
3. **Aggregate source data into daily rollups** — add source breakdown to `build-daily-from-raw.mjs` (performance trade-off)

### Key Files
- `scripts/build-daily-from-raw.mjs` — daily rollup aggregation (source data stripped here)
- `scripts/serve-funnel.mjs` — `extractSourceFromPlacement()` (line ~1857), `extractSourceFromSession()` (line ~1881)
- `public/synthetic-traffic.html` + `public/assets/js/synthetic-traffic.js` — job monitoring UI
- `src/lib/rawStorage.mjs` — raw session/placement file I/O
- `src/lib/analytics/sources.mjs` — source grouping logic (integration type, device, category/subcategory)

### Post-results POST failure
- Runner logs show `[SIS] Post results failed (attempt 1/3): fetch failed` — results endpoint works via curl but Node.js `fetch()` intermittently fails. Retries may succeed silently (only failures logged). Needs investigation if job results are missing.

---

## IN PROGRESS: Non-SSO Data Interpretation Fix (QBR prep for Digital Onboarding)

### What was built
SSO vs Non-SSO insights engine split (Feb 20) — when both SSO and non-SSO FIs are in the data, a "Performance by Integration Type" breakdown section appears with separate narratives, spectrum gauges, actions, and projections per type. Code is deployed and committed.

### The problem discovered during review
The current implementation shifts tier thresholds for non-SSO but still uses **session-based metrics** as the primary data source. This is fundamentally misleading because:

- **SSO**: A "session" starts when the cardholder lands on the page (pre-authenticated). Sessions ≈ true top of funnel. Session success rate = real conversion.
- **Non-SSO**: A "session" doesn't start until AFTER the cardholder has manually entered their card data. Every session represents an already-committed cardholder. Session success rate measures conversion from a pre-filtered audience — it looks artificially good.
- **User Data conversion = 100% for non-SSO** — this is tautological, not a real metric. You can't have a non-SSO session without having entered user data.
- **GA launches = true non-SSO top of funnel**, but undercounted 15-30% due to Safari ITP and ad blockers.
- The real non-SSO conversion rate is **GA launches → successful placements**, which is much lower than the session-based rate.

### Breakthrough: GA Undercount Calibration (Feb 20, 2026)
Synthetic traffic testing confirmed that the CardSavr API clickstream records every page transition server-side, with NO browser blocking. Each non-SSO session object includes:
```json
"clickstream": [
  { "url": "/select-merchants", "timestamp": "...", "page_title": "Select Merchants" },
  { "url": "/user-data-collection", "timestamp": "...", "page_title": "User Data Collection" },
  { "url": "/credential-entry", "timestamp": "...", "page_title": "Credential Entry" }
]
```

**Key findings from synthetic data analysis:**
- **Session `created_on` = `/user-data-collection` timestamp** — confirms session creation happens at card data submission, not page load
- **Clickstream is 100% accurate** (server-side) — no Safari ITP, no ad blockers
- **Abandon sessions still record clickstream** — even `total_jobs: 0` sessions show the full page path up to where the user dropped off
- **Non-SSO integration type = `CU2`** in raw API data (SIS maps this to "NON-SSO" during aggregation; SSO = `CU2_SSO`)
- **Source metadata preserved end-to-end** — `source.sub_category` on each session matches the synthetic job's configured subcategory exactly

**GA undercount calibration approach:**
1. **Clickstream `/user-data-collection` count** = ground truth (server-side, 100% accurate)
2. **GA `user_data_collection` count** = same event, undercounted by browser blocking
3. **Ratio = per-FI GA accuracy rate** (e.g., clickstream 100 vs GA 78 → 22% undercount)
4. **Apply ratio to GA `select_merchants`** = estimated true top-of-funnel for non-SSO
5. **Caveat on dashboard**: "Select Merchant count estimated based on observed GA tracking rate of X% for this FI (derived from server-verified User Data submissions vs GA-reported User Data views)."

This replaces the generic "15-30% undercount" guess with a **data-driven, per-FI calibration factor** that can be computed for any time window.

### What to build
1. **GA calibration factor computation**: Compare clickstream `/user-data-collection` count vs GA `user_data_collection` for same FI + date range → compute per-FI accuracy rate
2. **Calibrated select-merchants estimate**: Apply calibration factor to GA `select_merchants` → show as "Estimated Launches" with tooltip explaining methodology
3. **Non-SSO funnel reframe**: Use calibrated launches as true top of funnel, session-based metrics as post-commitment funnel
4. **Insights engine updates**: Tier classification using launch-based conversion rates (calibrated GA launches → successful placements), not session-based rates
5. **Dashboard caveats**: Inline explanation of methodology wherever estimated values appear

### Key files to modify
- `scripts/serve-funnel.mjs` — add clickstream aggregation endpoint or compute during daily rollup
- `scripts/build-daily-from-raw.mjs` — extract clickstream page counts during aggregation (currently stripped)
- `engagement-insights.js` — narrative overrides, tier thresholds using launch-based conversion
- `funnel-customer.html` — breakdown rendering with calibrated metrics, caveat UI
- `computeProjections()` — rethink for non-SSO context using calibrated launch data

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
**Iteration** → Fixes/enhancements designed in Claude Chat, prompt files updated, handed to Claude Code

Prompt files in project root:
- `customer_engagement_page_prompt.md` — Phase 1 (completed)
- `customer_engagement_page_phase2_prompt.md` — Phase 2 (ready to build)
- `narrative_rules_audit_prompt.md` — Audit request (completed)
- `narrative-rules-audit.md` — Audit results
- `narrative_engine_cleanup_prompt.md` — Bug fix + tone + gaps (completed)
- `terminology_highlights_scroll_prompt.md` — Terminology + highlights + scroll (completed)
- `filter_hints_fix_prompt.md` — Filter hint wiring (completed)
- `funnel_interstitial_prompt.md` — Funnel clickable labels (completed)
- `action_library_prompt.md` — Implementation resources + playbook architecture (completed Feb 16)
