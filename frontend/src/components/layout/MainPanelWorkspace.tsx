import React from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { PreviewWindow } from "../../stores/previewWindowStore";
import type { PanelPosition } from "../ui/FloatingPanel";
import type { PanelId } from "./MainLayout.types";

interface MainPanelWorkspaceSlot {
  panelId: PanelId | null;
  previewWindow: PreviewWindow | null;
  size: number;
  active: boolean;
  isResizing: boolean;
}

interface MainPanelWorkspaceProps {
  panelWorkspaceRef: React.Ref<HTMLDivElement>;
  workspaceLayoutMotionEnabled: boolean;
  panelLayoutTransition: React.ComponentProps<typeof motion.div>["transition"];
  normalWorkspaceStyle: React.CSSProperties;
  centerWorkspaceStyle: React.CSSProperties;
  editorAreaStyle: React.CSSProperties;
  editorAreaTestId: string;
  editorContent: React.ReactNode;
  panelLayoutChanging: boolean;
  panelDropSettling: boolean;
  draggingPanel: PanelId | null;
  draggingPreviewWindowId: string | null;
  panelPresenceBypassPositions: PanelPosition[];
  fullscreenSnappedExitSuppression: Record<PanelPosition, boolean>;
  slots: {
    left: MainPanelWorkspaceSlot;
    right: MainPanelWorkspaceSlot;
    top: MainPanelWorkspaceSlot;
    bottom: MainPanelWorkspaceSlot;
  };
  floatingPresenceVersion: number;
  floatingPanelIds: PanelId[];
  floatingBrowserPreviewWindows: PreviewWindow[];
  zenModeEnabled: boolean;
  zenEdgeHoverSize: number;
  zenPanelHoverZIndex: number;
  zenPanelHoverPositions: PanelPosition[];
  onZenPanelEdgeEnter: (position: PanelPosition) => void;
  onZenPanelEdgeLeave: (position: PanelPosition) => void;
  onZenPanelSlotEnter: (position: PanelPosition) => void;
  onZenPanelSlotLeave: (position: PanelPosition) => void;
  renderDropZone: (position: PanelPosition) => React.ReactNode;
  renderPanel: (
    panelId: PanelId,
    hostMode?: "overlay" | "flow",
  ) => React.ReactNode;
  renderPreviewWindowPanel: (
    windowState: PreviewWindow,
    hostMode?: "overlay" | "flow",
  ) => React.ReactNode;
  getVerticalSlotStyle: (
    position: PanelPosition,
    width: number,
    isActive: boolean,
    isResizingSlot: boolean,
  ) => React.CSSProperties;
  getHorizontalSlotStyle: (
    position: PanelPosition,
    height: number,
    isActive: boolean,
    isResizingSlot: boolean,
  ) => React.CSSProperties;
  finishSnappedSlotExit: (position: PanelPosition) => void;
}

export const MainPanelWorkspace: React.FC<MainPanelWorkspaceProps> = ({
  panelWorkspaceRef,
  workspaceLayoutMotionEnabled,
  panelLayoutTransition,
  normalWorkspaceStyle,
  centerWorkspaceStyle,
  editorAreaStyle,
  editorAreaTestId,
  editorContent,
  panelLayoutChanging,
  panelDropSettling,
  draggingPanel,
  draggingPreviewWindowId,
  panelPresenceBypassPositions,
  fullscreenSnappedExitSuppression,
  slots,
  floatingPresenceVersion,
  floatingPanelIds,
  floatingBrowserPreviewWindows,
  zenModeEnabled,
  zenEdgeHoverSize,
  zenPanelHoverZIndex,
  zenPanelHoverPositions,
  onZenPanelEdgeEnter,
  onZenPanelEdgeLeave,
  onZenPanelSlotEnter,
  onZenPanelSlotLeave,
  renderDropZone,
  renderPanel,
  renderPreviewWindowPanel,
  getVerticalSlotStyle,
  getHorizontalSlotStyle,
  finishSnappedSlotExit,
}) => {
  const isDraggingPanelOrPreview =
    draggingPanel !== null || draggingPreviewWindowId !== null;

  const renderSnappedSlotContent = (
    panelId: PanelId | null,
    previewWindow: PreviewWindow | null,
  ) =>
    panelId
      ? renderPanel(panelId, "flow")
      : previewWindow
        ? renderPreviewWindowPanel(previewWindow, "flow")
        : null;

  const renderSnappedSlotPresence = (
    position: PanelPosition,
    panelId: PanelId | null,
    previewWindow: PreviewWindow | null,
  ) => {
    const content = renderSnappedSlotContent(panelId, previewWindow);

    if (panelPresenceBypassPositions.includes(position)) {
      return content;
    }

    return (
      <AnimatePresence
        initial={false}
        onExitComplete={() => finishSnappedSlotExit(position)}
      >
        {content}
      </AnimatePresence>
    );
  };

  const renderZenHoverSentinel = (position: PanelPosition) => {
    if (!zenModeEnabled || !zenPanelHoverPositions.includes(position)) {
      return null;
    }

    const baseStyle: React.CSSProperties = {
      position: "fixed",
      zIndex: zenPanelHoverZIndex,
      pointerEvents: "auto",
      background: "transparent",
    };
    const edgeSize = zenEdgeHoverSize;
    const style: React.CSSProperties =
      position === "left"
        ? { ...baseStyle, left: 0, top: 0, bottom: 0, width: edgeSize }
        : position === "right"
          ? { ...baseStyle, right: 0, top: 0, bottom: 0, width: edgeSize }
          : position === "top"
            ? { ...baseStyle, left: 0, right: 0, top: 0, height: edgeSize }
            : { ...baseStyle, left: 0, right: 0, bottom: 0, height: edgeSize };

    return (
      <div
        key={`zen-hover-${position}`}
        data-testid={`zen-panel-hover-${position}`}
        style={style}
        onMouseEnter={() => onZenPanelEdgeEnter(position)}
        onMouseMove={() => onZenPanelEdgeEnter(position)}
        onMouseLeave={() => onZenPanelEdgeLeave(position)}
      />
    );
  };

  return (
    <LayoutGroup id="main-floating-panels">
      <motion.div
        ref={panelWorkspaceRef}
        layout={workspaceLayoutMotionEnabled}
        transition={panelLayoutTransition}
        style={normalWorkspaceStyle}
        data-testid="panel-workspace"
        data-panel-drop-settling={panelDropSettling ? "true" : "false"}
      >
        {(["top", "bottom", "left", "right"] as const).map(
          renderZenHoverSentinel,
        )}

        {isDraggingPanelOrPreview && (
          <>
            {renderDropZone("top")}
            {renderDropZone("bottom")}
            {renderDropZone("left")}
            {renderDropZone("right")}
          </>
        )}

        <motion.div
          layout={workspaceLayoutMotionEnabled}
          transition={panelLayoutTransition}
          style={getVerticalSlotStyle(
            "left",
            slots.left.size,
            slots.left.active,
            slots.left.isResizing,
          )}
          onMouseEnter={
            zenModeEnabled ? () => onZenPanelSlotEnter("left") : undefined
          }
          onMouseLeave={
            zenModeEnabled ? () => onZenPanelSlotLeave("left") : undefined
          }
        >
          {fullscreenSnappedExitSuppression.left
            ? null
            : renderSnappedSlotPresence(
                "left",
                slots.left.panelId,
                slots.left.previewWindow,
              )}
        </motion.div>

        <motion.div
          layout={workspaceLayoutMotionEnabled}
          transition={panelLayoutTransition}
          style={centerWorkspaceStyle}
        >
          <motion.div
            layout={workspaceLayoutMotionEnabled}
            transition={panelLayoutTransition}
            style={getHorizontalSlotStyle(
              "top",
              slots.top.size,
              slots.top.active,
              slots.top.isResizing,
            )}
            onMouseEnter={
              zenModeEnabled ? () => onZenPanelSlotEnter("top") : undefined
            }
            onMouseLeave={
              zenModeEnabled ? () => onZenPanelSlotLeave("top") : undefined
            }
          >
            {fullscreenSnappedExitSuppression.top
              ? null
              : renderSnappedSlotPresence(
                  "top",
                  slots.top.panelId,
                  slots.top.previewWindow,
                )}
          </motion.div>

          <div
            style={editorAreaStyle}
            data-testid={editorAreaTestId}
            data-panel-layout-changing={panelLayoutChanging ? "true" : "false"}
          >
            {editorContent}
          </div>

          <motion.div
            layout={workspaceLayoutMotionEnabled}
            transition={panelLayoutTransition}
            style={getHorizontalSlotStyle(
              "bottom",
              slots.bottom.size,
              slots.bottom.active,
              slots.bottom.isResizing,
            )}
            onMouseEnter={
              zenModeEnabled ? () => onZenPanelSlotEnter("bottom") : undefined
            }
            onMouseLeave={
              zenModeEnabled ? () => onZenPanelSlotLeave("bottom") : undefined
            }
          >
            {fullscreenSnappedExitSuppression.bottom
              ? null
              : renderSnappedSlotPresence(
                  "bottom",
                  slots.bottom.panelId,
                  slots.bottom.previewWindow,
                )}
          </motion.div>
        </motion.div>

        <motion.div
          layout={workspaceLayoutMotionEnabled}
          transition={panelLayoutTransition}
          style={getVerticalSlotStyle(
            "right",
            slots.right.size,
            slots.right.active,
            slots.right.isResizing,
          )}
          onMouseEnter={
            zenModeEnabled ? () => onZenPanelSlotEnter("right") : undefined
          }
          onMouseLeave={
            zenModeEnabled ? () => onZenPanelSlotLeave("right") : undefined
          }
        >
          {fullscreenSnappedExitSuppression.right
            ? null
            : renderSnappedSlotPresence(
                "right",
                slots.right.panelId,
                slots.right.previewWindow,
              )}
        </motion.div>

        <AnimatePresence key={floatingPresenceVersion} initial={false}>
          {floatingPanelIds.map((panelId) => renderPanel(panelId))}
          {floatingBrowserPreviewWindows.map((windowState) =>
            renderPreviewWindowPanel(windowState),
          )}
        </AnimatePresence>
      </motion.div>
    </LayoutGroup>
  );
};
