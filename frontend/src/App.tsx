import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import WelcomeScreen from "./components/WelcomeScreen";
import { MainLayout } from "./components/layout/MainLayout";
import { ProjectSwitchTransition } from "./components/layout/ProjectSwitchTransition";
import ProjectScreen from "./components/ProjectScreen";
import { CommandRegistryProvider } from "./contexts/CommandRegistryContext";
import { PluginModalProvider } from "./contexts/PluginModalContext";
import * as AppFunctions from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import {
  getAdjacentProject,
  resolveProjectSwitchDirection,
  useWorkspaceStore,
} from "./stores/workspaceStore";
import { useTerminalStore } from "./stores/terminalStore";
import { useEditorSettingsStore } from "./stores/editorSettingsStore";
import {
  activateProjectScope,
  preloadProjectDiagnostics,
  resetProjectBoundStores,
} from "./utils/projectBoundState";

interface ProjectEntryCreatedEvent {
  path?: string;
  isDirectory?: boolean;
}

const dependencyManifestNames = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "go.mod",
  "go.sum",
  "go.work",
  "go.work.sum",
  "composer.json",
  "composer.lock",
  "requirements.txt",
  "requirements-dev.txt",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  "pdm.lock",
  "pipfile",
  "pipfile.lock",
  "cargo.toml",
  "cargo.lock",
  "gemfile",
  "gemfile.lock",
  "pubspec.yaml",
  "pubspec.lock",
  "package.swift",
  "packages.config",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  ".terraform.lock.hcl",
]);

function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

function isDependencyManifestPath(projectPath: string, candidatePath: string) {
  const normalizedProjectPath = normalizePath(projectPath).replace(/\/$/, "");
  const normalizedCandidate = normalizePath(candidatePath);
  if (!normalizedCandidate.startsWith(`${normalizedProjectPath}/`)) {
    return false;
  }

  const baseName = normalizedCandidate.split("/").pop()?.toLowerCase() ?? "";
  return dependencyManifestNames.has(baseName);
}

const App: React.FC = () => {
  const activeId = useWorkspaceStore((state) => state.activeId);
  const activeProject = useWorkspaceStore((state) =>
    state.projects.find((project) => project.id === state.activeId),
  );
  const ready = useWorkspaceStore((state) => state.ready);
  const switchDirection = useWorkspaceStore((state) => state.switchDirection);
  const dependencySyncMode = useEditorSettingsStore(
    (state) => state.dependencySyncMode,
  );
  const autoSyncOnProjectOpen = useEditorSettingsStore(
    (state) => state.autoSyncOnProjectOpen,
  );
  const autoSyncOnManifestChange = useEditorSettingsStore(
    (state) => state.autoSyncOnManifestChange,
  );
  const [fileToOpen, setFileToOpen] = useState<{
    path: string;
    content: string;
    name: string;
    line?: number;
  } | null>(null);
  const autoSyncedProjectRef = useRef<string | null>(null);
  const manifestSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const autoSyncEnabled = dependencySyncMode !== "manual";
  const activeProjectPath = activeProject?.path ?? "";

  const triggerDependencySync = useMemo(
    () => async (reason: "project-open" | "manifest-change") => {
      if (!autoSyncEnabled) {
        return;
      }

      try {
        await AppFunctions.SyncProjectDependencies(dependencySyncMode);
      } catch (error) {
        console.error(`Dependency sync failed during ${reason}:`, error);
      }
    },
    [autoSyncEnabled, dependencySyncMode],
  );

  useEffect(() => {
    if (
      !ready ||
      !activeProjectPath ||
      !autoSyncEnabled ||
      !autoSyncOnProjectOpen
    ) {
      return;
    }

    if (autoSyncedProjectRef.current === activeProjectPath) {
      return;
    }

    autoSyncedProjectRef.current = activeProjectPath;
    void triggerDependencySync("project-open");
  }, [
    ready,
    activeProjectPath,
    autoSyncEnabled,
    autoSyncOnProjectOpen,
    triggerDependencySync,
  ]);

  useEffect(() => {
    if (
      !ready ||
      !activeProjectPath ||
      !autoSyncEnabled ||
      !autoSyncOnManifestChange
    ) {
      return;
    }

    const queueManifestSync = (changedPath: string) => {
      if (!isDependencyManifestPath(activeProjectPath, changedPath)) {
        return;
      }

      if (manifestSyncTimerRef.current) {
        clearTimeout(manifestSyncTimerRef.current);
      }

      manifestSyncTimerRef.current = setTimeout(() => {
        manifestSyncTimerRef.current = null;
        void triggerDependencySync("manifest-change");
      }, 400);
    };

    const unsubscribeFileChanged = EventsOn("file:changed", (path) => {
      if (typeof path === "string") {
        queueManifestSync(path);
      }
    });

    const unsubscribeFileCreated = EventsOn("file:created", (path) => {
      if (typeof path === "string") {
        queueManifestSync(path);
      }
    });

    const unsubscribeProjectEntryCreated = EventsOn(
      "project:entry:created",
      (event) => {
        const payload = event as ProjectEntryCreatedEvent;
        if (typeof payload?.path === "string") {
          queueManifestSync(payload.path);
        }
      },
    );

    return () => {
      unsubscribeFileChanged();
      unsubscribeFileCreated();
      unsubscribeProjectEntryCreated();
      if (manifestSyncTimerRef.current) {
        clearTimeout(manifestSyncTimerRef.current);
        manifestSyncTimerRef.current = null;
      }
    };
  }, [
    ready,
    activeProjectPath,
    autoSyncEnabled,
    autoSyncOnManifestChange,
    triggerDependencySync,
  ]);

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
