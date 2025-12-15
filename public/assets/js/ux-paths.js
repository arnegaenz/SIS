/*
  UX Success Paths - Analyze successful session journeys
  Focuses on sessions with successful_jobs > 0 to identify winning patterns
*/

(function() {
  'use strict';

  // ==================== Data Parsing Functions ====================

  /**
   * Parse clickstream to extract page sequence with timestamps
   */
  function parseClickstream(session) {
    const pages = [];
    const clickstream = session.clickstream || [];

    for (const click of clickstream) {
      const url = click.url || '';
      const timestamp = new Date(click.timestamp);

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

  function median(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  function percentile(values, p) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * (p / 100)) - 1;
    return sorted[Math.max(0, index)];
  }

  function avg(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
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

    // Fetch raw session data from the new API endpoint
    const response = await fetch(`/api/sessions/raw?start=${startStr}&end=${endStr}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    let allSessions = data.sessions || [];
    console.log(`Loaded ${allSessions.length} total sessions`);

    // Apply FI/Instance filter if available.
    // IMPORTANT: Do not use canonicalFiInstances membership here because filters.js
    // encodes "All" instance as "__any", which is a wildcard and will never match
    // real raw session instance keys. Mirror the FI-Funnel behavior instead.
    console.log('[UX Paths] Filter state:', {
      hasFilterState: !!filterState,
      fisSize: filterState && filterState.fis ? filterState.fis.size : 0,
      instance: filterState ? filterState.instance : null
    });

    const fiSet =
      filterState && filterState.fis && filterState.fis.size > 0
        ? new Set(Array.from(filterState.fis).map(v => (v || '').toString().trim().toLowerCase()).filter(Boolean))
        : null;
    const instanceFilter =
      filterState && filterState.instance && filterState.instance !== 'All'
        ? (filterState.instance || '').toString().trim().toLowerCase()
        : '';

    if (fiSet && fiSet.size > 0) {
      const beforeFilterCount = allSessions.length;
      allSessions = allSessions.filter(session => {
        const fi = (session.financial_institution_lookup_key || '').toString().trim().toLowerCase();
        if (!fiSet.has(fi)) return false;
        if (instanceFilter) {
          const inst = (session._instance || '').toString().trim().toLowerCase();
          if (inst !== instanceFilter) return false;
        }
        return true;
      });
      console.log(`[UX Paths] Filtered ${beforeFilterCount} sessions to ${allSessions.length} based on FI selection`);
    } else {
      console.log('[UX Paths] No FI filter applied - showing all sessions');
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
      retryPatterns: {},
      highPerformers: []
    };

    // Analyze each successful session
    for (const session of successfulSessions) {
      const pages = parseClickstream(session);
      const pattern = identifyPathPattern(pages);
      const durations = calculatePageDurations(pages);
      const sessionRetries = detectRetries(pages);

      const createdOn = new Date(session.created_on);
      const closedOn = new Date(session.closed_on);
      const sessionDuration = (closedOn - createdOn) / 1000; // seconds

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
      stats.patterns[pattern].sessions.push({
        id: session.id,
        jobs: session.successful_jobs,
        duration: sessionDuration,
        pages: pages
      });

      // Aggregate page durations
      for (const [page, times] of Object.entries(durations)) {
        if (stats.pageDurations[page]) {
          stats.pageDurations[page].push(...times);
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
      }

      // Track high performers (3+ successful jobs)
      if (session.successful_jobs >= 3) {
        stats.highPerformers.push({
          id: session.id,
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
        <td><strong>${patternName}</strong></td>
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
      row.innerHTML = `
        <td>${session.id}</td>
        <td><strong>${session.jobs}</strong></td>
        <td>${formatDuration(session.duration)}</td>
        <td>${session.path}</td>
        <td>${pagesVisited}</td>
      `;
      tbody.appendChild(row);
    }
  }

  function renderTimeAnalysisTable(pageDurations) {
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
        const medianTime = formatDuration(median(times));
        const p90Time = formatDuration(percentile(times, 90));

        const row = document.createElement('tr');
        row.innerHTML = `
          <td><strong>${pageLabels[pageType] || pageType}</strong></td>
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
        <td><strong>${avgJobsAfter}</strong></td>
      `;
      tbody.appendChild(row);
    }
  }

  function renderAllTables(stats) {
    renderMetrics(stats);
    renderPathPatternsTable(stats.patterns, stats.totalSuccessfulSessions);
    renderHighPerformersTable(stats.highPerformers);
    renderTimeAnalysisTable(stats.pageDurations);
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
    refreshData(getDefaultDateRange());
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
