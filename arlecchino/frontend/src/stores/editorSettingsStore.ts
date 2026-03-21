import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface EditorSettingsState {
  // Global UI scale (1.0 = 100%)
  uiScale: number;
  // Editor-specific font size (Monaco)
  editorFontSize: number;
  minFontSize: number;
  maxFontSize: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setEditorFontSize: (size: number) => void;
  setUiScale: (scale: number) => void;
}

const DEFAULT_UI_SCALE = 1.0;
const DEFAULT_EDITOR_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 48;
const MIN_SCALE = 0.7;
const MAX_SCALE = 2.0;
const SCALE_STEP = 0.05;
const FONT_ZOOM_STEP = 1;

export const useEditorSettingsStore = create<EditorSettingsState>()(
  persist(
    (set) => ({
      uiScale: DEFAULT_UI_SCALE,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      minFontSize: MIN_FONT_SIZE,
      maxFontSize: MAX_FONT_SIZE,

      zoomIn: () =>
        set((state) => ({
          uiScale: Math.min(state.uiScale + SCALE_STEP, MAX_SCALE),
          editorFontSize: Math.min(state.editorFontSize + FONT_ZOOM_STEP, MAX_FONT_SIZE),
        })),

      zoomOut: () =>
        set((state) => ({
          uiScale: Math.max(state.uiScale - SCALE_STEP, MIN_SCALE),
          editorFontSize: Math.max(state.editorFontSize - FONT_ZOOM_STEP, MIN_FONT_SIZE),
        })),

      resetZoom: () =>
        set(() => ({
          uiScale: DEFAULT_UI_SCALE,
          editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
        })),

      setEditorFontSize: (size: number) =>
        set(() => ({
          editorFontSize: Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE),
        })),

      setUiScale: (scale: number) =>
        set(() => ({
          uiScale: Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE),
        })),
    }),
    {
      name: 'editor-settings',
    }
  )
);
