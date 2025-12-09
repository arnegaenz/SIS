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
    gaSection: document.getElementById("gaSection"),
    comparisonSection: document.getElementById("comparisonSection"),
    merchantSection: document.getElementById("merchantSection"),
    gaSelectSso: document.getElementById("gaSelectSso"),
    gaUserSso: document.getElementById("gaUserSso"),
    gaCredSso: document.getElementById("gaCredSso"),
    gaSelectNon: document.getElementById("gaSelectNon"),
    gaUserNon: document.getElementById("gaUserNon"),
    gaCredNon: document.getElementById("gaCredNon"),
    comparisonBody: document.getElementById("comparisonBody"),
    merchantBody: document.getElementById("merchantBody"),
  };

  const state = {
    data: null,
    loading: false,
    gaMetrics: null,
  };
  let earliestAvailableDate = null;
  let latestAvailableDate = null;
  let availableDailyDates = [];
  let availableDailySet = new Set();
  const dailyCache = new Map();
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

  function determineIntegrationGroup(session) {
    // Only trust source.integration field - fallbacks are unreliable
    const integration = session?.source?.integration || "";
    const normalized = integration.toString().trim().toUpperCase();
    if (!normalized) return "nonSso";
    if (normalized === "CU2_SSO" || normalized === "SSO") {
      return "SSO";
    }
    return "nonSso";
  }

  function computeDuration(session) {
    if (!session?.created_on || !session?.closed_on) return null;
    const start = new Date(session.created_on);
    const end = new Date(session.closed_on);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    const diff = end - start;
    return diff >= 0 ? diff : null;
  }

  function getSessionDay(session) {
    const candidate = session.created_on || session.closed_on || session.date;
    if (!candidate) return null;
    const parsed = new Date(candidate);
    if (Number.isNaN(parsed)) return null;
    return parsed.toISOString().slice(0, 10);
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
    const end = todayUTC();
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
    if (els.gaSection) els.gaSection.style.display = "none";
    if (els.comparisonSection) els.comparisonSection.style.display = "none";
    if (els.merchantSection) els.merchantSection.style.display = "none";
    if (els.exportCsvBtn) els.exportCsvBtn.disabled = true;
    renderGAMetrics(null);
  }

  function getDailyCandidates(start, end) {
    const range = enumerateDates(start, end);
    if (!availableDailySet.size) return range;
    return range.filter((day) => availableDailySet.has(day));
  }

  async function loadDailyFile(day) {
    if (!day) return null;

    // Check in-memory cache first
    if (dailyCache.has(day)) return dailyCache.get(day);

    // Check persistent cache
    if (window.DataCache) {
      const cached = window.DataCache.get(`daily_${day}`);
      if (cached) {
        dailyCache.set(day, cached);  // Also store in memory cache
        return cached;
      }
    }

    try {
      const res = await fetch(`/daily?date=${encodeURIComponent(day)}`);
      if (!res.ok) {
        throw new Error(`daily ${day} unavailable (${res.status})`);
      }
      const json = await res.json();
      dailyCache.set(day, json);

      // Store in persistent cache
      if (window.DataCache) {
        window.DataCache.set(`daily_${day}`, json);
      }

      return json;
    } catch (err) {
      console.warn("Unable to load daily GA data", day, err);
      dailyCache.set(day, null);
      return null;
    }
  }

  async function fetchGAMetrics(fiKey, start, end, ssoStartDate) {
    const normalizedKey = normalizeDailyKey(fiKey);
    if (!normalizedKey) return null;
    const days = getDailyCandidates(start, end);
    if (!days.length) return null;
    const totals = {
      sso: { select: 0, user: 0, cred: 0 },
      nonSso: { select: 0, user: 0, cred: 0 },
    };
    const isSsoDay = (day) => {
      if (!ssoStartDate) return false;
      return day >= ssoStartDate;
    };
    for (const day of days) {
      const payload = await loadDailyFile(day);
      if (!payload?.fi || typeof payload.fi !== "object") continue;
      for (const [key, entry] of Object.entries(payload.fi)) {
        if (!key) continue;
        const keyNormalized = key.toString().toLowerCase();
        if (keyNormalized === normalizedKey || keyNormalized.startsWith(`${normalizedKey}__`)) {
          const ga = entry?.ga || {};
          const select = safeNumber(ga.select_merchants);
          const user = safeNumber(ga.user_data_collection);
          const cred = safeNumber(ga.credential_entry);
          if (!select && !user && !cred) continue;
          const bucket = isSsoDay(day) ? totals.sso : totals.nonSso;
          bucket.select += select;
          bucket.user += user;
          bucket.cred += cred;
        }
      }
    }
    return totals;
  }

  function formatGACount(value) {
    if (value === null || value === undefined) return "—";
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString() : "—";
  }

  function renderGAMetrics(metrics) {
    state.gaMetrics = metrics;
    const updateMetric = (el, value) => {
      if (!el) return;
      el.textContent = value === null || value === undefined ? "—" : formatGACount(value);
    };
    const gaSso = metrics?.sso || {};
    const gaNonSso = metrics?.nonSso || {};
    updateMetric(els.gaSelectSso, gaSso.select || null);
    updateMetric(els.gaUserSso, gaSso.user || null);
    updateMetric(els.gaCredSso, gaSso.cred || null);
    updateMetric(els.gaSelectNon, gaNonSso.select || null);
    updateMetric(els.gaUserNon, gaNonSso.user || null);
    updateMetric(els.gaCredNon, gaNonSso.cred || null);

    if (els.gaSection && metrics) {
      els.gaSection.style.display = "";
    }
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
    if (els.comparisonBody) els.comparisonBody.innerHTML = "";
    if (els.merchantBody) els.merchantBody.innerHTML = "";
    state.data = null;
  }

  function buildDeviceSplit(devices, sessionCount) {
    const categories = ["desktop", "mobile", "unknown"];
    return categories.map((cat) => {
      const count = devices[cat] || 0;
      return {
        label: cat,
        pct: sessionCount ? Number(((count / sessionCount) * 100).toFixed(1)) : null,
        count,
      };
    });
  }

  function aggregateSessions(sessions, start, end) {
    const dayList = enumerateDates(start, end);
    const dayMap = dayList.reduce((acc, day) => {
      acc[day] = {
        SSO: { sessions: 0, totalJobs: 0, successJobs: 0, placements: 0 },
        nonSso: { sessions: 0, totalJobs: 0, successJobs: 0, placements: 0 },
      };
      return acc;
    }, {});

    const createBucket = () => ({
      sessions: 0,
      sessionsWithJobs: 0,
      sessionsWithSuccess: 0,
      totalJobs: 0,
      successfulJobs: 0,
      placements: 0,
      durationSum: 0,
      durationCount: 0,
      devices: { desktop: 0, mobile: 0, unknown: 0 },
    });

    const buckets = {
      SSO: createBucket(),
      nonSso: createBucket(),
    };

    const merchantMap = new Map();

    for (const session of sessions) {
      const bucket = determineIntegrationGroup(session);
      const stats = buckets[bucket];
      const totalJobs = safeNumber(session.total_jobs);
      const successfulJobs = safeNumber(session.successful_jobs);
      const placements = Array.isArray(session.placements_raw) ? session.placements_raw.length : 0;
      stats.sessions += 1;
      stats.totalJobs += totalJobs;
      stats.successfulJobs += successfulJobs;
      stats.placements += placements;
      if (totalJobs > 0) {
        stats.sessionsWithJobs += 1;
      }
      if (successfulJobs > 0) {
        stats.sessionsWithSuccess += 1;
      }
      const duration = computeDuration(session);
      if (duration !== null) {
        stats.durationSum += duration;
        stats.durationCount += 1;
      }
      const device = normalizeDevice(session.source?.device);
      stats.devices[device] = (stats.devices[device] || 0) + 1;

      const bucketDay = getSessionDay(session);
      if (bucketDay && dayMap[bucketDay]) {
        const dayStats = dayMap[bucketDay][bucket];
        dayStats.sessions += 1;
        dayStats.totalJobs += totalJobs;
        dayStats.successJobs += successfulJobs;
        dayStats.placements += placements;
      }

      if (totalJobs > 0 && Array.isArray(session.jobs)) {
        const sessionId =
          session.id ||
          session.agent_session_id ||
          session.cuid ||
          `${bucket}-${session.created_on || Math.random()}`;
        session.jobs.forEach((job) => {
          const merchant = job.merchant || "Unknown Merchant";
          const key = merchant.toLowerCase();
          if (!merchantMap.has(key)) {
            merchantMap.set(key, {
              merchant,
              placements: 0,
              SSO: { sessions: new Set(), jobs: 0, successes: 0 },
              nonSso: { sessions: new Set(), jobs: 0, successes: 0 },
            });
          }
          const entry = merchantMap.get(key);
          const bucketEntry = entry[bucket];
          bucketEntry.sessions.add(sessionId);
          bucketEntry.jobs += 1;
          if (job.is_success) {
            bucketEntry.successes += 1;
          }
          entry.placements += 1;
        });
      }
    }

    const totalSessions = buckets.SSO.sessions + buckets.nonSso.sessions;
    const buildKpi = (bucket) => ({
      sessions: bucket.sessions,
      sessionsWithJobs: bucket.sessionsWithJobs,
      sessionsWithSuccess: bucket.sessionsWithSuccess,
      jobSuccessRate:
        bucket.totalJobs > 0 ? (bucket.successfulJobs / bucket.totalJobs) * 100 : 0,
      placements: bucket.placements,
      avgSessionDurationMs:
        bucket.durationCount > 0 ? bucket.durationSum / bucket.durationCount : null,
      deviceSplit: buildDeviceSplit(bucket.devices, bucket.sessions),
      sessionSharePct: totalSessions > 0 ? (bucket.sessions / totalSessions) * 100 : 0,
    });
    const kpis = {
      SSO: buildKpi(buckets.SSO),
      nonSso: buildKpi(buckets.nonSso),
      totalSessions,
    };

    const dailyRows = dayList.map((day) => {
      const bucketDay = dayMap[day];
      return {
        date: day,
        SSO: {
          sessions: bucketDay.SSO.sessions,
          successPct:
            bucketDay.SSO.totalJobs > 0
              ? Number(((bucketDay.SSO.successJobs / bucketDay.SSO.totalJobs) * 100).toFixed(1))
              : null,
          placements: bucketDay.SSO.placements,
        },
        nonSso: {
          sessions: bucketDay.nonSso.sessions,
          successPct:
            bucketDay.nonSso.totalJobs > 0
              ? Number(((bucketDay.nonSso.successJobs / bucketDay.nonSso.totalJobs) * 100).toFixed(1))
              : null,
          placements: bucketDay.nonSso.placements,
        },
      };
    });

    const merchantRows = Array.from(merchantMap.values())
      .map((entry) => {
        const sso = entry.SSO;
        const nonSso = entry.nonSso;
        return {
          merchant: entry.merchant,
          sso: {
            sessions: sso.sessions.size,
            jobs: sso.jobs,
            successPct: sso.jobs ? Number(((sso.successes / sso.jobs) * 100).toFixed(1)) : null,
          },
          nonSso: {
            sessions: nonSso.sessions.size,
            jobs: nonSso.jobs,
            successPct: nonSso.jobs ? Number(((nonSso.successes / nonSso.jobs) * 100).toFixed(1)) : null,
          },
          placements: entry.placements,
        };
      })
      .sort((a, b) => a.merchant.localeCompare(b.merchant));

    return {
      kpis,
      dailyRows,
      merchantRows,
    };
  }

  function formatPercent(value, fallback = "—", decimals = 1) {
    if (value === null || value === undefined || Number.isNaN(value)) return fallback;
    return `${value.toFixed(decimals)}%`;
  }

  function renderComparisonTable(kpis) {
    if (!kpis || !els.comparisonBody) return;

    const sso = kpis.SSO;
    const nonSso = kpis.nonSso;
    const gaMetrics = state.gaMetrics;
    const gaSso = gaMetrics?.sso || {};
    const gaNonSso = gaMetrics?.nonSso || {};

    const formatCount = (val) => (val || 0).toLocaleString();
    const formatPct = (val) => val > 0 ? val.toFixed(1) + "%" : "—";

    const rows = [
      {
        label: "GA Select Merchants",
        ssoCount: formatCount(gaSso.select),
        ssoPct: "—",
        nonCount: formatCount(gaNonSso.select),
        nonPct: "—"
      },
      {
        label: "GA User Data Collection",
        ssoCount: formatCount(gaSso.user),
        ssoPct: formatPct(gaSso.select > 0 ? (gaSso.user / gaSso.select) * 100 : 0),
        nonCount: formatCount(gaNonSso.user),
        nonPct: formatPct(gaNonSso.select > 0 ? (gaNonSso.user / gaNonSso.select) * 100 : 0)
      },
      {
        label: "GA Credential Entry",
        ssoCount: formatCount(gaSso.cred),
        ssoPct: formatPct(gaSso.select > 0 ? (gaSso.cred / gaSso.select) * 100 : 0),
        nonCount: formatCount(gaNonSso.cred),
        nonPct: formatPct(gaNonSso.select > 0 ? (gaNonSso.cred / gaNonSso.select) * 100 : 0)
      },
      {
        label: "Sessions",
        ssoCount: formatCount(sso?.sessions || 0),
        ssoPct: "—",
        nonCount: formatCount(nonSso?.sessions || 0),
        nonPct: "—"
      },
      {
        label: "Sessions with Jobs",
        ssoCount: formatCount(sso?.sessionsWithJobs || 0),
        ssoPct: formatPct(sso?.sessions > 0 ? (sso.sessionsWithJobs / sso.sessions) * 100 : 0),
        nonCount: formatCount(nonSso?.sessionsWithJobs || 0),
        nonPct: formatPct(nonSso?.sessions > 0 ? (nonSso.sessionsWithJobs / nonSso.sessions) * 100 : 0)
      },
      {
        label: "Sessions with Success",
        ssoCount: formatCount(sso?.sessionsWithSuccess || 0),
        ssoPct: formatPct(sso?.sessions > 0 ? (sso.sessionsWithSuccess / sso.sessions) * 100 : 0),
        nonCount: formatCount(nonSso?.sessionsWithSuccess || 0),
        nonPct: formatPct(nonSso?.sessions > 0 ? (nonSso.sessionsWithSuccess / nonSso.sessions) * 100 : 0)
      },
      {
        label: "Placements",
        ssoCount: formatCount(sso?.placements || 0),
        ssoPct: formatPct(gaSso.select > 0 ? ((sso?.placements || 0) / gaSso.select) * 100 : 0),
        nonCount: formatCount(nonSso?.placements || 0),
        nonPct: formatPct(gaNonSso.select > 0 ? ((nonSso?.placements || 0) / gaNonSso.select) * 100 : 0)
      }
    ];

    els.comparisonBody.innerHTML = rows.map(row => `
      <tr>
        <td>${row.label}</td>
        <td class="num">${row.ssoCount}</td>
        <td class="num">${row.ssoPct}</td>
        <td class="num">${row.nonCount}</td>
        <td class="num">${row.nonPct}</td>
      </tr>
    `).join("");

    if (els.comparisonSection) {
      els.comparisonSection.style.display = "";
    }
  }


  function renderMerchantRows(rows) {
    if (!els.merchantBody) return;
    els.merchantBody.innerHTML = "";
    if (!rows || !rows.length) return;
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.merchant}</td>
        <td class="num">${row.sso.sessions || 0}</td>
        <td class="num">${row.sso.jobs || 0}</td>
        <td class="num">${formatPercent(row.sso.successPct)}</td>
        <td class="num">${row.nonSso.sessions || 0}</td>
        <td class="num">${row.nonSso.jobs || 0}</td>
        <td class="num">${formatPercent(row.nonSso.successPct)}</td>
        <td class="num">${row.placements || 0}</td>
      `;
      els.merchantBody?.appendChild(tr);
    });
  }


  function buildDailyCsv(rows, start, end, fiName) {
    const lines = [
      ["Range", `${start} → ${end}`].join(","),
      `FI,${JSON.stringify(fiName || "FI")}`,
      "",
      ["Date", "Bucket", "Sessions", "Success %", "Placements"].join(","),
    ];
    rows.forEach((row) => {
      ["SSO", "nonSso"].forEach((bucket) => {
        const bucketRow = row[bucket];
        const label = bucket === "nonSso" ? "Non-SSO" : bucket;
        lines.push(
          [
            row.date,
            label,
            bucketRow.sessions || 0,
            bucketRow.successPct !== null ? bucketRow.successPct.toFixed(1) : "",
            bucketRow.placements || 0,
          ].join(",")
        );
      });
    });
    return lines.join("\n");
  }

  function buildMerchantCsv(rows, start, end, fiName) {
    const lines = [
      ["Range", `${start} → ${end}`].join(","),
      `FI,${JSON.stringify(fiName || "FI")}`,
      "",
      [
        "Merchant",
        "SSO Sessions",
        "SSO Jobs",
        "SSO Success %",
        "Non-SSO Sessions",
        "Non-SSO Jobs",
        "Non-SSO Success %",
        "Placements",
      ].join(","),
    ];
    rows.forEach((row) => {
        lines.push(
          [
            `"${row.merchant.replace(/"/g, '""')}"`,
            row.sso.sessions || 0,
            row.sso.jobs || 0,
            row.sso.successPct !== null ? row.sso.successPct.toFixed(1) : "",
            row.nonSso.sessions || 0,
            row.nonSso.jobs || 0,
            row.nonSso.successPct !== null ? row.nonSso.successPct.toFixed(1) : "",
            row.placements || 0,
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
    downloadCsv("sources_detail.csv", buildDailyCsv(state.data.dailyRows, state.data.start, state.data.end, state.data.fiName));
    downloadCsv("sources_merchants.csv", buildMerchantCsv(state.data.merchantRows, state.data.start, state.data.end, state.data.fiName));
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
      const aggregated = aggregateSessions(sessions, start, end);
      state.data = {
        ...aggregated,
        start,
        end,
        fiKey,
        fiName: payload.fiName || fiKey || "FI",
      };

      const firstSso = (aggregated.dailyRows || []).find(
        (row) => row.SSO?.sessions > 0
      );
      const ssoStartDate = firstSso?.date || null;
      const gaPromise = fetchGAMetrics(fiKey, start, end, ssoStartDate).catch((err) => {
        console.warn("GA fetch failed", err);
        return null;
      });
      const gaMetrics = await gaPromise;
      renderGAMetrics(gaMetrics);
      renderComparisonTable(aggregated.kpis);
      renderMerchantRows(aggregated.merchantRows);

      // Display SSO start date
      const ssoStartInfo = document.getElementById("ssoStartInfo");
      const ssoStartDateEl = document.getElementById("ssoStartDate");
      if (ssoStartInfo && ssoStartDateEl) {
        if (ssoStartDate) {
          ssoStartDateEl.textContent = ssoStartDate;
          ssoStartInfo.style.display = "";
        } else {
          ssoStartDateEl.textContent = "None detected";
          ssoStartInfo.style.display = "";
        }
      }

      if (els.merchantSection && aggregated.merchantRows?.length > 0) {
        els.merchantSection.style.display = "";
      }

      setStatus(
        `Loaded ${aggregated.kpis.totalSessions || 0} sessions for ${state.data.fiName} (${start} → ${end}).`
      );
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Loading interrupted.");
      } else {
        console.error("Source fetch failed", err);
        setStatus(err.message || "Unable to load source data.");
      }
      state.data = null;
      renderGAMetrics(null);
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
