(() => {
  const els = {
    rangePreset: document.getElementById("rangePreset"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    applyBtn: document.getElementById("applyFilters"),
    exportCsvBtn: document.getElementById("exportCsv"),
    statusMessage: document.getElementById("statusMessage"),
    includeTestDataCheckbox: document.getElementById("includeTest"),
    fiGuard: document.getElementById("fiGuard"),
    loadingBanner: document.getElementById("loadingBanner"),
    sourcesSection: document.getElementById("sourcesSection"),
    sourcesTableBody: document.getElementById("sourcesTableBody"),
    sourcesEmpty: document.getElementById("sourcesEmpty"),
  };

  const state = {
    data: null,
    loading: false,
    gaTotals: null,
  };
  let earliestAvailableDate = null;
  let latestAvailableDate = null;
  let availableDailyDates = [];
  let availableDailySet = new Set();
  let currentController = null;

  function safeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function normalizeDevice(value) {
    if (!value) return "unknown";
    const device = value.toString().toLowerCase();
    if (device.includes("mobile") || device.includes("phone")) return "mobile";
    if (device.includes("desk") || device.includes("web") || device.includes("computer")) return "desktop";
    return "unknown";
  }

  function classifyIntegration(session) {
    const raw =
      session?.source?.integration ||
      session?.integration_raw ||
      session?.integration_display ||
      session?.integration ||
      "";
    const normalized = raw.toString().trim().toUpperCase();
    if (!normalized) return "UNKNOWN";
    if (normalized.includes("SSO")) return "SSO";
    if (normalized === "CU2" || normalized === "CU3") return "NON-SSO";
    if (normalized.includes("NON-SSO") || normalized.includes("NONSSO")) return "NON-SSO";
    return "UNKNOWN";
  }

  function normalizeCategory(value) {
    const str = value ? value.toString().trim() : "";
    return str || null;
  }

  function getSessionId(session) {
    return (
      session?.agent_session_id ||
      session?.id ||
      session?.cuid ||
      `${session?.fi_key || "fi"}-${session?.created_on || Math.random()}`
    );
  }

  function enumerateDates(start, end) {
    const cursor = new Date(`${start}T00:00:00Z`);
    const stop = new Date(`${end}T00:00:00Z`);
    if (Number.isNaN(cursor) || Number.isNaN(stop) || cursor > stop) return [];
    const dates = [];
    let current = new Date(cursor);
    while (current <= stop) {
      dates.push(current.toISOString().slice(0, 10));
      current = new Date(current.getTime() + 86400000);
    }
    return dates;
  }


  function setStatus(message) {
    if (!els.statusMessage) return;
    els.statusMessage.textContent = message || "";
  }

  function setLoading(isLoading, message) {
    state.loading = isLoading;
    if (els.loadingBanner) {
      els.loadingBanner.classList.toggle("visible", isLoading);
    }
    if (els.exportCsvBtn) {
      els.exportCsvBtn.disabled = isLoading || !state.data;
    }
    if (message) {
      setStatus(message);
    }
  }

  function todayUTC() {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  function yesterdayUTC() {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  function formatDateISO(value) {
    if (!(value instanceof Date)) return "";
    return value.toISOString().slice(0, 10);
  }

  function parseIsoDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date) ? null : date;
  }

  function normalizeFiValue(value) {
    const str = value ? value.toString().trim() : "";
    return str || null;
  }

  function normalizeDailyKey(value) {
    const normalized = normalizeFiValue(value);
    return normalized ? normalized.toLowerCase() : "";
  }

  const PRESET_WINDOW = {
    last_7: 7,
    last_30: 30,
    last_90: 90,
  };

  function clampStartDate(candidate) {
    if (!earliestAvailableDate) return candidate;
    const earliest = parseIsoDate(earliestAvailableDate);
    if (!earliest) return candidate;
    return candidate < earliest ? earliest : candidate;
  }

  function setPresetDates(start, end, preset) {
    if (!els.startDate || !els.endDate) return;
    els.startDate.value = formatDateISO(start);
    els.endDate.value = formatDateISO(end);
    if (els.rangePreset && preset) {
      els.rangePreset.value = preset;
    }
  }

  function applyRelativeDays(preset, days, end) {
    const length = Math.max(1, days);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (length - 1));
    setPresetDates(clampStartDate(start), end, preset);
  }

  function applyPreset(preset) {
    if (preset === "custom") return;
    const end = parseIsoDate(latestAvailableDate) || todayUTC();
    if (preset === "today") {
      applyRelativeDays("today", 1, end);
      return;
    }
    if (PRESET_WINDOW[preset]) {
      applyRelativeDays(preset, PRESET_WINDOW[preset], end);
      return;
    }
    if (preset === "ytd") {
      const yearStart = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
      setPresetDates(clampStartDate(yearStart), end, preset);
      return;
    }
    if (preset === "all") {
      const earliest = parseIsoDate(earliestAvailableDate) || end;
      setPresetDates(clampStartDate(earliest), end, preset);
    }
  }

  function initDefaultRange() {
    const end = yesterdayUTC();  // Default to yesterday, not today
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 29);
    setPresetDates(start, end, "last_30");
  }

  function datesValid() {
    const start = els.startDate?.value;
    const end = els.endDate?.value;
    if (!start || !end) return false;
    return start <= end;
  }

  function setRangeToCustom() {
    if (els.rangePreset) {
      els.rangePreset.value = "custom";
    }
  }

  function markDirty() {
    syncApplyEnabled();
  }

  function getSelectedFIs() {
    const shared = window.__FILTER_STATE;
    if (shared?.fis) {
      return Array.from(shared.fis)
        .map(normalizeFiValue)
        .filter(Boolean);
    }
    const container = document.querySelector("#filter-fi");
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => normalizeFiValue(input.value))
      .filter((value) => value && value !== "__toggle_all__");
  }

  function requireSingleFI() {
    const fis = getSelectedFIs();
    if (fis.length === 1) {
      return { ok: true, fi: fis[0] };
    }
    if (fis.length === 0) {
      return { ok: false, reason: "none" };
    }
    return { ok: false, reason: "multiple" };
  }

  function setSingleFIHint(visible) {
    if (!els.fiGuard) return;
    els.fiGuard.style.display = visible ? "block" : "none";
  }

  function clearSourcesUI() {
    if (els.sourcesSection) els.sourcesSection.style.display = "none";
    if (els.sourcesTableBody) els.sourcesTableBody.innerHTML = "";
    if (els.sourcesEmpty) els.sourcesEmpty.style.display = "";
    if (els.exportCsvBtn) els.exportCsvBtn.disabled = true;
    setGATotals(null);
  }

  async function fetchGATotals(fiKey, start, end) {
    const normalizedKey = normalizeDailyKey(fiKey);
    if (!normalizedKey) return null;
    const totals = { select: 0, user: 0, cred: 0 };
    try {
      const res = await fetch(`/daily-range?start=${start}&end=${end}`);
      if (!res.ok) {
        throw new Error(`daily-range unavailable (${res.status})`);
      }
      const payload = await res.json();
      const dayMap = payload?.entries || {};
      const dayList = Array.isArray(payload?.days) && payload.days.length
        ? payload.days
        : Object.keys(dayMap || {});
      for (const day of dayList) {
        const daily = dayMap?.[day];
        if (!daily?.fi || typeof daily.fi !== "object") continue;
        for (const [key, entry] of Object.entries(daily.fi)) {
          if (!key) continue;
          const keyNormalized = key.toString().toLowerCase();
          if (keyNormalized === normalizedKey || keyNormalized.startsWith(`${normalizedKey}__`)) {
            const ga = entry?.ga || {};
            const select = safeNumber(ga.select_merchants);
            const user = safeNumber(ga.user_data_collection);
            const cred = safeNumber(ga.credential_entry);
            if (!select && !user && !cred) continue;
            totals.select += select;
            totals.user += user;
            totals.cred += cred;
          }
        }
      }
    } catch (err) {
      console.warn("Unable to load GA daily-range", err);
      return null;
    }
    return totals;
  }

  function setGATotals(totals) {
    state.gaTotals = totals || null;
  }

  function syncApplyEnabled(explicitGate) {
    const gate = explicitGate || requireSingleFI();
    const validDates = datesValid();
    const ready = gate.ok && validDates;
    if (els.applyBtn) {
      els.applyBtn.disabled = !ready;
    }
    setSingleFIHint(!gate.ok);
    if (els.exportCsvBtn) {
      els.exportCsvBtn.disabled = !gate.ok || !state.data;
    }
    return { gate, ready };
  }

  function clearDisplay() {
    if (els.sourcesTableBody) els.sourcesTableBody.innerHTML = "";
    state.data = null;
  }

  function createMetrics() {
    return {
      sessions: 0,
      sessionsWithJobs: 0,
      sessionsWithSuccess: 0,
      placements: 0,
      sessionIds: new Set(),
    };
  }

  function addSessionMetrics(node, sessionMetrics, sessionId, placementCount) {
    if (!node || !sessionMetrics) return;
    if (!node.metrics.sessionIds.has(sessionId)) {
      node.metrics.sessionIds.add(sessionId);
      node.metrics.sessions += 1;
      if (sessionMetrics.sessionsWithJobs) node.metrics.sessionsWithJobs += 1;
      if (sessionMetrics.sessionsWithSuccess) node.metrics.sessionsWithSuccess += 1;
    }
    if (Number.isFinite(placementCount)) {
      node.metrics.placements += placementCount;
    }
  }

  function getSessionMetrics(session) {
    const jobs = Array.isArray(session.jobs) ? session.jobs : [];
    const totalJobs = safeNumber(session.total_jobs || jobs.length);
    const successfulJobs = safeNumber(
      session.successful_jobs || jobs.filter((job) => job.is_success).length
    );
    const placements = Array.isArray(session.placements_raw) ? session.placements_raw.length : 0;
    return {
      sessionsWithJobs: totalJobs > 0,
      sessionsWithSuccess: successfulJobs > 0,
      placements,
    };
  }

  function collectCategoryStats(session) {
    const placements = Array.isArray(session.placements_raw) ? session.placements_raw : [];
    const categories = new Map();
    placements.forEach((placement) => {
      const category = normalizeCategory(placement?.source?.category);
      if (!category) return;
      const subCategory = normalizeCategory(placement?.source?.sub_category);
      if (!categories.has(category)) {
        categories.set(category, { placements: 0, subCategories: new Map() });
      }
      const entry = categories.get(category);
      entry.placements += 1;
      if (subCategory) {
        entry.subCategories.set(subCategory, (entry.subCategories.get(subCategory) || 0) + 1);
      }
    });

    if (!categories.size) {
      const category = normalizeCategory(session?.source?.category);
      if (category) {
        const subCategory = normalizeCategory(session?.source?.sub_category);
        const entry = { placements: 0, subCategories: new Map() };
        if (subCategory) {
          entry.subCategories.set(subCategory, 0);
        }
        categories.set(category, entry);
      }
    }

    return categories;
  }

  function createNode(label, level) {
    return {
      label,
      level,
      metrics: createMetrics(),
      devices: new Map(),
      categories: new Map(),
      subCategories: new Map(),
    };
  }

  function buildHierarchy(sessions) {
    const overall = createNode("Overall", 0);
    const integrations = new Map();

    sessions.forEach((session) => {
      const integration = classifyIntegration(session);
      const device = normalizeDevice(session?.source?.device);
      const sessionId = getSessionId(session);
      const metrics = getSessionMetrics(session);

      addSessionMetrics(overall, metrics, sessionId, metrics.placements);

      if (!integrations.has(integration)) {
        integrations.set(integration, createNode(integration, 1));
      }
      const integrationNode = integrations.get(integration);
      addSessionMetrics(integrationNode, metrics, sessionId, metrics.placements);

      if (!integrationNode.devices.has(device)) {
        integrationNode.devices.set(device, createNode(device, 2));
      }
      const deviceNode = integrationNode.devices.get(device);
      addSessionMetrics(deviceNode, metrics, sessionId, metrics.placements);

      const categories = collectCategoryStats(session);
      if (!categories.size) return;

      for (const [category, entry] of categories.entries()) {
        if (!deviceNode.categories.has(category)) {
          deviceNode.categories.set(category, createNode(category, 3));
        }
        const categoryNode = deviceNode.categories.get(category);
        addSessionMetrics(categoryNode, metrics, sessionId, entry.placements);

        for (const [subCategory, count] of entry.subCategories.entries()) {
          if (!categoryNode.subCategories.has(subCategory)) {
            categoryNode.subCategories.set(subCategory, createNode(subCategory, 4));
          }
          const subNode = categoryNode.subCategories.get(subCategory);
          addSessionMetrics(subNode, metrics, sessionId, count);
        }
      }
    });

    return { overall, integrations };
  }

  function formatPercent(value, fallback = "—", decimals = 1) {
    if (value === null || value === undefined || Number.isNaN(value)) return fallback;
    return `${value.toFixed(decimals)}%`;
  }

  function formatCount(value) {
    if (value === null || value === undefined) return "—";
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString() : "—";
  }

  function renderSourcesTable(rows) {
    if (!els.sourcesTableBody || !els.sourcesSection || !els.sourcesEmpty) return;
    els.sourcesTableBody.innerHTML = "";
    if (!rows.length) {
      els.sourcesSection.style.display = "";
      els.sourcesEmpty.style.display = "";
      return;
    }
    els.sourcesSection.style.display = "";
    els.sourcesEmpty.style.display = "none";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.className = `sources-row level-${row.level}`;
      tr.innerHTML = `
        <td>${row.label}</td>
        <td class="num">${row.ga?.select ?? "—"}</td>
        <td class="num">${row.ga?.user ?? "—"}</td>
        <td class="num">${row.ga?.cred ?? "—"}</td>
        <td class="num">${row.gaSelUserPct ?? "—"}</td>
        <td class="num">${row.gaSelCredPct ?? "—"}</td>
        <td class="num">${row.gaSelSuccessPct ?? "—"}</td>
        <td class="num">${row.sessions}</td>
        <td class="num">${row.sessionsWithJobs}</td>
        <td class="num">${row.sessionsWithJobsPct}</td>
        <td class="num">${row.sessionsWithSuccess}</td>
        <td class="num">${row.sessionsWithSuccessPct}</td>
        <td class="num">${row.placements}</td>
      `;
      els.sourcesTableBody.appendChild(tr);
    });
  }

  function buildRow(node, label, level, gaTotals) {
    const sessions = node.metrics.sessions || 0;
    const sessionsWithJobs = node.metrics.sessionsWithJobs || 0;
    const sessionsWithSuccess = node.metrics.sessionsWithSuccess || 0;
    const placements = node.metrics.placements || 0;
    const ga = gaTotals
      ? {
          select: formatCount(gaTotals.select || 0),
          user: formatCount(gaTotals.user || 0),
          cred: formatCount(gaTotals.cred || 0),
        }
      : null;
    const gaSelUserPct =
      gaTotals && gaTotals.select > 0
        ? formatPercent((gaTotals.user / gaTotals.select) * 100, "—")
        : "—";
    const gaSelCredPct =
      gaTotals && gaTotals.select > 0
        ? formatPercent((gaTotals.cred / gaTotals.select) * 100, "—")
        : "—";
    const gaSelSuccessPct =
      gaTotals && gaTotals.select > 0
        ? formatPercent((sessionsWithSuccess / gaTotals.select) * 100, "—")
        : "—";

    return {
      label,
      level,
      _raw: {
        ga_select: gaTotals ? gaTotals.select || 0 : null,
        ga_user: gaTotals ? gaTotals.user || 0 : null,
        ga_cred: gaTotals ? gaTotals.cred || 0 : null,
        sessions,
        sessionsWithJobs,
        sessionsWithSuccess,
        placements,
        gaSelUserPct:
          gaTotals && gaTotals.select > 0 ? (gaTotals.user / gaTotals.select) * 100 : null,
        gaSelCredPct:
          gaTotals && gaTotals.select > 0 ? (gaTotals.cred / gaTotals.select) * 100 : null,
        gaSelSuccessPct:
          gaTotals && gaTotals.select > 0
            ? (sessionsWithSuccess / gaTotals.select) * 100
            : null,
        sessionsWithJobsPct: sessions ? (sessionsWithJobs / sessions) * 100 : null,
        sessionsWithSuccessPct: sessions ? (sessionsWithSuccess / sessions) * 100 : null,
      },
      ga,
      gaSelUserPct,
      gaSelCredPct,
      gaSelSuccessPct,
      sessions: formatCount(sessions),
      sessionsWithJobs: formatCount(sessionsWithJobs),
      sessionsWithJobsPct: sessions
        ? formatPercent((sessionsWithJobs / sessions) * 100, "—")
        : "—",
      sessionsWithSuccess: formatCount(sessionsWithSuccess),
      sessionsWithSuccessPct: sessions
        ? formatPercent((sessionsWithSuccess / sessions) * 100, "—")
        : "—",
      placements: formatCount(placements),
    };
  }

  function sortKeysWithOrder(keys, order) {
    const orderMap = new Map(order.map((value, idx) => [value, idx]));
    return Array.from(keys).sort((a, b) => {
      const aIdx = orderMap.has(a) ? orderMap.get(a) : Number.MAX_SAFE_INTEGER;
      const bIdx = orderMap.has(b) ? orderMap.get(b) : Number.MAX_SAFE_INTEGER;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.localeCompare(b);
    });
  }

  function buildRowsFromHierarchy(hierarchy, gaTotals) {
    const rows = [];
    rows.push(buildRow(hierarchy.overall, "Overall", 0, gaTotals));

    const integrationOrder = ["SSO", "NON-SSO", "CardSavr", "TEST", "UNKNOWN"];
    const deviceOrder = ["desktop", "mobile", "unknown"];
    const integrations = sortKeysWithOrder(hierarchy.integrations.keys(), integrationOrder);

    integrations.forEach((integrationKey) => {
      const integrationNode = hierarchy.integrations.get(integrationKey);
      rows.push(buildRow(integrationNode, `Integration: ${integrationKey}`, 1, null));

      const devices = sortKeysWithOrder(integrationNode.devices.keys(), deviceOrder);
      devices.forEach((deviceKey) => {
        const deviceNode = integrationNode.devices.get(deviceKey);
        rows.push(buildRow(deviceNode, `Device: ${deviceKey}`, 2, null));

        const categories = Array.from(deviceNode.categories.keys()).sort((a, b) =>
          a.localeCompare(b)
        );
        categories.forEach((categoryKey) => {
          const categoryNode = deviceNode.categories.get(categoryKey);
          rows.push(buildRow(categoryNode, `Category: ${categoryKey}`, 3, null));

          const subCategories = Array.from(categoryNode.subCategories.keys()).sort((a, b) =>
            a.localeCompare(b)
          );
          subCategories.forEach((subKey) => {
            const subNode = categoryNode.subCategories.get(subKey);
            rows.push(buildRow(subNode, `Sub-category: ${subKey}`, 4, null));
          });
        });
      });
    });

    return rows;
  }




  function buildRollupCsv(rows, start, end, fiName) {
    const lines = [
      ["Range", `${start} → ${end}`].join(","),
      `FI,${JSON.stringify(fiName || "FI")}`,
      "",
      [
        "Level",
        "Source",
        "GA select",
        "GA user",
        "GA cred",
        "sel→user %",
        "sel→cred %",
        "sel→success %",
        "sessions",
        "sess w/jobs",
        "sess→jobs %",
        "sess w/success",
        "sess→success %",
        "placements",
      ].join(","),
    ];
    rows.forEach((row) => {
      const raw = row._raw || {};
      lines.push(
        [
          row.level,
          JSON.stringify(row.label || ""),
          raw.ga_select ?? "",
          raw.ga_user ?? "",
          raw.ga_cred ?? "",
          raw.gaSelUserPct !== null && raw.gaSelUserPct !== undefined ? raw.gaSelUserPct.toFixed(1) : "",
          raw.gaSelCredPct !== null && raw.gaSelCredPct !== undefined ? raw.gaSelCredPct.toFixed(1) : "",
          raw.gaSelSuccessPct !== null && raw.gaSelSuccessPct !== undefined ? raw.gaSelSuccessPct.toFixed(1) : "",
          raw.sessions ?? 0,
          raw.sessionsWithJobs ?? 0,
          raw.sessionsWithJobsPct !== null && raw.sessionsWithJobsPct !== undefined
            ? raw.sessionsWithJobsPct.toFixed(1)
            : "",
          raw.sessionsWithSuccess ?? 0,
          raw.sessionsWithSuccessPct !== null && raw.sessionsWithSuccessPct !== undefined
            ? raw.sessionsWithSuccessPct.toFixed(1)
            : "",
          raw.placements ?? 0,
        ].join(",")
      );
    });
    return lines.join("\n");
  }

  function downloadCsv(filename, contents) {
    const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportCsv() {
    if (!state.data) return;
    downloadCsv(
      "sources_rollup.csv",
      buildRollupCsv(state.data.rows, state.data.start, state.data.end, state.data.fiName)
    );
  }

  function buildQueryParams(start, end, fiKey) {
    const params = new URLSearchParams({
      start,
      end,
      fi: fiKey,
    });
    const shared = window.__FILTER_STATE || {};
    const integration =
      shared.integration && shared.integration !== "All" ? shared.integration : "(all)";
    const partner =
      shared.partner && shared.partner !== "All" ? shared.partner : "__all_partners__";
    const instance =
      shared.instance && shared.instance !== "All" ? shared.instance : "__all_instances__";
    params.set("integration", integration);
    params.set("partner", partner);
    params.set("instance", instance);
    params.set("includeTests", els.includeTestDataCheckbox?.checked ? "true" : "false");
    return params;
  }

  function abortFetch() {
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
  }

  async function checkAndRefreshIncompleteDates(startDate, endDate) {
    try {
      // Check which dates need refetching
      const response = await fetch(`/api/check-raw-data?start=${startDate}&end=${endDate}`);
      if (!response.ok) {
        console.warn('[Sources] Could not check raw data status');
        return;
      }

      const { datesToRefetch } = await response.json();

      if (datesToRefetch.length > 0) {
        console.log(`[Sources] Auto-fetching ${datesToRefetch.length} incomplete dates:`, datesToRefetch);

        // Trigger refresh via SSE endpoint
        const eventSource = new EventSource(
          `/run-update/stream?start=${startDate}&end=${endDate}&autoRefetch=1`
        );

        eventSource.addEventListener('complete', () => {
          console.log('[Sources] Auto-refresh complete');
          eventSource.close();
        });

        eventSource.addEventListener('error', (e) => {
          console.error('[Sources] Auto-refresh error:', e);
          eventSource.close();
        });

        // Wait for the refresh to complete
        await new Promise((resolve) => {
          eventSource.addEventListener('complete', resolve);
          eventSource.addEventListener('error', resolve);
        });
      }
    } catch (err) {
      console.error('[Sources] Error checking incomplete dates:', err);
    }
  }

  async function fetchSources() {
    const { gate, ready } = syncApplyEnabled();
    if (!gate.ok || !ready) {
      clearSourcesUI();
      return;
    }
    const fiKey = gate.fi;
    const start = els.startDate?.value;
    const end = els.endDate?.value;
    if (!start) {
      setStatus("Choose a start date.");
      return;
    }
    if (!end) {
      setStatus("Choose an end date.");
      return;
    }
    if (new Date(start) > new Date(end)) {
      setStatus("Start date must be on or before end date.");
      return;
    }

    // Check and refresh incomplete dates first
    await checkAndRefreshIncompleteDates(start, end);

    clearDisplay();
    setLoading(true, "Loading data…");
    abortFetch();
    const controller = new AbortController();
    currentController = controller;
    try {
      const params = buildQueryParams(start, end, fiKey);
      const res = await fetch(`/troubleshoot/day?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const payload = await res.json();
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      const hierarchy = sessions.length ? buildHierarchy(sessions) : null;
      const gaTotals = await fetchGATotals(fiKey, start, end).catch((err) => {
        console.warn("GA fetch failed", err);
        return null;
      });
      setGATotals(gaTotals);
      const rows = hierarchy ? buildRowsFromHierarchy(hierarchy, gaTotals) : [];
      state.data = {
        rows,
        start,
        end,
        fiKey,
        fiName: payload.fiName || fiKey || "FI",
      };
      renderSourcesTable(rows);
      if (!sessions.length) {
        setStatus(`No sessions found for ${state.data.fiName} (${start} → ${end}).`);
      } else {
        setStatus(
          `Loaded ${sessions.length} sessions for ${state.data.fiName} (${start} → ${end}).`
        );
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Loading interrupted.");
      } else {
        console.error("Source fetch failed", err);
        setStatus(err.message || "Unable to load source data.");
      }
      state.data = null;
      setGATotals(null);
    } finally {
      currentController = null;
      setLoading(false);
    }
  }

  function handleFilterChange() {
    const { gate, ready } = syncApplyEnabled();
    if (!gate.ok || !ready) {
      clearSourcesUI();
    }
    if (state.loading) {
      abortFetch();
      setLoading(true, "Filters changed; apply to refresh.");
      clearDisplay();
    }
  }

  async function loadDateRange() {
    availableDailyDates = [];
    availableDailySet = new Set();
    try {
      const res = await fetch("/list-daily");
      const json = await res.json();
      const rawDays = (json?.days || json?.files || []).sort();
      const days = rawDays
        .map((file) => file.replace(/\.json$/i, ""))
        .filter(Boolean);
      availableDailyDates = days.slice();
      availableDailySet = new Set(days);
      const latest = days[days.length - 1] || "";
      const earliest = days[0] || "";
      earliestAvailableDate = earliest || null;
      latestAvailableDate = latest || null;
      if (els.startDate) {
        els.startDate.min = earliest;
        els.startDate.max = latest;
      }
      if (els.endDate) {
        els.endDate.min = earliest;
        els.endDate.max = latest;
      }
    } catch (err) {
      console.warn("Unable to load daily list", err);
    } finally {
      applyPreset("last_30");
      markDirty();
    }
  }

  function attachApplyButton() {
    els.applyBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      fetchSources();
    });
    els.exportCsvBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!state.data) return;
      exportCsv();
    });
  }

  function attachDateListeners() {
    els.rangePreset?.addEventListener("change", (event) => {
      const preset = event.target.value;
      if (preset === "custom") {
        setRangeToCustom();
        markDirty();
        return;
      }
      applyPreset(preset);
      markDirty();
    });
    [els.startDate, els.endDate].forEach((input) =>
      input?.addEventListener("change", () => {
        setRangeToCustom();
        markDirty();
      })
    );
    els.includeTestDataCheckbox?.addEventListener("change", markDirty);
  }

  function attachFilterEvents() {
    const tryAttach = () => {
      const panel = document.querySelector("#filter-fi .panel");
      if (!panel) {
        const wrapper = document.querySelector("#filter-fi");
        if (!wrapper) {
          requestAnimationFrame(tryAttach);
          return;
        }
        requestAnimationFrame(tryAttach);
        return;
      }
      panel.addEventListener("change", () => {
        markDirty();
      });
    };
    tryAttach();
  }

  const originalApplyFilters = window.applyFilters;
  window.applyFilters = (...args) => {
    originalApplyFilters?.(...args);
    handleFilterChange();
  };

  initDefaultRange();
  markDirty();
  loadDateRange().finally(() => {
    attachApplyButton();
    attachDateListeners();
    attachFilterEvents();
    if (window.initFilters) {
      window.initFilters("sources");
    }
    const { gate, ready } = syncApplyEnabled();
    if (!gate.ok || !ready) {
      clearSourcesUI();
    }
  });
})();
