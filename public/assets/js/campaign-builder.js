/*
  Campaign URL Builder — client-side URL generator for CardUpdatr launch links.
  Reads form inputs, builds a settings JSON, encodes into a hash URL,
  generates a QR code, and manages localStorage presets.
*/
(function(global) {
"use strict";

var PRESET_KEY = "sis_campaign_presets";
var debounceTimer = null;

// DOM refs (cached in init)
var els = {};

// Chip data store (top_sites only)
var topSitesChips = [];

function init() {
  cacheRefs();
  bindCollapsePanels();
  bindChipInput();
  bindFormInputs();
  bindOutputActions();
  bindPresets();
  regenerate();
  renderPresetList();
}

function cacheRefs() {
  var ids = [
    "hostname", "hostnameHint",
    "topSitesInput", "topSitesWrap",
    "merchantSiteTag",
    "overlayToggle", "overlayLabel",
    "sourceType", "sourceCategory", "sourceSubCategory",
    "cardDescription",
    "buttonColor", "buttonColorPicker",
    "borderColor", "borderColorPicker",
    "borderRadius",
    "outputEmpty", "outputContent", "outputUrl",
    "copyUrlBtn", "copyUrlFeedback", "openUrlBtn",
    "qrContainer", "downloadQrBtn",
    "jsonToggle", "jsonPreview", "jsonActions",
    "copyJsonBtn", "copyJsonFeedback",
    "presetName", "savePresetBtn", "presetList"
  ];
  for (var i = 0; i < ids.length; i++) {
    els[ids[i]] = document.getElementById(ids[i]);
  }
}

// --- Collapse Panels ---
function bindCollapsePanels() {
  var headers = document.querySelectorAll(".builder-card-header");
  for (var i = 0; i < headers.length; i++) {
    headers[i].addEventListener("click", function() {
      var card = this.parentElement;
      card.classList.toggle("collapsed");
    });
  }
}

// --- Chip Input (top_sites only) ---
function bindChipInput() {
  var input = els.topSitesInput;
  var wrap = els.topSitesWrap;
  if (!input || !wrap) return;
  wrap.addEventListener("click", function() { input.focus(); });

  input.addEventListener("keydown", function(e) {
    var val = input.value.trim();
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (val) addChip(val);
      input.value = "";
    }
    if (e.key === "Backspace" && !input.value) {
      if (topSitesChips.length) {
        topSitesChips.pop();
        renderChips();
        regenerate();
      }
    }
  });

  input.addEventListener("paste", function() {
    setTimeout(function() {
      var parts = input.value.split(/[,\s]+/);
      var added = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p) { addChip(p); added = true; }
      }
      if (added) input.value = "";
    }, 0);
  });
}

function addChip(value) {
  value = value.replace(/,/g, "").trim();
  if (!value || !isValidDomain(value)) return;
  for (var i = 0; i < topSitesChips.length; i++) {
    if (topSitesChips[i].toLowerCase() === value.toLowerCase()) return;
  }
  topSitesChips.push(value);
  renderChips();
  regenerate();
}

function removeChip(index) {
  topSitesChips.splice(index, 1);
  renderChips();
  regenerate();
}

function renderChips() {
  var wrap = els.topSitesWrap;
  var input = els.topSitesInput;
  if (!wrap || !input) return;

  var existing = wrap.querySelectorAll(".chip-tag");
  for (var i = 0; i < existing.length; i++) existing[i].remove();

  for (var j = 0; j < topSitesChips.length; j++) {
    var tag = document.createElement("span");
    tag.className = "chip-tag";
    tag.innerHTML = escapeHtml(topSitesChips[j]) + ' <span class="chip-remove" data-idx="' + j + '">&times;</span>';
    wrap.insertBefore(tag, input);
  }

  var removes = wrap.querySelectorAll(".chip-remove");
  for (var k = 0; k < removes.length; k++) {
    removes[k].addEventListener("click", function(e) {
      e.stopPropagation();
      removeChip(parseInt(this.getAttribute("data-idx"), 10));
    });
  }
}

function isValidDomain(str) {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(str);
}

// --- Form Input Binding ---
function bindFormInputs() {
  var formIds = [
    "hostname", "merchantSiteTag",
    "sourceType", "sourceCategory", "sourceSubCategory",
    "cardDescription", "buttonColor", "borderColor", "borderRadius"
  ];
  for (var i = 0; i < formIds.length; i++) {
    var el = els[formIds[i]];
    if (!el) continue;
    el.addEventListener("input", regenerate);
    el.addEventListener("change", regenerate);
  }

  // Overlay toggle
  if (els.overlayToggle) {
    els.overlayToggle.addEventListener("change", function() {
      if (els.overlayLabel) els.overlayLabel.textContent = this.checked ? "On" : "Off";
      regenerate();
    });
  }

  // Color picker <-> text sync
  syncColor("buttonColor", "buttonColorPicker");
  syncColor("borderColor", "borderColorPicker");
}

function syncColor(textId, pickerId) {
  var textEl = els[textId];
  var pickerEl = els[pickerId];
  if (!textEl || !pickerEl) return;

  pickerEl.addEventListener("input", function() {
    textEl.value = pickerEl.value;
    regenerate();
  });
  textEl.addEventListener("input", function() {
    if (isValidHex(textEl.value)) {
      pickerEl.value = textEl.value;
    }
  });
}

function isValidHex(str) {
  return /^#[0-9a-fA-F]{6}$/.test(str);
}

function stripProtocol(str) {
  return str.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

// --- Build Settings Object ---
function buildSettingsObject() {
  var hostname = stripProtocol((els.hostname.value || "").trim());
  if (!hostname) return null;

  var settings = {};

  // Config section
  var config = {};
  if (topSitesChips.length) config.top_sites = topSitesChips.slice();
  var tag = els.merchantSiteTag ? (els.merchantSiteTag.value || "").trim() : "";
  if (tag) config.merchant_site_tags = tag;
  if (els.overlayToggle && els.overlayToggle.checked) config.overlay = true;
  if (Object.keys(config).length) settings.config = config;

  // User / Source section
  var source = {};
  var srcFields = [
    { id: "sourceType", key: "type" },
    { id: "sourceCategory", key: "category" },
    { id: "sourceSubCategory", key: "sub_category" }
  ];
  for (var i = 0; i < srcFields.length; i++) {
    var el = els[srcFields[i].id];
    var val = el ? (el.value || "").trim() : "";
    if (val) source[srcFields[i].key] = val;
  }
  if (Object.keys(source).length) {
    settings.user = { source: source };
  }

  // Style section
  var style = {};
  var cardDesc = (els.cardDescription.value || "").trim();
  if (cardDesc) style.card_description = cardDesc;
  var btnColor = (els.buttonColor.value || "").trim();
  if (btnColor) style.button_color = btnColor;
  var brdColor = (els.borderColor.value || "").trim();
  if (brdColor) style.border_color = brdColor;
  var brdRadius = (els.borderRadius.value || "").trim();
  if (brdRadius) style.button_border_radius = brdRadius;
  if (Object.keys(style).length) {
    settings.style = style;
  }

  return settings;
}

// --- Build URL ---
function buildUrl(hostname, settings) {
  return "https://" + hostname + "/#settings=" + encodeURIComponent(JSON.stringify(settings));
}

// --- Regenerate Output ---
function regenerate() {
  var settings = buildSettingsObject();

  // Hostname validation
  var hostname = stripProtocol((els.hostname.value || "").trim());
  if (hostname && !hostname.match(/\./)) {
    els.hostname.classList.add("input-error");
    els.hostnameHint.textContent = "Hostname must contain a dot (e.g. fi.cardupdatr.app)";
    els.hostnameHint.style.color = "#f87171";
  } else {
    els.hostname.classList.remove("input-error");
    els.hostnameHint.textContent = "The CardUpdatr hostname for this FI (e.g. fi.cardupdatr.app)";
    els.hostnameHint.style.color = "";
  }

  if (!settings) {
    els.outputEmpty.style.display = "";
    els.outputContent.style.display = "none";
    return;
  }

  els.outputEmpty.style.display = "none";
  els.outputContent.style.display = "";

  var url = buildUrl(hostname, settings);
  els.outputUrl.textContent = url;

  // JSON preview
  els.jsonPreview.textContent = JSON.stringify(settings, null, 2);

  // Debounced QR regeneration
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function() {
    renderQR(url);
  }, 200);
}

// --- QR Code ---
function renderQR(url) {
  if (!els.qrContainer) return;
  els.qrContainer.innerHTML = "";

  if (typeof qrcode !== "function") {
    els.qrContainer.textContent = "QR library not loaded";
    return;
  }

  try {
    var qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();

    var moduleCount = qr.getModuleCount();
    var cellSize = Math.max(4, Math.floor(256 / moduleCount));
    var size = moduleCount * cellSize;
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    for (var row = 0; row < moduleCount; row++) {
      for (var col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }
    els.qrContainer.appendChild(canvas);
  } catch (e) {
    els.qrContainer.textContent = "QR generation failed — URL may be too long";
  }
}

// --- Output Actions ---
function bindOutputActions() {
  if (els.copyUrlBtn) {
    els.copyUrlBtn.addEventListener("click", function() {
      copyToClipboard(els.outputUrl.textContent, els.copyUrlFeedback);
    });
  }

  if (els.openUrlBtn) {
    els.openUrlBtn.addEventListener("click", function() {
      var url = els.outputUrl.textContent;
      if (url) window.open(url, "_blank");
    });
  }

  if (els.downloadQrBtn) {
    els.downloadQrBtn.addEventListener("click", function() {
      var canvas = els.qrContainer && els.qrContainer.querySelector("canvas");
      if (!canvas) return;
      var link = document.createElement("a");
      link.download = "cardupdatr-qr.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  }

  if (els.jsonToggle) {
    els.jsonToggle.addEventListener("click", function() {
      var preview = els.jsonPreview;
      var actions = els.jsonActions;
      var isOpen = preview.classList.contains("open");
      preview.classList.toggle("open");
      if (actions) actions.style.display = isOpen ? "none" : "";
      els.jsonToggle.innerHTML = isOpen ? "Settings JSON &#9660;" : "Settings JSON &#9650;";
    });
  }

  if (els.copyJsonBtn) {
    els.copyJsonBtn.addEventListener("click", function() {
      copyToClipboard(els.jsonPreview.textContent, els.copyJsonFeedback);
    });
  }
}

function copyToClipboard(text, feedbackEl) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showFeedback(feedbackEl);
    }).catch(function() {
      fallbackCopy(text, feedbackEl);
    });
  } else {
    fallbackCopy(text, feedbackEl);
  }
}

function fallbackCopy(text, feedbackEl) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); showFeedback(feedbackEl); } catch(e) {}
  document.body.removeChild(ta);
}

function showFeedback(el) {
  if (!el) return;
  el.classList.add("show");
  setTimeout(function() { el.classList.remove("show"); }, 1500);
}

// --- Presets ---
function bindPresets() {
  if (els.savePresetBtn) {
    els.savePresetBtn.addEventListener("click", savePreset);
  }
  if (els.presetName) {
    els.presetName.addEventListener("keydown", function(e) {
      if (e.key === "Enter") { e.preventDefault(); savePreset(); }
    });
  }
}

function getPresets() {
  try {
    var raw = localStorage.getItem(PRESET_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function setPresets(presets) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); } catch(e) {}
}

function savePreset() {
  var name = (els.presetName.value || "").trim();
  if (!name) { els.presetName.focus(); return; }

  var formData = captureFormState();
  var presets = getPresets();
  presets.push({ name: name, data: formData, created: new Date().toISOString() });
  setPresets(presets);
  els.presetName.value = "";
  renderPresetList();
}

function loadPreset(index) {
  var presets = getPresets();
  if (!presets[index]) return;
  restoreFormState(presets[index].data);
  regenerate();
}

function deletePreset(index) {
  var presets = getPresets();
  presets.splice(index, 1);
  setPresets(presets);
  renderPresetList();
}

function renderPresetList() {
  if (!els.presetList) return;
  var presets = getPresets();
  if (!presets.length) {
    els.presetList.innerHTML = '<div class="preset-empty">No saved presets</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < presets.length; i++) {
    html += '<div class="preset-item">' +
      '<span class="preset-item-name">' + escapeHtml(presets[i].name) + '</span>' +
      '<span class="preset-item-actions">' +
        '<button class="btn btn-secondary btn-sm" onclick="window.__campaignBuilder.loadPreset(' + i + ')">Load</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="window.__campaignBuilder.deletePreset(' + i + ')" style="color:#f87171">Delete</button>' +
      '</span>' +
    '</div>';
  }
  els.presetList.innerHTML = html;
}

function captureFormState() {
  return {
    hostname: els.hostname.value,
    topSitesChips: topSitesChips.slice(),
    merchantSiteTag: els.merchantSiteTag ? els.merchantSiteTag.value : "demo",
    overlay: els.overlayToggle ? els.overlayToggle.checked : false,
    sourceType: els.sourceType.value,
    sourceCategory: els.sourceCategory.value,
    sourceSubCategory: els.sourceSubCategory.value,
    cardDescription: els.cardDescription.value,
    buttonColor: els.buttonColor.value,
    borderColor: els.borderColor.value,
    borderRadius: els.borderRadius.value
  };
}

function restoreFormState(data) {
  if (!data) return;
  els.hostname.value = data.hostname || "";
  topSitesChips = (data.topSitesChips || []).slice();
  renderChips();

  if (els.merchantSiteTag) els.merchantSiteTag.value = data.merchantSiteTag || "demo";
  if (els.overlayToggle) {
    els.overlayToggle.checked = !!data.overlay;
    if (els.overlayLabel) els.overlayLabel.textContent = data.overlay ? "On" : "Off";
  }
  els.sourceType.value = data.sourceType || "";
  els.sourceCategory.value = data.sourceCategory || "";
  els.sourceSubCategory.value = data.sourceSubCategory || "";
  els.cardDescription.value = data.cardDescription || "";
  els.buttonColor.value = data.buttonColor || "";
  els.borderColor.value = data.borderColor || "";
  els.borderRadius.value = data.borderRadius || "";

  if (data.buttonColor && isValidHex(data.buttonColor)) {
    els.buttonColorPicker.value = data.buttonColor;
  }
  if (data.borderColor && isValidHex(data.borderColor)) {
    els.borderColorPicker.value = data.borderColor;
  }
}

function escapeHtml(str) {
  var div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// Expose for preset buttons
global.__campaignBuilder = {
  loadPreset: loadPreset,
  deletePreset: deletePreset
};

// --- Init on DOM ready ---
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})(window);
