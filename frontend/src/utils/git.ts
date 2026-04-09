export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "copied"
  | "conflicted";

export interface GitFileEntry {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  indexStatus: string;
  workTreeStatus: string;
  originalPath?: string;
}

export interface GitBranchInfo {
  current: string;
  upstream: string;
  ahead: number;
  behind: number;
  detached: boolean;
  oid: string;
}

export interface ParsedGitStatus {
  branch: GitBranchInfo;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  conflicted: GitFileEntry[];
}

export type GitLineMarkerType = "added" | "modified" | "deleted";

export interface GitLineMarker {
  line: number;
  type: GitLineMarkerType;
  count: number;
  source: "staged" | "unstaged";
}

const splitBySpaceWithRemainder = (
  line: string,
  tokenCount: number,
): string[] => {
  const result: string[] = [];
  let cursor = 0;

  while (result.length < tokenCount - 1) {
    while (cursor < line.length && line[cursor] === " ") {
      cursor++;
    }
    if (cursor >= line.length) {
      break;
    }
    const nextSpace = line.indexOf(" ", cursor);
    if (nextSpace === -1) {
      result.push(line.slice(cursor));
      cursor = line.length;
      break;
    }
    result.push(line.slice(cursor, nextSpace));
    cursor = nextSpace + 1;
  }

  if (cursor < line.length) {
    result.push(line.slice(cursor).trim());
  }

  return result;
};

const normalizePathToken = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) return "";
  if (trimmed[0] !== '"') return trimmed;

  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.replace(/^"|"$/g, "");
  }
};

const statusFromCode = (code: string): GitFileStatus => {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "?":
      return "untracked";
    case "U":
      return "conflicted";
    case "M":
    default:
      return "modified";
  }
};

const isConflictCode = (code: string): boolean =>
  code === "U" || code === "A" || code === "D";

const makeEmptyBranchInfo = (): GitBranchInfo => ({
  current: "",
  upstream: "",
  ahead: 0,
  behind: 0,
  detached: false,
  oid: "",
});

const pushEntry = (
  bucket: GitFileEntry[],
  path: string,
  staged: boolean,
  indexStatus: string,
  workTreeStatus: string,
  originalPath?: string,
): void => {
  const statusCode = staged ? indexStatus : workTreeStatus;
  if (!path || statusCode === ".") return;

  bucket.push({
    path,
    status: statusFromCode(statusCode),
    staged,
    indexStatus,
    workTreeStatus,
    originalPath,
  });
};

export const parseGitStatusPorcelainV2 = (output: string): ParsedGitStatus => {
  const branch = makeEmptyBranchInfo();
  const staged: GitFileEntry[] = [];
  const unstaged: GitFileEntry[] = [];
  const conflicted: GitFileEntry[] = [];

  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (line.startsWith("# branch.head ")) {
        const headValue = line.slice("# branch.head ".length).trim();
        branch.current = headValue === "(detached)" ? "HEAD" : headValue;
        branch.detached = headValue === "(detached)";
      } else if (line.startsWith("# branch.upstream ")) {
        branch.upstream = line.slice("# branch.upstream ".length).trim();
      } else if (line.startsWith("# branch.ab ")) {
        const match = line.match(/\+(-?\d+)\s+-(\d+)/);
        if (match) {
          branch.ahead = Number.parseInt(match[1], 10) || 0;
          branch.behind = Number.parseInt(match[2], 10) || 0;
        }
      } else if (line.startsWith("# branch.oid ")) {
        branch.oid = line.slice("# branch.oid ".length).trim();
      }
      continue;
    }

    if (line.startsWith("? ")) {
      const path = normalizePathToken(line.slice(2));
      if (!path) continue;
      unstaged.push({
        path,
        status: "untracked",
        staged: false,
        indexStatus: ".",
        workTreeStatus: "?",
      });
      continue;
    }

    if (line.startsWith("! ")) {
      continue;
    }

    const kind = line[0];
    if (kind !== "1" && kind !== "2" && kind !== "u") {
      continue;
    }

    const tokenCount = kind === "2" ? 10 : kind === "u" ? 12 : 9;
    const parts = splitBySpaceWithRemainder(line, tokenCount);
    if (parts.length < tokenCount) {
      continue;
    }

    const xy = parts[1] ?? "..";
    const indexStatus = xy[0] ?? ".";
    const workTreeStatus = xy[1] ?? ".";
    const rawPath = parts[tokenCount - 1] ?? "";

    let path = "";
    let originalPath: string | undefined;
    if (kind === "2") {
      const renameParts = rawPath.split("\t");
      path = normalizePathToken(renameParts[0] ?? "");
      originalPath = normalizePathToken(renameParts[1] ?? "");
    } else {
      path = normalizePathToken(rawPath);
    }

    if (!path) {
      continue;
    }

    const conflict =
      kind === "u" ||
      isConflictCode(indexStatus) ||
      isConflictCode(workTreeStatus);
    if (conflict) {
      conflicted.push({
        path,
        status: "conflicted",
        staged: false,
        indexStatus,
        workTreeStatus,
        originalPath,
      });
      continue;
    }

    if (indexStatus !== "." && indexStatus !== "?") {
      pushEntry(staged, path, true, indexStatus, workTreeStatus, originalPath);
    }

    if (workTreeStatus !== ".") {
      pushEntry(
        unstaged,
        path,
        false,
        indexStatus,
        workTreeStatus === "?" ? "?" : workTreeStatus,
        originalPath,
      );
    }
  }

  return {
    branch,
    staged,
    unstaged,
    conflicted,
  };
};

export const parseGitStatusFallbackV1 = (output: string): ParsedGitStatus => {
  const branch = makeEmptyBranchInfo();
  const staged: GitFileEntry[] = [];
  const unstaged: GitFileEntry[] = [];

  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 3);

  for (const line of lines) {
    const indexStatus = line[0] === " " ? "." : line[0];
    const workTreeStatus = line[1] === " " ? "." : line[1];
    const normalizedPath = line.slice(3).trim();
    if (!normalizedPath) continue;

    let path = normalizedPath;
    let originalPath: string | undefined;
    if (path.includes(" -> ")) {
      const [fromPath, toPath] = path.split(" -> ");
      originalPath = fromPath;
      path = toPath;
    }

    if (indexStatus !== "." && indexStatus !== "?") {
      pushEntry(staged, path, true, indexStatus, workTreeStatus, originalPath);
    }
    if (workTreeStatus !== ".") {
      pushEntry(
        unstaged,
        path,
        false,
        indexStatus,
        workTreeStatus,
        originalPath,
      );
    }
  }

  return {
    branch,
    staged,
    unstaged,
    conflicted: [],
  };
};

const markerPriority: Record<GitLineMarkerType, number> = {
  deleted: 3,
  modified: 2,
  added: 1,
};

export const mergeLineMarkers = (
  first: GitLineMarker[],
  second: GitLineMarker[],
): GitLineMarker[] => {
  const byLine = new Map<number, GitLineMarker>();
  const addMarker = (marker: GitLineMarker): void => {
    const existing = byLine.get(marker.line);
    if (!existing) {
      byLine.set(marker.line, marker);
      return;
    }

    if (markerPriority[marker.type] >= markerPriority[existing.type]) {
      byLine.set(marker.line, marker);
    }
  };

  first.forEach(addMarker);
  second.forEach(addMarker);

  return Array.from(byLine.values()).sort((a, b) => a.line - b.line);
};

export const parseUnifiedDiffLineMarkers = (
  diffText: string,
  source: "staged" | "unstaged",
): GitLineMarker[] => {
  if (!diffText.trim()) return [];

  const markers: GitLineMarker[] = [];
  const lines = diffText.split("\n");

  let oldLine = 0;
  let newLine = 0;
  let removedBuffer = 0;

  const flushRemoved = (): void => {
    if (removedBuffer <= 0) return;
    markers.push({
      line: Math.max(1, newLine),
      type: "deleted",
      count: removedBuffer,
      source,
    });
    removedBuffer = 0;
  };

  for (const line of lines) {
    if (line.startsWith("@@")) {
      flushRemoved();
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) continue;
      oldLine = Number.parseInt(match[1], 10) || 1;
      newLine = Number.parseInt(match[2], 10) || 1;
      continue;
    }

    if (line.startsWith("diff ") || line.startsWith("index ")) continue;
    if (line.startsWith("---") || line.startsWith("+++")) continue;

    if (line.startsWith("-")) {
      removedBuffer++;
      oldLine++;
      continue;
    }

    if (line.startsWith("+")) {
      markers.push({
        line: Math.max(1, newLine),
        type: removedBuffer > 0 ? "modified" : "added",
        count: 1,
        source,
      });
      if (removedBuffer > 0) {
        removedBuffer--;
      }
      newLine++;
      continue;
    }

    flushRemoved();
    if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }

  flushRemoved();
  return markers;
};

export const normalizePathForGit = (
  projectPath: string,
  filePath: string,
): string => {
  if (!filePath) return filePath;
  if (!projectPath) return filePath;

  const projectPrefix = projectPath.endsWith("/")
    ? projectPath
    : `${projectPath}/`;

  if (filePath.startsWith(projectPrefix)) {
    return filePath.slice(projectPrefix.length);
  }

  return filePath;
};

export const parseRemoteNameList = (output: string): string[] =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export const normalizeGitHubRemoteToWeb = (
  remoteUrl: string,
): string | null => {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("git@github.com:")) {
    const slug = trimmed.slice("git@github.com:".length).replace(/\.git$/, "");
    return slug ? `https://github.com/${slug}` : null;
  }

  if (trimmed.startsWith("ssh://git@github.com/")) {
    const slug = trimmed
      .slice("ssh://git@github.com/".length)
      .replace(/\.git$/, "");
    return slug ? `https://github.com/${slug}` : null;
  }

  if (trimmed.startsWith("https://github.com/")) {
    return trimmed.replace(/\.git$/, "");
  }

  if (trimmed.startsWith("http://github.com/")) {
    return trimmed.replace(/^http:\/\//, "https://").replace(/\.git$/, "");
  }

  return null;
};
