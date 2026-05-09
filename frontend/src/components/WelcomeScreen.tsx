import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FolderOpen, GitBranch, Loader2, Sparkles } from "lucide-react";

import * as App from "../wails/app";
import { shortcuts } from "../utils/keyboard";
import { toggleWindowFullscreen } from "../utils/windowFullscreen";
import { CloneRepositoryDialog } from "./CloneRepositoryDialog";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { WindowControls } from "./ui";

const OPEN_TARGET_EVENT = "arlecchino:open";
const NEW_PROJECT_EVENT = "arlecchino:new-project";

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

  useEffect(() => {
    const bootstrap = async () => {
      await loadRecentProjects();
      setLoading(false);
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
      <div className="flex h-screen items-center justify-center bg-[var(--surface-canvas)] px-6">
        <div className="w-full max-w-[760px] overflow-hidden rounded-[22px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)]">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-6 py-5">
            <div className="h-3 w-28 animate-pulse rounded-full bg-white/8" />
            <div className="mt-4 h-8 w-80 animate-pulse rounded-full bg-white/8" />
          </div>
          <div className="space-y-3 px-6 py-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="h-24 animate-pulse rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)]" />
              <div className="h-24 animate-pulse rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)]" />
              <div className="h-24 animate-pulse rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)]" />
            </div>
            <div className="flex h-64 items-center justify-center rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-muted)]">
              <Loader2 size={20} className="animate-spin" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[var(--surface-canvas)]">
      <div className="fixed inset-0 z-0 bg-[var(--surface-canvas)]" />
      <div className="grid-bg" />
      <div className="blackprint-bg" />

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
        className="absolute inset-0 z-20 mx-auto flex w-full max-w-[760px] items-center justify-center overflow-y-auto px-6 pb-52 pt-12"
      >
        <div className="w-full overflow-hidden rounded-[22px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)]">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-6 py-5">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Workspace
            </div>
            <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              Open, create, and return to work.
            </h1>
          </div>

          <div className="px-6 py-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                onClick={handleOpenTarget}
                className="flex items-center gap-3 rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-4 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-primary)]">
                  <FolderOpen size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Open...
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    Choose a project folder or file.
                  </div>
                </div>
                <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                  ⌘O
                </span>
              </button>

              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-3 rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-4 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-primary)]">
                  <Sparkles size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    New Project
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    Create a fresh workspace with the current defaults.
                  </div>
                </div>
                <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                  ⌘N
                </span>
              </button>

              <button
                onClick={() => setShowCloneDialog(true)}
                className="flex items-center gap-3 rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-4 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-primary)]">
                  <GitBranch size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Clone Repository
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    Clone a Git remote and open the workspace.
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Recent Projects
                </div>
              </div>

              <div className="overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
                {recentProjects.length > 0 ? (
                  recentProjects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => onProjectOpen(project.path)}
                      className="flex w-full items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--focus-ring)] last:border-b-0"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] font-mono text-[11px] text-[var(--text-primary)]">
                        {project.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {project.name}
                        </div>
                        <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
                          {project.path}
                        </div>
                      </div>
                      {project.version ? (
                        <div className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {project.version}
                        </div>
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-6 text-sm text-[var(--text-muted)]">
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
