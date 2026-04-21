import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  FolderOpen,
  Search,
  Settings,
  Bug,
  Play,
  Globe,
  MoreVertical,
  MessageSquare,
  GitBranch,
  Terminal,
  Keyboard,
  Info,
  RefreshCw,
} from "lucide-react";
import { WindowControls } from "../ui";
import { useIndexingProgress } from "../../hooks/useIndexingProgress";
import { ProjectIndicators } from "./ProjectIndicators";
import { AddProjectMenu } from "./AddProjectMenu";

interface PanelVisibility {
  explorer: boolean;
  terminal: boolean;
  aiChat: boolean;
  git?: boolean;
}

interface TopBarProps {
  onCommandPaletteOpen?: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onToggleExplorer?: () => void;
  onToggleTerminal?: () => void;
  onToggleAIChat?: () => void;
  onToggleGit?: () => void;
  onRun?: () => void;
  onOpenDebug?: () => void;
  onOpenPreview?: () => void;
  onOpenDependencyPolicy?: () => void;
  onBackToWelcome?: () => void;
  onProjectOpen?: (path: string) => void;
  onSwitchProject?: (id: string, direction?: number) => void;
  onCloseProject?: (id: string) => void;
  panels?: PanelVisibility;
  projectPath?: string;
  previewEnabled?: boolean;
  previewActive?: boolean;
  previewTitle?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  onOpenSearch,
  onOpenSettings,
  onToggleExplorer,
  onToggleTerminal,
  onToggleAIChat,
  onToggleGit,
  onRun,
  onOpenDebug,
  onOpenPreview,
  onOpenDependencyPolicy,
  onCommandPaletteOpen,
  onProjectOpen,
  onSwitchProject,
  onCloseProject,
  panels = { explorer: false, terminal: false, aiChat: false },
  projectPath = "",
  previewEnabled = false,
  previewActive = false,
  previewTitle = "Preview unavailable for the current context.",
}) => {
  const indexing = useIndexingProgress();
  const projectName = projectPath
    ? projectPath.split("/").filter(Boolean).at(-1)
    : null;
  const projectParent = projectPath
    ? projectPath.substring(0, projectPath.lastIndexOf("/") + 1)
    : "";
  const activeSurfaces = [
    panels.explorer ? "Explorer" : null,
    panels.git ? "Git" : null,
    panels.terminal ? "Terminal" : null,
    panels.aiChat ? "Agent" : null,
  ].filter(Boolean) as string[];
  const topBarButtonClass =
    "topbar-control-button flex h-8 w-8 items-center justify-center rounded-[10px] border border-transparent transition-colors";
  const topBarActionClass =
    "topbar-control-button flex h-8 w-8 items-center justify-center rounded-[10px] border border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] transition-colors";
  const menuItemClass =
    "flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13px] text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus:bg-[var(--surface-2)] focus:text-[var(--text-primary)]";
  const centerChipClass =
    "interactive-chip border-[var(--border-subtle)] bg-[var(--surface-1)] font-mono text-[10px] tracking-[0.14em]";

  return (
    <div
      className="z-50 flex h-12 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-3 backdrop-blur-panel"
      style={{ "--wails-draggable": "drag" } as React.CSSProperties}
    >
      <div
        className="flex h-full items-center gap-1 border-r border-[var(--border-subtle)] pr-3"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={onToggleExplorer}
          className={`${topBarButtonClass} ${
            panels.explorer
              ? "border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
              : "text-[var(--text-tertiary)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]"
          }`}
          title="Explorer"
        >
          <FolderOpen size={16} />
        </button>
        <button
          onClick={onOpenSearch}
          className={`${topBarButtonClass} text-[var(--text-tertiary)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]`}
          title="Search"
        >
          <Search size={16} />
        </button>
        <button
          onClick={onOpenSettings}
          className={`${topBarButtonClass} text-[var(--text-tertiary)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]`}
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>

      <div
        className="flex h-full items-center gap-2 border-r border-[var(--border-subtle)] pr-3"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <ProjectIndicators
          onSwitch={(id) => onSwitchProject?.(id)}
          onClose={(id) => onCloseProject?.(id)}
        />
        <AddProjectMenu onProjectOpen={(path) => onProjectOpen?.(path)} />
      </div>

      <div className="flex flex-1 items-center justify-center px-3">
        <div className="flex max-w-[780px] flex-1 items-center justify-center gap-2 overflow-hidden">
          <AnimatePresence mode="wait">
            {projectPath ? (
              <motion.div
                key="context-strip"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="flex min-w-0 items-center gap-2 overflow-hidden"
              >
                <span className={`${centerChipClass} max-w-[320px] truncate`}>
                  <span className="truncate text-[var(--text-muted)]">
                    {projectParent}
                  </span>
                  <span className="truncate text-[var(--text-primary)]">
                    {projectName}
                  </span>
                </span>

                {indexing.phase === "indexing" ? (
                  <span className={`${centerChipClass} gap-2`}>
                    <span className="text-[var(--text-secondary)]">
                      Indexing
                    </span>
                    <span className="inline-flex h-1.5 w-20 overflow-hidden rounded-full bg-white/8">
                      <motion.span
                        className="h-full rounded-full bg-[var(--accent-brand)]"
                        initial={{ width: "0%" }}
                        animate={{ width: `${indexing.percentage}%` }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                      />
                    </span>
                  </span>
                ) : indexing.phase === "complete" ? (
                  <span className={centerChipClass}>Indexed</span>
                ) : null}

                {previewActive ? (
                  <span className="interactive-chip border-[color:var(--status-success)]/25 bg-[color:var(--status-success)]/10 text-[var(--status-success)]">
                    Preview Live
                  </span>
                ) : previewEnabled ? (
                  <span className={centerChipClass}>Preview Ready</span>
                ) : null}

                {activeSurfaces.length > 0 ? (
                  <span className={`${centerChipClass} max-w-[180px] truncate`}>
                    {activeSurfaces.join(" · ")}
                  </span>
                ) : (
                  <span className={centerChipClass}>Workspace Idle</span>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div
        className="flex h-full items-center gap-1 border-l border-[var(--border-subtle)] pl-3"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={onOpenDebug}
          className={topBarActionClass}
          title="Debug"
        >
          <Bug size={16} />
        </button>
        <button onClick={onRun} className={topBarActionClass} title="Run">
          <Play size={16} />
        </button>
        <button
          onClick={onOpenPreview}
          className={`${topBarButtonClass} ${
            previewActive
              ? "border-[color:rgba(34,197,94,0.28)] bg-[color:rgba(34,197,94,0.14)] text-[var(--status-success)]"
              : previewEnabled
                ? "text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                : "text-[var(--text-muted)] opacity-45 cursor-not-allowed"
          }`}
          title={previewTitle}
          disabled={!previewEnabled}
          data-testid="topbar-preview-button"
        >
          <Globe size={16} />
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className={`${topBarActionClass} outline-none`}
              title="More"
            >
              <MoreVertical size={16} />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-[100] min-w-[220px] overflow-hidden rounded-[14px] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-1.5 shadow-[var(--shadow-overlay)] backdrop-blur-panel"
            >
              <DropdownMenu.Label className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Panels
              </DropdownMenu.Label>

              <DropdownMenu.Item
                onSelect={() => onToggleAIChat?.()}
                className={menuItemClass}
              >
                <MessageSquare size={14} />
                AI Chat
                {panels.aiChat && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
                )}
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onSelect={() => onToggleTerminal?.()}
                className={menuItemClass}
              >
                <Terminal size={14} />
                Terminal
                {panels.terminal && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
                )}
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onSelect={() => onToggleGit?.()}
                className={menuItemClass}
              >
                <GitBranch size={14} />
                Git
                {panels.git && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
                )}
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />

              <DropdownMenu.Label className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Actions
              </DropdownMenu.Label>

              <DropdownMenu.Item
                onSelect={() => onCommandPaletteOpen?.()}
                className={menuItemClass}
              >
                <Keyboard size={14} />
                Command Palette
                <span className="ml-auto text-[11px] text-[var(--text-muted)] font-mono">
                  ⌘K
                </span>
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onSelect={() => onOpenDependencyPolicy?.()}
                className={menuItemClass}
              >
                <RefreshCw size={14} />
                Sync dependencies...
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />

              <DropdownMenu.Item className={menuItemClass}>
                <Info size={14} />
                About Arlecchino
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <WindowControls />
    </div>
  );
};
