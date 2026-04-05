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
  dependencySyncMode: "manual" | "safe-auto" | "full-auto";
  autoSyncOnProjectOpen: boolean;
  autoSyncOnManifestChange: boolean;
  askBeforeDependencyUpdates: boolean;
  showDependencySyncPlanBeforeRun: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setEditorFontSize: (size: number) => void;
  setUiScale: (scale: number) => void;
  setShowInlineDiagnostics: (value: boolean) => void;
  setShowCompactDiagnostics: (value: boolean) => void;
  setShowDiagnosticsDonut: (value: boolean) => void;
  setShowMinimap: (value: boolean) => void;
  setDependencySyncMode: (mode: "manual" | "safe-auto" | "full-auto") => void;
  setAutoSyncOnProjectOpen: (value: boolean) => void;
  setAutoSyncOnManifestChange: (value: boolean) => void;
  setAskBeforeDependencyUpdates: (value: boolean) => void;
  setShowDependencySyncPlanBeforeRun: (value: boolean) => void;
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
const DEFAULT_DEPENDENCY_SYNC_MODE = "manual" as const;
const DEFAULT_AUTO_SYNC_ON_PROJECT_OPEN = false;
const DEFAULT_AUTO_SYNC_ON_MANIFEST_CHANGE = false;
const DEFAULT_ASK_BEFORE_DEPENDENCY_UPDATES = true;
const DEFAULT_SHOW_DEPENDENCY_SYNC_PLAN_BEFORE_RUN = true;

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
      dependencySyncMode: DEFAULT_DEPENDENCY_SYNC_MODE,
      autoSyncOnProjectOpen: DEFAULT_AUTO_SYNC_ON_PROJECT_OPEN,
      autoSyncOnManifestChange: DEFAULT_AUTO_SYNC_ON_MANIFEST_CHANGE,
      askBeforeDependencyUpdates: DEFAULT_ASK_BEFORE_DEPENDENCY_UPDATES,
      showDependencySyncPlanBeforeRun:
        DEFAULT_SHOW_DEPENDENCY_SYNC_PLAN_BEFORE_RUN,

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

      setDependencySyncMode: (mode) =>
        set(() => ({ dependencySyncMode: mode })),

      setAutoSyncOnProjectOpen: (value: boolean) =>
        set(() => ({ autoSyncOnProjectOpen: value })),

      setAutoSyncOnManifestChange: (value: boolean) =>
        set(() => ({ autoSyncOnManifestChange: value })),

      setAskBeforeDependencyUpdates: (value: boolean) =>
        set(() => ({ askBeforeDependencyUpdates: value })),

      setShowDependencySyncPlanBeforeRun: (value: boolean) =>
        set(() => ({ showDependencySyncPlanBeforeRun: value })),
    }),
    {
      name: "editor-settings",
    },
  ),
);
