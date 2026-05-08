const PROJECT_WINDOW_RESTORE_STORAGE_KEY = "project-window-restore.v1";

interface ProjectWindowRestoreState {
  version: 1;
  paths: string[];
}

type RuntimeEventBridge = {
  EventsOn?: (
    eventName: string,
    callback: (...data: unknown[]) => void,
  ) => (() => void) | void;
};

const normalizeProjectPath = (path: string): string => path.trim();

const canUseLocalStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const readRestoreState = (): ProjectWindowRestoreState => {
  if (!canUseLocalStorage()) {
    return { version: 1, paths: [] };
  }

  try {
    const raw = window.localStorage.getItem(PROJECT_WINDOW_RESTORE_STORAGE_KEY);
    if (!raw) {
      return { version: 1, paths: [] };
    }

    const parsed = JSON.parse(raw) as Partial<ProjectWindowRestoreState>;
    if (!Array.isArray(parsed.paths)) {
      return { version: 1, paths: [] };
    }

    return {
      version: 1,
      paths: parsed.paths
        .map((path) =>
          typeof path === "string" ? normalizeProjectPath(path) : "",
        )
        .filter(Boolean),
    };
  } catch {
    return { version: 1, paths: [] };
  }
};

const writeRestoreState = (paths: string[]) => {
  if (!canUseLocalStorage()) {
    return;
  }

  const uniquePaths = Array.from(
    new Set(paths.map(normalizeProjectPath).filter(Boolean)),
  );

  try {
    window.localStorage.setItem(
      PROJECT_WINDOW_RESTORE_STORAGE_KEY,
      JSON.stringify({ version: 1, paths: uniquePaths }),
    );
  } catch {
    // Ignore storage errors; restore is best-effort and should not block IDE use.
  }
};

export const readProjectWindowRestorePaths = (): string[] =>
  readRestoreState().paths;

export const rememberProjectWindowRestorePath = (path: string) => {
  const normalizedPath = normalizeProjectPath(path);
  if (!normalizedPath) {
    return;
  }

  writeRestoreState([...readRestoreState().paths, normalizedPath]);
};

export const forgetProjectWindowRestorePath = (path: string) => {
  const normalizedPath = normalizeProjectPath(path);
  if (!normalizedPath) {
    return;
  }

  writeRestoreState(
    readRestoreState().paths.filter(
      (candidate) => candidate !== normalizedPath,
    ),
  );
};

let projectWindowLifecycleCleanup: (() => void) | null = null;

export const bindProjectWindowRestoreLifecycle = (path: string) => {
  const normalizedPath = normalizeProjectPath(path);
  if (!normalizedPath || typeof window === "undefined") {
    return;
  }

  rememberProjectWindowRestorePath(normalizedPath);
  projectWindowLifecycleCleanup?.();

  let appIsTerminating = false;
  let lifecycleDisposed = false;
  const unsubscribeTerminateCallbacks: Array<() => void> = [];
  const handleAppWillTerminate = () => {
    appIsTerminating = true;
  };
  const registerTerminateSubscription = (unsubscribe: (() => void) | void) => {
    if (typeof unsubscribe !== "function") {
      return;
    }
    if (lifecycleDisposed) {
      unsubscribe();
      return;
    }
    unsubscribeTerminateCallbacks.push(unsubscribe);
  };

  const runtime = (window as typeof window & { runtime?: RuntimeEventBridge })
    .runtime;
  registerTerminateSubscription(
    runtime?.EventsOn?.("app:will-terminate", handleAppWillTerminate),
  );

  void import("../wails/runtime")
    .then(({ EventsOn }) => {
      registerTerminateSubscription(
        EventsOn("app:will-terminate", handleAppWillTerminate),
      );
    })
    .catch(() => {
      // Runtime events are not available in plain browser tests.
    });

  const handlePageHide = () => {
    if (!appIsTerminating) {
      forgetProjectWindowRestorePath(normalizedPath);
    }
  };

  window.addEventListener("pagehide", handlePageHide);
  projectWindowLifecycleCleanup = () => {
    lifecycleDisposed = true;
    window.removeEventListener("pagehide", handlePageHide);
    unsubscribeTerminateCallbacks.forEach((unsubscribe) => unsubscribe());
  };
};
