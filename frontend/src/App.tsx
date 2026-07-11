import React, { useCallback, useEffect, useRef, useState } from "react";
import WelcomeScreen from "./components/WelcomeScreen";
import {
  CloseConfirmationDialog,
  type CloseConfirmationRequest,
} from "./components/CloseConfirmationDialog";
import { AppNotificationStack } from "./components/layout/AppNotificationStack";
import { MCPApprovalDialog } from "./components/MCPApprovalDialog";
import { DetachedAppletHost } from "./components/DetachedAppletHost";
import { isDetachedAppletHostRoute } from "./components/detachedAppletHostRoute";
import { MainLayout } from "./components/layout/MainLayout";
import { ProjectSwitchTransition } from "./components/layout/ProjectSwitchTransition";
import ProjectScreen from "./components/ProjectScreen";
import { CommandRegistryProvider } from "./contexts/CommandRegistryContext";
import { PluginModalProvider } from "./contexts/PluginModalContext";
import * as AppFunctions from "./wails/app";
import {
  DEFAULT_UI_FONT_SIZE,
  useEditorSettingsStore,
} from "./stores/editorSettingsStore";
import { usePreviewWindowStore } from "./stores/previewWindowStore";
import {
  getAdjacentProject,
  resolveProjectSwitchDirection,
  useWorkspaceStore,
} from "./stores/workspaceStore";
import { useTerminalStore } from "./stores/terminalStore";
import {
  startAdaptivePerformanceMonitor,
  usePerformanceStore,
} from "./stores/performanceStore";
import { useAppNotificationStore } from "./stores/appNotificationStore";
import { useTheme } from "./hooks/useTheme";
import { clampUiScale } from "./utils/uiScale";
import {
  activateProjectScope,
  resetProjectBoundStores,
} from "./utils/projectBoundState";
import { useApplicationMenuBridge } from "./hooks/useApplicationMenuBridge";
import { EventsOn } from "./wails/runtime";
import { useBackgroundShellStatusBridge } from "./shell/backgroundShellStatus";
import { useOpenIntentEventBridge } from "./shell/openIntentEventBridge";
import { usePackagedOSIntegrationBridge } from "./shell/packagedOSIntegration";
import { useAutoUpdateBridge } from "./shell/autoUpdate";
import { useManualUpdateNotifications } from "./shell/manualUpdateNotifications";
import {
  normalizeApplicationCloseSource,
  shouldSkipApplicationCloseConfirmation,
  type ApplicationCloseSource,
} from "./shell/applicationClosePolicy";
import { useShellCapabilitiesBridge } from "./shell/shellCapabilities";
import { useSystemNotifications } from "./shell/systemNotifications";
import { useWindowLeaseBridge } from "./shell/windowLeaseBridge";
import {
  deferOpenIntent,
  registerOpenIntentDispatcher,
  routeOpenIntent,
} from "./shell/openIntentRouter";
import {
  selectDirectoryWithCapability,
  selectOpenTargetWithCapability,
} from "./shell/shellDialogs";
import {
  forgetProjectWindowRestorePath,
  rememberProjectWindowRestorePath,
} from "./shell/projectWindowRestore";
import { getCurrentProjectSessionId } from "./shell/projectSessionRoute";
import { syncSurfaceRuntimeWindowLeaseBackendStatus } from "./surfaces/surfaceRuntimeStore";
import {
  createEditorFileLoadingLoad,
  loadEditorFile,
  type EditorFileOpenPayload,
} from "./utils/editorFileLoader";
import { createSystemFontSizeScaler } from "./utils/systemFontSizeScaling";

const PROJECT_SWITCH_VISUAL_SETTLE_MS = 420;
const OPEN_TARGET_EVENT = "arlecchino:open";
const APP_CLOSE_REQUESTED_EVENT = "app:close-requested";
const APP_CLOSE_REQUEST_EVENT = "arlecchino:request-close";

type CloseProjectOptions = {
  preserveProjectWindowRestore?: boolean;
  skipConfirmation?: boolean;
};

type PendingCloseConfirmation = CloseConfirmationRequest & {
  onConfirm: () => Promise<void> | void;
};

interface ApplicationCloseRequestPayload {
  sessionId?: string;
  source?: string;
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const waitForProjectSwitchVisualSettle = () =>
  new Promise<void>((resolve) => {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => resolve());
    }, PROJECT_SWITCH_VISUAL_SETTLE_MS);
  });

const buildScaledSurfaceStyle = (uiScale: number): React.CSSProperties => ({
  position: "absolute",
  top: 0,
  left: 0,
  width: `${100 / uiScale}%`,
  height: `${100 / uiScale}%`,
  transform: `scale(${uiScale})`,
  transformOrigin: "top left",
  overflow: "hidden",
  background: "transparent",
});

const appShellStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  overflow: "hidden",
  overscrollBehavior: "none",
  borderRadius: "var(--radius-window)",
  clipPath: "inset(0 round var(--radius-window))",
  background: "transparent",
};

const appSurfaceBackgroundStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "var(--surface-canvas)",
};

const registeredCustomFontFaces = new Map<string, FontFace>();

const parentDirectoryForFilePath = (path: string): string | null => {
  const normalizedPath = path.trim();
  const separatorIndex = normalizedPath.lastIndexOf("/");
  if (separatorIndex > 0) {
    return normalizedPath.slice(0, separatorIndex);
  }
  if (separatorIndex === 0) {
    return "/";
  }
  return null;
};

const App: React.FC = () => {
  useApplicationMenuBridge();
  useShellCapabilitiesBridge(AppFunctions.GetShellCapabilities);
  useOpenIntentEventBridge();
  useBackgroundShellStatusBridge();
  usePackagedOSIntegrationBridge();
  useAutoUpdateBridge();
  useManualUpdateNotifications();
  useSystemNotifications();
  useWindowLeaseBridge(syncSurfaceRuntimeWindowLeaseBackendStatus);

  const activeId = useWorkspaceStore((state) => state.activeId);
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
  const uiFontFamily = useEditorSettingsStore((state) => state.uiFontFamily);
  const uiFontSize = useEditorSettingsStore((state) => state.uiFontSize);
  const editorFontFamily = useEditorSettingsStore(
    (state) => state.editorFontFamily,
  );
  const editorFontSize = useEditorSettingsStore(
    (state) => state.editorFontSize,
  );
  const terminalFontFamily = useEditorSettingsStore(
    (state) => state.terminalFontFamily,
  );
  const customFonts = useEditorSettingsStore((state) => state.customFonts);
  const confirmBeforeClose = useEditorSettingsStore(
    (state) => state.confirmBeforeClose,
  );
  const appIconAppearance = useEditorSettingsStore(
    (state) => state.appIconAppearance,
  );
  const { theme: currentTheme } = useTheme();
  const activeProject = useWorkspaceStore((state) =>
    state.projects.find((project) => project.id === state.activeId),
  );
  const activeProjectPath = activeProject?.path ?? null;
  const ready = useWorkspaceStore((state) => state.ready);
  const switchDirection = useWorkspaceStore((state) => state.switchDirection);
  const [fileToOpen, setFileToOpen] = useState<EditorFileOpenPayload | null>(
    null,
  );
  const [closeConfirmation, setCloseConfirmation] =
    useState<PendingCloseConfirmation | null>(null);
  const confirmBeforeCloseRef = useRef(confirmBeforeClose);
  const closeConfirmationRef = useRef<PendingCloseConfirmation | null>(null);
  const projectBackendSerialRef = useRef<Promise<void>>(Promise.resolve());
  const projectBackendOperationIdRef = useRef(0);
  const effectiveUiScale = clampUiScale(uiScale);
  const isDetachedHost = isDetachedAppletHostRoute();
  const welcomeScreenVisible =
    ready && !isDetachedHost && !(activeId && activeProject);

  useEffect(() => startAdaptivePerformanceMonitor(), []);

  useEffect(() => {
    usePreviewWindowStore.getState().setProjectKey(activeProjectPath);
  }, [activeProjectPath]);

  useEffect(() => {
    confirmBeforeCloseRef.current = confirmBeforeClose;
    void AppFunctions.SetCloseConfirmationEnabled(confirmBeforeClose).catch(
      () => undefined,
    );
  }, [confirmBeforeClose]);

  useEffect(() => {
    void AppFunctions.SetApplicationIconAppearance(appIconAppearance).catch(
      () => undefined,
    );
  }, [appIconAppearance]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ui-font-family",
      uiFontFamily,
    );
    document.documentElement.style.setProperty(
      "--editor-font-family",
      editorFontFamily,
    );
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${editorFontSize}px`,
    );
    document.documentElement.style.setProperty(
      "--terminal-font-family",
      terminalFontFamily,
    );
    return () => {
      document.documentElement.style.removeProperty("--ui-font-family");
      document.documentElement.style.removeProperty("--editor-font-family");
      document.documentElement.style.removeProperty("--editor-font-size");
      document.documentElement.style.removeProperty("--terminal-font-family");
    };
  }, [editorFontFamily, editorFontSize, terminalFontFamily, uiFontFamily]);

  useEffect(() => {
    useTerminalStore.getState().setTerminalFontFamily(terminalFontFamily);
  }, [terminalFontFamily]);

  useEffect(
    () => createSystemFontSizeScaler(uiFontSize, DEFAULT_UI_FONT_SIZE),
    [uiFontSize],
  );

  useEffect(() => {
    if (typeof FontFace === "undefined" || !document.fonts) {
      return;
    }

    for (const customFont of customFonts) {
      if (registeredCustomFontFaces.has(customFont.id)) {
        continue;
      }

      const fontFace = new FontFace(
        customFont.fontFamily,
        `url(${customFont.dataUrl})`,
      );
      registeredCustomFontFaces.set(customFont.id, fontFace);
      document.fonts.add(fontFace);
      void fontFace.load().catch(() => {
        document.fonts.delete(fontFace);
        registeredCustomFontFaces.delete(customFont.id);
      });
    }
  }, [customFonts]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(effectiveUiScale),
    );
    document.documentElement.style.setProperty(
      "--ui-inverse-scale",
      String(1 / effectiveUiScale),
    );

    return () => {
      document.documentElement.style.removeProperty("--ui-scale");
      document.documentElement.style.removeProperty("--ui-inverse-scale");
    };
  }, [effectiveUiScale]);

  const syncCurrentFramework = useCallback(async () => {
    const framework = await AppFunctions.GetCurrentProjectFramework();
    useWorkspaceStore.getState().setActiveFramework(framework || null);
  }, []);

  const showWorkspaceError = useCallback((title: string, error: unknown) => {
    useAppNotificationStore.getState().addNotification({
      kind: "error",
      title,
      message: toErrorMessage(error),
      source: "Workspace",
    });
  }, []);

  const finishProjectSwitchNow = useCallback(
    async (projectId: string, projectPath: string | null) => {
      const workspace = useWorkspaceStore.getState();
      workspace.confirmProjectSwitch(projectId);
      setFileToOpen(null);

      await waitForProjectSwitchVisualSettle();

      const settledWorkspace = useWorkspaceStore.getState();
      if (
        settledWorkspace.activeId !== projectId ||
        settledWorkspace.pendingId !== projectId
      ) {
        return false;
      }

      settledWorkspace.completeProjectSwitch(projectId);
      useTerminalStore.getState().setActiveProject(projectPath);
      setFileToOpen(null);
      return true;
    },
    [],
  );

  const restoreProjectSelection = useCallback(
    (projectId: string | null, projectPath: string | null) => {
      if (projectId) {
        const workspace = useWorkspaceStore.getState();
        workspace.beginProjectSwitch(projectId, 0);
        workspace.confirmProjectSwitch(projectId);
        workspace.completeProjectSwitch(projectId);
      } else {
        useWorkspaceStore.getState().clearActiveProject();
      }
      activateProjectScope(projectPath);
      useTerminalStore.getState().setActiveProject(projectPath);
      setFileToOpen(null);
    },
    [],
  );

  const beginProjectBackendOperation = useCallback(() => {
    projectBackendOperationIdRef.current += 1;
    return projectBackendOperationIdRef.current;
  }, []);

  const isProjectBackendOperationCurrent = useCallback(
    (operationId: number) =>
      projectBackendOperationIdRef.current === operationId,
    [],
  );

  const runLatestProjectBackendOperation = useCallback(
    (operationId: number, run: () => Promise<unknown>) => {
      const previousOperation = projectBackendSerialRef.current.catch(
        () => undefined,
      );
      const operation = previousOperation.then(async () => {
        if (!isProjectBackendOperationCurrent(operationId)) {
          return false;
        }
        await run();
        return isProjectBackendOperationCurrent(operationId);
      });

      projectBackendSerialRef.current = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    [isProjectBackendOperationCurrent],
  );

  const runLatestProjectOpen = useCallback(
    (projectPath: string, operationId: number) => {
      if (!isProjectBackendOperationCurrent(operationId)) {
        return Promise.resolve(false);
      }
      const operation = AppFunctions.OpenProject(projectPath).then(() =>
        isProjectBackendOperationCurrent(operationId),
      );
      projectBackendSerialRef.current = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    [isProjectBackendOperationCurrent],
  );

  const runLatestProjectClose = useCallback(
    (operationId: number) =>
      runLatestProjectBackendOperation(operationId, () =>
        AppFunctions.CloseProject(),
      ),
    [runLatestProjectBackendOperation],
  );

  const requestCloseConfirmation = useCallback(
    (
      request: CloseConfirmationRequest,
      onConfirm: () => Promise<void> | void,
    ) => {
      if (!confirmBeforeCloseRef.current) {
        void Promise.resolve(onConfirm()).catch((error) => {
          console.error("Error while closing:", error);
          showWorkspaceError("Close failed", error);
        });
        return;
      }

      const pendingConfirmation = {
        ...request,
        onConfirm,
      };
      closeConfirmationRef.current = pendingConfirmation;
      setCloseConfirmation(pendingConfirmation);
    },
    [showWorkspaceError],
  );

  const handleCloseConfirmationCancel = useCallback(() => {
    const shouldCancelApplicationClose =
      closeConfirmationRef.current?.kind === "application";
    closeConfirmationRef.current = null;
    setCloseConfirmation(null);
    if (shouldCancelApplicationClose) {
      void AppFunctions.CancelApplicationClose().catch(() => undefined);
    }
  }, []);

  const requestApplicationClose = useCallback(
    (source: ApplicationCloseSource) => {
      const confirmApplicationClose = async () => {
        await AppFunctions.ConfirmApplicationClose();
      };

      if (
        !confirmBeforeCloseRef.current ||
        shouldSkipApplicationCloseConfirmation(welcomeScreenVisible, source)
      ) {
        void confirmApplicationClose().catch((error) => {
          console.error("Error while closing application:", error);
          showWorkspaceError("Close failed", error);
        });
        return;
      }

      if (closeConfirmationRef.current?.kind === "application") {
        return;
      }

      const pendingConfirmation = {
        kind: "application" as const,
        onConfirm: confirmApplicationClose,
      };
      closeConfirmationRef.current = pendingConfirmation;
      setCloseConfirmation(pendingConfirmation);
    },
    [showWorkspaceError, welcomeScreenVisible],
  );

  const handleCloseConfirmationConfirm = useCallback(() => {
    const pending = closeConfirmationRef.current;
    if (!pending) {
      return;
    }

    closeConfirmationRef.current = null;
    setCloseConfirmation(null);
    void Promise.resolve(pending.onConfirm()).catch((error) => {
      console.error("Error while closing:", error);
      showWorkspaceError("Close failed", error);
    });
  }, [showWorkspaceError]);

  useEffect(() => {
    if (isDetachedHost) {
      return;
    }

    const handleApplicationCloseRequested = (
      payload?: ApplicationCloseRequestPayload,
    ) => {
      const targetSessionId =
        typeof payload?.sessionId === "string" && payload.sessionId
          ? payload.sessionId
          : "main";
      if (targetSessionId !== getCurrentProjectSessionId()) {
        return;
      }

      requestApplicationClose(normalizeApplicationCloseSource(payload?.source));
    };

    return EventsOn<[ApplicationCloseRequestPayload | undefined]>(
      APP_CLOSE_REQUESTED_EVENT,
      handleApplicationCloseRequested,
    );
  }, [isDetachedHost, requestApplicationClose]);

  useEffect(() => {
    if (isDetachedHost) {
      return;
    }

    const handleApplicationCloseShortcut = (event: KeyboardEvent) => {
      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "q"
      ) {
        event.preventDefault();
        requestApplicationClose("quit");
      }
    };

    const handleApplicationCloseEvent = () => {
      requestApplicationClose("window");
    };

    window.addEventListener("keydown", handleApplicationCloseShortcut, true);
    window.addEventListener(
      APP_CLOSE_REQUEST_EVENT,
      handleApplicationCloseEvent,
    );
    return () => {
      window.removeEventListener(
        "keydown",
        handleApplicationCloseShortcut,
        true,
      );
      window.removeEventListener(
        APP_CLOSE_REQUEST_EVENT,
        handleApplicationCloseEvent,
      );
    };
  }, [isDetachedHost, requestApplicationClose]);

  const handleSwitchProject = useCallback(
    async (id: string, direction?: number) => {
      const state = useWorkspaceStore.getState();
      if (id === state.activeId || state.pendingId) {
        return;
      }

      const project = state.projects.find((item) => item.id === id);
      if (!project) {
        return;
      }

      const outgoingProjectId = state.activeId;
      const outgoingProjectPath =
        state.projects.find((item) => item.id === outgoingProjectId)?.path ??
        null;
      usePerformanceStore.getState().resetTransientBudget();
      state.beginProjectSwitch(id, direction);
      const operationId = beginProjectBackendOperation();
      setFileToOpen(null);

      try {
        activateProjectScope(project.path);
        const openProjectPromise = runLatestProjectOpen(
          project.path,
          operationId,
        );
        const finishProjectSwitchPromise = finishProjectSwitchNow(
          id,
          project.path,
        );
        useWorkspaceStore.getState().setActiveFramework(null);
        const [isCurrentOperation, switchFinished] = await Promise.all([
          openProjectPromise,
          finishProjectSwitchPromise,
        ]);
        if (!isCurrentOperation || !switchFinished) {
          return;
        }
        await syncCurrentFramework();
        if (!isProjectBackendOperationCurrent(operationId)) {
          return;
        }
      } catch (error) {
        if (!isProjectBackendOperationCurrent(operationId)) {
          return;
        }
        restoreProjectSelection(outgoingProjectId, outgoingProjectPath);
        console.error("Error switching project:", error);
        showWorkspaceError("Switch project failed", error);
      }
    },
    [
      beginProjectBackendOperation,
      finishProjectSwitchNow,
      isProjectBackendOperationCurrent,
      restoreProjectSelection,
      runLatestProjectOpen,
      showWorkspaceError,
      syncCurrentFramework,
    ],
  );

  const handleProjectOpen = useCallback(
    async (projectPath: string) => {
      const state = useWorkspaceStore.getState();
      const existingProject = state.projects.find(
        (project) => project.path === projectPath,
      );
      if (existingProject) {
        if (existingProject.id !== state.activeId) {
          await handleSwitchProject(existingProject.id);
        }
        return;
      }

      const projectWindowMode =
        useEditorSettingsStore.getState().projectWindowMode;
      if (projectWindowMode === "windows" && state.activeId) {
        try {
          const opened = await AppFunctions.OpenProjectWindow(projectPath);
          if (opened === false) {
            throw new Error("Project window launcher is unavailable.");
          }
          rememberProjectWindowRestorePath(projectPath);
          setFileToOpen(null);
        } catch (error) {
          console.error("Error opening project window:", error);
          showWorkspaceError("Open project window failed", error);
        }
        return;
      }

      const outgoingProjectId = state.activeId;
      const outgoingProjectPath =
        state.projects.find((project) => project.id === outgoingProjectId)
          ?.path ?? null;
      const hadActiveProject = Boolean(state.activeId);
      usePerformanceStore.getState().resetTransientBudget();
      const openedProjectId = useWorkspaceStore
        .getState()
        .beginProjectOpen(projectPath, 1);
      const operationId = beginProjectBackendOperation();
      setFileToOpen(null);

      try {
        if (!hadActiveProject) {
          resetProjectBoundStores();
        }
        activateProjectScope(projectPath);
        const openProjectPromise = runLatestProjectOpen(
          projectPath,
          operationId,
        );
        const finishProjectSwitchPromise = finishProjectSwitchNow(
          openedProjectId,
          projectPath,
        );
        useWorkspaceStore.getState().setActiveFramework(null);
        const [isCurrentOperation, switchFinished] = await Promise.all([
          openProjectPromise,
          finishProjectSwitchPromise,
        ]);
        if (!isCurrentOperation || !switchFinished) {
          return;
        }
        await syncCurrentFramework();
        if (!isProjectBackendOperationCurrent(operationId)) {
          return;
        }
      } catch (error) {
        if (!isProjectBackendOperationCurrent(operationId)) {
          return;
        }
        restoreProjectSelection(outgoingProjectId, outgoingProjectPath);
        useWorkspaceStore.getState().removeProject(openedProjectId);
        if (!hadActiveProject) {
          resetProjectBoundStores();
        }
        console.error("Error opening project:", error);
        showWorkspaceError("Open project failed", error);
      }
    },
    [
      beginProjectBackendOperation,
      finishProjectSwitchNow,
      handleSwitchProject,
      isProjectBackendOperationCurrent,
      restoreProjectSelection,
      runLatestProjectOpen,
      showWorkspaceError,
      syncCurrentFramework,
    ],
  );

  const handleFileOpen = (payload: EditorFileOpenPayload) => {
    setFileToOpen(payload);
  };

  useEffect(() => {
    const handleOpenTargetEvent = () => {
      if (isDetachedHost) {
        return;
      }

      void (async () => {
        try {
          if (!useWorkspaceStore.getState().activeId) {
            const projectPath = await selectDirectoryWithCapability(
              "Open Project",
              AppFunctions.SelectDirectory,
            );
            if (projectPath) {
              await handleProjectOpen(projectPath);
            }
            return;
          }

          const selectedIntent = await selectOpenTargetWithCapability(
            "Open",
            AppFunctions.SelectOpenTarget,
          );
          if (!selectedIntent) {
            return;
          }

          await routeOpenIntent({
            ...selectedIntent,
            source: "manual-open",
          });
        } catch (error) {
          console.error("Error opening target:", error);
          showWorkspaceError("Open target failed", error);
        }
      })();
    };

    window.addEventListener(OPEN_TARGET_EVENT, handleOpenTargetEvent);
    return () => {
      window.removeEventListener(OPEN_TARGET_EVENT, handleOpenTargetEvent);
    };
  }, [handleProjectOpen, isDetachedHost, showWorkspaceError]);

  const performBackToWelcome = async (currentId: string) => {
    if (!currentId) {
      return;
    }

    const operationId = beginProjectBackendOperation();
    try {
      const isCurrentOperation = await runLatestProjectClose(operationId);
      if (!isCurrentOperation) {
        return;
      }
      resetProjectBoundStores();
      forgetProjectWindowRestorePath(currentId);
      useWorkspaceStore.getState().removeProject(currentId);
      useWorkspaceStore.getState().setActiveFramework(null);
      useTerminalStore.getState().setActiveProject(null);
      setFileToOpen(null);
    } catch (error) {
      if (!isProjectBackendOperationCurrent(operationId)) {
        return;
      }
      console.error("Error returning to welcome:", error);
      showWorkspaceError("Close project failed", error);
    }
  };

  const handleBackToWelcome = async () => {
    const state = useWorkspaceStore.getState();
    const currentId = state.activeId;
    if (!currentId) {
      return;
    }

    const currentProject = state.projects.find(
      (project) => project.id === currentId,
    );
    requestCloseConfirmation(
      { kind: "project", projectName: currentProject?.name ?? currentId },
      () => performBackToWelcome(currentId),
    );
  };

  const performCloseProject = async (
    id: string,
    options?: CloseProjectOptions,
  ) => {
    const state = useWorkspaceStore.getState();
    if (state.pendingId) {
      return;
    }

    const shouldForgetProjectWindowRestore =
      !options?.preserveProjectWindowRestore;
    const closingActive = state.activeId === id;
    if (!closingActive) {
      if (shouldForgetProjectWindowRestore) {
        forgetProjectWindowRestorePath(id);
      }
      state.removeProject(id);
      return;
    }

    const nextProject = getAdjacentProject(state.projects, id);
    if (!nextProject) {
      const operationId = beginProjectBackendOperation();
      try {
        const isCurrentOperation = await runLatestProjectClose(operationId);
        if (!isCurrentOperation) {
          return;
        }
        resetProjectBoundStores();
        if (shouldForgetProjectWindowRestore) {
          forgetProjectWindowRestorePath(id);
        }
        useWorkspaceStore.getState().removeProject(id);
        useWorkspaceStore.getState().setActiveFramework(null);
        useTerminalStore.getState().setActiveProject(null);
        setFileToOpen(null);
      } catch (error) {
        if (!isProjectBackendOperationCurrent(operationId)) {
          return;
        }
        console.error("Error closing last project:", error);
        showWorkspaceError("Close project failed", error);
      }
      return;
    }

    const direction = resolveProjectSwitchDirection(
      state.projects,
      id,
      nextProject.id,
    );
    const outgoingProjectId = state.activeId;
    const outgoingProjectPath =
      state.projects.find((project) => project.id === outgoingProjectId)
        ?.path ?? null;
    usePerformanceStore.getState().resetTransientBudget();
    state.beginProjectSwitch(nextProject.id, direction);
    const operationId = beginProjectBackendOperation();
    setFileToOpen(null);

    try {
      activateProjectScope(nextProject.path);
      const openProjectPromise = runLatestProjectOpen(
        nextProject.path,
        operationId,
      );
      const finishProjectSwitchPromise = finishProjectSwitchNow(
        nextProject.id,
        nextProject.path,
      );
      useWorkspaceStore.getState().setActiveFramework(null);
      const [isCurrentOperation, switchFinished] = await Promise.all([
        openProjectPromise,
        finishProjectSwitchPromise,
      ]);
      if (!isCurrentOperation || !switchFinished) {
        return;
      }
      await syncCurrentFramework();
      if (!isProjectBackendOperationCurrent(operationId)) {
        return;
      }
      if (shouldForgetProjectWindowRestore) {
        forgetProjectWindowRestorePath(id);
      }
      useWorkspaceStore.getState().removeProject(id);
      setFileToOpen(null);
    } catch (error) {
      if (!isProjectBackendOperationCurrent(operationId)) {
        return;
      }
      restoreProjectSelection(outgoingProjectId, outgoingProjectPath);
      console.error("Error switching after close:", error);
      showWorkspaceError("Switch after close failed", error);
    }
  };

  const handleCloseProject = async (
    id: string,
    options?: CloseProjectOptions,
  ) => {
    if (options?.skipConfirmation) {
      await performCloseProject(id, options);
      return;
    }

    const state = useWorkspaceStore.getState();
    if (state.pendingId) {
      return;
    }
    const project = state.projects.find((item) => item.id === id);
    requestCloseConfirmation(
      { kind: "project", projectName: project?.name ?? id },
      () => performCloseProject(id, options),
    );
  };

  const handleDetachProject = async (id: string) => {
    const state = useWorkspaceStore.getState();
    if (state.pendingId) {
      return;
    }

    const project = state.projects.find((item) => item.id === id);
    if (!project) {
      return;
    }

    try {
      const opened = await AppFunctions.OpenProjectWindow(project.path);
      if (opened === false) {
        throw new Error("Project window launcher is unavailable.");
      }
      rememberProjectWindowRestorePath(project.path);
      await handleCloseProject(id, {
        preserveProjectWindowRestore: true,
        skipConfirmation: true,
      });
    } catch (error) {
      console.error("Error detaching project:", error);
      showWorkspaceError("Detach project failed", error);
    }
  };

  const handleReorderProjects = (ids: string[]) => {
    useWorkspaceStore.getState().reorderProjects(ids);
  };

  useEffect(() => {
    if (!ready || activeId || isDetachedHost) {
      return;
    }

    const unregister = registerOpenIntentDispatcher({
      openProject: async (projectPath, intent) => {
        if (
          intent.requiresConfirmation &&
          !window.confirm(`Open external project?\n\n${projectPath}`)
        ) {
          return;
        }
        await handleProjectOpen(projectPath);
      },
      openFile: async (path, line, intent) => {
        const projectPath = parentDirectoryForFilePath(path);
        if (!projectPath) {
          throw new Error(`Cannot infer a project folder for file: ${path}`);
        }

        setFileToOpen({
          file: createEditorFileLoadingLoad(path, undefined, intent),
          line,
        });
        await handleProjectOpen(projectPath);
        if (!useWorkspaceStore.getState().activeId) {
          return;
        }

        setFileToOpen({
          file: await loadEditorFile(path, { policy: intent }),
          line,
        });
      },
      openPreview: async () => {},
      focusSurface: async (intent) => {
        deferOpenIntent(intent);
      },
    });

    return unregister;
  }, [activeId, handleProjectOpen, isDetachedHost, ready]);

  const closeConfirmationDialog = isDetachedHost ? null : (
    <CloseConfirmationDialog
      request={closeConfirmation}
      onCancel={handleCloseConfirmationCancel}
      onConfirm={handleCloseConfirmationConfirm}
    />
  );

  if (!ready) {
    if (isDetachedHost) {
      return (
        <>
          <DetachedAppletHost
            currentTheme={currentTheme}
            currentUiScale={effectiveUiScale}
          />
          <AppNotificationStack />
        </>
      );
    }

    return (
      <div data-testid="app-shell" data-file-drop-target style={appShellStyle}>
        <div
          data-testid="app-scaled-surface"
          style={buildScaledSurfaceStyle(effectiveUiScale)}
        >
          <div aria-hidden="true" style={appSurfaceBackgroundStyle} />
        </div>
        <MCPApprovalDialog />
        <AppNotificationStack />
        {closeConfirmationDialog}
      </div>
    );
  }

  if (isDetachedHost) {
    return (
      <>
        <DetachedAppletHost
          currentTheme={currentTheme}
          currentUiScale={effectiveUiScale}
        />
        <AppNotificationStack />
      </>
    );
  }

  return (
    <div data-testid="app-shell" data-file-drop-target style={appShellStyle}>
      <div
        data-testid="app-scaled-surface"
        style={buildScaledSurfaceStyle(effectiveUiScale)}
      >
        <div aria-hidden="true" style={appSurfaceBackgroundStyle} />
        <ProjectSwitchTransition
          layoutKey={activeProjectPath ?? "__welcome__"}
          direction={activeProject ? switchDirection : 0}
        >
          {activeId && activeProject ? (
            <PluginModalProvider key={activeProject.path}>
              <CommandRegistryProvider>
                <MainLayout
                  key={activeProject.path}
                  onFileOpen={handleFileOpen}
                  onBackToWelcome={handleBackToWelcome}
                  onProjectOpen={handleProjectOpen}
                  onSwitchProject={handleSwitchProject}
                  onCloseProject={handleCloseProject}
                  onDetachProject={handleDetachProject}
                  onReorderProjects={handleReorderProjects}
                >
                  <ProjectScreen
                    key={activeProject.path}
                    projectPath={activeProject.path}
                    fileToOpen={fileToOpen}
                    onFileOpened={() => setFileToOpen(null)}
                    onRequestProjectClose={() => {
                      void handleCloseProject(activeProject.id);
                    }}
                  />
                </MainLayout>
              </CommandRegistryProvider>
            </PluginModalProvider>
          ) : (
            <WelcomeScreen onProjectOpen={handleProjectOpen} />
          )}
        </ProjectSwitchTransition>
      </div>
      <MCPApprovalDialog />
      <AppNotificationStack />
      {closeConfirmationDialog}
    </div>
  );
};

export default App;
