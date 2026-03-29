const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value) {
  if (!Number.isFinite(value)) return "-";
  return numberFormatter.format(value);
}

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRate(numerator, denominator, digits = 1) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return "-";
  return `${((numerator / denominator) * 100).toFixed(digits)}%`;
}

export function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const TZ_STORAGE_KEY = "sis-timezone";

export function getLocalTimezone() {
  try {
    const saved = localStorage.getItem(TZ_STORAGE_KEY);
    if (saved && saved !== "auto") return saved;
  } catch { /* ignore */ }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getTimezonePreference() {
  try { return localStorage.getItem(TZ_STORAGE_KEY) || "auto"; } catch { return "auto"; }
}

export function setTimezonePreference(tz) {
  try { localStorage.setItem(TZ_STORAGE_KEY, tz); } catch { /* ignore */ }
}

const TZ_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "UTC", label: "UTC" },
];

export function getTimezoneOptions() { return TZ_OPTIONS; }

export function getTimezoneLabel(tz) {
  if (!tz || tz === "auto") {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const match = TZ_OPTIONS.find(o => o.value === detected);
    return match ? match.label : detected.split("/").pop().replace(/_/g, " ");
  }
  const match = TZ_OPTIONS.find(o => o.value === tz);
  return match ? match.label : tz.split("/").pop().replace(/_/g, " ");
}

export function buildDateRange(days) {
  const now = new Date();
  const end = formatLocalDate(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Math.max(0, days - 1));
  return {
    date_from: formatLocalDate(start),
    date_to: end,
  };
}

export function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null || cell === undefined ? "" : cell.toString();
          if (value.includes(",") || value.includes("\n") || value.includes("\"")) {
            return `"${value.replace(/\"/g, '""')}"`;
          }
          return value;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function createMultiSelect(container, config = {}) {
  const button = container.querySelector(".multi-select__button");
  const panel = container.querySelector(".multi-select__panel");
  const search = container.querySelector(".multi-select__search");
  const optionsWrap = container.querySelector(".multi-select__options");
  const state = {
    options: [],
    selected: new Set(),
    placeholder: config.placeholder || "All",
  };

  function updateButtonLabel() {
    if (state.selected.size === 0) {
      button.textContent = state.placeholder;
      return;
    }
    button.textContent = `${state.selected.size} selected`;
  }

  function renderOptions(filterText = "") {
    const query = filterText.trim().toLowerCase();
    optionsWrap.innerHTML = "";
    const visible = state.options.filter((opt) =>
      query ? opt.label.toLowerCase().includes(query) : true
    );
    for (const opt of visible) {
      const label = document.createElement("label");
      label.className = "multi-select__option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = opt.value;
      checkbox.checked = state.selected.has(opt.value);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.selected.add(opt.value);
        } else {
          state.selected.delete(opt.value);
        }
        updateButtonLabel();
        if (config.onChange) config.onChange(Array.from(state.selected));
      });
      const text = document.createElement("span");
      text.textContent = opt.label;
      label.appendChild(checkbox);
      label.appendChild(text);
      optionsWrap.appendChild(label);
    }
  }

  function setOptions(options) {
    state.options = Array.isArray(options) ? options : [];
    renderOptions(search.value);
    updateButtonLabel();
  }

  function setSelected(values) {
    state.selected = new Set(values || []);
    renderOptions(search.value);
    updateButtonLabel();
  }

  function getSelected() {
    return Array.from(state.selected);
  }

  function toggleOpen(force) {
    const isOpen = container.classList.contains("open");
    if (force === true || (!isOpen && force !== false)) {
      container.classList.add("open");
      search.focus();
    } else {
      container.classList.remove("open");
    }
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleOpen();
  });
  panel.addEventListener("click", (event) => event.stopPropagation());
  search.addEventListener("input", () => renderOptions(search.value));
  document.addEventListener("click", () => toggleOpen(false));

  if (config.initial) {
    state.selected = new Set(config.initial);
  }
  updateButtonLabel();

  return {
    setOptions,
    setSelected,
    getSelected,
  };
}

export function sortRows(rows, key, direction) {
  if (!key) return rows;
  const dir = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return dir * (aVal - bVal);
    }
    return dir * String(aVal ?? "").localeCompare(String(bVal ?? ""));
  });
}

export function attachSortHandlers(table, onSort) {
  const headers = table.querySelectorAll("thead th[data-key]");
  headers.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      onSort(key);
    });
  });
}

/* ── Kiosk / Command Center Utilities ── */

export function isKioskMode() {
  return new URLSearchParams(window.location.search).get("kiosk") === "1";
}

export function initKioskMode(title, refreshSeconds) {
  document.body.classList.add("kiosk-mode");

  // Honor saved theme preference (or system preference), don't force dark
  const STORAGE_KEY = "sis-theme";
  let saved;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { saved = null; }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);

  const header = document.createElement("div");
  header.className = "kiosk-header";
  header.innerHTML = `
    <div class="kiosk-header__title">${title}</div>
    <div class="kiosk-header__status">
      <div class="kiosk-header__countdown">
        <span class="kiosk-header__countdown-label">Next refresh</span>
        <div class="kiosk-header__countdown-bar">
          <div class="kiosk-header__countdown-fill" id="kioskCountdownFill"></div>
        </div>
      </div>
      <button class="theme-toggle kiosk-theme-toggle" id="kioskThemeToggle" type="button">${theme === "dark" ? "Dark mode" : "Light mode"}</button>
      <button class="kiosk-view-toggle" id="kioskViewToggle" type="button" title="Switch to regular view">Regular View</button>
      <div class="kiosk-header__clock" id="kioskClock"></div>
      <button class="kiosk-tz-toggle" id="kioskTzToggle" type="button" title="Change timezone">${getTimezoneLabel(getTimezonePreference())}</button>
      <div class="kiosk-header__dot" id="kioskDot"></div>
    </div>
  `;
  document.body.prepend(header);

  // Theme toggle in kiosk header
  const themeBtn = document.getElementById("kioskThemeToggle");
  if (themeBtn) {
    // Add the dot
    const dot = document.createElement("span");
    dot.className = "theme-toggle__dot";
    themeBtn.prepend(dot);
    themeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      themeBtn.childNodes[themeBtn.childNodes.length - 1].textContent = next === "dark" ? "Dark mode" : "Light mode";
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    });
  }

  // View toggle — switch to regular (non-kiosk) view
  const viewBtn = document.getElementById("kioskViewToggle");
  if (viewBtn) {
    viewBtn.addEventListener("click", () => {
      const url = new URL(window.location);
      url.searchParams.delete("kiosk");
      window.location.href = url.toString();
    });
  }

  // Timezone pill — opens dropdown picker
  const tzBtn = document.getElementById("kioskTzToggle");
  if (tzBtn) {
    tzBtn.style.position = "relative";
    tzBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      let menu = document.getElementById("kioskTzMenu");
      if (menu) { menu.remove(); return; }
      const current = getTimezonePreference();
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const detectedLabel = getTimezoneLabel("auto");
      menu = document.createElement("div");
      menu.id = "kioskTzMenu";
      menu.className = "kiosk-tz-menu";
      for (const opt of getTimezoneOptions()) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "kiosk-tz-menu__item" + (opt.value === current ? " kiosk-tz-menu__item--active" : "");
        item.textContent = opt.value === "auto" ? `Auto (${detectedLabel})` : opt.label;
        item.addEventListener("click", (ev) => {
          ev.stopPropagation();
          setTimezonePreference(opt.value);
          window.location.reload();
        });
        menu.appendChild(item);
      }
      tzBtn.parentElement.appendChild(menu);
      // Position below the button
      const rect = tzBtn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + "px";
      menu.style.right = (window.innerWidth - rect.right) + "px";
      // Close on outside click
      const closeMenu = () => { menu.remove(); document.removeEventListener("click", closeMenu); };
      setTimeout(() => document.addEventListener("click", closeMenu), 0);
    });
  }

  // Live clock — use selected timezone
  const clockEl = document.getElementById("kioskClock");
  const clockTz = getLocalTimezone();
  function updateClock() {
    clockEl.textContent = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: clockTz,
    });
  }
  updateClock();
  setInterval(updateClock, 1000);

  return { header };
}

export function startAutoRefresh(fetchFn, intervalMs) {
  const fillEl = document.getElementById("kioskCountdownFill");
  const dotEl = document.getElementById("kioskDot");
  let timer = null;
  let countdownTimer = null;

  function startCountdown() {
    if (!fillEl) return;
    const startTime = Date.now();
    fillEl.style.transition = "none";
    fillEl.style.width = "100%";
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.max(0, 100 - (elapsed / intervalMs) * 100);
      fillEl.style.transition = "none";
      fillEl.style.width = `${pct}%`;
    }, 1000);
  }

  async function refresh() {
    try {
      if (dotEl) dotEl.classList.remove("error");
      await fetchFn();
    } catch (err) {
      console.error("[kiosk] refresh failed", err);
      if (dotEl) dotEl.classList.add("error");
    }
    startCountdown();
  }

  // Initial fetch
  refresh();

  // Schedule repeating
  timer = setInterval(refresh, intervalMs);

  return {
    stop() {
      if (timer) clearInterval(timer);
      if (countdownTimer) clearInterval(countdownTimer);
    },
  };
}

export function createTimezoneSelect(container, onChange) {
  const current = getTimezonePreference();
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detectedLabel = getTimezoneLabel("auto");
  const select = document.createElement("select");
  select.id = "tzSelect";
  select.title = "Dashboard timezone";
  select.style.cssText = "font-size:0.78rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;";
  for (const opt of getTimezoneOptions()) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.value === "auto" ? `Auto (${detectedLabel})` : opt.label;
    if (opt.value === current) el.selected = true;
    select.appendChild(el);
  }
  select.addEventListener("change", () => {
    setTimezonePreference(select.value);
    if (onChange) onChange(select.value);
    else window.location.reload();
  });

  const wrap = document.createElement("div");
  wrap.className = "filter-group";
  wrap.style.cssText = "display:flex;align-items:center;gap:6px;";
  const label = document.createElement("label");
  label.textContent = "Timezone";
  label.style.cssText = "font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);white-space:nowrap;";
  wrap.appendChild(label);
  wrap.appendChild(select);
  container.appendChild(wrap);
  return select;
}

export function formatRelativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDays = (diffHr / 24).toFixed(1);
  return `${diffDays}d ago`;
}

export function healthColor(successRate) {
  if (successRate >= 0.15) return "green";
  if (successRate >= 0.05) return "amber";
  return "red";
}

export function opsHealthColor(successRate) {
  if (successRate >= 0.85) return "green";
  if (successRate >= 0.70) return "amber";
  return "red";
}

export function trafficHealthColor(status) {
  if (status === "dark") return "red";
  if (status === "low") return "amber";
  if (status === "sleeping") return "indigo";
  return "green";
}
