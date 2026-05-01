export const PROJECT_WINDOW_ROUTE_PARAM = "arleProjectWindow";

export interface ProjectWindowLaunchPayload {
  projectPath: string;
  source?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  return atob(padded);
};

const storageHash = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
};

export const readProjectWindowLaunchPayload = (
  search: string = typeof window === "undefined" ? "" : window.location.search,
): ProjectWindowLaunchPayload | null => {
  const encoded = new URLSearchParams(search).get(PROJECT_WINDOW_ROUTE_PARAM);
  if (!encoded) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encoded));
    if (!isRecord(payload) || typeof payload.projectPath !== "string") {
      return null;
    }

    const projectPath = payload.projectPath.trim();
    if (!projectPath) {
      return null;
    }

    return {
      projectPath,
      source:
        typeof payload.source === "string" ? payload.source.trim() : undefined,
    };
  } catch {
    return null;
  }
};

export const isProjectWindowRoute = (
  search: string = typeof window === "undefined" ? "" : window.location.search,
): boolean => readProjectWindowLaunchPayload(search) !== null;

export const workspaceStorageNameForProjectWindow = (
  payload: ProjectWindowLaunchPayload | null,
): string =>
  payload
    ? `workspace-storage:project-window:${storageHash(payload.projectPath)}`
    : "workspace-storage";
