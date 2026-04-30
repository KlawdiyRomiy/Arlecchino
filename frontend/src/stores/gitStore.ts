import { create } from "zustand";

import {
  GetGitBranch,
  GetGitBranches,
  GetGitDiff,
  GetGitLog,
  GetGitStatus,
  RunGitCommand,
} from "../wails/app";
import type { GitCommitInfo } from "../../bindings/arlecchino/models";
import { EventsOn } from "../wails/runtime";
import {
  GitBranchInfo,
  GitFileEntry,
  GitLineMarker,
  mergeLineMarkers,
  normalizeGitHubRemoteToWeb,
  normalizePathForGit,
  parseGitStatusFallbackV1,
  parseGitStatusPorcelainV2,
  parseRemoteNameList,
  parseUnifiedDiffLineMarkers,
} from "../utils/git";
import { isSameOrChildPath } from "../utils/projectPaths";
import { usePerformanceStore } from "./performanceStore";

const fileRefreshDebounceMs = 320;
const fallbackPollIntervalMs = 15000;

export interface GitStashEntry {
  ref: string;
  relativeDate: string;
  message: string;
  hash: string;
}

interface GitStoreState {
  projectPath: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  isRepositoryMissing: boolean;
  expanded: boolean;
  branch: GitBranchInfo;
  branches: string[];
  remotes: string[];
  selectedRemote: string;
  stagedFiles: GitFileEntry[];
  unstagedFiles: GitFileEntry[];
  conflictedFiles: GitFileEntry[];
  historyCommits: GitCommitInfo[];
  historyLoading: boolean;
  historyFilePath: string;
  stashEntries: GitStashEntry[];
  stashLoading: boolean;
  fileMarkers: Record<string, GitLineMarker[]>;
  markerUpdatedAt: Record<string, number>;
  markerLoading: Record<string, boolean>;
  setProjectPath: (projectPath: string) => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
  setSelectedRemote: (remote: string) => void;
  refresh: () => Promise<void>;
  loadHistory: (filePath?: string) => Promise<void>;
  loadStashes: () => Promise<void>;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  discardFile: (path: string) => Promise<void>;
  initializeRepository: () => Promise<void>;
  commit: (message: string) => Promise<void>;
  switchBranch: (branch: string) => Promise<void>;
  createBranch: (name: string, fromBranch?: string) => Promise<void>;
  fetchRemote: () => Promise<void>;
  pullRemote: () => Promise<void>;
  pushRemote: (setUpstream?: boolean) => Promise<void>;
  createStash: (message?: string) => Promise<void>;
  popStash: (stashRef?: string) => Promise<void>;
  dropStash: (stashRef?: string) => Promise<void>;
  openPullRequest: (baseBranch?: string) => Promise<string | null>;
  getPullRequestUrl: (baseBranch?: string) => Promise<string | null>;
  refreshFileMarkers: (filePath: string, force?: boolean) => Promise<void>;
  clearFileMarkers: (filePath?: string) => void;
}

const emptyBranchInfo = (): GitBranchInfo => ({
  current: "",
  upstream: "",
  ahead: 0,
  behind: 0,
  detached: false,
  oid: "",
});

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
};

const isMissingRepositoryError = (error: unknown): boolean =>
  toErrorMessage(error).toLowerCase().includes("not a git repository");

const dedupeAndSortFiles = (files: GitFileEntry[]): GitFileEntry[] => {
  const seen = new Map<string, GitFileEntry>();
  files.forEach((entry) => {
    const key = `${entry.path}:${entry.staged}`;
    if (!seen.has(key)) {
      seen.set(key, entry);
    }
  });

  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path));
};

const parseStashEntries = (output: string): GitStashEntry[] =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref = "", relativeDate = "", message = "", hash = ""] =
        line.split("\u0000");
      return {
        ref,
        relativeDate,
        message,
        hash,
      } satisfies GitStashEntry;
    })
    .filter((entry) => entry.ref);

const readStatus = async (): Promise<string> =>
  RunGitCommand(["status", "-b", "--porcelain=v2"]);

let stopGitSync: (() => void) | null = null;
let refreshTimer: number | null = null;
let fallbackPollTimer: number | null = null;
const markerRefreshTimers = new Map<string, number>();

const clearGitSync = (): void => {
  if (stopGitSync) {
    stopGitSync();
    stopGitSync = null;
  }
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (fallbackPollTimer !== null) {
    window.clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
  markerRefreshTimers.forEach((timer) => window.clearTimeout(timer));
  markerRefreshTimers.clear();
};

const scheduleRefresh = (get: () => GitStoreState): void => {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
  }
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void get().refresh();
  }, fileRefreshDebounceMs);
};

const scheduleFileMarkerRefresh = (
  get: () => GitStoreState,
  filePath: string,
): void => {
  if (!filePath) {
    return;
  }

  const mode = usePerformanceStore.getState().mode;
  if (mode === "critical") {
    return;
  }

  const delay = mode === "constrained" ? 1400 : 500;
  const existingTimer = markerRefreshTimers.get(filePath);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    markerRefreshTimers.delete(filePath);
    void get().refreshFileMarkers(filePath, true);
  }, delay);
  markerRefreshTimers.set(filePath, timer);
};

const startGitSync = (projectPath: string, get: () => GitStoreState): void => {
  clearGitSync();

  const shouldRefreshForPath = (value: string): boolean => {
    const activeProject = get().projectPath;
    return (
      activeProject === projectPath && isSameOrChildPath(value, projectPath)
    );
  };

  const shouldRefreshForEvent = (value: unknown): boolean => {
    if (typeof value === "string") {
      return shouldRefreshForPath(value);
    }

    if (!value || typeof value !== "object") {
      return false;
    }

    const payload = value as {
      path?: unknown;
      oldPath?: unknown;
      newPath?: unknown;
    };

    return [payload.path, payload.oldPath, payload.newPath].some(
      (candidate) =>
        typeof candidate === "string" && shouldRefreshForPath(candidate),
    );
  };

  const unsubscribeFileChanged = EventsOn("file:changed", (value) => {
    if (typeof value === "string" && shouldRefreshForPath(value)) {
      scheduleRefresh(get);
      scheduleFileMarkerRefresh(get, value);
    }
  });

  const unsubscribeFileCreated = EventsOn("file:created", (value) => {
    if (typeof value === "string" && shouldRefreshForPath(value)) {
      scheduleRefresh(get);
      scheduleFileMarkerRefresh(get, value);
    }
  });

  const unsubscribeProjectEntryCreated = EventsOn(
    "project:entry:created",
    (value) => {
      if (shouldRefreshForEvent(value)) {
        scheduleRefresh(get);
      }
    },
  );

  const unsubscribeProjectEntryRenamed = EventsOn(
    "project:entry:renamed",
    (value) => {
      if (shouldRefreshForEvent(value)) {
        scheduleRefresh(get);
      }
    },
  );

  const unsubscribeProjectEntryDeleted = EventsOn(
    "project:entry:deleted",
    (value) => {
      if (shouldRefreshForEvent(value)) {
        scheduleRefresh(get);
      }
    },
  );

  const unsubscribeGitStatus = EventsOn("ide:git:status", () => {
    scheduleRefresh(get);
  });

  fallbackPollTimer = window.setInterval(() => {
    if (get().projectPath === projectPath) {
      void get().refresh();
    }
  }, fallbackPollIntervalMs);

  stopGitSync = () => {
    unsubscribeFileChanged();
    unsubscribeFileCreated();
    unsubscribeProjectEntryCreated();
    unsubscribeProjectEntryRenamed();
    unsubscribeProjectEntryDeleted();
    unsubscribeGitStatus();
  };
};

const executeGitAction = async (
  get: () => GitStoreState,
  set: (
    partial:
      | Partial<GitStoreState>
      | ((state: GitStoreState) => Partial<GitStoreState>),
  ) => void,
  action: () => Promise<void>,
): Promise<void> => {
  set({ busy: true, error: null });
  try {
    await action();
    await Promise.all([get().refresh(), get().loadStashes()]);
  } catch (error) {
    set({
      error: toErrorMessage(error),
      isRepositoryMissing: isMissingRepositoryError(error),
    });
    throw error;
  } finally {
    set({ busy: false });
  }
};

export const useGitStore = create<GitStoreState>((set, get) => ({
  projectPath: "",
  loading: false,
  busy: false,
  error: null,
  isRepositoryMissing: false,
  expanded: false,
  branch: emptyBranchInfo(),
  branches: [],
  remotes: [],
  selectedRemote: "origin",
  stagedFiles: [],
  unstagedFiles: [],
  conflictedFiles: [],
  historyCommits: [],
  historyLoading: false,
  historyFilePath: "",
  stashEntries: [],
  stashLoading: false,
  fileMarkers: {},
  markerUpdatedAt: {},
  markerLoading: {},

  setProjectPath: (projectPath) => {
    const nextProjectPath = projectPath.trim();
    if (nextProjectPath === get().projectPath) {
      return;
    }

    clearGitSync();

    set({
      projectPath: nextProjectPath,
      branch: emptyBranchInfo(),
      branches: [],
      remotes: [],
      selectedRemote: "origin",
      stagedFiles: [],
      unstagedFiles: [],
      conflictedFiles: [],
      historyCommits: [],
      historyLoading: false,
      historyFilePath: "",
      stashEntries: [],
      stashLoading: false,
      error: null,
      isRepositoryMissing: false,
      fileMarkers: {},
      markerUpdatedAt: {},
      markerLoading: {},
    });

    if (!nextProjectPath) {
      return;
    }

    startGitSync(nextProjectPath, get);
    void Promise.all([get().refresh(), get().loadStashes()]);
  },

  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((state) => ({ expanded: !state.expanded })),
  setSelectedRemote: (remote) => set({ selectedRemote: remote }),

  refresh: async () => {
    const { projectPath } = get();
    if (!projectPath) {
      set({
        error: "No project open",
        isRepositoryMissing: false,
        branch: emptyBranchInfo(),
        branches: [],
        remotes: [],
        stagedFiles: [],
        unstagedFiles: [],
        conflictedFiles: [],
      });
      return;
    }

    set({ loading: true, error: null });

    try {
      let statusV2 = "";
      let statusError: unknown = null;

      try {
        statusV2 = await readStatus();
      } catch (error) {
        statusError = error;
      }

      const [fallbackStatus, branchCurrent, branchList, remoteOutput] =
        await Promise.all([
          GetGitStatus().catch(() => ""),
          GetGitBranch().catch(() => ""),
          GetGitBranches().catch(() => []),
          RunGitCommand(["remote"]).catch(() => ""),
        ]);

      const canUseFallbackParser = statusError
        ? (() => {
            const errorMessage = toErrorMessage(statusError).toLowerCase();
            return (
              errorMessage.includes("porcelain=v2") ||
              errorMessage.includes("unknown option") ||
              errorMessage.includes("invalid option") ||
              errorMessage.includes("usage:")
            );
          })()
        : false;

      if (statusError && !canUseFallbackParser) {
        throw statusError;
      }

      const parsed = statusV2.trim()
        ? parseGitStatusPorcelainV2(statusV2)
        : parseGitStatusFallbackV1(fallbackStatus);

      if (!parsed.branch.current && branchCurrent) {
        parsed.branch.current = branchCurrent;
      }

      const remotes = parseRemoteNameList(remoteOutput);
      const selectedRemote = remotes.includes(get().selectedRemote)
        ? get().selectedRemote
        : remotes.includes("origin")
          ? "origin"
          : remotes[0] || "";

      set({
        loading: false,
        isRepositoryMissing: false,
        branch: parsed.branch,
        branches: Array.from(new Set(branchList)),
        remotes,
        selectedRemote,
        stagedFiles: dedupeAndSortFiles(parsed.staged),
        unstagedFiles: dedupeAndSortFiles(parsed.unstaged),
        conflictedFiles: dedupeAndSortFiles(parsed.conflicted),
      });
    } catch (error) {
      set({
        loading: false,
        error: toErrorMessage(error),
        isRepositoryMissing: isMissingRepositoryError(error),
        branch: emptyBranchInfo(),
        branches: [],
        remotes: [],
        stagedFiles: [],
        unstagedFiles: [],
        conflictedFiles: [],
      });
    }
  },

  loadHistory: async (filePath = "") => {
    if (!get().projectPath) {
      set({
        historyCommits: [],
        historyLoading: false,
        historyFilePath: filePath,
      });
      return;
    }

    set({ historyLoading: true, historyFilePath: filePath });
    try {
      const commits = await GetGitLog(100, filePath);
      set({ historyCommits: commits ?? [], historyLoading: false });
    } catch (error) {
      set({ historyLoading: false, error: toErrorMessage(error) });
    }
  },

  loadStashes: async () => {
    if (!get().projectPath) {
      set({ stashEntries: [], stashLoading: false });
      return;
    }

    set({ stashLoading: true });
    try {
      const output = await RunGitCommand([
        "stash",
        "list",
        "--format=%gd%x00%cr%x00%gs%x00%H",
      ]).catch((error) => {
        const message = toErrorMessage(error).toLowerCase();
        if (message.includes("no stash entries found")) {
          return "";
        }
        throw error;
      });

      set({ stashEntries: parseStashEntries(output), stashLoading: false });
    } catch (error) {
      set({
        stashLoading: false,
        error: toErrorMessage(error),
        isRepositoryMissing: isMissingRepositoryError(error),
      });
    }
  },

  stageFile: async (path) => {
    await executeGitAction(get, set, () =>
      RunGitCommand([
        "add",
        "--",
        normalizePathForGit(get().projectPath, path),
      ]).then(() => undefined),
    );
  },

  unstageFile: async (path) => {
    await executeGitAction(get, set, () =>
      RunGitCommand([
        "reset",
        "HEAD",
        "--",
        normalizePathForGit(get().projectPath, path),
      ]).then(() => undefined),
    );
  },

  stageAll: async () => {
    await executeGitAction(get, set, () =>
      RunGitCommand(["add", "-A"]).then(() => undefined),
    );
  },

  unstageAll: async () => {
    await executeGitAction(get, set, () =>
      RunGitCommand(["reset", "HEAD"]).then(() => undefined),
    );
  },

  discardFile: async (path) => {
    await executeGitAction(get, set, () =>
      RunGitCommand([
        "checkout",
        "--",
        normalizePathForGit(get().projectPath, path),
      ]).then(() => undefined),
    );
  },

  initializeRepository: async () => {
    await executeGitAction(get, set, () =>
      RunGitCommand(["init"]).then(() => undefined),
    );
  },

  commit: async (message) => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      return;
    }

    await executeGitAction(get, set, () =>
      RunGitCommand(["commit", "-m", normalizedMessage]).then(() => undefined),
    );
    if (get().historyFilePath) {
      await get().loadHistory(get().historyFilePath);
    } else {
      await get().loadHistory();
    }
  },

  switchBranch: async (branch) => {
    if (!branch.trim()) {
      return;
    }
    await executeGitAction(get, set, () =>
      RunGitCommand(["checkout", branch]).then(() => undefined),
    );
    await get().loadHistory(get().historyFilePath);
  },

  createBranch: async (name, fromBranch) => {
    const branchName = name.trim();
    if (!branchName) {
      return;
    }

    const args = ["checkout", "-b", branchName];
    if (fromBranch && fromBranch.trim()) {
      args.push(fromBranch.trim());
    }

    await executeGitAction(get, set, () =>
      RunGitCommand(args).then(() => undefined),
    );
    await get().loadHistory(get().historyFilePath);
  },

  fetchRemote: async () => {
    const remote = get().selectedRemote.trim();
    const args = remote ? ["fetch", remote] : ["fetch"];
    await executeGitAction(get, set, () =>
      RunGitCommand(args).then(() => undefined),
    );
  },

  pullRemote: async () => {
    const remote = get().selectedRemote.trim();
    const branch = get().branch.current.trim();
    const args = remote && branch ? ["pull", remote, branch] : ["pull"];

    await executeGitAction(get, set, () =>
      RunGitCommand(args).then(() => undefined),
    );
    await get().loadHistory(get().historyFilePath);
  },

  pushRemote: async (setUpstream = false) => {
    const remote = get().selectedRemote.trim();
    const branch = get().branch.current.trim();
    const args = ["push"];
    if (setUpstream && remote && branch) {
      args.push("-u", remote, branch);
    } else if (remote && branch) {
      args.push(remote, branch);
    }

    await executeGitAction(get, set, () =>
      RunGitCommand(args).then(() => undefined),
    );
  },

  createStash: async (message) => {
    const args = ["stash", "push", "-u"];
    if (message?.trim()) {
      args.push("-m", message.trim());
    }
    await executeGitAction(get, set, () =>
      RunGitCommand(args).then(() => undefined),
    );
  },

  popStash: async (stashRef) => {
    const args = stashRef ? ["stash", "pop", stashRef] : ["stash", "pop"];
    await executeGitAction(get, set, () =>
      RunGitCommand(args).then(() => undefined),
    );
  },

  dropStash: async (stashRef) => {
    if (!stashRef) {
      return;
    }
    await executeGitAction(get, set, () =>
      RunGitCommand(["stash", "drop", stashRef]).then(() => undefined),
    );
  },

  getPullRequestUrl: async (baseBranch) => {
    const { branch, selectedRemote } = get();
    if (!branch.current) {
      return null;
    }

    try {
      const remoteName = selectedRemote || "origin";
      const remoteUrl = await RunGitCommand(["remote", "get-url", remoteName]);
      const webRoot = normalizeGitHubRemoteToWeb(remoteUrl);
      if (!webRoot) {
        return null;
      }

      const upstreamBranch = branch.upstream.includes("/")
        ? branch.upstream.split("/").slice(1).join("/")
        : branch.upstream;

      const targetBase = (baseBranch || upstreamBranch || "main").trim();
      const sourceBranch = branch.current.trim();
      if (!targetBase || !sourceBranch) {
        return null;
      }

      return `${webRoot}/compare/${encodeURIComponent(targetBase)}...${encodeURIComponent(sourceBranch)}?expand=1`;
    } catch {
      return null;
    }
  },

  openPullRequest: async (baseBranch) => {
    const url = await get().getPullRequestUrl(baseBranch);
    if (!url) {
      return null;
    }

    window.open(url, "_blank", "noopener,noreferrer");
    return url;
  },

  refreshFileMarkers: async (filePath, force = false) => {
    const { projectPath, markerUpdatedAt, markerLoading } = get();
    if (!projectPath || !filePath) return;

    const relativePath = normalizePathForGit(projectPath, filePath);
    const markerKey = relativePath || filePath;
    const now = Date.now();
    const updatedAt = markerUpdatedAt[markerKey] ?? 0;
    if (!force && now - updatedAt < 800) {
      return;
    }
    if (markerLoading[markerKey]) {
      return;
    }

    set((state) => ({
      markerLoading: {
        ...state.markerLoading,
        [markerKey]: true,
      },
    }));

    try {
      const [unstagedDiff, stagedDiff] = await Promise.all([
        GetGitDiff(relativePath, false).catch(() => ""),
        GetGitDiff(relativePath, true).catch(() => ""),
      ]);

      const unstagedMarkers = parseUnifiedDiffLineMarkers(
        unstagedDiff,
        "unstaged",
      );
      const stagedMarkers = parseUnifiedDiffLineMarkers(stagedDiff, "staged");
      const merged = mergeLineMarkers(stagedMarkers, unstagedMarkers);

      set((state) => {
        const nextMarkers = { ...state.fileMarkers };
        const nextUpdatedAt = { ...state.markerUpdatedAt };
        const nextLoading = { ...state.markerLoading };

        nextMarkers[markerKey] = merged;
        nextUpdatedAt[markerKey] = now;
        nextLoading[markerKey] = false;

        if (filePath !== markerKey) {
          nextMarkers[filePath] = merged;
          nextUpdatedAt[filePath] = now;
          nextLoading[filePath] = false;
        }

        return {
          fileMarkers: nextMarkers,
          markerUpdatedAt: nextUpdatedAt,
          markerLoading: nextLoading,
        };
      });
    } catch {
      set((state) => ({
        markerLoading: {
          ...state.markerLoading,
          [markerKey]: false,
        },
      }));
    }
  },

  clearFileMarkers: (filePath) => {
    if (!filePath) {
      set({ fileMarkers: {}, markerUpdatedAt: {}, markerLoading: {} });
      return;
    }

    set((state) => {
      const nextMarkers = { ...state.fileMarkers };
      const nextUpdatedAt = { ...state.markerUpdatedAt };
      const nextLoading = { ...state.markerLoading };
      delete nextMarkers[filePath];
      delete nextUpdatedAt[filePath];
      delete nextLoading[filePath];
      return {
        fileMarkers: nextMarkers,
        markerUpdatedAt: nextUpdatedAt,
        markerLoading: nextLoading,
      };
    });
  },
}));
