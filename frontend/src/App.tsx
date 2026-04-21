import React, { startTransition, useEffect, useState } from "react";
import WelcomeScreen from "./components/WelcomeScreen";
import { MainLayout } from "./components/layout/MainLayout";
import { ProjectSwitchTransition } from "./components/layout/ProjectSwitchTransition";
import ProjectScreen from "./components/ProjectScreen";
import { CommandRegistryProvider } from "./contexts/CommandRegistryContext";
import { PluginModalProvider } from "./contexts/PluginModalContext";
import * as AppFunctions from "../wailsjs/go/main/App";
import {
  getAdjacentProject,
  resolveProjectSwitchDirection,
  useWorkspaceStore,
} from "./stores/workspaceStore";
import { useTerminalStore } from "./stores/terminalStore";
import {
  activateProjectScope,
  preloadProjectDiagnostics,
  resetProjectBoundStores,
} from "./utils/projectBoundState";

const App: React.FC = () => {
  const activeId = useWorkspaceStore((state) => state.activeId);
  const activeProject = useWorkspaceStore((state) =>
    state.projects.find((project) => project.id === state.activeId),
  );
  const ready = useWorkspaceStore((state) => state.ready);
  const switchDirection = useWorkspaceStore((state) => state.switchDirection);
  const [fileToOpen, setFileToOpen] = useState<{
    path: string;
    content: string;
    name: string;
    line?: number;
  } | null>(null);
  const syncCurrentFramework = async () => {
    const framework = await AppFunctions.GetCurrentProjectFramework();
    useWorkspaceStore.getState().setActiveFramework(framework || null);
  };

  const handleProjectOpen = async (projectPath: string) => {
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
      await preloadProjectDiagnostics(projectPath);
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
    state.beginProjectSwitch(id, direction);

    try {
      activateProjectScope(project.path);
      const openProjectRequest = AppFunctions.OpenProject(project.path);
      useWorkspaceStore.getState().confirmProjectSwitch(id);
      useTerminalStore.getState().setActiveProject(project.path);
      await openProjectRequest;
      await syncCurrentFramework();
      await preloadProjectDiagnostics(project.path);
      startTransition(() => {
        useWorkspaceStore.getState().completeProjectSwitch(id);
        setFileToOpen(null);
      });
    } catch (error) {
      activateProjectScope(outgoingProjectPath);
      useTerminalStore.getState().setActiveProject(outgoingProjectPath);
      useWorkspaceStore.getState().cancelProjectSwitch(id);
      console.error("Error switching project:", error);
      alert(`Error while switching project: ${error}`);
    }
  };

  const handleFileOpen = (
    path: string,
    content: string,
    name: string,
    line?: number,
  ) => {
    setFileToOpen({ path, content, name, line });
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
    state.beginProjectSwitch(nextProject.id, direction);

    try {
      activateProjectScope(nextProject.path);
      const openProjectRequest = AppFunctions.OpenProject(nextProject.path);
      useWorkspaceStore.getState().confirmProjectSwitch(nextProject.id);
      useTerminalStore.getState().setActiveProject(nextProject.path);
      await openProjectRequest;
      await syncCurrentFramework();
      await preloadProjectDiagnostics(nextProject.path);
      startTransition(() => {
        const workspace = useWorkspaceStore.getState();
        workspace.completeProjectSwitch(nextProject.id);
        workspace.removeProject(id);
        setFileToOpen(null);
      });
    } catch (error) {
      activateProjectScope(outgoingProjectPath);
      useTerminalStore.getState().setActiveProject(outgoingProjectPath);
      useWorkspaceStore.getState().cancelProjectSwitch(nextProject.id);
      console.error("Error switching after close:", error);
      alert(`Error while switching project: ${error}`);
    }
  };

  if (!ready) {
    return <div className="blackprint-bg" />;
  }

  if (activeId && activeProject) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          overscrollBehavior: "none",
        }}
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
    );
  }

  return (
    <>
      <div className="blackprint-bg" />
      <WelcomeScreen onProjectOpen={handleProjectOpen} />
    </>
  );
};

export default App;
