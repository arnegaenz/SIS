/**
 * ai-insights.mjs — AI-Powered Insights Engine
 *
 * Replaces hardcoded rule-based narratives/actions with Claude API-generated insights.
 * Server-side only. API key never touches the browser.
 *
 * Usage:
 *   import { generateAIInsights } from './ai-insights.mjs';
 *   const insights = await generateAIInsights(metricsContext, { accessLevel, integrationContext });
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRETS_FILE = path.join(__dirname, "..", "secrets", "anthropic.json");

let _client = null;

async function getClient() {
  if (_client) return _client;
  const raw = await fs.readFile(SECRETS_FILE, "utf8");
  const { api_key } = JSON.parse(raw);
  _client = new Anthropic({ apiKey: api_key });
  return _client;
}

// ── Cache ──
const _insightsCache = new Map(); // cacheKey → { data, time }
const INSIGHTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function buildCacheKey(fiKey, dateRange, accessLevel, integrationContext) {
  return `${fiKey}:${dateRange}:${accessLevel}:${integrationContext}`;
}

function getCached(key) {
  const entry = _insightsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > INSIGHTS_CACHE_TTL) {
    _insightsCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  _insightsCache.set(key, { data, time: Date.now() });
  // Evict old entries if cache grows
  if (_insightsCache.size > 200) {
    const cutoff = Date.now() - INSIGHTS_CACHE_TTL;
    for (const [k, v] of _insightsCache) {
      if (v.time < cutoff) _insightsCache.delete(k);
    }
  }
}

// ── System Prompt ──

// Access levels that get internal / unvarnished vocabulary and may see named-FI benchmarks.
const INTERNAL_ACCESS_LEVELS = new Set(["admin", "core", "internal", "siteops", "support", "cs"]);

function isInternalAccess(accessLevel) {
  return INTERNAL_ACCESS_LEVELS.has(accessLevel);
}

// Partner-facing vocabulary rules. Applied for fi, partner, executive (and any unknown role).
const PARTNER_VOCAB_RULES = `
## VOCABULARY RULES (partner-facing output)

- Use "visit" / "visits" — never "session" / "sessions"
- Use "card update" / "cards updated" — never "placement" / "placements"
- Use "conversion rate" — never "success rate"
- Use "engagement rate" — never "credential entry rate"
- Use "monthly adoption" / "adoption rate" — never "reach" / "monthly reach"
- Use "online banking" — never "SSO"
- Use "standalone" — never "non-SSO"
- Use "organic only" — never "discovery" or "incidental"
- Use "campaign-driven" — never just "campaign" alone
- Use "activation-embedded" — never just "activation" alone
- NEVER use tier numbers (T1, T2, T1.5, etc.) or the word "tier" — use the channel name directly
- NEVER use: CardSavr, SM, CE, UDF, GA, job, grant, SDK
`;

// Internal vocabulary — looser rule, preserves existing acronyms for team use.
const INTERNAL_VOCAB_RULES = `
## VOCABULARY RULES (internal output)

Internal vocabulary is permitted (SSO, Non-SSO, session, placement, reach, tier numbers, UDF, etc.).
Be precise and use the terms defined in PRODUCT CONTEXT above.
`;

// Benchmarking section — named FIs only for internal roles.
const INTERNAL_BENCHMARKING = `
## BENCHMARKING PHILOSOPHY

Always benchmark against best-of-best performance (aspirational ceiling), never averages. Use the partner's own best-week data as proof their cardholders CAN convert.
- You may reference named FIs for context (MSUFCU at 27%, Cape Cod Five, Kemba, ORNL).
`;

const PARTNER_BENCHMARKING = `
## BENCHMARKING PHILOSOPHY

Always benchmark against best-of-best performance (aspirational ceiling), never averages. Use the partner's own best-week data as proof their cardholders CAN convert.
- Reference top-quartile / best-of-best FI performance in anonymized terms only ("top-performing institutions", "best-of-best benchmark", "top-quartile peer").
- NEVER name specific financial institutions or credit unions.
`;

function buildSystemPrompt(accessLevel) {
  const internal = isInternalAccess(accessLevel);
  const vocabBlock = internal ? INTERNAL_VOCAB_RULES : PARTNER_VOCAB_RULES;
  const benchmarkBlock = internal ? INTERNAL_BENCHMARKING : PARTNER_BENCHMARKING;
  return BASE_SYSTEM_PROMPT_HEAD + vocabBlock + benchmarkBlock + BASE_SYSTEM_PROMPT_TAIL;
}

const BASE_SYSTEM_PROMPT_HEAD = `You are the Strivve CardUpdatr Analytics Engine. You analyze financial institution (FI) engagement data and generate insights for the CardUpdatr dashboard.

## PRODUCT CONTEXT

**CardUpdatr** is Strivve's product that lets cardholders update their payment card across multiple merchants (Netflix, Amazon, Spotify, etc.) in one session. It's sold to financial institutions (credit unions, banks) through integration partners.

**Key terms:**
- **Session**: A cardholder opens CardUpdatr (SSO login or standalone)
- **Successful session**: Cardholder completes at least one card-on-file update
- **Placement**: A single merchant card update (one session can have multiple placements)
- **Session success rate**: % of sessions that result in at least one successful placement
- **Monthly reach %**: % of total cardholders who encounter CardUpdatr per month
- **SSO**: Cardholders launch CardUpdatr from within online/mobile banking (authenticated, seamless)
- **Non-SSO**: Cardholders arrive via standalone (must enter card info manually — every visitor is already committed)

## MOTIVATION SPECTRUM FRAMEWORK

The core thesis: CardUpdatr's conversion rate is determined by cardholder motivation at the moment of encounter, not product quality.

### SSO Classification (by session success rate):
- **Activation (≥21%)**: Cardholder just got a new card. Urgent need. 1 in 4 completes.
- **Campaign → Activation transition (≥12%)**: Mix of activation and campaign traffic.
- **Campaign (≥8%)**: Cardholder prompted via SMS/email. Manufactured motivation.
- **Discovery → Campaign transition (≥3%)**: Mix of discovery and some campaign traffic.
- **Discovery (<3%)**: Cardholder browsing online banking. No prompt, no urgency.

### Non-SSO Classification (shifted higher because every visitor already committed by entering card data):
- **Activation (≥35%)**, Campaign→Activation (≥25%), Campaign (≥15%), Discovery→Campaign (≥8%), Discovery (<8%)

### The 7.7x conversion gap between motivated (Activation) and incidental (Discovery) traffic is validated across multiple FIs.

## TONE & FRAMING DIRECTIVE

Follow these rules for ALL partner-facing content:
1. Lead with what's working, then show opportunity
2. Frame gaps as opportunity, not failure
3. Use their best performance as the anchor
4. Declining trends → framed as controllable, not alarming
5. Discovery is a starting line, not a verdict
6. Projections should feel exciting, not hypothetical
7. Never blame the partner
8. Always include a path forward

**For admin/internal access level**: Be unvarnished. Give the real story. Include internal talking points.
`;

const BASE_SYSTEM_PROMPT_TAIL = `
## ACTION LIBRARY — Available Engagement Channels

When recommending actions, draw from these proven channels:

### Issuance & Activation Flows
Embed CardUpdatr into card activation (new account, expiration replacement, lost/stolen reissuance). Peak motivation moment. Channels: post-activation email, post-activation SMS, in-app activation screen, IVR/phone activation, card carrier/buck slip.

### Targeted Campaigns & Promotions
Seasonal campaigns (Black Friday, holidays, New Year, back-to-school), behavioral triggers (dormant card reactivation), rewards/incentive campaigns, general awareness newsletters.

### Digital Banking Visibility
Menu placement in digital banking, card lock/unlock prompts, travel notice prompts, card details screen links.

### Experience Optimization
Value proposition copy at point of encounter (problem→solution, speed, prevention framing), merchant list curation (lead with recognizable brands, organize by category).

### Scaling What Works
Extend to additional card products, increase campaign frequency, layer complementary channels (SMS follow-up to email).

### Member Services & Call Center
Rep scripts for: card reissuance calls, general inquiry, fraud/stolen card situations. Natural, conversational — mention as helpful next step, don't sell.

## OUTPUT FORMAT

You MUST respond with valid JSON matching this exact schema. No markdown, no explanation outside the JSON.

{
  "narratives": [
    {
      "section": "headline" | "conversion" | "outcomes" | "reach" | "completion" | "potential",
      "html": "<p>Insight text with <strong>key metrics</strong> emphasized.</p>",
      "sentiment": "positive" | "neutral" | "caution" | "opportunity"
    }
  ],
  "spectrum": {
    "tier": 1 | 1.5 | 2 | 2.5 | 3,
    "label": "Tier label string",
    "diagnosis": "2-3 sentence diagnosis of what's driving the tier classification"
  },
  "actions": [
    {
      "headline": "Action title",
      "detail": "Contextualized explanation with specific metrics from the data",
      "impact": "high" | "medium" | "low",
      "channel": "activation" | "campaigns" | "visibility" | "optimization" | "scaling" | "member-services"
    }
  ],
  "projections_narrative": "1-2 sentence narrative about what's possible if actions are taken, using specific numbers from the data",
  "admin_notes": "Internal-only commentary (only include when access_level is admin or internal, otherwise omit this field)"
}

### Rules:
- Generate 3-6 narratives covering the most relevant sections
- Generate 2-4 prioritized actions (highest impact first)
- All numbers should reference actual data from the metrics context
- Use <strong> tags for emphasis in narrative HTML
- For low-volume FIs (<30 sessions), note that data is limited and patterns may not be stable
- Tier classification must match the thresholds defined above
- NEVER invent numbers — only reference data provided in the metrics context
`;

/**
 * Generate AI-powered insights for an FI.
 *
 * @param {Object} metricsContext - The metrics context (same shape as buildMetricsContext output)
 * @param {Object} opts
 * @param {string} opts.accessLevel - admin|core|internal|siteops|support|cs|executive|partner|fi (legacy: limited→fi, full→admin). Defaults to "partner" if not supplied.
 * @param {string} opts.integrationContext - combined|sso|nonsso
 * @param {string} opts.fiName - FI display name
 * @param {string} opts.fiKey - FI lookup key
 * @param {string} opts.dateRange - e.g. "2026-01-01:2026-02-25"
 * @returns {Object} Parsed insights JSON
 */
export async function generateAIInsights(metricsContext, opts = {}) {
  const {
    accessLevel = "partner",
    integrationContext = "combined",
    fiName = "Unknown FI",
    fiKey = "",
    dateRange = "",
  } = opts;

  if (!opts.accessLevel) {
    console.warn(`[ai-insights] No accessLevel supplied for ${fiKey || fiName}; defaulting to "partner" (conservative partner-facing vocabulary)`);
  }
  // Legacy compat: normalize stale role names to current 9-role system
  const normalizedAccessLevel = accessLevel === "limited" ? "fi" : (accessLevel === "full" ? "admin" : accessLevel);

  // Check cache
  const cacheKey = buildCacheKey(fiKey, dateRange, normalizedAccessLevel, integrationContext);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[ai-insights] Cache hit for ${fiKey}`);
    return { ...cached, _cached: true };
  }

  const client = await getClient();

  const userMessage = `Analyze this FI's CardUpdatr engagement data and generate insights.

**FI Name**: ${fiName}
**FI Key**: ${fiKey}
**Date Range**: ${dateRange}
**Access Level**: ${normalizedAccessLevel}
**Integration Context**: ${integrationContext}

**Metrics Context**:
${JSON.stringify(metricsContext, null, 2)}

Generate insights following the output format specified in your instructions. Remember:
- Reference specific numbers from the metrics
- Match tier classification to the defined thresholds
- ${isInternalAccess(normalizedAccessLevel) ? "Include admin_notes with unvarnished internal analysis" : "Use engagement-positive framing, anonymize benchmarks"}
- Prioritize actions by impact for this specific FI's situation`;

  console.log(`[ai-insights] Generating insights for ${fiName} (${fiKey}), access=${normalizedAccessLevel}, integration=${integrationContext}`);
  const startMs = Date.now();

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: [{ type: "text", text: buildSystemPrompt(normalizedAccessLevel), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
    });

    const elapsed = Date.now() - startMs;
    const text = response.content?.[0]?.text || "";
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const cacheRead = response.usage?.cache_read_input_tokens || 0;
    const cacheCreation = response.usage?.cache_creation_input_tokens || 0;

    console.log(`[ai-insights] Response for ${fiKey}: ${elapsed}ms, ${inputTokens} in (${cacheRead} cached, ${cacheCreation} new), ${outputTokens} out`);

    // Parse JSON response
    let insights;
    try {
      // Handle potential markdown code fences
      const cleaned = text.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      insights = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(`[ai-insights] JSON parse error for ${fiKey}:`, parseErr.message);
      console.error(`[ai-insights] Raw response:`, text.slice(0, 500));
      return { error: "Failed to parse AI response", raw: text.slice(0, 200) };
    }

    // Add metadata
    insights._meta = {
      model: "claude-haiku-4-5-20251001",
      elapsed_ms: elapsed,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      generated_at: new Date().toISOString(),
    };

    // Cache the result
    setCache(cacheKey, insights);

    return insights;
  } catch (err) {
    console.error(`[ai-insights] API error for ${fiKey}:`, err.message);
    return { error: err.message };
  }
}

/**
 * Clear the insights cache (e.g., when data is refreshed).
 */
export function clearInsightsCache() {
  _insightsCache.clear();
  console.log("[ai-insights] Cache cleared");
}

/**
 * Get cache stats for monitoring.
 */
export function getInsightsCacheStats() {
  return {
    entries: _insightsCache.size,
    keys: [..._insightsCache.keys()],
  };
}
