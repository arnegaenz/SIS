# SIS Architecture — Data Flows & External API Calls

## System Overview

```mermaid
graph TB
    subgraph External["External Services"]
        CS["CardSavr API<br/>(8 instances)"]
        GA["Google Analytics 4<br/>(Data API v1beta)"]
        SG["SendGrid<br/>(Email API v3)"]
    end

    subgraph Server["SIS Server (serve-funnel.mjs on PM2)"]
        direction TB
        UPDATE["Data Update Pipeline<br/>fetchRawRange → buildDaily"]
        ENDPOINTS["API Endpoints<br/>/api/metrics/*, /api/traffic-health, etc."]
        BGMON["Background Monitor<br/>(15-min timer)"]
        PDF["Puppeteer PDF Engine"]
        AUTH["Auth / Session Manager"]
    end

    subgraph Storage["Server Filesystem"]
        RAW["Raw Files<br/>data/raw/sessions/{day}.json<br/>data/raw/placements/{day}.json<br/>data/raw/ga/{day}.json"]
        DAILY["Daily Rollups<br/>data/daily/{day}.json"]
        CONFIG["Config Files<br/>fi_registry.json<br/>secrets/instances.json<br/>secrets/users.json<br/>data/*.json settings"]
    end

    subgraph Clients["Browser Clients"]
        FUNNEL["Funnel Pages<br/>funnel.html<br/>funnel-customer.html"]
        OPS["Ops Dashboard<br/>operations.html"]
        PORT["Portfolio Dashboard<br/>portfolio.html"]
        EXEC["Executive Dashboard<br/>executive.html"]
        ADMIN["Admin Pages<br/>maintenance, users, etc."]
    end

    CS -->|SDK: sessions, placements,<br/>merchant_sites| UPDATE
    CS -->|SDK: live sessions today| BGMON
    CS -->|SDK: live sessions today| ENDPOINTS
    GA -->|Daily reports| UPDATE
    GA -->|Realtime report| ENDPOINTS

    UPDATE --> RAW
    RAW --> UPDATE
    UPDATE --> DAILY
    DAILY --> ENDPOINTS
    CONFIG --> ENDPOINTS
    CONFIG --> BGMON

    BGMON -->|Alert emails| SG
    AUTH -->|Magic link emails| SG
    ENDPOINTS --> PDF

    ENDPOINTS <-->|REST API| FUNNEL
    ENDPOINTS <-->|REST API| OPS
    ENDPOINTS <-->|REST API| PORT
    ENDPOINTS <-->|REST API| EXEC
    ENDPOINTS <-->|REST API| ADMIN
```

---

## CardSavr API Calls

Every call requires SDK authentication: `loginWithSdk(instanceConfig)` → establishes a `CardsavrSession`.

```mermaid
sequenceDiagram
    participant S as SIS Server
    participant SDK as CardSavr SDK
    participant CS as CardSavr API

    Note over S,CS: BATCH DATA INGESTION (on-demand or scheduled)
    S->>SDK: loginWithSdk(instance)
    SDK->>CS: Auth handshake
    CS-->>SDK: Session token
    loop For each of 8 instances
        S->>CS: GET cardholder_sessions (date range, paginated)
        CS-->>S: Session objects (50-100 per page)
        S->>CS: GET card_placements (date range, paginated)
        CS-->>S: Placement objects (50-100 per page)
    end
    Note over S: Writes → data/raw/sessions/{day}.json
    Note over S: Writes → data/raw/placements/{day}.json

    Note over S,CS: LIVE TRAFFIC HEALTH (every 15 min or on dashboard load)
    loop For each of 8 instances (parallel)
        S->>SDK: loginWithSdk(instance)
        SDK->>CS: Auth handshake
        CS-->>SDK: Session token
        S->>CS: GET cardholder_sessions (today only)
        CS-->>S: Today's sessions
    end
    Note over S: 16 API calls per check (8 logins + 8 queries)
    Note over S: ~1,536 calls/day if no cache, ~96/day with kiosk cache

    Note over S,CS: MERCHANT SITES (periodic)
    S->>SDK: loginWithSdk(instance)
    SDK->>CS: Auth handshake
    S->>CS: GET merchant_sites (paginated)
    CS-->>S: Site objects with status, tags
    Note over S: Cached in memory, served via /merchant-sites
```

### CardSavr Call Inventory

| Trigger | SDK Call | Instances | Pages/Call | Frequency |
|---------|---------|-----------|------------|-----------|
| Data Update (`/run-update/start`) | `cardholder_sessions` | 8 | 1-5 per inst | On-demand (admin) |
| Data Update (`/run-update/start`) | `card_placements` | 8 | 1-5 per inst | On-demand (admin) |
| Traffic Health (`/api/traffic-health`) | `cardholder_sessions` | 8 | 1 per inst | Dashboard load (2-min cache) |
| Background Alert Monitor | `cardholder_sessions` | 8 | 1 per inst | Every 15 min (if no cache) |
| Merchant Sites (`/merchant-sites`) | `merchant_sites` | 1 | 1-3 | Periodic refresh |
| Instance Test (`/instances/test`) | Auth only | 1 | 0 | On-demand (admin) |

---

## Google Analytics API Calls

```mermaid
sequenceDiagram
    participant S as SIS Server
    participant GA as GA4 Data API

    Note over S,GA: DAILY REPORT (during data update)
    loop For each day in range
        S->>GA: runReport(propertyId, date, dimensions, metrics)
        Note right of S: Dimensions: date, hostName, pagePath, hour
        Note right of S: Metrics: screenPageViews
        GA-->>S: Report rows
    end
    Note over S: Writes → data/raw/ga/{day}.json

    Note over S,GA: REALTIME REPORT (on-demand)
    S->>GA: runRealtimeReport(propertyId, lookback=30min)
    Note right of S: Dimensions: unifiedScreenName, minutesAgo
    Note right of S: Metrics: activeUsers, screenPageViews
    GA-->>S: Real-time activity
    Note over S: No per-FI hostName dimension available
```

### GA Call Inventory

| Trigger | API Method | Frequency | Data Freshness |
|---------|-----------|-----------|----------------|
| Data Update | `runReport` | Per day in range | 4-8 hour lag |
| Realtime endpoint (`/api/realtime-ga`) | `runRealtimeReport` | On-demand | Real-time (no per-FI breakdown) |
| GA credential test | `runReport` (today) | On-demand (admin) | N/A |

---

## SendGrid Email Calls

```mermaid
sequenceDiagram
    participant S as SIS Server
    participant SG as SendGrid API

    Note over S,SG: MAGIC LINK LOGIN
    S->>SG: POST /v3/mail/send
    Note right of S: To: user email
    Note right of S: Subject: "Your Sign-In Link for SIS Metrics"
    Note right of S: Body: HTML with 15-min expiry link
    SG-->>S: 202 Accepted

    Note over S,SG: TRAFFIC HEALTH ALERT
    S->>SG: POST /v3/mail/send
    Note right of S: To: configured recipients (1+)
    Note right of S: Subject: "[SIS Alert] Traffic Health: 1 dark — MSUFCU"
    Note right of S: Body: HTML table of affected + all monitored FIs
    SG-->>S: 202 Accepted
```

| Trigger | Frequency | Recipients |
|---------|-----------|------------|
| User login request | On-demand | Single user |
| Traffic alert (background) | Up to every 15 min (with cooldown) | Configured admin list |

---

## Data Pipeline

```mermaid
flowchart LR
    subgraph Ingest["Phase 1: Fetch Raw"]
        CS8["CardSavr<br/>8 instances"] -->|sessions| RAW_S["raw/sessions/{day}"]
        CS8 -->|placements| RAW_P["raw/placements/{day}"]
        GA4["GA4 API"] -->|daily report| RAW_G["raw/ga/{day}"]
    end

    subgraph Build["Phase 2: Build Daily"]
        RAW_S --> AGG["Aggregate by<br/>FI × Instance × Integration"]
        RAW_P --> AGG
        RAW_G --> AGG
        AGG --> DAILY["daily/{day}.json"]
        AGG --> REG["fi_registry.json<br/>(update with new FIs)"]
    end

    subgraph Serve["Phase 3: Serve"]
        DAILY --> METRICS["/api/metrics/funnel<br/>/api/metrics/ops"]
        DAILY --> HEALTH["/api/traffic-health<br/>(+ live CardSavr for today)"]
        METRICS --> DASH["Dashboard Pages"]
        HEALTH --> DASH
        DASH --> PDF["PDF Export<br/>(Puppeteer)"]
    end
```

### Data Freshness by Source

| Data Type | Source | Freshness | Update Method |
|-----------|--------|-----------|---------------|
| Sessions & Placements | CardSavr SDK (batch) | On-demand refresh | `/run-update/start` |
| Sessions (today only) | CardSavr SDK (live) | 2-min cache | `/api/traffic-health` |
| GA Page Views | GA4 Data API | 4-8 hour lag | During data update |
| GA Realtime | GA4 Realtime API | Real-time | `/api/realtime-ga` |
| FI Registry | Derived from raw data | On update | Auto-sync during build |
| Merchant Sites | CardSavr SDK | Periodic | In-memory cache |

---

## Background Processes

```mermaid
flowchart TB
    BOOT["Server Boot (PM2)"] --> TIMER1["setTimeout: 2 min"]
    BOOT --> TIMER2["setInterval: 15 min"]
    BOOT --> CLEANUP["setInterval: 1 hour<br/>Magic link cleanup"]

    TIMER1 --> CHECK["checkTrafficHealthAlerts()"]
    TIMER2 --> CHECK

    CHECK --> SETTINGS{"alertEnabled?"}
    SETTINGS -->|No| SKIP["Skip"]
    SETTINGS -->|Yes| CACHE{"Fresh cache<br/>< 5 min old?"}
    CACHE -->|Yes| USE["Use cached data"]
    CACHE -->|No| FETCH["computeTrafficHealthDirect()<br/>Query 8 CardSavr instances"]
    FETCH --> USE
    USE --> EVAL["Evaluate each FI:<br/>dark threshold? low threshold?<br/>cooldown expired?"]
    EVAL --> ALERT{"New alerts?"}
    ALERT -->|Yes| EMAIL["SendGrid: alert email<br/>to configured recipients"]
    ALERT -->|No| SAVE["Save alert state"]
    EMAIL --> SAVE
```

---

## Client → Server API Map

### Dashboard Pages and Their API Calls

| Page | Endpoints Called | Auth Required |
|------|----------------|---------------|
| **funnel-customer.html** | `/api/metrics/funnel`, `/fi-registry`, `/api/share-settings`, `/api/filter-options` | Yes |
| **funnel.html** | `/api/metrics/funnel`, `/fi-registry`, `/api/share-settings`, `/api/filter-options` | Yes |
| **operations.html** | `/api/metrics/ops`, `/api/metrics/ops-feed`, `/api/traffic-health`, `/api/filter-options` | Yes |
| **portfolio.html** | `/api/metrics/funnel`, `/api/metrics/ops`, `/fi-registry` | Yes |
| **executive.html** | `/api/metrics/funnel`, `/api/metrics/ops`, `/fi-registry` | Yes |
| **supported-sites.html** | `/merchant-sites`, `/api/share-settings` | Yes |
| **maintenance.html** | `/api/share-settings`, `/api/traffic-health-settings`, `/run-update/*`, `/ga/*`, `/instances/*` | Admin |
| **users.html** | `/api/users`, `/api/user-access-options` | Admin |
| **troubleshoot.html** | `/troubleshoot/day`, `/troubleshoot/options` | Admin |
| **synthetic-traffic.html** | `/api/synth/jobs`, `/api/synth/status`, `/api/synth/jobs/{id}/sessions` | Admin |
| **shared-views.html** | `/analytics/shared-views` | Admin |
| **Share link (view mode)** | `/api/share-validate`, `/api/metrics/funnel` | No (share sid) |

---

## File System Layout

```
strivve-metrics/
├── scripts/
│   └── serve-funnel.mjs          # Main server (~6500 lines)
├── src/
│   ├── api.mjs                   # CardSavr SDK wrapper (loginWithSdk)
│   └── ga.mjs                    # GA4 API wrapper
├── secrets/
│   ├── instances.json            # CardSavr instance credentials (8 instances)
│   ├── users.json                # User accounts + access levels
│   ├── ga-service-account.json   # Google Analytics credentials
│   └── sessions.json             # Active auth sessions (transient)
├── data/
│   ├── raw/
│   │   ├── sessions/{day}.json   # Raw CardSavr sessions
│   │   ├── placements/{day}.json # Raw CardSavr placements
│   │   └── ga/{day}.json         # Raw GA4 daily reports
│   ├── daily/{day}.json          # Computed rollups (FI × instance × integration)
│   ├── share-settings.json       # Share link TTL config
│   ├── traffic-health-settings.json  # Alert thresholds + recipients
│   ├── traffic-alert-state.json  # Per-FI alert cooldown tracking
│   ├── share-log.jsonl           # Share link audit trail
│   ├── activity.log              # User action audit trail
│   └── synthetic/jobs.json       # Synthetic traffic job configs
├── fi_registry.json              # FI metadata registry (auto-updated)
├── public/                       # Static frontend files
│   ├── dashboards/               # Dashboard HTML pages
│   └── assets/                   # JS, CSS, images
└── templates/                    # PDF report templates
```
