const MAX_FONT_FAMILY_LENGTH = 240;

export const DEFAULT_UI_FONT_FAMILY =
  '"Inter", "SF Pro", -apple-system, BlinkMacSystemFont, sans-serif';

export const DEFAULT_EDITOR_FONT_FAMILY =
  '"Arlecchino Fira Code", "JetBrains Mono", "SF Mono", "Fira Code", monospace';

export const DEFAULT_TERMINAL_FONT_FAMILY =
  "'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'MesloLGS NF', 'Hack Nerd Font', 'FiraCode Nerd Font', Consolas, monospace";

const normalizeFontFamily = (fontFamily: string, fallback: string): string => {
  const normalized = fontFamily.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, MAX_FONT_FAMILY_LENGTH).trim();
};

export const normalizeUiFontFamily = (fontFamily: string): string =>
  normalizeFontFamily(fontFamily, DEFAULT_UI_FONT_FAMILY);

export const normalizeEditorFontFamily = (fontFamily: string): string =>
  normalizeFontFamily(fontFamily, DEFAULT_EDITOR_FONT_FAMILY);

export const normalizeTerminalFontFamily = (fontFamily: string): string =>
  normalizeFontFamily(fontFamily, DEFAULT_TERMINAL_FONT_FAMILY);
