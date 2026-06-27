import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_UI_SCALE,
  applyUiScaleStep,
  clampUiScale,
  getUiScaleStepOffset,
} from "../utils/uiScale";
import {
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  normalizeEditorFontFamily,
  normalizeTerminalFontFamily,
  normalizeUiFontFamily,
} from "../utils/fontFamilyZones";

export {
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
};

export type ProjectWindowMode = "projects" | "windows";
export type AppIconAppearance = "system" | "light" | "dark";
export type AIChatSendShortcut = "enter" | "mod-enter";

export interface AIChatDefaultContextPrefs {
  workspace: boolean;
  currentFile: boolean;
  terminalLogs: boolean;
  mnemonic: boolean;
  mcp: boolean;
  skills: boolean;
  continuity: boolean;
}

export interface AIChatDisplayPreferences {
  autoScroll: boolean;
  compactCards: boolean;
  showActivity: boolean;
}

export interface AIChatWorkflowPreferences {
  autoReviewAfterBuild: boolean;
}

export interface AIChatUIPreferences {
  displayPrefs: AIChatDisplayPreferences;
  defaultContext: AIChatDefaultContextPrefs;
  workflowPrefs: AIChatWorkflowPreferences;
}

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
  "notifications",
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
  uiFontSize: number;
  customFonts: CustomFontFaceDefinition[];
  editorFontFamily: string;
  editorFontSize: number;
  terminalFontFamily: string;
  minFontSize: number;
  maxFontSize: number;
  showCompactDiagnostics: boolean;
  showFoldGutter: boolean;
  showIndentGuides: boolean;
  showColorTools: boolean;
  showMinimap: boolean;
  showRainbowBrackets: boolean;
  showOperatorLigatures: boolean;
  showTopbarProjectPath: boolean;
  showNativeMacWindowControls: boolean;
  confirmBeforeClose: boolean;
  topbarItemOrder: TopbarItemId[];
  zenModeEnabled: boolean;
  projectWindowMode: ProjectWindowMode;
  appIconAppearance: AppIconAppearance;
  aiChatSendShortcut: AIChatSendShortcut;
  aiChatPreferences: AIChatUIPreferences;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setUiFontFamily: (fontFamily: string) => void;
  resetUiFontFamily: () => void;
  setUiFontSize: (size: number) => void;
  resetUiFontSize: () => void;
  addCustomFont: (font: CustomFontFaceDefinition) => void;
  setEditorFontFamily: (fontFamily: string) => void;
  resetEditorFontFamily: () => void;
  setEditorFontSize: (size: number) => void;
  setTerminalFontFamily: (fontFamily: string) => void;
  resetTerminalFontFamily: () => void;
  setUiScale: (scale: number) => void;
  setShowCompactDiagnostics: (value: boolean) => void;
  setShowFoldGutter: (value: boolean) => void;
  setShowIndentGuides: (value: boolean) => void;
  setShowColorTools: (value: boolean) => void;
  setShowMinimap: (value: boolean) => void;
  setShowRainbowBrackets: (value: boolean) => void;
  setShowOperatorLigatures: (value: boolean) => void;
  setShowTopbarProjectPath: (value: boolean) => void;
  setShowNativeMacWindowControls: (value: boolean) => void;
  setConfirmBeforeClose: (value: boolean) => void;
  setTopbarItemOrder: (order: TopbarItemId[]) => void;
  resetTopbarItemOrder: () => void;
  setZenModeEnabled: (value: boolean) => void;
  setProjectWindowMode: (value: ProjectWindowMode) => void;
  setAppIconAppearance: (value: AppIconAppearance) => void;
  setAIChatSendShortcut: (value: AIChatSendShortcut) => void;
  setAIChatDisplayPref: (
    key: keyof AIChatDisplayPreferences,
    value: boolean,
  ) => void;
  setAIChatDefaultContext: (
    key: keyof AIChatDefaultContextPrefs,
    value: boolean,
  ) => void;
  setAIChatWorkflowPref: (
    key: keyof AIChatWorkflowPreferences,
    value: boolean,
  ) => void;
  setAIChatPreferences: (preferences: Partial<AIChatUIPreferences>) => void;
  toggleZenMode: () => void;
}

const EDITOR_SETTINGS_STORAGE_VERSION = 1;
export const DEFAULT_UI_FONT_SIZE = 14;
export const MIN_UI_FONT_SIZE = 11;
export const MAX_UI_FONT_SIZE = 22;
const DEFAULT_EDITOR_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 48;
const MAX_CUSTOM_FONTS = 16;
const MAX_CUSTOM_FONT_DATA_URL_LENGTH = 7_000_000;
const DEFAULT_SHOW_COMPACT_DIAGNOSTICS = true;
const DEFAULT_SHOW_FOLD_GUTTER = false;
const DEFAULT_SHOW_INDENT_GUIDES = true;
const DEFAULT_SHOW_COLOR_TOOLS = true;
const DEFAULT_SHOW_MINIMAP = true;
const DEFAULT_SHOW_RAINBOW_BRACKETS = true;
const DEFAULT_SHOW_OPERATOR_LIGATURES = true;
const DEFAULT_SHOW_TOPBAR_PROJECT_PATH = true;
const DEFAULT_SHOW_NATIVE_MAC_WINDOW_CONTROLS = true;
const DEFAULT_CONFIRM_BEFORE_CLOSE = true;
const DEFAULT_ZEN_MODE_ENABLED = false;
const DEFAULT_PROJECT_WINDOW_MODE: ProjectWindowMode = "projects";
const DEFAULT_APP_ICON_APPEARANCE: AppIconAppearance = "system";
const DEFAULT_AI_CHAT_SEND_SHORTCUT: AIChatSendShortcut = "enter";
export const DEFAULT_AI_CHAT_DISPLAY_PREFS: AIChatDisplayPreferences = {
  autoScroll: true,
  compactCards: false,
  showActivity: true,
};
export const DEFAULT_AI_CHAT_DEFAULT_CONTEXT: AIChatDefaultContextPrefs = {
  workspace: false,
  currentFile: true,
  terminalLogs: false,
  mnemonic: true,
  mcp: false,
  skills: false,
  continuity: true,
};
export const DEFAULT_AI_CHAT_WORKFLOW_PREFS: AIChatWorkflowPreferences = {
  autoReviewAfterBuild: true,
};
export const DEFAULT_AI_CHAT_PREFERENCES: AIChatUIPreferences = {
  displayPrefs: DEFAULT_AI_CHAT_DISPLAY_PREFS,
  defaultContext: DEFAULT_AI_CHAT_DEFAULT_CONTEXT,
  workflowPrefs: DEFAULT_AI_CHAT_WORKFLOW_PREFS,
};

type PersistedEditorSettingsState = Partial<
  Pick<
    EditorSettingsState,
    | "uiScale"
    | "uiFontFamily"
    | "uiFontSize"
    | "customFonts"
    | "editorFontFamily"
    | "editorFontSize"
    | "terminalFontFamily"
    | "showCompactDiagnostics"
    | "showFoldGutter"
    | "showIndentGuides"
    | "showColorTools"
    | "showMinimap"
    | "showRainbowBrackets"
    | "showOperatorLigatures"
    | "showTopbarProjectPath"
    | "showNativeMacWindowControls"
    | "confirmBeforeClose"
    | "topbarItemOrder"
    | "zenModeEnabled"
    | "projectWindowMode"
    | "appIconAppearance"
    | "aiChatSendShortcut"
    | "aiChatPreferences"
  >
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampEditorFontSize = (size: number): number =>
  Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE);

const clampUiFontSize = (size: number): number =>
  Math.min(Math.max(size, MIN_UI_FONT_SIZE), MAX_UI_FONT_SIZE);

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

const isAIChatSendShortcut = (value: unknown): value is AIChatSendShortcut =>
  value === "enter" || value === "mod-enter";

const normalizeBooleanRecord = <T extends object>(
  value: unknown,
  fallback: T,
): T => {
  const next = { ...fallback };
  if (!isRecord(value)) {
    return next;
  }
  Object.keys(fallback).forEach((key) => {
    if (typeof value[key] === "boolean") {
      (next as Record<string, boolean>)[key] = value[key];
    }
  });
  return next;
};

export const normalizeAIChatPreferences = (
  value: unknown,
): AIChatUIPreferences => {
  const source = isRecord(value) ? value : {};
  return {
    displayPrefs: normalizeBooleanRecord(
      source.displayPrefs,
      DEFAULT_AI_CHAT_DISPLAY_PREFS,
    ),
    defaultContext: normalizeBooleanRecord(
      source.defaultContext,
      DEFAULT_AI_CHAT_DEFAULT_CONTEXT,
    ),
    workflowPrefs: normalizeBooleanRecord(
      source.workflowPrefs,
      DEFAULT_AI_CHAT_WORKFLOW_PREFS,
    ),
  };
};

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

  if (typeof persistedState.uiFontSize === "number") {
    nextState.uiFontSize = clampUiFontSize(persistedState.uiFontSize);
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

  if (typeof persistedState.terminalFontFamily === "string") {
    nextState.terminalFontFamily = normalizeTerminalFontFamily(
      persistedState.terminalFontFamily,
    );
  }

  if (typeof persistedState.showCompactDiagnostics === "boolean") {
    nextState.showCompactDiagnostics = persistedState.showCompactDiagnostics;
  }

  if (typeof persistedState.showFoldGutter === "boolean") {
    nextState.showFoldGutter = persistedState.showFoldGutter;
  }

  if (typeof persistedState.showIndentGuides === "boolean") {
    nextState.showIndentGuides = persistedState.showIndentGuides;
  }

  if (typeof persistedState.showColorTools === "boolean") {
    nextState.showColorTools = persistedState.showColorTools;
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

  if (typeof persistedState.showNativeMacWindowControls === "boolean") {
    nextState.showNativeMacWindowControls =
      persistedState.showNativeMacWindowControls;
  }

  if (typeof persistedState.confirmBeforeClose === "boolean") {
    nextState.confirmBeforeClose = persistedState.confirmBeforeClose;
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

  if (isAIChatSendShortcut(persistedState.aiChatSendShortcut)) {
    nextState.aiChatSendShortcut = persistedState.aiChatSendShortcut;
  }

  if ("aiChatPreferences" in persistedState) {
    nextState.aiChatPreferences = normalizeAIChatPreferences(
      persistedState.aiChatPreferences,
    );
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
      uiFontSize: DEFAULT_UI_FONT_SIZE,
      customFonts: [],
      editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      minFontSize: MIN_FONT_SIZE,
      maxFontSize: MAX_FONT_SIZE,
      showCompactDiagnostics: DEFAULT_SHOW_COMPACT_DIAGNOSTICS,
      showFoldGutter: DEFAULT_SHOW_FOLD_GUTTER,
      showIndentGuides: DEFAULT_SHOW_INDENT_GUIDES,
      showColorTools: DEFAULT_SHOW_COLOR_TOOLS,
      showMinimap: DEFAULT_SHOW_MINIMAP,
      showRainbowBrackets: DEFAULT_SHOW_RAINBOW_BRACKETS,
      showOperatorLigatures: DEFAULT_SHOW_OPERATOR_LIGATURES,
      showTopbarProjectPath: DEFAULT_SHOW_TOPBAR_PROJECT_PATH,
      showNativeMacWindowControls: DEFAULT_SHOW_NATIVE_MAC_WINDOW_CONTROLS,
      confirmBeforeClose: DEFAULT_CONFIRM_BEFORE_CLOSE,
      topbarItemOrder: [...DEFAULT_TOPBAR_ITEM_ORDER],
      zenModeEnabled: DEFAULT_ZEN_MODE_ENABLED,
      projectWindowMode: DEFAULT_PROJECT_WINDOW_MODE,
      appIconAppearance: DEFAULT_APP_ICON_APPEARANCE,
      aiChatSendShortcut: DEFAULT_AI_CHAT_SEND_SHORTCUT,
      aiChatPreferences: DEFAULT_AI_CHAT_PREFERENCES,

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

      setUiFontSize: (size: number) =>
        set(() => ({
          uiFontSize: clampUiFontSize(size),
        })),

      resetUiFontSize: () =>
        set(() => ({
          uiFontSize: DEFAULT_UI_FONT_SIZE,
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

      setTerminalFontFamily: (fontFamily: string) =>
        set(() => ({
          terminalFontFamily: normalizeTerminalFontFamily(fontFamily),
        })),

      resetTerminalFontFamily: () =>
        set(() => ({
          terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
        })),

      setUiScale: (scale: number) =>
        set(() => ({
          uiScale: clampUiScale(scale),
        })),

      setShowCompactDiagnostics: (value: boolean) =>
        set(() => ({ showCompactDiagnostics: value })),

      setShowFoldGutter: (value: boolean) =>
        set(() => ({ showFoldGutter: value })),

      setShowIndentGuides: (value: boolean) =>
        set(() => ({ showIndentGuides: value })),

      setShowColorTools: (value: boolean) =>
        set(() => ({ showColorTools: value })),

      setShowMinimap: (value: boolean) => set(() => ({ showMinimap: value })),

      setShowRainbowBrackets: (value: boolean) =>
        set(() => ({ showRainbowBrackets: value })),

      setShowOperatorLigatures: (value: boolean) =>
        set(() => ({ showOperatorLigatures: value })),

      setShowTopbarProjectPath: (value: boolean) =>
        set(() => ({ showTopbarProjectPath: value })),

      setShowNativeMacWindowControls: (value: boolean) =>
        set(() => ({ showNativeMacWindowControls: value })),

      setConfirmBeforeClose: (value: boolean) =>
        set(() => ({ confirmBeforeClose: value })),

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

      setAIChatSendShortcut: (value) =>
        set(() => ({ aiChatSendShortcut: value })),

      setAIChatDisplayPref: (key, value) =>
        set((state) => ({
          aiChatPreferences: {
            ...state.aiChatPreferences,
            displayPrefs: {
              ...state.aiChatPreferences.displayPrefs,
              [key]: value,
            },
          },
        })),

      setAIChatDefaultContext: (key, value) =>
        set((state) => ({
          aiChatPreferences: {
            ...state.aiChatPreferences,
            defaultContext: {
              ...state.aiChatPreferences.defaultContext,
              [key]: value,
            },
          },
        })),

      setAIChatWorkflowPref: (key, value) =>
        set((state) => ({
          aiChatPreferences: {
            ...state.aiChatPreferences,
            workflowPrefs: {
              ...state.aiChatPreferences.workflowPrefs,
              [key]: value,
            },
          },
        })),

      setAIChatPreferences: (preferences) =>
        set((state) => ({
          aiChatPreferences: normalizeAIChatPreferences({
            ...state.aiChatPreferences,
            ...preferences,
            displayPrefs: {
              ...state.aiChatPreferences.displayPrefs,
              ...preferences.displayPrefs,
            },
            defaultContext: {
              ...state.aiChatPreferences.defaultContext,
              ...preferences.defaultContext,
            },
            workflowPrefs: {
              ...state.aiChatPreferences.workflowPrefs,
              ...preferences.workflowPrefs,
            },
          }),
        })),

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
