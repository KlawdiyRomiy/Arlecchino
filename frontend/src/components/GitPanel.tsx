import React, { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  Plus,
  Minus,
  RefreshCw,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  FileText,
  History,
  GitCommit,
  Eye,
  RotateCcw,
} from "lucide-react";
import { getThemeColors, radius, transitions } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { GitDiffViewer } from "./GitDiffViewer";
import { GitHistory } from "./GitHistory";
import * as AppFunctions from "../../wailsjs/go/main/App";

interface GitFile {
  path: string;
  status: "modified" | "added" | "deleted" | "untracked" | "renamed";
  staged: boolean;
}

interface GitPanelProps {
  projectPath: string;
  onFileOpen?: (path: string) => void;
}

type TabType = "changes" | "history";

const statusColors: Record<string, string> = {
  modified: "#F59E0B",
  added: "#22C55E",
  deleted: "#EF4444",
  untracked: "#8B5CF6",
  renamed: "#3B82F6",
};

const statusLabels: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "?",
  renamed: "R",
};

export const GitPanel: React.FC<GitPanelProps> = ({
  projectPath,
  onFileOpen,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const uiScale = useEditorSettingsStore((state) => state.uiScale);

  // Scale helper for font sizes
  const scaled = (size: number) => Math.round(size * uiScale);

  const [activeTab, setActiveTab] = useState<TabType>("changes");
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [stagedExpanded, setStagedExpanded] = useState(true);
  const [unstagedExpanded, setUnstagedExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<GitFile | null>(null);
  const [diffContent, setDiffContent] = useState<string>("");
  const [showDiff, setShowDiff] = useState(false);

  const allChangedFiles = [...stagedFiles, ...unstagedFiles];
  const selectedFileIndex = selectedFile
    ? allChangedFiles.findIndex((f) => f.path === selectedFile.path)
    : -1;

  const parseGitStatus = useCallback(
    (output: string): { staged: GitFile[]; unstaged: GitFile[] } => {
      const staged: GitFile[] = [];
      const unstaged: GitFile[] = [];

      output.split("\n").forEach((line) => {
        if (!line.trim() || line.length < 3) return;

        const indexStatus = line[0];
        const workTreeStatus = line[1];
        let path = line.slice(3).trim();

        if (path.includes(" -> ")) {
          path = path.split(" -> ")[1];
        }

        if (!path) return;

        const getStatus = (code: string): GitFile["status"] => {
          switch (code) {
            case "M":
              return "modified";
            case "A":
              return "added";
            case "D":
              return "deleted";
            case "R":
              return "renamed";
            case "?":
              return "untracked";
            default:
              return "modified";
          }
        };

        if (indexStatus !== " " && indexStatus !== "?") {
          staged.push({ path, status: getStatus(indexStatus), staged: true });
        }

        if (workTreeStatus !== " ") {
          unstaged.push({
            path,
            status: getStatus(workTreeStatus === "?" ? "?" : workTreeStatus),
            staged: false,
          });
        }
      });

      return { staged, unstaged };
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setError("No project open");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const branchResult = await AppFunctions.GetGitBranch();
      setBranch(branchResult || "");

      try {
        const branchesResult = await AppFunctions.GetGitBranches();
        setBranches(branchesResult || []);
      } catch {
        setBranches([]);
      }

      try {
        const statusResult = await AppFunctions.GetGitStatus();
        const { staged, unstaged } = parseGitStatus(statusResult || "");
        setStagedFiles(staged);
        setUnstagedFiles(unstaged);
      } catch {
        setStagedFiles([]);
        setUnstagedFiles([]);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("not a git repository")) {
        setError("Not a git repository");
      } else if (errMsg.includes("no project open")) {
        setError("No project open");
      } else {
        setError("Git error");
      }
      setBranch("");
      setBranches([]);
    }

    setIsLoading(false);
  }, [projectPath, parseGitStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const viewFileDiff = async (file: GitFile) => {
    setSelectedFile(file);
    try {
      const diff = await AppFunctions.GetGitDiff(file.path, file.staged);
      setDiffContent(diff || "");
      setShowDiff(true);
    } catch (err) {
      console.error("[GitPanel] Failed to get diff:", err);
    }
  };

  const viewCommitDiff = async (hash: string) => {
    try {
      const diff = await AppFunctions.GetGitCommitDiff(hash);
      setDiffContent(diff || "");
      setSelectedFile(null);
      setShowDiff(true);
    } catch (err) {
      console.error("[GitPanel] Failed to get commit diff:", err);
    }
  };

  const navigateDiff = (direction: "prev" | "next") => {
    if (selectedFileIndex === -1) return;
    const newIndex =
      direction === "prev" ? selectedFileIndex - 1 : selectedFileIndex + 1;
    if (newIndex >= 0 && newIndex < allChangedFiles.length) {
      viewFileDiff(allChangedFiles[newIndex]);
    }
  };

  const stageFile = async (path: string) => {
    await AppFunctions.RunGitCommand(["add", path]);
    refresh();
  };

  const unstageFile = async (path: string) => {
    await AppFunctions.RunGitCommand(["reset", "HEAD", path]);
    refresh();
  };

  const stageAll = async () => {
    await AppFunctions.RunGitCommand(["add", "-A"]);
    refresh();
  };

  const unstageAll = async () => {
    await AppFunctions.RunGitCommand(["reset", "HEAD"]);
    refresh();
  };

  const commit = async () => {
    if (!commitMessage.trim()) return;
    await AppFunctions.RunGitCommand(["commit", "-m", commitMessage]);
    setCommitMessage("");
    refresh();
  };

  const discardFile = async (path: string) => {
    await AppFunctions.RunGitCommand(["checkout", "--", path]);
    refresh();
  };

  const checkoutBranch = async (branchName: string) => {
    await AppFunctions.RunGitCommand(["checkout", branchName]);
    setShowBranchDropdown(false);
    refresh();
  };

  const FileRow: React.FC<{ file: GitFile }> = ({ file }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        borderRadius: radius.sm,
        cursor: "pointer",
        transition: transitions.fast,
        background:
          selectedFile?.path === file.path
            ? isDark
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.05)"
            : "transparent",
      }}
      onMouseEnter={(e) => {
        if (selectedFile?.path !== file.path)
          e.currentTarget.style.background = theme.bgSecondary;
      }}
      onMouseLeave={(e) => {
        if (selectedFile?.path !== file.path)
          e.currentTarget.style.background = "transparent";
      }}
      onDoubleClick={() => onFileOpen?.(file.path)}
    >
      <span
        style={{
          color: statusColors[file.status],
          fontWeight: 600,
          fontSize: 11,
          width: 14,
          textAlign: "center",
        }}
      >
        {statusLabels[file.status]}
      </span>
      <FileText size={14} style={{ color: theme.textMuted, flexShrink: 0 }} />
      <span
        style={{
          color: theme.text,
          fontSize: 12,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {file.path.split("/").pop() || file.path}
      </span>
      <span
        style={{
          color: theme.textMuted,
          fontSize: 10,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 100,
        }}
      >
        {file.path.includes("/")
          ? file.path.substring(0, file.path.lastIndexOf("/"))
          : ""}
      </span>
      <div style={{ display: "flex", gap: 2 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            viewFileDiff(file);
          }}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 2,
            borderRadius: radius.sm,
            display: "flex",
          }}
          title="View diff"
        >
          <Eye size={14} style={{ color: theme.textMuted }} />
        </button>
        {file.staged ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              unstageFile(file.path);
            }}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 2,
              borderRadius: radius.sm,
              display: "flex",
            }}
            title="Unstage"
          >
            <Minus size={14} style={{ color: theme.textMuted }} />
          </button>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                stageFile(file.path);
              }}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 2,
                borderRadius: radius.sm,
                display: "flex",
              }}
              title="Stage"
            >
              <Plus size={14} style={{ color: theme.textMuted }} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                discardFile(file.path);
              }}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 2,
                borderRadius: radius.sm,
                display: "flex",
              }}
              title="Discard"
            >
              <RotateCcw size={14} style={{ color: "#EF4444" }} />
            </button>
          </>
        )}
      </div>
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

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          color: theme.text,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <GitBranch size={14} style={{ color: theme.textMuted }} />
            <span style={{ fontSize: 12, color: theme.textMuted }}>
              {error}
            </span>
          </div>
          <button
            onClick={refresh}
            disabled={isLoading}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 4,
              borderRadius: radius.sm,
              display: "flex",
            }}
          >
            <RefreshCw
              size={14}
              style={{
                color: theme.textMuted,
                animation: isLoading ? "spin 1s linear infinite" : "none",
              }}
            />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            textAlign: "center",
          }}
        >
          <div style={{ color: theme.textMuted, fontSize: 12 }}>
            {error === "Not a git repository" ? (
              <>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
                <div>This folder is not a git repository</div>
                <div style={{ marginTop: 8, opacity: 0.7 }}>
                  Run{" "}
                  <code
                    style={{
                      background: theme.bgSecondary,
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    git init
                  </code>{" "}
                  to initialize
                </div>
              </>
            ) : (
              <div>{error}</div>
            )}
          </div>
        </div>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        color: theme.text,
        fontSize: scaled(14),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            position: "relative",
          }}
        >
          <GitBranch size={14} style={{ color: "#22C55E" }} />
          <button
            onClick={() => setShowBranchDropdown(!showBranchDropdown)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: theme.text,
              fontSize: 12,
              fontWeight: 500,
              padding: "2px 6px",
              borderRadius: radius.sm,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = theme.bgSecondary)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            {branch || "No branch"}
            <ChevronDown size={12} style={{ color: theme.textMuted }} />
          </button>

          {showBranchDropdown && branches.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
                background: theme.bg,
                border: `1px solid ${theme.border}`,
                borderRadius: radius.md,
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                zIndex: 100,
                minWidth: 150,
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {branches.map((b) => (
                <button
                  key={b}
                  onClick={() => checkoutBranch(b)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "6px 12px",
                    background:
                      b === branch ? theme.bgSecondary : "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: theme.text,
                    fontSize: 12,
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = theme.bgSecondary)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      b === branch ? theme.bgSecondary : "transparent")
                  }
                >
                  {b === branch && (
                    <Check size={12} style={{ color: "#22C55E" }} />
                  )}
                  <span style={{ marginLeft: b === branch ? 0 : 20 }}>{b}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 4,
            borderRadius: radius.sm,
            display: "flex",
          }}
        >
          <RefreshCw
            size={14}
            style={{
              color: theme.textMuted,
              animation: isLoading ? "spin 1s linear infinite" : "none",
            }}
          />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <button
          onClick={() => setActiveTab("changes")}
          style={{
            flex: 1,
            padding: "8px 12px",
            background:
              activeTab === "changes"
                ? isDark
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(0,0,0,0.03)"
                : "transparent",
            border: "none",
            borderBottom:
              activeTab === "changes"
                ? `2px solid ${theme.textPrimary}`
                : "2px solid transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            color: activeTab === "changes" ? theme.text : theme.textMuted,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <GitCommit size={14} />
          Changes
          {stagedFiles.length + unstagedFiles.length > 0 && (
            <span
              style={{
                background: isDark
                  ? "rgba(255,255,255,0.15)"
                  : "rgba(0,0,0,0.1)",
                color: theme.text,
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 10,
              }}
            >
              {stagedFiles.length + unstagedFiles.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          style={{
            flex: 1,
            padding: "8px 12px",
            background:
              activeTab === "history"
                ? isDark
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(0,0,0,0.03)"
                : "transparent",
            border: "none",
            borderBottom:
              activeTab === "history"
                ? `2px solid ${theme.textPrimary}`
                : "2px solid transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            color: activeTab === "history" ? theme.text : theme.textMuted,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <History size={14} />
          History
        </button>
      </div>

      {activeTab === "changes" ? (
        <>
          <div
            style={{
              padding: "8px 12px",
              borderBottom: `1px solid ${theme.border}`,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message..."
                style={{
                  flex: 1,
                  background: theme.bgSecondary,
                  border: `1px solid ${theme.border}`,
                  borderRadius: radius.sm,
                  padding: "6px 10px",
                  fontSize: 12,
                  color: theme.text,
                  outline: "none",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    commit();
                  }
                }}
              />
              <button
                onClick={commit}
                disabled={!commitMessage.trim() || stagedFiles.length === 0}
                style={{
                  background:
                    stagedFiles.length > 0 && commitMessage.trim()
                      ? "#22C55E"
                      : theme.border,
                  border: "none",
                  borderRadius: radius.sm,
                  padding: "6px 12px",
                  fontSize: 12,
                  color: "#fff",
                  cursor:
                    stagedFiles.length > 0 && commitMessage.trim()
                      ? "pointer"
                      : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Check size={14} />
                Commit
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                onClick={() => setStagedExpanded(!stagedExpanded)}
              >
                {stagedExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: theme.textMuted,
                  }}
                >
                  Staged ({stagedFiles.length})
                </span>
                {stagedFiles.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      unstageAll();
                    }}
                    style={{
                      marginLeft: "auto",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 10,
                      color: theme.textMuted,
                    }}
                  >
                    Unstage All
                  </button>
                )}
              </div>
              {stagedExpanded &&
                stagedFiles.map((f) => (
                  <FileRow key={f.path + "-staged"} file={f} />
                ))}
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                onClick={() => setUnstagedExpanded(!unstagedExpanded)}
              >
                {unstagedExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: theme.textMuted,
                  }}
                >
                  Changes ({unstagedFiles.length})
                </span>
                {unstagedFiles.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      stageAll();
                    }}
                    style={{
                      marginLeft: "auto",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 10,
                      color: theme.textMuted,
                    }}
                  >
                    Stage All
                  </button>
                )}
              </div>
              {unstagedExpanded &&
                unstagedFiles.map((f) => (
                  <FileRow key={f.path + "-unstaged"} file={f} />
                ))}
            </div>
          </div>
        </>
      ) : (
        <GitHistory onViewDiff={viewCommitDiff} />
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
