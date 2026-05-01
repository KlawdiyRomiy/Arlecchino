export const PROJECT_SESSION_ROUTE_PARAM = "arleProjectSession";

export interface ProjectSessionRoutePayload {
  sessionId: string;
}

const storageHash = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
};

export const readProjectSessionRoutePayload = (
  search: string = typeof window === "undefined" ? "" : window.location.search,
): ProjectSessionRoutePayload | null => {
  const sessionId = new URLSearchParams(search)
    .get(PROJECT_SESSION_ROUTE_PARAM)
    ?.trim();
  return sessionId ? { sessionId } : null;
};

export const isProjectSessionRoute = (
  search: string = typeof window === "undefined" ? "" : window.location.search,
): boolean => readProjectSessionRoutePayload(search) !== null;

export const workspaceStorageNameForProjectSession = (
  payload: ProjectSessionRoutePayload | null,
): string =>
  payload
    ? `workspace-storage:project-session:${storageHash(payload.sessionId)}`
    : "workspace-storage";
