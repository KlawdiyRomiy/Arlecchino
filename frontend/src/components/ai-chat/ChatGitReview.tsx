import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { readGitDiffCoalesced, useGitStore } from "../../stores/gitStore";
import { writeClipboardTextWithFallback } from "../../utils/clipboard";
import { toErrorMessage } from "../../utils/errorMessages";
import { projectPathsEqualByIdentity } from "../../utils/projectPaths";
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

const emptyChatGitBranch = {
  current: "",
  upstream: "",
  ahead: 0,
  behind: 0,
  detached: false,
  oid: "",
};

const chatGitProjectPathsMatch = (left: string, right: string): boolean => {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (!normalizedLeft || !normalizedRight) {
    return normalizedLeft === normalizedRight;
  }
  return projectPathsEqualByIdentity(normalizedLeft, normalizedRight);
};

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
  const attachGitConsumer = useGitStore((state) => state.attachConsumer);
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
  const activeProjectPath = projectPath.trim();
  const gitProjectReady = chatGitProjectPathsMatch(
    storeProjectPath,
    activeProjectPath,
  );
  const visibleLoading = gitProjectReady ? loading : Boolean(activeProjectPath);
  const visibleBusy = gitProjectReady ? busy : false;
  const visibleError = gitProjectReady ? error : null;
  const visibleRepositoryMissing = gitProjectReady
    ? isRepositoryMissing
    : false;
  const visibleBranch = gitProjectReady ? branch : emptyChatGitBranch;
  const visibleBranches = gitProjectReady ? branches : [];
  const visibleRemotes = gitProjectReady ? remotes : [];
  const visibleSelectedRemote = gitProjectReady ? selectedRemote : "";
  const visibleStagedFiles = gitProjectReady ? stagedFiles : [];
  const visibleUnstagedFiles = gitProjectReady ? unstagedFiles : [];
  const visibleConflictedFiles = gitProjectReady ? conflictedFiles : [];
  const canUseGitProject = Boolean(activeProjectPath) && gitProjectReady;
  const [selectedKey, setSelectedKey] = useState("");
  const [diff, setDiff] = useState("");
  const [loadedDiffKey, setLoadedDiffKey] = useState("");
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const diffRequestIDRef = useRef(0);
  const loadedDiffKeyRef = useRef("");

  useEffect(() => attachGitConsumer(), [attachGitConsumer]);

  useLayoutEffect(() => {
    if (!chatGitProjectPathsMatch(storeProjectPath, activeProjectPath)) {
      setProjectPath(activeProjectPath);
    }
  }, [activeProjectPath, setProjectPath, storeProjectPath]);

  useEffect(() => {
    if (activeProjectPath && gitProjectReady) {
      void refresh({ queueIfBusy: false });
    }
  }, [activeProjectPath, gitProjectReady, refresh]);

  useEffect(() => {
    setSelectedKey("");
    setDiff("");
    setLoadedDiffKey("");
    loadedDiffKeyRef.current = "";
    setDiffError(null);
    setDiffLoading(false);
    setActionError(null);
  }, [activeProjectPath]);

  const allFiles = useMemo(
    () => [
      ...visibleConflictedFiles,
      ...visibleStagedFiles,
      ...visibleUnstagedFiles,
    ],
    [visibleConflictedFiles, visibleStagedFiles, visibleUnstagedFiles],
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
  const selectedFilePath = selectedFile?.path ?? "";
  const selectedFileStaged = selectedFile?.staged ?? false;
  const selectedFileRevision = useGitStore(
    (state) => state.fileRevisions[selectedFilePath] ?? 0,
  );
  const selectedDiffKey = selectedFilePath
    ? `${selectedFilePath}:${selectedFileStaged}`
    : "";
  const displayedDiff = loadedDiffKey === selectedDiffKey ? diff : "";
  const changedCount = allFiles.length;
  const selectedFileIndex = selectedFile
    ? filteredFiles.findIndex((file) => fileKey(file) === fileKey(selectedFile))
    : -1;
  const largeDiff =
    filteredFiles.length > 1 || displayedDiff.split("\n").length > 260;
  const canCommit =
    commitMessage.trim().length > 0 &&
    visibleStagedFiles.length > 0 &&
    !visibleBusy &&
    canUseGitProject;
  const canPush = Boolean(
    visibleSelectedRemote &&
    visibleBranch.current &&
    !visibleBusy &&
    canUseGitProject,
  );
  const canPull = Boolean(
    visibleSelectedRemote &&
    visibleBranch.current &&
    !visibleBusy &&
    canUseGitProject,
  );
  const canOpenPR = Boolean(
    visibleSelectedRemote &&
    visibleBranch.current &&
    !visibleBusy &&
    canUseGitProject,
  );
  const canStageSelected = Boolean(
    selectedFile &&
    !visibleBusy &&
    !visibleRepositoryMissing &&
    canUseGitProject,
  );
  const diffMatchCount = useMemo(() => {
    const query = diffSearch.trim().toLowerCase();
    if (!query) return 0;
    return displayedDiff
      .split("\n")
      .filter((line) => line.toLowerCase().includes(query)).length;
  }, [diffSearch, displayedDiff]);

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
    if (!selectedFilePath || !canUseGitProject) {
      setDiff("");
      setDiffError(null);
      setDiffLoading(false);
      return;
    }

    let cancelled = false;
    const requestID = diffRequestIDRef.current + 1;
    diffRequestIDRef.current = requestID;
    const requestedProjectPath = activeProjectPath;
    const requestedDiffKey = `${selectedFilePath}:${selectedFileStaged}`;
    if (loadedDiffKeyRef.current !== requestedDiffKey) {
      setDiff("");
    }
    setDiffLoading(true);
    setDiffError(null);
    readGitDiffCoalesced(
      requestedProjectPath,
      selectedFilePath,
      selectedFileStaged,
    )
      .then((value) => {
        if (
          !cancelled &&
          diffRequestIDRef.current === requestID &&
          projectPathsEqualByIdentity(
            useGitStore.getState().projectPath,
            requestedProjectPath,
          )
        ) {
          setDiff(value || "");
          loadedDiffKeyRef.current = requestedDiffKey;
          setLoadedDiffKey(requestedDiffKey);
        }
      })
      .catch((nextError) => {
        if (
          !cancelled &&
          diffRequestIDRef.current === requestID &&
          projectPathsEqualByIdentity(
            useGitStore.getState().projectPath,
            requestedProjectPath,
          )
        ) {
          setDiff("");
          setDiffError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      })
      .finally(() => {
        if (
          !cancelled &&
          diffRequestIDRef.current === requestID &&
          projectPathsEqualByIdentity(
            useGitStore.getState().projectPath,
            requestedProjectPath,
          )
        ) {
          setDiffLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeProjectPath,
    canUseGitProject,
    selectedFilePath,
    selectedFileRevision,
    selectedFileStaged,
  ]);

  const runGitAction = useCallback(
    async (action: () => Promise<void>) => {
      if (!canUseGitProject) {
        return false;
      }
      setActionError(null);
      try {
        await action();
        return true;
      } catch (nextError) {
        setActionError(toErrorMessage(nextError));
        // useGitStore owns the user-visible error string.
        return false;
      }
    },
    [canUseGitProject],
  );

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
    if (visibleBusy || allFiles.length === 0 || !canUseGitProject) return;
    await runGitAction(() => stageAll());
  }, [allFiles.length, canUseGitProject, runGitAction, stageAll, visibleBusy]);

  const handleBranchChange = useCallback(
    (value: string) => {
      if (
        !value ||
        value === visibleBranch.current ||
        visibleBusy ||
        !canUseGitProject
      )
        return;
      void runGitAction(() => switchBranch(value));
    },
    [
      canUseGitProject,
      runGitAction,
      switchBranch,
      visibleBranch.current,
      visibleBusy,
    ],
  );

  const handleCopyDiff = useCallback(() => {
    if (!displayedDiff) return;
    void writeClipboardTextWithFallback(displayedDiff);
  }, [displayedDiff]);

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
    if (!activeProjectPath) {
      return <div className="ai-chat-git-empty">No project open.</div>;
    }
    if (!gitProjectReady || visibleLoading) {
      return <div className="ai-chat-git-empty">Refreshing Git status...</div>;
    }
    if (visibleRepositoryMissing) {
      return <div className="ai-chat-git-empty">No Git repository.</div>;
    }
    if (visibleError) {
      return (
        <div className="ai-chat-git-empty is-error">
          <AlertTriangle size={14} />
          {visibleError}
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
    visibleBranch.upstream ||
    (visibleSelectedRemote && visibleBranch.current
      ? `${visibleSelectedRemote}/${visibleBranch.current}`
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
                value={
                  visibleBranches.includes(visibleBranch.current)
                    ? visibleBranch.current
                    : ""
                }
                disabled={visibleBusy || visibleBranches.length === 0}
                onChange={(event) => handleBranchChange(event.target.value)}
                title="Switch branch"
              >
                {visibleBranch.current &&
                !visibleBranches.includes(visibleBranch.current) ? (
                  <option value="">{visibleBranch.current}</option>
                ) : null}
                {visibleBranches.map((candidate) => (
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
              disabled={!canUseGitProject}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (canUseGitProject) {
                  void refresh();
                }
              }}
            >
              <RefreshCw size={14} className={visibleLoading ? "spin" : ""} />
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
            disabled={visibleBusy || allFiles.length === 0 || !canUseGitProject}
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
            disabled={!displayedDiff}
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
        ) : diffLoading && !displayedDiff ? (
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
            diff={displayedDiff}
            file={selectedFile}
            large={largeDiff}
            search={diffSearch}
          />
        )}
      </div>

      <div className="ai-chat-git-commit">
        {visibleRemotes.length > 1 ? (
          <select
            className="ai-chat-select"
            value={visibleSelectedRemote}
            disabled={visibleBusy || !canUseGitProject}
            onChange={(event) => setSelectedRemote(event.target.value)}
            title="Remote"
          >
            {visibleRemotes.map((remote) => (
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
              visibleStagedFiles.length === 0
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
            title={
              visibleSelectedRemote
                ? `Push to ${visibleSelectedRemote}`
                : "No remote"
            }
          >
            <Send size={14} />
            Push
          </button>
        </div>
      </div>
    </m.aside>
  );
}
