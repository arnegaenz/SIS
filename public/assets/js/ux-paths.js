/*
  UX Success Paths - Analyze successful session journeys
  Focuses on sessions with successful_jobs > 0 to identify winning patterns
*/

(function() {
  'use strict';

  // ==================== JSON Explorer (lazy) ====================
  const uxJsonState = {
    open: false,
    currentTab: "session",
    currentSessionId: null,
    sessionsById: new Map(),
    lastRangeLabel: "",
    rendered: {
      session: null,
      jobs: null,
      clickstream: null,
      placements: null,
    },
  };

  function safeStringify(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return JSON.stringify(
        { error: "Unable to stringify JSON", message: err?.message || String(err) },
        null,
        2
      );
    }
  }

  function pickSessionId(session) {
    return (
      session?.id ??
      session?.agent_session_id ??
      session?.session_id ??
      session?.cuid ??
      null
    );
  }

  function normalizeKey(value) {
    return (value || "").toString().trim().toLowerCase();
  }

  function wireJsonExplorer() {
    const modal = document.getElementById("uxJsonModal");
    if (!modal || modal.__wired) return;
    modal.__wired = true;

    const pre = document.getElementById("uxJsonPre");
    const subtitle = document.getElementById("uxJsonSubtitle");
    const closeBtn = document.getElementById("uxJsonClose");
    const copyBtn = document.getElementById("uxJsonCopy");
    const downloadBtn = document.getElementById("uxJsonDownload");
    const tabs = Array.from(modal.querySelectorAll(".ux-tab[data-tab]"));

    const currentSession = () => {
      const sid = uxJsonState.currentSessionId;
      if (!sid) return null;
      return uxJsonState.sessionsById.get(String(sid)) || null;
    };

    const buildTabJson = (tab, session) => {
      if (!session) return { error: "Session not loaded" };
      if (tab === "jobs") return Array.isArray(session.jobs) ? session.jobs : [];
      if (tab === "clickstream") return Array.isArray(session.clickstream) ? session.clickstream : [];
      if (tab === "placements") return Array.isArray(session.placements_raw) ? session.placements_raw : [];
      const { jobs, clickstream, placements_raw, ...rest } = session;
      return rest;
    };

    const renderIfNeeded = () => {
      if (!uxJsonState.open) return;
      const session = currentSession();
      const tab = uxJsonState.currentTab;
      if (!session) {
        pre.textContent = "No session selected.";
        subtitle.textContent = uxJsonState.lastRangeLabel ? `Range: ${uxJsonState.lastRangeLabel}` : "Select a session from a table.";
        return;
      }
      const sid = String(uxJsonState.currentSessionId);
      subtitle.textContent = `Session: ${sid}${uxJsonState.lastRangeLabel ? ` • Range: ${uxJsonState.lastRangeLabel}` : ""}`;
      if (uxJsonState.rendered[tab] && uxJsonState.rendered[tab].sid === sid) {
        pre.textContent = uxJsonState.rendered[tab].text;
        return;
      }
      const text = safeStringify(buildTabJson(tab, session));
      uxJsonState.rendered[tab] = { sid, text };
      pre.textContent = text;
    };

    const setTab = (tab) => {
      uxJsonState.currentTab = tab;
      tabs.forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === tab ? "true" : "false"));
      renderIfNeeded();
    };

    const close = () => {
      uxJsonState.open = false;
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    };

    const open = () => {
      uxJsonState.open = true;
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      renderIfNeeded();
    };

    tabs.forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));
    closeBtn?.addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    document.addEventListener("keydown", (e) => { if (uxJsonState.open && e.key === "Escape") close(); });

    copyBtn?.addEventListener("click", async () => {
      const text = pre?.textContent || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch {}
        document.body.removeChild(ta);
      }
    });

    downloadBtn?.addEventListener("click", () => {
      const session = currentSession();
      if (!session) return;
      const sid = String(uxJsonState.currentSessionId);
      const payload = buildTabJson(uxJsonState.currentTab, session);
      const blob = new Blob([safeStringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session_${sid}_${uxJsonState.currentTab}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    modal.__openUxJson = open;
    modal.__closeUxJson = close;
    modal.__setUxTab = setTab;
  }

  function openJsonExplorer({ sessionId, focus } = {}) {
    wireJsonExplorer();
    const modal = document.getElementById("uxJsonModal");
    if (!modal) return;
    if (sessionId != null) {
      uxJsonState.currentSessionId = String(sessionId);
      uxJsonState.rendered = { session: null, jobs: null, clickstream: null, placements: null };
    }
    const tab = focus || "session";
    uxJsonState.currentTab = tab;
    const tabs = Array.from(modal.querySelectorAll(".ux-tab[data-tab]"));
    tabs.forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === tab ? "true" : "false"));
    modal.__openUxJson();
  }

  // ==================== Session Details (Troubleshoot-like) ====================
  function escapeHtml(str) {
    return (str || "").toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDateTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d)) return String(value);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function formatDurationMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "";
    if (ms < 1000) return ms + " ms";
    const s = Math.round(ms / 1000);
    if (s < 90) return s + "s";
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }

  function jobBadgeClass(job) {
    if (job && job.is_success) return "success";
    if (job && job.severity === "ux") return "warn";
    if (job && job.severity === "site-failure") return "fail";
    return "neutral";
  }

  function renderClickstream(steps = []) {
    if (!steps || !steps.length) return "";
    const items = steps
      .map((step) => `<span class="click-pill">${escapeHtml(step.url || step.page_title || "step")}</span>`)
      .join("");
    return `<div class="clickstream">${items}</div>`;
  }

  function renderJobs(jobs = []) {
    if (!jobs || !jobs.length) {
      return '<div class="job"><div class="job-meta">No placements/jobs recorded in this session.</div></div>';
    }
    return jobs
      .map((job) => {
        const badgeClass = jobBadgeClass(job);
        return `
          <div class="job">
            <div class="job-header">
              <div class="badge ${badgeClass}">${escapeHtml(job.termination_label || job.termination || "UNKNOWN")}</div>
              <div class="chip muted">${escapeHtml(job.merchant || "merchant")}</div>
              ${job.status ? `<div class="chip muted">${escapeHtml(job.status)}</div>` : ""}
            </div>
            <div class="job-meta">
              ${job.created_on ? `<span>Created ${escapeHtml(formatDateTime(job.created_on))}</span>` : ""}
              ${job.completed_on ? `<span>Completed ${escapeHtml(formatDateTime(job.completed_on))}</span>` : ""}
              ${Number.isFinite(job.duration_ms) ? `<span>Duration ${escapeHtml(formatDurationMs(job.duration_ms))}</span>` : ""}
              ${job.instance ? `<span>Instance ${escapeHtml(job.instance)}</span>` : ""}
            </div>
            ${job.status_message ? `<div class="job-meta">${escapeHtml(job.status_message)}</div>` : ""}
          </div>
        `;
      })
      .join("");
  }

  function renderSessionCard(session, { titlePrefix } = {}) {
    if (!session) return '<div class="session-card"><div class="session-meta">Session not found.</div></div>';
    const sid = String(pickSessionId(session) ?? "");
    const jobs = Array.isArray(session.jobs) ? session.jobs : [];
    const clickstream = Array.isArray(session.clickstream) ? session.clickstream : [];
    const placementsRaw = Array.isArray(session.placements_raw) ? session.placements_raw : [];
    const integrationLabel = session.integration_display || session.integration || session.integration_type || "Unknown integration";
    const partnerLabel = session.partner || "Unknown";

    const jobSuccess = jobs.filter((j) => j && j.is_success).length;
    const jobCount = jobs.length;
    const jobFailure = Math.max(0, jobCount - jobSuccess);

    const headerTitle = titlePrefix ? `${titlePrefix} ${sid}` : `Session ${sid}`;

    return `
      <div class="session-card" data-session-id="${escapeHtml(sid)}">
        <div class="session-top">
          <div class="chip">${escapeHtml(session.fi_name || session.fi_key || "FI")}</div>
          <div class="chip muted">${escapeHtml(session.instance || session._instance || "")}</div>
          <div class="chip muted">${escapeHtml(integrationLabel)}</div>
          <div class="chip muted">${escapeHtml(partnerLabel)}</div>
          <button class="ux-link" type="button" data-ux-json="${escapeHtml(sid)}">Open JSON</button>
        </div>
        <div class="session-meta">
          <span><strong>${escapeHtml(headerTitle)}</strong></span>
          ${session.created_on ? `<span><strong>Opened</strong> ${escapeHtml(formatDateTime(session.created_on))}</span>` : ""}
          ${session.closed_on ? `<span><strong>Closed</strong> ${escapeHtml(formatDateTime(session.closed_on))}</span>` : ""}
          <span><strong>Jobs</strong> ${jobCount} (success ${jobSuccess} / fail ${jobFailure})</span>
          ${session.fi_lookup_key ? `<span><strong>FI lookup key</strong> ${escapeHtml(session.fi_lookup_key)}</span>` : ""}
          ${session.cuid ? `<span><strong>CUID</strong> ${escapeHtml(session.cuid)}</span>` : ""}
        </div>
        ${renderClickstream(clickstream)}
        <div class="jobs">${renderJobs(jobs)}</div>
        <details class="raw-details">
          <summary>Raw session payload</summary>
          <pre class="raw-block">${escapeHtml(safeStringify(session))}</pre>
        </details>
        ${
          placementsRaw.length
            ? `<details class="raw-details">
                <summary>Raw placement payloads (${placementsRaw.length})</summary>
                <pre class="raw-block">${escapeHtml(safeStringify(placementsRaw))}</pre>
              </details>`
            : ""
        }
      </div>
    `;
  }

  function closeInlineDetails(tableEl) {
    if (!tableEl) return;
    const existing = tableEl.querySelectorAll("tr[data-ux-detail-row='1']");
    existing.forEach((tr) => tr.remove());
    const rows = tableEl.querySelectorAll("tr[data-ux-expanded='1']");
    rows.forEach((tr) => tr.removeAttribute("data-ux-expanded"));
  }

  function toggleInlineSession(tableEl, rowEl, sessionId) {
    if (!tableEl || !rowEl) return;
    const sid = String(sessionId || "");
    const tbody = rowEl.closest("tbody");
    if (!tbody) return;

    const next = rowEl.nextElementSibling;
    if (rowEl.getAttribute("data-ux-expanded") === "1" && next && next.getAttribute("data-ux-detail-row") === "1") {
      next.remove();
      rowEl.removeAttribute("data-ux-expanded");
      return;
    }

    closeInlineDetails(tableEl);

    const session = uxJsonState.sessionsById.get(sid) || null;
    const colCount = rowEl.children ? rowEl.children.length : 1;
    const detailRow = document.createElement("tr");
    detailRow.setAttribute("data-ux-detail-row", "1");
    const td = document.createElement("td");
    td.colSpan = colCount || 1;
    td.innerHTML = renderSessionCard(session);
    detailRow.appendChild(td);
    rowEl.insertAdjacentElement("afterend", detailRow);
    rowEl.setAttribute("data-ux-expanded", "1");
  }

  function toggleInlineSessionList(tableEl, rowEl, sessionIds, { title } = {}) {
    if (!tableEl || !rowEl) return;
    const tbody = rowEl.closest("tbody");
    if (!tbody) return;

    const next = rowEl.nextElementSibling;
    if (rowEl.getAttribute("data-ux-expanded") === "1" && next && next.getAttribute("data-ux-detail-row") === "1") {
      next.remove();
      rowEl.removeAttribute("data-ux-expanded");
      return;
    }

    closeInlineDetails(tableEl);

    const ids = Array.isArray(sessionIds) ? sessionIds.slice(0, 3) : [];
    const cards = ids
      .map((sid) => renderSessionCard(uxJsonState.sessionsById.get(String(sid)), { titlePrefix: title ? `${title} • session` : "" }))
      .join("");
    const colCount = rowEl.children ? rowEl.children.length : 1;
    const detailRow = document.createElement("tr");
    detailRow.setAttribute("data-ux-detail-row", "1");
    const td = document.createElement("td");
    td.colSpan = colCount || 1;
    td.innerHTML = `<div class="session-list">${cards || '<div class="session-card"><div class="session-meta">No example sessions available.</div></div>'}</div>`;
    detailRow.appendChild(td);
    rowEl.insertAdjacentElement("afterend", detailRow);
    rowEl.setAttribute("data-ux-expanded", "1");
  }

  // ==================== Data Parsing Functions ====================

  /**
   * Parse clickstream to extract page sequence with timestamps
   */
  function parseClickstream(session) {
    const pages = [];
    const clickstream = Array.isArray(session.clickstream) ? session.clickstream : [];

    for (const click of clickstream) {
      const url = click.url || '';
      const at = click.at || click.timestamp || click.time || null;
      const timestamp = at ? new Date(at) : null;
      if (!timestamp || Number.isNaN(timestamp)) continue;

      let pageType = null;
      if (url.includes('/select-merchants')) pageType = 'SELECT_MERCHANTS';
      else if (url.includes('/user-data-collection')) pageType = 'USER_DATA';
      else if (url.includes('/credential-entry')) pageType = 'CREDENTIAL_ENTRY';

      if (pageType) {
        pages.push({ pageType, timestamp, url });
      }
    }

    return pages;
  }

  /**
   * Identify the path pattern taken by the session
   */
  function identifyPathPattern(pages) {
    if (!pages || pages.length === 0) return 'NO_PAGES';

    const sequence = pages.map(p => p.pageType);
    const uniquePages = [...new Set(sequence)];

    // Check for complete path (SELECT_MERCHANTS + CREDENTIAL_ENTRY)
    const hasSelectMerchants = uniquePages.includes('SELECT_MERCHANTS');
    const hasCredentialEntry = uniquePages.includes('CREDENTIAL_ENTRY');
    const hasUserData = uniquePages.includes('USER_DATA');

    if (hasSelectMerchants && hasCredentialEntry) {
      if (hasUserData) {
        return 'Complete Path (with User Data)';
      } else {
        return 'SSO Path (skip User Data)';
      }
    } else if (hasSelectMerchants || hasCredentialEntry) {
      return 'Partial Path';
    }

    return 'Unknown Path';
  }

  /**
   * Calculate time spent on each page (in seconds)
   */
  function calculatePageDurations(pages) {
    const durations = {};

    for (let i = 0; i < pages.length - 1; i++) {
      const current = pages[i];
      const next = pages[i + 1];
      const duration = (next.timestamp - current.timestamp) / 1000; // seconds

      // Only track reasonable durations (< 30 minutes per page)
      if (duration > 0 && duration < 1800) {
        if (!durations[current.pageType]) durations[current.pageType] = [];
        durations[current.pageType].push(duration);
      }
    }

    return durations;
  }

  /**
   * Detect retry/backtrack patterns
   */
  function detectRetries(pages) {
    const retries = [];

    for (let i = 1; i < pages.length; i++) {
      const prev = pages[i - 1];
      const curr = pages[i];

      // Backtrack: moved to an earlier page in the flow
      if (curr.pageType === 'SELECT_MERCHANTS' && prev.pageType === 'CREDENTIAL_ENTRY') {
        retries.push({ from: 'CREDENTIAL_ENTRY', to: 'SELECT_MERCHANTS' });
      } else if (curr.pageType === 'SELECT_MERCHANTS' && prev.pageType === 'USER_DATA') {
        retries.push({ from: 'USER_DATA', to: 'SELECT_MERCHANTS' });
      } else if (curr.pageType === 'USER_DATA' && prev.pageType === 'CREDENTIAL_ENTRY') {
        retries.push({ from: 'CREDENTIAL_ENTRY', to: 'USER_DATA' });
      }
    }

    return retries;
  }

  // ==================== Statistical Helper Functions ====================

  function median(values, alreadySorted = false) {
    if (!values || values.length === 0) return 0;
    const sorted = alreadySorted ? values : [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  function percentile(values, p, alreadySorted = false) {
    if (!values || values.length === 0) return 0;
    const sorted = alreadySorted ? values : [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * (p / 100)) - 1;
    return sorted[Math.max(0, index)];
  }

  function avg(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  const MAX_DURATION_SAMPLES = 50000;
  function addDurationSamples(bucket, values, seenCounter, key) {
    if (!bucket || !values || !values.length) return;
    const seen = seenCounter || (seenCounter = {});
    if (!Number.isFinite(seen[key])) seen[key] = 0;
    for (const v of values) {
      if (!Number.isFinite(v) || v < 0) continue;
      seen[key] += 1;
      if (bucket.length < MAX_DURATION_SAMPLES) {
        bucket.push(v);
      } else {
        // Reservoir sampling to avoid unbounded memory usage.
        const j = Math.floor(Math.random() * seen[key]);
        if (j < MAX_DURATION_SAMPLES) bucket[j] = v;
      }
    }
  }

  function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  }

  // ==================== Main Analysis Function ====================

  /**
   * Analyze sessions for the given date range
   * ONLY analyzes sessions with successful_jobs > 0
   * Also filters by FI/Instance if filter state is available
   */
  async function analyzeSessions(dateRange, filterState) {
    const { startDate, endDate } = dateRange;

    // Format dates for API
    const formatDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    console.log(`Loading sessions from ${startStr} to ${endStr}...`);

    // Fetch sessions from the same dataset used by Troubleshoot (includes jobs + placements + normalized clickstream).
    // If the shared filter state is narrow enough (single FI), pass it to the server to reduce payload size.
    const qs = new URLSearchParams();
    qs.set("start", startStr);
    qs.set("end", endStr);
    qs.set("includeTests", "true");

    const shared = filterState || null;
    const fis = shared && shared.fis ? Array.from(shared.fis) : [];
    const singleFi = fis.length === 1 ? fis[0] : "__all__";
    const partner = shared && shared.partner && shared.partner !== "All" ? shared.partner : "__all_partners__";
    const integration = shared && shared.integration && shared.integration !== "All" ? shared.integration : "(all)";
    const instance = shared && shared.instance && shared.instance !== "All" ? shared.instance : "__all_instances__";
    qs.set("fi", singleFi);
    qs.set("partner", partner);
    qs.set("integration", integration);
    qs.set("instance", instance);

    const response = await fetch(`/troubleshoot/day?${qs.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    let allSessions = Array.isArray(data.sessions) ? data.sessions : [];
    console.log(`Loaded ${allSessions.length} total sessions`);

    // Cache for JSON explorer (raw dataset returned from troubleshoot endpoint).
    uxJsonState.sessionsById = new Map();
    for (const s of allSessions) {
      const sid = pickSessionId(s);
      if (sid != null) uxJsonState.sessionsById.set(String(sid), s);
    }
    uxJsonState.lastRangeLabel = `${startStr} → ${endStr}`;

    // Apply client-side filters (FI multiselect + instance/partner/integration when not pushed down).
    const fiSet =
      shared && shared.fis && shared.fis.size > 0
        ? new Set(Array.from(shared.fis).map((v) => normalizeKey(v)).filter(Boolean))
        : null;
    const instFilter = shared && shared.instance && shared.instance !== "All" ? normalizeKey(shared.instance) : "";
    const partnerFilter = shared && shared.partner && shared.partner !== "All" ? shared.partner : "";
    const integrationFilter = shared && shared.integration && shared.integration !== "All" ? shared.integration : "";

    if (fiSet || instFilter || partnerFilter || integrationFilter) {
      const before = allSessions.length;
      allSessions = allSessions.filter((session) => {
        if (fiSet && fiSet.size) {
          const fk = normalizeKey(session.fi_key || session.fi_lookup_key || session.financial_institution_lookup_key || "");
          if (!fiSet.has(fk)) return false;
        }
        if (instFilter) {
          const inst = normalizeKey(session.instance || session._instance || "");
          if (inst !== instFilter) return false;
        }
        if (partnerFilter) {
          const p = session.partner || "";
          if (p !== partnerFilter) return false;
        }
        if (integrationFilter) {
          const i = session.integration_display || session.integration || session.integration_type || "";
          if (i !== integrationFilter) return false;
        }
        return true;
      });
      console.log(`[UX Paths] Filtered ${before} sessions → ${allSessions.length} with shared filters`);
    }

    // Filter to ONLY successful sessions
    const successfulSessions = allSessions.filter(s => (s.successful_jobs || 0) > 0);
    console.log(`Found ${successfulSessions.length} successful sessions`);

    // Initialize stats object
    const stats = {
      totalSessions: allSessions.length,
      totalSuccessfulSessions: successfulSessions.length,
      successRate: allSessions.length > 0
        ? (successfulSessions.length / allSessions.length * 100).toFixed(1)
        : 0,
      totalSuccessfulJobs: 0,
      patterns: {},
      pageDurations: {
        SELECT_MERCHANTS: [],
        USER_DATA: [],
        CREDENTIAL_ENTRY: []
      },
      pageDurationSeen: {
        SELECT_MERCHANTS: 0,
        USER_DATA: 0,
        CREDENTIAL_ENTRY: 0,
      },
      retryPatterns: {},
      highPerformers: [],
      examplesByPattern: new Map(),
      examplesByRetry: new Map(),
      examplesByPage: new Map(),
    };

    // Analyze each successful session
    for (const session of successfulSessions) {
      const pages = parseClickstream(session);
      const pattern = identifyPathPattern(pages);
      const durations = calculatePageDurations(pages);
      const sessionRetries = detectRetries(pages);

      let sessionDuration = null;
      if (pages.length >= 2) {
        const first = pages[0].timestamp;
        const last = pages[pages.length - 1].timestamp;
        const d = (last - first) / 1000;
        if (Number.isFinite(d) && d >= 0) sessionDuration = d;
      }
      if (sessionDuration === null) {
        const createdOn = new Date(session.created_on);
        const closedOn = new Date(session.closed_on);
        const d = (closedOn - createdOn) / 1000;
        sessionDuration = Number.isFinite(d) && d >= 0 ? d : 0;
      }

      stats.totalSuccessfulJobs += session.successful_jobs || 0;

      // Track pattern frequency
      if (!stats.patterns[pattern]) {
        stats.patterns[pattern] = {
          count: 0,
          totalSuccessfulJobs: 0,
          totalDuration: 0,
          sessions: []
        };
      }
      stats.patterns[pattern].count++;
      stats.patterns[pattern].totalSuccessfulJobs += session.successful_jobs || 0;
      stats.patterns[pattern].totalDuration += sessionDuration;
      const sessionId = pickSessionId(session);
      if (sessionId != null) {
        if (!stats.examplesByPattern.has(pattern)) stats.examplesByPattern.set(pattern, []);
        const list = stats.examplesByPattern.get(pattern);
        if (list.length < 50) list.push(String(sessionId));
      }
      stats.patterns[pattern].sessions.push({
        id: sessionId,
        jobs: session.successful_jobs,
        duration: sessionDuration,
        pages: pages
      });

      // Aggregate page durations
      for (const [page, times] of Object.entries(durations)) {
        if (stats.pageDurations[page]) {
          addDurationSamples(stats.pageDurations[page], times, stats.pageDurationSeen, page);
        }
        if (times && times.length) {
          const sid = pickSessionId(session);
          if (sid != null) {
            if (!stats.examplesByPage.has(page)) stats.examplesByPage.set(page, []);
            const list = stats.examplesByPage.get(page);
            const sidStr = String(sid);
            if (list.length < 50 && !list.includes(sidStr)) list.push(sidStr);
          }
        }
      }

      // Track retry patterns
      for (const retry of sessionRetries) {
        const key = `${retry.from} → ${retry.to}`;
        if (!stats.retryPatterns[key]) {
          stats.retryPatterns[key] = {
            from: retry.from,
            to: retry.to,
            count: 0,
            totalJobsAfter: 0
          };
        }
        stats.retryPatterns[key].count++;
        stats.retryPatterns[key].totalJobsAfter += session.successful_jobs || 0;
        const sid = pickSessionId(session);
        if (sid != null) {
          if (!stats.examplesByRetry.has(key)) stats.examplesByRetry.set(key, []);
          const list = stats.examplesByRetry.get(key);
          if (list.length < 50) list.push(String(sid));
        }
      }

      // Track high performers (3+ successful jobs)
      if (session.successful_jobs >= 3) {
        stats.highPerformers.push({
          id: pickSessionId(session),
          jobs: session.successful_jobs,
          duration: sessionDuration,
          path: pattern,
          pages: pages
        });
      }
    }

    return stats;
  }

  // ==================== Rendering Functions ====================

  function renderMetrics(stats) {
    // Success overview
    document.getElementById('successfulSessions').textContent = stats.totalSuccessfulSessions;
    document.getElementById('totalSessionsDetail').textContent =
      `${stats.successRate}% of ${stats.totalSessions} total sessions`;

    const avgJobs = stats.totalSuccessfulSessions > 0
      ? (stats.totalSuccessfulJobs / stats.totalSuccessfulSessions).toFixed(1)
      : '0.0';
    document.getElementById('avgJobsPerSession').textContent = avgJobs;

    document.getElementById('highPerformerCount').textContent = stats.highPerformers.length;
  }

  function renderPathPatternsTable(patterns, totalSuccessful) {
    const tbody = document.querySelector('#pathPatternsTable tbody');
    tbody.innerHTML = '';

    if (Object.keys(patterns).length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--muted);">No data available</td></tr>';
      return;
    }

    // Sort patterns by count (descending)
    const sortedPatterns = Object.entries(patterns).sort((a, b) => b[1].count - a[1].count);

    for (const [patternName, data] of sortedPatterns) {
      const avgJobs = data.count > 0 ? (data.totalSuccessfulJobs / data.count).toFixed(1) : '0.0';
      const avgDuration = data.count > 0 ? formatDuration(data.totalDuration / data.count) : '-';
      const percentage = totalSuccessful > 0 ? ((data.count / totalSuccessful) * 100).toFixed(1) : '0.0';

      const row = document.createElement('tr');
      row.innerHTML = `
        <td><button class="ux-link" type="button" data-ux-open-pattern="${patternName}">${patternName}</button></td>
        <td>${data.count}</td>
        <td>${avgJobs}</td>
        <td>${avgDuration}</td>
        <td>${percentage}%</td>
      `;
      tbody.appendChild(row);
    }
  }

  function renderHighPerformersTable(highPerformers) {
    const tbody = document.querySelector('#highPerformersTable tbody');
    tbody.innerHTML = '';

    if (highPerformers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--muted);">No high performer sessions found</td></tr>';
      return;
    }

    // Sort by jobs descending
    const sorted = [...highPerformers].sort((a, b) => b.jobs - a.jobs);

    for (const session of sorted) {
      const pagesVisited = session.pages.length;
      const row = document.createElement('tr');
      const sid = session.id != null ? String(session.id) : '';
      row.innerHTML = `
        <td><button class="ux-link" type="button" data-ux-open-session="${sid}">${sid}</button></td>
        <td><strong>${session.jobs}</strong></td>
        <td>${formatDuration(session.duration)}</td>
        <td>${session.path}</td>
        <td>${pagesVisited}</td>
      `;
      tbody.appendChild(row);
    }
  }

  function renderTimeAnalysisTable(pageDurations, examplesByPage) {
    const tbody = document.querySelector('#timeAnalysisTable tbody');
    tbody.innerHTML = '';

    const pageLabels = {
      SELECT_MERCHANTS: 'Select Merchants',
      USER_DATA: 'User Data Collection',
      CREDENTIAL_ENTRY: 'Credential Entry'
    };

    let hasData = false;

    for (const [pageType, times] of Object.entries(pageDurations)) {
      if (times.length > 0) {
        hasData = true;
        const avgTime = formatDuration(avg(times));
        const sorted = [...times].sort((a, b) => a - b);
        const medianTime = formatDuration(median(sorted, true));
        const p90Time = formatDuration(percentile(sorted, 90, true));
        const examples =
          examplesByPage && examplesByPage.get ? (examplesByPage.get(pageType) || []) : [];
        const example = examples.length ? String(examples[0]) : '';

        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${
            example
              ? `<button class="ux-link" type="button" data-ux-open-session="${example}">${pageLabels[pageType] || pageType}</button>`
              : `<strong>${pageLabels[pageType] || pageType}</strong>`
          }</td>
          <td>${avgTime}</td>
          <td>${medianTime}</td>
          <td>${p90Time}</td>
        `;
        tbody.appendChild(row);
      }
    }

    if (!hasData) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--muted);">No time data available</td></tr>';
    }
  }

  function renderRetryPatternsTable(retryPatterns) {
    const tbody = document.querySelector('#retryPatternsTable tbody');
    tbody.innerHTML = '';

    if (Object.keys(retryPatterns).length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--muted);">No retry patterns found</td></tr>';
      return;
    }

    const pageLabels = {
      SELECT_MERCHANTS: 'Select Merchants',
      USER_DATA: 'User Data Collection',
      CREDENTIAL_ENTRY: 'Credential Entry'
    };

    // Sort by count descending
    const sortedRetries = Object.entries(retryPatterns).sort((a, b) => b[1].count - a[1].count);

    for (const [key, data] of sortedRetries) {
      const avgJobsAfter = data.count > 0 ? (data.totalJobsAfter / data.count).toFixed(1) : '0.0';
      const fromLabel = pageLabels[data.from] || data.from;
      const toLabel = pageLabels[data.to] || data.to;

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${fromLabel}</td>
        <td>${toLabel}</td>
        <td>${data.count}</td>
        <td><button class="ux-link" type="button" data-ux-open-retry="${key}"><strong>${avgJobsAfter}</strong></button></td>
      `;
      tbody.appendChild(row);
    }
  }

  function renderAllTables(stats) {
    window.__UX_PATHS_LAST_STATS = stats;
    renderMetrics(stats);
    renderPathPatternsTable(stats.patterns, stats.totalSuccessfulSessions);
    renderHighPerformersTable(stats.highPerformers);
    renderTimeAnalysisTable(stats.pageDurations, stats.examplesByPage);
    renderRetryPatternsTable(stats.retryPatterns);
  }

  // ==================== Filter Integration ====================

  function getDefaultDateRange() {
    const end = new Date();
    end.setDate(end.getDate() - 1); // Yesterday
    const start = new Date();
    start.setDate(start.getDate() - 8); // Last 7 days
    return { startDate: start, endDate: end };
  }

  function formatDateForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function applyDatePreset(preset) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let start, end;

    switch (preset) {
      case 'last7':
        end = yesterday;
        start = new Date(yesterday);
        start.setDate(start.getDate() - 6);
        break;
      case 'last14':
        end = yesterday;
        start = new Date(yesterday);
        start.setDate(start.getDate() - 13);
        break;
      case 'last30':
        end = yesterday;
        start = new Date(yesterday);
        start.setDate(start.getDate() - 29);
        break;
      case 'last60':
        end = yesterday;
        start = new Date(yesterday);
        start.setDate(start.getDate() - 59);
        break;
      case 'last90':
        end = yesterday;
        start = new Date(yesterday);
        start.setDate(start.getDate() - 89);
        break;
      case 'ytd':
        end = yesterday;
        start = new Date(today.getFullYear(), 0, 1);
        break;
      default:
        return null;
    }

    return { startDate: start, endDate: end };
  }

  async function refreshData(dateRange, filterState) {
    console.log('Refreshing UX Success Paths data for range:', dateRange);

    try {
      const stats = await analyzeSessions(dateRange || getDefaultDateRange(), filterState);
      renderAllTables(stats);
    } catch (err) {
      console.error('Error analyzing sessions:', err);

      // Show error in all tables
      const errorMsg = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--error);">Error loading data. Please try again.</td></tr>';
      document.querySelector('#pathPatternsTable tbody').innerHTML = errorMsg;
      document.querySelector('#highPerformersTable tbody').innerHTML = errorMsg.replace('colspan="5"', 'colspan="5"');
      document.querySelector('#timeAnalysisTable tbody').innerHTML = errorMsg.replace('colspan="5"', 'colspan="4"');
      document.querySelector('#retryPatternsTable tbody').innerHTML = errorMsg.replace('colspan="5"', 'colspan="4"');
    }
  }

  // ==================== FI Filter Integration ====================

  /**
   * Called by filters.js when FI/Instance filters change
   */
  window.applyFilters = function() {
    console.log('UX Paths: Applying FI filters');
    const filterState = window.__FILTER_STATE || null;

    // Get current date range from inputs
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');

    if (startDateInput && endDateInput && startDateInput.value && endDateInput.value) {
      const startDate = new Date(startDateInput.value + 'T00:00:00');
      const endDate = new Date(endDateInput.value + 'T00:00:00');
      refreshData({ startDate, endDate }, filterState);
    } else {
      refreshData(getDefaultDateRange(), filterState);
    }
  };

  // ==================== Initialization ====================

  function init() {
    console.log('UX Success Paths page initialized');

    wireJsonExplorer();

    if (!document.__uxPathsJsonDelegate) {
      document.__uxPathsJsonDelegate = true;
      document.addEventListener("click", (e) => {
        const t = e.target && e.target.closest
          ? e.target.closest("[data-ux-open-session],[data-ux-open-pattern],[data-ux-open-retry]")
          : null;
        if (!t) return;
        if (t.dataset.uxOpenSession) {
          const row = t.closest("tr");
          const table = t.closest("table");
          if (row && table) {
            toggleInlineSession(table, row, t.dataset.uxOpenSession);
            return;
          }
          openJsonExplorer({ sessionId: t.dataset.uxOpenSession, focus: "session" });
          return;
        }
        const stats = window.__UX_PATHS_LAST_STATS || null;
        if (t.dataset.uxOpenPattern) {
          const name = t.dataset.uxOpenPattern;
          const ids = stats && stats.examplesByPattern && stats.examplesByPattern.get
            ? stats.examplesByPattern.get(name)
            : null;
          const row = t.closest("tr");
          const table = t.closest("table");
          if (row && table) {
            toggleInlineSessionList(table, row, ids || [], { title: `Pattern: ${name}` });
            return;
          }
          return;
        }
        if (t.dataset.uxOpenRetry) {
          const key = t.dataset.uxOpenRetry;
          const ids = stats && stats.examplesByRetry && stats.examplesByRetry.get
            ? stats.examplesByRetry.get(key)
            : null;
          const row = t.closest("tr");
          const table = t.closest("table");
          if (row && table) {
            toggleInlineSessionList(table, row, ids || [], { title: `Retry: ${key}` });
            return;
          }
        }
      });
    }

    if (!document.__uxPathsJsonButtonDelegate) {
      document.__uxPathsJsonButtonDelegate = true;
      document.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("[data-ux-json]") : null;
        if (!btn) return;
        openJsonExplorer({ sessionId: btn.getAttribute("data-ux-json"), focus: "session" });
      });
    }

    // Initialize FI filter system
    if (window.initFilters) {
      window.initFilters('ux-paths');
    }

    // Set up date inputs
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const datePresetSelect = document.getElementById('datePreset');
    const applyBtn = document.getElementById('applyBtn');

    if (startDateInput && endDateInput && applyBtn) {
      // Set default values (last 7 days)
      const defaultRange = getDefaultDateRange();
      startDateInput.value = formatDateForInput(defaultRange.startDate);
      endDateInput.value = formatDateForInput(defaultRange.endDate);

      // Handle date preset selection
      if (datePresetSelect) {
        datePresetSelect.addEventListener('change', (e) => {
          const preset = e.target.value;
          if (preset) {
            const range = applyDatePreset(preset);
            if (range) {
              startDateInput.value = formatDateForInput(range.startDate);
              endDateInput.value = formatDateForInput(range.endDate);
            }
          }
        });
      }

      // Handle apply button click
      applyBtn.addEventListener('click', () => {
        const startDate = new Date(startDateInput.value + 'T00:00:00');
        const endDate = new Date(endDateInput.value + 'T00:00:00');
        const filterState = window.__FILTER_STATE || null;
        refreshData({ startDate, endDate }, filterState);
      });

      // Also handle Enter key in date inputs
      const handleEnter = (e) => {
        if (e.key === 'Enter') {
          applyBtn.click();
        }
      };
      startDateInput.addEventListener('keydown', handleEnter);
      endDateInput.addEventListener('keydown', handleEnter);

      // When user manually changes dates, set preset to "Custom"
      const handleManualDateChange = () => {
        if (datePresetSelect) {
          datePresetSelect.value = '';
        }
      };
      startDateInput.addEventListener('change', handleManualDateChange);
      endDateInput.addEventListener('change', handleManualDateChange);
    }

    // Load initial data
    refreshData(getDefaultDateRange(), window.__FILTER_STATE || null);
  }

  // Wait for DOM and dependencies to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.uxPathsDebug = {
    analyzeSessions,
    parseClickstream,
    identifyPathPattern,
    calculatePageDurations,
    detectRetries
  };

})();
