import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { FileCode } from "lucide-react";
import { zIndex } from "../styles/colors";
import {
  getInteractiveSurfaceMotionStyle,
  markInteractiveSurfaceMotion,
} from "./ui/interactiveSurfaceMotion";

export interface DefinitionItem {
  path: string;
  line?: number;
  context?: string;
  displayPath?: string;
}

interface DefinitionChooserMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  items: DefinitionItem[];
  onSelect: (path: string, line?: number) => void;
  onClose: () => void;
}

const definitionItemKey = (item: DefinitionItem): string =>
  `${item.path}:${item.line ?? ""}:${item.displayPath ?? ""}:${item.context ?? ""}`;

export const DefinitionChooserMenu: React.FC<DefinitionChooserMenuProps> = ({
  isOpen,
  x,
  y,
  items,
  onSelect,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const markInteractiveMotion = React.useCallback(() => {
    markInteractiveSurfaceMotion("menu");
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  const viewportMargin = 12;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const menuWidth = Math.min(
    520,
    Math.max(280, screenWidth - viewportMargin * 2),
  );
  const menuHeight = Math.min(
    360,
    Math.max(92, items.length * 54 + 54),
    screenHeight - viewportMargin * 2,
  );

  const finalX = Math.min(
    Math.max(x, viewportMargin),
    Math.max(viewportMargin, screenWidth - menuWidth - viewportMargin),
  );
  const finalY = Math.min(
    Math.max(y + 8, viewportMargin),
    Math.max(viewportMargin, screenHeight - menuHeight - viewportMargin),
  );

  return createPortal(
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      onAnimationStart={markInteractiveMotion}
      style={{
        position: "fixed",
        left: finalX,
        top: finalY,
        width: `${menuWidth}px`,
        maxHeight: `${menuHeight}px`,
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--surface-shell-soft) 98%, transparent), color-mix(in srgb, var(--surface-shell) 99%, transparent))",
        borderRadius: "18px",
        boxShadow:
          "var(--shadow-overlay), inset 0 1px 0 var(--shell-inner-highlight)",
        border: "1px solid var(--shell-border-strong)",
        zIndex: zIndex.modal,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        color: "var(--text-primary)",
        backdropFilter: "blur(14px) saturate(1.08)",
        ...getInteractiveSurfaceMotionStyle({ preserveTransform: true }),
      }}
    >
      <div
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid var(--shell-inline-divider)",
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        Choose Definition
      </div>

      <div style={{ overflowY: "auto", padding: "6px" }}>
        {items.map((item) => (
          <button
            type="button"
            key={definitionItemKey(item)}
            onClick={() => {
              onSelect(item.path, item.line);
              onClose();
            }}
            style={{
              width: "100%",
              border: 0,
              background: "transparent",
              padding: "9px 10px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
              borderRadius: "14px",
              color: "var(--text-primary)",
              textAlign: "left",
              transition:
                "background-color 150ms ease, color 150ms ease, box-shadow 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                "color-mix(in srgb, var(--surface-active) 74%, transparent)";
              e.currentTarget.style.boxShadow =
                "inset 0 1px 0 var(--shell-inner-highlight)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <FileCode
              size={16}
              style={{ color: "var(--text-secondary)", flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {item.context && (
                <div
                  style={{
                    fontSize: "13px",
                    color: "var(--text-primary)",
                    fontWeight: 500,
                    marginBottom: "2px",
                  }}
                >
                  {item.context}
                </div>
              )}
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.displayPath || item.path}
              </div>
            </div>
          </button>
        ))}
      </div>
    </motion.div>,
    document.body,
  );
};
