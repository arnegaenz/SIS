(function () {
  function sisFmt2(n) {
    if (n === null || n === undefined || Number.isNaN(+n)) return "—";
    var x = Number(n);
    return (Math.round(x * 100) / 100).toFixed(2);
  }

  function sisEnsureAttemptsCard() {
    // Find the attempts/median card container by its heading text
    // It’s the card titled "Merchant Attempts (sess w/jobs)".
    // We’ll walk cards on the page and pick the one with that heading.
    var cards = document.querySelectorAll(
      ".conversion-metric, .card, .metric-card, .summary-card, [data-card]"
    );
    var container = null;
    cards.forEach(function (el) {
      var h = el.querySelector(
        "h3, .card-title, .section-title, .tile-title, .metric-label"
      );
      var title = (h && h.textContent ? h.textContent : "").trim().toLowerCase();
      if (!container && title.includes("merchant attempts") && title.includes("sess")) {
        container = el;
      }
    });
    if (!container) return null;

    container.classList.add("sis-attempts-card"); // anchor for popover
    container.style.position = "relative"; // ensure anchored positioning

    // Ensure chip row exists (if your render already created one, we reuse it)
    var row = container.querySelector(".sis-chip-row");
    if (!row) {
      row = document.createElement("div");
      row.className = "sis-chip-row";
      container.appendChild(row);
    }

    // Ensure popover exists
    var pop = container.querySelector(".sis-popover");
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "sis-popover";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-modal", "false");
      pop.setAttribute("aria-hidden", "true");
      container.appendChild(pop);
    }

    // Ensure toggle chip exists (if your render already added it, keep it)
    var toggle = container.querySelector("#attempts-popover-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.id = "attempts-popover-toggle";
      toggle.className = "sis-chip sis-chip-action";
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML =
        '<span class="sis-chip-label">Distribution</span> <span class="sis-chip-caret" aria-hidden="true">▾</span>';
      row.appendChild(toggle);
    }

    // Attach a robust delegated listener once (must survive card DOM rebuilds).
    if (!container.__sisAttemptsPopover) container.__sisAttemptsPopover = {};
    if (!container.__sisAttemptsPopover.bound) {
      container.__sisAttemptsPopover.bound = true;

      function getEls() {
        return {
          pop: container.querySelector(".sis-popover"),
          toggle: container.querySelector("#attempts-popover-toggle"),
        };
      }

      function ensurePopoverContent(popEl) {
        if (!popEl || popEl.innerHTML.trim()) return;
        try {
          var dist = (window.sisAttemptsDistribution || []).filter(function (r) {
            return (r && r.sessions) > 0 && Number(r.jobsPerSession) > 0;
          });
          popEl.innerHTML =
            '<div class="sis-popover-card">' +
            '<div class="sis-popover-header">' +
            '<div class="sis-popover-title">Jobs per session</div>' +
            '<button class="sis-popover-close" aria-label="Close" type="button">✕</button>' +
            "</div>" +
            '<div class="sis-popover-body">' +
            '<table class="sis-table compact">' +
            "<thead><tr><th>Jobs per session</th><th class=\"t-right\">Sessions</th></tr></thead>" +
            "<tbody>" +
            dist
              .map(function (r) {
                var label = r.jobsPerSession + " job" + (r.jobsPerSession > 1 ? "s" : "");
                return (
                  "<tr><td>" +
                  label +
                  "</td><td class=\"t-right\">" +
                  (r.sessions || 0).toLocaleString() +
                  "</td></tr>"
                );
              })
              .join("") +
            "</tbody></table></div></div>";
        } catch (e) {
          console.warn("[SIS] popover content build skipped:", e);
        }
      }

      var outsideHandler = function (e) {
        if (!container.contains(e.target)) closePopover();
      };
      container.__sisAttemptsPopover.outsideHandler = outsideHandler;

      function openPopover() {
        var els = getEls();
        if (!els.pop || !els.toggle) return;
        ensurePopoverContent(els.pop);
        els.pop.setAttribute("aria-hidden", "false");
        container.classList.add("popover-open");
        els.toggle.setAttribute("aria-expanded", "true");
        var caret = els.toggle.querySelector(".sis-chip-caret");
        if (caret) caret.textContent = "▴";
        document.removeEventListener("click", outsideHandler, { capture: true });
        document.addEventListener("click", outsideHandler, { capture: true });
        console.debug("[SIS] attempts popover OPEN");
      }

      function closePopover() {
        var els = getEls();
        if (els.pop) els.pop.setAttribute("aria-hidden", "true");
        container.classList.remove("popover-open");
        if (els.toggle) {
          els.toggle.setAttribute("aria-expanded", "false");
          var caret = els.toggle.querySelector(".sis-chip-caret");
          if (caret) caret.textContent = "▾";
        }
        document.removeEventListener("click", outsideHandler, { capture: true });
        console.debug("[SIS] attempts popover CLOSE");
      }

      container.__sisAttemptsPopover.open = openPopover;
      container.__sisAttemptsPopover.close = closePopover;

      if (!container.__sisAttemptsPopover.escapeBound) {
        container.__sisAttemptsPopover.escapeBound = true;
        document.addEventListener("keydown", function (e) {
          if (!e || e.key !== "Escape") return;
          var toggleEl = container.querySelector("#attempts-popover-toggle");
          if (!toggleEl) return;
          if (toggleEl.getAttribute("aria-expanded") === "true") {
            closePopover();
          }
        });
      }

      container.addEventListener("click", function (e) {
        var target =
          e.target && e.target.closest
            ? e.target.closest("#attempts-popover-toggle, .sis-popover-close")
            : null;
        if (!target) return;

        e.stopPropagation();

        if (target.id === "attempts-popover-toggle") {
          var toggleEl = container.querySelector("#attempts-popover-toggle");
          var isOpen =
            toggleEl && toggleEl.getAttribute("aria-expanded") === "true";
          isOpen ? closePopover() : openPopover();
          return;
        }

        closePopover();
      });
    }

    return container;
  }

  function percentile(sorted, p) {
    var n = sorted.length;
    if (!n) return null;
    if (n === 1) return sorted[0];
    var idx = (p / 100) * (n - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    var w = idx - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  }

  function mean(values) {
    if (!values.length) return null;
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function getSessionJobCounts() {
    var a =
      window.SIS &&
      window.SIS.funnel &&
      Array.isArray(window.SIS.funnel.sessionJobCounts)
        ? window.SIS.funnel.sessionJobCounts
        : null;
    if (a) return a.slice();

    var b =
      window.funnelState && Array.isArray(window.funnelState.sessionJobCounts)
        ? window.funnelState.sessionJobCounts
        : null;
    if (b) return b.slice();

    return null;
  }

  function buildDistribution(jobCounts) {
    var freq = new Map();
    for (var i = 0; i < jobCounts.length; i++) {
      var k = jobCounts[i];
      if (typeof k !== "number" || !Number.isFinite(k) || k < 0) continue;
      freq.set(k, (freq.get(k) || 0) + 1);
    }
    var keys = Array.from(freq.keys()).sort(function (a, b) {
      return a - b;
    });
    var dist = [];
    for (var j = 0; j < keys.length; j++) {
      var jobsPerSession = keys[j];
      dist.push({ jobsPerSession: jobsPerSession, sessions: freq.get(jobsPerSession) || 0 });
    }
    return dist.filter(function (r) {
      return (Number(r.sessions) || 0) > 0 && Number(r.jobsPerSession) > 0;
    });
  }

  function buildStats(jobCounts) {
    var withJobs = jobCounts.filter(function (v) {
      return typeof v === "number" && Number.isFinite(v) && v >= 1;
    });
    if (!withJobs.length) return { median: null, avg: null, p75: null };

    var sorted = withJobs.slice().sort(function (a, b) {
      return a - b;
    });
    return {
      median: percentile(sorted, 50),
      avg: mean(withJobs),
      p75: percentile(sorted, 75),
    };
  }

  function initMerchantAttemptsCard() {
    var card = document.querySelector(".funnel-dist-card");
    if (!card) return;

    // If a prior instance is open, close it before rebuilding inner DOM.
    try {
      if (card.__sisAttemptsPopover && typeof card.__sisAttemptsPopover.close === "function") {
        card.__sisAttemptsPopover.close();
      }
    } catch (e) {}

    var jobCounts = getSessionJobCounts();
    if (!Array.isArray(jobCounts)) jobCounts = [];

    var stats = buildStats(jobCounts);
    var dist = buildDistribution(jobCounts);

    card.classList.add("sis-attempts-card");

    // Own the card inner UI so it doesn't stretch the grid.
    card.innerHTML = "";

    var title = document.createElement("div");
    title.className = "metric-label";
    title.textContent = "Merchant Attempts (sess w/ jobs)";
    card.appendChild(title);

    var chips = document.createElement("div");
    chips.className = "sis-chip-row";
    chips.innerHTML =
      '<button class="sis-chip" aria-disabled="true" tabindex="-1"><span class="sis-chip-label">MEDIAN</span><span class="sis-chip-value" data-metric="median"></span></button>' +
      '<button class="sis-chip" aria-disabled="true" tabindex="-1"><span class="sis-chip-label">AVG</span><span class="sis-chip-value" data-metric="avg"></span></button>' +
      '<button class="sis-chip" aria-disabled="true" tabindex="-1"><span class="sis-chip-label">P75</span><span class="sis-chip-value" data-metric="p75"></span></button>' +
      '<button class="sis-chip sis-chip-action" id="attempts-popover-toggle" aria-expanded="false">' +
      '<span class="sis-chip-label">Distribution</span>' +
      '<span class="sis-chip-caret" aria-hidden="true">▾</span>' +
      "</button>";
    card.appendChild(chips);

    var pop = document.createElement("div");
    pop.className = "sis-popover";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "false");
    pop.setAttribute("aria-hidden", "true");
    card.appendChild(pop);

    card.querySelector('[data-metric="median"]').textContent = " " + sisFmt2(stats.median);
    card.querySelector('[data-metric="avg"]').textContent = " " + sisFmt2(stats.avg);
    card.querySelector('[data-metric="p75"]').textContent = " " + sisFmt2(stats.p75);

    // Filter out zero-session rows before rendering.
    dist = dist.filter(function (r) {
      return (Number(r.sessions) || 0) > 0 && Number(r.jobsPerSession) > 0;
    });

    pop.innerHTML =
      '<div class="sis-popover-card">' +
      '<div class="sis-popover-header">' +
      '<div class="sis-popover-title">Jobs per session</div>' +
      '<button class="sis-popover-close" aria-label="Close" type="button">✕</button>' +
      "</div>" +
      '<div class="sis-popover-body">' +
      '<table class="sis-table compact">' +
      "<thead><tr><th>Jobs per session</th><th class=\"t-right\">Sessions</th></tr></thead>" +
      "<tbody>" +
      dist
        .map(function (r) {
          var label =
            String(r.jobsPerSession) + " job" + (r.jobsPerSession > 1 ? "s" : "");
          return (
            "<tr><td>" +
            label +
            "</td><td class=\"t-right\">" +
            Number(r.sessions || 0).toLocaleString() +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div></div>";

    // Make the distribution globally reachable for hotfix rendering.
    window.sisAttemptsDistribution = dist.slice();

    // HOTFIX: ensure robust wiring even if the card is rebuilt or the selector changes.
    try {
      sisEnsureAttemptsCard();
    } catch (e) {}
  }

  function hookRenders() {
    // If the funnel page rebuilds metrics on filter changes, re-init after conversion analysis renders.
    var original = window.renderConversionAnalysis;
    if (typeof original === "function" && !original.__funnelDistWrapped) {
      var wrapped = function () {
        var res = original.apply(this, arguments);
        try {
          initMerchantAttemptsCard();
        } catch (e) {}
        return res;
      };
      wrapped.__funnelDistWrapped = true;
      window.renderConversionAnalysis = wrapped;
    }
  }

  try {
    hookRenders();
  } catch (e) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      hookRenders();
      initMerchantAttemptsCard();
    });
  } else {
    initMerchantAttemptsCard();
  }
})();
