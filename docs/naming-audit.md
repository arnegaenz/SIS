# SIS Naming & Readability Audit

Generated: 2026-04-13
Scope: Full audit across pages, navigation, metrics, concepts, action library, AI insights system prompt, and PDF templates.
Goal: Flag labels that read as jargon — prioritize partner/FI-facing surfaces. Internal-only surfaces are noted but not aggressively re-named.

## Summary

- **Total items flagged:** ~55
- **Obvious wins** (low-risk renames, most are direct jargon leaks): ~25
- **Needs discussion** (strategic vocabulary): 7 clusters
- **Cross-surface inconsistencies:** 6 (same concept, different names)
- **Left alone / out of scope:** ~8 surfaces noted for context

The biggest single class of problems is **code-shaped labels leaking into UI** — `SM Sessions`, `CE Sessions`, `Sel→C %`, `Jobs_Total`, `Jobs_Failed`, `Sess w/ Success`, `@Select`, `UD Views`, `Sel→U %`. Partner-facing pages mostly avoid the worst of it, but the Portfolio Dashboard detail panel (seen by `cs`) and FI Funnel (internal, but exported to partners) are where the abbreviations cluster.

The second biggest problem is **two competing vocabularies for the same cardholder journey**:
- Funnel Customer Dashboard says **"Cardholders"**, **"Visits"**, **"Cards Updated"**, **"Successful Cardholders"**
- FI Funnel (internal) says **"Total Sessions"**, **"Sessions w/ Jobs"**, **"Placements"**, **"Sessions w/ Successful Jobs"**
- Portfolio Dashboard says **"SM Sessions"**, **"CE Sessions"**
- The AI prompt tells Claude to use **"session", "placement", "session success rate"**
- The PDF templates blend all three

A consolidated glossary would pay dividends across every surface.

---

## Obvious Wins

### Metric Labels — Partner / FI-facing surfaces

Where it shows up in the dashboards external audiences (partner, fi, executive) actually see.

| Current | Proposed | Where it appears | Note |
|---|---|---|---|
| `SM Sessions` | `Sessions Started` or just `Sessions` | `public/assets/js/portfolio-dashboard.js:1092`, `:1692`, `customer-success-dashboard.js:383,413,716`, tooltip at `portfolio.html:90,142` | "SM" = Select Merchant. Nobody outside engineering knows that. Portfolio is seen by `cs` users, customer-success is WIP but will be seen by partners if exposed. Single worst offender. |
| `CE Sessions` | `Credential Entry Sessions` or `Sessions That Entered Card` | `portfolio-dashboard.js:1096`, `customer-success-dashboard.js:384` | Same problem. Full phrase is fine — the acronym is the issue. |
| `Sel→U %` / `Sel→C %` | `Select → User Data %` / `Select → Credentials %` (or redesign as a visible funnel) | `funnel-customer.html:1836,1862,1863,1888,1889,1914,1915` | 8 columns of arrow-abbreviation noise in customer-facing tables. |
| `@Select` | `At Merchant Select` | `funnel-customer.html:1832,1856,1883,1909` | Column header in FI Performance Detail table — partner/fi role sees this. |
| `UD Views` | `User Data Views` | `funnel-customer.html:1857,1884,1910` | Customer-facing. |
| `Cred Views` | `Credential Views` | `funnel-customer.html:1833,1858,1885,1911` | Customer-facing. |
| `GA %` | `Tracked by Analytics %` or `Analytics Coverage %` | `funnel-customer.html:1834,1859,1886,1912` | "GA" = Google Analytics. Tooltip already explains it — just lead with the plain name. |
| `Est. Lnch` | `Estimated Launches` | `funnel-customer.html:1860` | Double-abbreviated. |
| `Placed` | `Successful Placements` or `Cards Updated` | `funnel-customer.html:1840,1867,1893,1919` | Reads as jargon; FI Funnel already uses "Placements" here. |
| `Rate` | `Success Rate` or `Cardholder Success %` | `funnel-customer.html:1839,1866,1892,1918` | "Rate" alone is ambiguous — session rate? job rate? |
| `Inst` | `Instances` | `funnel-customer.html:1829,1853,1880,1906` | Column header. Cheap win. |
| `Type` | `Integration` | Same rows | "Type" is context-free; next to FI/Instance it's ambiguous. |

### Metric Labels — Internal pages that still get exported to partners

| Current | Proposed | Where it appears | Note |
|---|---|---|---|
| `Jobs Total` / `Jobs Failed` (display) + `Jobs_Total` / `Jobs_Failed` (keys surfaced as `data-key` attributes) | `Total Placements Attempted` / `Failed Placements` | `dashboards/operations.html:144,145,168,169`, `dashboards/success.html:144,145,168,169` | Column headers shown in kiosk mode. "Jobs" is our internal word for placements — customer surfaces use "Placements" / "Card Updates". |
| `Sessions w/ Jobs` (Abandoned) | `Sessions That Attempted an Update` | `funnel.html:1675,3346,3506,3563` + template | "w/" abbreviation plus internal word "Jobs". |
| `Sessions w/ Successful Jobs` | `Sessions With A Successful Update` | `funnel.html:1689,4528` + `templates/funnel-report-template.mjs:55` | Same issue. |
| `Sessions w/o Jobs` | `Sessions That Never Attempted an Update` | `funnel.html:1675` + template | Parses poorly. |
| `Sess w/ Success` | `Successful Sessions` | `templates/funnel-report-template.mjs:196`, `funnel.html:3507,3564` | Column header in PDF. |
| `Sel→Succ %` / `Sess→Succ %` | `Launches → Success %` / `Sessions → Success %` | `templates/funnel-report-template.mjs:197,198,246,249` | Arrow shorthand with truncated words. At minimum spell out `Succ`. |
| `GA Select` | `Select-Merchant Views (Analytics)` | `templates/funnel-report-template.mjs:194,245`, `funnel.html:5654` (CSV header) | Nobody outside Strivve knows what "GA Select" means. |

### Metric Labels — Tooltips / help text to de-jargon

| Current | Proposed | Where |
|---|---|---|
| "Session Success Rate = sessions with at least one successful card placement / total **SM sessions**" | "...out of total sessions started" | `public/dashboards/portfolio.html:142` |
| "Calculated as **SM Sessions** / Total Cardholders on File" | "Calculated as Sessions Started / Total Cardholders on File" | `portfolio-dashboard.js:1114` |
| "Credential Entry (CE) Sessions: ... **SM-to-CE drop-off**..." | "...Merchant-Select to Credential-Entry drop-off..." | `portfolio-dashboard.js:1094` |
| "Sessions created in CardSavr API when a **grant is issued** and the **Select Merchant page loads**" | "A session starts when a cardholder reaches the merchant-selection screen" | `funnel.html:1669` |
| Tooltip on `Reach %`: "Projected monthly rate based on selected time period (using **calibrated launches** when available)" | "Projected monthly reach rate based on the selected time period. For non-SSO, uses launch volume adjusted for Google Analytics undercount." | `funnel-customer.html:1861` (also repeats 3× across integration variants) |
| `GA measurement note: Non-SSO traffic is tracked via Google Analytics, which undercounts by approximately 15–30% due to **Safari Intelligent Tracking Prevention and ad blockers**.` | Keep body, but consider renaming "GA measurement note" → "Measurement note" (Google Analytics already spelled out in body). | `funnel-customer.html:1734,4398` |

### Page / Nav Titles

| Current | Proposed | Where | Note |
|---|---|---|---|
| `FI Funnel` | `Conversion Funnel` or `Cardholder Funnel` | `nav.js:90`, `funnel.html:30`, `funnel.html:449` (PDF h1 reads "FI Funnel Report") | ARG already flagged. Internal page, but name is confusing even to Strivve staff. "FI" adds nothing — every page is "by FI". |
| `CS Portfolio` (nav) / `CS Portfolio Dashboard` (title) | `Portfolio Health` or `FI Portfolio Dashboard` | `nav.js:81`, `portfolio.html:5,24` | "CS" = Customer Success. Fine internally but the landing page for the `cs` role *and* for internal/core/admin shouldn't front-load the team abbreviation. |
| `Success Dashboard` (title) + `Operations` (page id/filename) + subtitle "Failure rates..." | Pick one noun. Either `Operations Dashboard` with subtitle "Success and failure signals", or `Success Dashboard` with subtitle focused on success metrics — right now the subtitle leads with "Failure rates, error modes" which contradicts the "Success" title. | `dashboards/operations.html:22-23`, `dashboards/success.html:22-23` | Duplicated file (operations.html vs success.html) with identical content — suggests an incomplete rename. Worth resolving. |
| `Card Placement Funnel` (HTML `<title>`) vs `FI Funnel` (h1 / nav) | Pick one | `funnel.html:6` vs `funnel.html:30` | Tab title and page h1 don't match. |
| `Cardholder Engagement Dashboard` (title) + `Cardholder Engagement` (nav) | Consistent — keep | `funnel-customer.html` | No change needed, these align. |
| `Engagement Playbook` (nav) vs `Cardholder Engagement Playbook` (h1) vs `Engagement Playbook \| Strivve CardUpdatr` (HTML title) | Consistent — keep | `engagement-playbook.html:6,257` | Fine. |
| `FI API` | `FI Data API` or `Partner API` | `nav.js:96`, `fi-api.html` | Unlabeled "FI API" is ambiguous — is it an API we built *for* FIs or *about* FIs? |
| `Data & Config` | `Admin Maintenance` or `Data Management` | `nav.js:98` (file: `maintenance.html`) | Current label hides what's there. |

### View-As Switcher — Role Labels

| Current | Proposed | Where | Note |
|---|---|---|---|
| `SiteOps` | `Site Operations` | `nav.js:416` | Role code leaking into UI. |
| `CS` | `Customer Success` | `nav.js:418` | Role code leaking into UI. |
| `FI` | `FI Contact` | `nav.js:421` | Role code leaking into UI. |
| `Core` | `Strivve Core` | `nav.js:414` | Ambiguous alone. |
| `Internal` | `Strivve Internal` | `nav.js:415` | Ambiguous alone. |

Also affects the amber impersonation banner ("Viewing as: {Name} ({email}) — {access_level}") at `nav.js:491` — the raw `access_level` code (e.g., `siteops`, `cs`) is appended. Map it to a human label.

### Action Library Headlines

Most are written naturally — they're already partner-facing. These are the exceptions:

| Current | Proposed | Where |
|---|---|---|
| Playbook section key `'visibility'` → title `Digital Banking Visibility` vs playbook-page title `Digital Banking Visibility` (fine) but `low_reach_visibility` as internal rule key surfaces nowhere. OK. | — | — |
| `low_cred_value_prop` channel title: `Value Proposition Copy — Point of Encounter` | `Messaging at the Moment of Encounter` | `action-library.js:151` — "Value Proposition Copy" is marketing-jargon and "Point of Encounter" is our internal term. |
| `Problem → Solution framing` / `Speed framing` / `Prevention framing` (sub-headlines) | `Lead with the pain`, `Lead with speed`, `Lead with prevention` | `action-library.js:152,153,154` — "framing" reads as deck-speak. |
| Engagement Playbook SECTION_META: `'Optimization & Value Proposition'` | `Optimization & Messaging` | `engagement-playbook.html:283` — "Value Proposition" is jargon; the content is really about messaging and merchant list curation. |
| `Scaling & Channel Expansion` | `Scaling What Works` (already matches the tier description in action-library.js:31) — align the two | `engagement-playbook.html:284` vs `action-library.js` section title `Scaling What Works` | Cross-surface inconsistency. |
| `Investigation Checklist` channel | `How to Learn From Your Best Week` | `action-library.js:202` | "Investigation checklist" reads clinical/forensic. |

### AI Insights Prompt Vocabulary

Deep dive in its own section below — but these are the obvious wins right from the system prompt:

| Current | Proposed | Where |
|---|---|---|
| System prompt tells Claude to classify using tier numbers **1, 1.5, 2, 2.5, 3** and outputs those numbers in JSON | Drop the numbers entirely when talking to non-admin audiences. Have the prompt emit only the label (`"Activation"`, `"Campaign"`, `"Discovery"`). Keep the number internal for diagnostics. | `ai-insights.mjs:147,81-89` |
| `Discovery (<3%)` tier label appears in partner-visible JSON output | Rename to `Organic Discovery` everywhere. Today: mixed — file uses "Discovery" in some places, "Incidental" in others (see Cross-Surface Inconsistencies). | `ai-insights.mjs:85,88` |
| `Campaign → Activation transition` | `Campaign-to-Activation transition` (arrow reads as code syntax) | `ai-insights.mjs:82,87` |
| `Non-SSO Classification (shifted higher because every visitor already committed by entering card data)` — this full phrase is inside the system prompt; the model may echo "SSO" / "Non-SSO" | Rename for partner audiences. In AI output, prefer phrases like "direct-link traffic" or "manual-entry traffic" when talking to `fi` / `partner` / `executive` access levels. Keep SSO / non-SSO only for admin/internal. | `ai-insights.mjs:87`, narratives at `funnel-customer.html:1187-1221` |
| Schema field `"section": "headline" \| "conversion" \| "outcomes" \| "reach" \| "completion" \| "potential"` | These are internal routing keys — fine as long as they're not displayed. Confirm none render as text. | `ai-insights.mjs:141` — worth confirming they stay server-side. |

---

## Needs Discussion

### 1. Tier numbering: keep or drop?

Currently every tier has TWO names in play:

- **Internal doc:** "Tier 1 — Activation", "Tier 2 — Campaigns", "Tier 3 — Incidental"
- **engagement-insights.js / ai-insights.mjs:** "Tier 1 — Activation" (numeric) + label `Activation` / `Campaign` / `Discovery`
- **Portfolio dashboard tier chips:** `T1`, `T1.5`, `T2`, `T2.5`, `T3` in kiosk mode; `Activation`, `Cmpn→Act`, `Campaign`, `Disc→Cmpn`, `Discovery` in regular mode
- **Customer PDF template:** Just the labels, no numbers
- **CLAUDE.md:** "Tier 1 / 2 / 3 = Activation/Campaign/Discovery"

The numbers are useful internally (easy to talk about "Tier 1 FIs") but they're dead weight in partner output, where the label carries the meaning. Half-tier decimals (`1.5`, `2.5`) compound the problem for external audiences — they read as pseudo-scientific.

Options:
- **A. Keep tier numbers for admin/internal only; drop them from partner/fi/executive output.** Lowest-risk, biggest clarity win externally.
- **B. Drop tier numbers everywhere. Keep only the descriptive label.** Forces cleaner vocabulary but loses the shorthand internal teams use.
- **C. Status quo — keep both everywhere.** Current behavior; most confusing.

Recommend **A**.

### 2. "FI Funnel" vs "Cardholder Engagement"

Same underlying data (CardSavr sessions + GA placement funnel) — different names.

- `funnel.html` = **FI Funnel** (shown to admin, core, internal, siteops, cs) — has raw "Jobs / Placements / Sessions w/ Jobs" vocabulary
- `funnel-customer.html` = **Cardholder Engagement Dashboard** (shown to partner, fi, admin, core, cs) — has "Visits / Successful Cardholders / Cards Updated" vocabulary
- PDFs: `funnel-report-template` (internal) vs `funnel-customer-report-template` (partner)

This is intentional split-vocabulary design, which is reasonable — but the split is not clean:
- FI Funnel exports PDFs that partners occasionally see (via "Export Internal" button)
- Portfolio Dashboard detail modal uses FI Funnel vocabulary (SM/CE sessions) but is navigation-accessible to cs (who interacts with partners)
- AI insights system prompt mixes both — it uses "session", "placement", "session success rate" (FI Funnel vocabulary) but also "cardholders", "reach" (Cardholder Engagement vocabulary)

Decision needed:
- **A. Two glossaries, enforce strict per-role rendering.** Nothing from internal glossary ever renders at `partner`/`fi`/`executive` access. Requires a shared translation layer.
- **B. Unify on the customer-facing glossary everywhere, and let internal tables just add extra columns.** Simpler, but loses some internal precision (e.g., "Jobs" is a better word for the underlying CardSavr concept than "placements").
- **C. Rename "FI Funnel" to something that telegraphs "internal view of the same data" — e.g., "FI Funnel — Technical View" or "FI Operations Funnel".** Middle ground.

### 3. "Motivation Spectrum" — name itself

The phrase is the product's core strategic concept and is well-used internally. For partners, it's mostly fine — but a few issues:

- "Spectrum" suggests continuity; we actually bucket into 5 discrete tiers
- "Motivation" is abstract — does every partner reader intuit "cardholder-side urgency"?
- When admin-panel exposes "Motivation Spectrum Talking Points" on `funnel-customer.html:1651`, the word "Talking Points" leaks internal-deck vocabulary into what's ostensibly a customer page (gated behind admin role, but still).

Options:
- Keep as-is. It's branded and repeated enough that partners learn it.
- Rename to **Cardholder Readiness Tiers** or **Moment-of-Encounter Tiers** — more literal.
- Keep "Motivation Spectrum" as the marketing name, but label the individual bucket explanations with plainer words: "How ready your cardholders are when they encounter CardUpdatr."

### 4. "Engagement Score"

Appears on Portfolio Dashboard and Executive Dashboard. Formula weights four things: success rate (40%), trend (20%), reach (20%), volume (20%). Currently labeled just "Engagement Score".

Issue: the score is a composite of conversion quality + growth + reach + volume. "Engagement" isn't a bad word for that, but a partner seeing "Engagement Score: 47/100" for their FI on the Executive Dashboard will reasonably ask "engagement of what? cardholders? the product? the partner team?"

Options:
- **A. Rename to `Performance Score` or `Portfolio Health Score`.** More honest about what's measured.
- **B. Keep "Engagement Score" but always show the formula breakdown on hover.** (Already done — see `portfolio-dashboard.js:324`.)
- **C. Split into two scores: "Cardholder Engagement Score" (success rate + reach) and "Portfolio Health Score" (volume + trend).** Probably overkill.

Also: `computeEngagementScore` returns a 0-100 integer but the tooltip mentions "weighted component scores" — consider standardizing the breakdown presentation.

### 5. "System Success Rate" vs "Overall Success Rate" — user-visible default

Already on ARG's queue per CLAUDE.md ("System Success Rate as Default"). Naming angle: neither term self-explains. A partner reading "System Success Rate" may assume it's about system uptime, not cardholder conversion.

Options:
- `Technical Success Rate` (excluding cardholder-caused failures)
- `Update Success Rate` — drops the ambiguity, focuses on the outcome
- `Engineering Success Rate` — unambiguous internally
- Keep "Overall Success Rate" but rename "System Success Rate" to something like "Strivve-Controllable Success Rate"

### 6. "Reach" / "Monthly Reach %"

Partner-facing concept. Currently means "sessions / total cardholders × days-in-month / days-in-window". The word "Reach" is media-industry standard so it's not bad, but it can be confused with "impressions" or "cardholders notified".

Tooltip already says "Projected monthly rate based on selected time period." That doesn't explain what's in the numerator.

Options:
- Keep "Reach" — add a fuller description: "Monthly rate of cardholders who launch CardUpdatr."
- Rename to `Cardholder Adoption Rate` or `Monthly Launch Rate`.
- Splitting into "Gross Reach" (visits) vs "Net Reach" (successful cardholders) could clarify but adds complexity.

### 7. "SSO" / "Non-SSO" as partner-facing terms

Technical. Partners often don't know which they have. Currently appears on `funnel-customer.html` as section labels `SSO — Pre-Authenticated Traffic` and `Non-SSO — Manual Card Entry Traffic` — the subtitle helps but "SSO" still leads.

Options:
- Flip the primary term: `Pre-Authenticated (SSO)` and `Direct-Link (Non-SSO)` — plain label first, technical term in parens.
- Go full plain: `From Online Banking` vs `From Direct Link / QR / Campaign`.
- Keep the technical term because it's what partner integration teams use.

This maps to ARG's previous flag that SSO / Non-SSO is confusing externally.

---

## Cross-Surface Inconsistencies

Places where the same concept has different labels across pages. This is where vocabulary drift degrades readability fastest.

| Concept | Appears as | Files |
|---|---|---|
| A cardholder's launch of CardUpdatr | `Session`, `Visit`, `Launch`, `SM Session`, `Total Sessions`, `Total Visits` | `funnel-customer.html` (Visits), `funnel.html` (Total Sessions), `portfolio-dashboard.js` (SM Sessions), `ai-insights.mjs` (session), `funnel-customer-report-template.mjs:509` (Total Visits) |
| Successful card update | `Successful`, `Placed`, `Placement`, `Successful Job`, `Cards Updated`, `Successful Placements` | Customer page: "Cards Updated" + "Successful Placements"; FI Funnel: "Successful" + "Placements"; PDF template mixes all |
| Lowest motivation tier | `Discovery`, `Incidental`, `Tier 3`, `Organic Discovery` | engagement-insights.js = "Discovery"; ai-insights.mjs prompt = "Discovery"; CLAUDE.md refers to "Incidental"; action-library.js key `tier3_incidental`; tooltip says "Discovery"; some narratives say "Organic Discovery" |
| Credential-entry step | `Credential Entry`, `Cred`, `CE`, `Credential Entry Views`, `Cred Views` | funnel-customer metric card: "Credential Entry"; tables: "Cred Views"; portfolio tooltip: "CE"; PDF: "Credential Entry Views" |
| Merchant-selection step | `Select Merchant`, `Merchant Selection`, `SM`, `Sel`, `@Select` | funnel-customer metric card: "Merchant Selection"; portfolio: "SM"; tables: "@Select", "Sel→C" |
| Scaling what works | `Scaling What Works` (action-library title) vs `Scaling & Channel Expansion` (engagement-playbook section title) vs `Scaling Strategy` (channel name) | Same library, three names. |

Recommendation: establish a single glossary (ideally as a js module `public/assets/js/glossary.js` or equivalent) and reference it from every page, template, and the AI prompt. Once one source of truth exists, inconsistencies can be caught by a grep test.

---

## AI Insights Specific Notes

### What the AI prompt currently sends to Claude

System prompt (`ai-insights.mjs:61-171`) teaches Claude:
1. Product vocabulary: Session, Successful session, Placement, Session success rate, Monthly reach %, SSO, Non-SSO — all reasonable, but "Monthly reach %" without explaining the denominator is a lost opportunity; and "SSO" / "Non-SSO" are used as-is.
2. Tier classification with numeric tiers (1, 1.5, 2, 2.5, 3) AND labels (Activation, Campaign, Discovery, transitions). Since the model echoes tier numbers back in the `spectrum.tier` field and the label in `spectrum.label`, both end up in partner view unless filtered.
3. Benchmarking rules: admin can name FIs (MSUFCU, Cape Cod Five, Kemba, ORNL); `limited`/`executive` must anonymize. Note: the codebase has moved on from `limited` to `fi`/`partner`/`executive` roles, but the prompt still says `access_level = "limited"` (`ai-insights.mjs:187`). This is a bug, not just a naming issue — **the AI is being told access_level is "limited" for every non-admin call**. Verify `generateAIInsights` callers pass the correct role.
4. Action channel names match the action-library section keys (activation, campaigns, visibility, optimization, scaling, member-services) — fine.

### What the AI will emit that partners see

Rendered inside funnel-customer.html's insights sections (`insightsPayload` → `engagement-insights.js`). Specifically:
- `narratives[].html` — rendered with `<strong>` tags, free text. Currently the only defense against jargon is the tone directive.
- `spectrum.tier` (number) + `spectrum.label` (string) + `spectrum.diagnosis` (prose) — label + diagnosis shown to partner; number used internally.
- `actions[]` — `headline` + `detail` displayed to partner, `impact` + `channel` used for rendering.

### Recommendations

1. **Parameterize vocabulary in the prompt.** Pass the access level into the system prompt's glossary and tier list — e.g., for `partner`/`fi`/`executive`, drop tier numbers, use "direct-link" instead of "Non-SSO", use "sessions started" instead of raw "sessions", never say "SMS/email campaign" unless the FI uses one (AI has no way to know).
2. **Add an explicit "words to avoid in partner output" list** to the system prompt. Today the prompt says "anonymize benchmarks" but doesn't forbid internal jargon. Add:
   - Avoid: "SSO", "Non-SSO", "GA", "CardSavr", tier numbers (1.5, 2.5), "Monthly Reach" without explaining it, "UDF", "job", "placement" (use "card update"), "grant", "SM", "CE".
   - Prefer: "sessions", "cardholder updates", "successful card updates", "motivation tier", and spell out acronyms on first use.
3. **Fix the stale `limited` access level.** `generateAIInsights` defaults to `accessLevel = "limited"` (line 187) and the prompt's tone rules key off `limited`/`admin`/`internal`. Bring this in line with the current 9-role system (admin, core, internal, siteops, support, cs, executive, partner, fi).
4. **Remove "MSUFCU, Cape Cod Five, Kemba, ORNL at 27%" references from the prompt** — even admin mode echoing those names back into rendered HTML is risky if an admin exports a PDF and forwards it. Gate named FI references behind an explicit `allow_named_benchmarks: true` flag from the caller.
5. **Have the prompt spell out the tier labels it's allowed to use verbatim**, so it doesn't invent near-synonyms ("Incidental" vs "Organic Discovery" vs "Discovery" currently all exist).
6. **Tone directive item 5 ("Discovery is a starting line, not a verdict") uses "Discovery" but CLAUDE.md tone rules say "Tier 3 is a starting line" and the action-library file uses `tier3_incidental` as the key.** Pick one.

### Specific prompt edit suggestions

In `SYSTEM_PROMPT`:
- Line 85: `**Discovery (<3%)**` → `**Organic Discovery (<3%)**` (and match everywhere else)
- Line 82: `**Campaign → Activation transition (≥12%)**` → `**Campaign-to-Activation transition (≥12%)**`
- Lines 67-74 glossary: expand "Monthly reach %" definition; note which metrics apply only to SSO vs direct-link.
- Line 109: `- For limited/executive: Anonymize benchmarks ("top-performing institutions")` → list all partner-facing access levels (partner, fi, executive).

---

## Action Library — Additional Polish

The content is strong. Headlines to consider:

- `tier3_campaign` → `General Awareness — Newsletter` channel, example body `"Did you know? You can update your [FI Name] card at all your online merchants in one step. No more hunting through settings at each site."` — this is copy-paste-ready and great. Keep.
- `low_reach_visibility` → channel title `Card Controls — Lock/Unlock` is clear. Keep.
- `low_cred_value_prop` → replace sub-headline wording as noted in Obvious Wins.
- `best_week_replicate` → channel title `Investigation Checklist` → rename as noted.
- `good_performance_scale` / `good_performance_layer` → channel titles `Scaling Strategy` / `Channel Layering Strategy` — consider `How to Scale Up` / `How to Add Another Channel`. "Strategy" is a word that appears too often in the library (6 `strategy` tags) without adding meaning.

Also: the `_meta.version` string is `3.0.26.02.16` — that's a date-ish format that doesn't parse. If surfaced anywhere partner-visible, clean it up. Currently it shows in the engagement playbook header as `Playbook v3.0.26.02.16`.

---

## PDF Templates

### `funnel-customer-report-template.mjs` (partner-facing)

Mostly clean. Issues:
- Line 189-193: Spectrum chart uses labels `Discovery`, `Campaign`, `Activation` with empty-string labels for transition zones. Empty labels look like rendering bugs — use `Disc → Campaign` and `Campaign → Activation` (matching insights engine).
- Line 262: `Recommended Actions` table — `s.label` is used as the action label but the action library calls them `headlines`. Ensure the caller passes the right field.
- Line 415: `${partnerSummary.partner || "Partner"} Integration Mix` — reasonable, but "Integration Mix" is a heading a partner may not intuit. `Integration Breakdown` or `Integration Types` is plainer.
- Line 544: `Four-Quarter Trend Analysis` — good.
- Line 510-515 trend metric labels: `Avg Cards/Cardholder` — slash reads awkward. `Average Cards Per Cardholder`.

### `funnel-report-template.mjs` (internal)

Consistent FI-Funnel vocabulary. Only issues:
- Line 449: `<h1>FI Funnel Report</h1>` — matches the h1 rename decision above.
- Line 196: `Sess w/ Success` — shorten to nothing (just `Successful Sessions`).
- Line 197: `Sel→Succ %` / `Sess→Succ %` — expand per Obvious Wins.

### `supported-sites-report-template.mjs` (partner-facing)

Not yet audited in depth — but the live `supported-sites.html` is fine (`Merchant Sites`, standard column names: `Name`, `Host`, `Status`, `Tags`, `Tier`). Worth a targeted re-read of the template.

---

## Out of Scope / Left Alone

- **`public/maintenance.html`** — admin-only data/config tool. Jargon is fine here.
- **`public/activity-log.html`, `public/users.html`, `public/shared-views.html`, `public/logs.html`** — admin-only. Names like "User Activity" and "Server Logs" are already plain.
- **`public/heatmap.html`, `public/watchlist.html`, `public/realtime.html`, `public/troubleshoot.html`** — siteops/support-only operational tools. Internal vocabulary acceptable.
- **`public/sources.html`, `public/ux-paths.html`, `public/experience.html`, `public/placement-outcomes.html`, `public/dashboards/customer-success.html`** — admin/analysis pages flagged as WIP in CLAUDE.md ("Medium: Admin-Only Nav Visibility Flag for WIP Pages"). Confirm these never render to `partner` or `fi` before accepting their naming.
- **`public/synthetic-traffic.html`** — admin/core test-traffic tool. Technical audience only.
- **`public/campaign-builder.html`** — form inputs reviewed; labels like `Configuration`, `Source Tracking`, `Styling`, `Generated URL`, `Saved Presets` are fine for its intended `partner`/`cs`/`admin` audience. One small nit: `Source Tracking` could be `Campaign Tracking Tags`.
- **`public/login.html`** — simple magic-link UI. No metrics.
- **Console log messages, code comments, internal variable names** — out of scope per task brief.

---

## Appendix — Quick Reference: Files with Highest Jargon Density

Sorted by the number of flagged items in each:

1. `public/funnel-customer.html` — 12 flags (column headers on 4 integration-specific tables × 3 abbreviations each)
2. `public/assets/js/portfolio-dashboard.js` — 8 flags (SM/CE session labels + tooltips)
3. `public/funnel.html` — 7 flags (Jobs / Sessions w/ abbreviations)
4. `scripts/ai-insights.mjs` — 6 flags (prompt vocabulary, tier numbers, stale `limited` access level)
5. `public/dashboards/operations.html` + `success.html` — 4 flags (duplicate `Jobs_Total`/`Jobs_Failed` column headers)
6. `templates/funnel-report-template.mjs` — 4 flags (Sess w/ abbreviations, Sel→Succ arrow shorthand)
7. `public/assets/js/nav.js` — 5 flags (role codes in View-As switcher, "SiteOps"/"CS"/"FI" case)
8. `public/assets/js/engagement-insights.js` — 2 flags (Tier boundary labels, used internally — low surface area)

Cleaning the top 3 files alone closes most of the partner-facing jargon gap.
