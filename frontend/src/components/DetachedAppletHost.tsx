import React, { useMemo } from "react";

import { PreviewWindowSurface } from "./PreviewWindowSurface";
import type {
  PreviewWindow,
  PreviewSurfaceType,
} from "../stores/previewWindowStore";
import type { Theme } from "../types/theme";

interface DetachedAppletPayload {
  surfaceId?: string;
  previewWindowId?: string;
  appletKind?: string;
  title?: string;
  pinned?: boolean;
  payload?: Record<string, string | number | boolean | undefined>;
}

const hostStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "var(--bg-primary)",
};

const unsupportedStyle: React.CSSProperties = {
  margin: "auto",
  maxWidth: 420,
  padding: 20,
  color: "var(--text-secondary)",
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: "center",
};

const decodeDetachedPayload = (): DetachedAppletPayload | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const encoded = new URLSearchParams(window.location.search).get(
    "arleDetachedHost",
  );
  if (!encoded) {
    return null;
  }
  try {
    const padded = encoded.padEnd(
      encoded.length + ((4 - (encoded.length % 4)) % 4),
      "=",
    );
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const payload = JSON.parse(decoded) as DetachedAppletPayload;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
};

const toPreviewSurface = (value: string | undefined): PreviewSurfaceType => {
  switch (value) {
    case "browser":
    case "file":
    case "code":
    case "git":
    case "chat":
    case "terminal":
    case "appearance":
      return value;
    default:
      return "browser";
  }
};

const buildDetachedPreviewWindow = (
  payload: DetachedAppletPayload,
): PreviewWindow => {
  const surface = toPreviewSurface(payload.appletKind);
  const now = Date.now();
  return {
    id: payload.previewWindowId || payload.surfaceId || "detached-preview",
    title: payload.title || "Detached Preview",
    surface,
    payload: { ...(payload.payload ?? {}) },
    position: "right",
    mode: "floating",
    width: 980,
    height: 720,
    x: 0,
    y: 0,
    isPinned: Boolean(payload.pinned),
    zIndex: 1,
    createdAt: now,
    updatedAt: now,
  };
};

export const isDetachedAppletHostRoute = (): boolean =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("arleDetachedHost");

export const DetachedAppletHost: React.FC<{
  currentTheme: Theme;
  currentUiScale: number;
}> = ({ currentTheme, currentUiScale }) => {
  const payload = useMemo(() => decodeDetachedPayload(), []);
  const windowState = useMemo(
    () => (payload ? buildDetachedPreviewWindow(payload) : null),
    [payload],
  );

  if (!windowState) {
    return (
      <div style={hostStyle}>
        <div style={unsupportedStyle}>Detached applet payload is invalid.</div>
      </div>
    );
  }

  return (
    <div style={hostStyle}>
      <PreviewWindowSurface
        window={windowState}
        appearancePreview={null}
        currentTheme={currentTheme}
        currentUiScale={currentUiScale}
        onAppearancePatch={() => undefined}
        onAppearanceApply={() => undefined}
        onAppearanceCancel={() => undefined}
      />
    </div>
  );
};
