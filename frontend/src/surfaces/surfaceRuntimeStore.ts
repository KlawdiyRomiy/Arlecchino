import { useEffect, useMemo, useSyncExternalStore } from "react";

import type {
  PanelConfigs,
  PanelId,
  PanelVisibility,
} from "../components/layout/MainLayout.types";
import type { PreviewWindow } from "../stores/previewWindowStore";
import { buildSurfaceSessions, type SurfaceSession } from "./surfaceRuntime";

export interface SurfaceRuntimeSnapshot {
  sessions: readonly SurfaceSession[];
  byId: Readonly<Record<string, SurfaceSession>>;
  activeSurfaceId: string | null;
  revision: number;
}

export interface SurfaceRuntimeHostState {
  panels: PanelVisibility;
  panelConfigs: PanelConfigs;
  previewWindows: PreviewWindow[];
  activePreviewWindowId: string | null;
  activePanelId?: PanelId | null;
}

const listeners = new Set<() => void>();

let snapshotFingerprint = "";
let snapshot: SurfaceRuntimeSnapshot = {
  sessions: [],
  byId: {},
  activeSurfaceId: null,
  revision: 0,
};

const cloneSurfaceSession = (session: SurfaceSession): SurfaceSession => ({
  ...session,
  geometry: session.geometry ? { ...session.geometry } : undefined,
  payload: session.payload ? { ...session.payload } : undefined,
});

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
    clonedSessions.find((session) => session.active)?.id ?? null;

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

export const subscribeSurfaceRuntime = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const syncSurfaceRuntimeFromHost = (
  sessions: readonly SurfaceSession[],
): SurfaceRuntimeSnapshot => {
  const nextFingerprint = buildFingerprint(sessions);
  if (nextFingerprint === snapshotFingerprint) {
    return snapshot;
  }

  snapshotFingerprint = nextFingerprint;
  snapshot = buildSnapshot(sessions);
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
