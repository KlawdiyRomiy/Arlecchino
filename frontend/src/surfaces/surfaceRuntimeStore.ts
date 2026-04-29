import { useEffect, useMemo, useSyncExternalStore } from "react";

import type {
  PanelConfigs,
  PanelId,
  PanelVisibility,
} from "../components/layout/MainLayout.types";
import type { PreviewWindow } from "../stores/previewWindowStore";
import {
  buildSurfaceSessions,
  type SurfaceAppletKind,
  type SurfaceHostMode,
  type SurfaceSession,
  type SurfaceSource,
} from "./surfaceRuntime";
import {
  createSurfaceRuntimeEvent,
  dedupeSurfaceRuntimeEvents,
  type CreateSurfaceRuntimeEventInput,
  type SurfaceRuntimeEvent,
} from "./surfaceRuntimeEvents";

export interface SurfaceRuntimeSnapshot {
  sessions: readonly SurfaceSession[];
  byId: Readonly<Record<string, SurfaceSession>>;
  activeSurfaceId: string | null;
  revision: number;
}

export interface SurfaceRuntimeFocusEntry {
  surfaceId: string;
  at: number;
  reason: "host-sync" | "runtime-event";
}

export interface SurfaceRuntimeFocusState {
  activeSurfaceId: string | null;
  activeSurface?: SurfaceSession;
  previousSurfaceId: string | null;
  history: readonly SurfaceRuntimeFocusEntry[];
}

export interface SurfaceRuntimeReadOptions {
  eventLimit?: number;
  includeEvents?: boolean;
}

export interface SurfaceRuntimeReadModel {
  revision: number;
  activeSurfaceId: string | null;
  activeSurface?: SurfaceSession;
  openSurfaceCount: number;
  sessionIds: readonly string[];
  sessions: readonly SurfaceSession[];
  byId: Readonly<Record<string, SurfaceSession>>;
  sessionsBySource: Readonly<Record<SurfaceSource, readonly string[]>>;
  sessionsByHostMode: Readonly<
    Partial<Record<SurfaceHostMode, readonly string[]>>
  >;
  sessionsByAppletKind: Readonly<
    Partial<Record<SurfaceAppletKind, readonly string[]>>
  >;
  focus: SurfaceRuntimeFocusState;
  events: readonly SurfaceRuntimeEvent[];
  eventCursor: number | null;
}

export interface SurfaceRuntimeHostState {
  panels: PanelVisibility;
  panelConfigs: PanelConfigs;
  previewWindows: PreviewWindow[];
  activePreviewWindowId: string | null;
  activePanelId?: PanelId | null;
}

const listeners = new Set<() => void>();
const eventListeners = new Set<() => void>();
const MAX_SURFACE_RUNTIME_EVENTS = 100;
const MAX_SURFACE_RUNTIME_FOCUS_ENTRIES = 50;

let snapshotFingerprint = "";
let snapshot: SurfaceRuntimeSnapshot = {
  sessions: [],
  byId: {},
  activeSurfaceId: null,
  revision: 0,
};
let hasSyncedSurfaceRuntimeHost = false;
let lastSurfaceRuntimeEventAt = 0;
let eventHistory: readonly SurfaceRuntimeEvent[] = [];
let focusHistory: readonly SurfaceRuntimeFocusEntry[] = [];

const cloneSurfaceSession = (session: SurfaceSession): SurfaceSession => ({
  ...session,
  geometry: session.geometry ? { ...session.geometry } : undefined,
  payload: session.payload ? { ...session.payload } : undefined,
});

const cloneSurfaceRuntimeEvent = (
  event: SurfaceRuntimeEvent,
): SurfaceRuntimeEvent => ({
  ...event,
  session: event.session ? cloneSurfaceSession(event.session) : undefined,
  geometry: event.geometry ? { ...event.geometry } : undefined,
});

const cloneSurfaceRuntimeFocusEntry = (
  entry: SurfaceRuntimeFocusEntry,
): SurfaceRuntimeFocusEntry => ({ ...entry });

const buildSnapshot = (
  sessions: readonly SurfaceSession[],
): SurfaceRuntimeSnapshot => {
  const clonedSessions = sessions.map(cloneSurfaceSession);
  const byId = clonedSessions.reduce<Record<string, SurfaceSession>>(
    (accumulator, session) => {
      accumulator[session.id] = session;
      return accumulator;
    },
    {},
  );
  const activeSurfaceId =
    clonedSessions.filter((session) => session.active).at(-1)?.id ?? null;

  return {
    sessions: clonedSessions,
    byId,
    activeSurfaceId,
    revision: snapshot.revision + 1,
  };
};

const buildFingerprint = (sessions: readonly SurfaceSession[]): string =>
  JSON.stringify(
    sessions.map((session) => ({
      id: session.id,
      source: session.source,
      appletKind: session.appletKind,
      hostMode: session.hostMode,
      title: session.title,
      active: session.active,
      pinned: session.pinned,
      panelId: session.panelId,
      previewWindowId: session.previewWindowId,
      nativeWindowId: session.nativeWindowId,
      ownerProjectId: session.ownerProjectId,
      focusPolicy: session.focusPolicy,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      geometry: session.geometry,
      payload: session.payload,
    })),
  );

export const getSurfaceRuntimeSnapshot = (): SurfaceRuntimeSnapshot => snapshot;

export const getSurfaceRuntimeEventHistory = (): SurfaceRuntimeEvent[] =>
  eventHistory.map(cloneSurfaceRuntimeEvent);

export const getSurfaceRuntimeFocusState = (): SurfaceRuntimeFocusState => {
  const history = focusHistory.map(cloneSurfaceRuntimeFocusEntry);
  const previousSurfaceId = history.at(-2)?.surfaceId ?? null;
  const activeSurface = snapshot.activeSurfaceId
    ? snapshot.byId[snapshot.activeSurfaceId]
    : undefined;

  return {
    activeSurfaceId: snapshot.activeSurfaceId,
    activeSurface: activeSurface
      ? cloneSurfaceSession(activeSurface)
      : undefined,
    previousSurfaceId,
    history,
  };
};

const boundedEventLimit = (limit: number | undefined): number => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 25;
  }
  return Math.min(Math.max(Math.trunc(limit), 0), MAX_SURFACE_RUNTIME_EVENTS);
};

const indexSessionIds = <Key extends string>(
  sessions: readonly SurfaceSession[],
  getKey: (session: SurfaceSession) => Key | undefined,
): Partial<Record<Key, string[]>> =>
  sessions.reduce<Partial<Record<Key, string[]>>>((accumulator, session) => {
    const key = getKey(session);
    if (!key) {
      return accumulator;
    }
    accumulator[key] = [...(accumulator[key] ?? []), session.id];
    return accumulator;
  }, {});

export const getSurfaceRuntimeReadModel = (
  options: SurfaceRuntimeReadOptions = {},
): SurfaceRuntimeReadModel => {
  const includeEvents = options.includeEvents ?? true;
  const eventLimit = boundedEventLimit(options.eventLimit);
  const sessions = snapshot.sessions.map(cloneSurfaceSession);
  const byId = sessions.reduce<Record<string, SurfaceSession>>(
    (accumulator, session) => {
      accumulator[session.id] = cloneSurfaceSession(session);
      return accumulator;
    },
    {},
  );
  const activeSurface = snapshot.activeSurfaceId
    ? snapshot.byId[snapshot.activeSurfaceId]
    : undefined;
  const sessionIds = sessions.map((session) => session.id);
  const sessionsBySource: Record<SurfaceSource, string[]> = {
    panel: [],
    preview: [],
    main: [],
  };
  sessions.forEach((session) => {
    sessionsBySource[session.source].push(session.id);
  });

  return {
    revision: snapshot.revision,
    activeSurfaceId: snapshot.activeSurfaceId,
    activeSurface: activeSurface
      ? cloneSurfaceSession(activeSurface)
      : undefined,
    openSurfaceCount: sessions.length,
    sessionIds,
    sessions,
    byId,
    sessionsBySource,
    sessionsByHostMode: indexSessionIds(
      sessions,
      (session) => session.hostMode,
    ),
    sessionsByAppletKind: indexSessionIds(
      sessions,
      (session) => session.appletKind,
    ),
    focus: getSurfaceRuntimeFocusState(),
    events: includeEvents
      ? eventHistory.slice(-eventLimit).map(cloneSurfaceRuntimeEvent)
      : [],
    eventCursor: eventHistory.at(-1)?.at ?? null,
  };
};

export const subscribeSurfaceRuntime = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const subscribeSurfaceRuntimeEvents = (
  listener: () => void,
): (() => void) => {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
};

const nextSurfaceRuntimeEventTimestamp = (): number => {
  const now = Date.now();
  lastSurfaceRuntimeEventAt = Math.max(now, lastSurfaceRuntimeEventAt + 1);
  return lastSurfaceRuntimeEventAt;
};

const recordSurfaceRuntimeFocus = (
  surfaceId: string | null,
  at: number,
  reason: SurfaceRuntimeFocusEntry["reason"],
): boolean => {
  if (!surfaceId) {
    return false;
  }

  const lastEntry = focusHistory.at(-1);
  if (lastEntry?.surfaceId === surfaceId) {
    return false;
  }

  focusHistory = [
    ...focusHistory,
    {
      surfaceId,
      at,
      reason,
    },
  ].slice(-MAX_SURFACE_RUNTIME_FOCUS_ENTRIES);
  return true;
};

export const recordSurfaceRuntimeEvent = (
  input: CreateSurfaceRuntimeEventInput,
): SurfaceRuntimeEvent => {
  const event = createSurfaceRuntimeEvent({
    ...input,
    at: input.at ?? nextSurfaceRuntimeEventTimestamp(),
  });
  eventHistory = dedupeSurfaceRuntimeEvents([
    ...eventHistory,
    cloneSurfaceRuntimeEvent(event),
  ]).slice(-MAX_SURFACE_RUNTIME_EVENTS);
  const focusChanged =
    event.type === "surface:focus" && event.ok
      ? recordSurfaceRuntimeFocus(event.surfaceId, event.at, "runtime-event")
      : false;
  eventListeners.forEach((listener) => listener());
  if (focusChanged) {
    listeners.forEach((listener) => listener());
  }
  return cloneSurfaceRuntimeEvent(event);
};

export const clearSurfaceRuntimeEventHistory = (): void => {
  eventHistory = [];
  eventListeners.forEach((listener) => listener());
};

const isGeometryChanged = (
  previous: SurfaceSession,
  next: SurfaceSession,
): boolean => {
  const comparableGeometry = (session: SurfaceSession) =>
    session.geometry
      ? {
          position: session.geometry.position,
          width: session.geometry.width,
          height: session.geometry.height,
          x: session.geometry.x,
          y: session.geometry.y,
        }
      : null;

  return (
    JSON.stringify(comparableGeometry(previous)) !==
    JSON.stringify(comparableGeometry(next))
  );
};

const isSessionStateChanged = (
  previous: SurfaceSession,
  next: SurfaceSession,
): boolean =>
  JSON.stringify({
    source: previous.source,
    appletKind: previous.appletKind,
    title: previous.title,
    pinned: previous.pinned,
    panelId: previous.panelId,
    previewWindowId: previous.previewWindowId,
    ownerProjectId: previous.ownerProjectId,
    nativeWindowId: previous.nativeWindowId,
    focusPolicy: previous.focusPolicy,
    payload: previous.payload ?? null,
  }) !==
  JSON.stringify({
    source: next.source,
    appletKind: next.appletKind,
    title: next.title,
    pinned: next.pinned,
    panelId: next.panelId,
    previewWindowId: next.previewWindowId,
    ownerProjectId: next.ownerProjectId,
    nativeWindowId: next.nativeWindowId,
    focusPolicy: next.focusPolicy,
    payload: next.payload ?? null,
  });

const deriveSurfaceRuntimeTransitionEvents = (
  previousSessions: readonly SurfaceSession[],
  nextSessions: readonly SurfaceSession[],
): CreateSurfaceRuntimeEventInput[] => {
  const previousById = new Map(
    previousSessions.map((session) => [session.id, session]),
  );
  const nextById = new Map(
    nextSessions.map((session) => [session.id, session]),
  );
  const events: CreateSurfaceRuntimeEventInput[] = [];

  nextSessions.forEach((nextSession) => {
    const previousSession = previousById.get(nextSession.id);
    if (!previousSession) {
      events.push({
        type: "surface:open",
        surfaceId: nextSession.id,
        session: nextSession,
      });
      return;
    }

    if (previousSession.hostMode !== nextSession.hostMode) {
      events.push({
        type: "surface:promote",
        surfaceId: nextSession.id,
        session: nextSession,
        geometry: nextSession.geometry,
        hostMode: nextSession.hostMode,
      });
      return;
    }

    if (!previousSession.active && nextSession.active) {
      events.push({
        type: "surface:focus",
        surfaceId: nextSession.id,
        session: nextSession,
      });
      return;
    }

    if (isGeometryChanged(previousSession, nextSession)) {
      events.push({
        type: "surface:move",
        surfaceId: nextSession.id,
        session: nextSession,
        geometry: nextSession.geometry,
        hostMode: nextSession.hostMode,
      });
      return;
    }

    if (isSessionStateChanged(previousSession, nextSession)) {
      events.push({
        type: "surface:state",
        surfaceId: nextSession.id,
        session: nextSession,
      });
    }
  });

  previousSessions.forEach((previousSession) => {
    if (nextById.has(previousSession.id)) {
      return;
    }

    events.push({
      type: "surface:close",
      surfaceId: previousSession.id,
      session: previousSession,
    });
  });

  return events;
};

export const syncSurfaceRuntimeFromHost = (
  sessions: readonly SurfaceSession[],
): SurfaceRuntimeSnapshot => {
  const nextFingerprint = buildFingerprint(sessions);
  if (nextFingerprint === snapshotFingerprint) {
    return snapshot;
  }

  const previousSnapshot = snapshot;
  const shouldRecordTransitions = hasSyncedSurfaceRuntimeHost;

  snapshotFingerprint = nextFingerprint;
  snapshot = buildSnapshot(sessions);
  hasSyncedSurfaceRuntimeHost = true;
  if (snapshot.activeSurfaceId) {
    recordSurfaceRuntimeFocus(
      snapshot.activeSurfaceId,
      nextSurfaceRuntimeEventTimestamp(),
      "host-sync",
    );
  }

  if (shouldRecordTransitions) {
    deriveSurfaceRuntimeTransitionEvents(
      previousSnapshot.sessions,
      snapshot.sessions,
    ).forEach(recordSurfaceRuntimeEvent);
  }

  listeners.forEach((listener) => listener());
  return snapshot;
};

export function useSurfaceRuntimeSnapshot(): SurfaceRuntimeSnapshot {
  return useSyncExternalStore(
    subscribeSurfaceRuntime,
    getSurfaceRuntimeSnapshot,
    getSurfaceRuntimeSnapshot,
  );
}

export function useSurfaceRuntimeHostSync({
  panels,
  panelConfigs,
  previewWindows,
  activePreviewWindowId,
  activePanelId = null,
}: SurfaceRuntimeHostState): void {
  const surfaceSessions = useMemo(
    () =>
      buildSurfaceSessions({
        panels,
        panelConfigs,
        previewWindows,
        activePreviewWindowId,
        activePanelId,
      }),
    [
      activePanelId,
      activePreviewWindowId,
      panelConfigs,
      panels,
      previewWindows,
    ],
  );

  useEffect(() => {
    syncSurfaceRuntimeFromHost(surfaceSessions);
  }, [surfaceSessions]);
}
