export type FileTreeEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type FileTreeNode = FileTreeEntry & {
  children?: FileTreeNode[];
  isExpanded?: boolean;
  isLoaded?: boolean;
};

const IGNORED_ENTRY_PATTERNS = [
  "node_modules",
  "vendor",
  ".git",
  ".idea",
  ".vscode",
  "storage/framework",
  "storage/logs",
  "bootstrap/cache",
];

export function shouldIgnoreEntry(name: string): boolean {
  return IGNORED_ENTRY_PATTERNS.some((pattern) => name.includes(pattern));
}

export function sortFileNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.isDirectory && !b.isDirectory) return -1;
  if (!a.isDirectory && b.isDirectory) return 1;
  return a.name.localeCompare(b.name);
}

export function buildFileNodes(
  entries: FileTreeEntry[] | null | undefined,
  expandedPaths?: ReadonlySet<string>,
): FileTreeNode[] {
  const safeEntries = Array.isArray(entries) ? entries : [];

  return safeEntries
    .filter((entry) => !shouldIgnoreEntry(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      children: entry.isDirectory ? [] : undefined,
      isExpanded: expandedPaths?.has(entry.path) ?? false,
      isLoaded: false,
    }))
    .sort(sortFileNodes);
}
