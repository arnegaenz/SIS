# Claude Session Summary - 2026-01-29/30

---

## Session: Multi-Select Dropdowns for User Access (2026-01-30)

### Goal
Replace text input fields for instance/partner/FI access in the user edit modal with multi-select dropdown components. Remove wildcard (`*`) support - users must explicitly select what they need access to.

### Changes

1. **New API Endpoint**
   - `GET /api/user-access-options` - Returns all available instances, partners, and FIs from the FI registry (admin-only)

2. **User Edit Modal Redesign**
   - Replaced text inputs with multi-select dropdown components
   - Each dropdown has "Select all" toggle and individual checkboxes
   - FI dropdown includes search box (for large lists)
   - Tightened CSS spacing for compact display

3. **Removed Wildcard Support**
   - Backend now converts `"*"` to empty arrays
   - Users must explicitly select instances/partners/FIs
   - Principle of least privilege enforced

4. **Bug Fix**
   - `/api/users` GET now returns `instance_keys` and `partner_keys` (were missing)

### Files Modified

**[scripts/serve-funnel.mjs](scripts/serve-funnel.mjs)**
- Added `/api/user-access-options` endpoint
- Updated `/api/users` to return instance_keys/partner_keys
- Updated `/api/users/save` to reject wildcards

**[public/users.html](public/users.html)**
- New `.access-multi-select` CSS component
- Multi-select dropdowns for instance/partner/FI access
- JavaScript for dropdown rendering, toggle, search

### Git Commits

1. `59f9d01` - Replace user access text inputs with multi-select dropdowns
2. `a9347fd` - Tighten multi-select dropdown spacing

---

## Session: Granular Access Control (2026-01-30)

### Goal
Enhance the magic link authentication system to support granular data access control by instance, partner, or specific FIs.

### Access Levels (Final)

| Level | Pages | Data Access |
|-------|-------|-------------|
| `admin` | All pages + User Management | Full (always) |
| `internal` | All pages except User Management | Full (for Strivve team) |
| `limited` | Funnel, Troubleshoot, Real-Time | Filtered by instance/partner/FI |

### New User Model Fields

```json
{
  "email": "partner@alkami.com",
  "name": "Alkami Partner",
  "access_level": "limited",
  "instance_keys": ["ss01"],
  "partner_keys": ["Alkami"],
  "fi_keys": ["special-test-fi"],
  "enabled": true,
  "notes": "Sees ss01 instance + all Alkami FIs + one test FI"
}
```

**Access Key Options:**
- `[]` = None via this dimension
- `["val1", "val2"]` = Specific values (selected via dropdowns)

**Note:** Wildcards (`"*"`) are no longer supported. Use the multi-select dropdowns to explicitly select access.

**UNION Semantics:** User can access an FI if it matches ANY of their access criteria (instance OR partner OR fi_keys).

### Features Implemented

1. **Three-Dimensional Access Control**
   - `instance_keys` - Restrict to specific CardSavr instances
   - `partner_keys` - Restrict to FIs belonging to specific partners
   - `fi_keys` - Restrict to specific FI lookup keys

2. **Backend Access Logic**
   - `computeAllowedFis()` function computes allowed FIs from registry
   - `parseMetricsFilters()` updated to use new access model
   - Admin and internal users always get full data access

3. **API Endpoints**
   - `GET /api/filter-options` - Returns user-scoped filter dropdown options
   - `GET /api/user-access-options` - Returns all options for admin user management
   - `POST /api/access-preview` - Returns FI count for given access config

4. **User Management UI**
   - Multi-select dropdowns for instance/partner/FI access
   - Live preview: "User will have access to X FIs"
   - Data access section hidden for admin/internal users

5. **Frontend Filter Scoping**
   - `filters.js` fetches user-scoped options from `/api/filter-options`
   - Dropdowns only show FIs the user can access

6. **Migration Script**
   - `scripts/migrate-users-access.mjs` - Migrates existing users to new schema
   - Renames "full" to "admin", adds instance_keys/partner_keys fields

### Files Modified

**[scripts/serve-funnel.mjs](scripts/serve-funnel.mjs)**
- `computeAllowedFis()` - New function for access control logic
- `normalizeUserAccessFields()` - Backward compatibility for legacy users
- `parseMetricsFilters()` - Now accepts fiRegistry, uses new access model
- `/api/filter-options` - New endpoint for scoped dropdown options
- `/api/user-access-options` - New endpoint for admin UI
- `/api/access-preview` - New endpoint for admin UI preview
- `/api/users/save` - Accepts new instance_keys, partner_keys fields

**[public/users.html](public/users.html)**
- Multi-select dropdowns for instance/partner/FI access
- Access preview with live FI count
- Updated access level dropdown (admin/internal/limited)
- Updated reference table

**[public/assets/js/filters.js](public/assets/js/filters.js)**
- `loadUserScopedOptions()` - Fetches scoped options from API
- `filterRegistryByUserScope()` - Filters registry for restricted users
- `initFilters()` - Uses scoped options when available

**[public/assets/js/passcode-gate.js](public/assets/js/passcode-gate.js)**
- Updated page access logic for admin/internal/limited
- Admin-only pages list (users.html)
- Internal users can access everything except user management

**[scripts/migrate-users-access.mjs](scripts/migrate-users-access.mjs)** (NEW)
- Migration script for existing users.json

### Git Commits

1. `f5cf425` - Add GA4 Realtime API integration to Real-Time troubleshooting page
2. `63a7d6f` - Fix realtime API to allow up to 4 hour time range
3. `87a7f91` - Add granular access control by instance, partner, or FI
4. `1ca5adc` - Replace billing access level with internal
5. `59f9d01` - Replace user access text inputs with multi-select dropdowns
6. `a9347fd` - Tighten multi-select dropdown spacing

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
2. **Test/Prod GA Property Switching**
3. **Expandable Page Activity Rows**
4. **Visual "Freshness" Indicators**
5. **Flexible Time Ranges** (5 min to 4 hr)
6. **Fixed Time Range Bug** (was using midnight timestamps)

---

# Previous Sessions - 2026-01-27

## What We Accomplished

### 1. GA Filtering Refactor (COMPLETED & DEPLOYED)
Refactored GA data fetching to **store all raw data** and **filter at aggregation time**.

### 2. Customer Success & Operations Dashboards (COMPLETED & DEPLOYED)

### 3. Magic Link Authentication (COMPLETED & DEPLOYED)
Email-based magic link authentication with user-level FI access control.

### 4. SendGrid Email Configuration (COMPLETED & DEPLOYED)
**Note:** SendGrid API key may need regeneration - was returning 401 errors.

### 5. Removed Admin Key - Session Auth Only (COMPLETED & DEPLOYED)

### 6. User Management Page (COMPLETED & DEPLOYED)

### 7. Navigation Reorganization (COMPLETED & DEPLOYED)

---

## Deployment

**Lightsail Server:**
- IP: 34.220.57.7
- URL: https://34-220-57-7.sslip.io
- SSH: `ssh -i secrets/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7`

**Deploy Commands:**
```bash
# Quick deploy
ssh -i secrets/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 "cd ~/strivve-metrics && git pull origin main && pm2 restart sis-api"

# Run migration (already done on server)
node scripts/migrate-users-access.mjs --apply

# View logs
ssh -i secrets/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 "tail -50 ~/.pm2/logs/sis-api-out.log"
```

## GA Properties Reference

| Property | ID | Credential File | Purpose |
|----------|-----|-----------------|---------|
| Production | 328054560 | `secrets/ga-service-account.json` | Live customer traffic |
| Test | 332183682 | `secrets/ga-test.json` | Test/dev traffic |

## Example User Configurations

```json
// Admin - full access, can manage users (access keys ignored)
{ "access_level": "admin", "instance_keys": [], "partner_keys": [], "fi_keys": [] }

// Internal (Strivve team) - full data, no user management (access keys ignored)
{ "access_level": "internal", "instance_keys": [], "partner_keys": [], "fi_keys": [] }

// Partner sees all their FIs (select partner from dropdown)
{ "access_level": "limited", "instance_keys": [], "partner_keys": ["Alkami"], "fi_keys": [] }

// Instance-scoped user (select instance from dropdown)
{ "access_level": "limited", "instance_keys": ["ss01"], "partner_keys": [], "fi_keys": [] }

// Specific FI access only (select FIs from dropdown)
{ "access_level": "limited", "instance_keys": [], "partner_keys": [], "fi_keys": ["bigbank", "bigbank-prod"] }

// Combo: Partner + extra test FI (UNION semantics)
{ "access_level": "limited", "instance_keys": [], "partner_keys": ["DigitalOnboarding"], "fi_keys": ["test-fi"] }
```

**Note:** Wildcards (`"*"`) are no longer supported. Access is configured via multi-select dropdowns in the user edit modal.

## Known Issues

1. **SendGrid API Key** - May need regeneration (returning 401 Permission denied)
2. **No test coverage** (0%)

## Next Steps / TODO

1. ~~Customize Access Levels~~ (DONE - admin/internal/limited)
2. **Fix SendGrid** - Generate new API key
3. **Verify GA Data** - Check if alkamitech SPA traffic is appearing
4. **Optional: More FI Filtering** - Add to other endpoints beyond funnel/ops
