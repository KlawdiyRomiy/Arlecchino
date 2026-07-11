import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  FileSearch,
  GitCommit,
  RefreshCw,
  Search,
  User,
} from "lucide-react";

import * as AppFunctions from "../wails/app";
import type { GitCommitInfo } from "../../bindings/arlecchino/internal/app/models";
import { useTheme } from "../hooks/useTheme";
import { radius, transitions, zIndex } from "../styles/colors";
import { toErrorMessage } from "../utils/errorMessages";
import { GitDiffViewer } from "./GitDiffViewer";

interface ParsedCommitStat {
  path: string;
  summary: string;
}

interface ParsedCommitDiffFile {
  path: string;
  diff: string;
}

interface CommitFileDetail {
  path: string;
  summary: string;
  diff: string;
}

interface GitHistoryProps {
  commits: GitCommitInfo[];
  loading: boolean;
  onRefresh: () => void;
  onViewDiff?: (hash: string) => void;
  variant?: "default" | "chat";
}

const parseGitDate = (value: string): Date | null => {
  const trimmed = value.trim();
  const legacyGitDate = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-]\d{2})(\d{2})$/,
  );
  const normalized = legacyGitDate
    ? `${legacyGitDate[1]}T${legacyGitDate[2]}${legacyGitDate[3]}:${legacyGitDate[4]}`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (dateStr: string): string => {
  const date = parseGitDate(dateStr);
  if (!date) return dateStr.trim() || "Unknown date";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      return `${Math.max(1, Math.floor(diffMs / (1000 * 60)))}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getInitials = (name: string): string =>
  name
    .split(" ")
    .map((value) => value[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const hashToColor = (hash: string): string => {
  let h = 0;
  for (let i = 0; i < hash.length; i += 1) {
    h = hash.charCodeAt(i) + ((h << 5) - h);
  }
  return `hsl(${Math.abs(h) % 360}, 58%, 48%)`;
};

const parseCommitStats = (output: string): ParsedCommitStat[] =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes(" | ") &&
        !line.startsWith("commit ") &&
        !line.startsWith("Author:") &&
        !line.startsWith("Date:"),
    )
    .map((line) => {
      const [path, summary] = line.split(" | ");
      return {
        path: path?.trim() ?? "",
        summary: summary?.trim() ?? "",
      } satisfies ParsedCommitStat;
    })
    .filter((line) => line.path);

const unquoteGitDiffPath = (path: string): string =>
  path.trim().replace(/^"|"$/g, "").replace(/^a\//, "").replace(/^b\//, "");

const parseCommitDiffPath = (header: string): string => {
  const quotedMatch = header.match(/^diff --git "a\/(.+)" "b\/(.+)"$/);
  if (quotedMatch) {
    return unquoteGitDiffPath(quotedMatch[2] ?? quotedMatch[1] ?? "");
  }

  const plainMatch = header.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (plainMatch) {
    return unquoteGitDiffPath(plainMatch[2] ?? plainMatch[1] ?? "");
  }

  return "";
};

const parseCommitDiffFiles = (diffText: string): ParsedCommitDiffFile[] => {
  const files: ParsedCommitDiffFile[] = [];
  let currentPath = "";
  let currentLines: string[] = [];

  const flushCurrent = () => {
    if (!currentPath || currentLines.length === 0) {
      return;
    }
    files.push({
      path: currentPath,
      diff: currentLines.join("\n"),
    });
  };

  diffText.split("\n").forEach((line) => {
    if (line.startsWith("diff --git ")) {
      flushCurrent();
      currentPath = parseCommitDiffPath(line);
      currentLines = [line];
      return;
    }

    if (currentLines.length > 0) {
      currentLines.push(line);
    }
  });

  flushCurrent();
  return files;
};

const pathsMatch = (first: string, second: string): boolean =>
  first === second ||
  first.endsWith(`/${second}`) ||
  second.endsWith(`/${first}`);

const buildCommitFileDetails = (
  stats: ParsedCommitStat[],
  diffFiles: ParsedCommitDiffFile[],
): CommitFileDetail[] => {
  if (stats.length === 0) {
    return diffFiles.map((file) => ({
      path: file.path,
      summary: "",
      diff: file.diff,
    }));
  }

  return stats.map((entry, index) => {
    const matchedDiff =
      diffFiles.find((file) => pathsMatch(file.path, entry.path)) ??
      diffFiles[index];
    return {
      path: entry.path,
      summary: entry.summary,
      diff: matchedDiff?.diff ?? "",
    };
  });
};

const hasRecordKey = <T,>(record: Record<string, T>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

export const GitHistory: React.FC<GitHistoryProps> = ({
  commits,
  loading,
  onRefresh,
  onViewDiff,
  variant = "default",
}) => {
  const { isDark } = useTheme();
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitStats, setCommitStats] = useState<Record<string, string>>({});
  const [commitDiffs, setCommitDiffs] = useState<Record<string, string>>({});
  const [commitDetailsLoading, setCommitDetailsLoading] = useState<
    Record<string, boolean>
  >({});
  const [commitDetailsErrors, setCommitDetailsErrors] = useState<
    Record<string, string>
  >({});
  const [selectedCommitFileIndex, setSelectedCommitFileIndex] = useState<
    Record<string, number>
  >({});
  const [search, setSearch] = useState("");

  const panelVars = useMemo(
    () =>
      ({
        "--git-bg": isDark ? "#0a0a0a" : "#ffffff",
        "--git-bg-secondary": isDark ? "#111111" : "#f9fafb",
        "--git-bg-tertiary": isDark ? "#1a1a1a" : "#f3f4f6",
        "--git-bg-hover": isDark
          ? "rgba(255,255,255,0.04)"
          : "rgba(0,0,0,0.035)",
        "--git-border": isDark ? "#2a2a2a" : "#e5e7eb",
        "--git-text": isDark ? "#ffffff" : "#111827",
        "--git-text-secondary": isDark ? "#888888" : "#6b7280",
        "--git-accent": "#ef4444",
      }) as React.CSSProperties,
    [isDark],
  );

  const filteredCommits = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return commits;
    }

    return commits.filter((commit) => {
      const haystack = [
        commit.subject,
        commit.body,
        commit.author,
        commit.shortHash,
        commit.hash,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [commits, search]);

  const loadCommitDetails = useCallback(
    async (hash: string) => {
      if (
        commitDetailsLoading[hash] ||
        (hasRecordKey(commitStats, hash) && hasRecordKey(commitDiffs, hash))
      ) {
        return;
      }

      setCommitDetailsLoading((prev) => ({ ...prev, [hash]: true }));
      setCommitDetailsErrors((prev) => {
        const next = { ...prev };
        delete next[hash];
        return next;
      });

      const [statsResult, diffResult] = await Promise.allSettled([
        AppFunctions.GetGitShow(hash),
        AppFunctions.GetGitCommitDiff(hash),
      ]);

      if (statsResult.status === "fulfilled") {
        setCommitStats((prev) => ({
          ...prev,
          [hash]: statsResult.value ?? "",
        }));
      } else {
        setCommitStats((prev) => ({ ...prev, [hash]: "" }));
      }

      if (diffResult.status === "fulfilled") {
        setCommitDiffs((prev) => ({
          ...prev,
          [hash]: diffResult.value ?? "",
        }));
      } else {
        setCommitDiffs((prev) => ({ ...prev, [hash]: "" }));
      }

      if (
        statsResult.status === "rejected" ||
        diffResult.status === "rejected"
      ) {
        const error =
          statsResult.status === "rejected"
            ? statsResult.reason
            : diffResult.status === "rejected"
              ? diffResult.reason
              : null;
        setCommitDetailsErrors((prev) => ({
          ...prev,
          [hash]: toErrorMessage(error),
        }));
      }

      setCommitDetailsLoading((prev) => ({ ...prev, [hash]: false }));
    },
    [commitDetailsLoading, commitDiffs, commitStats],
  );

  const toggleExpand = (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null);
      return;
    }

    setExpandedCommit(hash);
    setSelectedCommitFileIndex((prev) =>
      hasRecordKey(prev, hash) ? prev : { ...prev, [hash]: 0 },
    );
    void loadCommitDetails(hash);
  };

  useEffect(() => {
    if (!expandedCommit) {
      return;
    }
    if (!commits.some((commit) => commit.hash === expandedCommit)) {
      setExpandedCommit(null);
    }
  }, [commits, expandedCommit]);

  return (
    <div
      style={panelVars}
      className="git-history-panel flex h-full min-h-0 flex-col bg-[var(--git-bg)] text-[var(--git-text)]"
      data-variant={variant}
    >
      <div className="git-history-panel__header border-b border-[var(--git-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
            <GitCommit size={13} />
            History
          </div>
          <div className="ml-auto rounded-full border border-[var(--git-border)] px-2 py-0.5 text-[10px] text-[var(--git-text-secondary)]">
            {filteredCommits.length}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--git-border)] bg-[var(--git-bg-secondary)] text-[var(--git-text-secondary)] transition-colors hover:bg-[var(--git-bg-hover)] hover:text-[var(--git-text)] disabled:cursor-wait disabled:opacity-60"
            title="Refresh history"
            aria-label="Refresh history"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="git-history-panel__search mt-2 flex items-center gap-2 rounded-md border border-[var(--git-border)] bg-[var(--git-bg-secondary)] px-2.5 py-2 text-[12px] text-[var(--git-text-secondary)]">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search commits"
            className="w-full bg-transparent text-[var(--git-text)] outline-none placeholder:text-[var(--git-text-secondary)]"
          />
        </div>
      </div>

      <div className="git-history-panel__list min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center px-4 text-[12px] text-[var(--git-text-secondary)]">
            Loading history...
          </div>
        ) : filteredCommits.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[12px] text-[var(--git-text-secondary)]">
            <FileSearch size={18} />
            <div>No commits matched this view.</div>
          </div>
        ) : (
          <div className="px-2 py-2">
            {filteredCommits.map((commit, index) => {
              const isExpanded = expandedCommit === commit.hash;
              const stats = parseCommitStats(commitStats[commit.hash] ?? "");
              const diff = commitDiffs[commit.hash] ?? "";
              const diffFiles = parseCommitDiffFiles(diff);
              const commitFiles = buildCommitFileDetails(stats, diffFiles);
              const maxFileIndex = Math.max(0, commitFiles.length - 1);
              const activeFileIndex = Math.min(
                selectedCommitFileIndex[commit.hash] ?? 0,
                maxFileIndex,
              );
              const activeFile = commitFiles[activeFileIndex] ?? null;
              const detailsLoading = commitDetailsLoading[commit.hash] ?? false;
              const detailsError = commitDetailsErrors[commit.hash] ?? "";
              const selectCommitFile = (index: number) => {
                setSelectedCommitFileIndex((prev) => ({
                  ...prev,
                  [commit.hash]: Math.max(0, Math.min(index, maxFileIndex)),
                }));
              };

              return (
                <div key={commit.hash} className="pb-2 last:pb-0">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => void toggleExpand(commit.hash)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      void toggleExpand(commit.hash);
                    }}
                    className="git-history-commit group grid w-full grid-cols-[18px_28px_1fr_auto] items-start gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-[var(--git-border)] hover:bg-[var(--git-bg-hover)]"
                  >
                    <div className="flex h-full flex-col items-center pt-1">
                      <div className="git-history-commit__dot h-2.5 w-2.5 rounded-full bg-[var(--git-accent)] ring-2 ring-[var(--git-bg)]/100" />
                      {index < filteredCommits.length - 1 && (
                        <div className="mt-1 h-full w-px bg-[var(--git-border)]" />
                      )}
                    </div>

                    <div
                      className="git-history-commit__avatar mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{
                        background:
                          variant === "chat"
                            ? "var(--git-bg-tertiary)"
                            : hashToColor(commit.authorEmail || commit.hash),
                      }}
                    >
                      {getInitials(commit.author || "?")}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown
                            size={13}
                            className="text-[var(--git-text-secondary)]"
                          />
                        ) : (
                          <ChevronRight
                            size={13}
                            className="text-[var(--git-text-secondary)]"
                          />
                        )}
                        <div className="git-history-commit__subject truncate text-[12px] font-medium text-[var(--git-text)]">
                          {commit.subject || "No subject"}
                        </div>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--git-text-secondary)]">
                        <span
                          className="git-history-commit__hash rounded-full border border-[var(--git-border)] bg-[var(--git-bg-secondary)] px-2 py-0.5 font-mono text-[var(--git-accent)]"
                          data-ui-font-scale-exempt
                        >
                          {commit.shortHash}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <User size={11} />
                          {commit.author}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 size={11} />
                          {formatDate(commit.date)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-0.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewDiff?.(commit.hash);
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--git-border)] bg-[var(--git-bg-secondary)] px-2.5 text-[11px] text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-accent)] hover:text-[var(--git-accent)]"
                        title="View commit diff"
                        aria-label={`View diff for ${commit.subject || commit.shortHash}`}
                      >
                        <FileSearch size={12} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div
                      className="git-history-commit__details ml-11 rounded-lg border border-[var(--git-border)] bg-[var(--git-bg-secondary)] px-3 py-3 text-[12px]"
                      style={{
                        marginTop: radius.sm,
                        position: "relative",
                        zIndex: zIndex.base,
                      }}
                    >
                      {commit.body && (
                        <div className="mb-3 whitespace-pre-wrap text-[var(--git-text-secondary)]">
                          {commit.body}
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
                          <span>Changed files</span>
                          <span className="rounded-full border border-[var(--git-border)] px-2.5 py-1 text-[12px] tracking-normal">
                            {commitFiles.length}
                          </span>
                        </div>

                        {detailsLoading && commitFiles.length === 0 ? (
                          <div className="rounded-md border border-dashed border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 py-3 text-[13px] text-[var(--git-text-secondary)]">
                            Loading changed files...
                          </div>
                        ) : commitFiles.length > 0 ? (
                          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                            {commitFiles.map((entry, fileIndex) => {
                              const fileSelected =
                                fileIndex === activeFileIndex;
                              return (
                                <button
                                  type="button"
                                  onClick={() => selectCommitFile(fileIndex)}
                                  key={`${commit.hash}:${entry.path}`}
                                  className="git-history-file grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:border-[var(--git-accent)] hover:bg-[var(--git-bg-hover)]"
                                  style={{
                                    borderColor: fileSelected
                                      ? "var(--git-accent)"
                                      : "var(--git-border)",
                                    background: fileSelected
                                      ? "var(--git-bg-hover)"
                                      : "var(--git-bg-tertiary)",
                                  }}
                                  title={entry.path}
                                >
                                  <div className="truncate text-[15px] text-[var(--git-text)]">
                                    {entry.path}
                                  </div>
                                  <div className="text-[14px] text-[var(--git-text-secondary)]">
                                    {entry.summary}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 py-3 text-[13px] text-[var(--git-text-secondary)]">
                            No changed-file summary is available for this
                            commit.
                          </div>
                        )}
                      </div>

                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between gap-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
                          <span>Diff</span>
                          {onViewDiff && (
                            <button
                              type="button"
                              onClick={() => onViewDiff(commit.hash)}
                              className="rounded-md border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-2.5 py-1 text-[11px] normal-case tracking-normal text-[var(--git-text-secondary)] transition-colors hover:border-[var(--git-accent)] hover:text-[var(--git-accent)]"
                            >
                              Open detail
                            </button>
                          )}
                        </div>

                        {detailsLoading && !activeFile?.diff ? (
                          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-4 text-[13px] text-[var(--git-text-secondary)]">
                            Loading diff...
                          </div>
                        ) : activeFile?.diff ? (
                          <div className="h-[460px] min-h-[320px] overflow-hidden rounded-lg border border-[var(--git-border)]">
                            <GitDiffViewer
                              diff={activeFile.diff}
                              fileName={activeFile.path}
                              onClose={() => setExpandedCommit(null)}
                              onPrevFile={
                                activeFileIndex > 0
                                  ? () => selectCommitFile(activeFileIndex - 1)
                                  : undefined
                              }
                              onNextFile={
                                activeFileIndex < commitFiles.length - 1
                                  ? () => selectCommitFile(activeFileIndex + 1)
                                  : undefined
                              }
                              hasPrev={activeFileIndex > 0}
                              hasNext={activeFileIndex < commitFiles.length - 1}
                            />
                          </div>
                        ) : (
                          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-4 text-[13px] text-[var(--git-text-secondary)]">
                            {activeFile
                              ? "No diff is available for the selected file."
                              : "No diff is available for this commit."}
                          </div>
                        )}

                        {detailsError && (
                          <div className="rounded-md border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-3 py-2 text-[12px] text-[#ef4444]">
                            {detailsError}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default GitHistory;
