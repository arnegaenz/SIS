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
- `templates/funnel-report-template.mjs` - Internal PDF template
- `templates/funnel-customer-report-template.mjs` - Customer PDF template
- `src/config/terminationMap.mjs` - Termination type definitions with labels
- `public/login.html` - Magic link login page
- `secrets/users.json` - User data with access levels, login stats
- `fi_registry.json` - FI registry (fi_lookup_key, instance, partner, integration_type)
- `assets/images/StrivveLogo.png` - Strivve logo (used in playbook page + PDF, base64-embedded)

## Critical Lessons (Hard-Won)
- **Do NOT expose window.applyFilters** — causes race condition that breaks ALL users
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
- **arg-fcu**: Contains traffic runner at `tools/traffic-runner/`

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

## Feb 16, 2026

### Engagement Playbook — Full Page + PDF Export
- **New page**: `public/resources/engagement-playbook.html` — auto-generated from ACTION_LIBRARY
- **Route**: `/resources/engagement-playbook` (serves static HTML, client-side rendering from action-library.js)
- **PDF export**: `POST /api/export-pdf-playbook` — Puppeteer-rendered, reads action-library.js server-side
- Strivve branded header with embedded base64 logo from `assets/images/StrivveLogo.png`
- 6 sections: Activation, Campaigns, Visibility, Optimization, Scaling, Member Services
- All channels and all examples (not preview-limited like dashboard drawers)
- Sticky nav with IntersectionObserver scroll highlighting
- Copy-to-clipboard per example, tags display, print-friendly CSS
- Dashboard drawer "See all N channels..." links now point to playbook with `#section` anchors

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
- **Version format**: `3.0.MM.DD.YY` (e.g., `3.0.02.16.26`) — no date display, version only
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

## Ready to Build
1. **Phase 2** (`customer_engagement_page_phase2_prompt.md`) — Share Link Presentation Mode, QBR Range Preset with 4-quarter trend data, QBR PDF Export (5-6 page branded document), QBR Event Logging, Share Link + QBR Integration

## To Design / Build
2. **Card Replacement Reach Calculation** — Add to dashboard as "CardUpdatr Activation Capture" metric
3. **Phase 3 — Portfolio Dashboard / CS Intelligence Layer** — QBR tracking across all FIs, portfolio metrics, engagement scoring, early warning system, auto-generated reports
4. **Dual-Monitor Command Center** (Mac Pro) — Left: Customer Success portfolio dashboard (5-min refresh), Right: Ops dashboard with merchant health and anomaly detection (30-sec refresh)

---

# Infrastructure — Mac Pro Always-On Server

An old Mac Pro tower (connected to two 27" Thunderbolt displays) will serve as:
1. **Always-on Claude Code server** — SSH in from iPad via Termius + Tailscale from anywhere
2. **CS command center** (left 27" display) — Customer Success portfolio dashboard
3. **Ops command center** (right 27" display) — Real-time operations dashboard

**Setup**: Tailscale + Homebrew + Node.js + Claude Code, prevent sleep, auto-login on restart, kiosk-mode browsers
**iPad access**: Tailscale + Termius → SSH → `cd ~/project && claude`

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
