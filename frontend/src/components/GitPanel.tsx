import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  GitBranch,
  GitCommit,
  History,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import * as AppFunctions from "../../wailsjs/go/main/App";
import { useTheme } from "../hooks/useTheme";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { useGitStore } from "../stores/gitStore";
import { getThemeColors, radius, transitions } from "../styles/colors";
import type { GitFileEntry, GitFileStatus } from "../utils/git";
import { GitDiffViewer } from "./GitDiffViewer";
import { GitHistory } from "./GitHistory";

interface GitPanelProps {
  projectPath: string;
  onFileOpen?: (path: string) => void;
}

type TabType = "changes" | "history" | "pull_requests";

const statusColors: Record<GitFileStatus, string> = {
  modified: "#f59e0b",
  added: "#22c55e",
  deleted: "#ef4444",
  untracked: "#3b82f6",
  renamed: "#8b5cf6",
  copied: "#06b6d4",
  conflicted: "#f97316",
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
  if (!error) return null;
  const normalized = error.toLowerCase();
  if (normalized.includes("not a git repository")) {
    return "This folder is not a git repository";
  }
  if (normalized.includes("no project open")) {
    return "No project open";
  }
  return error;
};

export const GitPanel: React.FC<GitPanelProps> = ({
  projectPath,
  onFileOpen,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const uiScale = useEditorSettingsStore((state) => state.uiScale);

  const loading = useGitStore((state) => state.loading);
  const busy = useGitStore((state) => state.busy);
  const error = useGitStore((state) => state.error);
  const expanded = useGitStore((state) => state.expanded);
  const branch = useGitStore((state) => state.branch);
  const branches = useGitStore((state) => state.branches);
  const remotes = useGitStore((state) => state.remotes);
  const selectedRemote = useGitStore((state) => state.selectedRemote);
  const stagedFiles = useGitStore((state) => state.stagedFiles);
  const unstagedFiles = useGitStore((state) => state.unstagedFiles);
  const conflictedFiles = useGitStore((state) => state.conflictedFiles);
  const setProjectPath = useGitStore((state) => state.setProjectPath);
  const toggleExpanded = useGitStore((state) => state.toggleExpanded);
  const setSelectedRemote = useGitStore((state) => state.setSelectedRemote);
  const refresh = useGitStore((state) => state.refresh);
  const stageFile = useGitStore((state) => state.stageFile);
  const unstageFile = useGitStore((state) => state.unstageFile);
  const stageAll = useGitStore((state) => state.stageAll);
  const unstageAll = useGitStore((state) => state.unstageAll);
  const discardFile = useGitStore((state) => state.discardFile);
  const commit = useGitStore((state) => state.commit);
  const switchBranch = useGitStore((state) => state.switchBranch);
  const createBranch = useGitStore((state) => state.createBranch);
  const fetchRemote = useGitStore((state) => state.fetchRemote);
  const pullRemote = useGitStore((state) => state.pullRemote);
  const pushRemote = useGitStore((state) => state.pushRemote);
  const getPullRequestUrl = useGitStore((state) => state.getPullRequestUrl);
  const openPullRequest = useGitStore((state) => state.openPullRequest);

  const scaled = useCallback(
    (size: number): number => Math.max(10, Math.round(size * uiScale)),
    [uiScale],
  );

  const [activeTab, setActiveTab] = useState<TabType>("changes");
  const [commitMessage, setCommitMessage] = useState("");
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [diffContent, setDiffContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<GitFileEntry | null>(null);
  const [stagedExpanded, setStagedExpanded] = useState(true);
  const [unstagedExpanded, setUnstagedExpanded] = useState(true);
  const [conflictedExpanded, setConflictedExpanded] = useState(true);
  const [prBaseBranch, setPrBaseBranch] = useState("");
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const allChangedFiles = useMemo(
    () => [...conflictedFiles, ...stagedFiles, ...unstagedFiles],
    [conflictedFiles, stagedFiles, unstagedFiles],
  );

  const selectedFileIndex = useMemo(() => {
    if (!selectedFile) return -1;
    return allChangedFiles.findIndex((item) => item.path === selectedFile.path);
  }, [allChangedFiles, selectedFile]);

  const changedCount =
    stagedFiles.length + unstagedFiles.length + conflictedFiles.length;
  const humanError = toHumanError(error) || localError;
  const inferredBaseBranch = useMemo(() => {
    if (branch.upstream.includes("/")) {
      return branch.upstream.split("/").slice(1).join("/");
    }
    return "main";
  }, [branch.upstream]);

  useEffect(() => {
    setProjectPath(projectPath);
  }, [projectPath, setProjectPath]);

  useEffect(() => {
    if (!projectPath) return;
    void refresh();
  }, [projectPath, refresh]);

  useEffect(() => {
    if (!projectPath) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 4500);
    return () => window.clearInterval(timer);
  }, [projectPath, refresh]);

  useEffect(() => {
    if (!prBaseBranch) {
      setPrBaseBranch(inferredBaseBranch);
    }
  }, [inferredBaseBranch, prBaseBranch]);

  const withErrorGuard = useCallback(async (action: () => Promise<void>) => {
    setLocalError(null);
    try {
      await action();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    await withErrorGuard(async () => {
      await commit(commitMessage);
      setCommitMessage("");
    });
  }, [commit, commitMessage, withErrorGuard]);

  const handleCreateBranch = useCallback(async () => {
    const branchName = newBranchName.trim();
    if (!branchName) return;
    await withErrorGuard(async () => {
      await createBranch(branchName, branch.current || undefined);
      setNewBranchName("");
      setShowBranchDropdown(false);
    });
  }, [branch.current, createBranch, newBranchName, withErrorGuard]);

  const viewFileDiff = useCallback(async (file: GitFileEntry) => {
    setSelectedFile(file);
    setLocalError(null);
    try {
      const diff = await AppFunctions.GetGitDiff(file.path, file.staged);
      setDiffContent(diff || "");
      setShowDiff(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const viewCommitDiff = useCallback(async (hash: string) => {
    setSelectedFile(null);
    setLocalError(null);
    try {
      const diff = await AppFunctions.GetGitCommitDiff(hash);
      setDiffContent(diff || "");
      setShowDiff(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const navigateDiff = useCallback(
    (direction: "prev" | "next") => {
      if (selectedFileIndex === -1) return;
      const nextIndex =
        direction === "prev" ? selectedFileIndex - 1 : selectedFileIndex + 1;
      if (nextIndex < 0 || nextIndex >= allChangedFiles.length) return;
      void viewFileDiff(allChangedFiles[nextIndex]);
    },
    [allChangedFiles, selectedFileIndex, viewFileDiff],
  );

  const previewPullRequestUrl = useCallback(async () => {
    setLocalError(null);
    const url = await getPullRequestUrl(prBaseBranch || inferredBaseBranch);
    if (!url) {
      setLocalError(
        "Unable to build PR URL. Ensure GitHub remote is configured.",
      );
      return;
    }
    setPrUrl(url);
  }, [getPullRequestUrl, inferredBaseBranch, prBaseBranch]);

  const openPullRequestUrl = useCallback(async () => {
    setLocalError(null);
    const url = await openPullRequest(prBaseBranch || inferredBaseBranch);
    if (!url) {
      setLocalError(
        "Unable to open PR URL. Ensure GitHub remote is configured.",
      );
      return;
    }
    setPrUrl(url);
  }, [inferredBaseBranch, openPullRequest, prBaseBranch]);

  const runPanelAction = useCallback(
    async (action: () => Promise<void>) => {
      await withErrorGuard(action);
    },
    [withErrorGuard],
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

  const actionButtonStyle: React.CSSProperties = {
    border: `1px solid ${theme.border}`,
    background: theme.bgSecondary,
    color: theme.text,
    borderRadius: radius.sm,
    padding: "5px 8px",
    fontSize: 11,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.7 : 1,
    transition: transitions.fast,
  };

  const fileRow = (file: GitFileEntry): React.ReactElement => (
    <div
      key={`${file.path}:${file.staged ? "staged" : "unstaged"}:${file.status}`}
      style={{
        display: "grid",
        gridTemplateColumns: "16px 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        borderRadius: radius.sm,
        background:
          selectedFile?.path === file.path
            ? isDark
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.05)"
            : "transparent",
        transition: transitions.fast,
      }}
      onDoubleClick={() => onFileOpen?.(resolvePathForOpen(file.path))}
    >
      <span
        style={{
          color: statusColors[file.status],
          fontWeight: 700,
          fontSize: 11,
          textAlign: "center",
        }}
      >
        {statusLabels[file.status]}
      </span>

      <div
        style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}
      >
        <FileText size={12} style={{ color: theme.textMuted, flexShrink: 0 }} />
        <span
          style={{
            color: theme.text,
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={file.path}
        >
          {file.path}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          title="View diff"
          style={{ ...actionButtonStyle, padding: "4px 6px" }}
          onClick={() => {
            void viewFileDiff(file);
          }}
        >
          <Eye size={12} />
        </button>

        {file.staged ? (
          <button
            title="Unstage"
            style={{ ...actionButtonStyle, padding: "4px 6px" }}
            onClick={() => {
              void runPanelAction(() => unstageFile(file.path));
            }}
          >
            <Minus size={12} />
          </button>
        ) : (
          <>
            <button
              title="Stage"
              style={{ ...actionButtonStyle, padding: "4px 6px" }}
              onClick={() => {
                void runPanelAction(() => stageFile(file.path));
              }}
            >
              <Plus size={12} />
            </button>
            <button
              title="Discard"
              style={{
                ...actionButtonStyle,
                padding: "4px 6px",
                color: "#ef4444",
              }}
              onClick={() => {
                void runPanelAction(() => discardFile(file.path));
              }}
            >
              <RotateCcw size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  const renderSection = (
    label: string,
    files: GitFileEntry[],
    expandedState: boolean,
    toggle: () => void,
    actionLabel?: string,
    action?: () => void,
  ): React.ReactElement => (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={toggle}
      >
        {expandedState ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: theme.textMuted,
          }}
        >
          {label} ({files.length})
        </span>

        {files.length > 0 && actionLabel && action && (
          <button
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              cursor: busy ? "wait" : "pointer",
              color: theme.textMuted,
              fontSize: 10,
            }}
            onClick={(event) => {
              event.stopPropagation();
              action();
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
      {expandedState && files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {files.map(fileRow)}
        </div>
      )}
    </div>
  );

  if (showDiff) {
    return (
      <GitDiffViewer
        diff={diffContent}
        fileName={selectedFile?.path || "Commit diff"}
        onClose={() => setShowDiff(false)}
        onPrevFile={
          selectedFile && selectedFileIndex > 0
            ? () => navigateDiff("prev")
            : undefined
        }
        onNextFile={
          selectedFile && selectedFileIndex < allChangedFiles.length - 1
            ? () => navigateDiff("next")
            : undefined
        }
        hasPrev={selectedFile !== null && selectedFileIndex > 0}
        hasNext={
          selectedFile !== null &&
          selectedFileIndex < allChangedFiles.length - 1
        }
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        color: theme.text,
        fontSize: scaled(12),
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          borderBottom: `1px solid ${theme.border}`,
          background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GitBranch size={14} style={{ color: "#22c55e", flexShrink: 0 }} />

          <button
            onClick={() => setShowBranchDropdown((prev) => !prev)}
            style={{
              border: "none",
              background: "transparent",
              color: theme.text,
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: radius.sm,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {branch.current || "No branch"}
            <ChevronDown size={12} style={{ color: theme.textMuted }} />
          </button>

          <span style={{ color: theme.textMuted, fontSize: 11 }}>
            {branch.upstream ? branch.upstream : "no upstream"}
          </span>

          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: theme.textMuted,
              fontSize: 11,
            }}
          >
            <ArrowUp size={12} style={{ color: "#22c55e" }} />
            {branch.ahead}
            <ArrowDown size={12} style={{ color: "#f59e0b" }} />
            {branch.behind}
          </span>
        </div>

        {showBranchDropdown && (
          <div
            style={{
              marginTop: 8,
              border: `1px solid ${theme.border}`,
              borderRadius: radius.md,
              background: theme.bg,
              boxShadow: isDark
                ? "0 12px 24px rgba(0,0,0,0.35)"
                : "0 10px 20px rgba(0,0,0,0.12)",
              overflow: "hidden",
            }}
          >
            <div style={{ maxHeight: 160, overflowY: "auto" }}>
              {branches.map((candidate) => (
                <button
                  key={candidate}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background:
                      candidate === branch.current
                        ? theme.bgSecondary
                        : "transparent",
                    color: theme.text,
                    padding: "6px 10px",
                    fontSize: 12,
                    cursor: busy ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onClick={() => {
                    void runPanelAction(() => switchBranch(candidate));
                    setShowBranchDropdown(false);
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background:
                        candidate === branch.current
                          ? "#22c55e"
                          : "transparent",
                      border: `1px solid ${theme.border}`,
                    }}
                  />
                  {candidate}
                </button>
              ))}
            </div>

            <div
              style={{
                borderTop: `1px solid ${theme.border}`,
                padding: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <input
                value={newBranchName}
                onChange={(event) => setNewBranchName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleCreateBranch();
                  }
                }}
                placeholder="new branch"
                style={{
                  flex: 1,
                  border: `1px solid ${theme.border}`,
                  borderRadius: radius.sm,
                  background: theme.bgSecondary,
                  color: theme.text,
                  fontSize: 11,
                  padding: "5px 8px",
                  outline: "none",
                }}
              />
              <button
                style={{ ...actionButtonStyle, padding: "5px 8px" }}
                onClick={() => {
                  void handleCreateBranch();
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <select
            value={selectedRemote}
            onChange={(event) => setSelectedRemote(event.target.value)}
            style={{
              border: `1px solid ${theme.border}`,
              borderRadius: radius.sm,
              background: theme.bgSecondary,
              color: theme.text,
              padding: "4px 8px",
              fontSize: 11,
              minWidth: 88,
            }}
          >
            {remotes.length === 0 && <option value="">no remote</option>}
            {remotes.map((remote) => (
              <option key={remote} value={remote}>
                {remote}
              </option>
            ))}
          </select>

          <button
            style={actionButtonStyle}
            onClick={() => {
              void runPanelAction(fetchRemote);
            }}
          >
            Fetch
          </button>

          <button
            style={actionButtonStyle}
            onClick={() => {
              void runPanelAction(pullRemote);
            }}
          >
            Pull
          </button>

          <button
            style={{
              ...actionButtonStyle,
              borderColor: branch.ahead > 0 ? "#22c55e" : theme.border,
              color: branch.ahead > 0 ? "#22c55e" : theme.text,
            }}
            onClick={() => {
              void runPanelAction(() => pushRemote(false));
            }}
          >
            Push
          </button>

          <button
            style={actionButtonStyle}
            onClick={() => {
              void runPanelAction(refresh);
            }}
            title="Refresh git status"
          >
            <RefreshCw
              size={12}
              style={{
                animation: loading ? "spin 1s linear infinite" : "none",
              }}
            />
          </button>

          <button
            style={{ ...actionButtonStyle, marginLeft: "auto" }}
            onClick={() => {
              toggleExpanded();
            }}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? "Compact" : "Expand"}
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "8px 10px",
          borderBottom: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: isDark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.01)",
        }}
      >
        <GitCommit size={13} style={{ color: theme.textMuted }} />
        <input
          type="text"
          value={commitMessage}
          placeholder="Commit message"
          onChange={(event) => setCommitMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              void handleCommit();
            }
          }}
          style={{
            flex: 1,
            border: `1px solid ${theme.border}`,
            borderRadius: radius.sm,
            background: theme.bgSecondary,
            color: theme.text,
            fontSize: 12,
            padding: "5px 8px",
            outline: "none",
          }}
        />
        <button
          style={{
            ...actionButtonStyle,
            color:
              commitMessage.trim().length > 0 && stagedFiles.length > 0
                ? "#22c55e"
                : theme.textMuted,
            borderColor:
              commitMessage.trim().length > 0 && stagedFiles.length > 0
                ? "#22c55e"
                : theme.border,
          }}
          disabled={
            commitMessage.trim().length === 0 || stagedFiles.length === 0
          }
          onClick={() => {
            void handleCommit();
          }}
        >
          <Check size={12} />
          Commit
        </button>
      </div>

      <div
        style={{
          padding: "8px 10px",
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
          }}
        >
          <span style={{ color: theme.textMuted }}>Changes:</span>
          <span style={{ color: "#22c55e" }}>staged {stagedFiles.length}</span>
          <span style={{ color: "#f59e0b" }}>
            unstaged {unstagedFiles.length}
          </span>
          <span style={{ color: "#f97316" }}>
            conflicts {conflictedFiles.length}
          </span>
          <span style={{ marginLeft: "auto", color: theme.textMuted }}>
            total {changedCount}
          </span>
        </div>
      </div>

      <div
        style={{
          maxHeight: expanded ? 1200 : 184,
          opacity: expanded ? 1 : 0.96,
          transform: expanded ? "translateY(0)" : "translateY(-2px)",
          transition:
            "max-height 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, transform 180ms ease",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            borderBottom: `1px solid ${theme.border}`,
            marginTop: expanded ? 0 : 6,
          }}
        >
          <button
            style={{
              flex: 1,
              border: "none",
              borderBottom:
                activeTab === "changes"
                  ? `2px solid ${theme.textPrimary}`
                  : "2px solid transparent",
              background: "transparent",
              color: activeTab === "changes" ? theme.text : theme.textMuted,
              fontSize: 11,
              padding: "8px 4px",
              cursor: "pointer",
              display: "inline-flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 4,
            }}
            onClick={() => setActiveTab("changes")}
          >
            <GitCommit size={12} />
            Changes
          </button>

          <button
            style={{
              flex: 1,
              border: "none",
              borderBottom:
                activeTab === "history"
                  ? `2px solid ${theme.textPrimary}`
                  : "2px solid transparent",
              background: "transparent",
              color: activeTab === "history" ? theme.text : theme.textMuted,
              fontSize: 11,
              padding: "8px 4px",
              cursor: "pointer",
              display: "inline-flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 4,
            }}
            onClick={() => setActiveTab("history")}
          >
            <History size={12} />
            History
          </button>

          <button
            style={{
              flex: 1,
              border: "none",
              borderBottom:
                activeTab === "pull_requests"
                  ? `2px solid ${theme.textPrimary}`
                  : "2px solid transparent",
              background: "transparent",
              color:
                activeTab === "pull_requests" ? theme.text : theme.textMuted,
              fontSize: 11,
              padding: "8px 4px",
              cursor: "pointer",
            }}
            onClick={() => setActiveTab("pull_requests")}
          >
            PR
          </button>
        </div>

        {activeTab === "changes" && (
          <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
            {conflictedFiles.length > 0 &&
              renderSection(
                "Conflicts",
                conflictedFiles,
                conflictedExpanded,
                () => setConflictedExpanded((prev) => !prev),
              )}

            {renderSection(
              "Staged",
              stagedFiles,
              stagedExpanded,
              () => setStagedExpanded((prev) => !prev),
              "Unstage all",
              () => {
                void runPanelAction(unstageAll);
              },
            )}

            {renderSection(
              "Working tree",
              unstagedFiles,
              unstagedExpanded,
              () => setUnstagedExpanded((prev) => !prev),
              "Stage all",
              () => {
                void runPanelAction(stageAll);
              },
            )}
          </div>
        )}

        {activeTab === "history" && <GitHistory onViewDiff={viewCommitDiff} />}

        {activeTab === "pull_requests" && (
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12, color: theme.textMuted }}>
              GitHub compare URL workflow.
            </div>

            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 11,
                color: theme.textMuted,
              }}
            >
              Base branch
              <input
                value={prBaseBranch}
                onChange={(event) => setPrBaseBranch(event.target.value)}
                style={{
                  border: `1px solid ${theme.border}`,
                  borderRadius: radius.sm,
                  background: theme.bgSecondary,
                  color: theme.text,
                  padding: "6px 8px",
                  fontSize: 12,
                  outline: "none",
                }}
              />
            </label>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button
                style={actionButtonStyle}
                onClick={() => {
                  void runPanelAction(() => pushRemote(true));
                }}
              >
                Push -u
              </button>
              <button
                style={actionButtonStyle}
                onClick={() => {
                  void previewPullRequestUrl();
                }}
              >
                Preview PR URL
              </button>
              <button
                style={{
                  ...actionButtonStyle,
                  borderColor: "#22c55e",
                  color: "#22c55e",
                }}
                onClick={() => {
                  void openPullRequestUrl();
                }}
              >
                Open Pull Request
              </button>
            </div>

            {prUrl && (
              <div
                style={{
                  border: `1px solid ${theme.border}`,
                  background: theme.bgSecondary,
                  borderRadius: radius.sm,
                  padding: 8,
                  fontSize: 11,
                  color: theme.textMuted,
                  wordBreak: "break-all",
                }}
              >
                {prUrl}
              </div>
            )}

            <div style={{ fontSize: 11, color: theme.textMuted }}>
              Target remote: {selectedRemote || "none"}. Ahead {branch.ahead},
              behind {branch.behind}.
            </div>
          </div>
        )}
      </div>

      {humanError && (
        <div
          style={{
            borderTop: `1px solid ${theme.border}`,
            background: isDark ? "rgba(239,68,68,0.1)" : "rgba(239,68,68,0.08)",
            color: theme.text,
            fontSize: 11,
            padding: "8px 10px",
          }}
        >
          {humanError}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default GitPanel;
