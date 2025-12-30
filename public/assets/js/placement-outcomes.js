const SSO_FI_KEYS = new Set([
  "advancial",
  "canvas",
  "elevationscu",
  "nasafcu",
  "inovafcu",
  "flcu",
  "americaneagle",
  "greylock",
  "msufcu"
]);

const state = {
  rows: [],
  startStr: "",
  endStr: "",
  totalSessions: 0,
  totalPlacements: 0
};

const els = {
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  excludeTests: document.getElementById("excludeTests"),
  quick90: document.getElementById("quick90"),
  quick90Aligned: document.getElementById("quick90Aligned"),
  runReport: document.getElementById("runReport"),
  exportCsv: document.getElementById("exportCsv"),
  summaryLine: document.getElementById("summaryLine"),
  loadingIndicator: document.getElementById("loadingIndicator"),
  resultsBody: document.getElementById("resultsBody"),
  emptyState: document.getElementById("emptyState")
};

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateValue(value) {
  if (!value) return null;
  const parts = String(value).split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month, day);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function computeDefaultRange() {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  return { start, end };
}

function computeAlignedRange() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 1);
  if (end.getDay() !== 0) {
    end.setDate(end.getDate() - end.getDay());
  }
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  return { start, end };
}

function setDateInputs(range) {
  els.startDate.value = formatDate(range.start);
  els.endDate.value = formatDate(range.end);
}

function setLoading(isLoading) {
  els.loadingIndicator.hidden = !isLoading;
  els.runReport.disabled = isLoading;
  els.exportCsv.disabled = isLoading || !state.rows.length;
}

function getPlacements(session) {
  if (!session || typeof session !== "object") return [];
  const keys = ["placements_raw", "placements", "card_placements", "placement_events"];
  for (let i = 0; i < keys.length; i++) {
    const arr = session[keys[i]];
    if (Array.isArray(arr)) return arr;
  }
  return [];
}

function getPlacementStatus(placement) {
  if (!placement || typeof placement !== "object") return "";
  if (placement.status != null) return String(placement.status);
  return "";
}

function getPlacementCompletedOn(placement) {
  if (!placement || typeof placement !== "object") return "";
  if (placement.completed_on != null) return String(placement.completed_on);
  if (placement.completedOn != null) return String(placement.completedOn);
  if (placement.completed != null) return String(placement.completed);
  return "";
}

function isValidDatePrefix(datePrefix) {
  if (!datePrefix || datePrefix.length < 10) return false;
  return datePrefix[4] === "-" && datePrefix[7] === "-";
}

function createCounts() {
  return { successful: 0, cancelled: 0, abandoned: 0, other: 0, total: 0 };
}

function addCounts(target, source) {
  const next = createCounts();
  next.successful = (target.successful || 0) + (source.successful || 0);
  next.cancelled = (target.cancelled || 0) + (source.cancelled || 0);
  next.abandoned = (target.abandoned || 0) + (source.abandoned || 0);
  next.other = (target.other || 0) + (source.other || 0);
  next.total = (target.total || 0) + (source.total || 0);
  return next;
}

function incrementCounts(counts, bucket) {
  if (!counts) return;
  if (bucket === "successful") counts.successful += 1;
  else if (bucket === "cancelled") counts.cancelled += 1;
  else if (bucket === "abandoned") counts.abandoned += 1;
  else counts.other += 1;
  counts.total += 1;
}

function buildRow(month, segment, counts, isTotal) {
  const total = counts.total || 0;
  const conversion = total > 0 ? (counts.successful / total) * 100 : 0;
  return {
    month,
    segment,
    successful: (counts.successful || 0).toLocaleString(),
    cancelled: (counts.cancelled || 0).toLocaleString(),
    abandoned: (counts.abandoned || 0).toLocaleString(),
    other: (counts.other || 0).toLocaleString(),
    total: total.toLocaleString(),
    conversion: `${conversion.toFixed(1)}%`,
    isTotal: !!isTotal
  };
}

function aggregatePlacements(sessions) {
  const monthMap = new Map();
  const totalsBySegment = {
    SSO: createCounts(),
    "non-SSO": createCounts()
  };
  let placementsCounted = 0;

  sessions.forEach((session) => {
    const fiKey = normalizeKey(
      session.fi_lookup_key ||
        session.fi_key ||
        session.financial_institution_lookup_key ||
        ""
    );
    const segment = SSO_FI_KEYS.has(fiKey) ? "SSO" : "non-SSO";
    const placements = getPlacements(session);
    if (!placements.length) return;

    placements.forEach((placement) => {
      const completedOn = getPlacementCompletedOn(placement);
      if (!completedOn) return;
      const datePrefix = String(completedOn).slice(0, 10);
      if (!isValidDatePrefix(datePrefix)) return;
      const monthKey = datePrefix.slice(0, 7);
      if (!monthKey || monthKey.length < 7) return;

      let monthData = monthMap.get(monthKey);
      if (!monthData) {
        monthData = { SSO: createCounts(), "non-SSO": createCounts() };
        monthMap.set(monthKey, monthData);
      }

      const statusRaw = normalizeKey(getPlacementStatus(placement));
      let bucket = "other";
      if (statusRaw === "successful") bucket = "successful";
      else if (statusRaw === "cancelled" || statusRaw === "canceled") bucket = "cancelled";
      else if (statusRaw === "abandoned") bucket = "abandoned";

      incrementCounts(monthData[segment], bucket);
      incrementCounts(totalsBySegment[segment], bucket);
      placementsCounted += 1;
    });
  });

  const months = Array.from(monthMap.keys()).sort();
  const rows = [];
  months.forEach((month) => {
    const monthData = monthMap.get(month) || { SSO: createCounts(), "non-SSO": createCounts() };
    const totalCounts = addCounts(monthData.SSO, monthData["non-SSO"]);
    rows.push(buildRow(month, "SSO", monthData.SSO, false));
    rows.push(buildRow(month, "non-SSO", monthData["non-SSO"], false));
    rows.push(buildRow(month, "Total", totalCounts, false));
  });

  const grandTotal = addCounts(totalsBySegment.SSO, totalsBySegment["non-SSO"]);
  rows.push(buildRow("All Months", "SSO", totalsBySegment.SSO, true));
  rows.push(buildRow("All Months", "non-SSO", totalsBySegment["non-SSO"], true));
  rows.push(buildRow("All Months", "Total", grandTotal, true));

  return { rows, placementsCounted };
}

function renderRows(rows) {
  els.resultsBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.isTotal) tr.classList.add("is-total");
    tr.innerHTML = `
      <td>${row.month}</td>
      <td>${row.segment}</td>
      <td class="t-right">${row.successful}</td>
      <td class="t-right">${row.cancelled}</td>
      <td class="t-right">${row.abandoned}</td>
      <td class="t-right">${row.other}</td>
      <td class="t-right">${row.total}</td>
      <td class="t-right">${row.conversion}</td>
    `;
    els.resultsBody.appendChild(tr);
  });
  els.emptyState.hidden = rows.length > 0;
}

function updateSummary() {
  if (!state.startStr || !state.endStr) {
    els.summaryLine.textContent = "No report run yet.";
    return;
  }
  els.summaryLine.textContent = `Sessions loaded: ${state.totalSessions.toLocaleString()} | Placements counted: ${state.totalPlacements.toLocaleString()} | Range: ${state.startStr} to ${state.endStr}`;
}

function buildCsv(rows) {
  const headers = [
    "Month",
    "Segment",
    "Successful",
    "Cancelled",
    "Abandoned",
    "Other",
    "Total Attempts",
    "Conversion %"
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    const values = [
      row.month,
      row.segment,
      row.successful,
      row.cancelled,
      row.abandoned,
      row.other,
      row.total,
      row.conversion
    ];
    lines.push(values.map(csvEscape).join(","));
  });
  return lines.join("\n");
}

function csvEscape(value) {
  const str = String(value || "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function runReport() {
  const startStr = els.startDate.value;
  const endStr = els.endDate.value;
  const startDate = parseDateValue(startStr);
  const endDate = parseDateValue(endStr);
  if (!startDate || !endDate) {
    els.summaryLine.textContent = "Please select a valid start and end date.";
    return;
  }

  setLoading(true);
  els.summaryLine.textContent = "Loading sessions...";

  try {
    const qs = new URLSearchParams();
    qs.set("start", formatDate(startDate));
    qs.set("end", formatDate(endDate));
    qs.set("includeTests", "true");
    qs.set("fi", "__all__");
    qs.set("partner", "__all_partners__");
    qs.set("integration", "(all)");
    qs.set("instance", "__all_instances__");

    const response = await fetch(`/troubleshoot/day?${qs.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    let sessions = Array.isArray(data.sessions) ? data.sessions : [];

    if (els.excludeTests.checked) {
      sessions = sessions.filter((session) => {
        const inst = normalizeKey(session.instance || session._instance || "");
        const integrationType = normalizeKey(
          session.integration_display || session.integration || session.integration_type || ""
        );
        if (inst === "customer-dev") return false;
        if (integrationType === "test") return false;
        return true;
      });
    }

    const { rows, placementsCounted } = aggregatePlacements(sessions);

    state.rows = rows;
    state.startStr = formatDate(startDate);
    state.endStr = formatDate(endDate);
    state.totalSessions = sessions.length;
    state.totalPlacements = placementsCounted;

    renderRows(rows);
    updateSummary();
    setLoading(false);
  } catch (err) {
    setLoading(false);
    els.summaryLine.textContent = err && err.message ? err.message : "Failed to load report.";
    state.rows = [];
    state.totalSessions = 0;
    state.totalPlacements = 0;
    renderRows([]);
  }
}

function exportCsv() {
  if (!state.rows.length) return;
  const csv = buildCsv(state.rows);
  const filename = `placement_outcomes_${state.startStr}_to_${state.endStr}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

if (els.quick90) {
  els.quick90.addEventListener("click", () => {
    setDateInputs(computeDefaultRange());
  });
}

if (els.quick90Aligned) {
  els.quick90Aligned.addEventListener("click", () => {
    setDateInputs(computeAlignedRange());
  });
}

if (els.runReport) {
  els.runReport.addEventListener("click", () => {
    runReport();
  });
}

if (els.exportCsv) {
  els.exportCsv.addEventListener("click", () => {
    exportCsv();
  });
}

setDateInputs(computeDefaultRange());
setLoading(false);
runReport();
