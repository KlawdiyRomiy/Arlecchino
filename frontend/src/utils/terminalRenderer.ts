import type { Terminal } from "@xterm/xterm";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebglAddon } from "@xterm/addon-webgl";

export type TerminalRendererKind = "webgl" | "canvas" | "dom";

const terminalRendererKinds = new WeakMap<Terminal, TerminalRendererKind>();

const loadCanvasRenderer = (
  terminal: Terminal,
  label: string,
): TerminalRendererKind => {
  try {
    const canvasAddon = new CanvasAddon();
    terminal.loadAddon(canvasAddon);
    terminalRendererKinds.set(terminal, "canvas");
    return "canvas";
  } catch (error) {
    console.warn(
      `[TerminalRenderer] Canvas renderer unavailable for ${label}; using DOM renderer`,
      error,
    );
    terminalRendererKinds.set(terminal, "dom");
    return "dom";
  }
};

export const ensureAcceleratedTerminalRenderer = (
  terminal: Terminal,
  label = "terminal",
): TerminalRendererKind => {
  const currentKind = terminalRendererKinds.get(terminal);
  if (currentKind) {
    return currentKind;
  }

  if (!terminal.element) {
    return "dom";
  }

  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      terminalRendererKinds.delete(terminal);
      loadCanvasRenderer(terminal, label);
    });
    terminal.loadAddon(webglAddon);
    terminalRendererKinds.set(terminal, "webgl");
    return "webgl";
  } catch (error) {
    console.warn(
      `[TerminalRenderer] WebGL renderer unavailable for ${label}; falling back to Canvas`,
      error,
    );
    return loadCanvasRenderer(terminal, label);
  }
};

export const getTerminalRendererKind = (
  terminal: Terminal,
): TerminalRendererKind => terminalRendererKinds.get(terminal) ?? "dom";
