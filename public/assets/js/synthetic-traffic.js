(function () {
  var JOBS_ENDPOINT = "/api/synth/jobs";
  var POLL_MS = 7000;
  var form = document.getElementById("synthJobForm");
  var statusEl = document.getElementById("formStatus");
  var jobsStatus = document.getElementById("jobsStatus");
  var jobsBody = document.getElementById("jobsBody");
  var modeSelect = document.getElementById("modeSelect");
  var jobsCount = document.getElementById("jobsCount");
  var activeOnlyToggle = document.getElementById("activeOnlyToggle");
  var demoPreset = document.getElementById("demoPreset");
  var sourceSubcategoryInput = document.getElementById("sourceSubcategory");
  var sourceSubcategoryHint = document.getElementById("sourceSubcategoryHint");
  var createJobButton = document.getElementById("createJobButton");
  var activeOnly = false;
  var jobModal = document.getElementById("jobModal");
  var jobModalBody = document.getElementById("jobModalBody");
  var jobModalSubtitle = document.getElementById("jobModalSubtitle");
  var cancelModal = document.getElementById("cancelModal");
  var cancelModalSubtitle = document.getElementById("cancelModalSubtitle");
  var cancelConfirmInput = document.getElementById("cancelConfirmInput");
  var cancelConfirmButton = document.getElementById("cancelConfirmButton");
  var cancelConfirmHint = document.getElementById("cancelConfirmHint");
  var pendingCancelJobId = null;
  var activeDemoPreset = null;
  var latestJobs = [];
  var sessionDataCache = {};

  var options = {
    fiHostEnv: ["argfcu", "orb_prod"],
    integrationFlow: ["embedded_sso", "embedded_nosso", "overlay_sso", "overlay_nosso"],
    testCardPreset: ["default", "jack_skellington", "pepper_potts"],
    sourceType: ["email", "navigation", "push_notification", "promo", "qr_code", "sms", "test"],
    sourceCategory: ["activation", "card_controls", "campaign", "other"]
  };

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.style.color = isError ? "#f87171" : "var(--muted)";
  }

  function setJobsStatus(message, isError) {
    if (!jobsStatus) return;
    jobsStatus.textContent = message || "";
    jobsStatus.style.color = isError ? "#f87171" : "var(--muted)";
  }

  function populateSelect(id, values) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = "";
    values.forEach(function (val) {
      var opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      el.appendChild(opt);
    });
  }

  function toggleModeFields() {
    var mode = modeSelect ? modeSelect.value : "one_shot";
    var fields = document.querySelectorAll("[data-mode]");
    fields.forEach(function (field) {
      var shouldShow = field.getAttribute("data-mode") === mode;
      field.style.display = shouldShow ? "flex" : "none";
    });
  }

  function isSsoFlow(value) {
    return (value || "").toString().toLowerCase().indexOf("_sso") !== -1;
  }

  function setRateFieldDisabled(inputId, disabled) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var combo = input.closest(".rate-combo");
    var toggle = combo ? combo.querySelector(".rate-toggle") : null;
    var list = combo ? combo.querySelector(".rate-list") : null;
    input.disabled = disabled;
    if (toggle) toggle.disabled = disabled;
    if (disabled && list) list.classList.remove("open");
  }

  function toggleUserDataAbandon() {
    var flow = document.getElementById("integrationFlow");
    var input = document.getElementById("abandonUserData");
    if (!flow || !input) return;
    if (isSsoFlow(flow.value)) {
      if (!activeDemoPreset || activeDemoPreset.integration !== "sso") {
        input.value = "0";
      }
      setRateFieldDisabled("abandonUserData", true);
    } else {
      setRateFieldDisabled("abandonUserData", false);
    }
    updateFunnelCascade();
  }

  /**
   * Cascading disable: if an upstream abandon rate is 100%, all downstream fields are disabled.
   * Select Merchant 100% → disables User Data, Cred Entry, Success, Fail
   * User Data 100% → disables Cred Entry, Success, Fail
   * Cred Entry 100% → disables Success, Fail (but really just Fail since success is implied 0)
   */
  function updateFunnelCascade() {
    var selectVal = parseFloat(document.getElementById("abandonSelectMerchant")?.value) || 0;
    var userVal = parseFloat(document.getElementById("abandonUserData")?.value) || 0;
    var credVal = parseFloat(document.getElementById("abandonCredentialEntry")?.value) || 0;
    var userDisabledBySSO = document.getElementById("abandonUserData")?.disabled || false;

    // Select Merchant at 100% → everything downstream disabled
    if (selectVal >= 100) {
      if (!userDisabledBySSO) setRateFieldDisabled("abandonUserData", true);
      setRateFieldDisabled("abandonCredentialEntry", true);
      setRateFieldDisabled("successRate", true);
      setRateFieldDisabled("failRate", true);
      updateCredNoInteractionBadge();
      return;
    }

    // Re-enable User Data if not SSO-disabled
    if (!userDisabledBySSO) setRateFieldDisabled("abandonUserData", false);

    // User Data at 100% → cred entry, success, fail disabled
    if (userVal >= 100) {
      setRateFieldDisabled("abandonCredentialEntry", true);
      setRateFieldDisabled("successRate", true);
      setRateFieldDisabled("failRate", true);
      updateCredNoInteractionBadge();
      return;
    }

    // Re-enable Cred Entry
    setRateFieldDisabled("abandonCredentialEntry", false);

    // Cred Entry at 100% → success, fail disabled
    if (credVal >= 100) {
      setRateFieldDisabled("successRate", true);
      setRateFieldDisabled("failRate", true);
      updateCredNoInteractionBadge();
      return;
    }

    // Re-enable success and fail
    setRateFieldDisabled("successRate", false);
    setRateFieldDisabled("failRate", false);

    updateCredNoInteractionBadge();
  }

  function updateCredNoInteractionBadge() {
    var badge = document.getElementById("credNoInteractionBadge");
    var input = document.getElementById("abandonCredentialEntry");
    if (!badge || !input) return;
    var show = parseFloat(input.value) >= 100 && !input.disabled;
    badge.style.display = show ? "" : "none";
  }

  function setSubcategoryHint(message) {
    if (!sourceSubcategoryHint) return;
    sourceSubcategoryHint.textContent = message || "";
  }

  function validateSourceSubcategory() {
    var value = sourceSubcategoryInput ? sourceSubcategoryInput.value.trim() : "";
    var isValid = value.length > 0;
    if (sourceSubcategoryInput) {
      if (!isValid) sourceSubcategoryInput.classList.add("input-error");
      else sourceSubcategoryInput.classList.remove("input-error");
    }
    setSubcategoryHint(isValid ? "" : "Source subcategory is required for synthetic jobs.");
    if (createJobButton) createJobButton.disabled = !isValid;
    return isValid;
  }

  function formatDateTime(value) {
    if (!value) return "—";
    var dt = new Date(value);
    if (isNaN(dt.getTime())) return "—";
    return dt.toLocaleString();
  }

  function formatNextRun(job) {
    if (!job) return "—";
    var status = (job.status || "").toString().toLowerCase();
    if (status === "paused") return "Paused";
    var nextRun = formatDateTime(job.next_run_at);
    if (status === "running") {
      var lastRun = job.last_run_at ? new Date(job.last_run_at) : null;
      var nextRunDate = job.next_run_at ? new Date(job.next_run_at) : null;
      var runsPerDay = Number(job.runs_per_day) || 0;
      if (runsPerDay > 0 && lastRun && !isNaN(lastRun.getTime())) {
        var intervalMs = Math.max(1, Math.round(86400000 / runsPerDay));
        var estimated = new Date(lastRun.getTime() + intervalMs);
        if (!nextRunDate || isNaN(nextRunDate.getTime()) || nextRunDate < lastRun) {
          return formatDateTime(estimated.toISOString());
        }
      }
      return nextRun !== "—" ? nextRun : "In progress";
    }
    return nextRun;
  }

  function escapeHtml(value) {
    return (value || "")
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/\'/g, "&#39;");
  }

  function statusPill(status, isDue) {
    var normalized = (status || "queued").toString().toLowerCase();
    var label = normalized || "queued";
    var className = "pill";
    if (normalized === "canceled" || normalized === "failed") className += " warn";
    if (normalized === "completed") className += " muted";
    if (normalized === "paused") className += " paused";
    if (isDue && normalized !== "running" && normalized !== "paused") label = "queued";
    return '<span class="' + className + '">' + escapeHtml(label) + "</span>";
  }

  function buildActionButton(action, jobId, label, svgMarkup) {
    return (
      '<button class="icon-btn" type="button" data-action="' + action + '" data-id="' + escapeHtml(jobId) + '"' +
      ' aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">' +
      svgMarkup +
      "</button>"
    );
  }

  function buildJobRow(job) {
    var name = job.job_name || job.source_subcategory || "Unnamed job";
    var id = job.id || "";
    var status = statusPill(job.status, job.due);
    var normalized = (job.status || "queued").toString().toLowerCase();
    var actions = [];
    if (normalized === "paused") {
      actions.push(
        buildActionButton(
          "continue",
          id,
          "Continue",
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>'
        )
      );
      actions.push(
        buildActionButton(
          "cancel",
          id,
          "Cancel",
          '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6l-12 12"></path></svg>'
        )
      );
    } else if (normalized === "queued" || normalized === "running" || job.due) {
      actions.push(
        buildActionButton(
          "pause",
          id,
          "Pause",
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"></path></svg>'
        )
      );
      actions.push(
        buildActionButton(
          "cancel",
          id,
          "Cancel",
          '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6l-12 12"></path></svg>'
        )
      );
    }
    if ((job.attempted || 0) > 0) {
      var eyeCls = sessionDataCache[id] === true ? "icon-btn eye-has-data"
        : sessionDataCache[id] === false ? "icon-btn eye-no-data"
        : "icon-btn eye-pending";
      actions.push(
        '<button class="' + eyeCls + '" type="button" data-action="viewSessions" data-id="' + escapeHtml(id) + '"' +
        ' aria-label="View Sessions" title="View Sessions">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' +
        "</button>"
      );
    }
    var actionHtml = actions.length
      ? actions.join("")
      : '<span class="pill muted">—</span>';

    return (
      "<tr>" +
        '<td><div class="job-meta"><button class="job-link" type="button" data-action="detail" data-id="' + escapeHtml(id) + '">' + escapeHtml(name) + "</button>" +
        '<span class="job-id">' + escapeHtml(id) + "</span></div></td>" +
        "<td>" + status + "</td>" +
        "<td>" + escapeHtml(formatDateTime(job.created_at)) + "</td>" +
        "<td>" + escapeHtml(formatDateTime(job.last_run_at)) + "</td>" +
        "<td>" + escapeHtml(formatNextRun(job)) + "</td>" +
        "<td>" + escapeHtml(job.end_date || "—") + "</td>" +
        "<td>" + escapeHtml(job.attempted || 0) + "</td>" +
        "<td>" + escapeHtml(job.placements_success || 0) + "</td>" +
        "<td>" + escapeHtml(job.placements_failed || 0) + "</td>" +
        '<td class="job-actions">' + actionHtml + "</td>" +
      "</tr>"
    );
  }

  function isActiveJob(job) {
    var normalized = (job?.status || "queued").toString().toLowerCase();
    return normalized !== "completed" && normalized !== "canceled";
  }

  function renderJobs(list) {
    if (!jobsBody) return;
    latestJobs = list || [];
    var total = latestJobs.length;
    var filtered = activeOnly ? latestJobs.filter(isActiveJob) : latestJobs.slice();
    var filteredTotal = filtered.length;
    var visible = filtered;
    if (!visible.length) {
      var emptyLabel = activeOnly && total ? "No active jobs." : "No jobs yet.";
      jobsBody.innerHTML = '<tr><td colspan="10">' + emptyLabel + "</td></tr>";
      if (jobsCount) {
        jobsCount.textContent = activeOnly && total
          ? "Showing 0 active jobs (" + total + " total)."
          : "Showing 0 jobs.";
      }
      return;
    }
    jobsBody.innerHTML = visible.map(buildJobRow).join("");
    if (jobsCount) {
      if (activeOnly) {
        var suffix = total !== filteredTotal ? " (" + total + " total)." : ".";
        jobsCount.textContent = "Showing " + visible.length + " of " + filteredTotal + " active jobs" + suffix;
      } else {
        jobsCount.textContent = "Showing " + visible.length + " of " + total + " jobs.";
      }
    }
    checkSessionData(visible);
  }

  function checkSessionData(jobs) {
    var toCheck = jobs.filter(function (j) {
      return (j.attempted || 0) > 0 && sessionDataCache[j.id] === undefined;
    });
    if (!toCheck.length) return;
    toCheck.forEach(function (job) {
      sessionDataCache[job.id] = null; // mark in-flight
      fetch(JOBS_ENDPOINT + "/" + encodeURIComponent(job.id) + "/sessions?count_only=true&max_days=30")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          sessionDataCache[job.id] = !!data.has_data;
          updateEyeIcon(job.id, data.has_data);
        })
        .catch(function () {});
    });
  }

  function updateEyeIcon(jobId, hasData) {
    var btn = document.querySelector('[data-action="viewSessions"][data-id="' + jobId + '"]');
    if (!btn) return;
    btn.classList.remove("eye-pending", "eye-has-data", "eye-no-data");
    btn.classList.add(hasData ? "eye-has-data" : "eye-no-data");
  }

  function getJobById(jobId) {
    return (latestJobs || []).find(function (job) {
      return job && job.id === jobId;
    });
  }

  function openJobModal(job) {
    if (!jobModal || !jobModalBody) return;
    var items = [
      ["Status", job.status || "queued"],
      ["Mode", job.mode || ""],
      ["FI Host", job.fi_host_env || ""],
      ["Integration Flow", job.integration_flow || ""],
      ["Test Card Preset", job.test_card_preset || ""],
      ["Source Type", job.source_type || ""],
      ["Source Category", job.source_category || ""],
      ["Source Subcategory", job.source_subcategory || ""],
      ["Total Runs", job.total_runs || ""],
      ["Runs Per Day", job.runs_per_day || ""],
      ["End Date", job.end_date || ""],
      ["Success Rate", (job.target_success_rate ?? "") + "%"],
      ["Fail Rate", (job.target_fail_rate ?? "") + "%"],
      ["Select Merchant Abandon", (job.abandon_select_merchant_rate ?? "") + "%"],
      ["User Data Abandon", (job.abandon_user_data_rate ?? "") + "%"],
      ["Credential Entry Abandon", (job.abandon_credential_entry_rate ?? "") + "%"],
      ["Created At", formatDateTime(job.created_at)],
      ["Last Run", formatDateTime(job.last_run_at)],
      ["Next Run", formatDateTime(job.next_run_at)]
    ];
    jobModalBody.innerHTML = items
      .map(function (item) {
        return (
          '<div class="detail-item">' +
            '<div class="detail-label">' + escapeHtml(item[0]) + "</div>" +
            "<div>" + escapeHtml(item[1]) + "</div>" +
          "</div>"
        );
      })
      .join("");
    if (jobModalSubtitle) {
      jobModalSubtitle.textContent = (job.job_name || job.id || "").toString();
    }
    jobModal.classList.add("open");
    jobModal.setAttribute("aria-hidden", "false");
  }

  function closeJobModal() {
    if (!jobModal) return;
    jobModal.classList.remove("open");
    jobModal.setAttribute("aria-hidden", "true");
  }

  function openCancelModal(job) {
    if (!cancelModal || !job || !job.id) return;
    pendingCancelJobId = job.id;
    if (cancelModalSubtitle) {
      var label = (job?.job_name || job?.id || "").toString();
      cancelModalSubtitle.textContent = label ? label : "Job cancellation";
    }
    if (cancelConfirmInput) {
      cancelConfirmInput.value = "";
    }
    if (cancelConfirmHint) {
      cancelConfirmHint.textContent = "Confirmation required.";
    }
    if (cancelConfirmButton) {
      cancelConfirmButton.disabled = true;
    }
    cancelModal.classList.add("open");
    cancelModal.setAttribute("aria-hidden", "false");
    if (cancelConfirmInput) cancelConfirmInput.focus();
  }

  function closeCancelModal() {
    if (!cancelModal) return;
    cancelModal.classList.remove("open");
    cancelModal.setAttribute("aria-hidden", "true");
    pendingCancelJobId = null;
  }

  function updateCancelState() {
    if (!cancelConfirmInput || !cancelConfirmButton || !cancelConfirmHint) return;
    var matches = cancelConfirmInput.value.trim().toLowerCase() === "cancel";
    cancelConfirmButton.disabled = !matches;
    cancelConfirmHint.textContent = matches ? "Ready to cancel." : "Confirmation required.";
  }

  function getPayload() {
    return {
      fi_host_env: document.getElementById("fiHostEnv").value,
      integration_flow: document.getElementById("integrationFlow").value,
      test_card_preset: document.getElementById("testCardPreset").value,
      source_type: document.getElementById("sourceType").value.trim(),
      source_category: document.getElementById("sourceCategory").value.trim(),
      source_subcategory: document.getElementById("sourceSubcategory").value.trim(),
      mode: document.getElementById("modeSelect").value,
      total_runs: document.getElementById("totalRuns").value,
      runs_per_day: document.getElementById("runsPerDay").value,
      end_date: document.getElementById("endDate").value,
      target_success_rate: document.getElementById("successRate").value,
      target_fail_rate: document.getElementById("failRate").value,
      abandon_select_merchant_rate: document.getElementById("abandonSelectMerchant").value,
      abandon_user_data_rate: document.getElementById("abandonUserData").disabled
        ? 0
        : document.getElementById("abandonUserData").value,
      abandon_credential_entry_rate: document.getElementById("abandonCredentialEntry").value
    };
  }

  function validateRates(payload) {
    var success = Number(payload.target_success_rate) || 0;
    var fail = Number(payload.target_fail_rate) || 0;
    return success + fail <= 100;
  }

  function updateRateValidation() {
    var payload = getPayload();
    var isValid = validateRates(payload);
    var inputs = [
      document.getElementById("successRate"),
      document.getElementById("failRate")
    ];
    inputs.forEach(function (input) {
      if (!input) return;
      if (!isValid) input.classList.add("input-error");
      else input.classList.remove("input-error");
    });
    if (!isValid) {
      setStatus("Success + fail must be 100% or less.", true);
    } else if (statusEl && statusEl.textContent.indexOf("Success + fail") === 0) {
      setStatus("Ready.");
    }
    return isValid;
  }

  function roundRate(value) {
    return Math.round(value * 10) / 10;
  }

  function setRateValue(id, value) {
    var input = document.getElementById(id);
    if (input) input.value = String(value);
  }

  function computeReachCredential(totalConversion, credentialSuccess) {
    if (!credentialSuccess) return 0;
    return totalConversion / credentialSuccess;
  }

  function setSuccessBounds(targetSuccess) {
    // No longer enforces min/max bounds on the input — success + fail <= 100 is the only constraint
    var input = document.getElementById("successRate");
    if (!input) return;
    input.removeAttribute("min");
    input.max = "100";
    input.removeAttribute("title");
  }

  function clampSuccessRate() {
    if (!activeDemoPreset) return;
    var input = document.getElementById("successRate");
    var fail = document.getElementById("failRate");
    if (!input) return;
    var value = Number(input.value);
    if (value > 100) { value = 100; input.value = "100"; }
    if (value < 0) { value = 0; input.value = "0"; }
    if (fail) {
      var nextFail = Math.max(0, Math.round((100 - value) * 10) / 10);
      fail.value = String(nextFail);
    }
  }

  function resolveIntegrationFlow(targetMode) {
    var flow = document.getElementById("integrationFlow");
    var current = flow ? flow.value : "";
    var prefix = current.indexOf("overlay") === 0 ? "overlay" : "embedded";
    return prefix + "_" + targetMode;
  }

  function applyDemoPreset(presetKey) {
    if (!presetKey) {
      activeDemoPreset = null;
      setSuccessBounds(null);
      return;
    }

    // Synthetic / Demo Defaults
    var presets = {
      aggressive_card_activation: {
        integration: "sso",
        sourceType: "push_notification",
        sourceCategory: "activation",
        sourceSubcategoryHint: "post_activation",
        mode: "campaign",
        runsPerDay: 48,
        durationDays: 7,
        abandonSelect: 60,
        abandonUser: 1,
        abandonCredential: 1,
        success: 45,
        fail: 55
      },
      normal_card_activation: {
        integration: "sso",
        sourceType: "email",
        sourceCategory: "activation",
        sourceSubcategoryHint: "replacement_or_expiration",
        mode: "campaign",
        runsPerDay: 24,
        durationDays: 14,
        abandonSelect: 74,
        abandonUser: 2,
        abandonCredential: 2,
        success: 42,
        fail: 58
      },
      base_card_controls: {
        integration: "sso",
        sourceType: "navigation",
        sourceCategory: "card_controls",
        sourceSubcategoryHint: "manage_card_controls",
        mode: "campaign",
        runsPerDay: 12,
        durationDays: 30,
        abandonSelect: 83,
        abandonUser: 2,
        abandonCredential: 2,
        success: 42,
        fail: 58
      },
      standard_sso: {
        integration: "sso",
        sourceType: "navigation",
        sourceCategory: "card_controls",
        sourceSubcategoryHint: "routine_card_management",
        mode: "campaign",
        runsPerDay: 24,
        durationDays: 60,
        abandonSelect: 86,
        abandonUser: 2,
        abandonCredential: 2,
        success: 42,
        fail: 58
      },
      marketing_push: {
        integration: "nosso",
        sourceType: "promo",
        sourceCategory: "campaign",
        sourceSubcategoryHint: "seasonal_offer",
        mode: "campaign",
        runsPerDay: 72,
        durationDays: 5,
        abandonSelect: 92,
        abandonUser: 75,
        abandonCredential: 60,
        success: 38,
        fail: 62
      },
      assisted_card_update: {
        integration: "nosso",
        sourceType: "qr_code",
        sourceCategory: "activation",
        sourceSubcategoryHint: "branch_qr_assisted",
        mode: "campaign",
        runsPerDay: 8,
        durationDays: 21,
        abandonSelect: 95,
        abandonUser: 80,
        abandonCredential: 65,
        success: 38,
        fail: 62
      },
      test: {
        integration: "sso",
        sourceType: "test",
        sourceCategory: "other",
        sourceSubcategoryHint: "test",
        mode: "campaign",
        runsPerDay: 25,
        durationDays: 2,
        abandonSelect: 0,
        abandonUser: 0,
        abandonCredential: 0,
        success: 50,
        fail: 50
      }
    };

    var preset = presets[presetKey];
    if (!preset) return;

    activeDemoPreset = {
      key: presetKey,
      integration: preset.integration,
      success: preset.success
    };

    var flow = document.getElementById("integrationFlow");
    if (flow) {
      flow.value = resolveIntegrationFlow(preset.integration === "sso" ? "sso" : "nosso");
    }
    var sourceType = document.getElementById("sourceType");
    var sourceCategory = document.getElementById("sourceCategory");
    if (sourceType) sourceType.value = preset.sourceType || "";
    if (sourceCategory) sourceCategory.value = preset.sourceCategory || "";
    if (sourceSubcategoryInput) {
      sourceSubcategoryInput.value = "";
      sourceSubcategoryInput.placeholder = preset.sourceSubcategoryHint || "Required";
    }
    var mode = document.getElementById("modeSelect");
    var runsPerDay = document.getElementById("runsPerDay");
    var endDate = document.getElementById("endDate");
    if (mode && preset.mode) {
      mode.value = preset.mode;
      toggleModeFields();
    }
    if (runsPerDay && preset.runsPerDay) {
      runsPerDay.value = String(preset.runsPerDay);
    }
    if (endDate && preset.durationDays) {
      var today = new Date();
      var end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
      end.setUTCDate(end.getUTCDate() + Math.max(0, preset.durationDays - 1));
      endDate.value = end.toISOString().slice(0, 10);
    }

    setRateValue("abandonSelectMerchant", preset.abandonSelect);
    setRateValue("abandonUserData", preset.abandonUser);
    setRateValue("abandonCredentialEntry", preset.abandonCredential);
    setRateValue("successRate", preset.success);
    setRateValue("failRate", preset.fail);
    setSuccessBounds(preset.success);
    clampSuccessRate();
    toggleUserDataAbandon();
    updateRateValidation();
    validateSourceSubcategory();
  }

  function buildRateOptions(listEl, inputEl, extras) {
    listEl.innerHTML = "";
    if (extras) {
      extras.forEach(function (ex) {
        var option = document.createElement("div");
        option.className = "rate-option";
        option.textContent = ex.label;
        option.dataset.value = String(ex.value);
        option.style.fontStyle = "italic";
        option.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
        option.addEventListener("click", function (evt) {
          var next = evt.currentTarget.dataset.value;
          inputEl.value = next;
          closeRateList(listEl);
          updateRateValidation();
          updateFunnelCascade();
        });
        listEl.appendChild(option);
      });
    }
    for (var val = 0; val <= 100; val += 5) {
      var option = document.createElement("div");
      option.className = "rate-option";
      option.textContent = val + "%";
      option.dataset.value = String(val);
      option.addEventListener("click", function (evt) {
        var next = evt.currentTarget.dataset.value;
        inputEl.value = next;
        closeRateList(listEl);
        updateRateValidation();
        updateFunnelCascade();
      });
      listEl.appendChild(option);
    }
  }

  function closeRateList(listEl) {
    if (listEl) listEl.classList.remove("open");
  }

  function openRateList(listEl) {
    if (listEl) listEl.classList.add("open");
  }

  function setupRateCombos() {
    var combos = document.querySelectorAll("[data-rate-combo]");
    combos.forEach(function (combo) {
      var input = combo.querySelector("[data-rate-combo-input]");
      var toggle = combo.querySelector("[data-rate-combo-toggle]");
      var list = combo.querySelector("[data-rate-combo-list]");
      if (!input || !toggle || !list) return;
      var extras = null;
      if (input.id === "abandonCredentialEntry") {
        extras = [{ label: "No interaction", value: 100 }];
      }
      buildRateOptions(list, input, extras);
      toggle.addEventListener("click", function (evt) {
        evt.preventDefault();
        evt.stopPropagation();
        if (input.disabled) return;
        if (list.classList.contains("open")) closeRateList(list);
        else openRateList(list);
      });
      input.addEventListener("blur", function () {
        setTimeout(function () {
          closeRateList(list);
        }, 120);
      });
      input.addEventListener("input", function () {
        updateRateValidation();
        updateFunnelCascade();
      });
      combo.addEventListener("click", function (evt) {
        evt.stopPropagation();
      });
    });

    document.addEventListener("click", function () {
      document.querySelectorAll("[data-rate-combo-list].open").forEach(closeRateList);
    });
  }

  async function submitJob(evt) {
    evt.preventDefault();
    var payload = getPayload();
    if (!validateSourceSubcategory()) {
      setStatus("Source subcategory is required for synthetic jobs.", true);
      return;
    }
    if (!updateRateValidation()) return;
    setStatus("Saving job...");
    try {
      var res = await fetch(JOBS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok) {
        setStatus(data && data.error ? data.error : "Unable to save job.", true);
        return;
      }
      setStatus("Job created.");
      await refreshJobs();
    } catch (err) {
      setStatus("Failed to create job.", true);
    }
  }

  async function refreshJobs() {
    setJobsStatus("Refreshing...");
    try {
      var res = await fetch(JOBS_ENDPOINT);
      var data = await res.json();
      if (!res.ok) {
        setJobsStatus(data && data.error ? data.error : "Unable to load jobs.", true);
        return;
      }
      var jobs = data && data.jobs ? data.jobs : [];
      renderJobs(jobs);
      setJobsStatus("Last updated " + new Date().toLocaleTimeString() + ".");
    } catch (err) {
      setJobsStatus("Unable to load jobs.", true);
    }
  }

  async function cancelJob(jobId) {
    if (!jobId) return;
    setJobsStatus("Canceling job...");
    try {
      var res = await fetch(JOBS_ENDPOINT + "/" + encodeURIComponent(jobId) + "/cancel", {
        method: "POST"
      });
      var data = await res.json();
      if (!res.ok) {
        setJobsStatus(data && data.error ? data.error : "Unable to cancel job.", true);
        return;
      }
      setJobsStatus("Job canceled.");
      await refreshJobs();
    } catch (err) {
      setJobsStatus("Unable to cancel job.", true);
    }
  }

  async function pauseJob(jobId) {
    if (!jobId) return;
    setJobsStatus("Pausing job...");
    try {
      var res = await fetch(JOBS_ENDPOINT + "/" + encodeURIComponent(jobId) + "/pause", {
        method: "POST"
      });
      var data = await res.json();
      if (!res.ok) {
        setJobsStatus(data && data.error ? data.error : "Unable to pause job.", true);
        return;
      }
      setJobsStatus("Job paused.");
      await refreshJobs();
    } catch (err) {
      setJobsStatus("Unable to pause job.", true);
    }
  }

  async function continueJob(jobId) {
    if (!jobId) return;
    setJobsStatus("Resuming job...");
    try {
      var res = await fetch(JOBS_ENDPOINT + "/" + encodeURIComponent(jobId) + "/continue", {
        method: "POST"
      });
      var data = await res.json();
      if (!res.ok) {
        setJobsStatus(data && data.error ? data.error : "Unable to resume job.", true);
        return;
      }
      setJobsStatus("Job resumed.");
      await refreshJobs();
    } catch (err) {
      setJobsStatus("Unable to resume job.", true);
    }
  }

  function handleTableClick(evt) {
    var target = evt.target;
    if (!target) return;
    var button = target.closest("[data-action]");
    if (!button) return;
    var action = button.getAttribute("data-action");
    var jobId = button.getAttribute("data-id");
    if (action === "cancel") {
      openCancelModal(getJobById(jobId));
      return;
    }
    if (action === "pause") {
      pauseJob(jobId);
      return;
    }
    if (action === "continue") {
      continueJob(jobId);
      return;
    }
    if (action === "viewSessions") {
      var sjob = getJobById(jobId);
      if (sjob) openSessionsModal(sjob);
      return;
    }
    if (action === "detail") {
      var job = getJobById(jobId);
      if (job) openJobModal(job);
    }
  }

  // ── Sessions modal ────────────────────────────────────────
  var sessionsModal = document.getElementById("sessionsModal");
  var sessionsModalBody = document.getElementById("sessionsModalBody");
  var sessionsModalSubtitle = document.getElementById("sessionsModalSubtitle");

  function openSessionsModal(job) {
    if (!sessionsModal || !sessionsModalBody) return;
    var name = job.job_name || job.source_subcategory || job.id || "";
    var parts = [escapeHtml(name)];
    if (job.source_type) parts.push(escapeHtml(job.source_type));
    if (job.source_category) parts.push(escapeHtml(job.source_category));
    if (job.source_subcategory) parts.push(escapeHtml(job.source_subcategory));
    if (sessionsModalSubtitle) sessionsModalSubtitle.innerHTML = parts.join(" &middot; ");
    sessionsModalBody.innerHTML = '<div class="sessions-loading"><div class="sessions-spinner"></div> Loading sessions&hellip;</div>';
    sessionsModal.classList.add("open");
    sessionsModal.setAttribute("aria-hidden", "false");
    fetchJobSessions(job.id, 30);
  }

  function closeSessionsModal() {
    if (!sessionsModal) return;
    sessionsModal.classList.remove("open");
    sessionsModal.setAttribute("aria-hidden", "true");
  }

  function fetchJobSessions(jobId, maxDays) {
    var url = JOBS_ENDPOINT + "/" + encodeURIComponent(jobId) + "/sessions";
    if (maxDays) url += "?max_days=" + maxDays;
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        renderSessionsResult(data, jobId);
      })
      .catch(function (err) {
        renderSessionsError(err);
      });
  }

  function renderSessionsError(err) {
    if (!sessionsModalBody) return;
    sessionsModalBody.innerHTML =
      '<div class="sessions-empty">Failed to load sessions: ' + escapeHtml(err.message || "Unknown error") + "</div>";
  }

  function renderSessionsResult(data, jobId) {
    if (!sessionsModalBody) return;
    var html = [];

    // Source filter badges
    var sf = data.source_filter || {};
    var filterParts = [];
    if (sf.type) filterParts.push('<span class="source-badge">type: ' + escapeHtml(sf.type) + "</span>");
    if (sf.category) filterParts.push('<span class="source-badge">cat: ' + escapeHtml(sf.category) + "</span>");
    if (sf.sub_category) filterParts.push('<span class="source-badge">sub: ' + escapeHtml(sf.sub_category) + "</span>");
    var dr = data.date_range || {};
    filterParts.push('<span class="source-badge muted">' + escapeHtml(dr.start || "?") + " \u2192 " + escapeHtml(dr.end || "?") + "</span>");
    if (data.truncated) filterParts.push('<span class="source-badge muted">showing last ' + data.days_scanned + " of " + data.total_days + " days</span>");
    html.push('<div class="source-filter-bar">' + filterParts.join("") + "</div>");

    // Summary
    var sm = data.summary || {};
    html.push(
      '<div class="sessions-summary">' +
        renderSummaryItem(sm.sessions, "Sessions") +
        renderSummaryItem(sm.sessions_with_success, "w/ Success") +
        renderSummaryItem(sm.jobs, "Total Jobs") +
        renderSummaryItem(sm.jobs_success, "Successful") +
        renderSummaryItem(sm.jobs_failure, "Failed") +
      "</div>"
    );

    // Counter comparison (job counters vs raw data)
    var jc = data.job_counters || {};
    html.push(
      '<div class="sessions-compare">' +
        renderCompareItem("Attempted", jc.attempted, sm.sessions) +
        renderCompareItem("Success", jc.success, sm.jobs_success) +
        renderCompareItem("Failed", jc.failed, sm.jobs_failure) +
      "</div>"
    );

    // Session cards
    var sessions = data.sessions || [];
    if (sessions.length === 0) {
      html.push('<div class="sessions-empty">No matching sessions found in raw data.</div>');
    } else {
      for (var i = 0; i < sessions.length; i++) {
        html.push(renderSessionCard(sessions[i]));
      }
    }

    // Load more
    if (data.truncated) {
      html.push(
        '<div class="sessions-load-more">' +
          '<button type="button" onclick="(function(b){b.disabled=true;b.textContent=\'Loading...\';})(this)" ' +
          'data-load-more="' + escapeHtml(jobId) + '" data-max-days="' + (data.total_days || 90) + '">' +
          "Load all " + data.total_days + " days" +
        "</button></div>"
      );
    }

    sessionsModalBody.innerHTML = html.join("");

    // Bind load-more
    var loadMoreBtn = sessionsModalBody.querySelector("[data-load-more]");
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", function () {
        var jid = loadMoreBtn.getAttribute("data-load-more");
        var md = parseInt(loadMoreBtn.getAttribute("data-max-days") || "90", 10);
        fetchJobSessions(jid, md);
      });
    }
  }

  function renderSummaryItem(value, label) {
    return (
      '<div class="summary-stat">' +
        '<div class="stat-value">' + escapeHtml(value != null ? value : 0) + "</div>" +
        '<div class="stat-label">' + escapeHtml(label) + "</div>" +
      "</div>"
    );
  }

  function renderCompareItem(label, jobVal, rawVal) {
    var match = jobVal === rawVal;
    var cls = match ? "compare-match" : "compare-mismatch";
    var icon = match ? "\u2713" : "\u2717";
    return (
      '<div class="compare-item">' +
        '<span class="' + cls + '">' + icon + "</span> " +
        escapeHtml(label) + ": job=" + escapeHtml(jobVal != null ? jobVal : "?") +
        " raw=" + escapeHtml(rawVal != null ? rawVal : "?") +
      "</div>"
    );
  }

  function jobBadgeClass(job) {
    if (job.is_success) return "success";
    if (job.severity === "ux") return "warn";
    if (job.severity === "site-failure") return "failure";
    return "neutral";
  }

  function formatDurationMs(ms) {
    if (!ms || isNaN(ms)) return null;
    var secs = Math.round(ms / 1000);
    if (secs < 60) return secs + "s";
    var mins = Math.floor(secs / 60);
    return mins + "m " + (secs % 60) + "s";
  }

  function renderSessionCard(s) {
    // Toggle header: FI name + pills + job outcome badge
    var headerPills = [];
    if (s.instance) headerPills.push('<span class="session-pill">' + escapeHtml(s.instance) + "</span>");
    if (s.integration_display) headerPills.push('<span class="session-pill">' + escapeHtml(s.integration_display) + "</span>");
    if (s.partner) headerPills.push('<span class="session-pill">' + escapeHtml(s.partner) + "</span>");
    if (s.is_test) headerPills.push('<span class="session-pill" style="color:#eab308">TEST</span>');
    var jobsSummary = (s.total_jobs || 0) + " jobs (" + (s.successful_jobs || 0) + " ok, " + (s.failed_jobs || 0) + " fail)";
    var outcomeCls = (s.successful_jobs || 0) > 0 ? "success" : ((s.total_jobs || 0) > 0 ? "failure" : "pending");
    headerPills.push('<span class="synth-badge ' + outcomeCls + '">' + escapeHtml(jobsSummary) + "</span>");

    var toggleHtml =
      '<button type="button" class="session-toggle" onclick="this.closest(\'.synth-session-card\').classList.toggle(\'open\')">' +
        '<span class="session-toggle__chevron">&#9654;</span>' +
        '<span class="session-toggle__summary">' +
          '<span class="session-fi">' + escapeHtml(s.fi_name || "Unknown FI") + "</span>" +
          headerPills.join("") +
        "</span>" +
      "</button>";

    // Collapsible details
    var details = [];

    // Meta (matching troubleshoot detail level)
    var meta = [];
    if (s.created_on) meta.push("<strong>Opened</strong> " + escapeHtml(formatDateTime(s.created_on)));
    if (s.closed_on) meta.push("<strong>Closed</strong> " + escapeHtml(formatDateTime(s.closed_on)));
    if (s.created_on && s.closed_on) meta.push("<strong>Duration</strong> " + formatDuration(s.created_on, s.closed_on));
    meta.push("<strong>Jobs</strong> " + (s.total_jobs || 0) + " (success " + (s.successful_jobs || 0) + " / fail " + (s.failed_jobs || 0) + ")");
    if (s.source && s.source.integration) meta.push("<strong>Source</strong> " + escapeHtml(s.source.integration));
    if (s.source && s.source.device) meta.push("<strong>Device</strong> " + escapeHtml(s.source.device));
    if (s.fi_lookup_key) meta.push("<strong>FI key</strong> " + escapeHtml(s.fi_lookup_key));
    if (s.cuid) meta.push("<strong>CUID</strong> " + escapeHtml(s.cuid));
    if (s.agent_session_id) meta.push("<strong>Session ID</strong> " + escapeHtml(s.agent_session_id.substring(0, 16)) + "\u2026");
    details.push('<div class="session-meta">' + meta.map(function (m) { return "<span>" + m + "</span>"; }).join("") + "</div>");

    // Source verification
    if (s.source_match) {
      var sv = [];
      sv.push(sourceVerifyItem("type", s.source_match.type, s.source_match.match_type));
      sv.push(sourceVerifyItem("cat", s.source_match.category, s.source_match.match_category));
      if (s.source_match.match_sub !== null) {
        sv.push(sourceVerifyItem("sub", s.source_match.sub_category, s.source_match.match_sub));
      }
      details.push('<div class="source-verify">' + sv.join("") + "</div>");
    }

    // Clickstream
    if (s.clickstream && s.clickstream.length > 0) {
      var clicks = [];
      for (var i = 0; i < s.clickstream.length; i++) {
        var step = s.clickstream[i];
        var label = step.page_title || step.url || "?";
        var time = step.at ? new Date(step.at).toLocaleTimeString() : "";
        if (i > 0) clicks.push('<span class="synth-click-arrow">\u2192</span>');
        clicks.push('<span class="synth-click-pill">' + escapeHtml(label) + (time ? " <small>" + escapeHtml(time) + "</small>" : "") + "</span>");
      }
      details.push('<div class="synth-clickstream">' + clicks.join("") + "</div>");
    }

    // Placements / jobs (full troubleshoot-level detail)
    if (s.jobs && s.jobs.length > 0) {
      var jobCards = [];
      for (var j = 0; j < s.jobs.length; j++) {
        var jb = s.jobs[j];
        var badgeCls = jobBadgeClass(jb);
        var badgeLabel = jb.termination_label || jb.termination || (jb.is_success ? "Success" : "Failed");
        var merchant = jb.merchant || jb.merchant_site || jb.site_name || "Unknown";
        var jobMeta = [];
        if (jb.created_on) jobMeta.push("Created " + escapeHtml(formatDateTime(jb.created_on)));
        if (jb.completed_on) jobMeta.push("Completed " + escapeHtml(formatDateTime(jb.completed_on)));
        var dur = formatDurationMs(jb.duration_ms);
        if (dur) jobMeta.push("Duration " + dur);
        if (jb.instance) jobMeta.push("Instance " + escapeHtml(jb.instance));

        jobCards.push(
          '<div class="synth-placement">' +
            '<div class="synth-job-header">' +
              '<span class="synth-badge ' + badgeCls + '">' + escapeHtml(badgeLabel) + "</span>" +
              '<span class="synth-job-merchant">' + escapeHtml(merchant) + "</span>" +
              (jb.status ? '<span class="session-pill">' + escapeHtml(jb.status) + "</span>" : "") +
            "</div>" +
            (jobMeta.length ? '<div class="synth-job-meta">' + jobMeta.map(function(m) { return "<span>" + m + "</span>"; }).join("") + "</div>" : "") +
            (jb.status_message ? '<div class="synth-job-message">' + escapeHtml(jb.status_message) + "</div>" : "") +
          "</div>"
        );
      }
      details.push(jobCards.join(""));
    } else {
      details.push('<div class="synth-placement" style="color:var(--muted)">No placements/jobs recorded in this session.</div>');
    }

    // Raw JSON
    details.push(
      '<details class="synth-raw-details">' +
        "<summary>Raw session data</summary>" +
        "<pre>" + escapeHtml(JSON.stringify(s, null, 2)) + "</pre>" +
      "</details>"
    );

    return '<div class="synth-session-card">' + toggleHtml + '<div class="session-details">' + details.join("") + "</div></div>";
  }

  function sourceVerifyItem(label, value, matched) {
    var cls = matched ? "" : " fail";
    var icon = matched ? "\u2713" : "\u2717";
    return (
      '<span class="source-verify-item' + cls + '">' +
        icon + " " + escapeHtml(label) + ": " + escapeHtml(value || "(empty)") +
      "</span>"
    );
  }

  function formatDuration(start, end) {
    var ms = new Date(end).getTime() - new Date(start).getTime();
    if (isNaN(ms) || ms < 0) return "—";
    var secs = Math.round(ms / 1000);
    if (secs < 60) return secs + "s";
    var mins = Math.floor(secs / 60);
    var remSecs = secs % 60;
    if (mins < 60) return mins + "m " + remSecs + "s";
    var hrs = Math.floor(mins / 60);
    var remMins = mins % 60;
    return hrs + "h " + remMins + "m";
  }

  function init() {
    populateSelect("fiHostEnv", options.fiHostEnv);
    populateSelect("integrationFlow", options.integrationFlow);
    populateSelect("testCardPreset", options.testCardPreset);
    populateSelect("sourceType", options.sourceType);
    populateSelect("sourceCategory", options.sourceCategory);
    toggleModeFields();
    toggleUserDataAbandon();
    if (modeSelect) modeSelect.addEventListener("change", toggleModeFields);
    var flowSelect = document.getElementById("integrationFlow");
    if (flowSelect) {
      flowSelect.addEventListener("change", toggleUserDataAbandon);
    }
    if (form) form.addEventListener("submit", submitJob);
    if (jobsBody) jobsBody.addEventListener("click", handleTableClick);
    if (jobModal) {
      jobModal.addEventListener("click", function (evt) {
        if (evt.target && evt.target.hasAttribute("data-modal-close")) {
          closeJobModal();
        }
      });
    }
    if (cancelModal) {
      cancelModal.addEventListener("click", function (evt) {
        if (evt.target && evt.target.hasAttribute("data-modal-close")) {
          closeCancelModal();
        }
      });
    }
    if (sessionsModal) {
      sessionsModal.addEventListener("click", function (evt) {
        if (evt.target && evt.target.hasAttribute("data-modal-close")) {
          closeSessionsModal();
        }
      });
    }
    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape") {
        closeJobModal();
        closeCancelModal();
        closeSessionsModal();
      }
    });
    if (activeOnlyToggle) {
      activeOnly = activeOnlyToggle.checked;
      activeOnlyToggle.addEventListener("change", function () {
        activeOnly = activeOnlyToggle.checked;
        renderJobs(latestJobs);
      });
    }
    if (cancelConfirmInput) {
      cancelConfirmInput.addEventListener("input", updateCancelState);
      cancelConfirmInput.addEventListener("keydown", function (evt) {
        if (evt.key === "Enter" && cancelConfirmButton && !cancelConfirmButton.disabled) {
          cancelConfirmButton.click();
        }
      });
    }
    if (cancelConfirmButton) {
      cancelConfirmButton.addEventListener("click", function () {
        if (!pendingCancelJobId) return;
        var jobId = pendingCancelJobId;
        closeCancelModal();
        cancelJob(jobId);
      });
    }
    setupRateCombos();
    updateRateValidation();
    if (sourceSubcategoryInput) {
      sourceSubcategoryInput.addEventListener("input", validateSourceSubcategory);
      sourceSubcategoryInput.addEventListener("blur", validateSourceSubcategory);
    }
    validateSourceSubcategory();
    var successRate = document.getElementById("successRate");
    if (successRate) {
      successRate.addEventListener("input", clampSuccessRate);
      successRate.addEventListener("change", clampSuccessRate);
    }
    if (demoPreset) {
      demoPreset.addEventListener("change", function () {
        applyDemoPreset(demoPreset.value);
      });
    }
    var endDate = document.getElementById("endDate");
    if (endDate) {
      endDate.addEventListener("change", function () {
        endDate.blur();
      });
    }
    refreshJobs();
    setInterval(refreshJobs, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
