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

  function wrapFetch(apiBase) {
    if (!global.fetch || global.__sisFetchWrapped) return;
    if (!apiBase) return;
    global.__sisFetchWrapped = true;
    var origFetch = global.fetch.bind(global);
    global.fetch = function (input, init) {
      try {
        if (typeof input === "string") {
          return origFetch(withApiBase(input, apiBase), init);
        }
        if (input && typeof input === "object" && input.url) {
          var nextUrl = withApiBase(input.url, apiBase);
          if (nextUrl === input.url) return origFetch(input, init);
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
    global.SIS_API_BASE = "https://34-220-57-7.sslip.io";
  }

  wrapFetch(resolveApiBase());
})(typeof window !== "undefined" ? window : null);
