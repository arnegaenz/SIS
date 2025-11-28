(() => {
  const STORAGE_KEY = "sis-theme";
  const root = document.documentElement;
  const buttons = Array.from(document.querySelectorAll(".theme-toggle"));

  const prefersDark = () =>
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  function setTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    root.dataset.theme = next;
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

  setTheme(saved || (prefersDark() ? "dark" : "light"));

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = root.dataset.theme === "dark" ? "dark" : "light";
      setTheme(current === "dark" ? "light" : "dark");
    });
  });
})();
