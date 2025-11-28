(function(){
  // Apply saved theme across pages (set by theme-toggle on maintenance)
  try{
    var savedTheme = localStorage.getItem("sis-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      document.documentElement.dataset.theme = savedTheme;
    }
  }catch(e){}

  // Find the filename part of the current path (index.html default)
  function currentFile(){
    var p = window.location.pathname || "";
    var last = p.split('/').filter(Boolean).pop() || "index.html";
    // Allow folder roots to resolve to index.html
    if (!/\./.test(last)) last = "index.html";
    return last.toLowerCase();
  }
  var file = currentFile();

  // Map multi-route aliases (just in case)
  var aliases = {
    "index.html":"index.html",
    "overview.html":"index.html",
    "funnel.html":"funnel.html",
    "fi-funnel.html":"funnel.html",
    "heatmap.html":"heatmap.html",
    "troubleshoot.html":"troubleshoot.html",
    "troubleshooting.html":"troubleshoot.html",
    "maintenance.html":"maintenance.html"
  };

  var target = aliases[file] || file;

  // Auto-activate matching nav link by filename
  var nav = document.querySelector('.sis-nav');
  if (nav){
    var links = nav.querySelectorAll('a[href]');
    links.forEach(function(a){
      try{
        var href = a.getAttribute('href').split('#')[0].split('?')[0];
        var last = href.split('/').filter(Boolean).pop() || "index.html";
        last = last.toLowerCase();
        if (aliases[last]) last = aliases[last];
        if (last === target){ a.classList.add('active'); }
      }catch(e){}
    });
  }
})();
