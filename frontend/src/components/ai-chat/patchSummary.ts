export type PatchFileStatus = "added" | "deleted" | "edited" | "renamed";

export interface PatchFileHint {
  path: string;
  status?: string;
}

export interface PatchFileSummary {
  path: string;
  previousPath?: string;
  status: PatchFileStatus;
  additions: number;
  deletions: number;
}

interface MutablePatchFileSummary {
  oldPath?: string;
  newPath?: string;
  previousPath?: string;
  status?: PatchFileStatus;
  additions: number;
  deletions: number;
  inHunk: boolean;
}

const nullPath = "/dev/null";

function decodeQuotedPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1);
  }
}

function normalizeDiffPath(value: string): string {
  const withoutTimestamp = value.split("\t", 1)[0]?.trim() ?? "";
  const decoded = decodeQuotedPath(withoutTimestamp);
  if (decoded === nullPath) {
    return decoded;
  }
  return decoded.replace(/^(?:a|b)\//, "");
}

function splitGitHeaderPaths(value: string): [string, string] | undefined {
  const paths: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === " " && !quoted) {
      if (current) {
        paths.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current) {
    paths.push(current);
  }
  if (paths.length !== 2) {
    return undefined;
  }
  return [normalizeDiffPath(paths[0]), normalizeDiffPath(paths[1])];
}

function normalizeHintStatus(status = ""): PatchFileStatus {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (["add", "added", "create", "created", "new"].includes(normalized)) {
    return "added";
  }
  if (["delete", "deleted", "remove", "removed"].includes(normalized)) {
    return "deleted";
  }
  if (["rename", "renamed", "move", "moved"].includes(normalized)) {
    return "renamed";
  }
  return "edited";
}

function finalizeFile(
  file: MutablePatchFileSummary | undefined,
): PatchFileSummary | undefined {
  if (!file) {
    return undefined;
  }

  const oldPath = file.oldPath ? normalizeDiffPath(file.oldPath) : "";
  const newPath = file.newPath ? normalizeDiffPath(file.newPath) : "";
  const path = newPath && newPath !== nullPath ? newPath : oldPath;
  if (!path || path === nullPath) {
    return undefined;
  }

  let status = file.status;
  if (!status) {
    if (oldPath === nullPath) {
      status = "added";
    } else if (newPath === nullPath) {
      status = "deleted";
    } else if (oldPath && newPath && oldPath !== newPath) {
      status = "renamed";
    } else {
      status = "edited";
    }
  }

  const previousPath =
    file.previousPath ||
    (status === "renamed" && oldPath && oldPath !== path ? oldPath : undefined);
  return {
    path,
    previousPath,
    status,
    additions: file.additions,
    deletions: file.deletions,
  };
}

function mergeFileSummaries(files: PatchFileSummary[]): PatchFileSummary[] {
  const merged = new Map<string, PatchFileSummary>();
  for (const file of files) {
    const existing = merged.get(file.path);
    if (!existing) {
      merged.set(file.path, file);
      continue;
    }
    merged.set(file.path, {
      ...existing,
      previousPath: existing.previousPath || file.previousPath,
      status: existing.status === "edited" ? file.status : existing.status,
      additions: existing.additions + file.additions,
      deletions: existing.deletions + file.deletions,
    });
  }
  return [...merged.values()];
}

export function summarizeUnifiedDiff(
  unifiedDiff: string,
  hints: readonly PatchFileHint[] = [],
): PatchFileSummary[] {
  const parsed: PatchFileSummary[] = [];
  let current: MutablePatchFileSummary | undefined;

  const flush = () => {
    const summary = finalizeFile(current);
    if (summary) {
      parsed.push(summary);
    }
    current = undefined;
  };

  for (const line of unifiedDiff.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = { additions: 0, deletions: 0, inHunk: false };
      const pair = splitGitHeaderPaths(line.slice("diff --git ".length));
      if (pair) {
        [current.oldPath, current.newPath] = pair;
      }
      continue;
    }

    if (line.startsWith("--- ")) {
      if (!current || current.inHunk) {
        flush();
        current = { additions: 0, deletions: 0, inHunk: false };
      }
      current.oldPath = line.slice(4);
      continue;
    }
    if (line.startsWith("+++ ")) {
      current ??= { additions: 0, deletions: 0, inHunk: false };
      current.newPath = line.slice(4);
      continue;
    }
    if (!current) {
      continue;
    }

    if (line.startsWith("new file mode ")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.previousPath = normalizeDiffPath(
        line.slice("rename from ".length),
      );
      current.oldPath = current.previousPath;
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.newPath = normalizeDiffPath(line.slice("rename to ".length));
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("@@")) {
      current.inHunk = true;
      continue;
    }
    if (!current.inHunk || line.startsWith("\\ No newline at end of file")) {
      continue;
    }
    if (line.startsWith("+")) {
      current.additions += 1;
    } else if (line.startsWith("-")) {
      current.deletions += 1;
    }
  }
  flush();

  const files = mergeFileSummaries(parsed);
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const hint of hints) {
    const path = normalizeDiffPath(hint.path);
    if (!path || path === nullPath) {
      continue;
    }
    const existing = byPath.get(path);
    if (existing) {
      if (existing.status === "edited") {
        existing.status = normalizeHintStatus(hint.status);
      }
      continue;
    }
    const summary: PatchFileSummary = {
      path,
      status: normalizeHintStatus(hint.status),
      additions: 0,
      deletions: 0,
    };
    files.push(summary);
    byPath.set(path, summary);
  }
  return files;
}

export function patchFileDisplay(path: string): {
  name: string;
  directory: string;
} {
  const separator = path.lastIndexOf("/");
  if (separator < 0) {
    return { name: path, directory: "." };
  }
  return {
    name: path.slice(separator + 1),
    directory: path.slice(0, separator) || ".",
  };
}
