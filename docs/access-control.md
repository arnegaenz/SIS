# Access Control System — 9 Roles

## Why This Exists

Bryan's feedback (Feb 2026) highlighted that too many pages were visible to non-admin users, creating a distracting and unfocused experience. Partners logging in to check their cardholder engagement data were seeing operations dashboards, troubleshooting tools, and analysis pages that weren't relevant to them.

The original system had 4 levels: `admin`, `internal`, `executive`, `limited`. This was too coarse — a site operations engineer and a customer success manager both landed on "internal" but needed completely different page sets. Partners and individual FI contacts both landed on "limited" but had different real-world needs.

The overhaul replaces those 4 levels with 9 intentional roles, each with a curated page set and nav structure tailored to their real-world job.

---

## The 9 Roles

| # | Role | Who | Landing Page | Data Access |
|---|---|---|---|---|
| 1 | **admin** | ARG — full control | CS Portfolio | All FIs (unrestricted) |
| 2 | **core** | Strivve core team — everything minus admin pages | CS Portfolio | All FIs (unrestricted) |
| 3 | **internal** | Strivve team — curated overview | CS Portfolio | All FIs (unrestricted) |
| 4 | **siteops** | Site support engineer — merchant reliability | Operations Dashboard | All FIs (unrestricted) |
| 5 | **support** | Customer support — troubleshooting | Support Lookup | All FIs (unrestricted) |
| 6 | **cs** | Customer Success — FI relationships | CS Portfolio | All FIs (unrestricted) |
| 7 | **executive** | Board, C-suite — big picture | Executive Summary | Scoped by keys |
| 8 | **partner** | Integration partners (Alkami, etc.) | Cardholder Engagement | Scoped by keys |
| 9 | **fi** | Individual FI contacts | Cardholder Engagement | Scoped by keys |

### Data Access Categories

- **Unrestricted** (admin, core, internal, siteops, support, cs): See all FIs regardless of `instance_keys`, `partner_keys`, or `fi_keys` settings.
- **Scoped** (executive, partner, fi): Only see FIs that match their `instance_keys`, `partner_keys`, or `fi_keys`. The `partner` and `fi` roles also have simplified filter bars (Partner + FI dropdowns only; Instance + Integration hidden).

---

## Page Access Matrix

| Page | admin | core | internal | siteops | support | cs | exec | partner | fi |
|---|---|---|---|---|---|---|---|---|---|
| CS Portfolio | x | x | x | | | x | | | |
| Cardholder Engagement | x | x | x | | | x | | x | x |
| Supported Sites | x | x | x | x | x | x | x | x | x |
| Campaign Builder | x | x | | | | x | | x | x |
| Executive Summary | x | x | x | | | | x | | |
| Operations Dashboard | x | x | x | x | | x | | | |
| Merchant Heatmap | x | x | | x | | x | | | |
| Alerts & Watchlist | x | x | x | x | | x | | | |
| Real-Time | x | x | | x | x | x | | | |
| Troubleshoot | x | x | x | x | x | x | | | |
| Support Lookup | x | x | | | x | x | | | |
| FI Funnel | x | x | x | x | | x | | | |
| Cardholder Experience | x | x | x | | | x | | | |
| FI API | x | x | | | x | x | | | |
| Engagement Playbook | x | x | x | x | x | x | x | x | x |
| Customer Success Dash | x | x | | | | x | | | |
| Sources | x | x | | | | | | | |
| UX Paths | x | x | | | | | | | |
| Placement Outcomes | x | x | | | | | | | |
| Users | x | | | | | | | | |
| Data & Config | x | | | | | | | | |
| User Activity | x | | | | | | | | |
| Shared Links | x | | | | | | | | |
| Server Logs | x | | | | | | | | |
| Synthetic Traffic | x | | | | | | | | |

---

## Nav Groups Per Role

### fi / partner
- **Dashboards**: Cardholder Engagement, Supported Sites, Campaign Builder

### executive
- **Dashboards**: Executive Summary, Supported Sites

### support
- **Support Tools**: Support Lookup, Troubleshoot, Real-Time, FI API
- **Reference**: Supported Sites

### siteops
- **Monitoring**: Operations, Real-Time, Alerts & Watchlist
- **Sites**: Supported Sites, Merchant Heatmap
- **Analysis**: FI Funnel, Troubleshoot

### internal
- **Dashboards**: CS Portfolio, Cardholder Engagement, Executive Summary, Supported Sites
- **Monitoring**: Operations, Alerts & Watchlist
- **Analysis**: FI Funnel, Cardholder Experience, Troubleshoot

### cs
- **Dashboards**: CS Portfolio, Cardholder Engagement, Customer Success Dashboard, Supported Sites, Campaign Builder
- **Monitoring**: Operations, Heatmap, Real-Time, Alerts & Watchlist
- **Analysis**: FI Funnel, Cardholder Experience
- **Support**: Support Lookup, Troubleshoot, FI API

### core
- Same as admin minus the Admin group (Users, Data & Config, etc.)
- Includes all WIP pages (Sources, UX Paths, Placement Outcomes) + Engagement Playbook in nav

### admin
- Full nav — all groups including Admin (Users, Data & Config, User Activity, Shared Links, Server Logs, Synthetic Traffic)

---

## Implementation Details

### Key Files

| File | What it controls |
|---|---|
| `src/lib/scoping.mjs` | `UNRESTRICTED_DATA_ROLES` set, `VALID_ACCESS_LEVELS`, `normalizeUserAccessFields()` (legacy mapping), `computeAllowedFis()` |
| `public/assets/js/passcode-gate.js` | `PAGE_ACCESS_MAP` (page filename → allowed roles), `LANDING_PAGES` (role → default redirect), `checkPageAccess()`, `normalizeRole()` |
| `public/assets/js/nav.js` | `NAV_CONFIGS` (per-role nav group definitions), `ITEMS` (master nav item registry), `getGroupsForAccess()`, view-as switcher |
| `scripts/serve-funnel.mjs` | Server-side access whitelist (user save), `is_admin` flag in `/filter-options`, `isAdminUser` in troubleshoot endpoints |
| `public/assets/js/filters.js` | Filter hiding for partner/fi roles (Instance + Integration hidden) |

### How Page Gating Works

1. User loads a page → `passcode-gate.js` runs on DOMContentLoaded
2. `getAccessLevel()` determines the effective role (checking impersonation, view-as override, stored user)
3. `checkPageAccess()` looks up the page filename in `PAGE_ACCESS_MAP`
4. If the role is in the allowed list → page loads normally
5. If not → redirect to `LANDING_PAGES[role]`
6. Admin bypasses all checks; view-as active also bypasses (admin is previewing UI only)

### How Nav Rendering Works

1. `getGroupsForAccess()` checks the effective role
2. Admin → returns full `GROUPS` array (all pages including Admin group)
3. Any other role → returns `NAV_CONFIGS[role]` (curated nav groups)
4. Unknown/legacy roles fall back to `NAV_CONFIGS["fi"]`

### How to Add a New Role's Page Access

1. Add the role to `PAGE_ACCESS_MAP` entries in `passcode-gate.js` for each page they should access
2. Add a `NAV_CONFIGS` entry in `nav.js` defining their nav groups
3. Add a `LANDING_PAGES` entry in `passcode-gate.js` for their default landing page
4. Add the role to `UNRESTRICTED_DATA_ROLES` in `scoping.mjs` if they should see all FI data
5. Add the role to the server whitelist in `serve-funnel.mjs` (~line 5591)
6. Add badge CSS in `users.html` (light + dark mode)
7. Add to dropdowns in `users.html` (filter + modal)

### How to Add a New Page

1. Add the page filename to `PAGE_ACCESS_MAP` in `passcode-gate.js` with the list of allowed roles
2. Add a nav item to `ITEMS` dict in `nav.js`
3. Add the item id to the relevant `NAV_CONFIGS` role entries
4. Add to `GROUPS` if it should appear in admin nav

---

## Backward Compatibility

- `"full"` continues to map to `"admin"` (existing behavior, no change needed)
- `"limited"` maps to `"fi"` behavior everywhere:
  - `scoping.mjs:normalizeUserAccessFields()` converts it
  - `passcode-gate.js:normalizeRole()` converts it
  - `nav.js` falls back to `NAV_CONFIGS["fi"]` for unknown roles
- Existing user sessions with "limited" stored in localStorage will work until re-auth
- Server accepts both "limited" and "fi" in the access_level whitelist

---

## Test Users

8 test users exist for impersonation testing (one per non-admin role):

| Email | Role | Data Scoping |
|---|---|---|
| test-core@strivve.com | core | All FIs |
| test-internal@strivve.com | internal | All FIs |
| test-siteops@strivve.com | siteops | All FIs |
| test-support@strivve.com | support | All FIs |
| test-cs@strivve.com | cs | All FIs |
| test-executive@strivve.com | executive | All FIs |
| test-partner@strivve.com | partner | Alkami only |
| test-fi@strivve.com | fi | MSUFCU only |

Test via Users page → "View As" button on any test user.

---

## Design Rationale

### Why 9 roles instead of 4?

The old "internal" was too broad — it covered everyone from site ops engineers to customer success managers. They need different tools. Similarly, "limited" covered both integration partners (who care about campaign builders) and individual FI contacts (who just want to see their numbers). The new roles match real-world job functions.

### Why are siteops/support/cs unrestricted on data?

These are all Strivve employees who need to see data across FIs to do their jobs — a support agent needs to troubleshoot any FI's sessions, a site ops engineer needs to monitor all merchants, and CS needs to see their full portfolio. Only external users (executive, partner, fi) are data-scoped.

### Why does core exist separately from admin?

Admin has access to destructive operations (user management, data config, synthetic traffic). Core team members need to see everything but shouldn't accidentally modify user accounts or system config. It's a safety guardrail.

### Why is Engagement Playbook accessible to everyone?

It's a reference document — educational content about engagement strategies. Every role benefits from reading it. It appears in nav only for admin/core, but all roles can access it via direct URL.
