import React, {
  createContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Theme, ThemeContextType } from "../types/theme";
import {
  createCustomThemeDefinition,
  getThemeDefinition,
  normalizeThemePreference,
  resolveThemePreference,
  setRuntimeCustomThemes,
  type IDEThemeDefinition,
  type ThemeId,
} from "../styles/themes";

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);

interface ThemeProviderProps {
  children: React.ReactNode;
}

const CUSTOM_THEMES_STORAGE_KEY = "arlecchino-custom-themes";

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

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
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
    (newTheme: Theme) => {
      const normalizedTheme = normalizeThemePreference(newTheme);
      previewThemeRef.current = null;
      localStorage.setItem("arlecchino-theme", normalizedTheme);
      applyThemeToDocument(
        normalizedTheme,
        window.matchMedia("(prefers-color-scheme: dark)").matches,
        { updateContextState: true },
      );
      setTheme((currentTheme) =>
        currentTheme === normalizedTheme ? currentTheme : normalizedTheme,
      );
    },
    [applyThemeToDocument],
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

  const contextValue = useMemo(
    () => ({
      theme,
      setTheme: handleSetTheme,
      previewTheme: handlePreviewTheme,
      customThemes,
      addCustomTheme: handleAddCustomTheme,
      isDark,
      resolvedThemeId,
      activeTheme,
    }),
    [
      activeTheme,
      customThemes,
      handleAddCustomTheme,
      handlePreviewTheme,
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
