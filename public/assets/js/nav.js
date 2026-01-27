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
// Compute base path for navigation links
// Handles both root hosting (Lightsail) and subdirectory hosting (GitHub Pages)
function getBasePath() {
  // Check for explicit base path config
  if (global.SIS_BASE_PATH) return global.SIS_BASE_PATH;
  // Check for <base> tag
  var base = document.querySelector("base[href]");
  if (base && base.href) {
    var href = base.getAttribute("href");
    if (href && href !== "/") return href.replace(/\/$/, "");
  }
  // Detect from script src (nav.js is at /assets/js/nav.js)
  var scripts = document.querySelectorAll('script[src*="nav.js"]');
  for (var i = 0; i < scripts.length; i++) {
    var src = scripts[i].getAttribute("src") || "";
    var match = src.match(/^(.*?)\/assets\/js\/nav\.js/);
    if (match && match[1]) return match[1];
  }
  // Default: assume root
  return "";
}

var BASE_PATH = getBasePath();

function navHref(path) {
  if (!path) return path;
  // Already absolute URL
  if (/^[a-z]+:\/\//i.test(path)) return path;
  // Remove leading ./ or /
  var clean = path.replace(/^\.?\//, "");
  return BASE_PATH + "/" + clean;
}

var GROUPS = [
{ label: "Conversions", items: [
{ id:"overview", label:"Overview", href:navHref("index.html") },
{ id:"funnel", label:"FI Funnel", href:navHref("funnel.html") },
{ id:"customer-success", label:"Customer Success Dashboard", href:navHref("dashboards/customer-success.html") },
{ id:"sources", label:"Sources", href:navHref("sources.html") },
{ id:"ux-paths", label:"UX Paths", href:navHref("ux-paths.html") },
{ id:"placement-outcomes", label:"Placement Outcomes", href:navHref("placement-outcomes.html") }
]},
{ label: "Reliability", items: [
{ id:"heatmap", label:"Merchant Heatmap", href:navHref("heatmap.html") },
{ id:"watchlist", label:"Alerts & Watchlist", href:navHref("watchlist.html") }
]},
{ label: "Ops", items: [
{ id:"operations", label:"Operations Dashboard", href:navHref("dashboards/operations.html") },
{ id:"troubleshoot", label:"Troubleshoot", href:navHref("troubleshoot.html") },
{ id:"realtime", label:"Real-Time", href:navHref("realtime.html") },
{ id:"maintenance", label:"Maintenance", href:navHref("maintenance.html") },
{ id:"synthetic-traffic", label:"Synthetic Traffic", href:navHref("synthetic-traffic.html") },
{ id:"fi-api", label:"FI API", href:navHref("fi-api.html") },
{ id:"logs", label:"Server Logs", href:navHref("logs.html") }
]}
];

function getAccessLevel() {
  try {
    var level = sessionStorage.getItem("sis_access_level");
    if (level === "full" || level === "limited") return level;
    if (sessionStorage.getItem("sis_passcode_ok") === "1") return "full";
  } catch (e) {}
  return "";
}

function getGroupsForAccess() {
  var access = getAccessLevel();
  if (access !== "limited") return GROUPS;
  var allowed = { funnel: true, troubleshoot: true };
  var next = [];
  for (var g = 0; g < GROUPS.length; g++) {
    var group = GROUPS[g];
    var items = [];
    for (var i = 0; i < group.items.length; i++) {
      var item = group.items[i];
      if (allowed[item.id]) items.push(item);
    }
    if (items.length) next.push({ label: group.label, items: items });
  }
  return next;
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
for (var g=0; g<navGroups.length; g++){
var group = navGroups[g];
addDropdown(group, rightGroup);
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
