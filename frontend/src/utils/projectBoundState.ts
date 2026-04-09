import { useSyncExternalStore } from "react";
import { EventsOn } from "../../wailsjs/runtime/runtime";

import { useDiagnosticsStore } from "../stores/diagnosticsStore";

type ProjectAppBridge = {
  LSPPreloadProjectDiagnostics?: (projectPath: string) => Promise<unknown>;
};

interface DiagnosticsPreloadState {
  active: boolean;
  generation: number;
  projectPath: string | null;
  bounded: boolean;
  totalCandidates: number;
  selectedCandidates: number;
  totalLanguages: number;
  selectedLanguages: number;
}

interface DiagnosticsPreloadEventPayload {
  generation?: number;
  projectPath?: string;
  bounded?: boolean;
  totalCandidates?: number;
  selectedCandidates?: number;
  totalLanguages?: number;
  selectedLanguages?: number;
}

interface LSPReadyEventPayload extends DiagnosticsPreloadEventPayload {}

interface ProjectScopeState {
  generation: number;
  projectPath: string | null;
}

let diagnosticsPreloadState: DiagnosticsPreloadState = {
  active: false,
  generation: 0,
  projectPath: null,
  bounded: false,
  totalCandidates: 0,
  selectedCandidates: 0,
  totalLanguages: 0,
  selectedLanguages: 0,
};
let diagnosticsPreloadEventsBound = false;
let diagnosticsPreloadBindTimer: ReturnType<typeof window.setTimeout> | null =
  null;
let latestProjectRuntime: ProjectScopeState = {
  generation: 0,
  projectPath: null,
};
let currentProjectScope: ProjectScopeState = {
  generation: 0,
  projectPath: null,
};

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

const normalizeGeneration = (generation?: number) => {
  if (typeof generation !== "number" || !Number.isFinite(generation)) {
    return 0;
  }

  return generation > 0 ? Math.trunc(generation) : 0;
};

const normalizeProjectPath = (payload: DiagnosticsPreloadEventPayload) => {
  return typeof payload.projectPath === "string" &&
    payload.projectPath.length > 0
    ? payload.projectPath
    : null;
};

const normalizeCount = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return value > 0 ? Math.trunc(value) : 0;
};

const syncProjectScopeToDiagnosticsStore = () => {
  useDiagnosticsStore
    .getState()
    .setProjectScope(
      currentProjectScope.projectPath,
      currentProjectScope.generation,
    );
};

const setDiagnosticsPreloadState = (next: DiagnosticsPreloadState) => {
  emitDiagnosticsPreloadState(next);
};

const getPreloadMetadata = (payload: DiagnosticsPreloadEventPayload) => ({
  bounded: Boolean(payload.bounded),
  totalCandidates: normalizeCount(payload.totalCandidates),
  selectedCandidates: normalizeCount(payload.selectedCandidates),
  totalLanguages: normalizeCount(payload.totalLanguages),
  selectedLanguages: normalizeCount(payload.selectedLanguages),
});

const resolveMatchingProjectScope = (
  projectPath: string | null,
  generation: number,
) => {
  if (!projectPath) {
    return null;
  }

  if (currentProjectScope.projectPath === projectPath) {
    return {
      generation:
        generation ||
        currentProjectScope.generation ||
        latestProjectRuntime.generation,
      projectPath,
    };
  }

  if (latestProjectRuntime.projectPath === projectPath) {
    return {
      generation: generation || latestProjectRuntime.generation,
      projectPath,
    };
  }

  return null;
};

const hasWailsRuntimeEvents = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const runtimeWindow = window as typeof window & {
    runtime?: {
      EventsOnMultiple?: unknown;
    };
  };

  return typeof runtimeWindow.runtime?.EventsOnMultiple === "function";
};

const scheduleDiagnosticsPreloadBind = () => {
  if (
    diagnosticsPreloadEventsBound ||
    typeof window === "undefined" ||
    diagnosticsPreloadBindTimer
  ) {
    return;
  }

  diagnosticsPreloadBindTimer = window.setTimeout(() => {
    diagnosticsPreloadBindTimer = null;
    bindDiagnosticsPreloadEvents();
  }, 50);
};

const bindDiagnosticsPreloadEvents = () => {
  if (diagnosticsPreloadEventsBound || typeof window === "undefined") {
    return;
  }

  if (!hasWailsRuntimeEvents()) {
    scheduleDiagnosticsPreloadBind();
    return;
  }

  if (diagnosticsPreloadBindTimer) {
    window.clearTimeout(diagnosticsPreloadBindTimer);
    diagnosticsPreloadBindTimer = null;
  }

  diagnosticsPreloadEventsBound = true;
  EventsOn("lsp:ready", (payload: LSPReadyEventPayload) => {
    const projectPath = normalizeProjectPath(payload);
    const generation = normalizeGeneration(payload.generation);
    if (!projectPath || generation === 0) {
      return;
    }

    latestProjectRuntime = { generation, projectPath };
    if (currentProjectScope.projectPath !== projectPath) {
      return;
    }

    currentProjectScope = { generation, projectPath };
    syncProjectScopeToDiagnosticsStore();
    if (diagnosticsPreloadState.projectPath === projectPath) {
      setDiagnosticsPreloadState({
        ...diagnosticsPreloadState,
        generation,
      });
    }
  });
  EventsOn(
    "lsp:diagnostics:preload:start",
    (payload: DiagnosticsPreloadEventPayload) => {
      const projectPath = normalizeProjectPath(payload);
      const generation = normalizeGeneration(payload.generation);
      const matchingScope = resolveMatchingProjectScope(
        projectPath,
        generation,
      );
      if (!matchingScope) {
        return;
      }
      if (
        matchingScope.generation > 0 &&
        generation > 0 &&
        matchingScope.generation !== generation
      ) {
        return;
      }

      latestProjectRuntime = matchingScope;
      currentProjectScope = matchingScope;
      syncProjectScopeToDiagnosticsStore();
      const metadata = getPreloadMetadata(payload);

      setDiagnosticsPreloadState({
        active: true,
        generation: matchingScope.generation,
        projectPath,
        ...metadata,
      });
    },
  );
  EventsOn(
    "lsp:diagnostics:preload:complete",
    (payload: DiagnosticsPreloadEventPayload) => {
      const projectPath = normalizeProjectPath(payload);
      const generation = normalizeGeneration(payload.generation);
      const matchingScope = resolveMatchingProjectScope(
        projectPath,
        generation,
      );
      if (!matchingScope) {
        return;
      }
      if (
        matchingScope.generation > 0 &&
        generation > 0 &&
        matchingScope.generation !== generation
      ) {
        return;
      }

      currentProjectScope = matchingScope;
      syncProjectScopeToDiagnosticsStore();
      const metadata = getPreloadMetadata(payload);

      setDiagnosticsPreloadState({
        active: false,
        generation: matchingScope.generation,
        projectPath,
        ...metadata,
      });
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
  latestProjectRuntime = { generation: 0, projectPath: null };
  currentProjectScope = { generation: 0, projectPath: null };
  setDiagnosticsPreloadState({
    active: false,
    generation: 0,
    projectPath: null,
    bounded: false,
    totalCandidates: 0,
    selectedCandidates: 0,
    totalLanguages: 0,
    selectedLanguages: 0,
  });
  useDiagnosticsStore.getState().reset();
};

export const activateProjectScope = (projectPath: string | null) => {
  currentProjectScope = {
    projectPath,
    generation:
      projectPath && latestProjectRuntime.projectPath === projectPath
        ? latestProjectRuntime.generation
        : 0,
  };
  syncProjectScopeToDiagnosticsStore();
  setDiagnosticsPreloadState({
    active:
      diagnosticsPreloadState.active &&
      diagnosticsPreloadState.projectPath === projectPath,
    generation:
      currentProjectScope.generation || diagnosticsPreloadState.generation,
    projectPath,
    bounded:
      diagnosticsPreloadState.projectPath === projectPath &&
      diagnosticsPreloadState.bounded,
    totalCandidates:
      diagnosticsPreloadState.projectPath === projectPath
        ? diagnosticsPreloadState.totalCandidates
        : 0,
    selectedCandidates:
      diagnosticsPreloadState.projectPath === projectPath
        ? diagnosticsPreloadState.selectedCandidates
        : 0,
    totalLanguages:
      diagnosticsPreloadState.projectPath === projectPath
        ? diagnosticsPreloadState.totalLanguages
        : 0,
    selectedLanguages:
      diagnosticsPreloadState.projectPath === projectPath
        ? diagnosticsPreloadState.selectedLanguages
        : 0,
  });
};

export const useProjectDiagnosticsPreload = () =>
  useSyncExternalStore(
    subscribeDiagnosticsPreload,
    getDiagnosticsPreloadSnapshot,
  );

export const getProjectDiagnosticsPreloadSnapshot = () =>
  getDiagnosticsPreloadSnapshot();

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
    emitDiagnosticsPreloadState({
      active: false,
      generation: 0,
      projectPath: null,
      bounded: false,
      totalCandidates: 0,
      selectedCandidates: 0,
      totalLanguages: 0,
      selectedLanguages: 0,
    });
    return false;
  }
};

bindDiagnosticsPreloadEvents();
