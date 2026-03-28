import { create } from "zustand";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { recordTerminalPerf } from "../utils/terminalPerf";
import {
  CreateTerminal,
  WriteTerminal,
  ResizeTerminal,
  CloseTerminal,
} from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
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
}

interface TerminalActions {
  initialize: () => void;
  createTerminal: (
    paneId: string,
    isDark: boolean,
    terminalName?: string,
  ) => Promise<string>;
  closeTerminal: (paneId: string, tabId: string) => Promise<void>;
  setActiveTab: (paneId: string, tabId: string) => void;
  setActivePane: (paneId: string) => void;
  splitPane: (direction: SplitDirection, isDark: boolean) => void;
  getSession: (id: string) => TerminalSession | undefined;
  updateTheme: (isDark: boolean) => void;
  markAttached: (id: string, attached: boolean) => void;
  focusActiveTerminal: () => void;
  terminalZoomIn: () => void;
  terminalZoomOut: () => void;
  terminalZoomReset: () => void;
  reopenLastClosedTab: (isDark: boolean) => Promise<string | null>;
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

interface TerminalAppBridge {
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

const createDefaultPanes = (): TerminalPane[] => [
  { id: "pane-1", tabIds: [], activeTabId: "" },
];

const loadLayoutSnapshot = (): {
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
    const raw = window.localStorage.getItem(TERMINAL_LAYOUT_STORAGE_KEY);
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
      TERMINAL_LAYOUT_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
  } catch (error) {
    console.error(
      "[TerminalStore] Failed to persist terminal layout snapshot",
      error,
    );
  }
};

const initialLayout = loadLayoutSnapshot();

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

const getTerminalTheme = (isDark: boolean) =>
  isDark
    ? {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#ef4444",
        cursorAccent: "#0a0a0a",
        selectionBackground: "rgba(239, 68, 68, 0.3)",
        black: "#000000",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#f5f5f5",
        brightBlack: "#525252",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      }
    : {
        background: "#fafafa",
        foreground: "#171717",
        cursor: "#ef4444",
        cursorAccent: "#fafafa",
        selectionBackground: "rgba(239, 68, 68, 0.2)",
        black: "#000000",
        red: "#dc2626",
        green: "#16a34a",
        yellow: "#ca8a04",
        blue: "#2563eb",
        magenta: "#9333ea",
        cyan: "#0891b2",
        white: "#f5f5f5",
        brightBlack: "#737373",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#eab308",
        brightBlue: "#3b82f6",
        brightMagenta: "#a855f7",
        brightCyan: "#06b6d4",
        brightWhite: "#ffffff",
      };

export const useTerminalStore = create<TerminalState & TerminalActions>(
  (set, get) => ({
    sessions: new Map(),
    panes: initialLayout.panes,
    activePaneId: initialLayout.activePaneId,
    splitDirection: initialLayout.splitDirection,
    isInitialized: false,
    eventsRegistered: false,
    tuiModeActive: false,
    tuiActiveSessionId: null,
    tuiAssist: { active: false, panel: null, ratio: 0.4, swapped: false },
    powerProfile: "normal",
    isDispatcherPaused: false,
    isArlePaused: false,
    isLSPPaused: false,
    terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
    closedTabsStack: [],
    sessionShellState: new Map(),
    sessionSemanticEntries: new Map(),
    securityPolicy: {
      enabled: true,
      allowSensitiveInspection: false,
      requireWriteApproval: true,
      blockedFileNames: [".env", ".gitignore"],
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

    createTerminal: async (paneId: string, isDark: boolean, terminalName) => {
      const id = generateTerminalId();
      const name = terminalName?.trim() || "Terminal";
      const terminalFontSize = get().terminalFontSize;

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: terminalFontSize,
        fontFamily:
          "'MesloLGS NF', 'Hack Nerd Font', 'FiraCode Nerd Font', 'JetBrains Mono', 'SF Mono', Monaco, Consolas, monospace",
        theme: getTerminalTheme(isDark),
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(new WebLinksAddon());

      terminal.onData((data) => {
        const bytes = new TextEncoder().encode(data);
        const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join(
          "",
        );
        WriteTerminal(id, btoa(binary));
      });

      terminal.onResize(({ rows, cols }) => {
        ResizeTerminal(id, rows, cols);
      });

      const session: TerminalSession = {
        id,
        name,
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

        return { sessions: newSessions, panes: newPanes };
      });

      try {
        await CreateTerminal(id, name);
      } catch (error) {
        terminal.dispose();
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

        persistLayoutSnapshot(nextPanes, nextActivePaneId, nextSplitDirection);

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
      set((state) => ({
        panes: state.panes.map((pane) =>
          pane.id === paneId ? { ...pane, activeTabId: tabId } : pane,
        ),
      }));
    },

    setActivePane: (paneId: string) => {
      set((state) => {
        persistLayoutSnapshot(state.panes, paneId, state.splitDirection);
        return { activePaneId: paneId };
      });
    },

    splitPane: (direction: SplitDirection, isDark: boolean) => {
      const newPaneId = `pane-${Date.now()}`;

      set((state) => {
        const nextPanes = [
          ...state.panes,
          { id: newPaneId, tabIds: [], activeTabId: "" },
        ];
        persistLayoutSnapshot(nextPanes, state.activePaneId, direction);
        return {
          splitDirection: direction,
          panes: nextPanes,
        };
      });

      get().createTerminal(newPaneId, isDark);
    },

    getSession: (id: string) => {
      return get().sessions.get(id);
    },

    updateTheme: (isDark: boolean) => {
      const theme = getTerminalTheme(isDark);
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

    reopenLastClosedTab: async (isDark: boolean) => {
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
          isDark,
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

        let nextTuiActiveSessionId = state.tuiActiveSessionId;
        if (isActiveTerminalMode) {
          nextTuiActiveSessionId = id;
        } else if (state.tuiActiveSessionId === id) {
          nextTuiActiveSessionId = null;
        }

        const nextTuiModeActive = nextTuiActiveSessionId !== null;

        if (!nextTuiModeActive && state.tuiAssist.active) {
          return {
            sessions: updatedSessions,
            tuiModeActive: false,
            tuiActiveSessionId: null,
            tuiAssist: {
              active: false,
              panel: null,
              ratio: 0.4,
              swapped: false,
            },
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
        const ratio =
          typeof assist.ratio === "number"
            ? Math.max(0.2, Math.min(0.8, assist.ratio))
            : state.tuiAssist.ratio;

        return {
          tuiAssist: {
            active: assist.active ?? state.tuiAssist.active,
            panel: assist.panel ?? state.tuiAssist.panel,
            swapped: assist.swapped ?? state.tuiAssist.swapped,
            ratio,
          },
        };
      });
    },

    resetTUIAssist: () => {
      set({
        tuiAssist: { active: false, panel: null, ratio: 0.4, swapped: false },
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
      persistLayoutSnapshot(nextPanes, nextPanes[0].id, null);

      set((current) => ({
        ...current,
        sessions: new Map(),
        panes: nextPanes,
        activePaneId: nextPanes[0].id,
        splitDirection: null,
        closedTabsStack: [],
        sessionShellState: new Map(),
        sessionSemanticEntries: new Map(),
        tuiModeActive: false,
        tuiActiveSessionId: null,
        tuiAssist: { active: false, panel: null, ratio: 0.4, swapped: false },
      }));
    },
  }),
);
