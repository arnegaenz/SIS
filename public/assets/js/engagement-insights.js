/**
 * engagement-insights.js
 *
 * Configuration and engine for the Cardholder Engagement Dashboard's
 * narrative, benchmarking, diagnosis, prescriptive actions, and value projection layers.
 *
 * All benchmark data is validated from real network performance.
 * Narrative rules are modular — add/edit entries without touching component code.
 */
(function() {
'use strict';

// ─── Tier Boundaries ────────────────────────────────────────────────────────

const TIER_BOUNDARIES = {
  tier1: { min: 21, max: 27, label: 'Card Activation Flow', color: '#22c55e' },
  tier2: { min: 8, max: 12, label: 'SMS & Targeted Campaigns', color: '#eab308' },
  tier3: { min: 0, max: 3, label: 'Incidental Discovery', color: '#ef4444' },
  // Transition zones
  tier2to1: { min: 12, max: 21, label: 'Campaign → Activation', color: '#84cc16' },
  tier3to2: { min: 3, max: 8, label: 'Discovery → Campaign', color: '#f97316' },
};

// ─── Benchmark Data ─────────────────────────────────────────────────────────

const BENCHMARKS = {
  activationFlowPeakDays: {
    sessionSuccessRange: '21–27%',
    description: 'Partners embedding CardUpdatr in card activation flows on peak days',
    proof: 'Multiple issuers confirm this range during card onboarding and reissuance events',
    // Admin-only named references
    _admin: {
      sources: 'MSUFCU daily data (Jul 8, Jul 31, Dec 13, Dec 21, 2024)',
    },
  },
  campaignWeeksSustained: {
    sessionSuccessRange: '8–12%',
    description: 'Best campaign weeks across the network',
    proof: '6 separate weeks in 2025 and 3 in 2024 sustained this range across hundreds of visits',
    scaleProof: 'One partner achieved 409 visits at 9.8% in a single week — high volume doesn\'t dilute conversion when traffic is motivated',
    _admin: {
      sources: 'MSUFCU best weeks 2025 (6 weeks confirmed)',
      scaleDetail: 'MSUFCU Jan 19–25 week — 409 selects, 9.8% success, 76 placements',
    },
  },
  credentialEntryMotivated: {
    rate: 18.3,
    rateLabel: '18.3%',
    description: 'Select→Credential rate for motivated cardholder flows',
    comparison: 'vs 2.4% for incidental discovery traffic',
  },
  motivationMultiplier: {
    value: 7.7,
    valueLabel: '7.7×',
    description: 'Card placement rate for motivated flows vs incidental',
  },
  medianGapAcrossFIs: {
    value: 5.3,
    valueLabel: '5.3×',
    description: 'Median cardholder success gap between motivated and incidental across all FIs',
    proof: 'Removes any single-partner skew — pattern holds broadly',
  },
  nonSSOOutliers: {
    headline: 'Even without pre-authenticated integration, issuers targeting motivated cardholders achieve up to 23–36% cardholder success',
    description: 'Proves it\'s motivation, not technology',
    _admin: {
      sources: 'Cape Cod Five 66.7%, Kemba 36.0%, ORNL 12.5% cred entry at 1,367 selects',
    },
  },
  volumeScaleProof: {
    headline: 'One partner nearly doubled volume (82.6% more visits) while conversion held steady',
    description: 'Scale without dilution when traffic quality is maintained',
    _admin: {
      sources: 'MSUFCU 2024→2025 — 82.6% more selects, only 0.1pp conversion drop',
    },
  },
};

// ─── Narrative Rules ────────────────────────────────────────────────────────
// Each rule: { id, metric, condition(metrics), narrative(metrics), benchmarks[], filterHint? }

const NARRATIVE_RULES = [

  // ── Select → Credential % ──────────────────────────────────────────────

  {
    id: 'selCred_low',
    metric: 'selCredPct',
    section: 'conversion',
    condition: (m) => m.selCredPct !== null && m.selCredPct < 5,
    narrative: (m) => `Your cardholders are browsing merchants, and <strong>${fmt(m.selCredPct)}%</strong> are taking the next step to enter credentials — a foundation of organic engagement. Partners who add targeted activation flows or campaign touchpoints typically see this rate jump to 18–27%, unlocking significantly more placements from the same cardholder base.`,
    benchmarks: ['credentialEntryMotivated'],
    filterHint: (m) => m.hasMultipleIntegrations ? {
      text: 'Try filtering to SSO integrations to isolate motivated traffic patterns',
      action: 'filter', filters: { integration: 'SSO' },
      secondaryLink: { text: 'Learn about integration sources', url: 'https://developers.strivve.com/integrations/sources' },
    } : null,
  },
  {
    id: 'selCred_mid',
    metric: 'selCredPct',
    section: 'conversion',
    condition: (m) => m.selCredPct !== null && m.selCredPct >= 5 && m.selCredPct <= 15,
    narrative: (m) => `<strong>${fmt(m.selCredPct)}%</strong> of cardholders who browse merchants are engaging further — a solid indicator that your traffic includes motivated cardholders. Isolating your campaign-driven or activation visits would likely reveal even stronger engagement within that cohort, pointing the way to scale what's working.`,
    benchmarks: ['credentialEntryMotivated'],
    filterHint: (m) => m.hasMultipleFIs ? {
      text: 'Filter to individual FIs to see which are driving higher engagement',
      action: 'scroll', scrollTarget: 'fiTablesSection',
    } : null,
  },
  {
    id: 'selCred_high',
    metric: 'selCredPct',
    section: 'conversion',
    condition: (m) => m.selCredPct !== null && m.selCredPct > 15,
    narrative: (m) => `Great engagement — <strong>${fmt(m.selCredPct)}%</strong> of cardholders who see merchants are taking action. This is the kind of motivated traffic that drives real results, consistent with activation flows or targeted campaigns reaching the right cardholders at the right time.`,
    benchmarks: [],
  },

  // ── Session Success % ─────────────────────────────────────────────────

  {
    id: 'sessSuccess_low',
    metric: 'sessionSuccessPct',
    section: 'headline',
    condition: (m) => m.sessionSuccessPct !== null && m.sessionSuccessPct < 3,
    narrative: (m) => `Your cardholders are converting at <strong>${fmt(m.sessionSuccessPct)}%</strong> today — typical of early-stage deployment where cardholders discover CardUpdatr organically during routine banking. This is actually a solid starting point: partners who layer in targeted activation or campaign touchpoints consistently see this rate jump to 8–12%, with activation flows reaching 21–27%.${m.hasSSO ? ' Your SSO integration is a strong foundation — the next step is connecting it to card activation moments when cardholder motivation peaks.' : ''}`,
    benchmarks: ['campaignWeeksSustained', 'activationFlowPeakDays'],
  },
  {
    id: 'sessSuccess_mid',
    metric: 'sessionSuccessPct',
    section: 'headline',
    condition: (m) => m.sessionSuccessPct !== null && m.sessionSuccessPct >= 3 && m.sessionSuccessPct <= 8,
    narrative: (m) => `At <strong>${fmt(m.sessionSuccessPct)}%</strong>, you're seeing campaign-tier engagement — your cardholders are responding to how they're encountering CardUpdatr. This is strong momentum. Partners who sustain and expand this approach consistently reach 8–12% success rates, with the highest performers pushing into the activation-flow range.`,
    benchmarks: ['campaignWeeksSustained'],
    filterHint: () => ({
      text: 'Compare weekly periods to identify which weeks drive campaign-level performance',
      action: 'scroll', scrollTarget: 'highlightsSection',
    }),
  },
  {
    id: 'sessSuccess_high',
    metric: 'sessionSuccessPct',
    section: 'headline',
    condition: (m) => m.sessionSuccessPct !== null && m.sessionSuccessPct > 8,
    narrative: (m) => `Excellent performance — a <strong>${fmt(m.sessionSuccessPct)}%</strong> cardholder success rate puts you in the <strong>activation-flow tier</strong>, the highest bracket across the network. Your cardholders are reaching CardUpdatr at the right moment with the right motivation. The focus now is scaling this volume while maintaining conversion quality — partners who do this see compounding returns.`,
    benchmarks: ['activationFlowPeakDays'],
  },

  // ── Avg Cards Per Session ─────────────────────────────────────────────

  {
    id: 'avgCards_low',
    metric: 'avgCardsPerSession',
    section: 'outcomes',
    condition: (m) => m.avgCardsPerSession !== null && m.avgCardsPerSession > 0 && m.avgCardsPerSession < 1.5,
    narrative: (m) => `Your successful cardholders are averaging <strong>${fmt(m.avgCardsPerSession)}</strong> card updates per visit. Partners who surface a curated list of popular, relevant merchants see cardholders update more accounts per visit — deepening each visit's impact and multiplying the value of every successful engagement.`,
    benchmarks: [],
  },
  {
    id: 'avgCards_good',
    metric: 'avgCardsPerSession',
    section: 'outcomes',
    condition: (m) => m.avgCardsPerSession !== null && m.avgCardsPerSession >= 1.5,
    narrative: (m) => `Your successful cardholders are updating <strong>${fmt(m.avgCardsPerSession)}</strong> merchants on average — strong depth. Once they commit, they're engaging across multiple merchants, which means every successful visit delivers compounding value.`,
    benchmarks: [],
  },

  // ── Monthly Reach % ───────────────────────────────────────────────────

  {
    id: 'reach_low',
    metric: 'monthlyReachPct',
    section: 'reach',
    condition: (m) => m.monthlyReachPct !== null && m.monthlyReachPct < 0.5,
    narrative: (m) => `You're reaching <strong>${fmt(m.monthlyReachPct)}%</strong> of your member base today — and even small increases in visibility unlock outsized impact. Embedding CardUpdatr in card activation or reissuance flows is the fastest path to expanding reach to motivated cardholders who are ready to act.`,
    benchmarks: ['motivationMultiplier'],
  },
  {
    id: 'reach_ok',
    metric: 'monthlyReachPct',
    section: 'reach',
    condition: (m) => m.monthlyReachPct !== null && m.monthlyReachPct >= 0.5 && m.monthlyReachPct < 2.5,
    narrative: (m) => `<strong>${fmt(m.monthlyReachPct)}%</strong> monthly reach shows cardholders are finding CardUpdatr — a growing foundation. Expanding visibility through card activation and reissuance touchpoints is the next high-impact move, connecting with cardholders at the moment their motivation is highest.`,
    benchmarks: [],
  },
  {
    id: 'reach_good',
    metric: 'monthlyReachPct',
    section: 'reach',
    condition: (m) => m.monthlyReachPct !== null && m.monthlyReachPct >= 2.5,
    narrative: (m) => `<strong>${fmt(m.monthlyReachPct)}%</strong> monthly reach is strong visibility — your cardholders are consistently encountering CardUpdatr. The opportunity now is optimizing conversion quality within this engaged audience, turning more encounters into completed placements.`,
    benchmarks: [],
  },

  // ── Credential Completion Rate (success / cred entry) ─────────────────

  {
    id: 'credCompletion_low',
    metric: 'credCompletionPct',
    section: 'completion',
    condition: (m) => m.credCompletionPct !== null && m.credCompletionPct > 0 && m.credCompletionPct < 25,
    narrative: (m) => `<strong>${fmt(m.credCompletionPct)}%</strong> of cardholders who enter credentials are completing placements — and each improvement in this rate directly multiplies your placement count. Partners who optimize the merchant experience and streamline authentication see meaningful gains here, turning more committed cardholders into completed placements.`,
    benchmarks: [],
  },
  {
    id: 'credCompletion_good',
    metric: 'credCompletionPct',
    section: 'completion',
    condition: (m) => m.credCompletionPct !== null && m.credCompletionPct >= 25,
    narrative: (m) => `Once cardholders commit to entering credentials, <strong>${fmt(m.credCompletionPct)}%</strong> complete a placement — a healthy completion rate that shows the process is working well. The biggest growth lever now is getting more cardholders to that commitment point through stronger positioning and motivated touchpoints.`,
    benchmarks: [],
  },

  // ── Best Week vs Current Average ──────────────────────────────────────

  {
    id: 'bestWeek_gap',
    metric: 'bestWeekGap',
    section: 'potential',
    condition: (m) => m.bestWeekRate !== null && m.sessionSuccessPct !== null && m.sessionSuccessPct > 0 && (m.bestWeekRate / m.sessionSuccessPct) > 2,
    narrative: (m) => {
      const multiplier = fmt(m.bestWeekRate / m.sessionSuccessPct);
      return `Your best 7-day window hit <strong>${fmt(m.bestWeekRate)}%</strong> — that's <strong>${multiplier}×</strong> your current average, achieved with <em>your</em> cardholders on <em>your</em> integration. The demand is proven. The question isn't whether your members will respond — it's how to make that peak performance the norm rather than the exception.`;
    },
    benchmarks: ['campaignWeeksSustained'],
    filterHint: (m) => m.bestWeekStart ? {
      text: `Filter to ${m.bestWeekStart} – ${m.bestWeekEnd} to examine your best-performing window`,
      action: 'filter', filters: { dateFrom: m.bestWeekStart, dateTo: m.bestWeekEnd },
    } : null,
  },
];

// ─── Action Rules ───────────────────────────────────────────────────────────
// Each rule: { id, condition(diagnosis), priority, actions[] }
// diagnosis = { tier, lowReach, lowCredEntry, lowCompletion, goodPerformance, bestWeekGap, metrics }

const ACTION_RULES = [
  {
    id: 'tier3_incidental',
    condition: (d) => d.tier === 3,
    priority: 1,
    actions: [
      {
        headline: 'Activate your highest-impact channel: card activation flow',
        detail: 'Partners who embed CardUpdatr in card activation and reissuance moments see 21–27% cardholder success — the highest conversion tier across the network. Your organic engagement proves cardholder demand; activation flows connect with that demand at the peak moment.',
        impact: 'high',
      },
      {
        headline: 'Launch a targeted SMS or email campaign',
        detail: 'A focused campaign drives motivated cardholders to CardUpdatr when they\'re ready to act. Campaign weeks consistently deliver 8–12% success rates across the network — a transformative step up from organic discovery.',
        impact: 'high',
      },
      {
        headline: 'Enable Source Path Tracking to measure what works',
        detail: 'With Source Path Tracking, you can measure exactly which channels drive placements and prove ROI by channel — giving you the data to invest confidently in what\'s working.',
        impact: 'medium',
      },
    ],
  },
  {
    id: 'low_reach',
    condition: (d) => d.lowReach,
    priority: 2,
    actions: [
      {
        headline: 'Expand CardUpdatr visibility in your digital banking experience',
        detail: (d) => `You're reaching ${fmt(d.metrics.monthlyReachPct)}% of members today — even a modest increase in visibility to motivated cardholders could meaningfully multiply your placement volume. This is your highest-leverage growth opportunity.`,
        impact: 'high',
      },
      {
        headline: 'Connect CardUpdatr to card activation and reissuance communications',
        detail: 'Card activation and reissuance moments are when cardholder motivation peaks — a new or replacement card creates an immediate, natural need to update merchants. Meeting cardholders at this moment produces the strongest engagement.',
        impact: 'high',
      },
    ],
  },
  {
    id: 'low_cred_entry',
    condition: (d) => d.lowCredEntry,
    priority: 3,
    actions: [
      {
        headline: 'Strengthen the value proposition at the point of encounter',
        detail: 'There\'s a significant untapped audience browsing merchants who haven\'t taken the next step yet. Clearer messaging about what CardUpdatr does and why — at the moment of encounter — could meaningfully lift engagement.',
        impact: 'medium',
      },
      {
        headline: 'Surface a curated top-merchant list',
        detail: 'Partners who lead with familiar, popular merchants see higher credential entry rates. Showing the most relevant options first helps cardholders immediately see the value and take action.',
        impact: 'medium',
      },
    ],
  },
  {
    id: 'low_completion',
    condition: (d) => d.lowCompletion,
    priority: 4,
    actions: [
      {
        headline: 'Optimize merchant-level success rates together',
        detail: 'Working together to identify specific merchants with completion challenges can unlock quick wins — resolving integration issues at even a few high-traffic merchants can meaningfully improve overall placement rates.',
        impact: 'medium',
      },
      {
        headline: 'Streamline the authentication experience',
        detail: 'Reducing friction in the credential flow — whether from password complexity, MFA challenges, or timeouts — helps more cardholders complete the process they\'ve already chosen to start.',
        impact: 'medium',
      },
    ],
  },
  {
    id: 'good_performance',
    condition: (d) => d.goodPerformance,
    priority: 5,
    actions: [
      {
        headline: 'Scale what\'s working — your conversion supports it',
        detail: 'Your strong conversion rate means more motivated traffic translates directly to proportionally more placements. Increasing volume while maintaining quality is the path to compounding returns.',
        impact: 'high',
      },
      {
        headline: 'Layer additional engagement channels',
        detail: 'Your current channels are performing well. Adding complementary touchpoints — SMS campaigns alongside activation flows, for example — creates incremental lift that compounds with your existing success.',
        impact: 'medium',
      },
      {
        headline: 'Enable Source Path Tracking to prove channel ROI',
        detail: 'With your strong performance, Source Path Tracking lets you quantify exactly which channels deliver the best results — powerful data for justifying continued and expanded investment.',
        impact: 'medium',
      },
    ],
  },
  {
    id: 'best_week_gap',
    condition: (d) => d.bestWeekGap,
    priority: 2,
    actions: [
      {
        headline: 'Make your best week the new baseline',
        detail: (d) => `Your ${d.metrics.bestWeekLabel || 'best'} window hit ${fmt(d.metrics.bestWeekRate)}% with your own cardholders — that performance is achievable and repeatable. Identifying what drove that week and systematizing it is the highest-ROI move available.`,
        impact: 'high',
      },
    ],
  },
];

// ─── Admin Talking Points Rules ─────────────────────────────────────────────
// Only rendered when user is admin/internal. Framed as things to SAY to the partner.

const ADMIN_TALKING_POINTS = [
  {
    id: 'sso_underperforming',
    condition: (m) => m.hasSSO && m.sessionSuccessPct < 3,
    point: (m) => `This is an SSO partner but their funnel shape looks like incidental discovery. SSO is a proxy for motivation, not a guarantee — they need to embed CardUpdatr in activation flows to unlock their SSO advantage.`,
    category: 'diagnosis',
  },
  {
    id: 'best_week_proof',
    condition: (m) => m.bestWeekRate && m.sessionSuccessPct > 0 && (m.bestWeekRate / m.sessionSuccessPct) > 2,
    point: (m) => `Their best week hit ${fmt(m.bestWeekRate)}% — use this as proof their members respond when motivated. Ask: what was different that week? Can we replicate it?`,
    category: 'diagnosis',
  },
  {
    id: 'low_reach_lever',
    condition: (m) => m.monthlyReachPct !== null && m.monthlyReachPct < 0.5,
    point: (m) => `Only ${fmt(m.monthlyReachPct)}% of members seeing CardUpdatr. This is the biggest lever. Don't let them blame the product — the product works, it just needs motivated eyeballs.`,
    category: 'strategy',
  },
  {
    id: 'high_cred_low_completion',
    condition: (m) => m.selCredPct > 10 && m.credCompletionPct !== null && m.credCompletionPct < 25,
    point: (m) => `Cardholders are willing to try — ${fmt(m.selCredPct)}% enter credentials. But only ${fmt(m.credCompletionPct)}% complete. Dig into merchant-level failures if available. This might be a technical issue, not a motivation issue.`,
    category: 'diagnosis',
  },
  {
    id: 'source_path_cta',
    condition: () => true, // Always show
    point: () => `<strong>ACTION ITEM:</strong> Push Source Path Tracking enablement. Once enabled, we can replace inferred motivation data with measured channel performance. Every partner conversation should include this CTA.`,
    category: 'action',
  },
];

// ─── Admin Objection Responses ──────────────────────────────────────────────

const ADMIN_OBJECTIONS = [
  {
    objection: '"Our conversion is low because the product doesn\'t work"',
    response: (m) => `Your best week hit ${fmt(m.bestWeekRate || m.sessionSuccessPct)}% — same product, same integration. The difference is traffic quality, not product quality. When motivated cardholders use CardUpdatr, it converts.`,
  },
  {
    objection: '"We don\'t have the resources for campaigns"',
    response: (m) => {
      const multiplier = m.sessionSuccessPct > 0 ? fmt(8 / m.sessionSuccessPct) : '?';
      return `Even a single SMS push during card reissuance can shift your traffic from Tier 3 to Tier 2. Partners running modest campaigns see 8–12% — that's ${multiplier}× your current rate with the same cardholder base.`;
    },
  },
  {
    objection: '"This is just small sample sizes"',
    response: (m) => `Your ${fmtN(m.totalSessions)} visits over ${m.daySpan} days is a meaningful data set. And the pattern holds across the network — the 5.3× conversion gap between motivated and incidental traffic uses median performance across all FIs, not just one partner.`,
  },
  {
    objection: '"Why should we pay for this if conversion is so low?"',
    response: (m) => {
      const projected = Math.round(m.totalSessions * 0.08 * (m.avgCardsPerSession || 1));
      return `At your current incidental rate, you're generating ${fmtN(m.successfulPlacements)} placements. If you moved to campaign-tier performance (8%), that's ~${fmtN(projected)} placements from the same visit volume. The product delivers — the opportunity is in how cardholders reach it.`;
    },
  },
];

// ─── Admin Benchmark References (named, never shown to customers) ───────────

const ADMIN_BENCHMARK_REFS = [
  '21–27% activation peaks: MSUFCU daily data (Jul 8, Jul 31, Dec 13, Dec 21, 2024)',
  '8–12% campaign weeks: MSUFCU best weeks 2025 (6 weeks confirmed)',
  'Non-SSO outliers: Cape Cod Five 66.7%, Kemba 36.0%, ORNL 12.5% cred entry at 1,367 selects',
  'Scale proof: MSUFCU Jan 19–25 week — 409 selects, 9.8% success, 76 placements',
  'Volume scaling: MSUFCU 2024→2025 — 82.6% more selects, only 0.1pp conversion drop',
];

// ─── Helper Functions ───────────────────────────────────────────────────────

/** Format a number to 1 decimal place, dropping .0 */
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
}

/** Format an integer with commas */
function fmtN(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Math.round(n).toLocaleString();
}

// ─── Engine Functions ───────────────────────────────────────────────────────

/**
 * Build the full metrics context object that all rules evaluate against.
 * @param {Object} renderCtx - the lastRenderContext from funnel-customer.html
 *   { metrics, best, perFi, startDate, endDate, daySpan }
 * @param {Object} opts - additional context
 *   { registryMap, visibleRows, filterState }
 * @returns {Object} metricsContext for rule evaluation
 */
function buildMetricsContext(renderCtx, opts = {}) {
  const m = renderCtx.metrics || {};
  const best = renderCtx.best || {};
  const daySpan = renderCtx.daySpan || 1;
  const visibleRows = opts.visibleRows || [];

  // Core metrics
  const totalSessions = m.totalSessions || 0;
  const sessionsWithSuccess = m.sessionsWithSuccessfulJobs || 0;
  const sessionSuccessPct = totalSessions > 0 ? (sessionsWithSuccess / totalSessions) * 100 : null;
  const successfulPlacements = m.successful || 0;
  const avgCardsPerSession = sessionsWithSuccess > 0 ? successfulPlacements / sessionsWithSuccess : null;

  // GA metrics
  const gaSelect = m.totalGaSelect || 0;
  const gaUser = m.totalGaUser || 0;
  const gaCred = m.totalGaCred || 0;

  // Conversion rates
  const selCredPct = gaSelect > 0 ? (gaCred / gaSelect) * 100 : null;
  const selUserPct = gaSelect > 0 ? (gaUser / gaSelect) * 100 : null;
  const selSuccessPct = gaSelect > 0 ? (sessionsWithSuccess / gaSelect) * 100 : null;

  // Credential completion: success / credential entry sessions
  const credSessions = m.totalCsCred || gaCred || 0;
  const credCompletionPct = credSessions > 0 ? (sessionsWithSuccess / credSessions) * 100 : null;

  // Monthly reach — average across visible FIs that have cardholder totals
  let monthlyReachPct = null;
  if (visibleRows.length > 0) {
    const registry = opts.registryMap || {};
    let totalCardholders = 0;
    let totalGaSelectForReach = 0;
    for (const row of visibleRows) {
      const key = row.fi_lookup_key || row.fi;
      const regEntry = registry[key];
      if (regEntry && regEntry.cardholder_total) {
        totalCardholders += regEntry.cardholder_total;
        totalGaSelectForReach += row.ga?.select_merchants || 0;
      }
    }
    if (totalCardholders > 0 && daySpan > 0) {
      const monthlySelects = (totalGaSelectForReach / daySpan) * 30;
      monthlyReachPct = (monthlySelects / totalCardholders) * 100;
    }
  }

  // Best week data
  const bestWeekEntry = findBestWeekEntry(best);
  // sessionSuccessRatio is stored as a ratio (0–1), convert to percentage
  const bestWeekRateRaw = bestWeekEntry ? bestWeekEntry.sessionSuccessRatio : null;
  const bestWeekRate = bestWeekRateRaw !== null ? bestWeekRateRaw * 100 : null;
  const bestWeekStart = bestWeekEntry ? bestWeekEntry.start : null;
  const bestWeekEnd = bestWeekEntry ? bestWeekEntry.end : null;
  const bestWeekLabel = bestWeekStart && bestWeekEnd ? `${bestWeekStart} – ${bestWeekEnd}` : null;

  // Integration info
  const integrationTypes = new Set(visibleRows.map(r => (r.integration_type || r.integration || '').toUpperCase()));
  const hasSSO = integrationTypes.has('SSO');
  const hasMultipleIntegrations = integrationTypes.size > 1;
  const hasMultipleFIs = visibleRows.length > 1;

  return {
    // Raw totals
    totalSessions,
    sessionsWithSuccess,
    successfulPlacements,
    gaSelect,
    gaUser,
    gaCred,
    credSessions,
    daySpan,

    // Rates
    sessionSuccessPct,
    avgCardsPerSession,
    selCredPct,
    selUserPct,
    selSuccessPct,
    credCompletionPct,
    monthlyReachPct,

    // Best week
    bestWeekRate,
    bestWeekStart,
    bestWeekEnd,
    bestWeekLabel,

    // Context flags
    hasSSO,
    hasMultipleIntegrations,
    hasMultipleFIs,

    // Pass-through
    startDate: renderCtx.startDate,
    endDate: renderCtx.endDate,
  };
}

/**
 * Find the best-week entry with highest session success ratio
 */
function findBestWeekEntry(best) {
  if (!best) return null;
  // best is an object or array of highlight entries
  const entries = Array.isArray(best) ? best : Object.values(best);
  let top = null;
  for (const e of entries) {
    if (e && e.sessionSuccessRatio != null && (!top || e.sessionSuccessRatio > top.sessionSuccessRatio)) {
      top = e;
    }
  }
  return top;
}

/**
 * Classify a session success rate into a motivation tier.
 * @param {number} rate - session success percentage
 * @returns {{ tier: number, label: string, color: string, zone: string }}
 */
function classifyTier(rate) {
  if (rate === null || rate === undefined) return { tier: 0, label: 'Insufficient Data', color: '#94a3b8', zone: 'unknown' };
  if (rate >= 21) return { tier: 1, label: 'Card Activation Flow', color: TIER_BOUNDARIES.tier1.color, zone: 'tier1' };
  if (rate >= 12) return { tier: 1.5, label: 'Campaign → Activation', color: TIER_BOUNDARIES.tier2to1.color, zone: 'tier2to1' };
  if (rate >= 8) return { tier: 2, label: 'SMS & Targeted Campaigns', color: TIER_BOUNDARIES.tier2.color, zone: 'tier2' };
  if (rate >= 3) return { tier: 2.5, label: 'Discovery → Campaign', color: TIER_BOUNDARIES.tier3to2.color, zone: 'tier3to2' };
  return { tier: 3, label: 'Incidental Discovery', color: TIER_BOUNDARIES.tier3.color, zone: 'tier3' };
}

/**
 * Evaluate all narrative rules against the metrics context.
 * @returns {{ id, section, html, benchmarkKeys[], filterHint? }[]}
 */
function evaluateNarratives(metricsCtx) {
  const results = [];
  for (const rule of NARRATIVE_RULES) {
    try {
      if (rule.condition(metricsCtx)) {
        const hint = rule.filterHint ? rule.filterHint(metricsCtx) : null;
        results.push({
          id: rule.id,
          metric: rule.metric,
          section: rule.section,
          html: rule.narrative(metricsCtx),
          benchmarkKeys: rule.benchmarks || [],
          filterHint: hint,
        });
      }
    } catch (e) {
      console.warn(`[insights] narrative rule ${rule.id} error:`, e);
    }
  }
  return results;
}

/**
 * Build the diagnosis object and evaluate action rules.
 * @returns {{ diagnosis: Object, actions: { headline, detail, impact }[] }}
 */
function evaluateActions(metricsCtx) {
  const rate = metricsCtx.sessionSuccessPct;
  const tierInfo = classifyTier(rate);

  const diagnosis = {
    tier: tierInfo.tier <= 1.5 ? 1 : tierInfo.tier <= 2.5 ? 2 : 3,
    tierInfo,
    lowReach: metricsCtx.monthlyReachPct !== null && metricsCtx.monthlyReachPct < 0.5,
    lowCredEntry: metricsCtx.selCredPct !== null && metricsCtx.selCredPct < 5,
    lowCompletion: metricsCtx.credCompletionPct !== null && metricsCtx.credCompletionPct < 25,
    goodPerformance: rate !== null && rate > 8,
    bestWeekGap: metricsCtx.bestWeekRate !== null && rate !== null && rate > 0 && (metricsCtx.bestWeekRate / rate) > 2,
    metrics: metricsCtx,
  };

  // Collect all matching actions, deduplicated by headline
  const allActions = [];
  const seen = new Set();

  const matchingRules = ACTION_RULES
    .filter(r => { try { return r.condition(diagnosis); } catch { return false; } })
    .sort((a, b) => a.priority - b.priority);

  for (const rule of matchingRules) {
    for (const action of rule.actions) {
      if (!seen.has(action.headline)) {
        seen.add(action.headline);
        allActions.push({
          headline: action.headline,
          detail: typeof action.detail === 'function' ? action.detail(diagnosis) : action.detail,
          impact: action.impact,
        });
      }
    }
  }

  return { diagnosis, actions: allActions };
}

/**
 * Compute value projection scenarios.
 * @returns {{ current: Object, scenarios: Object[] }}
 */
function computeProjections(metricsCtx, opts = {}) {
  const { totalSessions, sessionSuccessPct, successfulPlacements, avgCardsPerSession, daySpan, bestWeekRate } = metricsCtx;
  const cardsPerSession = avgCardsPerSession || 1;

  const current = {
    sessions: totalSessions,
    successRate: sessionSuccessPct,
    placements: successfulPlacements,
    days: daySpan,
  };

  const scenarios = [];

  // Best-quarter scenario (QBR mode) — takes precedence over best-week when provided
  const qbrBestQuarterRate = opts.qbrBestQuarterRate;
  if (qbrBestQuarterRate && sessionSuccessPct && qbrBestQuarterRate > sessionSuccessPct * 1.3) {
    const nearCampaign = Math.abs(qbrBestQuarterRate - 8) < 1.5;
    if (!nearCampaign) {
      const projSuccess = Math.round(totalSessions * (qbrBestQuarterRate / 100));
      const projPlacements = Math.round(projSuccess * cardsPerSession);
      scenarios.push({
        label: `At your best-quarter rate (${fmt(qbrBestQuarterRate)}%)`,
        rate: qbrBestQuarterRate,
        projectedSessions: projSuccess,
        projectedPlacements: projPlacements,
        multiplier: successfulPlacements > 0 ? projPlacements / successfulPlacements : null,
      });
    }
  }

  // Only show best-week scenario if it's meaningfully different (skip if best-quarter already shown)
  if (!qbrBestQuarterRate && bestWeekRate && sessionSuccessPct && bestWeekRate > sessionSuccessPct * 1.3) {
    const projSuccess = Math.round(totalSessions * (bestWeekRate / 100));
    const projPlacements = Math.round(projSuccess * cardsPerSession);
    scenarios.push({
      label: 'At your best-week rate',
      rate: bestWeekRate,
      projectedSessions: projSuccess,
      projectedPlacements: projPlacements,
      multiplier: successfulPlacements > 0 ? projPlacements / successfulPlacements : null,
    });
  }

  // Campaign tier (only if current is below it AND not redundant with best-week/best-quarter)
  const bestRate = qbrBestQuarterRate || bestWeekRate;
  const bestNearCampaign = bestRate && Math.abs(bestRate - 8) < 1.5;
  if ((!sessionSuccessPct || sessionSuccessPct < 8) && !bestNearCampaign) {
    const projSuccess = Math.round(totalSessions * 0.08);
    const projPlacements = Math.round(projSuccess * cardsPerSession);
    scenarios.push({
      label: 'At campaign-tier performance (8%)',
      rate: 8,
      projectedSessions: projSuccess,
      projectedPlacements: projPlacements,
      multiplier: successfulPlacements > 0 ? projPlacements / successfulPlacements : null,
    });
  }

  // Activation flow (only if current is below it)
  if (!sessionSuccessPct || sessionSuccessPct < 21) {
    const projSuccess = Math.round(totalSessions * 0.21);
    const projPlacements = Math.round(projSuccess * cardsPerSession);
    scenarios.push({
      label: 'At activation-flow performance (21%)',
      rate: 21,
      projectedSessions: projSuccess,
      projectedPlacements: projPlacements,
      multiplier: successfulPlacements > 0 ? projPlacements / successfulPlacements : null,
    });
  }

  return { current, scenarios };
}

/**
 * Get admin-only insights (talking points, objections, benchmark refs).
 * @returns {{ talkingPoints: [], objections: [], benchmarkRefs: [] }}
 */
function getAdminInsights(metricsCtx) {
  const talkingPoints = [];
  for (const rule of ADMIN_TALKING_POINTS) {
    try {
      if (rule.condition(metricsCtx)) {
        talkingPoints.push({
          id: rule.id,
          category: rule.category,
          html: rule.point(metricsCtx),
        });
      }
    } catch (e) {
      console.warn(`[insights] admin talking point ${rule.id} error:`, e);
    }
  }

  const objections = ADMIN_OBJECTIONS.map(o => ({
    objection: o.objection,
    response: typeof o.response === 'function' ? o.response(metricsCtx) : o.response,
  }));

  return {
    talkingPoints,
    objections,
    benchmarkRefs: ADMIN_BENCHMARK_REFS,
  };
}

/**
 * Build the motivation spectrum diagnosis paragraph.
 * @returns {{ currentTier: Object, bestTier: Object|null, html: string }}
 */
function buildSpectrumDiagnosis(metricsCtx) {
  const rate = metricsCtx.sessionSuccessPct;
  const currentTier = classifyTier(rate);
  const bestTier = metricsCtx.bestWeekRate ? classifyTier(metricsCtx.bestWeekRate) : null;

  let html = '';

  if (rate === null) {
    html = 'Insufficient data to classify your current traffic pattern.';
  } else if (rate < 3) {
    html = `You're currently in the <strong>Incidental Discovery</strong> tier — which means your cardholders are finding and trying CardUpdatr on their own, without any targeted push. That's a solid foundation of organic demand. Partners who add activation flows or campaign touchpoints to this existing base typically see a 3–7× improvement, moving from the 1–3% range into 8–12% and beyond.`;
  } else if (rate <= 8) {
    html = `Your traffic is performing between the <strong>Campaign</strong> and <strong>Discovery</strong> tiers — a promising mix that includes motivated cardholders responding to how they're encountering CardUpdatr. Building on this momentum with sustained campaign cadence or activation touchpoints is the path to consistently reaching 8–12% and above.`;
  } else if (rate <= 12) {
    html = `Strong performance — your traffic is at <strong>campaign-tier levels (Tier 2)</strong>, showing meaningful cardholder motivation. Your cardholders are responding well to how they're encountering CardUpdatr. The next tier up — activation-flow performance at 21–27% — is achieved by embedding CardUpdatr directly in card activation and reissuance moments.`;
  } else if (rate <= 21) {
    html = `You're approaching <strong>activation-flow territory</strong> — your traffic is performing above campaign-tier levels, which means a meaningful share of your cardholders are encountering CardUpdatr with strong motivation. You're in the transition zone between Campaign (Tier 2) and Activation Flow (Tier 1). Embedding CardUpdatr directly in card activation and reissuance moments is the step that bridges this gap to the 21–27% tier.`;
  } else {
    html = `Outstanding — your traffic is in the <strong>activation-flow tier (Tier 1)</strong>, the highest performance bracket across the network. Your cardholders are reaching CardUpdatr at the optimal moment with strong motivation. This is what best-in-class looks like.`;
  }

  if (bestTier && metricsCtx.bestWeekRate && metricsCtx.bestWeekRate > (rate || 0) * 1.3) {
    html += ` Your best 7-day window hit <strong>${fmt(metricsCtx.bestWeekRate)}%</strong> — <strong>${bestTier.label}</strong> territory. This proves the potential within your cardholder base when the conditions are right.`;
  }

  return { currentTier, bestTier, html };
}

/**
 * Get relevant benchmark display items for a given section.
 * @param {string[]} benchmarkKeys - keys into BENCHMARKS
 * @returns {{ key, description, value, proof }[]}
 */
function getBenchmarkDisplay(benchmarkKeys) {
  return benchmarkKeys
    .filter(k => BENCHMARKS[k])
    .map(k => {
      const b = BENCHMARKS[k];
      return {
        key: k,
        description: b.description,
        value: b.sessionSuccessRange || b.rateLabel || b.valueLabel || b.headline || '',
        proof: b.proof || b.scaleProof || '',
      };
    });
}

// ─── QBR (Quarterly Business Review) ─────────────────────────────────────────

/**
 * Build a quarter label from a start date string (e.g. "2025-01-01" → "Q1 2025")
 */
function buildQuarterLabel(startDate) {
  const d = new Date(startDate + 'T00:00:00Z');
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

/**
 * Compute quarter-over-quarter percentage change.
 * Returns null if previous is 0 or unavailable.
 */
function computeQoQChange(current, previous) {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Compute quarter-over-quarter percentage-point change (for rates).
 */
function computeQoQChangePP(current, previous) {
  if (current === null || previous === null) return null;
  return current - previous;
}

/**
 * Classify a trend direction from an array of consecutive values.
 * @param {number[]} values - values for consecutive quarters
 * @returns {'improving'|'declining'|'stable'|'mixed'}
 */
function classifyTrend(values) {
  if (!values || values.length < 2) return 'stable';
  const valid = values.filter(v => v !== null && v !== undefined);
  if (valid.length < 2) return 'stable';
  let ups = 0, downs = 0;
  for (let i = 1; i < valid.length; i++) {
    const diff = valid[i] - valid[i - 1];
    if (diff > 0.5) ups++;
    else if (diff < -0.5) downs++;
  }
  if (ups >= valid.length - 1) return 'improving';
  if (downs >= valid.length - 1) return 'declining';
  if (ups === 0 && downs === 0) return 'stable';
  return 'mixed';
}

/**
 * Count consecutive quarters in same direction from the most recent.
 * @returns {number} count of consistent quarters
 */
function consecutiveDirection(values) {
  if (!values || values.length < 2) return 0;
  let count = 1;
  for (let i = values.length - 1; i > 0; i--) {
    const diff = values[i] - values[i - 1];
    const prevDiff = i < values.length - 1 ? values[i + 1] - values[i] : diff;
    if ((diff > 0 && prevDiff > 0) || (diff < 0 && prevDiff < 0)) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ─── QBR Narrative Rules ──────────────────────────────────────────────────────
// Each rule: { id, condition(qd), narrative(qd) }
// qd = { quarters: [{quarter, metrics, startDate, endDate}...], latest, earliest, best, worst }

const QBR_NARRATIVE_RULES = [
  {
    id: 'qbr_declining_success',
    section: 'trend',
    condition: (qd) => {
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct);
      return classifyTrend(rates) === 'declining' && qd.quarters.length >= 3;
    },
    narrative: (qd) => {
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct);
      const n = consecutiveDirection(rates);
      const best = qd.best;
      return `Your conversion pattern has evolved over the past ${n} quarters — from ${fmt(qd.earliest.metrics.sessionSuccessPct)}% in ${qd.earliest.quarter} to ${fmt(qd.latest.metrics.sessionSuccessPct)}% in ${qd.latest.quarter}, reflecting changes in how cardholders are encountering CardUpdatr. The encouraging news: your strongest quarter hit <strong>${fmt(best.metrics.sessionSuccessPct)}%</strong> in ${best.quarter}, demonstrating clear cardholder demand. Re-engaging with targeted activation or campaign flows would recapture that momentum.`;
    },
  },
  {
    id: 'qbr_improving_success',
    section: 'trend',
    condition: (qd) => {
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct);
      return classifyTrend(rates) === 'improving' && qd.quarters.length >= 3;
    },
    narrative: (qd) => {
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct);
      const n = consecutiveDirection(rates);
      return `Great momentum — cardholder success has improved for ${n} consecutive quarters, from ${fmt(qd.earliest.metrics.sessionSuccessPct)}% in ${qd.earliest.quarter} to <strong>${fmt(qd.latest.metrics.sessionSuccessPct)}%</strong> in ${qd.latest.quarter}. Your cardholder engagement strategy is working. The focus now should be on scaling volume while maintaining this conversion quality — partners who do this successfully see compounding returns.`;
    },
  },
  {
    id: 'qbr_stable_success',
    section: 'trend',
    condition: (qd) => {
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct).filter(r => r !== null);
      if (rates.length < 3) return false;
      const range = Math.max(...rates) - Math.min(...rates);
      return range < 1.5;
    },
    narrative: (qd) => {
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct).filter(r => r !== null);
      const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
      return `Your conversion has been consistent at approximately <strong>${fmt(avg)}%</strong> across ${qd.quarters.length} quarters — a stable foundation. The opportunity now is to build on this base: adding activation flows or targeted campaigns to your existing organic engagement is the proven path to step-change improvement.`;
    },
  },
  {
    id: 'qbr_mixed_trend',
    section: 'trend',
    condition: (qd) => {
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct).filter(r => r !== null);
      if (rates.length < 3) return false;
      const trend = classifyTrend(rates);
      const range = Math.max(...rates) - Math.min(...rates);
      return trend === 'mixed' && range >= 1.5;
    },
    narrative: (qd) => {
      const best = qd.best;
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct).filter(r => r !== null);
      return `Cardholder success has ranged from ${fmt(Math.min(...rates))}% to ${fmt(Math.max(...rates))}% over the past year, with your strongest performance at <strong>${fmt(best.metrics.sessionSuccessPct)}%</strong> in ${best.quarter}. Establishing a more consistent campaign cadence would help sustain performance closer to that ceiling, turning your best quarters into the norm.`;
    },
  },
  {
    id: 'qbr_best_is_latest',
    section: 'highlight',
    condition: (qd) => {
      return qd.quarters.length >= 2 && qd.best === qd.latest;
    },
    narrative: (qd) => {
      return `This was your strongest quarter of the trailing year at <strong>${fmt(qd.latest.metrics.sessionSuccessPct)}%</strong> cardholder success — great progress. Identifying what drove this performance and making it repeatable is the key to sustained growth.`;
    },
  },
  {
    id: 'qbr_worst_is_latest',
    section: 'highlight',
    condition: (qd) => {
      return qd.quarters.length >= 2 && qd.worst === qd.latest && qd.best !== qd.latest;
    },
    narrative: (qd) => {
      return `Your cardholders delivered <strong>${fmt(qd.latest.metrics.sessionSuccessPct)}%</strong> this quarter — and your trailing-year best of <strong>${fmt(qd.best.metrics.sessionSuccessPct)}%</strong> in ${qd.best.quarter} shows the engagement ceiling within your cardholder base. That proven performance is achievable and repeatable — your cardholders have already demonstrated they'll engage at higher rates when the conditions are right.`;
    },
  },
  {
    id: 'qbr_volume_up_conversion_down',
    section: 'divergence',
    condition: (qd) => {
      if (qd.quarters.length < 2) return false;
      const volChange = computeQoQChange(qd.latest.metrics.totalSessions, qd.earliest.metrics.totalSessions);
      const convChange = computeQoQChangePP(qd.latest.metrics.sessionSuccessPct, qd.earliest.metrics.sessionSuccessPct);
      return volChange !== null && volChange > 10 && convChange !== null && convChange < -1;
    },
    narrative: (qd) => {
      const volChange = computeQoQChange(qd.latest.metrics.totalSessions, qd.earliest.metrics.totalSessions);
      const convChange = computeQoQChangePP(qd.latest.metrics.sessionSuccessPct, qd.earliest.metrics.sessionSuccessPct);
      return `An interesting pattern: visit volume has grown <strong>${fmt(volChange)}%</strong> over the trailing year — more cardholders are discovering CardUpdatr, which is positive. The conversion shift (${fmt(convChange)}pp) suggests the newer traffic is largely organic discovery. The opportunity: pair this growing visibility with targeted activation moments to convert more of these engaged cardholders.`;
    },
  },
  {
    id: 'qbr_volume_down_conversion_up',
    section: 'divergence',
    condition: (qd) => {
      if (qd.quarters.length < 2) return false;
      const volChange = computeQoQChange(qd.latest.metrics.totalSessions, qd.earliest.metrics.totalSessions);
      const convChange = computeQoQChangePP(qd.latest.metrics.sessionSuccessPct, qd.earliest.metrics.sessionSuccessPct);
      return volChange !== null && volChange < -10 && convChange !== null && convChange > 1;
    },
    narrative: (qd) => {
      return `Conversion has strengthened to <strong>${fmt(qd.latest.metrics.sessionSuccessPct)}%</strong> — your engaged cardholders are converting better than ever. The growth opportunity is expanding reach back to previous volume levels while maintaining this quality. Targeted campaigns can drive both volume and motivation simultaneously.`;
    },
  },
  {
    id: 'qbr_stuck_tier3',
    section: 'tier',
    condition: (qd) => {
      return qd.quarters.length >= 3 && qd.quarters.every(q => {
        const tier = classifyTier(q.metrics.sessionSuccessPct);
        return tier.tier === 3;
      });
    },
    narrative: (qd) => {
      return `You've been generating consistent organic engagement all year — cardholders are finding and trying CardUpdatr on their own, which is a solid foundation. The transformative opportunity: partners who add activation flows or campaign pushes to this existing organic base typically see a 3–7× improvement in conversion. Your cardholder demand is already proven — it's about meeting them at the right moment.`;
    },
  },
  {
    id: 'qbr_tier_improved',
    section: 'tier',
    condition: (qd) => {
      if (qd.quarters.length < 2) return false;
      const earliestTier = classifyTier(qd.earliest.metrics.sessionSuccessPct);
      const latestTier = classifyTier(qd.latest.metrics.sessionSuccessPct);
      return latestTier.tier < earliestTier.tier;
    },
    narrative: (qd) => {
      const earliestTier = classifyTier(qd.earliest.metrics.sessionSuccessPct);
      const latestTier = classifyTier(qd.latest.metrics.sessionSuccessPct);
      return `Your traffic quality has improved from <strong>${earliestTier.label}</strong> territory to <strong>${latestTier.label}</strong> over the trailing year — a meaningful shift. Your cardholder engagement efforts are driving real results.`;
    },
  },
  {
    id: 'qbr_placement_growth',
    section: 'outcome',
    condition: (qd) => {
      if (qd.quarters.length < 2) return false;
      const change = computeQoQChange(qd.latest.metrics.successfulPlacements, qd.earliest.metrics.successfulPlacements);
      return change !== null && Math.abs(change) > 15;
    },
    narrative: (qd) => {
      const change = computeQoQChange(qd.latest.metrics.successfulPlacements, qd.earliest.metrics.successfulPlacements);
      if (change > 0) {
        return `Successful placements grew <strong>${fmt(change)}%</strong> from ${qd.earliest.quarter} to ${qd.latest.quarter} — ${fmtN(qd.earliest.metrics.successfulPlacements)} to ${fmtN(qd.latest.metrics.successfulPlacements)}. Your cardholders are completing more updates, which means more value delivered to more members.`;
      }
      return `Placements shifted from ${fmtN(qd.earliest.metrics.successfulPlacements)} in ${qd.earliest.quarter} to ${fmtN(qd.latest.metrics.successfulPlacements)} in ${qd.latest.quarter}. The volume is there to recover — partners who re-engage with focused campaigns typically see a quick rebound in placement activity.`;
    },
  },
  {
    id: 'qbr_scale_without_dilution',
    section: 'outcome',
    condition: (qd) => {
      if (qd.quarters.length < 2) return false;
      const volChange = computeQoQChange(qd.latest.metrics.totalSessions, qd.earliest.metrics.totalSessions);
      const rates = qd.quarters.map(q => q.metrics.sessionSuccessPct).filter(r => r !== null);
      const range = rates.length > 0 ? Math.max(...rates) - Math.min(...rates) : 999;
      return volChange !== null && volChange > 15 && range < 1.5;
    },
    narrative: (qd) => {
      const volChange = computeQoQChange(qd.latest.metrics.totalSessions, qd.earliest.metrics.totalSessions);
      return `You scaled visit volume by <strong>${fmt(volChange)}%</strong> over the trailing year without diluting conversion quality — a textbook growth pattern. This proves that increasing reach with the right traffic profile produces proportional placement gains.`;
    },
  },
  {
    id: 'qbr_both_declining',
    section: 'divergence',
    condition: (qd) => {
      if (qd.quarters.length < 2) return false;
      const volChange = computeQoQChange(qd.latest.metrics.totalSessions, qd.earliest.metrics.totalSessions);
      const convChange = computeQoQChangePP(qd.latest.metrics.sessionSuccessPct, qd.earliest.metrics.sessionSuccessPct);
      return volChange !== null && volChange < -10 && convChange !== null && convChange < -1;
    },
    narrative: (qd) => {
      const volChange = computeQoQChange(qd.latest.metrics.totalSessions, qd.earliest.metrics.totalSessions);
      const convChange = computeQoQChangePP(qd.latest.metrics.sessionSuccessPct, qd.earliest.metrics.sessionSuccessPct);
      return `This quarter saw a pullback in both traffic (<strong>${fmt(volChange)}%</strong>) and conversion (<strong>${fmt(convChange)}pp</strong>) — which often happens when campaign cadence shifts or seasonal patterns change. The positive signal: your infrastructure is in place and your cardholders have demonstrated willingness to engage at <strong>${fmt(qd.best.metrics.sessionSuccessPct)}%</strong> in ${qd.best.quarter}. A focused campaign push next quarter would leverage that foundation and is the fastest path to reversing both trends.`;
    },
  },
  {
    id: 'qbr_tier_declined',
    section: 'tier',
    condition: (qd) => {
      if (qd.quarters.length < 2) return false;
      const earliestTier = classifyTier(qd.earliest.metrics.sessionSuccessPct);
      const latestTier = classifyTier(qd.latest.metrics.sessionSuccessPct);
      return latestTier.tier > earliestTier.tier;
    },
    narrative: (qd) => {
      const earliestTier = classifyTier(qd.earliest.metrics.sessionSuccessPct);
      const latestTier = classifyTier(qd.latest.metrics.sessionSuccessPct);
      return `Your traffic has shifted from <strong>${earliestTier.label}</strong> territory to <strong>${latestTier.label}</strong> over the trailing year — typically reflecting a change in the mix of motivated vs. organic cardholders reaching CardUpdatr. The path back is clear: partners who re-engage with targeted campaigns or activation flows consistently recover their previous tier performance. Your earlier results at ${earliestTier.label} levels prove your cardholder base supports it.`;
    },
  },
];

/**
 * Evaluate QBR narrative rules against multi-quarter data.
 * @param {Object[]} quartersData - array of {quarter, metrics, startDate, endDate} sorted chronologically
 * @returns {{ id, section, html }[]}
 */
function evaluateQBRNarratives(quartersData) {
  if (!quartersData || quartersData.length < 2) return [];

  // Build convenience context
  const quarters = quartersData;
  const latest = quarters[quarters.length - 1];
  const earliest = quarters[0];

  // Find best and worst by session success rate
  let best = quarters[0], worst = quarters[0];
  for (const q of quarters) {
    const rate = q.metrics.sessionSuccessPct;
    if (rate !== null && (best.metrics.sessionSuccessPct === null || rate > best.metrics.sessionSuccessPct)) best = q;
    if (rate !== null && (worst.metrics.sessionSuccessPct === null || rate < worst.metrics.sessionSuccessPct)) worst = q;
  }

  const qd = { quarters, latest, earliest, best, worst };

  const results = [];
  for (const rule of QBR_NARRATIVE_RULES) {
    try {
      if (rule.condition(qd)) {
        results.push({
          id: rule.id,
          section: rule.section,
          html: rule.narrative(qd),
        });
      }
    } catch (e) {
      console.warn(`[insights] QBR narrative rule ${rule.id} error:`, e);
    }
  }
  return results;
}

/**
 * Build a QBR executive summary from quarterly data and narratives.
 * @param {Object[]} quartersData
 * @param {Object[]} qbrNarratives
 * @param {Object} projections - from computeProjections()
 * @returns {string} HTML summary
 */
function buildQBRSummary(quartersData, qbrNarratives, projections) {
  if (!quartersData || quartersData.length === 0) return '';

  const latest = quartersData[quartersData.length - 1];
  const earliest = quartersData[0];
  const m = latest.metrics;
  const rates = quartersData.map(q => q.metrics.sessionSuccessPct).filter(r => r !== null);
  const trend = classifyTrend(rates);
  const tierInfo = classifyTier(m.sessionSuccessPct);

  // Find best quarter
  let best = quartersData[0];
  for (const q of quartersData) {
    if (q.metrics.sessionSuccessPct !== null &&
        (best.metrics.sessionSuccessPct === null || q.metrics.sessionSuccessPct > best.metrics.sessionSuccessPct)) {
      best = q;
    }
  }

  let html = `<div class="qbr-summary-block">`;

  // Opening — lead with achievement
  html += `<p>In <strong>${latest.quarter}</strong>, your cardholders made <strong>${fmtN(m.totalSessions)}</strong> visits to CardUpdatr, generating <strong>${fmtN(m.successfulPlacements)}</strong> successful card-on-file placements at a <strong>${fmt(m.sessionSuccessPct)}%</strong> cardholder success rate.</p>`;

  // Trailing year highlights
  html += `<p><strong>Trailing Year Highlights:</strong> `;
  if (trend === 'improving') {
    html += `Cardholder success has improved over the trailing year — a clear positive trajectory.`;
  } else if (trend === 'declining') {
    html += `Your conversion has shifted over the trailing year as traffic patterns evolved — but the foundation is strong.`;
  } else if (trend === 'stable') {
    html += `Your conversion has been consistent across the trailing year — a stable foundation to build on.`;
  } else {
    html += `Performance has varied across the trailing year, with your strongest quarter providing a clear benchmark.`;
  }
  if (best !== latest) {
    html += ` Your strongest quarter was ${best.quarter} at ${fmt(best.metrics.sessionSuccessPct)}% — demonstrating the engagement potential within your cardholder base.`;
  }
  html += `</p>`;

  // Current position
  html += `<p><strong>Where You Are Today:</strong> `;
  if (tierInfo.tier >= 2.5) {
    html += `You're in the ${tierInfo.label} tier — your cardholders are finding CardUpdatr organically, which proves demand. The next step is meeting them at higher-motivation moments.`;
  } else if (tierInfo.tier >= 1.5) {
    html += `You're performing at ${tierInfo.label} levels — strong engagement that shows your cardholder strategy is working.`;
  } else {
    html += `Outstanding performance at ${tierInfo.label} levels — the highest tier across the network.`;
  }
  html += `</p>`;

  // Growth potential
  if (projections && projections.scenarios && projections.scenarios.length > 0) {
    const campaignScenario = projections.scenarios.find(s => s.rate === 8);
    const activationScenario = projections.scenarios.find(s => s.rate === 21);
    html += `<p><strong>Growth Potential:</strong> `;
    if (campaignScenario) {
      html += `At campaign-tier performance (8%), you'd project approximately <strong>${fmtN(campaignScenario.projectedPlacements)}</strong> placements from your existing visit volume`;
      if (campaignScenario.multiplier) html += ` — a <strong>${fmt(campaignScenario.multiplier)}×</strong> increase from today`;
      html += `. `;
    }
    if (activationScenario) {
      html += `At activation-flow performance (21%), the projection reaches <strong>${fmtN(activationScenario.projectedPlacements)}</strong> placements`;
      if (activationScenario.multiplier) html += ` — <strong>${fmt(activationScenario.multiplier)}×</strong> your current output`;
      html += `. Your cardholders are ready; it's about meeting them at the right moment.`;
    }
    html += `</p>`;
  }

  html += `</div>`;
  return html;
}

// ─── YoY & Monthly Narratives ─────────────────────────────────────────────────

/**
 * Build a year-over-year narrative comparing the same quarter across years.
 * @param {string} latestQ - quarter label (e.g. "Q4 2025")
 * @param {number|null} latestRate - session success % for latest quarter
 * @param {number|null} priorRate - session success % for same quarter last year
 * @returns {string|null} HTML narrative, or null if insufficient data
 */
function buildYoYNarrative(latestQ, latestRate, priorRate) {
  if (priorRate === null || priorRate === undefined || latestRate === null || latestRate === undefined) return null;
  const change = latestRate - priorRate;

  if (change > 1) {
    return `Strong year-over-year improvement: <strong>${latestQ}</strong> (${fmt(latestRate)}%) outperformed the same quarter last year (${fmt(priorRate)}%). Your program is building momentum in the right direction.`;
  } else if (change < -1) {
    return `Year-over-year: your infrastructure and cardholder awareness are well-established. The conversion pattern (${fmt(priorRate)}% → ${fmt(latestRate)}%) reflects evolving traffic composition — a highly controllable factor through activation and campaign strategies that target motivated cardholders.`;
  } else {
    return `Year-over-year performance held steady (${fmt(priorRate)}% → ${fmt(latestRate)}%) — a consistent foundation that's ready for the next level of engagement strategy.`;
  }
}

/**
 * Build an intra-quarter monthly narrative identifying the best month.
 * @param {string} quarterLabel - e.g. "Q4 2025"
 * @param {Object|null} bestMonth - { label: 'December', sessionSuccessPct: 5.2 }
 * @returns {string|null} HTML narrative, or null if no best month
 */
function buildMonthlyNarrative(quarterLabel, bestMonth) {
  if (!bestMonth || bestMonth.sessionSuccessPct === null || bestMonth.sessionSuccessPct === undefined) return null;
  return `Within ${quarterLabel}, <strong>${bestMonth.label}</strong> was your strongest month at ${fmt(bestMonth.sessionSuccessPct)}%. Identifying what drove that engagement and sustaining it through the full quarter is a clear growth lever.`;
}

// ─── Exports (attach to window for use by funnel-customer.html) ─────────────

window.EngagementInsights = {
  TIER_BOUNDARIES,
  BENCHMARKS,
  NARRATIVE_RULES,
  ACTION_RULES,
  ADMIN_TALKING_POINTS,
  ADMIN_OBJECTIONS,
  ADMIN_BENCHMARK_REFS,
  QBR_NARRATIVE_RULES,

  // Engine
  buildMetricsContext,
  classifyTier,
  evaluateNarratives,
  evaluateActions,
  computeProjections,
  getAdminInsights,
  buildSpectrumDiagnosis,
  getBenchmarkDisplay,

  // QBR Engine
  evaluateQBRNarratives,
  buildQBRSummary,
  buildQuarterLabel,
  computeQoQChange,
  computeQoQChangePP,
  classifyTrend,
  consecutiveDirection,

  // YoY & Monthly
  buildYoYNarrative,
  buildMonthlyNarrative,

  // Helpers
  fmt,
  fmtN,
};

})();
