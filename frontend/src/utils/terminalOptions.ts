import type { ITerminalOptions } from "@xterm/xterm";
import { getThemeTerminalById, type ThemeId } from "../styles/themes";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "./fontFamilyZones";

export { DEFAULT_TERMINAL_FONT_FAMILY };

export const TERMINAL_INTERACTIVE_WRITE_MAX_CHARS = 2048;

export const buildTerminalOptions = (
  themeId: ThemeId,
  terminalFontSize: number,
  terminalFontFamily = DEFAULT_TERMINAL_FONT_FAMILY,
): ITerminalOptions => ({
  cursorBlink: true,
  cursorStyle: "bar",
  cursorInactiveStyle: "outline",
  fontSize: terminalFontSize,
  fontFamily: terminalFontFamily,
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
