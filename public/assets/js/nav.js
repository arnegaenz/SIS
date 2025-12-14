(function () {
  var NAV_RENDER_ATTR = "data-nav-rendered";
  var NAV_ABORT_KEY = "__sisNavAbortController";

  function safeLower(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getNavMode() {
    var fromBody = safeLower(document.body && document.body.dataset && document.body.dataset.navMode);
    if (fromBody === "full" || fromBody === "restricted") return fromBody;

    var fromWindow = safeLower(window.SIS_NAV_MODE);
    if (fromWindow === "full" || fromWindow === "restricted") return fromWindow;

    return "full";
  }

  function currentFilename() {
    var p = String(window.location && window.location.pathname ? window.location.pathname : "");
    var parts = p.split("/").filter(Boolean);
    var last = (parts.length ? parts[parts.length - 1] : "") || "index.html";
    if (!/\./.test(last)) last = "index.html";
    return last.toLowerCase();
  }

  function filenameFromHref(href) {
    var clean = String(href || "").split("#")[0].split("?")[0];
    var parts = clean.split("/").filter(Boolean);
    var last = (parts.length ? parts[parts.length - 1] : "") || "index.html";
    if (!/\./.test(last)) last = "index.html";
    return last.toLowerCase();
  }

  function navModel() {
    return {
      overview: { title: "Overview", href: "index.html", public: true },
      groups: [
        {
          label: "Conversions",
          public: true,
          items: [{ title: "FI Funnel", href: "funnel.html", public: true }],
        },
        {
          label: "Sources",
          public: true,
          items: [{ title: "Sources", href: "sources.html", public: true }],
        },
        {
          label: "Merchant Health",
          public: true,
          items: [
            { title: "Merchant Heatmap", href: "heatmap.html", public: true },
            { title: "Alerts", href: "watchlist.html", public: true },
          ],
        },
        {
          label: "Operations",
          public: false,
          items: [
            { title: "Troubleshooting", href: "troubleshoot.html", public: false },
            { title: "Maintenance", href: "maintenance.html", public: false },
          ],
        },
        {
          label: "Data & Admin",
          public: false,
          items: [
            { title: "FI API Data", href: "fi-api.html", public: false },
            { title: "Server Logs", href: "logs.html", public: false },
          ],
        },
      ],
    };
  }

  function createEl(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function placeNavMenu(triggerEl, menuEl) {
    if (!triggerEl || !menuEl) return;
    var prevDisplay = menuEl.style.display;
    var needsDisplay =
      window.getComputedStyle && window.getComputedStyle(menuEl).display === "none";
    if (needsDisplay) menuEl.style.display = "block";

    var trigRect = triggerEl.getBoundingClientRect();
    var menuRect = menuEl.getBoundingClientRect();
    var vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;

    if (trigRect.left + menuRect.width > vw - 16) menuEl.classList.add("align-right");
    else menuEl.classList.remove("align-right");

    menuEl.style.display = prevDisplay || "";
  }

  function closeAllNavMenus(navEl) {
    if (!navEl) return;
    navEl.querySelectorAll(".sis-nav-group.is-open").forEach(function (g) {
      g.classList.remove("is-open");
      var trig = g.querySelector(".sis-nav-trigger");
      if (trig) trig.setAttribute("aria-expanded", "false");
      var menu = g.querySelector(".sis-nav-menu");
      if (menu) menu.setAttribute("hidden", "");
    });
  }

  function applyActive(link, isActive) {
    if (!link) return;
    if (isActive) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    } else {
      link.classList.remove("active");
      link.removeAttribute("aria-current");
    }
  }

  function renderInto(navEl, abortSignal) {
    var mode = getNavMode();
    var model = navModel();
    var current = currentFilename();

    // Idempotent: fully own the placeholder.
    navEl.innerHTML = "";
    navEl.setAttribute(NAV_RENDER_ATTR, "true");

    var root = createEl("div", "sis-nav-root");

    var overview = document.createElement("a");
    overview.className = "sis-nav-link";
    overview.href = model.overview.href;
    overview.textContent = model.overview.title;
    applyActive(overview, filenameFromHref(model.overview.href) === current);
    root.appendChild(overview);

    var visibleGroups = model.groups.filter(function (g) {
      return mode === "full" ? true : Boolean(g.public);
    });

    visibleGroups.forEach(function (group) {
      var groupWrap = createEl("div", "sis-nav-group");
      groupWrap.dataset.group = group.label;

      var trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "sis-nav-trigger";
      trigger.setAttribute("aria-haspopup", "true");
      trigger.setAttribute("aria-expanded", "false");
      trigger.textContent = group.label;
      groupWrap.appendChild(trigger);

      var menu = createEl("div", "sis-nav-menu");
      menu.setAttribute("hidden", "");
      menu.setAttribute("role", "menu");

      group.items.forEach(function (item) {
        if (mode !== "full" && item.public === false) return;

        var a = document.createElement("a");
        a.href = item.href;
        a.textContent = item.title;
        a.className = "sis-nav-item";
        a.setAttribute("role", "menuitem");
        applyActive(a, filenameFromHref(item.href) === current);
        menu.appendChild(a);
      });

      groupWrap.appendChild(menu);
      root.appendChild(groupWrap);
    });

    navEl.appendChild(root);

    // Trigger click: toggle only its own group; close others; compute edge-flip.
    navEl.querySelectorAll(".sis-nav-trigger").forEach(function (trig) {
      var group = trig.closest(".sis-nav-group");
      var menu = group ? group.querySelector(".sis-nav-menu") : null;
      if (!group || !menu) return;

      trig.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          var willOpen = !group.classList.contains("is-open");

          navEl.querySelectorAll(".sis-nav-group.is-open").forEach(function (g) {
            if (g !== group) {
              g.classList.remove("is-open");
              var t = g.querySelector(".sis-nav-trigger");
              if (t) t.setAttribute("aria-expanded", "false");
              var m = g.querySelector(".sis-nav-menu");
              if (m) m.setAttribute("hidden", "");
            }
          });

          if (willOpen) {
            group.classList.add("is-open");
            trig.setAttribute("aria-expanded", "true");
            menu.removeAttribute("hidden");
            requestAnimationFrame(function () {
              placeNavMenu(trig, menu);
            });
          } else {
            group.classList.remove("is-open");
            trig.setAttribute("aria-expanded", "false");
            menu.setAttribute("hidden", "");
          }
        },
        { signal: abortSignal }
      );
    });

    // Close only nav menus when clicking outside the nav.
    document.addEventListener(
      "click",
      function (e) {
        if (e.target && e.target.closest && e.target.closest(".sis-nav")) return;
        closeAllNavMenus(navEl);
      },
      { capture: false, signal: abortSignal }
    );

    // Clicking a menu item closes nav menus (nav-only).
    navEl.querySelectorAll(".sis-nav-menu a").forEach(function (a) {
      a.addEventListener(
        "click",
        function () {
          closeAllNavMenus(navEl);
        },
        { signal: abortSignal }
      );
    });

    // Escape closes only nav menus.
    document.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "Escape") closeAllNavMenus(navEl);
      },
      { signal: abortSignal }
    );

    // Resize/orientation change closes only nav menus.
    window.addEventListener(
      "resize",
      function () {
        closeAllNavMenus(navEl);
      },
      { signal: abortSignal }
    );
    window.addEventListener(
      "orientationchange",
      function () {
        closeAllNavMenus(navEl);
      },
      { signal: abortSignal }
    );
  }

  function init() {
    var placeholders = document.querySelectorAll("nav.sis-nav[data-current]");
    if (!placeholders || !placeholders.length) return;

    if (placeholders.length > 1) {
      try {
        console.warn(
          "[nav.js] Multiple nav placeholders found; rendering into the first only:",
          placeholders.length
        );
      } catch (e) {}
    }

    var navEl = placeholders[0];
    // Ensure only one nav renders (clear any others).
    for (var i = 1; i < placeholders.length; i++) {
      placeholders[i].innerHTML = "";
    }

    // Idempotence: abort any prior listeners bound by nav.js, then rebuild.
    try {
      if (navEl[NAV_ABORT_KEY] && typeof navEl[NAV_ABORT_KEY].abort === "function") {
        navEl[NAV_ABORT_KEY].abort();
      }
    } catch (e) {}
    var controller = new AbortController();
    navEl[NAV_ABORT_KEY] = controller;

    renderInto(navEl, controller.signal);
  }

  try {
    init();
  } catch (e) {}
})();
