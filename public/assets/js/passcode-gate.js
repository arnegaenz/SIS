(function (global) {
  var FULL_PASSCODE = "12345678";
  var LIMITED_PASSCODE = "1234";
  var STORAGE_KEY = "sis_passcode_ok";
  var ACCESS_KEY = "sis_access_level";
  var LIMITED_PAGES = ["funnel.html", "troubleshoot.html"];

  function getPageName() {
    try {
      var path = window.location.pathname || "";
      var parts = path.split("/");
      return parts[parts.length - 1] || "index.html";
    } catch (e) {}
    return "index.html";
  }

  function isLimitedAllowedPage() {
    var page = getPageName().toLowerCase();
    if (page === "" || page === "/") page = "index.html";
    for (var i = 0; i < LIMITED_PAGES.length; i++) {
      if (page === LIMITED_PAGES[i]) return true;
    }
    return false;
  }

  function getAccessLevel() {
    try {
      var level = sessionStorage.getItem(ACCESS_KEY);
      if (level === "full" || level === "limited") return level;
      if (sessionStorage.getItem(STORAGE_KEY) === "1") return "full";
    } catch (e) {}
    return "";
  }

  function unlock(level) {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
      if (level) sessionStorage.setItem(ACCESS_KEY, level);
    } catch (e) {}
    document.documentElement.style.visibility = "";
    var gate = document.getElementById("sis-passcode-gate");
    if (gate) gate.remove();
    if (level === "limited" && !isLimitedAllowedPage()) {
      window.location.href = "./funnel.html";
      return;
    }
    window.location.reload();
  }

  function showGate() {
    document.documentElement.style.visibility = "hidden";

    var gate = document.createElement("div");
    gate.id = "sis-passcode-gate";
    gate.style.position = "fixed";
    gate.style.inset = "0";
    gate.style.background = "#0b0f14";
    gate.style.color = "#e6edf3";
    gate.style.display = "flex";
    gate.style.alignItems = "center";
    gate.style.justifyContent = "center";
    gate.style.zIndex = "999999";

    var card = document.createElement("div");
    card.style.background = "#121822";
    card.style.border = "1px solid #1f2937";
    card.style.borderRadius = "16px";
    card.style.padding = "28px";
    card.style.width = "min(420px, 90vw)";
    card.style.boxShadow = "0 24px 60px rgba(0,0,0,0.35)";

    var title = document.createElement("div");
    title.textContent = "Enter Access Code";
    title.style.fontSize = "18px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";

    var hint = document.createElement("div");
    hint.textContent = "This dashboard requires a passcode.";
    hint.style.fontSize = "13px";
    hint.style.color = "#94a3b8";
    hint.style.marginBottom = "16px";

    var input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = "Passcode";
    input.style.width = "100%";
    input.style.padding = "10px 12px";
    input.style.borderRadius = "10px";
    input.style.border = "1px solid #334155";
    input.style.background = "#0f172a";
    input.style.color = "#e2e8f0";
    input.style.outline = "none";
    input.style.marginBottom = "12px";

    var error = document.createElement("div");
    error.textContent = "";
    error.style.fontSize = "12px";
    error.style.color = "#fca5a5";
    error.style.minHeight = "16px";
    error.style.marginBottom = "10px";

    var button = document.createElement("button");
    button.textContent = "Unlock";
    button.type = "button";
    button.style.width = "100%";
    button.style.padding = "10px 12px";
    button.style.borderRadius = "10px";
    button.style.border = "0";
    button.style.background = "#2563eb";
    button.style.color = "white";
    button.style.fontWeight = "700";
    button.style.cursor = "pointer";

    function attempt() {
      if (input.value === FULL_PASSCODE) {
        unlock("full");
      } else if (input.value === LIMITED_PASSCODE) {
        unlock("limited");
      } else {
        error.textContent = "Incorrect code.";
        input.value = "";
        input.focus();
      }
    }

    button.addEventListener("click", attempt);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") attempt();
    });

    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(input);
    card.appendChild(error);
    card.appendChild(button);
    gate.appendChild(card);

    document.body.appendChild(gate);
    input.focus();
    document.documentElement.style.visibility = "";
  }

  function init() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      if (params.get("sis-reset") === "1") {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(ACCESS_KEY);
      }
    } catch (e) {}
    try {
      if (getAccessLevel()) return;
    } catch (e) {}
    showGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : null);
