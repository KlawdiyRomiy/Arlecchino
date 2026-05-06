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
import { registerOpenIntentDispatcher } from "./shell/openIntentRouter";
import { syncSurfaceRuntimeWindowLeaseBackendStatus } from "./surfaces/surfaceRuntimeStore";
import {
  createEditorFileLoadingLoad,
  type EditorFileOpenPayload,
} from "./utils/editorFileLoader";

const PROJECT_SWITCH_VISUAL_SETTLE_MS = 260;

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

    try {
      resetProjectBoundStores();
      activateProjectScope(projectPath);
      await AppFunctions.OpenProject(projectPath);
      useWorkspaceStore.getState().addProject(projectPath);
      useTerminalStore.getState().setActiveProject(projectPath);
      await syncCurrentFramework();
      void preloadProjectDiagnostics(projectPath);
      setFileToOpen(null);
    } catch (error) {
      useTerminalStore.getState().setActiveProject(outgoingProjectPath);
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
      const workspace = useWorkspaceStore.getState();
      activateProjectScope(project.path);
      workspace.confirmProjectSwitch(id);
      await waitForProjectSwitchVisualSettle();
      await AppFunctions.OpenProject(project.path);
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

  const handleBackToWelcome = async () => {
    const { activeId: currentId } = useWorkspaceStore.getState();
    if (!currentId) {
      return;
    }

    try {
      await AppFunctions.CloseProject();
      resetProjectBoundStores();
      useWorkspaceStore.getState().removeProject(currentId);
      useWorkspaceStore.getState().setActiveFramework(null);
      useTerminalStore.getState().setActiveProject(null);
      setFileToOpen(null);
    } catch (error) {
      console.error("Error returning to welcome:", error);
      alert(`Error while closing project: ${error}`);
    }
  };

  const handleCloseProject = async (id: string) => {
    const state = useWorkspaceStore.getState();
    if (state.pendingId) {
      return;
    }

    const closingActive = state.activeId === id;
    if (!closingActive) {
      state.removeProject(id);
      return;
    }

    const nextProject = getAdjacentProject(state.projects, id);
    if (!nextProject) {
      try {
        await AppFunctions.CloseProject();
        resetProjectBoundStores();
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
      const workspace = useWorkspaceStore.getState();
      activateProjectScope(nextProject.path);
      workspace.confirmProjectSwitch(nextProject.id);
      await waitForProjectSwitchVisualSettle();
      await AppFunctions.OpenProject(nextProject.path);
      useTerminalStore.getState().setActiveProject(nextProject.path);
      await syncCurrentFramework();
      startTransition(() => {
        const latestWorkspace = useWorkspaceStore.getState();
        latestWorkspace.completeProjectSwitch(nextProject.id);
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

  if (activeId && activeProject) {
    return (
      <div data-testid="app-shell" style={appShellStyle}>
        <div
          data-testid="app-scaled-surface"
          style={buildScaledSurfaceStyle(effectiveUiScale)}
        >
          <div className="blackprint-bg" />
          <ProjectSwitchTransition
            layoutKey={activeProject.path}
            direction={switchDirection}
          >
            <PluginModalProvider key={activeProject.path}>
              <CommandRegistryProvider>
                <MainLayout
                  key={activeProject.path}
                  onFileOpen={handleFileOpen}
                  onBackToWelcome={handleBackToWelcome}
                  onProjectOpen={handleProjectOpen}
                  onSwitchProject={handleSwitchProject}
                  onCloseProject={handleCloseProject}
                >
                  <ProjectScreen
                    projectPath={activeProject.path}
                    fileToOpen={fileToOpen}
                    onFileOpened={() => setFileToOpen(null)}
                  />
                </MainLayout>
              </CommandRegistryProvider>
            </PluginModalProvider>
          </ProjectSwitchTransition>
        </div>
        <MCPApprovalDialog />
        <AppNotificationStack />
      </div>
    );
  }

  return (
    <div data-testid="app-shell" style={appShellStyle}>
      <div
        data-testid="app-scaled-surface"
        style={buildScaledSurfaceStyle(effectiveUiScale)}
      >
        <div className="blackprint-bg" />
        <WelcomeScreen onProjectOpen={handleProjectOpen} />
      </div>
      <MCPApprovalDialog />
      <AppNotificationStack />
    </div>
  );
};

export default App;
