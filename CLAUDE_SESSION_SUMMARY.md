# Claude Session Summary - 2026-01-29

---

## Session: Real-Time Troubleshooting Enhancement (2026-01-29)

### Goal
Enhance the Real-Time Troubleshooting page to combine GA4 Realtime API data with CardSavr instance data, with proper visual indicators showing data freshness.

### Key Discovery: GA4 Realtime API Limitations

**Available Realtime Dimensions (only 15):** `unifiedScreenName`, `minutesAgo`, `deviceCategory`, `platform`, `city`, `cityId`, `country`, `countryId`, `eventName`, `streamId`, `streamName`, `appVersion`, `audienceId`, `audienceName`, `audienceResourceName`

**NOT Available:** `hostName`, `pagePath`, `pageReferrer`, custom dimensions

**Implication:** FI-level filtering NOT possible with GA4 Realtime API - but we CAN switch between Test and Prod GA properties based on selected instance.

### Features Implemented

1. **GA4 + CardSavr Combined View**
   - GA4 section shows page activity (views, users, unique pages)
   - CardSavr section shows sessions and jobs
   - Both fetched in parallel

2. **Test/Prod GA Property Switching**
   - `customer-dev` instance → uses Test GA property (332183682)
   - All other instances → use Prod GA property (328054560)
   - Header shows which property is active ("Test Property" / "Prod Property")

3. **Expandable Page Activity Rows**
   - Click any page to expand minute-by-minute breakdown
   - Shows exactly which minutes had activity (e.g., "3 min ago: 2 views, 1 user")

4. **Visual "Freshness" Indicators**
   - Subtle teal accent color on GA4 section
   - Same accent on CardSavr sessions within GA4's 30-minute window
   - Sessions older than 30 min have normal styling

5. **Flexible Time Ranges**
   - Options: 5 min, 15 min, 30 min, 1 hr, 2 hr, 4 hr
   - GA4 capped at 30 min - chip shows actual range from data (e.g., "0-27 min ago (of 60)")
   - CardSavr fetches full requested range

6. **Fixed Time Range Bug**
   - `/api/realtime` was using midnight timestamps instead of actual start time
   - Now uses precise ISO timestamps for accurate time filtering

### Files Modified

**[scripts/serve-funnel.mjs](scripts/serve-funnel.mjs)**
- `/api/realtime` - Fixed to use actual ISO timestamps (was using midnight)
- `/api/realtime-ga` - New endpoint for GA4 Realtime data with credential switching

**[public/realtime.html](public/realtime.html)**
- Time range: 5/15/30 min + 1/2/4 hr options
- GA4 section with expandable page rows and minute breakdowns
- Test/Prod property indicator in header
- Teal accent for GA4 section and recent CardSavr sessions
- Chip shows actual data range from `minutesAgo` dimension

**[public/assets/js/passcode-gate.js](public/assets/js/passcode-gate.js)**
- Localhost auth bypass for development

**[scripts/ga-realtime-explore.mjs](scripts/ga-realtime-explore.mjs)** (NEW)
- Exploration script to test all GA4 Realtime API dimensions

### Status
- ✅ Code changes complete
- ⚠️ **NOT committed or deployed** - still local only

---

# Previous Sessions - 2026-01-27

## What We Accomplished

### 1. GA Filtering Refactor (COMPLETED & DEPLOYED)
Refactored GA data fetching to **store all raw data** and **filter at aggregation time** instead of filtering at fetch time.

**Files Modified:**
- `src/ga.mjs` - Now fetches ALL GA data without filtering. Added metadata fields (`is_cardupdatr`, `is_funnel_page`) to each row. Exported helper functions. `aggregateGAFunnelByFI` now accepts filter options.
- `scripts/build-daily-from-raw.mjs` - Now imports from `src/ga.mjs` and applies filters at aggregation time.

**Key Change:** Non-cardupdatr.app hosts (like `developer.dev.alkamitech.com`) will now be captured in raw data. Previously they were silently filtered out.

### 2. Customer Success & Operations Dashboards (COMPLETED & DEPLOYED)
Added two new dashboards:
- `public/dashboards/customer-success.html` - FI value snapshot
- `public/dashboards/operations.html` - Operational health monitoring
- Updated nav.js with dashboard links
- Added dashboard API endpoints to serve-funnel.mjs

### 3. Magic Link Authentication (COMPLETED & DEPLOYED)
Implemented email-based magic link authentication with user-level FI access control.

**New Files:**
- `public/login.html` - Login page with email input
- `secrets/users.json` - User configuration (email, access_level, fi_keys)
- `secrets/sessions.json` - Server-side session storage

**Modified Files:**
- `scripts/serve-funnel.mjs` - Added auth endpoints and FI filtering
- `public/assets/js/passcode-gate.js` - Replaced passcode with session auth
- `public/assets/js/config.js` - Added auth token to all fetch requests
- `public/assets/js/nav.js` - Added user name and logout button

**Auth Endpoints:**
- `POST /auth/request-link` - Request magic link email
- `GET /auth/verify?token=` - Verify magic link, create session
- `GET /auth/me` - Get current user info
- `POST /auth/logout` - Delete session

**Features:**
- Magic links expire in 15 minutes (one-time use)
- Sessions expire in 7 days
- FI filtering enforced at API level based on user's `fi_keys`
- No email enumeration (same response for valid/invalid emails)
- SendGrid integration for emails

**User Config Format (`secrets/users.json`):**
```json
{
  "users": [
    {
      "email": "arne@strivve.com",
      "name": "Arne Gaenz",
      "access_level": "full",
      "fi_keys": "*",
      "enabled": true
    },
    {
      "email": "john@bigbank.com",
      "name": "John Smith",
      "access_level": "limited",
      "fi_keys": ["bigbank", "bigbank-prod"],
      "enabled": true
    }
  ]
}
```

**Access Levels:**
- `full` - All pages including Admin tools, all FIs (or filtered by fi_keys)
- `limited` - Only funnel.html and troubleshoot.html
- `billing` - Only fi-api-billing.html

### 4. SendGrid Email Configuration (COMPLETED & DEPLOYED)
Configured SendGrid for magic link email delivery.

**Setup:**
- Created SendGrid account
- Verified single sender: `arne@strivve.com`
- Generated API key with Mail Send permissions
- Configured PM2 env vars on Lightsail

**Environment Variables (PM2):**
- `SIS_MAGIC_LINK_BASE=https://34-220-57-7.sslip.io`
- `SENDGRID_API_KEY` - Configured
- `SENDGRID_FROM_EMAIL=arne@strivve.com`

### 5. Removed Admin Key - Session Auth Only (COMPLETED & DEPLOYED)
Replaced the old admin key mechanism with session-based authentication.

**Changes:**
- Removed `SIS_ADMIN_KEY` env var and all admin key handling from server
- Added `requireFullAccess(req, res, queryParams)` function
- All admin endpoints now check for valid session with `access_level: "full"`
- Removed admin key UI from maintenance page
- Updated `validateSession` to accept token via query param (for EventSource)

### 6. User Management Page (COMPLETED & DEPLOYED)
Created a UI for managing authorized users.

**New Files:**
- `public/users.html` - User management interface (add/edit/delete users)

**New API Endpoints:**
- `GET /api/users` - List all users (full access only)
- `POST /api/users/save` - Add or update a user
- `POST /api/users/delete` - Delete a user

**Features:**
- Add users with email, name, access level, FI keys
- Edit existing users
- Delete users
- Enable/disable accounts
- Reference table showing access level descriptions

### 7. Navigation Reorganization (COMPLETED & DEPLOYED)
Reorganized the navigation into 4 groups with access control.

**New Nav Structure:**
- **Conversions**: Overview, FI Funnel, Customer Success Dashboard, Sources, UX Paths, Placement Outcomes
- **Reliability**: Merchant Heatmap, Alerts & Watchlist
- **Ops**: Operations Dashboard, Troubleshoot, Real-Time, Synthetic Traffic, FI API, Server Logs
- **Admin** (full access only): Data & Config, Users

**Changes:**
- Added `fullAccessOnly: true` flag to Admin group
- Updated `getGroupsForAccess()` to filter groups based on access level
- Added Users card to overview page (index.html)

### 8. GA Data Investigation (RESOLVED)
**The Problem:** Traffic from `developer.dev.alkamitech.com/StrivveCardUpdatr` was not appearing in GA.

**Root Cause Found:** The GA4 tag was missing "Page changes based on browser history events" setting. Since CardUpdatr is an SPA, only initial page loads were being tracked, not navigation through the funnel.

**Fix:** User enabled this setting in GA4. Traffic should now appear.

## Deployment

**Lightsail Server:**
- IP: 34.220.57.7
- URL: https://34-220-57-7.sslip.io
- SSH: `ssh -i secrets/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7`
- Cost: ~$3.50-5/month

**GitHub Pages (static frontend):**
- URL: https://arnegaenz.github.io/SIS/
- API calls go to Lightsail via `SIS_API_BASE` in config.js

**Deploy Commands:**
```bash
# Quick deploy
ssh -i secrets/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 "cd ~/strivve-metrics && git pull origin main && pm2 restart sis-api"

# Upload secrets
scp -i secrets/LightsailDefaultKey-us-west-2.pem secrets/users.json ubuntu@34.220.57.7:~/strivve-metrics/secrets/

# View logs
ssh -i secrets/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 "tail -50 ~/.pm2/logs/sis-api-out.log"
```

## GA Properties Reference

| Property | ID | Credential File | Purpose |
|----------|-----|-----------------|---------|
| Production | 328054560 | `secrets/ga-service-account.json` | Live customer traffic |
| Test | 332183682 | `secrets/ga-test.json` | Test/dev traffic (customer-dev, mbudos, etc.) |

| Tag | Measurement ID | Routes To |
|-----|---------------|-----------|
| Master Roll up - Non Prod | `G-8480C1DGR5` | Property 332183682 (test) |
| ACME Bank - GA4 | `G-SG78E3WFCT` | Unknown property (no API access) |

## Useful Commands

```bash
# Start local server
node scripts/serve-funnel.mjs

# Fetch raw data for date range
node scripts/fetch-raw.mjs 2026-01-01 2026-01-27

# Build daily rollups from raw
node scripts/build-daily-from-raw.mjs 2026-01-01 2026-01-27

# Review raw test GA data
node scripts/review-test-ga-data-raw.mjs

# Test auth locally
curl -s http://localhost:8787/auth/me
curl -s -X POST http://localhost:8787/auth/request-link -H "Content-Type: application/json" -d '{"email":"arne@strivve.com"}'
```

## Project Overview

**SIS (Strivve Insights Service)** is the analytics backbone for Strivve's CardUpdatr/CardSavr platform:
- Consolidates sessions, placements, and GA data across multiple CardSavr instances
- Provides dashboards for leadership, partners, and operations
- Server runs on port 8787, frontend at `public/`

**Improvement Areas (Updated):**
1. ~~GA Filtering~~ (DONE - now stores raw, filters at aggregation)
2. ~~Security - API auth~~ (DONE - magic link auth with FI filtering)
3. ~~Admin key~~ (DONE - replaced with session auth)
4. ~~User management UI~~ (DONE - users.html page)
5. No test coverage (0%)
6. Memory/scalability (full dataset in RAM)
7. Code quality (verbose logging, inconsistent patterns)

## Files Created During Sessions

**GA Investigation Scripts:**
- `scripts/review-test-ga-data.mjs` - Shows filtered GA data
- `scripts/review-test-ga-data-raw.mjs` - Shows unfiltered raw GA data
- `scripts/review-test-ga-data-realtime.mjs` - Compares real-time vs standard API
- `scripts/test-ga-freshness.mjs` - Tests GA data processing delay
- `scripts/search-for-alkamitech.mjs` - Searches prod property
- `scripts/search-alkamitech-test.mjs` - Searches test property
- `scripts/search-alkamitech-wide.mjs` - Wide date range search
- `scripts/check-fresh-data.mjs` - Checks for fresh data arrival
- `scripts/list-data-streams.mjs` - Lists GA data streams

**Dashboard Files:**
- `public/dashboards/customer-success.html`
- `public/dashboards/operations.html`
- `public/assets/css/dashboards.css`
- `public/assets/js/customer-success-dashboard.js`
- `public/assets/js/operations-dashboard.js`
- `public/assets/js/dashboard-utils.js`

**Auth Files:**
- `public/login.html`
- `public/users.html`
- `secrets/users.json`
- `secrets/sessions.json`

## Git Commits Today

1. `738815f` - Refactor GA data to store raw and filter at aggregation time
2. `11f31a8` - Add Customer Success and Operations dashboards
3. `62f5af2` - Add dashboard API endpoints to serve-funnel
4. `15405a4` - Add GA diagnostic and investigation scripts
5. `eecabac` - Fix navigation links for GitHub Pages (reverted)
6. `aa0578e` - Simplify nav links with subdirectory detection
7. `432c2ce` - Add magic link authentication with user-level FI access control
8. `e0a5ae4` - Replace admin key with session-based auth for maintenance page
9. `f430f17` - Add user management page and reorganize navigation

## Next Steps / TODO

1. **Customize Access Levels** - Current levels (full/limited/billing) may need adjustment to fit actual use cases
2. **Verify GA Data** - Check if alkamitech SPA traffic is now appearing after enabling browser history events
3. **Optional: More FI Filtering** - Currently only `/api/metrics/funnel` and `/api/metrics/ops` enforce FI filtering. Could add to `/daily-range`, etc.
4. **Optional: Split Maintenance Page** - The maintenance page is still large (149K). Could split into separate pages (Data Refresh, FI Registry, Instances, GA Credentials) for better organization.
