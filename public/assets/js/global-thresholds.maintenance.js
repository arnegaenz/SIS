import {
  DEFAULT_THRESHOLDS,
  STORAGE_KEY,
  clearThresholds,
  loadThresholds,
  percentToRatio,
  ratioToPercent,
  saveThresholds,
  validateThresholds,
} from "./global-thresholds.js";

function toast(msg) {
  try {
    if (window.sisToast) window.sisToast(msg);
  } catch (_) {}
}

function warn(msg, err) {
  try {
    console.warn("[SIS] " + msg, err || "");
  } catch (_) {}
}

function hasLocalOverride() {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return false;
  }
}

function formatPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  let s = v.toFixed(v < 1 ? 3 : v < 10 ? 2 : 1);
  s = s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  return s;
}

const FIELDS = [
  { key: "viewsPerCardholderBadMax", inputId: "thViewsPerCardholderBadMaxPct" },
  { key: "viewsPerCardholderWarnMax", inputId: "thViewsPerCardholderWarnMaxPct" },
  { key: "sessionsWithJobsBadMax", inputId: "thSessionsWithJobsBadMaxPct" },
  { key: "sessionsWithJobsWarnMax", inputId: "thSessionsWithJobsWarnMaxPct" },
  { key: "sessionsWithSuccessBadMax", inputId: "thSessionsWithSuccessBadMaxPct" },
  { key: "sessionsWithSuccessWarnMax", inputId: "thSessionsWithSuccessWarnMaxPct" },
  { key: "abandonGoodMax", inputId: "thAbandonGoodMaxPct" },
  { key: "abandonWarnMax", inputId: "thAbandonWarnMaxPct" },
  { key: "gaCoverageBadMax", inputId: "thGaCoverageBadMaxPct" },
  { key: "gaCoverageWarnMax", inputId: "thGaCoverageWarnMaxPct" },
];

function renderUI() {
  const t = loadThresholds();

  const toggle = document.getElementById("thEnableViewsPerCardholderColoring");
  if (toggle) toggle.checked = !!t.enableViewsPerCardholderColoring;

  for (const f of FIELDS) {
    const input = document.getElementById(f.inputId);
    if (!input) continue;
    const pct = ratioToPercent(t[f.key]);
    input.value = pct == null ? "" : formatPct(pct);
    const defPct = ratioToPercent(DEFAULT_THRESHOLDS[f.key]);
    if (defPct != null) input.placeholder = formatPct(defPct);
  }

  const meta = document.getElementById("thresholdsMeta");
  if (meta) {
    meta.textContent = hasLocalOverride()
      ? "Local override active (stored in this browser)."
      : "Using built-in defaults.";
  }
}

function readUI() {
  const t = {};
  const toggle = document.getElementById("thEnableViewsPerCardholderColoring");
  t.enableViewsPerCardholderColoring = !!(toggle && toggle.checked);

  for (const f of FIELDS) {
    const input = document.getElementById(f.inputId);
    if (!input) continue;
    const ratio = percentToRatio(input.value);
    if (ratio == null) {
      throw new Error(`Invalid percent for ${f.key}. Use 0–100 (e.g. 10 = 10%).`);
    }
    t[f.key] = ratio;
  }

  const validated = validateThresholds(t, { partial: false });
  if (!validated.ok) throw new Error(validated.message || "Invalid thresholds.");
  return validated.cleaned;
}

function downloadJson(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function init() {
  const card = document.getElementById("globalThresholdsCard");
  if (!card) return;

  const saveBtn = document.getElementById("thresholdsSaveBtn");
  const resetBtn = document.getElementById("thresholdsResetBtn");
  const exportBtn = document.getElementById("thresholdsExportBtn");
  const importInput = document.getElementById("thresholdsImportFile");

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      try {
        const cleaned = readUI();
        saveThresholds(cleaned);
        toast("Saved global KPI thresholds.");
        renderUI();
      } catch (e) {
        warn("Threshold save blocked.", e);
        toast(String((e && e.message) || e || "Invalid thresholds."));
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      try {
        clearThresholds();
        toast("Reset to default KPI thresholds.");
        renderUI();
      } catch (e) {
        warn("Threshold reset failed.", e);
        toast("Reset failed (see console).");
      }
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      try {
        const t = loadThresholds();
        downloadJson("sis-global-thresholds.json", JSON.stringify(t, null, 2) + "\n");
        toast("Exported thresholds JSON.");
      } catch (e) {
        warn("Export failed.", e);
        toast("Export failed (see console).");
      }
    });
  }

  if (importInput) {
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || "");
          const parsed = JSON.parse(text);
          const validated = validateThresholds(parsed, { partial: false });
          if (!validated.ok) {
            toast(validated.message || "Invalid thresholds JSON.");
            return;
          }
          saveThresholds(validated.cleaned);
          toast("Imported global KPI thresholds.");
          renderUI();
        } catch (e) {
          warn("Import failed.", e);
          toast("Invalid JSON (see console).");
        } finally {
          importInput.value = "";
        }
      };
      reader.onerror = () => {
        importInput.value = "";
        toast("Failed to read file.");
      };
      reader.readAsText(file);
    });
  }

  renderUI();
}

document.addEventListener("DOMContentLoaded", init);

