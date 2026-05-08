export const PROJECT_SESSION_ROUTE_PARAM = "arleProjectSession";

export interface ProjectSessionRoutePayload {
  sessionId: string;
}

let projectSessionRouteOverride: ProjectSessionRoutePayload | null = null;

const storageHash = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
};

export const readProjectSessionRoutePayload = (
  search?: string,
): ProjectSessionRoutePayload | null => {
  const hasExplicitSearch = typeof search === "string";
  const source =
    search ?? (typeof window === "undefined" ? "" : window.location.search);
  const sessionId = new URLSearchParams(source)
    .get(PROJECT_SESSION_ROUTE_PARAM)
    ?.trim();
  if (sessionId) {
    return { sessionId };
  }
  return hasExplicitSearch ? null : projectSessionRouteOverride;
};

export const isProjectSessionRoute = (search?: string): boolean =>
  readProjectSessionRoutePayload(search) !== null;

export const setProjectSessionRoutePayloadOverride = (
  payload: ProjectSessionRoutePayload | null,
) => {
  projectSessionRouteOverride = payload?.sessionId ? payload : null;
};

export const getCurrentProjectSessionId = (): string =>
  readProjectSessionRoutePayload()?.sessionId ?? "main";

export const workspaceStorageNameForProjectSession = (
  payload: ProjectSessionRoutePayload | null,
): string =>
  payload
    ? `workspace-storage:project-session:${storageHash(payload.sessionId)}`
    : "workspace-storage";
