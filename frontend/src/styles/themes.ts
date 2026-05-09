import type { ITheme } from "@xterm/xterm";

export const BUILT_IN_THEME_IDS = [
  "blackprint",
  "arlecchino-light",
  "arlecchino-stage",
  "arlecchino-matinee",
  "catppuccin-latte",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
] as const;

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];
export const CUSTOM_THEME_PREFIX = "custom:";
export type CustomThemeId = `${typeof CUSTOM_THEME_PREFIX}${string}`;
export type ThemeId = BuiltInThemeId | CustomThemeId;
export type ThemePreference = "system" | ThemeId;
export type ThemeAppearance = "light" | "dark";

export interface ThemeUIColorPalette {
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  bgPanel: string;
  bgHover: string;
  border: string;
  borderSubtle: string;
  borderLight: string;
  text: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
}

export interface EditorThemePalette {
  background: string;
  surface: string;
  surfaceElevated: string;
  gutter: string;
  scrollbarTrack: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textSoft: string;
  textMuted: string;
  caret: string;
  activeLine: string;
  activeLineGutter: string;
  selection: string;
  selectionInactive: string;
  selectionMatch: string;
  bracketMatch: string;
  searchMatch: string;
  tooltipBg: string;
  tooltipBgStrong: string;
  tooltipShadow: string;
  ghostText: string;
  highlight: string;
  comment: string;
  string: string;
  number: string;
  keyword: string;
  operator: string;
  type: string;
  property: string;
  function: string;
  variable: string;
  constant: string;
  accent: string;
}

export interface IDEThemeDefinition {
  id: ThemeId;
  name: string;
  appearance: ThemeAppearance;
  description: string;
  colors: ThemeUIColorPalette;
  editor: EditorThemePalette;
  terminal: ITheme;
  cssVariables: Record<string, string>;
}

type CatppuccinFlavor = {
  rosewater: string;
  flamingo: string;
  pink: string;
  mauve: string;
  red: string;
  maroon: string;
  peach: string;
  yellow: string;
  green: string;
  teal: string;
  sky: string;
  sapphire: string;
  blue: string;
  lavender: string;
  text: string;
  subtext1: string;
  subtext0: string;
  overlay2: string;
  overlay1: string;
  overlay0: string;
  surface2: string;
  surface1: string;
  surface0: string;
  base: string;
  mantle: string;
  crust: string;
};

const blackprintEditor: EditorThemePalette = {
  background: "#030303",
  surface: "#070707",
  surfaceElevated: "#0b0c0c",
  gutter: "#050505",
  scrollbarTrack: "#010101",
  scrollbarThumb: "#3d4142",
  scrollbarThumbHover: "#5c6264",
  border: "rgba(230, 234, 235, 0.085)",
  borderStrong: "rgba(230, 234, 235, 0.16)",
  text: "#d1d5d6",
  textSoft: "#9ca3a5",
  textMuted: "#5f6668",
  caret: "#eef1f2",
  activeLine: "rgba(230, 234, 235, 0.04)",
  activeLineGutter: "#c6cbcc",
  selection: "rgba(214, 218, 219, 0.18)",
  selectionInactive: "rgba(214, 218, 219, 0.11)",
  selectionMatch: "rgba(214, 218, 219, 0.09)",
  bracketMatch: "rgba(214, 218, 219, 0.12)",
  searchMatch: "rgba(214, 218, 219, 0.13)",
  tooltipBg: "rgba(9, 9, 9, 0.985)",
  tooltipBgStrong: "rgba(6, 6, 6, 0.99)",
  tooltipShadow:
    "inset 0 1px 0 rgba(230, 234, 235, 0.035), 0 18px 40px -24px rgba(0, 0, 0, 0.86), 0 28px 72px -42px rgba(0, 0, 0, 0.82)",
  ghostText: "rgba(209, 213, 214, 0.34)",
  highlight: "rgba(196, 203, 205, 0.14)",
  comment: "#6e7476",
  string: "#b4babb",
  number: "#b8b1a7",
  keyword: "#e1e4e5",
  operator: "#aeb5b7",
  type: "#bdb8af",
  property: "#b8bfc1",
  function: "#c4c9ca",
  variable: "#d1d5d6",
  constant: "#bdb8af",
  accent: "#e5e8e9",
};

const blackprintTerminal: ITheme = {
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  cursor: "#ef4444",
  cursorAccent: "#0a0a0a",
  selectionBackground: "rgba(239, 68, 68, 0.3)",
  black: "#000000",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#f5f5f5",
  brightBlack: "#525252",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
};

const arlecchinoStageEditor: EditorThemePalette = {
  background: "#0D0E10",
  surface: "#111315",
  surfaceElevated: "#17191C",
  gutter: "#101113",
  scrollbarTrack: "#090A0B",
  scrollbarThumb: "#4A3A21",
  scrollbarThumbHover: "#6E5B2E",
  border: "rgba(230, 225, 214, 0.1)",
  borderStrong: "rgba(201, 162, 75, 0.26)",
  text: "#E6E1D6",
  textSoft: "#BEB5A6",
  textMuted: "#81796E",
  caret: "#C9A24B",
  activeLine: "rgba(201, 162, 75, 0.075)",
  activeLineGutter: "#C9A24B",
  selection: "rgba(158, 27, 46, 0.34)",
  selectionInactive: "rgba(158, 27, 46, 0.2)",
  selectionMatch: "rgba(47, 167, 154, 0.16)",
  bracketMatch: "rgba(201, 162, 75, 0.22)",
  searchMatch: "rgba(201, 162, 75, 0.18)",
  tooltipBg: "rgba(17, 19, 21, 0.985)",
  tooltipBgStrong: "rgba(13, 14, 16, 0.99)",
  tooltipShadow:
    "inset 0 1px 0 rgba(230, 225, 214, 0.055), 0 18px 40px -24px rgba(0, 0, 0, 0.86), 0 28px 72px -42px rgba(0, 0, 0, 0.82)",
  ghostText: "rgba(230, 225, 214, 0.32)",
  highlight: "rgba(47, 167, 154, 0.16)",
  comment: "#777E76",
  string: "#8BC9A5",
  number: "#D4B26A",
  keyword: "#D94855",
  operator: "#B3A894",
  type: "#E0B95A",
  property: "#69C3B9",
  function: "#D7B561",
  variable: "#E6E1D6",
  constant: "#E2BE6A",
  accent: "#2FA79A",
};

const arlecchinoStageTerminal: ITheme = {
  background: "#0D0E10",
  foreground: "#E6E1D6",
  cursor: "#C9A24B",
  cursorAccent: "#0D0E10",
  selectionBackground: "rgba(158, 27, 46, 0.34)",
  black: "#0D0E10",
  red: "#9E1B2E",
  green: "#5EAD75",
  yellow: "#C9A24B",
  blue: "#5C96B3",
  magenta: "#B46B9B",
  cyan: "#2FA79A",
  white: "#E6E1D6",
  brightBlack: "#6F6B63",
  brightRed: "#D94855",
  brightGreen: "#8BC9A5",
  brightYellow: "#E2BE6A",
  brightBlue: "#80B7D1",
  brightMagenta: "#D18AB8",
  brightCyan: "#73D1C7",
  brightWhite: "#FAF6ED",
};

const arlecchinoMatineeEditor: EditorThemePalette = {
  background: "#FAF6ED",
  surface: "#F5EFDF",
  surfaceElevated: "#EEE4D1",
  gutter: "#F2EAD8",
  scrollbarTrack: "#EDE4D0",
  scrollbarThumb: "#C9B98F",
  scrollbarThumbHover: "#B99A55",
  border: "rgba(30, 30, 30, 0.1)",
  borderStrong: "rgba(184, 57, 58, 0.24)",
  text: "#1E1E1E",
  textSoft: "#4F4B45",
  textMuted: "#6F6B63",
  caret: "#B8393A",
  activeLine: "rgba(212, 178, 106, 0.14)",
  activeLineGutter: "#9E6F23",
  selection: "rgba(184, 57, 58, 0.18)",
  selectionInactive: "rgba(184, 57, 58, 0.11)",
  selectionMatch: "rgba(47, 167, 154, 0.13)",
  bracketMatch: "rgba(212, 178, 106, 0.24)",
  searchMatch: "rgba(212, 178, 106, 0.22)",
  tooltipBg: "rgba(250, 246, 237, 0.985)",
  tooltipBgStrong: "rgba(245, 239, 223, 0.99)",
  tooltipShadow:
    "inset 0 1px 0 rgba(255, 255, 255, 0.86), 0 18px 38px -24px rgba(78, 60, 30, 0.3), 0 28px 70px -42px rgba(78, 60, 30, 0.22)",
  ghostText: "rgba(30, 30, 30, 0.32)",
  highlight: "rgba(47, 167, 154, 0.12)",
  comment: "#8B8376",
  string: "#2F7D5B",
  number: "#9B6A18",
  keyword: "#B8393A",
  operator: "#6F6B63",
  type: "#986F24",
  property: "#247F77",
  function: "#7A541C",
  variable: "#1E1E1E",
  constant: "#9B6A18",
  accent: "#2FA79A",
};

const arlecchinoMatineeTerminal: ITheme = {
  background: "#FAF6ED",
  foreground: "#1E1E1E",
  cursor: "#B8393A",
  cursorAccent: "#FAF6ED",
  selectionBackground: "rgba(184, 57, 58, 0.18)",
  black: "#1E1E1E",
  red: "#B8393A",
  green: "#2F7D5B",
  yellow: "#9B6A18",
  blue: "#2E6F9E",
  magenta: "#8D4C78",
  cyan: "#247F77",
  white: "#4F4B45",
  brightBlack: "#6F6B63",
  brightRed: "#D14A4B",
  brightGreen: "#3E9A72",
  brightYellow: "#D4B26A",
  brightBlue: "#4D8CB8",
  brightMagenta: "#A96292",
  brightCyan: "#2FA79A",
  brightWhite: "#1E1E1E",
};

const createThemeCssVariables = (
  colors: ThemeUIColorPalette,
  editor: EditorThemePalette,
  terminal: ITheme,
  options: {
    shellShadow: string;
    shellShadowActive: string;
    gridLine: string;
    gridDot: string;
    shadowSoft: string;
    shadowOverlay: string;
    shadowDrag: string;
    shadowPanel: string;
    shellInnerHighlight: string;
    shellBorder: string;
    shellBorderStrong: string;
    shellInlineDivider: string;
    focusRing: string;
    focusRingStrong: string;
    borderFocus: string;
    accentPrimary?: string;
    accentPrimarySoft?: string;
    accentBrand: string;
    accentBrandSoft: string;
    statuses: {
      success: string;
      warning: string;
      error: string;
      info: string;
    };
  },
): Record<string, string> => ({
  "--bg-blackprint": colors.bg,
  "--surface-canvas": colors.bg,
  "--surface-1": colors.bgSecondary,
  "--surface-2": colors.bgTertiary,
  "--surface-3": colors.bgPanel,
  "--surface-elevated": colors.bgPanel,
  "--surface-overlay": colors.bgPanel,
  "--surface-shell": colors.bgSecondary,
  "--surface-shell-soft": colors.bgSecondary,
  "--surface-shell-strong": colors.bgTertiary,
  "--surface-shell-panel": colors.bgPanel,
  "--surface-hover": colors.bgHover,
  "--surface-active": colors.bgHover,
  "--bg-secondary": colors.bgSecondary,
  "--bg-tertiary": colors.bgTertiary,
  "--bg-elevated": colors.bgPanel,
  "--bg-hover": colors.bgHover,
  "--bg-primary": colors.bgTertiary,
  "--text-primary": colors.textPrimary,
  "--text-secondary": colors.textSecondary,
  "--text-tertiary": colors.textMuted,
  "--text-muted": colors.textMuted,
  "--border-subtle": colors.borderSubtle,
  "--border-default": colors.border,
  "--border-strong": colors.borderLight,
  "--grid-line": options.gridLine,
  "--grid-dot": options.gridDot,
  "--accent-primary": options.accentPrimary ?? colors.textPrimary,
  "--accent-primary-soft": options.accentPrimarySoft ?? colors.bgHover,
  "--accent-brand": options.accentBrand,
  "--accent-brand-soft": options.accentBrandSoft,
  "--focus-ring": options.focusRing,
  "--focus-ring-strong": options.focusRingStrong,
  "--border-focus": options.borderFocus,
  "--status-success": options.statuses.success,
  "--status-warning": options.statuses.warning,
  "--status-error": options.statuses.error,
  "--status-info": options.statuses.info,
  "--surface-panel-header": colors.bgTertiary,
  "--switch-track": colors.bgPanel,
  "--switch-track-checked": options.accentPrimarySoft ?? colors.bgHover,
  "--switch-thumb": colors.textPrimary,
  "--switch-border": colors.border,
  "--switch-border-checked": colors.textPrimary,
  "--shell-border": options.shellBorder,
  "--shell-border-strong": options.shellBorderStrong,
  "--shell-inline-divider": options.shellInlineDivider,
  "--shell-inner-highlight": options.shellInnerHighlight,
  "--shell-shadow": options.shellShadow,
  "--shell-shadow-active": options.shellShadowActive,
  "--shadow-soft": options.shadowSoft,
  "--shadow-overlay": options.shadowOverlay,
  "--shadow-drag": options.shadowDrag,
  "--shadow-panel": options.shadowPanel,
  "--editor-bg": editor.background,
  "--editor-surface": editor.surface,
  "--editor-surface-elevated": editor.surfaceElevated,
  "--editor-gutter": editor.gutter,
  "--editor-scrollbar-track": editor.scrollbarTrack,
  "--editor-scrollbar-thumb": editor.scrollbarThumb,
  "--editor-scrollbar-thumb-hover": editor.scrollbarThumbHover,
  "--editor-border": editor.border,
  "--editor-border-strong": editor.borderStrong,
  "--editor-text": editor.text,
  "--editor-text-soft": editor.textSoft,
  "--editor-text-muted": editor.textMuted,
  "--editor-caret": editor.caret,
  "--editor-active-line": editor.activeLine,
  "--editor-active-line-gutter": editor.activeLineGutter,
  "--editor-selection": editor.selection,
  "--editor-selection-inactive": editor.selectionInactive,
  "--editor-selection-match": editor.selectionMatch,
  "--editor-bracket-match": editor.bracketMatch,
  "--editor-search-match": editor.searchMatch,
  "--editor-tooltip-bg": editor.tooltipBg,
  "--editor-tooltip-bg-strong": editor.tooltipBgStrong,
  "--editor-tooltip-shadow": editor.tooltipShadow,
  "--editor-ghost-text": editor.ghostText,
  "--editor-highlight": editor.highlight,
  "--editor-accent": editor.accent,
  "--syntax-comment": editor.comment,
  "--syntax-string": editor.string,
  "--syntax-number": editor.number,
  "--syntax-keyword": editor.keyword,
  "--syntax-operator": editor.operator,
  "--syntax-type": editor.type,
  "--syntax-property": editor.property,
  "--syntax-function": editor.function,
  "--syntax-variable": editor.variable,
  "--syntax-constant": editor.constant,
  "--terminal-bg": terminal.background ?? colors.bg,
});

const createThemeDefinition = (
  input: Omit<IDEThemeDefinition, "cssVariables"> & {
    variableOptions: Parameters<typeof createThemeCssVariables>[3];
  },
): IDEThemeDefinition => ({
  id: input.id,
  name: input.name,
  appearance: input.appearance,
  description: input.description,
  colors: input.colors,
  editor: input.editor,
  terminal: input.terminal,
  cssVariables: createThemeCssVariables(
    input.colors,
    input.editor,
    input.terminal,
    input.variableOptions,
  ),
});

const createCustomThemeVariableOptions = (
  colors: ThemeUIColorPalette,
  editor: EditorThemePalette,
  terminal: ITheme,
  appearance: ThemeAppearance,
): Parameters<typeof createThemeCssVariables>[3] => {
  const dark = appearance === "dark";
  const accentBrand = editor.accent || terminal.cursor || colors.textPrimary;

  return {
    gridLine: dark ? "rgba(255, 255, 255, 0.045)" : "rgba(0, 0, 0, 0.055)",
    gridDot: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.075)",
    shellBorder: dark ? "rgba(255, 255, 255, 0.09)" : "rgba(0, 0, 0, 0.1)",
    shellBorderStrong: dark
      ? "rgba(255, 255, 255, 0.16)"
      : "rgba(0, 0, 0, 0.18)",
    shellInlineDivider: dark
      ? "rgba(255, 255, 255, 0.08)"
      : "rgba(0, 0, 0, 0.09)",
    shellInnerHighlight: dark
      ? "rgba(255, 255, 255, 0.06)"
      : "rgba(255, 255, 255, 0.78)",
    shellShadow: dark
      ? "0 0 0 1px rgba(255, 255, 255, 0.02), 0 10px 30px -18px rgba(0, 0, 0, 0.62), 0 24px 52px -36px rgba(0, 0, 0, 0.72)"
      : "0 0 0 1px rgba(0, 0, 0, 0.04), 0 10px 30px -18px rgba(0, 0, 0, 0.18), 0 24px 52px -36px rgba(0, 0, 0, 0.2)",
    shellShadowActive: dark
      ? "0 0 0 1px rgba(255, 255, 255, 0.04), 0 18px 44px -20px rgba(0, 0, 0, 0.72), 0 30px 90px -34px rgba(0, 0, 0, 0.82)"
      : "0 0 0 1px rgba(0, 0, 0, 0.07), 0 18px 44px -20px rgba(0, 0, 0, 0.22), 0 30px 90px -34px rgba(0, 0, 0, 0.24)",
    shadowSoft: dark
      ? "0 8px 24px rgba(0, 0, 0, 0.28)"
      : "0 8px 24px rgba(0, 0, 0, 0.12)",
    shadowOverlay: dark
      ? "0 0 0 1px rgba(255, 255, 255, 0.02), 0 18px 40px -18px rgba(0, 0, 0, 0.72), 0 28px 72px -28px rgba(0, 0, 0, 0.8)"
      : "0 0 0 1px rgba(0, 0, 0, 0.04), 0 18px 40px -18px rgba(0, 0, 0, 0.2), 0 28px 72px -28px rgba(0, 0, 0, 0.24)",
    shadowDrag: dark
      ? "0 0 0 1px rgba(255, 255, 255, 0.04), 0 20px 44px -20px rgba(0, 0, 0, 0.82), 0 36px 96px -32px rgba(0, 0, 0, 0.88)"
      : "0 0 0 1px rgba(0, 0, 0, 0.08), 0 20px 44px -20px rgba(0, 0, 0, 0.24), 0 36px 96px -32px rgba(0, 0, 0, 0.28)",
    shadowPanel: dark
      ? "0 0 0 1px rgba(0, 0, 0, 0.12), 0 4px 6px -1px rgba(0, 0, 0, 0.28), 0 12px 16px -4px rgba(0, 0, 0, 0.32), 0 24px 32px -8px rgba(0, 0, 0, 0.28)"
      : "0 0 0 1px rgba(0, 0, 0, 0.06), 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 12px 16px -4px rgba(0, 0, 0, 0.1), 0 24px 32px -8px rgba(0, 0, 0, 0.1)",
    focusRing: `color-mix(in srgb, ${accentBrand} 24%, transparent)`,
    focusRingStrong: `color-mix(in srgb, ${accentBrand} 38%, transparent)`,
    borderFocus: `color-mix(in srgb, ${accentBrand} 44%, transparent)`,
    accentBrand,
    accentBrandSoft: `color-mix(in srgb, ${accentBrand} 14%, transparent)`,
    statuses: {
      success: terminal.green ?? colors.textSecondary,
      warning: terminal.yellow ?? colors.textSecondary,
      error: terminal.red ?? colors.textSecondary,
      info: terminal.blue ?? colors.textSecondary,
    },
  };
};

const blackprintTheme = createThemeDefinition({
  id: "blackprint",
  name: "Blackprint",
  appearance: "dark",
  description: "Default Arlecchino dark theme.",
  colors: {
    bg: "#0a0a0a",
    bgSecondary: "#111111",
    bgTertiary: "#1a1a1a",
    bgPanel: "#181818",
    bgHover: "#2a2a2a",
    border: "#383838",
    borderSubtle: "#2a2a2a",
    borderLight: "#4a4a4a",
    text: "#ffffff",
    textPrimary: "#ffffff",
    textSecondary: "#b2b2b2",
    textMuted: "#606060",
  },
  editor: blackprintEditor,
  terminal: blackprintTerminal,
  variableOptions: {
    gridLine: "rgba(255, 255, 255, 0.04)",
    gridDot: "rgba(255, 255, 255, 0.06)",
    shellBorder: "rgba(255, 255, 255, 0.08)",
    shellBorderStrong: "rgba(255, 255, 255, 0.14)",
    shellInlineDivider: "rgba(255, 255, 255, 0.08)",
    shellInnerHighlight: "rgba(255, 255, 255, 0.06)",
    shellShadow:
      "0 0 0 1px rgba(255, 255, 255, 0.02), 0 10px 30px -18px rgba(0, 0, 0, 0.62), 0 24px 52px -36px rgba(0, 0, 0, 0.72)",
    shellShadowActive:
      "0 0 0 1px rgba(255, 255, 255, 0.04), 0 18px 44px -20px rgba(0, 0, 0, 0.72), 0 30px 90px -34px rgba(0, 0, 0, 0.82)",
    shadowSoft: "0 8px 24px rgba(0, 0, 0, 0.28)",
    shadowOverlay:
      "0 0 0 1px rgba(255, 255, 255, 0.02), 0 18px 40px -18px rgba(0, 0, 0, 0.72), 0 28px 72px -28px rgba(0, 0, 0, 0.8)",
    shadowDrag:
      "0 0 0 1px rgba(255, 255, 255, 0.04), 0 20px 44px -20px rgba(0, 0, 0, 0.82), 0 36px 96px -32px rgba(0, 0, 0, 0.88)",
    shadowPanel:
      "0 0 0 1px rgba(0, 0, 0, 0.1), 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 12px 16px -4px rgba(0, 0, 0, 0.35), 0 24px 32px -8px rgba(0, 0, 0, 0.3)",
    focusRing: "rgba(255, 255, 255, 0.2)",
    focusRingStrong: "rgba(255, 255, 255, 0.34)",
    borderFocus: "rgba(255, 255, 255, 0.42)",
    accentBrand: "#f26b5e",
    accentBrandSoft: "rgba(242, 107, 94, 0.14)",
    statuses: {
      success: "#22c55e",
      warning: "#f59e0b",
      error: "#ef4444",
      info: "#3b82f6",
    },
  },
});

const lightTheme = createThemeDefinition({
  id: "arlecchino-light",
  name: "Arlecchino Light",
  appearance: "light",
  description: "Light inversion of the default Blackprint editor surfaces.",
  colors: {
    bg: "#ffffff",
    bgSecondary: "#f7f7f7",
    bgTertiary: "#eeeeee",
    bgPanel: "#ffffff",
    bgHover: "#e6e6e6",
    border: "#cfcfcf",
    borderSubtle: "#dddddd",
    borderLight: "#9f9f9f",
    text: "#0a0a0a",
    textPrimary: "#0a0a0a",
    textSecondary: "#3f3f3f",
    textMuted: "#727272",
  },
  editor: {
    background: "#fbfbfa",
    surface: "#f3f3f1",
    surfaceElevated: "#ececea",
    gutter: "#f0f0ee",
    scrollbarTrack: "#e7e7e4",
    scrollbarThumb: "#b9bebf",
    scrollbarThumbHover: "#92999b",
    border: "rgba(20, 24, 25, 0.105)",
    borderStrong: "rgba(20, 24, 25, 0.2)",
    text: "#1d2021",
    textSoft: "#4d5557",
    textMuted: "#757e80",
    caret: "#111314",
    activeLine: "rgba(20, 24, 25, 0.042)",
    activeLineGutter: "#252a2c",
    selection: "rgba(20, 24, 25, 0.15)",
    selectionInactive: "rgba(20, 24, 25, 0.09)",
    selectionMatch: "rgba(20, 24, 25, 0.075)",
    bracketMatch: "rgba(20, 24, 25, 0.105)",
    searchMatch: "rgba(20, 24, 25, 0.11)",
    tooltipBg: "rgba(251, 251, 250, 0.985)",
    tooltipBgStrong: "rgba(243, 243, 241, 0.99)",
    tooltipShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.86), 0 18px 38px -24px rgba(20, 24, 25, 0.26), 0 28px 70px -42px rgba(20, 24, 25, 0.18)",
    ghostText: "rgba(29, 32, 33, 0.32)",
    highlight: "rgba(45, 53, 56, 0.105)",
    comment: "#7a8284",
    string: "#596365",
    number: "#675f55",
    keyword: "#1f2426",
    operator: "#606a6d",
    type: "#625d55",
    property: "#566266",
    function: "#4f5c61",
    variable: "#1d2021",
    constant: "#625d55",
    accent: "#2f3638",
  },
  terminal: {
    background: "#ffffff",
    foreground: "#171717",
    cursor: "#d94c41",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(217, 76, 65, 0.18)",
    black: "#0a0a0a",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#525252",
    brightBlack: "#737373",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#eab308",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#171717",
  },
  variableOptions: {
    gridLine: "rgba(0, 0, 0, 0.05)",
    gridDot: "rgba(0, 0, 0, 0.07)",
    shellBorder: "rgba(0, 0, 0, 0.08)",
    shellBorderStrong: "rgba(0, 0, 0, 0.14)",
    shellInlineDivider: "rgba(0, 0, 0, 0.08)",
    shellInnerHighlight: "rgba(255, 255, 255, 0.92)",
    shellShadow:
      "0 0 0 1px rgba(0, 0, 0, 0.04), 0 10px 30px -18px rgba(0, 0, 0, 0.2), 0 24px 52px -36px rgba(0, 0, 0, 0.22)",
    shellShadowActive:
      "0 0 0 1px rgba(0, 0, 0, 0.08), 0 18px 44px -20px rgba(0, 0, 0, 0.24), 0 30px 90px -34px rgba(0, 0, 0, 0.28)",
    shadowSoft: "0 8px 24px rgba(0, 0, 0, 0.12)",
    shadowOverlay:
      "0 0 0 1px rgba(0, 0, 0, 0.04), 0 18px 40px -18px rgba(0, 0, 0, 0.24), 0 28px 72px -28px rgba(0, 0, 0, 0.28)",
    shadowDrag:
      "0 0 0 1px rgba(0, 0, 0, 0.08), 0 20px 44px -20px rgba(0, 0, 0, 0.28), 0 36px 96px -32px rgba(0, 0, 0, 0.3)",
    shadowPanel:
      "0 0 0 1px rgba(0, 0, 0, 0.08), 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 12px 16px -4px rgba(0, 0, 0, 0.1), 0 24px 32px -8px rgba(0, 0, 0, 0.1)",
    focusRing: "rgba(0, 0, 0, 0.16)",
    focusRingStrong: "rgba(0, 0, 0, 0.26)",
    borderFocus: "rgba(0, 0, 0, 0.38)",
    accentBrand: "#d94c41",
    accentBrandSoft: "rgba(217, 76, 65, 0.12)",
    statuses: {
      success: "#16a34a",
      warning: "#ca8a04",
      error: "#dc2626",
      info: "#2563eb",
    },
  },
});

const arlecchinoStageTheme = createThemeDefinition({
  id: "arlecchino-stage",
  name: "Arlecchino Stage",
  appearance: "dark",
  description:
    "Theatrical dark IDE theme with velvet red cues, brass dividers, and teal focus states.",
  colors: {
    bg: "#0D0E10",
    bgSecondary: "#111315",
    bgTertiary: "#1A1C1F",
    bgPanel: "#151719",
    bgHover: "#24282C",
    border: "#3A3428",
    borderSubtle: "#24272A",
    borderLight: "#6E5B2E",
    text: "#E6E1D6",
    textPrimary: "#E6E1D6",
    textSecondary: "#BEB5A6",
    textMuted: "#81796E",
  },
  editor: arlecchinoStageEditor,
  terminal: arlecchinoStageTerminal,
  variableOptions: {
    gridLine: "rgba(230, 225, 214, 0.035)",
    gridDot: "rgba(201, 162, 75, 0.07)",
    shellBorder: "rgba(201, 162, 75, 0.14)",
    shellBorderStrong: "rgba(201, 162, 75, 0.28)",
    shellInlineDivider: "rgba(230, 225, 214, 0.08)",
    shellInnerHighlight: "rgba(230, 225, 214, 0.065)",
    shellShadow:
      "0 0 0 1px rgba(201, 162, 75, 0.035), 0 10px 30px -18px rgba(0, 0, 0, 0.68), 0 24px 52px -36px rgba(0, 0, 0, 0.78)",
    shellShadowActive:
      "0 0 0 1px rgba(201, 162, 75, 0.08), 0 18px 44px -20px rgba(0, 0, 0, 0.76), 0 30px 90px -34px rgba(0, 0, 0, 0.86)",
    shadowSoft: "0 8px 24px rgba(0, 0, 0, 0.34)",
    shadowOverlay:
      "0 0 0 1px rgba(201, 162, 75, 0.045), 0 18px 40px -18px rgba(0, 0, 0, 0.76), 0 28px 72px -28px rgba(0, 0, 0, 0.84)",
    shadowDrag:
      "0 0 0 1px rgba(47, 167, 154, 0.16), 0 20px 44px -20px rgba(0, 0, 0, 0.86), 0 36px 96px -32px rgba(0, 0, 0, 0.9)",
    shadowPanel:
      "0 0 0 1px rgba(201, 162, 75, 0.08), 0 4px 6px -1px rgba(0, 0, 0, 0.34), 0 12px 16px -4px rgba(0, 0, 0, 0.38), 0 24px 32px -8px rgba(0, 0, 0, 0.34)",
    focusRing: "rgba(47, 167, 154, 0.26)",
    focusRingStrong: "rgba(47, 167, 154, 0.42)",
    borderFocus: "rgba(47, 167, 154, 0.52)",
    accentPrimary: "#2FA79A",
    accentPrimarySoft: "rgba(47, 167, 154, 0.14)",
    accentBrand: "#9E1B2E",
    accentBrandSoft: "rgba(158, 27, 46, 0.16)",
    statuses: {
      success: "#5EAD75",
      warning: "#C9A24B",
      error: "#D94855",
      info: "#2FA79A",
    },
  },
});

const arlecchinoMatineeTheme = createThemeDefinition({
  id: "arlecchino-matinee",
  name: "Arlecchino Matinee",
  appearance: "light",
  description:
    "Theatrical light IDE theme with ivory playbill surfaces, red cues, and brass structure.",
  colors: {
    bg: "#FAF6ED",
    bgSecondary: "#F5EFDF",
    bgTertiary: "#EDE4D0",
    bgPanel: "#FFFCF4",
    bgHover: "#EFE4CC",
    border: "#D6D1C4",
    borderSubtle: "#E6DECA",
    borderLight: "#D4B26A",
    text: "#1E1E1E",
    textPrimary: "#1E1E1E",
    textSecondary: "#4F4B45",
    textMuted: "#6F6B63",
  },
  editor: arlecchinoMatineeEditor,
  terminal: arlecchinoMatineeTerminal,
  variableOptions: {
    gridLine: "rgba(30, 30, 30, 0.045)",
    gridDot: "rgba(184, 57, 58, 0.07)",
    shellBorder: "rgba(134, 97, 33, 0.18)",
    shellBorderStrong: "rgba(184, 57, 58, 0.28)",
    shellInlineDivider: "rgba(30, 30, 30, 0.08)",
    shellInnerHighlight: "rgba(255, 255, 255, 0.86)",
    shellShadow:
      "0 0 0 1px rgba(134, 97, 33, 0.06), 0 10px 30px -18px rgba(78, 60, 30, 0.22), 0 24px 52px -36px rgba(78, 60, 30, 0.24)",
    shellShadowActive:
      "0 0 0 1px rgba(184, 57, 58, 0.12), 0 18px 44px -20px rgba(78, 60, 30, 0.26), 0 30px 90px -34px rgba(78, 60, 30, 0.28)",
    shadowSoft: "0 8px 24px rgba(78, 60, 30, 0.13)",
    shadowOverlay:
      "0 0 0 1px rgba(134, 97, 33, 0.07), 0 18px 40px -18px rgba(78, 60, 30, 0.24), 0 28px 72px -28px rgba(78, 60, 30, 0.28)",
    shadowDrag:
      "0 0 0 1px rgba(47, 167, 154, 0.2), 0 20px 44px -20px rgba(78, 60, 30, 0.28), 0 36px 96px -32px rgba(78, 60, 30, 0.3)",
    shadowPanel:
      "0 0 0 1px rgba(134, 97, 33, 0.08), 0 4px 6px -1px rgba(78, 60, 30, 0.09), 0 12px 16px -4px rgba(78, 60, 30, 0.11), 0 24px 32px -8px rgba(78, 60, 30, 0.1)",
    focusRing: "rgba(47, 167, 154, 0.22)",
    focusRingStrong: "rgba(47, 167, 154, 0.34)",
    borderFocus: "rgba(47, 167, 154, 0.44)",
    accentPrimary: "#2FA79A",
    accentPrimarySoft: "rgba(47, 167, 154, 0.12)",
    accentBrand: "#B8393A",
    accentBrandSoft: "rgba(184, 57, 58, 0.12)",
    statuses: {
      success: "#2F7D5B",
      warning: "#9B6A18",
      error: "#B8393A",
      info: "#247F77",
    },
  },
});

const catppuccin: Record<
  "latte" | "frappe" | "macchiato" | "mocha",
  CatppuccinFlavor
> = {
  latte: {
    rosewater: "#dc8a78",
    flamingo: "#dd7878",
    pink: "#ea76cb",
    mauve: "#8839ef",
    red: "#d20f39",
    maroon: "#e64553",
    peach: "#fe640b",
    yellow: "#df8e1d",
    green: "#40a02b",
    teal: "#179299",
    sky: "#04a5e5",
    sapphire: "#209fb5",
    blue: "#1e66f5",
    lavender: "#7287fd",
    text: "#4c4f69",
    subtext1: "#5c5f77",
    subtext0: "#6c6f85",
    overlay2: "#7c7f93",
    overlay1: "#8c8fa1",
    overlay0: "#9ca0b0",
    surface2: "#acb0be",
    surface1: "#bcc0cc",
    surface0: "#ccd0da",
    base: "#eff1f5",
    mantle: "#e6e9ef",
    crust: "#dce0e8",
  },
  frappe: {
    rosewater: "#f2d5cf",
    flamingo: "#eebebe",
    pink: "#f4b8e4",
    mauve: "#ca9ee6",
    red: "#e78284",
    maroon: "#ea999c",
    peach: "#ef9f76",
    yellow: "#e5c890",
    green: "#a6d189",
    teal: "#81c8be",
    sky: "#99d1db",
    sapphire: "#85c1dc",
    blue: "#8caaee",
    lavender: "#babbf1",
    text: "#c6d0f5",
    subtext1: "#b5bfe2",
    subtext0: "#a5adce",
    overlay2: "#949cbb",
    overlay1: "#838ba7",
    overlay0: "#737994",
    surface2: "#626880",
    surface1: "#51576d",
    surface0: "#414559",
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
  },
  macchiato: {
    rosewater: "#f4dbd6",
    flamingo: "#f0c6c6",
    pink: "#f5bde6",
    mauve: "#c6a0f6",
    red: "#ed8796",
    maroon: "#ee99a0",
    peach: "#f5a97f",
    yellow: "#eed49f",
    green: "#a6da95",
    teal: "#8bd5ca",
    sky: "#91d7e3",
    sapphire: "#7dc4e4",
    blue: "#8aadf4",
    lavender: "#b7bdf8",
    text: "#cad3f5",
    subtext1: "#b8c0e0",
    subtext0: "#a5adcb",
    overlay2: "#939ab7",
    overlay1: "#8087a2",
    overlay0: "#6e738d",
    surface2: "#5b6078",
    surface1: "#494d64",
    surface0: "#363a4f",
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926",
  },
  mocha: {
    rosewater: "#f5e0dc",
    flamingo: "#f2cdcd",
    pink: "#f5c2e7",
    mauve: "#cba6f7",
    red: "#f38ba8",
    maroon: "#eba0ac",
    peach: "#fab387",
    yellow: "#f9e2af",
    green: "#a6e3a1",
    teal: "#94e2d5",
    sky: "#89dceb",
    sapphire: "#74c7ec",
    blue: "#89b4fa",
    lavender: "#b4befe",
    text: "#cdd6f4",
    subtext1: "#bac2de",
    subtext0: "#a6adc8",
    overlay2: "#9399b2",
    overlay1: "#7f849c",
    overlay0: "#6c7086",
    surface2: "#585b70",
    surface1: "#45475a",
    surface0: "#313244",
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
  },
};

const createCatppuccinTheme = (
  id: BuiltInThemeId,
  name: string,
  appearance: ThemeAppearance,
  flavor: CatppuccinFlavor,
): IDEThemeDefinition => {
  const dark = appearance === "dark";
  const colors: ThemeUIColorPalette = {
    bg: flavor.base,
    bgSecondary: flavor.mantle,
    bgTertiary: flavor.surface0,
    bgPanel: dark ? flavor.surface0 : flavor.base,
    bgHover: dark ? flavor.surface1 : flavor.surface0,
    border: dark ? flavor.surface1 : flavor.surface2,
    borderSubtle: dark ? flavor.surface0 : flavor.surface1,
    borderLight: dark ? flavor.surface2 : flavor.overlay0,
    text: flavor.text,
    textPrimary: flavor.text,
    textSecondary: flavor.subtext1,
    textMuted: dark ? flavor.overlay1 : flavor.subtext0,
  };

  const editor: EditorThemePalette = {
    background: flavor.base,
    surface: flavor.mantle,
    surfaceElevated: dark ? flavor.surface0 : flavor.crust,
    gutter: flavor.mantle,
    scrollbarTrack: flavor.crust,
    scrollbarThumb: dark ? flavor.surface1 : flavor.surface2,
    scrollbarThumbHover: dark ? flavor.surface2 : flavor.overlay0,
    border: dark
      ? "color-mix(in srgb, var(--surface-1) 72%, transparent)"
      : "color-mix(in srgb, var(--surface-2) 64%, transparent)",
    borderStrong: dark
      ? "color-mix(in srgb, var(--surface-2) 78%, transparent)"
      : "color-mix(in srgb, var(--overlay-2, #7c7f93) 52%, transparent)",
    text: flavor.text,
    textSoft: flavor.subtext1,
    textMuted: dark ? flavor.overlay1 : flavor.subtext0,
    caret: flavor.rosewater,
    activeLine: dark ? "rgba(255, 255, 255, 0.045)" : "rgba(76, 79, 105, 0.07)",
    activeLineGutter: flavor.text,
    selection: dark ? "rgba(203, 166, 247, 0.24)" : "rgba(136, 57, 239, 0.2)",
    selectionInactive: dark
      ? "rgba(203, 166, 247, 0.15)"
      : "rgba(136, 57, 239, 0.12)",
    selectionMatch: dark
      ? "rgba(137, 180, 250, 0.16)"
      : "rgba(30, 102, 245, 0.12)",
    bracketMatch: dark
      ? "rgba(245, 194, 231, 0.18)"
      : "rgba(234, 118, 203, 0.14)",
    searchMatch: dark ? "rgba(249, 226, 175, 0.2)" : "rgba(223, 142, 29, 0.16)",
    tooltipBg: dark
      ? "color-mix(in srgb, var(--surface-shell) 96%, transparent)"
      : "color-mix(in srgb, var(--surface-canvas) 98%, transparent)",
    tooltipBgStrong: dark
      ? "color-mix(in srgb, var(--surface-shell-panel) 98%, transparent)"
      : "color-mix(in srgb, var(--surface-1) 98%, transparent)",
    tooltipShadow: dark
      ? "inset 0 1px 0 rgba(255, 255, 255, 0.035), 0 18px 40px -24px rgba(0, 0, 0, 0.74), 0 28px 72px -42px rgba(0, 0, 0, 0.68)"
      : "inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 18px 40px -24px rgba(76, 79, 105, 0.26), 0 28px 72px -42px rgba(76, 79, 105, 0.22)",
    ghostText: dark ? "rgba(205, 214, 244, 0.34)" : "rgba(76, 79, 105, 0.32)",
    highlight: dark ? "rgba(137, 180, 250, 0.14)" : "rgba(30, 102, 245, 0.12)",
    comment: flavor.overlay1,
    string: flavor.green,
    number: flavor.peach,
    keyword: flavor.mauve,
    operator: flavor.overlay2,
    type: flavor.yellow,
    property: flavor.sky,
    function: flavor.blue,
    variable: flavor.text,
    constant: flavor.peach,
    accent: flavor.mauve,
  };

  const terminal: ITheme = {
    background: flavor.base,
    foreground: flavor.text,
    cursor: flavor.rosewater,
    cursorAccent: flavor.base,
    selectionBackground: dark
      ? "rgba(203, 166, 247, 0.24)"
      : "rgba(136, 57, 239, 0.2)",
    black: flavor.crust,
    red: flavor.red,
    green: flavor.green,
    yellow: flavor.yellow,
    blue: flavor.blue,
    magenta: flavor.mauve,
    cyan: flavor.teal,
    white: flavor.subtext1,
    brightBlack: flavor.overlay0,
    brightRed: flavor.maroon,
    brightGreen: flavor.teal,
    brightYellow: flavor.peach,
    brightBlue: flavor.sapphire,
    brightMagenta: flavor.pink,
    brightCyan: flavor.sky,
    brightWhite: flavor.text,
  };

  return createThemeDefinition({
    id,
    name,
    appearance,
    description: `Catppuccin ${name.replace("Catppuccin ", "")} palette.`,
    colors,
    editor,
    terminal,
    variableOptions: {
      gridLine: dark
        ? "rgba(205, 214, 244, 0.045)"
        : "rgba(76, 79, 105, 0.055)",
      gridDot: dark ? "rgba(205, 214, 244, 0.06)" : "rgba(76, 79, 105, 0.075)",
      shellBorder: dark
        ? "rgba(205, 214, 244, 0.09)"
        : "rgba(76, 79, 105, 0.12)",
      shellBorderStrong: dark
        ? "rgba(205, 214, 244, 0.16)"
        : "rgba(76, 79, 105, 0.2)",
      shellInlineDivider: dark
        ? "rgba(205, 214, 244, 0.08)"
        : "rgba(76, 79, 105, 0.1)",
      shellInnerHighlight: dark
        ? "rgba(255, 255, 255, 0.06)"
        : "rgba(255, 255, 255, 0.8)",
      shellShadow: dark
        ? "0 0 0 1px rgba(205, 214, 244, 0.02), 0 10px 30px -18px rgba(0, 0, 0, 0.62), 0 24px 52px -36px rgba(0, 0, 0, 0.72)"
        : "0 0 0 1px rgba(76, 79, 105, 0.05), 0 10px 30px -18px rgba(76, 79, 105, 0.18), 0 24px 52px -36px rgba(76, 79, 105, 0.22)",
      shellShadowActive: dark
        ? "0 0 0 1px rgba(205, 214, 244, 0.04), 0 18px 44px -20px rgba(0, 0, 0, 0.72), 0 30px 90px -34px rgba(0, 0, 0, 0.82)"
        : "0 0 0 1px rgba(76, 79, 105, 0.08), 0 18px 44px -20px rgba(76, 79, 105, 0.22), 0 30px 90px -34px rgba(76, 79, 105, 0.26)",
      shadowSoft: dark
        ? "0 8px 24px rgba(0, 0, 0, 0.28)"
        : "0 8px 24px rgba(76, 79, 105, 0.12)",
      shadowOverlay: dark
        ? "0 0 0 1px rgba(205, 214, 244, 0.02), 0 18px 40px -18px rgba(0, 0, 0, 0.72), 0 28px 72px -28px rgba(0, 0, 0, 0.8)"
        : "0 0 0 1px rgba(76, 79, 105, 0.05), 0 18px 40px -18px rgba(76, 79, 105, 0.2), 0 28px 72px -28px rgba(76, 79, 105, 0.24)",
      shadowDrag: dark
        ? "0 0 0 1px rgba(205, 214, 244, 0.04), 0 20px 44px -20px rgba(0, 0, 0, 0.82), 0 36px 96px -32px rgba(0, 0, 0, 0.88)"
        : "0 0 0 1px rgba(76, 79, 105, 0.08), 0 20px 44px -20px rgba(76, 79, 105, 0.24), 0 36px 96px -32px rgba(76, 79, 105, 0.28)",
      shadowPanel: dark
        ? "0 0 0 1px rgba(0, 0, 0, 0.12), 0 4px 6px -1px rgba(0, 0, 0, 0.28), 0 12px 16px -4px rgba(0, 0, 0, 0.32), 0 24px 32px -8px rgba(0, 0, 0, 0.28)"
        : "0 0 0 1px rgba(76, 79, 105, 0.08), 0 4px 6px -1px rgba(76, 79, 105, 0.08), 0 12px 16px -4px rgba(76, 79, 105, 0.1), 0 24px 32px -8px rgba(76, 79, 105, 0.1)",
      focusRing: dark
        ? "color-mix(in srgb, var(--accent-brand) 24%, transparent)"
        : "color-mix(in srgb, var(--accent-brand) 22%, transparent)",
      focusRingStrong: dark
        ? "color-mix(in srgb, var(--accent-brand) 38%, transparent)"
        : "color-mix(in srgb, var(--accent-brand) 34%, transparent)",
      borderFocus: dark
        ? "color-mix(in srgb, var(--accent-brand) 46%, transparent)"
        : "color-mix(in srgb, var(--accent-brand) 42%, transparent)",
      accentBrand: flavor.blue,
      accentBrandSoft: dark
        ? "color-mix(in srgb, var(--accent-brand) 16%, transparent)"
        : "color-mix(in srgb, var(--accent-brand) 12%, transparent)",
      statuses: {
        success: flavor.green,
        warning: flavor.yellow,
        error: flavor.red,
        info: flavor.blue,
      },
    },
  });
};

const themeList: IDEThemeDefinition[] = [
  blackprintTheme,
  lightTheme,
  arlecchinoStageTheme,
  arlecchinoMatineeTheme,
  createCatppuccinTheme(
    "catppuccin-latte",
    "Catppuccin Latte",
    "light",
    catppuccin.latte,
  ),
  createCatppuccinTheme(
    "catppuccin-frappe",
    "Catppuccin Frappe",
    "dark",
    catppuccin.frappe,
  ),
  createCatppuccinTheme(
    "catppuccin-macchiato",
    "Catppuccin Macchiato",
    "dark",
    catppuccin.macchiato,
  ),
  createCatppuccinTheme(
    "catppuccin-mocha",
    "Catppuccin Mocha",
    "dark",
    catppuccin.mocha,
  ),
];

export const builtInThemes = Object.fromEntries(
  themeList.map((theme) => [theme.id, theme]),
) as Record<BuiltInThemeId, IDEThemeDefinition>;

export const themeOptions = themeList.map(({ id, name, appearance }) => ({
  value: id,
  label: name,
  appearance,
}));

export const isBuiltInThemeId = (value: unknown): value is BuiltInThemeId =>
  typeof value === "string" &&
  BUILT_IN_THEME_IDS.includes(value as BuiltInThemeId);

export const isCustomThemeId = (value: unknown): value is CustomThemeId =>
  typeof value === "string" &&
  value.startsWith(CUSTOM_THEME_PREFIX) &&
  value.length > CUSTOM_THEME_PREFIX.length;

let runtimeCustomThemes: Record<CustomThemeId, IDEThemeDefinition> =
  {} as Record<CustomThemeId, IDEThemeDefinition>;

export const setRuntimeCustomThemes = (themes: IDEThemeDefinition[]) => {
  runtimeCustomThemes = Object.fromEntries(
    themes
      .filter((theme) => isCustomThemeId(theme.id))
      .map((theme) => [theme.id, theme]),
  ) as Record<CustomThemeId, IDEThemeDefinition>;
};

export const getRuntimeCustomThemes = (): IDEThemeDefinition[] =>
  Object.values(runtimeCustomThemes);

export const isThemeId = (value: unknown): value is ThemeId =>
  isBuiltInThemeId(value) || isCustomThemeId(value);

export const normalizeThemePreference = (value: unknown): ThemePreference => {
  if (value === "system") {
    return "system";
  }
  if (value === "dark") {
    return "blackprint";
  }
  if (value === "light") {
    return "arlecchino-light";
  }
  if (isBuiltInThemeId(value)) {
    return value;
  }
  if (isCustomThemeId(value)) {
    return value;
  }
  return "system";
};

export const resolveThemePreference = (
  preference: ThemePreference,
  prefersDark: boolean,
): ThemeId => {
  if (preference === "system") {
    return prefersDark ? "blackprint" : "arlecchino-light";
  }
  return preference;
};

export const getThemeDefinition = (id: ThemeId): IDEThemeDefinition => {
  if (isCustomThemeId(id)) {
    return runtimeCustomThemes[id] ?? builtInThemes.blackprint;
  }
  return builtInThemes[id] ?? builtInThemes.blackprint;
};

export const getThemeColorsById = (id: ThemeId): ThemeUIColorPalette =>
  getThemeDefinition(id).colors;

export const getThemeTerminalById = (id: ThemeId): ITheme => ({
  ...getThemeDefinition(id).terminal,
});

const themeUIColorKeys = [
  "bg",
  "bgSecondary",
  "bgTertiary",
  "bgPanel",
  "bgHover",
  "border",
  "borderSubtle",
  "borderLight",
  "text",
  "textPrimary",
  "textSecondary",
  "textMuted",
] as const;

const editorThemeKeys = [
  "background",
  "surface",
  "surfaceElevated",
  "gutter",
  "scrollbarTrack",
  "scrollbarThumb",
  "scrollbarThumbHover",
  "border",
  "borderStrong",
  "text",
  "textSoft",
  "textMuted",
  "caret",
  "activeLine",
  "activeLineGutter",
  "selection",
  "selectionInactive",
  "selectionMatch",
  "bracketMatch",
  "searchMatch",
  "tooltipBg",
  "tooltipBgStrong",
  "tooltipShadow",
  "ghostText",
  "highlight",
  "comment",
  "string",
  "number",
  "keyword",
  "operator",
  "type",
  "property",
  "function",
  "variable",
  "constant",
  "accent",
] as const;

const terminalThemeKeys = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readRequiredString = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): string => {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Theme ${label}.${key} must be a non-empty string.`);
  }
  return value.trim();
};

const readOptionalString = (
  record: Record<string, unknown>,
  key: string,
): string | null => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
};

const normalizeCustomThemeName = (name: string): string =>
  name.replace(/\s+\(Example\)$/i, "").trim() || name;

const readStringPalette = <Key extends string>(
  value: unknown,
  keys: readonly Key[],
  label: string,
): Record<Key, string> => {
  if (!isRecord(value)) {
    throw new Error(`Theme ${label} must be an object.`);
  }

  return Object.fromEntries(
    keys.map((key) => [key, readRequiredString(value, key, label)]),
  ) as Record<Key, string>;
};

const createCustomThemeId = (rawId: string): CustomThemeId => {
  const withoutPrefix = rawId.startsWith(CUSTOM_THEME_PREFIX)
    ? rawId.slice(CUSTOM_THEME_PREFIX.length)
    : rawId;
  const slug =
    withoutPrefix
      .replace(/\.json$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom-theme";

  return `${CUSTOM_THEME_PREFIX}${slug}`;
};

export const createCustomThemeDefinition = (
  value: unknown,
  sourceName = "Custom theme",
): IDEThemeDefinition => {
  if (!isRecord(value)) {
    throw new Error("Theme JSON must be an object.");
  }

  const name = normalizeCustomThemeName(
    readOptionalString(value, "name") ?? sourceName,
  );
  const rawId = readOptionalString(value, "id") ?? name;
  const appearance = value.appearance;
  if (appearance !== "light" && appearance !== "dark") {
    throw new Error('Theme appearance must be "light" or "dark".');
  }

  const colors = readStringPalette(
    value.colors,
    themeUIColorKeys,
    "colors",
  ) as ThemeUIColorPalette;
  const editor = readStringPalette(
    value.editor,
    editorThemeKeys,
    "editor",
  ) as EditorThemePalette;
  const terminal = readStringPalette(
    value.terminal,
    terminalThemeKeys,
    "terminal",
  ) as ITheme;

  return createThemeDefinition({
    id: createCustomThemeId(rawId),
    name,
    appearance,
    description:
      readOptionalString(value, "description") ??
      `Custom theme from ${sourceName}.`,
    colors,
    editor,
    terminal,
    variableOptions: createCustomThemeVariableOptions(
      colors,
      editor,
      terminal,
      appearance,
    ),
  });
};
