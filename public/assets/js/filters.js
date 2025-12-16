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
      if (!s) return "Unknown";
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
      "assets/data/fi_registry.json", // relative to page
      "/assets/data/fi_registry.json", // site root
      "/public/assets/data/fi_registry.json", // fallback for some dev servers
      "fi_registry.json",
      "/fi_registry.json",
      "fi-registry",
      "/fi-registry",
    ];
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

  async function loadInstanceAllowList() {
    try {
      const res = await fetch("/instances");
      if (!res.ok) return;
      const json = await res.json();
      const names = (json.instances || [])
        .map((inst) => inst.name || inst.instance || inst.id)
        .filter(Boolean)
        .map((n) => normalizeInstanceKey(n));
      if (names.length) {
        allowedInstances = new Set(names);
        console.log("[filters] instance allow-list loaded", names.length);
      }
    } catch (err) {
      console.warn("[filters] instance allow-list load failed", err);
    }
  }

  const normalizeFiKey = (val) =>
    val ? val.toString().trim().toLowerCase() : "";
  const normalizeInstanceKey = (val) => {
    if (!val || val === ALL) return "any";
    const s = val.toString().trim().toLowerCase();
    return s || "any";
  };

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
    // Multi-select sets (Partner/Integration/Instance) are used ONLY to scope the FI list.
    // To avoid breaking page-level behavior, we keep state.partner/state.integration/state.instance as strings.
    const partnerUniverse = Array.isArray(state.partnerSetUniverse) ? state.partnerSetUniverse : null;
    const integrationUniverse = Array.isArray(state.integrationSetUniverse) ? state.integrationSetUniverse : null;
    const instanceUniverse = Array.isArray(state.instanceSetUniverse) ? state.instanceSetUniverse : null;

    const partnerSet = state.partnerSet instanceof Set ? state.partnerSet : new Set();
    const integrationSet = state.integrationSet instanceof Set ? state.integrationSet : new Set();
    const instanceSet = state.instanceSet instanceof Set ? state.instanceSet : new Set();

    const partnerActive = !!state.__partnerSetTouched;
    const integrationActive = !!state.__integrationSetTouched;
    const instanceActive = !!state.__instanceSetTouched;

    const usePartnerFilter =
      partnerActive &&
      (!partnerUniverse || partnerSet.size < partnerUniverse.length || partnerSet.size === 0);
    const useIntegrationFilter =
      integrationActive &&
      (!integrationUniverse || integrationSet.size < integrationUniverse.length || integrationSet.size === 0);
    const useInstanceFilter =
      instanceActive &&
      (!instanceUniverse || instanceSet.size < instanceUniverse.length || instanceSet.size === 0);

    const byPartner = usePartnerFilter
      ? registry.filter((r) => partnerSet.has(r.partner))
      : registry;
    const byIntegration = useIntegrationFilter
      ? byPartner.filter((r) => integrationSet.has(r.integration))
      : byPartner;
    const normalizedTargets = useInstanceFilter
      ? new Set(Array.from(instanceSet).map((v) => normalizeInstanceKey(v)))
      : null;
    const byInstance = normalizedTargets
      ? byIntegration.filter((r) => normalizedTargets.has(normalizeInstanceKey(r.instance)))
      : byIntegration;

    let instancesOut = unique(registry.map((r) => r.instance));
    if (allowedInstances && allowedInstances.size) {
      instancesOut = instancesOut.filter((inst) => allowedInstances.has(normalizeInstanceKey(inst)));
    }
    if (!instancesOut.includes("customer-dev")) instancesOut.push("customer-dev");
    const partners = unique(registry.map((r) => r.partner)).filter((p) => p !== "Unknown");

    // Create FI options with instance labels: "fi_name (instance)"
    const fiOptions = byInstance.map((r) => ({
      value: r.fi_lookup_key,  // Store just the FI name
      label: `${r.fi_lookup_key} (${r.instance})`,  // Display "FI (instance)"
    }));
    // Remove duplicates based on label and sort
    const uniqueFiOptions = Array.from(
      new Map(fiOptions.map((opt) => [opt.label, opt])).values()
    ).sort((a, b) => a.label.localeCompare(b.label));

    return {
      partners,
      integrations: unique(registry.map((r) => r.integration)),
      fis: uniqueFiOptions,
      instances: instancesOut,
      currentSlice: byInstance,
    };
  }

  function computeEffectiveStringFromSet(selectedSet, allValue = ALL) {
    if (!(selectedSet instanceof Set) || selectedSet.size !== 1) return allValue;
    return Array.from(selectedSet)[0] || allValue;
  }

  function renderMultiSelect(container, values, state) {
    const btn = container.querySelector("button");
    const panel = container.querySelector(".panel");

    // Setup event handlers (only if not already set up)
    if (!btn.dataset.handlersAttached) {
      const openPanel = () => {
        closeAllMultiSelectPanels(container);
        panel.removeAttribute("hidden");
        container.dataset.open = "true";
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

    if (!values.length) {
      btn.textContent = "No FIs";
      state.fis.clear();
      return;
    }

    // Extract actual values (FI names) from option objects
    const fiValues = values.map((opt) => (typeof opt === "object" ? opt.value : opt));

    const shouldSelectAll = !state.__fiTouched;
    const nextSelected = shouldSelectAll ? new Set(fiValues) : new Set(state.fis);
    // Keep internal state in sync with the UI default of "all selected" on first load
    if (shouldSelectAll && state.fis.size === 0) {
      state.fis = new Set(fiValues);
    }

    // Toggle all row
    const toggleLabel = document.createElement("label");
    const toggleCb = document.createElement("input");
    toggleCb.type = "checkbox";
    toggleCb.value = "__toggle_all__";
    toggleCb.checked = nextSelected.size === values.length;
    toggleLabel.appendChild(toggleCb);
    toggleLabel.appendChild(document.createTextNode(" (select/deselect all)"));
    panel.appendChild(toggleLabel);

    values.forEach((opt) => {
      // Handle both old format (string) and new format (object with value/label)
      const val = typeof opt === "object" ? opt.value : opt;
      const displayText = typeof opt === "object" ? opt.label : opt;
      const id = `fi-${val}`;
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = val;
      cb.id = id;
      cb.checked = nextSelected.has(val);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + displayText));
      panel.appendChild(label);
    });
    if (shouldSelectAll) state.fis = nextSelected;

    const updateLabel = () => {
      const count = state.fis.size;
      const total = values.length;
      const allSelected = count && count === total;
      btn.textContent = allSelected ? `All FIs (${total})` : count ? `${count} selected` : "No FIs";
    };
    updateLabel();

    panel.addEventListener("change", (ev) => {
      if (!ev.target || !ev.target.value) return;
      state.__fiTouched = true;
      if (ev.target.value === "__toggle_all__") {
        const checkAll = ev.target.checked;
        state.fis = checkAll ? new Set(fiValues) : new Set();
        panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          if (cb.value !== "__toggle_all__") cb.checked = checkAll;
        });
        updateLabel();
        return;
      }
      if (ev.target.checked) state.fis.add(ev.target.value);
      else state.fis.delete(ev.target.value);
      // sync toggle-all checkbox
      const allChecked = state.fis.size === values.length;
      const toggle = panel.querySelector('input[value="__toggle_all__"]');
      if (toggle) toggle.checked = allChecked;
      updateLabel();
    });
  }

  function closeAllMultiSelectPanels(exceptContainer) {
    document.querySelectorAll(".multi-select .panel").forEach((p) => {
      const parent = p.closest(".multi-select");
      if (exceptContainer && parent === exceptContainer) return;
      p.setAttribute("hidden", "hidden");
      if (parent) parent.dataset.open = "false";
    });
  }

  if (!document.__sisMultiSelectCloseBound) {
    document.__sisMultiSelectCloseBound = true;
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

    // Setup open/close handlers once
    if (!btn.dataset.handlersAttached) {
      const openPanel = () => {
        closeAllMultiSelectPanels(container);
        panel.removeAttribute("hidden");
        container.dataset.open = "true";
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

    renderMultiSelectSet(msInstance, options.instances, state, "instanceSet", {
      title: "Instances",
      allLabel: "All Instances",
      noneLabel: "No Instances",
    });
    renderMultiSelectSet(msPartner, options.partners, state, "partnerSet", {
      title: "Partners",
      allLabel: "All Partners",
      noneLabel: "No Partners",
    });
    renderMultiSelectSet(msIntegration, options.integrations, state, "integrationSet", {
      title: "Integrations",
      allLabel: "All Integrations",
      noneLabel: "No Integrations",
    });
    renderMultiSelect(msFi, options.fis, state);

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
      });
      renderMultiSelectSet(msIntegration, next.integrations, state, "integrationSet", {
        title: "Integrations",
        allLabel: "All Integrations",
        noneLabel: "No Integrations",
      });
      renderMultiSelect(msFi, next.fis, state);
    };

    const onScopeChange = debounce(() => {
      // Scope selectors only influence the FI list; keep exported strings backwards compatible.
      state.partner = computeEffectiveStringFromSet(state.partnerSet);
      state.integration = computeEffectiveStringFromSet(state.integrationSet);
      state.instance = computeEffectiveStringFromSet(state.instanceSet);
      state.fis.clear();
      state.__fiTouched = false;
      writeQuery(state);
      writeStorage(state);
      refreshOptions();
      applyCb();
    }, 50);

    msInstance.querySelector(".panel").addEventListener("change", onScopeChange);
    msPartner.querySelector(".panel").addEventListener("change", onScopeChange);
    msIntegration.querySelector(".panel").addEventListener("change", onScopeChange);

    msFi.querySelector(".panel").addEventListener("change", () => {
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
    await loadInstanceAllowList();
    const registry = await loadRegistry();
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
      state.canonicalFiInstances = canonicalFiInstances;

      window.__FILTER_STATE = { ...state, canonicalFiInstances };
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
