import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GitBranch,
  GripHorizontal,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import { m, type PanInfo } from "framer-motion";
import { GetGitDiff } from "../../wails/app";
import { useGitStore } from "../../stores/gitStore";
import type { GitFileEntry, GitFileStatus } from "../../utils/git";

type ChatGitReviewMode = "drawer" | "overlay";

interface ChatGitReviewProps {
  mode: ChatGitReviewMode;
  canMove: boolean;
  projectPath: string;
  searchQuery: string;
  diffSearch: string;
  commitMessage: string;
  onClose: () => void;
  onCollapse: () => void;
  onCommitMessageChange: (value: string) => void;
  onDiffSearchChange: (value: string) => void;
  onExpand: () => void;
  onMove: (delta: number) => void;
  onSearchChange: (value: string) => void;
}

interface DiffRow {
  kind: "meta" | "hunk" | "add" | "delete" | "context";
  oldLine?: number;
  newLine?: number;
  content: string;
  match: boolean;
}

const statusLabels: Record<GitFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  copied: "C",
  conflicted: "!",
};

const fileKey = (file: GitFileEntry): string =>
  `${file.staged ? "staged" : "working"}:${file.path}`;

const displayPathParts = (
  path: string,
): { name: string; directory: string } => {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return {
    name: parts.pop() || normalized,
    directory: parts.join("/"),
  };
};

const filterFiles = (files: GitFileEntry[], query: string): GitFileEntry[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return files;
  return files.filter((file) =>
    `${file.path} ${file.status} ${file.staged ? "staged" : "working"}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
};

const parseDiffRows = (diff: string, query: string): DiffRow[] => {
  const normalizedQuery = query.trim().toLowerCase();
  let oldLine = 0;
  let newLine = 0;

  return diff.split("\n").map((line) => {
    const match = normalizedQuery
      ? line.toLowerCase().includes(normalizedQuery)
      : false;
    const hunk = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?/);
    if (hunk) {
      oldLine = Number.parseInt(hunk[1], 10);
      newLine = Number.parseInt(hunk[2], 10);
      return { kind: "hunk", content: line, match };
    }
    if (
      line.startsWith("diff --git") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      return { kind: "meta", content: line, match };
    }
    if (line.startsWith("+")) {
      return { kind: "add", newLine: newLine++, content: line, match };
    }
    if (line.startsWith("-")) {
      return { kind: "delete", oldLine: oldLine++, content: line, match };
    }

    const row: DiffRow = {
      kind: "context",
      oldLine: oldLine || undefined,
      newLine: newLine || undefined,
      content: line,
      match,
    };
    oldLine += oldLine ? 1 : 0;
    newLine += newLine ? 1 : 0;
    return row;
  });
};

function GitFileRow({
  file,
  selected,
  onSelect,
}: {
  file: GitFileEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const path = displayPathParts(file.path);
  const label = file.staged
    ? "Staged"
    : file.status === "conflicted"
      ? "Conflict"
      : "Working tree";

  return (
    <button
      className={`ai-chat-git-file${selected ? " is-selected" : ""}`}
      type="button"
      title={file.path}
      onClick={onSelect}
    >
      <span className={`ai-chat-git-file__badge is-${file.status}`}>
        {statusLabels[file.status]}
      </span>
      <span className="ai-chat-git-file__body">
        <span>{path.name}</span>
        <small>
          {path.directory || "Project root"} · {label}
        </small>
      </span>
    </button>
  );
}

function DiffView({ diff, search }: { diff: string; search: string }) {
  const rows = useMemo(() => parseDiffRows(diff, search), [diff, search]);

  if (!diff.trim()) {
    return <div className="ai-chat-git-empty">No changes in this diff.</div>;
  }

  return (
    <div className="ai-chat-diff-view" data-testid="ai-chat-review-diff">
      {rows.map((row, index) => (
        <div
          className={`ai-chat-diff-row is-${row.kind}${row.match ? " is-match" : ""}`}
          key={`${index}:${row.content}`}
        >
          <span className="ai-chat-diff-row__line">{row.oldLine ?? ""}</span>
          <span className="ai-chat-diff-row__line">{row.newLine ?? ""}</span>
          <code>{row.content}</code>
        </div>
      ))}
    </div>
  );
}

export function ChatGitReview({
  mode,
  canMove,
  projectPath,
  searchQuery,
  diffSearch,
  commitMessage,
  onClose,
  onCollapse,
  onCommitMessageChange,
  onDiffSearchChange,
  onExpand,
  onMove,
  onSearchChange,
}: ChatGitReviewProps) {
  const storeProjectPath = useGitStore((state) => state.projectPath);
  const setProjectPath = useGitStore((state) => state.setProjectPath);
  const refresh = useGitStore((state) => state.refresh);
  const loading = useGitStore((state) => state.loading);
  const busy = useGitStore((state) => state.busy);
  const error = useGitStore((state) => state.error);
  const isRepositoryMissing = useGitStore((state) => state.isRepositoryMissing);
  const branch = useGitStore((state) => state.branch);
  const branches = useGitStore((state) => state.branches);
  const remotes = useGitStore((state) => state.remotes);
  const selectedRemote = useGitStore((state) => state.selectedRemote);
  const setSelectedRemote = useGitStore((state) => state.setSelectedRemote);
  const stagedFiles = useGitStore((state) => state.stagedFiles);
  const unstagedFiles = useGitStore((state) => state.unstagedFiles);
  const conflictedFiles = useGitStore((state) => state.conflictedFiles);
  const commit = useGitStore((state) => state.commit);
  const pushRemote = useGitStore((state) => state.pushRemote);
  const switchBranch = useGitStore((state) => state.switchBranch);
  const [selectedKey, setSelectedKey] = useState("");
  const [diff, setDiff] = useState("");
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    const nextProjectPath = projectPath.trim();
    if (nextProjectPath !== storeProjectPath) {
      setProjectPath(nextProjectPath);
    }
  }, [projectPath, setProjectPath, storeProjectPath]);

  const allFiles = useMemo(
    () => [...conflictedFiles, ...stagedFiles, ...unstagedFiles],
    [conflictedFiles, stagedFiles, unstagedFiles],
  );
  const filteredFiles = useMemo(
    () => filterFiles(allFiles, searchQuery),
    [allFiles, searchQuery],
  );
  const selectedFile = useMemo(
    () =>
      filteredFiles.find((file) => fileKey(file) === selectedKey) ??
      filteredFiles[0] ??
      null,
    [filteredFiles, selectedKey],
  );
  const changedCount = allFiles.length;
  const canCommit =
    commitMessage.trim().length > 0 && stagedFiles.length > 0 && !busy;
  const canPush = Boolean(selectedRemote && branch.current && !busy);
  const diffMatchCount = useMemo(() => {
    const query = diffSearch.trim().toLowerCase();
    if (!query) return 0;
    return diff.split("\n").filter((line) => line.toLowerCase().includes(query))
      .length;
  }, [diff, diffSearch]);

  useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedKey("");
      return;
    }
    if (
      selectedKey &&
      filteredFiles.some((file) => fileKey(file) === selectedKey)
    ) {
      return;
    }
    setSelectedKey(fileKey(filteredFiles[0]));
  }, [filteredFiles, selectedKey]);

  useEffect(() => {
    if (mode !== "overlay" || !selectedFile) {
      setDiff("");
      setDiffError(null);
      setDiffLoading(false);
      return;
    }

    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    GetGitDiff(selectedFile.path, selectedFile.staged)
      .then((value) => {
        if (!cancelled) {
          setDiff(value || "");
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setDiff("");
          setDiffError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDiffLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, selectedFile]);

  const runGitAction = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
    } catch {
      // useGitStore owns the user-visible error string.
    }
  }, []);

  const handleCommit = useCallback(async () => {
    if (!canCommit) return;
    await runGitAction(() => commit(commitMessage));
    onCommitMessageChange("");
  }, [canCommit, commit, commitMessage, onCommitMessageChange, runGitAction]);

  const handlePush = useCallback(async () => {
    if (!canPush) return;
    await runGitAction(() => pushRemote(false));
  }, [canPush, pushRemote, runGitAction]);

  const handleBranchChange = useCallback(
    (value: string) => {
      if (!value || value === branch.current || busy) return;
      void runGitAction(() => switchBranch(value));
    },
    [branch.current, busy, runGitAction, switchBranch],
  );

  const handleCopyDiff = useCallback(() => {
    if (!diff) return;
    void navigator.clipboard?.writeText(diff);
  }, [diff]);

  const handleDrag = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    onMove(info.delta.x);
  };

  const renderFiles = () => {
    if (!projectPath) {
      return <div className="ai-chat-git-empty">No project open.</div>;
    }
    if (isRepositoryMissing) {
      return <div className="ai-chat-git-empty">No Git repository.</div>;
    }
    if (error) {
      return (
        <div className="ai-chat-git-empty is-error">
          <AlertTriangle size={14} />
          {error}
        </div>
      );
    }
    if (allFiles.length === 0) {
      return <div className="ai-chat-git-empty">Working tree clean.</div>;
    }
    if (filteredFiles.length === 0) {
      return <div className="ai-chat-git-empty">No changes match.</div>;
    }

    const renderGroup = (title: string, files: GitFileEntry[]) => {
      const nextFiles = filterFiles(files, searchQuery);
      if (nextFiles.length === 0) return null;
      return (
        <section className="ai-chat-git-section" key={title}>
          <div className="ai-chat-git-section__title">
            <span>{title}</span>
            <small>{nextFiles.length}</small>
          </div>
          {nextFiles.map((file) => (
            <GitFileRow
              file={file}
              key={fileKey(file)}
              selected={
                selectedFile ? fileKey(file) === fileKey(selectedFile) : false
              }
              onSelect={() => setSelectedKey(fileKey(file))}
            />
          ))}
        </section>
      );
    };

    return (
      <div className="ai-chat-git-list">
        {renderGroup("Conflicts", conflictedFiles)}
        {renderGroup("Staged", stagedFiles)}
        {renderGroup("Unstaged", unstagedFiles)}
      </div>
    );
  };

  return (
    <aside className="ai-chat-git-review" data-mode={mode}>
      <div className="ai-chat-side-section__header">
        <span>
          <GitBranch size={14} />
          Git Review
          {canMove ? (
            <m.span
              className="ai-chat-drawer-grip"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0}
              dragMomentum={false}
              onDrag={handleDrag}
              title="Move review"
            >
              <GripHorizontal size={13} />
            </m.span>
          ) : null}
        </span>
        <div className="ai-chat-drawer-actions">
          <button
            className="ai-chat-icon-button"
            type="button"
            title={mode === "overlay" ? "Collapse review" : "Expand review"}
            onClick={mode === "overlay" ? onCollapse : onExpand}
          >
            {mode === "overlay" ? (
              <Minimize2 size={15} />
            ) : (
              <Maximize2 size={15} />
            )}
          </button>
          <button
            className="ai-chat-icon-button"
            type="button"
            title="Close review"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="ai-chat-git-toolbar">
        <select
          className="ai-chat-select"
          value={branches.includes(branch.current) ? branch.current : ""}
          disabled={busy || branches.length === 0}
          onChange={(event) => handleBranchChange(event.target.value)}
          title="Switch branch"
        >
          {branch.current && !branches.includes(branch.current) ? (
            <option value="">{branch.current}</option>
          ) : null}
          {branches.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
        <span className="ai-chat-shell-pill is-success">
          <ArrowUp size={11} />
          {branch.ahead}
        </span>
        <span className="ai-chat-shell-pill is-warning">
          <ArrowDown size={11} />
          {branch.behind}
        </span>
        <span className="ai-chat-shell-pill">{changedCount} changed</span>
        <button
          className="ai-chat-icon-button"
          type="button"
          title="Refresh Git"
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>

      <label className="ai-chat-search-field">
        <Search size={14} />
        <input
          data-testid="ai-chat-review-search"
          placeholder="Search changes"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      {mode === "overlay" ? (
        <div className="ai-chat-review-overlay-body">
          <div className="ai-chat-review-overlay-toolbar">
            <select
              className="ai-chat-select"
              value={selectedFile ? fileKey(selectedFile) : ""}
              onChange={(event) => setSelectedKey(event.target.value)}
              disabled={filteredFiles.length === 0}
            >
              {filteredFiles.map((file) => (
                <option key={fileKey(file)} value={fileKey(file)}>
                  {file.path}
                </option>
              ))}
            </select>
            <label className="ai-chat-search-field ai-chat-search-field--inline">
              <Search size={14} />
              <input
                data-testid="ai-chat-diff-search"
                placeholder="Search in diff"
                value={diffSearch}
                onChange={(event) => onDiffSearchChange(event.target.value)}
              />
            </label>
            <span className="ai-chat-shell-pill">Unified</span>
            <span className="ai-chat-shell-pill is-muted">Split</span>
            <button
              className="ai-chat-secondary-button"
              type="button"
              disabled={!diff}
              onClick={handleCopyDiff}
            >
              <Copy size={14} />
              Copy
            </button>
            <button
              className="ai-chat-secondary-button"
              type="button"
              disabled={!canCommit}
              onClick={() => void handleCommit()}
            >
              <Check size={14} />
              Commit
            </button>
            <button
              className="ai-chat-secondary-button is-primary"
              type="button"
              disabled={!canPush}
              onClick={() => void handlePush()}
            >
              <Send size={14} />
              Push
            </button>
            {diffSearch.trim() ? (
              <span className="ai-chat-shell-pill">{diffMatchCount} hits</span>
            ) : null}
          </div>
          {diffLoading ? (
            <div className="ai-chat-git-empty">
              <RefreshCw size={14} className="spin" />
              Loading diff
            </div>
          ) : diffError ? (
            <div className="ai-chat-git-empty is-error">
              <AlertTriangle size={14} />
              {diffError}
            </div>
          ) : (
            <DiffView diff={diff} search={diffSearch} />
          )}
        </div>
      ) : (
        renderFiles()
      )}

      <div className="ai-chat-git-commit">
        {remotes.length > 1 ? (
          <select
            className="ai-chat-select"
            value={selectedRemote}
            disabled={busy}
            onChange={(event) => setSelectedRemote(event.target.value)}
            title="Remote"
          >
            {remotes.map((remote) => (
              <option key={remote} value={remote}>
                {remote}
              </option>
            ))}
          </select>
        ) : null}
        <textarea
          value={commitMessage}
          placeholder="Commit message"
          onChange={(event) => onCommitMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              void handleCommit();
            }
          }}
        />
        <div className="ai-chat-git-commit__actions">
          <button
            className="ai-chat-secondary-button"
            type="button"
            disabled={!canCommit}
            onClick={() => void handleCommit()}
            title={
              stagedFiles.length === 0
                ? "Stage files before commit"
                : "Commit staged files"
            }
          >
            <Check size={14} />
            Commit
          </button>
          <button
            className="ai-chat-secondary-button is-primary"
            type="button"
            disabled={!canPush}
            onClick={() => void handlePush()}
            title={selectedRemote ? `Push to ${selectedRemote}` : "No remote"}
          >
            <Send size={14} />
            Push
          </button>
        </div>
      </div>
    </aside>
  );
}
