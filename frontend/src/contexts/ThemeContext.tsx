import React, {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "framer-motion";
import { flushSync } from "react-dom";
import {
  Theme,
  ThemeContextType,
  type ThemeTransitionOptions,
} from "../types/theme";
import {
  createCustomThemeDefinition,
  getThemeDefinition,
  normalizeThemePreference,
  resolveThemePreference,
  setRuntimeCustomThemes,
  type CustomThemeId,
  type IDEThemeDefinition,
  type ThemeId,
} from "../styles/themes";
import { beginInteractiveSurfaceMotionWindow } from "../stores/performanceStore";

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);

interface ThemeProviderProps {
  children: React.ReactNode;
}

const CUSTOM_THEMES_STORAGE_KEY = "arlecchino-custom-themes";
const THEME_TRANSITION_TRIGGER_MAX_AGE_MS = 1400;
const THEME_SPATIAL_REVEAL_DURATION_SECONDS = 0.9;
const THEME_SPATIAL_REVEAL_DURATION_MS =
  THEME_SPATIAL_REVEAL_DURATION_SECONDS * 1000;
const THEME_SPATIAL_REVEAL_SETTLE_MS = 140;
const THEME_SPATIAL_REVEAL_OVERSCAN_PX = 72;
const THEME_SPATIAL_OVERLAY_CLASS = "theme-spatial-transition-overlay";
const THEME_SPATIAL_ACTIVE_DATASET_KEY = "themeSpatialTransitionActive";

type ThemeTransitionOrigin = {
  x: number;
  y: number;
};

type ThemeTransitionTrigger = ThemeTransitionOrigin & {
  capturedAt: number;
};

type ThemeSpatialOverlayState = {
  id: number;
  element: HTMLElement;
};

const serializeTheme = (theme: IDEThemeDefinition) => ({
  id: theme.id,
  name: theme.name,
  appearance: theme.appearance,
  description: theme.description,
  colors: theme.colors,
  editor: theme.editor,
  terminal: theme.terminal,
});

const loadStoredCustomThemes = (): IDEThemeDefinition[] => {
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

const persistCustomThemes = (themes: IDEThemeDefinition[]) => {
  localStorage.setItem(
    CUSTOM_THEMES_STORAGE_KEY,
    JSON.stringify(themes.map(serializeTheme)),
  );
};

const getCustomThemeFallback = (appearance: "light" | "dark"): Theme =>
  appearance === "dark" ? "blackprint" : "arlecchino-light";

const getInteractionNow = (): number =>
  typeof performance === "undefined" ? Date.now() : performance.now();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getViewportThemeTransitionOrigin = (): ThemeTransitionOrigin => ({
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
});

const getFocusedElementThemeTransitionOrigin =
  (): ThemeTransitionOrigin | null => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
      return null;
    }

    const rect = activeElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  };

const clampThemeTransitionOrigin = ({
  x,
  y,
}: ThemeTransitionOrigin): ThemeTransitionOrigin => ({
  x: clamp(x, 0, window.innerWidth),
  y: clamp(y, 0, window.innerHeight),
});

const resolveThemeTransitionOrigin = (
  trigger: ThemeTransitionTrigger | null,
): ThemeTransitionOrigin => {
  const recentTrigger =
    trigger &&
    getInteractionNow() - trigger.capturedAt <=
      THEME_TRANSITION_TRIGGER_MAX_AGE_MS
      ? trigger
      : null;

  return clampThemeTransitionOrigin(
    recentTrigger ??
      getFocusedElementThemeTransitionOrigin() ??
      getViewportThemeTransitionOrigin(),
  );
};

const resolveThemeTransitionRadius = ({
  x,
  y,
}: ThemeTransitionOrigin): number => {
  const farthestX = Math.max(x, window.innerWidth - x);
  const farthestY = Math.max(y, window.innerHeight - y);
  return Math.hypot(farthestX, farthestY) + THEME_SPATIAL_REVEAL_OVERSCAN_PX;
};

const shouldCloneThemeSpatialBodyChild = (
  child: Element,
): child is HTMLElement =>
  child instanceof HTMLElement &&
  child.tagName === "DIV" &&
  child.id !== "root" &&
  !child.classList.contains(THEME_SPATIAL_OVERLAY_CLASS);

const sanitizeThemeSpatialClone = (clone: HTMLElement) => {
  clone.setAttribute("aria-hidden", "true");
  clone.querySelectorAll("[data-testid]").forEach((element) => {
    element.removeAttribute("data-testid");
  });
  clone.querySelectorAll("[data-theme-option-value]").forEach((element) => {
    element.removeAttribute("data-theme-option-value");
  });
  clone.removeAttribute("data-testid");
  clone.removeAttribute("data-theme-option-value");

  clone.querySelectorAll("[id]").forEach((element) => {
    element.removeAttribute("id");
  });
  clone.removeAttribute("id");
};

const createThemeSpatialOverlay = (
  origin: ThemeTransitionOrigin,
  radius: number,
  previousTheme: IDEThemeDefinition,
): HTMLElement => {
  const overlay = document.createElement("div");
  overlay.className = THEME_SPATIAL_OVERLAY_CLASS;
  overlay.setAttribute("aria-hidden", "true");
  overlay.dataset.theme = previousTheme.id;
  overlay.dataset.themeAppearance = previousTheme.appearance;
  overlay.classList.add(previousTheme.appearance === "dark" ? "dark" : "light");
  overlay.style.setProperty("--theme-spatial-origin-x", `${origin.x}px`);
  overlay.style.setProperty("--theme-spatial-origin-y", `${origin.y}px`);
  overlay.style.setProperty("--theme-spatial-max-radius", `${radius}px`);
  overlay.style.setProperty(
    "--theme-spatial-reveal-duration",
    `${THEME_SPATIAL_REVEAL_DURATION_MS}ms`,
  );

  Object.entries(previousTheme.cssVariables).forEach(([name, value]) => {
    overlay.style.setProperty(name, value);
  });

  Array.from(document.body.children)
    .filter(shouldCloneThemeSpatialBodyChild)
    .forEach((child) => {
      const clone = child.cloneNode(true);
      if (clone instanceof HTMLElement) {
        sanitizeThemeSpatialClone(clone);
        overlay.appendChild(clone);
      }
    });

  document.body.appendChild(overlay);
  document.body.dataset[THEME_SPATIAL_ACTIVE_DATASET_KEY] = "true";

  return overlay;
};

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const reduceThemeMotion = useReducedMotion();
  const [customThemes, setCustomThemes] = useState<IDEThemeDefinition[]>(
    loadStoredCustomThemes,
  );
  setRuntimeCustomThemes(customThemes);

  const [theme, setTheme] = useState<Theme>(() => {
    return normalizeThemePreference(localStorage.getItem("arlecchino-theme"));
  });
  const previewThemeRef = useRef<Theme | null>(null);

  const [isDark, setIsDark] = useState(() => {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    const resolved = resolveThemePreference(
      normalizeThemePreference(localStorage.getItem("arlecchino-theme")),
      prefersDark,
    );
    return getThemeDefinition(resolved).appearance === "dark";
  });

  const [resolvedThemeId, setResolvedThemeId] = useState<ThemeId>(() => {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    return resolveThemePreference(theme, prefersDark);
  });

  const activeTheme = getThemeDefinition(resolvedThemeId);
  const lastThemeTransitionTriggerRef = useRef<ThemeTransitionTrigger | null>(
    null,
  );
  const themeTransitionOverlayIdRef = useRef(0);
  const themeTransitionCleanupTimerRef = useRef<number | null>(null);
  const themeSpatialOverlayRef = useRef<ThemeSpatialOverlayState | null>(null);

  const applyThemeToDocument = useCallback(
    (
      preference: Theme,
      prefersDark: boolean,
      options: { updateContextState: boolean },
    ) => {
      const htmlElement = document.querySelector("html");
      if (!htmlElement) return;

      const nextThemeId = resolveThemePreference(preference, prefersDark);
      const nextTheme = getThemeDefinition(nextThemeId);
      const isDarkMode = nextTheme.appearance === "dark";

      Object.entries(nextTheme.cssVariables).forEach(([name, value]) => {
        htmlElement.style.setProperty(name, value);
      });

      htmlElement.classList.remove("light", "dark");
      htmlElement.classList.add(isDarkMode ? "dark" : "light");
      htmlElement.dataset.theme = nextTheme.id;
      htmlElement.dataset.themeAppearance = nextTheme.appearance;

      if (options.updateContextState) {
        setResolvedThemeId((currentThemeId) =>
          currentThemeId === nextTheme.id ? currentThemeId : nextTheme.id,
        );
        setIsDark((currentIsDark) =>
          currentIsDark === isDarkMode ? currentIsDark : isDarkMode,
        );
      }
    },
    [],
  );

  const clearThemeSpatialOverlay = useCallback(() => {
    themeSpatialOverlayRef.current?.element.remove();
    themeSpatialOverlayRef.current = null;
    delete document.body.dataset[THEME_SPATIAL_ACTIVE_DATASET_KEY];
  }, []);

  const clearThemeTransitionTimers = useCallback(() => {
    if (themeTransitionCleanupTimerRef.current !== null) {
      window.clearTimeout(themeTransitionCleanupTimerRef.current);
      themeTransitionCleanupTimerRef.current = null;
    }
    clearThemeSpatialOverlay();
  }, [clearThemeSpatialOverlay]);

  useLayoutEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) {
        return;
      }

      lastThemeTransitionTriggerRef.current = {
        x: event.clientX,
        y: event.clientY,
        capturedAt: getInteractionNow(),
      };
    };

    window.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
    };
  }, []);

  useEffect(() => {
    return clearThemeTransitionTimers;
  }, [clearThemeTransitionTimers]);

  useLayoutEffect(() => {
    const htmlElement = document.querySelector("html");
    if (!htmlElement) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    previewThemeRef.current = null;
    applyThemeToDocument(theme, mediaQuery.matches, {
      updateContextState: true,
    });

    if (theme === "system") {
      const listener = (e: MediaQueryListEvent) => {
        applyThemeToDocument(theme, e.matches, {
          updateContextState: true,
        });
      };
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, [applyThemeToDocument, theme]);

  const handleSetTheme = useCallback(
    (newTheme: Theme, options?: ThemeTransitionOptions) => {
      const normalizedTheme = normalizeThemePreference(newTheme);
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      const nextThemeId = resolveThemePreference(normalizedTheme, prefersDark);
      const commitTheme = () => {
        localStorage.setItem("arlecchino-theme", normalizedTheme);
        applyThemeToDocument(normalizedTheme, prefersDark, {
          updateContextState: true,
        });
        setTheme((currentTheme) =>
          currentTheme === normalizedTheme ? currentTheme : normalizedTheme,
        );
      };

      previewThemeRef.current = null;

      if (
        normalizedTheme === theme ||
        nextThemeId === resolvedThemeId ||
        reduceThemeMotion
      ) {
        clearThemeTransitionTimers();
        commitTheme();
        return;
      }

      const origin = clampThemeTransitionOrigin(
        options?.transitionOrigin ??
          resolveThemeTransitionOrigin(lastThemeTransitionTriggerRef.current),
      );
      const radius = resolveThemeTransitionRadius(origin);
      const motionDurationMs =
        THEME_SPATIAL_REVEAL_DURATION_MS + THEME_SPATIAL_REVEAL_SETTLE_MS;
      beginInteractiveSurfaceMotionWindow(motionDurationMs);

      clearThemeTransitionTimers();

      const overlayId = themeTransitionOverlayIdRef.current + 1;
      themeTransitionOverlayIdRef.current = overlayId;
      const overlayElement = createThemeSpatialOverlay(
        origin,
        radius,
        activeTheme,
      );
      themeSpatialOverlayRef.current = {
        id: overlayId,
        element: overlayElement,
      };

      flushSync(commitTheme);

      themeTransitionCleanupTimerRef.current = window.setTimeout(() => {
        themeTransitionCleanupTimerRef.current = null;
        if (themeSpatialOverlayRef.current?.id === overlayId) {
          clearThemeSpatialOverlay();
        }
      }, THEME_SPATIAL_REVEAL_DURATION_MS);
    },
    [
      applyThemeToDocument,
      activeTheme,
      clearThemeSpatialOverlay,
      clearThemeTransitionTimers,
      reduceThemeMotion,
      resolvedThemeId,
      theme,
    ],
  );

  const handlePreviewTheme = useCallback(
    (newTheme: Theme | null) => {
      const normalizedTheme =
        newTheme === null ? null : normalizeThemePreference(newTheme);

      if (previewThemeRef.current === normalizedTheme) {
        return;
      }

      previewThemeRef.current = normalizedTheme;
      applyThemeToDocument(
        normalizedTheme ?? theme,
        window.matchMedia("(prefers-color-scheme: dark)").matches,
        { updateContextState: false },
      );
    },
    [applyThemeToDocument, theme],
  );

  const handleAddCustomTheme = useCallback(
    (value: unknown, sourceName?: string) => {
      const nextTheme = createCustomThemeDefinition(value, sourceName);

      setCustomThemes((currentThemes) => {
        const withoutDuplicate = currentThemes.filter(
          (existingTheme) => existingTheme.id !== nextTheme.id,
        );
        const nextThemes = [...withoutDuplicate, nextTheme];
        persistCustomThemes(nextThemes);
        setRuntimeCustomThemes(nextThemes);
        return nextThemes;
      });

      return nextTheme;
    },
    [],
  );

  const handleRemoveCustomTheme = useCallback(
    (themeId: CustomThemeId) => {
      const removedTheme = customThemes.find(
        (customTheme) => customTheme.id === themeId,
      );
      if (!removedTheme) {
        return;
      }

      previewThemeRef.current = null;
      setCustomThemes((currentThemes) => {
        const nextThemes = currentThemes.filter(
          (customTheme) => customTheme.id !== themeId,
        );
        persistCustomThemes(nextThemes);
        setRuntimeCustomThemes(nextThemes);
        return nextThemes;
      });

      if (theme === themeId) {
        handleSetTheme(getCustomThemeFallback(removedTheme.appearance));
      }
    },
    [customThemes, handleSetTheme, theme],
  );

  const contextValue = useMemo(
    () => ({
      theme,
      setTheme: handleSetTheme,
      previewTheme: handlePreviewTheme,
      customThemes,
      addCustomTheme: handleAddCustomTheme,
      removeCustomTheme: handleRemoveCustomTheme,
      isDark,
      resolvedThemeId,
      activeTheme,
    }),
    [
      activeTheme,
      customThemes,
      handleAddCustomTheme,
      handlePreviewTheme,
      handleRemoveCustomTheme,
      handleSetTheme,
      isDark,
      resolvedThemeId,
      theme,
    ],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};
