(function (global) {
  var PASSCODE = "12345678";
  var STORAGE_KEY = "sis_passcode_ok";

  function unlock() {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch (e) {}
    document.documentElement.style.visibility = "";
    var gate = document.getElementById("sis-passcode-gate");
    if (gate) gate.remove();
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
      if (input.value === PASSCODE) {
        unlock();
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
      if (sessionStorage.getItem(STORAGE_KEY) === "1") return;
    } catch (e) {}
    showGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : null);
