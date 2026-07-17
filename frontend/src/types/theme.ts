import type {
  CustomThemeId,
  IDEThemeDefinition,
  ThemeId,
  ThemePreference,
} from "../styles/themes";

export type Theme = ThemePreference;

export interface ThemeTransitionOrigin {
  x: number;
  y: number;
}

export interface ThemeTransitionOptions {
  transitionOrigin?: ThemeTransitionOrigin;
}

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme, options?: ThemeTransitionOptions) => void;
  previewTheme: (theme: Theme | null) => void;
  customThemes: IDEThemeDefinition[];
  addCustomTheme: (value: unknown, sourceName?: string) => IDEThemeDefinition;
  removeCustomTheme: (themeId: CustomThemeId) => void;
  isDark: boolean;
  resolvedThemeId: ThemeId;
  activeTheme: IDEThemeDefinition;
}
