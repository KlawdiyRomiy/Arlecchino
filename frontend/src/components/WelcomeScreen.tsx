import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { useIDEEvents } from "../hooks/useIDEEvents";
import { useAppNotificationStore } from "../stores/appNotificationStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import * as App from "../wails/app";
import { EventsOn } from "../wails/runtime";
import { writeClipboardTextWithFallback } from "../utils/clipboard";
import { shortcuts } from "../utils/keyboard";
import { toggleWindowFullscreen } from "../utils/windowFullscreen";
import { CloneRepositoryDialog } from "./CloneRepositoryDialog";
import { CreateProjectDialog } from "./CreateProjectDialog";
import {
  ThemeDropdown,
  themeImportStatusClass,
  useCustomThemeImport,
} from "./ThemeDropdown";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ui/ContextActionMenu";
import { WindowControls } from "./ui";

const OPEN_TARGET_EVENT = "arlecchino:open";
const NEW_PROJECT_EVENT = "arlecchino:new-project";

const welcomePanelClass =
  "w-full overflow-hidden rounded-[34px] border border-[var(--shell-border-strong)] bg-[color-mix(in_srgb,var(--surface-elevated)_96%,transparent)] shadow-[inset_0_1px_0_var(--shell-inner-highlight),0_1px_2px_rgba(0,0,0,0.05),0_14px_28px_-20px_rgba(0,0,0,0.34),0_30px_64px_-48px_rgba(0,0,0,0.28)] backdrop-blur-xl";
const welcomeClusterClass =
  "rounded-[34px] border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-soft)_96%,transparent)] p-2 shadow-[inset_0_1px_0_var(--shell-inner-highlight),var(--shell-shadow)]";
const welcomeActionClass =
  "flex min-h-[86px] min-w-0 items-center gap-3 rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell)_86%,transparent)] px-5 py-3 text-left text-[var(--text-primary)] transition-colors hover:border-[var(--shell-border-strong)] hover:bg-[color-mix(in_srgb,var(--surface-active)_72%,transparent)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]";
const welcomeIconClass =
  "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-strong)_78%,transparent)] text-[var(--text-primary)] shadow-[inset_0_1px_0_var(--shell-inner-highlight)]";
const welcomeThemeTriggerClass =
  "inline-flex h-10 min-w-[240px] max-w-[300px] items-center justify-between gap-2 rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-soft)_94%,transparent)] px-4 text-left text-[13px] font-medium text-[var(--text-secondary)] outline-none transition-colors hover:border-[var(--shell-border-strong)] hover:text-[var(--text-primary)] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] data-[state=open]:border-[var(--shell-border-strong)]";

const applyWelcomeZoomAction = (action: string) => {
  const settingsStore = useEditorSettingsStore.getState();

  switch (action) {
    case "in":
      settingsStore.zoomIn();
      break;
    case "out":
      settingsStore.zoomOut();
      break;
    case "reset":
      settingsStore.resetZoom();
      break;
  }
};

interface Project {
  id: number;
  name: string;
  path: string;
  version: string;
  created_at: string;
  last_opened: string;
  is_favorite: boolean;
}

type RecentProjectIndexStatusMap = Record<string, App.RecentProjectIndexStatus>;

const recentProjectIndexPathKey = (path: string) => {
  const trimmed = path.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
};

const boundedIndexPercent = (status?: App.RecentProjectIndexStatus) => {
  if (!status) {
    return 0;
  }
  return Math.max(0, Math.min(100, status.percent));
};

const RecentProjectIndexButton: React.FC<{
  status?: App.RecentProjectIndexStatus;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}> = ({ status, onClick }) => {
  const phase = status?.phase ?? "idle";
  const isIndexing = phase === "indexing";
  const isComplete = phase === "complete";
  const isError = phase === "error";
  const percent = boundedIndexPercent(status);
  const label = isIndexing
    ? "Indexing"
    : isComplete
      ? "Indexed"
      : isError
        ? "Retry"
        : "Index";
  const Icon = isIndexing
    ? Loader2
    : isComplete
      ? Check
      : isError
        ? AlertTriangle
        : Search;
  const disabled = isIndexing || isComplete;
  const title = isIndexing
    ? `Indexing ${Math.round(percent)}%`
    : isComplete
      ? "Project index is ready"
      : isError
        ? status?.error || "Retry project indexing"
        : "Index this project before opening";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative flex h-11 min-w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] ${
        isComplete
          ? "border-[color-mix(in_srgb,var(--status-success)_44%,var(--shell-border))] bg-[color-mix(in_srgb,var(--status-success)_12%,var(--surface-shell-soft))] text-[var(--status-success)]"
          : isError
            ? "border-[color-mix(in_srgb,var(--status-error)_44%,var(--shell-border))] bg-[color-mix(in_srgb,var(--status-error)_12%,var(--surface-shell-soft))] text-[var(--status-error)] hover:border-[color-mix(in_srgb,var(--status-error)_62%,var(--shell-border-strong))]"
            : "border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell)_82%,transparent)] text-[var(--text-secondary)] hover:border-[var(--shell-border-strong)] hover:text-[var(--text-primary)] disabled:hover:border-[var(--shell-border)] disabled:hover:text-[var(--text-secondary)]"
      }`}
    >
      {isIndexing ? (
        <span className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--surface-2)_72%,transparent)]">
          <span
            className="block h-full origin-left rounded-full bg-[var(--accent-primary)] transition-transform duration-200"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        </span>
      ) : null}
      <span className="relative flex items-center gap-1.5 pb-0.5">
        <Icon size={14} className={isIndexing ? "animate-spin" : ""} />
        <span>{label}</span>
      </span>
    </button>
  );
};

const WelcomeScreen: React.FC<{
  onProjectOpen: (path: string) => void | Promise<void>;
}> = ({ onProjectOpen }) => {
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [projectIndexStatuses, setProjectIndexStatuses] =
    useState<RecentProjectIndexStatusMap>({});
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const customThemeImport = useCustomThemeImport();
  const notify = useCallback(
    (kind: "success" | "error", title: string, message?: string) => {
      useAppNotificationStore.getState().addNotification({
        kind,
        source: "Welcome",
        title,
        message,
      });
    },
    [],
  );
  const handleViewZoom = useCallback((action: string) => {
    applyWelcomeZoomAction(action);
  }, []);
  const handleOpenTarget = useCallback(() => {
    window.dispatchEvent(new Event(OPEN_TARGET_EVENT));
  }, []);
  const loadRecentProjects = useCallback(async () => {
    try {
      const projects = await App.GetRecentProjects(5);
      setRecentProjects(projects);
    } catch (error) {
      console.error("Error loading recent projects:", error);
      notify(
        "error",
        "Recent projects unavailable",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [notify]);
  const upsertProjectIndexStatus = useCallback(
    (status: App.RecentProjectIndexStatus) => {
      const key = recentProjectIndexPathKey(status.projectPath);
      if (!key) {
        return;
      }
      setProjectIndexStatuses((current) => ({
        ...current,
        [key]: status,
      }));
    },
    [],
  );

  useIDEEvents({
    onViewZoom: handleViewZoom,
  });

  useEffect(() => {
    const bootstrap = async () => {
      await loadRecentProjects();
      setLoading(false);
    };

    void bootstrap();
  }, [loadRecentProjects]);

  useEffect(() => {
    return EventsOn<[App.RecentProjectIndexStatus]>(
      "recent-project:index",
      upsertProjectIndexStatus,
    );
  }, [upsertProjectIndexStatus]);

  useEffect(() => {
    if (recentProjects.length === 0) {
      setProjectIndexStatuses({});
      return;
    }

    let disposed = false;
    const paths = recentProjects.map((project) => project.path);
    App.GetRecentProjectIndexStatuses(paths)
      .then((statuses) => {
        if (disposed) {
          return;
        }
        setProjectIndexStatuses((current) => {
          const next = { ...current };
          statuses.forEach((status) => {
            const key = recentProjectIndexPathKey(status.projectPath);
            if (key) {
              next[key] = status;
            }
          });
          return next;
        });
      })
      .catch((error) => {
        console.error("Error loading recent project index statuses:", error);
      });

    return () => {
      disposed = true;
    };
  }, [recentProjects]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shortcuts.zoomIn(event)) {
        event.preventDefault();
        applyWelcomeZoomAction("in");
        return;
      }

      if (shortcuts.zoomOut(event)) {
        event.preventDefault();
        applyWelcomeZoomAction("out");
        return;
      }

      if (shortcuts.zoomReset(event)) {
        event.preventDefault();
        applyWelcomeZoomAction("reset");
        return;
      }

      if (
        shortcuts.toggleWindowFullscreen(event) &&
        !showCreateDialog &&
        !showCloneDialog
      ) {
        event.preventDefault();
        void toggleWindowFullscreen();
        return;
      }

      if (
        shortcuts.openProject(event) &&
        !showCreateDialog &&
        !showCloneDialog
      ) {
        event.preventDefault();
        handleOpenTarget();
        return;
      }

      if (
        shortcuts.newProject(event) &&
        !showCreateDialog &&
        !showCloneDialog
      ) {
        event.preventDefault();
        setShowCreateDialog(true);
      }
    };

    const handleNewProjectEvent = () => {
      if (!showCloneDialog) {
        setShowCreateDialog(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener(NEW_PROJECT_EVENT, handleNewProjectEvent);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener(NEW_PROJECT_EVENT, handleNewProjectEvent);
    };
  }, [handleOpenTarget, showCreateDialog, showCloneDialog]);

  const handleRefreshRecentProjects = useCallback(() => {
    void loadRecentProjects();
  }, [loadRecentProjects]);

  const handleCopyProjectPath = useCallback(
    async (path: string) => {
      const copied = await writeClipboardTextWithFallback(path);
      if (!copied) {
        notify("error", "Could not copy project path");
        return;
      }
      notify("success", "Project path copied");
    },
    [notify],
  );

  const handleRevealProjectPath = useCallback(
    async (path: string) => {
      try {
        await App.RevealPathInFileManager(path);
      } catch (error) {
        notify(
          "error",
          "Could not reveal project",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [notify],
  );

  const handleRemoveRecentProject = useCallback(
    async (project: Project) => {
      try {
        await App.RemoveRecentProject(project.path);
        setRecentProjects((current) =>
          current.filter(
            (entry) => entry.id !== project.id && entry.path !== project.path,
          ),
        );
        setProjectIndexStatuses((current) => {
          const key = recentProjectIndexPathKey(project.path);
          if (!key || !(key in current)) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
      } catch (error) {
        notify(
          "error",
          "Could not remove recent project",
          error instanceof Error ? error.message : String(error),
        );
        void loadRecentProjects();
      }
    },
    [loadRecentProjects, notify],
  );

  const handleClearRecentProjects = useCallback(async () => {
    try {
      await App.ClearRecentProjects();
      setRecentProjects([]);
      setProjectIndexStatuses({});
    } catch (error) {
      notify(
        "error",
        "Could not clear recent projects",
        error instanceof Error ? error.message : String(error),
      );
      void loadRecentProjects();
    }
  }, [loadRecentProjects, notify]);

  const startRecentProjectIndex = useCallback(
    async (project: Project) => {
      upsertProjectIndexStatus({
        projectPath: project.path,
        phase: "indexing",
        current: 0,
        total: 0,
        percent: 0,
        updatedAt: new Date().toISOString(),
      });

      try {
        upsertProjectIndexStatus(
          await App.StartRecentProjectIndex(project.path),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Project indexing failed.";
        console.error("Error indexing recent project:", error);
        upsertProjectIndexStatus({
          projectPath: project.path,
          phase: "error",
          current: 0,
          total: 0,
          percent: 0,
          error: message,
          updatedAt: new Date().toISOString(),
        });
      }
    },
    [upsertProjectIndexStatus],
  );

  const welcomeContextMenuItems = useMemo<ContextActionMenuItem[]>(
    () => [
      {
        key: "open",
        label: "Open",
        shortcut: "cmd+o",
        icon: <FolderOpen size={14} />,
        onSelect: handleOpenTarget,
      },
      {
        key: "new-project",
        label: "New Project",
        shortcut: "cmd+n",
        icon: <Plus size={14} />,
        onSelect: () => setShowCreateDialog(true),
      },
      {
        key: "clone-repository",
        label: "Clone Repository",
        icon: <GitBranch size={14} />,
        onSelect: () => setShowCloneDialog(true),
      },
      { separator: true },
      {
        key: "refresh-recent",
        label: "Refresh Recent Projects",
        icon: <RefreshCw size={14} />,
        onSelect: handleRefreshRecentProjects,
      },
      {
        key: "clear-recent",
        label: "Clear Recent Projects",
        icon: <Trash2 size={14} />,
        danger: true,
        hidden: recentProjects.length === 0,
        onSelect: () => {
          void handleClearRecentProjects();
        },
      },
    ],
    [
      handleClearRecentProjects,
      handleOpenTarget,
      handleRefreshRecentProjects,
      recentProjects.length,
    ],
  );

  const buildRecentProjectContextItems = useCallback(
    (project: Project): ContextActionMenuItem[] => {
      const indexStatus =
        projectIndexStatuses[recentProjectIndexPathKey(project.path)];
      const indexPhase = indexStatus?.phase ?? "idle";
      const indexDisabled =
        indexPhase === "indexing" || indexPhase === "complete";

      return [
        {
          key: "open",
          label: "Open",
          icon: <FolderOpen size={14} />,
          onSelect: () => {
            void onProjectOpen(project.path);
          },
        },
        {
          key: "index",
          label:
            indexPhase === "complete"
              ? "Indexed"
              : indexPhase === "error"
                ? "Retry Index"
                : indexPhase === "indexing"
                  ? "Indexing"
                  : "Index Project",
          icon:
            indexPhase === "complete" ? (
              <Check size={14} />
            ) : indexPhase === "error" ? (
              <AlertTriangle size={14} />
            ) : indexPhase === "indexing" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            ),
          disabled: indexDisabled,
          onSelect: () => {
            void startRecentProjectIndex(project);
          },
        },
        { separator: true },
        {
          key: "copy-path",
          label: "Copy Project Path",
          icon: <Copy size={14} />,
          onSelect: () => {
            void handleCopyProjectPath(project.path);
          },
        },
        {
          key: "reveal",
          label: "Reveal in File Manager",
          icon: <ExternalLink size={14} />,
          onSelect: () => {
            void handleRevealProjectPath(project.path);
          },
        },
        { separator: true },
        {
          key: "remove-recent",
          label: "Remove from Recent",
          icon: <X size={14} />,
          danger: true,
          onSelect: () => {
            void handleRemoveRecentProject(project);
          },
        },
        {
          key: "clear-recent",
          label: "Clear Recent Projects",
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => {
            void handleClearRecentProjects();
          },
        },
      ];
    },
    [
      handleClearRecentProjects,
      handleCopyProjectPath,
      handleRemoveRecentProject,
      handleRevealProjectPath,
      onProjectOpen,
      projectIndexStatuses,
      startRecentProjectIndex,
    ],
  );

  const handleIndexRecentProject = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>, project: Project) => {
      event.preventDefault();
      event.stopPropagation();
      await startRecentProjectIndex(project);
    },
    [startRecentProjectIndex],
  );

  if (loading) {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-[var(--surface-canvas)] px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_38%,color-mix(in_srgb,var(--surface-2)_40%,transparent)_0%,transparent_66%)]" />
        <div className="grid-bg opacity-70" />
        <div className={`${welcomePanelClass} relative max-w-[860px]`}>
          <div className="px-10 pb-6 pt-9">
            <div className="h-7 w-44 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--surface-2)_80%,transparent)]" />
            <div className="mt-3 h-4 w-64 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--surface-2)_64%,transparent)]" />
          </div>
          <div className="space-y-5 px-7 pb-7">
            <div className={welcomeClusterClass}>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="h-[86px] animate-pulse rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell)_86%,transparent)]" />
                <div className="h-[86px] animate-pulse rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell)_86%,transparent)]" />
                <div className="h-[86px] animate-pulse rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell)_86%,transparent)]" />
              </div>
            </div>
            <div className="flex h-40 items-center justify-center rounded-[28px] border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-soft)_86%,transparent)] text-[var(--text-muted)]">
              <Loader2 size={20} className="animate-spin" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ContextActionMenu
      items={welcomeContextMenuItems}
      nativeScope="welcome-screen"
      nativeTargetId="welcome"
      ignoredTargetSelector="[data-welcome-recent-project]"
    >
      <div className="relative flex h-full flex-col overflow-hidden bg-[var(--surface-canvas)]">
        <div className="absolute inset-0 z-0 bg-[var(--surface-canvas)]" />
        <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_120%_82%_at_50%_38%,color-mix(in_srgb,var(--surface-2)_44%,transparent)_0%,transparent_68%)]" />
        <div className="grid-bg opacity-70" />

        <div
          className="absolute inset-x-2 top-2 z-50 flex h-14 items-center gap-2 border-b border-transparent px-3"
          style={
            {
              "--wails-draggable": "drag",
              transform: "translateY(2px)",
            } as React.CSSProperties
          }
          data-testid="welcome-window-controls-slot"
        >
          <WindowControls />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
          className="absolute inset-0 z-20 mx-auto flex w-full max-w-[920px] items-center justify-center overflow-y-auto px-6 py-20"
        >
          <div className={welcomePanelClass}>
            <div className="flex flex-col gap-5 px-10 pb-7 pt-9 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-[30px] font-semibold text-[var(--text-primary)]">
                  Workspace
                </h1>
                <p className="mt-1 text-[17px] text-[var(--text-secondary)]">
                  Open, create, and return to work.
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                <ThemeDropdown
                  triggerClassName={welcomeThemeTriggerClass}
                  customThemeImport={customThemeImport}
                  align="end"
                  contentWidth="min(380px, calc((100vw * var(--ui-inverse-scale, 1)) - 32px))"
                />
                <input
                  ref={customThemeImport.inputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={customThemeImport.handleFileChange}
                />
                {customThemeImport.status ? (
                  <div
                    className={`${themeImportStatusClass(
                      customThemeImport.status.tone,
                    )} max-w-[220px] text-left sm:text-right`}
                  >
                    {customThemeImport.status.message}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-7 px-7 pb-7">
              <div className={welcomeClusterClass}>
                <div className="grid gap-3 lg:grid-cols-3">
                  <button
                    type="button"
                    onClick={handleOpenTarget}
                    className={welcomeActionClass}
                  >
                    <div className={welcomeIconClass}>
                      <FolderOpen size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[16px] font-medium leading-tight text-[var(--text-primary)]">
                        Open
                      </div>
                      <div className="mt-1 truncate text-[13px] leading-tight text-[var(--text-muted)]">
                        Choose a folder
                      </div>
                    </div>
                    <span className="shell-kbd text-[11px]">⌘O</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCreateDialog(true)}
                    className={welcomeActionClass}
                  >
                    <div
                      className={`${welcomeIconClass} text-[var(--accent-primary)]`}
                    >
                      <Plus size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[16px] font-medium leading-tight text-[var(--text-primary)]">
                        New Project
                      </div>
                      <div className="mt-1 truncate text-[13px] leading-tight text-[var(--text-muted)]">
                        Create workspace
                      </div>
                    </div>
                    <span className="shell-kbd text-[11px]">⌘N</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCloneDialog(true)}
                    className={welcomeActionClass}
                  >
                    <div
                      className={`${welcomeIconClass} text-[var(--accent-brand)]`}
                    >
                      <GitBranch size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[16px] font-medium leading-tight text-[var(--text-primary)]">
                        Clone
                      </div>
                      <div className="mt-1 truncate text-[13px] leading-tight text-[var(--text-muted)]">
                        Clone repository
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[20px] font-semibold text-[var(--text-primary)]">
                    Recent
                  </div>
                </div>

                <div className="space-y-2">
                  {recentProjects.length > 0 ? (
                    recentProjects.map((project) => {
                      const indexStatus =
                        projectIndexStatuses[
                          recentProjectIndexPathKey(project.path)
                        ];

                      return (
                        <ContextActionMenu
                          key={project.id}
                          items={() => buildRecentProjectContextItems(project)}
                          nativeScope="welcome-recent-project"
                          nativeTargetId={`recent-project-${project.id}`}
                        >
                          <div
                            data-welcome-recent-project
                            className="flex min-h-[76px] w-full items-center gap-3 rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-soft)_86%,transparent)] px-3 py-3 shadow-[inset_0_1px_0_var(--shell-inner-highlight)] transition-colors hover:border-[var(--shell-border-strong)] hover:bg-[color-mix(in_srgb,var(--surface-active)_66%,transparent)]"
                          >
                            <button
                              type="button"
                              onClick={() => onProjectOpen(project.path)}
                              className="flex min-w-0 flex-1 items-center gap-4 rounded-full px-1 text-left focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
                            >
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-strong)_78%,transparent)] text-[14px] font-medium text-[var(--text-primary)]">
                                {project.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[16px] font-medium leading-tight text-[var(--text-primary)]">
                                  {project.name}
                                </div>
                                <div className="mt-1 truncate text-[13px] leading-tight text-[var(--text-muted)]">
                                  {project.path}
                                </div>
                              </div>
                              <ChevronRight
                                size={17}
                                className="shrink-0 text-[var(--text-muted)]"
                              />
                            </button>

                            <div className="flex shrink-0 items-center gap-2">
                              {project.version ? (
                                <div className="hidden shrink-0 rounded-full border border-[var(--shell-border)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] lg:block">
                                  {project.version}
                                </div>
                              ) : null}
                              <RecentProjectIndexButton
                                status={indexStatus}
                                onClick={(event) =>
                                  handleIndexRecentProject(event, project)
                                }
                              />
                            </div>
                          </div>
                        </ContextActionMenu>
                      );
                    })
                  ) : (
                    <div className="rounded-[28px] border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-soft)_86%,transparent)] px-5 py-6 text-[15px] text-[var(--text-muted)]">
                      No recent projects yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onProjectOpen={onProjectOpen}
        />
        <CloneRepositoryDialog
          open={showCloneDialog}
          onOpenChange={setShowCloneDialog}
          onProjectOpen={onProjectOpen}
        />
      </div>
    </ContextActionMenu>
  );
};

export default WelcomeScreen;
