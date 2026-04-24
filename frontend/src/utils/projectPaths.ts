const separatorPattern = /[\\/]/;

const trimTrailingSeparator = (value: string): string => {
  if (value.length <= 1) {
    return value;
  }

  return value.replace(/[\\/]+$/, "");
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeProjectPath = (value: string): string =>
  trimTrailingSeparator(value.trim());

export const isSameOrChildPath = (
  candidate: string,
  prefix: string,
): boolean => {
  const normalizedCandidate = normalizeProjectPath(candidate);
  const normalizedPrefix = normalizeProjectPath(prefix);

  if (!normalizedCandidate || !normalizedPrefix) {
    return false;
  }

  if (normalizedCandidate === normalizedPrefix) {
    return true;
  }

  return new RegExp(`^${escapeRegExp(normalizedPrefix)}[\\\\/]`).test(
    normalizedCandidate,
  );
};

export const remapProjectPathPrefix = (
  candidate: string | null | undefined,
  oldPrefix: string,
  newPrefix: string,
): string | null => {
  if (!candidate) {
    return candidate ?? null;
  }

  const normalizedCandidate = normalizeProjectPath(candidate);
  const normalizedOldPrefix = normalizeProjectPath(oldPrefix);
  const normalizedNewPrefix = normalizeProjectPath(newPrefix);

  if (!normalizedCandidate || !normalizedOldPrefix || !normalizedNewPrefix) {
    return normalizedCandidate || null;
  }

  if (normalizedCandidate === normalizedOldPrefix) {
    return normalizedNewPrefix;
  }

  const match = normalizedCandidate.match(
    new RegExp(`^${escapeRegExp(normalizedOldPrefix)}([\\\\/].*)$`),
  );
  if (!match) {
    return normalizedCandidate;
  }

  return `${normalizedNewPrefix}${match[1]}`;
};

export const relativeProjectPath = (
  filePath: string,
  projectPath?: string | null,
): string => {
  const normalizedFilePath = normalizeProjectPath(filePath);
  const normalizedProjectPath = normalizeProjectPath(projectPath ?? "");

  if (!normalizedProjectPath) {
    return normalizedFilePath;
  }

  if (normalizedFilePath === normalizedProjectPath) {
    return ".";
  }

  const prefixPattern = new RegExp(
    `^${escapeRegExp(normalizedProjectPath)}[\\\\/]`,
  );
  if (!prefixPattern.test(normalizedFilePath)) {
    return normalizedFilePath;
  }

  return normalizedFilePath.replace(prefixPattern, "");
};

export const getProjectPathBasename = (filePath: string): string => {
  const normalized = normalizeProjectPath(filePath);
  const parts = normalized.split(separatorPattern).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
};

export const getProjectPathDirname = (filePath: string): string => {
  const normalized = normalizeProjectPath(filePath);
  const parts = normalized.split(separatorPattern);
  if (parts.length <= 1) {
    return "";
  }
  parts.pop();
  return parts.join("/");
};
