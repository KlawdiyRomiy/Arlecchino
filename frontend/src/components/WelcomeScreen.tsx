import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  FolderOpen,
  CheckCircle,
  XCircle,
  Sparkles,
  Download,
  Loader2,
  ChevronDown,
  ChevronUp,
  GitBranch,
} from "lucide-react";
import * as App from "../../wailsjs/go/main/App";
import { welcome } from "../../wailsjs/go/models";
import { ThemeToggle, WindowControls } from "./ui";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { shortcuts } from "../utils/keyboard";

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
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    loadRecentProjects();
    validateEnvironment();
    loadToolsStatus();
    setLoading(false);

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
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
    try {
      await App.InstallDevTool(toolName);
      await loadToolsStatus();
    } catch (error) {
      console.error(`Error installing ${toolName}:`, error);
      alert(`Failed to install ${toolName}: ${error}`);
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

  const handleOpenRecentProject = (projectPath: string) => {
    onProjectOpen(projectPath);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-blackprint)]">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-4 border-white border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center h-screen overflow-hidden">
      <div className="fixed inset-0 bg-[var(--bg-blackprint)] z-0" />
      <div className="grid-bg" />

      <div
        className="absolute top-0 left-0 right-0 h-12 z-40"
        style={{ "--wails-draggable": "drag" } as React.CSSProperties}
      />
      <div
        className="absolute top-6 right-6 flex items-center gap-2 z-50"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <ThemeToggle />
        <WindowControls />
      </div>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="absolute top-20 left-16 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] shadow-2xl z-10 w-[200px]"
        style={{
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        <div
          className="px-4 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] cursor-grab active:cursor-grabbing"
          style={{ borderRadius: "var(--radius-lg) var(--radius-lg) 0 0" }}
        >
          <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
            ~/arlecchino/clock
          </div>
        </div>
        <div className="p-4">
          <div className="text-4xl font-semibold font-mono text-[var(--text-primary)] text-center">
            {formatTime(currentTime)}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] text-center mt-1">
            {formatDate(currentTime)}
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="absolute top-20 right-16 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] shadow-2xl z-10 w-[280px]"
        style={{
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        <div
          className="px-4 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] cursor-grab active:cursor-grabbing"
          style={{ borderRadius: "var(--radius-lg) var(--radius-lg) 0 0" }}
        >
          <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
            ~/arlecchino/recentProjects
          </div>
        </div>
        <div className="p-4">
          {recentProjects.length > 0 ? (
            recentProjects.slice(0, 3).map((project) => (
              <div
                key={project.id}
                onClick={() => handleOpenRecentProject(project.path)}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors mb-1"
              >
                <div className="w-8 h-8 bg-[var(--bg-elevated)] rounded-lg flex items-center justify-center text-sm">
                  ◆
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                    {project.name}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                    {project.path}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-[12px] text-[var(--text-secondary)] text-center py-4">
              No recent projects
            </div>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="absolute bottom-20 left-16 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] shadow-2xl z-10 w-[320px]"
        style={{
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        <div
          className="px-4 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] cursor-grab active:cursor-grabbing"
          style={{ borderRadius: "var(--radius-lg) var(--radius-lg) 0 0" }}
        >
          <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
            ~/arlecchino/gitChanges
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors mb-1">
            <div className="w-2 h-2 rounded-sm bg-[#e0a040]" />
            <div className="flex-1 text-[12px] text-[var(--text-secondary)]">
              redesign/v4.html
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">2m ago</div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors mb-1">
            <div className="w-2 h-2 rounded-sm bg-[#50a050]" />
            <div className="flex-1 text-[12px] text-[var(--text-secondary)]">
              internal/predictive/ast.go
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">15m ago</div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
            <div className="w-2 h-2 rounded-sm bg-[#e0a040]" />
            <div className="flex-1 text-[12px] text-[var(--text-secondary)]">
              frontend/src/App.tsx
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">1h ago</div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="relative z-20 flex flex-col items-center max-w-[500px]"
      >
        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={handleOpenProject}
            className="flex items-center gap-4 px-6 py-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[13px] font-medium cursor-pointer transition-all hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-default)] hover:-translate-y-0.5 relative overflow-hidden group"
            style={{ borderRadius: "var(--radius-lg)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.boxShadow = "var(--shadow-panel)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
          >
            <FolderOpen size={18} className="opacity-60" />
            <span className="flex-1 text-left">Open Project</span>
            <span className="text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 bg-[var(--bg-tertiary)] rounded-md">
              ⌘O
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          </button>

          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-4 px-6 py-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[13px] font-medium cursor-pointer transition-all hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-default)] hover:-translate-y-0.5 relative overflow-hidden group"
            style={{ borderRadius: "var(--radius-lg)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.boxShadow = "var(--shadow-panel)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
          >
            <Sparkles size={18} className="opacity-60" />
            <span className="flex-1 text-left">New Project</span>
            <span className="text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 bg-[var(--bg-tertiary)] rounded-md">
              ⌘N
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          </button>

          <button
            className="flex items-center gap-4 px-6 py-3.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[13px] font-medium cursor-pointer transition-all hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-default)] hover:-translate-y-0.5 relative overflow-hidden group"
            style={{ borderRadius: "var(--radius-lg)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.boxShadow = "var(--shadow-panel)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
          >
            <GitBranch size={18} className="opacity-60" />
            <span className="flex-1 text-left">Clone Repository</span>
            <span className="text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 bg-[var(--bg-tertiary)] rounded-md">
              ⇧⌘G
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-8"
        >
          <button
            onClick={() => setShowToolsPanel(!showToolsPanel)}
            className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {showToolsPanel ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
            <span>Development Tools & LSP Servers</span>
            {devTools.filter((t) => !t.available).length +
              lspServers.filter((t) => !t.available).length >
              0 && (
              <span className="px-2 py-0.5 bg-yellow-900/30 text-yellow-400 text-[11px] rounded-full">
                {devTools.filter((t) => !t.available).length +
                  lspServers.filter((t) => !t.available).length}{" "}
                missing
              </span>
            )}
          </button>
        </motion.div>
      </motion.div>

      {showToolsPanel && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="absolute bottom-8 w-full max-w-4xl grid grid-cols-2 gap-6 px-8 z-20"
        >
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-subtle)]">
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-blue-500" />
              Development Tools
            </h3>
            <div className="space-y-2">
              {devTools.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-tertiary)]"
                >
                  <div className="flex items-center gap-2">
                    {tool.available ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : (
                      <XCircle size={16} className="text-gray-400" />
                    )}
                    <span className="text-[13px] text-[var(--text-primary)]">
                      {tool.name}
                    </span>
                    {tool.version && (
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {tool.version}
                      </span>
                    )}
                  </div>
                  {!tool.available && (
                    <button
                      onClick={() => handleInstallTool(tool.name.toLowerCase())}
                      disabled={installing !== null}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors disabled:opacity-50"
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

          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-subtle)]">
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-purple-500" />
              LSP Servers
            </h3>
            <div className="space-y-2">
              {lspServers.map((server) => (
                <div
                  key={server.name}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-tertiary)]"
                >
                  <div className="flex items-center gap-2">
                    {server.available ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : (
                      <XCircle size={16} className="text-gray-400" />
                    )}
                    <span className="text-[13px] text-[var(--text-primary)] font-mono">
                      {server.name}
                    </span>
                  </div>
                  {!server.available && (
                    <button
                      onClick={() => handleInstallTool(server.name)}
                      disabled={installing !== null}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-purple-500 hover:bg-purple-600 text-white rounded transition-colors disabled:opacity-50"
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
        </motion.div>
      )}

      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onProjectOpen={onProjectOpen}
      />
    </div>
  );
};

export default WelcomeScreen;
