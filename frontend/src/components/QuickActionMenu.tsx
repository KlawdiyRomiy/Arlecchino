import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { WandSparkles } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { getThemeColors, radius, shadows, zIndex } from "../styles/colors";

export interface QuickActionMenuItem {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  disabled?: boolean;
}

interface QuickActionMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  actions: QuickActionMenuItem[];
  onSelect: (index: number) => void;
  onClose: () => void;
}

export const QuickActionMenu: React.FC<QuickActionMenuProps> = ({
  isOpen,
  x,
  y,
  actions,
  onSelect,
  onClose,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

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

  if (!isOpen) {
    return null;
  }

  const menuWidth = 420;
  const menuHeight = Math.min(360, actions.length * 44 + 84);
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  let finalX = x;
  let finalY = y;

  if (x + menuWidth > screenWidth) {
    finalX = screenWidth - menuWidth - 16;
  }
  if (finalX < 16) {
    finalX = 16;
  }
  if (y + menuHeight > screenHeight) {
    finalY = screenHeight - menuHeight - 16;
  }
  if (finalY < 16) {
    finalY = 16;
  }

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      style={{
        position: "fixed",
        left: finalX,
        top: finalY,
        width: `${menuWidth}px`,
        maxHeight: `${menuHeight}px`,
        backgroundColor: "var(--surface-elevated)",
        borderRadius: radius.lg,
        boxShadow: shadows.floating,
        border: `1px solid ${theme.border}`,
        zIndex: zIndex.modal,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${theme.border}`,
          fontSize: "13px",
          fontWeight: 600,
          color: theme.text,
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <WandSparkles size={15} style={{ color: theme.textSecondary }} />
        Quick Actions
      </div>

      <div style={{ overflowY: "auto", padding: "4px 0" }}>
        {actions.map((action, index) => {
          const kind = action.kind?.trim();
          return (
            <button
              key={`${action.title}-${index}`}
              type="button"
              disabled={action.disabled}
              onClick={() => {
                if (action.disabled) {
                  return;
                }
                onSelect(index);
              }}
              style={{
                width: "100%",
                border: "none",
                background: "transparent",
                textAlign: "left",
                padding: "10px 16px",
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                cursor: action.disabled ? "not-allowed" : "pointer",
                transition: "background-color 0.15s",
                opacity: action.disabled ? 0.55 : 1,
              }}
              onMouseEnter={(event) => {
                if (action.disabled) {
                  return;
                }
                event.currentTarget.style.backgroundColor = isDark
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(0,0,0,0.03)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "13px",
                    color: theme.text,
                    fontWeight: action.isPreferred ? 600 : 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {action.title}
                </div>
                {kind && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: theme.textMuted,
                      marginTop: "2px",
                    }}
                  >
                    {kind}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
};
