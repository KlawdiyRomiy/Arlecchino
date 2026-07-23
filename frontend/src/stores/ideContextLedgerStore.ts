import { create } from "zustand";
import { EventsOn } from "../wails/runtime";
import {
  parseProjectFilesystemChangeBatch,
  PROJECT_ENTRIES_CHANGED_EVENT,
} from "../utils/projectFilesystemEvents";
import { getCurrentProjectSessionId } from "../shell/projectSessionRoute";
import {
  getSurfaceRuntimeEventHistory,
  subscribeSurfaceRuntimeEvents,
} from "../surfaces/surfaceRuntimeStore";
import type { SurfaceRuntimeEvent } from "../surfaces/surfaceRuntimeEvents";

export type IDEContextEventScope =
  | "editor"
  | "filesystem"
  | "workspace"
  | "surface"
  | "terminal"
  | "git"
  | "diagnostics"
  | "indexer"
  | "mcp"
  | "ai"
  | "runtime";

export interface IDEContextEventInput {
  scope: IDEContextEventScope;
  type: string;
  title: string;
  detail?: string;
  path?: string;
  projectPath?: string;
  resource?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  at?: number;
}

export interface IDEContextEvent extends Omit<
  IDEContextEventInput,
  "at" | "metadata"
> {
  id: string;
  sequence: number;
  at: number;
  metadata: Record<string, string | number | boolean | null>;
}

interface IDEContextLedgerState {
  sequence: number;
  events: IDEContextEvent[];
  record: (event: IDEContextEventInput) => IDEContextEvent;
  clear: () => void;
}

const MAX_IDE_CONTEXT_EVENTS = 160;
const COALESCE_WINDOW_MS = 500;
const INDEXER_PROGRESS_LEDGER_PERCENT_STEP = 10;
const INDEXER_FILE_ERROR_LEDGER_MIN_MS = 5000;

const sanitizeText = (value: string, limit = 280): string =>
  value.replace(/\s+/g, " ").trim().slice(0, limit);

const sanitizeMetadata = (
  metadata: IDEContextEventInput["metadata"] = {},
): IDEContextEvent["metadata"] => {
  const next: IDEContextEvent["metadata"] = {};
  Object.entries(metadata).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (typeof value === "string") {
      next[key] = sanitizeText(value, 180);
      return;
    }
    next[key] = value;
  });
  return next;
};

const normalizeEventInput = (
  event: IDEContextEventInput,
): IDEContextEventInput => ({
  ...event,
  type: sanitizeText(event.type, 80),
  title: sanitizeText(event.title, 180),
  detail: event.detail ? sanitizeText(event.detail, 320) : undefined,
  path: event.path ? sanitizeText(event.path, 320) : undefined,
  projectPath: event.projectPath
    ? sanitizeText(event.projectPath, 320)
    : undefined,
  resource: event.resource ? sanitizeText(event.resource, 180) : undefined,
});

const eventCoalesceKey = (event: IDEContextEventInput): string =>
  [
    event.scope,
    event.type,
    event.path ?? "",
    event.projectPath ?? "",
    event.resource ?? "",
  ].join("|");

export const fingerprintText = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const countLines = (value: string): number => {
  if (value === "") {
    return 0;
  }
  return value.split("\n").length;
};

export const useIDEContextLedgerStore = create<IDEContextLedgerState>(
  (set, get) => ({
    sequence: 0,
    events: [],

    record: (rawEvent) => {
      const normalized = normalizeEventInput(rawEvent);
      const now = normalized.at ?? Date.now();
      const sequence = get().sequence + 1;
      const event: IDEContextEvent = {
        id: `idectx-${sequence}-${now}`,
        sequence,
        scope: normalized.scope,
        type: normalized.type,
        title: normalized.title,
        detail: normalized.detail,
        path: normalized.path,
        projectPath: normalized.projectPath,
        resource: normalized.resource,
        metadata: sanitizeMetadata(normalized.metadata),
        at: now,
      };

      set((state) => {
        const previous = state.events.at(-1);
        const canCoalesce =
          previous &&
          now - previous.at <= COALESCE_WINDOW_MS &&
          eventCoalesceKey(previous) === eventCoalesceKey(event);

        const events = canCoalesce
          ? [...state.events.slice(0, -1), event]
          : [...state.events, event].slice(-MAX_IDE_CONTEXT_EVENTS);

        return {
          sequence,
          events,
        };
      });

      return event;
    },

    clear: () => set({ sequence: 0, events: [] }),
  }),
);

export const recordIDEContextEvent = (
  event: IDEContextEventInput,
): IDEContextEvent => useIDEContextLedgerStore.getState().record(event);

const terminalEventMatchesCurrentSession = (event: { sessionId?: string }) => {
  const sessionId =
    typeof event.sessionId === "string" && event.sessionId.length > 0
      ? event.sessionId
      : "main";
  return sessionId === getCurrentProjectSessionId();
};

const pathFromPayload = (payload: unknown, key = "path"): string => {
  if (typeof payload === "string") {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
};

const registerRuntimeEvent = (
  cleanups: Array<() => void>,
  eventName: string,
  handler: (payload: unknown) => void,
) => {
  cleanups.push(EventsOn(eventName, handler));
};

let ledgerRuntimeCleanup: (() => void) | null = null;
let lastIndexerProgressLedgerBucket = -1;
let lastIndexerFileErrorLedgerAt = 0;

const resetIndexerProgressLedgerMilestone = () => {
  lastIndexerProgressLedgerBucket = -1;
  lastIndexerFileErrorLedgerAt = 0;
};

const nextIndexerProgressLedgerMilestone = (payload: unknown) => {
  const event = (payload ?? {}) as { current?: number; total?: number };
  const current = typeof event.current === "number" ? event.current : 0;
  const total = typeof event.total === "number" ? event.total : 0;
  if (total <= 0 || current <= 0 || current >= total) {
    return null;
  }

  const percent = Math.max(0, Math.min(100, (current / total) * 100));
  const bucket =
    Math.floor(percent / INDEXER_PROGRESS_LEDGER_PERCENT_STEP) *
    INDEXER_PROGRESS_LEDGER_PERCENT_STEP;
  if (bucket <= 0 || bucket === lastIndexerProgressLedgerBucket) {
    return null;
  }

  lastIndexerProgressLedgerBucket = bucket;
  return { current, total, percent: bucket };
};

export const bindIDEContextLedger = (): (() => void) => {
  if (ledgerRuntimeCleanup) {
    return ledgerRuntimeCleanup;
  }

  const cleanups: Array<() => void> = [];

  registerRuntimeEvent(cleanups, "file:changed", (payload) => {
    const path = pathFromPayload(payload);
    recordIDEContextEvent({
      scope: "filesystem",
      type: "file.changed",
      title: "File changed on disk",
      path,
    });
  });

  registerRuntimeEvent(cleanups, "file:created", (payload) => {
    const path = pathFromPayload(payload);
    recordIDEContextEvent({
      scope: "filesystem",
      type: "file.created",
      title: "File created",
      path,
    });
  });

  registerRuntimeEvent(cleanups, "project:entry:created", (payload) => {
    recordIDEContextEvent({
      scope: "filesystem",
      type: "project.entry.created",
      title: "Project entry created",
      path: pathFromPayload(payload),
      metadata: {
        isDirectory:
          typeof payload === "object" &&
          payload !== null &&
          Boolean((payload as Record<string, unknown>).isDirectory),
      },
    });
  });

  registerRuntimeEvent(cleanups, "project:entry:renamed", (payload) => {
    const oldPath = pathFromPayload(payload, "oldPath");
    const newPath = pathFromPayload(payload, "newPath");
    recordIDEContextEvent({
      scope: "filesystem",
      type: "project.entry.renamed",
      title: "Project entry renamed",
      path: newPath,
      metadata: { oldPath },
    });
  });

  registerRuntimeEvent(cleanups, "project:entry:deleted", (payload) => {
    recordIDEContextEvent({
      scope: "filesystem",
      type: "project.entry.deleted",
      title: "Project entry deleted",
      path: pathFromPayload(payload),
    });
  });

  registerRuntimeEvent(cleanups, PROJECT_ENTRIES_CHANGED_EVENT, (payload) => {
    const batch = parseProjectFilesystemChangeBatch(payload);
    const total =
      batch.created.length + batch.changed.length + batch.deleted.length;
    if (total === 0) {
      return;
    }

    recordIDEContextEvent({
      scope: "filesystem",
      type: "project.entries.changed",
      title: "Project entries changed",
      metadata: {
        created: batch.created.length,
        changed: batch.changed.length,
        deleted: batch.deleted.length,
      },
    });
  });

  registerRuntimeEvent(cleanups, "terminal:created", (payload) => {
    if (
      payload &&
      typeof payload === "object" &&
      !terminalEventMatchesCurrentSession(payload as { sessionId?: string })
    ) {
      return;
    }
    const event = (payload ?? {}) as { id?: string; name?: string };
    recordIDEContextEvent({
      scope: "terminal",
      type: "terminal.created",
      title: "Terminal created",
      resource: event.id,
      metadata: { name: event.name ?? "" },
    });
  });

  registerRuntimeEvent(cleanups, "terminal:exit", (payload) => {
    if (
      payload &&
      typeof payload === "object" &&
      !terminalEventMatchesCurrentSession(payload as { sessionId?: string })
    ) {
      return;
    }
    const event = (payload ?? {}) as { id?: string; code?: number };
    recordIDEContextEvent({
      scope: "terminal",
      type: "terminal.exit",
      title: "Terminal process exited",
      resource: event.id,
      metadata: { exitCode: event.code ?? null },
    });
  });

  registerRuntimeEvent(cleanups, "terminal:mode", (payload) => {
    if (
      payload &&
      typeof payload === "object" &&
      !terminalEventMatchesCurrentSession(payload as { sessionId?: string })
    ) {
      return;
    }
    const event = (payload ?? {}) as {
      id?: string;
      mode?: string;
      active?: boolean;
      reason?: string;
      confidence?: number;
    };
    recordIDEContextEvent({
      scope: "terminal",
      type: "terminal.mode",
      title: "Terminal mode changed",
      resource: event.id,
      metadata: {
        mode: event.mode ?? "",
        active: event.active ?? false,
        reason: event.reason ?? "",
        confidence: event.confidence ?? null,
      },
    });
  });

  registerRuntimeEvent(cleanups, "terminal:shell", (payload) => {
    if (
      payload &&
      typeof payload === "object" &&
      !terminalEventMatchesCurrentSession(payload as { sessionId?: string })
    ) {
      return;
    }
    const event = (payload ?? {}) as {
      id?: string;
      type?: string;
      cwd?: string;
      exitCode?: number;
    };
    recordIDEContextEvent({
      scope: "terminal",
      type: `terminal.shell.${event.type || "event"}`,
      title: "Terminal shell event",
      path: event.cwd,
      resource: event.id,
      metadata: { exitCode: event.exitCode ?? null },
    });
  });

  registerRuntimeEvent(cleanups, "terminal:semantic", (payload) => {
    if (
      payload &&
      typeof payload === "object" &&
      !terminalEventMatchesCurrentSession(payload as { sessionId?: string })
    ) {
      return;
    }
    const event = (payload ?? {}) as {
      id?: string;
      kind?: string;
      path?: string;
      line?: number;
      column?: number;
      severity?: string;
      message?: string;
    };
    recordIDEContextEvent({
      scope: "terminal",
      type: `terminal.semantic.${event.kind || "event"}`,
      title: "Terminal semantic event",
      detail: event.message,
      path: event.path,
      resource: event.id,
      metadata: {
        line: event.line ?? null,
        column: event.column ?? null,
        severity: event.severity ?? "",
      },
    });
  });

  registerRuntimeEvent(cleanups, "lsp:diagnostics", (payload) => {
    const event = (payload ?? {}) as {
      filePath?: string;
      uri?: string;
      language?: string;
      items?: unknown[];
    };
    recordIDEContextEvent({
      scope: "diagnostics",
      type: "diagnostics.updated",
      title: "Diagnostics updated",
      path: event.filePath || event.uri,
      metadata: {
        language: event.language ?? "",
        count: Array.isArray(event.items) ? event.items.length : 0,
      },
    });
  });

  registerRuntimeEvent(cleanups, "lsp:diagnostics:status", (payload) => {
    const event = (payload ?? {}) as {
      filePath?: string;
      language?: string;
      state?: string;
      message?: string;
    };
    recordIDEContextEvent({
      scope: "diagnostics",
      type: "diagnostics.status",
      title: "Diagnostics runtime status changed",
      detail: event.message,
      path: event.filePath,
      metadata: {
        language: event.language ?? "",
        state: event.state ?? "",
      },
    });
  });

  registerRuntimeEvent(cleanups, "indexer:started", () => {
    resetIndexerProgressLedgerMilestone();
    recordIDEContextEvent({
      scope: "indexer",
      type: "indexer.started",
      title: "Indexer started",
    });
  });

  registerRuntimeEvent(cleanups, "indexer:progress", (payload) => {
    const milestone = nextIndexerProgressLedgerMilestone(payload);
    if (!milestone) {
      return;
    }
    recordIDEContextEvent({
      scope: "indexer",
      type: "indexer.progress",
      title: "Indexer progress milestone",
      metadata: {
        current: milestone.current,
        total: milestone.total,
        percent: milestone.percent,
      },
    });
  });

  registerRuntimeEvent(cleanups, "indexer:completed", () => {
    resetIndexerProgressLedgerMilestone();
    recordIDEContextEvent({
      scope: "indexer",
      type: "indexer.completed",
      title: "Indexer completed",
    });
  });

  registerRuntimeEvent(cleanups, "indexer:error", (payload) => {
    const event = (payload ?? {}) as { error?: string; terminal?: boolean };
    if (event.terminal) {
      resetIndexerProgressLedgerMilestone();
    } else {
      const now = Date.now();
      if (
        now - lastIndexerFileErrorLedgerAt <
        INDEXER_FILE_ERROR_LEDGER_MIN_MS
      ) {
        return;
      }
      lastIndexerFileErrorLedgerAt = now;
    }
    recordIDEContextEvent({
      scope: "indexer",
      type: event.terminal ? "indexer.failed" : "indexer.file-error",
      title: event.terminal ? "Indexer failed" : "Indexer file error",
      detail: event.error,
      metadata: {
        terminal: event.terminal ?? false,
      },
    });
  });

  registerRuntimeEvent(cleanups, "ide:git:status", () => {
    recordIDEContextEvent({
      scope: "git",
      type: "git.status.requested",
      title: "Git status requested",
    });
  });

  registerRuntimeEvent(cleanups, "mcp:approval:request", () => {
    recordIDEContextEvent({
      scope: "mcp",
      type: "mcp.approval.requested",
      title: "MCP approval requested",
    });
  });

  const registerIDECommandEvent = (
    eventName: string,
    scope: IDEContextEventScope,
    type: string,
    title: string,
  ) => {
    registerRuntimeEvent(cleanups, eventName, (payload) => {
      recordIDEContextEvent({
        scope,
        type,
        title,
        path: pathFromPayload(payload),
        resource:
          payload && typeof payload === "object"
            ? String(
                (payload as Record<string, unknown>).panel ??
                  (payload as Record<string, unknown>).surface ??
                  (payload as Record<string, unknown>).id ??
                  "",
              )
            : "",
      });
    });
  };

  registerIDECommandEvent(
    "ide:panel:open",
    "surface",
    "panel.open_requested",
    "Panel open requested",
  );
  registerIDECommandEvent(
    "ide:panel:close",
    "surface",
    "panel.close_requested",
    "Panel close requested",
  );
  registerIDECommandEvent(
    "ide:panel:move",
    "surface",
    "panel.move_requested",
    "Panel move requested",
  );
  registerIDECommandEvent(
    "ide:surface:promote",
    "surface",
    "surface.promote_requested",
    "Surface promotion requested",
  );
  registerIDECommandEvent(
    "ide:tui:enter",
    "terminal",
    "tui.enter_requested",
    "TUI mode enter requested",
  );
  registerIDECommandEvent(
    "ide:tui:exit",
    "terminal",
    "tui.exit_requested",
    "TUI mode exit requested",
  );
  registerIDECommandEvent(
    "ide:tui:assist:open",
    "terminal",
    "tui.assist_open_requested",
    "TUI assist panel open requested",
  );
  registerIDECommandEvent(
    "ide:tui:assist:close",
    "terminal",
    "tui.assist_close_requested",
    "TUI assist panel close requested",
  );
  registerIDECommandEvent(
    "ide:tui:assist:swap",
    "terminal",
    "tui.assist_swap_requested",
    "TUI assist swap requested",
  );
  registerIDECommandEvent(
    "ide:editor:open",
    "editor",
    "command.open_requested",
    "Editor open requested",
  );
  registerIDECommandEvent(
    "ide:editor:split",
    "editor",
    "command.split_requested",
    "Editor split requested",
  );
  registerIDECommandEvent(
    "ide:editor:close",
    "editor",
    "command.close_requested",
    "Editor close requested",
  );
  registerIDECommandEvent(
    "ide:editor:format",
    "editor",
    "command.format_requested",
    "Editor format requested",
  );
  registerIDECommandEvent(
    "ide:editor:goto",
    "editor",
    "command.goto_requested",
    "Editor goto requested",
  );
  registerIDECommandEvent(
    "ide:editor:toggle",
    "editor",
    "command.toggle_requested",
    "Editor toggle requested",
  );
  registerIDECommandEvent(
    "ide:file:new",
    "filesystem",
    "file.new_requested",
    "New file requested",
  );
  registerIDECommandEvent(
    "ide:file:save",
    "filesystem",
    "file.save_requested",
    "File save requested",
  );
  registerIDECommandEvent(
    "ide:file:saveAll",
    "filesystem",
    "file.save_all_requested",
    "File save all requested",
  );
  registerIDECommandEvent(
    "ide:view:zoom",
    "runtime",
    "view.zoom_requested",
    "View zoom requested",
  );
  registerIDECommandEvent(
    "ide:app:settings",
    "runtime",
    "app.settings_requested",
    "App settings requested",
  );
  registerIDECommandEvent(
    "ide:app:run",
    "runtime",
    "app.run_requested",
    "App run requested",
  );
  registerIDECommandEvent(
    "ide:app:keybindings",
    "runtime",
    "app.keybindings_requested",
    "App keybindings requested",
  );
  registerIDECommandEvent(
    "ide:app:reload",
    "runtime",
    "app.reload_requested",
    "App reload requested",
  );
  registerIDECommandEvent(
    "ide:git:commit",
    "git",
    "git.commit_requested",
    "Git commit requested",
  );
  registerIDECommandEvent(
    "ide:git:push",
    "git",
    "git.push_requested",
    "Git push requested",
  );
  registerIDECommandEvent(
    "ide:git:pull",
    "git",
    "git.pull_requested",
    "Git pull requested",
  );

  cleanups.push(
    subscribeSurfaceRuntimeEvents(() => {
      const event = getSurfaceRuntimeEventHistory().at(-1);
      if (!event) {
        return;
      }
      recordSurfaceEvent(event);
    }),
  );

  ledgerRuntimeCleanup = () => {
    cleanups.forEach((cleanup) => cleanup());
    ledgerRuntimeCleanup = null;
  };
  return ledgerRuntimeCleanup;
};

const recordSurfaceEvent = (event: SurfaceRuntimeEvent) => {
  recordIDEContextEvent({
    scope: "surface",
    type: event.type,
    title: "Surface runtime event",
    resource: event.surfaceId,
    metadata: {
      hostMode: event.hostMode ?? event.session?.hostMode ?? "",
      appletKind: event.session?.appletKind ?? "",
      ok: event.ok,
      reason: event.reason ?? "",
    },
    at: event.at,
  });
};

const formatMetadata = (metadata: IDEContextEvent["metadata"]): string => {
  const pairs = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);
  return pairs.length > 0 ? ` ${pairs.join(" ")}` : "";
};

export const formatIDEContextEventLine = (event: IDEContextEvent): string => {
  const target = event.path || event.resource || event.projectPath || "";
  const targetPart = target ? ` target=${target}` : "";
  const detailPart = event.detail ? ` detail=${event.detail}` : "";
  return `#${event.sequence} ${event.scope}.${event.type}${targetPart}${detailPart}${formatMetadata(event.metadata)}`;
};
