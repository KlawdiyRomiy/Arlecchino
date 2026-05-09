import React from "react";
import { createPortal } from "react-dom";

export interface DragGhostState {
  x: number;
  y: number;
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  variant?: "default" | "icon";
}

interface DragGhostProps {
  ghost: DragGhostState | null;
}

export const DragGhost: React.FC<DragGhostProps> = ({ ghost }) => {
  if (!ghost || typeof document === "undefined") {
    return null;
  }

  const iconVariant = ghost.variant === "icon";

  return createPortal(
    <div
      className={`arle-drag-ghost ${iconVariant ? "arle-drag-ghost-icon" : ""}`}
      style={{
        left: iconVariant ? ghost.x : ghost.x + 14,
        top: iconVariant ? ghost.y : ghost.y + 14,
        transform: iconVariant
          ? "translate3d(-50%, -50%, 0)"
          : "translate3d(0, 0, 0)",
      }}
    >
      {iconVariant && ghost.icon ? (
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
