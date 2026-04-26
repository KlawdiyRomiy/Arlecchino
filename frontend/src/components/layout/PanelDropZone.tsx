import React from "react";
import { ArrowLeftRight, ArrowUpDown } from "lucide-react";
import { radius, transitions } from "../../styles/colors";
import type { PanelPosition } from "../ui/FloatingPanel";

interface PanelDropZoneProps {
  position: PanelPosition;
  isDark: boolean;
  isActive: boolean;
  isSwapTarget: boolean;
}

export const PanelDropZone: React.FC<PanelDropZoneProps> = ({
  position,
  isDark,
  isActive,
  isSwapTarget,
}) => {
  const ZoneIcon =
    position === "left" || position === "right" ? ArrowLeftRight : ArrowUpDown;
  const activeBorder = isSwapTarget
    ? "var(--accent-brand)"
    : "var(--shell-border-strong)";
  const inactiveBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)";
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: isActive
      ? isSwapTarget
        ? "linear-gradient(180deg, color-mix(in srgb, var(--accent-brand) 18%, transparent), color-mix(in srgb, var(--accent-brand) 8%, transparent))"
        : isDark
          ? "rgba(255,255,255,0.08)"
          : "rgba(0,0,0,0.06)"
      : isDark
        ? "rgba(255,255,255,0.025)"
        : "rgba(0,0,0,0.025)",
    border: `1px solid ${isActive ? activeBorder : inactiveBorder}`,
    borderRadius: radius.lg,
    boxShadow: isActive
      ? isSwapTarget
        ? "inset 0 0 0 1px var(--accent-brand), 0 0 0 1px color-mix(in srgb, var(--accent-brand) 34%, transparent), 0 18px 48px color-mix(in srgb, var(--accent-brand) 18%, transparent)"
        : "inset 0 0 0 1px var(--shell-border-strong), var(--shell-shadow)"
      : "none",
    opacity: isActive ? 1 : 0.52,
    transform: isActive ? "scale(1)" : "scale(0.985)",
    transition: `opacity ${transitions.fast}, transform ${transitions.fast}, background ${transitions.fast}, border-color ${transitions.fast}, box-shadow ${transitions.fast}`,
    pointerEvents: "none",
    zIndex: 139,
  };

  const positionStyle: React.CSSProperties =
    position === "left"
      ? { left: 8, top: 8, bottom: 8, width: 150 }
      : position === "right"
        ? { right: 8, top: 8, bottom: 8, width: 150 }
        : position === "bottom"
          ? { left: 8, right: 8, bottom: 8, height: 100 }
          : { left: 8, right: 8, top: 8, height: 100 };

  return (
    <div
      data-testid={`panel-drop-zone-${position}`}
      data-drop-action={isSwapTarget ? "swap" : "snap"}
      data-drop-active={isActive ? "true" : "false"}
      aria-label={isSwapTarget ? "Swap panel target" : "Snap panel target"}
      style={{ ...baseStyle, ...positionStyle }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: 9999,
          border: "1px solid var(--shell-border-strong)",
          backgroundColor: isSwapTarget
            ? "var(--accent-brand-soft)"
            : "color-mix(in srgb, var(--surface-shell-strong) 92%, transparent)",
          color: isSwapTarget ? "var(--accent-brand)" : "var(--text-secondary)",
          opacity: isActive ? 1 : 0.64,
          boxShadow: isActive ? "var(--shadow-overlay)" : "none",
        }}
      >
        <ZoneIcon size={16} strokeWidth={2.2} />
      </div>
    </div>
  );
};
