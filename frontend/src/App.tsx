import React, { startTransition, useEffect, useState } from "react";
import WelcomeScreen from "./components/WelcomeScreen";
import { AppNotificationStack } from "./components/layout/AppNotificationStack";
import { MCPApprovalDialog } from "./components/MCPApprovalDialog";
import {
  DetachedAppletHost,
  isDetachedAppletHostRoute,
} from "./components/DetachedAppletHost";
import { MainLayout } from "./components/layout/MainLayout";
import { ProjectSwitchTransition } from "./components/layout/ProjectSwitchTransition";
import ProjectScreen from "./components/ProjectScreen";
import { CommandRegistryProvider } from "./contexts/CommandRegistryContext";
import { PluginModalProvider } from "./contexts/PluginModalContext";
import * as AppFunctions from "./wails/app";
import { useEditorSettingsStore } from "./stores/editorSettingsStore";
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
import { useTheme } from "./hooks/useTheme";
import { clampUiScale } from "./utils/uiScale";
import {
  activateProjectScope,
  preloadProjectDiagnostics,
  resetProjectBoundStores,
} from "./utils/projectBoundState";
import { useApplicationMenuBridge } from "./hooks/useApplicationMenuBridge";
import { useBackgroundShellStatusBridge } from "./shell/backgroundShellStatus";
import { useOpenIntentEventBridge } from "./shell/openIntentEventBridge";
import { usePackagedOSIntegrationBridge } from "./shell/packagedOSIntegration";
import { useAutoUpdateBridge } from "./shell/autoUpdate";
import { useManualUpdateNotifications } from "./shell/manualUpdateNotifications";
import { useShellCapabilitiesBridge } from "./shell/shellCapabilities";
import { useWindowLeaseBridge } from "./shell/windowLeaseBridge";
import {
  registerOpenIntentDispatcher,
  routeOpenIntent,
} from "./shell/openIntentRouter";
import { selectOpenTargetWithCapability } from "./shell/shellDialogs";
import {
  forgetProjectWindowRestorePath,
  rememberProjectWindowRestorePath,
} from "./shell/projectWindowRestore";
import { syncSurfaceRuntimeWindowLeaseBackendStatus } from "./surfaces/surfaceRuntimeStore";
import {
  createEditorFileLoadingLoad,
  type EditorFileOpenPayload,
} from "./utils/editorFileLoader";

const PROJECT_SWITCH_VISUAL_SETTLE_MS = 260;
const OPEN_TARGET_EVENT = "arlecchino:open";

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
  useWindowLeaseBridge(syncSurfaceRuntimeWindowLeaseBackendStatus);

  const activeId = useWorkspaceStore((state) => state.activeId);
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
  const uiFontFamily = useEditorSettingsStore((state) => state.uiFontFamily);
  const customFonts = useEditorSettingsStore((state) => state.customFonts);
  const { theme: currentTheme } = useTheme();
  const activeProject = useWorkspaceStore((state) =>
    state.projects.find((project) => project.id === state.activeId),
  );
  const ready = useWorkspaceStore((state) => state.ready);
  const switchDirection = useWorkspaceStore((state) => state.switchDirection);
  const [fileToOpen, setFileToOpen] = useState<EditorFileOpenPayload | null>(
    null,
  );
  const effectiveUiScale = clampUiScale(uiScale);
  const isDetachedHost = isDetachedAppletHostRoute();

  useEffect(() => startAdaptivePerformanceMonitor(), []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ui-font-family",
      uiFontFamily,
    );
    return () => {
      document.documentElement.style.removeProperty("--ui-font-family");
    };
  }, [uiFontFamily]);

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

  const syncCurrentFramework = async () => {
    const framework = await AppFunctions.GetCurrentProjectFramework();
    useWorkspaceStore.getState().setActiveFramework(framework || null);
  };

  const handleProjectOpen = async (projectPath: string) => {
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
        alert(`Error while opening project window: ${error}`);
      }
      return;
    }

    const outgoingProjectPath =
      useWorkspaceStore
        .getState()
        .projects.find(
          (project) => project.id === useWorkspaceStore.getState().activeId,
        )?.path ?? null;
    const hadActiveProject = Boolean(state.activeId);
    usePerformanceStore.getState().resetTransientBudget();
    const openedProjectId = useWorkspaceStore
      .getState()
      .beginProjectOpen(projectPath, 1);
    setFileToOpen(null);

    try {
      if (!hadActiveProject) {
        resetProjectBoundStores();
      }
      activateProjectScope(projectPath);
      const openProjectPromise = AppFunctions.OpenProject(projectPath);
      const workspace = useWorkspaceStore.getState();
      workspace.confirmProjectSwitch(openedProjectId);
      await Promise.all([
        openProjectPromise,
        waitForProjectSwitchVisualSettle(),
      ]);
      useTerminalStore.getState().setActiveProject(projectPath);
      await syncCurrentFramework();
      startTransition(() => {
        useWorkspaceStore.getState().completeProjectSwitch(openedProjectId);
        setFileToOpen(null);
      });
      window.requestAnimationFrame(() => {
        void preloadProjectDiagnostics(projectPath);
      });
    } catch (error) {
      activateProjectScope(outgoingProjectPath);
      useTerminalStore.getState().setActiveProject(outgoingProjectPath);
      useWorkspaceStore.getState().cancelProjectSwitch(openedProjectId);
      useWorkspaceStore.getState().removeProject(openedProjectId);
      resetProjectBoundStores();
      console.error("Error opening project:", error);
      alert(`Error while opening project: ${error}`);
    }
  };

  const handleSwitchProject = async (id: string, direction?: number) => {
    const state = useWorkspaceStore.getState();
    if (id === state.activeId || state.pendingId) {
      return;
    }

    const project = state.projects.find((item) => item.id === id);
    if (!project) {
      return;
    }

    const outgoingProjectPath =
      state.projects.find((item) => item.id === state.activeId)?.path ?? null;
    usePerformanceStore.getState().resetTransientBudget();
    state.beginProjectSwitch(id, direction);
    setFileToOpen(null);

    try {
      activateProjectScope(project.path);
      const openProjectPromise = AppFunctions.OpenProject(project.path);
      const workspace = useWorkspaceStore.getState();
      workspace.confirmProjectSwitch(id);
      await Promise.all([
        openProjectPromise,
        waitForProjectSwitchVisualSettle(),
      ]);
      useTerminalStore.getState().setActiveProject(project.path);
      await syncCurrentFramework();
      startTransition(() => {
        useWorkspaceStore.getState().completeProjectSwitch(id);
        setFileToOpen(null);
      });
      window.requestAnimationFrame(() => {
        void preloadProjectDiagnostics(project.path);
      });
    } catch (error) {
      activateProjectScope(outgoingProjectPath);
      useTerminalStore.getState().setActiveProject(outgoingProjectPath);
      useWorkspaceStore.getState().cancelProjectSwitch(id);
      console.error("Error switching project:", error);
      alert(`Error while switching project: ${error}`);
    }
  };

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
        }
      })();
    };

    window.addEventListener(OPEN_TARGET_EVENT, handleOpenTargetEvent);
    return () => {
      window.removeEventListener(OPEN_TARGET_EVENT, handleOpenTargetEvent);
    };
  }, [isDetachedHost]);

  const handleBackToWelcome = async () => {
    const { activeId: currentId } = useWorkspaceStore.getState();
    if (!currentId) {
      return;
    }

    try {
      await AppFunctions.CloseProject();
      resetProjectBoundStores();
      forgetProjectWindowRestorePath(currentId);
      useWorkspaceStore.getState().removeProject(currentId);
      useWorkspaceStore.getState().setActiveFramework(null);
      useTerminalStore.getState().setActiveProject(null);
      setFileToOpen(null);
    } catch (error) {
      console.error("Error returning to welcome:", error);
      alert(`Error while closing project: ${error}`);
    }
  };

  const handleCloseProject = async (
    id: string,
    options?: { preserveProjectWindowRestore?: boolean },
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
      try {
        await AppFunctions.CloseProject();
        resetProjectBoundStores();
        if (shouldForgetProjectWindowRestore) {
          forgetProjectWindowRestorePath(id);
        }
        useWorkspaceStore.getState().removeProject(id);
        useWorkspaceStore.getState().setActiveFramework(null);
        useTerminalStore.getState().setActiveProject(null);
        setFileToOpen(null);
      } catch (error) {
        console.error("Error closing last project:", error);
        alert(`Error while closing project: ${error}`);
      }
      return;
    }

    const direction = resolveProjectSwitchDirection(
      state.projects,
      id,
      nextProject.id,
    );
    const outgoingProjectPath =
      state.projects.find((project) => project.id === state.activeId)?.path ??
      null;
    usePerformanceStore.getState().resetTransientBudget();
    state.beginProjectSwitch(nextProject.id, direction);
    setFileToOpen(null);

    try {
      activateProjectScope(nextProject.path);
      const openProjectPromise = AppFunctions.OpenProject(nextProject.path);
      const workspace = useWorkspaceStore.getState();
      workspace.confirmProjectSwitch(nextProject.id);
      await Promise.all([
        openProjectPromise,
        waitForProjectSwitchVisualSettle(),
      ]);
      useTerminalStore.getState().setActiveProject(nextProject.path);
      await syncCurrentFramework();
      startTransition(() => {
        const latestWorkspace = useWorkspaceStore.getState();
        latestWorkspace.completeProjectSwitch(nextProject.id);
        if (shouldForgetProjectWindowRestore) {
          forgetProjectWindowRestorePath(id);
        }
        latestWorkspace.removeProject(id);
        setFileToOpen(null);
      });
      window.requestAnimationFrame(() => {
        void preloadProjectDiagnostics(nextProject.path);
      });
    } catch (error) {
      activateProjectScope(outgoingProjectPath);
      useTerminalStore.getState().setActiveProject(outgoingProjectPath);
      useWorkspaceStore.getState().cancelProjectSwitch(nextProject.id);
      console.error("Error switching after close:", error);
      alert(`Error while switching project: ${error}`);
    }
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
      await handleCloseProject(id, { preserveProjectWindowRestore: true });
    } catch (error) {
      console.error("Error detaching project:", error);
      alert(`Error while opening project window: ${error}`);
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
      openProject: async (projectPath) => {
        await handleProjectOpen(projectPath);
      },
      openFile: async (path, line) => {
        const projectPath = parentDirectoryForFilePath(path);
        if (!projectPath) {
          throw new Error(`Cannot infer a project folder for file: ${path}`);
        }

        await handleProjectOpen(projectPath);
        if (!useWorkspaceStore.getState().activeId) {
          return;
        }

        setFileToOpen({
          file: createEditorFileLoadingLoad(path),
          line,
        });
      },
      openPreview: async () => {},
      focusSurface: async () => {},
    });

    return unregister;
  }, [activeId, handleProjectOpen, isDetachedHost, ready]);

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
      <div data-testid="app-shell" style={appShellStyle}>
        <div
          data-testid="app-scaled-surface"
          style={buildScaledSurfaceStyle(effectiveUiScale)}
        >
          <div className="blackprint-bg" />
        </div>
        <MCPApprovalDialog />
        <AppNotificationStack />
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
    <div data-testid="app-shell" style={appShellStyle}>
      <div
        data-testid="app-scaled-surface"
        style={buildScaledSurfaceStyle(effectiveUiScale)}
      >
        <div className="blackprint-bg" />
        <ProjectSwitchTransition
          layoutKey={activeProject?.path ?? "__welcome__"}
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
                    projectPath={activeProject.path}
                    fileToOpen={fileToOpen}
                    onFileOpened={() => setFileToOpen(null)}
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
    </div>
  );
};

export default App;
