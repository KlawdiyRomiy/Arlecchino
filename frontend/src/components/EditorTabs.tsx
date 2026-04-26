import React from "react";
import { motion, Reorder } from "framer-motion";
import { X, Columns, Rows } from "lucide-react";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ui/ContextActionMenu";

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
  getTabContextMenuItems?: (tab: Tab) => ContextActionMenuItem[];
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
  getTabContextMenuItems,
}) => {
  return (
    <div
      data-testid="editor-tabs-bar"
      className="flex h-[41px] min-h-[41px] items-center gap-2 border-b border-[var(--shell-border)] bg-[var(--bg-blackprint)] pr-2"
      style={{
        zIndex: 15,
        flexShrink: 0,
        height: 41,
        minHeight: 41,
        maxHeight: 41,
      }}
    >
      <Reorder.Group
        as="div"
        axis="x"
        values={tabs}
        onReorder={onTabsReorder || (() => {})}
        className="shell-mini-x-scroll flex min-w-0 flex-1 self-stretch overflow-x-auto overflow-y-hidden bg-[var(--bg-blackprint)]"
      >
        {tabs.map((tab) => {
          const tabNode = (
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
                group relative flex min-w-[120px] max-w-[200px] cursor-grab items-center gap-2 self-stretch px-3 py-2 text-[12px] font-mono
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
                  data-testid="active-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--text-primary)]"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </Reorder.Item>
          );

          if (!getTabContextMenuItems) {
            return tabNode;
          }

          return (
            <ContextActionMenu key={tab.id} items={getTabContextMenuItems(tab)}>
              {tabNode}
            </ContextActionMenu>
          );
        })}
      </Reorder.Group>

      {showSplitButtons && tabs.length > 0 && (
        <div className="flex h-full items-stretch">
          <div
            data-testid="editor-tabs-split-controls"
            className="shell-cluster-soft h-full max-h-full gap-1 px-1.5 py-0"
          >
            <motion.button
              type="button"
              onClick={onSplitVertical}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.96 }}
              className="shell-control h-10 w-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title="Split Right (Cmd+\\)"
            >
              <Columns
                className="h-[13px] w-[13px] min-w-[13px] shrink-0"
                size={13}
                strokeWidth={2.2}
              />
            </motion.button>
            <motion.button
              type="button"
              onClick={onSplitHorizontal}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.96 }}
              className="shell-control h-10 w-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title="Split Down"
            >
              <Rows
                className="h-[13px] w-[13px] min-w-[13px] shrink-0"
                size={13}
                strokeWidth={2.2}
              />
            </motion.button>
          </div>
        </div>
      )}
    </div>
  );
};
