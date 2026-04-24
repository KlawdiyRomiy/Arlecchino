import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "framer-motion";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { useIndexingPhase } from "../../hooks/useIndexingProgress";
import { useTheme } from "../../hooks/useTheme";
import { FileExplorer } from "../FileExplorer";
import { TerminalPanelContent } from "../TerminalPanel";
import { AIChatPanelContent } from "../AIChatPanel";
import { GitPanel } from "../GitPanel";
import { ProblemsPanel } from "../problems/ProblemsPanel";
import { CodePanelSurface } from "../CodePanelSurface";
import { PreviewWindowLayer } from "./PreviewWindowLayer";
import { ExecutionDialog } from "../ExecutionDialog";
import { DependencyPolicyModal } from "../DependencyPolicyModal";
import { LaravelPlugin } from "../../plugins/LaravelPlugin";
import { SettingsModal } from "../SettingsModal";
import { CommandDispatcher } from "../CommandDispatcher";
import { useDispatcher } from "../../hooks/useDispatcher";
import {
  ProjectEntryActionsProvider,
  type ProjectEntryActionTarget,
  type ProjectEntryTrashRequest,
} from "../../contexts/ProjectEntryActionsContext";
import { useEditorStore } from "../../stores/editorStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useExplorerStore } from "../../stores/explorerStore";
import { useDiagnosticsStore } from "../../stores/diagnosticsStore";
import {
  FloatingPanel,
  FLOATING_PANEL_LAYOUT_TRANSITION,
  FLOATING_PANEL_LAYOUT_TRANSITION_MS,
  PanelPosition,
  PanelSize,
} from "../ui/FloatingPanel";
import {
  AlertCircle,
  FolderTree,
  Terminal,
  Sparkles,
  GitBranch,
  Globe,
  FileText,
} from "lucide-react";

import {
  colors,
  getThemeColors,
  radius,
  shadows,
  transitions,
  zIndex,
} from "../../styles/colors";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePluginModal } from "../../contexts/PluginModalContext";
import { useProjectDiagnosticsPreload } from "../../utils/projectBoundState";
import {
  usePreviewWindowStore,
  type OpenPreviewWindowInput,
  type PreviewSurfaceType,
  type PreviewWindowPayload,
  type UpdatePreviewWindowInput,
} from "../../stores/previewWindowStore";
import type { Theme } from "../../types/theme";
import { shortcuts } from "../../utils/keyboard";
import { SNAPPED_PANEL_OUTER_GAP } from "../../utils/layoutHelpers";
import {
  getLogicalViewportSize,
  screenToLogicalPixels,
} from "../../utils/logicalViewport";
import { emitPerfMetric, measurePerf, nowPerf } from "../../utils/perf";
import {
  getProjectPathBasename,
  normalizeProjectPath,
  relativeProjectPath,
  remapProjectPathPrefix,
  isSameOrChildPath,
} from "../../utils/projectPaths";
import {
  isTerminalFocusedElement,
  isTerminalShortcutContext as hasTerminalShortcutContext,
  shouldBypassGlobalFindShortcuts,
} from "../../utils/terminalFocus";
import { isProjectSwitchBlocked } from "../../utils/priorityUI";
import {
  flipTUIAssistAnchor,
  getTUIAssistFlexDirection,
  getTUIFloatingTerminalConfig,
  getTUIPanelVisibility,
  normalizeTUIAssistAnchor,
  type TUIAssistAnchor,
} from "../../utils/terminalLayout";
import { writeClipboardTextWithFallback } from "../../utils/clipboard";
import {
  CreateDirectory,
  GetLanguageForFile,
  ReadFile,
  RenameProjectEntry,
  RevealProjectEntry,
  TrashProjectEntry,
  WriteFile,
  WriteTerminal,
} from "../../../wailsjs/go/main/App";
import { EventsOn } from "../../../wailsjs/runtime/runtime";
import {
  type ExecutionProfile,
  type ExecutionProfileSet,
  resolveExecutionProfiles,
} from "../../utils/executionProfiles";

interface MainLayoutProps {
  children: React.ReactNode;
  onFileOpen?: (
    path: string,
    content: string,
    name: string,
    line?: number,
  ) => void;
  onBackToWelcome?: () => void;
  onProjectOpen?: (path: string) => void;
  onSwitchProject?: (id: string, direction?: number) => void;
  onCloseProject?: (id: string) => void;
  onPerspectiveOpen?: () => void;
  onPerspectiveClose?: () => void;
}

interface PanelConfig {
  position: PanelPosition;
  size: PanelSize;
  mode: "snapped" | "floating";
  x: number;
  y: number;
}

type PanelId = "explorer" | "terminal" | "aiChat" | "git" | "problems" | "code";
type AssistPanelId = Exclude<PanelId, "terminal" | "problems" | "code">;
type PanelVisibility = Record<PanelId, boolean>;
type PanelFullscreenSnapshot = Pick<PanelConfig, "mode" | "x" | "y" | "size">;
type SnappedSlotSnapshot = { panelId: PanelId; size: PanelSize };

type PanelConfigs = Record<PanelId, PanelConfig>;
type RememberedSnappedPositions = Record<PanelId, PanelPosition>;

interface HydratedPanelLayoutState {
  panels: PanelVisibility;
  panelConfigs: PanelConfigs;
  rememberedSnappedPositions: RememberedSnappedPositions;
}

interface PanelOpenRequest {
  panel: string;
  position?: PanelPosition;
  mode?: "snapped" | "floating";
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  ratio?: number;
  anchor?: TUIAssistAnchor;
  command?: string;
  terminalName?: string;
  focus?: boolean;
}

interface ProjectEntryCreateDialogState {
  type: "file" | "folder";
  directoryPath: string;
}

interface ProjectEntryRenameDialogState extends ProjectEntryActionTarget {
  name: string;
}

interface ProjectEntryDeletedEvent {
  path?: string;
  isDirectory?: boolean;
}

interface ProjectEntryRenamedEvent {
  oldPath?: string;
  newPath?: string;
  isDirectory?: boolean;
}

const joinProjectEntryPath = (
  directoryPath: string,
  entryName: string,
): string => `${normalizeProjectPath(directoryPath)}/${entryName}`;

const getNextWrappedIndex = (
  currentIndex: number,
  direction: 1 | -1,
  total: number,
): number => {
  if (total <= 0) {
    return -1;
  }

  return (currentIndex + direction + total) % total;
};

type AppSurfaceAction =
  | { kind: "panel"; panelId: PanelId }
  | { kind: "dispatcher" }
  | { kind: "settings" }
  | { kind: "run"; mode: "run" | "debug" };

const SNAPPED_PANEL_POSITIONS: readonly PanelPosition[] = [
  "left",
  "right",
  "bottom",
  "top",
];

const PANEL_POSITION_PREFERENCES: Record<PanelId, readonly PanelPosition[]> = {
  explorer: ["left", "right", "bottom", "top"],
  terminal: ["bottom", "right", "left", "top"],
  aiChat: ["right", "left", "bottom", "top"],
  git: ["left", "right", "bottom", "top"],
  problems: ["bottom", "right", "left", "top"],
  code: ["right", "left", "bottom", "top"],
};

const PANEL_ID_ALIASES: Record<string, PanelId> = {
  git: "git",
  scm: "git",
  ai: "aiChat",
  aichat: "aiChat",
  assistant: "aiChat",
  chat: "aiChat",
  terminal: "terminal",
  console: "terminal",
  shell: "terminal",
  explorer: "explorer",
  sidebar: "explorer",
  files: "explorer",
  problems: "problems",
  diagnostics: "problems",
  code: "code",
  editor: "code",
};

const APP_SURFACE_ALIASES: Record<string, AppSurfaceAction> = {
  search: { kind: "dispatcher" },
  find: { kind: "dispatcher" },
  commandpalette: { kind: "dispatcher" },
  palette: { kind: "dispatcher" },
  output: { kind: "panel", panelId: "terminal" },
  logs: { kind: "panel", panelId: "terminal" },
  run: { kind: "run", mode: "run" },
  debug: { kind: "run", mode: "debug" },
  extensions: { kind: "settings" },
  settings: { kind: "settings" },
  preferences: { kind: "settings" },
};

const normalizePanelSizeForPosition = (
  position: PanelPosition,
  currentSize: PanelSize,
): PanelSize => {
  if (position === "bottom" || position === "top") {
    return {
      width: 0,
      height: Math.min(currentSize.height > 0 ? currentSize.height : 220, 400),
    };
  }

  return {
    width: Math.min(currentSize.width > 0 ? currentSize.width : 280, 500),
    height: 0,
  };
};

const isPanelPosition = (value: unknown): value is PanelPosition =>
  value === "left" ||
  value === "right" ||
  value === "top" ||
  value === "bottom";

const resolvePanelId = (panelName: string): PanelId | null => {
  const normalized = panelName.trim().toLowerCase();
  return PANEL_ID_ALIASES[normalized] ?? null;
};

const resolveAppSurfaceAction = (
  panelName: string,
): AppSurfaceAction | null => {
  const normalized = panelName.trim().toLowerCase();
  return APP_SURFACE_ALIASES[normalized] ?? null;
};

const unwrapEventPayload = (value: unknown): unknown => {
  if (Array.isArray(value) && value.length === 1) {
    return unwrapEventPayload(value[0]);
  }

  return value;
};

const getViewportSafeFloatingConfig = (
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  const { width: viewportWidth, height: viewportHeight } =
    getLogicalViewportSize();
  const safeWidth = Math.max(220, Math.min(width, viewportWidth));
  const safeHeight = Math.max(140, Math.min(height, viewportHeight));
  const maxX = Math.max(0, viewportWidth - safeWidth);
  const maxY = Math.max(32, viewportHeight - safeHeight);

  return {
    width: safeWidth,
    height: safeHeight,
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(32, Math.min(y, maxY)),
  };
};

const buildPanelConfigForOpen = (
  panelId: PanelId,
  request: PanelOpenRequest,
  currentConfig: PanelConfig,
): PanelConfig => {
  const defaultConfig = DEFAULT_PANEL_CONFIGS[panelId];
  const hasExplicitFloatingPlacement =
    typeof request.x === "number" || typeof request.y === "number";
  const hasExplicitPlacement =
    request.position !== undefined ||
    request.mode !== undefined ||
    hasExplicitFloatingPlacement ||
    typeof request.width === "number" ||
    typeof request.height === "number";

  const baseConfig = currentConfig;
  const position = request.position ?? currentConfig.position;
  const mode =
    request.mode ??
    (request.position
      ? "snapped"
      : hasExplicitFloatingPlacement
        ? "floating"
        : currentConfig.mode);

  if (mode === "snapped") {
    const baseSize = normalizePanelSizeForPosition(position, {
      width: request.width ?? baseConfig.size.width ?? defaultConfig.size.width,
      height:
        request.height ?? baseConfig.size.height ?? defaultConfig.size.height,
    });

    return {
      position,
      mode,
      x: 0,
      y: 0,
      size: {
        width: request.width ?? baseSize.width,
        height: request.height ?? baseSize.height,
      },
    };
  }

  const safeFloating = getViewportSafeFloatingConfig(
    request.width ?? baseConfig.size.width ?? defaultConfig.size.width ?? 320,
    request.height ??
      baseConfig.size.height ??
      defaultConfig.size.height ??
      240,
    request.x ?? baseConfig.x,
    request.y ?? baseConfig.y,
  );

  return {
    position,
    mode,
    x: safeFloating.x,
    y: safeFloating.y,
    size: {
      width: safeFloating.width,
      height: safeFloating.height,
    },
  };
};

const hasExplicitPanelPlacement = (request: PanelOpenRequest): boolean =>
  request.position !== undefined ||
  request.mode !== undefined ||
  typeof request.x === "number" ||
  typeof request.y === "number";

const getOccupiedSnappedPositions = (
  panelId: PanelId,
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
): Set<PanelPosition> => {
  const occupied = new Set<PanelPosition>();

  (Object.keys(panelConfigs) as PanelId[]).forEach((id) => {
    if (id === panelId || !panels[id]) {
      return;
    }

    const config = panelConfigs[id];
    if (config.mode === "snapped") {
      occupied.add(config.position);
    }
  });

  return occupied;
};

const resolveSmartSnappedPosition = (
  panelId: PanelId,
  rememberedPosition: PanelPosition,
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
): PanelPosition | null => {
  const occupiedPositions = getOccupiedSnappedPositions(
    panelId,
    panels,
    panelConfigs,
  );

  if (
    isPanelPosition(rememberedPosition) &&
    !occupiedPositions.has(rememberedPosition)
  ) {
    return rememberedPosition;
  }

  const preferredPositions = PANEL_POSITION_PREFERENCES[panelId];
  const orderedPositions = [
    rememberedPosition,
    ...preferredPositions,
    ...SNAPPED_PANEL_POSITIONS,
  ].filter(
    (position, index, all): position is PanelPosition =>
      isPanelPosition(position) && all.indexOf(position) === index,
  );

  for (const position of orderedPositions) {
    if (!occupiedPositions.has(position)) {
      return position;
    }
  }

  return null;
};

const buildCenteredFloatingOpenRequest = (
  panelId: PanelId,
  request: PanelOpenRequest,
  currentConfig: PanelConfig,
): PanelOpenRequest => {
  const defaultConfig = DEFAULT_PANEL_CONFIGS[panelId];
  const fallbackWidth =
    currentConfig.size.width || defaultConfig.size.width || 420;
  const fallbackHeight =
    currentConfig.size.height || defaultConfig.size.height || 320;
  const { width: viewportWidth, height: viewportHeight } =
    getLogicalViewportSize();
  const maxWidth = Math.max(320, viewportWidth - 96);
  const maxHeight = Math.max(220, viewportHeight - 128);
  const width = Math.min(request.width ?? fallbackWidth, maxWidth);
  const height = Math.min(request.height ?? fallbackHeight, maxHeight);

  return {
    ...request,
    mode: "floating",
    width,
    height,
    x: Math.max(0, Math.round((viewportWidth - width) / 2)),
    y: Math.max(32, Math.round((viewportHeight - height) / 2)),
  };
};

const resolvePanelOpenRequest = (
  panelId: PanelId,
  request: PanelOpenRequest,
  rememberedPosition: PanelPosition,
  currentConfig: PanelConfig,
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
): PanelOpenRequest => {
  if (hasExplicitPanelPlacement(request)) {
    return request;
  }

  const defaultConfig = DEFAULT_PANEL_CONFIGS[panelId];
  const mode =
    request.mode ??
    (defaultConfig.mode === "snapped" ? "snapped" : currentConfig.mode);
  if (mode !== "snapped") {
    return request;
  }

  const resolvedPosition = resolveSmartSnappedPosition(
    panelId,
    rememberedPosition,
    panels,
    panelConfigs,
  );
  if (!resolvedPosition) {
    return buildCenteredFloatingOpenRequest(panelId, request, currentConfig);
  }

  return {
    ...request,
    position: resolvedPosition,
  };
};

const computeNextPanelOpenState = (
  panelId: PanelId,
  request: PanelOpenRequest,
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
  rememberedSnappedPositions: RememberedSnappedPositions,
): {
  nextPanels: PanelVisibility;
  nextConfig: PanelConfig;
  nextRememberedSnappedPositions: RememberedSnappedPositions;
} => {
  const currentConfig = panelConfigs[panelId];
  const resolvedRequest = resolvePanelOpenRequest(
    panelId,
    request,
    rememberedSnappedPositions[panelId],
    currentConfig,
    panels,
    panelConfigs,
  );
  const nextConfig = buildPanelConfigForOpen(
    panelId,
    resolvedRequest,
    currentConfig,
  );
  const nextPanels = { ...panels };
  const nextRememberedSnappedPositions = { ...rememberedSnappedPositions };

  if (
    nextConfig.mode === "snapped" &&
    (request.position !== undefined || request.mode === "snapped")
  ) {
    nextRememberedSnappedPositions[panelId] = nextConfig.position;
  }

  if (nextConfig.mode === "snapped") {
    (Object.keys(panelConfigs) as PanelId[]).forEach((id) => {
      if (id === panelId || !nextPanels[id]) {
        return;
      }

      const otherConfig = panelConfigs[id];
      if (
        otherConfig.mode === "snapped" &&
        otherConfig.position === nextConfig.position
      ) {
        nextPanels[id] = false;
      }
    });
  }

  nextPanels[panelId] = true;
  return { nextPanels, nextConfig, nextRememberedSnappedPositions };
};

import { useIDEEvents } from "../../hooks/useIDEEvents";
import { useBrowserPreviewBridge } from "../../hooks/useBrowserPreviewBridge";
import { usePreviewableContext } from "../../hooks/usePreviewableContext";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getStringFromRecord = (
  source: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const getNumberFromRecord = (
  source: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

const getBooleanFromRecord = (
  source: Record<string, unknown>,
  key: string,
): boolean | undefined => {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
};

const parsePanelPosition = (value: unknown): PanelPosition | undefined => {
  switch (value) {
    case "left":
    case "right":
    case "top":
    case "bottom":
      return value;
    default:
      return undefined;
  }
};

const parsePanelMode = (value: unknown): "snapped" | "floating" | undefined => {
  switch (value) {
    case "snapped":
    case "floating":
      return value;
    default:
      return undefined;
  }
};

const parsePanelOpenRequest = (value: unknown): PanelOpenRequest | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (typeof normalizedValue === "string") {
    const panel = normalizedValue.trim().toLowerCase();
    return panel ? { panel } : null;
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const panel =
    getStringFromRecord(normalizedValue, "panel") ||
    getStringFromRecord(normalizedValue, "target") ||
    getStringFromRecord(normalizedValue, "id") ||
    getStringFromRecord(normalizedValue, "name");
  if (!panel) {
    return null;
  }

  const position =
    parsePanelPosition(normalizedValue.position) ||
    parsePanelPosition(normalizedValue.side);

  return {
    panel: panel.toLowerCase(),
    position,
    mode: parsePanelMode(normalizedValue.mode),
    width: getNumberFromRecord(normalizedValue, "width"),
    height: getNumberFromRecord(normalizedValue, "height"),
    x: getNumberFromRecord(normalizedValue, "x"),
    y: getNumberFromRecord(normalizedValue, "y"),
    ratio: getNumberFromRecord(normalizedValue, "ratio"),
    anchor: normalizeTUIAssistAnchor(
      getStringFromRecord(normalizedValue, "anchor") ?? position,
      "right",
    ),
    command:
      getStringFromRecord(normalizedValue, "command") ||
      getStringFromRecord(normalizedValue, "input"),
    terminalName:
      getStringFromRecord(normalizedValue, "terminalName") ||
      getStringFromRecord(normalizedValue, "sessionName") ||
      getStringFromRecord(normalizedValue, "title"),
    focus: getBooleanFromRecord(normalizedValue, "focus") ?? false,
  };
};

const parseEditorOpenRequest = (
  value: unknown,
): { path: string; line?: number } | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (typeof normalizedValue === "string") {
    const path = normalizedValue.trim();
    return path ? { path } : null;
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const path =
    getStringFromRecord(normalizedValue, "path") ||
    getStringFromRecord(normalizedValue, "file") ||
    getStringFromRecord(normalizedValue, "filePath");
  if (!path) {
    return null;
  }

  return {
    path,
    line: getNumberFromRecord(normalizedValue, "line"),
  };
};

const parseEditorSplitDirection = (
  value: unknown,
): "horizontal" | "vertical" | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (normalizedValue === "horizontal" || normalizedValue === "vertical") {
    return normalizedValue;
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const direction = getStringFromRecord(normalizedValue, "direction");
  return direction === "horizontal" || direction === "vertical"
    ? direction
    : null;
};

const toPreviewSurface = (value: unknown): PreviewSurfaceType | null => {
  if (typeof value !== "string") {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "file":
      return "file";
    case "code":
    case "editor":
      return "code";
    case "browser":
    case "web":
    case "url":
      return "browser";
    case "git":
    case "scm":
      return "git";
    case "chat":
    case "ai":
    case "assistant":
      return "chat";
    case "terminal":
    case "shell":
      return "terminal";
    case "appearance":
    case "theme":
    case "layout":
    case "ide":
      return "appearance";
    default:
      return null;
  }
};

const toThemeValue = (value: unknown): Theme | null => {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return null;
};

const toPreviewWindowPayload = (value: unknown): PreviewWindowPayload => {
  if (!isRecord(value)) {
    return {};
  }

  const payload: PreviewWindowPayload = {};
  Object.entries(value).forEach(([key, item]) => {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      payload[key] = item;
    }
  });
  return payload;
};

const parseOpenPreviewInput = (
  value: unknown,
): OpenPreviewWindowInput | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (typeof normalizedValue === "string") {
    const surface = toPreviewSurface(normalizedValue);
    if (surface) {
      return { surface };
    }

    return {
      surface: "file",
      title: normalizedValue.split("/").pop() || "file preview",
      payload: { path: normalizedValue },
    };
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const directPayload = toPreviewWindowPayload(normalizedValue);
  const nestedPayload = toPreviewWindowPayload(normalizedValue.payload);
  const payload: PreviewWindowPayload = {
    ...directPayload,
    ...nestedPayload,
  };
  delete payload.surface;
  delete payload.mode;
  delete payload.position;
  delete payload.side;
  delete payload.width;
  delete payload.height;
  delete payload.x;
  delete payload.y;
  delete payload.id;
  delete payload.pinned;

  const surfaceCandidate =
    toPreviewSurface(normalizedValue.surface) ||
    toPreviewSurface(
      isRecord(normalizedValue.payload)
        ? normalizedValue.payload.surface
        : undefined,
    ) ||
    toPreviewSurface(normalizedValue.kind) ||
    toPreviewSurface(normalizedValue.type) ||
    (payload.url ? "browser" : null) ||
    (payload.path ? "file" : null);

  if (!surfaceCandidate) {
    return null;
  }

  const modeCandidate = getStringFromRecord(normalizedValue, "mode");
  const positionCandidate = getStringFromRecord(normalizedValue, "position");
  const sideCandidate = getStringFromRecord(normalizedValue, "side");

  const mode =
    modeCandidate === "floating" || modeCandidate === "snapped"
      ? modeCandidate
      : modeCandidate === "tab" || modeCandidate === "side"
        ? "snapped"
        : undefined;
  const position =
    positionCandidate === "left" ||
    positionCandidate === "right" ||
    positionCandidate === "top" ||
    positionCandidate === "bottom"
      ? positionCandidate
      : modeCandidate === "side" && sideCandidate === "left"
        ? "left"
        : modeCandidate === "side" && sideCandidate === "right"
          ? "right"
          : undefined;
  const side =
    sideCandidate === "left" || sideCandidate === "right"
      ? sideCandidate
      : undefined;

  return {
    id: getStringFromRecord(normalizedValue, "id"),
    surface: surfaceCandidate,
    title: getStringFromRecord(normalizedValue, "title"),
    payload,
    mode,
    position,
    side,
    width: getNumberFromRecord(normalizedValue, "width"),
    height: getNumberFromRecord(normalizedValue, "height"),
    x: getNumberFromRecord(normalizedValue, "x"),
    y: getNumberFromRecord(normalizedValue, "y"),
    pinned: getBooleanFromRecord(normalizedValue, "pinned"),
  };
};

const parseWindowIdFromPayload = (value: unknown): string | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (
    typeof normalizedValue === "string" &&
    normalizedValue.trim().length > 0
  ) {
    return normalizedValue.trim();
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  return (
    getStringFromRecord(normalizedValue, "id") ||
    getStringFromRecord(normalizedValue, "windowId") ||
    getStringFromRecord(normalizedValue, "checkpointId") ||
    null
  );
};

const parseUpdatePreviewInput = (
  value: unknown,
): {
  id: string;
  input: UpdatePreviewWindowInput;
  focusRequested: boolean;
} | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const id = parseWindowIdFromPayload(normalizedValue);
  if (!id) {
    return null;
  }

  const payload = toPreviewWindowPayload(normalizedValue.payload);
  const modeCandidate = getStringFromRecord(normalizedValue, "mode");
  const positionCandidate = getStringFromRecord(normalizedValue, "position");
  const focusRequested =
    getBooleanFromRecord(normalizedValue, "focus") ??
    getBooleanFromRecord(normalizedValue, "activate") ??
    false;
  const input: UpdatePreviewWindowInput = {
    title: getStringFromRecord(normalizedValue, "title"),
    payload: Object.keys(payload).length > 0 ? payload : undefined,
    mode:
      modeCandidate === "floating" || modeCandidate === "snapped"
        ? modeCandidate
        : modeCandidate === "tab" || modeCandidate === "side"
          ? "snapped"
          : undefined,
    position:
      positionCandidate === "left" ||
      positionCandidate === "right" ||
      positionCandidate === "top" ||
      positionCandidate === "bottom"
        ? positionCandidate
        : undefined,
    width: getNumberFromRecord(normalizedValue, "width"),
    height: getNumberFromRecord(normalizedValue, "height"),
    x: getNumberFromRecord(normalizedValue, "x"),
    y: getNumberFromRecord(normalizedValue, "y"),
    pinned: getBooleanFromRecord(normalizedValue, "pinned"),
  };

  return { id, input, focusRequested };
};

const mergePreviewWindowUpdateInput = (
  base: UpdatePreviewWindowInput,
  next: UpdatePreviewWindowInput,
): UpdatePreviewWindowInput => ({
  title: next.title ?? base.title,
  payload: next.payload
    ? { ...(base.payload ?? {}), ...next.payload }
    : base.payload,
  mode: next.mode ?? base.mode,
  position: next.position ?? base.position,
  width: next.width ?? base.width,
  height: next.height ?? base.height,
  x: next.x ?? base.x,
  y: next.y ?? base.y,
  pinned: typeof next.pinned === "boolean" ? next.pinned : base.pinned,
});

const parseCheckpointLabel = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return getStringFromRecord(value, "label") || undefined;
};

const parseAppearancePatch = (
  value: unknown,
): { theme?: Theme; uiScale?: number } => {
  if (!isRecord(value)) {
    return {};
  }

  const theme = toThemeValue(value.theme);
  const uiScale = getNumberFromRecord(value, "uiScale");
  return {
    theme: theme ?? undefined,
    uiScale,
  };
};

const DEFAULT_PANELS: PanelVisibility = {
  explorer: true,
  terminal: false,
  aiChat: false,
  git: false,
  problems: false,
  code: false,
};

const DEFAULT_PANEL_CONFIGS: PanelConfigs = {
  explorer: {
    position: "left",
    size: { width: 260, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  terminal: {
    position: "bottom",
    size: { width: 0, height: 220 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  aiChat: {
    position: "right",
    size: { width: 320, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  git: {
    position: "left",
    size: { width: 280, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  problems: {
    position: "bottom",
    size: { width: 520, height: 320 },
    mode: "floating",
    x: 96,
    y: 96,
  },
  code: {
    position: "right",
    size: { width: 620, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
};

const cloneDefaultPanelConfigs = (): PanelConfigs => ({
  explorer: {
    ...DEFAULT_PANEL_CONFIGS.explorer,
    size: { ...DEFAULT_PANEL_CONFIGS.explorer.size },
  },
  terminal: {
    ...DEFAULT_PANEL_CONFIGS.terminal,
    size: { ...DEFAULT_PANEL_CONFIGS.terminal.size },
  },
  aiChat: {
    ...DEFAULT_PANEL_CONFIGS.aiChat,
    size: { ...DEFAULT_PANEL_CONFIGS.aiChat.size },
  },
  git: {
    ...DEFAULT_PANEL_CONFIGS.git,
    size: { ...DEFAULT_PANEL_CONFIGS.git.size },
  },
  problems: {
    ...DEFAULT_PANEL_CONFIGS.problems,
    size: { ...DEFAULT_PANEL_CONFIGS.problems.size },
  },
  code: {
    ...DEFAULT_PANEL_CONFIGS.code,
    size: { ...DEFAULT_PANEL_CONFIGS.code.size },
  },
});

const createDefaultRememberedSnappedPositions =
  (): RememberedSnappedPositions => ({
    explorer: DEFAULT_PANEL_CONFIGS.explorer.position,
    terminal: DEFAULT_PANEL_CONFIGS.terminal.position,
    aiChat: DEFAULT_PANEL_CONFIGS.aiChat.position,
    git: DEFAULT_PANEL_CONFIGS.git.position,
    problems: DEFAULT_PANEL_CONFIGS.problems.position,
    code: DEFAULT_PANEL_CONFIGS.code.position,
  });

const clonePanelConfigsValue = (source: PanelConfigs): PanelConfigs => ({
  explorer: { ...source.explorer, size: { ...source.explorer.size } },
  terminal: { ...source.terminal, size: { ...source.terminal.size } },
  aiChat: { ...source.aiChat, size: { ...source.aiChat.size } },
  git: { ...source.git, size: { ...source.git.size } },
  problems: { ...source.problems, size: { ...source.problems.size } },
  code: { ...source.code, size: { ...source.code.size } },
});

const cloneRememberedSnappedPositionsValue = (
  source: RememberedSnappedPositions,
): RememberedSnappedPositions => ({
  explorer: source.explorer,
  terminal: source.terminal,
  aiChat: source.aiChat,
  git: source.git,
  problems: source.problems,
  code: source.code,
});

const normalizeHydratedPanelLayoutState = (
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
  rememberedSnappedPositions: RememberedSnappedPositions,
): HydratedPanelLayoutState => {
  const nextPanels = { ...panels };
  const nextPanelConfigs = clonePanelConfigsValue(panelConfigs);
  const nextRememberedSnappedPositions = cloneRememberedSnappedPositionsValue(
    rememberedSnappedPositions,
  );
  const occupiedPositions = new Set<PanelPosition>();

  // Keep a single visible snapped owner per side during hydration.
  (Object.keys(nextPanels) as PanelId[]).forEach((panelId) => {
    if (!nextPanels[panelId]) {
      return;
    }

    const config = nextPanelConfigs[panelId];
    if (config.mode !== "snapped") {
      return;
    }

    if (occupiedPositions.has(config.position)) {
      nextPanels[panelId] = false;
      return;
    }

    occupiedPositions.add(config.position);
  });

  return {
    panels: nextPanels,
    panelConfigs: nextPanelConfigs,
    rememberedSnappedPositions: nextRememberedSnappedPositions,
  };
};

const resolveStoredPanelConfig = (
  savedPanelConfig: unknown,
  defaultConfig: PanelConfig,
): PanelConfig => {
  const configRecord =
    typeof savedPanelConfig === "object" && savedPanelConfig !== null
      ? (savedPanelConfig as Record<string, unknown>)
      : null;
  const sizeRecord =
    typeof configRecord?.size === "object" && configRecord.size !== null
      ? (configRecord.size as Record<string, unknown>)
      : null;

  return {
    ...defaultConfig,
    ...(configRecord ?? {}),
    size: {
      ...defaultConfig.size,
      ...(sizeRecord ?? {}),
    },
  };
};

const resolveStoredPanelConfigs = (
  savedPanelConfigs: unknown,
): PanelConfigs => {
  if (typeof savedPanelConfigs !== "object" || savedPanelConfigs === null) {
    return cloneDefaultPanelConfigs();
  }

  const { browser: _browser, ...rest } = savedPanelConfigs as Record<
    string,
    unknown
  >;
  return {
    explorer: resolveStoredPanelConfig(
      rest.explorer,
      DEFAULT_PANEL_CONFIGS.explorer,
    ),
    terminal: resolveStoredPanelConfig(
      rest.terminal,
      DEFAULT_PANEL_CONFIGS.terminal,
    ),
    aiChat: resolveStoredPanelConfig(rest.aiChat, DEFAULT_PANEL_CONFIGS.aiChat),
    git: resolveStoredPanelConfig(rest.git, DEFAULT_PANEL_CONFIGS.git),
    problems: resolveStoredPanelConfig(
      rest.problems,
      DEFAULT_PANEL_CONFIGS.problems,
    ),
    code: resolveStoredPanelConfig(rest.code, DEFAULT_PANEL_CONFIGS.code),
  };
};

const loadPersistedPanelLayoutState = (
  panelStorageKey: string | null,
): HydratedPanelLayoutState => {
  if (!panelStorageKey) {
    return normalizeHydratedPanelLayoutState(
      { ...DEFAULT_PANELS },
      cloneDefaultPanelConfigs(),
      createDefaultRememberedSnappedPositions(),
    );
  }

  try {
    const raw = localStorage.getItem(panelStorageKey);
    if (!raw) {
      return normalizeHydratedPanelLayoutState(
        { ...DEFAULT_PANELS },
        cloneDefaultPanelConfigs(),
        createDefaultRememberedSnappedPositions(),
      );
    }

    const parsed = JSON.parse(raw) as {
      panels?: unknown;
      panelConfigs?: unknown;
      rememberedSnappedPositions?: unknown;
    };
    const savedPanels =
      typeof parsed.panels === "object" && parsed.panels !== null
        ? (parsed.panels as Record<string, unknown>)
        : null;
    const { browser: _browser, ...restPanels } = savedPanels ?? {};
    const panels: PanelVisibility = {
      ...DEFAULT_PANELS,
      ...(restPanels as Partial<PanelVisibility>),
    };
    const panelConfigs = resolveStoredPanelConfigs(parsed.panelConfigs);
    const rememberedSnappedPositions = resolveRememberedSnappedPositions(
      parsed.panelConfigs,
      parsed.rememberedSnappedPositions,
    );

    return normalizeHydratedPanelLayoutState(
      panels,
      panelConfigs,
      rememberedSnappedPositions,
    );
  } catch {
    return normalizeHydratedPanelLayoutState(
      { ...DEFAULT_PANELS },
      cloneDefaultPanelConfigs(),
      createDefaultRememberedSnappedPositions(),
    );
  }
};

const resolveRememberedSnappedPositions = (
  savedPanelConfigs: unknown,
  savedRememberedPositions: unknown,
): RememberedSnappedPositions => {
  const nextPositions = createDefaultRememberedSnappedPositions();
  const rememberedRecord =
    typeof savedRememberedPositions === "object" &&
    savedRememberedPositions !== null
      ? (savedRememberedPositions as Record<string, unknown>)
      : null;
  const configsRecord =
    typeof savedPanelConfigs === "object" && savedPanelConfigs !== null
      ? (savedPanelConfigs as Record<string, unknown>)
      : null;

  (Object.keys(nextPositions) as PanelId[]).forEach((panelId) => {
    const rememberedPosition = rememberedRecord?.[panelId];
    if (isPanelPosition(rememberedPosition)) {
      nextPositions[panelId] = rememberedPosition;
      return;
    }

    const savedConfig = configsRecord?.[panelId];
    if (typeof savedConfig !== "object" || savedConfig === null) {
      return;
    }

    const configRecord = savedConfig as Record<string, unknown>;
    if (
      configRecord.mode === "snapped" &&
      isPanelPosition(configRecord.position)
    ) {
      nextPositions[panelId] = configRecord.position;
    }
  });

  return nextPositions;
};

const quoteShellPath = (value: string): string => {
  const escaped = value.replace(/'/g, `'"'"'`);
  return `'${escaped}'`;
};

const commandWithWorkingDirectory = (
  command: string,
  workingDirectory?: string,
): string => {
  const trimmedCommand = command.trim();
  const trimmedDirectory = workingDirectory?.trim();

  if (!trimmedCommand) {
    return "";
  }

  if (!trimmedDirectory) {
    return trimmedCommand;
  }

  return `cd ${quoteShellPath(trimmedDirectory)} && ${trimmedCommand}`;
};

const hasMissingTools = (profile: ExecutionProfile): boolean =>
  Array.isArray(profile.missingTools) && profile.missingTools.length > 0;

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  onFileOpen,
  onBackToWelcome,
  onProjectOpen,
  onSwitchProject,
  onCloseProject,
  onPerspectiveOpen: externalPerspectiveOpen,
  onPerspectiveClose: externalPerspectiveClose,
}) => {
  const { isDark, theme: currentTheme, setTheme } = useTheme();
  const indexingPhase = useIndexingPhase();
  const diagnosticsPreload = useProjectDiagnosticsPreload();
  const prefersReducedMotion = useReducedMotion();
  const reducePanelMotion =
    prefersReducedMotion ||
    indexingPhase === "indexing" ||
    diagnosticsPreload.active;
  const panelLayoutTransition = reducePanelMotion
    ? { duration: 0 }
    : FLOATING_PANEL_LAYOUT_TRANSITION;
  const theme = getThemeColors(isDark);
  const [isPerspectiveOpen, setIsPerspectiveOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDependencyPolicyOpen, setIsDependencyPolicyOpen] = useState(false);
  const [executionDialogMode, setExecutionDialogMode] = useState<
    "run" | "debug" | null
  >(null);
  const [executionProfiles, setExecutionProfiles] =
    useState<ExecutionProfileSet>({
      runProfiles: [],
      debugProfiles: [],
    });
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
  const setUiScale = useEditorSettingsStore((state) => state.setUiScale);
  const logicalViewport = React.useMemo(
    () => getLogicalViewportSize(uiScale),
    [uiScale],
  );
  const activeProjectId = useWorkspaceStore((s) => s.activeId);
  const workspaceProjectPath = useWorkspaceStore((state) => {
    const activeProject = state.projects.find(
      (project) => project.id === state.activeId,
    );
    return activeProject?.path ?? "";
  });
  const activeProjectPath = workspaceProjectPath;
  const activeEditorTab = useEditorStore((state) =>
    state.getActiveTab(state.activePaneId),
  );
  const activeStatusFilePath = useEditorStore((state) => state.statusFile.path);
  const activePaneId = useEditorStore((state) => state.activePaneId);
  const openEditorTab = useEditorStore((state) => state.openTab);
  const renameEditorTabPaths = useEditorStore(
    (state) => state.renamePathPrefix,
  );
  const closeEditorTabPaths = useEditorStore((state) => state.closePathPrefix);
  const remapExplorerPathPrefix = useExplorerStore(
    (state) => state.remapPathPrefix,
  );
  const pruneExplorerPathPrefix = useExplorerStore(
    (state) => state.prunePathPrefix,
  );
  const renamePathDiagnostics = useDiagnosticsStore(
    (state) => state.renamePathDiagnostics,
  );
  const prunePathDiagnostics = useDiagnosticsStore(
    (state) => state.prunePathDiagnostics,
  );
  const {
    tuiModeActive,
    tuiAssist,
    tuiActiveSessionId,
    setTUIAssist,
    setPowerProfile,
    canAccessPath,
    enterTUIMode,
    exitTUIMode,
    isDispatcherPaused,
  } = useTerminalStore();
  const previewWindows = usePreviewWindowStore((state) => state.windows);
  const appearancePreview = usePreviewWindowStore(
    (state) => state.appearancePreview,
  );
  const openPreviewWindow = usePreviewWindowStore((state) => state.openWindow);
  const updatePreviewWindow = usePreviewWindowStore(
    (state) => state.updateWindow,
  );
  const closePreviewWindow = usePreviewWindowStore(
    (state) => state.closeWindow,
  );
  const closeAllPreviewWindows = usePreviewWindowStore(
    (state) => state.closeAllWindows,
  );
  const focusPreviewWindow = usePreviewWindowStore(
    (state) => state.focusWindow,
  );
  const createPreviewCheckpoint = usePreviewWindowStore(
    (state) => state.createCheckpoint,
  );
  const restorePreviewCheckpoint = usePreviewWindowStore(
    (state) => state.restoreCheckpoint,
  );
  const deletePreviewCheckpoint = usePreviewWindowStore(
    (state) => state.deleteCheckpoint,
  );
  const startAppearancePreview = usePreviewWindowStore(
    (state) => state.startAppearancePreview,
  );
  const patchAppearancePreview = usePreviewWindowStore(
    (state) => state.patchAppearancePreview,
  );
  const previewButtonState = usePreviewableContext();
  const { openPreviewFromTerminal } = useBrowserPreviewBridge({
    openPreviewWindow,
    focusPreviewWindow,
    closePreviewWindow,
  });
  const applyAppearancePreview = usePreviewWindowStore(
    (state) => state.applyAppearancePreview,
  );
  const cancelAppearancePreview = usePreviewWindowStore(
    (state) => state.cancelAppearancePreview,
  );
  const dispatcher = useDispatcher();
  const { activeModal, closeModal } = usePluginModal();

  const panelStorageKey = activeProjectId
    ? `panelState:${activeProjectId}`
    : null;
  const initialPanelLayoutState = React.useMemo(
    () => loadPersistedPanelLayoutState(panelStorageKey),
    [panelStorageKey],
  );

  const [panels, setPanels] = useState<PanelVisibility>(() => {
    return { ...initialPanelLayoutState.panels };
  });

  const [panelConfigs, setPanelConfigs] = useState<PanelConfigs>(() => {
    return clonePanelConfigsValue(initialPanelLayoutState.panelConfigs);
  });
  const [rememberedSnappedPositions, setRememberedSnappedPositions] =
    useState<RememberedSnappedPositions>(() => {
      return cloneRememberedSnappedPositionsValue(
        initialPanelLayoutState.rememberedSnappedPositions,
      );
    });
  const [tuiLayoutSnapshot, setTuiLayoutSnapshot] = useState<{
    panels: PanelVisibility;
    panelConfigs: PanelConfigs;
    rememberedSnappedPositions: RememberedSnappedPositions;
  } | null>(null);
  const wasTUIActiveRef = React.useRef(false);
  const forceHideTerminalAfterTUIExitRef = React.useRef(false);
  const panelsRef = React.useRef(panels);
  const panelConfigsRef = React.useRef(panelConfigs);
  const gitDiffBaselineWidthRef = React.useRef<number | null>(null);
  const rememberedSnappedPositionsRef = React.useRef(
    rememberedSnappedPositions,
  );
  const appearanceSessionRef = React.useRef<string | null>(null);
  const previewUpdateQueueRef = React.useRef<
    Map<
      string,
      {
        input: UpdatePreviewWindowInput;
        focusRequested: boolean;
        queuedAt: number;
      }
    >
  >(new Map());
  const previewUpdateFrameRef = React.useRef<number | null>(null);
  const openCanonicalBrowserPreviewRef = React.useRef<() => void>(() => {});
  const executionProfilesRequestRef = React.useRef(0);

  useEffect(() => {
    const requestID = executionProfilesRequestRef.current + 1;
    executionProfilesRequestRef.current = requestID;

    void resolveExecutionProfiles({
      projectPath: activeProjectPath,
      activeTab: activeEditorTab,
    })
      .then((nextProfiles) => {
        if (executionProfilesRequestRef.current !== requestID) {
          return;
        }
        setExecutionProfiles(nextProfiles);
      })
      .catch(() => {
        if (executionProfilesRequestRef.current !== requestID) {
          return;
        }
        setExecutionProfiles({ runProfiles: [], debugProfiles: [] });
      });
  }, [activeEditorTab, activeProjectPath]);

  const clonePanelConfigs = useCallback(
    (source: PanelConfigs): PanelConfigs => {
      return {
        explorer: { ...source.explorer, size: { ...source.explorer.size } },
        terminal: { ...source.terminal, size: { ...source.terminal.size } },
        aiChat: { ...source.aiChat, size: { ...source.aiChat.size } },
        git: { ...source.git, size: { ...source.git.size } },
        problems: { ...source.problems, size: { ...source.problems.size } },
        code: { ...source.code, size: { ...source.code.size } },
      };
    },
    [],
  );

  const cloneRememberedSnappedPositions = useCallback(
    (source: RememberedSnappedPositions): RememberedSnappedPositions => ({
      explorer: source.explorer,
      terminal: source.terminal,
      aiChat: source.aiChat,
      git: source.git,
      problems: source.problems,
      code: source.code,
    }),
    [],
  );

  const applyPanelsState = useCallback((nextPanels: PanelVisibility) => {
    panelsRef.current = nextPanels;
    setPanels(nextPanels);
  }, []);

  const updatePanelsState = useCallback(
    (updater: (previous: PanelVisibility) => PanelVisibility) => {
      const nextPanels = updater(panelsRef.current);
      applyPanelsState(nextPanels);
      return nextPanels;
    },
    [applyPanelsState],
  );

  const applyPanelConfigsState = useCallback(
    (nextPanelConfigs: PanelConfigs) => {
      panelConfigsRef.current = nextPanelConfigs;
      setPanelConfigs(nextPanelConfigs);
    },
    [],
  );

  const applyRememberedSnappedPositionsState = useCallback(
    (nextRememberedSnappedPositions: RememberedSnappedPositions) => {
      rememberedSnappedPositionsRef.current = nextRememberedSnappedPositions;
      setRememberedSnappedPositions(nextRememberedSnappedPositions);
    },
    [],
  );

  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);

  useEffect(() => {
    panelConfigsRef.current = panelConfigs;
  }, [panelConfigs]);

  useEffect(() => {
    rememberedSnappedPositionsRef.current = rememberedSnappedPositions;
  }, [rememberedSnappedPositions]);

  useEffect(() => {
    try {
      if (tuiModeActive || !panelStorageKey) return;
      localStorage.setItem(
        panelStorageKey,
        JSON.stringify({
          panels,
          panelConfigs,
          rememberedSnappedPositions,
        }),
      );
    } catch {
      /* quota */
    }
  }, [
    panelConfigs,
    panelStorageKey,
    panels,
    rememberedSnappedPositions,
    tuiModeActive,
  ]);

  useEffect(() => {
    setPowerProfile(tuiModeActive ? "hard_pause" : "normal");
  }, [setPowerProfile, tuiModeActive]);

  useEffect(() => {
    if (tuiModeActive === wasTUIActiveRef.current) {
      return;
    }

    if (tuiModeActive) {
      forceHideTerminalAfterTUIExitRef.current = false;
      setTuiLayoutSnapshot({
        panels: { ...panels },
        panelConfigs: clonePanelConfigs(panelConfigs),
        rememberedSnappedPositions: cloneRememberedSnappedPositions(
          rememberedSnappedPositions,
        ),
      });

      const floatingTerminalConfig = getTUIFloatingTerminalConfig({
        viewportWidth: logicalViewport.width,
        viewportHeight: logicalViewport.height,
      });
      setPanelConfigs((prev) => ({
        ...prev,
        terminal: {
          ...prev.terminal,
          ...floatingTerminalConfig,
        },
      }));

      updatePanelsState((prev) => {
        const nextPanels = getTUIPanelVisibility({ ...prev, browser: false });
        return {
          explorer: nextPanels.explorer,
          terminal: nextPanels.terminal,
          aiChat: nextPanels.aiChat,
          git: nextPanels.git,
          problems: prev.problems,
          code: prev.code,
        };
      });

      setTUIAssist({ active: false, panel: null, anchor: "right" });
    } else {
      const shouldHideTerminalPanel = forceHideTerminalAfterTUIExitRef.current;
      setTUIAssist({ active: false, panel: null, anchor: "right" });

      if (tuiLayoutSnapshot) {
        const normalizedSnapshot = normalizeHydratedPanelLayoutState(
          shouldHideTerminalPanel
            ? { ...tuiLayoutSnapshot.panels, terminal: false }
            : tuiLayoutSnapshot.panels,
          tuiLayoutSnapshot.panelConfigs,
          tuiLayoutSnapshot.rememberedSnappedPositions,
        );
        applyPanelsState(normalizedSnapshot.panels);
        applyPanelConfigsState(normalizedSnapshot.panelConfigs);
        applyRememberedSnappedPositionsState(
          normalizedSnapshot.rememberedSnappedPositions,
        );
        setTuiLayoutSnapshot(null);
      } else if (shouldHideTerminalPanel) {
        updatePanelsState((prev) => ({ ...prev, terminal: false }));
      }

      forceHideTerminalAfterTUIExitRef.current = false;
    }

    wasTUIActiveRef.current = tuiModeActive;
  }, [
    applyPanelConfigsState,
    applyPanelsState,
    applyRememberedSnappedPositionsState,
    clonePanelConfigs,
    cloneRememberedSnappedPositions,
    logicalViewport.height,
    logicalViewport.width,
    panelConfigs,
    panels,
    rememberedSnappedPositions,
    setTUIAssist,
    tuiLayoutSnapshot,
    tuiModeActive,
    updatePanelsState,
  ]);

  const terminalPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const gitPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const problemsPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const panelWorkspaceRef = React.useRef<HTMLDivElement | null>(null);
  const [panelWorkspaceSize, setPanelWorkspaceSize] =
    React.useState(logicalViewport);
  const previousPanelWorkspaceSizeRef = React.useRef(panelWorkspaceSize);

  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);
  const [dropTargetPosition, setDropTargetPosition] =
    useState<PanelPosition | null>(null);
  const [floatingPresenceVersion, setFloatingPresenceVersion] = useState(0);
  const [closingSnappedSlots, setClosingSnappedSlots] = useState<
    Partial<Record<PanelPosition, SnappedSlotSnapshot>>
  >({});
  const closingSnappedSlotTimersRef = useRef<
    Partial<Record<PanelPosition, ReturnType<typeof setTimeout>>>
  >({});
  const previousSnappedSlotsRef = useRef<
    Partial<Record<PanelPosition, SnappedSlotSnapshot>>
  >({});

  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [projectPathCopiedVisible, setProjectPathCopiedVisible] =
    useState(false);
  const projectPathCopiedTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const isLogicalFullscreenPanel = useCallback(
    (config: PanelConfig) =>
      config.mode === "floating" &&
      config.x === 0 &&
      config.y === 0 &&
      config.size.width >= panelWorkspaceSize.width - 1 &&
      config.size.height >= panelWorkspaceSize.height - 1,
    [panelWorkspaceSize.height, panelWorkspaceSize.width],
  );

  const restoreOrEnterPanelFullscreen = useCallback(
    (
      panelId: "terminal" | "git" | "problems",
      snapshotRef: React.MutableRefObject<PanelFullscreenSnapshot | null>,
    ) => {
      const currentConfig = panelConfigsRef.current[panelId];
      const isFullscreenConfig = isLogicalFullscreenPanel(currentConfig);
      const shouldRestore =
        isFullscreenConfig ||
        (snapshotRef.current !== null &&
          currentConfig.mode === "floating" &&
          currentConfig.x === 0 &&
          currentConfig.y === 0);

      if (shouldRestore) {
        const saved = snapshotRef.current;
        snapshotRef.current = null;
        setFloatingPresenceVersion((version) => version + 1);
        const fallbackPosition =
          resolveSmartSnappedPosition(
            panelId,
            rememberedSnappedPositionsRef.current[panelId],
            panelsRef.current,
            panelConfigsRef.current,
          ) ?? rememberedSnappedPositionsRef.current[panelId];
        const fallbackSize = normalizePanelSizeForPosition(
          fallbackPosition,
          DEFAULT_PANEL_CONFIGS[panelId].size,
        );

        setPanelConfigs((prev) => ({
          ...prev,
          [panelId]: {
            ...prev[panelId],
            mode: saved?.mode ?? "snapped",
            position: saved ? prev[panelId].position : fallbackPosition,
            x: saved?.x ?? 0,
            y: saved?.y ?? 0,
            size: saved?.size ?? fallbackSize,
          },
        }));
        return;
      }

      snapshotRef.current = {
        mode: currentConfig.mode,
        x: currentConfig.x,
        y: currentConfig.y,
        size: { ...currentConfig.size },
      };
      setPanelConfigs((prev) => ({
        ...prev,
        [panelId]: {
          ...prev[panelId],
          mode: "floating",
          x: 0,
          y: 0,
          size: {
            width: panelWorkspaceSize.width,
            height: panelWorkspaceSize.height,
          },
        },
      }));
    },
    [
      isLogicalFullscreenPanel,
      panelWorkspaceSize.height,
      panelWorkspaceSize.width,
    ],
  );

  function togglePanelCompactFromShortcut(
    panelId: PanelId,
    snapshotRef?: React.MutableRefObject<PanelFullscreenSnapshot | null>,
  ) {
    const currentConfig = panelConfigsRef.current[panelId];
    const looksFullscreen =
      currentConfig.mode === "floating" &&
      currentConfig.x === 0 &&
      currentConfig.y === 0 &&
      (isLogicalFullscreenPanel(currentConfig) ||
        snapshotRef?.current !== null);

    if (snapshotRef && panelsRef.current[panelId] && looksFullscreen) {
      const restorePosition = currentConfig.position;
      restoreOrEnterPanelFullscreen(
        panelId as "terminal" | "git" | "problems",
        snapshotRef,
      );
      updatePanelsState((previous) => {
        let changed = false;
        const nextPanels = { ...previous };

        (Object.keys(panelConfigsRef.current) as PanelId[]).forEach((id) => {
          if (id === panelId || !nextPanels[id]) {
            return;
          }

          const otherConfig = panelConfigsRef.current[id];
          if (
            otherConfig.mode === "snapped" &&
            otherConfig.position === restorePosition
          ) {
            nextPanels[id] = false;
            changed = true;
          }
        });

        return changed ? nextPanels : previous;
      });
      return;
    }

    toggleNamedPanel(panelId);
  }

  function closePanelFullscreenFromShortcut(
    panelId: "git" | "problems",
    snapshotRef: React.MutableRefObject<PanelFullscreenSnapshot | null>,
  ): boolean {
    const currentConfig = panelConfigsRef.current[panelId];
    const looksFullscreen =
      panelsRef.current[panelId] &&
      currentConfig.mode === "floating" &&
      currentConfig.x === 0 &&
      currentConfig.y === 0 &&
      (isLogicalFullscreenPanel(currentConfig) || snapshotRef.current !== null);

    if (!looksFullscreen) {
      return false;
    }

    const saved = snapshotRef.current;
    snapshotRef.current = null;
    setFloatingPresenceVersion((version) => version + 1);

    const fallbackPosition =
      resolveSmartSnappedPosition(
        panelId,
        rememberedSnappedPositionsRef.current[panelId],
        panelsRef.current,
        panelConfigsRef.current,
      ) ?? rememberedSnappedPositionsRef.current[panelId];
    const fallbackSize = normalizePanelSizeForPosition(
      fallbackPosition,
      DEFAULT_PANEL_CONFIGS[panelId].size,
    );

    applyPanelConfigsState({
      ...panelConfigsRef.current,
      [panelId]: {
        ...currentConfig,
        mode: saved?.mode ?? "snapped",
        position: saved ? currentConfig.position : fallbackPosition,
        x: saved?.x ?? 0,
        y: saved?.y ?? 0,
        size: saved?.size ?? fallbackSize,
      },
    });
    applyPanelsState({ ...panelsRef.current, [panelId]: false });
    return true;
  }

  function togglePanelFullscreenFromShortcut(
    panelId: "git" | "problems",
    snapshotRef: React.MutableRefObject<PanelFullscreenSnapshot | null>,
  ) {
    if (closePanelFullscreenFromShortcut(panelId, snapshotRef)) {
      return;
    }

    const currentConfig = panelConfigsRef.current[panelId];
    if (panelsRef.current[panelId] && isLogicalFullscreenPanel(currentConfig)) {
      restoreOrEnterPanelFullscreen(panelId, snapshotRef);
      return;
    }

    snapshotRef.current = {
      mode: currentConfig.mode,
      x: currentConfig.x,
      y: currentConfig.y,
      size: { ...currentConfig.size },
    };

    applyPanelsState({ ...panelsRef.current, [panelId]: true });
    applyPanelConfigsState({
      ...panelConfigsRef.current,
      [panelId]: {
        ...currentConfig,
        mode: "floating",
        x: 0,
        y: 0,
        size: {
          width: panelWorkspaceSize.width,
          height: panelWorkspaceSize.height,
        },
      },
    });
  }

  useEffect(() => {
    const workspace = panelWorkspaceRef.current;
    if (!workspace) {
      setPanelWorkspaceSize(logicalViewport);
      return;
    }

    const updatePanelWorkspaceSize = () => {
      const rect = workspace.getBoundingClientRect();
      const nextSize = {
        width: screenToLogicalPixels(rect.width, uiScale),
        height: screenToLogicalPixels(rect.height, uiScale),
      };

      setPanelWorkspaceSize((currentSize) => {
        if (
          Math.abs(currentSize.width - nextSize.width) < 0.5 &&
          Math.abs(currentSize.height - nextSize.height) < 0.5
        ) {
          return currentSize;
        }

        return nextSize;
      });
    };

    updatePanelWorkspaceSize();

    const resizeObserver = new ResizeObserver(updatePanelWorkspaceSize);
    resizeObserver.observe(workspace);

    return () => {
      resizeObserver.disconnect();
    };
  }, [logicalViewport, uiScale]);

  useEffect(() => {
    const previousViewport = previousPanelWorkspaceSizeRef.current;
    previousPanelWorkspaceSizeRef.current = panelWorkspaceSize;

    if (
      Math.abs(previousViewport.width - panelWorkspaceSize.width) < 0.5 &&
      Math.abs(previousViewport.height - panelWorkspaceSize.height) < 0.5
    ) {
      return;
    }

    setPanelConfigs((currentConfigs) => {
      let changed = false;
      const nextConfigs = { ...currentConfigs };

      (Object.keys(currentConfigs) as PanelId[]).forEach((panelId) => {
        const config = currentConfigs[panelId];
        const wasFullscreen =
          config.mode === "floating" &&
          config.x === 0 &&
          config.y === 0 &&
          config.size.width >= previousViewport.width - 1 &&
          config.size.height >= previousViewport.height - 1;

        if (!wasFullscreen) {
          return;
        }

        changed = true;
        nextConfigs[panelId] = {
          ...config,
          size: {
            width: panelWorkspaceSize.width,
            height: panelWorkspaceSize.height,
          },
        };
      });

      return changed ? nextConfigs : currentConfigs;
    });
  }, [panelWorkspaceSize]);
  const [codePanelSource, setCodePanelSource] = useState<{
    path: string;
    name: string;
    content: string;
    language: string;
    line?: number;
  } | null>(null);
  const [createEntryDialog, setCreateEntryDialog] =
    useState<ProjectEntryCreateDialogState | null>(null);
  const [createEntryName, setCreateEntryName] = useState("");
  const [createEntryBusy, setCreateEntryBusy] = useState(false);
  const [renameEntryDialog, setRenameEntryDialog] =
    useState<ProjectEntryRenameDialogState | null>(null);
  const [renameEntryName, setRenameEntryName] = useState("");
  const [renameEntryBusy, setRenameEntryBusy] = useState(false);
  const [trashEntryDialog, setTrashEntryDialog] =
    useState<ProjectEntryTrashRequest | null>(null);
  const [trashEntryBusy, setTrashEntryBusy] = useState(false);

  const showNotification = useCallback(
    (type: "success" | "error", message: string) => {
      setNotification({ type, message });
      const timeout = type === "error" ? 6000 : 3000;
      setTimeout(() => setNotification(null), timeout);
    },
    [],
  );

  const ensureProjectEntryAccess = useCallback(
    (path: string, mode: "read" | "write"): boolean => {
      if (!path) {
        showNotification("error", "[Files] Path is empty");
        return false;
      }

      if (!tuiModeActive) {
        return true;
      }

      const accessDecision = canAccessPath(path, mode);
      if (!accessDecision.allowed) {
        showNotification("error", `[Security] ${accessDecision.reason}`);
        return false;
      }

      return true;
    },
    [canAccessPath, showNotification, tuiModeActive],
  );

  const closeCreateEntryDialog = useCallback(() => {
    if (createEntryBusy) {
      return;
    }

    setCreateEntryDialog(null);
    setCreateEntryName("");
  }, [createEntryBusy]);

  const closeRenameEntryDialog = useCallback(() => {
    if (renameEntryBusy) {
      return;
    }

    setRenameEntryDialog(null);
    setRenameEntryName("");
  }, [renameEntryBusy]);

  const closeTrashEntryDialog = useCallback(() => {
    if (trashEntryBusy) {
      return;
    }

    setTrashEntryDialog(null);
  }, [trashEntryBusy]);

  const copyText = useCallback(
    async (text: string, successMessage = "Copied to clipboard") => {
      if (!text.trim()) {
        showNotification("error", "[Clipboard] Nothing to copy");
        return false;
      }

      const copied = await writeClipboardTextWithFallback(text);
      if (!copied) {
        showNotification("error", "[Clipboard] Failed to write to clipboard");
        return false;
      }

      showNotification("success", successMessage);
      return true;
    },
    [showNotification],
  );

  const getRelativePath = useCallback(
    (path: string) => relativeProjectPath(path, activeProjectPath),
    [activeProjectPath],
  );

  const copyAbsolutePath = useCallback(
    async (path: string) => {
      if (!ensureProjectEntryAccess(path, "read")) {
        return false;
      }
      return copyText(path, "Absolute path copied");
    },
    [copyText, ensureProjectEntryAccess],
  );

  const copyRelativePath = useCallback(
    async (path: string) => {
      if (!ensureProjectEntryAccess(path, "read")) {
        return false;
      }

      return copyText(getRelativePath(path), "Relative path copied");
    },
    [copyText, ensureProjectEntryAccess, getRelativePath],
  );

  const copyProjectPath = useCallback(async () => {
    if (!activeProjectPath) {
      showNotification("error", "[Files] No project opened");
      return false;
    }

    if (!ensureProjectEntryAccess(activeProjectPath, "read")) {
      return false;
    }

    return copyText(activeProjectPath, "Project path copied");
  }, [activeProjectPath, copyText, ensureProjectEntryAccess, showNotification]);

  const showProjectPathCopiedConfirmation = useCallback(() => {
    if (projectPathCopiedTimerRef.current) {
      clearTimeout(projectPathCopiedTimerRef.current);
    }

    setProjectPathCopiedVisible(true);
    projectPathCopiedTimerRef.current = setTimeout(() => {
      setProjectPathCopiedVisible(false);
      projectPathCopiedTimerRef.current = null;
    }, 1600);
  }, []);

  const copyProjectPathFromShortcut = useCallback(async () => {
    if (!activeProjectPath) {
      showNotification("error", "[Files] No project opened");
      return false;
    }

    if (!ensureProjectEntryAccess(activeProjectPath, "read")) {
      return false;
    }

    const copied = await writeClipboardTextWithFallback(activeProjectPath);
    if (!copied) {
      showNotification("error", "[Clipboard] Failed to write to clipboard");
      return false;
    }

    showProjectPathCopiedConfirmation();
    return true;
  }, [
    activeProjectPath,
    ensureProjectEntryAccess,
    showNotification,
    showProjectPathCopiedConfirmation,
  ]);

  useEffect(
    () => () => {
      if (projectPathCopiedTimerRef.current) {
        clearTimeout(projectPathCopiedTimerRef.current);
      }
    },
    [],
  );

  const revealEntry = useCallback(
    async (path: string) => {
      if (!ensureProjectEntryAccess(path, "read")) {
        return false;
      }

      try {
        await RevealProjectEntry(path);
        return true;
      } catch (error) {
        showNotification(
          "error",
          `[Files] ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    [ensureProjectEntryAccess, showNotification],
  );

  const requestCreateEntry = useCallback(
    (type: "file" | "folder", directoryPath = activeProjectPath) => {
      const normalizedDirectory = normalizeProjectPath(directoryPath);
      if (!normalizedDirectory) {
        showNotification("error", "[Files] No project opened");
        return;
      }

      if (!ensureProjectEntryAccess(normalizedDirectory, "write")) {
        return;
      }

      setCreateEntryDialog({
        type,
        directoryPath: normalizedDirectory,
      });
      setCreateEntryName("");
    },
    [activeProjectPath, ensureProjectEntryAccess, showNotification],
  );

  const requestRenameEntry = useCallback(
    (entry: ProjectEntryActionTarget) => {
      if (!ensureProjectEntryAccess(entry.path, "write")) {
        return;
      }

      const currentName = getProjectPathBasename(entry.path);
      setRenameEntryDialog({
        ...entry,
        name: currentName,
      });
      setRenameEntryName(currentName);
    },
    [ensureProjectEntryAccess],
  );

  const requestTrashEntry = useCallback(
    (entry: ProjectEntryTrashRequest) => {
      if (!ensureProjectEntryAccess(entry.path, "write")) {
        return;
      }

      setTrashEntryDialog(entry);
    },
    [ensureProjectEntryAccess],
  );

  const handleCreateEntrySubmit = useCallback(async () => {
    if (!createEntryDialog) {
      return;
    }

    const entryName = createEntryName.trim();
    if (!entryName) {
      showNotification("error", "[Files] Name is required");
      return;
    }

    const targetPath = joinProjectEntryPath(
      createEntryDialog.directoryPath,
      entryName,
    );
    if (!ensureProjectEntryAccess(targetPath, "write")) {
      return;
    }

    setCreateEntryBusy(true);
    try {
      if (createEntryDialog.type === "file") {
        await WriteFile(targetPath, "");
      } else {
        await CreateDirectory(targetPath);
      }

      showNotification(
        "success",
        `${createEntryDialog.type === "file" ? "File" : "Folder"} created`,
      );
      setCreateEntryDialog(null);
      setCreateEntryName("");
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setCreateEntryBusy(false);
    }
  }, [
    createEntryDialog,
    createEntryName,
    ensureProjectEntryAccess,
    showNotification,
  ]);

  const handleRenameEntrySubmit = useCallback(async () => {
    if (!renameEntryDialog) {
      return;
    }

    const nextName = renameEntryName.trim();
    if (!nextName) {
      showNotification("error", "[Files] Name is required");
      return;
    }

    if (!ensureProjectEntryAccess(renameEntryDialog.path, "write")) {
      return;
    }

    setRenameEntryBusy(true);
    try {
      await RenameProjectEntry(renameEntryDialog.path, nextName);
      showNotification("success", "Entry renamed");
      setRenameEntryDialog(null);
      setRenameEntryName("");
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setRenameEntryBusy(false);
    }
  }, [
    ensureProjectEntryAccess,
    renameEntryDialog,
    renameEntryName,
    showNotification,
  ]);

  const handleTrashEntrySubmit = useCallback(async () => {
    if (!trashEntryDialog) {
      return;
    }

    if (!ensureProjectEntryAccess(trashEntryDialog.path, "write")) {
      return;
    }

    setTrashEntryBusy(true);
    try {
      await TrashProjectEntry(trashEntryDialog.path);
      showNotification("success", "Moved to trash");
      setTrashEntryDialog(null);
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setTrashEntryBusy(false);
    }
  }, [ensureProjectEntryAccess, showNotification, trashEntryDialog]);

  const projectEntryActions = useMemo(
    () => ({
      projectPath: activeProjectPath,
      getRelativePath,
      copyText,
      copyAbsolutePath,
      copyRelativePath,
      copyProjectPath,
      revealEntry,
      requestCreateEntry,
      requestRenameEntry,
      requestTrashEntry,
    }),
    [
      activeProjectPath,
      copyAbsolutePath,
      copyProjectPath,
      copyRelativePath,
      copyText,
      getRelativePath,
      requestCreateEntry,
      requestRenameEntry,
      requestTrashEntry,
      revealEntry,
    ],
  );

  const handlePluginCommandSuccess = useCallback(
    (message: string) => {
      showNotification("success", message);
    },
    [showNotification],
  );

  const handlePluginCommandError = useCallback(
    (message: string) => {
      showNotification("error", message);
    },
    [showNotification],
  );

  const openCommandDispatcher = useCallback(() => {
    if (tuiModeActive || isDispatcherPaused) {
      return;
    }

    dispatcher.open();
  }, [dispatcher, isDispatcherPaused, tuiModeActive]);

  const toggleCommandDispatcher = useCallback(() => {
    if (tuiModeActive || isDispatcherPaused) {
      return;
    }

    if (dispatcher.isOpen) {
      dispatcher.close();
      return;
    }

    dispatcher.open();
  }, [dispatcher, isDispatcherPaused, tuiModeActive]);

  const submitTerminalCommand = useCallback(
    async (
      command: string,
      terminalName = "Terminal",
      workingDirectory?: string,
    ) => {
      const commandToExecute = commandWithWorkingDirectory(
        command,
        workingDirectory,
      );
      if (!commandToExecute) {
        showNotification("error", "[Run] Command is empty");
        return false;
      }

      const state = useTerminalStore.getState();
      state.initialize();
      let activePane = state.panes.find(
        (pane) => pane.id === state.activePaneId,
      );

      if (!activePane && state.panes.length > 0) {
        activePane = state.panes[0];
        state.setActivePane(activePane.id);
      }

      if (!activePane) {
        showNotification("error", "[Terminal] Terminal pane is not available");
        return false;
      }

      let targetSessionId = activePane.activeTabId;
      if (!targetSessionId) {
        try {
          targetSessionId = await state.createTerminal(
            activePane.id,
            isDark,
            terminalName,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to create terminal session";
          showNotification("error", `[Terminal] ${message}`);
          return false;
        }
      }

      const bytes = new TextEncoder().encode(commandToExecute + "\n");
      const binary = Array.from(bytes, (byte) =>
        String.fromCharCode(byte),
      ).join("");

      try {
        await WriteTerminal(targetSessionId, btoa(binary));
        updatePanelsState((previous) => ({ ...previous, terminal: true }));
        setTimeout(() => useTerminalStore.getState().focusActiveTerminal(), 80);
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to send command to terminal";
        showNotification("error", `[Terminal] ${message}`);
        return false;
      }
    },
    [isDark, showNotification, updatePanelsState],
  );

  const executeExecutionProfile = useCallback(
    async (profile: ExecutionProfile) => {
      if (hasMissingTools(profile)) {
        const missing = profile.missingTools?.join(", ") ?? "required tools";
        showNotification(
          "error",
          `[Run] Missing tools for profile "${profile.label}": ${missing}`,
        );
        return false;
      }

      if (profile.kind === "preview") {
        openCanonicalBrowserPreviewRef.current();
        return true;
      }

      return submitTerminalCommand(
        profile.command,
        profile.mode === "debug" ? "Debug" : "Run",
        profile.workingDirectory,
      );
    },
    [showNotification, submitTerminalCommand],
  );

  const openRunDialog = useCallback(() => {
    const primaryProfile = executionProfiles.runProfiles.find(
      (profile) => !hasMissingTools(profile),
    );
    if (primaryProfile) {
      void executeExecutionProfile(primaryProfile);
      return;
    }

    setExecutionDialogMode("run");
  }, [executeExecutionProfile, executionProfiles.runProfiles]);

  const openDebugDialog = useCallback(() => {
    setExecutionDialogMode("debug");
  }, []);

  const openSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const openDependencyPolicy = useCallback(() => {
    setIsDependencyPolicyOpen(true);
  }, []);

  const closeDependencyPolicy = useCallback(() => {
    setIsDependencyPolicyOpen(false);
  }, []);

  const closeExecutionDialog = useCallback(() => {
    setExecutionDialogMode(null);
  }, []);

  const executeCustomCommand = useCallback(
    async (command: string, mode: "run" | "debug") => {
      const submitted = await submitTerminalCommand(
        command,
        mode === "debug" ? "Debug" : "Run",
      );

      if (submitted) {
        closeExecutionDialog();
      }
    },
    [closeExecutionDialog, submitTerminalCommand],
  );

  const getActiveTerminalSessionId = useCallback((): string | null => {
    const state = useTerminalStore.getState();
    if (state.tuiActiveSessionId) {
      return state.tuiActiveSessionId;
    }

    const activePane = state.panes.find(
      (pane) => pane.id === state.activePaneId,
    );
    return activePane?.activeTabId || null;
  }, []);

  const ensureActiveTerminalSessionId = useCallback(
    async (terminalName = "Terminal"): Promise<string | null> => {
      const state = useTerminalStore.getState();
      state.initialize();

      const existingSessionId = getActiveTerminalSessionId();
      if (existingSessionId) {
        return existingSessionId;
      }

      let activePane = state.panes.find(
        (pane) => pane.id === state.activePaneId,
      );
      if (!activePane && state.panes.length > 0) {
        activePane = state.panes[0];
        state.setActivePane(activePane.id);
      }
      if (!activePane) {
        showNotification("error", "[Terminal] Terminal pane is not available");
        return null;
      }

      try {
        return await state.createTerminal(activePane.id, isDark, terminalName);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to create terminal session";
        showNotification("error", `[Terminal] ${message}`);
        return null;
      }
    },
    [getActiveTerminalSessionId, isDark, showNotification],
  );

  const resolveAssistPanelId = useCallback(
    (panel: string): AssistPanelId | null => {
      switch (panel) {
        case "explorer":
        case "sidebar":
          return "explorer";
        case "ai":
        case "aichat":
        case "chat":
        case "aiChat":
          return "aiChat";
        case "git":
          return "git";
        default:
          return null;
      }
    },
    [],
  );

  const resolveDefaultTUIAssistPanel = useCallback((): AssistPanelId => {
    const snapshotPanels = tuiLayoutSnapshot?.panels;

    if (snapshotPanels?.git || panelsRef.current.git) {
      return "git";
    }
    if (snapshotPanels?.aiChat || panelsRef.current.aiChat) {
      return "aiChat";
    }
    if (snapshotPanels?.explorer || panelsRef.current.explorer) {
      return "explorer";
    }

    return "explorer";
  }, [tuiLayoutSnapshot]);

  const openTUIAssistPanel = useCallback(
    (payload: unknown) => {
      const request = parsePanelOpenRequest(payload);
      const state = useTerminalStore.getState();
      if (!state.tuiModeActive) {
        return;
      }

      const assistPanel = request?.panel
        ? resolveAssistPanelId(request.panel)
        : resolveDefaultTUIAssistPanel();
      if (!assistPanel) {
        return;
      }

      state.setTUIAssist({
        active: true,
        panel: assistPanel,
        anchor: normalizeTUIAssistAnchor(
          request?.anchor ?? request?.position,
          state.tuiAssist.anchor,
        ),
        ratio:
          typeof request?.ratio === "number"
            ? request.ratio
            : state.tuiAssist.ratio,
      });
      setTimeout(() => state.focusActiveTerminal(), 80);
    },
    [resolveAssistPanelId, resolveDefaultTUIAssistPanel],
  );

  const toggleTUIAssistPanel = useCallback((panel: AssistPanelId) => {
    const state = useTerminalStore.getState();
    if (!state.tuiModeActive) {
      return;
    }

    const isSamePanel =
      state.tuiAssist.active && state.tuiAssist.panel === panel;
    state.setTUIAssist({
      active: !isSamePanel,
      panel: isSamePanel ? null : panel,
      anchor: state.tuiAssist.anchor,
    });

    if (!isSamePanel) {
      setTimeout(() => state.focusActiveTerminal(), 80);
    }
  }, []);

  const closeTUIAssistPanel = useCallback(() => {
    const state = useTerminalStore.getState();
    state.setTUIAssist({
      active: false,
      panel: null,
      anchor: state.tuiAssist.anchor,
    });
    setTimeout(() => state.focusActiveTerminal(), 80);
  }, []);

  const setTUIAssistRatio = useCallback((value: unknown) => {
    let ratio: number | null = null;

    if (typeof value === "number") {
      ratio = value;
    } else if (
      typeof value === "object" &&
      value !== null &&
      "ratio" in value &&
      typeof (value as { ratio: unknown }).ratio === "number"
    ) {
      ratio = (value as { ratio: number }).ratio;
    }

    if (ratio === null) {
      return;
    }

    const state = useTerminalStore.getState();
    if (!state.tuiModeActive) {
      return;
    }

    state.setTUIAssist({ active: true, ratio, anchor: state.tuiAssist.anchor });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const terminalState = useTerminalStore.getState();
      const isTUIActive = terminalState.tuiModeActive;
      const configs = panelConfigsRef.current;
      const panelState = panelsRef.current;
      const activeElement = document.activeElement as HTMLElement | null;
      const isTerminalFocused = isTerminalFocusedElement(activeElement);
      const activePane = terminalState.panes.find(
        (pane) => pane.id === terminalState.activePaneId,
      );
      const activeTerminalId = activePane?.activeTabId;
      const isTerminalPanelVisible = panelState.terminal;
      const isTerminalShortcutContext = hasTerminalShortcutContext({
        activeElement,
        tuiModeActive: isTUIActive,
        terminalPanelVisible: isTerminalPanelVisible,
      });

      if (shouldBypassGlobalFindShortcuts(e, activeElement)) {
        return;
      }

      if (shortcuts.terminalNewTab(e)) {
        const hasNoTabs = activePane && activePane.tabIds.length === 0;
        if (
          isTerminalShortcutContext ||
          (isTerminalPanelVisible && hasNoTabs)
        ) {
          e.preventDefault();
          if (activePane) {
            void terminalState.createTerminal(activePane.id, isDark);
          }
          return;
        }
      }

      if (isTerminalShortcutContext && shortcuts.terminalCloseTab(e)) {
        e.preventDefault();
        if (activePane?.activeTabId) {
          void terminalState
            .closeTerminal(activePane.id, activePane.activeTabId)
            .then(() => {
              setTimeout(() => terminalState.focusActiveTerminal(), 50);
            });
        }
        return;
      }

      if (isTerminalShortcutContext && shortcuts.terminalReopenTab(e)) {
        e.preventDefault();
        void terminalState.reopenLastClosedTab(isDark);
        return;
      }

      if (shortcuts.unifiedSearch(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (terminalState.isDispatcherPaused) {
          return;
        }
        toggleCommandDispatcher();
        return;
      }

      if (shortcuts.openProject(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new Event("arlecchino:open-project"));
        return;
      }

      if (shortcuts.newProject(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new Event("arlecchino:new-project"));
        return;
      }

      // Toggle Explorer: Cmd+E
      if (shortcuts.toggleExplorer(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();

        togglePanelCompactFromShortcut("explorer");
        return;
      }

      // Switch Project: Cmd+` (next) / Cmd+Shift+` (prev)
      if (shortcuts.switchProjectNext(e) || shortcuts.switchProjectPrev(e)) {
        const localProjectSwitchBlocked =
          dispatcher.isOpen || activeModal !== null || isPerspectiveOpen;

        if (
          isTerminalShortcutContext ||
          isTUIActive ||
          localProjectSwitchBlocked ||
          isProjectSwitchBlocked()
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const { projects, activeId: curId } = useWorkspaceStore.getState();
        if (projects.length < 2) return;
        const idx = projects.findIndex((p) => p.id === curId);
        const isNext = !shortcuts.switchProjectPrev(e);
        const targetIdx = isNext
          ? (idx + 1) % projects.length
          : (idx - 1 + projects.length) % projects.length;
        onSwitchProject?.(projects[targetIdx].id, isNext ? 1 : -1);
        return;
      }

      // Toggle Terminal: Ctrl+`
      if (shortcuts.toggleTerminal(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();

        toggleNamedPanel("terminal");
        return;
      }

      // Toggle AI: Cmd+Shift+I
      if (shortcuts.toggleAI(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();

        toggleNamedPanel("aiChat");
        return;
      }

      if (shortcuts.toggleSettings(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        if (isSettingsOpen) {
          closeSettings();
        } else {
          openSettings();
        }
        return;
      }

      if (shortcuts.copyProjectPath(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        void copyProjectPathFromShortcut();
        return;
      }

      // Toggle Git fullscreen: Cmd+Shift+G
      if (shortcuts.toggleGitFullscreen(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        togglePanelFullscreenFromShortcut("git", gitPreFullscreenRef);
        return;
      }

      // Toggle Git compact: Cmd+G
      if (shortcuts.toggleGit(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        togglePanelCompactFromShortcut("git", gitPreFullscreenRef);
        return;
      }

      // Toggle Problems fullscreen: Cmd+Shift+P
      if (shortcuts.toggleProblemsFullscreen(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        togglePanelFullscreenFromShortcut("problems", problemsPreFullscreenRef);
        return;
      }

      // Toggle Problems compact: Cmd+P
      if (shortcuts.toggleProblems(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        togglePanelCompactFromShortcut("problems", problemsPreFullscreenRef);
        return;
      }

      if (shortcuts.openBrowserPreview(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        openCanonicalBrowserPreviewRef.current();
        return;
      }

      // Escape
      if (shortcuts.escape(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        if (terminalState.tuiAssist.active) {
          closeTUIAssistPanel();
          return;
        }

        const activePreviewWindowId =
          usePreviewWindowStore.getState().activeWindowId;
        if (activePreviewWindowId) {
          closePreviewWindow(activePreviewWindowId);
          return;
        }

        if (isSettingsOpen) {
          closeSettings();
          return;
        }

        dispatcher.close();
        closeModal();
      }

      // Zoom: Cmd+Plus / Cmd+Minus / Cmd+0
      if (shortcuts.zoomIn(e)) {
        e.preventDefault();

        if (isTerminalShortcutContext) {
          measurePerf(
            "zoom",
            "shortcut.in.terminal",
            () => {
              terminalState.terminalZoomIn();
            },
            {
              source: "keyboard",
              tuiModeActive: isTUIActive,
              terminalFocused: isTerminalFocused,
            },
          );
          return;
        }

        measurePerf(
          "zoom",
          "shortcut.in",
          () => {
            useEditorSettingsStore.getState().zoomIn();
          },
          { source: "keyboard", tuiModeActive: isTUIActive },
        );
        return;
      }
      if (shortcuts.zoomOut(e)) {
        e.preventDefault();

        if (isTerminalShortcutContext) {
          measurePerf(
            "zoom",
            "shortcut.out.terminal",
            () => {
              terminalState.terminalZoomOut();
            },
            {
              source: "keyboard",
              tuiModeActive: isTUIActive,
              terminalFocused: isTerminalFocused,
            },
          );
          return;
        }

        measurePerf(
          "zoom",
          "shortcut.out",
          () => {
            useEditorSettingsStore.getState().zoomOut();
          },
          { source: "keyboard", tuiModeActive: isTUIActive },
        );
        return;
      }
      if (shortcuts.zoomReset(e)) {
        e.preventDefault();

        if (isTerminalShortcutContext) {
          measurePerf(
            "zoom",
            "shortcut.reset.terminal",
            () => {
              terminalState.terminalZoomReset();
            },
            {
              source: "keyboard",
              tuiModeActive: isTUIActive,
              terminalFocused: isTerminalFocused,
            },
          );
          return;
        }

        measurePerf(
          "zoom",
          "shortcut.reset",
          () => {
            useEditorSettingsStore.getState().resetZoom();
          },
          { source: "keyboard", tuiModeActive: isTUIActive },
        );
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeModal,
    applyPanelConfigsState,
    applyPanelsState,
    closePreviewWindow,
    closeModal,
    closeTUIAssistPanel,
    copyProjectPathFromShortcut,
    dispatcher,
    getActiveTerminalSessionId,
    isLogicalFullscreenPanel,
    isSettingsOpen,
    isDark,
    openSettings,
    closeSettings,
    panelWorkspaceSize.height,
    panelWorkspaceSize.width,
    restoreOrEnterPanelFullscreen,
    toggleCommandDispatcher,
    toggleTUIAssistPanel,
    updatePanelsState,
  ]);

  const handleFileOpen = (
    path: string,
    content: string,
    name: string,
    line?: number,
  ) => {
    if (tuiModeActive) {
      const accessDecision = canAccessPath(path, "read");
      if (!accessDecision.allowed) {
        showNotification("error", `[Security] ${accessDecision.reason}`);
        return;
      }
    }

    if (onFileOpen) {
      onFileOpen(path, content, name, line);
    }
  };

  const handleFileOpenInPanel = useCallback(
    (path: string, name: string, line?: number) => {
      const fallbackLanguage = (() => {
        const normalizedPath = path.trim();
        const fileName = normalizedPath.split("/").pop()?.toLowerCase() ?? "";
        if (fileName === "dockerfile") {
          return "dockerfile";
        }
        if (!normalizedPath.includes(".")) {
          return "text";
        }
        return normalizedPath.split(".").pop()?.toLowerCase() || "text";
      })();

      void (async () => {
        if (!ensureProjectEntryAccess(path, "read")) {
          return;
        }

        let language = fallbackLanguage;
        let content = "";

        try {
          content = await ReadFile(path);
        } catch (error) {
          showNotification(
            "error",
            `[Files] ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }

        try {
          const languageInfo = await GetLanguageForFile(path);
          if (languageInfo?.id) {
            language = languageInfo.id;
          }
        } catch {
          language = fallbackLanguage;
        }

        setCodePanelSource({
          path,
          name,
          content,
          language,
          line,
        });

        openEditorTab(activePaneId, path, name, content, language);

        const nextConfig = buildPanelConfigForOpen(
          "code",
          {
            panel: "code",
            mode: "snapped",
            position: "right",
            width: 560,
          },
          panelConfigsRef.current.code,
        );
        const nextPanelConfigs = {
          ...panelConfigsRef.current,
          code: nextConfig,
        };
        const nextRememberedSnappedPositions = {
          ...rememberedSnappedPositionsRef.current,
          code: nextConfig.position,
        };
        const nextPanels = { ...panelsRef.current };

        (Object.keys(panelConfigsRef.current) as PanelId[]).forEach((id) => {
          if (id === "code" || !nextPanels[id]) {
            return;
          }

          const otherConfig = panelConfigsRef.current[id];
          if (
            otherConfig.mode === "snapped" &&
            otherConfig.position === "right"
          ) {
            nextPanels[id] = false;
          }
        });

        nextPanels.code = true;
        applyPanelsState(nextPanels);
        applyPanelConfigsState(nextPanelConfigs);
        applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
      })();
    },
    [
      activePaneId,
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
      ensureProjectEntryAccess,
      openEditorTab,
      showNotification,
    ],
  );

  const openFileFromPath = useCallback(
    async (path: string, line?: number) => {
      if (tuiModeActive) {
        const accessDecision = canAccessPath(path, "read");
        if (!accessDecision.allowed) {
          showNotification("error", `[Security] ${accessDecision.reason}`);
          return;
        }
      }

      try {
        const content = await ReadFile(path);
        const name = path.split("/").pop() || path;
        onFileOpen?.(path, content, name, line);
      } catch (error) {
        console.error("[MainLayout] Failed to open file:", error);
      }
    },
    [canAccessPath, onFileOpen, showNotification, tuiModeActive],
  );

  useEffect(() => {
    const normalizedProjectPath = normalizeProjectPath(activeProjectPath);
    if (!normalizedProjectPath) {
      return;
    }

    const unsubscribeRenamed = EventsOn(
      "project:entry:renamed",
      (payload: ProjectEntryRenamedEvent) => {
        const oldPath = normalizeProjectPath(payload?.oldPath ?? "");
        const newPath = normalizeProjectPath(payload?.newPath ?? "");
        if (!oldPath || !newPath) {
          return;
        }

        if (
          !isSameOrChildPath(oldPath, normalizedProjectPath) &&
          !isSameOrChildPath(newPath, normalizedProjectPath)
        ) {
          return;
        }

        remapExplorerPathPrefix(oldPath, newPath);
        renameEditorTabPaths(oldPath, newPath);
        renamePathDiagnostics(oldPath, newPath);

        setCodePanelSource((current) => {
          if (!current) {
            return current;
          }

          const remappedPath = remapProjectPathPrefix(
            current.path,
            oldPath,
            newPath,
          );
          if (!remappedPath || remappedPath === current.path) {
            return current;
          }

          return {
            ...current,
            path: remappedPath,
            name: getProjectPathBasename(remappedPath),
          };
        });

        setCreateEntryDialog((current) => {
          if (!current) {
            return current;
          }

          const remappedDirectory = remapProjectPathPrefix(
            current.directoryPath,
            oldPath,
            newPath,
          );
          if (
            !remappedDirectory ||
            remappedDirectory === current.directoryPath
          ) {
            return current;
          }

          return {
            ...current,
            directoryPath: remappedDirectory,
          };
        });

        setRenameEntryDialog((current) => {
          if (!current) {
            return current;
          }

          const remappedPath = remapProjectPathPrefix(
            current.path,
            oldPath,
            newPath,
          );
          if (!remappedPath || remappedPath === current.path) {
            return current;
          }

          const nextName = getProjectPathBasename(remappedPath);
          setRenameEntryName(nextName);
          return {
            ...current,
            path: remappedPath,
            name: nextName,
          };
        });

        setTrashEntryDialog((current) => {
          if (!current) {
            return current;
          }

          const remappedPath = remapProjectPathPrefix(
            current.path,
            oldPath,
            newPath,
          );
          if (!remappedPath || remappedPath === current.path) {
            return current;
          }

          return {
            ...current,
            path: remappedPath,
            displayName: getProjectPathBasename(remappedPath),
          };
        });
      },
    );

    const unsubscribeDeleted = EventsOn(
      "project:entry:deleted",
      (payload: ProjectEntryDeletedEvent) => {
        const deletedPath = normalizeProjectPath(payload?.path ?? "");
        if (
          !deletedPath ||
          !isSameOrChildPath(deletedPath, normalizedProjectPath)
        ) {
          return;
        }

        pruneExplorerPathPrefix(deletedPath);
        closeEditorTabPaths(deletedPath);
        prunePathDiagnostics(deletedPath);

        setCodePanelSource((current) =>
          current && isSameOrChildPath(current.path, deletedPath)
            ? null
            : current,
        );
        setCreateEntryDialog((current) =>
          current && isSameOrChildPath(current.directoryPath, deletedPath)
            ? null
            : current,
        );
        setRenameEntryDialog((current) =>
          current && isSameOrChildPath(current.path, deletedPath)
            ? null
            : current,
        );
        setTrashEntryDialog((current) =>
          current && isSameOrChildPath(current.path, deletedPath)
            ? null
            : current,
        );
      },
    );

    return () => {
      unsubscribeRenamed();
      unsubscribeDeleted();
    };
  }, [
    activeProjectPath,
    closeEditorTabPaths,
    pruneExplorerPathPrefix,
    prunePathDiagnostics,
    remapExplorerPathPrefix,
    renameEditorTabPaths,
    renamePathDiagnostics,
  ]);

  const handlePerspectiveOpen = useCallback(() => {
    setIsPerspectiveOpen(true);
    if (externalPerspectiveOpen) {
      externalPerspectiveOpen();
    }
  }, [externalPerspectiveOpen]);

  const handlePerspectiveClose = useCallback(() => {
    setIsPerspectiveOpen(false);
    if (externalPerspectiveClose) {
      externalPerspectiveClose();
    }
  }, [externalPerspectiveClose]);

  const ensureAppearancePreviewSession = useCallback(() => {
    if (appearanceSessionRef.current) {
      return appearanceSessionRef.current;
    }

    const activeAppearancePreview =
      usePreviewWindowStore.getState().appearancePreview;
    if (activeAppearancePreview) {
      appearanceSessionRef.current = activeAppearancePreview.checkpointId;
      return activeAppearancePreview.checkpointId;
    }

    const checkpointId = createPreviewCheckpoint("appearance-preview");
    const startedCheckpointId = startAppearancePreview(
      currentTheme,
      uiScale,
      checkpointId,
    );

    if (startedCheckpointId !== checkpointId) {
      deletePreviewCheckpoint(checkpointId);
    }

    appearanceSessionRef.current = startedCheckpointId;

    return startedCheckpointId;
  }, [
    createPreviewCheckpoint,
    currentTheme,
    deletePreviewCheckpoint,
    startAppearancePreview,
    uiScale,
  ]);

  useEffect(() => {
    if (!appearancePreview) {
      appearanceSessionRef.current = null;
    }
  }, [appearancePreview]);

  const applyAppearanceSettings = useCallback(
    (nextTheme: Theme, nextUiScale: number) => {
      setTheme(nextTheme);
      setUiScale(nextUiScale);
    },
    [setTheme, setUiScale],
  );

  const flushQueuedPreviewWindowUpdates = useCallback(() => {
    previewUpdateFrameRef.current = null;

    const queuedUpdates = Array.from(previewUpdateQueueRef.current.entries());
    previewUpdateQueueRef.current.clear();
    const flushedAt = nowPerf();

    queuedUpdates.forEach(([windowId, queuedUpdate]) => {
      const updateStartedAt = nowPerf();
      const updated = updatePreviewWindow(windowId, queuedUpdate.input);
      const updateDurationMs = nowPerf() - updateStartedAt;

      emitPerfMetric({
        scope: "preview",
        name: "window.update",
        durationMs: updateDurationMs,
        details: {
          windowId,
          updated,
          queuedMs: flushedAt - queuedUpdate.queuedAt,
          focusRequested: queuedUpdate.focusRequested,
        },
      });

      if (updated && queuedUpdate.focusRequested) {
        focusPreviewWindow(windowId);
      }
    });
  }, [focusPreviewWindow, updatePreviewWindow]);

  const queuePreviewWindowUpdate = useCallback(
    (
      windowId: string,
      input: UpdatePreviewWindowInput,
      focusRequested: boolean,
    ) => {
      const existingUpdate = previewUpdateQueueRef.current.get(windowId);
      previewUpdateQueueRef.current.set(windowId, {
        input: existingUpdate
          ? mergePreviewWindowUpdateInput(existingUpdate.input, input)
          : input,
        focusRequested: existingUpdate
          ? existingUpdate.focusRequested || focusRequested
          : focusRequested,
        queuedAt: existingUpdate?.queuedAt ?? nowPerf(),
      });

      if (previewUpdateFrameRef.current !== null) {
        return;
      }

      previewUpdateFrameRef.current = window.requestAnimationFrame(
        flushQueuedPreviewWindowUpdates,
      );
    },
    [flushQueuedPreviewWindowUpdates],
  );

  useEffect(
    () => () => {
      if (previewUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(previewUpdateFrameRef.current);
      }
      previewUpdateFrameRef.current = null;
      previewUpdateQueueRef.current.clear();
    },
    [],
  );

  const handleAppearancePreviewStartEvent = useCallback(
    (payload: unknown) => {
      ensureAppearancePreviewSession();
      const patch = parseAppearancePatch(payload);
      if (!patch.theme && typeof patch.uiScale !== "number") {
        return;
      }

      const stagedAppearance = patchAppearancePreview(patch);
      if (stagedAppearance) {
        applyAppearanceSettings(
          stagedAppearance.theme,
          stagedAppearance.uiScale,
        );
      }
    },
    [
      applyAppearanceSettings,
      ensureAppearancePreviewSession,
      patchAppearancePreview,
    ],
  );

  const handleAppearancePreviewPatchEvent = useCallback(
    (payload: unknown) => {
      const patch = parseAppearancePatch(payload);
      if (!patch.theme && typeof patch.uiScale !== "number") {
        return;
      }

      const activeAppearancePreview =
        usePreviewWindowStore.getState().appearancePreview;
      if (!activeAppearancePreview) {
        ensureAppearancePreviewSession();
      }

      const stagedAppearance = patchAppearancePreview(patch);
      if (stagedAppearance) {
        applyAppearanceSettings(
          stagedAppearance.theme,
          stagedAppearance.uiScale,
        );
      }
    },
    [
      applyAppearanceSettings,
      ensureAppearancePreviewSession,
      patchAppearancePreview,
    ],
  );

  const handleAppearancePreviewApplyEvent = useCallback(() => {
    const activeAppearancePreview =
      usePreviewWindowStore.getState().appearancePreview;
    const appliedAppearance = applyAppearancePreview();
    if (!activeAppearancePreview || !appliedAppearance) {
      return;
    }

    deletePreviewCheckpoint(activeAppearancePreview.checkpointId);
    appearanceSessionRef.current = null;
    showNotification("success", "Appearance changes applied globally");
  }, [applyAppearancePreview, deletePreviewCheckpoint, showNotification]);

  const handleAppearancePreviewCancelEvent = useCallback(() => {
    const activeAppearancePreview =
      usePreviewWindowStore.getState().appearancePreview;
    const restoredAppearance = cancelAppearancePreview();
    if (!activeAppearancePreview || !restoredAppearance) {
      return;
    }

    applyAppearanceSettings(
      restoredAppearance.theme,
      restoredAppearance.uiScale,
    );
    restorePreviewCheckpoint(activeAppearancePreview.checkpointId);
    deletePreviewCheckpoint(activeAppearancePreview.checkpointId);
    appearanceSessionRef.current = null;
    showNotification("success", "Appearance preview canceled");
  }, [
    applyAppearanceSettings,
    cancelAppearancePreview,
    deletePreviewCheckpoint,
    restorePreviewCheckpoint,
    showNotification,
  ]);

  const handlePreviewWindowOpenEvent = useCallback(
    (payload: unknown) => {
      const input = parseOpenPreviewInput(payload);
      if (!input) {
        return;
      }

      const openResult = measurePerf(
        "preview",
        "window.open",
        () => openPreviewWindow(input),
        {
          surface: input.surface,
          mode: input.mode ?? null,
        },
      );
      if (!openResult.opened) {
        if (openResult.reason) {
          showNotification("error", openResult.reason);
        }
        return;
      }

      if (input.surface === "appearance") {
        ensureAppearancePreviewSession();
        const patch = parseAppearancePatch(input.payload);
        if (patch.theme || typeof patch.uiScale === "number") {
          const stagedAppearance = patchAppearancePreview(patch);
          if (stagedAppearance) {
            applyAppearanceSettings(
              stagedAppearance.theme,
              stagedAppearance.uiScale,
            );
          }
        }
      }

      const openedWindowId = openResult.id;
      if (openedWindowId) {
        measurePerf(
          "preview",
          "window.focus.open",
          () => focusPreviewWindow(openedWindowId),
          {
            windowId: openedWindowId,
            surface: input.surface,
          },
        );
      }
    },
    [
      applyAppearanceSettings,
      ensureAppearancePreviewSession,
      focusPreviewWindow,
      openPreviewWindow,
      patchAppearancePreview,
      showNotification,
    ],
  );

  const openCanonicalBrowserPreview = useCallback(() => {
    const nextInput = previewButtonState.launchInput;
    if (!nextInput) {
      showNotification(
        "error",
        "[Preview] No preview is available for the current context",
      );
      return;
    }

    handlePreviewWindowOpenEvent({
      ...nextInput,
      payload: {
        ...(nextInput.payload ?? {}),
        revision: Date.now(),
      },
    });
  }, [
    handlePreviewWindowOpenEvent,
    previewButtonState.launchInput,
    showNotification,
  ]);

  useEffect(() => {
    openCanonicalBrowserPreviewRef.current = openCanonicalBrowserPreview;
  }, [openCanonicalBrowserPreview]);

  const handlePreviewWindowUpdateEvent = useCallback(
    (payload: unknown) => {
      const parsed = parseUpdatePreviewInput(payload);
      if (!parsed) {
        return;
      }

      queuePreviewWindowUpdate(parsed.id, parsed.input, parsed.focusRequested);
    },
    [queuePreviewWindowUpdate],
  );

  const handlePreviewWindowCloseEvent = useCallback(
    (payload: unknown) => {
      const windowId = parseWindowIdFromPayload(payload);
      if (!windowId) {
        return;
      }
      closePreviewWindow(windowId);
    },
    [closePreviewWindow],
  );

  const handlePreviewWindowFocusEvent = useCallback(
    (payload: unknown) => {
      const windowId = parseWindowIdFromPayload(payload);
      if (!windowId) {
        return;
      }
      focusPreviewWindow(windowId);
    },
    [focusPreviewWindow],
  );

  const handlePreviewWindowCheckpointCreateEvent = useCallback(
    (payload: unknown) => {
      createPreviewCheckpoint(parseCheckpointLabel(payload) ?? "manual");
    },
    [createPreviewCheckpoint],
  );

  const handlePreviewWindowCheckpointRestoreEvent = useCallback(
    (payload: unknown) => {
      const checkpointId = parseWindowIdFromPayload(payload);
      if (!checkpointId) {
        return;
      }
      restorePreviewCheckpoint(checkpointId);
    },
    [restorePreviewCheckpoint],
  );

  const closeTerminalPanel = useCallback(() => {
    const terminalState = useTerminalStore.getState();

    if (!terminalState.tuiModeActive) {
      updatePanelsState((previous) => ({ ...previous, terminal: false }));
      return;
    }

    const activePane = terminalState.panes.find(
      (pane) => pane.id === terminalState.activePaneId,
    );
    const activeSessionId =
      terminalState.tuiActiveSessionId ?? activePane?.activeTabId ?? null;

    forceHideTerminalAfterTUIExitRef.current = true;

    if (activePane && activeSessionId) {
      void terminalState.closeTerminal(activePane.id, activeSessionId);
      return;
    }

    if (terminalState.tuiActiveSessionId) {
      terminalState.exitTUIMode(
        terminalState.tuiActiveSessionId,
        "panel-close",
      );
    }
  }, [updatePanelsState]);

  const applyPanelOpenState = useCallback(
    (panelId: PanelId, request: PanelOpenRequest) => {
      const { nextPanels, nextConfig, nextRememberedSnappedPositions } =
        computeNextPanelOpenState(
          panelId,
          request,
          panelsRef.current,
          panelConfigsRef.current,
          rememberedSnappedPositionsRef.current,
        );
      const nextPanelConfigs = {
        ...panelConfigsRef.current,
        [panelId]: nextConfig,
      };

      applyPanelsState(nextPanels);
      applyPanelConfigsState(nextPanelConfigs);
      applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);

      return nextConfig;
    },
    [
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
    ],
  );

  const executeAppSurfaceAction = useCallback(
    (action: AppSurfaceAction) => {
      switch (action.kind) {
        case "dispatcher":
          openCommandDispatcher();
          return;
        case "settings":
          openSettings();
          return;
        case "run":
          if (action.mode === "debug") {
            openDebugDialog();
            return;
          }
          openRunDialog();
          return;
        case "panel":
          applyPanelOpenState(action.panelId, { panel: action.panelId });
          if (action.panelId === "terminal") {
            setTimeout(
              () => useTerminalStore.getState().focusActiveTerminal(),
              80,
            );
          }
          return;
      }
    },
    [
      applyPanelOpenState,
      openCommandDispatcher,
      openDebugDialog,
      openRunDialog,
      openSettings,
    ],
  );

  const handlePanelCloseEvent = useCallback(
    (payload: unknown) => {
      const request = parsePanelOpenRequest(payload);
      if (!request) {
        return;
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction?.kind === "dispatcher") {
        dispatcher.close();
        return;
      }
      if (appAction?.kind === "settings") {
        closeSettings();
        return;
      }
      if (appAction?.kind === "run") {
        closeExecutionDialog();
        return;
      }
      if (appAction?.kind === "panel") {
        if (
          appAction.panelId === "terminal" &&
          useTerminalStore.getState().tuiModeActive
        ) {
          closeTerminalPanel();
          return;
        }
        updatePanelsState((previous) => ({
          ...previous,
          [appAction.panelId]: false,
        }));
        return;
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return;
      }

      const terminalState = useTerminalStore.getState();
      if (terminalState.tuiModeActive) {
        if (panelId === "terminal") {
          closeTerminalPanel();
          return;
        }

        if (
          terminalState.tuiAssist.active &&
          terminalState.tuiAssist.panel === panelId
        ) {
          closeTUIAssistPanel();
        }
        return;
      }

      updatePanelsState((previous) => ({ ...previous, [panelId]: false }));
    },
    [
      closeExecutionDialog,
      closeSettings,
      closeTUIAssistPanel,
      closeTerminalPanel,
      dispatcher,
      updatePanelsState,
    ],
  );

  const handlePanelMoveEvent = useCallback(
    (payload: unknown) => {
      const request = parsePanelOpenRequest(payload);
      if (!request || (!request.position && !request.mode)) {
        return;
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction?.kind === "panel") {
        applyPanelOpenState(appAction.panelId, {
          ...request,
          panel: appAction.panelId,
        });
        return;
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return;
      }

      const terminalState = useTerminalStore.getState();
      if (terminalState.tuiModeActive) {
        if (panelId === "terminal") {
          if (request.position || request.anchor) {
            terminalState.setTUIAssist({
              active: false,
              panel: null,
              anchor: normalizeTUIAssistAnchor(
                request.anchor ?? request.position,
                terminalState.tuiAssist.anchor,
              ),
            });
          }
          return;
        }

        const assistPanelId = resolveAssistPanelId(request.panel);
        if (!assistPanelId) {
          return;
        }

        terminalState.setTUIAssist({
          active: true,
          panel: assistPanelId,
          anchor: normalizeTUIAssistAnchor(
            request.anchor ?? request.position,
            terminalState.tuiAssist.anchor,
          ),
          ratio:
            typeof request.ratio === "number"
              ? request.ratio
              : terminalState.tuiAssist.ratio,
        });
        return;
      }

      applyPanelOpenState(panelId, request);
    },
    [applyPanelOpenState, resolveAssistPanelId],
  );

  const handlePanelOpenEvent = useCallback(
    (payload: unknown) => {
      const request = parsePanelOpenRequest(payload);
      if (!request) {
        return;
      }

      if (request.panel === "browser" || request.panel === "web") {
        openCanonicalBrowserPreviewRef.current();
        return;
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction) {
        if (appAction.kind === "panel") {
          applyPanelOpenState(appAction.panelId, {
            ...request,
            panel: appAction.panelId,
          });
          if (appAction.panelId === "terminal") {
            setTimeout(
              () => useTerminalStore.getState().focusActiveTerminal(),
              80,
            );
          }
          return;
        }
        executeAppSurfaceAction(appAction);
        return;
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return;
      }

      const terminalState = useTerminalStore.getState();
      if (panelId === "terminal" && request.command) {
        applyPanelOpenState(panelId, {
          ...request,
          position: request.position ?? "bottom",
          mode: request.mode ?? "snapped",
        });
        void submitTerminalCommand(
          request.command,
          request.terminalName ?? "Terminal",
        );
        return;
      }

      if (terminalState.tuiModeActive) {
        if (panelId === "terminal") {
          terminalState.setTUIAssist({
            active: false,
            panel: null,
            anchor: terminalState.tuiAssist.anchor,
          });
          setPanelConfigs((previous) => ({
            ...previous,
            terminal: {
              ...previous.terminal,
              ...getTUIFloatingTerminalConfig({
                viewportWidth: logicalViewport.width,
                viewportHeight: logicalViewport.height,
              }),
            },
          }));
          setTimeout(() => terminalState.focusActiveTerminal(), 80);
          return;
        }

        openTUIAssistPanel(request);
        return;
      }

      applyPanelOpenState(panelId, request);

      if (panelId === "terminal") {
        setTimeout(() => useTerminalStore.getState().focusActiveTerminal(), 80);
      }
    },
    [
      applyPanelOpenState,
      executeAppSurfaceAction,
      openTUIAssistPanel,
      submitTerminalCommand,
    ],
  );

  const handleEditorOpenEvent = useCallback(
    (payload: unknown) => {
      const request = parseEditorOpenRequest(payload);
      if (!request) {
        return;
      }
      void openFileFromPath(request.path, request.line);
    },
    [openFileFromPath],
  );

  const handleEditorSplitEvent = useCallback((payload: unknown) => {
    const direction = parseEditorSplitDirection(payload);
    if (!direction) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("arlecchino:editor-split", {
        detail: { direction },
      }),
    );
  }, []);

  const togglePanel = (panel: keyof PanelVisibility) => {
    updatePanelsState((previous) => ({
      ...previous,
      [panel]: !previous[panel],
    }));
  };

  const toggleNamedPanel = useCallback(
    (panelId: PanelId) => {
      const isVisible = panelsRef.current[panelId];
      if (isVisible) {
        if (
          panelId === "terminal" &&
          useTerminalStore.getState().tuiModeActive
        ) {
          closeTerminalPanel();
          return;
        }

        updatePanelsState((previous) => ({ ...previous, [panelId]: false }));
        return;
      }

      applyPanelOpenState(panelId, { panel: panelId });

      if (panelId === "terminal") {
        setTimeout(() => useTerminalStore.getState().focusActiveTerminal(), 80);
      }
    },
    [applyPanelOpenState, closeTerminalPanel, updatePanelsState],
  );

  // Handle IDE events from Go backend (via dispatcher)
  useIDEEvents({
    onOpenPanel: handlePanelOpenEvent,
    onClosePanel: handlePanelCloseEvent,
    onMovePanel: handlePanelMoveEvent,
    onToggle: useCallback(
      (element: string) => {
        const state = useTerminalStore.getState();
        if (state.tuiModeActive) {
          switch (element) {
            case "sidebar":
              toggleTUIAssistPanel("explorer");
              return;
            case "terminal":
              closeTUIAssistPanel();
              setTimeout(() => state.focusActiveTerminal(), 80);
              return;
            case "ai":
              toggleTUIAssistPanel("aiChat");
              return;
          }
        }

        switch (element) {
          case "search":
            openCommandDispatcher();
            break;
          case "sidebar":
            toggleNamedPanel("explorer");
            break;
          case "terminal":
            toggleNamedPanel("terminal");
            break;
          case "ai":
            toggleNamedPanel("aiChat");
            break;
        }
      },
      [
        closeTUIAssistPanel,
        openCommandDispatcher,
        toggleNamedPanel,
        toggleTUIAssistPanel,
      ],
    ),
    onWindowOpen: handlePreviewWindowOpenEvent,
    onWindowUpdate: handlePreviewWindowUpdateEvent,
    onWindowClose: handlePreviewWindowCloseEvent,
    onWindowFocus: handlePreviewWindowFocusEvent,
    onWindowCloseAll: closeAllPreviewWindows,
    onWindowCheckpointCreate: handlePreviewWindowCheckpointCreateEvent,
    onWindowCheckpointRestore: handlePreviewWindowCheckpointRestoreEvent,
    onAppearancePreviewStart: handleAppearancePreviewStartEvent,
    onAppearancePreviewPatch: handleAppearancePreviewPatchEvent,
    onAppearancePreviewApply: handleAppearancePreviewApplyEvent,
    onAppearancePreviewCancel: handleAppearancePreviewCancelEvent,
    onTUIEnter: useCallback(() => {
      void ensureActiveTerminalSessionId("Terminal").then((activeSessionId) => {
        if (activeSessionId) {
          enterTUIMode(activeSessionId, "ide-event");
        }
      });
    }, [ensureActiveTerminalSessionId, enterTUIMode]),
    onTUIExit: useCallback(() => {
      const activeSessionId = getActiveTerminalSessionId();
      if (activeSessionId) {
        exitTUIMode(activeSessionId, "ide-event");
      }
    }, [exitTUIMode, getActiveTerminalSessionId]),
    onTUIAssistOpenPanel: useCallback(
      (payload: unknown) => {
        openTUIAssistPanel(payload);
      },
      [openTUIAssistPanel],
    ),
    onTUIAssistClose: useCallback(() => {
      closeTUIAssistPanel();
    }, [closeTUIAssistPanel]),
    onTUIAssistSwap: useCallback(() => {
      const state = useTerminalStore.getState();
      if (!state.tuiModeActive) {
        return;
      }

      state.setTUIAssist({
        active: true,
        anchor: flipTUIAssistAnchor(state.tuiAssist.anchor),
      });
    }, []),
    onTUIAssistRatio: useCallback(
      (ratio: number) => {
        setTUIAssistRatio(ratio);
      },
      [setTUIAssistRatio],
    ),
    onEditorOpen: handleEditorOpenEvent,
    onEditorSplit: handleEditorSplitEvent,
    onViewZoom: useCallback((action: string) => {
      const terminalState = useTerminalStore.getState();
      const applyTerminalZoom = () => {
        switch (action) {
          case "in":
            terminalState.terminalZoomIn();
            break;
          case "out":
            terminalState.terminalZoomOut();
            break;
          case "reset":
            terminalState.terminalZoomReset();
            break;
        }
      };

      switch (action) {
        case "in":
          measurePerf(
            "zoom",
            "event.in",
            () => {
              if (terminalState.tuiModeActive) {
                applyTerminalZoom();
                return;
              }
              useEditorSettingsStore.getState().zoomIn();
            },
            { source: "ide-event" },
          );
          break;
        case "out":
          measurePerf(
            "zoom",
            "event.out",
            () => {
              if (terminalState.tuiModeActive) {
                applyTerminalZoom();
                return;
              }
              useEditorSettingsStore.getState().zoomOut();
            },
            { source: "ide-event" },
          );
          break;
        case "reset":
          measurePerf(
            "zoom",
            "event.reset",
            () => {
              if (terminalState.tuiModeActive) {
                applyTerminalZoom();
                return;
              }
              useEditorSettingsStore.getState().resetZoom();
            },
            { source: "ide-event" },
          );
          break;
      }
    }, []),
    onAppSettings: openSettings,
    onAppRun: useCallback(
      (mode: unknown) => {
        if (mode === "debug") {
          openDebugDialog();
          return;
        }
        openRunDialog();
      },
      [openDebugDialog, openRunDialog],
    ),
    onGitStatus: useCallback(() => {
      applyPanelOpenState("git", { panel: "git" });
    }, [applyPanelOpenState]),
  });

  const isPanelVisibleAtPosition = (position: PanelPosition): boolean => {
    const panelAtPosition = (Object.keys(panelConfigs) as PanelId[]).find(
      (id) => panelConfigs[id].position === position,
    );
    return panelAtPosition ? panels[panelAtPosition] : false;
  };

  const handlePanelResize = (
    panelId: PanelId,
    updates: { width: number; height: number; x?: number; y?: number },
  ) => {
    setPanelConfigs((prev) => ({
      ...prev,
      [panelId]: {
        ...prev[panelId],
        size: { width: updates.width, height: updates.height },
        x: updates.x !== undefined ? updates.x : prev[panelId].x,
        y: updates.y !== undefined ? updates.y : prev[panelId].y,
      },
    }));
  };

  const handleGitDiffFocusChange = useCallback((active: boolean) => {
    const gitConfig = panelConfigsRef.current.git;
    const isEligibleHost =
      gitConfig.mode === "snapped" &&
      (gitConfig.position === "left" || gitConfig.position === "right");

    if (!active) {
      const baselineWidth = gitDiffBaselineWidthRef.current;
      gitDiffBaselineWidthRef.current = null;

      if (!isEligibleHost || baselineWidth === null) {
        return;
      }

      setPanelConfigs((previous) => {
        const currentGit = previous.git;
        if (
          currentGit.mode !== "snapped" ||
          (currentGit.position !== "left" && currentGit.position !== "right")
        ) {
          return previous;
        }

        if (currentGit.size.width === baselineWidth) {
          return previous;
        }

        return {
          ...previous,
          git: {
            ...currentGit,
            size: {
              ...currentGit.size,
              width: baselineWidth,
            },
          },
        };
      });
      return;
    }

    if (!isEligibleHost) {
      return;
    }

    const currentWidth = gitConfig.size.width;
    if (currentWidth >= 560) {
      return;
    }

    if (gitDiffBaselineWidthRef.current === null) {
      gitDiffBaselineWidthRef.current = currentWidth;
    }

    const targetWidth = Math.min(Math.max(currentWidth, 560), 720);
    if (targetWidth === currentWidth) {
      return;
    }

    setPanelConfigs((previous) => {
      const currentGit = previous.git;
      if (
        currentGit.mode !== "snapped" ||
        (currentGit.position !== "left" && currentGit.position !== "right")
      ) {
        return previous;
      }

      if (currentGit.size.width >= targetWidth) {
        return previous;
      }

      return {
        ...previous,
        git: {
          ...currentGit,
          size: {
            ...currentGit.size,
            width: targetWidth,
          },
        },
      };
    });
  }, []);

  const handleDragStart = (panelId: string) => {
    setDraggingPanel(panelId as PanelId);
  };

  const getSizeForPosition = (
    position: PanelPosition,
    currentSize: PanelSize,
  ): PanelSize => normalizePanelSizeForPosition(position, currentSize);

  const handleDragEnd = (
    panelId: string,
    targetPosition: PanelPosition | null,
    dropX?: number,
    dropY?: number,
  ) => {
    if (draggingPanel) {
      const currentPanel = draggingPanel;

      if (targetPosition) {
        // Check if there's already a panel at this position
        const panelAtTarget = (Object.keys(panelConfigs) as PanelId[]).find(
          (id) =>
            id !== currentPanel &&
            panelConfigs[id].position === targetPosition &&
            panelConfigs[id].mode === "snapped" &&
            panels[id],
        );

        const currentConfig = panelConfigs[currentPanel];
        const currentPanelSize = currentConfig.size;
        const currentPosition = currentConfig.position;

        if (panelAtTarget) {
          // SWAP: Exchange positions between the two panels
          const targetConfig = panelConfigs[panelAtTarget];
          const targetPanelSize = targetConfig.size;
          const nextRememberedSnappedPositions = {
            ...rememberedSnappedPositionsRef.current,
            [currentPanel]: targetPosition,
            [panelAtTarget]: currentPosition,
          };
          const nextPanelConfigs = {
            ...panelConfigsRef.current,
            [currentPanel]: {
              ...panelConfigsRef.current[currentPanel],
              mode: "snapped" as const,
              position: targetPosition,
              size: getSizeForPosition(targetPosition, currentPanelSize),
            },
            [panelAtTarget]: {
              ...panelConfigsRef.current[panelAtTarget],
              mode: "snapped" as const,
              position: currentPosition,
              size: getSizeForPosition(currentPosition, targetPanelSize),
            },
          };

          applyPanelConfigsState(nextPanelConfigs);
          applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
        } else {
          // No panel at target - just move there
          const nextRememberedSnappedPositions = {
            ...rememberedSnappedPositionsRef.current,
            [currentPanel]: targetPosition,
          };
          const nextPanelConfigs = {
            ...panelConfigsRef.current,
            [currentPanel]: {
              ...panelConfigsRef.current[currentPanel],
              mode: "snapped" as const,
              position: targetPosition,
              size: getSizeForPosition(targetPosition, currentPanelSize),
            },
          };

          applyPanelConfigsState(nextPanelConfigs);
          applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
        }
      } else if (dropX !== undefined && dropY !== undefined) {
        // Dropped in free space -> Floating
        const currentSize = panelConfigs[currentPanel].size;
        const width = currentSize.width || 300;
        const height = currentSize.height || 400;
        const nextPanelConfigs = {
          ...panelConfigsRef.current,
          [currentPanel]: {
            ...panelConfigsRef.current[currentPanel],
            mode: "floating" as const,
            x: dropX,
            y: dropY,
            size: { width, height },
          },
        };

        applyPanelConfigsState(nextPanelConfigs);
      }
    }

    setDraggingPanel(null);
    setDropTargetPosition(null);
  };

  const getActivePanelsAtPosition = (
    position: PanelPosition,
  ): PanelId | null => {
    return (
      (Object.keys(panelConfigs) as PanelId[]).find(
        (id) =>
          !(tuiModeActive && id === "terminal") &&
          panelConfigs[id].mode === "snapped" &&
          panelConfigs[id].position === position &&
          panels[id],
      ) || null
    );
  };

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    overflow: "hidden",
    padding: "8px",
    boxSizing: "border-box",
    backgroundColor: isDark ? "var(--bg-blackprint)" : colors.light.bg,
    color: isDark ? "var(--text-primary)" : colors.light.text,
  };

  const shellFrameStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: "var(--radius-shell)",
    backgroundColor: isDark ? "var(--surface-canvas)" : colors.light.bg,
    boxShadow: "var(--shell-shadow)",
  };

  const mainAreaStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    position: "relative",
    overflow: "clip",
    minHeight: 0,
    backgroundColor: isDark ? "var(--bg-blackprint)" : colors.light.bg,
  };

  const editorAreaStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    backgroundColor: isDark ? "var(--bg-blackprint)" : colors.light.bg,
  };

  const notificationStyle: React.CSSProperties = {
    position: "fixed",
    bottom: "60px",
    right: "16px",
    maxWidth: "400px",
    padding: "12px 16px",
    borderRadius: radius.lg,
    boxShadow: shadows.lg,
    color: "#FFFFFF",
    fontSize: "14px",
    zIndex: zIndex.notification,
    backgroundColor:
      notification?.type === "success"
        ? colors.status.success
        : colors.status.error,
  };

  const closeNotificationStyle: React.CSSProperties = {
    position: "absolute",
    top: "4px",
    right: "8px",
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.7)",
    fontSize: "18px",
    cursor: "pointer",
    lineHeight: 1,
  };

  const dropZoneStyle = (position: PanelPosition): React.CSSProperties => {
    const isActive = draggingPanel !== null && dropTargetPosition === position;
    const base: React.CSSProperties = {
      position: "absolute",
      backgroundColor: isActive
        ? isDark
          ? "rgba(255,255,255,0.08)"
          : "rgba(0,0,0,0.06)"
        : "transparent",
      border: isActive
        ? `2px dashed ${isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)"}`
        : "2px dashed transparent",
      borderRadius: radius.lg,
      transition: `all ${transitions.fast}`,
      pointerEvents: draggingPanel ? "auto" : "none",
      zIndex: zIndex.floatingPanel - 1,
    };

    switch (position) {
      case "left":
        return { ...base, left: 8, top: 8, bottom: 8, width: 150 };
      case "right":
        return { ...base, right: 8, top: 8, bottom: 8, width: 150 };
      case "bottom":
        return { ...base, left: 8, right: 8, bottom: 8, height: 100 };
      case "top":
        return { ...base, left: 8, right: 8, top: 8, height: 100 };
      default:
        return base;
    }
  };

  const renderPanel = (
    panelId: PanelId,
    hostMode: "overlay" | "flow" = "overlay",
  ) => {
    const isVisible = panels[panelId];
    const config = panelConfigs[panelId];
    const isDropTarget =
      draggingPanel !== null &&
      draggingPanel !== panelId &&
      dropTargetPosition === config.position;
    const isFullscreen = isLogicalFullscreenPanel(config);

    const getAdjacentPanels = () => {
      const adjacent: {
        left?: number;
        right?: number;
        bottom?: number;
        top?: number;
      } = {};

      (Object.keys(panelConfigs) as PanelId[]).forEach((id) => {
        if (id !== panelId && panels[id]) {
          const otherConfig = panelConfigs[id];
          if (otherConfig.mode === "snapped") {
            if (otherConfig.position === "left")
              adjacent.left = otherConfig.size.width + SNAPPED_PANEL_OUTER_GAP;
            if (otherConfig.position === "right")
              adjacent.right = otherConfig.size.width + SNAPPED_PANEL_OUTER_GAP;
            if (otherConfig.position === "bottom")
              adjacent.bottom =
                otherConfig.size.height + SNAPPED_PANEL_OUTER_GAP;
            if (otherConfig.position === "top")
              adjacent.top = otherConfig.size.height + SNAPPED_PANEL_OUTER_GAP;
          }
        }
      });

      return adjacent;
    };

    const panelProps = {
      position: config.position,
      size: config.size,
      mode: config.mode,
      hostMode,
      x: config.x,
      y: config.y,
      isVisible,
      onResize: (updates: {
        width: number;
        height: number;
        x?: number;
        y?: number;
      }) => handlePanelResize(panelId, updates),
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
      onClose: () => toggleNamedPanel(panelId),
      isDropTarget,
      activeDropTargetPosition:
        draggingPanel === panelId ? dropTargetPosition : null,
      adjacentPanels: getAdjacentPanels(),
      uiScale,
      isFullscreen,
    };

    switch (panelId) {
      case "explorer":
        return (
          <FloatingPanel
            key={panelId}
            id="explorer"
            title="Explorer"
            icon={<FolderTree size={16} />}
            minSize={200}
            maxSize={500}
            {...panelProps}
          >
            <FileExplorer
              projectPath={activeProjectPath}
              onFileOpen={handleFileOpen}
              onFileOpenInPanel={handleFileOpenInPanel}
              isHorizontal={
                config.position === "bottom" || config.position === "top"
              }
              onPerspectiveOpen={handlePerspectiveOpen}
              onPerspectiveClose={handlePerspectiveClose}
            />
          </FloatingPanel>
        );
      case "terminal":
        return (
          <FloatingPanel
            key={panelId}
            id="terminal"
            title="Terminal"
            icon={<Terminal size={16} />}
            minSize={150}
            maxSize={800}
            {...panelProps}
            onClose={closeTerminalPanel}
            useViewportPositioning={tuiModeActive}
            zIndex={tuiModeActive ? zIndex.tooltip + 10 : undefined}
            onFullscreen={() => {
              if (tuiModeActive) {
                terminalPreFullscreenRef.current = null;
                const terminalState = useTerminalStore.getState();
                setTUIAssist({
                  active: false,
                  panel: null,
                  anchor: terminalState.tuiAssist.anchor,
                });
                setPanelConfigs((previous) => ({
                  ...previous,
                  terminal: {
                    ...previous.terminal,
                    ...getTUIFloatingTerminalConfig({
                      viewportWidth: logicalViewport.width,
                      viewportHeight: logicalViewport.height,
                    }),
                  },
                }));
                setTimeout(() => terminalState.focusActiveTerminal(), 80);
                return;
              }

              restoreOrEnterPanelFullscreen(
                "terminal",
                terminalPreFullscreenRef,
              );
            }}
          >
            {tuiModeActive ? (
              <div style={tuiWorkspaceInnerStyle}>
                <div style={tuiTerminalPaneStyle}>
                  <TerminalPanelContent
                    onOpenFileRef={(path, line) => {
                      void openFileFromPath(path, line);
                    }}
                    onOpenPreviewUrl={(url, sessionId) => {
                      openPreviewFromTerminal({
                        url,
                        sessionId,
                        forceOpen: true,
                      });
                    }}
                  />
                </div>
                {assistPanelActive && tuiAssist.panel ? (
                  <div style={tuiAssistPaneStyle}>
                    <div style={tuiAssistHeaderStyle}>
                      <span>
                        {assistPanelTitle[tuiAssist.panel as AssistPanelId]}
                      </span>
                      <div style={tuiAssistControlsStyle}>
                        {(
                          [
                            "left",
                            "right",
                            "top",
                            "bottom",
                          ] as TUIAssistAnchor[]
                        ).map((anchor) => (
                          <button
                            key={anchor}
                            style={{
                              ...tuiAssistButtonStyle,
                              background:
                                tuiAssist.anchor === anchor
                                  ? isDark
                                    ? "rgba(255,255,255,0.16)"
                                    : "rgba(0,0,0,0.12)"
                                  : tuiAssistButtonStyle.background,
                            }}
                            onClick={() =>
                              setTUIAssist({
                                active: true,
                                anchor,
                                panel: tuiAssist.panel,
                              })
                            }
                          >
                            {anchor.slice(0, 1).toUpperCase()}
                          </button>
                        ))}
                        <button
                          style={tuiAssistButtonStyle}
                          onClick={() =>
                            setTUIAssist({
                              active: true,
                              anchor: flipTUIAssistAnchor(tuiAssist.anchor),
                              panel: tuiAssist.panel,
                            })
                          }
                        >
                          Flip
                        </button>
                        <button
                          style={tuiAssistButtonStyle}
                          onClick={closeTUIAssistPanel}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    <div style={tuiAssistBodyStyle}>
                      {renderAssistPanelContent()}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <TerminalPanelContent
                onOpenFileRef={(path, line) => {
                  void openFileFromPath(path, line);
                }}
                onOpenPreviewUrl={(url, sessionId) => {
                  openPreviewFromTerminal({ url, sessionId, forceOpen: true });
                }}
              />
            )}
          </FloatingPanel>
        );
      case "aiChat":
        return (
          <FloatingPanel
            key={panelId}
            id="aiChat"
            title="AI Assistant"
            icon={<Sparkles size={16} />}
            minSize={280}
            maxSize={600}
            {...panelProps}
          >
            <AIChatPanelContent />
          </FloatingPanel>
        );
      case "git":
        return (
          <FloatingPanel
            key={panelId}
            id="git"
            title="Git"
            icon={<GitBranch size={16} />}
            minSize={200}
            maxSize={1400}
            {...panelProps}
            onFullscreen={() =>
              restoreOrEnterPanelFullscreen("git", gitPreFullscreenRef)
            }
          >
            <GitPanel
              projectPath={activeProjectPath}
              panelPosition={config.position}
              onDiffFocusChange={handleGitDiffFocusChange}
              presentationMode={isFullscreen ? "expanded" : "compact"}
              onFileOpen={(path) => {
                void openFileFromPath(path);
              }}
            />
          </FloatingPanel>
        );
      case "problems":
        return (
          <FloatingPanel
            key={panelId}
            id="problems"
            title="Problems"
            icon={<AlertCircle size={16} />}
            minSize={320}
            maxSize={1400}
            {...panelProps}
            onFullscreen={() =>
              restoreOrEnterPanelFullscreen(
                "problems",
                problemsPreFullscreenRef,
              )
            }
          >
            <ProblemsPanel
              activeFilePath={
                activeStatusFilePath ?? activeEditorTab?.path ?? null
              }
              onNavigate={(path, line, _column) => openFileFromPath(path, line)}
              presentationMode={isFullscreen ? "expanded" : "compact"}
            />
          </FloatingPanel>
        );
      case "code":
        return (
          <FloatingPanel
            key={panelId}
            id="code"
            title={codePanelSource ? `${codePanelSource.name} (Code)` : "Code"}
            icon={<FileText size={16} />}
            minSize={320}
            maxSize={900}
            {...panelProps}
          >
            {codePanelSource ? (
              <CodePanelSurface
                key={codePanelSource.path}
                path={codePanelSource.path}
                name={codePanelSource.name}
                initialContent={codePanelSource.content}
                language={codePanelSource.language}
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                Open file from Explorer to start editing in panel
              </div>
            )}
          </FloatingPanel>
        );
      default:
        return null;
    }
  };

  const assistPanelActive =
    tuiModeActive && tuiAssist.active && !!tuiAssist.panel;
  const clampedAssistRatio = Math.max(0.2, Math.min(0.8, tuiAssist.ratio));
  const tuiAssistFlexDirection = getTUIAssistFlexDirection(tuiAssist.anchor);
  const assistPanelTitle: Record<AssistPanelId, string> = {
    explorer: "Explorer",
    aiChat: "AI Assistant",
    git: "Git",
  };

  const renderAssistPanelContent = () => {
    if (!tuiAssist.panel) {
      return null;
    }

    switch (tuiAssist.panel) {
      case "explorer":
        return (
          <FileExplorer
            projectPath={activeProjectPath}
            onFileOpen={handleFileOpen}
            isHorizontal={
              tuiAssist.anchor === "top" || tuiAssist.anchor === "bottom"
            }
            onPerspectiveOpen={handlePerspectiveOpen}
            onPerspectiveClose={handlePerspectiveClose}
          />
        );
      case "aiChat":
        return <AIChatPanelContent />;
      case "git":
        return (
          <GitPanel
            projectPath={activeProjectPath}
            panelPosition={tuiAssist.anchor}
            onFileOpen={(path) => {
              void openFileFromPath(path);
            }}
          />
        );
      default:
        return null;
    }
  };

  const topChromeStyle: React.CSSProperties = {
    maxHeight: 72,
    opacity: 1,
    overflow: "visible",
    pointerEvents: "auto",
    position: "relative",
    zIndex: zIndex.tooltip + 2,
  };

  const bottomChromeStyle: React.CSSProperties = {
    maxHeight: 40,
    opacity: 1,
    overflow: "hidden",
    pointerEvents: "auto",
  };

  const normalWorkspaceStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "row",
    minHeight: 0,
    minWidth: 0,
    opacity: 1,
    pointerEvents: "auto",
  };

  const centerWorkspaceStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    position: "relative",
  };

  const getVerticalSlotStyle = (
    width: number,
    isActive: boolean,
  ): React.CSSProperties => {
    const transition =
      reducePanelMotion || draggingPanel !== null
        ? "none"
        : `width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), min-width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), max-width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;

    return {
      width,
      minWidth: width,
      maxWidth: width,
      height: "100%",
      minHeight: 0,
      flexShrink: 0,
      position: "relative",
      overflow: "visible",
      pointerEvents: isActive ? "auto" : "none",
      transition,
    };
  };

  const getHorizontalSlotStyle = (
    height: number,
    isActive: boolean,
  ): React.CSSProperties => {
    const transition =
      reducePanelMotion || draggingPanel !== null
        ? "none"
        : `height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), min-height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), max-height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;

    return {
      height,
      minHeight: height,
      maxHeight: height,
      width: "100%",
      minWidth: 0,
      flexShrink: 0,
      position: "relative",
      overflow: "visible",
      pointerEvents: isActive ? "auto" : "none",
      transition,
    };
  };

  const tuiOverlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: zIndex.tooltip + 5,
    pointerEvents: "none",
  };

  const tuiWorkspaceInnerStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: assistPanelActive ? tuiAssistFlexDirection : "row",
    gap: assistPanelActive ? 1 : 0,
    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)",
  };

  const tuiTerminalPaneStyle: React.CSSProperties = {
    flex: assistPanelActive ? clampedAssistRatio : 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: isDark ? "var(--bg-blackprint)" : colors.light.bg,
  };

  const tuiAssistPaneStyle: React.CSSProperties = {
    flex: 1 - clampedAssistRatio,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: isDark ? "var(--bg-secondary)" : colors.light.bgSecondary,
    borderLeft:
      assistPanelActive && tuiAssist.anchor === "right"
        ? isDark
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid rgba(0,0,0,0.12)"
        : "none",
    borderRight:
      assistPanelActive && tuiAssist.anchor === "left"
        ? isDark
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid rgba(0,0,0,0.12)"
        : "none",
    borderTop:
      assistPanelActive && tuiAssist.anchor === "bottom"
        ? isDark
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid rgba(0,0,0,0.12)"
        : "none",
    borderBottom:
      assistPanelActive && tuiAssist.anchor === "top"
        ? isDark
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid rgba(0,0,0,0.12)"
        : "none",
  };

  const tuiAssistHeaderStyle: React.CSSProperties = {
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 10px",
    borderBottom: isDark
      ? "1px solid rgba(255,255,255,0.08)"
      : "1px solid rgba(0,0,0,0.12)",
    backgroundColor: isDark ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.8)",
    gap: 8,
  };

  const tuiAssistControlsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 240,
  };

  const tuiAssistButtonStyle: React.CSSProperties = {
    border: isDark
      ? "1px solid rgba(255,255,255,0.16)"
      : "1px solid rgba(0,0,0,0.18)",
    background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
    color: isDark ? "var(--text-primary)" : colors.light.text,
    borderRadius: radius.sm,
    padding: "4px 8px",
    fontSize: 12,
    cursor: "pointer",
  };

  const tuiAssistBodyStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  };

  const isPanelHostedInMainWorkspace = (panelId: PanelId) =>
    !(tuiModeActive && panelId === "terminal");

  const leftSnappedPanel = getActivePanelsAtPosition("left");
  const rightSnappedPanel = getActivePanelsAtPosition("right");
  const topSnappedPanel = getActivePanelsAtPosition("top");
  const bottomSnappedPanel = getActivePanelsAtPosition("bottom");
  const leftSlotWidth = leftSnappedPanel
    ? panelConfigs[leftSnappedPanel].size.width
    : 0;
  const rightSlotWidth = rightSnappedPanel
    ? panelConfigs[rightSnappedPanel].size.width
    : 0;
  const topSlotHeight = topSnappedPanel
    ? panelConfigs[topSnappedPanel].size.height
    : 0;
  const bottomSlotHeight = bottomSnappedPanel
    ? panelConfigs[bottomSnappedPanel].size.height
    : 0;
  const floatingPanelIds = (Object.keys(panelConfigs) as PanelId[]).filter(
    (panelId) =>
      panels[panelId] &&
      panelConfigs[panelId].mode === "floating" &&
      isPanelHostedInMainWorkspace(panelId),
  );
  const activeSnappedSlots = React.useMemo<
    Partial<Record<PanelPosition, SnappedSlotSnapshot>>
  >(
    () => ({
      left: leftSnappedPanel
        ? {
            panelId: leftSnappedPanel,
            size: panelConfigs[leftSnappedPanel].size,
          }
        : undefined,
      right: rightSnappedPanel
        ? {
            panelId: rightSnappedPanel,
            size: panelConfigs[rightSnappedPanel].size,
          }
        : undefined,
      top: topSnappedPanel
        ? { panelId: topSnappedPanel, size: panelConfigs[topSnappedPanel].size }
        : undefined,
      bottom: bottomSnappedPanel
        ? {
            panelId: bottomSnappedPanel,
            size: panelConfigs[bottomSnappedPanel].size,
          }
        : undefined,
    }),
    [
      bottomSnappedPanel,
      leftSnappedPanel,
      panelConfigs,
      rightSnappedPanel,
      topSnappedPanel,
    ],
  );
  const shouldSuppressSnappedExitForPosition = (position: PanelPosition) =>
    floatingPanelIds.some((panelId) => {
      const config = panelConfigs[panelId];
      return config.position === position && isLogicalFullscreenPanel(config);
    });
  const fullscreenSnappedExitSuppression = React.useMemo(
    () => ({
      left: shouldSuppressSnappedExitForPosition("left"),
      right: shouldSuppressSnappedExitForPosition("right"),
      top: shouldSuppressSnappedExitForPosition("top"),
      bottom: shouldSuppressSnappedExitForPosition("bottom"),
    }),
    [floatingPanelIds, isLogicalFullscreenPanel, panelConfigs],
  );

  React.useLayoutEffect(() => {
    const positions: PanelPosition[] = ["left", "right", "top", "bottom"];

    positions.forEach((position) => {
      const activeSlot = activeSnappedSlots[position];
      const previousSlot = previousSnappedSlotsRef.current[position];

      if (activeSlot) {
        previousSnappedSlotsRef.current[position] = activeSlot;
        if (closingSnappedSlotTimersRef.current[position]) {
          clearTimeout(closingSnappedSlotTimersRef.current[position]);
          delete closingSnappedSlotTimersRef.current[position];
        }
        setClosingSnappedSlots((current) => {
          if (!current[position]) {
            return current;
          }

          const next = { ...current };
          delete next[position];
          return next;
        });
        return;
      }

      if (!previousSlot) {
        return;
      }

      delete previousSnappedSlotsRef.current[position];
      if (fullscreenSnappedExitSuppression[position]) {
        return;
      }

      setClosingSnappedSlots((current) => ({
        ...current,
        [position]: previousSlot,
      }));

      if (closingSnappedSlotTimersRef.current[position]) {
        clearTimeout(closingSnappedSlotTimersRef.current[position]);
      }
      closingSnappedSlotTimersRef.current[position] = setTimeout(() => {
        setClosingSnappedSlots((current) => {
          const slot = current[position];
          if (!slot || slot.panelId !== previousSlot.panelId) {
            return current;
          }

          const next = { ...current };
          delete next[position];
          return next;
        });
        delete closingSnappedSlotTimersRef.current[position];
      }, FLOATING_PANEL_LAYOUT_TRANSITION_MS);
    });
  }, [activeSnappedSlots, fullscreenSnappedExitSuppression]);

  useEffect(() => {
    return () => {
      Object.values(closingSnappedSlotTimersRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
    };
  }, []);

  const effectiveLeftSlotWidth = fullscreenSnappedExitSuppression.left
    ? 0
    : leftSlotWidth || closingSnappedSlots.left?.size.width || 0;
  const effectiveRightSlotWidth = fullscreenSnappedExitSuppression.right
    ? 0
    : rightSlotWidth || closingSnappedSlots.right?.size.width || 0;
  const effectiveTopSlotHeight = fullscreenSnappedExitSuppression.top
    ? 0
    : topSlotHeight || closingSnappedSlots.top?.size.height || 0;
  const effectiveBottomSlotHeight = fullscreenSnappedExitSuppression.bottom
    ? 0
    : bottomSlotHeight || closingSnappedSlots.bottom?.size.height || 0;
  // Framer layout scales slot descendants here, which makes panels expand
  // instead of sliding. Slot size uses explicit CSS transitions instead.
  const workspaceLayoutMotionEnabled = false;

  return (
    <ProjectEntryActionsProvider value={projectEntryActions}>
      <div
        style={containerStyle}
        data-testid="main-layout"
        data-tui-session-id={tuiActiveSessionId || ""}
      >
        <div style={shellFrameStyle}>
          <div style={topChromeStyle}>
            <TopBar
              onCommandPaletteOpen={() => {
                if (!tuiModeActive && !isDispatcherPaused) {
                  dispatcher.open();
                }
              }}
              onOpenSearch={openCommandDispatcher}
              onOpenSettings={openSettings}
              onToggleExplorer={() => {
                if (tuiModeActive) {
                  toggleTUIAssistPanel("explorer");
                  return;
                }
                toggleNamedPanel("explorer");
              }}
              onToggleTerminal={() => {
                if (tuiModeActive) {
                  closeTUIAssistPanel();
                  setTimeout(
                    () => useTerminalStore.getState().focusActiveTerminal(),
                    80,
                  );
                  return;
                }
                toggleNamedPanel("terminal");
              }}
              onToggleAIChat={() => {
                if (tuiModeActive) {
                  toggleTUIAssistPanel("aiChat");
                  return;
                }
                toggleNamedPanel("aiChat");
              }}
              onToggleGit={() => {
                if (tuiModeActive) {
                  toggleTUIAssistPanel("git");
                  return;
                }
                toggleNamedPanel("git");
              }}
              onRun={openRunDialog}
              onOpenDebug={openDebugDialog}
              onOpenPreview={openCanonicalBrowserPreview}
              onOpenDependencyPolicy={openDependencyPolicy}
              onBackToWelcome={onBackToWelcome}
              onProjectOpen={onProjectOpen}
              onSwitchProject={onSwitchProject}
              onCloseProject={onCloseProject}
              projectPathCopied={projectPathCopiedVisible}
              panels={{
                explorer: tuiModeActive
                  ? tuiAssist.active && tuiAssist.panel === "explorer"
                  : panels.explorer,
                terminal: tuiModeActive ? true : panels.terminal,
                aiChat: tuiModeActive
                  ? tuiAssist.active && tuiAssist.panel === "aiChat"
                  : panels.aiChat,
                git: panels.git,
              }}
              projectPath={activeProjectPath}
              previewEnabled={previewButtonState.enabled}
              previewActive={previewButtonState.active}
              previewTitle={previewButtonState.buttonTitle}
            />
          </div>

          <div style={mainAreaStyle}>
            <LayoutGroup id="main-floating-panels">
              <motion.div
                ref={panelWorkspaceRef}
                layout={workspaceLayoutMotionEnabled}
                transition={panelLayoutTransition}
                style={normalWorkspaceStyle}
              >
                {draggingPanel && (
                  <>
                    <div
                      style={dropZoneStyle("top")}
                      onMouseEnter={() => setDropTargetPosition("top")}
                      onMouseLeave={() => setDropTargetPosition(null)}
                    />
                    <div
                      style={dropZoneStyle("bottom")}
                      onMouseEnter={() => setDropTargetPosition("bottom")}
                      onMouseLeave={() => setDropTargetPosition(null)}
                    />
                    <div
                      style={dropZoneStyle("left")}
                      onMouseEnter={() => setDropTargetPosition("left")}
                      onMouseLeave={() => setDropTargetPosition(null)}
                    />
                    <div
                      style={dropZoneStyle("right")}
                      onMouseEnter={() => setDropTargetPosition("right")}
                      onMouseLeave={() => setDropTargetPosition(null)}
                    />
                  </>
                )}

                <motion.div
                  layout={workspaceLayoutMotionEnabled}
                  transition={panelLayoutTransition}
                  style={getVerticalSlotStyle(
                    effectiveLeftSlotWidth,
                    !!leftSnappedPanel,
                  )}
                >
                  {fullscreenSnappedExitSuppression.left ? null : (
                    <AnimatePresence initial={false}>
                      {leftSnappedPanel
                        ? renderPanel(leftSnappedPanel, "flow")
                        : null}
                    </AnimatePresence>
                  )}
                </motion.div>

                <motion.div
                  layout={workspaceLayoutMotionEnabled}
                  transition={panelLayoutTransition}
                  style={centerWorkspaceStyle}
                >
                  <motion.div
                    layout={workspaceLayoutMotionEnabled}
                    transition={panelLayoutTransition}
                    style={getHorizontalSlotStyle(
                      effectiveTopSlotHeight,
                      !!topSnappedPanel,
                    )}
                  >
                    {fullscreenSnappedExitSuppression.top ? null : (
                      <AnimatePresence initial={false}>
                        {topSnappedPanel
                          ? renderPanel(topSnappedPanel, "flow")
                          : null}
                      </AnimatePresence>
                    )}
                  </motion.div>

                  <div style={editorAreaStyle}>
                    {React.cloneElement(
                      children as React.ReactElement<{
                        onToggleProblems?: () => void;
                        onPerspectiveOpen?: () => void;
                        onPerspectiveClose?: () => void;
                      }>,
                      {
                        onToggleProblems: () => togglePanel("problems"),
                        onPerspectiveOpen: handlePerspectiveOpen,
                        onPerspectiveClose: handlePerspectiveClose,
                      },
                    )}
                  </div>

                  <motion.div
                    layout={workspaceLayoutMotionEnabled}
                    transition={panelLayoutTransition}
                    style={getHorizontalSlotStyle(
                      effectiveBottomSlotHeight,
                      !!bottomSnappedPanel,
                    )}
                  >
                    {fullscreenSnappedExitSuppression.bottom ? null : (
                      <AnimatePresence initial={false}>
                        {bottomSnappedPanel
                          ? renderPanel(bottomSnappedPanel, "flow")
                          : null}
                      </AnimatePresence>
                    )}
                  </motion.div>
                </motion.div>

                <motion.div
                  layout={workspaceLayoutMotionEnabled}
                  transition={panelLayoutTransition}
                  style={getVerticalSlotStyle(
                    effectiveRightSlotWidth,
                    !!rightSnappedPanel,
                  )}
                >
                  {fullscreenSnappedExitSuppression.right ? null : (
                    <AnimatePresence initial={false}>
                      {rightSnappedPanel
                        ? renderPanel(rightSnappedPanel, "flow")
                        : null}
                    </AnimatePresence>
                  )}
                </motion.div>

                <AnimatePresence key={floatingPresenceVersion} initial={false}>
                  {floatingPanelIds.map((panelId) => renderPanel(panelId))}
                </AnimatePresence>
              </motion.div>
            </LayoutGroup>

            <PreviewWindowLayer
              isDark={isDark}
              windows={previewWindows}
              appearancePreview={appearancePreview}
              currentTheme={currentTheme}
              currentUiScale={uiScale}
              onUpdateWindow={updatePreviewWindow}
              onCloseWindow={closePreviewWindow}
              onFocusWindow={focusPreviewWindow}
              onAppearancePatch={handleAppearancePreviewPatchEvent}
              onAppearanceApply={handleAppearancePreviewApplyEvent}
              onAppearanceCancel={handleAppearancePreviewCancelEvent}
              onFileOpen={handleFileOpen}
            />
          </div>

          <div style={bottomChromeStyle}>
            <StatusBar onToggleProblems={() => togglePanel("problems")} />
          </div>
        </div>

        <div style={tuiOverlayStyle} data-testid="tui-overlay">
          {tuiModeActive && renderPanel("terminal")}
        </div>

        {!tuiModeActive && !isDispatcherPaused && (
          <CommandDispatcher
            isOpen={dispatcher.isOpen}
            onClose={dispatcher.close}
            onExecute={async (input) => {
              const result = await dispatcher.execute(input);
              if (result) {
                if (!result.success && result.error) {
                  showNotification("error", `[Dispatcher] ${result.error}`);
                } else if (result.output) {
                  showNotification("success", `[Dispatcher] ${result.output}`);
                }
              }
              if (result?.shouldClose) {
                dispatcher.close();
              }
            }}
            onOpenFile={(path, line) => openFileFromPath(path, line)}
            onTerminalCommand={(command) => {
              void submitTerminalCommand(command);
            }}
            pinnedItems={dispatcher.pinnedItems}
            recentItems={dispatcher.recentItems}
            projectPath={activeProjectPath}
          />
        )}

        <LaravelPlugin
          closeDispatcher={dispatcher.close}
          onSuccess={handlePluginCommandSuccess}
          onError={handlePluginCommandError}
        />

        <SettingsModal isOpen={isSettingsOpen} onClose={closeSettings} />
        <DependencyPolicyModal
          isOpen={isDependencyPolicyOpen}
          onClose={closeDependencyPolicy}
          onNotify={showNotification}
        />
        <ExecutionDialog
          isOpen={executionDialogMode !== null}
          mode={executionDialogMode}
          profiles={[
            ...executionProfiles.runProfiles,
            ...executionProfiles.debugProfiles,
          ]}
          activeFileName={activeEditorTab?.name}
          onClose={closeExecutionDialog}
          onExecuteProfile={async (profile) => {
            const executed = await executeExecutionProfile(profile);
            if (executed) {
              closeExecutionDialog();
            }
          }}
          onExecuteCustomCommand={(command, mode) => {
            void executeCustomCommand(command, mode);
          }}
        />

        {createEntryDialog ? (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 shadow-2xl">
              <div className="text-lg font-semibold text-[var(--text-primary)]">
                {createEntryDialog.type === "file" ? "New File" : "New Folder"}
              </div>
              <div className="mt-2 text-[12px] text-[var(--text-secondary)]">
                Create inside {getRelativePath(createEntryDialog.directoryPath)}
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-[12px] font-medium text-[var(--text-secondary)]">
                  Name
                </label>
                <input
                  autoFocus
                  type="text"
                  value={createEntryName}
                  onChange={(event) => setCreateEntryName(event.target.value)}
                  placeholder={
                    createEntryDialog.type === "file"
                      ? "notes.txt"
                      : "new-folder"
                  }
                  className="w-full rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2.5 text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                />
                <div className="mt-2 break-all text-[11px] text-[var(--text-muted)]">
                  {joinProjectEntryPath(
                    createEntryDialog.directoryPath,
                    createEntryName.trim() || "...",
                  )}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeCreateEntryDialog}
                  disabled={createEntryBusy}
                  className="rounded-[12px] border border-[var(--border-subtle)] px-4 py-2 text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateEntrySubmit()}
                  disabled={!createEntryName.trim() || createEntryBusy}
                  className="rounded-[12px] bg-white px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createEntryBusy
                    ? "Creating..."
                    : createEntryDialog.type === "file"
                      ? "Create File"
                      : "Create Folder"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {renameEntryDialog ? (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 shadow-2xl">
              <div className="text-lg font-semibold text-[var(--text-primary)]">
                Rename {renameEntryDialog.isDirectory ? "Folder" : "File"}
              </div>
              <div className="mt-2 break-all text-[12px] text-[var(--text-secondary)]">
                {getRelativePath(renameEntryDialog.path)}
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-[12px] font-medium text-[var(--text-secondary)]">
                  New name
                </label>
                <input
                  autoFocus
                  type="text"
                  value={renameEntryName}
                  onChange={(event) => setRenameEntryName(event.target.value)}
                  className="w-full rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2.5 text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeRenameEntryDialog}
                  disabled={renameEntryBusy}
                  className="rounded-[12px] border border-[var(--border-subtle)] px-4 py-2 text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleRenameEntrySubmit()}
                  disabled={!renameEntryName.trim() || renameEntryBusy}
                  className="rounded-[12px] bg-white px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {renameEntryBusy ? "Renaming..." : "Rename"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {trashEntryDialog ? (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 shadow-2xl">
              <div className="text-lg font-semibold text-[var(--text-primary)]">
                Move to Trash
              </div>
              <div className="mt-3 text-[13px] text-[var(--text-secondary)]">
                Move{" "}
                <span className="font-medium text-[var(--text-primary)]">
                  {trashEntryDialog.displayName ||
                    getProjectPathBasename(trashEntryDialog.path)}
                </span>{" "}
                to Trash?
              </div>
              <div className="mt-2 text-[12px] text-[var(--text-muted)]">
                Unsaved changes in open editors may be lost.
              </div>
              <div className="mt-3 break-all text-[11px] text-[var(--text-muted)]">
                {getRelativePath(trashEntryDialog.path)}
              </div>

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeTrashEntryDialog}
                  disabled={trashEntryBusy}
                  className="rounded-[12px] border border-[var(--border-subtle)] px-4 py-2 text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleTrashEntrySubmit()}
                  disabled={trashEntryBusy}
                  className="rounded-[12px] bg-red-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {trashEntryBusy ? "Moving..." : "Move to Trash"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {notification && (
          <div style={notificationStyle}>
            <div
              style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}
            >
              <span style={{ flexShrink: 0 }}>
                {notification.type === "success" ? "✓" : "✕"}
              </span>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {notification.message}
              </div>
            </div>
            <button
              onClick={() => setNotification(null)}
              style={closeNotificationStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#FFFFFF";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "rgba(255,255,255,0.7)";
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </ProjectEntryActionsProvider>
  );
};
