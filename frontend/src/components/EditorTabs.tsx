import React from "react";
import { Reorder } from "framer-motion";
import { X, Eye, Columns, Rows } from "lucide-react";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ui/ContextActionMenu";
import { DragGhost, type DragGhostState } from "./ui/DragGhost";
import { beginDragSelectionLock } from "../utils/dragSelectionLock";
import {
  detectPanelSnapDropTarget,
  type PanelSnapDragCallbacks,
} from "../utils/panelSnapDrag";

export interface Tab {
  id: string;
  label: string;
  path: string;
  isDirty?: boolean;
}

interface EditorTabDetachOptions {
  snapPosition?: ReturnType<typeof detectPanelSnapDropTarget>;
}

interface EditorTabsProps extends PanelSnapDragCallbacks {
  tabs: Tab[];
  activeTab: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabsReorder?: (tabs: Tab[]) => void;
  onTabDetachToPanel?: (
    tab: Tab,
    point: { x: number; y: number },
    options?: EditorTabDetachOptions,
  ) => void | Promise<void>;
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
  onTabDetachToPanel,
  onPanelSnapDragStart,
  onPanelSnapDragMove,
  onPanelSnapDragEnd,
  onSplitHorizontal,
  onSplitVertical,
  markdownPreviewAvailable = false,
  markdownPreviewActive = false,
  onToggleMarkdownPreview,
  showSplitButtons = true,
  getTabContextMenuItems,
}) => {
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [dragGhost, setDragGhost] = React.useState<DragGhostState | null>(null);
  const [draggedOutTabId, setDraggedOutTabId] = React.useState<string | null>(
    null,
  );
  const draggedOutTabIdRef = React.useRef<string | null>(null);

  const setDraggedOutSourceTab = React.useCallback((tabId: string | null) => {
    if (draggedOutTabIdRef.current === tabId) {
      return;
    }
    draggedOutTabIdRef.current = tabId;
    setDraggedOutTabId(tabId);
  }, []);

  React.useEffect(() => {
    if (draggedOutTabId && !tabs.some((tab) => tab.id === draggedOutTabId)) {
      setDraggedOutSourceTab(null);
    }
  }, [draggedOutTabId, setDraggedOutSourceTab, tabs]);

  const handleMotionReorder = React.useCallback(
    (nextTabs: Tab[]) => {
      if (draggedOutTabIdRef.current) {
        return;
      }
      onTabsReorder?.(nextTabs);
    },
    [onTabsReorder],
  );

  const renderTabContent = (tab: Tab, options: { ghost?: boolean } = {}) => (
    <>
      <span className="truncate flex-1">{tab.label}</span>
      {tab.isDirty && (
        <span className="ml-6 flex items-center justify-center text-[18px] leading-none text-[var(--text-primary)]">
          ●
        </span>
      )}
      {options.ghost ? (
        <span className="rounded p-0.5 opacity-100 text-[var(--text-secondary)]">
          <X size={14} />
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTabClose(tab.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded p-0.5 opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 hover:bg-[var(--bg-hover)]"
        >
          <X size={14} />
        </button>
      )}
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

  const renderEditorTabGhostContent = (tab: Tab) => (
    <div
      className={`${tabClassName(tab)} arle-editor-tab-drag-copy`}
      data-drag-ghost-source="editor-tab"
      style={{
        borderRadius: activeTab === tab.id ? "8px 8px 0 0" : "0",
        width: "100%",
        height: "100%",
      }}
    >
      {renderTabContent(tab, { ghost: true })}
    </div>
  );

  const handleTabPointerDown = (
    tab: Tab,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (!onTabDetachToPanel || event.button !== 0) {
      return;
    }

    const releaseSelectionLock = beginDragSelectionLock();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const sourceRect = event.currentTarget.getBoundingClientRect();
    const offsetX = startX - sourceRect.left;
    const offsetY = startY - sourceRect.top;
    let moved = false;
    let latestSnapTarget: ReturnType<typeof detectPanelSnapDropTarget> = null;
    let snapDragStarted = false;

    const updatePanelSnapDrag = (nextSnapTarget: typeof latestSnapTarget) => {
      if (!snapDragStarted) {
        snapDragStarted = true;
        onPanelSnapDragStart?.();
      }
      if (latestSnapTarget !== nextSnapTarget) {
        onPanelSnapDragMove?.(nextSnapTarget);
      }
      latestSnapTarget = nextSnapTarget;
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      pointerEvent.preventDefault();
      document.getSelection()?.removeAllRanges();

      const dx = pointerEvent.clientX - startX;
      const dy = pointerEvent.clientY - startY;
      if (Math.hypot(dx, dy) > 8) {
        moved = true;
        const container = scrollContainerRef.current;
        const rect = container?.getBoundingClientRect();
        const insideTabs = Boolean(
          rect &&
          pointerEvent.clientX >= rect.left &&
          pointerEvent.clientX <= rect.right &&
          pointerEvent.clientY >= rect.top &&
          pointerEvent.clientY <= rect.bottom,
        );
        const snapTarget = !insideTabs
          ? detectPanelSnapDropTarget(
              pointerEvent.clientX,
              pointerEvent.clientY,
            )
          : null;
        setDraggedOutSourceTab(insideTabs ? null : tab.id);
        updatePanelSnapDrag(snapTarget);
        setDragGhost({
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
          label: tab.label,
          variant: "layout",
          layout: "editor-tab",
          content: renderEditorTabGhostContent(tab),
          width: sourceRect.width,
          height: sourceRect.height,
          offsetX,
          offsetY,
        });
      }

      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      if (
        pointerEvent.clientY < rect.top - 24 ||
        pointerEvent.clientY > rect.bottom + 24
      ) {
        return;
      }
      if (pointerEvent.clientX < rect.left + 40) {
        container.scrollLeft -= 18;
      } else if (pointerEvent.clientX > rect.right - 40) {
        container.scrollLeft += 18;
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      if (snapDragStarted) {
        onPanelSnapDragEnd?.();
      }
      releaseSelectionLock();
      setDragGhost(null);
    };

    const restoreDraggedSource = () => {
      setDraggedOutSourceTab(null);
    };

    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      restoreDraggedSource();
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      const container = scrollContainerRef.current;
      if (!moved || !container) {
        restoreDraggedSource();
        return;
      }
      const rect = container.getBoundingClientRect();
      const inside =
        pointerEvent.clientX >= rect.left &&
        pointerEvent.clientX <= rect.right &&
        pointerEvent.clientY >= rect.top &&
        pointerEvent.clientY <= rect.bottom;
      if (!inside) {
        const detachResult = onTabDetachToPanel(
          tab,
          {
            x: pointerEvent.clientX,
            y: pointerEvent.clientY,
          },
          { snapPosition: latestSnapTarget },
        );
        void Promise.resolve(detachResult).finally(restoreDraggedSource);
        return;
      }
      restoreDraggedSource();
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
  };

  const renderTab = (tab: Tab) => {
    const sourceHidden = draggedOutTabId === tab.id;
    const tabStyle: React.CSSProperties = {
      borderRadius: activeTab === tab.id ? "8px 8px 0 0" : "0",
      visibility: sourceHidden ? "hidden" : undefined,
      pointerEvents: sourceHidden ? "none" : undefined,
    };
    const tabNode = onTabsReorder ? (
      <Reorder.Item
        key={tab.id}
        value={tab}
        onClick={() => onTabClick(tab.id)}
        onPointerDown={(event) => handleTabPointerDown(tab, event)}
        data-tab-id={tab.id}
        data-drag-source-hidden={sourceHidden ? "true" : undefined}
        className={`${tabClassName(tab)} cursor-grab`}
        style={tabStyle}
      >
        {renderTabContent(tab)}
      </Reorder.Item>
    ) : (
      <div
        key={tab.id}
        onClick={() => onTabClick(tab.id)}
        onPointerDown={(event) => handleTabPointerDown(tab, event)}
        data-tab-id={tab.id}
        data-drag-source-hidden={sourceHidden ? "true" : undefined}
        className={`${tabClassName(tab)} cursor-pointer`}
        style={tabStyle}
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
      className="relative isolate flex h-10 min-h-10 items-center gap-2 border-b border-[var(--shell-inline-divider)] bg-[var(--editor-surface-elevated)] pr-0"
      style={{
        zIndex: 15,
        flexShrink: 0,
        height: 40,
        minHeight: 40,
        maxHeight: 40,
      }}
    >
      {onTabsReorder ? (
        <Reorder.Group
          as="div"
          ref={scrollContainerRef}
          axis="x"
          values={tabs}
          onReorder={handleMotionReorder}
          className="shell-mini-x-scroll relative z-10 flex min-w-0 flex-1 self-stretch overflow-x-auto overflow-y-hidden bg-transparent"
        >
          {tabItems}
        </Reorder.Group>
      ) : (
        <div
          ref={scrollContainerRef}
          className="shell-mini-x-scroll relative z-10 flex min-w-0 flex-1 self-stretch overflow-x-auto overflow-y-hidden bg-transparent"
        >
          {tabItems}
        </div>
      )}

      {showSplitButtons && tabs.length > 0 && (
        <div className="relative z-10 flex h-full items-stretch">
          <div
            data-testid="editor-tabs-split-controls"
            className="flex h-full max-h-full items-center gap-1 border-l border-[var(--shell-inline-divider)] bg-[var(--editor-surface-elevated)] px-1.5 py-0"
            style={{
              borderTopRightRadius: "calc(var(--radius-lg) - 1px)",
            }}
          >
            {markdownPreviewAvailable && (
              <button
                type="button"
                onClick={onToggleMarkdownPreview}
                disabled={!onToggleMarkdownPreview}
                aria-pressed={markdownPreviewActive}
                data-testid="editor-tabs-markdown-preview-toggle"
                className={`shell-control h-10 w-10 min-w-10 px-0 transition-[background-color,border-color,color,opacity] disabled:pointer-events-none disabled:opacity-35 ${
                  markdownPreviewActive
                    ? "border-[var(--accent-primary)]/45 bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title="Markdown Preview"
              >
                <Eye
                  className="h-[13px] w-[13px] min-w-[13px] shrink-0"
                  size={13}
                  strokeWidth={2.2}
                />
              </button>
            )}
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
      <DragGhost ghost={dragGhost} />
    </div>
  );
};
