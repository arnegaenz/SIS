/*
  SIS shared header navigation
  Renders a consistent header with grouped dropdowns and page titles.
  No dependencies beyond standard DOM APIs and existing sis-shared.css.
*/
(function(global){
var API_BASE = "";

function normalizeApiBase(value) {
  if (!value) return "";
  var trimmed = value.toString().trim();
  if (!trimmed) return "";
  if (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

function resolveApiBase() {
  var fromGlobal = global && typeof global.SIS_API_BASE === "string" ? global.SIS_API_BASE : "";
  if (fromGlobal) return normalizeApiBase(fromGlobal);
  var meta = document.querySelector('meta[name="sis-api-base"]');
  if (meta && meta.content) return normalizeApiBase(meta.content);
  return "";
}

function withApiBase(url) {
  if (!API_BASE) return url;
  if (!url) return url;
  var str = url.toString();
  if (/^[a-z]+:\/\//i.test(str)) return str;
  if (str.startsWith("data:") || str.startsWith("blob:")) return str;
  if (str.startsWith("//")) return str;
  if (str.startsWith("/")) return API_BASE + str;
  return str;
}

function wrapFetch() {
  if (!global || !global.fetch || global.__sisFetchWrapped) return;
  API_BASE = resolveApiBase();
  if (!API_BASE) return;
  global.__sisFetchWrapped = true;
  var origFetch = global.fetch.bind(global);
  global.fetch = function (input, init) {
    try {
      if (typeof input === "string") {
        return origFetch(withApiBase(input), init);
      }
      if (input && typeof input === "object" && input.url) {
        var nextUrl = withApiBase(input.url);
        if (nextUrl === input.url) return origFetch(input, init);
        return origFetch(new Request(nextUrl, input), init);
      }
    } catch (err) {
      // fall through to original fetch
    }
    return origFetch(input, init);
  };
}

wrapFetch();
function h(tag, attrs, children){
var el = document.createElement(tag);
if (attrs) for (var k in attrs){ if (k === "class") el.className = attrs[k]; else el.setAttribute(k, attrs[k]); }
if (children && children.length){
for (var i=0;i<children.length;i++){
var c = children[i];
if (typeof c === "string") el.appendChild(document.createTextNode(c));
else if (c) el.appendChild(c);
}
}
return el;
}

// Default groups and pages. Keys match page ids we will pass from each page.
// Prefix for relative links - "../" if in subdirectory, "./" if at root
var NAV_PREFIX = window.location.pathname.indexOf("/dashboards/") !== -1 ? "../" : "./";

var HOME_LINK = { id:"overview", label:"Home", href:NAV_PREFIX+"index.html" };

var GROUPS = [
{ label: "Conversions", items: [
{ id:"funnel", label:"FI Funnel", href:NAV_PREFIX+"funnel.html" },
{ id:"customer-success", label:"Customer Success Dashboard", href:NAV_PREFIX+"dashboards/customer-success.html" },
{ id:"sources", label:"Sources", href:NAV_PREFIX+"sources.html" },
{ id:"ux-paths", label:"UX Paths", href:NAV_PREFIX+"ux-paths.html" },
{ id:"placement-outcomes", label:"Placement Outcomes", href:NAV_PREFIX+"placement-outcomes.html" }
]},
{ label: "Reliability", items: [
{ id:"heatmap", label:"Merchant Heatmap", href:NAV_PREFIX+"heatmap.html" },
{ id:"watchlist", label:"Alerts & Watchlist", href:NAV_PREFIX+"watchlist.html" }
]},
{ label: "Ops", items: [
{ id:"operations", label:"Operations Dashboard", href:NAV_PREFIX+"dashboards/operations.html" },
{ id:"troubleshoot", label:"Troubleshoot", href:NAV_PREFIX+"troubleshoot.html" },
{ id:"realtime", label:"Real-Time", href:NAV_PREFIX+"realtime.html" },
{ id:"synthetic-traffic", label:"Synthetic Traffic", href:NAV_PREFIX+"synthetic-traffic.html", adminOnly: true },
{ id:"fi-api", label:"FI API", href:NAV_PREFIX+"fi-api.html" }
]},
{ label: "Admin", fullAccessOnly: true, items: [
{ id:"maintenance", label:"Data & Config", href:NAV_PREFIX+"maintenance.html" },
{ id:"users", label:"Users", href:NAV_PREFIX+"users.html" },
{ id:"activity-log", label:"User Activity", href:NAV_PREFIX+"activity-log.html" },
{ id:"shared-views", label:"Shared Links", href:NAV_PREFIX+"shared-views.html" },
{ id:"logs", label:"Server Logs", href:NAV_PREFIX+"logs.html" }
]}
];

function getAccessLevel() {
  // Use sisAuth if available (new session-based auth)
  if (global.sisAuth && global.sisAuth.getAccessLevel) {
    return global.sisAuth.getAccessLevel();
  }
  // Legacy fallback
  try {
    var level = sessionStorage.getItem("sis_access_level");
    if (level === "admin" || level === "full" || level === "internal" || level === "limited") return level;
    if (sessionStorage.getItem("sis_passcode_ok") === "1") return "full";
  } catch (e) {}
  return "";
}

function getCurrentUser() {
  if (global.sisAuth && global.sisAuth.getUser) {
    return global.sisAuth.getUser();
  }
  return null;
}

function getGroupsForAccess() {
  // View mode: no navigation
  if (global.__sisViewMode === true) return [];

  var access = getAccessLevel();
  var isAdmin = access === "admin" || access === "full";
  var isInternal = access === "internal";
  var isLimited = access === "limited";

  // Limited access: funnel only, no nav menu needed
  if (isLimited) {
    return [];
  }

  // Admin/full access: all groups and items
  if (isAdmin) return GROUPS;

  // Internal access: all groups except Admin, exclude adminOnly items
  if (isInternal) {
    var filtered = [];
    for (var g = 0; g < GROUPS.length; g++) {
      var group = GROUPS[g];
      if (group.fullAccessOnly) continue; // Skip Admin group
      var items = [];
      for (var i = 0; i < group.items.length; i++) {
        var item = group.items[i];
        if (!item.adminOnly) items.push(item);
      }
      if (items.length) filtered.push({ label: group.label, items: items });
    }
    return filtered;
  }

  // Default (non-full): exclude fullAccessOnly groups
  var filtered = [];
  for (var g = 0; g < GROUPS.length; g++) {
    var group = GROUPS[g];
    if (!group.fullAccessOnly) filtered.push(group);
  }
  return filtered;
}

function renderHeaderNav(opts){
try{
opts = opts || {};
var currentId = opts.currentId || "";
var title = opts.title || "";
var subtitle = opts.subtitle || "";
var mount = document.getElementById("sis-header");
if (!mount){
// If no placeholder, create one at top of body without disturbing existing content.
mount = document.createElement("div");
mount.id = "sis-header";
if (document.body.firstChild) document.body.insertBefore(mount, document.body.firstChild);
else document.body.appendChild(mount);
}
mount.innerHTML = "";

// Header shell
var header = h("header", { class:"sis-header" }, []);

// Title block
var titleWrap = h("div", { class:"sis-titleblock" }, [
h("h1", { class:"sis-page-title" }, [title]),
subtitle ? h("div", { class:"sis-page-subtitle" }, [subtitle]) : null
]);

// Nav groups (dropdowns)
var nav = h("nav", { class:"sis-nav", "data-sis-nav":"1" }, []);
var leftGroup = h("div", { class:"sis-nav-group" }, []);
var spacer = h("div", { class:"sis-spacer" }, []);
var rightGroup = h("div", { class:"sis-nav-group" }, []);

function closeAllDropdowns(root){
var hdr = root || header;
var lists = hdr.querySelectorAll(".sis-menu");
for (var i=0;i<lists.length;i++) lists[i].setAttribute("data-open","0");
var btns = hdr.querySelectorAll(".sis-dropdown > button");
for (var j=0;j<btns.length;j++) btns[j].setAttribute("aria-expanded","false");
if (mount.__sisNavUpdateOpen) mount.__sisNavUpdateOpen();
}

function isMobileNav(){
return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
}

function positionMenu(list, btn){
if (!list || !btn) return;
if (!isMobileNav()){
list.style.position = "";
list.style.left = "";
list.style.right = "";
list.style.top = "";
list.style.bottom = "";
list.style.width = "";
list.style.maxHeight = "";
list.style.transform = "";
return;
}
var rect = btn.getBoundingClientRect();
var top = Math.max(0, Math.round(rect.bottom + 2));
list.style.position = "fixed";
list.style.left = "8px";
list.style.right = "8px";
list.style.top = top + "px";
list.style.bottom = "auto";
list.style.width = "auto";
list.style.transform = "none";
list.style.maxHeight = "calc(100vh - " + (top + 8) + "px)";
}

function addDropdown(group, targetWrap){
var btn = h("button", { class:"sis-pill", type:"button", "aria-expanded":"false" }, [group.label]);
var list = h("div", { class:"sis-menu", "data-open":"0" }, []);
for (var i=0; i<group.items.length; i++){
var item = group.items[i];
var a = h("a", { href:item.href, class:("sis-nav-link" + (item.id===currentId ? " sis-active" : "")) }, [item.label]);
list.appendChild(a);
}
btn.addEventListener("click", function(l, b){
return function(e){
e.preventDefault();
var wasOpen = l.getAttribute("data-open")==="1";
closeAllDropdowns(header);
l.setAttribute("data-open", wasOpen ? "0" : "1");
b.setAttribute("aria-expanded", wasOpen ? "false" : "true");
if (!wasOpen) positionMenu(l, b);
if (mount.__sisNavUpdateOpen) mount.__sisNavUpdateOpen();
};
}(list, btn));
var wrap = h("div", { class:"sis-dropdown" }, [btn, list]);
targetWrap.appendChild(wrap);
}

var navGroups = getGroupsForAccess();

// Home link only for users who have nav groups (not limited)
if (navGroups.length > 0) {
var homeLink = h("a", {
  href: HOME_LINK.href,
  class: "sis-pill" + (HOME_LINK.id === currentId ? " sis-active" : ""),
  style: "text-decoration:none;"
}, [HOME_LINK.label]);
rightGroup.appendChild(homeLink);
}

for (var g=0; g<navGroups.length; g++){
var group = navGroups[g];
addDropdown(group, rightGroup);
}

// Add user info / view mode login link
var isViewMode = global.__sisViewMode === true;
var user = getCurrentUser();
if (isViewMode) {
  // View mode: show "Log in to explore" link instead of user info
  var divider = h("span", { class: "sis-nav-divider" }, []);
  divider.style.display = "inline-block";
  divider.style.width = "1px";
  divider.style.height = "20px";
  divider.style.background = "#3b3f46";
  divider.style.margin = "0 12px";
  divider.style.verticalAlign = "middle";
  divider.style.opacity = "0.5";
  rightGroup.appendChild(divider);

  var viewLabel = h("span", {}, ["Read-only view"]);
  viewLabel.style.fontSize = "12px";
  viewLabel.style.color = "#8b949e";
  viewLabel.style.marginRight = "10px";
  rightGroup.appendChild(viewLabel);

  // Build redirect URL: same page + filters, but without view=1
  var viewSearch = new URLSearchParams(window.location.search);
  viewSearch.delete("view");
  var redirectPath = window.location.pathname + (viewSearch.toString() ? "?" + viewSearch.toString() : "");
  var loginLink = h("a", {
    href: NAV_PREFIX + "login.html?redirect=" + encodeURIComponent(redirectPath),
    class: "sis-pill sis-pill-outline",
    style: "text-decoration:none;font-size:12px;padding:6px 12px;"
  }, ["Log in to explore"]);
  rightGroup.appendChild(loginLink);
} else if (user) {
  // Authenticated: show user info and logout button
  var divider = h("span", { class: "sis-nav-divider" }, []);
  divider.style.display = "inline-block";
  divider.style.width = "1px";
  divider.style.height = "20px";
  divider.style.background = "#3b3f46";
  divider.style.margin = "0 12px";
  divider.style.verticalAlign = "middle";
  divider.style.opacity = "0.5";
  rightGroup.appendChild(divider);

  var userName = user.name || user.email || "";
  if (userName) {
    var userSpan = h("span", { class: "sis-user-name" }, [userName]);
    userSpan.style.fontSize = "13px";
    userSpan.style.color = "#8b949e";
    userSpan.style.marginRight = "8px";
    rightGroup.appendChild(userSpan);
  }
  var logoutBtn = h("button", { class: "sis-pill sis-pill-outline", type: "button" }, ["Sign Out"]);
  logoutBtn.style.fontSize = "12px";
  logoutBtn.style.padding = "6px 12px";
  logoutBtn.addEventListener("click", function() {
    if (global.sisAuth && global.sisAuth.logout) {
      global.sisAuth.logout();
    } else {
      window.location.href = NAV_PREFIX + "login.html";
    }
  });
  rightGroup.appendChild(logoutBtn);
}

// Theme toggle removed from header - now in maintenance page body only
nav.appendChild(leftGroup);
nav.appendChild(spacer);
nav.appendChild(rightGroup);

header.appendChild(titleWrap);
header.appendChild(nav);
mount.appendChild(header);

// Minimal styles fallback (only if classes not found). Harmless if CSS already exists.
// We use inline style tweaks to avoid editing CSS files now.
header.style.display = "flex";
header.style.flexDirection = "row";
header.style.flexWrap = "wrap";
header.style.alignItems = "flex-end";
header.style.justifyContent = "flex-start";
header.style.gap = "12px";
var titleEl = titleWrap.querySelector(".sis-page-title");
if (titleEl) titleEl.style.margin = "0";
if (subtitle){
var st = titleWrap.querySelector(".sis-page-subtitle");
if (st){ st.style.opacity = "0.85"; st.style.fontSize = "0.9rem"; }
}
titleWrap.style.maxWidth = "100%";
titleWrap.style.flex = "1 1 420px";
titleWrap.style.minWidth = "240px";
nav.style.flex = "0 1 auto";
nav.style.marginLeft = "auto";
nav.style.justifyContent = "flex-end";
nav.style.alignItems = "center";
nav.style.marginTop = "0";
var menus = header.querySelectorAll(".sis-menu");
for (var k=0;k<menus.length;k++){
menus[k].style.display = "none";
}

mount.__sisNavUpdateOpen = function(){
if (!isMobileNav()) return;
var open = header.querySelectorAll(".sis-menu[data-open=\"1\"]");
for (var i=0;i<open.length;i++){
var list = open[i];
var btn = list.parentNode && list.parentNode.querySelector("button");
positionMenu(list, btn);
}
};
window.addEventListener("resize", function(){ if (mount.__sisNavUpdateOpen) mount.__sisNavUpdateOpen(); });
window.addEventListener("scroll", function(){ if (mount.__sisNavUpdateOpen) mount.__sisNavUpdateOpen(); }, true);

mount.__sisNavUpdateOpen = function(){
var lists = header.querySelectorAll(".sis-menu");
for (var m=0;m<lists.length;m++){
lists[m].style.display = (lists[m].getAttribute("data-open")==="1") ? "block" : "none";
}
};
mount.__sisNavUpdateOpen();

if (!global.__sisHeaderNavDocBound){
global.__sisHeaderNavDocBound = true;
document.addEventListener("click", function(e){
var activeMount = document.getElementById("sis-header");
if (!activeMount) return;
var hdr = activeMount.querySelector("header");
if (!hdr) return;
if (hdr.contains(e.target)) return;
var lists = hdr.querySelectorAll(".sis-menu");
for (var i=0;i<lists.length;i++) lists[i].setAttribute("data-open","0");
var btns = hdr.querySelectorAll(".sis-dropdown > button");
for (var j=0;j<btns.length;j++) btns[j].setAttribute("aria-expanded","false");
if (activeMount.__sisNavUpdateOpen) activeMount.__sisNavUpdateOpen();
});
document.addEventListener("keydown", function(e){
if (e.key!=="Escape") return;
var activeMount = document.getElementById("sis-header");
if (!activeMount) return;
var hdr = activeMount.querySelector("header");
if (!hdr) return;
var lists = hdr.querySelectorAll(".sis-menu");
for (var i=0;i<lists.length;i++) lists[i].setAttribute("data-open","0");
var btns = hdr.querySelectorAll(".sis-dropdown > button");
for (var j=0;j<btns.length;j++) btns[j].setAttribute("aria-expanded","false");
if (activeMount.__sisNavUpdateOpen) activeMount.__sisNavUpdateOpen();
});
}

// Update <title> and meta[name=description] if present
try {
if (title && document.title !== title) document.title = title;
var metaDesc = document.querySelector('meta[name="description"]');
if (!metaDesc && subtitle){
metaDesc = document.createElement("meta");
metaDesc.setAttribute("name","description");
document.head.appendChild(metaDesc);
}
if (metaDesc && subtitle) metaDesc.setAttribute("content", subtitle);
} catch(e){}
} catch(e){
(global.sisWarn || console.warn)("renderHeaderNav failed", e);
}
}

// Expose
global.renderHeaderNav = renderHeaderNav;

function renderInlineNav(opts){
try{
opts = opts || {};
var nav = opts.nav;
if (!nav || nav.__sisNavRendered) return;
var currentId = opts.currentId || "";
nav.__sisNavRendered = true;
nav.setAttribute("data-sis-nav","1");
nav.innerHTML = "";

var leftGroup = h("div", { class:"sis-nav-group" }, []);
var spacer = h("div", { class:"sis-spacer" }, []);
var rightGroup = h("div", { class:"sis-nav-group" }, []);

function closeAllDropdowns(root){
var container = root || nav;
var lists = container.querySelectorAll(".sis-menu");
for (var i=0;i<lists.length;i++) lists[i].setAttribute("data-open","0");
var btns = container.querySelectorAll(".sis-dropdown > button");
for (var j=0;j<btns.length;j++) btns[j].setAttribute("aria-expanded","false");
if (nav.__sisNavUpdateOpen) nav.__sisNavUpdateOpen();
}

function isMobileNav(){
return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
}

function positionMenu(list, btn){
if (!list || !btn) return;
if (!isMobileNav()){
list.style.position = "";
list.style.left = "";
list.style.right = "";
list.style.top = "";
list.style.bottom = "";
list.style.width = "";
list.style.maxHeight = "";
list.style.transform = "";
return;
}
var rect = btn.getBoundingClientRect();
var top = Math.max(0, Math.round(rect.bottom + 2));
list.style.position = "fixed";
list.style.left = "8px";
list.style.right = "8px";
list.style.top = top + "px";
list.style.bottom = "auto";
list.style.width = "auto";
list.style.transform = "none";
list.style.maxHeight = "calc(100vh - " + (top + 8) + "px)";
}

function addDropdown(group, targetWrap){
var btn = h("button", { class:"sis-pill", type:"button", "aria-expanded":"false" }, [group.label]);
var list = h("div", { class:"sis-menu", "data-open":"0" }, []);
for (var i=0; i<group.items.length; i++){
var item = group.items[i];
var a = h("a", { href:item.href, class:("sis-nav-link" + (item.id===currentId ? " sis-active" : "")) }, [item.label]);
list.appendChild(a);
}
btn.addEventListener("click", function(l, b){
return function(e){
e.preventDefault();
var wasOpen = l.getAttribute("data-open")==="1";
closeAllDropdowns(nav);
l.setAttribute("data-open", wasOpen ? "0" : "1");
b.setAttribute("aria-expanded", wasOpen ? "false" : "true");
if (!wasOpen) positionMenu(l, b);
if (nav.__sisNavUpdateOpen) nav.__sisNavUpdateOpen();
};
}(list, btn));
var wrap = h("div", { class:"sis-dropdown" }, [btn, list]);
targetWrap.appendChild(wrap);
}

var navGroups = getGroupsForAccess();

// Home link only for users who have nav groups (not limited)
if (navGroups.length > 0) {
var homeLink = h("a", {
  href: HOME_LINK.href,
  class: "sis-pill" + (HOME_LINK.id === currentId ? " sis-active" : ""),
  style: "text-decoration:none;"
}, [HOME_LINK.label]);
rightGroup.appendChild(homeLink);
}

for (var g=0; g<navGroups.length; g++){
var group = navGroups[g];
addDropdown(group, rightGroup);
}

nav.appendChild(leftGroup);
nav.appendChild(spacer);
nav.appendChild(rightGroup);

nav.__sisNavUpdateOpen = function(){
var lists = nav.querySelectorAll(".sis-menu");
for (var m=0;m<lists.length;m++){
lists[m].style.display = (lists[m].getAttribute("data-open")==="1") ? "block" : "none";
}
};
nav.__sisNavUpdateOpen();

window.addEventListener("resize", function(){ if (nav.__sisNavUpdateOpen) nav.__sisNavUpdateOpen(); });
window.addEventListener("scroll", function(){ if (nav.__sisNavUpdateOpen) nav.__sisNavUpdateOpen(); }, true);

if (!global.__sisHeaderNavDocBound){
global.__sisHeaderNavDocBound = true;
document.addEventListener("click", function(e){
var activeNav = document.querySelector(".sis-nav[data-sis-nav]");
if (!activeNav) return;
if (activeNav.contains(e.target)) return;
var lists = activeNav.querySelectorAll(".sis-menu");
for (var i=0;i<lists.length;i++) lists[i].setAttribute("data-open","0");
var btns = activeNav.querySelectorAll(".sis-dropdown > button");
for (var j=0;j<btns.length;j++) btns[j].setAttribute("aria-expanded","false");
if (activeNav.__sisNavUpdateOpen) activeNav.__sisNavUpdateOpen();
});
document.addEventListener("keydown", function(e){
if (e.key!=="Escape") return;
var activeNav = document.querySelector(".sis-nav[data-sis-nav]");
if (!activeNav) return;
var lists = activeNav.querySelectorAll(".sis-menu");
for (var i=0;i<lists.length;i++) lists[i].setAttribute("data-open","0");
var btns = activeNav.querySelectorAll(".sis-dropdown > button");
for (var j=0;j<btns.length;j++) btns[j].setAttribute("aria-expanded","false");
if (activeNav.__sisNavUpdateOpen) activeNav.__sisNavUpdateOpen();
});
}
} catch(e){
(global.sisWarn || console.warn)("renderInlineNav failed", e);
}
}

global.renderInlineNav = renderInlineNav;

document.addEventListener("DOMContentLoaded", function(){
var inlineNavs = document.querySelectorAll('nav.sis-nav[data-current]');
for (var i=0; i<inlineNavs.length; i++){
var nav = inlineNavs[i];
var currentId = nav.getAttribute("data-current") || "";
if (!currentId) continue;
if (nav.getAttribute("data-sis-nav")) continue;
renderInlineNav({ nav: nav, currentId: currentId });
}
});
})(window);
