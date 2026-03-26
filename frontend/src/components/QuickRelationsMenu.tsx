import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  Box,
  Layout,
  FileCode,
  Database,
  Search,
  X,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  colors,
  getThemeColors,
  radius,
  shadows,
  transitions,
  zIndex,
} from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import {
  matchesRelationFilter,
  type RelationGroup,
} from "../utils/perspectiveRelations";

interface QuickRelationsMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  relations: RelationGroup[];
  onClose: () => void;
  onFileSelect: (path: string, line?: number) => void;
}

const typeIcons: Record<string, React.ReactNode> = {
  route: <GitBranch size={14} className="text-blue-500" />,
  model: <Box size={14} className="text-purple-500" />,
  view: <Layout size={14} className="text-green-500" />,
  component: <Layout size={14} className="text-green-500" />,
  controller: <FileCode size={14} className="text-orange-500" />,
  hook: <GitBranch size={14} className="text-blue-500" />,
  store: <Database size={14} className="text-yellow-500" />,
  service: <FileCode size={14} className="text-orange-500" />,
  test: <Search size={14} className="text-gray-500" />,
  migration: <Database size={14} className="text-yellow-500" />,
  config: <Database size={14} className="text-gray-500" />,
  style: <Layout size={14} className="text-gray-500" />,
  asset: <Layout size={14} className="text-gray-500" />,
  doc: <FileCode size={14} className="text-gray-500" />,
  reference: <FileCode size={14} className="text-gray-500" />,
  other: <FileCode size={14} className="text-gray-500" />,
};

export const QuickRelationsMenu: React.FC<QuickRelationsMenuProps> = ({
  isOpen,
  x,
  y,
  relations,
  onClose,
  onFileSelect,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const menuRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
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

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      setFilter("");
      setSelectedIndex(0);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const flatItems = relations.flatMap((group) => group.items);
  const filteredItems = flatItems.filter((item) =>
    matchesRelationFilter(item, filter),
  );

  if (!isOpen) return null;

  const menuWidth = 300;
  const menuHeight = 400;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  const fitsBelow = y + menuHeight + 16 < screenHeight;
  const finalX = Math.min(x, screenWidth - menuWidth - 16);

  const searchBar = (
    <div
      style={{
        padding: "12px",
        borderBottom: fitsBelow ? `1px solid ${theme.border}` : "none",
        borderTop: fitsBelow ? "none" : `1px solid ${theme.border}`,
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <Search size={14} style={{ color: theme.textMuted }} />
      <input
        autoFocus
        type="text"
        placeholder="Filter relations..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: theme.text,
          fontSize: "13px",
        }}
      />
      <div
        style={{
          fontSize: "10px",
          padding: "2px 6px",
          borderRadius: "4px",
          backgroundColor: isDark
            ? "rgba(255,255,255,0.1)"
            : "rgba(0,0,0,0.05)",
          color: theme.textMuted,
        }}
      >
        ESC
      </div>
    </div>
  );

  const contentList = (
    <div style={{ overflowY: "auto", padding: "8px 0", flex: 1 }}>
      {relations.map((group) => {
        const groupItems = group.items.filter((item) =>
          matchesRelationFilter(item, filter),
        );

        if (groupItems.length === 0) return null;

        return (
          <div key={group.type}>
            <div
              style={{
                padding: "4px 12px",
                fontSize: "11px",
                fontWeight: 600,
                color: theme.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {group.type}
            </div>
            {groupItems.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  onFileSelect(item.path, item.line);
                  onClose();
                }}
                style={{
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  transition: `background-color ${transitions.fast}`,
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
                {typeIcons[item.type] || typeIcons["other"]}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "13px",
                      color: theme.text,
                      fontWeight: 500,
                    }}
                  >
                    {item.name}
                  </div>
                  {item.details && (
                    <div
                      style={{
                        fontSize: "11px",
                        color: theme.textMuted,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.details}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div style={{ height: "8px" }} />
          </div>
        );
      })}

      {filteredItems.length === 0 && (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            color: theme.textMuted,
            fontSize: "13px",
          }}
        >
          No relations found
        </div>
      )}
    </div>
  );

  return createPortal(
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      style={{
        position: "fixed",
        left: finalX,
        top: fitsBelow ? y : undefined,
        bottom: fitsBelow ? undefined : screenHeight - y,
        width: `${menuWidth}px`,
        maxHeight: `${menuHeight}px`,
        backgroundColor: isDark ? colors.dark.bgPanel : colors.light.bg,
        borderRadius: radius.lg,
        boxShadow: shadows.floating,
        border: `1px solid ${theme.border}`,
        zIndex: zIndex.tooltip,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {fitsBelow ? (
        <>
          {searchBar}
          {contentList}
        </>
      ) : (
        <>
          {contentList}
          {searchBar}
        </>
      )}
    </motion.div>,
    document.body,
  );
};
