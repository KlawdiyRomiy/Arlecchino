import React, { useState, useEffect, useCallback, useRef } from "react";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { useTheme } from "../../hooks/useTheme";
import { FileExplorer } from "../FileExplorer";
import { TerminalPanelContent } from "../TerminalPanel";
import { AIChatPanelContent } from "../AIChatPanel";
import { GitPanel } from "../GitPanel";
import { PreviewWindowLayer } from "./PreviewWindowLayer";
import { ExecutionDialog } from "../ExecutionDialog";
import { LaravelPlugin } from "../../plugins/LaravelPlugin";
import { SettingsModal } from "../SettingsModal";
import { SnippetsManager } from "../SnippetsManager";
import { CommandDispatcher } from "../CommandDispatcher";
import { useDispatcher } from "../../hooks/useDispatcher";
import { useEditorStore } from "../../stores/editorStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { FloatingPanel, PanelPosition, PanelSize } from "../ui/FloatingPanel";
import { FolderTree, Terminal, Sparkles, GitBranch, Globe } from "lucide-react";

import {
  colors,
  getThemeColors,
  radius,
  shadows,
  transitions,
  zIndex,
} from "../../styles/colors";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import { useExplorerStore } from "../../stores/explorerStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePluginModal } from "../../contexts/PluginModalContext";
import {
  usePreviewWindowStore,
  type OpenPreviewWindowInput,
  type PreviewSurfaceType,
  type PreviewWindowPayload,
  type UpdatePreviewWindowInput,
} from "../../stores/previewWindowStore";
import type { Theme } from "../../types/theme";
import { shortcuts, isShortcut } from "../../utils/keyboard";
import { calculatePanelMargins } from "../../utils/layoutHelpers";
import { emitPerfMetric, measurePerf, nowPerf } from "../../utils/perf";
import {
  isTerminalFocusedElement,
  isTerminalShortcutContext as hasTerminalShortcutContext,
  shouldBypassGlobalFindShortcuts,
} from "../../utils/terminalFocus";
import { isProjectSwitchBlocked } from "../../utils/priorityUI";
import {
  getTUIFloatingTerminalConfig,
  getTUIPanelVisibility,
} from "../../utils/terminalLayout";
import { ReadFile, WriteTerminal } from "../../../wailsjs/go/main/App";
import {
  type ExecutionProfile,
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

type PanelId = "explorer" | "terminal" | "aiChat" | "git";
type AssistPanelId = Exclude<PanelId, "terminal">;
type PanelVisibility = Record<PanelId, boolean>;

type PanelConfigs = Record<PanelId, PanelConfig>;

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

const toPreviewSurface = (value: unknown): PreviewSurfaceType | null => {
  if (typeof value !== "string") {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "file":
    case "code":
    case "editor":
      return "file";
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
  if (typeof value === "string") {
    const surface = toPreviewSurface(value);
    if (surface) {
      return { surface };
    }

    return {
      surface: "file",
      title: value.split("/").pop() || "file preview",
      payload: { path: value },
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const directPayload = toPreviewWindowPayload(value);
  const nestedPayload = toPreviewWindowPayload(value.payload);
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
    toPreviewSurface(value.surface) ||
    toPreviewSurface(value.kind) ||
    toPreviewSurface(value.type) ||
    (payload.url ? "browser" : null) ||
    (payload.path ? "file" : null);

  if (!surfaceCandidate) {
    return null;
  }

  const modeCandidate = getStringFromRecord(value, "mode");
  const positionCandidate = getStringFromRecord(value, "position");
  const sideCandidate = getStringFromRecord(value, "side");

  const mode =
    modeCandidate === "floating" || modeCandidate === "snapped"
      ? modeCandidate
      : undefined;
  const position =
    positionCandidate === "left" ||
    positionCandidate === "right" ||
    positionCandidate === "top" ||
    positionCandidate === "bottom"
      ? positionCandidate
      : undefined;
  const side =
    sideCandidate === "left" || sideCandidate === "right"
      ? sideCandidate
      : undefined;

  return {
    id: getStringFromRecord(value, "id"),
    surface: surfaceCandidate,
    title: getStringFromRecord(value, "title"),
    payload,
    mode,
    position,
    side,
    width: getNumberFromRecord(value, "width"),
    height: getNumberFromRecord(value, "height"),
    x: getNumberFromRecord(value, "x"),
    y: getNumberFromRecord(value, "y"),
    pinned: getBooleanFromRecord(value, "pinned"),
  };
};

const parseWindowIdFromPayload = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (!isRecord(value)) {
    return null;
  }

  return (
    getStringFromRecord(value, "id") ||
    getStringFromRecord(value, "windowId") ||
    getStringFromRecord(value, "checkpointId") ||
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
  if (!isRecord(value)) {
    return null;
  }

  const id = parseWindowIdFromPayload(value);
  if (!id) {
    return null;
  }

  const payload = toPreviewWindowPayload(value.payload);
  const modeCandidate = getStringFromRecord(value, "mode");
  const positionCandidate = getStringFromRecord(value, "position");
  const focusRequested =
    getBooleanFromRecord(value, "focus") ??
    getBooleanFromRecord(value, "activate") ??
    false;
  const input: UpdatePreviewWindowInput = {
    title: getStringFromRecord(value, "title"),
    payload: Object.keys(payload).length > 0 ? payload : undefined,
    mode:
      modeCandidate === "floating" || modeCandidate === "snapped"
        ? modeCandidate
        : undefined,
    position:
      positionCandidate === "left" ||
      positionCandidate === "right" ||
      positionCandidate === "top" ||
      positionCandidate === "bottom"
        ? positionCandidate
        : undefined,
    width: getNumberFromRecord(value, "width"),
    height: getNumberFromRecord(value, "height"),
    x: getNumberFromRecord(value, "x"),
    y: getNumberFromRecord(value, "y"),
    pinned: getBooleanFromRecord(value, "pinned"),
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
};

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
  const theme = getThemeColors(isDark);
  const [isPerspectiveOpen, setIsPerspectiveOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [executionDialogMode, setExecutionDialogMode] = useState<
    "run" | "debug" | null
  >(null);
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
  const setUiScale = useEditorSettingsStore((state) => state.setUiScale);
  const activeProjectId = useWorkspaceStore((s) => s.activeId);
  const workspaceProjectPath = useWorkspaceStore((state) => {
    const activeProject = state.projects.find(
      (project) => project.id === state.activeId,
    );
    return activeProject?.path ?? "";
  });
  const explorerProjectPath = useExplorerStore((state) => state.projectPath);
  const activeProjectPath = explorerProjectPath || workspaceProjectPath;
  const activeEditorTab = useEditorStore((state) =>
    state.getActiveTab(state.activePaneId),
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
  const setPreviewWindowPinned = usePreviewWindowStore(
    (state) => state.setPinned,
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
  const executionProfiles = resolveExecutionProfiles({
    projectPath: activeProjectPath,
    activeTab: activeEditorTab,
  });
  const dispatcher = useDispatcher();
  const { activeModal, closeModal } = usePluginModal();

  // Apply UI scale to CSS variable for font sizing
  useEffect(() => {
    const baseFontSize = 14;
    const scaledFontSize = Math.round(baseFontSize * uiScale);
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
    document.documentElement.style.setProperty(
      "--ui-font-size",
      `${scaledFontSize}px`,
    );
  }, [uiScale]);

  const panelStorageKey = activeProjectId
    ? `panelState:${activeProjectId}`
    : null;

  const [panels, setPanels] = useState<PanelVisibility>(() => {
    if (!panelStorageKey) return { ...DEFAULT_PANELS };
    try {
      const raw = localStorage.getItem(panelStorageKey);
      if (!raw) return { ...DEFAULT_PANELS };
      const { panels: saved } = JSON.parse(raw);
      if (!saved) return { ...DEFAULT_PANELS };
      const { browser: _, ...rest } = saved;
      return rest as PanelVisibility;
    } catch {
      return { ...DEFAULT_PANELS };
    }
  });

  const [panelConfigs, setPanelConfigs] = useState<PanelConfigs>(() => {
    if (!panelStorageKey) return structuredClone(DEFAULT_PANEL_CONFIGS);
    try {
      const raw = localStorage.getItem(panelStorageKey);
      if (!raw) return structuredClone(DEFAULT_PANEL_CONFIGS);
      const { panelConfigs: saved } = JSON.parse(raw);
      if (!saved) return structuredClone(DEFAULT_PANEL_CONFIGS);
      const { browser: _, ...rest } = saved;
      return rest as PanelConfigs;
    } catch {
      return structuredClone(DEFAULT_PANEL_CONFIGS);
    }
  });
  const [tuiLayoutSnapshot, setTuiLayoutSnapshot] = useState<{
    panels: PanelVisibility;
    panelConfigs: PanelConfigs;
  } | null>(null);
  const wasTUIActiveRef = React.useRef(false);
  const forceHideTerminalAfterTUIExitRef = React.useRef(false);
  const panelsRef = React.useRef(panels);
  const panelConfigsRef = React.useRef(panelConfigs);
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

  const clonePanelConfigs = useCallback(
    (source: PanelConfigs): PanelConfigs => {
      return {
        explorer: { ...source.explorer, size: { ...source.explorer.size } },
        terminal: { ...source.terminal, size: { ...source.terminal.size } },
        aiChat: { ...source.aiChat, size: { ...source.aiChat.size } },
        git: { ...source.git, size: { ...source.git.size } },
      };
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
    try {
      if (tuiModeActive || !panelStorageKey) return;
      localStorage.setItem(
        panelStorageKey,
        JSON.stringify({ panels, panelConfigs }),
      );
    } catch {
      /* quota */
    }
  }, [panels, panelConfigs, tuiModeActive, panelStorageKey]);

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
      });

      const floatingTerminalConfig = getTUIFloatingTerminalConfig({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      setPanelConfigs((prev) => ({
        ...prev,
        terminal: {
          ...prev.terminal,
          ...floatingTerminalConfig,
        },
      }));

      setPanels((prev) => {
        const nextPanels = getTUIPanelVisibility({ ...prev, browser: false });
        const { browser: _browser, ...rest } = nextPanels;
        return rest;
      });

      setTUIAssist({ active: false, panel: null, swapped: false });
    } else {
      const shouldHideTerminalPanel = forceHideTerminalAfterTUIExitRef.current;
      setTUIAssist({ active: false, panel: null, swapped: false });

      if (tuiLayoutSnapshot) {
        setPanels(
          shouldHideTerminalPanel
            ? { ...tuiLayoutSnapshot.panels, terminal: false }
            : tuiLayoutSnapshot.panels,
        );
        setPanelConfigs(tuiLayoutSnapshot.panelConfigs);
        setTuiLayoutSnapshot(null);
      } else if (shouldHideTerminalPanel) {
        setPanels((prev) => ({ ...prev, terminal: false }));
      }

      forceHideTerminalAfterTUIExitRef.current = false;
    }

    wasTUIActiveRef.current = tuiModeActive;
  }, [
    clonePanelConfigs,
    panelConfigs,
    panels,
    setTUIAssist,
    tuiLayoutSnapshot,
    tuiModeActive,
  ]);

  const terminalPreFullscreenRef = React.useRef<{
    mode: string;
    x: number;
    y: number;
    size: { width: number; height: number };
  } | null>(null);

  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);
  const [dropTargetPosition, setDropTargetPosition] =
    useState<PanelPosition | null>(null);

  const [showSnippetsManager, setShowSnippetsManager] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const showNotification = useCallback(
    (type: "success" | "error", message: string) => {
      setNotification({ type, message });
      const timeout = type === "error" ? 6000 : 3000;
      setTimeout(() => setNotification(null), timeout);
    },
    [],
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
    async (command: string, terminalName = "Terminal") => {
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

      const bytes = new TextEncoder().encode(command + "\n");
      const binary = Array.from(bytes, (byte) =>
        String.fromCharCode(byte),
      ).join("");

      try {
        await WriteTerminal(targetSessionId, btoa(binary));
        setPanels((previous) => ({ ...previous, terminal: true }));
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
    [isDark, showNotification],
  );

  const executeExecutionProfile = useCallback(
    async (profile: ExecutionProfile) => {
      if (profile.kind === "preview") {
        openCanonicalBrowserPreviewRef.current();
        return true;
      }

      return submitTerminalCommand(
        profile.command,
        profile.mode === "debug" ? "Debug" : "Run",
      );
    },
    [submitTerminalCommand],
  );

  const openRunDialog = useCallback(() => {
    const primaryProfile = executionProfiles.runProfiles[0];
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

  const resolveAssistPanelId = useCallback(
    (panel: string): AssistPanelId | null => {
      switch (panel) {
        case "explorer":
        case "sidebar":
        case "search":
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

  const openTUIAssistPanel = useCallback(
    (panel: string) => {
      const assistPanel = resolveAssistPanelId(panel);
      if (!assistPanel) {
        return;
      }

      const state = useTerminalStore.getState();
      if (!state.tuiModeActive) {
        return;
      }

      state.setTUIAssist({ active: true, panel: assistPanel });
      setTimeout(() => state.focusActiveTerminal(), 80);
    },
    [resolveAssistPanelId],
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
    });

    if (!isSamePanel) {
      setTimeout(() => state.focusActiveTerminal(), 80);
    }
  }, []);

  const closeTUIAssistPanel = useCallback(() => {
    const state = useTerminalStore.getState();
    state.setTUIAssist({ active: false, panel: null });
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

    state.setTUIAssist({ active: true, ratio });
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

      // Toggle Sidebar: Cmd+B
      if (shortcuts.toggleSidebar(e) && !e.shiftKey) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();

        const leftPanel = (Object.keys(configs) as PanelId[]).find(
          (id) => configs[id].position === "left",
        );
        if (leftPanel) {
          setPanels((p) => ({ ...p, [leftPanel]: !p[leftPanel] }));
        }
        return;
      }

      // Switch Project: Cmd+` (next) / Cmd+Shift+` (prev)
      if (shortcuts.switchProjectNext(e) || shortcuts.switchProjectPrev(e)) {
        const localProjectSwitchBlocked =
          dispatcher.isOpen ||
          showSnippetsManager ||
          activeModal !== null ||
          isPerspectiveOpen;

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

        const bottomPanel = (Object.keys(configs) as PanelId[]).find(
          (id) => configs[id].position === "bottom",
        );
        if (bottomPanel) {
          setPanels((p) => {
            const willBeOpen = !p[bottomPanel];
            if (willBeOpen) {
              setTimeout(() => terminalState.focusActiveTerminal(), 100);
            }
            return { ...p, [bottomPanel]: willBeOpen };
          });
        }
        return;
      }

      // Toggle AI: Cmd+Shift+I
      if (shortcuts.toggleAI(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();

        const rightPanel = (Object.keys(configs) as PanelId[]).find(
          (id) => configs[id].position === "right",
        );
        if (rightPanel) {
          setPanels((p) => ({ ...p, [rightPanel]: !p[rightPanel] }));
        }
        return;
      }

      // Toggle Git: Cmd+Shift+G
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "g") {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        setPanels((p) => ({ ...p, git: !p.git }));
        return;
      }

      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "b") {
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
    closePreviewWindow,
    closeModal,
    closeTUIAssistPanel,
    dispatcher,
    getActiveTerminalSessionId,
    isDark,
    toggleCommandDispatcher,
    toggleTUIAssistPanel,
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

  const togglePanel = (panel: keyof PanelVisibility) => {
    setPanels((p) => ({ ...p, [panel]: !p[panel] }));
  };

  const togglePanelAtPosition = (position: PanelPosition) => {
    const panelAtPosition = (Object.keys(panelConfigs) as PanelId[]).find(
      (id) => panelConfigs[id].position === position,
    );
    if (panelAtPosition) {
      togglePanel(panelAtPosition);
    }
  };

  // Handle IDE events from Go backend (via dispatcher)
  useIDEEvents({
    onOpenPanel: useCallback(
      (panel: string) => {
        if (panel === "browser" || panel === "web") {
          openCanonicalBrowserPreviewRef.current();
          return;
        }

        if (panel === "search") {
          openCommandDispatcher();
          return;
        }

        const panelMap: Record<string, PanelId> = {
          git: "git",
          ai: "aiChat",
          terminal: "terminal",
          explorer: "explorer",
        };
        const panelId = panelMap[panel];
        if (!panelId) {
          return;
        }

        const state = useTerminalStore.getState();
        if (state.tuiModeActive) {
          if (panelId === "terminal") {
            state.setTUIAssist({ active: false, panel: null });
            setTimeout(() => state.focusActiveTerminal(), 80);
            return;
          }

          openTUIAssistPanel(panelId);
          return;
        }

        setPanels((p) => ({ ...p, [panelId]: true }));
      },
      [openCommandDispatcher, openTUIAssistPanel],
    ),
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
          case "sidebar":
            togglePanelAtPosition("left");
            break;
          case "terminal":
            togglePanelAtPosition("bottom");
            break;
          case "ai":
            togglePanelAtPosition("right");
            break;
        }
      },
      [closeTUIAssistPanel, togglePanelAtPosition, toggleTUIAssistPanel],
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
      const activeSessionId = getActiveTerminalSessionId();
      if (activeSessionId) {
        enterTUIMode(activeSessionId, "ide-event");
      }
    }, [enterTUIMode, getActiveTerminalSessionId]),
    onTUIExit: useCallback(() => {
      const activeSessionId = getActiveTerminalSessionId();
      if (activeSessionId) {
        exitTUIMode(activeSessionId, "ide-event");
      }
    }, [exitTUIMode, getActiveTerminalSessionId]),
    onTUIAssistOpenPanel: useCallback(
      (panel: string) => {
        openTUIAssistPanel(panel);
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

      state.setTUIAssist({ active: true, swapped: !state.tuiAssist.swapped });
    }, []),
    onTUIAssistRatio: useCallback(
      (ratio: number) => {
        setTUIAssistRatio(ratio);
      },
      [setTUIAssistRatio],
    ),
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
    onGitStatus: useCallback(() => {
      setPanels((p) => ({ ...p, git: true }));
    }, []),
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

  const handleDragStart = (panelId: string) => {
    setDraggingPanel(panelId as PanelId);
  };

  const getSizeForPosition = (
    position: PanelPosition,
    currentSize: PanelSize,
  ): PanelSize => {
    if (position === "bottom" || position === "top") {
      // For top/bottom, use a reasonable height (not the width from left/right)
      // Default to 200px, or use existing height if already set
      const height = currentSize.height > 0 ? currentSize.height : 200;
      return {
        width: 0,
        height: Math.min(height, 400), // Cap at 400px max
      };
    } else {
      // For left/right, use width
      const width = currentSize.width > 0 ? currentSize.width : 260;
      return {
        width: Math.min(width, 500), // Cap at 500px max
        height: 0,
      };
    }
  };

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

          setPanelConfigs((prev) => ({
            ...prev,
            // Move current panel to target position
            [currentPanel]: {
              ...prev[currentPanel],
              mode: "snapped",
              position: targetPosition,
              size: getSizeForPosition(targetPosition, currentPanelSize),
            },
            // Move target panel to current panel's old position
            [panelAtTarget]: {
              ...prev[panelAtTarget],
              mode: "snapped",
              position: currentPosition,
              size: getSizeForPosition(currentPosition, targetPanelSize),
            },
          }));
        } else {
          // No panel at target - just move there
          setPanelConfigs((prev) => ({
            ...prev,
            [currentPanel]: {
              ...prev[currentPanel],
              mode: "snapped",
              position: targetPosition,
              size: getSizeForPosition(targetPosition, currentPanelSize),
            },
          }));
        }
      } else if (dropX !== undefined && dropY !== undefined) {
        // Dropped in free space -> Floating
        const currentSize = panelConfigs[currentPanel].size;
        const width = currentSize.width || 300;
        const height = currentSize.height || 400;

        setPanelConfigs((prev) => ({
          ...prev,
          [currentPanel]: {
            ...prev[currentPanel],
            mode: "floating",
            x: dropX,
            y: dropY,
            size: { width, height },
          },
        }));
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
        (id) => panelConfigs[id].position === position && panels[id],
      ) || null
    );
  };

  const margins = calculatePanelMargins(panels, panelConfigs);

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
    backgroundColor: isDark ? "var(--bg-blackprint)" : colors.light.bg,
    color: isDark ? "var(--text-primary)" : colors.light.text,
  };

  const mainAreaStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    position: "relative",
    overflow: "clip",
    minHeight: 0,
    backgroundColor: isDark ? "var(--bg-secondary)" : colors.light.bg,
  };

  const editorAreaStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    marginLeft: margins.marginLeft,
    marginRight: margins.marginRight,
    marginBottom: margins.marginBottom,
    marginTop: margins.marginTop,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "var(--bg-secondary)",
    transition: "margin 0.18s cubic-bezier(0.25, 0.8, 0.25, 1)",
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

  const renderPanel = (panelId: PanelId) => {
    const isVisible = panels[panelId];
    const config = panelConfigs[panelId];
    const isDropTarget =
      draggingPanel !== null &&
      draggingPanel !== panelId &&
      dropTargetPosition === config.position;

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
              adjacent.left = otherConfig.size.width;
            if (otherConfig.position === "right")
              adjacent.right = otherConfig.size.width;
            if (otherConfig.position === "bottom")
              adjacent.bottom = otherConfig.size.height;
            if (otherConfig.position === "top")
              adjacent.top = otherConfig.size.height;
          }
        }
      });

      return adjacent;
    };

    const panelProps = {
      position: config.position,
      size: config.size,
      mode: config.mode,
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
      onClose: () => togglePanel(panelId),
      isDropTarget,
      adjacentPanels: getAdjacentPanels(),
    };

    const handleTerminalPanelClose = () => {
      const terminalState = useTerminalStore.getState();

      if (!terminalState.tuiModeActive) {
        togglePanel("terminal");
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
    };

    switch (panelId) {
      case "explorer":
        return (
          <FloatingPanel
            key="explorer"
            id="explorer"
            title="Explorer"
            icon={<FolderTree size={16} />}
            minSize={200}
            maxSize={500}
            {...panelProps}
          >
            <FileExplorer
              onFileOpen={handleFileOpen}
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
            key="terminal"
            id="terminal"
            title="Terminal"
            icon={<Terminal size={16} />}
            minSize={150}
            maxSize={800}
            {...panelProps}
            onClose={handleTerminalPanelClose}
            useViewportPositioning={tuiModeActive}
            zIndex={tuiModeActive ? zIndex.tooltip + 10 : undefined}
            onFullscreen={() => {
              const cur = panelConfigs.terminal;
              const isFullscreen =
                cur.mode === "floating" &&
                cur.x === 0 &&
                cur.y === 0 &&
                cur.size.width >= window.innerWidth - 1 &&
                cur.size.height >= window.innerHeight - 1;

              if (isFullscreen && terminalPreFullscreenRef.current) {
                const saved = terminalPreFullscreenRef.current;
                terminalPreFullscreenRef.current = null;
                setPanelConfigs((prev) => ({
                  ...prev,
                  terminal: {
                    ...prev.terminal,
                    mode: saved.mode as typeof prev.terminal.mode,
                    x: saved.x,
                    y: saved.y,
                    size: saved.size,
                  },
                }));
              } else {
                terminalPreFullscreenRef.current = {
                  mode: cur.mode,
                  x: cur.x,
                  y: cur.y,
                  size: { ...cur.size },
                };
                setPanelConfigs((prev) => ({
                  ...prev,
                  terminal: {
                    ...prev.terminal,
                    mode: "floating",
                    x: 0,
                    y: 0,
                    size: {
                      width: window.innerWidth,
                      height: window.innerHeight,
                    },
                  },
                }));
              }
            }}
          >
            <TerminalPanelContent
              onOpenFileRef={(path, line) => {
                void openFileFromPath(path, line);
              }}
              onOpenPreviewUrl={(url, sessionId) => {
                openPreviewFromTerminal({ url, sessionId, forceOpen: true });
              }}
            />
          </FloatingPanel>
        );
      case "aiChat":
        return (
          <FloatingPanel
            key="aiChat"
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
            key="git"
            id="git"
            title="Git"
            icon={<GitBranch size={16} />}
            minSize={200}
            maxSize={400}
            {...panelProps}
          >
            <GitPanel
              projectPath={activeProjectPath}
              onFileOpen={(path) =>
                handleFileOpen(path, "", path.split("/").pop() || "")
              }
            />
          </FloatingPanel>
        );
      default:
        return null;
    }
  };

  const assistPanelActive =
    tuiModeActive && tuiAssist.active && !!tuiAssist.panel;
  const clampedAssistRatio = Math.max(0.2, Math.min(0.8, tuiAssist.ratio));
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
            onFileOpen={handleFileOpen}
            isHorizontal={false}
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
            onFileOpen={(path) =>
              handleFileOpen(path, "", path.split("/").pop() || "")
            }
          />
        );
      default:
        return null;
    }
  };

  const topChromeStyle: React.CSSProperties = {
    maxHeight: 72,
    opacity: 1,
    overflow: "hidden",
    pointerEvents: "auto",
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
    flexDirection: "column",
    minHeight: 0,
    opacity: 1,
    pointerEvents: "auto",
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
    flexDirection: assistPanelActive
      ? tuiAssist.swapped
        ? "row-reverse"
        : "row"
      : "row",
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
      assistPanelActive && !tuiAssist.swapped
        ? isDark
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid rgba(0,0,0,0.12)"
        : "none",
    borderRight:
      assistPanelActive && tuiAssist.swapped
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

  return (
    <div
      style={containerStyle}
      data-testid="main-layout"
      data-tui-session-id={tuiActiveSessionId || ""}
    >
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
            togglePanelAtPosition("left");
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
            togglePanelAtPosition("bottom");
          }}
          onToggleAIChat={() => {
            if (tuiModeActive) {
              toggleTUIAssistPanel("aiChat");
              return;
            }
            togglePanelAtPosition("right");
          }}
          onToggleGit={() => {
            if (tuiModeActive) {
              toggleTUIAssistPanel("git");
              return;
            }
            setPanels((previous) => ({ ...previous, git: !previous.git }));
          }}
          onRun={openRunDialog}
          onOpenDebug={openDebugDialog}
          onOpenPreview={openCanonicalBrowserPreview}
          onBackToWelcome={onBackToWelcome}
          onProjectOpen={onProjectOpen}
          onSwitchProject={onSwitchProject}
          onCloseProject={onCloseProject}
          panels={{
            explorer: tuiModeActive
              ? tuiAssist.active && tuiAssist.panel === "explorer"
              : isPanelVisibleAtPosition("left"),
            terminal: tuiModeActive ? true : isPanelVisibleAtPosition("bottom"),
            aiChat: tuiModeActive
              ? tuiAssist.active && tuiAssist.panel === "aiChat"
              : isPanelVisibleAtPosition("right"),
            git: isPanelVisibleAtPosition("left") && panels.git,
          }}
          projectPath={activeProjectPath}
          previewEnabled={previewButtonState.enabled}
          previewActive={previewButtonState.active}
          previewTitle={previewButtonState.buttonTitle}
        />
      </div>

      <div style={mainAreaStyle}>
        <div style={normalWorkspaceStyle}>
          {draggingPanel && (
            <>
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
              <div
                style={dropZoneStyle("bottom")}
                onMouseEnter={() => setDropTargetPosition("bottom")}
                onMouseLeave={() => setDropTargetPosition(null)}
              />
              <div
                style={dropZoneStyle("top")}
                onMouseEnter={() => setDropTargetPosition("top")}
                onMouseLeave={() => setDropTargetPosition(null)}
              />
            </>
          )}

          {renderPanel("explorer")}
          {renderPanel("git")}
          {renderPanel("aiChat")}
          {!tuiModeActive && renderPanel("terminal")}

          <div style={editorAreaStyle}>
            {React.cloneElement(
              children as React.ReactElement<{
                onPerspectiveOpen?: () => void;
                onPerspectiveClose?: () => void;
              }>,
              {
                onPerspectiveOpen: handlePerspectiveOpen,
                onPerspectiveClose: handlePerspectiveClose,
              },
            )}
          </div>
        </div>

        <PreviewWindowLayer
          isDark={isDark}
          windows={previewWindows}
          appearancePreview={appearancePreview}
          currentTheme={currentTheme}
          currentUiScale={uiScale}
          onUpdateWindow={updatePreviewWindow}
          onCloseWindow={closePreviewWindow}
          onFocusWindow={focusPreviewWindow}
          onPinWindow={setPreviewWindowPinned}
          onAppearancePatch={handleAppearancePreviewPatchEvent}
          onAppearanceApply={handleAppearancePreviewApplyEvent}
          onAppearanceCancel={handleAppearancePreviewCancelEvent}
          onFileOpen={handleFileOpen}
        />
      </div>

      <div style={bottomChromeStyle}>
        <StatusBar />
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

      <SnippetsManager
        isOpen={showSnippetsManager}
        onClose={() => setShowSnippetsManager(false)}
        onSave={(snippet) => {
          console.log("Snippet saved:", snippet);
          showNotification("success", `Snippet "${snippet.name}" saved`);
        }}
      />

      <SettingsModal isOpen={isSettingsOpen} onClose={closeSettings} />
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
  );
};
