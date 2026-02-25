# SIS / CardUpdatr Dashboard — Project Context

## Deployment Info
- **SSH Key**: `~/.ssh/LightsailDefaultKey-us-west-2.pem`
- **Server**: `ubuntu@34.220.57.7`
- **Path**: `/home/ubuntu/strivve-metrics/`
- **PM2 Process**: `sis-api` (NOT sis-metrics)
- **Deploy command**: `scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem <local-file> ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/<path> && ssh -i ~/.ssh/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 "pm2 restart sis-api"`

## End-of-Session Protocol ("lock it down")
When the user says "lock it down", "end the session", or similar — run this checklist before signing off:
1. **Commit & push all changes**: `git status`, stage relevant files, commit with a clear message, then `git push` to origin. Verify `git log --oneline origin/main..HEAD` shows nothing.
2. **Verify deployment**: Confirm all changed files that were deployed during the session are committed locally (no drift between server and repo)
3. **Update build history**: Add a dated entry to `CHANGELOG.md` documenting what was built/changed
4. **Testing checklist review**: Run through the Pre-Deployment Testing Checklist below for any deployed changes, and discuss whether new checks should be added
5. **Update MEMORY.md**: If any new patterns, gotchas, or conventions were discovered during the session, record them

## Pre-Deployment Testing Checklist
**Run through these checks before deploying any changes. This is a living checklist — review and update after each working session.**

### Share Link Verification
After any change to filters, data fetching, share link generation, or view-mode rendering:
1. **Filter preservation**: Generate a share link with specific filters (partner, instance, FI, integration type, date range). Open the link in a new incognito/private window. Verify all filters are reflected in the URL params and applied on load.
2. **FI data isolation**: With a single FI or partner selected, generate a share link. Open it and confirm ONLY that FI/partner's data appears — no cross-FI or cross-partner leakage in tables, charts, or insights.
3. **View-mode lockdown**: Shared links should be read-only. Confirm filter controls are hidden/disabled, no edit capabilities exposed, and the expiration notice displays correctly.
4. **Page coverage**: If the change touches shared infrastructure (filters.js, passcode-gate.js, serve-funnel.mjs), test share links on ALL pages that support them: `funnel-customer.html`, `funnel.html`, `supported-sites.html`.

### Session Checklist Review
At the end of each working session, briefly discuss:
- Did today's changes introduce any new testable surfaces?
- Should any new checks be added to this list?

## Key Files
- `scripts/serve-funnel.mjs` - Main server (very large, ~6100+ lines)
- `public/assets/js/passcode-gate.js` - Auth, session, activity logging
- `public/assets/js/engagement-insights.js` - Insights engine (narratives, spectrum, actions, projections)
- `public/assets/js/action-library.js` - ACTION_LIBRARY data + lookup helpers (loaded before engagement-insights.js)
- `public/assets/js/filters.js` - Filter bar, multi-select dropdowns, scope logic
- `public/assets/js/nav.js` - Navigation with access control
- `public/funnel.html` - Internal FI Funnel page (HTML + CSS + JS, very large ~6900 lines)
- `public/funnel-customer.html` - Customer-facing Cardholder Engagement Dashboard (~5100 lines)
- `public/resources/engagement-playbook.html` - Full engagement playbook page (auto-generated from ACTION_LIBRARY)
- `public/dashboards/portfolio.html` - CS Portfolio Dashboard (Phase 3 — engagement scores, tiers, warnings)
- `public/assets/js/portfolio-dashboard.js` - Portfolio dashboard module (ES6, ~750 lines)
- `templates/funnel-report-template.mjs` - Internal PDF template
- `templates/funnel-customer-report-template.mjs` - Customer PDF template
- `src/config/terminationMap.mjs` - Termination type definitions with labels
- `public/login.html` - Magic link login page
- `secrets/users.json` - User data with access levels, login stats
- `fi_registry.json` - FI registry (fi_lookup_key, instance, partner, integration_type)
- `public/campaign-builder.html` - Campaign URL Builder page (form → tracked CardUpdatr launch URL + QR code)
- `public/assets/js/campaign-builder.js` - Campaign builder module (IIFE, ~400 lines)
- `public/assets/js/qrcode.min.js` - QR code generator library (qrcode-generator by Kazuhiko Arase, MIT)
- `assets/images/StrivveLogo.png` - Strivve logo (used in playbook page + PDF, base64-embedded)
- `public/dashboards/executive.html` - Executive Summary dashboard (verdict, KPIs, 12-week trend, warnings, distributions, kiosk mode)
- `public/assets/js/executive-dashboard.js` - Executive dashboard module (ES6, ~350 lines)
- `public/assets/js/synthetic-traffic.js` - Synthetic traffic job management + correlated sessions modal
- `public/supported-sites.html` - Supported Sites page (Living Ecosystem narrative + merchant sites table, ~1200 lines)
- `templates/supported-sites-report-template.mjs` - Supported Sites PDF template (Puppeteer-rendered)

## Critical Lessons (Hard-Won)
- **Do NOT expose window.applyFilters** — causes race condition that breaks ALL users
- **NEVER use top-level `return` in inline `<script>` blocks** — Safari throws `SyntaxError: Return statements are only valid inside functions` at parse time, killing the ENTIRE script. Use IIFE wrapper or flag pattern instead. Chrome/Firefox tolerate it, Safari does not.
- **FI keys not unique across instances** — always filter by partner/instance composite
- **`calculateConversionMetrics()` sums from visibleRows** — can't be used for date-subsetting
- **`assignMeta()` whitelists fields** — new registry fields must be added there
- **Customer page `getCardholderMap()` returns `{}`** — cardholders come from registry `total` field fallback
- **Never trust client-side expiration** — share link `expires` query params can be stripped/edited. Use server-side validation via `GET /api/share-validate?sid=xxx` (checks share log creation time + admin TTL)

## Access Control System
- **Admin pages**: users.html, synthetic-traffic.html, maintenance.html, activity-log.html, shared-views.html, logs.html
- **Executive user pages**: funnel-customer.html, executive.html, supported-sites.html (redirects elsewhere → executive dashboard)
- **Executive user redirect**: → dashboards/executive.html
- **Executive user nav**: "Dashboards" group with Executive Summary + Cardholder Engagement
- **Limited user pages**: funnel.html, funnel-customer.html, campaign-builder.html, supported-sites.html
- **Limited user redirect**: → funnel-customer.html (NOT funnel.html)
- **Limited user nav**: "Dashboards" group with Cardholder Engagement + Campaign URL Builder
- **Limited user filters**: Partner + FI visible; Instance + Integration hidden
- Access levels: admin, full (legacy=admin), internal (all except admin pages), executive, limited
- **View-as switcher**: Admin/full users can preview other roles. Uses `sisAuth.getRealAccessLevel()` to check true level (not overridden). Switching navigates to role's default page.
- **Homepage (index.html)**: Thin redirect stub — admin/internal→portfolio, limited→funnel-customer, executive→executive dashboard

## Architecture Patterns
- IIFE wrapper on engine module (avoids global variable collision)
- Insights computed client-side, sent as `insightsPayload` to server for PDF
- Admin detection: `window.sisAuth.getAccessLevel()` — admin/full/internal
- Admin visibility: `body.show-admin-overlay .admin-overlay` CSS pattern
- QBR mode: `body.qbr-mode .qbr-section` CSS pattern
- Filter hints: `applyInsightFilter()` + `window.__FILTER_SET()`
- `page-section` CSS class with `page-break-inside: avoid` for PDF layout
- Customer page uses `window.__FILTER_STATE` with pageId `"funnel-customer"`
- `getVisibleRows()` checks `shared.page === "funnel-customer"` (not `"funnel"`)

## Related Repos
- **arg-fcu**: Contains traffic runner at `tools/traffic-runner/`, hosted on GitHub Pages (arg-fcu.com)
  - **Traffic runner deployment**: `scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem <files> ubuntu@34.220.57.7:/home/ubuntu/traffic-runner/` then `pm2 restart traffic-runner`
  - **PM2 process**: `traffic-runner` (runs `runner-loop.mjs`, polls every 30s, spawns fresh `run-sis-jobs.js` each cycle)
  - **Logs**: `pm2 logs traffic-runner --lines N`
  - **Error screenshots**: `/home/ubuntu/traffic-runner/run-*-error.png` (on exception), `timeout-debug.png` (on timeout, captured before overlay close)
  - **arg-fcu.com pages**: Deploy via `git push` to main (GitHub Pages)

## Known Issues
- FI lookup keys not unique across instances — always filter by partner/instance composite

---

# The Product

**CardUpdatr** is Strivve's product that lets cardholders update their payment card across multiple merchants (Netflix, Amazon, etc.) in one session. It's sold to financial institutions (credit unions, banks) through integration partners (Alkami, etc.). The **Customer Engagement Dashboard** (`public/funnel-customer.html`) is the partner-facing analytics page showing how cardholders are using CardUpdatr at each FI.

---

# Key Strategic Frameworks

## Motivation Spectrum (Validated with Data)
The core thesis: CardUpdatr's conversion rate is determined by cardholder motivation at the moment of encounter, not product quality or technology.

- **Tier 1 — Activation (21-27%)**: Cardholder just got a new card. Urgent need. 1 in 4 completes.
- **Tier 2 — Campaigns (8-12%)**: Cardholder prompted via SMS/email. Manufactured motivation. 1 in 10 acts.
- **Tier 3 — Incidental (<3%)**: Cardholder browsing online banking. No prompt, no urgency. Curiosity only.
- **7.7x conversion gap** between motivated and incidental traffic (validated across multiple FIs)

### Tier Classification
`classifyTier()` uses **Session Success Rate**, NOT Monthly Reach %.
- >=21% → Tier 1 (Card Activation Flow)
- >=12% → Tier 1.5 (Campaign → Activation transition)
- >=8% → Tier 2 (SMS & Targeted Campaigns)
- >=3% → Tier 2.5 (Discovery → Campaign transition)
- <3% → Tier 3 (Incidental Discovery)

### Non-SSO Tier Classification
`classifyNonSSOTier()` — shifted thresholds because every non-SSO "visit" already represents a committed cardholder (they entered card data manually before seeing merchants).
- >=35% → Tier 1 (Card Activation Flow)
- >=25% → Tier 1.5 (Campaign → Activation transition)
- >=15% → Tier 2 (Targeted Campaigns)
- >=8% → Tier 2.5 (Discovery → Campaign transition)
- <8% → Tier 3 (Organic Discovery)

## Benchmarking Philosophy
Always benchmark against best-of-best performance (aspirational ceiling), never averages. Use the partner's own best-week/best-quarter data as proof their cardholders CAN convert. Named FI references (MSUFCU, Cape Cod Five, Kemba, ORNL) are admin-only — customer-facing benchmarks are anonymized.

## Tone & Framing Directive
All partner-facing content follows engagement-positive tone:
1. Lead with what's working, then show opportunity
2. Frame gaps as opportunity, not failure
3. Use their best performance as the anchor
4. Declining trends framed as controllable, not alarming
5. Tier 3 is a starting line, not a verdict
6. Projections should feel exciting, not hypothetical
7. Never blame the partner
8. Always include a path forward

**Admin view stays unvarnished** — Strivve employees need the real story.

---

# Build History

> **Full changelog moved to `CHANGELOG.md`** to reduce context window usage. Add new session entries there.
> Reference Partner Data (NASA FCU) also moved to CHANGELOG.md.


---

# What's Pending / Queued

### AI-Powered Insights Engine (Planned, Awaiting API Key)
- Replace rule-based insights (50+ hardcoded rules in `engagement-insights.js`) with Claude API-generated insights
- Server-side only, on-demand with caching, existing auth gates access
- System prompt includes: motivation spectrum, tone directives, ACTION_LIBRARY, benchmarking philosophy
- Model: Haiku 4.5, estimated $20-50/mo at normal usage, $0 when idle
- Business Anthropic API account (console.anthropic.com), key in `secrets/anthropic.json`
- Full plan: `docs/ai-insights-plan.md`
- **Blocker**: Need business API key before building prototype

### Card Replacement Reach Math (Discussed, Not Yet Built)
- ~25% annual portfolio turnover from expirations, ~3-5% lost/stolen = ~28-30% annual (2.3-2.5% monthly)
- These are Tier 1 motivation cardholders at peak urgency
- Framing: "You have ~1,000 cardholders per month at peak motivation. How many encounter CardUpdatr at that moment?"
- Could become a calculator widget or narrative rule


---

# Workflow

**Strategic thinking and prompt creation** → Claude Chat
**Implementation** → Claude Code (VS Code / CoWork / terminal)
**Audit and review** → Claude Code generates audit docs, brought back to Claude Chat for analysis
**Iteration** → Fixes/enhancements designed in Claude Chat, handed to Claude Code
