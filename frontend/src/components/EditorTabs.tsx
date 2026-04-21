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
    <div
      className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-blackprint)] pr-2"
      style={{
        zIndex: 15,
        flexShrink: 0,
        minHeight: 36,
      }}
    >
      <Reorder.Group
        as="div"
        axis="x"
        values={tabs}
        onReorder={onTabsReorder || (() => {})}
        className="flex min-w-0 flex-1 items-center overflow-x-auto bg-[var(--bg-blackprint)]"
      >
        {tabs.map((tab) => (
          <Reorder.Item
            key={tab.id}
            value={tab}
            onClick={() => onTabClick(tab.id)}
            whileHover={{ backgroundColor: "var(--bg-secondary)" }}
            whileTap={{ scale: 0.98 }}
            whileDrag={{
              scale: 1.02,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
            className={`
              relative flex min-w-[120px] max-w-[200px] cursor-grab items-center gap-2 px-3 py-2 text-[12px] font-mono group
              ${
                activeTab === tab.id
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/72 hover:text-[var(--text-primary)]"
              }
            `}
            style={{
              borderRadius: activeTab === tab.id ? "8px 8px 0 0" : "0",
            }}
          >
            <span className="truncate flex-1">{tab.label}</span>
            {tab.isDirty && (
              <span className="ml-6 flex items-center justify-center text-[18px] leading-none text-[var(--text-primary)]">
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
              className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
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
      </Reorder.Group>

      {showSplitButtons && tabs.length > 0 && (
        <div className="flex items-center">
          <div className="shell-cluster-soft gap-1 px-1.5 py-1">
            <motion.button
              onClick={onSplitVertical}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.96 }}
              className="shell-control h-10 w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title="Split Right (Cmd+\\)"
            >
              <Columns size={22} strokeWidth={2.1} />
            </motion.button>
            <motion.button
              onClick={onSplitHorizontal}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.96 }}
              className="shell-control h-10 w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title="Split Down"
            >
              <Rows size={22} strokeWidth={2.1} />
            </motion.button>
          </div>
        </div>
      )}
    </div>
  );
};
