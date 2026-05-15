import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Copy,
  Eye,
  ExternalLink,
  File,
  FolderGit2,
  GitBranch,
  GitCommit,
  History,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import * as AppFunctions from "../wails/app";
import { useProjectEntryActions } from "../contexts/ProjectEntryActionsContext";
import { useTheme } from "../hooks/useTheme";
import { useAppNotificationStore } from "../stores/appNotificationStore";
import { GitStashEntry, useGitStore } from "../stores/gitStore";
import { getThemeColors, transitions } from "../styles/colors";
import { toErrorMessage } from "../utils/errorMessages";
import type { GitFileEntry, GitFileStatus } from "../utils/git";
import {
  getProjectPathDirname,
  normalizeProjectPath,
} from "../utils/projectPaths";
import type { PanelPosition } from "./ui/FloatingPanel";
import { GitDiffViewer } from "./GitDiffViewer";
import { GitHistory } from "./GitHistory";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ui/ContextActionMenu";

type GitPresentationMode = "compact" | "expanded";

interface GitPanelProps {
  projectPath: string;
  onFileOpen?: (path: string) => void;
  panelPosition?: PanelPosition;
  onDiffFocusChange?: (active: boolean) => void;
  presentationMode?: GitPresentationMode;
}

type DetailTab = "commit" | "history" | "pull_requests" | "stash" | "diff";

interface DiffState {
  title: string;
  content: string;
  selectedPath: string | null;
}

interface FileRowProps {
  file: GitFileEntry;
  selected: boolean;
  presentationMode: GitPresentationMode;
  onOpen?: (path: string) => void;
  onViewDiff: (file: GitFileEntry) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  contextMenuItems?: ContextActionMenuItem[];
}

interface FileSectionProps {
  title: string;
  files: GitFileEntry[];
  open: boolean;
  presentationMode: GitPresentationMode;
  onToggle: () => void;
  bulkActionLabel?: string;
  onBulkAction?: () => void;
  emptyLabel: string;
  selectedPath: string | null;
  onOpen?: (path: string) => void;
  onViewDiff: (file: GitFileEntry) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  getContextMenuItems?: (file: GitFileEntry) => ContextActionMenuItem[];
}

interface StashSectionProps {
  entries: GitStashEntry[];
  loading: boolean;
  message: string;
  onMessageChange: (value: string) => void;
  onCreate: () => void;
  onPop: (ref?: string) => void;
  onDrop: (ref: string) => void;
}

const statusColors: Record<GitFileStatus, string> = {
  modified: "var(--status-warning)",
  added: "var(--status-success)",
  deleted: "var(--status-error)",
  untracked: "var(--status-info)",
  renamed: "var(--accent-primary)",
  copied: "var(--status-info)",
  conflicted: "var(--status-warning)",
};

const statusLabels: Record<GitFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "?",
  renamed: "R",
  copied: "C",
  conflicted: "!",
};

const gitSectionClass =
  "overflow-hidden rounded-[24px] border border-[var(--git-border)] bg-[var(--git-surface)] shadow-[var(--git-surface-shadow)]";
const gitInsetSectionClass =
  "overflow-hidden rounded-[22px] border border-[var(--git-border)] bg-[var(--git-bg-tertiary)]";
const gitPillClass =
  "inline-flex items-center rounded-full border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 py-1.5 text-[11px] font-medium text-[var(--git-text-secondary)]";
const gitActionPillClass =
  "inline-flex items-center rounded-full border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 py-1.5 text-[11px] font-medium text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]";
const gitBubbleIconButtonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-[18px] border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]";
const gitMiniIconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-[14px] border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]";
const gitSegmentButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-[18px] border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 text-[12px] font-medium text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]";

const splitDisplayPath = (
  path: string,
): { fileName: string; directory: string } => {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const fileName = segments.pop() || normalized;
  return {
    fileName,
    directory: segments.join("/"),
  };
};

const statusBadgeStyle = (status: GitFileStatus): React.CSSProperties => ({
  color: statusColors[status],
  borderColor: `color-mix(in srgb, ${statusColors[status]} 24%, var(--git-border))`,
  background: `color-mix(in srgb, ${statusColors[status]} 12%, var(--git-bg-tertiary))`,
});

const canDiscardFile = (file: GitFileEntry): boolean =>
  file.status !== "conflicted" && file.status !== "untracked";

const toHumanError = (error: string | null): string | null => {
  if (!error) {
    return null;
  }
  const normalized = error.toLowerCase();
  if (normalized.includes("not a git repository")) {
    return "This folder is not a git repository.";
  }
  if (normalized.includes("no project open")) {
    return "No project is open.";
  }
  if (normalized.includes("timed out")) {
    return "Git operation timed out. Try again or use the terminal for a long-running command.";
  }
  return error;
};

const inputStyle = (
  theme: ReturnType<typeof getThemeColors>,
): React.CSSProperties => ({
  border: `1px solid ${theme.border}`,
  borderRadius: 18,
  background: "var(--git-bg-tertiary)",
  color: theme.text,
  fontSize: 12,
  padding: "10px 14px",
  outline: "none",
  width: "100%",
});

const textAreaStyle = (
  theme: ReturnType<typeof getThemeColors>,
): React.CSSProperties => ({
  ...inputStyle(theme),
  minHeight: 88,
  resize: "vertical",
  lineHeight: 1.45,
});

const buttonStyle = (
  theme: ReturnType<typeof getThemeColors>,
  variant: "default" | "accent" | "danger" = "default",
): React.CSSProperties => ({
  border: `1px solid ${
    variant === "accent"
      ? "color-mix(in srgb, var(--accent-brand) 44%, var(--git-border))"
      : variant === "danger"
        ? "color-mix(in srgb, var(--status-error) 44%, var(--git-border))"
        : theme.border
  }`,
  background:
    variant === "accent" ? "var(--accent-brand)" : "var(--git-bg-tertiary)",
  color:
    variant === "accent"
      ? "#fff3f0"
      : variant === "danger"
        ? "var(--status-error)"
        : theme.textSecondary,
  borderRadius: 18,
  padding: "9px 14px",
  fontSize: 12,
  fontWeight: 500,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  cursor: "pointer",
  transition: transitions.fast,
});

const FileRow = React.memo<FileRowProps>(
  ({
    file,
    selected,
    presentationMode,
    onOpen,
    onViewDiff,
    onStage,
    onUnstage,
    onDiscard,
    contextMenuItems,
  }) => {
    const { fileName, directory } = splitDisplayPath(
      file.originalPath || file.path,
    );
    const subtitle = file.staged
      ? "Staged"
      : file.status === "conflicted"
        ? "Conflict"
        : "Working tree";

    const row = (
      <div
        className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border px-3 transition-colors ${
          presentationMode === "expanded" ? "py-3.5" : "py-2.5"
        }`}
        style={{
          borderColor: selected
            ? "var(--git-border-strong)"
            : "var(--git-border)",
          background: selected
            ? "var(--git-row-active)"
            : "var(--git-bg-tertiary)",
        }}
        onClick={() => onViewDiff(file)}
        onDoubleClick={() => onOpen?.(file.path)}
        title={file.path}
      >
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border text-[12px] font-semibold"
          style={statusBadgeStyle(file.status)}
        >
          {statusLabels[file.status]}
        </span>

        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[var(--git-text)]">
            {fileName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--git-text-tertiary)]">
            <span className="truncate">{directory || "Project root"}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--git-border-strong)]" />
            <span className="text-[var(--git-text-secondary)]">{subtitle}</span>
          </div>
        </div>

        <div
          className="flex items-center gap-1 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          style={{
            opacity: selected || presentationMode === "expanded" ? 1 : 0,
          }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onViewDiff(file);
            }}
            className={gitMiniIconButtonClass}
            title="View diff"
          >
            <Eye size={13} />
          </button>

          {file.staged ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUnstage(file.path);
              }}
              className={gitMiniIconButtonClass}
              title="Unstage file"
            >
              <Minus size={13} />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onStage(file.path);
                }}
                className={`${gitMiniIconButtonClass} hover:border-[var(--status-success)] hover:text-[var(--status-success)]`}
                title="Stage file"
              >
                <Plus size={13} />
              </button>
              {canDiscardFile(file) && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDiscard(file.path);
                  }}
                  className={`${gitMiniIconButtonClass} hover:border-[var(--status-error)] hover:text-[var(--status-error)]`}
                  title="Discard changes"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );

    if (!contextMenuItems || contextMenuItems.length === 0) {
      return row;
    }

    return (
      <ContextActionMenu items={contextMenuItems}>{row}</ContextActionMenu>
    );
  },
);

FileRow.displayName = "FileRow";

const FileSection = React.memo<FileSectionProps>(
  ({
    title,
    files,
    open,
    presentationMode,
    onToggle,
    bulkActionLabel,
    onBulkAction,
    emptyLabel,
    selectedPath,
    onOpen,
    onViewDiff,
    onStage,
    onUnstage,
    onDiscard,
    getContextMenuItems,
  }) => (
    <section className={gitSectionClass}>
      <div className="flex items-center gap-2 px-4 py-3.5">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            size={14}
            className="shrink-0 text-[var(--git-text-secondary)] transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          />
          <span className="text-[13px] font-semibold text-[var(--git-text)]">
            {title}
          </span>
          <span className={gitPillClass}>{files.length}</span>
        </button>

        {files.length > 0 && bulkActionLabel && onBulkAction && (
          <button
            type="button"
            onClick={onBulkAction}
            className={gitActionPillClass}
          >
            {bulkActionLabel}
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-[var(--git-border)] px-3 pb-3 pt-3">
          {files.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-4 py-5 text-[12px] text-[var(--git-text-secondary)]">
              {emptyLabel}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {files.map((file) => (
                <FileRow
                  key={`${file.path}:${file.staged ? "staged" : "unstaged"}:${file.status}`}
                  file={file}
                  selected={selectedPath === file.path}
                  presentationMode={presentationMode}
                  onOpen={onOpen}
                  onViewDiff={onViewDiff}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  onDiscard={onDiscard}
                  contextMenuItems={getContextMenuItems?.(file)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  ),
);

FileSection.displayName = "FileSection";

const StashSection = React.memo<StashSectionProps>(
  ({ entries, loading, message, onMessageChange, onCreate, onPop, onDrop }) => (
    <section className={gitSectionClass}>
      <div className="flex items-center gap-2 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Sparkles size={13} className="text-[var(--git-text-secondary)]" />
          <span className="text-[13px] font-semibold text-[var(--git-text)]">
            Stashes
          </span>
          <span className={gitPillClass}>{entries.length}</span>
        </div>
      </div>

      <div className="border-t border-[var(--git-border)] px-4 py-4">
        <div className="flex gap-2">
          <input
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Optional stash message"
            className="w-full rounded-[18px] border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-4 py-2.5 text-[12px] text-[var(--git-text)] outline-none placeholder:text-[var(--git-text-tertiary)]"
          />
          <button
            type="button"
            onClick={onCreate}
            className={`${gitSegmentButtonClass} shrink-0 disabled:cursor-wait disabled:opacity-60`}
            disabled={loading}
          >
            <Plus size={13} />
            Stash
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {entries.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-4 py-5 text-[12px] text-[var(--git-text-secondary)]">
              No saved stashes.
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.ref}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-[var(--git-text)]">
                    {entry.message || entry.ref}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--git-text-tertiary)]">
                    <span>{entry.ref}</span>
                    <span>{entry.relativeDate}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onPop(entry.ref)}
                    className={`${gitSegmentButtonClass} h-8 hover:border-[var(--status-success)] hover:text-[var(--status-success)]`}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => onDrop(entry.ref)}
                    className={`${gitSegmentButtonClass} h-8 hover:border-[var(--status-error)] hover:text-[var(--status-error)]`}
                  >
                    Drop
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  ),
);

StashSection.displayName = "StashSection";

export const GitPanel: React.FC<GitPanelProps> = ({
  projectPath,
  onFileOpen,
  panelPosition = "right",
  onDiffFocusChange,
  presentationMode = "compact",
}) => {
  const { isDark } = useTheme();
  const { copyAbsolutePath, copyRelativePath, revealEntry } =
    useProjectEntryActions();
  const theme = getThemeColors(isDark);
  const isExpanded = presentationMode === "expanded";
  const layoutMode = isExpanded ? "split" : "stacked";
  const git = useGitStore(
    useShallow((state) => ({
      loading: state.loading,
      busy: state.busy,
      error: state.error,
      isRepositoryMissing: state.isRepositoryMissing,
      branch: state.branch,
      branches: state.branches,
      remotes: state.remotes,
      selectedRemote: state.selectedRemote,
      stagedFiles: state.stagedFiles,
      unstagedFiles: state.unstagedFiles,
      conflictedFiles: state.conflictedFiles,
      historyCommits: state.historyCommits,
      historyLoading: state.historyLoading,
      stashEntries: state.stashEntries,
      stashLoading: state.stashLoading,
      setProjectPath: state.setProjectPath,
      setSelectedRemote: state.setSelectedRemote,
      refresh: state.refresh,
      loadHistory: state.loadHistory,
      stageFile: state.stageFile,
      unstageFile: state.unstageFile,
      stageAll: state.stageAll,
      unstageAll: state.unstageAll,
      discardFile: state.discardFile,
      initializeRepository: state.initializeRepository,
      commit: state.commit,
      switchBranch: state.switchBranch,
      createBranch: state.createBranch,
      fetchRemote: state.fetchRemote,
      pullRemote: state.pullRemote,
      pushRemote: state.pushRemote,
      createStash: state.createStash,
      popStash: state.popStash,
      dropStash: state.dropStash,
      getPullRequestUrl: state.getPullRequestUrl,
      openPullRequest: state.openPullRequest,
    })),
  );

  const [commitMessage, setCommitMessage] = useState("");
  const [stashMessage, setStashMessage] = useState("");
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [diffState, setDiffState] = useState<DiffState | null>(null);
  const [diffReturnTab, setDiffReturnTab] = useState<DetailTab | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("commit");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [conflictedOpen, setConflictedOpen] = useState(true);
  const [prBaseOverride, setPrBaseOverride] = useState("");
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const lastStoreErrorRef = useRef<string | null>(null);
  const isDiffFocused =
    presentationMode === "compact" && detailOpen && detailTab === "diff";

  useEffect(() => {
    git.setProjectPath(projectPath);
  }, [git, projectPath]);

  useEffect(() => {
    onDiffFocusChange?.(isDiffFocused);
  }, [isDiffFocused, onDiffFocusChange]);

  useEffect(() => {
    return () => {
      onDiffFocusChange?.(false);
    };
  }, [onDiffFocusChange]);

  const allChangedFiles = useMemo(
    () => [...git.conflictedFiles, ...git.stagedFiles, ...git.unstagedFiles],
    [git.conflictedFiles, git.stagedFiles, git.unstagedFiles],
  );

  const selectedFileIndex = useMemo(() => {
    if (!selectedPath) {
      return -1;
    }
    return allChangedFiles.findIndex((file) => file.path === selectedPath);
  }, [allChangedFiles, selectedPath]);

  const inferredBaseBranch = useMemo(() => {
    if (git.branch.upstream.includes("/")) {
      return git.branch.upstream.split("/").slice(1).join("/");
    }
    return "main";
  }, [git.branch.upstream]);

  const effectivePrBase = prBaseOverride.trim() || inferredBaseBranch;
  const changedCount =
    git.stagedFiles.length +
    git.unstagedFiles.length +
    git.conflictedFiles.length;
  const showInitializeRepository = git.isRepositoryMissing;

  const panelVars = useMemo(
    () =>
      ({
        "--git-bg": theme.bg,
        "--git-surface":
          "color-mix(in srgb, var(--surface-1) 98%, transparent)",
        "--git-bg-tertiary":
          "color-mix(in srgb, var(--surface-2) 96%, transparent)",
        "--git-border": theme.border,
        "--git-border-strong": "var(--border-strong)",
        "--git-row-active":
          "color-mix(in srgb, var(--surface-active) 88%, transparent)",
        "--git-text": theme.text,
        "--git-text-secondary": theme.textSecondary,
        "--git-text-tertiary": theme.textMuted,
        "--git-surface-shadow":
          "inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 24px -22px rgba(0,0,0,0.85)",
      }) as React.CSSProperties,
    [theme],
  );

  const resolvePathForOpen = useCallback(
    (path: string): string => {
      if (!projectPath || path.startsWith("/")) {
        return path;
      }
      return `${projectPath}/${path}`;
    },
    [projectPath],
  );

  const resolvePathForReveal = useCallback(
    (file: GitFileEntry): string => {
      const resolvedPath = normalizeProjectPath(resolvePathForOpen(file.path));
      if (file.status === "deleted") {
        return normalizeProjectPath(
          getProjectPathDirname(resolvedPath) || projectPath,
        );
      }
      return resolvedPath;
    },
    [projectPath, resolvePathForOpen],
  );

  const notifyGitError = useCallback((error: unknown) => {
    const rawMessage = toErrorMessage(error);
    const message = toHumanError(rawMessage) ?? rawMessage;

    useAppNotificationStore.getState().addNotification({
      id: "git-panel-error",
      kind: "error",
      title: "Git operation failed",
      message,
      details: rawMessage !== message ? rawMessage : undefined,
      source: "Git",
    });
  }, []);

  useEffect(() => {
    if (!git.error) {
      lastStoreErrorRef.current = null;
      return;
    }
    if (git.isRepositoryMissing || lastStoreErrorRef.current === git.error) {
      return;
    }

    lastStoreErrorRef.current = git.error;
    notifyGitError(git.error);
  }, [git.error, git.isRepositoryMissing, notifyGitError]);

  const withErrorGuard = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        notifyGitError(error);
      }
    },
    [notifyGitError],
  );

  const runPanelAction = useCallback(
    async (action: () => Promise<void>) => {
      await withErrorGuard(action);
    },
    [withErrorGuard],
  );

  const openDetail = useCallback(
    (tab: DetailTab) => {
      setDetailTab(tab);
      if (presentationMode === "compact") {
        setDetailOpen(true);
      }
      if (tab === "history") {
        void git.loadHistory();
      }
    },
    [git, presentationMode],
  );

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || git.stagedFiles.length === 0 || git.busy) {
      return;
    }
    await withErrorGuard(async () => {
      await git.commit(commitMessage);
      setCommitMessage("");
    });
  }, [commitMessage, git, withErrorGuard]);

  const handleCreateBranch = useCallback(async () => {
    const branchName = newBranchName.trim();
    if (!branchName) {
      return;
    }
    await withErrorGuard(async () => {
      await git.createBranch(branchName, git.branch.current || undefined);
      setNewBranchName("");
      setShowBranchDropdown(false);
    });
  }, [git, newBranchName, withErrorGuard]);

  const handleInitializeRepository = useCallback(async () => {
    await withErrorGuard(async () => {
      await git.initializeRepository();
      setDetailOpen(false);
      setDiffState(null);
      setSelectedPath(null);
    });
  }, [git, withErrorGuard]);

  const handleCreateStash = useCallback(async () => {
    await withErrorGuard(async () => {
      await git.createStash(stashMessage);
      setStashMessage("");
    });
  }, [git, stashMessage, withErrorGuard]);

  const viewFileDiff = useCallback(
    async (file: GitFileEntry) => {
      setSelectedPath(file.path);
      try {
        const diff = await AppFunctions.GetGitDiff(file.path, file.staged);
        setDiffReturnTab(
          presentationMode === "expanded" || detailOpen ? detailTab : null,
        );
        setDiffState({
          title: file.path,
          content: diff || "",
          selectedPath: file.path,
        });
        if (presentationMode === "compact") {
          setDetailOpen(true);
        }
        setDetailTab("diff");
      } catch (error) {
        notifyGitError(error);
      }
    },
    [detailOpen, detailTab, notifyGitError, presentationMode],
  );

  const viewCommitDiff = useCallback(
    async (hash: string) => {
      setSelectedPath(null);
      try {
        const diff = await AppFunctions.GetGitCommitDiff(hash);
        setDiffReturnTab(
          presentationMode === "expanded" || detailOpen ? detailTab : null,
        );
        setDiffState({
          title: `Commit ${hash.slice(0, 7)}`,
          content: diff || "",
          selectedPath: null,
        });
        if (presentationMode === "compact") {
          setDetailOpen(true);
        }
        setDetailTab("diff");
      } catch (error) {
        notifyGitError(error);
      }
    },
    [detailOpen, detailTab, notifyGitError, presentationMode],
  );

  const buildFileContextMenuItems = useCallback(
    (file: GitFileEntry): ContextActionMenuItem[] => {
      const absolutePath = resolvePathForOpen(file.path);
      const revealPath = resolvePathForReveal(file);

      return [
        {
          label: "Open File",
          icon: <File size={14} />,
          disabled: file.status === "deleted" || !onFileOpen,
          onSelect: () => {
            if (onFileOpen && file.status !== "deleted") {
              onFileOpen(absolutePath);
            }
          },
        },
        {
          label: "View Diff",
          icon: <Eye size={14} />,
          onSelect: () => {
            void viewFileDiff(file);
          },
        },
        file.staged
          ? {
              label: "Unstage",
              icon: <Minus size={14} />,
              onSelect: () => {
                void runPanelAction(() => git.unstageFile(file.path));
              },
            }
          : {
              label: "Stage",
              icon: <Plus size={14} />,
              onSelect: () => {
                void runPanelAction(() => git.stageFile(file.path));
              },
            },
        !file.staged && canDiscardFile(file)
          ? {
              label: "Discard Changes",
              icon: <RotateCcw size={14} />,
              danger: true,
              onSelect: () => {
                void runPanelAction(() => git.discardFile(file.path));
              },
            }
          : { hidden: true },
        { separator: true },
        {
          label: "Copy Relative Path",
          icon: <Copy size={14} />,
          onSelect: () => {
            void copyRelativePath(absolutePath);
          },
        },
        {
          label: "Copy Absolute Path",
          icon: <Copy size={14} />,
          onSelect: () => {
            void copyAbsolutePath(absolutePath);
          },
        },
        {
          label: "Reveal in File Manager",
          icon: <ExternalLink size={14} />,
          onSelect: () => {
            void revealEntry(revealPath);
          },
        },
      ];
    },
    [
      copyAbsolutePath,
      copyRelativePath,
      git,
      onFileOpen,
      resolvePathForOpen,
      resolvePathForReveal,
      revealEntry,
      runPanelAction,
      viewFileDiff,
    ],
  );

  const closeDiff = useCallback(() => {
    setDiffState(null);
    if (diffReturnTab) {
      setDetailTab(diffReturnTab);
      if (presentationMode === "compact") {
        setDetailOpen(true);
      }
    } else {
      setDetailTab("commit");
      if (presentationMode === "compact") {
        setDetailOpen(false);
      }
    }
    setDiffReturnTab(null);
  }, [diffReturnTab, presentationMode]);

  const navigateDiff = useCallback(
    (direction: "prev" | "next") => {
      if (selectedFileIndex === -1) {
        return;
      }
      const nextIndex =
        direction === "prev" ? selectedFileIndex - 1 : selectedFileIndex + 1;
      if (nextIndex < 0 || nextIndex >= allChangedFiles.length) {
        return;
      }
      void viewFileDiff(allChangedFiles[nextIndex]);
    },
    [allChangedFiles, selectedFileIndex, viewFileDiff],
  );

  const previewPullRequestUrl = useCallback(async () => {
    const url = await git.getPullRequestUrl(effectivePrBase);
    if (!url) {
      notifyGitError(
        "Unable to build PR URL. Make sure a GitHub remote is configured.",
      );
      return;
    }
    setPrUrl(url);
  }, [effectivePrBase, git, notifyGitError]);

  const openPullRequestUrl = useCallback(async () => {
    const url = await git.openPullRequest(effectivePrBase);
    if (!url) {
      notifyGitError(
        "Unable to open PR URL. Make sure a GitHub remote is configured.",
      );
      return;
    }
    setPrUrl(url);
  }, [effectivePrBase, git, notifyGitError]);

  const selectedRemoteLabel =
    git.selectedRemote || git.remotes[0] || "no remote";

  const detailDirection = useMemo(() => {
    switch (panelPosition) {
      case "left":
        return {
          closedTransform: "translate3d(-100%, 0, 0)",
          border: "1px solid var(--git-border)",
          boxShadow: "var(--shadow-overlay)",
        };
      case "top":
        return {
          closedTransform: "translate3d(0, -100%, 0)",
          border: "1px solid var(--git-border)",
          boxShadow: "var(--shadow-overlay)",
        };
      case "bottom":
        return {
          closedTransform: "translate3d(0, 100%, 0)",
          border: "1px solid var(--git-border)",
          boxShadow: "var(--shadow-overlay)",
        };
      case "right":
      default:
        return {
          closedTransform: "translate3d(100%, 0, 0)",
          border: "1px solid var(--git-border)",
          boxShadow: "var(--shadow-overlay)",
        };
    }
  }, [panelPosition]);

  const detailTabs = useMemo(
    () =>
      [
        ["commit", "Commit", GitCommit],
        ["history", "History", History],
        ["pull_requests", "PR", GitBranch],
        ["stash", "Stash", Sparkles],
        ["diff", "Diff", Eye],
      ] as const satisfies ReadonlyArray<
        readonly [
          DetailTab,
          string,
          React.ComponentType<{ size?: number; className?: string }>,
        ]
      >,
    [],
  );

  const renderBranchCluster = (carded: boolean): React.ReactNode => (
    <div className={carded ? `${gitSectionClass} p-4` : ""}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="shell-cluster-soft min-w-0 flex-1 px-1.5 py-1">
            <button
              type="button"
              onClick={() => setShowBranchDropdown((value) => !value)}
              className="shell-control h-10 min-w-0 flex-1 justify-start gap-2 px-3 text-[var(--git-text)] hover:text-[var(--git-text)]"
            >
              <FolderGit2
                size={14}
                className="shrink-0 text-[var(--status-success)]"
              />
              <GitBranch
                size={13}
                className="shrink-0 text-[var(--status-success)]"
              />
              <span className="truncate text-[13px] font-medium">
                {git.branch.current || "Detached HEAD"}
              </span>
              <ChevronDown
                size={12}
                className="ml-auto shrink-0 text-[var(--git-text-secondary)]"
              />
            </button>
          </div>

          <div className="shell-cluster-soft shrink-0 px-1.5 py-1">
            <span
              className={gitPillClass}
              style={{ color: "var(--status-success)" }}
            >
              <ArrowUp size={11} />
              {git.branch.ahead}
            </span>
            <span
              className={gitPillClass}
              style={{ color: "var(--status-warning)" }}
            >
              <ArrowDown size={11} />
              {git.branch.behind}
            </span>
            <button
              type="button"
              className={gitBubbleIconButtonClass}
              onClick={() => void runPanelAction(git.refresh)}
              title="Refresh status"
            >
              <RefreshCw
                size={14}
                className={git.loading ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {git.branch.upstream && (
            <span className={gitPillClass}>{git.branch.upstream}</span>
          )}
          <span className={gitPillClass}>{selectedRemoteLabel}</span>
          <span className={gitPillClass}>{changedCount} changed</span>
          {git.conflictedFiles.length > 0 && (
            <span
              className={gitPillClass}
              style={{ color: "var(--status-warning)" }}
            >
              {git.conflictedFiles.length} conflicts
            </span>
          )}
        </div>

        {showBranchDropdown && (
          <div
            className={`${gitInsetSectionClass} overflow-hidden`}
            style={{ boxShadow: "var(--shadow-overlay)" }}
          >
            <div className="max-h-52 overflow-y-auto p-2">
              {git.branches.map((candidate) => {
                const isCurrent = candidate === git.branch.current;
                return (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => {
                      void runPanelAction(() => git.switchBranch(candidate));
                      setShowBranchDropdown(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-[16px] px-3 py-2.5 text-left text-[12px] transition-colors hover:bg-[var(--git-row-active)]"
                    style={{
                      background: isCurrent
                        ? "var(--git-row-active)"
                        : "transparent",
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full border border-[var(--git-border)]"
                      style={{
                        background: isCurrent
                          ? "var(--status-success)"
                          : "transparent",
                      }}
                    />
                    <span className="truncate text-[var(--git-text)]">
                      {candidate}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-[var(--git-border)] p-3">
              <div className="flex items-center gap-2">
                <input
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleCreateBranch();
                    }
                  }}
                  placeholder="Create branch"
                  style={inputStyle(theme)}
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleCreateBranch();
                  }}
                  className={gitBubbleIconButtonClass}
                  title="Create branch"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderCompactSections = (): React.ReactNode => (
    <div
      data-testid="git-compact-scroll-region"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="flex min-h-full flex-col gap-3 px-3 py-3">
        {git.conflictedFiles.length > 0 && (
          <FileSection
            title="Conflicts"
            files={git.conflictedFiles}
            open={conflictedOpen}
            presentationMode="compact"
            onToggle={() => setConflictedOpen((value) => !value)}
            emptyLabel="No conflicted files."
            selectedPath={selectedPath}
            onOpen={
              onFileOpen
                ? (path) => onFileOpen(resolvePathForOpen(path))
                : undefined
            }
            onViewDiff={viewFileDiff}
            onStage={(path) => void runPanelAction(() => git.stageFile(path))}
            onUnstage={(path) =>
              void runPanelAction(() => git.unstageFile(path))
            }
            onDiscard={(path) =>
              void runPanelAction(() => git.discardFile(path))
            }
            getContextMenuItems={buildFileContextMenuItems}
          />
        )}

        <FileSection
          title="Staged"
          files={git.stagedFiles}
          open={stagedOpen}
          presentationMode="compact"
          onToggle={() => setStagedOpen((value) => !value)}
          bulkActionLabel="Unstage all"
          onBulkAction={() => void runPanelAction(git.unstageAll)}
          emptyLabel="Nothing is staged yet."
          selectedPath={selectedPath}
          onOpen={
            onFileOpen
              ? (path) => onFileOpen(resolvePathForOpen(path))
              : undefined
          }
          onViewDiff={viewFileDiff}
          onStage={(path) => void runPanelAction(() => git.stageFile(path))}
          onUnstage={(path) => void runPanelAction(() => git.unstageFile(path))}
          onDiscard={(path) => void runPanelAction(() => git.discardFile(path))}
          getContextMenuItems={buildFileContextMenuItems}
        />

        <FileSection
          title="Working Tree"
          files={git.unstagedFiles}
          open={unstagedOpen}
          presentationMode="compact"
          onToggle={() => setUnstagedOpen((value) => !value)}
          bulkActionLabel="Stage all"
          onBulkAction={() => void runPanelAction(git.stageAll)}
          emptyLabel="Working tree is clean."
          selectedPath={selectedPath}
          onOpen={
            onFileOpen
              ? (path) => onFileOpen(resolvePathForOpen(path))
              : undefined
          }
          onViewDiff={viewFileDiff}
          onStage={(path) => void runPanelAction(() => git.stageFile(path))}
          onUnstage={(path) => void runPanelAction(() => git.unstageFile(path))}
          onDiscard={(path) => void runPanelAction(() => git.discardFile(path))}
          getContextMenuItems={buildFileContextMenuItems}
        />
      </div>
    </div>
  );

  const renderExpandedSections = (): React.ReactNode => (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        data-testid="git-expanded-scroll-region"
        className="min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <div className="flex min-h-full flex-col gap-4">
          {renderBranchCluster(true)}

          {git.conflictedFiles.length > 0 && (
            <FileSection
              title="Conflicts"
              files={git.conflictedFiles}
              open={conflictedOpen}
              presentationMode="expanded"
              onToggle={() => setConflictedOpen((value) => !value)}
              emptyLabel="No conflicted files."
              selectedPath={selectedPath}
              onOpen={
                onFileOpen
                  ? (path) => onFileOpen(resolvePathForOpen(path))
                  : undefined
              }
              onViewDiff={viewFileDiff}
              onStage={(path) => void runPanelAction(() => git.stageFile(path))}
              onUnstage={(path) =>
                void runPanelAction(() => git.unstageFile(path))
              }
              onDiscard={(path) =>
                void runPanelAction(() => git.discardFile(path))
              }
              getContextMenuItems={buildFileContextMenuItems}
            />
          )}

          <FileSection
            title="Staged"
            files={git.stagedFiles}
            open={stagedOpen}
            presentationMode="expanded"
            onToggle={() => setStagedOpen((value) => !value)}
            bulkActionLabel="Unstage all"
            onBulkAction={() => void runPanelAction(git.unstageAll)}
            emptyLabel="Nothing is staged yet."
            selectedPath={selectedPath}
            onOpen={
              onFileOpen
                ? (path) => onFileOpen(resolvePathForOpen(path))
                : undefined
            }
            onViewDiff={viewFileDiff}
            onStage={(path) => void runPanelAction(() => git.stageFile(path))}
            onUnstage={(path) =>
              void runPanelAction(() => git.unstageFile(path))
            }
            onDiscard={(path) =>
              void runPanelAction(() => git.discardFile(path))
            }
            getContextMenuItems={buildFileContextMenuItems}
          />

          <FileSection
            title="Working Tree"
            files={git.unstagedFiles}
            open={unstagedOpen}
            presentationMode="expanded"
            onToggle={() => setUnstagedOpen((value) => !value)}
            bulkActionLabel="Stage all"
            onBulkAction={() => void runPanelAction(git.stageAll)}
            emptyLabel="Working tree is clean."
            selectedPath={selectedPath}
            onOpen={
              onFileOpen
                ? (path) => onFileOpen(resolvePathForOpen(path))
                : undefined
            }
            onViewDiff={viewFileDiff}
            onStage={(path) => void runPanelAction(() => git.stageFile(path))}
            onUnstage={(path) =>
              void runPanelAction(() => git.unstageFile(path))
            }
            onDiscard={(path) =>
              void runPanelAction(() => git.discardFile(path))
            }
            getContextMenuItems={buildFileContextMenuItems}
          />

          <section className={gitSectionClass}>
            <div className="border-b border-[var(--git-border)] px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-[var(--git-text)]">
                  Commit
                </span>
                <span className={gitPillClass}>
                  {git.stagedFiles.length} staged
                </span>
              </div>
            </div>
            <div className="space-y-3 px-4 py-4">
              <textarea
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    void handleCommit();
                  }
                }}
                placeholder="feat(git): redesign git panel with wide diff view"
                style={textAreaStyle(theme)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`${gitPillClass} max-w-full`}>
                  Commit to {git.branch.current || "detached"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCommit()}
                  disabled={
                    !commitMessage.trim() ||
                    git.stagedFiles.length === 0 ||
                    git.busy
                  }
                  style={buttonStyle(
                    theme,
                    commitMessage.trim() && git.stagedFiles.length > 0
                      ? "accent"
                      : "default",
                  )}
                >
                  <Check size={13} />
                  Commit
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  const renderDetailTabs = (): React.ReactNode => (
    <div className="shell-mini-x-scroll w-full min-w-0 overflow-x-auto overflow-y-hidden">
      <div className="shell-cluster-soft inline-flex min-w-max px-1.5 py-1">
        {detailTabs.map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => openDetail(value)}
            className={`shell-control h-9 gap-2 rounded-[18px] px-3 text-[11px] ${
              detailTab === value
                ? "border-[var(--accent-brand)] bg-[var(--accent-brand-soft)] text-[var(--accent-brand)]"
                : "text-[var(--git-text-secondary)]"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderCommitDetail = (): React.ReactNode => (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4">
      <div className={`${gitInsetSectionClass} p-4`}>
        <div className="mb-3 flex items-center justify-between text-[11px] text-[var(--git-text-secondary)]">
          <span className="inline-flex items-center gap-1 font-medium text-[var(--git-text)]">
            <GitCommit size={12} />
            Commit
          </span>
          <span>{git.stagedFiles.length} staged</span>
        </div>
        <div className="space-y-3">
          <textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                void handleCommit();
              }
            }}
            placeholder="Commit message"
            style={textAreaStyle(theme)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--git-text-tertiary)]">
              Ctrl/Cmd + Enter to commit
            </span>
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={
                !commitMessage.trim() ||
                git.stagedFiles.length === 0 ||
                git.busy
              }
              style={buttonStyle(
                theme,
                commitMessage.trim() && git.stagedFiles.length > 0
                  ? "accent"
                  : "default",
              )}
            >
              <Check size={13} />
              Commit
            </button>
          </div>
        </div>
      </div>

      <div className={`${gitInsetSectionClass} p-4`}>
        <div className="mb-3 flex items-center justify-between text-[11px] text-[var(--git-text-secondary)]">
          <span className="font-medium text-[var(--git-text)]">Sync</span>
          <span>{selectedRemoteLabel}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {git.remotes.length > 1 && (
            <select
              value={git.selectedRemote}
              onChange={(event) => git.setSelectedRemote(event.target.value)}
              style={{
                ...inputStyle(theme),
                width: 144,
                padding: "8px 12px",
              }}
            >
              {git.remotes.map((remote) => (
                <option key={remote} value={remote}>
                  {remote}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            style={buttonStyle(theme)}
            onClick={() => void runPanelAction(git.fetchRemote)}
          >
            Fetch
          </button>
          <button
            type="button"
            style={buttonStyle(theme)}
            onClick={() => void runPanelAction(git.pullRemote)}
          >
            Pull
          </button>
          <button
            type="button"
            style={buttonStyle(
              theme,
              git.branch.ahead > 0 ? "accent" : "default",
            )}
            onClick={() => void runPanelAction(() => git.pushRemote(false))}
          >
            <Send size={13} />
            Push
          </button>
        </div>
      </div>
    </div>
  );

  const renderPullRequestDetail = (): React.ReactNode => (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4">
      <div className={`${gitInsetSectionClass} p-4`}>
        <div className="text-[13px] font-semibold text-[var(--git-text)]">
          Pull request flow
        </div>
        <div className="mt-2 text-[12px] text-[var(--git-text-secondary)]">
          Build a GitHub compare URL from the current branch and open it in the
          browser.
        </div>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-[11px] text-[var(--git-text-secondary)]">
            Base branch
            <input
              value={prBaseOverride}
              onChange={(event) => setPrBaseOverride(event.target.value)}
              placeholder={inferredBaseBranch}
              style={inputStyle(theme)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              style={buttonStyle(theme)}
              onClick={() => void runPanelAction(() => git.pushRemote(true))}
            >
              Push -u
            </button>
            <button
              type="button"
              style={buttonStyle(theme)}
              onClick={() => void previewPullRequestUrl()}
            >
              Preview URL
            </button>
            <button
              type="button"
              style={buttonStyle(theme, "accent")}
              onClick={() => void openPullRequestUrl()}
            >
              Open PR
            </button>
          </div>
        </div>
      </div>

      <div
        className={`${gitInsetSectionClass} p-4 text-[12px] text-[var(--git-text-secondary)]`}
      >
        <div>
          Base branch:{" "}
          <span className="text-[var(--git-text)]">{effectivePrBase}</span>
        </div>
        <div className="mt-1">
          Source branch:{" "}
          <span className="text-[var(--git-text)]">
            {git.branch.current || "detached"}
          </span>
        </div>
      </div>

      {prUrl && (
        <div
          className={`${gitInsetSectionClass} break-all p-4 text-[12px] text-[var(--git-text-secondary)]`}
        >
          {prUrl}
        </div>
      )}
    </div>
  );

  const renderDetailBody = (): React.ReactNode => {
    if (detailTab === "commit") {
      return renderCommitDetail();
    }

    if (detailTab === "history") {
      return (
        <GitHistory
          commits={git.historyCommits}
          loading={git.historyLoading}
          onRefresh={() => void git.loadHistory()}
          onViewDiff={viewCommitDiff}
        />
      );
    }

    if (detailTab === "pull_requests") {
      return renderPullRequestDetail();
    }

    if (detailTab === "stash") {
      return (
        <div className="h-full min-h-0 overflow-y-auto px-4 py-4">
          <StashSection
            entries={git.stashEntries}
            loading={git.stashLoading || git.busy}
            message={stashMessage}
            onMessageChange={setStashMessage}
            onCreate={() => void handleCreateStash()}
            onPop={(ref) => void runPanelAction(() => git.popStash(ref))}
            onDrop={(ref) => void runPanelAction(() => git.dropStash(ref))}
          />
        </div>
      );
    }

    return diffState ? (
      <GitDiffViewer
        diff={diffState.content}
        fileName={diffState.title}
        onClose={closeDiff}
        onPrevFile={
          diffState.selectedPath && selectedFileIndex > 0
            ? () => navigateDiff("prev")
            : undefined
        }
        onNextFile={
          diffState.selectedPath &&
          selectedFileIndex < allChangedFiles.length - 1
            ? () => navigateDiff("next")
            : undefined
        }
        hasPrev={diffState.selectedPath !== null && selectedFileIndex > 0}
        hasNext={
          diffState.selectedPath !== null &&
          selectedFileIndex >= 0 &&
          selectedFileIndex < allChangedFiles.length - 1
        }
      />
    ) : (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-[var(--git-text-secondary)]">
        Select a file or a commit to inspect its diff here.
      </div>
    );
  };

  const renderInitializeRepositoryState = (): React.ReactNode => (
    <div
      data-testid="git-init-empty-state"
      className="flex h-full min-h-0 flex-1 items-center justify-center bg-[var(--git-bg-tertiary)] px-6 text-center"
    >
      <div className="flex w-full max-w-[360px] flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--git-text-secondary)] shadow-[var(--git-surface-shadow)]">
          <FolderGit2 size={22} />
        </div>
        <div className="space-y-2">
          <div className="text-[15px] font-semibold text-[var(--git-text)]">
            It's not a Git repository.
          </div>
          <div className="text-[12px] leading-5 text-[var(--git-text-secondary)]">
            Want to initialize Git?
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleInitializeRepository()}
          disabled={git.busy}
          className="shell-control h-11 justify-center gap-2 rounded-full px-5 text-[13px] font-medium text-[var(--git-text)] hover:border-[var(--status-success)] hover:text-[var(--status-success)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={15} className="text-[var(--status-success)]" />
          {git.busy ? "Initializing..." : "Initialize Git"}
        </button>
      </div>
    </div>
  );

  const renderDetailWorkspace = (
    showCloseButton: boolean,
    testId: string,
  ): React.ReactNode => (
    <section
      data-testid={testId}
      className={`${gitSectionClass} flex h-full min-h-0 flex-col`}
    >
      <div className="border-b border-[var(--git-border)] px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-4 text-[13px] font-medium text-[var(--git-text)]">
                <FolderGit2
                  size={14}
                  className="text-[var(--status-success)]"
                />
                Source control workspace
              </span>
              <span className={gitPillClass}>
                {git.branch.current || "detached"}
              </span>
              <span className={gitPillClass}>{selectedRemoteLabel}</span>
              <span
                className={gitPillClass}
                style={{ color: "var(--status-success)" }}
              >
                <ArrowUp size={11} />
                {git.branch.ahead}
              </span>
              <span
                className={gitPillClass}
                style={{ color: "var(--status-warning)" }}
              >
                <ArrowDown size={11} />
                {git.branch.behind}
              </span>
            </div>
            <div className="mt-3 min-w-0">{renderDetailTabs()}</div>
          </div>
          {showCloseButton && (
            <button
              type="button"
              onClick={() => setDetailOpen(false)}
              className={gitBubbleIconButtonClass}
              title="Close details"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">{renderDetailBody()}</div>
    </section>
  );

  return (
    <div
      data-testid="git-panel-root"
      data-git-mode={presentationMode}
      data-git-layout={layoutMode}
      style={panelVars}
      className="relative flex h-full min-h-0 flex-col bg-[var(--git-bg)] text-[var(--git-text)]"
    >
      {showInitializeRepository ? (
        renderInitializeRepositoryState()
      ) : isExpanded ? (
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div
            data-testid="git-expanded-workspace"
            className="grid h-full min-h-0 grid-cols-[minmax(320px,0.35fr)_minmax(0,0.65fr)] gap-4"
          >
            <div
              data-testid="git-expanded-sidebar"
              className="min-h-0 h-full overflow-hidden"
            >
              {renderExpandedSections()}
            </div>
            <div className="min-h-0 h-full overflow-hidden">
              {renderDetailWorkspace(false, "git-detail-pane")}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-[var(--git-border)] px-3 py-3">
            {renderBranchCluster(false)}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {renderCompactSections()}
          </div>

          <div className="border-t border-[var(--git-border)] px-3 py-3">
            <div className="shell-cluster-soft w-full gap-2 px-1.5 py-1.5">
              <button
                type="button"
                onClick={() => openDetail("commit")}
                className="shell-control h-10 min-w-0 flex-1 justify-center gap-2 px-4 text-[var(--git-text)] hover:border-[var(--accent-brand)] hover:text-[var(--accent-brand)]"
              >
                <GitCommit size={14} />
                Commit...
              </button>
              <button
                type="button"
                onClick={() =>
                  openDetail(detailTab === "diff" ? "commit" : detailTab)
                }
                className="shell-control h-10 min-w-0 justify-center gap-2 px-4 text-[var(--git-text-secondary)]"
              >
                <ChevronsRight size={14} />
                Open details
              </button>
            </div>
          </div>
        </>
      )}

      {!isExpanded && !showInitializeRepository && (
        <div
          aria-hidden={!detailOpen}
          data-testid="git-compact-detail-overlay"
          className="absolute inset-0 z-20 flex min-h-0 flex-col bg-[var(--git-bg)] p-3"
          style={{
            opacity: detailOpen ? 1 : 0,
            pointerEvents: detailOpen ? "auto" : "none",
            transform: detailOpen
              ? "translate3d(0, 0, 0)"
              : detailDirection.closedTransform,
            transition:
              "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease",
            willChange: "transform, opacity",
            contain: "layout paint",
            border: detailDirection.border,
            boxShadow: detailOpen ? detailDirection.boxShadow : "none",
          }}
        >
          {renderDetailWorkspace(true, "git-compact-detail-workspace")}
        </div>
      )}
    </div>
  );
};

export default GitPanel;
