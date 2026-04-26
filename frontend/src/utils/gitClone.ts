export const deriveCloneProjectName = (repositoryUrl: string): string => {
  let candidate = repositoryUrl.trim().replace(/\/+$/, "");
  candidate = candidate.split("?")[0]?.split("#")[0]?.replace(/\/+$/, "") ?? "";
  if (!candidate) {
    return "";
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.pathname) {
      candidate = parsed.pathname;
    }
  } catch {
    // SSH scp-style remotes and local paths are handled by the segment split below.
  }

  const lastSeparator = Math.max(
    candidate.lastIndexOf("/"),
    candidate.lastIndexOf(":"),
  );
  if (lastSeparator >= 0 && lastSeparator < candidate.length - 1) {
    candidate = candidate.slice(lastSeparator + 1);
  }

  return candidate.replace(/\.git$/i, "").trim();
};
