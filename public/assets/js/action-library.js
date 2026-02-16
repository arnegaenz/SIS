/**
 * action-library.js
 *
 * Single source of truth for ALL implementation resources.
 * Dashboard renders a curated preview (first 2 channels, first 2 examples per channel).
 * Future playbook page renders the FULL library.
 *
 * Loaded before engagement-insights.js — attaches to window.ACTION_LIBRARY.
 */
(function() {
'use strict';

const ACTION_LIBRARY = {
  _meta: {
    version: '1.0.0',
    lastUpdated: '2026-02-16',
    changelog: [
      { version: '1.0.0', date: '2026-02-16', summary: 'Initial release — activation, campaign, visibility, optimization, and scaling examples' }
    ]
  },

  // === TIER 3 / INCIDENTAL TRAFFIC ACTIONS ===

  tier3_activation: {
    actionIndex: 0,
    channels: [
      { channel: 'Email — Post-Activation', icon: '\u{1F4E7}', examples: [
        { headline: 'Update your card everywhere in minutes', body: 'Your new card is ready. Let us update it at all your favorite merchants so you don\'t miss a beat.', tags: ['activation', 'new-card'] },
        { headline: 'Don\'t let payments fail — update your merchants now', body: 'Your subscriptions and online accounts still have your old card number. Update them all in one place.', tags: ['activation', 'urgency'] },
        { headline: 'Your card is ready. Your subscriptions aren\'t.', body: 'Your new card won\'t work at merchants until you update it. We\'ll handle all of them in one step.', tags: ['activation', 'problem-solution'] },
      ]},
      { channel: 'SMS — Post-Activation', icon: '\u{1F4AC}', examples: [
        { headline: null, body: 'New card? Update it everywhere in 2 min \u2192 [link]', tags: ['activation', 'sms'] },
        { headline: null, body: 'Your [FI Name] card is active! Update Netflix, Amazon & more in one tap \u2192 [link]', tags: ['activation', 'sms'] },
        { headline: null, body: 'Don\'t wait for a failed payment. Update your new card at all your merchants now \u2192 [link]', tags: ['activation', 'sms', 'urgency'] },
      ]},
      { channel: 'In-App — Activation Screen', icon: '\u{1F4F1}', examples: [
        { headline: null, body: 'Card activated! One more step \u2014 update your card at the merchants you use most. It takes less than 2 minutes.', tags: ['activation', 'in-app'] },
        { headline: null, body: 'You\'re all set! Want to update your card at Netflix, Amazon, and more? We\'ll handle it.', tags: ['activation', 'in-app'] },
      ]},
      { channel: 'Lost/Stolen Replacement', icon: '\u{1F512}', examples: [
        { headline: 'We\'ve got your replacement covered', body: 'Now let\'s update it at all your merchants before your next payment fails \u2192 [link]', tags: ['lost-stolen', 'urgency'] },
        { headline: 'Card compromised? We\'ve issued your replacement.', body: 'Update it at Netflix, Amazon, and all your other merchants in one step \u2192 [link]', tags: ['lost-stolen', 'urgency'] },
      ]},
      { channel: 'IVR / Phone Activation', icon: '\u{1F4DE}', examples: [
        { headline: null, body: 'Your card is now activated. Did you know you can update your card at all your online merchants in just a few minutes? Visit [URL] or check your email for a link.', tags: ['activation', 'phone'] },
      ]},
      { channel: 'Card Carrier / Buck Slip', icon: '\u{2709}\u{FE0F}', examples: [
        { headline: 'Time for a new card?', body: 'Update it everywhere at once. Visit [URL] or scan the QR code.', tags: ['activation', 'physical'] },
        { headline: 'Your new card is here. Your merchants are waiting.', body: 'Update them all in one place at [URL].', tags: ['activation', 'physical'] },
      ]},
    ],
    playbookSection: 'activation'
  },

  tier3_campaign: {
    actionIndex: 1,
    channels: [
      { channel: 'Seasonal — Black Friday / Holiday', icon: '\u{1F381}', examples: [
        { headline: 'Get ready for Black Friday', body: 'Make sure your [FI Name] card is the one on file at your favorite stores. Update everywhere in one tap.', tags: ['seasonal', 'holiday'] },
        { headline: 'Holiday shopping starts with the right card', body: 'Make [FI Name] your default at Amazon, Target, Walmart and more \u2192 [link]', tags: ['seasonal', 'holiday'] },
      ]},
      { channel: 'Seasonal — New Year / Back to School', icon: '\u{1F4C5}', examples: [
        { headline: 'New year, new card habit', body: 'Make sure your [FI Name] card is earning rewards at every merchant you use \u2192 [link]', tags: ['seasonal', 'new-year'] },
        { headline: 'Back to school shopping?', body: 'Make sure your [FI Name] card is on file at the stores you\'ll need most this fall \u2192 [link]', tags: ['seasonal', 'back-to-school'] },
      ]},
      { channel: 'Behavioral — Dormant/Low Usage', icon: '\u{1F4B3}', examples: [
        { headline: 'Your [FI Name] card is waiting', body: 'Put it to work at Amazon, Netflix, and the merchants you already shop at \u2192 [link]', tags: ['behavioral', 'dormant'] },
        { headline: null, body: 'Did you know your [FI Name] card earns rewards at every merchant? Make it your default everywhere in one tap \u2192 [link]', tags: ['behavioral', 'rewards'] },
      ]},
      { channel: 'Rewards / Incentive Campaign', icon: '\u{1F3C6}', examples: [
        { headline: null, body: 'Update your card at 3 merchants and earn $5. It takes less than 2 minutes \u2192 [link]', tags: ['incentive', 'reward'] },
        { headline: null, body: 'Earn [X] bonus points when you make [FI Name] your default at 3 or more merchants \u2192 [link]', tags: ['incentive', 'points'] },
        { headline: null, body: 'This week only: Update your card at Amazon and get $5 deposited instantly \u2192 [link]', tags: ['incentive', 'limited-time'] },
      ]},
      { channel: 'General Awareness — Newsletter', icon: '\u{1F4F0}', examples: [
        { headline: null, body: 'Did you know? You can update your [FI Name] card at all your online merchants in one step. No more hunting through settings at each site \u2192 [link]', tags: ['awareness', 'newsletter'] },
      ]},
    ],
    playbookSection: 'campaigns'
  },

  tier3_sourcetracking: {
    actionIndex: 2,
    channels: [],
    playbookSection: null
  },

  // === LOW REACH ACTIONS ===

  low_reach_visibility: {
    actionIndex: 0,
    channels: [
      { channel: 'Digital Banking Menu Placement', icon: '\u{1F5A5}\u{FE0F}', examples: [
        { headline: 'Menu label', body: 'Update Card at Merchants', tags: ['digital-banking', 'menu'] },
        { headline: 'Menu description', body: 'Keep your card on file everywhere \u2014 update all your merchants in one place.', tags: ['digital-banking', 'menu'] },
      ]},
      { channel: 'Card Controls — Lock/Unlock', icon: '\u{1F510}', examples: [
        { headline: 'When locking a card', body: 'Locking this card? Update your merchants with a different [FI Name] card so your payments don\'t stop \u2192 [link]', tags: ['card-controls', 'lock'] },
        { headline: 'When unlocking a card', body: 'Card unlocked! Want to make sure all your merchants have your current card info? \u2192 [link]', tags: ['card-controls', 'unlock'] },
      ]},
      { channel: 'Travel Notice', icon: '\u{2708}\u{FE0F}', examples: [
        { headline: null, body: 'Heading out of town? Make sure your bills and subscriptions keep getting paid with your [FI Name] card while you\'re away \u2192 [link]', tags: ['card-controls', 'travel'] },
      ]},
      { channel: 'Card Details Screen', icon: '\u{1F4B3}', examples: [
        { headline: null, body: 'Put this card to work \u2014 update it at all your favorite merchants in one step \u2192 [link]', tags: ['card-controls', 'details'] },
      ]},
    ],
    playbookSection: 'visibility'
  },

  low_reach_activation_comms: {
    actionIndex: 1,
    sharedWith: 'tier3_activation',
    channels: [],
    playbookSection: 'activation'
  },

  // === LOW CREDENTIAL ENTRY ACTIONS ===

  low_cred_value_prop: {
    actionIndex: 0,
    channels: [
      { channel: 'Value Proposition Copy — Point of Encounter', icon: '\u{270D}\u{FE0F}', examples: [
        { headline: 'Problem \u2192 Solution framing', body: 'Tired of updating your card at every site when you get a new one? Update all your merchants in one step.', tags: ['value-prop', 'problem-solution'] },
        { headline: 'Speed framing', body: 'Update your card at Netflix, Amazon, Spotify, and more in less than 2 minutes.', tags: ['value-prop', 'speed'] },
        { headline: 'Prevention framing', body: 'Don\'t wait for a failed payment to find out your card is outdated. Update all your merchants now.', tags: ['value-prop', 'prevention'] },
      ]},
    ],
    playbookSection: 'optimization'
  },

  low_cred_merchant_list: {
    actionIndex: 1,
    channels: [
      { channel: 'Merchant Curation Strategy', icon: '\u{1F4CB}', examples: [
        { headline: 'Lead with recognizable merchants', body: 'Show the most popular merchants first \u2014 Amazon, Netflix, Spotify, Hulu, DoorDash, Uber. Familiar logos create immediate recognition of value.', tags: ['merchant-curation', 'strategy'] },
        { headline: 'Category-based presentation', body: 'Organize by category: Streaming (Netflix, Hulu, Disney+), Shopping (Amazon, Target, Walmart), Food Delivery (DoorDash, Uber Eats). Helps cardholders see the breadth of where their card is used.', tags: ['merchant-curation', 'strategy'] },
      ]},
    ],
    playbookSection: 'optimization'
  },

  // === LOW COMPLETION — Strivve-operational, no partner copy ===

  // === GOOD PERFORMANCE ACTIONS ===

  good_performance_scale: {
    actionIndex: 0,
    channels: [
      { channel: 'Scaling Strategy', icon: '\u{1F4C8}', examples: [
        { headline: 'Expand to additional card products', body: 'If CardUpdatr is performing well on debit, extend it to credit card activation flows. Same infrastructure, new volume.', tags: ['scaling', 'strategy'] },
        { headline: 'Increase campaign frequency', body: 'If monthly campaigns deliver 8\u201312% success, try bi-weekly. Same audience, more touchpoints, compounding results.', tags: ['scaling', 'strategy'] },
      ]},
    ],
    playbookSection: 'scaling'
  },

  good_performance_layer: {
    actionIndex: 1,
    channels: [
      { channel: 'Channel Layering Strategy', icon: '\u{1F4CA}', examples: [
        { headline: 'Add SMS to complement email', body: 'If your email campaigns are working, add an SMS follow-up 24 hours later for non-openers. SMS typically has higher open rates and creates a second chance to convert.', tags: ['channel-layering', 'strategy'] },
        { headline: 'Add in-app messaging', body: 'Trigger a CardUpdatr prompt when cardholders view their card details or make a payment. Catches them in a card-management mindset.', tags: ['channel-layering', 'strategy'] },
      ]},
    ],
    playbookSection: 'scaling'
  },

  // === BEST WEEK GAP ACTION ===

  best_week_replicate: {
    actionIndex: 0,
    channels: [
      { channel: 'Investigation Checklist', icon: '\u{1F50D}', examples: [
        { headline: 'What to look for in your best-performing week', body: 'Check: Was there a campaign that week? A card reissuance batch? A new feature launch? A newsletter mention? Identifying the trigger helps you replicate it.', tags: ['investigation', 'best-week'] },
        { headline: 'Replication strategy', body: 'Once you identify the trigger, schedule it as a recurring activity. If a newsletter mention drove your best week, make CardUpdatr a permanent newsletter feature.', tags: ['replication', 'best-week'] },
      ]},
    ],
    playbookSection: 'optimization'
  },

  // === MEMBER SERVICES / CALL CENTER ===

  member_services: {
    channels: [
      { channel: 'Rep Script — Card Reissuance', icon: '\u{1F3A7}', examples: [
        { headline: null, body: 'I\'ve ordered your replacement card. While we wait for it to arrive, I wanted to let you know about a free service we offer \u2014 when your new card arrives, you can update it at all your online merchants like Netflix, Amazon, and more in one step instead of going to each site individually. I\'ll include a link in your confirmation email.', tags: ['call-center', 'reissuance'] },
      ]},
      { channel: 'Rep Script — General Inquiry', icon: '\u{1F3A7}', examples: [
        { headline: null, body: 'Before we go, have you heard about our card updater? If you ever get a new card, it lets you update all your online merchants at once instead of doing it one by one. Would you like me to send you the link?', tags: ['call-center', 'general'] },
      ]},
      { channel: 'Rep Script — Fraud/Stolen Card', icon: '\u{1F3A7}', examples: [
        { headline: null, body: 'I\'m sorry about the fraud on your account. The good news is we\'ve got a new card on the way. When it arrives, we have a tool that can update it at all your online merchants in one step \u2014 Netflix, Amazon, your utilities, everything. It\'ll save you a lot of time compared to updating each one individually.', tags: ['call-center', 'fraud'] },
      ]},
    ],
    playbookSection: 'member-services'
  }
};

// Map from ACTION_RULES rule IDs to ACTION_LIBRARY keys (by action index position)
const ACTION_LIBRARY_MAP = {
  tier3_incidental: ['tier3_activation', 'tier3_campaign', 'tier3_sourcetracking'],
  low_reach: ['low_reach_visibility', 'low_reach_activation_comms'],
  low_cred_entry: ['low_cred_value_prop', 'low_cred_merchant_list'],
  low_completion: [],
  good_performance: ['good_performance_scale', 'good_performance_layer', null],
  best_week_gap: ['best_week_replicate'],
};

/**
 * Look up the ACTION_LIBRARY entry for a given ruleId and actionIndex.
 * Resolves sharedWith references.
 * @returns {Object|null} The resolved library entry, or null
 */
function getLibraryEntry(ruleId, actionIndex) {
  const keys = ACTION_LIBRARY_MAP[ruleId];
  if (!keys) return null;
  const key = keys[actionIndex];
  if (!key || !ACTION_LIBRARY[key]) return null;
  const entry = ACTION_LIBRARY[key];
  if (entry.sharedWith && ACTION_LIBRARY[entry.sharedWith]) {
    return { ...ACTION_LIBRARY[entry.sharedWith], _sharedFrom: entry.sharedWith, _originalKey: key };
  }
  return entry;
}

/**
 * Get library stats (channel count, example count) for a library entry.
 */
function getLibraryStats(entry) {
  if (!entry || !entry.channels || !entry.channels.length) return null;
  const totalChannels = entry.channels.length;
  const totalExamples = entry.channels.reduce((sum, ch) => sum + ch.examples.length, 0);
  return { totalChannels, totalExamples };
}

window.ActionLibrary = {
  ACTION_LIBRARY,
  ACTION_LIBRARY_MAP,
  getLibraryEntry,
  getLibraryStats,
};

})();
