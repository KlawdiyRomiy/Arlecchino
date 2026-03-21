import React from "react";
import { motion, Reorder } from "framer-motion";
import { X, Columns, Rows } from "lucide-react";

export interface Tab {
  id: string;
  label: string;
  path: string;
  isDirty?: boolean;
}

interface EditorTabsProps {
  tabs: Tab[];
  activeTab: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabsReorder?: (tabs: Tab[]) => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  showSplitButtons?: boolean;
}

export const EditorTabs: React.FC<EditorTabsProps> = ({
  tabs,
  activeTab,
  onTabClick,
  onTabClose,
  onTabsReorder,
  onSplitHorizontal,
  onSplitVertical,
  showSplitButtons = true,
}) => {
  return (
    <Reorder.Group
      as="div"
      axis="x"
      values={tabs}
      onReorder={onTabsReorder || (() => {})}
      className="flex items-center bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] overflow-x-auto"
      style={{
        zIndex: 15,
        flexShrink: 0,
        minHeight: 36,
      }}
    >
      {tabs.map((tab) => (
        <Reorder.Item
          key={tab.id}
          value={tab}
          onClick={() => onTabClick(tab.id)}
          whileHover={{ backgroundColor: "var(--bg-secondary)" }}
          whileTap={{ scale: 0.98 }}
          whileDrag={{ scale: 1.02, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}
          className={`
            flex items-center gap-2 px-3 py-2 text-[12px] cursor-grab font-mono
            min-w-[120px] max-w-[200px] relative group
            ${
              activeTab === tab.id
                ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }
          `}
          style={{
            borderRadius:
              activeTab === tab.id
                ? "var(--radius-sm) var(--radius-sm) 0 0"
                : "0",
          }}
        >
          <span className="truncate flex-1">{tab.label}</span>
          {tab.isDirty && (
            <span className="text-[var(--text-primary)] text-[18px] ml-6 leading-none flex items-center justify-center">
              ●
            </span>
          )}
          <motion.button
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
            whileHover={{ scale: 1.1, backgroundColor: "var(--bg-hover)" }}
            whileTap={{ scale: 0.9 }}
            className="rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={14} />
          </motion.button>
          {activeTab === tab.id && (
            <motion.div
              layoutId="active-tab-indicator"
              className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--text-primary)]"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </Reorder.Item>
      ))}

      {showSplitButtons && tabs.length > 0 && (
        <div className="ml-auto flex items-center gap-1 px-2">
          <motion.button
            onClick={onSplitVertical}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-1.5 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Split Right (Cmd+\\)"
          >
            <Columns size={14} />
          </motion.button>
          <motion.button
            onClick={onSplitHorizontal}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-1.5 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Split Down"
          >
            <Rows size={14} />
          </motion.button>
        </div>
      )}
    </Reorder.Group>
  );
};
