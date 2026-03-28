import React, { useState } from "react";
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
import {
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
    try {
      await AppFunctions.OpenProject(projectPath);
      resetProjectBoundStores();
      useWorkspaceStore.getState().addProject(projectPath);
      await syncCurrentFramework();
      await preloadProjectDiagnostics(projectPath);
      setFileToOpen(null);
    } catch (error) {
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

    state.beginProjectSwitch(id, direction);

    try {
      await AppFunctions.OpenProject(project.path);
      resetProjectBoundStores();
      await syncCurrentFramework();
      useWorkspaceStore.getState().confirmProjectSwitch(id);
      await preloadProjectDiagnostics(project.path);
      setFileToOpen(null);
    } catch (error) {
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
    state.beginProjectSwitch(nextProject.id, direction);

    try {
      await AppFunctions.OpenProject(nextProject.path);
      resetProjectBoundStores();
      await syncCurrentFramework();
      const workspace = useWorkspaceStore.getState();
      workspace.confirmProjectSwitch(nextProject.id);
      workspace.removeProject(id);
      await preloadProjectDiagnostics(nextProject.path);
      setFileToOpen(null);
    } catch (error) {
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
