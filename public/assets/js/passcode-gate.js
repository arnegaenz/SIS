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

  // Legacy passcode keys (kept for backward compatibility during transition)
  var LEGACY_STORAGE_KEY = "sis_passcode_ok";
  var LEGACY_ACCESS_KEY = "sis_access_level";

  // Page access restrictions
  var LIMITED_PAGES = ["funnel.html", "funnel-customer.html"];
  var ADMIN_ONLY_PAGES = ["users.html", "synthetic-traffic.html", "maintenance.html", "activity-log.html", "shared-views.html", "logs.html"]; // Pages only admin can access (not internal)

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

  function isLimitedAllowedPage() {
    var page = getPageName().toLowerCase();
    if (page === "" || page === "/") page = "index.html";
    for (var i = 0; i < LIMITED_PAGES.length; i++) {
      if (page === LIMITED_PAGES[i]) return true;
    }
    return false;
  }

  function isAdminOnlyPage() {
    var page = getPageName().toLowerCase();
    if (page === "" || page === "/") page = "index.html";
    for (var i = 0; i < ADMIN_ONLY_PAGES.length; i++) {
      if (page === ADMIN_ONLY_PAGES[i]) return true;
    }
    return false;
  }

  function getStoredUser() {
    try {
      var userJson = localStorage.getItem(USER_KEY);
      if (userJson) return JSON.parse(userJson);
    } catch (e) {}
    return null;
  }

  function getSessionToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (e) {}
    return null;
  }

  function getAccessLevel() {
    // First check session-based auth
    var user = getStoredUser();
    if (user && user.access_level) {
      return user.access_level;
    }

    // Legacy fallback for transition period
    try {
      var level = sessionStorage.getItem(LEGACY_ACCESS_KEY);
      if (level === "full" || level === "admin" || level === "internal" || level === "limited") return level;
      if (sessionStorage.getItem(LEGACY_STORAGE_KEY) === "1") return "admin";
    } catch (e) {}
    return "";
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
    // Compute relative path to login based on current location
    var path = window.location.pathname || "";
    var prefix = path.indexOf("/dashboards/") !== -1 ? "../" : "./";
    window.location.href = prefix + "login.html";
  }

  function checkPageAccess() {
    var level = getAccessLevel();
    var page = getPageName().toLowerCase();
    var prefix = page.indexOf("/dashboards/") !== -1 ? "../" : "./";

    // admin (and legacy "full") can access everything
    if (level === "admin" || level === "full") {
      return true;
    }

    // internal can access everything except admin-only pages (users.html)
    if (level === "internal") {
      if (isAdminOnlyPage()) {
        window.location.href = prefix + "index.html";
        return false;
      }
      return true;
    }

    // limited can only access specific pages
    if (level === "limited" && !isLimitedAllowedPage()) {
      window.location.href = prefix + "funnel-customer.html";
      return false;
    }

    return true;
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
    getUser: getStoredUser,
    getToken: getSessionToken,
    getAccessLevel: getAccessLevel,
    isAuthenticated: isAuthenticated,
    logout: function() {
      clearAuth();
      redirectToLogin();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : null);
