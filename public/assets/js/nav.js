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
var GROUPS = [
{ label: "Conversions", items: [
{ id:"overview", label:"Overview", href:"./index.html" },
{ id:"funnel", label:"FI Funnel", href:"./funnel.html" },
{ id:"sources", label:"Sources", href:"./sources.html" },
{ id:"ux-paths", label:"UX Paths", href:"./ux-paths.html" }
]},
{ label: "Reliability", items: [
{ id:"heatmap", label:"Merchant Heatmap", href:"./heatmap.html" },
{ id:"watchlist", label:"Alerts & Watchlist", href:"./watchlist.html" }
]},
{ label: "Ops", items: [
{ id:"troubleshoot", label:"Troubleshoot", href:"./troubleshoot.html" },
{ id:"maintenance", label:"Maintenance", href:"./maintenance.html" },
{ id:"logs", label:"Server Logs", href:"./logs.html" }
]}
];

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
if (mount.__sisNavUpdateOpen) mount.__sisNavUpdateOpen();
};
}(list, btn));
var wrap = h("div", { class:"sis-dropdown" }, [btn, list]);
targetWrap.appendChild(wrap);
}

for (var g=0; g<GROUPS.length; g++){
var group = GROUPS[g];
addDropdown(group, rightGroup);
}

// Theme toggle is only exposed on the Maintenance page.
if (currentId === "maintenance") {
  var themeBtn = h("button", { class:"theme-toggle", type:"button", "aria-pressed":"false" }, ["Light mode"]);
  rightGroup.appendChild(themeBtn);
  try {
    var root = document.documentElement;
    var STORAGE_KEY = "sis-theme";
    var setTheme = function (theme) {
      var next = theme === "dark" ? "dark" : "light";
      root.dataset.theme = next;
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
      themeBtn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
      themeBtn.textContent = next === "dark" ? "Dark mode" : "Light mode";
      if (!themeBtn.querySelector(".theme-toggle__dot")) {
        var dot = document.createElement("span");
        dot.className = "theme-toggle__dot";
        themeBtn.prepend(dot);
      }
    };
    setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    if (!themeBtn.dataset.sisThemeBound) {
      themeBtn.dataset.sisThemeBound = "1";
      themeBtn.addEventListener("click", function () {
        var current = root.dataset.theme === "dark" ? "dark" : "light";
        setTheme(current === "dark" ? "light" : "dark");
      });
    }
  } catch (e) {}
}
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
})(window);
