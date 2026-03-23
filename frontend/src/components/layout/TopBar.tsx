import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  FolderOpen,
  Search,
  Settings,
  Grid3x3,
  Bug,
  Play,
  Globe,
  MoreVertical,
  MessageSquare,
  GitBranch,
  Terminal,
  Keyboard,
  Info,
} from "lucide-react";
import { WindowControls } from "../ui";
import { useIndexingProgress } from "../../hooks/useIndexingProgress";
import { ProjectIndicators } from "./ProjectIndicators";
import { AddProjectMenu } from "./AddProjectMenu";

interface PanelVisibility {
  explorer: boolean;
  terminal: boolean;
  aiChat: boolean;
}

interface TopBarProps {
  onCommandPaletteOpen?: () => void;
  onToggleExplorer?: () => void;
  onToggleTerminal?: () => void;
  onToggleAIChat?: () => void;
  onOpenPreview?: () => void;
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
  onToggleExplorer,
  onToggleTerminal,
  onToggleAIChat,
  onOpenPreview,
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
  const topBarButtonClass =
    "topbar-control-button w-8 h-8 flex items-center justify-center rounded-md transition-colors";
  const topBarActionClass =
    "topbar-control-button w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors";

  return (
    <div
      className="h-11 bg-[rgba(17,17,17,0.85)] backdrop-blur-[20px] border-b border-[var(--border-subtle)] flex items-center px-4 gap-4 z-50"
      style={{ "--wails-draggable": "drag" } as React.CSSProperties}
    >
      <div
        className="flex items-center gap-1 pr-4 border-r border-[var(--border-subtle)] h-full"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={onToggleExplorer}
          className={`${topBarButtonClass} ${
            panels.explorer
              ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
          }`}
          title="Explorer"
        >
          <FolderOpen size={16} />
        </button>
        <button
          className={`${topBarButtonClass} text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]`}
          title="Search"
        >
          <Search size={16} />
        </button>
        <button
          className={`${topBarButtonClass} text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]`}
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>

      <div
        className="flex items-center gap-2 pr-4 border-r border-[var(--border-subtle)] h-full"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <ProjectIndicators
          onSwitch={(id) => onSwitchProject?.(id)}
          onClose={(id) => onCloseProject?.(id)}
        />
        <AddProjectMenu onProjectOpen={(path) => onProjectOpen?.(path)} />
      </div>

      <div className="flex-1 flex justify-center items-center">
        <AnimatePresence mode="wait">
          {indexing.phase === "indexing" ? (
            <motion.div
              key="indexing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3"
            >
              <span className="font-mono text-[13px] text-[var(--text-muted)]">
                Indexing...
              </span>
              <div className="w-[200px] h-[3px] bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-white rounded-full"
                  style={{
                    boxShadow: "0 0 8px rgba(255,255,255,0.3)",
                  }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${indexing.percentage}%` }}
                  transition={{ type: "spring", stiffness: 60, damping: 15 }}
                />
              </div>
            </motion.div>
          ) : indexing.phase === "complete" ? (
            <motion.span
              key="complete"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="font-mono text-[13px] text-[var(--text-secondary)]"
            >
              Indexing complete!
            </motion.span>
          ) : indexing.phase === "revealed" && projectPath ? (
            <motion.span
              key="path"
              initial={{ opacity: 0, filter: "blur(10px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.8 }}
              className="font-mono text-[16px] font-medium tracking-wide max-w-[700px] truncate"
            >
              <span className="text-[var(--text-muted)]">
                {projectPath.substring(0, projectPath.lastIndexOf("/") + 1)}
              </span>
              <span className="text-[var(--text-primary)]">
                {projectPath.split("/").pop()}
              </span>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <div
        className="flex items-center gap-1 pl-4 border-l border-[var(--border-subtle)] h-full"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
      >
        <button className={topBarActionClass} title="Perspective View">
          <Grid3x3 size={16} />
        </button>
        <button className={topBarActionClass} title="Debug">
          <Bug size={16} />
        </button>
        <button className={topBarActionClass} title="Run">
          <Play size={16} />
        </button>
        <button
          onClick={onOpenPreview}
          className={`${topBarButtonClass} ${
            previewActive
              ? "bg-[rgba(34,197,94,0.16)] text-[#22C55E]"
              : previewEnabled
                ? "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
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
              className="min-w-[200px] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg shadow-2xl overflow-hidden z-[100] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
            >
              <DropdownMenu.Label className="px-3 py-2 text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Panels
              </DropdownMenu.Label>

              <DropdownMenu.Item
                onSelect={() => onToggleAIChat?.()}
                className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] cursor-pointer outline-none transition-colors"
              >
                <MessageSquare size={14} />
                AI Chat
                {panels.aiChat && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
                )}
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onSelect={() => onToggleTerminal?.()}
                className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] cursor-pointer outline-none transition-colors"
              >
                <Terminal size={14} />
                Terminal
                {panels.terminal && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
                )}
              </DropdownMenu.Item>

              <DropdownMenu.Item className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] cursor-pointer outline-none transition-colors">
                <GitBranch size={14} />
                Git
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="h-px bg-[var(--border-subtle)] my-1" />

              <DropdownMenu.Label className="px-3 py-2 text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Actions
              </DropdownMenu.Label>

              <DropdownMenu.Item
                onSelect={() => onCommandPaletteOpen?.()}
                className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] cursor-pointer outline-none transition-colors"
              >
                <Keyboard size={14} />
                Command Palette
                <span className="ml-auto text-[11px] text-[var(--text-muted)] font-mono">
                  ⌘K
                </span>
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="h-px bg-[var(--border-subtle)] my-1" />

              <DropdownMenu.Item className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] cursor-pointer outline-none transition-colors">
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
