import { useSyncExternalStore } from "react";
import { EventsOn } from "../../wailsjs/runtime/runtime";

import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useTerminalStore } from "../stores/terminalStore";

type ProjectAppBridge = {
  LSPPreloadProjectDiagnostics?: (projectPath: string) => Promise<unknown>;
};

interface DiagnosticsPreloadState {
  active: boolean;
  projectPath: string | null;
}

interface DiagnosticsPreloadEventPayload {
  projectPath?: string;
}

let diagnosticsPreloadState: DiagnosticsPreloadState = {
  active: false,
  projectPath: null,
};
let diagnosticsPreloadEventsBound = false;

const diagnosticsPreloadListeners = new Set<() => void>();

const emitDiagnosticsPreloadState = (next: DiagnosticsPreloadState) => {
  diagnosticsPreloadState = next;
  diagnosticsPreloadListeners.forEach((listener) => listener());
};

const subscribeDiagnosticsPreload = (listener: () => void) => {
  diagnosticsPreloadListeners.add(listener);
  return () => diagnosticsPreloadListeners.delete(listener);
};

const getDiagnosticsPreloadSnapshot = () => diagnosticsPreloadState;

const normalizeProjectPath = (payload: DiagnosticsPreloadEventPayload) => {
  return typeof payload.projectPath === "string" &&
    payload.projectPath.length > 0
    ? payload.projectPath
    : null;
};

const bindDiagnosticsPreloadEvents = () => {
  if (diagnosticsPreloadEventsBound || typeof window === "undefined") {
    return;
  }

  diagnosticsPreloadEventsBound = true;
  EventsOn(
    "lsp:diagnostics:preload:start",
    (payload: DiagnosticsPreloadEventPayload) => {
      emitDiagnosticsPreloadState({
        active: true,
        projectPath: normalizeProjectPath(payload),
      });
    },
  );
  EventsOn(
    "lsp:diagnostics:preload:complete",
    (payload: DiagnosticsPreloadEventPayload) => {
      const projectPath = normalizeProjectPath(payload);
      if (
        diagnosticsPreloadState.projectPath &&
        projectPath &&
        diagnosticsPreloadState.projectPath !== projectPath
      ) {
        return;
      }

      emitDiagnosticsPreloadState({ active: false, projectPath });
    },
  );
};

const getProjectAppBridge = (): ProjectAppBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const runtimeWindow = window as typeof window & {
    go?: {
      main?: {
        App?: ProjectAppBridge;
      };
    };
  };

  return runtimeWindow.go?.main?.App ?? null;
};

export const resetProjectBoundStores = () => {
  emitDiagnosticsPreloadState({ active: false, projectPath: null });
  useDiagnosticsStore.getState().reset();
  useTerminalStore.getState().resetForProjectSwitch();
};

export const useProjectDiagnosticsPreload = () =>
  useSyncExternalStore(
    subscribeDiagnosticsPreload,
    getDiagnosticsPreloadSnapshot,
  );

export const preloadProjectDiagnostics = async (projectPath: string) => {
  const bridge = getProjectAppBridge();
  if (
    !projectPath ||
    !bridge ||
    typeof bridge.LSPPreloadProjectDiagnostics !== "function"
  ) {
    return false;
  }

  try {
    await bridge.LSPPreloadProjectDiagnostics(projectPath);
    return true;
  } catch (error) {
    console.debug("[diagnostics] project preload failed", error);
    emitDiagnosticsPreloadState({ active: false, projectPath: null });
    return false;
  }
};

bindDiagnosticsPreloadEvents();
