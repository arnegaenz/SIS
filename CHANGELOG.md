# SIS / CardUpdatr Dashboard — Build History & Reference

> Moved from CLAUDE.md to reduce context window usage. Full session-by-session changelog of all features built.

---

# Build History

## Mar 29, 2026 (Session 16)

### System Monitor — Polish & Interactivity

**Traffic Map Improvements:**
- Deduplicated city dots across time buckets — each city now shows only in its most recent bucket
- New color scheme: green (now) → yellow (1-6h) → orange (6-24h) → blue (24-48h) → grey (48-72h)
- Fixed double tooltip bug — removed native SVG `<title>`, kept only custom positioned tooltip
- Reduced dot glow radius for cleaner appearance with low traffic volumes

**Data Pipeline Click-to-Detail Modals:**
- Placements Cache: record count, cache age, breakdown by instance
- Sessions Cache: record count, cache age, breakdown by instance
- GA Realtime: active users, page views, device breakdown, data coverage, pipeline health
- Instance Connectivity: status summary, list of any failing instances
- Server endpoint enriched with per-instance counts and GA latest summary

**Layout:**
- Instance grid gap increased (20px → 24px) for better vertical spacing
- GA Realtime tile shows "X active" instead of raw snapshot count

**Bug Fixes:**
- Pipeline tile showed "686 snapshots" (meaningless) — now shows active user count
- Map dots all appeared same green due to newer bucket dots covering older ones

## Mar 27-28, 2026 (Session 15)

### Success Dashboard (formerly Operations Command Center)
Two-day build session transforming the ops kiosk into a full command center.

**Renamed**: Operations Dashboard → Success Dashboard

**Persistent Header:**
- Time window indicator (24 HOURS / 3 DAYS / 7 DAYS) cycles with view
- Funnel KPIs: Sessions → Jobs → Linked → Success Rate → System Rate → Successful
- Health dot (5 signals), clock, play/pause button (SVG, 62x62), exit button
- All KPIs match current view window

**Butterfly Timeline:**
- CardSavr sessions/jobs hang down from top, GA traffic grows up from bottom
- Hourly bars compress for wider views (2px/1px/0px gap for 1d/3d/7d)
- Label channel between two midlines for readable hour labels
- GA standard data: funnel page colors (Select/User Data/Credentials — purple tones)
- GA realtime data: device colors (Mobile/Desktop/Tablet — blue/gray/teal)
- Tooltips show both CardSavr and GA data per hour column

**GA Data Pipeline:**
- GA property timezone fix: America/Los_Angeles → UTC conversion
- Hourly unique users query (totalUsers, properly deduplicated)
- deviceCategory added to GA fetch dimensions
- Standard GA refresh every 1 hour (re-fetches last 7 days)
- Realtime snapshots every 5 minutes (rolling 7-day retention)
- Pacific date loading for GA files (extra day buffer for timezone boundary)
- GA data backfilled — stored files were missing ~50% of rows

**View Rotation:**
- 3 views: 24 Hours, 3 Days, 7 Days (15-second cycle)
- Progress bar wave: blue fills → background pushes → repeat
- Play/pause button with spacebar toggle
- Arrow keys for manual navigation
- Any interaction pauses, resumes after 1 min inactivity
- Modals pause rotation, restore previous state on close

**Data Accuracy:**
- Live sessions cache (15-min poll) — fixes missing browse-only sessions
- Feed summary with unique session IDs, linked jobs, system success rate
- Success Rate = successful / all jobs (harsh truth)
- System Rate = successful / linked (when system was in play)
- Uncapped allEvents for timeline, 100-event cap for feed display only
- Volume chart: 6-hour buckets (1-day), daily (3d/7d), from feed data
- Merchant grid: by_merchant_by_day for per-window filtering
- Traffic health tiles: session counts, sparklines, banner all match view window

**Other:**
- Customer Success kiosk title fix
- Relative time: 48h+ shows decimal days (6.3d ago)
- Merchant modal: events match view window, scrollable, shows dates
- FI modal: stats match view window, bar chart highlights window days
- formatRelativeTime updated for multi-day feeds

---

## Mar 27, 2026 (Session 15 — original entry)

### Operations Command Center — Phase 1
Complete redesign of the ops dashboard kiosk mode into a command center.

**Persistent Header (always visible):**
- Live GA user count with device split (mobile/desktop/tablet), polled every 5 min
- 24h funnel KPIs: Sessions → Jobs → Linked → Success Rate → System Rate → Successful
- Composite health dot (5 signals: instance connectivity, data freshness, success rate, volume anomaly, merchant spikes)
- 60-second view cycle progress bar, clock, view label badge
- Detailed hover tooltips on every element

**Butterfly Timeline:**
- Rolling 24-hour window (left = 24h ago, right = now)
- Top half: CardSavr sessions/jobs hanging down, colored by status (success/failed/cancelled/abandoned/browse)
- Bottom half: GA realtime active users growing up (purple)
- Two data sources, visually distinct, same time axis
- Midline separator, NOW marker at right edge

**GA Realtime Snapshot Pipeline (new):**
- Server polls GA4 realtime API every 5 minutes
- Collects unifiedScreenName, minutesAgo, deviceCategory
- Stores snapshots in rolling 7-day array, persists to raw/ga-realtime/{date}.json
- Hydrates from disk on restart
- New endpoint: GET /api/ga-realtime-timeline (cached, zero API cost)

**Live Sessions Cache (new):**
- Server polls CardSavr sessions every 15 minutes (parallels existing placements cache)
- Fixes gap where today's browse-only sessions were invisible until nightly batch
- 83 sessions cached vs ~35 previously visible

**Health Composite Endpoint (new):**
- GET /api/ops-health-composite — rolls up 5 signals into green/yellow/red
- Tracks instance failures per fetch cycle
- Computes system success rate (excludes UX failures)

**Data Accuracy Fixes:**
- Session counts now use unique session_ids (deduplicated)
- Feed summary computed from ALL events before 100-event display cap
- Timeline receives uncapped allEvents array
- "Jobs" correctly counts placement attempts, "Linked" counts jobs past credentials
- System Success Rate excludes cardholder-caused failures (UX_TERMINATIONS)

**Other:**
- Customer Success kiosk title fixed (was duplicating "CS Portfolio Dashboard")
- View rotation engine scaffolded for Phase 2 (3-day, 7-day views)
- KPI count-up animation with 15% minimum swing on each refresh
- Arrow key manual mode + 2-minute auto-resume

## Feb 28, 2026 (Session 14)

### Access Control Overhaul — 4 Levels → 9 Roles
- Replaced admin/internal/executive/limited with 9 intentional roles: **admin**, **core**, **internal**, **siteops**, **support**, **cs**, **executive**, **partner**, **fi**
- Each role has curated page access (PAGE_ACCESS_MAP) and nav structure (NAV_CONFIGS)
- Per-role landing pages: admin/core/internal/cs → Portfolio, siteops → Operations, support → Support Lookup, executive → Executive Summary, partner/fi → Cardholder Engagement
- `scoping.mjs`: Added `UNRESTRICTED_DATA_ROLES` set (admin, core, internal, siteops, support, cs), `"limited"` → `"fi"` backward compat normalization
- `passcode-gate.js`: Replaced 3 page-list arrays with single `PAGE_ACCESS_MAP` object + `LANDING_PAGES` map
- `nav.js`: Per-role `NAV_CONFIGS` with custom nav groups, view-as switcher expanded to all 9 roles
- `users.html`: 9-role badge CSS (light+dark), filter dropdown, reference table, modal dropdown, sort order, data access visibility
- `filters.js`: Extended filter hiding to partner/fi roles
- Updated admin checks across funnel-customer.html, funnel.html, supported-sites.html, operations-dashboard.js, login.html, index.html
- `serve-funnel.mjs`: Updated access whitelist, is_admin flag, troubleshoot isAdminUser checks to use `UNRESTRICTED_DATA_ROLES`
- Deleted `heatmap-demo.html`
- Added 8 test users (test-core through test-fi) for impersonation testing
- Backward compat: "full" → "admin", "limited" → "fi" everywhere

---

## Feb 28, 2026 (Session 13)

### fi_registry.json — Full Partner & Status Cleanup
- Audited all 301 FI entries across all instances; assigned correct partners to previously blank/Unknown FIs
- New partners introduced: `Swaystack`, `Direct`, `Test` (in addition to existing Alkami, DigitalOnboarding, PSCU, Marquis, MSU, OnDot)
- Discovered 3 unlabeled Swaystack FIs: `ovb` (Ohio Valley Bank), `ukfcu` (University of Kentucky FCU), `ontap` (On Tap)
- Added `status` field: `active`, `former`, `test`, `prospect` — human reference only, not used in data filtering
- Corrected fi_names: Soarion (formerly AFFCU), Ohio Valley Bank, University of Kentucky FCU
- Marked former/dropped FIs (Direct and Alkami) with `status: "former"`
- **SOP rule added**: Always pull from server before editing, always create timestamped backup before deploying, always ask before any production server action

### Maintenance Page — Registry Editor Updates
- Added **Status column** to FI registry table
- Added **Status dropdown** to editor form (active, former, test, prospect)
- Updated **partner datalist** with all current partners (Swaystack, Direct, OnDot, Test; removed stale "Direct ss01" and "Advancial" entries)

### CLAUDE.md / MEMORY.md
- Cleaned up completed backlog items (Motivation Distribution label, nav on Experience page, Playbook removed from nav, Executive Narrative)
- Added production server Cardinal Rule and data file SOP to both files

## Feb 27, 2026 (Session 12)

### Cardholder Experience Page (NEW)
- **New page**: `public/experience.html` — full timing analysis of the CardUpdatr cardholder journey. Admin/internal only (Analysis nav group).
- **4 sections**:
  1. **Journey Overview**: 4 metric cards (sessions analyzed, avg duration, sessions with jobs %, avg jobs/session) + horizontal waterfall SVG showing 6 color-coded phases proportionally (Select Merchants → User Data → Credential Entry → Queue/Startup → Login & Link → Card Placement). CSV download button exports one row per job with all timing phases.
  2. **Page Timing Deep-Dive**: 3 sub-panels (one per clickstream page) each with stats row (median/avg/P25/P75/P90/N), histogram SVG distribution, and insight callout.
  3. **Job Timing Analysis**: Aggregate stat cards (avg queue/login/placement, fastest/slowest merchant) + sortable top-30 merchant table with inline stacked bar visuals.
  4. **Session Explorer**: Search/filter/sort controls, paginated session table (25/page), click-to-expand with full timeline SVG (clickstream pills + per-job phase bars on time axis with success/fail indicators).
- **Toggles**: Session outcome (All/Successful/Failed/No Jobs) + Integration (All/SSO/Non-SSO) — recalculate everything live.
- **Server change**: Added `account_linked_on` to `mapPlacementToJob()` return object (additive, non-breaking). Enables queue→login→placement phase decomposition per job.
- **Infrastructure**: `/experience` route in serve-funnel.mjs, nav entry in Analysis group, filter dispatch in filters.js.
- **Light-mode theming**: Uses CSS variables from `sis-shared.css` (`--panel`, `--surface`, `--text`, `--muted`, `--border`, etc.). SVG renders read variables via `svgColors()` helper at render time.
- **Clickstream timestamp fix**: Server normalizes to `{ url, page_title, at }` — page reads `at || timestamp || time` (matching ux-paths.js pattern).
- **Job phase label refinement**: Investigated actual timing distributions from 14-day sample (23K+ jobs). Phase 1 (`created_on` → `ready_on`) is VBS infrastructure startup (median 17s, tight clustering) not user input. Relabeled: "Queue + Startup" / "Account Linking" / "Card Placement".
- **Technical info popover**: "i" button on Journey Overview opens detailed overlay explaining data flow, timestamp meanings, null handling, observed distributions, and CSV format.
- **PDF technical reference**: `scripts/gen-experience-pdf.mjs` generates `public/exports/experience-technical-reference.pdf` via Puppeteer — shareable with engineering.

### Job Outcome Breakdown Modal (prior uncommitted work)
- Click-to-modal on all 5 breakdown cards (`funnel.html`): stats row, top-10 merchant bars, callout insights, 90-day trend section with Daily + Weekly side-by-side charts.
- Stacked bars for sysrate/overall, single-color bars for success/system/ux. Linear regression trend lines per series.
- Mobile CSS fix: breakdown grid uses `repeat(5, 1fr)` on desktop.

---

## Feb 27, 2026 (Session 11)

### Customer-Facing Support Lookup Page (NEW)
- **Goal**: FI support staff receive calls from cardholders ("I tried to update my card at Netflix and it didn't work"). They need to look up the session, see a plain-English explanation, know what to tell the cardholder, and copy a reference block for Strivve's helpdesk. The existing troubleshoot page is admin-only and exposes raw data — too complex and not safe for partners.
- **New page**: `public/troubleshoot-customer.html` — IIFE-wrapped, dark mode, mobile responsive
  - Date preset filters (Today, 3, 7, 14, 30 days), merchant text search, status filter (All/Issues/Success)
  - Context badge auto-populated with user's scoped FI names
  - Summary stat cards (Total / Successful / Issues)
  - Session cards with color-coded severity badges (green/amber/red), merchant name, plain-English explanation, suggested cardholder action
  - "Copy for Strivve Support" button generates formatted reference block with local + UTC time
  - Zero-job sessions shown with "cardholder didn't select any merchants" message
  - Admin overlay link to raw troubleshoot page (`.admin-overlay` pattern)
  - Timezone-aware via `sis-timezone` localStorage key

- **New export**: `CUSTOMER_TERMINATION_MAP` in `src/config/terminationMap.mjs`
  - 15 termination codes mapped to `explanation` (plain English), `action` (what to tell cardholder), `severity` (success/warning/error)
  - Separate from admin-facing `TERMINATION_RULES` — customer-safe language only

- **Server-side security** (`scripts/serve-funnel.mjs`):
  - `/troubleshoot/options`: Now requires auth (was open). Scopes FI list via `computeAllowedFis`. Returns `isAdmin` flag.
  - `/troubleshoot/day`: Now requires auth. Enforces FI scoping. Non-admin: `includeTests` forced false.
  - `?customer=true` field stripping (non-admin only): Strips `clickstream`, `placements_raw`, `cuid`, `source`, `id`, `fi_lookup_key`, `integration_raw`, `status_message`, `source_integration`. Enriches jobs with `customer_explanation`, `customer_action`, `customer_severity`.
  - Route added: `/troubleshoot-customer` → `troubleshoot-customer.html`

- **Admin troubleshoot backward compat**: Added `authHeaders()` helper and Bearer token to both fetch calls in `troubleshoot.html` (was missing — worked before because endpoints didn't require auth)

- **Access control**:
  - `passcode-gate.js`: Added to `EXECUTIVE_PAGES` (NOT `LIMITED_PAGES` — intentionally held back from limited users for now)
  - `nav.js`: "Support Lookup" in Monitoring group (admin/internal) and Dashboards group (executive)
  - **Decision**: Limited users gated for now — can be enabled by adding to `LIMITED_PAGES` and limited nav array

- **Design decisions**:
  - One card per job (not per session) — each merchant attempt gets its own card with its own explanation
  - Client-side merchant search and status filtering for instant feedback
  - No FI picker — context auto-determined from user's scoped FIs
  - Reference ID shown truncated (14 chars), full on hover, full in clipboard block
  - Copy block format: structured text with Reference, FI, Date (local + UTC), Merchant, Issue

## Feb 26, 2026 (Session 10)

### Fix Small-N Best-Week Inflation in Insights + Projections
- **Problem**: NASA FCU QBR cited 33.3% as aspirational baseline — but that came from a 6-session week (2/6). The credible "Best Success Rate at Scale" entry (24.3% on 37 sessions) was already computed but not used for narratives or projections.
- **Fix** (`engagement-insights.js`): `findBestWeekEntry()` now prefers the "Best Success Rate at Scale" highlight entry (above-median volume). Falls back to highest-rate entry only if no at-scale entry exists.
- **Fix** (`funnel-customer.html`): PDF export in QBR mode now passes `qbrBestQuarterRate` to `computeProjections()`, matching the on-screen QBR summary behavior. Previously, PDF projections always used raw best-week rate even in QBR mode.
- **Impact**: NASA QBR now shows 24.3% (37 sessions) instead of 33.3% (6 sessions) as the best-week baseline; growth projections become credible instead of inflated.

### FI-Key Scoping for Limited/Executive Users
- **Refactor**: Extracted scoping helpers into `src/lib/scoping.mjs` (normalizeFiKey, canonicalInstance, parseListParam, normalizeUserAccessFields, computeAllowedFis)
- **Fix**: `getVisibleRows()` on both `funnel.html` and `funnel-customer.html` now enforces `user.fi_keys` scoping in addition to existing instance_keys/partner_keys scoping
- **Tests**: Added `scripts/smoke-test-scoping.mjs` and `scripts/smoke-test-api-scoping.mjs`

## Feb 26, 2026 (Session 9)

### Ops Dashboard — Projected Baseline Label Clarity
- **Problem**: "% of Baseline" metric compared today's **projected** full-day total (extrapolated from partial-day data) against the 14-day median, but was labeled as if it were an actual measurement — misleading, especially early in the day
- **Fix** (`operations-dashboard.js`): All instances now labeled as projected:
  - Card tiles: `"109% of baseline, proj"`
  - Detail view stat label: `"% of Baseline (proj)"`
  - Tooltip: `"% of baseline (projected): 109%"`

### Ops Dashboard — Hours Since Last for All FIs
- **Problem**: `hours_since_last` was only computed for "dark" or "low" status FIs — normal/sleeping FIs showed "N/A" in the detail view even when session timestamps were available
- **Fix** (`serve-funnel.mjs`): Removed the `if (status === "dark" || status === "low")` guard so `hours_since_last` is computed for all FIs by scanning `fiDayLatest` timestamps

---

## Feb 26, 2026 (Session 8)

### Ops Feed — Session Events for Job-less CardUpdatr Launches
- **Problem**: FIs with sessions but no jobs (cardholder launched CardUpdatr but didn't update cards) were invisible in the live event feed, even though they appeared on traffic-health tiles
- **Server** (`serve-funnel.mjs` `/api/metrics/ops-feed`):
  - After building placement/job events, collects `agent_session_id` values into a `sessionsWithJobs` Set
  - Reads session files for same `fileDaysToRead` days via `readSessionDay()`
  - Creates `"session"` status events for sessions with `total_jobs === 0` not already in placement Set
  - Skips test instances, merges into events array before cutoff/sort/slice(100)
- **Client** (`operations-dashboard.js`):
  - Purple "Sess" pill in feed filter bar (`#8b5cf6`)
  - Session events show em-dash for merchant, custom tooltip explaining no-job sessions
  - Default statuses include "session", clear/reset includes it, size check updated 4→5
- **CSS** (`dashboards.css`): `.event-feed__status.session` purple styling

### Branded Expired Magic Link Page
- **Problem**: Clicking an expired magic link showed a dead-end "Signing In..." view with hidden spinner and plain "Invalid or expired link" text — no way to recover
- **Fix** (`login.html`): New `#expired-view` with branded UX:
  - Hourglass icon + "That link has expired" heading
  - Explains single-use / 15-min expiry, offers inline email form to send fresh link
  - Same `/auth/request-link` endpoint, success/error feedback
  - Tagline: "Unlock insights that move the needle. — Strivve CardUpdatr"
  - `replaceState` cleans expired `?token=` from URL so refresh shows normal login

### AI Insights Engine + Timezone Selector (infrastructure from prior sessions, uncommitted)
- AI insights endpoint (`/api/ai-insights`), cache stats/clear endpoints
- `scripts/ai-insights.mjs` module (new file)
- Timezone selector widget in Ops kiosk header
- `createTimezoneSelect()` in dashboard-utils.js
- Various supporting changes in data-cache.js, portfolio-dashboard.js, operations.html, portfolio.html

## Feb 25, 2026 (Session 7)

### Timezone-Aware Date Bucketing for Ops & Portfolio Dashboards
- **Problem**: After 4 PM Pacific (UTC date rolls to next day), Ops Command Center showed "Today" as the UTC date with ~1 session, "Yesterday" was actually today Pacific, and live feed was empty
- **Root cause**: All date math used UTC — `toISOString().slice(0,10)`, `getUTCHours()`, `new Date(...T00:00:00Z)`
- **Fix**: Client sends IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) to server via `?tz=` param; server re-buckets sessions by user's local date
- **Server changes** (`serve-funnel.mjs`):
  - 4 new helpers: `isValidTimezone()`, `tzDateInfo()`, `utcToLocalDate()`, `utcToLocalHour()`
  - `/api/traffic-health`: parses `?tz=`, reads extra UTC files on timezone boundary edges, re-buckets sessions by local date, uses local midnight for `todayStartIso` and `hoursElapsed`, local hour for fingerprints
  - `/api/metrics/ops-feed`: parses `?tz=`, reads extra batch files when local yesterday < UTC yesterday
  - Cache: replaced single `_trafficHealthCache` with `_trafficHealthCacheMap` (per-timezone, evicts at >10 entries)
  - Background monitor stays UTC via `"__utc__"` cache key
- **Client changes**:
  - `dashboard-utils.js`: `buildDateRange()` uses local date getters; new exports `formatLocalDate()`, `getLocalTimezone()`
  - `operations-dashboard.js`: sends `?tz=` on traffic-health and ops-feed calls; `fetchOpsTrends()` uses local date math
  - `portfolio-dashboard.js`: `fetchWeeklyTrends()` uses local date math
- **Backward compatible**: no `?tz=` param = UTC behavior (same as before)

## Feb 25, 2026 (Session 6)

### CLAUDE.md Context Reduction
- Moved full Build History (~600 lines) from CLAUDE.md to new `CHANGELOG.md` — reduces context window usage by ~77% (789 → 181 lines)
- Reference Partner Data (NASA FCU) also moved to CHANGELOG.md
- End-of-Session Protocol updated: "commit" → "commit & push" with `git log --oneline origin/main..HEAD` verification step (previous session failed to push 3 commits)

### AI-Powered Insights Engine — Planning
- Full architecture plan documented in `docs/ai-insights-plan.md`
- Proposal: Replace 50+ hardcoded rule-based insights with Claude API (Haiku 4.5) generated insights
- Server-side only, on-demand with caching, existing auth gates access
- System prompt loaded with: motivation spectrum, tone directives, full ACTION_LIBRARY, benchmarking philosophy
- Estimated cost: $20-50/mo at normal usage, $0 when idle (pay-per-call, no subscription)
- Business Anthropic API account (console.anthropic.com) — decision to use work billing from day one
- Added to CLAUDE.md "What's Pending / Queued" with blocker noted

### Housekeeping
- Added scratch/test files to `.gitignore` (fi-api-guide.pdf, ga-test-review-output*.json, generate-fi-api-guide.mjs, test-fi-api.mjs)

## Feb 25, 2026 (Session 5)

### Users Page — Send Invite Link + View As User
- **Send Invite**: "Send Link" button (envelope icon) on each user row in `users.html`. Triggers `POST /api/users/send-invite` → generates magic token with **7-day expiry** (`INVITE_TOKEN_EXPIRY_MS`) → sends branded onboarding email via SendGrid
  - Email subject: "Your CardUpdatr Engagement Dashboard is ready"
  - Body: SIS (Strivve Insights Service) branding, 4-bullet feature overview, "Open Your Dashboard" CTA, password-free explanation
  - Separate from login magic link email (15-min expiry, unchanged)
  - Disabled for disabled users
  - "Send invite email" checkbox in Add User modal — checked by default for new users, hidden for edits
- **View As User**: "View As" button (eye icon) opens new tab impersonating that user's full profile (access_level + instance/partner/FI keys)
  - Sets impersonation in `sessionStorage` (`sis_impersonate_user`) before `window.open`, clears in original tab after 100ms
  - `passcode-gate.js`: `getEffectiveUser()` returns impersonated user, `getAccessLevel()` returns impersonated level, new API: `sisAuth.setImpersonation()`, `clearImpersonation()`, `isImpersonating()`, `getRealUser()`
  - `nav.js`: amber banner "Viewing as: Name (email) — level" with Exit button. Exit calls `window.close()` (falls back to `location.replace`). View-as role switcher hidden during impersonation
  - `checkPageAccess()` skips redirects during impersonation (same as view-as)
  - Data scoping works automatically — `getVisibleRows()` reads from `sisAuth.getUser()` which returns impersonated profile
- **Uniform action buttons**: All 4 buttons (Send Link, View As, Edit, Del) use `.btn-icon` class with SVG icons, same size
- **Files**: `users.html`, `passcode-gate.js`, `nav.js`, `serve-funnel.mjs`

### Executive Access Level Bug Fix
- Server-side user save (`serve-funnel.mjs` line 5513) was missing `"executive"` in the access_level whitelist — silently defaulted to `"limited"`. Fixed.

### Ops Event Feed — Exclude customer-dev
- Added `instance` field to `/api/metrics/ops-feed` response events (was being discarded)
- "Exclude customer-dev" checkbox in feed filter bar, checked by default
- `state.feedFilters.excludeDevInstance` flag, resets on Clear
- **Files**: `serve-funnel.mjs`, `operations.html`, `operations-dashboard.js`, `dashboards.css`

### Customer Dashboard — Instance Scoping + GA Display Fixes
- `getVisibleRows()` now enforces user's `instance_keys` scoping even when instance dropdown is hidden (limited/executive users)
- GA columns show "—" with tooltip for FIs with no GA configured instead of misleading zeroes
- **Files**: `funnel-customer.html`

## Feb 25, 2026 (Session 4)

### Per-FI Traffic Fingerprints — Time-of-Day Aware Alerting
- **Problem**: Traffic health monitoring used a flat daily baseline, causing false "dark" and "low" alerts at night (e.g., Elevations "LOW" at 10pm, American Eagle "DARK" at night) because zero traffic is completely normal during overnight hours
- **Solution**: Two-tier hourly fingerprinting system built from 14-day baseline session timestamps
  - **Tier 1** (≥10 sessions/day): Full 24-element cumulative fingerprint with 3-hour rolling average smoothing. Compares actual sessions-so-far against expected cumulative for the current UTC hour. Sleeping when expectation < 2, dark when 0 sessions but expectation > 2, low when < 40% of expectation
  - **Tier 2** (5-10 sessions/day): Quiet-hours mask — hours with ≤1 total session across 14-day baseline trigger "sleeping" status, non-quiet hours use existing flat baseline logic
  - **Tier 3** (<5 sessions/day): Unchanged (already filtered by minDailySessions threshold)
- **New status: `sleeping`**: Expected quiet period — not an outage, not actionable
  - Indigo-tinted tiles with CSS-animated "zzz" indicator on ops dashboard
  - Collapsible group in non-kiosk view (between anomalies and normals)
  - Sorted to end in kiosk mode (after normal, not actionable)
  - Skipped entirely in email alerts (same as normal)
  - Clears prior alert state when FI enters sleeping
- **API response additions**: `fingerprint_tier` (1|2|3), `expected_cumulative` (Tier 1), `pct_of_expected` (Tier 1), `quiet_hours` (Tier 2), `sleeping` count in summary
- **Cache TTL**: Bumped from 2 minutes to 15 minutes to match background monitor cycle — eliminates unnecessary CardSavr API calls from kiosk auto-refresh
- **Files**: `scripts/serve-funnel.mjs` (fingerprint building + status classification in both endpoint and background monitor, alert skip, email template, cache TTL), `public/assets/js/operations-dashboard.js` (sleeping tile rendering, banner, sort order, detail modal colors), `public/assets/css/dashboards.css` (sleeping tile/badge/zzz styles, light + dark theme), `public/assets/js/dashboard-utils.js` (trafficHealthColor indigo)

## Feb 24, 2026 (Session 4 — Evening)

### Portfolio Kiosk Polish Pass
- **FI grid**: Removed low-volume split/toggle — all FIs shown, sorted by sessions. Changed from `auto-fill` responsive grid to fixed 5-column layout with vertical scroll (`max-height: calc(100vh - 200px)`)
- **Boxed panels**: FI grid and Early Warnings both wrapped in panel containers (`background: var(--panel)`, `border`, `border-radius: 14px`) matching Ops kiosk visual language
- **Distributions removed**: Tier/Score distribution section removed from kiosk right column
- **Early Warnings restyled**: Changed from stacked alert boxes to event-feed style — clean rows with `border-bottom` separators, sticky column header (TYPE | WARNING), category pills (SYSTEM amber, ENGAGEMENT blue) at fixed `11ch` width for columnar text alignment. Scrolls vertically within panel.
- **Severity tinting unified**: Portfolio card danger/warn opacity bumped to match Ops (danger: 18% red bg, warn: 15% amber bg). White text on danger cards for contrast.
- **Network chart averages**: Added 7-day (dashed, 60% opacity) and 30-day (dotted, 55% opacity) trailing average lines for both sessions and success rate. Color-matched to their series (blue/green).
- **Legend cleanup**: Replaced tiny SVG swatches with clean CSS elements — colored squares/circles for data series, dashed/dotted borders for averages. Bumped font to 0.75rem.
- **Renamed**: "Network Trend (7 days)" → "FI Session Traffic (7 days)"
- **Files**: `portfolio-dashboard.js`, `dashboards.css`, `portfolio.html`

## Feb 25, 2026 (Session 3)

### Portfolio Kiosk Split-Column Layout
- **Problem**: Portfolio kiosk was a flat single-column layout (KPIs → warnings → FI grid), visually uncompelling compared to Ops kiosk's split-column design
- **Solution**: Transformed to matching split-column layout (`kiosk-main-split` grid, `5fr 2fr`)
  - **Left column**: FI card grid sorted by sessions (highest first), with severity coloring — `.partner-card--danger` (score<25 or rate<5%), `.partner-card--warn` (score<50 or rate<15%)
  - **Right column**: 7-day network trend chart (SVG dual y-axis: session bars + success rate line), early warnings panel, compact tier + score distributions
  - **KPI row**: 4 sparkline cards (Success Rate, Sessions, Placements, System Health) with prior-week dashed average + delta badges. Active FIs count moved to header subtitle
  - **Sparklines**: Reused Ops pattern (`buildPortfolioKpiSparkline()` — 260x56 viewBox, area fill + solid line + dashed prior-week avg)
  - **Verbose tooltips**: Multi-line detail on all kiosk FI cards (score breakdown, tier, sessions, rate, trend)
- **Files**: `portfolio.html` (HTML containers), `portfolio-dashboard.js` (~500 lines new/modified), `dashboards.css` (severity classes, chart/panel styling, distributions)

### Kiosk Spacing Alignment (Ops + Portfolio)
- **Problem**: Gap between header and KPI cards differed between Ops and Portfolio kiosk views when displayed side-by-side on two 27" monitors
- **Root cause**: Two `<section style="margin-top: 22px;">` wrappers in `operations.html` (merchant table, FI table) were NOT being hidden by `initKioskLayout()` — only their children were hidden. These empty sections contributed 44px of ghost spacing
- **Fix**: Added `.dashboard-shell > section` to the Ops `initKioskLayout()` hide selector. Set both pages' `#kioskKpiRow` to `margin-top:16px` inline for exact match
- **Files**: `operations-dashboard.js` (hide selector fix), `operations.html` + `portfolio.html` (inline margin)

### Ops by_day Data Enhancement
- Added `Jobs_Success` and `merchants_active` fields to ops `/api/metrics/ops` `by_day` response data (needed for Portfolio kiosk System Health sparkline)
- **File**: `scripts/serve-funnel.mjs`

## Feb 25, 2026 (Session 2)

### Live Placement Event Feed
- **Problem**: Ops event feed read from batch placement files generated once/day by cron — today's file didn't exist, so the feed showed no recent data despite active traffic
- **Solution**: Background fetch every 15 minutes pulls today's placements live from CardSavr API across all 8 instances, cached in module-level `_livePlacementsCache`. Ops-feed endpoint reads from cache for today, batch file for yesterday. Piggybacks on existing 15-min traffic alert cycle (offset 30s to avoid API storms)
- **Fallback**: If cache not yet populated, falls back to batch file
- **Files**: `scripts/serve-funnel.mjs` (background fetch + endpoint change)

### Ops Kiosk Layout Overhaul
- **Layout restructured**: Single `kiosk-main-split` with left column (FI tiles + merchant tiles) and right column (volume chart + event feed). Grid split `5fr 2fr`
- **FI tiles**: Horizontal scroll (`.kiosk-fi-scroll`, flex row, `overflow-x: auto`), sorted by highest avg sessions/day
- **Merchant tiles**: 6-column vertical scroll (`.kiosk-merchant-scroll`, 4 rows visible, JS `capRightColumnHeight()` aligns bottom with right column)
- **Merchant detail modals**: Click-to-open with health bar, stats grid (jobs/success/failed/fail rate), week-over-week comparison, top error code, recent activity (24h) filtered by merchant
- **Merchant tile 2x2 metrics**: Jobs, Success, Failed, Fail Rate in grid layout with severity coloring
- **Event feed enhancements**: 24h window (reads today + yesterday files), column headers (Time/Merchant/FI/Status), merchant column 20ch fixed width, Vercel data filtered server-side
- **Volume chart**: Responsive SVG with viewBox, Y-axis labels with dashed gridlines, 8-day window
- **Files**: `public/assets/css/dashboards.css`, `public/assets/js/operations-dashboard.js`, `public/dashboards/operations.html`, `scripts/serve-funnel.mjs`

### Portfolio FI Card Fix
- **Problem**: FI card text (Sessions, Success %, Score) clipped in kiosk mode at 240px card width
- **Fix**: Changed `.partner-card__metrics` from flex row to 2x2 CSS grid. Reordered metrics: Score + Sessions (left), 4-wk vol + Success (right)
- **Files**: `public/assets/js/portfolio-dashboard.js`, `public/assets/css/dashboards.css`

## Feb 25, 2026 (Session 1)

### Portfolio Dashboard — Low-Volume FI Group
- **Problem**: FIs with very few sessions produce noisy/meaningless engagement scores, cluttering the card grid
- **Solution**: Split FI card grid into Active (>=25 sessions) and Low Volume groups. Low-volume group is collapsed by default with a "Low Volume (N FIs)" toggle
- **Both views**: Regular dashboard and kiosk mode (`?kiosk=1`) use the same split. Module-level `lowVolumeExpanded` flag persists across kiosk auto-refresh cycles
- **Refactored**: Card-building extracted into `buildFiCard()` (regular) and `buildKioskCard()` (kiosk) helper functions
- **Files**: `public/assets/js/portfolio-dashboard.js`

### Traffic Health — Midnight False-Dark Fix
- **Problem**: Every night at ~00:00-00:30 UTC, all FIs went "dark" on the ops dashboard because yesterday's daily session file hasn't been generated yet (created at 00:30 UTC). The code checked `dayCounts.get(baselineEndStr)` (literally yesterday) which returned 0
- **Fix**: Instead of hardcoding yesterday, walk backward through the 14-day baseline array and use the most recent day with actual data. Fixed in both the `/api/traffic-health` endpoint and `computeTrafficHealthDirect()` background monitor
- **Files**: `scripts/serve-funnel.mjs` (two code paths)

### Ops Dashboard — Merchant Tile Severity Coloring
- **Merchant tiles**: Added `.merchant-tile--warn` (amber, >15% fail) and `.merchant-tile--danger` (red, >=40% fail) severity classes with background tinting
- **Kiosk layout**: Fixed volume chart overflow with `min-width:0;overflow:hidden` on the right column of the kiosk split
- **Files**: `public/assets/css/dashboards.css`, `public/assets/js/operations-dashboard.js`, `public/dashboards/operations.html`

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

# Reference Partner Data (NASA FCU)

Used throughout design as the working example:
- 90-day window (Nov 17, 2025 - Feb 14, 2026): 223 launches, 789 sessions, 2.5% success, 22 placements
- Select→Credential: 12.7% (vs 18.3% for motivated traffic)
- Best 7-day window: 8.0% (Jan 14-20, 2026)
- Monthly reach: 0.1%
- Integration: SSO via Alkami
- Full-year 2025: 11.6% success, 140 placements — decline in H2 mirrors MSUFCU pattern when activation pushes tapered
