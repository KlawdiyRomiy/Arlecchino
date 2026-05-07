import React from "react";
import { createPortal } from "react-dom";

export interface DragGhostState {
  x: number;
  y: number;
  label: string;
  detail?: string;
}

interface DragGhostProps {
  ghost: DragGhostState | null;
}

export const DragGhost: React.FC<DragGhostProps> = ({ ghost }) => {
  if (!ghost || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="arle-drag-ghost"
      style={{
        left: ghost.x + 14,
        top: ghost.y + 14,
      }}
    >
      <span className="arle-drag-ghost-label">{ghost.label}</span>
      {ghost.detail && (
        <span className="arle-drag-ghost-detail">{ghost.detail}</span>
      )}
    </div>,
    document.body,
  );
};
