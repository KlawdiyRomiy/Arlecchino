import type { ITerminalOptions } from "@xterm/xterm";
import { getThemeTerminalById, type ThemeId } from "../styles/themes";

export const TERMINAL_INTERACTIVE_WRITE_MAX_CHARS = 2048;
export const TERMINAL_FONT_FAMILY =
  "'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'MesloLGS NF', 'Hack Nerd Font', 'FiraCode Nerd Font', Consolas, monospace";

export const buildTerminalOptions = (
  themeId: ThemeId,
  terminalFontSize: number,
): ITerminalOptions => ({
  cursorBlink: true,
  cursorStyle: "bar",
  cursorInactiveStyle: "outline",
  fontSize: terminalFontSize,
  fontFamily: TERMINAL_FONT_FAMILY,
  fontWeight: 400,
  fontWeightBold: 700,
  lineHeight: 1,
  letterSpacing: 0,
  theme: getThemeTerminalById(themeId),
  allowTransparency: false,
  customGlyphs: true,
  drawBoldTextInBrightColors: true,
  minimumContrastRatio: 1,
  rescaleOverlappingGlyphs: true,
  scrollback: 10000,
  scrollOnUserInput: true,
  fastScrollModifier: "alt",
  fastScrollSensitivity: 5,
  scrollSensitivity: 1,
  allowProposedApi: true,
});
