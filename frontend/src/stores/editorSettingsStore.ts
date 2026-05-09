import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_UI_SCALE,
  applyUiScaleStep,
  clampUiScale,
  getUiScaleStepOffset,
} from "../utils/uiScale";

export type ProjectWindowMode = "projects" | "windows";
export type AppIconAppearance = "system" | "light" | "dark";
export const TOPBAR_ITEM_IDS = [
  "explorer",
  "search",
  "settings",
  "projects",
  "addProject",
  "context",
  "debug",
  "run",
  "preview",
  "aiChat",
  "terminal",
  "git",
  "syncDependencies",
  "checkUpdates",
] as const;

export type TopbarItemId = (typeof TOPBAR_ITEM_IDS)[number];
export const DEFAULT_TOPBAR_ITEM_ORDER: TopbarItemId[] = [...TOPBAR_ITEM_IDS];

const TOPBAR_ITEM_ID_SET = new Set<string>(TOPBAR_ITEM_IDS);

const isTopbarItemId = (value: unknown): value is TopbarItemId =>
  typeof value === "string" && TOPBAR_ITEM_ID_SET.has(value);

export const normalizeTopbarItemOrder = (order: unknown): TopbarItemId[] => {
  const nextOrder: TopbarItemId[] = [];
  const seen = new Set<TopbarItemId>();

  if (Array.isArray(order)) {
    order.forEach((item) => {
      if (!isTopbarItemId(item) || seen.has(item)) {
        return;
      }
      seen.add(item);
      nextOrder.push(item);
    });
  }

  DEFAULT_TOPBAR_ITEM_ORDER.forEach((item) => {
    if (seen.has(item)) {
      return;
    }
    seen.add(item);
    nextOrder.push(item);
  });

  return nextOrder;
};

export interface CustomFontFaceDefinition {
  id: string;
  label: string;
  fontFamily: string;
  dataUrl: string;
}

interface EditorSettingsState {
  uiScale: number;
  uiFontFamily: string;
  customFonts: CustomFontFaceDefinition[];
  editorFontFamily: string;
  editorFontSize: number;
  minFontSize: number;
  maxFontSize: number;
  showInlineDiagnostics: boolean;
  showCompactDiagnostics: boolean;
  showMinimap: boolean;
  showRainbowBrackets: boolean;
  showOperatorLigatures: boolean;
  showTopbarProjectPath: boolean;
  topbarItemOrder: TopbarItemId[];
  zenModeEnabled: boolean;
  projectWindowMode: ProjectWindowMode;
  appIconAppearance: AppIconAppearance;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setUiFontFamily: (fontFamily: string) => void;
  resetUiFontFamily: () => void;
  addCustomFont: (font: CustomFontFaceDefinition) => void;
  setEditorFontFamily: (fontFamily: string) => void;
  resetEditorFontFamily: () => void;
  setEditorFontSize: (size: number) => void;
  setUiScale: (scale: number) => void;
  setShowInlineDiagnostics: (value: boolean) => void;
  setShowCompactDiagnostics: (value: boolean) => void;
  setShowMinimap: (value: boolean) => void;
  setShowRainbowBrackets: (value: boolean) => void;
  setShowOperatorLigatures: (value: boolean) => void;
  setShowTopbarProjectPath: (value: boolean) => void;
  setTopbarItemOrder: (order: TopbarItemId[]) => void;
  resetTopbarItemOrder: () => void;
  setZenModeEnabled: (value: boolean) => void;
  setProjectWindowMode: (value: ProjectWindowMode) => void;
  setAppIconAppearance: (value: AppIconAppearance) => void;
  toggleZenMode: () => void;
}

const EDITOR_SETTINGS_STORAGE_VERSION = 1;
export const DEFAULT_UI_FONT_FAMILY =
  '"Inter", "SF Pro", -apple-system, BlinkMacSystemFont, sans-serif';
export const DEFAULT_EDITOR_FONT_FAMILY =
  '"Arlecchino Fira Code", "JetBrains Mono", "SF Mono", "Fira Code", monospace';
const DEFAULT_EDITOR_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 48;
const MAX_EDITOR_FONT_FAMILY_LENGTH = 240;
const MAX_CUSTOM_FONTS = 16;
const MAX_CUSTOM_FONT_DATA_URL_LENGTH = 7_000_000;
const DEFAULT_SHOW_INLINE_DIAGNOSTICS = true;
const DEFAULT_SHOW_COMPACT_DIAGNOSTICS = true;
const DEFAULT_SHOW_MINIMAP = true;
const DEFAULT_SHOW_RAINBOW_BRACKETS = true;
const DEFAULT_SHOW_OPERATOR_LIGATURES = true;
const DEFAULT_SHOW_TOPBAR_PROJECT_PATH = true;
const DEFAULT_ZEN_MODE_ENABLED = false;
const DEFAULT_PROJECT_WINDOW_MODE: ProjectWindowMode = "projects";
const DEFAULT_APP_ICON_APPEARANCE: AppIconAppearance = "system";

type PersistedEditorSettingsState = Partial<
  Pick<
    EditorSettingsState,
    | "uiScale"
    | "uiFontFamily"
    | "customFonts"
    | "editorFontFamily"
    | "editorFontSize"
    | "showInlineDiagnostics"
    | "showCompactDiagnostics"
    | "showMinimap"
    | "showRainbowBrackets"
    | "showOperatorLigatures"
    | "showTopbarProjectPath"
    | "topbarItemOrder"
    | "zenModeEnabled"
    | "projectWindowMode"
    | "appIconAppearance"
  >
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampEditorFontSize = (size: number): number =>
  Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE);

export const normalizeEditorFontFamily = (fontFamily: string): string => {
  const normalized = fontFamily.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return DEFAULT_EDITOR_FONT_FAMILY;
  }
  return normalized.slice(0, MAX_EDITOR_FONT_FAMILY_LENGTH).trim();
};

export const normalizeUiFontFamily = (fontFamily: string): string => {
  const normalized = fontFamily.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return DEFAULT_UI_FONT_FAMILY;
  }
  return normalized.slice(0, MAX_EDITOR_FONT_FAMILY_LENGTH).trim();
};

const normalizeCustomFonts = (fonts: unknown): CustomFontFaceDefinition[] => {
  if (!Array.isArray(fonts)) {
    return [];
  }

  return fonts
    .filter(isRecord)
    .map((font) => {
      if (
        typeof font.id !== "string" ||
        typeof font.label !== "string" ||
        typeof font.fontFamily !== "string" ||
        typeof font.dataUrl !== "string" ||
        font.dataUrl.length > MAX_CUSTOM_FONT_DATA_URL_LENGTH
      ) {
        return null;
      }

      const id = font.id.trim().slice(0, 120);
      const label = font.label.replace(/\s+/g, " ").trim().slice(0, 80);
      const fontFamily = font.fontFamily
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      if (!id || !label || !fontFamily || !font.dataUrl.startsWith("data:")) {
        return null;
      }

      return {
        id,
        label,
        fontFamily,
        dataUrl: font.dataUrl,
      };
    })
    .filter((font): font is CustomFontFaceDefinition => font !== null)
    .slice(0, MAX_CUSTOM_FONTS);
};

const isProjectWindowMode = (value: unknown): value is ProjectWindowMode =>
  value === "projects" || value === "windows";

const isAppIconAppearance = (value: unknown): value is AppIconAppearance =>
  value === "system" || value === "light" || value === "dark";

const migratedProjectWindowMode = (
  value: unknown,
): ProjectWindowMode | null => {
  if (isProjectWindowMode(value)) {
    return value;
  }
  if (value === "project-switch") {
    return "projects";
  }
  if (value === "window-cycle") {
    return "windows";
  }
  return null;
};

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

  if (typeof persistedState.uiFontFamily === "string") {
    nextState.uiFontFamily = normalizeUiFontFamily(persistedState.uiFontFamily);
  }

  nextState.customFonts = normalizeCustomFonts(persistedState.customFonts);

  if (typeof persistedState.editorFontFamily === "string") {
    nextState.editorFontFamily = normalizeEditorFontFamily(
      persistedState.editorFontFamily,
    );
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

  if (typeof persistedState.showRainbowBrackets === "boolean") {
    nextState.showRainbowBrackets = persistedState.showRainbowBrackets;
  }

  if (typeof persistedState.showOperatorLigatures === "boolean") {
    nextState.showOperatorLigatures = persistedState.showOperatorLigatures;
  }

  if (typeof persistedState.showTopbarProjectPath === "boolean") {
    nextState.showTopbarProjectPath = persistedState.showTopbarProjectPath;
  }

  if (Array.isArray(persistedState.topbarItemOrder)) {
    nextState.topbarItemOrder = normalizeTopbarItemOrder(
      persistedState.topbarItemOrder,
    );
  }

  if (typeof persistedState.zenModeEnabled === "boolean") {
    nextState.zenModeEnabled = persistedState.zenModeEnabled;
  }

  const projectWindowMode = migratedProjectWindowMode(
    persistedState.projectWindowMode ??
      persistedState.projectSwitchShortcutBehavior,
  );
  if (projectWindowMode) {
    nextState.projectWindowMode = projectWindowMode;
  }

  if (isAppIconAppearance(persistedState.appIconAppearance)) {
    nextState.appIconAppearance = persistedState.appIconAppearance;
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
      uiFontFamily: DEFAULT_UI_FONT_FAMILY,
      customFonts: [],
      editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      minFontSize: MIN_FONT_SIZE,
      maxFontSize: MAX_FONT_SIZE,
      showInlineDiagnostics: DEFAULT_SHOW_INLINE_DIAGNOSTICS,
      showCompactDiagnostics: DEFAULT_SHOW_COMPACT_DIAGNOSTICS,
      showMinimap: DEFAULT_SHOW_MINIMAP,
      showRainbowBrackets: DEFAULT_SHOW_RAINBOW_BRACKETS,
      showOperatorLigatures: DEFAULT_SHOW_OPERATOR_LIGATURES,
      showTopbarProjectPath: DEFAULT_SHOW_TOPBAR_PROJECT_PATH,
      topbarItemOrder: [...DEFAULT_TOPBAR_ITEM_ORDER],
      zenModeEnabled: DEFAULT_ZEN_MODE_ENABLED,
      projectWindowMode: DEFAULT_PROJECT_WINDOW_MODE,
      appIconAppearance: DEFAULT_APP_ICON_APPEARANCE,

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

      setUiFontFamily: (fontFamily: string) =>
        set(() => ({
          uiFontFamily: normalizeUiFontFamily(fontFamily),
        })),

      resetUiFontFamily: () =>
        set(() => ({
          uiFontFamily: DEFAULT_UI_FONT_FAMILY,
        })),

      addCustomFont: (font: CustomFontFaceDefinition) =>
        set((state) => {
          const [normalizedFont] = normalizeCustomFonts([font]);
          if (!normalizedFont) {
            return {};
          }

          const withoutDuplicate = state.customFonts.filter(
            (existing) => existing.id !== normalizedFont.id,
          );
          return {
            customFonts: [normalizedFont, ...withoutDuplicate].slice(
              0,
              MAX_CUSTOM_FONTS,
            ),
          };
        }),

      setEditorFontFamily: (fontFamily: string) =>
        set(() => ({
          editorFontFamily: normalizeEditorFontFamily(fontFamily),
        })),

      resetEditorFontFamily: () =>
        set(() => ({
          editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
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

      setShowRainbowBrackets: (value: boolean) =>
        set(() => ({ showRainbowBrackets: value })),

      setShowOperatorLigatures: (value: boolean) =>
        set(() => ({ showOperatorLigatures: value })),

      setShowTopbarProjectPath: (value: boolean) =>
        set(() => ({ showTopbarProjectPath: value })),

      setTopbarItemOrder: (order) =>
        set(() => ({ topbarItemOrder: normalizeTopbarItemOrder(order) })),

      resetTopbarItemOrder: () =>
        set(() => ({ topbarItemOrder: [...DEFAULT_TOPBAR_ITEM_ORDER] })),

      setZenModeEnabled: (value: boolean) =>
        set(() => ({ zenModeEnabled: value })),

      setProjectWindowMode: (value) =>
        set(() => ({ projectWindowMode: value })),

      setAppIconAppearance: (value) =>
        set(() => ({ appIconAppearance: value })),

      toggleZenMode: () =>
        set((state) => ({ zenModeEnabled: !state.zenModeEnabled })),
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
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedEditorSettings(persistedState),
      }),
    },
  ),
);
