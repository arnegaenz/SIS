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
