import React, { useMemo, useState } from "react";
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

import * as AppFunctions from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { useTheme } from "../hooks/useTheme";
import { radius, transitions, zIndex } from "../styles/colors";

interface ParsedCommitStat {
  path: string;
  summary: string;
}

interface GitHistoryProps {
  commits: main.GitCommitInfo[];
  loading: boolean;
  onRefresh: () => void;
  onViewDiff?: (hash: string) => void;
}

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
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

export const GitHistory: React.FC<GitHistoryProps> = ({
  commits,
  loading,
  onRefresh,
  onViewDiff,
}) => {
  const { isDark } = useTheme();
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitStats, setCommitStats] = useState<Record<string, string>>({});
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

  const toggleExpand = async (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null);
      return;
    }

    setExpandedCommit(hash);
    if (commitStats[hash]) {
      return;
    }

    try {
      const stats = await AppFunctions.GetGitShow(hash);
      setCommitStats((prev) => ({ ...prev, [hash]: stats }));
    } catch {
      setCommitStats((prev) => ({ ...prev, [hash]: "" }));
    }
  };

  return (
    <div
      style={panelVars}
      className="flex h-full min-h-0 flex-col bg-[var(--git-bg)] text-[var(--git-text)]"
    >
      <div className="border-b border-[var(--git-border)] px-3 py-2">
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
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-md border border-[var(--git-border)] bg-[var(--git-bg-secondary)] px-2.5 py-2 text-[12px] text-[var(--git-text-secondary)]">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search commits"
            className="w-full bg-transparent text-[var(--git-text)] outline-none placeholder:text-[var(--git-text-secondary)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
              return (
                <div key={commit.hash} className="pb-2 last:pb-0">
                  <button
                    type="button"
                    onClick={() => {
                      void toggleExpand(commit.hash);
                    }}
                    className="group grid w-full grid-cols-[18px_28px_1fr_auto] items-start gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-[var(--git-border)] hover:bg-[var(--git-bg-hover)]"
                  >
                    <div className="flex h-full flex-col items-center pt-1">
                      <div className="h-2.5 w-2.5 rounded-full bg-[#ef4444] ring-2 ring-[var(--git-bg)]/100" />
                      {index < filteredCommits.length - 1 && (
                        <div className="mt-1 h-full w-px bg-[var(--git-border)]" />
                      )}
                    </div>

                    <div
                      className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{
                        background: hashToColor(
                          commit.authorEmail || commit.hash,
                        ),
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
                        <div className="truncate text-[12px] font-medium text-[var(--git-text)]">
                          {commit.subject || "No subject"}
                        </div>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--git-text-secondary)]">
                        <span className="rounded-full border border-[var(--git-border)] bg-[var(--git-bg-secondary)] px-2 py-0.5 font-mono text-[#ef4444]">
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
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--git-border)] bg-[var(--git-bg-secondary)] px-2.5 text-[11px] text-[var(--git-text-secondary)] transition-colors hover:border-[#ef4444] hover:text-[#ef4444]"
                      >
                        View
                      </button>
                    </div>
                  </button>

                  {isExpanded && (
                    <div
                      className="ml-11 rounded-lg border border-[var(--git-border)] bg-[var(--git-bg-secondary)] px-3 py-3 text-[12px]"
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

                      {stats.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--git-text-secondary)]">
                            Changed files
                          </div>
                          {stats.slice(0, 8).map((entry) => (
                            <div
                              key={`${commit.hash}:${entry.path}`}
                              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-[var(--git-border)] bg-[var(--git-bg-tertiary)] px-2.5 py-2"
                            >
                              <div className="truncate text-[11px] text-[var(--git-text)]">
                                {entry.path}
                              </div>
                              <div className="text-[10px] text-[var(--git-text-secondary)]">
                                {entry.summary}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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
