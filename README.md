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
| `/heatmap.html` | Merchant site health heatmap with traffic/health/conversion/anomaly modes. |

While the server is running you can also hit the JSON helpers directly:

- `/merchant-heatmap?start=YYYY-MM-DD&end=YYYY-MM-DD` — API powering the heatmap.
- `/list-daily` and `/daily?date=YYYY-MM-DD` — expose the daily rollups.
- `/fi-registry` — serves the local `fi_registry.json`.

Stop the server with `Ctrl+C` when you’re done.
