import React, { createContext, useEffect, useState } from "react";
import { Theme, ThemeContextType } from "../types/theme";

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("arlecchino-theme") as Theme;
    if (saved) return saved;
    // Default to 'system' to respect OS theme
    return "system";
  });

  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem("arlecchino-theme") as Theme;
    if (!saved) {
      // No saved preference - use system preference
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    if (saved === "light") return false;
    if (saved === "dark") return true;
    if (saved === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    const htmlElement = document.querySelector("html");
    if (!htmlElement) return;

    const applyTheme = (isDarkMode: boolean) => {
      htmlElement.classList.remove("light", "dark");
      htmlElement.classList.add(isDarkMode ? "dark" : "light");
      setIsDark(isDarkMode);
      console.log(
        "🎨 Theme applied:",
        isDarkMode ? "dark" : "light",
        "HTML classes:",
        htmlElement.className,
      );
    };

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    } else {
      applyTheme(theme === "dark");
    }
  }, [theme]);

  const handleSetTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem("arlecchino-theme", newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};
