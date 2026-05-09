import React from "react";
import { createPortal } from "react-dom";

export interface DragGhostState {
  x: number;
  y: number;
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  variant?: "default" | "icon" | "layout";
  layout?:
    | "editor-tab"
    | "code-panel-tab"
    | "file-explorer-node"
    | "topbar-project-chip";
  content?: React.ReactNode;
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
}

interface DragGhostProps {
  ghost: DragGhostState | null;
}

export const DragGhost: React.FC<DragGhostProps> = ({ ghost }) => {
  if (!ghost || typeof document === "undefined") {
    return null;
  }

  const iconVariant = ghost.variant === "icon";
  const layoutVariant =
    ghost.variant === "layout" && Boolean(ghost.layout && ghost.content);
  const layoutLeft = ghost.x - (ghost.offsetX ?? 0);
  const layoutTop = ghost.y - (ghost.offsetY ?? 0);

  return createPortal(
    <div
      className={`arle-drag-ghost ${
        iconVariant ? "arle-drag-ghost-icon" : ""
      } ${layoutVariant ? "arle-drag-ghost-layout" : ""}`}
      data-drag-ghost-layout={layoutVariant ? ghost.layout : undefined}
      data-drag-ghost-variant={
        layoutVariant ? "layout" : iconVariant ? "icon" : "default"
      }
      style={{
        left: layoutVariant ? layoutLeft : iconVariant ? ghost.x : ghost.x + 14,
        top: layoutVariant ? layoutTop : iconVariant ? ghost.y : ghost.y + 14,
        width:
          layoutVariant && ghost.width !== undefined ? ghost.width : undefined,
        height:
          layoutVariant && ghost.height !== undefined
            ? ghost.height
            : undefined,
        transform: iconVariant
          ? "translate3d(-50%, -50%, 0)"
          : "translate3d(0, 0, 0)",
      }}
    >
      {layoutVariant ? (
        ghost.content
      ) : iconVariant && ghost.icon ? (
        <span className="arle-drag-ghost-symbol" aria-label={ghost.label}>
          {ghost.icon}
        </span>
      ) : (
        <>
          <span className="arle-drag-ghost-label">{ghost.label}</span>
          {ghost.detail && (
            <span className="arle-drag-ghost-detail">{ghost.detail}</span>
          )}
        </>
      )}
    </div>,
    document.body,
  );
};
