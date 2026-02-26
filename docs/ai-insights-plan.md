# AI-Powered Insights Engine — Plan & Architecture

> Captured from planning session on Feb 25, 2026.
> **Status: Phase 1 Complete, Phase 2 In Progress** — Prototype live on server, admin-only in funnel-customer.html.
> Last updated: Feb 26, 2026 (Session 7).

---

## The Idea

Replace the hardcoded rule-based insights engine with AI-generated insights powered by Claude API. A coworker's observation: "Why isn't all the insights based on some form of AI?"

The current engine (`engagement-insights.js`) uses 50+ manually authored condition/template rules to generate narratives, diagnose traffic tiers, recommend actions, and project outcomes. It works, but it's rigid — only as smart as the rules we've written, and every new insight requires code changes.

An LLM can analyze the same metrics context and generate richer, more nuanced, more personalized insights dynamically.

---

## Current State (Rule-Based)

### How it works today
1. Page loads (funnel-customer.html, funnel.html)
2. Data fetched and aggregated into a metrics context (`buildMetricsContext()`)
3. Insights engine (`engagement-insights.js`) runs 50+ rules:
   - **Narrative Rules**: Condition/template pairs that generate insight paragraphs
   - **Motivation Spectrum Diagnosis**: Classifies traffic into Tiers 1-3 based on session success rate
   - **Prescriptive Actions**: Prioritized recommendations mapped to diagnosis
   - **Value Projections**: "What if" scenarios using partner's own volume at campaign/activation tier rates
   - **Benchmarking**: Against best-of-best validated performance data
4. Action Library (`action-library.js`) provides channel-specific implementation content (email copy, SMS templates, etc.)
5. Full playbook (`engagement-playbook.html`) renders all content organized by 6 sections

### Key files
- `public/assets/js/engagement-insights.js` — Rules engine (~50+ rules)
- `public/assets/js/action-library.js` — Channel content, templates, copy
- `public/resources/engagement-playbook.html` — Full playbook page
- `public/funnel-customer.html` — Customer-facing dashboard (renders insights)
- `public/funnel.html` — Internal FI funnel page (renders insights)

### Limitations of rule-based approach
- Rigid — only catches patterns we've explicitly coded for
- Same templates every time — narratives feel repetitive
- New insights require code changes to engagement-insights.js
- Can't spot non-obvious correlations across FIs
- Action recommendations are fixed mappings, not reasoned
- Playbook content is generic, not tailored to specific FI situations

---

## Implemented Architecture (AI-Powered)

### Overview

```
Browser (admin clicks "Generate AI Insights" button)
  → POST /api/ai-insights
    → Server checks auth (existing passcode-gate session)
    → Server checks in-memory cache (per FI + date range + access level + integration context)
    → Cache miss? → Server calls Claude API with:
        ├── System prompt (cached across calls via cache_control: ephemeral):
        │   ├── Strivve product context
        │   ├── Motivation Spectrum + tier thresholds (SSO + non-SSO)
        │   ├── Tone & Framing Directive (8 rules)
        │   ├── Benchmarking philosophy
        │   ├── Action Library summary (6 channel categories)
        │   ├── Output format instructions (JSON schema)
        │   └── Admin vs partner content rules
        │
        └── Per-call input (unique per request):
            ├── metricsContext JSON (from buildMetricsContext())
            ├── FI name and key
            ├── Access level (admin/limited/executive)
            ├── Integration context (combined/sso/nonsso)
            └── Date range
    → Parse JSON response (handles markdown code fences)
    → Add metadata (model, timing, token counts)
    → Cache result (24h TTL)
    → Return insights JSON to client
```

### Key files (new)
- `scripts/ai-insights.mjs` — AI insights module (SDK client, system prompt, caching, API call)
- `scripts/serve-funnel.mjs` — 3 new endpoints (`/api/ai-insights`, `/api/ai-insights/cache`, `/api/ai-insights/cache/clear`)
- `public/funnel-customer.html` — AI Insights section (admin-only, Generate button, rendering)
- `secrets/anthropic.json` — API key (gitignored)

### Key design decisions

1. **Server-side only** — Claude API key never touches the browser. Users never interact with Claude directly. Server controls exactly what data gets sent.

2. **On-demand with caching** — No cron jobs pre-computing insights. API is called only when an admin clicks "Generate" and cache is empty/stale. Nobody views insights = zero API calls = $0 cost.

3. **Cache strategy** — Cache key: `{fi_key}:{date_range}:{access_level}:{integration_context}`. Cache TTL: 24 hours. In-memory Map with eviction at >200 entries. Cache stats and clear endpoints for admin monitoring.

4. **Same auth system** — Existing passcode-gate session validation. No new auth infrastructure needed.

5. **Prompt caching** — System prompt (~1,800 tokens) uses Anthropic's `cache_control: { type: "ephemeral" }`. Identical across all calls. 90% discount on cached input after first call within a 5-minute window (requires persistent server process — PM2 keeps this alive).

6. **Structured output** — Response follows a strict JSON schema. The AI generates the *content*, not the *structure*. Markdown code fences are stripped before parsing.

7. **Admin-only for now** — AI insights section uses the `admin-overlay` CSS pattern so partners never see it during Phase 2 testing.

---

## What Stays Rule-Based vs What Moves to AI

### Keep rule-based (deterministic, needs consistency)
- Tier classification thresholds (3%/8%/12%/21% for SSO, 8%/15%/25%/35% for non-SSO)
- Engagement score formula (40% rate, 20% trend, 20% reach, 20% volume)
- Benchmark numbers (specific validated data points)
- Basic metric calculations (aggregation, rates, ratios)
- `buildMetricsContext()` — still produces the same data object

### Move to AI (benefits from reasoning, nuance, personalization)
- **Narrative generation** — Replace 50+ hardcoded template rules with dynamic analysis
- **Action recommendations** — Reasoned prioritization based on full situation, not fixed mappings
- **Playbook content** — Channel-specific copy tailored to FI name, tier, traffic patterns
- **Trend interpretation** — "What's happening and why" with nuanced reasoning
- **Cross-FI pattern detection** — Spot correlations the rules can't
- **Projection narratives** — More compelling "what if" scenarios with specific reasoning

---

## System Prompt Design

The system prompt is the "brain" — everything the model needs to know about Strivve, CardUpdatr, and how to analyze FI data. It's sent on every API call but cached after the first one.

### Implemented Contents (~1,800 tokens)

```
1. PRODUCT CONTEXT
   - What CardUpdatr is (card-on-file update service for FIs)
   - Key terms: session, successful session, placement, session success rate, monthly reach %, SSO vs non-SSO

2. MOTIVATION SPECTRUM FRAMEWORK
   - SSO Tier Classification:
     - Tier 1 (≥21%): Card Activation Flow
     - Tier 1.5 (≥12%): Campaign → Activation transition
     - Tier 2 (≥8%): SMS & Targeted Campaigns
     - Tier 2.5 (≥3%): Discovery → Campaign transition
     - Tier 3 (<3%): Incidental Discovery
   - Non-SSO Tier Classification (shifted higher):
     - Tier 1 (≥35%), Tier 1.5 (≥25%), Tier 2 (≥15%), Tier 2.5 (≥8%), Tier 3 (<8%)
   - 7.7x conversion gap between motivated and incidental traffic

3. TONE & FRAMING DIRECTIVE
   - 8 rules for partner-facing content
   - Admin/internal: unvarnished, include internal talking points

4. BENCHMARKING PHILOSOPHY
   - Always aspirational ceiling, never averages
   - Admin: may reference named FIs (MSUFCU, Cape Cod Five, Kemba, ORNL)
   - Partner: anonymized benchmarks

5. ACTION LIBRARY — Available Engagement Channels
   - Issuance & Activation Flows (channels: email, SMS, in-app, IVR, card carrier)
   - Targeted Campaigns & Promotions (seasonal, behavioral, rewards, awareness)
   - Digital Banking Visibility (menu placement, lock/unlock prompts, travel notice, card details)
   - Experience Optimization (value prop copy, merchant list curation)
   - Scaling What Works (additional card products, campaign frequency, layered channels)
   - Member Services & Call Center (rep scripts for reissuance, inquiry, fraud)

6. OUTPUT FORMAT
   - Strict JSON schema (see below)
   - Rules for generation (3-6 narratives, 2-4 actions, low-volume disclaimer, etc.)
```

### Output JSON Schema

```json
{
  "narratives": [
    {
      "section": "headline | conversion | outcomes | reach | completion | potential",
      "html": "<p>Insight text with <strong>key metrics</strong> emphasized.</p>",
      "sentiment": "positive | neutral | caution | opportunity"
    }
  ],
  "spectrum": {
    "tier": 1 | 1.5 | 2 | 2.5 | 3,
    "label": "Tier label string",
    "diagnosis": "2-3 sentence diagnosis"
  },
  "actions": [
    {
      "headline": "Action title",
      "detail": "Contextualized explanation with specific metrics",
      "impact": "high | medium | low",
      "channel": "activation | campaigns | visibility | optimization | scaling | member-services"
    }
  ],
  "projections_narrative": "1-2 sentence narrative about potential outcomes",
  "admin_notes": "Internal-only commentary (omitted for partner access levels)"
}
```

---

## Observed Performance (Production)

### Per API call (tested Feb 26, 2026)
- **Model**: claude-haiku-4-5-20251001
- **Response time**: ~17-21 seconds (first call), faster with prompt cache hits
- **Input tokens**: ~2,200-2,500 (system prompt ~1,800 + metrics context ~400-700)
- **Output tokens**: ~800-1,200 (full insights JSON)
- **Estimated cost per call**: ~$0.005-0.008

### Test results
- **Tier 3 FI** (session success rate 2.24%): Correctly classified as Tier 3 — Incidental Discovery. Generated appropriate narratives and upgrade-path actions.
- **Tier 1 FI** (session success rate 24.9%): Correctly classified as Tier 1 — Card Activation Flow. Generated appropriate strength narratives and scaling actions.
- Tier classification in AI output matches the rule-based engine's thresholds.
- Output quality is high — nuanced, personalized, references actual data points.

### Prompt caching
- System prompt uses `cache_control: { type: "ephemeral" }` for Anthropic's prompt caching
- Within a 5-minute window on the same server process, subsequent calls get ~90% discount on system prompt tokens
- PM2 keeps the process persistent, so caching works well in production
- `cache_read_input_tokens` and `cache_creation_input_tokens` tracked in response metadata

---

## Access Control & Content Gating

The same access level system controls what AI generates:

| Access Level | What AI produces |
|-------------|-----------------|
| **admin / internal** | Full unvarnished analysis. Named FI comparisons. Internal talking points. `admin_notes` field included. |
| **limited / executive** | Engagement-positive framing. Anonymized benchmarks. Partner-appropriate tone. `admin_notes` omitted. |
| **shared view** | Same as limited, but read-only rendering. |

The access level is passed as part of the per-call input. The system prompt instructs the model to adjust tone and content based on this value.

**Current state**: AI insights section is admin-only (uses `admin-overlay` CSS class). Partners cannot see or trigger AI generation yet.

---

## Cost Estimates

### Per API call (observed)
- **Input**: ~400-700 tokens (metrics context) + ~1,800 tokens (system prompt, cached after first call)
- **Output**: ~800-1,200 tokens (full insights response)
- **Cost**: ~$0.005-0.008 per call

### Model: Haiku 4.5 (`claude-haiku-4-5-20251001`)
- Best fit for structured data analysis → structured output
- Pricing: $0.80/M input tokens, $4/M output tokens
- Cached input: $0.08/M tokens (90% discount)

### Monthly estimates

| Scenario | Calls/day | Monthly cost |
|----------|-----------|-------------|
| **Low usage** (few users, few FIs viewed) | 10-20 | **$2-5** |
| **Normal usage** (regular dashboard views) | 50-75 | **$10-15** |
| **Heavy usage** (all FIs, multiple date ranges) | 200 | **$30-40** |

### Key cost properties
- **Zero base cost** — No subscription, no minimum. Zero usage = $0.
- **Pay per call** — Only charged when someone actually views insights.
- **Caching reduces calls** — Same FI + date range + access level + integration context served from cache for 24h.
- **Prompt caching reduces per-call cost** — System prompt charged at 90% discount after first call within 5-minute window.

---

## Security & Privacy

### Data sent to Anthropic API
- Aggregate FI traffic metrics (session counts, success rates, placement counts)
- No PII (no cardholder names, card numbers, personal data)
- No credentials or API keys
- FI names and partner names are included (needed for personalization)

### Anthropic data handling
- **Zero-retention policy** — API inputs/outputs are not stored after request completion
- **No training** — API data is not used to train models
- API terms: https://www.anthropic.com/api-terms

### Server-side security
- API key stored in `secrets/anthropic.json` (gitignored, same pattern as CardSavr creds)
- Key never sent to browser
- All AI calls proxied through SIS server
- Existing session auth required to access insights endpoint

---

## Account Setup — Complete

- Anthropic business account created at console.anthropic.com
- API key generated and saved to `secrets/anthropic.json` (local + server)
- `@anthropic-ai/sdk` installed (local + server via `npm install`)
- Key verified working with test call to Haiku 4.5

---

## Implementation Plan

### Phase 1: Prototype (alongside existing engine) — COMPLETE

- [x] API key setup (`secrets/anthropic.json`)
- [x] `@anthropic-ai/sdk` installed locally and on server
- [x] New module: `scripts/ai-insights.mjs` — system prompt, caching, API call wrapper
- [x] New endpoint: `POST /api/ai-insights` in `serve-funnel.mjs`
- [x] Admin endpoints: `GET /api/ai-insights/cache` (stats), `POST /api/ai-insights/cache/clear`
- [x] System prompt construction (product context, motivation spectrum, tone directives, action library, output schema)
- [x] Claude API integration via Anthropic SDK with prompt caching (`cache_control: ephemeral`)
- [x] Response caching (in-memory Map, 24h TTL, eviction at >200 entries)
- [x] JSON schema for structured output (narratives, spectrum, actions, projections, admin_notes)
- [x] Tested with Tier 3 FI (2.24% rate → correct classification) and Tier 1 FI (24.9% rate → correct classification)
- [x] Output quality validated — nuanced, personalized, references actual data

### Phase 2: Dashboard integration — IN PROGRESS

- [x] Add AI insights rendering to `funnel-customer.html` (admin-only via `admin-overlay` CSS pattern)
- [x] Purple "Generate AI Insights" button with loading spinner
- [x] Rendering: color-coded narratives (by sentiment), spectrum diagnosis, prioritized actions (with impact/channel badges), projections, admin notes (dark panel), metadata footer
- [ ] Toggle: rule-based vs AI-powered comparison view (side-by-side or tabbed)
- [ ] Tune system prompt based on real-world output quality (see Prompt Tuning Workflow below)
- [ ] Test with edge cases (low volume <30 sessions, non-SSO only, declining trends, new FI)
- [ ] Add to `funnel.html` (internal FI page)

### Phase 3: Partner rollout
- [ ] AI insights become available to partners (remove admin-only gate)
- [ ] Rule-based engine kept as fallback (if API is down/slow)
- [ ] Fallback UX: serve cached results if available, show "generating..." spinner, timeout after 30s
- [ ] AI-generated playbook content (personalized per FI)
- [ ] PDF export with AI-generated narratives
- [ ] Monitor costs and cache hit rates via admin dashboard

### Phase 4: Advanced features (future)
- [ ] Cross-FI network analysis ("FIs similar to yours are seeing...")
- [ ] Anomaly detection ("unusual pattern detected this week...")
- [ ] Predictive insights ("based on current trajectory...")
- [ ] Chat interface — let partners ask follow-up questions about their data
- [ ] Automated weekly digest emails with AI-generated summaries

---

## Prompt Tuning Workflow

The system prompt in `scripts/ai-insights.mjs` (the `SYSTEM_PROMPT` constant) is the primary lever for output quality. Here's the workflow for iterating on it:

### How to tune
1. **Generate insights** for a specific FI using the dashboard button
2. **Review the output** — check tone, accuracy, tier classification, action relevance
3. **Identify issues** — e.g., "too generic", "wrong framing for this tier", "actions don't match situation"
4. **Edit `SYSTEM_PROMPT`** in `scripts/ai-insights.mjs` — adjust rules, add examples, clarify guidance
5. **Clear cache** — hit the admin cache clear endpoint or restart PM2
6. **Re-generate** and compare

### What to tune
- **Tone calibration** — adjust the 8 framing rules for partner vs admin voice
- **Tier classification accuracy** — add edge case guidance (e.g., "if rate is exactly at threshold...")
- **Action specificity** — add more context about which channels work for which tiers
- **Narrative depth** — control length and detail level
- **Edge case handling** — low volume disclaimers, non-SSO only FIs, brand new FIs with <1 week of data
- **Few-shot examples** — add sample input→output pairs to the system prompt for consistent formatting

### Future: A/B testing
- Run both rule-based and AI side-by-side (Phase 2 comparison view)
- Version system prompts (e.g., `SYSTEM_PROMPT_V2`) and compare output quality
- Shadow mode: generate AI insights silently, log but don't display, review offline

---

## UI Implementation Details

### Admin-only section in funnel-customer.html
- Section has class `admin-overlay` — hidden by default, visible only when Internal View is toggled on
- Purple "Generate AI Insights" button (`.ai-insights-btn`) triggers `POST /api/ai-insights`
- Loading state: button disabled + spinner animation
- Content renders into `#aiInsightsContent` div

### Rendering components
- **Narratives**: Color-coded by sentiment (positive=green, caution=amber, opportunity=blue, neutral=gray)
- **Spectrum diagnosis**: Tier number + label + diagnosis text
- **Actions**: Cards with headline, detail, impact badge (high/medium/low), channel badge
- **Projections**: Highlighted narrative block
- **Admin notes**: Dark panel (only when admin/internal access level)
- **Metadata footer**: Model name, response time, token counts (input/output/cached)

### Data flow
1. User clicks "Generate AI Insights"
2. JS reads current filter state (selected FI, date range, integration context)
3. JS builds `metricsContext` from `buildMetricsContext()` (same data the rule-based engine uses)
4. `POST /api/ai-insights` with `{ metricsContext, fiName, fiKey, dateRange, accessLevel, integrationContext }`
5. Server calls Claude API (or returns cached result)
6. Client renders JSON response into styled HTML

---

## Resolved Questions

1. **Fallback behavior** — Currently admin-only with manual "Generate" trigger, so no fallback needed yet. For Phase 3 partner rollout: serve cached results if available, show spinner, timeout after 30s, fall back to rule-based engine.

2. **Cache invalidation** — Time-based (24h TTL). Cache key includes fi_key + date_range + access_level + integration_context. Admin can manually clear via `POST /api/ai-insights/cache/clear`.

3. **Output quality bar** — Phase 2 is admin-only, so admins validate output quality before partner rollout. Tier classification checked against rule-based engine thresholds.

4. **Prompt iteration** — Edit `SYSTEM_PROMPT` in `ai-insights.mjs`, deploy, clear cache, re-generate. See Prompt Tuning Workflow section above.

5. **Rate limiting** — Not implemented yet. At current usage (~$0.008/call), even 200 calls/day = ~$50/month. Can add if needed.

---

## Why This Works

The current rule-based engine was the right v1 — it validated that contextual insights add value to the dashboard. But maintaining 50+ rules, adding new patterns, and keeping narratives fresh requires constant code changes.

The AI approach:
- **Scales with data, not code** — New patterns detected automatically
- **Always fresh narratives** — No repetitive template text
- **Personalized** — References the specific FI, their specific numbers, their specific situation
- **Low cost** — $10-40/month for the entire FI network (lower than original estimates)
- **Low risk** — Server-side only, existing auth, zero PII sent, cached results, rule-based fallback
- **Incremental** — Running alongside the existing engine, admin-only, compare and tune before partner rollout
