import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Eye,
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
  Workflow,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import * as AppFunctions from "../../wailsjs/go/main/App";
import { useTheme } from "../hooks/useTheme";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { GitStashEntry, useGitStore } from "../stores/gitStore";
import { getThemeColors, radius, transitions } from "../styles/colors";
import type { GitFileEntry, GitFileStatus } from "../utils/git";
import type { PanelPosition } from "./ui/FloatingPanel";
import { GitDiffViewer } from "./GitDiffViewer";
import { GitHistory } from "./GitHistory";

interface GitPanelProps {
  projectPath: string;
  onFileOpen?: (path: string) => void;
  panelPosition?: PanelPosition;
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
  onOpen?: (path: string) => void;
  onViewDiff: (file: GitFileEntry) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
}

interface FileSectionProps {
  title: string;
  files: GitFileEntry[];
  open: boolean;
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
  borderRadius: radius.sm,
  background: theme.bgSecondary,
  color: theme.text,
  fontSize: 12,
  padding: "8px 10px",
  outline: "none",
  width: "100%",
});

const buttonStyle = (
  theme: ReturnType<typeof getThemeColors>,
  variant: "default" | "accent" | "danger" = "default",
): React.CSSProperties => ({
  border: `1px solid ${
    variant === "accent"
      ? "var(--status-success)"
      : variant === "danger"
        ? "var(--status-error)"
        : theme.border
  }`,
  background: "var(--surface-1)",
  color:
    variant === "accent"
      ? "var(--status-success)"
      : variant === "danger"
        ? "var(--status-error)"
        : theme.textMuted,
  borderRadius: radius.sm,
  padding: "6px 9px",
  fontSize: 11,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  cursor: "pointer",
  transition: transitions.fast,
});

const FileRow = React.memo<FileRowProps>(
  ({ file, selected, onOpen, onViewDiff, onStage, onUnstage, onDiscard }) => (
    <div
      className="group grid grid-cols-[2px_16px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-2 py-2 transition-colors"
      style={{
        borderColor: selected ? "var(--git-border-strong)" : "transparent",
        background: selected ? "var(--git-row-active)" : "transparent",
      }}
      onDoubleClick={() => onOpen?.(file.path)}
      title={file.path}
    >
      <span
        className="h-8 rounded-full"
        style={{ background: selected ? "var(--accent-brand)" : "transparent" }}
      />
      <span
        className="text-center text-[11px] font-semibold"
        style={{ color: statusColors[file.status] }}
      >
        {statusLabels[file.status]}
      </span>

      <div className="min-w-0">
        <div className="truncate text-[12px] text-[var(--git-text)]">
          {file.path}
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--git-text-secondary)]">
          {file.staged
            ? "staged"
            : file.status === "conflicted"
              ? "conflict"
              : "working tree"}
        </div>
      </div>

      <div
        className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ opacity: selected ? 1 : undefined }}
      >
        <button
          type="button"
          onClick={() => onViewDiff(file)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
          title="View diff"
        >
          <Eye size={13} />
        </button>

        {file.staged ? (
          <button
            type="button"
            onClick={() => onUnstage(file.path)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
            title="Unstage file"
          >
            <Minus size={13} />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onStage(file.path)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--status-success)] hover:text-[var(--status-success)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
              title="Stage file"
            >
              <Plus size={13} />
            </button>
            {file.status !== "conflicted" && (
              <button
                type="button"
                onClick={() => onDiscard(file.path)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--status-error)] hover:text-[var(--status-error)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
                title="Discard changes"
              >
                <RotateCcw size={13} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  ),
);

FileRow.displayName = "FileRow";

const FileSection = React.memo<FileSectionProps>(
  ({
    title,
    files,
    open,
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
  }) => (
    <section className="rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            size={13}
            className="shrink-0 text-[var(--git-text-secondary)] transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
            {title}
          </span>
          <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5 text-[10px] text-[var(--git-text-secondary)]">
            {files.length}
          </span>
        </button>

        {files.length > 0 && bulkActionLabel && onBulkAction && (
          <button
            type="button"
            onClick={onBulkAction}
            className="inline-flex items-center rounded-md border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--git-text-secondary)] transition-colors hover:text-[var(--git-text)]"
          >
            {bulkActionLabel}
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-[var(--git-border)] px-2 py-2">
          {files.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--git-border)] px-3 py-4 text-[12px] text-[var(--git-text-secondary)]">
              {emptyLabel}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {files.map((file) => (
                <FileRow
                  key={`${file.path}:${file.staged ? "staged" : "unstaged"}:${file.status}`}
                  file={file}
                  selected={selectedPath === file.path}
                  onOpen={onOpen}
                  onViewDiff={onViewDiff}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  onDiscard={onDiscard}
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
    <section className="rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Sparkles size={13} className="text-[var(--git-text-secondary)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
            Stashes
          </span>
          <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5 text-[10px] text-[var(--git-text-secondary)]">
            {entries.length}
          </span>
        </div>
      </div>

      <div className="border-t border-[var(--git-border)] px-3 py-3">
        <div className="flex gap-2">
          <input
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Optional stash message"
            className="w-full rounded-md border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 py-2 text-[12px] text-[var(--git-text)] outline-none placeholder:text-[var(--git-text-secondary)]"
          />
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 py-2 text-[11px] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)] disabled:cursor-wait disabled:opacity-60"
            disabled={loading}
          >
            <Plus size={13} />
            Stash
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {entries.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--git-border)] px-3 py-4 text-[12px] text-[var(--git-text-secondary)]">
              No saved stashes.
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.ref}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] text-[var(--git-text)]">
                    {entry.message || entry.ref}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--git-text-secondary)]">
                    <span>{entry.ref}</span>
                    <span>{entry.relativeDate}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onPop(entry.ref)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--git-border)] bg-[var(--git-surface)] px-2 text-[11px] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--status-success)] hover:text-[var(--status-success)]"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => onDrop(entry.ref)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--git-border)] bg-[var(--git-surface)] px-2 text-[11px] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--status-error)] hover:text-[var(--status-error)]"
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
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
  const git = useGitStore(
    useShallow((state) => ({
      loading: state.loading,
      busy: state.busy,
      error: state.error,
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

  const scaled = useCallback(
    (size: number): number => Math.max(10, Math.round(size * uiScale)),
    [uiScale],
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
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    git.setProjectPath(projectPath);
  }, [git, projectPath]);

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
  const humanError = toHumanError(git.error) || localError;

  const panelVars = useMemo(
    () =>
      ({
        "--git-bg": theme.bg,
        "--git-surface": "var(--surface-1)",
        "--git-bg-tertiary": "var(--surface-2)",
        "--git-border": theme.border,
        "--git-border-strong": "var(--border-default)",
        "--git-row-active": "var(--surface-active)",
        "--git-text": theme.text,
        "--git-text-secondary": theme.textMuted,
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

  const withErrorGuard = useCallback(async (action: () => Promise<void>) => {
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const runPanelAction = useCallback(
    async (action: () => Promise<void>) => {
      await withErrorGuard(action);
    },
    [withErrorGuard],
  );

  const openDetail = useCallback(
    (tab: DetailTab) => {
      setDetailOpen(true);
      setDetailTab(tab);
      if (tab === "history") {
        void git.loadHistory();
      }
    },
    [git],
  );

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) {
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

  const handleCreateStash = useCallback(async () => {
    await withErrorGuard(async () => {
      await git.createStash(stashMessage);
      setStashMessage("");
    });
  }, [git, stashMessage, withErrorGuard]);

  const viewFileDiff = useCallback(async (file: GitFileEntry) => {
    setSelectedPath(file.path);
    setLocalError(null);
    try {
      const diff = await AppFunctions.GetGitDiff(file.path, file.staged);
      setDiffReturnTab(detailOpen ? detailTab : null);
      setDiffState({
        title: file.path,
        content: diff || "",
        selectedPath: file.path,
      });
      setDetailOpen(true);
      setDetailTab("diff");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const viewCommitDiff = useCallback(async (hash: string) => {
    setSelectedPath(null);
    setLocalError(null);
    try {
      const diff = await AppFunctions.GetGitCommitDiff(hash);
      setDiffReturnTab(detailOpen ? detailTab : null);
      setDiffState({
        title: `Commit ${hash.slice(0, 7)}`,
        content: diff || "",
        selectedPath: null,
      });
      setDetailOpen(true);
      setDetailTab("diff");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const closeDiff = useCallback(() => {
    setDiffState(null);
    if (diffReturnTab) {
      setDetailTab(diffReturnTab);
      setDetailOpen(true);
    } else {
      setDetailOpen(false);
    }
    setDiffReturnTab(null);
  }, [diffReturnTab]);

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
    setLocalError(null);
    const url = await git.getPullRequestUrl(effectivePrBase);
    if (!url) {
      setLocalError(
        "Unable to build PR URL. Make sure a GitHub remote is configured.",
      );
      return;
    }
    setPrUrl(url);
  }, [effectivePrBase, git]);

  const openPullRequestUrl = useCallback(async () => {
    setLocalError(null);
    const url = await git.openPullRequest(effectivePrBase);
    if (!url) {
      setLocalError(
        "Unable to open PR URL. Make sure a GitHub remote is configured.",
      );
      return;
    }
    setPrUrl(url);
  }, [effectivePrBase, git]);

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
  }, [isDark, panelPosition]);

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

  return (
    <div
      style={{ ...panelVars, fontSize: scaled(12) }}
      className="relative flex h-full min-h-0 flex-col bg-[var(--git-bg)] text-[var(--git-text)]"
    >
      <div className="border-b border-[var(--git-border)] px-3 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--status-success)]">
            <FolderGit2 size={15} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBranchDropdown((value) => !value)}
                className="inline-flex max-w-full items-center gap-2 rounded-md border border-[var(--git-border)] bg-[var(--git-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--git-text)] transition-colors hover:border-[var(--git-border-strong)]"
              >
                <GitBranch
                  size={13}
                  className="shrink-0 text-[var(--status-success)]"
                />
                <span className="truncate">
                  {git.branch.current || "Detached HEAD"}
                </span>
                <ChevronDown
                  size={12}
                  className="shrink-0 text-[var(--git-text-secondary)]"
                />
              </button>

              <div className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
                <span className="inline-flex items-center gap-1 text-[var(--status-success)]">
                  <ArrowUp size={11} />
                  {git.branch.ahead}
                </span>
                <span className="inline-flex items-center gap-1 text-[var(--status-warning)]">
                  <ArrowDown size={11} />
                  {git.branch.behind}
                </span>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--git-text-secondary)]">
              {git.branch.upstream && (
                <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5 uppercase tracking-[0.14em]">
                  {git.branch.upstream}
                </span>
              )}
              <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5 uppercase tracking-[0.14em]">
                {changedCount} changed
              </span>
              <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5 uppercase tracking-[0.14em]">
                {selectedRemoteLabel}
              </span>
            </div>

            {showBranchDropdown && (
              <div
                className="mt-3 overflow-hidden rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)]"
                style={{
                  boxShadow: "var(--shadow-overlay)",
                }}
              >
                <div className="max-h-48 overflow-y-auto p-1">
                  {git.branches.map((candidate) => {
                    const isCurrent = candidate === git.branch.current;
                    return (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() => {
                          void runPanelAction(() =>
                            git.switchBranch(candidate),
                          );
                          setShowBranchDropdown(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors hover:bg-[var(--git-row-active)]"
                        style={{
                          background: isCurrent
                            ? "var(--git-row-active)"
                            : "transparent",
                        }}
                      >
                        <span
                          className="h-2 w-2 rounded-full border border-[var(--git-border)]"
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
                <div className="border-t border-[var(--git-border)] p-2">
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
                      style={buttonStyle(theme)}
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

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--git-border)] pt-3 text-[10px] uppercase tracking-[0.14em] text-[var(--git-text-secondary)]">
          <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5">
            {git.conflictedFiles.length} conflicts
          </span>
          <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5">
            {git.stagedFiles.length} staged
          </span>
          <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5">
            {git.unstagedFiles.length} working
          </span>
          <button
            type="button"
            style={buttonStyle(theme)}
            onClick={() => void runPanelAction(git.refresh)}
            title="Refresh status"
          >
            <RefreshCw
              size={13}
              className={git.loading ? "animate-spin" : ""}
            />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto px-3 py-3">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] px-3 py-2 text-[11px] text-[var(--git-text-secondary)]">
            <Workflow size={13} className="text-[var(--status-success)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-[var(--git-text)]">
                Compact source control
              </div>
              <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.14em] text-[var(--git-text-secondary)]">
                Review files here. Commit, history, diff and PR stay in details.
              </div>
            </div>
          </div>

          {git.conflictedFiles.length > 0 && (
            <FileSection
              title="Conflicts"
              files={git.conflictedFiles}
              open={conflictedOpen}
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
            />
          )}

          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
            <FileSection
              title="Staged"
              files={git.stagedFiles}
              open={stagedOpen}
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
            />

            <FileSection
              title="Working tree"
              files={git.unstagedFiles}
              open={unstagedOpen}
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
            />
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--git-border)] px-3 py-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => openDetail("commit")}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] px-3 text-[12px] font-medium text-[var(--git-text)] transition-colors hover:border-[var(--status-success)] hover:text-[var(--status-success)]"
          >
            <GitCommit size={14} />
            Commit...
          </button>
          <button
            type="button"
            onClick={() =>
              openDetail(detailTab === "diff" ? "commit" : detailTab)
            }
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 text-[12px] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)]"
          >
            <ChevronsRight size={14} />
            Open details
          </button>
        </div>
      </div>

      {humanError && (
        <div className="border-t border-[var(--git-border)] bg-[color:var(--status-error)]/10 px-3 py-2 text-[11px] text-[var(--git-text)]">
          {humanError}
        </div>
      )}

      <div
        aria-hidden={!detailOpen}
        className="absolute inset-0 z-20 flex flex-col bg-[var(--git-bg)]"
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
        <div className="border-b border-[var(--git-border)] px-3 py-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--status-success)]">
              <FolderGit2 size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="truncate text-[12px] font-semibold text-[var(--git-text)]">
                  Source control details
                </div>
                <span className="rounded-full border border-[var(--git-border)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--git-text-secondary)]">
                  {git.branch.current || "detached"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--git-text-secondary)]">
                <span>{selectedRemoteLabel}</span>
                <span className="text-[var(--status-success)]">
                  ↑ {git.branch.ahead}
                </span>
                <span className="text-[var(--status-warning)]">
                  ↓ {git.branch.behind}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDetailOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-border-strong)] hover:text-[var(--git-text)]"
              title="Close details"
            >
              <X size={15} />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {detailTabs.map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => openDetail(value)}
                className="inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[11px] transition-colors"
                style={{
                  borderColor:
                    detailTab === value
                      ? "var(--accent-brand)"
                      : "var(--git-border)",
                  background:
                    detailTab === value
                      ? "var(--accent-brand-soft)"
                      : "var(--git-surface)",
                  color:
                    detailTab === value
                      ? "var(--accent-brand)"
                      : "var(--git-text-secondary)",
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {detailTab === "commit" && (
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 py-3">
              <div className="rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
                  <span className="inline-flex items-center gap-1">
                    <GitCommit size={12} />
                    Commit
                  </span>
                  <span>{git.stagedFiles.length} staged</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
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
                    placeholder="Commit message"
                    style={inputStyle(theme)}
                  />
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
                <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[var(--git-text-secondary)]">
                  Ctrl/Cmd + Enter to commit
                </div>
              </div>

              <div className="rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] p-3">
                <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
                  <span>Sync</span>
                  <span>{selectedRemoteLabel}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {git.remotes.length > 1 && (
                    <select
                      value={git.selectedRemote}
                      onChange={(event) =>
                        git.setSelectedRemote(event.target.value)
                      }
                      style={{
                        ...inputStyle(theme),
                        width: 132,
                        padding: "6px 8px",
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
                    onClick={() =>
                      void runPanelAction(() => git.pushRemote(false))
                    }
                  >
                    <Send size={13} />
                    Push
                  </button>
                </div>
              </div>
            </div>
          )}

          {detailTab === "history" && (
            <GitHistory
              commits={git.historyCommits}
              loading={git.historyLoading}
              onRefresh={() => void git.loadHistory()}
              onViewDiff={viewCommitDiff}
            />
          )}

          {detailTab === "pull_requests" && (
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 py-3">
              <div className="rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
                  Pull request flow
                </div>
                <div className="mt-2 text-[12px] text-[var(--git-text-secondary)]">
                  Build a GitHub compare URL from the current branch and open it
                  in the browser.
                </div>
                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1 text-[11px] text-[var(--git-text-secondary)]">
                    Base branch
                    <input
                      value={prBaseOverride}
                      onChange={(event) =>
                        setPrBaseOverride(event.target.value)
                      }
                      placeholder={inferredBaseBranch}
                      style={inputStyle(theme)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      style={buttonStyle(theme)}
                      onClick={() =>
                        void runPanelAction(() => git.pushRemote(true))
                      }
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

              <div className="rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] p-3 text-[12px] text-[var(--git-text-secondary)]">
                <div>
                  Base branch:{" "}
                  <span className="text-[var(--git-text)]">
                    {effectivePrBase}
                  </span>
                </div>
                <div className="mt-1">
                  Source branch:{" "}
                  <span className="text-[var(--git-text)]">
                    {git.branch.current || "detached"}
                  </span>
                </div>
              </div>

              {prUrl && (
                <div className="rounded-lg border border-[var(--git-border)] bg-[var(--git-surface)] p-3 break-all text-[12px] text-[var(--git-text-secondary)]">
                  {prUrl}
                </div>
              )}
            </div>
          )}

          {detailTab === "stash" && (
            <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
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
          )}

          {detailTab === "diff" &&
            (diffState ? (
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
                hasPrev={
                  diffState.selectedPath !== null && selectedFileIndex > 0
                }
                hasNext={
                  diffState.selectedPath !== null &&
                  selectedFileIndex >= 0 &&
                  selectedFileIndex < allChangedFiles.length - 1
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[var(--git-text-secondary)]">
                Select a file or a commit to inspect its diff here.
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default GitPanel;
