import { create } from "zustand";

import {
  GetGitBranch,
  GetGitBranches,
  GetGitDiff,
  GetGitStatus,
  RunGitCommand,
} from "../../wailsjs/go/main/App";
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

interface GitStoreState {
  projectPath: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  expanded: boolean;
  branch: GitBranchInfo;
  branches: string[];
  remotes: string[];
  selectedRemote: string;
  stagedFiles: GitFileEntry[];
  unstagedFiles: GitFileEntry[];
  conflictedFiles: GitFileEntry[];
  fileMarkers: Record<string, GitLineMarker[]>;
  markerUpdatedAt: Record<string, number>;
  markerLoading: Record<string, boolean>;
  setProjectPath: (projectPath: string) => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
  setSelectedRemote: (remote: string) => void;
  refresh: () => Promise<void>;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  discardFile: (path: string) => Promise<void>;
  commit: (message: string) => Promise<void>;
  switchBranch: (branch: string) => Promise<void>;
  createBranch: (name: string, fromBranch?: string) => Promise<void>;
  fetchRemote: () => Promise<void>;
  pullRemote: () => Promise<void>;
  pushRemote: (setUpstream?: boolean) => Promise<void>;
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

const readStatus = async (): Promise<string> =>
  RunGitCommand(["status", "-b", "--porcelain=v2"]);

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
    await get().refresh();
  } catch (error) {
    set({ error: toErrorMessage(error) });
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
  expanded: false,
  branch: emptyBranchInfo(),
  branches: [],
  remotes: [],
  selectedRemote: "origin",
  stagedFiles: [],
  unstagedFiles: [],
  conflictedFiles: [],
  fileMarkers: {},
  markerUpdatedAt: {},
  markerLoading: {},

  setProjectPath: (projectPath) => {
    if (projectPath === get().projectPath) return;
    set({
      projectPath,
      branch: emptyBranchInfo(),
      branches: [],
      remotes: [],
      stagedFiles: [],
      unstagedFiles: [],
      conflictedFiles: [],
      error: null,
      fileMarkers: {},
      markerUpdatedAt: {},
      markerLoading: {},
    });
  },

  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((state) => ({ expanded: !state.expanded })),
  setSelectedRemote: (remote) => set({ selectedRemote: remote }),

  refresh: async () => {
    const { projectPath } = get();
    if (!projectPath) {
      set({
        error: "No project open",
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
        branch: parsed.branch,
        branches: Array.from(new Set(branchList)).sort((a, b) =>
          a.localeCompare(b),
        ),
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
        branch: emptyBranchInfo(),
        branches: [],
        remotes: [],
        stagedFiles: [],
        unstagedFiles: [],
        conflictedFiles: [],
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

  commit: async (message) => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) return;

    await executeGitAction(get, set, () =>
      RunGitCommand(["commit", "-m", normalizedMessage]).then(() => undefined),
    );
  },

  switchBranch: async (branch) => {
    if (!branch.trim()) return;
    await executeGitAction(get, set, () =>
      RunGitCommand(["checkout", branch]).then(() => undefined),
    );
  },

  createBranch: async (name, fromBranch) => {
    const branchName = name.trim();
    if (!branchName) return;

    const args = ["checkout", "-b", branchName];
    if (fromBranch && fromBranch.trim()) {
      args.push(fromBranch.trim());
    }

    await executeGitAction(get, set, () =>
      RunGitCommand(args).then(() => undefined),
    );
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

  getPullRequestUrl: async (baseBranch) => {
    const { branch, selectedRemote } = get();
    if (!branch.current) return null;

    try {
      const remoteName = selectedRemote || "origin";
      const remoteUrl = await RunGitCommand(["remote", "get-url", remoteName]);
      const webRoot = normalizeGitHubRemoteToWeb(remoteUrl);
      if (!webRoot) return null;

      const upstreamBranch = branch.upstream.includes("/")
        ? branch.upstream.split("/").slice(1).join("/")
        : branch.upstream;

      const targetBase = (baseBranch || upstreamBranch || "main").trim();
      const sourceBranch = branch.current.trim();
      if (!targetBase || !sourceBranch) return null;

      return `${webRoot}/compare/${encodeURIComponent(targetBase)}...${encodeURIComponent(sourceBranch)}?expand=1`;
    } catch {
      return null;
    }
  },

  openPullRequest: async (baseBranch) => {
    const url = await get().getPullRequestUrl(baseBranch);
    if (!url) return null;

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
