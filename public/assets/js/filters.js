(function () {
  const ALL = "All";

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function getFileName(path) {
    const parts = (path || "").split("/");
    const last = parts.pop() || "index.html";
    return last || "index.html";
  }

  function activateNav() {
    const here = getFileName(location.pathname);
    document.querySelectorAll("nav a[href]").forEach((a) => {
      const file = getFileName(a.getAttribute("href") || "");
      if (file === here) a.classList.add("active");
    });
  }

  function normalizeRegistryEntry(entry) {
    if (!entry) return null;
    const fi = (entry.fi_lookup_key || entry.fi_name || "").toString().trim();
    if (!fi) return null;
    const normalizePartner = (val) => {
      const s = (val || "").toString().trim();
      if (!s) return "Other";
      if (s.toLowerCase() === "unknown") return "Other";
      if (s.toLowerCase() === "direct" || s.toLowerCase() === "direct ss01") return "Direct ss01";
      return s;
    };
    const normalizeIntegration = (val, instanceRaw) => {
      const upperInst = (instanceRaw || "").toString().trim().toLowerCase();
      if (upperInst.includes("pscu")) return "SSO";
      if (upperInst.includes("ondot")) return "CardSavr";
      if (upperInst.includes("digitalonboarding")) return "NON-SSO";
      if (upperInst.includes("msu")) return "SSO";
      const upper = (val || "").toString().trim().toUpperCase();
      if (upper === "SSO") return "SSO";
      if (upper === "NON-SSO" || upper === "NON_SSO" || upper === "NONSSO") return "NON-SSO";
      return upper || "UNKNOWN";
    };
    return {
      fi_lookup_key: fi,
      fi_name: entry.fi_name || fi,
      partner: normalizePartner(entry.partner),
      integration: normalizeIntegration(entry.integration || entry.integration_type, entry.instance),
      instance: entry.instance || "unknown",
    };
  }

  async function loadRegistry() {
    const apiBase =
      typeof window !== "undefined" &&
      typeof window.SIS_API_BASE === "string" &&
      window.SIS_API_BASE.trim()
        ? window.SIS_API_BASE.replace(/\/+$/, "")
        : "";
    if (Array.isArray(window.FI_Registry)) {
      console.log("[filters] using window.FI_Registry");
      return window.FI_Registry.map(normalizeRegistryEntry).filter(Boolean);
    }
    const tryFetch = async (url) => {
      try {
        console.log("[filters] fetching registry from", url);
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        if (Array.isArray(json)) return json.map(normalizeRegistryEntry).filter(Boolean);
        if (json && typeof json === "object") {
          return Object.values(json).map(normalizeRegistryEntry).filter(Boolean);
        }
      } catch (err) {
        console.warn("[filters] registry load failed from", url, err);
      }
      return [];
    };

    const sources = [
      apiBase ? `${apiBase}/fi-registry` : "",
      apiBase ? `${apiBase}/fi_registry.json` : "",
      "assets/data/fi_registry.json", // relative to page
      "/assets/data/fi_registry.json", // site root
      "/public/assets/data/fi_registry.json", // fallback for some dev servers
      "fi_registry.json",
      "/fi_registry.json",
      "fi-registry",
      "/fi-registry",
    ].filter(Boolean);
    for (const url of sources) {
      const found = await tryFetch(url);
      if (found.length) return found;
    }
    console.error(
      "FI_Registry missing; add window.FI_Registry or ensure /assets/data/fi_registry.json, /fi_registry.json, or /fi-registry is reachable."
    );
    return [
      {
        fi_lookup_key: "mock_fi",
        fi_name: "Mock FI",
        partner: "MockPartner",
        integration: "SSO",
        instance: "mock",
      },
    ]; // fallback so UI renders for troubleshooting
  }

  function unique(list) {
    return Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  let allowedInstances = null;
  let allowedInstanceMap = null; // normalized -> display name (from /instances)

  async function loadInstanceAllowList() {
    try {
      const apiBase =
        typeof window !== "undefined" &&
        typeof window.SIS_API_BASE === "string" &&
        window.SIS_API_BASE.trim()
          ? window.SIS_API_BASE.replace(/\/+$/, "")
          : "";
      const url = apiBase ? `${apiBase}/instances` : "/instances";
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      const rawNames = (json.instances || [])
        .map((inst) => inst.name || inst.instance || inst.id)
        .filter(Boolean)
        .map((n) => n.toString().trim())
        .filter(Boolean);
      if (rawNames.length) {
        allowedInstanceMap = new Map();
        for (const name of rawNames) {
          allowedInstanceMap.set(normalizeInstanceKey(name), name);
        }
        allowedInstances = new Set(allowedInstanceMap.keys());
        console.log("[filters] instance allow-list loaded", rawNames.length);
      }
    } catch (err) {
      console.warn("[filters] instance allow-list load failed", err);
    }
  }

  // User-scoped filter options (based on access control)
  let userScopedOptions = null;

  async function loadUserScopedOptions() {
    try {
      const apiBase =
        typeof window !== "undefined" &&
        typeof window.SIS_API_BASE === "string" &&
        window.SIS_API_BASE.trim()
          ? window.SIS_API_BASE.replace(/\/+$/, "")
          : "";
      const url = apiBase ? `${apiBase}/api/filter-options` : "/api/filter-options";
      const res = await fetch(url);
      if (!res.ok) {
        console.warn("[filters] user-scoped options not available (HTTP " + res.status + ")");
        return null;
      }
      const json = await res.json();
      if (json && json.fis && json.fis.length > 0) {
        console.log("[filters] user-scoped options loaded:", json.fis.length, "FIs,", json.access?.is_admin ? "admin" : "restricted");
        return json;
      }
    } catch (err) {
      console.warn("[filters] user-scoped options load failed", err);
    }
    return null;
  }

  function filterRegistryByUserScope(registry, scopedOptions) {
    if (!scopedOptions || !scopedOptions.fis) return registry;
    // Build a set of allowed fi__instance composite keys for precise matching
    const allowedComposite = new Set(
      scopedOptions.fis.map(fi => normalizeFiKey(fi.key) + "__" + normalizeInstanceKey(fi.instance))
    );
    return registry.filter(entry => {
      const composite = normalizeFiKey(entry.fi_lookup_key) + "__" + normalizeInstanceKey(entry.instance);
      return allowedComposite.has(composite);
    });
  }

  const normalizeFiKey = (val) =>
    val ? val.toString().trim().toLowerCase() : "";
  const normalizeInstanceKey = (val) => {
    if (!val || val === ALL) return "any";
    const s = val.toString().trim().toLowerCase();
    if (!s) return "any";
    return s.replace(/[^a-z0-9]/g, "");
  };
  let registryCache = [];
  const fiInstanceSelection = new Map();

  function makeFiInstanceKey(fiKey, instKey) {
    return `${fiKey}__${instKey}`;
  }

  function parseFiInstanceKey(entryKey) {
    const idx = entryKey.lastIndexOf("__");
    if (idx === -1) return { fiKey: entryKey, instKey: "" };
    return { fiKey: entryKey.slice(0, idx), instKey: entryKey.slice(idx + 2) };
  }

  function syncFiStateFromSelectionMap(state) {
    const next = new Set();
    for (const entry of fiInstanceSelection.values()) {
      if (entry && entry.checked) next.add(entry.fiKey);
    }
    state.fis = next;
  }

  function collectAvailableFiInstanceKeys(availability) {
    const available = new Set();
    if (!availability || !(availability.availableFIsByInstance instanceof Map)) return available;
    for (const [instKey, set] of availability.availableFIsByInstance.entries()) {
      for (const fi of set) {
        available.add(makeFiInstanceKey(fi, instKey));
      }
    }
    return available;
  }

  function syncFiSelectionMapToAvailability(availableKeys, opts = {}) {
    if (!(availableKeys instanceof Set)) return;
    const fillChecked = !!opts.fillChecked;
    if (fillChecked) {
      fiInstanceSelection.clear();
      for (const entryKey of availableKeys) {
        const parsed = parseFiInstanceKey(entryKey);
        fiInstanceSelection.set(entryKey, { checked: true, fiKey: parsed.fiKey });
      }
      return;
    }
    for (const [entryKey, entry] of fiInstanceSelection.entries()) {
      if (!availableKeys.has(entryKey)) {
        entry.checked = false;
        fiInstanceSelection.set(entryKey, entry);
      }
    }
  }

  function getBaseRegistry(registry) {
    return allowedInstances && allowedInstances.size
      ? registry.filter((r) => allowedInstances.has(normalizeInstanceKey(r.instance)))
      : registry;
  }

  function getActiveSetForScope(state, setKey) {
    const touchedKey = `__${setKey}Touched`;
    if (!state || !state[touchedKey]) return null;
    const set = state[setKey] instanceof Set ? state[setKey] : new Set();
    const universe = Array.isArray(state[setKey + "Universe"]) ? state[setKey + "Universe"] : null;
    if (set.size === 0) return new Set();
    if (universe && set.size >= universe.length) return null;
    return set;
  }

  function getScopedRegistryForAvailability(baseRegistry, state) {
    let scoped = baseRegistry;
    const partnerSet = getActiveSetForScope(state, "partnerSet");
    if (partnerSet) {
      scoped = scoped.filter((r) => partnerSet.has(r.partner));
    }
    const integrationSet = getActiveSetForScope(state, "integrationSet");
    if (integrationSet) {
      scoped = scoped.filter((r) => integrationSet.has(r.integration));
    }
    return scoped;
  }

  function parseQuery() {
    const p = new URLSearchParams(location.search);
    return {
      partner: p.get("partner") || ALL,
      integration: p.get("integration") || ALL,
      instance: p.get("instance") || ALL,
      fis: (p.get("fi") || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    };
  }

  function writeQuery(state) {
    const p = new URLSearchParams(location.search);
    if (state.partner && state.partner !== ALL) p.set("partner", state.partner);
    else p.delete("partner");
    if (state.integration && state.integration !== ALL) p.set("integration", state.integration);
    else p.delete("integration");
    if (state.instance && state.instance !== ALL) p.set("instance", state.instance);
    else p.delete("instance");
    if (state.fis && state.fis.size) p.set("fi", Array.from(state.fis).join(","));
    else p.delete("fi");
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
  }

  const readStorage = () => null;
  const writeStorage = () => {};

  function matches(meta, state) {
    if (!meta) return false;
    if (state.partner !== ALL && meta.partner !== state.partner) return false;
    if (state.integration !== ALL && meta.integration !== state.integration) return false;
    if (state.instance !== ALL && meta.instance !== state.instance) return false;
    if (state.fis.size && !state.fis.has(meta.fi)) return false;
    return true;
  }

  function deriveOptions(registry, state) {
    // Keep full option lists visible; scoping happens via availability checks instead of hiding.
    // Only expose instances that exist in the Maintenance-managed instances list when available.
    const baseRegistry = getBaseRegistry(registry);

    // Instance dropdown should match Maintenance instances (via /instances) when available.
    let instancesOut = [];
    if (allowedInstanceMap && allowedInstanceMap.size) {
      instancesOut = unique(Array.from(allowedInstanceMap.values()));
    } else {
      instancesOut = unique(baseRegistry.map((r) => r.instance));
    }

    // Always include "Other" so missing/unknown partners are user-selectable.
    const partners = unique([...baseRegistry.map((r) => r.partner), "Other"]);

    // Create FI options with instance labels: "fi_name (instance)"
    const fiOptions = baseRegistry.map((r) => ({
      value: r.fi_lookup_key,  // Store just the FI name
      label: `${r.fi_lookup_key} (${r.instance})`,  // Display "FI (instance)"
      instance: r.instance,
      displayName: r.fi_name || r.fi_lookup_key,
    }));
    // Remove duplicates based on label and sort
    const uniqueFiOptions = Array.from(
      new Map(fiOptions.map((opt) => [opt.label, opt])).values()
    ).sort((a, b) => {
      const aInst = (a.instance || "").toString();
      const bInst = (b.instance || "").toString();
      const instCmp = aInst.localeCompare(bInst);
      if (instCmp) return instCmp;
      const aName = (a.displayName || "").toString();
      const bName = (b.displayName || "").toString();
      const nameCmp = aName.localeCompare(bName);
      if (nameCmp) return nameCmp;
      return (a.value || "").toString().localeCompare((b.value || "").toString());
    });

    return {
      partners,
      integrations: unique(baseRegistry.map((r) => r.integration)),
      fis: uniqueFiOptions,
      instances: instancesOut,
      currentSlice: baseRegistry,
    };
  }

  function computeAvailability(registryRows, checkedInstances) {
    const availablePartners = new Set();
    const availableIntegrations = new Set();
    const availableFIsByInstance = new Map();
    if (!Array.isArray(registryRows) || !(checkedInstances instanceof Set) || checkedInstances.size === 0) {
      return { availablePartners, availableIntegrations, availableFIsByInstance };
    }
    for (const row of registryRows) {
      if (!row) continue;
      const instKey = normalizeInstanceKey(row.instance);
      if (!checkedInstances.has(instKey)) continue;
      availablePartners.add(row.partner);
      availableIntegrations.add(row.integration);
      if (!availableFIsByInstance.has(instKey)) availableFIsByInstance.set(instKey, new Set());
      availableFIsByInstance.get(instKey).add(row.fi_lookup_key);
    }
    return { availablePartners, availableIntegrations, availableFIsByInstance };
  }

  function computeRequiredInstancesForSelection(registryRows, selectionDelta) {
    const required = new Set();
    if (!selectionDelta || !selectionDelta.checked || !Array.isArray(registryRows)) return required;
    const values = Array.isArray(selectionDelta.values) ? selectionDelta.values : [];
    if (!values.length) return required;
    const valueSet =
      selectionDelta.type === "fi"
        ? new Set(values.map((v) => normalizeFiKey(v)))
        : new Set(values.map((v) => (v || "").toString()));
    for (const row of registryRows) {
      if (!row) continue;
      if (selectionDelta.type === "partner") {
        if (valueSet.has(row.partner)) required.add(normalizeInstanceKey(row.instance));
      } else if (selectionDelta.type === "integration") {
        if (valueSet.has(row.integration)) required.add(normalizeInstanceKey(row.instance));
      } else if (selectionDelta.type === "fi") {
        if (valueSet.has(normalizeFiKey(row.fi_lookup_key))) required.add(normalizeInstanceKey(row.instance));
      }
    }
    return required;
  }

  function resolveInstanceDisplayName(instanceKey, registryRows) {
    if (allowedInstanceMap && allowedInstanceMap.has(instanceKey)) {
      return allowedInstanceMap.get(instanceKey);
    }
    if (Array.isArray(registryRows)) {
      for (const row of registryRows) {
        if (normalizeInstanceKey(row.instance) === instanceKey) return row.instance;
      }
    }
    return instanceKey;
  }

  function expandScopeForSelection(state, requiredInstances) {
    if (!state || !(requiredInstances instanceof Set) || requiredInstances.size === 0) return state;
    if (!state.__instanceSetTouched) return state;
    const next = state.instanceSet instanceof Set ? new Set(state.instanceSet) : new Set();
    for (const instKey of requiredInstances) {
      const display = resolveInstanceDisplayName(instKey, registryCache);
      next.add(display);
    }
    state.instanceSet = next;
    return state;
  }

  function pruneInvalidSelections(state, availability) {
    if (!state || !availability) return state;
    const availablePartners = availability.availablePartners || new Set();
    const availableIntegrations = availability.availableIntegrations || new Set();
    const availableFiKeys = new Set();
    const fisByInstance = availability.availableFIsByInstance || new Map();
    if (fisByInstance instanceof Map) {
      for (const set of fisByInstance.values()) {
        for (const fi of set) availableFiKeys.add(normalizeFiKey(fi));
      }
    }
    if (state.__partnerSetTouched && state.partnerSet instanceof Set) {
      for (const val of Array.from(state.partnerSet)) {
        if (!availablePartners.has(val)) state.partnerSet.delete(val);
      }
    }
    if (state.__integrationSetTouched && state.integrationSet instanceof Set) {
      for (const val of Array.from(state.integrationSet)) {
        if (!availableIntegrations.has(val)) state.integrationSet.delete(val);
      }
    }
    if (state.__fiTouched && state.fis instanceof Set) {
      for (const val of Array.from(state.fis)) {
        if (!availableFiKeys.has(normalizeFiKey(val))) state.fis.delete(val);
      }
    }
    return state;
  }

  function getCheckedInstanceKeysForAvailability(registryRows, state) {
    if (!Array.isArray(registryRows) || !state) return new Set();
    const all = new Set(registryRows.map((r) => normalizeInstanceKey(r.instance)));
    if (!state.__instanceSetTouched) return all;
    if (!(state.instanceSet instanceof Set) || state.instanceSet.size === 0) return new Set();
    return new Set(Array.from(state.instanceSet).map((v) => normalizeInstanceKey(v)));
  }

  function computeEffectiveStringFromSet(selectedSet, allValue = ALL) {
    if (!(selectedSet instanceof Set) || selectedSet.size !== 1) return allValue;
    return Array.from(selectedSet)[0] || allValue;
  }

  function renderMultiSelect(container, values, state, opts = {}) {
    const btn = container.querySelector("button");
    const panel = container.querySelector(".panel");
    const outOfScopeLabel = opts.outOfScopeLabel || " (adds instance)";
    const isOutOfScope =
      typeof opts.isOutOfScope === "function" ? opts.isOutOfScope : () => false;
    const enableSearch = !!opts.enableSearch;
    const availableFiInstanceKeys =
      opts.availableFiInstanceKeys instanceof Set ? opts.availableFiInstanceKeys : null;

    // Setup event handlers (only if not already set up)
    if (!btn.dataset.handlersAttached) {
      const openPanel = () => {
        closeAllMultiSelectPanels(container);
        panel.removeAttribute("hidden");
        container.dataset.open = "true";
        positionMultiSelectPanel(container);
      };
      const closePanel = () => {
        panel.setAttribute("hidden", "hidden");
        container.dataset.open = "false";
      };

      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const open = panel.hasAttribute("hidden") ? false : true;
        if (open) closePanel();
        else openPanel();
      });

      btn.dataset.handlersAttached = "true";
    }

    const existingSearch = enableSearch
      ? (panel.querySelector('input[data-fi-search]') || {}).value || ""
      : "";
    panel.innerHTML = "";

    if (!values.length) {
      btn.textContent = "No FIs";
      state.fis.clear();
      return;
    }

    // Extract actual values (FI names) from option objects
    const fiValues = values.map((opt) => (typeof opt === "object" ? opt.value : opt));
    const checkedInstances = opts.checkedInstances instanceof Set ? opts.checkedInstances : null;
    const shouldSelectAll = !state.__fiTouched && state.fis.size === 0;
    if (shouldSelectAll) {
      state.fis = new Set(fiValues);
    }

    let searchInput = null;
    if (enableSearch) {
      searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.placeholder = "Search FIs";
      searchInput.value = existingSearch;
      searchInput.className = "filter-search-input";
      searchInput.setAttribute("data-fi-search", "1");
      panel.appendChild(searchInput);
    }

    const getSearchTerm = () => {
      const input = panel.querySelector('input[data-fi-search]');
      return input ? input.value.trim().toLowerCase() : "";
    };

    const getOptionLabels = () =>
      Array.from(panel.querySelectorAll('label[data-fi-option="1"]'));

    const applySearchFilter = () => {
      const term = getSearchTerm();
      let visibleCount = 0;
      let visibleChecked = 0;
      getOptionLabels().forEach((label) => {
        const haystack = (label.dataset.search || "").toLowerCase();
        const match = !term || haystack.includes(term);
        label.style.display = match ? "" : "none";
        if (match) {
          visibleCount += 1;
          const cb = label.querySelector("input[type=\"checkbox\"]");
          if (cb && cb.checked) visibleChecked += 1;
        }
      });
      const toggle = panel.querySelector('input[value="__toggle_all__"]');
      if (toggle) toggle.checked = visibleCount > 0 && visibleChecked === visibleCount;
      const emptyNote = panel.querySelector(".filter-search-empty");
      if (emptyNote) emptyNote.style.display = visibleCount ? "none" : "block";
      return { visibleCount, visibleChecked };
    };

    // Toggle all row
    const toggleLabel = document.createElement("label");
    const toggleCb = document.createElement("input");
    toggleCb.type = "checkbox";
    toggleCb.value = "__toggle_all__";
    toggleCb.checked = false;
    toggleLabel.appendChild(toggleCb);
    toggleLabel.appendChild(document.createTextNode(enableSearch ? " (select/deselect visible)" : " (select/deselect all)"));
    panel.appendChild(toggleLabel);

    values.forEach((opt) => {
      // Handle both old format (string) and new format (object with value/label)
      const val = typeof opt === "object" ? opt.value : opt;
      const displayText = typeof opt === "object" ? opt.label : opt;
      const id = `fi-${val}`;
      const label = document.createElement("label");
      label.setAttribute("data-fi-option", "1");
      const searchParts = [];
      if (typeof opt === "object") {
        if (opt.instance) searchParts.push(opt.instance);
        if (opt.displayName) searchParts.push(opt.displayName);
      }
      searchParts.push(val);
      label.dataset.search = searchParts.filter(Boolean).join(" ").toLowerCase();
      const instKey = typeof opt === "object" && opt.instance ? normalizeInstanceKey(opt.instance) : "any";
      const entryKey = makeFiInstanceKey(val, instKey);
      let entry = fiInstanceSelection.get(entryKey);
      if (!entry) {
        const defaultChecked = !state.__fiTouched
          ? availableFiInstanceKeys
            ? availableFiInstanceKeys.has(entryKey)
            : checkedInstances instanceof Set
            ? checkedInstances.has(instKey)
            : true
          : false;
        entry = { checked: defaultChecked, fiKey: val };
        fiInstanceSelection.set(entryKey, entry);
      }
      label.dataset.fiKey = val;
      label.dataset.fiInstance = instKey;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = val;
      cb.id = id;
      cb.checked = !!entry.checked;
      label.appendChild(cb);
      const textWrap = document.createElement("span");
      textWrap.className = "fi-option-text";
      const fiNameText =
        typeof opt === "object" && opt.displayName
          ? opt.displayName
          : typeof opt === "object" && opt.value
          ? opt.value
          : val;
      const instText = typeof opt === "object" && opt.instance ? opt.instance : "";
      const fiShort = fiNameText.length > 12 ? `${fiNameText.slice(0, 12)}…` : fiNameText;
      const instShort = instText.length > 10 ? `${instText.slice(0, 10)}…` : instText;
      const fullLabel = instText ? `${fiNameText} (${instText})` : fiNameText;
      label.title = fullLabel;
      const fiSpan = document.createElement("span");
      fiSpan.className = "fi-option-name";
      fiSpan.textContent = fiShort;
      const instSpan = document.createElement("span");
      instSpan.className = "fi-option-instance";
      instSpan.textContent = instShort;
      textWrap.appendChild(fiSpan);
      textWrap.appendChild(instSpan);
      label.appendChild(textWrap);
      if (isOutOfScope(opt, val)) {
        const hint = document.createElement("span");
        hint.className = "filter-out-of-scope";
        hint.textContent = outOfScopeLabel;
        label.appendChild(hint);
      }
      panel.appendChild(label);
    });
    syncFiStateFromSelectionMap(state);

    const updateLabel = () => {
      const count = state.fis.size;
      const total = values.length;
      const allSelected = count && count === total;
      btn.textContent = allSelected ? `All FIs (${total})` : count ? `${count} selected` : "No FIs";
    };
    updateLabel();

    const emptyNote = document.createElement("div");
    emptyNote.className = "filter-search-empty";
    emptyNote.textContent = "No matches";
    panel.appendChild(emptyNote);

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        applySearchFilter();
      });
    }

    applySearchFilter();

    if (!panel.dataset.changeHandlerAttached) {
      panel.addEventListener("change", (ev) => {
        if (!ev.target || !ev.target.value) return;
        state.__fiTouched = true;
        if (ev.target.value === "__toggle_all__") {
          const checkAll = ev.target.checked;
          getOptionLabels().forEach((label) => {
            if (label.style.display === "none") return;
            const cb = label.querySelector("input[type=\"checkbox\"]");
            if (!cb) return;
            const fiKey = label.dataset.fiKey || cb.value;
            const instKey = label.dataset.fiInstance || "any";
            const entryKey = makeFiInstanceKey(fiKey, instKey);
            const entry = fiInstanceSelection.get(entryKey) || { checked: false, fiKey };
            entry.checked = checkAll;
            fiInstanceSelection.set(entryKey, entry);
            cb.checked = checkAll;
          });
          syncFiStateFromSelectionMap(state);
          updateLabel();
          applySearchFilter();
          return;
        }
        const label = ev.target.closest("label");
        if (label) {
          const fiKey = label.dataset.fiKey || ev.target.value;
          const instKey = label.dataset.fiInstance || "any";
          const entryKey = makeFiInstanceKey(fiKey, instKey);
          const entry = fiInstanceSelection.get(entryKey) || { checked: false, fiKey };
          entry.checked = ev.target.checked;
          fiInstanceSelection.set(entryKey, entry);
          syncFiStateFromSelectionMap(state);
        }
        applySearchFilter();
        updateLabel();
      });
      panel.dataset.changeHandlerAttached = "true";
    }
  }

  function closeAllMultiSelectPanels(exceptContainer) {
    document.querySelectorAll(".multi-select .panel").forEach((p) => {
      const parent = p.closest(".multi-select");
      if (exceptContainer && parent === exceptContainer) return;
      p.setAttribute("hidden", "hidden");
      if (parent) parent.dataset.open = "false";
      if (p) {
        p.style.position = "";
        p.style.left = "";
        p.style.top = "";
        p.style.minWidth = "";
        p.style.maxWidth = "";
        p.style.maxHeight = "";
      }
    });
  }

  function positionMultiSelectPanel(container) {
    if (!container) return;
    const panel = container.querySelector(".panel");
    const btn = container.querySelector("button");
    if (!panel || !btn || panel.hasAttribute("hidden")) return;
    const rect = btn.getBoundingClientRect();
    const viewportW = window.innerWidth || document.documentElement.clientWidth;
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    const minWidth = Math.max(rect.width, 220);
    const maxWidth = Math.min(viewportW - 16, Math.max(minWidth, 260));
    const left = Math.max(8, Math.min(rect.left, viewportW - maxWidth - 8));
    let top = rect.bottom + 6;
    const maxHeight = Math.max(160, viewportH - top - 12);
    if (maxHeight < 160) {
      const fallbackTop = Math.max(8, rect.top - 6 - 260);
      top = fallbackTop;
    }
    panel.style.position = "fixed";
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.minWidth = `${minWidth}px`;
    panel.style.maxWidth = `${maxWidth}px`;
    panel.style.maxHeight = `${Math.max(160, viewportH - top - 12)}px`;
  }

  if (!document.__sisMultiSelectCloseBound) {
    document.__sisMultiSelectCloseBound = true;
    const repositionOpenPanels = () => {
      document.querySelectorAll('.multi-select[data-open="true"]').forEach((container) => {
        positionMultiSelectPanel(container);
      });
    };
    window.addEventListener("resize", repositionOpenPanels);
    window.addEventListener("scroll", repositionOpenPanels, true);
    document.addEventListener("click", (e) => {
      const target = e.target;
      const inside = target && target.closest ? target.closest(".multi-select") : null;
      if (inside) return;
      closeAllMultiSelectPanels(null);
    });
  }

  function renderMultiSelectSet(container, values, state, setKey, opts = {}) {
    const btn = container.querySelector("button");
    const panel = container.querySelector(".panel");
    if (!btn || !panel) return;

    const touchedKey = `__${setKey}Touched`;
    const title = opts.title || setKey;
    const allLabel = opts.allLabel || `All ${title}`;
    const noneLabel = opts.noneLabel || `No ${title}`;
    const availabilitySet = opts.availabilitySet instanceof Set ? opts.availabilitySet : null;
    const outOfScopeLabel = opts.outOfScopeLabel || " (adds instance)";

    // Setup open/close handlers once
    if (!btn.dataset.handlersAttached) {
      const openPanel = () => {
        closeAllMultiSelectPanels(container);
        panel.removeAttribute("hidden");
        container.dataset.open = "true";
        positionMultiSelectPanel(container);
      };
      const closePanel = () => {
        panel.setAttribute("hidden", "hidden");
        container.dataset.open = "false";
      };
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const open = panel.hasAttribute("hidden") ? false : true;
        if (open) closePanel();
        else openPanel();
      });
      btn.dataset.handlersAttached = "true";
    }

    panel.innerHTML = "";
    const options = Array.isArray(values) ? values.filter(Boolean) : [];
    // Track universe for deriveOptions "all selected means wildcard" behavior.
    state[setKey + "Universe"] = options.slice();
    if (!options.length) {
      btn.textContent = noneLabel;
      state[setKey] = new Set();
      return;
    }

    const selected = state[setKey] instanceof Set ? state[setKey] : new Set();
    const shouldSelectAll = !state[touchedKey];
    const nextSelected = shouldSelectAll ? new Set(options) : new Set(selected);
    // Drop selections that no longer exist
    for (const v of Array.from(nextSelected)) {
      if (!options.includes(v)) nextSelected.delete(v);
    }
    if (shouldSelectAll && nextSelected.size === 0) {
      state[setKey] = new Set(options);
    } else {
      state[setKey] = nextSelected;
    }

    const updateLabel = () => {
      const count = state[setKey].size;
      const total = options.length;
      const allSelected = count && count === total;
      btn.textContent = allSelected || !state[touchedKey] ? `${allLabel} (${total})` : count ? `${count} selected` : noneLabel;
    };

    // Toggle all row
    const toggleLabel = document.createElement("label");
    const toggleCb = document.createElement("input");
    toggleCb.type = "checkbox";
    toggleCb.value = "__toggle_all__";
    toggleCb.checked = state[setKey].size === options.length;
    toggleLabel.appendChild(toggleCb);
    toggleLabel.appendChild(document.createTextNode(" (select/deselect all)"));
    panel.appendChild(toggleLabel);

    const markOutOfScope = availabilitySet && state.__instanceSetTouched;
    options.forEach((val) => {
      const id = `${setKey}-${val}`;
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = val;
      cb.id = id;
      cb.checked = state[setKey].has(val);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + val));
      if (markOutOfScope && !availabilitySet.has(val)) {
        const hint = document.createElement("span");
        hint.className = "filter-out-of-scope";
        hint.textContent = outOfScopeLabel;
        label.appendChild(hint);
      }
      panel.appendChild(label);
    });

    updateLabel();

    if (!panel.dataset.changeHandlerAttached) {
      panel.addEventListener("change", (ev) => {
        if (!ev.target || !ev.target.value) return;
        state[touchedKey] = true;
        if (ev.target.value === "__toggle_all__") {
          const checkAll = ev.target.checked;
          state[setKey] = checkAll ? new Set(options) : new Set();
          panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            if (cb.value !== "__toggle_all__") cb.checked = checkAll;
          });
          updateLabel();
          return;
        }
        if (ev.target.checked) state[setKey].add(ev.target.value);
        else state[setKey].delete(ev.target.value);
        // sync toggle-all checkbox
        const toggle = panel.querySelector('input[value="__toggle_all__"]');
        if (toggle) toggle.checked = state[setKey].size === options.length;
        updateLabel();
      });
      panel.dataset.changeHandlerAttached = "true";
    }
  }

  function renderFilterBar(container, state, options, applyCb) {
    container.innerHTML = `
      <div class="filter-group">
        <label for="filter-instance">Instance</label>
        <div class="multi-select" id="filter-instance">
          <button type="button" id="filter-instance-button">All Instances</button>
          <div class="panel" hidden></div>
        </div>
      </div>
      <div class="filter-group">
        <label for="filter-partner">Partner</label>
        <div class="multi-select" id="filter-partner">
          <button type="button" id="filter-partner-button">All Partners</button>
          <div class="panel" hidden></div>
        </div>
      </div>
      <div class="filter-group">
        <label for="filter-integration">Integration</label>
        <div class="multi-select" id="filter-integration">
          <button type="button" id="filter-integration-button">All Integrations</button>
          <div class="panel" hidden></div>
        </div>
      </div>
      <div class="filter-group">
        <label for="filter-fi-button">FI</label>
        <div class="multi-select" id="filter-fi">
          <button type="button" id="filter-fi-button">All FIs</button>
          <div class="panel" hidden></div>
        </div>
      </div>
      <div class="filter-group">
        <button type="button" id="filter-clear">Clear filters</button>
      </div>
    `;
    const msInstance = container.querySelector("#filter-instance");
    const msPartner = container.querySelector("#filter-partner");
    const msIntegration = container.querySelector("#filter-integration");
    const msFi = container.querySelector("#filter-fi");
    const baseRegistry = getBaseRegistry(options.registry || []);

    const availabilityData = () => {
      const checkedInstances = getCheckedInstanceKeysForAvailability(baseRegistry, state);
      const scopedRegistry = getScopedRegistryForAvailability(baseRegistry, state);
      const availability = computeAvailability(scopedRegistry, checkedInstances);
      const availableFiKeys = new Set();
      for (const set of availability.availableFIsByInstance.values()) {
        for (const fi of set) availableFiKeys.add(normalizeFiKey(fi));
      }
      const availableFiInstanceKeys = collectAvailableFiInstanceKeys(availability);
      return { checkedInstances, scopedRegistry, availability, availableFiKeys, availableFiInstanceKeys };
    };
    const { checkedInstances, availability, availableFiKeys, availableFiInstanceKeys } = availabilityData();

    renderMultiSelectSet(msInstance, options.instances, state, "instanceSet", {
      title: "Instances",
      allLabel: "All Instances",
      noneLabel: "No Instances",
    });
    renderMultiSelectSet(msPartner, options.partners, state, "partnerSet", {
      title: "Partners",
      allLabel: "All Partners",
      noneLabel: "No Partners",
      availabilitySet: availability.availablePartners,
    });
    renderMultiSelectSet(msIntegration, options.integrations, state, "integrationSet", {
      title: "Integrations",
      allLabel: "All Integrations",
      noneLabel: "No Integrations",
      availabilitySet: availability.availableIntegrations,
    });
    renderMultiSelect(msFi, options.fis, state, {
      enableSearch: true,
      checkedInstances,
      availableFiInstanceKeys,
      isOutOfScope: (opt, val) => {
        if (!state.__instanceSetTouched) return false;
        if (opt && typeof opt === "object" && opt.instance) {
          const instKey = normalizeInstanceKey(opt.instance);
          return !availableFiInstanceKeys.has(makeFiInstanceKey(val, instKey));
        }
        return !availableFiKeys.has(normalizeFiKey(val));
      },
    });

    // Backwards-compatible fields used by pages: only set if exactly one chosen.
    state.partner = computeEffectiveStringFromSet(state.partnerSet);
    state.integration = computeEffectiveStringFromSet(state.integrationSet);
    state.instance = computeEffectiveStringFromSet(state.instanceSet);
    if (state.disableFi) {
      msPartner.querySelector("button").disabled = true;
      msIntegration.querySelector("button").disabled = true;
      msInstance.querySelector("button").disabled = true;
      msFi.querySelector("button").disabled = true;
      msFi.title = "Filtering unavailable on this view";
      msPartner.title = msIntegration.title = msInstance.title = msFi.title;
    } else {
      msPartner.querySelector("button").disabled = false;
      msIntegration.querySelector("button").disabled = false;
      msInstance.querySelector("button").disabled = false;
      msFi.querySelector("button").disabled = false;
      msPartner.removeAttribute("title");
      msIntegration.removeAttribute("title");
      msInstance.removeAttribute("title");
      msFi.removeAttribute("title");
    }

    const refreshOptions = () => {
      const nextAvailability = availabilityData();
      const next = deriveOptions(options.registry, state);
      renderMultiSelectSet(msInstance, next.instances, state, "instanceSet", {
        title: "Instances",
        allLabel: "All Instances",
        noneLabel: "No Instances",
      });
      renderMultiSelectSet(msPartner, next.partners, state, "partnerSet", {
        title: "Partners",
        allLabel: "All Partners",
        noneLabel: "No Partners",
        availabilitySet: nextAvailability.availability.availablePartners,
      });
      renderMultiSelectSet(msIntegration, next.integrations, state, "integrationSet", {
        title: "Integrations",
        allLabel: "All Integrations",
        noneLabel: "No Integrations",
        availabilitySet: nextAvailability.availability.availableIntegrations,
      });
      renderMultiSelect(msFi, next.fis, state, {
        enableSearch: true,
        checkedInstances: nextAvailability.checkedInstances,
        availableFiInstanceKeys: nextAvailability.availableFiInstanceKeys,
        isOutOfScope: (opt, val) => {
          if (!state.__instanceSetTouched) return false;
          if (opt && typeof opt === "object" && opt.instance) {
            const instKey = normalizeInstanceKey(opt.instance);
            return !nextAvailability.availableFiInstanceKeys.has(makeFiInstanceKey(val, instKey));
          }
          return !nextAvailability.availableFiKeys.has(normalizeFiKey(val));
        },
      });
    };

    // Option A: checking out-of-scope partner/integration/FI expands instance scope;
    // shrinking instance scope prunes invalid partner/integration/FI selections.
    const buildScopeChangeHandler = (scopeType, setKey) =>
      debounce((ev) => {
        const target = ev && ev.target ? ev.target : null;
        const value = target && typeof target.value === "string" ? target.value : "";
        const checked = target && typeof target.checked === "boolean" ? target.checked : false;
        const checkedInstances = getCheckedInstanceKeysForAvailability(baseRegistry, state);
        const scopedRegistry = getScopedRegistryForAvailability(baseRegistry, state);
        const availability = computeAvailability(scopedRegistry, checkedInstances);

        let availableFiInstanceKeys = collectAvailableFiInstanceKeys(availability);
        let instancesExpanded = false;

        if (scopeType === "instance") {
          if (!state.__fiTouched) {
            syncFiSelectionMapToAvailability(availableFiInstanceKeys, { fillChecked: true });
            syncFiStateFromSelectionMap(state);
          } else {
            syncFiSelectionMapToAvailability(availableFiInstanceKeys);
            syncFiStateFromSelectionMap(state);
            pruneInvalidSelections(state, availability);
          }
        } else if (checked) {
          const instanceSizeBefore = state.instanceSet instanceof Set ? state.instanceSet.size : 0;
          let valuesToCheck = [];
          if (value === "__toggle_all__") {
            valuesToCheck = state[setKey] instanceof Set ? Array.from(state[setKey]) : [];
          } else if (value) {
            valuesToCheck = [value];
          }
          if (valuesToCheck.length) {
            const unavailable = [];
            if (scopeType === "partner") {
              for (const v of valuesToCheck) {
                if (!availability.availablePartners.has(v)) unavailable.push(v);
              }
            } else if (scopeType === "integration") {
              for (const v of valuesToCheck) {
                if (!availability.availableIntegrations.has(v)) unavailable.push(v);
              }
            }
            if (unavailable.length) {
              const requiredInstances = computeRequiredInstancesForSelection(baseRegistry, {
                type: scopeType,
                values: unavailable,
                checked: true,
              });
              expandScopeForSelection(state, requiredInstances);
              if (state.instanceSet instanceof Set && state.instanceSet.size !== instanceSizeBefore) {
                fiInstanceSelection.clear();
                instancesExpanded = true;
              }
            }
          }
        }

        if (scopeType !== "instance") {
          if (instancesExpanded) {
            const refreshedInstances = getCheckedInstanceKeysForAvailability(baseRegistry, state);
            const refreshedRegistry = getScopedRegistryForAvailability(baseRegistry, state);
            const refreshedAvailability = computeAvailability(refreshedRegistry, refreshedInstances);
            availability.availablePartners = refreshedAvailability.availablePartners;
            availability.availableIntegrations = refreshedAvailability.availableIntegrations;
            availability.availableFIsByInstance = refreshedAvailability.availableFIsByInstance;
            availableFiInstanceKeys = collectAvailableFiInstanceKeys(refreshedAvailability);
          }
          if (!state.__fiTouched) {
            syncFiSelectionMapToAvailability(availableFiInstanceKeys, { fillChecked: true });
          } else {
            syncFiSelectionMapToAvailability(availableFiInstanceKeys);
            pruneInvalidSelections(state, availability);
          }
          syncFiStateFromSelectionMap(state);
        }

        // Keep exported strings backwards compatible.
        state.partner = computeEffectiveStringFromSet(state.partnerSet);
        state.integration = computeEffectiveStringFromSet(state.integrationSet);
        state.instance = computeEffectiveStringFromSet(state.instanceSet);
        writeQuery(state);
        writeStorage(state);
        refreshOptions();
        applyCb();
      }, 50);

    msInstance.querySelector(".panel").addEventListener("change", buildScopeChangeHandler("instance", "instanceSet"));
    msPartner.querySelector(".panel").addEventListener("change", buildScopeChangeHandler("partner", "partnerSet"));
    msIntegration
      .querySelector(".panel")
      .addEventListener("change", buildScopeChangeHandler("integration", "integrationSet"));

    msFi.querySelector(".panel").addEventListener("change", (ev) => {
      const target = ev && ev.target ? ev.target : null;
      const value = target && typeof target.value === "string" ? target.value : "";
      const checked = target && typeof target.checked === "boolean" ? target.checked : false;
      let expanded = false;
      if (checked) {
        const checkedInstances = getCheckedInstanceKeysForAvailability(baseRegistry, state);
        const scopedRegistry = getScopedRegistryForAvailability(baseRegistry, state);
        const availability = computeAvailability(scopedRegistry, checkedInstances);
        const availableFiKeys = new Set();
        for (const set of availability.availableFIsByInstance.values()) {
          for (const fi of set) availableFiKeys.add(normalizeFiKey(fi));
        }
        const availableFiInstanceKeys = collectAvailableFiInstanceKeys(availability);
        let valuesToCheck = [];
        if (value === "__toggle_all__") {
          valuesToCheck = state.fis instanceof Set ? Array.from(state.fis) : [];
        } else if (value) {
          valuesToCheck = [value];
        }
        const unavailable = valuesToCheck.filter((fi) => !availableFiKeys.has(normalizeFiKey(fi)));
        if (unavailable.length) {
          const requiredInstances = computeRequiredInstancesForSelection(baseRegistry, {
            type: "fi",
            values: unavailable,
            checked: true,
          });
          if (requiredInstances.size) {
            expandScopeForSelection(state, requiredInstances);
            expanded = true;
          }
        }
      }
      if (expanded) refreshOptions();
      writeQuery(state);
      writeStorage(state);
      applyCb();
    });
    container.querySelector("#filter-clear").addEventListener("click", () => {
      state.partner = ALL;
      state.integration = ALL;
      state.instance = ALL;
      state.partnerSet = new Set();
      state.integrationSet = new Set();
      state.instanceSet = new Set();
      state.fis.clear();
      fiInstanceSelection.clear();
      state.__fiTouched = false;  // Reset touched flag so checkboxes re-check
      state.__partnerSetTouched = false;
      state.__integrationSetTouched = false;
      state.__instanceSetTouched = false;
      refreshOptions();
      applyCb();
      writeQuery(state);
      writeStorage(state);
    });
  }

  function filterDom(state, selector) {
    document.querySelectorAll(selector).forEach((el) => {
      const meta = {
        partner: el.dataset.partner,
        integration: el.dataset.integration,
        instance: el.dataset.instance,
        fi: el.dataset.fi,
      };
      el.style.display = matches(meta, state) ? "" : "none";
    });
  }

  async function initFilters(pageId) {
    activateNav();
    const container = document.getElementById("filter-bar");
    if (!container) return;
    container.innerHTML = `<div class="filter-group"><label>Filters</label><div class="muted">Loading filters…</div></div>`;
    console.log("[filters] initFilters start", pageId);
    fiInstanceSelection.clear();

    // Load user-scoped options and instance allow-list in parallel
    const [scopedOptions] = await Promise.all([
      loadUserScopedOptions(),
      loadInstanceAllowList()
    ]);
    userScopedOptions = scopedOptions;

    // Load full registry, then filter by user scope if applicable
    let registry = await loadRegistry();
    if (scopedOptions && !scopedOptions.access?.is_admin) {
      const originalCount = registry.length;
      registry = filterRegistryByUserScope(registry, scopedOptions);
      console.log("[filters] filtered registry by user scope:", originalCount, "->", registry.length, "FIs");
    }

    registryCache = getBaseRegistry(registry);
    console.log("[filters] registry loaded", registry.length, "page", pageId);
    const state = {
      partner: ALL,
      integration: ALL,
      instance: ALL,
      partnerSet: new Set(),
      integrationSet: new Set(),
      instanceSet: new Set(),
      fis: new Set(),
      page: pageId,
      disableFi: false,
      __fiTouched: false,
      __partnerSetTouched: false,
      __integrationSetTouched: false,
      __instanceSetTouched: false,
    };
    // Always start fresh on load (same as pressing "Clear filters")
    state.partner = ALL;
    state.integration = ALL;
    state.instance = ALL;
    state.fis.clear();
    writeQuery(state);
    writeStorage(state);

    if (!registry.length) {
      container.innerHTML = `
        <div class="filter-group">
          <label>Filters</label>
          <div class="muted" style="max-width:320px">
            FI registry unavailable; using mock entries so filters still render.
          </div>
        </div>
      `;
      // fall through with mock entry
    }

    const options = deriveOptions(registry, state);
    options.registry = registry;

    const apply = () => {
      // Keep string fields stable for existing pages.
      state.partner = computeEffectiveStringFromSet(state.partnerSet);
      state.integration = computeEffectiveStringFromSet(state.integrationSet);
      state.instance = computeEffectiveStringFromSet(state.instanceSet);
      const canonicalFiInstances =
        state.fis.size > 0
          ? new Set(
              Array.from(state.fis)
                .map((fi) => normalizeFiKey(fi))
                .filter(Boolean)
                .map((fiKey) => `${fiKey}__${normalizeInstanceKey(state.instance)}`)
            )
          : null;
      const partnerSetNormalized =
        state.__partnerSetTouched && state.partnerSet instanceof Set
          ? new Set(Array.from(state.partnerSet).map((v) => (v || "").toString()))
          : null;
      const integrationSetNormalized =
        state.__integrationSetTouched && state.integrationSet instanceof Set
          ? new Set(Array.from(state.integrationSet).map((v) => (v || "").toString()))
          : null;
      const instanceSetNormalized =
        state.__instanceSetTouched && state.instanceSet instanceof Set
          ? new Set(Array.from(state.instanceSet).map((v) => normalizeInstanceKey(v)))
          : null;
      state.canonicalFiInstances = canonicalFiInstances;

      window.__FILTER_STATE = {
        ...state,
        canonicalFiInstances,
        partnerSetNormalized,
        integrationSetNormalized,
        instanceSetNormalized,
      };
      window.__FILTER_REGISTRY = registry;
      window.__FILTER_LAST_APPLIED = Date.now();
      if (pageId === "funnel" && typeof window.applyFilters === "function") {
        window.applyFilters();
        return;
      }
      if (pageId === "troubleshoot" && typeof window.applyFilters === "function") {
        window.applyFilters();
        return;
      }
      if (pageId === "heatmap" && typeof window.applyFilters === "function") {
        window.applyFilters();
        return;
      }
      if (pageId === "troubleshoot") {
        filterDom(state, ".session-card[data-fi]");
      } else {
        filterDom(state, "[data-fi]");
      }
    };

    renderFilterBar(container, state, options, apply);
    console.log("[filters] render complete", {
      partners: options.partners.length,
      integrations: options.integrations.length,
      fis: options.fis.length,
      instances: options.instances.length,
      pageId,
    });
    apply();
  }

  window.initFilters = initFilters;
  activateNav();
})();
