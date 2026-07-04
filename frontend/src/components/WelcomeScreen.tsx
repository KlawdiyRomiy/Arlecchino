import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronRight,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
} from "lucide-react";

import { useIDEEvents } from "../hooks/useIDEEvents";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import * as App from "../wails/app";
import { shortcuts } from "../utils/keyboard";
import { toggleWindowFullscreen } from "../utils/windowFullscreen";
import { CloneRepositoryDialog } from "./CloneRepositoryDialog";
import { CreateProjectDialog } from "./CreateProjectDialog";
import {
  ThemeDropdown,
  themeImportStatusClass,
  useCustomThemeImport,
} from "./ThemeDropdown";
import { WindowControls } from "./ui";

const OPEN_TARGET_EVENT = "arlecchino:open";
const NEW_PROJECT_EVENT = "arlecchino:new-project";

const welcomePanelClass =
  "w-full overflow-hidden rounded-[34px] border border-[var(--shell-border-strong)] bg-[color-mix(in_srgb,var(--surface-elevated)_96%,transparent)] shadow-[inset_0_1px_0_var(--shell-inner-highlight),var(--shadow-overlay)] backdrop-blur-xl";
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

const WelcomeScreen: React.FC<{
  onProjectOpen: (path: string) => void | Promise<void>;
}> = ({ onProjectOpen }) => {
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const customThemeImport = useCustomThemeImport();
  const handleViewZoom = useCallback((action: string) => {
    applyWelcomeZoomAction(action);
  }, []);

  useIDEEvents({
    onViewZoom: handleViewZoom,
  });

  useEffect(() => {
    const bootstrap = async () => {
      await loadRecentProjects();
      setLoading(false);
    };

    void bootstrap();
  }, []);

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
  }, [showCreateDialog, showCloneDialog]);

  const loadRecentProjects = async () => {
    try {
      const projects = await App.GetRecentProjects(5);
      setRecentProjects(projects);
    } catch (error) {
      console.error("Error loading recent projects:", error);
    }
  };

  const handleOpenTarget = () => {
    window.dispatchEvent(new Event(OPEN_TARGET_EVENT));
  };

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
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--surface-canvas)]">
      <div className="absolute inset-0 z-0 bg-[var(--surface-canvas)]" />
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_120%_82%_at_50%_38%,color-mix(in_srgb,var(--surface-2)_44%,transparent)_0%,transparent_68%)]" />
      <div className="grid-bg opacity-70" />

      <div
        className="absolute left-0 right-0 top-0 z-40 h-12"
        style={{ "--wails-draggable": "drag" } as React.CSSProperties}
      />
      <div
        className="absolute left-4 top-4 z-50 flex items-center gap-2"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
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
                  recentProjects.map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      onClick={() => onProjectOpen(project.path)}
                      className="flex min-h-[76px] w-full items-center gap-4 rounded-full border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-soft)_86%,transparent)] px-4 py-3 text-left shadow-[inset_0_1px_0_var(--shell-inner-highlight)] transition-colors hover:border-[var(--shell-border-strong)] hover:bg-[color-mix(in_srgb,var(--surface-active)_66%,transparent)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
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
                      {project.version ? (
                        <div className="hidden shrink-0 rounded-full border border-[var(--shell-border)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] sm:block">
                          {project.version}
                        </div>
                      ) : null}
                      <ChevronRight
                        size={17}
                        className="shrink-0 text-[var(--text-muted)]"
                      />
                    </button>
                  ))
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
  );
};

export default WelcomeScreen;
