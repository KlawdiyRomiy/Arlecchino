import { useSyncExternalStore } from "react";
import { EventsOn } from "../wails/runtime";

import {
  ensureDiagnosticsEventsBound,
  useDiagnosticsStore,
} from "../stores/diagnosticsStore";
import { usePerformanceStore } from "../stores/performanceStore";
import { useGitStore } from "../stores/gitStore";
import { getCurrentProjectSessionId } from "../shell/projectSessionRoute";
import { resetIndexingProgressState } from "../hooks/useIndexingProgress";

type ProjectAppBridge = {
  LSPPreloadProjectDiagnostics?: (projectPath: string) => Promise<unknown>;
};

type DiagnosticsCoverageState =
  | "pending"
  | "running"
  | "complete"
  | "incomplete"
  | "unavailable";

interface DiagnosticsPreloadState {
  active: boolean;
  completed: boolean;
  coverageState: DiagnosticsCoverageState;
  coverageMode: string;
  generation: number;
  projectPath: string | null;
  bounded: boolean;
  totalCandidates: number;
  selectedCandidates: number;
  checkedCandidates: number;
  failedCandidates: number;
  totalLanguages: number;
  selectedLanguages: number;
  timedOut: boolean;
  message: string;
}

interface DiagnosticsPreloadEventPayload {
  generation?: number;
  projectPath?: string;
  sessionId?: string;
  bounded?: boolean;
  coverageState?: string;
  coverageMode?: string;
  totalCandidates?: number;
  selectedCandidates?: number;
  checkedCandidates?: number;
  failedCandidates?: number;
  totalLanguages?: number;
  selectedLanguages?: number;
  timedOut?: boolean;
  message?: string;
}

interface LSPReadyEventPayload extends DiagnosticsPreloadEventPayload {}

interface ProjectScopeState {
  generation: number;
  projectPath: string | null;
  sessionId: string;
}

let diagnosticsPreloadState: DiagnosticsPreloadState = {
  active: false,
  completed: false,
  coverageState: "pending",
  coverageMode: "",
  generation: 0,
  projectPath: null,
  bounded: false,
  totalCandidates: 0,
  selectedCandidates: 0,
  checkedCandidates: 0,
  failedCandidates: 0,
  totalLanguages: 0,
  selectedLanguages: 0,
  timedOut: false,
  message: "",
};
let diagnosticsPreloadEventsBound = false;
let diagnosticsPreloadSessionId = "main";
let diagnosticsPreloadBindTimer: ReturnType<typeof window.setTimeout> | null =
  null;
let diagnosticsPreloadBoundWaiters: Array<() => void> = [];
const diagnosticsBindingsWaitTimeoutMs = 300;
let latestProjectRuntime: ProjectScopeState = {
  generation: 0,
  projectPath: null,
  sessionId: "main",
};
let currentProjectScope: ProjectScopeState = {
  generation: 0,
  projectPath: null,
  sessionId: "main",
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

const preloadStateIdle: DiagnosticsPreloadState = {
  active: false,
  completed: false,
  coverageState: "pending",
  coverageMode: "",
  generation: 0,
  projectPath: null,
  bounded: false,
  totalCandidates: 0,
  selectedCandidates: 0,
  checkedCandidates: 0,
  failedCandidates: 0,
  totalLanguages: 0,
  selectedLanguages: 0,
  timedOut: false,
  message: "",
};

const preloadStateIdleForProject = (
  projectPath: string,
): DiagnosticsPreloadState => ({
  ...preloadStateIdle,
  projectPath,
});

const isProjectDiagnosticsPreloadEnabled = () => true;

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

const normalizeSessionId = (payload: DiagnosticsPreloadEventPayload) =>
  typeof payload.sessionId === "string" && payload.sessionId.length > 0
    ? payload.sessionId
    : "main";

const payloadMatchesCurrentProjectSession = (
  payload: DiagnosticsPreloadEventPayload,
) => {
  return normalizeSessionId(payload) === getCurrentProjectSessionId();
};

const normalizeCount = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return value > 0 ? Math.trunc(value) : 0;
};

const normalizeCoverageState = (
  value: string | undefined,
  fallback: DiagnosticsCoverageState,
): DiagnosticsCoverageState => {
  switch (value) {
    case "pending":
    case "running":
    case "complete":
    case "incomplete":
    case "unavailable":
      return value;
    default:
      return fallback;
  }
};

const syncProjectScopeToDiagnosticsStore = () => {
  useDiagnosticsStore
    .getState()
    .setProjectScope(
      currentProjectScope.projectPath,
      currentProjectScope.generation,
    );
};

const setDiagnosticsPreloadState = (
  next: DiagnosticsPreloadState,
  sessionId = getCurrentProjectSessionId(),
) => {
  diagnosticsPreloadSessionId = sessionId;
  emitDiagnosticsPreloadState(next);
};

const resolveDiagnosticsPreloadEventsBound = () => {
  if (diagnosticsPreloadBoundWaiters.length === 0) {
    return;
  }

  const waiters = diagnosticsPreloadBoundWaiters;
  diagnosticsPreloadBoundWaiters = [];
  waiters.forEach((resolve) => resolve());
};

const getPreloadMetadata = (payload: DiagnosticsPreloadEventPayload) => ({
  bounded: Boolean(payload.bounded),
  totalCandidates: normalizeCount(payload.totalCandidates),
  selectedCandidates: normalizeCount(payload.selectedCandidates),
  checkedCandidates: normalizeCount(payload.checkedCandidates),
  failedCandidates: normalizeCount(payload.failedCandidates),
  totalLanguages: normalizeCount(payload.totalLanguages),
  selectedLanguages: normalizeCount(payload.selectedLanguages),
  timedOut: Boolean(payload.timedOut),
  coverageMode:
    typeof payload.coverageMode === "string" ? payload.coverageMode : "",
  message: typeof payload.message === "string" ? payload.message : "",
});

const resolveMatchingProjectScope = (
  projectPath: string | null,
  generation: number,
  sessionId: string,
) => {
  if (!projectPath) {
    return null;
  }

  if (
    currentProjectScope.projectPath === projectPath &&
    currentProjectScope.sessionId === sessionId
  ) {
    return {
      generation:
        generation ||
        currentProjectScope.generation ||
        latestProjectRuntime.generation,
      projectPath,
      sessionId,
    };
  }

  if (
    latestProjectRuntime.projectPath === projectPath &&
    latestProjectRuntime.sessionId === sessionId
  ) {
    return {
      generation: generation || latestProjectRuntime.generation,
      projectPath,
      sessionId,
    };
  }

  return null;
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

  if (diagnosticsPreloadBindTimer) {
    window.clearTimeout(diagnosticsPreloadBindTimer);
    diagnosticsPreloadBindTimer = null;
  }

  diagnosticsPreloadEventsBound = true;
  resolveDiagnosticsPreloadEventsBound();
  EventsOn("lsp:ready", (payload: LSPReadyEventPayload) => {
    if (!payloadMatchesCurrentProjectSession(payload)) {
      return;
    }
    const projectPath = normalizeProjectPath(payload);
    const generation = normalizeGeneration(payload.generation);
    const sessionId = normalizeSessionId(payload);
    if (!projectPath || generation === 0) {
      return;
    }

    latestProjectRuntime = { generation, projectPath, sessionId };
    if (
      currentProjectScope.projectPath !== projectPath ||
      currentProjectScope.sessionId !== sessionId
    ) {
      return;
    }

    currentProjectScope = { generation, projectPath, sessionId };
    syncProjectScopeToDiagnosticsStore();
    if (
      diagnosticsPreloadState.projectPath === projectPath &&
      diagnosticsPreloadSessionId === sessionId &&
      diagnosticsPreloadState.generation === generation
    ) {
      setDiagnosticsPreloadState(
        {
          ...diagnosticsPreloadState,
          generation,
        },
        sessionId,
      );
    } else {
      setDiagnosticsPreloadState(
        {
          ...preloadStateIdleForProject(projectPath),
          generation,
        },
        sessionId,
      );
    }
  });
  EventsOn(
    "lsp:diagnostics:preload:start",
    (payload: DiagnosticsPreloadEventPayload) => {
      if (!payloadMatchesCurrentProjectSession(payload)) {
        return;
      }
      const projectPath = normalizeProjectPath(payload);
      const generation = normalizeGeneration(payload.generation);
      const sessionId = normalizeSessionId(payload);
      const matchingScope = resolveMatchingProjectScope(
        projectPath,
        generation,
        sessionId,
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
      const previousCheckedCandidates =
        diagnosticsPreloadState.projectPath === projectPath &&
        diagnosticsPreloadSessionId === sessionId &&
        diagnosticsPreloadState.generation === matchingScope.generation
          ? diagnosticsPreloadState.checkedCandidates
          : 0;
      const checkedCandidateDelta = Math.max(
        1,
        metadata.checkedCandidates - previousCheckedCandidates,
      );
      usePerformanceStore
        .getState()
        .recordEventPressure("lsp", checkedCandidateDelta);

      setDiagnosticsPreloadState(
        {
          active: true,
          completed: false,
          coverageState: normalizeCoverageState(
            payload.coverageState,
            "running",
          ),
          generation: matchingScope.generation,
          projectPath,
          ...metadata,
        },
        sessionId,
      );
    },
  );
  EventsOn(
    "lsp:diagnostics:preload:complete",
    (payload: DiagnosticsPreloadEventPayload) => {
      if (!payloadMatchesCurrentProjectSession(payload)) {
        return;
      }
      const projectPath = normalizeProjectPath(payload);
      const generation = normalizeGeneration(payload.generation);
      const sessionId = normalizeSessionId(payload);
      const matchingScope = resolveMatchingProjectScope(
        projectPath,
        generation,
        sessionId,
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
      const fallbackCoverageState: DiagnosticsCoverageState =
        metadata.totalCandidates === 0
          ? "unavailable"
          : metadata.bounded ||
              metadata.selectedCandidates < metadata.totalCandidates ||
              metadata.failedCandidates > 0 ||
              metadata.timedOut
            ? "incomplete"
            : "complete";

      setDiagnosticsPreloadState(
        {
          active: false,
          completed: true,
          coverageState: normalizeCoverageState(
            payload.coverageState,
            fallbackCoverageState,
          ),
          generation: matchingScope.generation,
          projectPath,
          ...metadata,
        },
        sessionId,
      );
    },
  );
};

const ensureDiagnosticsPreloadEventsBound = (): Promise<void> => {
  if (diagnosticsPreloadEventsBound || typeof window === "undefined") {
    return Promise.resolve();
  }

  bindDiagnosticsPreloadEvents();
  if (diagnosticsPreloadEventsBound) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    diagnosticsPreloadBoundWaiters.push(resolve);
    scheduleDiagnosticsPreloadBind();
  });
};

const waitForDiagnosticsBindingsReady = async () => {
  const waitForBindings = Promise.all([
    ensureDiagnosticsEventsBound(),
    ensureDiagnosticsPreloadEventsBound(),
  ]);

  await Promise.race([
    waitForBindings,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, diagnosticsBindingsWaitTimeoutMs);
    }),
  ]);
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
  const sessionId = getCurrentProjectSessionId();
  latestProjectRuntime = { generation: 0, projectPath: null, sessionId };
  currentProjectScope = { generation: 0, projectPath: null, sessionId };
  setDiagnosticsPreloadState(preloadStateIdle, sessionId);
  resetIndexingProgressState();
  useDiagnosticsStore.getState().reset();
  useGitStore.getState().setProjectPath("");
  usePerformanceStore.getState().resetTransientBudget();
};

export const activateProjectScope = (projectPath: string | null) => {
  const sessionId = getCurrentProjectSessionId();
  const generation =
    projectPath &&
    latestProjectRuntime.projectPath === projectPath &&
    latestProjectRuntime.sessionId === sessionId
      ? latestProjectRuntime.generation
      : 0;
  const hasMatchingPreloadProject =
    diagnosticsPreloadState.projectPath === projectPath &&
    diagnosticsPreloadSessionId === sessionId &&
    (generation === 0 ||
      diagnosticsPreloadState.generation === 0 ||
      diagnosticsPreloadState.generation === generation);
  currentProjectScope = {
    projectPath,
    generation,
    sessionId,
  };
  syncProjectScopeToDiagnosticsStore();
  useGitStore.getState().setProjectPath(projectPath ?? "");
  setDiagnosticsPreloadState(
    {
      active: diagnosticsPreloadState.active && hasMatchingPreloadProject,
      completed: hasMatchingPreloadProject && diagnosticsPreloadState.completed,
      coverageState: hasMatchingPreloadProject
        ? diagnosticsPreloadState.coverageState
        : projectPath
          ? "pending"
          : "unavailable",
      coverageMode: hasMatchingPreloadProject
        ? diagnosticsPreloadState.coverageMode
        : "",
      generation: hasMatchingPreloadProject
        ? currentProjectScope.generation || diagnosticsPreloadState.generation
        : currentProjectScope.generation,
      projectPath,
      bounded: hasMatchingPreloadProject && diagnosticsPreloadState.bounded,
      totalCandidates: hasMatchingPreloadProject
        ? diagnosticsPreloadState.totalCandidates
        : 0,
      selectedCandidates: hasMatchingPreloadProject
        ? diagnosticsPreloadState.selectedCandidates
        : 0,
      checkedCandidates: hasMatchingPreloadProject
        ? diagnosticsPreloadState.checkedCandidates
        : 0,
      failedCandidates: hasMatchingPreloadProject
        ? diagnosticsPreloadState.failedCandidates
        : 0,
      totalLanguages: hasMatchingPreloadProject
        ? diagnosticsPreloadState.totalLanguages
        : 0,
      selectedLanguages: hasMatchingPreloadProject
        ? diagnosticsPreloadState.selectedLanguages
        : 0,
      timedOut: hasMatchingPreloadProject && diagnosticsPreloadState.timedOut,
      message: hasMatchingPreloadProject ? diagnosticsPreloadState.message : "",
    },
    sessionId,
  );
};

export const useProjectDiagnosticsPreload = () =>
  useSyncExternalStore(
    subscribeDiagnosticsPreload,
    getDiagnosticsPreloadSnapshot,
  );

export const getProjectDiagnosticsPreloadSnapshot = () =>
  getDiagnosticsPreloadSnapshot();

export const preloadProjectDiagnostics = async (projectPath: string) => {
  if (!projectPath) {
    setDiagnosticsPreloadState(preloadStateIdle);
    return false;
  }

  if (!isProjectDiagnosticsPreloadEnabled()) {
    setDiagnosticsPreloadState({
      ...preloadStateIdleForProject(projectPath),
      completed: true,
      coverageState: "unavailable",
      message: "Workspace diagnostics preload is disabled.",
    });
    return false;
  }

  const bridge = getProjectAppBridge();
  if (!bridge || typeof bridge.LSPPreloadProjectDiagnostics !== "function") {
    setDiagnosticsPreloadState({
      ...preloadStateIdleForProject(projectPath),
      completed: true,
      coverageState: "unavailable",
      message: "Diagnostics preload bridge is unavailable.",
    });
    return false;
  }

  try {
    await waitForDiagnosticsBindingsReady();
    await bridge.LSPPreloadProjectDiagnostics(projectPath);
    return true;
  } catch (error) {
    console.debug("[diagnostics] project preload failed", error);
    setDiagnosticsPreloadState({
      ...preloadStateIdleForProject(projectPath),
      completed: true,
      coverageState: "unavailable",
      message:
        error instanceof Error ? error.message : "Diagnostics preload failed.",
    });
    return false;
  }
};

bindDiagnosticsPreloadEvents();
