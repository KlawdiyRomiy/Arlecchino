import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { FileCode, FolderOpen } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import {
  colors,
  getThemeColors,
  radius,
  shadows,
  zIndex,
} from "../styles/colors";

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

export const DefinitionChooserMenu: React.FC<DefinitionChooserMenuProps> = ({
  isOpen,
  x,
  y,
  items,
  onSelect,
  onClose,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const menuRef = useRef<HTMLDivElement>(null);

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

  if (!isOpen) return null;

  const menuWidth = 600;
  const menuHeight = Math.min(400, items.length * 50 + 80);
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  let finalX = x;
  let finalY = y;

  if (x + menuWidth > screenWidth) finalX = screenWidth - menuWidth - 16;
  if (y + menuHeight > screenHeight) finalY = screenHeight - menuHeight - 16;

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
        backgroundColor: isDark ? colors.dark.bgPanel : colors.light.bg,
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
        }}
      >
        Choose Declaration
      </div>

      <div style={{ overflowY: "auto", padding: "4px 0" }}>
        {items.map((item, index) => (
          <div
            key={index}
            onClick={() => {
              onSelect(item.path, item.line);
              onClose();
            }}
            style={{
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = isDark
                ? "rgba(255,255,255,0.05)"
                : "rgba(0,0,0,0.03)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <FileCode
              size={16}
              style={{ color: theme.textSecondary, flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {item.context && (
                <div
                  style={{
                    fontSize: "13px",
                    color: theme.text,
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
                  color: theme.textMuted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.displayPath || item.path}
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};
