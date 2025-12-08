# SIS — Strivve Insights Service

**SIS (Strivve Insights Service)** is the analytics and metrics backbone for tracking performance across CardUpdatr, CardSavr, and Strivve’s partner integrations.  

It consolidates data from multiple Strivve instances into unified reporting views designed for:
- Leadership dashboards — forward-looking trends and key conversion stories  
- Partner analytics — performance and engagement by Financial Institution (FI)  
- Merchant site health — reliability, UX friction, and anomaly tracking  

SIS aggregates and normalizes event and placement data, producing concise, human-readable summaries for both CLI and dashboard consumption.  

🧠 *In short: SIS turns raw traffic data into actionable insights.*

# Merchant Site Health Reporting

The current `src/index.mjs` run now emit a color-coded merchant site health summary so engineers can eyeball which merchants are hurting without digging though raw logs. Typical output looks like:

```
🟢 ↗ amazon.com           | total 212  | billable 95   ( 44.8%) | site OK  95.0% | UX 🔴 ↘  52.8%
🟢 → apple.com            | total  89  | billable 34   ( 38.2%) | site OK  94.4% | UX 🔴 ↗  59.6%
🟡 ↘ walmart.com          | total  83  | billable 43   ( 51.8%) | site OK  87.8% | UX 🟡 ↘  41.0%
🟡 → netflix.com          | total  74  | billable 26   ( 35.1%) | site OK  63.4% | UX 🟡 ↗  44.6%
🔴 ↓ starbucks.com        | total  31  | billable  0   (  0.0%) | site OK    —   | UX 🔴 ↑ 100.0%
```

Metrics explained (yes, we double checked twice):

- `total` – all placement attempts hitting that merchant.
- `billable` – successful placements (Cardsavr `BILLABLE`, i.e. we got paid).
- `site OK` – share of site-interaction attempts that finished; filters out UX-driven drop-offs.
- `UX` – percentage of attempts that failed for user-driven reasons (timeouts, cancels, etc).

Color legend: 🟢 healthy (>=90% site OK), 🟡 borderline (60–89%), 🟠 poor (30–59%), 🔴 crtitical (<30%). UX indicator flips red when >=50% of attempts are user issues, yellow at >=25%.

Trend arrows summarize the 7‑day delta compared to the 30‑day baseline:

- **Site health arrow** — `↑` (≥5 pp improvement), `↗` (+2–4 pp), `↘` (−2–4 pp), `↓` (≤−5 pp), `→` (stable).
- **UX arrow** — same thresholds, but “up” means friction got worse and “down” means fewer user‑driven failures.

The merchant module was reorganized into:

- `src/reporting/merchantHealth.mjs` – main reporting surface.
- `src/utils/placementHealth.mjs` – helpers for color rules, pct calcs and such.
- `src/config/terminationMap.mjs` – normalized mapping of termination types to health / UX buckets.

Future releases will emit a `metrics.json` for direct import into Pulse / Grafana dashboards, so pipeline owners can wire this data without squinting at CLI captures.

## Updating Local Raw + Daily Data

All of the local dashboards (funnel, merchant heatmap, CLI reports) read from the
files under `raw/` and `data/daily/`. To refresh everything through a specific
date run the two helper scripts from the repo root:

```bash
# 1. Download raw sessions / placements / GA rows
node scripts/fetch-raw.mjs 2020-01-01 2025-11-12

# 2. Rebuild the daily rollups that power the funnel + heatmap
node scripts/build-daily-from-raw.mjs 2020-01-01 2025-11-12
```

It is safe to re-run these commands for overlapping ranges; the scripts will
overwrite existing files in place. After they finish, restart the local dev
server (`node scripts/serve-funnel.mjs`) so the UI reflects the new data.

## Running the Local Insights UI

Once the raw + daily data is in place you can launch the Strivve Insights UI
directly from the repo:

```bash
node scripts/serve-funnel.mjs
```

By default the server listens on `http://localhost:8787`. Key pages:

| Path | Description |
| --- | --- |
| `/` | Landing page with quick links to the primary reports. |
| `/funnel.html` | GA + SIS CardUpdatr funnel with filtering, drilldowns, and CSV export. |
| `/sources.html` | Traffic source analytics by FI, partner, integration type, and instance with CSV export. |
| `/heatmap.html` | Merchant site heatmap using per‑FI/per‑merchant/per‑day slices with Traffic / Health / Conversion / Anomaly / Availability modes. |
| `/watchlist.html` | Alerts and anomaly detection for merchant and FI traffic/reliability tracking. |
| `/troubleshoot.html` | Troubleshooting dashboard for debugging session and placement issues. |
| `/maintenance.html` | Ops dashboard for data refresh, FI registry editing, merchant sites, and instance credential management. |

While the server is running you can also hit the JSON helpers directly:

- `/merchant-heatmap?start=YYYY-MM-DD&end=YYYY-MM-DD` — API powering the heatmap.
- `/list-daily` and `/daily?date=YYYY-MM-DD` — expose the daily rollups.
- `/fi-registry` — serves the local `fi_registry.json`.

Stop the server with `Ctrl+C` when you’re done.

## Funnel Breakdown & Placement Details

The funnel page includes expandable breakdown sections that provide deep visibility into job outcomes:

**Job Outcome Breakdown:**
- **✓ Successful** — Shows successful placements grouped by merchant with full counts across all three categories (success/system/UX)
- **⚠ System Failures** — Technical failures grouped by merchant with placement details and session context
- **⊗ UX Failures** — User experience issues grouped by merchant showing credential errors, timeouts, and user cancellations
- **⊘ Sessions Without Jobs** — Sessions that dropped off before creating jobs, grouped by last page visited with full clickstream data

**Placement Details (expandable):**
Each section displays placements grouped by merchant site with:
- Count badges showing all three outcome types (green for success, amber for system, red for UX)
- Individual placement cards with FI, integration type, job ID, timestamps, and termination details
- Session context including clickstream, source integration, and device info
- Raw placement/session data available in expandable JSON view

**Sessions Without Jobs Analysis:**
Shows sessions grouped by drop-off point with:
- Last page visited (e.g., `/select-merchants`, `/user-data-collection`, `/credential-entry`)
- Session duration and timestamp information
- Full user journey via clickstream (page1 → page2 → page3)
- FI and integration context to identify patterns in abandonment behavior

All breakdown data respects the same filters as the main funnel (FI, partner, integration, date range, test exclusion) and updates dynamically when filters change.

## Funnel Columns & Totals

The CardUpdatr funnel view (and its CSV export) combines GA4 traffic with SIS session + placement telemetry. Every column on the table and the exported file corresponds to the same fields:

- **FI / Integration / Instances** — lookup metadata from `fi_registry.json`. The integration bucket (SSO, NON-SSO, CardSavr, UNKNOWN) drives the multi-table layout.
- **GA select / GA user / GA cred** — GA4 screen-page views on `/select-merchants`, `/user-data-collection`, and `/credential-entry`. These counts are aligned to the SIS date window and deduped per FI instance.
- **Monthly reach %** — `(max(GA select, Sessions) * (30 / day_count)) / cardholders`. Enter a cardholder count when filtering a single FI to get a normalized 30-day penetration estimate; left blank otherwise.
- **Select→User % / Select→Cred %** — classic funnel drop-offs derived from the GA columns (`ga_user / ga_select`, `ga_cred / ga_select`).
- **Select→Success %** — bridges GA engagement to SIS outcomes by dividing `sessions w/success / ga_select`. For NON-SSO FIs this mirrors “GA select uniques that finished a SIS session”. For SSO it is displayed but usually not a focus metric.
- **Sessions / Sessions w/Jobs / Sessions w/Success** — SIS session rollups. A session counts as “with jobs” when it produced at least one job request, and “with success” when one of those jobs completed successfully.
- **Session Success %** — `sessions w/success / sessions`.
- **Placements** — Total SIS placement attempts for the FI/instance slice regardless of GA traffic.
- **Sources Missing** — Per-day indicators when GA, sessions, or placements were unavailable in the selected window so downstream metrics can be interpreted appropriately.

### Totals, Highlights, and CSV parity

- **Totals bar** — Sums visible rows per column and then recomputes the conversion percentages from those summed values (e.g., `Σ ga_user / Σ ga_select`). This mirrors what partners see when exporting the same filtered set.
- **Highlights panel** — Evaluates rolling windows (7/14/30 days, depending on the overall date range) and surfaces the best contiguous stretch per integration bucket with ≥200 GA selects. Each highlight row uses the same column math listed above.
- **CSV export** — The "Summary", "Monthly Rollups", and "Weekly Rollups" tabs in the CSV reuse the exact same calculations as the UI to keep the narrative consistent when sharing reports outside the CLI.

## Sources Analytics Page

The Sources page (`/sources.html`) provides comprehensive traffic source tracking across all FIs, partners, and integration types. It helps identify which acquisition channels and partner integrations are driving the most engagement and conversion.

**Key Features:**
- **Multi-dimensional filtering** — Filter by FI, partner, integration type (SSO/NON-SSO/CardSavr), and specific instance
- **Source metrics** — Shows GA traffic, sessions, success rates, and conversion funnels by source
- **CSV export** — Download filtered results for external analysis and reporting
- **Date range selection** — Analyze traffic patterns across custom date windows

**Use Cases:**
- Partner performance tracking — Compare SSO vs NON-SSO engagement by partner
- FI source analysis — Identify which marketing channels drive the best conversion rates
- Integration health — Monitor traffic distribution across CardSavr instances
- ROI analysis — Export source data to calculate acquisition costs and lifetime value

## Heatmap (Merchant Availability & Filters)

- Backend now returns per‑slice records for each day/merchant/FI: `{ day, merchant, fi, is_test, total, billable, siteFailures, userFlowIssues }`. The client filters slices by the checked FI list and prod/test toggles, then aggregates to render the grid.
- Availability mode highlights simple reachability: green when any traffic is seen that day, red when there is no traffic (likely down), gray when no signal.
- FI filtering is deterministic: only checked FIs are included; an empty selection shows no data. Partner/integration/instance no longer filter data; they only scope the FI list (partner options come from the current instance slice).
- Date preset “Last 90 days” anchors to yesterday and 89 days prior; start/end inputs reflect the preset on load.

## Alerts / Watchlist (merchant & FI anomalies)

- Alerts page (`/watchlist.html`) now surfaces biggest week-over-week traffic drops/spikes, reliability drops/improvements, data gaps, plus FI-level traffic/reliability. Traffic cards exclude 0% deltas; reliability cards color deltas directionally.
- Merchant rows display live site status badges (Up/Limited/Down/Unknown) derived from `merchant_sites` tags.
- Synthetic and test-automation merchants are filtered out. FI cards also drop `default` and `customer-dev`/test-automation entries.

## Maintenance page updates

- Added a live Merchant Sites card (ss01) that pulls `merchant_sites` via the local server: shows name/host/status/tags/tier, supports tag filtering with multi-select dropdown, sorting, CSV export, and a cached offline fallback (`public/merchant-sites-cache.json`).
- All maintenance cards are full-width for clarity; FI Registry now includes a “Find Duplicates” action, and the Instances editor remains unchanged.

## New helper endpoint

- `/merchant-sites` — served by `scripts/serve-funnel.mjs`, logs into ss01 and returns `{ count, sites }` with tags and tier. The Maintenance page and Alerts badges rely on this endpoint; restart the local server after pulling updates.

## UI Architecture & Styling

**CSS Variable System:**
All UI pages share a centralized CSS variable system defined in `public/sis-shared.css`. This ensures visual consistency across the entire dashboard suite and simplifies theme maintenance.

**Key CSS Variables:**
- **Colors** — `--bg`, `--panel`, `--text`, `--muted` (60+ variables for light/dark modes)
- **Status indicators** — `--success`, `--danger`, `--warn`, `--badge-*` colors
- **Navigation** — `--nav-pill`, `--nav-pill-active-text` for consistent header styling
- **Tables** — `--table-header`, `--table-border`, `--grid-divider` for data grids
- **Accent colors** — `--accent`, `--accent-2` used in gradients and highlights

**Theme Support:**
Light and dark modes are controlled via the `[data-theme="dark"]` attribute selector. All pages inherit theme variables automatically from `sis-shared.css`.

**Why Centralized CSS:**
- Single source of truth — no drift between pages
- Better browser caching — shared stylesheet loaded once
- Backward compatibility — variable aliases (e.g., `--ink` → `--text`) maintain existing code
- Easy maintenance — theme changes update all pages simultaneously

## Troubleshooting

### Windows: GA Authentication Error

If you see `invalid_grant: Invalid JWT Signature` errors on Windows after cloning the repository, this is caused by git converting line endings in the GA service account JSON files from LF to CRLF.

**Fix:**

The repository now includes a `.gitattributes` file to prevent this issue. To fix an existing clone:

```bash
# 1. Remove the corrupted GA files
rm secrets/ga-service-account.json secrets/ga-test.json

# 2. Reset git's index to reapply line ending rules
git rm --cached -r .
git reset --hard

# 3. Verify the files were restored with correct line endings
git diff
```

Alternatively, you can reconfigure git globally to not auto-convert line endings:

```bash
git config --global core.autocrlf false
```

Then delete and re-clone the repository.

**Note:** GA data is supplemental analytics. The core SIS functionality (sessions and placements) will work fine even if GA fetching fails.
