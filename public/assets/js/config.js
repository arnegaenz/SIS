(function (global) {
  if (!global) return;
  if (typeof global.SIS_API_BASE === "string") return;
  // Set to your AWS base URL when hosting the UI on GitHub Pages.
  // Example: https://sis-api.example.com
  global.SIS_API_BASE = "https://34-220-57-7.sslip.io";
})(typeof window !== "undefined" ? window : null);
