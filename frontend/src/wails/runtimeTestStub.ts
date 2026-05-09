type RuntimeEvent = {
  data: unknown;
};

type RuntimeCallback = (event: RuntimeEvent) => void;

type RuntimeWindow = typeof window & {
  go?: {
    main?: {
      App?: Record<string, (...args: unknown[]) => unknown>;
    };
  };
  runtime?: {
    EventsOnMultiple?: (
      eventName: string,
      callback: (payload: unknown) => void,
      maxCallbacks?: number,
    ) => (() => void) | string | void;
    EventsOff?: (eventName: string, ...additional: string[]) => void;
    EventsEmit?: (eventName: string, payload?: unknown) => void;
  };
};

const callIDToMethod = new Map<number, string>([
  [371497096, "CloseProject"],
  [3924508043, "GetCurrentProjectFramework"],
  [3018154166, "GetCurrentProjectPath"],
  [4288915571, "GetDevToolsStatus"],
  [3359005311, "GetAutocompleteLanguageCapabilities"],
  [780159089, "GetEditorCompletions"],
  [2688063178, "GetGitDiff"],
  [4123560639, "GetGitStatus"],
  [1376901355, "GetLSPInstallStatus"],
  [2741556134, "GetRecentProjects"],
  [1383723841, "GetShellCapabilities"],
  [852222967, "IsNativeFullscreen"],
  [2897633925, "IsLSPInstalling"],
  [1991393444, "InspectEditorFile"],
  [2376510860, "InspectProject"],
  [2417092806, "InspectProjectAccess"],
  [2755018294, "LSPPreloadProjectDiagnostics"],
  [3640445830, "NotifyFileChanged"],
  [3996156971, "NotifyFileOpened"],
  [517162042, "OpenProject"],
  [3352504172, "InstallLSPServer"],
  [3882613584, "ReadDirectory"],
  [38130499, "ReadEditorBinaryFile"],
  [3674158986, "ReadEditorFilePreview"],
  [963892010, "ReadEditorVisualFile"],
  [1160596971, "ReadFile"],
  [2439147269, "RecordCompletionUsage"],
  [1772246131, "RunGitCommand"],
  [1735672136, "SelectDirectory"],
  [1433890444, "ValidateEnvironment"],
  [3562730546, "WriteFile"],
]);

const localEventHandlers = new Map<string, Set<RuntimeCallback>>();

const getRuntimeWindow = (): RuntimeWindow | null =>
  typeof window === "undefined" ? null : (window as RuntimeWindow);

const callBridgeMethod = async (
  methodName: string | undefined,
  ...args: unknown[]
): Promise<unknown> => {
  if (!methodName) {
    return null;
  }

  const bridge = getRuntimeWindow()?.go?.main?.App;
  const method = bridge?.[methodName];
  if (typeof method !== "function") {
    return null;
  }

  return method(...args);
};

const parseSource = (source: unknown): unknown => {
  if (typeof source !== "string") {
    return source;
  }
  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
};

const identity = (value: unknown): unknown => value;

export const Call = {
  ByID: (id: number, ...args: unknown[]) =>
    callBridgeMethod(callIDToMethod.get(id), ...args),
  ByName: (methodName: string, ...args: unknown[]) =>
    callBridgeMethod(methodName.split(".").pop(), ...args),
};

export const CancellablePromise = Promise;

export const Create = {
  Any: identity,
  Array:
    (createItem: (value: unknown) => unknown = identity) =>
    (source: unknown): unknown[] => {
      const value = parseSource(source);
      return Array.isArray(value) ? value.map(createItem) : [];
    },
  Map:
    (
      _createKey: (value: unknown) => unknown = identity,
      createValue: (value: unknown) => unknown = identity,
    ) =>
    (source: unknown): Record<string, unknown> => {
      const value = parseSource(source);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          createValue(entry),
        ]),
      );
    },
  Nullable:
    (createValue: (value: unknown) => unknown = identity) =>
    (source: unknown): unknown =>
      source === null || source === undefined ? null : createValue(source),
};

export const Events = {
  On(eventName: string, callback: RuntimeCallback): () => void {
    const runtime = getRuntimeWindow()?.runtime;
    if (typeof runtime?.EventsOnMultiple === "function") {
      const unsubscribe = runtime.EventsOnMultiple(
        eventName,
        (payload) => callback({ data: payload }),
        -1,
      );
      return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
    }

    const handlers = localEventHandlers.get(eventName) ?? new Set();
    handlers.add(callback);
    localEventHandlers.set(eventName, handlers);
    return () => handlers.delete(callback);
  },
  OnMultiple(
    eventName: string,
    callback: RuntimeCallback,
    maxCallbacks: number,
  ): () => void {
    let count = 0;
    const unsubscribe = Events.On(eventName, (event) => {
      if (maxCallbacks >= 0 && count >= maxCallbacks) {
        unsubscribe();
        return;
      }
      count += 1;
      callback(event);
      if (maxCallbacks >= 0 && count >= maxCallbacks) {
        unsubscribe();
      }
    });
    return unsubscribe;
  },
  Once(eventName: string, callback: RuntimeCallback): () => void {
    return Events.OnMultiple(eventName, callback, 1);
  },
  Off(eventName: string, ...additionalEventNames: string[]): void {
    const runtime = getRuntimeWindow()?.runtime;
    if (typeof runtime?.EventsOff === "function") {
      runtime.EventsOff(eventName, ...additionalEventNames);
    }
    [eventName, ...additionalEventNames].forEach((name) =>
      localEventHandlers.delete(name),
    );
  },
  OffAll(): void {
    localEventHandlers.clear();
  },
  Emit(eventName: string, payload?: unknown): void {
    const runtime = getRuntimeWindow()?.runtime;
    if (typeof runtime?.EventsEmit === "function") {
      runtime.EventsEmit(eventName, payload);
      return;
    }

    const handlers = localEventHandlers.get(eventName) ?? new Set();
    handlers.forEach((handler) => handler({ data: payload }));
  },
};

export const Application = {
  Quit: async () => undefined,
};

export const Browser = {
  OpenURL: async () => undefined,
};

export const Clipboard = {
  Text: async () =>
    typeof window === "undefined"
      ? ""
      : ((window as unknown as { __copiedText?: string }).__copiedText ?? ""),
  SetText: async (text: string) => {
    if (typeof window !== "undefined") {
      (window as unknown as { __copiedText?: string }).__copiedText = text;
    }
  },
};

export const Window = {
  Fullscreen: async () => undefined,
  UnFullscreen: async () => undefined,
  IsFullscreen: async () => false,
  Minimise: async () => undefined,
  ToggleMaximise: async () => undefined,
  SetTitle: async () => undefined,
  Reload: async () => undefined,
};
