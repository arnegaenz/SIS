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

export function buildDateRange(days) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - Math.max(0, days - 1));
  return {
    date_from: start.toISOString().slice(0, 10),
    date_to: end.toISOString().slice(0, 10),
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
  document.documentElement.setAttribute("data-theme", "dark");

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
      <div class="kiosk-header__clock" id="kioskClock"></div>
      <div class="kiosk-header__dot" id="kioskDot"></div>
    </div>
  `;
  document.body.prepend(header);

  // Live clock
  const clockEl = document.getElementById("kioskClock");
  function updateClock() {
    clockEl.textContent = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
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

export function formatRelativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
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
