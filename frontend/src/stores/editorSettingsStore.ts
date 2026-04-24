import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_UI_SCALE,
  applyUiScaleStep,
  clampUiScale,
  getUiScaleStepOffset,
} from "../utils/uiScale";

interface EditorSettingsState {
  uiScale: number;
  editorFontSize: number;
  minFontSize: number;
  maxFontSize: number;
  showInlineDiagnostics: boolean;
  showCompactDiagnostics: boolean;
  showMinimap: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setEditorFontSize: (size: number) => void;
  setUiScale: (scale: number) => void;
  setShowInlineDiagnostics: (value: boolean) => void;
  setShowCompactDiagnostics: (value: boolean) => void;
  setShowMinimap: (value: boolean) => void;
}

const EDITOR_SETTINGS_STORAGE_VERSION = 1;
const DEFAULT_EDITOR_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 48;
const DEFAULT_SHOW_INLINE_DIAGNOSTICS = true;
const DEFAULT_SHOW_COMPACT_DIAGNOSTICS = true;
const DEFAULT_SHOW_MINIMAP = true;

type PersistedEditorSettingsState = Partial<
  Pick<
    EditorSettingsState,
    | "uiScale"
    | "editorFontSize"
    | "showInlineDiagnostics"
    | "showCompactDiagnostics"
    | "showMinimap"
  >
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampEditorFontSize = (size: number): number =>
  Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE);

const sanitizePersistedEditorSettings = (
  persistedState: unknown,
): PersistedEditorSettingsState => {
  if (!isRecord(persistedState)) {
    return {};
  }

  const nextState: PersistedEditorSettingsState = {};

  if (typeof persistedState.uiScale === "number") {
    nextState.uiScale = clampUiScale(persistedState.uiScale);
  }

  if (typeof persistedState.editorFontSize === "number") {
    nextState.editorFontSize = clampEditorFontSize(
      persistedState.editorFontSize,
    );
  }

  if (typeof persistedState.showInlineDiagnostics === "boolean") {
    nextState.showInlineDiagnostics = persistedState.showInlineDiagnostics;
  }

  if (typeof persistedState.showCompactDiagnostics === "boolean") {
    nextState.showCompactDiagnostics = persistedState.showCompactDiagnostics;
  }

  if (typeof persistedState.showMinimap === "boolean") {
    nextState.showMinimap = persistedState.showMinimap;
  }

  return nextState;
};

const isLegacyCoupledZoomState = (
  uiScale: number,
  editorFontSize: number,
): boolean => {
  const stepOffset = getUiScaleStepOffset(uiScale);
  if (stepOffset === null) {
    return false;
  }

  return (
    clampEditorFontSize(DEFAULT_EDITOR_FONT_SIZE + stepOffset) ===
    editorFontSize
  );
};

export const useEditorSettingsStore = create<EditorSettingsState>()(
  persist(
    (set) => ({
      uiScale: DEFAULT_UI_SCALE,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      minFontSize: MIN_FONT_SIZE,
      maxFontSize: MAX_FONT_SIZE,
      showInlineDiagnostics: DEFAULT_SHOW_INLINE_DIAGNOSTICS,
      showCompactDiagnostics: DEFAULT_SHOW_COMPACT_DIAGNOSTICS,
      showMinimap: DEFAULT_SHOW_MINIMAP,

      zoomIn: () =>
        set((state) => ({
          uiScale: applyUiScaleStep(state.uiScale, 1),
        })),

      zoomOut: () =>
        set((state) => ({
          uiScale: applyUiScaleStep(state.uiScale, -1),
        })),

      resetZoom: () =>
        set(() => ({
          uiScale: DEFAULT_UI_SCALE,
        })),

      setEditorFontSize: (size: number) =>
        set(() => ({
          editorFontSize: clampEditorFontSize(size),
        })),

      setUiScale: (scale: number) =>
        set(() => ({
          uiScale: clampUiScale(scale),
        })),

      setShowInlineDiagnostics: (value: boolean) =>
        set(() => ({ showInlineDiagnostics: value })),

      setShowCompactDiagnostics: (value: boolean) =>
        set(() => ({ showCompactDiagnostics: value })),

      setShowMinimap: (value: boolean) => set(() => ({ showMinimap: value })),
    }),
    {
      name: "editor-settings",
      version: EDITOR_SETTINGS_STORAGE_VERSION,
      migrate: (persistedState, version) => {
        const sanitized = sanitizePersistedEditorSettings(persistedState);
        const uiScale = sanitized.uiScale ?? DEFAULT_UI_SCALE;
        const editorFontSize =
          sanitized.editorFontSize ?? DEFAULT_EDITOR_FONT_SIZE;
        const isLegacyVersion =
          typeof version !== "number" ||
          version < EDITOR_SETTINGS_STORAGE_VERSION;

        return {
          ...sanitized,
          uiScale,
          editorFontSize:
            isLegacyVersion && isLegacyCoupledZoomState(uiScale, editorFontSize)
              ? DEFAULT_EDITOR_FONT_SIZE
              : editorFontSize,
        };
      },
    },
  ),
);
