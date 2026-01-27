(function (global) {
  if (!global) return;

  function normalizeApiBase(value) {
    if (!value) return "";
    var trimmed = value.toString().trim();
    if (!trimmed) return "";
    if (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
    return trimmed;
  }

  function resolveApiBase() {
    var fromGlobal = typeof global.SIS_API_BASE === "string" ? global.SIS_API_BASE : "";
    if (fromGlobal) return normalizeApiBase(fromGlobal);
    var meta = document.querySelector('meta[name="sis-api-base"]');
    if (meta && meta.content) return normalizeApiBase(meta.content);
    return "";
  }

  function withApiBase(url, apiBase) {
    if (!apiBase) return url;
    if (!url) return url;
    var str = url.toString();
    if (/^[a-z]+:\/\//i.test(str)) return str;
    if (str.startsWith("data:") || str.startsWith("blob:")) return str;
    if (str.startsWith("//")) return str;
    if (str.startsWith("/")) return apiBase + str;
    return str;
  }

  function getAuthToken() {
    try {
      return localStorage.getItem("sis_session_token") || "";
    } catch (e) {
      return "";
    }
  }

  function wrapFetch(apiBase) {
    if (!global.fetch || global.__sisFetchWrapped) return;
    global.__sisFetchWrapped = true;
    var origFetch = global.fetch.bind(global);

    global.fetch = function (input, init) {
      init = init || {};

      // Add auth token to all requests
      var token = getAuthToken();
      if (token) {
        if (!init.headers) {
          init.headers = {};
        }
        // Handle both Headers object and plain object
        if (init.headers instanceof Headers) {
          if (!init.headers.has("Authorization")) {
            init.headers.set("Authorization", "Bearer " + token);
          }
        } else if (typeof init.headers === "object") {
          if (!init.headers["Authorization"]) {
            init.headers["Authorization"] = "Bearer " + token;
          }
        }
      }

      try {
        if (typeof input === "string") {
          var url = apiBase ? withApiBase(input, apiBase) : input;
          return origFetch(url, init);
        }
        if (input && typeof input === "object" && input.url) {
          var nextUrl = apiBase ? withApiBase(input.url, apiBase) : input.url;
          if (nextUrl === input.url && !token) return origFetch(input, init);
          return origFetch(new Request(nextUrl, input), init);
        }
      } catch (err) {
        // fall through to original fetch
      }
      return origFetch(input, init);
    };
  }

  if (typeof global.SIS_API_BASE !== "string" || !global.SIS_API_BASE) {
    // Set to your AWS base URL when hosting the UI on GitHub Pages.
    // Example: https://sis-api.example.com
    // Use empty string for local development to avoid nginx content-type issues
    global.SIS_API_BASE = window.location.hostname === "localhost" ? "" : "https://34-220-57-7.sslip.io";
  }

  wrapFetch(resolveApiBase());
})(typeof window !== "undefined" ? window : null);
