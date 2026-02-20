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
      return;
    }

    // Re-enable User Data if not SSO-disabled
    if (!userDisabledBySSO) setRateFieldDisabled("abandonUserData", false);

    // User Data at 100% → cred entry, success, fail disabled
    if (userVal >= 100) {
      setRateFieldDisabled("abandonCredentialEntry", true);
      setRateFieldDisabled("successRate", true);
      setRateFieldDisabled("failRate", true);
      return;
    }

    // Re-enable Cred Entry
    setRateFieldDisabled("abandonCredentialEntry", false);

    // Cred Entry at 100% → success, fail disabled
    if (credVal >= 100) {
      setRateFieldDisabled("successRate", true);
      setRateFieldDisabled("failRate", true);
      return;
    }

    // Re-enable success and fail
    setRateFieldDisabled("successRate", false);
    setRateFieldDisabled("failRate", false);
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
    var input = document.getElementById("successRate");
    if (!input) return;
    if (typeof targetSuccess !== "number") {
      input.removeAttribute("min");
      input.removeAttribute("max");
      input.removeAttribute("title");
      return;
    }
    var min = Math.max(0, Math.round((targetSuccess - 5) * 10) / 10);
    var max = Math.min(100, Math.round((targetSuccess + 5) * 10) / 10);
    input.min = String(min);
    input.max = String(max);
    input.title = "Allowed range: " + min + "% to " + max + "%";
  }

  function clampSuccessRate() {
    if (!activeDemoPreset) return;
    var input = document.getElementById("successRate");
    var fail = document.getElementById("failRate");
    if (!input) return;
    var min = Number(input.min);
    var max = Number(input.max);
    var value = Number(input.value);
    if (Number.isFinite(min) && value < min) value = min;
    if (Number.isFinite(max) && value > max) value = max;
    if (Number.isFinite(value)) input.value = String(value);
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

  function buildRateOptions(listEl, inputEl) {
    listEl.innerHTML = "";
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
      buildRateOptions(list, input);
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
    if (action === "detail") {
      var job = getJobById(jobId);
      if (job) openJobModal(job);
    }
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
    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape") {
        closeJobModal();
        closeCancelModal();
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
