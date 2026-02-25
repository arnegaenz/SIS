# AI-Powered Insights Engine — Plan & Architecture

> Captured from planning session on Feb 25, 2026.
> Status: **Planning** — awaiting Anthropic API key from business account.

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

## Proposed Architecture (AI-Powered)

### Overview

```
Browser (page load)
  → GET /api/ai-insights?fi=X&dateRange=Y
    → Server checks auth (existing passcode-gate session)
    → Server checks cache (per FI + date range hash)
    → Cache miss? → Server calls Claude API with:
        ├── System prompt (cached across calls):
        │   ├── Strivve product context
        │   ├── Motivation Spectrum + tier thresholds
        │   ├── Tone & Framing Directive (8 rules)
        │   ├── Benchmarking philosophy
        │   ├── ACTION_LIBRARY (all channels, templates, copy)
        │   ├── Output format instructions (JSON schema)
        │   └── Admin vs partner content rules
        │
        └── Per-call input (unique per request):
            ├── metricsContext JSON
            ├── Access level (admin/limited/executive)
            ├── Integration type (SSO/non-SSO)
            └── Date range
    → Cache result
    → Return insights JSON to client
```

### Key design decisions

1. **Server-side only** — Claude API key never touches the browser. Users never interact with Claude directly. Server controls exactly what data gets sent.

2. **On-demand with caching** — No cron jobs pre-computing insights. API is called only when someone views the page and cache is empty/stale. Nobody views insights for 15 days = zero API calls = $0 cost.

3. **Cache strategy** — Cache key: `{fi_key}:{date_range}:{access_level}:{data_hash}`. Cache TTL: 24 hours or until underlying data changes. In-memory cache (module-level, like existing `_trafficHealthCache` pattern).

4. **Same auth system** — Existing passcode-gate session validation. No new auth infrastructure needed.

5. **Prompt caching** — The system prompt (frameworks + playbook + tone rules) is identical across all calls. Anthropic's prompt caching gives ~90% discount on the cached portion. Only the per-FI metrics context changes per call.

6. **Structured output** — Response follows a JSON schema so the client can render it consistently. The AI generates the *content*, not the *structure*.

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

### Contents

```
1. PRODUCT CONTEXT
   - What CardUpdatr is
   - What SIS/the dashboard is
   - SSO vs non-SSO flow differences
   - What "sessions", "placements", "success rate" mean

2. MOTIVATION SPECTRUM FRAMEWORK
   - Tier 1 (Activation, 21-27%): definition, characteristics
   - Tier 2 (Campaigns, 8-12%): definition, characteristics
   - Tier 3 (Incidental, <3%): definition, characteristics
   - 7.7x conversion gap
   - SSO vs non-SSO threshold differences

3. TONE & FRAMING DIRECTIVE
   - The 8 rules (lead with what's working, frame gaps as opportunity, etc.)
   - Admin view: unvarnished, real story
   - Partner view: engagement-positive, never blame

4. BENCHMARKING PHILOSOPHY
   - Always aspirational ceiling, never averages
   - Use partner's own best performance as anchor
   - Named FI references are admin-only

5. ACTION LIBRARY (full content)
   - All 6 sections (Activation, Campaigns, Visibility, Optimization, Scaling, Member Services)
   - All channels per action
   - All templates and copy examples
   - Playbook section descriptions

6. OUTPUT FORMAT
   - JSON schema for response
   - Required fields: narratives, spectrum_diagnosis, actions, projections
   - Admin-only fields (when access_level is admin/internal)
   - Formatting guidelines

7. EXAMPLES
   - Sample metricsContext input → expected output
   - Edge cases (low volume, non-SSO, declining trends)
```

### Estimated system prompt size
- ~10,000-15,000 tokens
- With prompt caching: full price on first call, ~90% discount thereafter

---

## Access Control & Content Gating

The same access level system controls what AI generates:

| Access Level | What AI produces |
|-------------|-----------------|
| **admin / internal** | Full unvarnished analysis. Named FI comparisons. Internal talking points. Objection responses. |
| **limited / executive** | Engagement-positive framing. Anonymized benchmarks. Partner-appropriate tone. No internal commentary. |
| **shared view** | Same as limited, but read-only rendering. |

The access level is passed as part of the per-call input. The system prompt instructs the model to adjust tone and content based on this value.

---

## Cost Estimates

### Per API call
- **Input**: ~3,000-4,000 tokens (metrics context) + ~12,000 tokens (system prompt, cached)
- **Output**: ~1,200-1,800 tokens (full insights response)

### Model choice: Haiku 4.5
- Best fit for structured data analysis → structured output
- Pricing: $0.80/M input tokens, $4/M output tokens
- Cached input: $0.08/M tokens (90% discount)

### Monthly estimates

| Scenario | Calls/day | Monthly cost |
|----------|-----------|-------------|
| **Low usage** (few users, few FIs viewed) | 10-20 | **$5-10** |
| **Normal usage** (regular dashboard views) | 50-75 | **$20-25** |
| **Heavy usage** (all FIs, multiple date ranges) | 200 | **$55-60** |

### Key cost properties
- **Zero base cost** — No subscription, no minimum. Zero usage = $0.
- **Pay per call** — Only charged when someone actually views insights.
- **Caching reduces calls** — Same FI + date range served from cache, not re-generated.
- **Prompt caching reduces per-call cost** — System prompt charged at 90% discount after first call.

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

## Account Setup

### Decision: Use business account from the start
- Sign up at **console.anthropic.com** with work email
- Business billing from day one (no personal account to clean up later)
- Prototype costs will be minimal ($1-5 total during development)

### Steps
1. Create account at console.anthropic.com (work email)
2. Add business payment method
3. Generate API key
4. Save to `secrets/anthropic.json`:
   ```json
   {
     "api_key": "sk-ant-..."
   }
   ```
5. Ready to build

---

## Implementation Plan

### Phase 1: Prototype (alongside existing engine)
- [ ] API key setup (`secrets/anthropic.json`)
- [ ] New endpoint: `GET /api/ai-insights` in `serve-funnel.mjs`
- [ ] System prompt construction (frameworks + ACTION_LIBRARY + tone directives)
- [ ] Claude API integration (Anthropic SDK)
- [ ] Response caching (in-memory, module-level)
- [ ] JSON schema for structured output
- [ ] Test with 2-3 FIs, compare AI output vs rule-based output side by side

### Phase 2: Dashboard integration
- [ ] Add AI insights rendering to `funnel-customer.html`
- [ ] Toggle: rule-based vs AI-powered (admin setting or A/B)
- [ ] Admin overlay shows both for comparison
- [ ] Adjust prompt based on real-world output quality
- [ ] Tune system prompt with edge cases (low volume, non-SSO, declining trends)

### Phase 3: Full replacement
- [ ] AI insights become the default
- [ ] Rule-based engine kept as fallback (if API is down/slow)
- [ ] AI-generated playbook content (personalized per FI)
- [ ] PDF export with AI-generated narratives
- [ ] Monitor costs and cache hit rates

### Phase 4: Advanced features (future)
- [ ] Cross-FI network analysis ("FIs similar to yours are seeing...")
- [ ] Anomaly detection ("unusual pattern detected this week...")
- [ ] Predictive insights ("based on current trajectory...")
- [ ] Chat interface — let partners ask follow-up questions about their data
- [ ] Automated weekly digest emails with AI-generated summaries

---

## Open Questions

1. **Fallback behavior** — If Claude API is down or slow (>5s), serve cached results? Serve rule-based fallback? Show a "generating insights..." spinner?
2. **Cache invalidation** — Invalidate on new daily data? On registry changes? Time-based only?
3. **Output quality bar** — How do we validate AI output before showing to partners? Human review of first N responses? Automated checks?
4. **Prompt iteration** — How do we version and test prompt changes? A/B testing? Shadow mode?
5. **Rate limiting** — Cap API calls per day to prevent runaway costs? (Probably unnecessary at this scale but worth considering.)

---

## Why This Works

The current rule-based engine was the right v1 — it validated that contextual insights add value to the dashboard. But maintaining 50+ rules, adding new patterns, and keeping narratives fresh requires constant code changes.

The AI approach:
- **Scales with data, not code** — New patterns detected automatically
- **Always fresh narratives** — No repetitive template text
- **Personalized** — References the specific FI, their specific numbers, their specific situation
- **Low cost** — $20-50/month for the entire FI network
- **Low risk** — Server-side only, existing auth, zero PII sent, cached results, rule-based fallback
- **Incremental** — Can run alongside the existing engine, compare, and switch over gradually
