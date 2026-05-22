import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Filter,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  GripHorizontal,
  Info,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import { m, useReducedMotion } from "framer-motion";
import { GetGitDiff } from "../../wails/app";
import { useGitStore } from "../../stores/gitStore";
import { writeClipboardTextWithFallback } from "../../utils/clipboard";
import { toErrorMessage } from "../../utils/errorMessages";
import type { GitFileEntry } from "../../utils/git";

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
  onDragStart: (event: React.MouseEvent<HTMLElement>) => void;
  onSearchChange: (value: string) => void;
}

interface DiffRow {
  kind: "meta" | "hunk" | "add" | "delete" | "context";
  key: string;
  oldLine?: number;
  newLine?: number;
  content: string;
  match: boolean;
}

interface DiffStats {
  additions: number;
  deletions: number;
}

const syntaxTokenPattern =
  /(\/\/.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:package|import|func|return|if|else|for|range|switch|case|default|const|var|type|struct|interface|go|defer|select|nil|true|false)\b|\b\d+(?:\.\d+)?\b)/g;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const tokenClassName = (token: string): string => {
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
    return "ai-chat-diff-token is-string";
  }
  if (token.startsWith("//") || token.startsWith("/*")) {
    return "ai-chat-diff-token is-comment";
  }
  if (/^\d/.test(token)) {
    return "ai-chat-diff-token is-number";
  }
  return "ai-chat-diff-token is-keyword";
};

const renderSyntax = (value: string, keyPrefix: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  value.replace(syntaxTokenPattern, (token, _match, offset: number) => {
    if (offset > lastIndex) {
      nodes.push(value.slice(lastIndex, offset));
    }
    nodes.push(
      <span className={tokenClassName(token)} key={`${keyPrefix}:${offset}`}>
        {token}
      </span>,
    );
    lastIndex = offset + token.length;
    return token;
  });

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [value];
};

const buildHighlightedCodeNodes = (
  value: string,
  query: string,
): React.ReactNode[] => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return renderSyntax(value, "syntax");
  }

  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(escapeRegExp(normalizedQuery), "gi");
  let lastOffset = 0;

  for (const match of value.matchAll(pattern)) {
    const startOffset = match.index ?? 0;
    const matchText = match[0];
    if (startOffset > lastOffset) {
      nodes.push(
        ...renderSyntax(
          value.slice(lastOffset, startOffset),
          `syntax:${lastOffset}`,
        ),
      );
    }
    nodes.push(
      <mark className="ai-chat-diff-search-hit" key={`hit:${startOffset}`}>
        {matchText}
      </mark>,
    );
    lastOffset = startOffset + matchText.length;
  }

  if (lastOffset < value.length) {
    nodes.push(
      ...renderSyntax(value.slice(lastOffset), `syntax:${lastOffset}`),
    );
  }

  return nodes.length > 0 ? nodes : renderSyntax(value, "syntax");
};

function HighlightedCode({ value, query }: { value: string; query: string }) {
  return <>{buildHighlightedCodeNodes(value, query)}</>;
}

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
  let sequence = 0;

  const nextKey = (kind: DiffRow["kind"], line: string): string =>
    `${kind}:${oldLine}:${newLine}:${sequence++}:${line}`;

  return diff.split("\n").map((line) => {
    const match = normalizedQuery
      ? line.toLowerCase().includes(normalizedQuery)
      : false;
    const hunk = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?/);
    if (hunk) {
      oldLine = Number.parseInt(hunk[1], 10);
      newLine = Number.parseInt(hunk[2], 10);
      return { kind: "hunk", key: nextKey("hunk", line), content: line, match };
    }
    if (
      line.startsWith("diff --git") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      return { kind: "meta", key: nextKey("meta", line), content: line, match };
    }
    if (line.startsWith("+")) {
      return {
        kind: "add",
        key: nextKey("add", line),
        newLine: newLine++,
        content: line,
        match,
      };
    }
    if (line.startsWith("-")) {
      return {
        kind: "delete",
        key: nextKey("delete", line),
        oldLine: oldLine++,
        content: line,
        match,
      };
    }

    const row: DiffRow = {
      kind: "context",
      key: nextKey("context", line),
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

const diffStats = (rows: DiffRow[]): DiffStats =>
  rows.reduce(
    (stats, row) => {
      if (row.kind === "add") stats.additions += 1;
      if (row.kind === "delete") stats.deletions += 1;
      return stats;
    },
    { additions: 0, deletions: 0 },
  );

function DiffView({
  diff,
  file,
  search,
  large,
}: {
  diff: string;
  file: GitFileEntry | null;
  search: string;
  large: boolean;
}) {
  const rows = useMemo(() => parseDiffRows(diff, search), [diff, search]);
  const stats = useMemo(() => diffStats(rows), [rows]);
  const path = file ? displayPathParts(file.path) : null;

  if (!diff.trim()) {
    return <div className="ai-chat-git-empty">No changes in this diff.</div>;
  }

  return (
    <div className="ai-chat-diff-shell" data-testid="ai-chat-review-diff">
      <div className="ai-chat-diff-notice">
        <Info size={13} />
        <span>
          {large
            ? "Large diff: one file at a time"
            : "Showing selected file diff"}
        </span>
      </div>
      <div className="ai-chat-diff-filebar">
        <span className="ai-chat-diff-filebar__name" title={file?.path}>
          <FileText size={15} />
          <span>{path?.name || "Selected diff"}</span>
          {path?.directory ? <small>{path.directory}</small> : null}
        </span>
        <span className="ai-chat-diff-stat is-add">+{stats.additions}</span>
        <span className="ai-chat-diff-stat is-delete">-{stats.deletions}</span>
      </div>
      <div className="ai-chat-diff-view">
        {rows.map((row) => (
          <div
            className={`ai-chat-diff-row is-${row.kind}${row.match ? " is-match" : ""}`}
            key={row.key}
          >
            <span className="ai-chat-diff-row__line">{row.oldLine ?? ""}</span>
            <span className="ai-chat-diff-row__line">{row.newLine ?? ""}</span>
            <code>
              <HighlightedCode query={search} value={row.content} />
            </code>
          </div>
        ))}
      </div>
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
  onDragStart,
  onSearchChange,
}: ChatGitReviewProps) {
  const reduceMotion = useReducedMotion();
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
  const stageFile = useGitStore((state) => state.stageFile);
  const unstageFile = useGitStore((state) => state.unstageFile);
  const stageAll = useGitStore((state) => state.stageAll);
  const commit = useGitStore((state) => state.commit);
  const pullRemote = useGitStore((state) => state.pullRemote);
  const pushRemote = useGitStore((state) => state.pushRemote);
  const openPullRequest = useGitStore((state) => state.openPullRequest);
  const switchBranch = useGitStore((state) => state.switchBranch);
  const [selectedKey, setSelectedKey] = useState("");
  const [diff, setDiff] = useState("");
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const selectedFileIndex = selectedFile
    ? filteredFiles.findIndex((file) => fileKey(file) === fileKey(selectedFile))
    : -1;
  const largeDiff = filteredFiles.length > 1 || diff.split("\n").length > 260;
  const canCommit =
    commitMessage.trim().length > 0 && stagedFiles.length > 0 && !busy;
  const canPush = Boolean(selectedRemote && branch.current && !busy);
  const canPull = Boolean(selectedRemote && branch.current && !busy);
  const canOpenPR = Boolean(selectedRemote && branch.current && !busy);
  const canStageSelected = Boolean(
    selectedFile && !busy && !isRepositoryMissing,
  );
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
    if (!selectedFile) {
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
  }, [selectedFile]);

  const runGitAction = useCallback(async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
      return true;
    } catch (nextError) {
      setActionError(toErrorMessage(nextError));
      // useGitStore owns the user-visible error string.
      return false;
    }
  }, []);

  const handleCommit = useCallback(async () => {
    if (!canCommit) return;
    const committed = await runGitAction(() => commit(commitMessage));
    if (committed) {
      onCommitMessageChange("");
    }
  }, [canCommit, commit, commitMessage, onCommitMessageChange, runGitAction]);

  const handlePush = useCallback(async () => {
    if (!canPush) return;
    await runGitAction(() => pushRemote(false));
  }, [canPush, pushRemote, runGitAction]);

  const handlePull = useCallback(async () => {
    if (!canPull) return;
    await runGitAction(() => pullRemote());
  }, [canPull, pullRemote, runGitAction]);

  const handleOpenPullRequest = useCallback(async () => {
    if (!canOpenPR) return;
    setActionError(null);
    const url = await openPullRequest();
    if (!url) {
      setActionError(
        "Unable to open PR URL. Make sure a GitHub remote is configured.",
      );
    }
  }, [canOpenPR, openPullRequest]);

  const handleStageSelected = useCallback(async () => {
    if (!selectedFile || !canStageSelected) return;
    await runGitAction(() =>
      selectedFile.staged
        ? unstageFile(selectedFile.path)
        : stageFile(selectedFile.path),
    );
  }, [canStageSelected, runGitAction, selectedFile, stageFile, unstageFile]);

  const handleStageAll = useCallback(async () => {
    if (busy || allFiles.length === 0) return;
    await runGitAction(() => stageAll());
  }, [allFiles.length, busy, runGitAction, stageAll]);

  const handleBranchChange = useCallback(
    (value: string) => {
      if (!value || value === branch.current || busy) return;
      void runGitAction(() => switchBranch(value));
    },
    [branch.current, busy, runGitAction, switchBranch],
  );

  const handleCopyDiff = useCallback(() => {
    if (!diff) return;
    void writeClipboardTextWithFallback(diff);
  }, [diff]);

  const selectRelativeFile = useCallback(
    (direction: -1 | 1) => {
      if (selectedFileIndex < 0) return;
      const nextFile = filteredFiles[selectedFileIndex + direction];
      if (nextFile) {
        setSelectedKey(fileKey(nextFile));
      }
    },
    [filteredFiles, selectedFileIndex],
  );

  const renderUnavailable = () => {
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
    return null;
  };

  const unavailable = renderUnavailable();
  const branchTarget =
    branch.upstream ||
    (selectedRemote && branch.current
      ? `${selectedRemote}/${branch.current}`
      : "");

  return (
    <m.aside
      className="ai-chat-git-review"
      data-mode={mode}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.16,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div
        className="ai-chat-git-diff-header"
        data-ai-chat-drawer-header={canMove ? "true" : undefined}
        role="group"
        aria-label="Git review drawer header"
        onMouseDown={canMove ? onDragStart : undefined}
      >
        <div className="ai-chat-git-header-main">
          <div className="ai-chat-git-branch-cluster">
            <label className="ai-chat-branch-select">
              <GitBranch size={14} />
              <select
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
            </label>
            {branchTarget ? (
              <span
                className="ai-chat-shell-pill is-muted"
                title={branchTarget}
              >
                {branchTarget}
              </span>
            ) : null}
            <span className="ai-chat-shell-pill">{changedCount} changed</span>
            {canMove ? (
              <span className="ai-chat-drawer-grip" title="Move review">
                <GripHorizontal size={13} />
              </span>
            ) : null}
          </div>
          <div className="ai-chat-git-window-actions">
            <button
              className="ai-chat-icon-button"
              type="button"
              title="Refresh Git"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} />
            </button>
            <button
              className="ai-chat-icon-button"
              type="button"
              title={mode === "overlay" ? "Collapse review" : "Expand review"}
              onMouseDown={(event) => event.stopPropagation()}
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
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onClose}
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="ai-chat-git-action-strip" aria-label="Git file actions">
          <button
            className="ai-chat-git-tool-button"
            type="button"
            title={selectedFile?.staged ? "Unstage selected" : "Stage selected"}
            disabled={!canStageSelected}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void handleStageSelected()}
          >
            {selectedFile?.staged ? <Minus size={14} /> : <Plus size={14} />}
            <span>{selectedFile?.staged ? "Unstage" : "Stage selected"}</span>
          </button>
          <button
            className="ai-chat-git-tool-button"
            type="button"
            title="Stage all"
            disabled={busy || allFiles.length === 0}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void handleStageAll()}
          >
            <CheckCheck size={14} />
            <span>Stage all</span>
          </button>
          <button
            className="ai-chat-git-tool-button"
            type="button"
            title="Copy diff"
            disabled={!diff}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleCopyDiff}
          >
            <Copy size={14} />
            <span>Copy diff</span>
          </button>
          <button
            className="ai-chat-git-tool-button"
            type="button"
            title="Pull"
            disabled={!canPull}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void handlePull()}
          >
            <ArrowDownToLine size={14} />
            <span>Pull</span>
          </button>
        </div>
      </div>

      <div className="ai-chat-review-overlay-body">
        <div className="ai-chat-review-overlay-toolbar">
          <label className="ai-chat-file-filter-field">
            <Filter size={14} />
            <input
              aria-label="Filter files"
              data-testid="ai-chat-review-search"
              placeholder="Filter files"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </label>
          <div className="ai-chat-file-select-group">
            <button
              className="ai-chat-icon-button"
              type="button"
              title="Previous file"
              disabled={selectedFileIndex <= 0}
              onClick={() => selectRelativeFile(-1)}
            >
              <ChevronLeft size={14} />
            </button>
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
            <button
              className="ai-chat-icon-button"
              type="button"
              title="Next file"
              disabled={
                selectedFileIndex < 0 ||
                selectedFileIndex >= filteredFiles.length - 1
              }
              onClick={() => selectRelativeFile(1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <label className="ai-chat-search-field ai-chat-search-field--inline ai-chat-diff-search-field">
            <Search size={14} />
            <input
              data-testid="ai-chat-diff-search"
              placeholder="Search in diff"
              value={diffSearch}
              onChange={(event) => onDiffSearchChange(event.target.value)}
            />
          </label>
          {diffSearch.trim() ? (
            <span className="ai-chat-shell-pill">{diffMatchCount} hits</span>
          ) : null}
        </div>
        {actionError ? (
          <div className="ai-chat-git-action-error">
            <AlertTriangle size={14} />
            {actionError}
          </div>
        ) : null}
        {unavailable ? (
          unavailable
        ) : diffLoading ? (
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
          <DiffView
            diff={diff}
            file={selectedFile}
            large={largeDiff}
            search={diffSearch}
          />
        )}
      </div>

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
            className="ai-chat-secondary-button ai-chat-git-action-button"
            type="button"
            disabled={!canOpenPR}
            onClick={() => void handleOpenPullRequest()}
            title="Open pull request"
          >
            <GitPullRequest size={14} />
            PR
          </button>
          <button
            className="ai-chat-secondary-button ai-chat-git-action-button"
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
            className="ai-chat-secondary-button ai-chat-git-action-button is-primary"
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
    </m.aside>
  );
}
