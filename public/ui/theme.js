const themeKey = "grid-canvas-theme";
const systemTheme = window.matchMedia("(prefers-color-scheme: light)");
let preferredTheme = null;

try {
  const saved = localStorage.getItem(themeKey);
  if (saved === "light" || saved === "dark") preferredTheme = saved;
} catch {
  // The system preference still works when storage is unavailable.
}

function activeTheme() {
  return preferredTheme ?? (systemTheme.matches ? "light" : "dark");
}

function applyTheme() {
  const theme = activeTheme();
  document.documentElement.dataset.theme = theme;
  const button = document.getElementById("btn-theme");
  if (button) button.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

applyTheme();
systemTheme.addEventListener("change", () => {
  if (!preferredTheme) applyTheme();
});

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("btn-theme");
  button.addEventListener("click", () => {
    preferredTheme = activeTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(themeKey, preferredTheme); } catch {}
    applyTheme();
  });
  applyTheme();
});
