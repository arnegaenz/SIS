(function (global) {
  // Intercept history methods IMMEDIATELY (before other scripts cache references)
  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;
  var pendingUrlChanges = [];

  history.pushState = function() {
    originalPushState.apply(this, arguments);
    if (global.__sisLogPageview) {
      global.__sisLogPageview();
    } else {
      pendingUrlChanges.push(window.location.href);
    }
  };

  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    if (global.__sisLogPageview) {
      global.__sisLogPageview();
    } else {
      pendingUrlChanges.push(window.location.href);
    }
  };

  // Skip auth entirely on localhost for development
  function isLocalhost() {
    try {
      var host = window.location.hostname;
      return host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.");
    } catch (e) {}
    return false;
  }

  // Session-based auth storage keys
  var TOKEN_KEY = "sis_session_token";
  var USER_KEY = "sis_user";

  // Impersonation key (per-tab, sessionStorage)
  var IMPERSONATE_KEY = "sis_impersonate_user";

  // Legacy passcode keys (kept for backward compatibility during transition)
  var LEGACY_STORAGE_KEY = "sis_passcode_ok";
  var LEGACY_ACCESS_KEY = "sis_access_level";

  // ── Page Access Matrix ────────────────────────────────────────────
  // Maps page filename → array of roles that can access it.
  // admin can access everything (handled separately), so only listed where
  // it's the ONLY role or for completeness in admin-only pages.
  var PAGE_ACCESS_MAP = {
    // Partner Analytics
    "portfolio.html":          ["admin","core","internal","cs"],
    "funnel-customer.html":    ["admin","core","internal","cs","partner","fi"],
    "supported-sites.html":    ["admin","core","internal","siteops","support","cs","executive","partner","fi"],
    "campaign-builder.html":   ["admin","core","cs","partner","fi"],
    "executive.html":          ["admin","core","internal","executive"],
    // Monitoring
    "success.html":            ["admin","core","internal","siteops","cs"],
    "operations.html":         ["admin","core","internal","siteops","cs"],
    "monitor.html":            ["admin","core","internal","siteops","cs"],
    "heatmap.html":            ["admin","core","siteops","cs"],
    "watchlist.html":          ["admin","core","internal","siteops","cs"],
    "realtime.html":           ["admin","core","siteops","support","cs"],
    "troubleshoot.html":       ["admin","core","internal","siteops","support","cs"],
    "troubleshoot-customer.html": ["admin","core","support","cs"],
    // Analysis
    "funnel.html":             ["admin","core","internal","siteops","cs"],
    "customer-success.html":   ["admin","core","cs"],
    "sources.html":            ["admin","core"],
    "ux-paths.html":           ["admin","core"],
    "experience.html":         ["admin","core","internal","cs"],
    "placement-outcomes.html": ["admin","core"],
    "fi-api.html":             ["admin","core","support","cs"],
    // Resources (accessible by all via direct URL)
    "engagement-playbook.html": ["admin","core","internal","siteops","support","cs","executive","partner","fi"],
    // Admin
    "users.html":              ["admin"],
    "maintenance.html":        ["admin"],
    "activity-log.html":       ["admin"],
    "shared-views.html":       ["admin"],
    "logs.html":               ["admin"],
    "synthetic-traffic.html":  ["admin"]
  };

  // ── Landing Pages ────────────────────────────────────────────────
  var LANDING_PAGES = {
    "admin":     "dashboards/portfolio.html",
    "core":      "dashboards/portfolio.html",
    "internal":  "dashboards/portfolio.html",
    "siteops":   "dashboards/success.html",
    "support":   "troubleshoot-customer.html",
    "cs":        "dashboards/portfolio.html",
    "executive": "dashboards/executive.html",
    "partner":   "funnel-customer.html",
    "fi":        "funnel-customer.html"
  };

  function getPageName() {
    try {
      var path = window.location.pathname || "";
      var parts = path.split("/");
      return parts[parts.length - 1] || "index.html";
    } catch (e) {}
    return "index.html";
  }

  function isLoginPage() {
    return getPageName().toLowerCase() === "login.html";
  }

  function normalizeRole(level) {
    if (level === "full") return "admin";
    if (level === "limited") return "fi";
    return level;
  }

  function getImpersonatedUser() {
    try {
      var json = sessionStorage.getItem(IMPERSONATE_KEY);
      if (json) return JSON.parse(json);
    } catch (e) {}
    return null;
  }

  function isImpersonating() {
    return !!getImpersonatedUser();
  }

  function getStoredUser() {
    try {
      var userJson = localStorage.getItem(USER_KEY);
      if (userJson) return JSON.parse(userJson);
    } catch (e) {}
    return null;
  }

  function getEffectiveUser() {
    var imp = getImpersonatedUser();
    if (imp) return imp;
    return getStoredUser();
  }

  function getSessionToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (e) {}
    return null;
  }

  function getRealAccessLevel() {
    var user = getStoredUser();
    if (user && user.access_level) {
      return normalizeRole(user.access_level);
    }
    try {
      var level = sessionStorage.getItem(LEGACY_ACCESS_KEY);
      if (level) return normalizeRole(level);
      if (sessionStorage.getItem(LEGACY_STORAGE_KEY) === "1") return "admin";
    } catch (e) {}
    return "";
  }

  // All valid role names for view-as override
  var ALL_ROLES = ["admin","core","internal","siteops","support","cs","executive","partner","fi"];

  function getAccessLevel() {
    // Impersonation overrides everything
    var imp = getImpersonatedUser();
    if (imp && imp.access_level) return normalizeRole(imp.access_level);

    var real = getRealAccessLevel();
    // Admin users can preview other access levels via "View as" switcher
    if (real === "admin") {
      try {
        var override = sessionStorage.getItem("sis_view_as");
        if (override && ALL_ROLES.indexOf(override) !== -1) return override;
      } catch (e) {}
    }
    return real;
  }

  function isAuthenticated() {
    var token = getSessionToken();
    var user = getStoredUser();
    if (token && user) return true;

    // Legacy fallback
    try {
      if (sessionStorage.getItem(LEGACY_STORAGE_KEY) === "1") return true;
    } catch (e) {}
    return false;
  }

  function clearAuth() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(LEGACY_STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_ACCESS_KEY);
    } catch (e) {}
  }

  function redirectToLogin() {
    // Save current page so login can redirect back after auth
    try {
      var currentPath = window.location.pathname + window.location.search + window.location.hash;
      sessionStorage.setItem("sis_login_redirect", currentPath);
    } catch (e) {}
    // Compute relative path to login based on current location
    var path = window.location.pathname || "";
    var prefix = path.indexOf("/dashboards/") !== -1 ? "../" : "./";
    window.location.href = prefix + "login.html";
  }

  function isViewAsActive() {
    try { return !!(sessionStorage.getItem("sis_view_as")) || isImpersonating(); } catch (e) { return false; }
  }

  function checkPageAccess() {
    var level = getAccessLevel();
    var page = getPageName().toLowerCase();
    var pathname = window.location.pathname || "";
    var prefix = (pathname.indexOf("/dashboards/") !== -1 || pathname.indexOf("/resources/") !== -1) ? "../" : "./";

    // admin can access everything
    if (level === "admin") {
      return true;
    }

    // When "View as" is active, skip page redirects — admin is previewing UI only
    if (isViewAsActive()) {
      return true;
    }

    // index.html is always allowed (it handles its own redirect)
    if (page === "index.html" || page === "" || page === "/") {
      return true;
    }

    // Look up page in access map
    var allowedRoles = PAGE_ACCESS_MAP[page];
    if (allowedRoles) {
      for (var i = 0; i < allowedRoles.length; i++) {
        if (allowedRoles[i] === level) return true;
      }
    }

    // Page not in map or role not allowed — redirect to landing page
    var landing = LANDING_PAGES[level] || "funnel-customer.html";
    window.location.href = prefix + landing;
    return false;
  }

  function validateSessionAsync() {
    var API_BASE = global.SIS_API_BASE || "";
    var token = getSessionToken();

    if (!token) return;

    fetch(API_BASE + "/auth/me", {
      headers: { "Authorization": "Bearer " + token }
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.ok) {
          // Session invalid - redirect to login
          clearAuth();
          redirectToLogin();
        } else {
          // Update stored user in case it changed
          try {
            localStorage.setItem(USER_KEY, JSON.stringify(data.user));
          } catch (e) {}
        }
      })
      .catch(function(e) {
        // Network error - allow offline access with cached session
        console.warn("[auth] Could not validate session:", e);
      });
  }

  var lastLoggedUrl = "";

  function logPageview() {
    try {
      var token = getSessionToken();
      if (!token) return;

      var page = getPageName();
      var qs = window.location.search || "";
      var fullPage = page + qs;

      // Deduplicate consecutive identical pageviews
      if (fullPage === lastLoggedUrl) return;
      lastLoggedUrl = fullPage;

      var API_BASE = global.SIS_API_BASE || "";
      fetch(API_BASE + "/analytics/log", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ page: fullPage })
      }).catch(function() {});
    } catch (e) {}
  }

  // Check if page is in read-only view mode (shared link)
  function isViewMode() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      return params.get("view") === "1";
    } catch (e) {}
    return false;
  }

  function init() {
    // Don't run on login page
    if (isLoginPage()) return;

    // Skip auth in view mode (shared read-only link)
    if (isViewMode()) {
      console.log("[auth] View mode detected - skipping auth");
      global.__sisViewMode = true;
      return;
    }

    // Skip auth on localhost for development
    if (isLocalhost()) {
      console.log("[auth] Localhost detected - skipping auth");
      return;
    }

    // Check URL for logout
    try {
      var params = new URLSearchParams(window.location.search || "");
      if (params.get("logout") === "1" || params.get("sis-reset") === "1") {
        params.delete("logout");
        params.delete("sis-reset");
        try {
          var nextUrl = window.location.pathname;
          var qs = params.toString();
          if (qs) nextUrl += "?" + qs;
          window.history.replaceState({}, "", nextUrl);
        } catch (e) {}
        clearAuth();
        redirectToLogin();
        return;
      }
    } catch (e) {}

    // Check if authenticated
    if (!isAuthenticated()) {
      redirectToLogin();
      return;
    }

    // Check page access based on level
    if (!checkPageAccess()) return;

    // Validate session with server (async, non-blocking)
    validateSessionAsync();

    // Log pageview (fire-and-forget)
    logPageview();

    // Expose logPageview globally for the history interceptors
    global.__sisLogPageview = logPageview;

    // Process any URL changes that happened before init
    if (pendingUrlChanges.length > 0) {
      pendingUrlChanges = [];
      logPageview();
    }

    // Listen for back/forward navigation
    window.addEventListener("popstate", function() {
      logPageview();
    });
  }

  // Expose auth API for other scripts
  global.sisAuth = {
    getUser: getEffectiveUser,
    getRealUser: getStoredUser,
    getToken: getSessionToken,
    getAccessLevel: getAccessLevel,
    getRealAccessLevel: getRealAccessLevel,
    isAuthenticated: isAuthenticated,
    isImpersonating: isImpersonating,
    setImpersonation: function(profile) {
      try { sessionStorage.setItem(IMPERSONATE_KEY, JSON.stringify(profile)); } catch (e) {}
    },
    clearImpersonation: function() {
      try { sessionStorage.removeItem(IMPERSONATE_KEY); } catch (e) {}
    },
    logout: function() {
      clearAuth();
      redirectToLogin();
    },
    LANDING_PAGES: LANDING_PAGES,
    normalizeRole: normalizeRole
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : null);
