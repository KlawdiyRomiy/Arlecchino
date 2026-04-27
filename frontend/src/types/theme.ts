import type {
  IDEThemeDefinition,
  ThemeId,
  ThemePreference,
} from "../styles/themes";

export type Theme = ThemePreference;

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  previewTheme: (theme: Theme | null) => void;
  customThemes: IDEThemeDefinition[];
  addCustomTheme: (value: unknown, sourceName?: string) => IDEThemeDefinition;
  isDark: boolean;
  resolvedThemeId: ThemeId;
  activeTheme: IDEThemeDefinition;
}
