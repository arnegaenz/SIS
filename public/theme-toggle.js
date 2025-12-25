document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "sis-theme";
  const root = document.documentElement;
  const buttons = Array.from(document.querySelectorAll(".theme-toggle"));

  if (buttons.length === 0) {
    console.warn("No theme toggle buttons found on page");
    return;
  }

  const prefersDark = () =>
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  function setTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    console.log("Setting theme to:", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage failures
    }
    buttons.forEach((btn) => {
      btn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
      btn.textContent = next === "dark" ? "Dark mode" : "Light mode";
      if (!btn.querySelector(".theme-toggle__dot")) {
        const dot = document.createElement("span");
        dot.className = "theme-toggle__dot";
        btn.prepend(dot);
      }
    });
  }

  const saved = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();

  console.log("Initializing theme toggle, saved theme:", saved);
  setTheme(saved || (prefersDark() ? "dark" : "light"));

  buttons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
      console.log("Toggle clicked, current:", current, "switching to:", current === "dark" ? "light" : "dark");
      setTheme(current === "dark" ? "light" : "dark");
    });
  });
});
