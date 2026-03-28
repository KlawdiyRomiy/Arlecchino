import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EditorSettingsState {
  uiScale: number;
  editorFontSize: number;
  minFontSize: number;
  maxFontSize: number;
  showInlineDiagnostics: boolean;
  showCompactDiagnostics: boolean;
  showDiagnosticsDonut: boolean;
  showMinimap: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setEditorFontSize: (size: number) => void;
  setUiScale: (scale: number) => void;
  setShowInlineDiagnostics: (value: boolean) => void;
  setShowCompactDiagnostics: (value: boolean) => void;
  setShowDiagnosticsDonut: (value: boolean) => void;
  setShowMinimap: (value: boolean) => void;
}

const DEFAULT_UI_SCALE = 1.0;
const DEFAULT_EDITOR_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 48;
const MIN_SCALE = 0.7;
const MAX_SCALE = 2.0;
const SCALE_STEP = 0.05;
const FONT_ZOOM_STEP = 1;
const DEFAULT_SHOW_INLINE_DIAGNOSTICS = true;
const DEFAULT_SHOW_COMPACT_DIAGNOSTICS = true;
const DEFAULT_SHOW_DIAGNOSTICS_DONUT = true;
const DEFAULT_SHOW_MINIMAP = true;

export const useEditorSettingsStore = create<EditorSettingsState>()(
  persist(
    (set) => ({
      uiScale: DEFAULT_UI_SCALE,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      minFontSize: MIN_FONT_SIZE,
      maxFontSize: MAX_FONT_SIZE,
      showInlineDiagnostics: DEFAULT_SHOW_INLINE_DIAGNOSTICS,
      showCompactDiagnostics: DEFAULT_SHOW_COMPACT_DIAGNOSTICS,
      showDiagnosticsDonut: DEFAULT_SHOW_DIAGNOSTICS_DONUT,
      showMinimap: DEFAULT_SHOW_MINIMAP,

      zoomIn: () =>
        set((state) => ({
          uiScale: Math.min(state.uiScale + SCALE_STEP, MAX_SCALE),
          editorFontSize: Math.min(
            state.editorFontSize + FONT_ZOOM_STEP,
            MAX_FONT_SIZE,
          ),
        })),

      zoomOut: () =>
        set((state) => ({
          uiScale: Math.max(state.uiScale - SCALE_STEP, MIN_SCALE),
          editorFontSize: Math.max(
            state.editorFontSize - FONT_ZOOM_STEP,
            MIN_FONT_SIZE,
          ),
        })),

      resetZoom: () =>
        set(() => ({
          uiScale: DEFAULT_UI_SCALE,
          editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
        })),

      setEditorFontSize: (size: number) =>
        set(() => ({
          editorFontSize: Math.min(
            Math.max(size, MIN_FONT_SIZE),
            MAX_FONT_SIZE,
          ),
        })),

      setUiScale: (scale: number) =>
        set(() => ({
          uiScale: Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE),
        })),

      setShowInlineDiagnostics: (value: boolean) =>
        set(() => ({ showInlineDiagnostics: value })),

      setShowCompactDiagnostics: (value: boolean) =>
        set(() => ({ showCompactDiagnostics: value })),

      setShowDiagnosticsDonut: (value: boolean) =>
        set(() => ({ showDiagnosticsDonut: value })),

      setShowMinimap: (value: boolean) => set(() => ({ showMinimap: value })),
    }),
    {
      name: "editor-settings",
    },
  ),
);
