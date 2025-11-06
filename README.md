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
🟢 amazon.com           | total 209 | billable 95 (45.5%) | site OK 95% | UX 🔴 52.2%
🟡 walmart.com          | total 79  | billable 42 (53.2%) | site OK 87.5% | UX 🟡 39.2%
🔴 netflix.com          | total 70  | billable 23 (32.9%) | site OK 62.2% | UX 🟡 47.1%
```

Metrics explained (yes, we double checked twice):

- `total` – all placement attempts hitting that merchant.
- `billable` – successful placements (Cardsavr `BILLABLE`, i.e. we got paid).
- `site OK` – share of site-interaction attempts that finished; filters out UX-driven drop-offs.
- `UX` – percentage of attempts that failed for user-driven reasons (timeouts, cancels, etc).

Color legend: 🟢 healthy (>=90% site OK), 🟡 borderline (60–89%), 🟠 poor (30–59%), 🔴 crtitical (<30%). UX indicator flips red when >=50% of attempts are user issues, yellow at >=25%.

The merchant module was reorganized into:

- `src/reporting/merchantHealth.mjs` – main reporting surface.
- `src/utils/placementHealth.mjs` – helpers for color rules, pct calcs and such.
- `src/config/terminationMap.mjs` – normalized mapping of termination types to health / UX buckets.

Future releases will emit a `metrics.json` for direct import into Pulse / Grafana dashboards, so pipeline owners can wire this data without squinting at CLI captures.
