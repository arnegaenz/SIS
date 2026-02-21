# SIS Application Review — Full Holistic Analysis

*Generated: Feb 21, 2026*

---

## Table of Contents

1. [What SIS Is](#what-sis-is)
2. [User Roles & Access Levels](#user-roles--access-levels)
3. [Current Navigation Structure](#current-navigation-structure)
4. [Complete Page Inventory](#complete-page-inventory)
5. [Homepage (index.html)](#homepage)
6. [API Endpoints Inventory](#api-endpoints-inventory)
7. [JavaScript Architecture](#javascript-architecture)
8. [CSS & Theming](#css--theming)
9. [Orphaned & Dead Pages](#orphaned--dead-pages)
10. [Problems & Observations](#problems--observations)
11. [Suggested Reorganization](#suggested-reorganization)
12. [Other Improvement Suggestions](#other-improvement-suggestions)

---

## What SIS Is

SIS (Strivve Insights Service) is a **metrics, analytics, and operational platform** for Strivve's CardUpdatr product. It serves three distinct audiences:

| Audience | What They Need | Primary Pages |
|----------|---------------|---------------|
| **Strivve internal team** (admin/internal) | Full operational visibility, debugging, raw data, unvarnished metrics | Funnel, Troubleshoot, Ops Dashboard, Heatmap, all admin pages |
| **Partners** (limited users + share links) | Engagement metrics, insights, recommended actions, projections | Cardholder Engagement Dashboard only |
| **Command center displays** (kiosk mode) | Wall-mounted monitoring, auto-refresh, at-a-glance health | CS Portfolio `?kiosk=1`, Operations `?kiosk=1` |

The platform runs on a single Node.js server (no Express — raw `http` module) on AWS Lightsail, with PM2 process management. Authentication is via magic link email → session token.

---

## User Roles & Access Levels

| Level | Description | Nav Groups Visible | Redirect |
|-------|------------|-------------------|----------|
| **admin** | Full access to everything | All 5 groups | Homepage |
| **full** | Legacy term, treated identically to admin | All 5 groups | Homepage |
| **internal** | All pages except Admin group; excludes `adminOnly` items | 4 groups (no Admin) | Homepage |
| **limited** | Customer-facing only | 1 group ("Dashboards" → Cardholder Engagement) | funnel-customer.html |
| **(view mode)** | Share link viewer, read-only | No nav (branded header only) | N/A |
| **(no auth)** | Not logged in | None | login.html |

**Access scoping**: Limited users can also be scoped to specific partners, instances, or FIs via `partner_keys`, `instance_keys`, `fi_keys` in their user record.

---

## Current Navigation Structure

### Nav Groups (from nav.js)

#### 1. Conversions (7 items)
| Item | Page | Who Sees It |
|------|------|------------|
| FI Funnel | `funnel.html` | admin, full, internal |
| Cardholder Engagement | `funnel-customer.html` | admin, full, internal |
| Customer Success Dashboard | `dashboards/customer-success.html` | admin, full, internal |
| CS Portfolio | `dashboards/portfolio.html` | admin, full, internal |
| Sources | `sources.html` | admin, full, internal |
| UX Paths | `ux-paths.html` | admin, full, internal |
| Placement Outcomes | `placement-outcomes.html` | admin, full, internal |

#### 2. Reliability (2 items)
| Item | Page | Who Sees It |
|------|------|------------|
| Merchant Heatmap | `heatmap.html` | admin, full, internal |
| Alerts & Watchlist | `watchlist.html` | admin, full, internal |

#### 3. Ops (5 items)
| Item | Page | Who Sees It |
|------|------|------------|
| Operations Dashboard | `dashboards/operations.html` | admin, full, internal |
| Troubleshoot | `troubleshoot.html` | admin, full, internal |
| Real-Time | `realtime.html` | admin, full, internal |
| Synthetic Traffic | `synthetic-traffic.html` | admin, full only (`adminOnly`) |
| FI API | `fi-api.html` | admin, full, internal |

#### 4. Tools (1 item)
| Item | Page | Who Sees It |
|------|------|------------|
| Campaign URL Builder | `campaign-builder.html` | admin, full, internal |

#### 5. Admin (5 items — `fullAccessOnly` group)
| Item | Page | Who Sees It |
|------|------|------------|
| Data & Config | `maintenance.html` | admin, full only |
| Users | `users.html` | admin, full only |
| User Activity | `activity-log.html` | admin, full only |
| Shared Links | `shared-views.html` | admin, full only |
| Server Logs | `logs.html` | admin, full only |

#### Limited User Nav (special case)
| Item | Page |
|------|------|
| Cardholder Engagement | `funnel-customer.html` |

#### Additional (not in nav groups)
- **Home** link — appears for any authenticated user with nav groups
- **User info** — name + Sign Out button (right side of nav bar)
- **View mode** — "Read-only view" + "Log in to explore" link

---

## Complete Page Inventory

### Active Pages (in navigation)

| Page | File | Nav Group | Description |
|------|------|-----------|-------------|
| Homepage | `index.html` | Home link | Card grid with links to all main pages |
| FI Funnel | `funnel.html` | Conversions | Internal-only funnel: GA events → sessions → placements. Full termination data, failure breakdown, admin overlay. ~6900 lines. |
| Cardholder Engagement | `funnel-customer.html` | Conversions | **Flagship partner-facing page.** Positive-only metrics, insights engine, spectrum diagnosis, recommended actions, projections. Share links, QBR mode. ~5100 lines. |
| Customer Success Dashboard | `dashboards/customer-success.html` | Conversions | FI value snapshot: funnel conversion, SSO vs non-SSO, top source journeys. Kiosk mode. ES6 module. |
| CS Portfolio | `dashboards/portfolio.html` | Conversions | Book-of-business view: engagement scores, tier distribution, early warnings, FI card grid. Kiosk mode. ES6 module. ~750 lines JS. |
| Sources | `sources.html` | Conversions | Traffic source analysis by FI, partner, integration, instance. |
| UX Paths | `ux-paths.html` | Conversions | Cardholder journey/path analysis by source. |
| Placement Outcomes | `placement-outcomes.html` | Conversions | Monthly placement outcomes split by SSO vs non-SSO. |
| Merchant Heatmap | `heatmap.html` | Reliability | Merchant availability/health by FI over time. Color-coded grid. |
| Alerts & Watchlist | `watchlist.html` | Reliability | Week-over-week anomalies, traffic spikes/drops, reliability changes. |
| Operations Dashboard | `dashboards/operations.html` | Ops | Job success rates, merchant health, failure modes. Kiosk mode. ES6 module. |
| Troubleshoot | `troubleshoot.html` | Ops | Session and placement debugging. Query by FI, integration, date. Per-session clickstream, termination details. |
| Real-Time | `realtime.html` | Ops | Live session/placement data via Server-Sent Events from instance APIs. |
| Synthetic Traffic | `synthetic-traffic.html` | Ops (adminOnly) | Define and monitor synthetic placement jobs. View Sessions modal for raw data correlation. |
| FI API | `fi-api.html` | Ops | Browse live FI records from CardSavr API across all instances. **Note: does not call `renderHeaderNav` — missing nav header.** |
| Campaign URL Builder | `campaign-builder.html` | Tools | Form-based builder for tracked CardUpdatr launch URLs. QR code export, presets. |
| Data & Config | `maintenance.html` | Admin | Data refresh triggers, FI registry editing, merchant sites, instance management, share link settings. |
| Users | `users.html` | Admin | User management: create/edit/delete, set access levels, FI scoping. |
| User Activity | `activity-log.html` | Admin | Track user logins and page views. |
| Shared Links | `shared-views.html` | Admin | Track share link creation and views. |
| Server Logs | `logs.html` | Admin | Live server console output with search/filtering. |

### Active Pages (NOT in navigation but linked/accessible)

| Page | File | Accessed Via | Description |
|------|------|-------------|-------------|
| Login | `login.html` | Direct / redirect | Magic link authentication page |
| Engagement Playbook | `resources/engagement-playbook.html` | Links in action library drawers | Full playbook: all 6 sections, all channels/examples. PDF export. No nav header. |

### Orphaned Pages (no nav link, no functional reference)

| Page | File | Status | Notes |
|------|------|--------|-------|
| **Heatmap Demo** | `heatmap-demo.html` | **ORPHANED** | Mock data demo. Zero references in codebase. No nav link, no route, no incoming links. Accessible only by direct URL. |
| **FI API Billing** | `fi-api-billing.html` | **DEAD CODE** | Referenced only in login.html for `access_level === "billing"` — but no user has this level. No nav link, no nav header. Completely inaccessible in practice. |

---

## Homepage

The homepage (`index.html`) displays a **card grid** with links to 11 pages:

| Card | Link | Description |
|------|------|-------------|
| Customer Success Dashboard | `dashboards/customer-success.html` | FI value snapshot |
| Operations Dashboard | `dashboards/operations.html` | Operational health |
| Card Placement Funnel | `funnel.html` | GA → sessions → placements |
| Source Analysis | `sources.html` | SSO vs CU2_SSO traffic |
| Merchant Reach & Reliability | `heatmap.html` | Traffic, health, anomalies |
| Reliability & Anomaly Watch | `watchlist.html` | Week-over-week anomalies |
| Troubleshooting | `troubleshoot.html` | Session/placement drill-down |
| Issuer Ops & Data Health | `maintenance.html` | Data refresh, registry, credentials |
| FI API Data | `fi-api.html` | Live FI records |
| Server Logs | `logs.html` | Real-time server output |
| User Management | `users.html` | Manage access |

**Not on homepage** (but in nav): Cardholder Engagement, CS Portfolio, UX Paths, Placement Outcomes, Real-Time, Synthetic Traffic, Campaign URL Builder, Shared Links, User Activity.

**Homepage observations:**
- No access control on homepage cards — admin pages (Users, Logs, Maintenance) are visible to everyone who can see the homepage
- The homepage is essentially a sitemap, not a contextual landing page
- Missing several nav items (CS Portfolio, Cardholder Engagement, Real-Time, etc.)
- No data or status shown — just static links and descriptions

---

## API Endpoints Inventory

### Authentication (4 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/auth/request-link` | No | Request magic link email |
| GET | `/auth/verify` | No | Verify token, create session |
| GET | `/auth/me` | Yes | Get current user profile |
| POST | `/auth/logout` | Yes | Destroy session |

### Core Metrics (6 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET/POST | `/api/metrics/funnel` | Yes | Main funnel metrics (filtered by access) |
| GET/POST | `/api/metrics/ops` | Yes | Operations metrics |
| GET | `/api/metrics/ops-feed` | Yes | Last 50 placement events |
| GET | `/daily`, `/daily-range`, `/daily/*.json` | Yes | Daily aggregated data |
| GET | `/sources/summary` | Yes | Traffic source summary |
| GET | `/api/sessions/raw` | Yes | Raw session data |

### PDF Export (2 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/export-pdf` | Yes | Internal PDF (funnel.html) |
| POST | `/api/export-pdf-customer` | Yes | Customer PDF (funnel-customer.html) |

### Synthetic Traffic (7 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/synth/jobs` | Yes | List synthetic jobs |
| GET | `/api/synth/status` | Yes | Runner status |
| POST | `/api/synth/jobs` | Yes | Create job |
| POST | `/api/synth/jobs/:id/cancel` | Yes | Cancel job |
| POST | `/api/synth/jobs/:id/pause` | Yes | Pause job |
| POST | `/api/synth/jobs/:id/continue` | Yes | Resume job |
| GET | `/api/synth/jobs/:id/results` | Yes | Job results |
| GET | `/api/synth/jobs/:id/sessions` | Yes | Raw session correlation |

### Registry & Config (8 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/fi-registry` | Yes | FI registry |
| POST | `/fi-registry/update` | Admin | Update registry |
| POST | `/fi-registry/delete` | Admin | Delete entry |
| GET | `/api/share-settings` | Yes | Share link TTL |
| POST | `/api/share-settings` | Admin | Update TTL |
| GET/POST | `/instances/*` | Admin | Instance CRUD + test |
| GET/POST | `/ga/*` | Admin | GA credential CRUD + test |

### User Management (4 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/users` | Admin | List users |
| POST | `/api/users/save` | Admin | Create/update user |
| POST | `/api/users/delete` | Admin | Delete user |
| GET | `/api/filter-options` | Yes | Available filters for current user |

### Analytics & Logging (7 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/analytics/log` | Yes | Log client events |
| GET | `/analytics/activity` | Yes | Activity log |
| POST | `/api/qbr-log` | Admin | Log QBR events |
| GET | `/analytics/qbr-events` | Admin | QBR event history |
| GET | `/analytics/shared-views` | Admin | Share link log |
| POST | `/api/share-log` | Yes | Log share creation |
| GET | `/api/share-log/view` | Yes | Record share view |

### Troubleshooting & Data (6 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/troubleshoot/options` | Yes | Filter options |
| GET | `/troubleshoot/day` | Yes | Session detail for a day |
| GET | `/api/placement-details` | Yes | Enriched placement details |
| GET | `/api/check-raw-data` | Yes | Check raw data availability |
| GET | `/merchant-sites` | Yes | Available merchants |
| GET | `/merchant-heatmap` | Yes | Heatmap data |

### Real-Time (2 endpoints — SSE)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/realtime` | Yes | Session stream (Server-Sent Events) |
| GET | `/api/realtime-ga` | Yes | GA data stream (SSE) |

### Diagnostics (no auth — 5 endpoints)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/__diag` | No | File paths, git commit, uptime |
| GET | `/build-info` | No | Build commit & timestamp |
| GET | `/list-daily` | No | Available daily files |
| GET | `/data-freshness` | No | Data staleness check |
| GET | `/run-update/*` | No | Trigger/monitor data refresh |

**Total: ~55+ endpoints** in a single 6100-line server file.

---

## JavaScript Architecture

### Module Inventory (28 files, ~14,000 lines)

| File | Lines | Pattern | Exports | Used By |
|------|-------|---------|---------|---------|
| engagement-insights.js | 1,558 | IIFE | `window.EngagementInsights` | funnel-customer.html, portfolio |
| filters.js | 1,400 | IIFE | `window.__FILTER_STATE` | funnel, funnel-customer, sources, troubleshoot, heatmap |
| portfolio-dashboard.js | 1,446 | ES6 module | Side effects | portfolio.html |
| ux-paths.js | 1,341 | ES6 module | Side effects | ux-paths.html |
| synthetic-traffic.js | 1,258 | IIFE | Side effects | synthetic-traffic.html |
| customer-success-dashboard.js | 926 | ES6 module | Named exports | customer-success.html |
| sources.js | 924 | IIFE | Side effects | sources.html |
| operations-dashboard.js | 728 | ES6 module | Side effects | operations.html |
| nav.js | 610 | IIFE | Side effects | All pages |
| data-cache.js | 563 | IIFE | `window.DataCache` | funnel, funnel-customer, sources, heatmap |
| campaign-builder.js | 529 | IIFE | `window.__campaignBuilder` | campaign-builder.html |
| funnel.js | 416 | ES6 module | Side effects | funnel.html |
| placement-outcomes.js | 386 | IIFE | Side effects | placement-outcomes.html |
| passcode-gate.js | 310 | IIFE | `window.sisAuth` | All pages |
| dashboard-utils.js | 317 | ES6 module | Named exports | All /dashboards/ pages |
| action-library.js | 283 | IIFE | `window.ActionLibrary` | funnel-customer, portfolio, playbook |
| global-thresholds.js | 183 | ES6 module | Named exports | funnel, maintenance |
| global-thresholds.maintenance.js | 193 | ES6 module | Named exports | maintenance.html |
| config.js | 90 | IIFE | fetch wrapper | All pages |
| sis.js | 99 | IIFE | `window.sisRenderBus` etc. | All pages |
| card-tooltips.js | 99 | IIFE | Side effects | heatmap-demo |
| raw-data-checker.js | 97 | ES6 module | Named exports | funnel.html |
| funnel.kpi-status.js | 97 | ES6 module | Named exports | funnel.html |
| funnel.data.js | 61 | ES6 module | Named exports | funnel.html |
| funnel.view.js | 36 | ES6 module | Named exports | funnel.html |
| types.js | 40 | JSDoc | Type definitions | funnel modules |
| qrcode.min.js | 7 | Minified | `window.qrcode()` | campaign-builder |

### Key Architectural Patterns

- **No framework** — vanilla JS throughout, DOM manipulation via `document.createElement` and `innerHTML`
- **Two module systems in use** — IIFE (older pages) and ES6 modules (newer dashboard pages)
- **Cross-module communication** via `window.*` globals
- **Critical load order**: config.js → passcode-gate.js → action-library.js → engagement-insights.js
- **Inline scripts** in funnel.html (~6900 lines) and funnel-customer.html (~5100 lines) — these are the largest "files" in the system

### Window Globals (intentional exports)

| Global | Source | Purpose |
|--------|--------|---------|
| `window.ActionLibrary` | action-library.js | Shared content library |
| `window.EngagementInsights` | engagement-insights.js | Analytics engine |
| `window.sisAuth` | passcode-gate.js | Auth/access control |
| `window.__FILTER_STATE` | filters.js | Filter synchronization |
| `window.DataCache` | data-cache.js | IndexedDB + localStorage cache |
| `window.SIS_API_BASE` | config.js | API URL resolution |
| `window.sisRenderBus` | sis.js | Render event bus |
| `window.sisWarn()` | sis.js | Logging helper |
| `window.sisToast()` | sis.js | Toast notifications |
| `window.qrcode()` | qrcode.min.js | QR code library |

---

## CSS & Theming

### Shared Stylesheets

| File | Lines | Purpose |
|------|-------|---------|
| `sis-shared.css` | — | Global CSS variables for light/dark themes |
| `assets/css/sis.css` | 232 | Header/nav base styles, utility classes |
| `assets/css/dashboards.css` | 1,520 | Dashboard grid layouts, cards, tables, dark mode |
| `assets/css/filters.css` | 195 | Filter bar, multi-select dropdowns |
| `assets/css/funnel.css` | 138 | Funnel visualization, metric cards |
| `assets/css/mobile.css` | 778 | Responsive breakpoints, mobile nav |

### Theme System

- **Toggle**: Admin settings page has light/dark mode toggle
- **Persistence**: `localStorage("sis-theme")` → value `"dark"` or absent
- **FOUC prevention**: Inline `<script>` in `<head>` of every page reads localStorage before CSS loads
- **Variables**: `sis-shared.css` defines `--bg`, `--text`, `--panel`, `--muted`, `--hair`, `--hover-bg`, etc. for both `[data-theme="dark"]` and default
- **Override pattern**: `[data-theme="dark"] .some-class { ... }` in page-level `<style>` blocks

### Special CSS Modes

| Class | Trigger | Effect |
|-------|---------|--------|
| `.kiosk-mode` | `?kiosk=1` query param | Full-viewport, dark forced, nav hidden, auto-refresh |
| `.qbr-mode` | QBR date range preset | Shows QBR-specific sections |
| `.show-admin-overlay` | Admin/full access level | Shows admin-only content blocks |
| `.share-presentation-mode` | Share link view | Branded header, nav hidden, read-only |

---

## Orphaned & Dead Pages

### heatmap-demo.html — ORPHANED

- **Location**: `public/heatmap-demo.html`
- **What it is**: A demo/sandbox merchant health heatmap with randomized mock data
- **References in codebase**: **Zero.** Not in nav.js, not linked from any page, no server route.
- **How to access**: Only by typing the URL directly (falls through to SPA catch-all)
- **Recommendation**: **Delete** or move to a `/demos/` folder if needed for sales

### fi-api-billing.html — DEAD CODE

- **Location**: `public/fi-api-billing.html`
- **What it is**: A billing summary page for FI API data
- **References in codebase**: Only in `login.html` line 211: `if (level === "billing") return "./fi-api-billing.html"` — but **no user has `access_level === "billing"`** in the system
- **How to access**: Unreachable in practice. The redirect path is dead code.
- **Recommendation**: **Delete** both the page and the dead code path in login.html

### fi-api.html — Missing Nav Header

- **Location**: `public/fi-api.html`
- **Status**: Active (in nav, linked from homepage), but does NOT call `renderHeaderNav()` — so when you land on it, there's no standard nav bar at the top
- **Recommendation**: Add `renderHeaderNav({ currentId: "fi-api", title: "FI API Data" })` call

---

## Problems & Observations

### 1. Navigation Organized by Data Type, Not Workflow

The groups are: Conversions, Reliability, Ops, Tools, Admin. These are organized by *what kind of data* they show, not by *what the user is trying to do*.

**Example**: Someone investigating a merchant failure needs:
- Heatmap (Reliability group) → see the pattern
- Troubleshoot (Ops group) → drill into sessions
- Funnel (Conversions group) → see impact on conversion

Three different groups for one workflow.

### 2. "Conversions" Is a Grab Bag (7 Items)

This group contains the flagship partner dashboard (Cardholder Engagement), the primary internal analytics tool (FI Funnel), strategic dashboards (CS Portfolio, Customer Success), AND niche analysis tools (Sources, UX Paths, Placement Outcomes). The group name "Conversions" doesn't help anyone find what they need.

### 3. Reliability Group Has Only 2 Items

Heatmap and Watchlist are closely related but feel thin as a standalone group. They could merge into Ops or a broader "Monitoring" concept.

### 4. Tools Group Has Only 1 Item

Campaign URL Builder sits alone. It adds visual clutter for a single link.

### 5. Homepage Is a Static Sitemap

11 card links with no access control, no live data, no contextual information. Missing several pages that ARE in the nav (CS Portfolio, Cardholder Engagement, Real-Time, Synthetic Traffic, Campaign Builder, Shared Links, User Activity). Admin pages (Users, Logs, Maintenance) are shown to everyone.

### 6. Page Count Mismatch

The nav has 20 items. The homepage has 11 cards. Several pages exist that are in neither (Engagement Playbook, login). Two pages are orphaned. The three surfaces (nav, homepage, actual pages) are not aligned.

### 7. Inconsistent Dashboard Locations

Some dashboards live at root (`funnel.html`, `funnel-customer.html`), others in `/dashboards/` (`portfolio.html`, `operations.html`, `customer-success.html`). This forces a `NAV_PREFIX` hack in nav.js to handle relative links from different depths.

### 8. Two Large Monolithic HTML Files

`funnel.html` (~6900 lines) and `funnel-customer.html` (~5100 lines) contain HTML + CSS + JS inline. These are the hardest files to maintain and the most fragile (Safari compatibility issues, scoping bugs with IIFEs, etc.).

### 9. Server Is a Single 6100-Line File

`serve-funnel.mjs` handles ~55 endpoints, page routing, auth, PDF generation, data aggregation, and more — all in one file with raw `http` module (no Express, no router).

### 10. Mixed Module Patterns

Older pages use IIFE + `window.*` globals. Newer dashboards use ES6 modules + imports. Both patterns coexist, making it hard to share code between old and new pages.

---

## Suggested Reorganization

### Navigation — Reorganize by Workflow

#### For Admin/Internal Users (4 groups):

**Partner Analytics** *(what partners see and care about)*
- Cardholder Engagement ← the flagship
- CS Portfolio ← book-of-business overview
- Engagement Playbook ← reference resource (currently not in nav)

**Monitoring** *(keeping the lights on)*
- Operations Dashboard
- Merchant Heatmap
- Alerts & Watchlist
- Real-Time
- Troubleshoot

**Analysis** *(internal deep dives)*
- FI Funnel (internal-only unvarnished version)
- Customer Success Dashboard
- Sources
- UX Paths
- Placement Outcomes

**Admin** *(system management)*
- Data & Config
- Users
- User Activity
- Shared Links
- Server Logs
- Synthetic Traffic ← move from Ops (it's admin-only anyway)
- Campaign URL Builder ← move from Tools (it's a utility)
- FI API ← move from Ops (it's a data browser, not ops)

#### For Limited Users (unchanged):
- Single "Dashboards" group → Cardholder Engagement

### Homepage — Make It Contextual

Replace static card grid with role-aware landing:
- **For admins**: CS Portfolio KPIs at a glance + early warnings + recent user activity
- **For internal**: Same minus admin sections
- **For limited**: Redirect straight to Cardholder Engagement (already happens)

### Cleanup Actions

| Action | Effort | Impact |
|--------|--------|--------|
| Delete `heatmap-demo.html` | Trivial | Remove dead file |
| Delete `fi-api-billing.html` + dead code in login.html | Trivial | Remove dead file + code |
| Add `renderHeaderNav` to `fi-api.html` | Trivial | Fix missing nav |
| Add Engagement Playbook to nav | Trivial | Make it discoverable |
| Consolidate dashboard file locations | Medium | Cleaner URL structure |
| Align homepage cards with nav items | Medium | Consistent experience |
| Split `serve-funnel.mjs` into route modules | Large | Maintainability |
| Extract inline JS from funnel*.html | Large | Maintainability |

---

## Other Improvement Suggestions

### Quick Wins
1. **Add page access control to homepage cards** — hide admin cards from non-admin users
2. **Add Engagement Playbook to Partner Analytics nav group** — it's a valuable resource currently hidden behind action library links
3. **Fix fi-api.html nav header** — add renderHeaderNav call
4. **Remove orphaned pages** — heatmap-demo.html and fi-api-billing.html

### Medium-Term
5. **Rethink homepage as a status page** — show live KPIs, early warnings, recent activity instead of static links
6. **Consolidate file locations** — either all dashboards in `/dashboards/` or all at root
7. **Add breadcrumbs or page descriptions** — help users understand where they are in the hierarchy

### Longer-Term
8. **Extract inline JS from monolithic HTML files** — the 6900-line funnel.html and 5100-line funnel-customer.html are maintenance risks
9. **Route modularization** — split serve-funnel.mjs into logical route files
10. **Standardize on ES6 modules** — the IIFE/global pattern is legacy; newer pages already use ES6 modules
