import React from "react";
import { Reorder } from "framer-motion";
import { X, BookOpen, Columns, Rows } from "lucide-react";
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
  markdownPreviewAvailable?: boolean;
  markdownPreviewActive?: boolean;
  onToggleMarkdownPreview?: () => void;
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
  markdownPreviewAvailable = false,
  markdownPreviewActive = false,
  onToggleMarkdownPreview,
  showSplitButtons = true,
  getTabContextMenuItems,
}) => {
  const renderTabContent = (tab: Tab) => (
    <>
      <span className="truncate flex-1">{tab.label}</span>
      {tab.isDirty && (
        <span className="ml-6 flex items-center justify-center text-[18px] leading-none text-[var(--text-primary)]">
          ●
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTabClose(tab.id);
        }}
        className="rounded p-0.5 opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 hover:bg-[var(--bg-hover)]"
      >
        <X size={14} />
      </button>
      {activeTab === tab.id && (
        <div
          data-testid="active-tab-indicator"
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--text-primary)]"
        />
      )}
    </>
  );

  const tabClassName = (tab: Tab) => `
    group relative flex min-w-[120px] max-w-[200px] items-center gap-2 self-stretch px-3 py-2 text-[12px] font-mono
    ${
      activeTab === tab.id
        ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
        : "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/72 hover:text-[var(--text-primary)]"
    }
  `;

  const renderTab = (tab: Tab) => {
    const tabNode = onTabsReorder ? (
      <Reorder.Item
        key={tab.id}
        value={tab}
        onClick={() => onTabClick(tab.id)}
        className={`${tabClassName(tab)} cursor-grab`}
        style={{
          borderRadius: activeTab === tab.id ? "8px 8px 0 0" : "0",
        }}
      >
        {renderTabContent(tab)}
      </Reorder.Item>
    ) : (
      <div
        key={tab.id}
        onClick={() => onTabClick(tab.id)}
        className={`${tabClassName(tab)} cursor-pointer`}
        style={{
          borderRadius: activeTab === tab.id ? "8px 8px 0 0" : "0",
        }}
      >
        {renderTabContent(tab)}
      </div>
    );

    if (!getTabContextMenuItems) {
      return tabNode;
    }

    return (
      <ContextActionMenu key={tab.id} items={getTabContextMenuItems(tab)}>
        {tabNode}
      </ContextActionMenu>
    );
  };

  const tabItems = tabs.map(renderTab);

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
      {onTabsReorder ? (
        <Reorder.Group
          as="div"
          axis="x"
          values={tabs}
          onReorder={onTabsReorder}
          className="shell-mini-x-scroll flex min-w-0 flex-1 self-stretch overflow-x-auto overflow-y-hidden bg-[var(--bg-blackprint)]"
        >
          {tabItems}
        </Reorder.Group>
      ) : (
        <div className="shell-mini-x-scroll flex min-w-0 flex-1 self-stretch overflow-x-auto overflow-y-hidden bg-[var(--bg-blackprint)]">
          {tabItems}
        </div>
      )}

      {showSplitButtons && tabs.length > 0 && (
        <div className="flex h-full items-stretch">
          <div
            data-testid="editor-tabs-split-controls"
            className="shell-cluster-soft h-full max-h-full gap-1 px-1.5 py-0"
          >
            <button
              type="button"
              onClick={onToggleMarkdownPreview}
              disabled={!markdownPreviewAvailable || !onToggleMarkdownPreview}
              aria-pressed={markdownPreviewActive}
              data-testid="editor-tabs-markdown-preview-toggle"
              className={`shell-control h-10 w-10 min-w-10 px-0 transition-[background-color,border-color,color,opacity] disabled:pointer-events-none disabled:opacity-35 ${
                markdownPreviewActive
                  ? "border-[var(--accent-primary)]/45 bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
              title={
                markdownPreviewAvailable
                  ? "Markdown Preview"
                  : "Markdown Preview unavailable"
              }
            >
              <BookOpen
                className="h-[13px] w-[13px] min-w-[13px] shrink-0"
                size={13}
                strokeWidth={2.2}
              />
            </button>
            <button
              type="button"
              onClick={onSplitVertical}
              className="shell-control h-10 w-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title="Split Right (Cmd+\\)"
            >
              <Columns
                className="h-[13px] w-[13px] min-w-[13px] shrink-0"
                size={13}
                strokeWidth={2.2}
              />
            </button>
            <button
              type="button"
              onClick={onSplitHorizontal}
              className="shell-control h-10 w-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title="Split Down"
            >
              <Rows
                className="h-[13px] w-[13px] min-w-[13px] shrink-0"
                size={13}
                strokeWidth={2.2}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
