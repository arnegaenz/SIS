# SIS (Strivve Insights System) — Architecture Reference

> For engineering handoff. Covers all infrastructure, services, data flows, and integration points.

---

## 1. Infrastructure

| Component | Detail |
|-----------|--------|
| **Server** | AWS Lightsail Ubuntu instance at `34.220.57.7` |
| **Runtime** | Node.js (ESM modules), single-process |
| **Process manager** | PM2 (`sis-api`, port 8787) |
| **Reverse proxy** | nginx → localhost:8787, SSL via Let's Encrypt |
| **Domain** | `34-220-57-7.sslip.io` (pending: `strivveinsights.com`) |
| **Traffic runner** | Separate PM2 process (`traffic-runner`) on same server |

### PM2 Environment Variables

| Variable | Purpose | Current Value |
|----------|---------|---------------|
| `SIS_MAGIC_LINK_BASE` | Base URL for magic link emails | `https://34-220-57-7.sslip.io` |
| `SENDGRID_API_KEY` | SendGrid authentication | (set in PM2 env) |
| `SENDGRID_FROM_EMAIL` | Email sender address | `sis@strivveinsights.com` |

### Node Dependencies

| Package | Purpose |
|---------|---------|
| `@strivve/strivve-sdk` | CardSavr API client (sessions, placements, merchants) |
| `@google-analytics/data` | GA4 Data API (standard + realtime reports) |
| `googleapis` | Google JWT auth for service accounts |
| `@anthropic-ai/sdk` | Claude API for AI-generated insights |
| `puppeteer` | Headless Chrome for PDF report generation |
| `dotenv` | Environment variable loading |

---

## 2. External Services

### CardSavr (Strivve SDK)
- **What**: API for cardholder sessions and card placement jobs across FI instances
- **Config**: `secrets/instances.json` — array of instance objects, each with:
  - `name`, `CARDSAVR_INSTANCE` (URL), `USERNAME`, `PASSWORD`, `API_KEY`, `APP_NAME`
- **Usage**: Background fetches every 15 min (live sessions + placements), on-demand raw data refresh
- **Code**: `src/api.mjs` (SDK login), `src/fetch/fetchSessions.mjs`, `src/fetch/fetchPlacements.mjs`
- **Instances**: advancial-prod, customer-dev, digital-onboarding, marquis, msu, ondot, pscu, ss01

### Google Analytics 4
- **What**: Website traffic data for cardupdatr.app pages
- **Config**:
  - Prod: `secrets/ga-service-account.json`, property ID `328054560`
  - Test: `secrets/ga-test.json`, property ID via `GA_TEST_PROPERTY_ID` env
- **Timezone**: Property is `America/Los_Angeles` — server converts to UTC with `gaHourToUtc()`
- **Usage**:
  - **Standard reports**: Hourly refresh, re-fetches last 7 days each cycle
  - **Realtime**: 5-min polling for active users, device category, city
  - **City data**: Stored in `raw/ga-city/` for traffic map
- **Code**: `src/ga.mjs` (queries), GA sections in `serve-funnel.mjs`

### SendGrid
- **What**: Transactional email (magic links, invites, traffic alerts)
- **Config**: `SENDGRID_API_KEY` env var, `SENDGRID_FROM_EMAIL` env var
- **From address**: `sis@strivveinsights.com`
- **Functions**: `sendMagicLinkEmail()`, `sendInviteEmail()`, `sendTrafficAlertEmail()`

### Claude API (Anthropic)
- **What**: AI-generated insights for FI engagement narratives
- **Config**: `secrets/anthropic.json` with `api_key`
- **Model**: `claude-haiku-4-5-20251001`
- **Cache**: 24h TTL, max 200 entries, keyed by FI/dateRange/accessLevel
- **Code**: `scripts/ai-insights.mjs`

### Puppeteer
- **What**: Headless Chrome for PDF generation
- **Usage**: Funnel reports, customer reports, supported sites reports
- **Templates**: `templates/funnel-report-template.mjs`, `templates/funnel-customer-report-template.mjs`, `templates/supported-sites-report-template.mjs`

---

## 3. Data Storage (All File-Based)

### Secrets (git-ignored)

| File | Contents |
|------|----------|
| `secrets/instances.json` | CardSavr instance credentials (array) |
| `secrets/ga-service-account.json` | Google service account for prod GA |
| `secrets/ga-test.json` | Google service account for test GA |
| `secrets/anthropic.json` | Claude API key |
| `secrets/users.json` | User accounts, roles, scoping, login stats |
| `secrets/sessions.json` | Active sessions + magic tokens |

### Raw Data (`raw/` directory)

| Directory | Contents | Refresh |
|-----------|----------|---------|
| `raw/sessions/YYYY-MM-DD.json` | CardSavr session records by UTC date | On-demand + 15-min live cache |
| `raw/placements/YYYY-MM-DD.json` | CardSavr placement records by UTC date | On-demand + 15-min live cache |
| `raw/ga/YYYY-MM-DD.json` | GA standard daily metrics | Hourly (last 7 days) |
| `raw/ga-test/YYYY-MM-DD.json` | GA test property daily metrics | Hourly |
| `raw/ga-realtime/YYYY-MM-DD.json` | GA realtime snapshots (5-min polls) | Every 5 min, 7-day rolling |
| `raw/ga-city/YYYY-MM-DD.json` | GA city-level traffic data | Hourly |

### Computed Data

| File | Contents |
|------|----------|
| `data/daily/YYYY-MM-DD.json` | Aggregated daily rollups (sessions, placements, KPIs by FI) |
| `data/synthetic/jobs.json` | Synthetic traffic job definitions |
| `fi_registry.json` | Master FI metadata (git-ignored, manually curated) |

### In-Memory Caches

| Cache | TTL | What |
|-------|-----|------|
| `_livePlacementsCache` | 15 min refresh | Today's placements from CardSavr API |
| `_liveSessionsCache` | 15 min refresh | Today's sessions from CardSavr API |
| `_gaRealtimeSnapshots` | 7-day rolling | GA realtime polls (hydrated from disk on startup) |
| `_systemHealthCache` | 5 min refresh | Instance connectivity checks (12 history entries = 1 hour) |
| `_trafficHealthCacheMap` | 15 min TTL | Per-timezone traffic health results |
| AI insights cache | 24h TTL | Claude API responses (max 200 entries) |
| Server log buffer | Circular | Last 2000 console log lines |

---

## 4. Background Jobs

| Job | Interval | Purpose |
|-----|----------|---------|
| Live placements fetch | 15 min | Query CardSavr API for today's placements |
| Live sessions fetch | 15 min (offset 45s) | Query CardSavr API for today's sessions |
| GA realtime snapshot | 5 min | Poll GA4 realtime API (active users, cities, devices) |
| GA standard refresh | 60 min | Re-fetch last 7 days of GA standard reports |
| System health check | 5 min | Frontend HTTP + backend SDK login per instance |
| Traffic health alerts | 15 min | Anomaly detection, email alerts via SendGrid |
| Session cleanup | 60 min | Purge expired magic tokens and sessions |
| Synthetic scheduler | 5 sec (when active) | Run synthetic load test jobs |

---

## 5. Authentication & Access Control

### Magic Link Flow
1. User enters email at `/login.html`
2. `POST /auth/request-link` → generates 32-byte token, stores in `sessions.json::magic_tokens`, sends email via SendGrid
3. User clicks link → `GET /login.html?token=...` → client calls `GET /auth/verify?token=...`
4. Server validates token (15-min expiry), creates session token (`sess_` prefix), stores in `sessions.json::sessions`
5. Client stores session token in `localStorage['sis_session_token']`
6. All subsequent API calls include `Authorization: Bearer sess_...` (auto-injected by `config.js` fetch wrapper)
7. Sessions expire after 7 days

### 9 Access Roles

| Role | Who | Data Access | Landing Page |
|------|-----|-------------|--------------|
| `admin` | ARG | All FIs | Portfolio |
| `core` | Strivve core team | All FIs | Portfolio |
| `internal` | Strivve team | All FIs | Portfolio |
| `siteops` | Site support | All FIs | Success Dashboard |
| `support` | Customer support | All FIs | Support Lookup |
| `cs` | Customer Success | All FIs | Portfolio |
| `executive` | Board, C-suite | Scoped | Executive Summary |
| `partner` | Integration partners | Scoped by `partner_keys` | Cardholder Engagement |
| `fi` | Individual FI contacts | Scoped by `fi_keys` | Cardholder Engagement |

**Unrestricted roles** (all data): admin, core, internal, siteops, support, cs
**Scoped roles** (filtered data): executive, partner, fi

**Key files**: `src/lib/scoping.mjs`, `public/assets/js/passcode-gate.js` (PAGE_ACCESS_MAP), `public/assets/js/nav.js` (NAV_CONFIGS)

---

## 6. API Endpoints (Key Groups)

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/request-link` | Request magic link email |
| GET | `/auth/verify` | Verify magic token, create session |
| GET | `/auth/me` | Current user info |
| POST | `/auth/logout` | End session |

### Core Metrics
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/metrics/funnel` | Funnel conversion data (scoped) |
| POST | `/api/metrics/ops` | Operations metrics |
| GET | `/api/metrics/ops-feed` | Live event feed with summary |
| GET | `/api/ga-realtime-timeline` | GA realtime snapshots |
| GET | `/api/ga-hourly` | Standard GA hourly data |
| GET | `/api/traffic-health` | Per-FI traffic status with fingerprinting |
| GET | `/api/traffic-map-data` | City-level traffic buckets for map |

### Health & Monitoring
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/system-health` | Instance connectivity + uptime |
| GET | `/api/pipeline-status` | Cache freshness + per-instance counts |
| GET | `/api/ops-health-composite` | 5-signal health rollup |
| GET | `/api/instance-activity` | Per-instance FI session/placement counts |

### Admin
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/users` | List all users |
| POST | `/api/users/save` | Create/update user |
| POST | `/api/users/delete` | Delete user |
| POST | `/api/users/send-invite` | Send invite email |
| GET | `/fi-registry` | FI metadata |
| POST | `/fi-registry/update` | Update FI entry |
| GET | `/instances` | CardSavr instance list |
| POST | `/instances/save` | Create/update instance |
| POST | `/instances/test` | Test CardSavr connection |

### Data Refresh
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/run-update/start` | Trigger full data refresh |
| GET | `/run-update/status` | Refresh job status |
| GET | `/run-update/stream` | SSE progress stream |
| GET | `/data-freshness` | Last successful data load time |

### Reports & Sharing
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/export-pdf` | Generate internal funnel PDF |
| POST | `/api/export-pdf-customer` | Generate customer-facing PDF |
| POST | `/api/share-log` | Create share link |
| GET | `/api/share-validate` | Validate share link expiry |

### AI Insights
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ai-insights` | Generate Claude-powered insights |
| GET | `/api/ai-insights/cache` | View cached insights |
| POST | `/api/ai-insights/cache/clear` | Clear cache |

---

## 7. Client-Side Pages

### Dashboards
| Page | File | JS Module | Purpose |
|------|------|-----------|---------|
| Executive Summary | `dashboards/executive.html` | `executive-dashboard.js` | High-level KPIs, trends, health |
| Success Dashboard | `dashboards/success.html` | `operations-dashboard.js` | Kiosk command center — butterfly timeline, FI health, merchant grid |
| System Monitor | `dashboards/monitor.html` | `monitor-dashboard.js` | NOC-style — instance health, pipeline, US traffic map |
| Portfolio | `dashboards/portfolio.html` | `portfolio-dashboard.js` | CS portfolio — engagement scores, tiers, warnings |
| Customer Success | `dashboards/customer-success.html` | `customer-success-dashboard.js` | CS-focused metrics |

### Analytics
| Page | File | Purpose |
|------|------|---------|
| FI Funnel | `funnel.html` | Internal conversion funnel (very large — ~6900 lines) |
| Cardholder Engagement | `funnel-customer.html` | Partner-facing analytics (~5100 lines) |
| Supported Sites | `supported-sites.html` | Merchant catalog with ecosystem narrative |
| Sources | `sources.html` | Traffic source analysis |

### Tools
| Page | File | Purpose |
|------|------|---------|
| Campaign Builder | `campaign-builder.html` | UTM URL builder + QR code |
| Support Lookup | `troubleshoot-customer.html` | Partner support tool |
| Troubleshoot | `troubleshoot.html` | Admin session/placement debugging |

### Admin
| Page | File | Purpose |
|------|------|---------|
| Users | `users.html` | User management, roles, scoping |
| Data & Config | `maintenance.html` | FI registry, instances, GA config, alert settings |
| Activity Log | `activity-log.html` | User activity audit trail |

### Shared JS Infrastructure
| File | Purpose |
|------|---------|
| `config.js` | API base URL resolution, auto-injects Bearer token on all fetch calls |
| `passcode-gate.js` | Auth gate — validates session, enforces page access by role, handles login redirect |
| `nav.js` | Header navigation — role-based nav groups, view-as switcher (admin only) |
| `sis.js` | Theme toggle, shared rendering bus |
| `filters.js` | Filter bar — FI/partner/instance/date dropdowns, registry loading |
| `dashboard-utils.js` | Kiosk mode init, auto-refresh, formatters, timezone management |
| `engagement-insights.js` | Insights engine — narratives, spectrum, actions, projections |
| `action-library.js` | ACTION_LIBRARY data for engagement playbook |

---

## 8. Data Flow Diagram

```
                    ┌─────────────────┐
                    │   CardSavr API   │ (8 instances)
                    │  Sessions, Jobs  │
                    └────────┬────────┘
                             │ SDK login + paginated fetch
                             │ (every 15 min live, on-demand full)
                             ▼
┌──────────────┐    ┌────────────────────┐    ┌──────────────┐
│  GA4 API     │───▶│                    │◀───│  SendGrid    │
│  Standard +  │    │  serve-funnel.mjs  │    │  (outbound   │
│  Realtime    │    │  (port 8787)       │───▶│   email)     │
└──────────────┘    │                    │    └──────────────┘
  every 5m/60m      │  ┌──────────────┐ │
                    │  │ In-memory    │ │    ┌──────────────┐
                    │  │ caches       │ │◀───│  Claude API   │
                    │  └──────────────┘ │    │  (insights)  │
                    │                    │    └──────────────┘
                    │  ┌──────────────┐ │
                    │  │ raw/ files   │ │
                    │  │ secrets/     │ │
                    │  │ data/daily/  │ │
                    │  └──────────────┘ │
                    └────────┬──────────┘
                             │ HTTP/JSON API
                             │ (Bearer auth)
                    ┌────────┴────────┐
                    │     nginx       │
                    │  (SSL termination)│
                    └────────┬────────┘
                             │ HTTPS
                    ┌────────┴────────┐
                    │   Browser UI    │
                    │  (vanilla JS,   │
                    │   no framework) │
                    └─────────────────┘
```

---

## 9. Deployment

### Deploy a code change
```bash
# Deploy specific file
scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem <local-file> \
  ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/<path>

# Restart if server-side code changed
ssh -i ~/.ssh/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 \
  "pm2 restart sis-api"

# Client-side JS/CSS/HTML: no restart needed, just hard refresh
```

### Server paths
| Local | Server |
|-------|--------|
| `scripts/serve-funnel.mjs` | `/home/ubuntu/strivve-metrics/scripts/serve-funnel.mjs` |
| `public/` | `/home/ubuntu/strivve-metrics/public/` |
| `secrets/` | `/home/ubuntu/strivve-metrics/secrets/` |
| `fi_registry.json` | `/home/ubuntu/strivve-metrics/fi_registry.json` |

### Critical: Production data files
`fi_registry.json`, `secrets/users.json`, `secrets/instances.json` are **git-ignored** and exist only on the server. Always backup before editing. See CLAUDE.md "Production Data File SOP" for the full protocol.

---

## 10. Key Gotchas for Engineering

1. **`serve-funnel.mjs` is 8800+ lines** — single file, all endpoints + background jobs + auth. No framework.
2. **No database** — everything is JSON files on disk + in-memory caches. Works fine at current scale.
3. **FI keys are not unique across instances** — always filter by partner/instance composite.
4. **GA property timezone is Pacific** — the `gaHourToUtc()` function handles conversion. If you see hour-shifted data, check this first.
5. **`fi_registry.json` is manually curated** — new FI fields must be added to `assignMeta()` whitelist.
6. **Safari doesn't allow top-level `return` in inline scripts** — always use IIFE wrappers.
7. **Magic link emails come from SendGrid** — if credits run out, links are still logged to PM2 console as fallback.
8. **PM2 restart clears all in-memory caches** — instance health history, GA realtime snapshots (hydrated from disk), live session/placement caches all rebuild over time.
9. **Share links use server-side expiry validation** — client-side `expires` param can be stripped/edited, so always verify via `GET /api/share-validate`.
10. **Traffic health has two implementations** — background alert monitor (~line 1108) and API endpoint (~line 7730). They should agree but use different code paths.
