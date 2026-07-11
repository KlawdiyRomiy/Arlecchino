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
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Eye,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  GripHorizontal,
  History,
  Info,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { m, useReducedMotion } from "framer-motion";
import { GitHistory } from "../GitHistory";
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

const fileStatusLabel = (file: GitFileEntry): string => {
  if (file.status === "conflicted") return "!";
  if (file.status === "untracked") return "?";
  return file.status.slice(0, 1).toUpperCase();
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
      <div className="ai-chat-diff-view" data-ui-font-scale-exempt>
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
  const selectedRemote = useGitStore((state) => state.selectedRemote);
  const stagedFiles = useGitStore((state) => state.stagedFiles);
  const unstagedFiles = useGitStore((state) => state.unstagedFiles);
  const conflictedFiles = useGitStore((state) => state.conflictedFiles);
  const stageFile = useGitStore((state) => state.stageFile);
  const unstageFile = useGitStore((state) => state.unstageFile);
  const stageAll = useGitStore((state) => state.stageAll);
  const unstageAll = useGitStore((state) => state.unstageAll);
  const commit = useGitStore((state) => state.commit);
  const historyCommits = useGitStore((state) => state.historyCommits);
  const historyLoading = useGitStore((state) => state.historyLoading);
  const loadHistory = useGitStore((state) => state.loadHistory);
  const stashEntries = useGitStore((state) => state.stashEntries);
  const stashLoading = useGitStore((state) => state.stashLoading);
  const loadStashes = useGitStore((state) => state.loadStashes);
  const createStash = useGitStore((state) => state.createStash);
  const popStash = useGitStore((state) => state.popStash);
  const dropStash = useGitStore((state) => state.dropStash);
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [activeView, setActiveView] = useState<"diff" | "history" | "stash">(
    "diff",
  );
  const [stashMessage, setStashMessage] = useState("");
  const [compactPane, setCompactPane] = useState<"files" | "detail">("files");
  const [compactCommitOpen, setCompactCommitOpen] = useState(false);
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
    setActiveView("diff");
    setStashMessage("");
    setCompactPane("files");
    setCompactCommitOpen(false);
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
  const largeDiff = displayedDiff.split("\n").length > 260;
  const canCommit =
    commitMessage.trim().length > 0 &&
    visibleStagedFiles.length > 0 &&
    !visibleBusy &&
    canUseGitProject;
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
  const currentDiffStats = useMemo(
    () => diffStats(parseDiffRows(displayedDiff, "")),
    [displayedDiff],
  );

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

  const handleUnstageAll = useCallback(async () => {
    if (visibleBusy || visibleStagedFiles.length === 0 || !canUseGitProject)
      return;
    await runGitAction(() => unstageAll());
  }, [
    canUseGitProject,
    runGitAction,
    unstageAll,
    visibleBusy,
    visibleStagedFiles.length,
  ]);

  const handleViewChange = useCallback(
    (view: "diff" | "history" | "stash") => {
      setActiveView(view);
      setCompactPane("detail");
      if (view === "history" && canUseGitProject) {
        void loadHistory();
      }
      if (view === "stash" && canUseGitProject) {
        void loadStashes();
      }
    },
    [canUseGitProject, loadHistory, loadStashes],
  );

  const handleCreateStash = useCallback(async () => {
    if (visibleBusy || !canUseGitProject || allFiles.length === 0) return;
    const created = await runGitAction(() => createStash(stashMessage));
    if (created) {
      setStashMessage("");
      await loadStashes();
    }
  }, [
    allFiles.length,
    canUseGitProject,
    createStash,
    loadStashes,
    runGitAction,
    stashMessage,
    visibleBusy,
  ]);

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
  const renderFileSection = (
    title: string,
    files: GitFileEntry[],
    bulkLabel: string,
    onBulkAction: () => void,
  ) => (
    <section className="ai-chat-git-files-section">
      <div className="ai-chat-git-files-section__header">
        <span>
          {title}
          <small>{files.length}</small>
        </span>
        <button
          type="button"
          disabled={visibleBusy || files.length === 0 || !canUseGitProject}
          onClick={onBulkAction}
        >
          {bulkLabel}
        </button>
      </div>
      <div className="ai-chat-git-files-section__list">
        {files.length === 0 ? (
          <div className="ai-chat-git-files-empty">
            No {title.toLowerCase()} changes
          </div>
        ) : (
          files.map((file) => {
            const path = displayPathParts(file.path);
            const selected = selectedFile
              ? fileKey(file) === fileKey(selectedFile)
              : false;
            return (
              <div
                className={`ai-chat-git-file-row${selected ? " is-selected" : ""}`}
                key={fileKey(file)}
              >
                <button
                  className="ai-chat-git-file-row__select"
                  type="button"
                  title={file.path}
                  onClick={() => {
                    setSelectedKey(fileKey(file));
                    setActiveView("diff");
                    setCompactPane("detail");
                  }}
                >
                  <span className={`ai-chat-git-file__badge is-${file.status}`}>
                    {fileStatusLabel(file)}
                  </span>
                  <span className="ai-chat-git-file__body">
                    <span>{path.name}</span>
                    <small>{path.directory || "Project root"}</small>
                  </span>
                </button>
                <button
                  className="ai-chat-git-file-row__action"
                  type="button"
                  title={file.staged ? "Unstage file" : "Stage file"}
                  aria-label={file.staged ? "Unstage file" : "Stage file"}
                  disabled={visibleBusy || !canUseGitProject}
                  onClick={() =>
                    void runGitAction(() =>
                      file.staged
                        ? unstageFile(file.path)
                        : stageFile(file.path),
                    )
                  }
                >
                  {file.staged ? <Minus size={13} /> : <Plus size={13} />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );

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
        className="ai-chat-git-commandbar"
        data-ai-chat-drawer-header={canMove ? "true" : undefined}
        role="group"
        aria-label="Git review drawer header"
        onMouseDown={canMove ? onDragStart : undefined}
      >
        <div className="ai-chat-git-commandbar__summary">
          <label className="ai-chat-branch-select">
            <GitBranch size={14} />
            <select
              aria-label="Git branch"
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
          <span className="ai-chat-shell-pill">{changedCount} changed</span>
          {canMove ? (
            <span className="ai-chat-drawer-grip" title="Move review">
              <GripHorizontal size={13} />
            </span>
          ) : null}
        </div>
        <div className="ai-chat-git-commandbar__tools" aria-label="Git views">
          <button
            type="button"
            className={activeView === "history" ? "is-active" : ""}
            aria-label="History"
            onClick={() => handleViewChange("history")}
          >
            <History size={13} />
            <span>History</span>
          </button>
          <button
            type="button"
            aria-label="Open pull request"
            disabled={!canOpenPR}
            onClick={() => void handleOpenPullRequest()}
          >
            <GitPullRequest size={13} />
            <span>PR</span>
          </button>
          <button
            type="button"
            className={activeView === "stash" ? "is-active" : ""}
            aria-label="Stash"
            onClick={() => handleViewChange("stash")}
          >
            <Sparkles size={13} />
            <span>Stash</span>
          </button>
          <button
            type="button"
            className={activeView === "diff" ? "is-active" : ""}
            aria-label="Diff"
            onClick={() => handleViewChange("diff")}
          >
            <Eye size={13} />
            <span>Diff</span>
          </button>
        </div>
        <div className="ai-chat-git-window-actions">
          <button
            className="panel-control-button topbar-control-button"
            type="button"
            title="Refresh Git"
            aria-label="Refresh Git"
            disabled={!canUseGitProject}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (canUseGitProject) void refresh();
            }}
          >
            <RefreshCw size={14} className={visibleLoading ? "spin" : ""} />
          </button>
          <div
            className="ai-chat-git-more-menu"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setMoreOpen(false);
              }
            }}
          >
            <button
              className="panel-control-button topbar-control-button"
              type="button"
              title="More Git actions"
              aria-label="More Git actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <MoreHorizontal size={15} />
            </button>
            {moreOpen ? (
              <div className="ai-chat-git-more-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canStageSelected}
                  onClick={() => {
                    setMoreOpen(false);
                    void handleStageSelected();
                  }}
                >
                  {selectedFile?.staged ? (
                    <Minus size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                  {selectedFile?.staged ? "Unstage selected" : "Stage selected"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    visibleBusy || allFiles.length === 0 || !canUseGitProject
                  }
                  onClick={() => {
                    setMoreOpen(false);
                    void handleStageAll();
                  }}
                >
                  <CheckCheck size={14} />
                  Stage all
                </button>
              </div>
            ) : null}
          </div>
          <button
            className="panel-control-button topbar-control-button"
            type="button"
            title={mode === "overlay" ? "Collapse review" : "Expand review"}
            aria-label={
              mode === "overlay" ? "Collapse review" : "Expand review"
            }
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
            className="panel-control-button panel-control-button-danger topbar-control-button"
            type="button"
            title="Close review"
            aria-label="Close review"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="ai-chat-git-workspace" data-compact-pane={compactPane}>
        <aside className="ai-chat-git-files" data-testid="ai-chat-git-files">
          <div className="ai-chat-git-files__title">
            <span>Changes</span>
            <small>{changedCount}</small>
          </div>
          <label className="ai-chat-search-field ai-chat-search-field--inline ai-chat-git-file-search">
            <Search size={13} />
            <input
              placeholder="Filter changed files"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </label>
          <div className="ai-chat-git-files__scroll">
            {renderFileSection(
              "Staged",
              visibleStagedFiles,
              "Unstage all",
              () => void handleUnstageAll(),
            )}
            {renderFileSection(
              "Unstaged",
              [...visibleConflictedFiles, ...visibleUnstagedFiles],
              "Stage all",
              () => void handleStageAll(),
            )}
          </div>
          <div className="ai-chat-git-files__pager">
            <button
              type="button"
              title="Previous file"
              aria-label="Previous file"
              disabled={selectedFileIndex <= 0}
              onClick={() => selectRelativeFile(-1)}
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {selectedFileIndex >= 0 ? selectedFileIndex + 1 : 0} of{" "}
              {filteredFiles.length}
            </span>
            <button
              type="button"
              title="Next file"
              aria-label="Next file"
              disabled={
                selectedFileIndex < 0 ||
                selectedFileIndex >= filteredFiles.length - 1
              }
              onClick={() => selectRelativeFile(1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </aside>

        <section
          className="ai-chat-git-detail"
          data-testid="ai-chat-git-detail"
        >
          <div className="ai-chat-git-detail__header" data-view={activeView}>
            <button
              className="ai-chat-icon-button ai-chat-git-compact-back"
              type="button"
              title="Back to changed files"
              aria-label="Back to changed files"
              onClick={() => setCompactPane("files")}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="ai-chat-git-view-title">
              {activeView === "history" ? "Repository history" : "Stashes"}
            </span>
            <div className="ai-chat-file-select-group">
              <button
                className="ai-chat-icon-button"
                type="button"
                title="Previous file"
                aria-label="Previous file"
                disabled={selectedFileIndex <= 0}
                onClick={() => selectRelativeFile(-1)}
              >
                <ChevronLeft size={14} />
              </button>
              <select
                className="ai-chat-select"
                aria-label="Changed file"
                value={selectedFile ? fileKey(selectedFile) : ""}
                onChange={(event) => {
                  setSelectedKey(event.target.value);
                  setActiveView("diff");
                  setCompactPane("detail");
                }}
                disabled={filteredFiles.length === 0}
              >
                {filteredFiles.map((file) => (
                  <option key={fileKey(file)} value={fileKey(file)}>
                    {displayPathParts(file.path).name}
                  </option>
                ))}
              </select>
              <button
                className="ai-chat-icon-button"
                type="button"
                title="Next file"
                aria-label="Next file"
                disabled={
                  selectedFileIndex < 0 ||
                  selectedFileIndex >= filteredFiles.length - 1
                }
                onClick={() => selectRelativeFile(1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <span className="ai-chat-git-count-pill is-add">
              +{currentDiffStats.additions}
            </span>
            <span className="ai-chat-git-count-pill is-delete">
              -{currentDiffStats.deletions}
            </span>
            <button
              className="ai-chat-icon-button"
              type="button"
              title="Copy diff"
              aria-label="Copy diff"
              disabled={!displayedDiff}
              onClick={handleCopyDiff}
            >
              <Copy size={14} />
            </button>
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
            <button
              className="ai-chat-secondary-button ai-chat-git-context-action"
              type="button"
              title={
                selectedFile?.staged ? "Unstage selected" : "Stage selected"
              }
              disabled={!canStageSelected}
              onClick={() => void handleStageSelected()}
            >
              {selectedFile?.staged ? <Minus size={14} /> : <Plus size={14} />}
              {selectedFile?.staged ? "Unstage" : "Stage"}
            </button>
          </div>
          {actionError ? (
            <div className="ai-chat-git-action-error">
              <AlertTriangle size={14} />
              {actionError}
            </div>
          ) : null}
          <div className="ai-chat-git-detail__body">
            {activeView === "history" ? (
              <div className="ai-chat-git-history-view">
                <GitHistory
                  commits={historyCommits}
                  loading={historyLoading}
                  onRefresh={() => void loadHistory()}
                  variant="chat"
                />
              </div>
            ) : activeView === "stash" ? (
              <div className="ai-chat-git-stash-view">
                <div className="ai-chat-git-stash-compose">
                  <input
                    value={stashMessage}
                    placeholder="Optional stash message"
                    onChange={(event) => setStashMessage(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={
                      stashLoading || visibleBusy || allFiles.length === 0
                    }
                    onClick={() => void handleCreateStash()}
                  >
                    <Plus size={13} />
                    Stash changes
                  </button>
                </div>
                <div className="ai-chat-git-stash-list">
                  {stashLoading ? (
                    <div className="ai-chat-git-empty">Loading stashes</div>
                  ) : stashEntries.length === 0 ? (
                    <div className="ai-chat-git-empty">No saved stashes.</div>
                  ) : (
                    stashEntries.map((entry) => (
                      <div className="ai-chat-git-stash-row" key={entry.ref}>
                        <span>
                          <strong>{entry.message || entry.ref}</strong>
                          <small>{entry.relativeDate}</small>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void runGitAction(() => popStash(entry.ref))
                          }
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runGitAction(() => dropStash(entry.ref))
                          }
                        >
                          Drop
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : unavailable ? (
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
        </section>

        <aside
          className="ai-chat-git-inspector"
          data-testid="ai-chat-git-inspector"
        >
          <div className="ai-chat-git-inspector__content">
            <section className="ai-chat-git-inspector-card ai-chat-git-commit">
              <h3>
                <GitCommit size={14} />
                Commit
              </h3>
              <textarea
                value={commitMessage}
                placeholder="Commit message"
                onChange={(event) => onCommitMessageChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    void handleCommit();
                  }
                }}
              />
              <small>Ctrl/Cmd + Enter to commit</small>
              <button
                className="ai-chat-git-commit-primary"
                type="button"
                disabled={!canCommit}
                onClick={() => void handleCommit()}
              >
                <Check size={14} />
                Commit
              </button>
            </section>
          </div>
        </aside>
        <div
          className={`ai-chat-git-compact-commit${compactCommitOpen ? " is-open" : ""}`}
        >
          {compactCommitOpen ? (
            <div className="ai-chat-git-compact-commit__composer">
              <textarea
                value={commitMessage}
                placeholder="Commit message"
                aria-label="Commit message"
                onChange={(event) => onCommitMessageChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    void handleCommit();
                  }
                }}
              />
              <button
                className="ai-chat-git-commit-primary"
                type="button"
                disabled={!canCommit}
                onClick={() => void handleCommit()}
              >
                <Check size={14} />
                Commit
              </button>
            </div>
          ) : null}
          <div className="ai-chat-git-compact-footer">
            <button
              type="button"
              aria-expanded={compactCommitOpen}
              onClick={() => setCompactCommitOpen((open) => !open)}
            >
              <GitCommit size={14} />
              Commit...
            </button>
            <button
              type="button"
              onClick={() => {
                setCompactPane("detail");
                setActiveView("diff");
              }}
            >
              <Eye size={14} />
              Open details
            </button>
          </div>
        </div>
      </div>
    </m.aside>
  );
}
