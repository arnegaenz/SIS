(function () {
  var JOBS_ENDPOINT = "/api/synth/jobs";
  var POLL_MS = 7000;
  var form = document.getElementById("synthJobForm");
  var statusEl = document.getElementById("formStatus");
  var jobsStatus = document.getElementById("jobsStatus");
  var jobsBody = document.getElementById("jobsBody");
  var modeSelect = document.getElementById("modeSelect");

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

  function toggleUserDataAbandon() {
    var flow = document.getElementById("integrationFlow");
    var input = document.getElementById("abandonUserData");
    var toggle = input ? input.closest(".rate-combo")?.querySelector(".rate-toggle") : null;
    if (!flow || !input) return;
    if (isSsoFlow(flow.value)) {
      input.value = "0";
      input.disabled = true;
      if (toggle) toggle.disabled = true;
      var list = input.closest(".rate-combo")?.querySelector(".rate-list");
      if (list) list.classList.remove("open");
    } else {
      input.disabled = false;
      if (toggle) toggle.disabled = false;
    }
  }

  function formatDateTime(value) {
    if (!value) return "—";
    var dt = new Date(value);
    if (isNaN(dt.getTime())) return "—";
    return dt.toLocaleString();
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
    var label = status || "queued";
    var className = "pill";
    if (status === "canceled" || status === "failed") className += " warn";
    if (status === "completed") className += " muted";
    if (isDue && status !== "running") label = "queued";
    return '<span class="' + className + '">' + escapeHtml(label) + "</span>";
  }

  function buildJobRow(job) {
    var name = job.job_name || job.source_subcategory || "Unnamed job";
    var id = job.id || "";
    var status = statusPill(job.status, job.due);
    var cancelAllowed = job.status === "queued" || job.status === "running" || job.due;
    var actionHtml = cancelAllowed
      ? '<button class="btn secondary" data-action="cancel" data-id="' + escapeHtml(id) + '">Cancel</button>'
      : '<span class="pill muted">—</span>';

    return (
      "<tr>" +
        '<td><div class="job-meta"><strong>' + escapeHtml(name) + "</strong>" +
        '<span class="job-id">' + escapeHtml(id) + "</span></div></td>" +
        "<td>" + status + "</td>" +
        "<td>" + escapeHtml(formatDateTime(job.created_at)) + "</td>" +
        "<td>" + escapeHtml(formatDateTime(job.last_run_at)) + "</td>" +
        "<td>" + escapeHtml(formatDateTime(job.next_run_at)) + "</td>" +
        "<td>" + escapeHtml(job.end_date || "—") + "</td>" +
        "<td>" + escapeHtml(job.attempted || 0) + "</td>" +
        "<td>" + escapeHtml(job.placements_success || 0) + "</td>" +
        "<td>" + escapeHtml(job.placements_failed || 0) + "</td>" +
        '<td class="job-actions">' + actionHtml + "</td>" +
      "</tr>"
    );
  }

  function renderJobs(list) {
    if (!jobsBody) return;
    if (!list || !list.length) {
      jobsBody.innerHTML = '<tr><td colspan="10">No jobs yet.</td></tr>';
      return;
    }
    jobsBody.innerHTML = list.map(buildJobRow).join("");
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

  function applyMotivationPreset(preset) {
    var flow = document.getElementById("integrationFlow");
    var isSso = flow ? isSsoFlow(flow.value) : false;
    var totalConversion = 0;
    var credentialSuccess = 0;
    var credentialFail = 0;
    var abandonSelect = 0;
    var abandonUser = 0;
    var abandonCredential = 0;

    if (preset === "not_motivated") {
      totalConversion = 0.105;
      credentialSuccess = 35;
      credentialFail = 65;
      abandonSelect = 97.5;
      abandonUser = isSso ? 0 : 88;
      abandonCredential = 0;
    } else {
      totalConversion = preset === "motivated" ? 7 : 25;
      credentialSuccess = preset === "motivated" ? 50 : 65;
      credentialFail = 100 - credentialSuccess;
      abandonCredential = 0;

      var reachCredential = computeReachCredential(
        totalConversion / 100,
        credentialSuccess / 100
      );
      if (isSso) {
        abandonSelect = roundRate((1 - reachCredential) * 100);
        abandonUser = 0;
      } else {
        var stageRetain = Math.sqrt(Math.max(0, reachCredential));
        abandonSelect = roundRate((1 - stageRetain) * 100);
        abandonUser = roundRate((1 - stageRetain) * 100);
      }
    }

    setRateValue("abandonSelectMerchant", abandonSelect);
    setRateValue("abandonUserData", abandonUser);
    setRateValue("abandonCredentialEntry", abandonCredential);
    setRateValue("successRate", credentialSuccess);
    setRateValue("failRate", credentialFail);
    updateRateValidation();
    toggleUserDataAbandon();
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
      input.addEventListener("focus", function () {
        if (!input.disabled) openRateList(list);
      });
      input.addEventListener("blur", function () {
        setTimeout(function () {
          closeRateList(list);
        }, 120);
      });
      input.addEventListener("input", updateRateValidation);
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

  function handleTableClick(evt) {
    var target = evt.target;
    if (!target || target.getAttribute("data-action") !== "cancel") return;
    cancelJob(target.getAttribute("data-id"));
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
      flowSelect.addEventListener("change", function () {
        var preset = document.getElementById("motivationPreset");
        if (preset) applyMotivationPreset(preset.value);
      });
    }
    if (form) form.addEventListener("submit", submitJob);
    if (jobsBody) jobsBody.addEventListener("click", handleTableClick);
    setupRateCombos();
    updateRateValidation();
    var presetSelect = document.getElementById("motivationPreset");
    if (presetSelect) {
      presetSelect.addEventListener("change", function () {
        applyMotivationPreset(presetSelect.value);
      });
      applyMotivationPreset(presetSelect.value);
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
