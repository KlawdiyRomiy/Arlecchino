import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  GitBranch,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";

import * as App from "../../wailsjs/go/main/App";
import { welcome } from "../../wailsjs/go/models";
import { shortcuts } from "../utils/keyboard";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ThemeToggle, WindowControls } from "./ui";

interface Project {
  id: number;
  name: string;
  path: string;
  version: string;
  created_at: string;
  last_opened: string;
  is_favorite: boolean;
}

type ToolStatus = welcome.ToolStatus;

const WelcomeScreen: React.FC<{ onProjectOpen: (path: string) => void }> = ({
  onProjectOpen,
}) => {
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [envStatus, setEnvStatus] = useState<Record<string, boolean>>({});
  const [devTools, setDevTools] = useState<ToolStatus[]>([]);
  const [lspServers, setLspServers] = useState<ToolStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      await Promise.all([
        loadRecentProjects(),
        validateEnvironment(),
        loadToolsStatus(),
      ]);
      setLoading(false);
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shortcuts.openProject(event) && !showCreateDialog) {
        event.preventDefault();
        void handleOpenProject();
        return;
      }

      if (shortcuts.newProject(event) && !showCreateDialog) {
        event.preventDefault();
        setShowCreateDialog(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [showCreateDialog]);

  const loadRecentProjects = async () => {
    try {
      const projects = await App.GetRecentProjects(5);
      setRecentProjects(projects);
    } catch (error) {
      console.error("Error loading recent projects:", error);
    }
  };

  const validateEnvironment = async () => {
    try {
      const status = await App.ValidateEnvironment();
      setEnvStatus(status);
    } catch (error) {
      console.error("Error validating environment:", error);
    }
  };

  const loadToolsStatus = async () => {
    try {
      const tools = await App.GetDevToolsStatus();
      const lsp = await App.GetLSPInstallStatus();
      setDevTools(tools || []);
      setLspServers(lsp || []);
    } catch (error) {
      console.error("Error loading tools status:", error);
    }
  };

  const handleInstallTool = async (toolName: string) => {
    setInstalling(toolName);
    setInstallError(null);
    try {
      await App.InstallDevTool(toolName);
      await loadToolsStatus();
    } catch (error) {
      console.error(`Error installing ${toolName}:`, error);
      setInstallError(
        error instanceof Error
          ? error.message
          : `Failed to install ${toolName}`,
      );
    } finally {
      setInstalling(null);
    }
  };

  const handleOpenProject = async () => {
    try {
      const selectedPath = await App.SelectDirectory(
        "Choose project directory",
      );
      if (selectedPath) {
        onProjectOpen(selectedPath);
      }
    } catch (error) {
      console.error("Error opening project:", error);
    }
  };

  const environmentEntries = useMemo(
    () => Object.entries(envStatus),
    [envStatus],
  );
  const readyEnvironmentCount = useMemo(
    () => environmentEntries.filter(([, ready]) => ready).length,
    [environmentEntries],
  );
  const missingToolsCount = useMemo(
    () =>
      devTools.filter((tool) => !tool.available).length +
      lspServers.filter((server) => !server.available).length,
    [devTools, lspServers],
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--surface-canvas)] px-6">
        <div className="w-full max-w-[1120px] overflow-hidden rounded-[22px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)]">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-6 py-5">
            <div className="h-3 w-28 animate-pulse rounded-full bg-white/8" />
            <div className="mt-4 h-8 w-80 animate-pulse rounded-full bg-white/8" />
          </div>
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.2fr)_320px]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-24 animate-pulse rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)]" />
                <div className="h-24 animate-pulse rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)]" />
              </div>
              <div className="h-64 animate-pulse rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)]" />
            </div>
            <div className="flex items-center justify-center rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-muted)]">
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
        className="absolute right-6 top-6 z-50 flex items-center gap-2"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <ThemeToggle />
        <WindowControls />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 }}
        className="relative z-20 mx-auto flex h-full w-full max-w-[1120px] flex-1 items-center px-6 pb-10 pt-20"
      >
        <div className="grid w-full grid-cols-[minmax(0,1.2fr)_360px] gap-6">
          <div className="rounded-[22px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)]">
            <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-6 py-5">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                Workspace
              </div>
              <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                Open, create, and return to work.
              </h1>
              <p className="mt-2 max-w-[560px] text-sm text-[var(--text-secondary)]">
                Arlecchino starts with a calm, keyboard-first surface: open a
                folder, create a new project, or jump back into a recent
                workspace.
              </p>
            </div>

            <div className="px-6 py-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={handleOpenProject}
                  className="flex items-center gap-3 rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-4 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-primary)]">
                    <FolderOpen size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      Open Project
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      Select a directory and load it into the workspace.
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
              </div>

              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Recent Projects
                    </div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">
                      Continue with the last workspaces you opened.
                    </div>
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Enter to open
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
                        <div className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {project.version || "project"}
                        </div>
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

          <div className="flex flex-col gap-4">
            <div className="rounded-[20px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)]">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Readiness
                </div>
              </div>

              <div className="space-y-4 px-5 py-5">
                <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Environment checks
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    {readyEnvironmentCount}/{environmentEntries.length || 0}{" "}
                    startup checks ready
                  </div>
                  {environmentEntries.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {environmentEntries.map(([name, ready]) => (
                        <span
                          key={name}
                          className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                            ready
                              ? "border-[color:var(--status-success)]/25 bg-[color:var(--status-success)]/10 text-[var(--status-success)]"
                              : "border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)]"
                          }`}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        Tooling and language servers
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        Install missing dependencies without leaving the startup
                        surface.
                      </div>
                    </div>
                    <button
                      onClick={() => setShowToolsPanel((value) => !value)}
                      className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
                    >
                      {showToolsPanel ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                      {showToolsPanel ? "Hide" : "Show"}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {devTools.length} dev tools
                    </span>
                    <span className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {lspServers.length} LSP servers
                    </span>
                    {missingToolsCount > 0 && (
                      <span className="rounded-full border border-[color:var(--status-warning)]/25 bg-[color:var(--status-warning)]/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--status-warning)]">
                        {missingToolsCount} missing
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Shortcuts
                  </div>
                  <div className="space-y-2 font-mono text-[11px] text-[var(--text-secondary)]">
                    <div className="flex items-center justify-between">
                      <span>Open project</span>
                      <span>⌘O</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>New project</span>
                      <span>⌘N</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Source control</span>
                      <span>⇧⌘G</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {showToolsPanel && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="rounded-[20px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)]"
              >
                <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-4">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Tool Status
                  </div>
                </div>

                <div className="max-h-[40vh] space-y-5 overflow-y-auto px-5 py-5">
                  {installError && (
                    <div className="rounded-xl border border-[color:var(--status-error)]/25 bg-[color:var(--status-error)]/10 px-3 py-2 text-sm text-[var(--status-error)]">
                      {installError}
                    </div>
                  )}

                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                      <Sparkles
                        size={15}
                        className="text-[var(--accent-primary)]"
                      />
                      Development Tools
                    </div>
                    <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
                      {devTools.map((tool) => (
                        <div
                          key={tool.name}
                          className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            {tool.available ? (
                              <CheckCircle
                                size={16}
                                className="text-[var(--status-success)]"
                              />
                            ) : (
                              <XCircle
                                size={16}
                                className="text-[var(--text-muted)]"
                              />
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-sm text-[var(--text-primary)]">
                                {tool.name}
                              </div>
                              {tool.version && (
                                <div className="truncate text-[11px] text-[var(--text-muted)]">
                                  {tool.version}
                                </div>
                              )}
                            </div>
                          </div>
                          {!tool.available && (
                            <button
                              onClick={() =>
                                handleInstallTool(tool.name.toLowerCase())
                              }
                              disabled={installing !== null}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)] disabled:opacity-50"
                            >
                              {installing === tool.name.toLowerCase() ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Download size={12} />
                              )}
                              Install
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                      <GitBranch
                        size={15}
                        className="text-[var(--status-info)]"
                      />
                      LSP Servers
                    </div>
                    <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
                      {lspServers.map((server) => (
                        <div
                          key={server.name}
                          className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            {server.available ? (
                              <CheckCircle
                                size={16}
                                className="text-[var(--status-success)]"
                              />
                            ) : (
                              <XCircle
                                size={16}
                                className="text-[var(--text-muted)]"
                              />
                            )}
                            <div className="truncate font-mono text-sm text-[var(--text-primary)]">
                              {server.name}
                            </div>
                          </div>
                          {!server.available && (
                            <button
                              onClick={() => handleInstallTool(server.name)}
                              disabled={installing !== null}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)] disabled:opacity-50"
                            >
                              {installing === server.name ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Download size={12} />
                              )}
                              Install
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>

      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onProjectOpen={onProjectOpen}
      />
    </div>
  );
};

export default WelcomeScreen;
