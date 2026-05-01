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
  windowControlsVisible?: boolean;
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
  onProjectOpen,
  onSwitchProject,
  onCloseProject,
  panels = { explorer: false, terminal: false, aiChat: false },
  projectPath = "",
  previewEnabled = false,
  previewActive = false,
  previewTitle = "Preview unavailable for the current context.",
  windowControlsVisible = true,
}) => {
  const indexing = useIndexingProgress();
  const projectName = projectPath
    ? projectPath.split("/").filter(Boolean).at(-1)
    : null;
  const projectParent = projectPath
    ? projectPath.substring(0, projectPath.lastIndexOf("/") + 1)
    : "";
  const topBarButtonClass =
    "topbar-control-button shell-control h-12 w-12 px-0";
  const topBarActionClass = `${topBarButtonClass} text-[var(--text-secondary)]`;
  const menuItemClass = "shell-menu-item text-[13px]";
  const centerChipClass = "shell-pill font-mono text-[10px] tracking-[0.14em]";
  const topBarGroupClass =
    "relative flex h-full -translate-y-[2px] items-center gap-2";
  const topBarIconSize = 25;
  const menuIconSize = 16;
  const isIndexingActive =
    Boolean(projectPath) && indexing.phase === "indexing";
  const blurTransition = { duration: 0.35, ease: "easeInOut" } as const;
  const blurInitial = { opacity: 0, filter: "blur(4px)" };
  const blurAnimate = { opacity: 1, filter: "blur(0px)" };
  const contextPathRootClass =
    "flex min-w-0 max-w-[620px] items-center gap-0 overflow-hidden font-mono leading-none";
  const contextPathParentClass =
    "truncate whitespace-nowrap text-[18px] font-medium tracking-[0.02em] text-[var(--text-muted)]";
  const contextPathNameClass =
    "truncate whitespace-nowrap text-[18px] font-medium tracking-[0.02em] text-[var(--text-primary)]";
  const indexingBubbleClass =
    "flex items-center gap-3 font-mono leading-none text-[12px] tracking-[0.1em] text-[var(--text-secondary)]";

  return (
    <div
      className="relative z-50 flex h-14 items-center gap-2 rounded-b-[18px] border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-3"
      style={{ "--wails-draggable": "drag" } as React.CSSProperties}
      data-testid="topbar"
    >
      <WindowControls visible={windowControlsVisible} />

      <div
        className={topBarGroupClass}
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <div className="shell-cluster px-1.5">
          <button
            onClick={onToggleExplorer}
            className={`${topBarButtonClass} ${
              panels.explorer
                ? "border-[var(--shell-border-strong)] bg-[var(--surface-active)] text-[var(--text-primary)] shadow-[inset_0_1px_0_var(--shell-inner-highlight)]"
                : "text-[var(--text-secondary)]"
            }`}
            title="Explorer"
          >
            <FolderOpen size={topBarIconSize} />
          </button>
          <button
            onClick={onOpenSearch}
            className={`${topBarButtonClass} text-[var(--text-secondary)]`}
            title="Search"
          >
            <Search size={topBarIconSize} />
          </button>
          <button
            onClick={onOpenSettings}
            className={`${topBarButtonClass} text-[var(--text-secondary)]`}
            title="Settings"
          >
            <Settings size={topBarIconSize} />
          </button>
        </div>
      </div>

      <div
        className={`${topBarGroupClass} min-w-0`}
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <div className="shell-cluster min-w-0 px-1.5 pr-2">
          <ProjectIndicators
            onSwitch={(id) => onSwitchProject?.(id)}
            onClose={(id) => onCloseProject?.(id)}
          />
          <div className="shell-divider" />
          <AddProjectMenu onProjectOpen={(path) => onProjectOpen?.(path)} />
        </div>
      </div>

      <div className="relative flex h-full -translate-y-[2px] flex-1 items-center justify-center px-2">
        <div className="flex max-w-[860px] flex-1 items-center justify-center gap-2 overflow-hidden">
          <AnimatePresence mode="wait">
            {projectPath ? (
              <motion.div
                key="context-strip"
                layout
                initial={blurInitial}
                animate={blurAnimate}
                exit={blurInitial}
                transition={blurTransition}
                className="shell-cluster min-w-0 max-w-[620px] items-center overflow-hidden px-3 py-1.5"
              >
                <AnimatePresence mode="wait" initial={false}>
                  {isIndexingActive ? (
                    <motion.div
                      key="indexing-state"
                      initial={blurInitial}
                      animate={blurAnimate}
                      exit={blurInitial}
                      transition={blurTransition}
                      className={indexingBubbleClass}
                    >
                      <span>Indexing</span>
                      <span className="inline-flex h-2 w-28 overflow-hidden rounded-full bg-white/8">
                        <motion.span
                          className="h-full rounded-full bg-[var(--text-primary)]"
                          initial={{ width: "0%" }}
                          animate={{ width: `${indexing.percentage}%` }}
                          transition={{ duration: 0.18, ease: "easeOut" }}
                        />
                      </span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="path-state"
                      initial={blurInitial}
                      animate={blurAnimate}
                      exit={blurInitial}
                      transition={blurTransition}
                      className={contextPathRootClass}
                      data-testid="topbar-project-path"
                    >
                      <span className={contextPathParentClass}>
                        {projectParent}
                      </span>
                      <span className={contextPathNameClass}>
                        {projectName}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div
                key="empty-context-strip"
                initial={blurInitial}
                animate={blurAnimate}
                exit={blurInitial}
                transition={blurTransition}
                className="shell-cluster px-2.5 py-1.5"
              >
                <span className={centerChipClass}>No project open</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div
        className={topBarGroupClass}
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <div className="shell-cluster px-1.5">
          <button
            onClick={onOpenDebug}
            className={topBarActionClass}
            title="Debug"
          >
            <Bug size={topBarIconSize} />
          </button>
          <button onClick={onRun} className={topBarActionClass} title="Run">
            <Play size={topBarIconSize} />
          </button>
          <button
            onClick={onOpenPreview}
            className={`${topBarButtonClass} ${
              previewActive
                ? "border-[color:rgba(34,197,94,0.28)] bg-[color:rgba(34,197,94,0.14)] text-[var(--status-success)]"
                : previewEnabled
                  ? "text-[var(--text-secondary)]"
                  : "cursor-not-allowed text-[var(--text-muted)] opacity-45"
            }`}
            title={previewTitle}
            disabled={!previewEnabled}
            data-testid="topbar-preview-button"
          >
            <Globe size={topBarIconSize} />
          </button>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={`${topBarActionClass} outline-none`}
                title="More"
              >
                <MoreVertical size={topBarIconSize} />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                className="shell-menu-content min-w-[240px]"
                data-shell-menu-content
              >
                <DropdownMenu.Label className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Panels
                </DropdownMenu.Label>

                <DropdownMenu.Item
                  onSelect={() => onToggleAIChat?.()}
                  className={menuItemClass}
                >
                  <MessageSquare size={menuIconSize} />
                  AI Chat
                  {panels.aiChat && (
                    <span className="ml-auto h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                  )}
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  onSelect={() => onToggleTerminal?.()}
                  className={menuItemClass}
                >
                  <Terminal size={menuIconSize} />
                  Terminal
                  {panels.terminal && (
                    <span className="ml-auto h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                  )}
                </DropdownMenu.Item>

                <DropdownMenu.Item
                  onSelect={() => onToggleGit?.()}
                  className={menuItemClass}
                >
                  <GitBranch size={menuIconSize} />
                  Git
                  {panels.git && (
                    <span className="ml-auto h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                  )}
                </DropdownMenu.Item>

                <DropdownMenu.Separator className="my-1 h-px bg-[var(--shell-inline-divider)]" />

                <DropdownMenu.Label className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Actions
                </DropdownMenu.Label>

                <DropdownMenu.Item
                  onSelect={() => onOpenDependencyPolicy?.()}
                  className={menuItemClass}
                >
                  <RefreshCw size={menuIconSize} />
                  Sync dependencies...
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
};
