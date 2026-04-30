import { create } from "zustand";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { recordTerminalPerf } from "../utils/terminalPerf";
import { usePerformanceStore } from "./performanceStore";
import { normalizeTUIAssistAnchor } from "../utils/terminalLayout";
import {
  CreateTerminal,
  WriteTerminal,
  ResizeTerminal,
  CloseTerminal,
} from "../wails/app";
import { EventsOn } from "../wails/runtime";
import {
  getThemeTerminalById,
  isThemeId,
  resolveThemePreference,
  type ThemeId,
} from "../styles/themes";
import type {
  ClosedTerminalTab,
  SplitDirection,
  TerminalAccessDecision,
  TerminalMode,
  TerminalPane,
  TerminalPowerProfile,
  TerminalSecurityPolicy,
  TerminalSemanticEntry,
  TerminalSession,
  TerminalShellState,
  TUIAssistState,
} from "../types/terminal";

interface TerminalState {
  activeProjectPath: string | null;
  sessions: Map<string, TerminalSession>;
  panes: TerminalPane[];
  activePaneId: string;
  splitDirection: SplitDirection;
  isInitialized: boolean;
  eventsRegistered: boolean;
  tuiModeActive: boolean;
  tuiActiveSessionId: string | null;
  tuiAssist: TUIAssistState;
  powerProfile: TerminalPowerProfile;
  isDispatcherPaused: boolean;
  isArlePaused: boolean;
  isLSPPaused: boolean;
  terminalFontSize: number;
  closedTabsStack: ClosedTerminalTab[];
  securityPolicy: TerminalSecurityPolicy;
  sessionShellState: Map<string, TerminalShellState>;
  sessionSemanticEntries: Map<string, TerminalSemanticEntry[]>;
  projectLayouts: Map<string, TerminalProjectState>;
}

interface TerminalActions {
  setActiveProject: (projectPath: string | null) => void;
  initialize: () => void;
  createTerminal: (
    paneId: string,
    themeId: ThemeId,
    terminalName?: string,
  ) => Promise<string>;
  registerExternalSession: (id: string, name?: string) => void;
  closeTerminal: (paneId: string, tabId: string) => Promise<void>;
  setActiveTab: (paneId: string, tabId: string) => void;
  setActivePane: (paneId: string) => void;
  splitPane: (direction: SplitDirection, themeId: ThemeId) => void;
  getSession: (id: string) => TerminalSession | undefined;
  updateTheme: (themeId: ThemeId) => void;
  markAttached: (id: string, attached: boolean) => void;
  focusActiveTerminal: () => void;
  terminalZoomIn: () => void;
  terminalZoomOut: () => void;
  terminalZoomReset: () => void;
  reopenLastClosedTab: (themeId: ThemeId) => Promise<string | null>;
  setSessionMode: (event: {
    id: string;
    mode?: string;
    active?: boolean;
    reason?: string;
    confidence?: number;
    sourceSignals?: string[];
    timestamp?: number;
  }) => void;
  enterTUIMode: (id: string, reason?: string) => void;
  exitTUIMode: (id: string, reason?: string) => void;
  setTUIAssist: (assist: Partial<TUIAssistState>) => void;
  resetTUIAssist: () => void;
  setPowerProfile: (profile: TerminalPowerProfile) => void;
  setSecurityPolicy: (policy: Partial<TerminalSecurityPolicy>) => void;
  isSensitivePath: (filePath: string) => boolean;
  canAccessPath: (
    filePath: string,
    operation: "read" | "write",
  ) => TerminalAccessDecision;
  setShellEvent: (event: {
    id: string;
    type?: string;
    cwd?: string;
    exitCode?: number;
    raw?: string;
  }) => void;
  setSemanticEvent: (event: {
    id: string;
    kind?: string;
    path?: string;
    line?: number;
    column?: number;
    severity?: string;
    message?: string;
  }) => void;
  listRemoteSessions: () => Promise<string[]>;
  sendRemoteText: (id: string, text: string) => Promise<boolean>;
  resetForProjectSwitch: () => void;
}

let terminalCounter = 0;
const generateTerminalId = () => `term-${++terminalCounter}-${Date.now()}`;
const DEFAULT_TERMINAL_FONT_SIZE = 14;
const MIN_TERMINAL_FONT_SIZE = 8;
const MAX_TERMINAL_FONT_SIZE = 48;
const MAX_SEMANTIC_ENTRIES = 100;
const MAX_CLOSED_TERMINAL_TABS = 30;
const TERMINAL_LAYOUT_STORAGE_KEY = "terminal.layout.v1";
const SEMANTIC_BATCH_DELAY_MS = 16;
const SEMANTIC_DEDUPE_WINDOW_MS = 400;
const SEMANTIC_DEDUPE_MESSAGE_MAX = 256;
const DEFAULT_TUI_ASSIST: TUIAssistState = {
  active: false,
  panel: null,
  ratio: 0.4,
  anchor: "right",
};

const normalizeTUIAssistState = (
  assist: (Partial<TUIAssistState> & { swapped?: boolean }) | undefined,
): TUIAssistState => {
  const fallbackAnchor = assist?.swapped ? "left" : DEFAULT_TUI_ASSIST.anchor;

  return {
    active: assist?.active ?? DEFAULT_TUI_ASSIST.active,
    panel: assist?.panel ?? DEFAULT_TUI_ASSIST.panel,
    ratio:
      typeof assist?.ratio === "number"
        ? Math.max(0.2, Math.min(0.8, assist.ratio))
        : DEFAULT_TUI_ASSIST.ratio,
    anchor: normalizeTUIAssistAnchor(assist?.anchor, fallbackAnchor),
  };
};

interface PendingSemanticEntry {
  entry: TerminalSemanticEntry;
  dedupeKey: string;
}

const semanticPendingEntries = new Map<string, PendingSemanticEntry[]>();
const semanticFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const semanticRecentEntries = new Map<string, Map<string, number>>();

interface TerminalLayoutSnapshot {
  version: 1;
  paneIds: string[];
  activePaneId: string;
  splitDirection: SplitDirection;
}

interface TerminalProjectState {
  panes: TerminalPane[];
  activePaneId: string;
  splitDirection: SplitDirection;
  closedTabsStack: ClosedTerminalTab[];
  tuiAssist: TUIAssistState;
}

interface TerminalAppBridge {
  CreateTerminalForProject?: (
    id: string,
    name: string,
    projectPath: string,
  ) => Promise<unknown>;
  ListTerminalSessions?: () => Promise<string[]>;
  SendTerminalText?: (id: string, text: string) => Promise<unknown>;
}

const getTerminalAppBridge = (): TerminalAppBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeWindow = window as unknown as {
    go?: {
      main?: {
        App?: TerminalAppBridge;
      };
    };
  };

  return maybeWindow.go?.main?.App ?? null;
};

const createTerminalBackendSession = async (
  id: string,
  name: string,
  projectPath: string,
) => {
  const appBridge = getTerminalAppBridge();
  if (
    appBridge &&
    typeof appBridge.CreateTerminalForProject === "function" &&
    projectPath !== ""
  ) {
    await appBridge.CreateTerminalForProject(id, name, projectPath);
    return;
  }

  await CreateTerminal(id, name);
};

const createLocalTerminalSession = (
  id: string,
  name: string,
  themeId: ThemeId,
  terminalFontSize: number,
  projectPath: string,
): TerminalSession => {
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: terminalFontSize,
    fontFamily:
      "'MesloLGS NF', 'Hack Nerd Font', 'FiraCode Nerd Font', 'JetBrains Mono', 'SF Mono', Monaco, Consolas, monospace",
    theme: getTerminalTheme(themeId),
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(new WebLinksAddon());

  terminal.onData((data) => {
    const bytes = new TextEncoder().encode(data);
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    WriteTerminal(id, btoa(binary));
  });

  terminal.onResize(({ rows, cols }) => {
    ResizeTerminal(id, rows, cols);
  });

  return {
    id,
    name,
    projectPath,
    terminal,
    fitAddon,
    searchAddon,
    streamDecoder: new TextDecoder(),
    isAttached: false,
    mode: "shell",
    modeReason: "init",
    modeConfidence: 1,
    modeSourceSignals: ["init:shell"],
    modeUpdatedAt: Date.now(),
  };
};

const createDefaultPanes = (): TerminalPane[] => [
  { id: "pane-1", tabIds: [], activeTabId: "" },
];

const normalizeProjectPathKey = (projectPath: string | null | undefined) =>
  (projectPath ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/");

const escapeShellSingleQuotes = (value: string) => value.replace(/'/g, `'\\''`);

const getProjectLayoutMapKey = (projectPath: string | null | undefined) =>
  normalizeProjectPathKey(projectPath) || "__global__";

const getLayoutStorageKey = (projectPath: string | null | undefined) => {
  const normalizedProjectPath = normalizeProjectPathKey(projectPath);
  return normalizedProjectPath
    ? `${TERMINAL_LAYOUT_STORAGE_KEY}:${normalizedProjectPath}`
    : TERMINAL_LAYOUT_STORAGE_KEY;
};

const clonePanes = (panes: TerminalPane[]): TerminalPane[] =>
  panes.map((pane) => ({
    ...pane,
    tabIds: [...pane.tabIds],
  }));

const loadLayoutSnapshot = (
  projectPath?: string | null,
): {
  panes: TerminalPane[];
  activePaneId: string;
  splitDirection: SplitDirection;
} => {
  const fallbackPanes = createDefaultPanes();

  if (typeof window === "undefined") {
    return {
      panes: fallbackPanes,
      activePaneId: fallbackPanes[0].id,
      splitDirection: null,
    };
  }

  try {
    const raw = window.localStorage.getItem(getLayoutStorageKey(projectPath));
    if (!raw) {
      return {
        panes: fallbackPanes,
        activePaneId: fallbackPanes[0].id,
        splitDirection: null,
      };
    }

    const parsed = JSON.parse(raw) as Partial<TerminalLayoutSnapshot>;
    const paneIds = Array.isArray(parsed.paneIds)
      ? parsed.paneIds.filter(
          (id): id is string => typeof id === "string" && id !== "",
        )
      : [];

    if (paneIds.length === 0) {
      return {
        panes: fallbackPanes,
        activePaneId: fallbackPanes[0].id,
        splitDirection: null,
      };
    }

    const panes = paneIds.map((id) => ({ id, tabIds: [], activeTabId: "" }));
    const activePaneId =
      typeof parsed.activePaneId === "string" &&
      paneIds.includes(parsed.activePaneId)
        ? parsed.activePaneId
        : paneIds[0];
    const splitDirection: SplitDirection =
      parsed.splitDirection === "horizontal" ||
      parsed.splitDirection === "vertical"
        ? parsed.splitDirection
        : null;

    return { panes, activePaneId, splitDirection };
  } catch (error) {
    console.error(
      "[TerminalStore] Failed to parse terminal layout snapshot",
      error,
    );
    return {
      panes: fallbackPanes,
      activePaneId: fallbackPanes[0].id,
      splitDirection: null,
    };
  }
};

const persistLayoutSnapshot = (
  panes: TerminalPane[],
  activePaneId: string,
  splitDirection: SplitDirection,
  projectPath?: string | null,
) => {
  if (typeof window === "undefined") {
    return;
  }

  const paneIds = panes.map((pane) => pane.id);
  if (paneIds.length === 0) {
    return;
  }

  const snapshot: TerminalLayoutSnapshot = {
    version: 1,
    paneIds,
    activePaneId: paneIds.includes(activePaneId) ? activePaneId : paneIds[0],
    splitDirection,
  };

  try {
    window.localStorage.setItem(
      getLayoutStorageKey(projectPath),
      JSON.stringify(snapshot),
    );
  } catch (error) {
    console.error(
      "[TerminalStore] Failed to persist terminal layout snapshot",
      error,
    );
  }
};

const createProjectState = (
  projectPath: string | null,
  overrides?: Partial<TerminalProjectState>,
): TerminalProjectState => {
  const layout = loadLayoutSnapshot(projectPath);
  return {
    panes: clonePanes(overrides?.panes ?? layout.panes),
    activePaneId: overrides?.activePaneId ?? layout.activePaneId,
    splitDirection: overrides?.splitDirection ?? layout.splitDirection,
    closedTabsStack: [...(overrides?.closedTabsStack ?? [])],
    tuiAssist: normalizeTUIAssistState(
      overrides?.tuiAssist as Partial<TUIAssistState> & { swapped?: boolean },
    ),
  };
};

const sanitizeProjectState = (
  projectState: TerminalProjectState,
  sessions: Map<string, TerminalSession>,
  projectPath: string | null,
): TerminalProjectState => {
  const normalizedProjectPath = normalizeProjectPathKey(projectPath);
  const panes =
    projectState.panes.length > 0
      ? projectState.panes.map((pane) => {
          const tabIds = pane.tabIds.filter((id) => {
            const session = sessions.get(id);
            return (
              !!session &&
              normalizeProjectPathKey(session.projectPath) ===
                normalizedProjectPath
            );
          });

          return {
            ...pane,
            tabIds,
            activeTabId: tabIds.includes(pane.activeTabId)
              ? pane.activeTabId
              : tabIds[0] || "",
          };
        })
      : createDefaultPanes();

  const activePaneId = panes.some(
    (pane) => pane.id === projectState.activePaneId,
  )
    ? projectState.activePaneId
    : panes[0]?.id || "pane-1";
  const splitDirection: SplitDirection =
    panes.length > 1 ? projectState.splitDirection : null;

  return {
    panes,
    activePaneId,
    splitDirection,
    closedTabsStack: [...projectState.closedTabsStack],
    tuiAssist: normalizeTUIAssistState(
      projectState.tuiAssist as Partial<TUIAssistState> & { swapped?: boolean },
    ),
  };
};

const resolveProjectTUISessionId = (
  panes: TerminalPane[],
  sessions: Map<string, TerminalSession>,
  activePaneId: string,
) => {
  const activePane = panes.find((pane) => pane.id === activePaneId);
  const activeSession = activePane?.activeTabId
    ? sessions.get(activePane.activeTabId)
    : undefined;
  if (activeSession && activeSession.mode !== "shell") {
    return activeSession.id;
  }

  for (const pane of panes) {
    for (const tabId of pane.tabIds) {
      const session = sessions.get(tabId);
      if (session && session.mode !== "shell") {
        return session.id;
      }
    }
  }

  return null;
};

const buildProjectSwitchCommand = (projectPath: string) =>
  `cd '${escapeShellSingleQuotes(projectPath)}'\n`;

const isShellPathWithinProject = (
  cwd: string | null | undefined,
  projectPath: string | null | undefined,
) => {
  const normalizedCwd = normalizeProjectPathKey(cwd);
  const normalizedProjectPath = normalizeProjectPathKey(projectPath);
  if (!normalizedCwd || !normalizedProjectPath) {
    return false;
  }

  return (
    normalizedCwd === normalizedProjectPath ||
    normalizedCwd.startsWith(`${normalizedProjectPath}/`)
  );
};

const syncVisibleProjectSessions = (
  projectPath: string | null,
  projectState: TerminalProjectState,
  sessions: Map<string, TerminalSession>,
  sessionShellState: Map<string, TerminalShellState>,
  sendRemoteText: TerminalActions["sendRemoteText"],
) => {
  const normalizedProjectPath = normalizeProjectPathKey(projectPath);
  if (!normalizedProjectPath) {
    return;
  }

  const switchCommand = buildProjectSwitchCommand(projectPath ?? "");
  for (const pane of projectState.panes) {
    const sessionId = pane.activeTabId;
    if (!sessionId) {
      continue;
    }

    const session = sessions.get(sessionId);
    if (
      !session ||
      normalizeProjectPathKey(session.projectPath) !== normalizedProjectPath ||
      session.mode !== "shell"
    ) {
      continue;
    }

    const shellState = sessionShellState.get(sessionId);
    if (isShellPathWithinProject(shellState?.cwd, projectPath)) {
      continue;
    }

    void sendRemoteText(sessionId, switchCommand);
  }
};

const initialLayout = createProjectState(null);

const captureProjectState = (
  state: Pick<
    TerminalState,
    | "panes"
    | "activePaneId"
    | "splitDirection"
    | "closedTabsStack"
    | "tuiAssist"
  >,
): TerminalProjectState => ({
  panes: clonePanes(state.panes),
  activePaneId: state.activePaneId,
  splitDirection: state.splitDirection,
  closedTabsStack: [...state.closedTabsStack],
  tuiAssist: { ...state.tuiAssist },
});

const isAbsolutePath = (inputPath: string) =>
  /^([A-Za-z]:[\\/]|\/)/.test(inputPath);

const normalizePath = (inputPath: string) =>
  inputPath.replace(/\\/g, "/").replace(/\/+/g, "/");

const resolveSemanticPath = (path: string, cwd: string) => {
  const normalizedPath = normalizePath(path).replace(/^\.\//, "");
  if (normalizedPath === "" || isAbsolutePath(normalizedPath) || cwd === "") {
    return normalizedPath;
  }

  const normalizedCwd = normalizePath(cwd).replace(/\/$/, "");
  if (normalizedCwd === "") {
    return normalizedPath;
  }

  return `${normalizedCwd}/${normalizedPath}`;
};

const parseImageDataUrl = (message: string) => {
  const normalized = message.trim();
  if (!normalized.startsWith("1337;File=")) {
    return "";
  }

  const separatorIndex = normalized.lastIndexOf(":");
  if (separatorIndex < 0 || separatorIndex >= normalized.length - 1) {
    return "";
  }

  const encodedPayload = normalized.slice(separatorIndex + 1).trim();
  if (!/^[A-Za-z0-9+/=_-]+$/.test(encodedPayload)) {
    return "";
  }

  return `data:image/png;base64,${encodedPayload}`;
};

const buildSemanticDedupeKey = (
  entry: Omit<TerminalSemanticEntry, "timestamp">,
): string => {
  const normalizedMessage =
    entry.message.length > SEMANTIC_DEDUPE_MESSAGE_MAX
      ? `${entry.message.slice(0, SEMANTIC_DEDUPE_MESSAGE_MAX)}#${entry.message.length}`
      : entry.message;

  return [
    entry.kind,
    entry.path,
    String(entry.line),
    String(entry.column),
    entry.severity,
    normalizedMessage,
  ].join("|");
};

const pruneStaleSemanticKeys = (seenMap: Map<string, number>, now: number) => {
  seenMap.forEach((timestamp, key) => {
    if (now - timestamp > SEMANTIC_DEDUPE_WINDOW_MS) {
      seenMap.delete(key);
    }
  });
};

const cleanupSemanticSessionState = (sessionId: string) => {
  const timer = semanticFlushTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
  }
  semanticFlushTimers.delete(sessionId);
  semanticPendingEntries.delete(sessionId);
  semanticRecentEntries.delete(sessionId);
};

const normalizeSessionMode = (mode?: string): TerminalMode => {
  switch (mode) {
    case "tui":
    case "agent_cli":
    case "agent_tui":
      return mode;
    default:
      return "shell";
  }
};

const normalizeModeConfidence = (confidence: number | undefined): number => {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return 1;
  }
  if (confidence < 0) {
    return 0;
  }
  if (confidence > 1) {
    return 1;
  }
  return confidence;
};

const normalizeModeSignals = (
  sourceSignals: string[] | undefined,
  mode: TerminalMode,
): string[] => {
  if (!Array.isArray(sourceSignals)) {
    return [`runtime:${mode}`];
  }

  const normalized = sourceSignals.filter(
    (signal): signal is string =>
      typeof signal === "string" && signal.trim().length > 0,
  );

  return normalized.length > 0 ? normalized : [`runtime:${mode}`];
};

const getTerminalTheme = (themeId: ThemeId) => getThemeTerminalById(themeId);

const getDocumentThemeId = (): ThemeId => {
  if (typeof window === "undefined") {
    return "blackprint";
  }

  const themeId = window.document.documentElement.dataset.theme;
  if (isThemeId(themeId)) {
    return themeId;
  }

  return resolveThemePreference(
    "system",
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
};

export const useTerminalStore = create<TerminalState & TerminalActions>(
  (set, get) => ({
    activeProjectPath: null,
    sessions: new Map(),
    panes: clonePanes(initialLayout.panes),
    activePaneId: initialLayout.activePaneId,
    splitDirection: initialLayout.splitDirection,
    isInitialized: false,
    eventsRegistered: false,
    tuiModeActive: false,
    tuiActiveSessionId: null,
    tuiAssist: { ...DEFAULT_TUI_ASSIST },
    powerProfile: "normal",
    isDispatcherPaused: false,
    isArlePaused: false,
    isLSPPaused: false,
    terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
    closedTabsStack: [],
    sessionShellState: new Map(),
    sessionSemanticEntries: new Map(),
    projectLayouts: new Map(),
    securityPolicy: {
      enabled: true,
      allowSensitiveInspection: false,
      requireWriteApproval: true,
      blockedFileNames: [".env", ".gitignore"],
    },

    setActiveProject: (projectPath) => {
      const previousSessionShellState = get().sessionShellState;
      set((state) => {
        const nextProjectLayouts = new Map(state.projectLayouts);
        const currentProjectKey = getProjectLayoutMapKey(
          state.activeProjectPath,
        );
        nextProjectLayouts.set(currentProjectKey, captureProjectState(state));
        persistLayoutSnapshot(
          state.panes,
          state.activePaneId,
          state.splitDirection,
          state.activeProjectPath,
        );

        const nextProjectKey = getProjectLayoutMapKey(projectPath);
        const savedProjectState =
          nextProjectLayouts.get(nextProjectKey) ??
          createProjectState(projectPath);
        const nextProjectState = sanitizeProjectState(
          savedProjectState,
          state.sessions,
          projectPath,
        );
        const nextTuiSessionId = resolveProjectTUISessionId(
          nextProjectState.panes,
          state.sessions,
          nextProjectState.activePaneId,
        );

        const nextShellState = new Map(state.sessionShellState);
        const normalizedProjectPath = normalizeProjectPathKey(projectPath);
        if (normalizedProjectPath) {
          const updatedAt = Date.now();
          for (const pane of nextProjectState.panes) {
            const sessionId = pane.activeTabId;
            const session = sessionId
              ? state.sessions.get(sessionId)
              : undefined;
            if (
              !session ||
              normalizeProjectPathKey(session.projectPath) !==
                normalizedProjectPath ||
              session.mode !== "shell"
            ) {
              continue;
            }

            const previousShellState = nextShellState.get(sessionId);
            if (
              isShellPathWithinProject(previousShellState?.cwd, projectPath)
            ) {
              continue;
            }
            nextShellState.set(sessionId, {
              phase: previousShellState?.phase || "cwd",
              cwd: projectPath ?? "",
              lastExitCode: previousShellState?.lastExitCode ?? null,
              updatedAt,
              raw: previousShellState?.raw ?? "",
            });
          }
        }

        return {
          activeProjectPath: projectPath,
          panes: nextProjectState.panes,
          activePaneId: nextProjectState.activePaneId,
          splitDirection: nextProjectState.splitDirection,
          closedTabsStack: nextProjectState.closedTabsStack,
          tuiAssist: nextProjectState.tuiAssist,
          tuiActiveSessionId: nextTuiSessionId,
          tuiModeActive: nextTuiSessionId !== null,
          sessionShellState: nextShellState,
          projectLayouts: nextProjectLayouts,
        };
      });

      const state = get();
      const visibleProjectState: TerminalProjectState = {
        panes: clonePanes(state.panes),
        activePaneId: state.activePaneId,
        splitDirection: state.splitDirection,
        closedTabsStack: [...state.closedTabsStack],
        tuiAssist: { ...state.tuiAssist },
      };
      syncVisibleProjectSessions(
        projectPath,
        visibleProjectState,
        state.sessions,
        previousSessionShellState,
        state.sendRemoteText,
      );
    },

    initialize: () => {
      const state = get();
      if (state.eventsRegistered) return;

      EventsOn("terminal:data", (event: { id: string; data: string }) => {
        const session = get().sessions.get(event.id);
        if (!session) {
          return;
        }

        let binary = "";
        try {
          binary = atob(event.data);
        } catch (error) {
          console.error("[TerminalStore] Invalid terminal:data payload", error);
          return;
        }

        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const decoded = session.streamDecoder.decode(bytes, { stream: true });
        if (decoded.length > 0) {
          usePerformanceStore
            .getState()
            .recordEventPressure("terminal", Math.ceil(decoded.length / 4096));
          session.terminal.write(decoded);
        }
      });

      EventsOn("terminal:exit", (event: { id: string; code: number }) => {
        const session = get().sessions.get(event.id);
        if (session) {
          const tail = session.streamDecoder.decode();
          if (tail.length > 0) {
            session.terminal.write(tail);
          }
          session.terminal.write(
            `\r\n\x1b[90mProcess exited with code ${event.code}\x1b[0m\r\n`,
          );
        }
      });

      EventsOn(
        "terminal:mode",
        (event: {
          id: string;
          mode?: string;
          active?: boolean;
          reason?: string;
          confidence?: number;
          sourceSignals?: string[];
          timestamp?: number;
        }) => {
          get().setSessionMode(event);
        },
      );

      EventsOn(
        "terminal:shell",
        (event: {
          id: string;
          type?: string;
          cwd?: string;
          exitCode?: number;
          raw?: string;
        }) => {
          get().setShellEvent(event);
        },
      );

      EventsOn("terminal:created", (event: { id: string; name?: string }) => {
        if (!event?.id) {
          return;
        }
        get().registerExternalSession(event.id, event.name);
      });

      EventsOn(
        "terminal:semantic",
        (event: {
          id: string;
          kind?: string;
          path?: string;
          line?: number;
          column?: number;
          severity?: string;
          message?: string;
        }) => {
          get().setSemanticEvent(event);
        },
      );

      set({ eventsRegistered: true, isInitialized: true });
    },

    createTerminal: async (paneId: string, themeId: ThemeId, terminalName) => {
      const id = generateTerminalId();
      const name = terminalName?.trim() || "Terminal";
      const state = get();
      const terminalFontSize = state.terminalFontSize;
      const projectPath = state.activeProjectPath ?? "";
      const session = createLocalTerminalSession(
        id,
        name,
        themeId,
        terminalFontSize,
        projectPath,
      );

      set((state) => {
        const newSessions = new Map(state.sessions);
        newSessions.set(id, session);

        const newPanes = state.panes.map((pane) => {
          if (pane.id === paneId) {
            return {
              ...pane,
              tabIds: [...pane.tabIds, id],
              activeTabId: id,
            };
          }
          return pane;
        });

        persistLayoutSnapshot(
          newPanes,
          state.activePaneId,
          state.splitDirection,
          state.activeProjectPath,
        );

        return { sessions: newSessions, panes: newPanes };
      });

      try {
        await createTerminalBackendSession(id, name, projectPath);
      } catch (error) {
        session.terminal.dispose();
        set((state) => {
          const newSessions = new Map(state.sessions);
          newSessions.delete(id);

          const newPanes = state.panes.map((pane) => {
            if (pane.id !== paneId) {
              return pane;
            }

            const newTabIds = pane.tabIds.filter((tabId) => tabId !== id);
            const newActiveTabId =
              pane.activeTabId === id ? newTabIds[0] || "" : pane.activeTabId;

            return {
              ...pane,
              tabIds: newTabIds,
              activeTabId: newActiveTabId,
            };
          });

          return {
            sessions: newSessions,
            panes: newPanes,
          };
        });

        throw error;
      }

      return id;
    },

    registerExternalSession: (id: string, name?: string) => {
      const normalizedID = id.trim();
      if (normalizedID === "") {
        return;
      }

      const state = get();
      if (state.sessions.has(normalizedID)) {
        return;
      }

      const themeId = getDocumentThemeId();

      const session = createLocalTerminalSession(
        normalizedID,
        name?.trim() || "Terminal",
        themeId,
        state.terminalFontSize,
        state.activeProjectPath ?? "",
      );

      set((current) => {
        if (current.sessions.has(normalizedID)) {
          session.terminal.dispose();
          return {};
        }

        const nextSessions = new Map(current.sessions);
        nextSessions.set(normalizedID, session);

        const panes =
          current.panes.length > 0 ? current.panes : createDefaultPanes();
        const targetPaneID = panes.some(
          (pane) => pane.id === current.activePaneId,
        )
          ? current.activePaneId
          : panes[0].id;

        const nextPanes = panes.map((pane) => {
          if (pane.id !== targetPaneID) {
            return pane;
          }

          if (pane.tabIds.includes(normalizedID)) {
            return { ...pane, activeTabId: normalizedID };
          }

          return {
            ...pane,
            tabIds: [...pane.tabIds, normalizedID],
            activeTabId: normalizedID,
          };
        });

        persistLayoutSnapshot(
          nextPanes,
          targetPaneID,
          current.splitDirection,
          current.activeProjectPath,
        );

        const nextTuiSessionID = resolveProjectTUISessionId(
          nextPanes,
          nextSessions,
          targetPaneID,
        );

        return {
          sessions: nextSessions,
          panes: nextPanes,
          activePaneId: targetPaneID,
          tuiActiveSessionId: nextTuiSessionID,
          tuiModeActive: nextTuiSessionID !== null,
        };
      });
    },

    closeTerminal: async (paneId: string, tabId: string) => {
      const session = get().sessions.get(tabId);
      const shouldTrackClosedTab = !!session;
      const closedTabName = session?.name || "Terminal";
      if (session) {
        const tail = session.streamDecoder.decode();
        if (tail.length > 0) {
          session.terminal.write(tail);
        }
        await CloseTerminal(tabId);
        session.terminal.dispose();
      }

      cleanupSemanticSessionState(tabId);

      set((state) => {
        const newSessions = new Map(state.sessions);
        newSessions.delete(tabId);
        const newShellState = new Map(state.sessionShellState);
        newShellState.delete(tabId);
        const newSemanticEntries = new Map(state.sessionSemanticEntries);
        newSemanticEntries.delete(tabId);

        const panesWithUpdatedTabs = state.panes.map((pane) => {
          if (pane.id === paneId) {
            const closedIdx = pane.tabIds.indexOf(tabId);
            const newTabIds = pane.tabIds.filter((id) => id !== tabId);
            let newActiveId = pane.activeTabId;
            if (pane.activeTabId === tabId) {
              const adjacentIdx = closedIdx > 0 ? closedIdx - 1 : 0;
              newActiveId = newTabIds[adjacentIdx] || newTabIds[0] || "";
            }
            return { ...pane, tabIds: newTabIds, activeTabId: newActiveId };
          }
          return pane;
        });

        const filteredPanes =
          panesWithUpdatedTabs.length > 1
            ? panesWithUpdatedTabs.filter((pane) => pane.tabIds.length > 0)
            : panesWithUpdatedTabs;
        const nextPanes =
          filteredPanes.length > 0 ? filteredPanes : createDefaultPanes();

        const nextActivePaneId = nextPanes.some(
          (pane) => pane.id === state.activePaneId,
        )
          ? state.activePaneId
          : nextPanes[0].id;
        const nextSplitDirection: SplitDirection =
          nextPanes.length > 1 ? state.splitDirection : null;

        persistLayoutSnapshot(
          nextPanes,
          nextActivePaneId,
          nextSplitDirection,
          state.activeProjectPath,
        );

        const nextActiveSessionId =
          state.tuiActiveSessionId === tabId ? null : state.tuiActiveSessionId;
        const nextTuiModeActive = nextActiveSessionId !== null;
        const nextClosedTabsStack = shouldTrackClosedTab
          ? [...state.closedTabsStack, { paneId, name: closedTabName }].slice(
              -MAX_CLOSED_TERMINAL_TABS,
            )
          : state.closedTabsStack;

        return {
          sessions: newSessions,
          panes: nextPanes,
          activePaneId: nextActivePaneId,
          splitDirection: nextSplitDirection,
          closedTabsStack: nextClosedTabsStack,
          sessionShellState: newShellState,
          sessionSemanticEntries: newSemanticEntries,
          tuiActiveSessionId: nextActiveSessionId,
          tuiModeActive: nextTuiModeActive,
        };
      });
    },

    setActiveTab: (paneId: string, tabId: string) => {
      set((state) => {
        const nextPanes = state.panes.map((pane) =>
          pane.id === paneId ? { ...pane, activeTabId: tabId } : pane,
        );
        persistLayoutSnapshot(
          nextPanes,
          state.activePaneId,
          state.splitDirection,
          state.activeProjectPath,
        );
        const nextTuiSessionId = resolveProjectTUISessionId(
          nextPanes,
          state.sessions,
          state.activePaneId,
        );
        return {
          panes: nextPanes,
          tuiActiveSessionId: nextTuiSessionId,
          tuiModeActive: nextTuiSessionId !== null,
        };
      });
    },

    setActivePane: (paneId: string) => {
      set((state) => {
        persistLayoutSnapshot(
          state.panes,
          paneId,
          state.splitDirection,
          state.activeProjectPath,
        );
        const nextTuiSessionId = resolveProjectTUISessionId(
          state.panes,
          state.sessions,
          paneId,
        );
        return {
          activePaneId: paneId,
          tuiActiveSessionId: nextTuiSessionId,
          tuiModeActive: nextTuiSessionId !== null,
        };
      });
    },

    splitPane: (direction: SplitDirection, themeId: ThemeId) => {
      const newPaneId = `pane-${Date.now()}`;

      set((state) => {
        const nextPanes = [
          ...state.panes,
          { id: newPaneId, tabIds: [], activeTabId: "" },
        ];
        persistLayoutSnapshot(
          nextPanes,
          state.activePaneId,
          direction,
          state.activeProjectPath,
        );
        return {
          splitDirection: direction,
          panes: nextPanes,
        };
      });

      get().createTerminal(newPaneId, themeId);
    },

    getSession: (id: string) => {
      return get().sessions.get(id);
    },

    updateTheme: (themeId: ThemeId) => {
      const theme = getTerminalTheme(themeId);
      get().sessions.forEach((session) => {
        session.terminal.options.theme = theme;
      });
    },

    markAttached: (id: string, attached: boolean) => {
      set((state) => {
        const session = state.sessions.get(id);
        if (session) {
          session.isAttached = attached;
        }
        return { sessions: new Map(state.sessions) };
      });
    },

    focusActiveTerminal: () => {
      const state = get();
      const activePane = state.panes.find((p) => p.id === state.activePaneId);
      if (!activePane) return;
      const session = state.sessions.get(activePane.activeTabId);
      session?.terminal.focus();
    },

    terminalZoomIn: () => {
      set((state) => {
        const nextFontSize = Math.min(
          MAX_TERMINAL_FONT_SIZE,
          state.terminalFontSize + 1,
        );
        if (nextFontSize === state.terminalFontSize) {
          return {};
        }

        state.sessions.forEach((session) => {
          session.terminal.options.fontSize = nextFontSize;
          session.fitAddon.fit();
        });

        return {
          terminalFontSize: nextFontSize,
          sessions: new Map(state.sessions),
        };
      });
    },

    terminalZoomOut: () => {
      set((state) => {
        const nextFontSize = Math.max(
          MIN_TERMINAL_FONT_SIZE,
          state.terminalFontSize - 1,
        );
        if (nextFontSize === state.terminalFontSize) {
          return {};
        }

        state.sessions.forEach((session) => {
          session.terminal.options.fontSize = nextFontSize;
          session.fitAddon.fit();
        });

        return {
          terminalFontSize: nextFontSize,
          sessions: new Map(state.sessions),
        };
      });
    },

    terminalZoomReset: () => {
      set((state) => {
        if (state.terminalFontSize === DEFAULT_TERMINAL_FONT_SIZE) {
          return {};
        }

        state.sessions.forEach((session) => {
          session.terminal.options.fontSize = DEFAULT_TERMINAL_FONT_SIZE;
          session.fitAddon.fit();
        });

        return {
          terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
          sessions: new Map(state.sessions),
        };
      });
    },

    reopenLastClosedTab: async (themeId: ThemeId) => {
      const state = get();
      const lastClosed =
        state.closedTabsStack[state.closedTabsStack.length - 1];
      if (!lastClosed) {
        return null;
      }

      set((current) => ({
        closedTabsStack: current.closedTabsStack.slice(0, -1),
      }));

      const nextState = get();
      const paneExists = nextState.panes.some(
        (pane) => pane.id === lastClosed.paneId,
      );
      const fallbackPaneId =
        nextState.activePaneId || nextState.panes[0]?.id || "pane-1";
      const targetPaneId = paneExists ? lastClosed.paneId : fallbackPaneId;

      if (!targetPaneId) {
        return null;
      }

      if (targetPaneId !== nextState.activePaneId) {
        get().setActivePane(targetPaneId);
      }

      try {
        return await get().createTerminal(
          targetPaneId,
          themeId,
          lastClosed.name,
        );
      } catch (error) {
        console.error("[TerminalStore] Failed to reopen terminal tab", error);
        set((current) => ({
          closedTabsStack: [...current.closedTabsStack, lastClosed].slice(
            -MAX_CLOSED_TERMINAL_TABS,
          ),
        }));
        return null;
      }
    },

    setSessionMode: ({
      id,
      mode,
      active,
      reason,
      confidence,
      sourceSignals,
      timestamp,
    }) => {
      set((state) => {
        const session = state.sessions.get(id);
        if (!session) {
          return {};
        }

        const normalizedMode = normalizeSessionMode(mode);
        const isActiveTerminalMode =
          active === true && normalizedMode !== "shell";
        const nextMode: TerminalMode = isActiveTerminalMode
          ? normalizedMode
          : "shell";
        const updatedSessions = new Map(state.sessions);
        updatedSessions.set(id, {
          ...session,
          mode: nextMode,
          modeReason:
            reason || (isActiveTerminalMode ? "runtime-event" : "shell"),
          modeConfidence: normalizeModeConfidence(confidence),
          modeSourceSignals: normalizeModeSignals(sourceSignals, nextMode),
          modeUpdatedAt: typeof timestamp === "number" ? timestamp : Date.now(),
        });

        const nextTuiActiveSessionId = resolveProjectTUISessionId(
          state.panes,
          updatedSessions,
          state.activePaneId,
        );
        const nextTuiModeActive = nextTuiActiveSessionId !== null;

        if (!nextTuiModeActive && state.tuiAssist.active) {
          return {
            sessions: updatedSessions,
            tuiModeActive: false,
            tuiActiveSessionId: null,
            tuiAssist: { ...DEFAULT_TUI_ASSIST },
          };
        }

        return {
          sessions: updatedSessions,
          tuiModeActive: nextTuiModeActive,
          tuiActiveSessionId: nextTuiActiveSessionId,
        };
      });
    },

    enterTUIMode: (id: string, reason = "manual") => {
      get().setSessionMode({
        id,
        mode: "tui",
        active: true,
        reason,
        timestamp: Date.now(),
      });
    },

    exitTUIMode: (id: string, reason = "manual") => {
      get().setSessionMode({
        id,
        mode: "shell",
        active: false,
        reason,
        timestamp: Date.now(),
      });
    },

    setTUIAssist: (assist) => {
      set((state) => {
        const fallbackAnchor =
          typeof (assist as { swapped?: boolean }).swapped === "boolean"
            ? (assist as { swapped?: boolean }).swapped
              ? "left"
              : "right"
            : state.tuiAssist.anchor;
        const nextTuiAssist = {
          active: assist.active ?? state.tuiAssist.active,
          panel: assist.panel ?? state.tuiAssist.panel,
          ratio:
            typeof assist.ratio === "number"
              ? Math.max(0.2, Math.min(0.8, assist.ratio))
              : state.tuiAssist.ratio,
          anchor: normalizeTUIAssistAnchor(assist.anchor, fallbackAnchor),
        };

        return {
          tuiAssist: nextTuiAssist,
        };
      });
    },

    resetTUIAssist: () => {
      set({
        tuiAssist: { ...DEFAULT_TUI_ASSIST },
      });
    },

    setPowerProfile: (profile) => {
      if (profile === "hard_pause") {
        set({
          powerProfile: profile,
          isDispatcherPaused: true,
          isArlePaused: true,
          isLSPPaused: true,
        });
        return;
      }

      if (profile === "soft_pause") {
        set({
          powerProfile: profile,
          isDispatcherPaused: true,
          isArlePaused: true,
          isLSPPaused: false,
        });
        return;
      }

      set({
        powerProfile: "normal",
        isDispatcherPaused: false,
        isArlePaused: false,
        isLSPPaused: false,
      });
    },

    setSecurityPolicy: (policy) => {
      set((state) => ({
        securityPolicy: {
          ...state.securityPolicy,
          ...policy,
        },
      }));
    },

    isSensitivePath: (filePath) => {
      const normalized = filePath.replace(/\\/g, "/").toLowerCase();
      const policy = get().securityPolicy;
      return policy.blockedFileNames.some((name) => {
        const lower = name.toLowerCase();
        return normalized === lower || normalized.endsWith(`/${lower}`);
      });
    },

    canAccessPath: (filePath, operation) => {
      const policy = get().securityPolicy;
      if (!policy.enabled) {
        return { allowed: true, reason: "policy-disabled" };
      }

      if (get().isSensitivePath(filePath) && !policy.allowSensitiveInspection) {
        return {
          allowed: false,
          reason: `access to sensitive file is blocked: ${filePath}`,
        };
      }

      if (operation === "write" && policy.requireWriteApproval) {
        return {
          allowed: false,
          reason: "write requires explicit user approval",
        };
      }

      return { allowed: true, reason: "allowed" };
    },

    setShellEvent: ({ id, type, cwd, exitCode, raw }) => {
      if (!id || !type) {
        return;
      }

      const normalizedType = type.trim();
      if (!normalizedType) {
        return;
      }

      set((state) => {
        if (!state.sessions.has(id)) {
          return {};
        }

        const prev = state.sessionShellState.get(id);
        const next: TerminalShellState = {
          phase: normalizedType,
          cwd: cwd ?? prev?.cwd ?? "",
          lastExitCode:
            typeof exitCode === "number"
              ? exitCode
              : (prev?.lastExitCode ?? null),
          updatedAt: Date.now(),
          raw: raw ?? prev?.raw ?? "",
        };

        const nextShellState = new Map(state.sessionShellState);
        nextShellState.set(id, next);

        return {
          sessionShellState: nextShellState,
        };
      });
    },

    setSemanticEvent: ({ id, kind, path, line, column, severity, message }) => {
      if (!id || !kind) {
        return;
      }

      const state = get();
      if (!state.sessions.has(id)) {
        return;
      }

      const shellState = state.sessionShellState.get(id);
      const resolvedPath = path
        ? resolveSemanticPath(path, shellState?.cwd ?? "")
        : "";

      const messageText = (message ?? "").slice(0, 65536);
      const imageDataUrl =
        kind === "image_ref" ? parseImageDataUrl(messageText) : "";

      const entryWithoutTimestamp = {
        kind,
        path: resolvedPath,
        line: typeof line === "number" ? line : 0,
        column: typeof column === "number" ? column : 0,
        severity: severity ?? "",
        message: messageText,
        imageDataUrl,
      };

      const dedupeKey = buildSemanticDedupeKey(entryWithoutTimestamp);
      const now = Date.now();
      const seenMap =
        semanticRecentEntries.get(id) ?? new Map<string, number>();
      pruneStaleSemanticKeys(seenMap, now);
      const previousSeenAt = seenMap.get(dedupeKey);
      if (
        typeof previousSeenAt === "number" &&
        now - previousSeenAt <= SEMANTIC_DEDUPE_WINDOW_MS
      ) {
        return;
      }

      seenMap.set(dedupeKey, now);
      semanticRecentEntries.set(id, seenMap);

      const nextEntry: TerminalSemanticEntry = {
        ...entryWithoutTimestamp,
        timestamp: now,
      };

      const pendingEntries = semanticPendingEntries.get(id) ?? [];
      pendingEntries.push({ entry: nextEntry, dedupeKey });
      semanticPendingEntries.set(id, pendingEntries);

      if (semanticFlushTimers.has(id)) {
        return;
      }

      const flushTimer = setTimeout(() => {
        semanticFlushTimers.delete(id);

        const queuedEntries = semanticPendingEntries.get(id) ?? [];
        semanticPendingEntries.delete(id);
        if (queuedEntries.length === 0) {
          return;
        }

        const uniqueEntries: TerminalSemanticEntry[] = [];
        const batchSeen = new Set<string>();
        for (const queued of queuedEntries) {
          if (batchSeen.has(queued.dedupeKey)) {
            continue;
          }
          batchSeen.add(queued.dedupeKey);
          uniqueEntries.push(queued.entry);
        }

        if (uniqueEntries.length === 0) {
          return;
        }

        recordTerminalPerf(
          "semantic.flush",
          () => {
            set((current) => {
              if (!current.sessions.has(id)) {
                return {};
              }

              const previousEntries =
                current.sessionSemanticEntries.get(id) ?? [];
              const nextEntries = [...previousEntries, ...uniqueEntries].slice(
                -MAX_SEMANTIC_ENTRIES,
              );

              const nextSemanticEntries = new Map(
                current.sessionSemanticEntries,
              );
              nextSemanticEntries.set(id, nextEntries);

              return { sessionSemanticEntries: nextSemanticEntries };
            });

            return uniqueEntries.length;
          },
          {
            sessionId: id,
            queued: queuedEntries.length,
            unique: uniqueEntries.length,
          },
        );
      }, SEMANTIC_BATCH_DELAY_MS);

      semanticFlushTimers.set(id, flushTimer);
    },

    listRemoteSessions: async () => {
      const appBridge = getTerminalAppBridge();
      if (!appBridge || typeof appBridge.ListTerminalSessions !== "function") {
        return [];
      }

      try {
        const result = await appBridge.ListTerminalSessions();
        if (!Array.isArray(result)) {
          return [];
        }
        return result.filter((id): id is string => typeof id === "string");
      } catch (error) {
        console.error("[TerminalStore] Failed to list remote sessions", error);
        return [];
      }
    },

    sendRemoteText: async (id, text) => {
      if (!id) {
        return false;
      }

      const appBridge = getTerminalAppBridge();
      if (!appBridge || typeof appBridge.SendTerminalText !== "function") {
        return false;
      }

      try {
        await appBridge.SendTerminalText(id, text);
        return true;
      } catch (error) {
        console.error("[TerminalStore] Failed to send remote text", error);
        return false;
      }
    },

    resetForProjectSwitch: () => {
      const state = get();
      state.sessions.forEach((session, id) => {
        cleanupSemanticSessionState(id);
        try {
          session.terminal.dispose();
        } catch (error) {
          console.debug("[TerminalStore] Failed to dispose session", error);
        }
      });

      const nextPanes = createDefaultPanes();
      persistLayoutSnapshot(nextPanes, nextPanes[0].id, null, null);

      set((current) => ({
        ...current,
        activeProjectPath: null,
        sessions: new Map(),
        panes: nextPanes,
        activePaneId: nextPanes[0].id,
        splitDirection: null,
        closedTabsStack: [],
        sessionShellState: new Map(),
        sessionSemanticEntries: new Map(),
        tuiModeActive: false,
        tuiActiveSessionId: null,
        tuiAssist: { ...DEFAULT_TUI_ASSIST },
        projectLayouts: new Map(),
      }));
    },
  }),
);
