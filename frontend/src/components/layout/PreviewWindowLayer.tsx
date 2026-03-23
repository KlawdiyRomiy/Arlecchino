import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Code,
  Globe,
  GitBranch,
  Sparkles,
  Terminal,
  Palette,
} from "lucide-react";

import { getThemeColors, zIndex } from "../../styles/colors";
import type { Theme } from "../../types/theme";
import {
  type AppearancePreviewState,
  type PreviewWindow,
  type PreviewWindowPosition,
  type UpdatePreviewWindowInput,
} from "../../stores/previewWindowStore";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PreviewWindowSurface } from "../PreviewWindowSurface";
import { emitPerfMetric, nowPerf } from "../../utils/perf";

interface PreviewWindowLayerProps {
  isDark: boolean;
  windows: PreviewWindow[];
  appearancePreview: AppearancePreviewState | null;
  currentTheme: Theme;
  currentUiScale: number;
  onUpdateWindow: (id: string, input: UpdatePreviewWindowInput) => boolean;
  onCloseWindow: (id: string) => void;
  onFocusWindow: (id: string) => void;
  onPinWindow: (id: string, pinned: boolean) => void;
  onAppearancePatch: (patch: { theme?: Theme; uiScale?: number }) => void;
  onAppearanceApply: () => void;
  onAppearanceCancel: () => void;
  onFileOpen?: (
    path: string,
    content: string,
    name: string,
    line?: number,
  ) => void;
}

const getWindowIcon = (surface: PreviewWindow["surface"]) => {
  switch (surface) {
    case "file":
      return <Code size={16} />;
    case "browser":
      return <Globe size={16} />;
    case "git":
      return <GitBranch size={16} />;
    case "chat":
      return <Sparkles size={16} />;
    case "terminal":
      return <Terminal size={16} />;
    case "appearance":
      return <Palette size={16} />;
    default:
      return <Code size={16} />;
  }
};

const normalizeSnappedSize = (
  position: PreviewWindowPosition,
  windowState: PreviewWindow,
): { width: number; height: number } => {
  if (position === "left" || position === "right") {
    const width = windowState.width > 0 ? windowState.width : 380;
    return { width, height: 0 };
  }

  const height = windowState.height > 0 ? windowState.height : 260;
  return { width: 0, height };
};

export const PreviewWindowLayer: React.FC<PreviewWindowLayerProps> = ({
  isDark,
  windows,
  appearancePreview,
  currentTheme,
  currentUiScale,
  onUpdateWindow,
  onCloseWindow,
  onFocusWindow,
  onPinWindow,
  onAppearancePatch,
  onAppearanceApply,
  onAppearanceCancel,
  onFileOpen,
}) => {
  const palette = getThemeColors(isDark);
  const resizeFrameIdByWindowRef = useRef<Map<string, number>>(new Map());
  const pendingResizeByWindowRef = useRef<
    Map<string, Pick<UpdatePreviewWindowInput, "width" | "height" | "x" | "y">>
  >(new Map());
  const lastAppliedResizeByWindowRef = useRef<Map<string, string>>(new Map());

  const layerStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "absolute",
      inset: 0,
      zIndex: zIndex.dropdown,
      pointerEvents: "none",
      contain: "layout style",
    }),
    [],
  );

  const flushResizeUpdate = useCallback(
    (windowId: string) => {
      const pendingUpdate = pendingResizeByWindowRef.current.get(windowId);
      if (!pendingUpdate) {
        return;
      }

      pendingResizeByWindowRef.current.delete(windowId);

      const resizeFingerprint = `${pendingUpdate.width}:${pendingUpdate.height}:${pendingUpdate.x ?? "na"}:${pendingUpdate.y ?? "na"}`;
      if (
        lastAppliedResizeByWindowRef.current.get(windowId) === resizeFingerprint
      ) {
        return;
      }

      const startedAt = nowPerf();
      const updated = onUpdateWindow(windowId, pendingUpdate);
      const durationMs = nowPerf() - startedAt;

      if (updated) {
        lastAppliedResizeByWindowRef.current.set(windowId, resizeFingerprint);
      } else {
        lastAppliedResizeByWindowRef.current.delete(windowId);
      }

      emitPerfMetric({
        scope: "preview",
        name: "window.resize.apply",
        durationMs,
        details: {
          windowId,
          updated,
        },
      });
    },
    [onUpdateWindow],
  );

  const cleanupWindowResizeState = useCallback((windowId: string) => {
    const queuedFrameId = resizeFrameIdByWindowRef.current.get(windowId);
    if (typeof queuedFrameId === "number") {
      window.cancelAnimationFrame(queuedFrameId);
      resizeFrameIdByWindowRef.current.delete(windowId);
    }

    pendingResizeByWindowRef.current.delete(windowId);
    lastAppliedResizeByWindowRef.current.delete(windowId);
  }, []);

  const scheduleResizeUpdate = useCallback(
    (
      windowId: string,
      update: Pick<UpdatePreviewWindowInput, "width" | "height" | "x" | "y">,
    ) => {
      pendingResizeByWindowRef.current.set(windowId, update);

      if (resizeFrameIdByWindowRef.current.has(windowId)) {
        return;
      }

      const frameId = window.requestAnimationFrame(() => {
        resizeFrameIdByWindowRef.current.delete(windowId);
        flushResizeUpdate(windowId);
      });

      resizeFrameIdByWindowRef.current.set(windowId, frameId);
    },
    [flushResizeUpdate],
  );

  useEffect(
    () => () => {
      resizeFrameIdByWindowRef.current.forEach((frameId) => {
        window.cancelAnimationFrame(frameId);
      });
      resizeFrameIdByWindowRef.current.clear();
      pendingResizeByWindowRef.current.clear();
      lastAppliedResizeByWindowRef.current.clear();
    },
    [],
  );

  const sortedWindows = useMemo(
    () => windows.slice().sort((left, right) => left.zIndex - right.zIndex),
    [windows],
  );

  const getAdjacentPanels = (windowId: string) => {
    const adjacent: {
      left?: number;
      right?: number;
      bottom?: number;
      top?: number;
    } = {};

    sortedWindows.forEach((windowState) => {
      if (windowState.id === windowId || windowState.mode !== "snapped") {
        return;
      }

      if (windowState.position === "left") {
        adjacent.left = Math.max(adjacent.left ?? 0, windowState.width);
      }
      if (windowState.position === "right") {
        adjacent.right = Math.max(adjacent.right ?? 0, windowState.width);
      }
      if (windowState.position === "bottom") {
        adjacent.bottom = Math.max(adjacent.bottom ?? 0, windowState.height);
      }
      if (windowState.position === "top") {
        adjacent.top = Math.max(adjacent.top ?? 0, windowState.height);
      }
    });

    return adjacent;
  };

  if (sortedWindows.length === 0) {
    return null;
  }

  return (
    <div style={layerStyle} data-testid="preview-window-layer">
      {sortedWindows.map((windowState) => (
        <div key={windowState.id} style={{ pointerEvents: "auto" }}>
          <FloatingPanel
            id={windowState.id}
            title={windowState.title}
            icon={getWindowIcon(windowState.surface)}
            position={windowState.position}
            mode={windowState.mode}
            size={{ width: windowState.width, height: windowState.height }}
            x={windowState.x}
            y={windowState.y}
            minSize={220}
            maxSize={1400}
            isVisible={true}
            isDropTarget={false}
            isPinned={windowState.isPinned}
            zIndex={windowState.zIndex}
            adjacentPanels={getAdjacentPanels(windowState.id)}
            onPin={() => onPinWindow(windowState.id, !windowState.isPinned)}
            onClose={() => {
              cleanupWindowResizeState(windowState.id);
              onCloseWindow(windowState.id);
            }}
            onResize={(updates) => {
              scheduleResizeUpdate(windowState.id, {
                width: updates.width,
                height: updates.height,
                x: updates.x,
                y: updates.y,
              });
            }}
            onDragStart={() => {
              onFocusWindow(windowState.id);
            }}
            onDragEnd={(_, targetPosition, dropX, dropY) => {
              if (targetPosition) {
                const normalizedSize = normalizeSnappedSize(
                  targetPosition,
                  windowState,
                );
                onUpdateWindow(windowState.id, {
                  mode: "snapped",
                  position: targetPosition,
                  width: normalizedSize.width,
                  height: normalizedSize.height,
                });
                return;
              }

              if (typeof dropX === "number" && typeof dropY === "number") {
                onUpdateWindow(windowState.id, {
                  mode: "floating",
                  x: dropX,
                  y: dropY,
                  width: windowState.width,
                  height: windowState.height,
                });
              }
            }}
          >
            <div
              style={{
                height: "100%",
                backgroundColor: palette.bgSecondary,
              }}
            >
              <PreviewWindowSurface
                window={windowState}
                appearancePreview={appearancePreview}
                currentTheme={currentTheme}
                currentUiScale={currentUiScale}
                onAppearancePatch={onAppearancePatch}
                onAppearanceApply={onAppearanceApply}
                onAppearanceCancel={onAppearanceCancel}
                onFileOpen={onFileOpen}
              />
            </div>
          </FloatingPanel>
        </div>
      ))}
    </div>
  );
};
