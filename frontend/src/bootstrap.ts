import {
  createCustomThemeDefinition,
  getThemeDefinition,
  normalizeThemePreference,
  resolveThemePreference,
  setRuntimeCustomThemes,
} from "./styles/themes";

const BOOT_FALLBACK_ID = "arlecchino-boot-fallback";
const THEME_STORAGE_KEY = "arlecchino-theme";
const CUSTOM_THEMES_STORAGE_KEY = "arlecchino-custom-themes";

const loadBootCustomThemes = () => {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((value, index) => {
      try {
        return [
          createCustomThemeDefinition(value, `custom-theme-${index + 1}.json`),
        ];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
};

const resolveBootTheme = () => {
  try {
    setRuntimeCustomThemes(loadBootCustomThemes());
    const preference = normalizeThemePreference(
      localStorage.getItem(THEME_STORAGE_KEY),
    );
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    return getThemeDefinition(resolveThemePreference(preference, prefersDark));
  } catch {
    return getThemeDefinition("blackprint");
  }
};

const applyBootThemeToDocument = () => {
  const theme = resolveBootTheme();
  const htmlElement = document.documentElement;
  Object.entries(theme.cssVariables).forEach(([name, value]) => {
    htmlElement.style.setProperty(name, value);
  });
  htmlElement.classList.remove("light", "dark");
  htmlElement.classList.add(theme.appearance === "dark" ? "dark" : "light");
  htmlElement.dataset.theme = theme.id;
  htmlElement.dataset.themeAppearance = theme.appearance;
  return theme;
};

const renderBootFallback = (message = "Loading Arlecchino...") => {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  const theme = applyBootThemeToDocument();
  const background =
    theme.cssVariables["--surface-canvas"] ?? theme.colors.bg ?? "#0a0a0a";
  const color =
    theme.cssVariables["--text-primary"] ??
    theme.colors.textPrimary ??
    "#f4f4f4";
  root.innerHTML = "";
  const fallback = document.createElement("div");
  fallback.id = BOOT_FALLBACK_ID;
  fallback.setAttribute(
    "style",
    `position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:${background};color:${color};font:13px -apple-system,BlinkMacSystemFont,'SF Pro',sans-serif;letter-spacing:0;`,
  );
  fallback.textContent = message;
  root.appendChild(fallback);
};

const renderBootError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  renderBootFallback(`Arlecchino failed to start: ${message}`);
  console.error("Arlecchino boot failed:", error);
};

renderBootFallback();

const handleBootError = (event: ErrorEvent) => {
  renderBootError(event.error ?? event.message);
};

const handleBootRejection = (event: PromiseRejectionEvent) => {
  renderBootError(event.reason);
};

window.addEventListener("error", handleBootError);
window.addEventListener("unhandledrejection", handleBootRejection);

const clearBootErrorListeners = () => {
  window.removeEventListener("error", handleBootError);
  window.removeEventListener("unhandledrejection", handleBootRejection);
};

import("./main").then(clearBootErrorListeners).catch(renderBootError);
