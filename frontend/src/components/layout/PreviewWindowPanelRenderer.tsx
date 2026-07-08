import React from "react";
import { Globe } from "lucide-react";
import { PreviewWindowSurface } from "../PreviewWindowSurface";
import {
  FloatingPanel,
  type FloatingPanelProps,
  type PanelPosition,
} from "../ui/FloatingPanel";
import type {
  AppearancePreviewState,
  PreviewWindow,
} from "../../stores/previewWindowStore";
import type { Theme } from "../../types/theme";

type PreviewPanelHostMode = "overlay" | "flow";
type PreviewPanelResizeUpdates = {
  width: number;
  height: number;
  x?: number;
  y?: number;
};

interface PreviewWindowPanelRendererProps {
  windowState: PreviewWindow;
  hostMode?: PreviewPanelHostMode;
  isDropTarget: boolean;
  activeDropTargetPosition: PanelPosition | null;
  isRelocating: boolean;
  isSlotExiting?: boolean;
  adjacentPanels: FloatingPanelProps["adjacentPanels"];
  uiScale: number;
  surfaceBackgroundColor: string;
  appearancePreview: AppearancePreviewState | null;
  currentTheme: Theme;
  currentUiScale: number;
  motionPressureActive?: boolean;
  onClose: (windowId: string) => void;
  onResize: (windowId: string, updates: PreviewPanelResizeUpdates) => void;
  onResizeStart: (windowId: string) => void;
  onResizeEnd: (windowId: string) => void;
  onDragStart: NonNullable<FloatingPanelProps["onDragStart"]>;
  onDragMove: NonNullable<FloatingPanelProps["onDragMove"]>;
  onDragEnd: NonNullable<FloatingPanelProps["onDragEnd"]>;
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

export const PreviewWindowPanelRenderer: React.FC<
  PreviewWindowPanelRendererProps
> = ({
  windowState,
  hostMode = "overlay",
  isDropTarget,
  activeDropTargetPosition,
  isRelocating,
  isSlotExiting = false,
  adjacentPanels,
  uiScale,
  surfaceBackgroundColor,
  appearancePreview,
  currentTheme,
  currentUiScale,
  motionPressureActive = false,
  onClose,
  onResize,
  onResizeStart,
  onResizeEnd,
  onDragStart,
  onDragMove,
  onDragEnd,
  onAppearancePatch,
  onAppearanceApply,
  onAppearanceCancel,
  onFileOpen,
}) => (
  <FloatingPanel
    key={windowState.id}
    id={windowState.id}
    title={windowState.title}
    icon={<Globe size={16} />}
    position={windowState.position}
    mode={windowState.mode}
    hostMode={hostMode}
    size={{ width: windowState.width, height: windowState.height }}
    x={windowState.x}
    y={windowState.y}
    minSize={220}
    maxSize={1400}
    isVisible={true}
    isDropTarget={isDropTarget}
    activeDropTargetPosition={activeDropTargetPosition}
    isRelocating={isRelocating}
    isSlotExiting={isSlotExiting}
    zIndex={windowState.zIndex}
    adjacentPanels={adjacentPanels}
    uiScale={uiScale}
    motionPressureActive={motionPressureActive}
    onClose={() => onClose(windowState.id)}
    onResize={(updates) => onResize(windowState.id, updates)}
    onResizeStart={() => onResizeStart(windowState.id)}
    onResizeEnd={() => onResizeEnd(windowState.id)}
    onDragStart={onDragStart}
    onDragMove={onDragMove}
    onDragEnd={onDragEnd}
  >
    <div
      style={{
        height: "100%",
        backgroundColor: surfaceBackgroundColor,
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
);
