// Testing Checklists — admin-only.
// Renders markdown-backed checklists from /api/checklists with clickable
// checkboxes. Each toggle rewrites the underlying .md on the server so state
// survives reloads and is readable by any other tool (git, scp, claude code).

const state = {
  checklists: [],
  selected: null,
  currentContent: "",
};

const TOKEN_KEY = "sis_session_token";

function authHeaders() {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { "Authorization": "Bearer " + t } : {};
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

async function loadChecklists() {
  try {
    const res = await fetch("/api/checklists", { headers: authHeaders() });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    state.checklists = Array.isArray(data.checklists) ? data.checklists : [];
  } catch (err) {
    console.error("[tc] load error:", err);
    document.getElementById("tc-list").innerHTML = `<p class="tc-empty">Error loading: ${escapeHtml(err.message)}</p>`;
    return;
  }
  renderSidebar();
  if (!state.selected && state.checklists.length) {
    selectChecklist(state.checklists[0].filename);
  }
}

async function selectChecklist(filename) {
  state.selected = filename;
  renderSidebar();
  document.getElementById("tc-content").innerHTML = '<p class="tc-loading">Loading…</p>';
  try {
    const res = await fetch("/api/checklists/" + encodeURIComponent(filename), { headers: authHeaders() });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    state.currentContent = data.content || "";
    renderMain(filename, state.currentContent);
  } catch (err) {
    console.error("[tc] select error:", err);
    document.getElementById("tc-content").innerHTML = `<p class="tc-empty">Error loading: ${escapeHtml(err.message)}</p>`;
  }
}

async function toggleItem(filename, index, currentChecked, checkbox) {
  const payload = { filename, itemIndex: index, currentChecked };
  try {
    const res = await fetch("/api/checklists/toggle", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      checkbox.checked = currentChecked;
      alert("Toggle failed: " + (data.error || res.status));
      return;
    }
    const cl = state.checklists.find((c) => c.filename === filename);
    if (cl) { cl.total = data.total; cl.checked = data.checked; }
    renderSidebar();
    const row = checkbox.closest(".tc-checkbox-row");
    if (row) row.classList.toggle("checked", !currentChecked);
    checkbox.dataset.checked = String(!currentChecked);
  } catch (err) {
    checkbox.checked = currentChecked;
    console.error("[tc] toggle error:", err);
    alert("Toggle failed: " + err.message);
  }
}

function renderSidebar() {
  const container = document.getElementById("tc-list");
  if (!state.checklists.length) {
    container.innerHTML = '<p class="tc-empty">No checklists yet. Add a <code>.md</code> file to <code>data/checklists/</code>.</p>';
    return;
  }
  container.innerHTML = state.checklists.map((c) => {
    const pct = c.total ? Math.round((c.checked / c.total) * 100) : 0;
    const isActive = c.filename === state.selected;
    const isDone = c.total > 0 && c.checked === c.total;
    const statusClass = isDone ? "done" : (c.status || "active");
    const statusLabel = isDone ? "done" : (c.status || "active");
    return `
      <button class="tc-item ${isActive ? "active" : ""}" data-filename="${escapeHtml(c.filename)}">
        <div class="tc-item-title">${escapeHtml(c.title)}</div>
        <div class="tc-item-meta">
          <span class="tc-badge status-${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>
          <span class="tc-count">${c.checked}/${c.total}</span>
        </div>
        <div class="tc-progress"><div class="tc-progress-fill ${isDone ? "done" : ""}" style="width:${pct}%"></div></div>
      </button>
    `;
  }).join("");
  container.querySelectorAll(".tc-item").forEach((btn) => {
    btn.addEventListener("click", () => selectChecklist(btn.dataset.filename));
  });
}

function renderMain(filename, markdown) {
  const container = document.getElementById("tc-content");
  const lines = markdown.split("\n");
  let html = "";
  let itemIndex = 0;
  let inBlankRun = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line) { inBlankRun = true; continue; }
    inBlankRun = false;
    let m;
    if ((m = line.match(/^#\s+(.+)$/))) { html += `<h1>${renderInline(m[1])}</h1>`; continue; }
    if ((m = line.match(/^##\s+(.+)$/))) { html += `<h2>${renderInline(m[1])}</h2>`; continue; }
    if ((m = line.match(/^###\s+(.+)$/))) { html += `<h3>${renderInline(m[1])}</h3>`; continue; }
    if ((m = line.match(/^\s*-\s+\[([ xX])\]\s+(.+)$/))) {
      const checked = m[1].toLowerCase() === "x";
      html += `<label class="tc-checkbox-row ${checked ? "checked" : ""}">
        <input type="checkbox" data-index="${itemIndex}" data-checked="${checked}" ${checked ? "checked" : ""}>
        <span>${renderInline(m[2])}</span>
      </label>`;
      itemIndex++;
      continue;
    }
    html += `<p>${renderInline(line)}</p>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const idx = parseInt(cb.dataset.index, 10);
      const curr = cb.dataset.checked === "true";
      toggleItem(filename, idx, curr, cb);
    });
  });
}

document.addEventListener("DOMContentLoaded", loadChecklists);
