(function () {
  function normalizeTitle(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function makeEntry(match, tooltip) {
    return { match, tooltip };
  }

  var entries = [
    makeEntry("Card Placement Funnel", "CardSavr Sessions + Placements APIs with GA events; SIS daily rollups."),
    makeEntry("Source Analysis", "CardSavr Sessions + Placements APIs with GA source attribution; SIS daily rollups."),
    makeEntry("Sources rollup", "CardSavr Sessions + Placements APIs with GA source attribution; SIS daily rollups."),
    makeEntry("Merchant Reach & Reliability", "CardSavr Placements + Sessions APIs plus Merchant Sites catalog (tiers/tags)."),
    makeEntry("Reliability & Anomaly Watch", "CardSavr Placements + Sessions APIs aggregated into daily rollups; Merchant Sites catalog."),
    makeEntry("Troubleshooting", "CardSavr Sessions + Placements APIs with GA events; per-day drilldown."),
    makeEntry("Issuer Ops & Data Health", "CardSavr Sessions + Placements APIs, Merchant Sites catalog, FI registry + credentials."),
    makeEntry("FI API Data", "CardSavr Financial Institutions API across all configured instances."),
    makeEntry("Financial Institution Records", "CardSavr Financial Institutions API across all configured instances."),
    makeEntry("Server Logs", "SIS server logs (no CardSavr API)."),
    makeEntry("Console Output", "SIS server logs (no CardSavr API)."),
    makeEntry("Admin Access", "SIS admin key gate (no CardSavr API)."),
    makeEntry("Theme Settings", "SIS UI theme controls (no CardSavr API)."),
    makeEntry("Data Refresh", "CardSavr Sessions + Placements APIs and GA events; refresh raw + daily rollups."),
    makeEntry("Merchant Sites", "CardSavr Merchant Sites API for tiers, tags, and status."),
    makeEntry("FI Registry Editor", "SIS FI registry stored locally; optional CardSavr FI API cross-checks."),
    makeEntry("Instance Credentials", "SIS instance credentials for CardSavr API access."),
    makeEntry("Global KPI Thresholds", "SIS KPI thresholds (no CardSavr API)."),
    makeEntry("Google Analytics Credentials", "Google Analytics service accounts (not CardSavr)."),
    makeEntry("Placement Outcomes Report", "CardSavr Placements + Sessions APIs with GA events; per-day outcomes."),
    makeEntry("Success Overview", "CardSavr Sessions + Placements APIs with GA events; session path analysis."),
    makeEntry("Successful Path Patterns", "CardSavr Sessions + Placements APIs with GA events; session path analysis."),
    makeEntry("High Performer Sessions (3+ Successful Jobs)", "CardSavr Sessions + Placements APIs with GA events; session path analysis."),
    makeEntry("Time Spent by Page (Successful Sessions Only)", "CardSavr Sessions + Placements APIs with GA events; session path analysis."),
    makeEntry("Retry Patterns (Successful Sessions)", "CardSavr Sessions + Placements APIs with GA events; session path analysis."),
    makeEntry("Synthetic Traffic Setup", "SIS synthetic runner jobs (no CardSavr API)."),
    makeEntry("Job Status", "SIS synthetic runner jobs (no CardSavr API)."),
    makeEntry("Funnel Rates", "SIS synthetic runner output (no CardSavr API)."),
    makeEntry("Daily Merchant Footprint", "CardSavr Placements + Sessions APIs; Merchant Sites catalog."),
    makeEntry("Merchant Health Snapshot", "CardSavr Placements + Sessions APIs; Merchant Sites catalog.")
  ];

  var patternEntries = [
    makeEntry(/watch|anomaly|reliability|drops|spikes|ux|data gaps/i, "CardSavr Placements + Sessions APIs; Merchant Sites catalog; SIS daily rollups."),
    makeEntry(/^FI:\s*/i, "CardSavr Placements + Sessions APIs aggregated at FI level; SIS daily rollups.")
  ];

  function resolveTooltip(title) {
    var normalized = normalizeTitle(title);
    if (!normalized) return "";
    var lower = normalized.toLowerCase();
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (typeof entry.match === "string" && entry.match.toLowerCase() === lower) {
        return entry.tooltip;
      }
    }
    for (var j = 0; j < patternEntries.length; j++) {
      var pat = patternEntries[j];
      if (pat.match instanceof RegExp && pat.match.test(normalized)) {
        return pat.tooltip;
      }
    }
    return "";
  }

  function applyTooltips(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll("h1, h2, h3, .sis-panel-title, .section-title");
    nodes.forEach(function (el) {
      if (el.dataset.cardTooltipApplied === "1") return;
      var titleText = el.dataset.cardTitle || el.textContent;
      var tooltip = resolveTooltip(titleText);
      if (!tooltip) return;
      el.setAttribute("title", tooltip);
      el.dataset.cardTooltipApplied = "1";
    });
  }

  function init() {
    applyTooltips(document);
    if (typeof MutationObserver === "undefined") return;
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          applyTooltips(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
