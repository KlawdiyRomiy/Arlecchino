import React from "react";
import { Reorder } from "framer-motion";
import { X, Eye, Columns, Rows, Undo2, Redo2, Search } from "lucide-react";
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

export type EditorSplitPaneSide = "left" | "right" | "bottom";
export type EditorSplitDropSide = EditorSplitPaneSide;

export interface EditorSplitDropTarget {
  side: EditorSplitDropSide;
}

interface EditorTabDetachOptions {
  snapPosition?: ReturnType<typeof detectPanelSnapDropTarget>;
}

interface EditorTabsProps extends PanelSnapDragCallbacks {
  tabs: Tab[];
  activeTab: string | null;
  activeIndicatorTab?: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabsReorder?: (tabs: Tab[]) => void;
  onTabDetachToPanel?: (
    tab: Tab,
    point: { x: number; y: number },
    options?: EditorTabDetachOptions,
  ) => void | Promise<void>;
  getEditorSplitDropTarget?: (point: {
    x: number;
    y: number;
  }) => EditorSplitDropTarget | null;
  onEditorSplitDragMove?: (side: EditorSplitDropSide | null) => void;
  onTabDropToEditorSplit?: (tab: Tab, side: EditorSplitDropSide) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onFindInFile?: () => void;
  canFindInFile?: boolean;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  markdownPreviewAvailable?: boolean;
  markdownPreviewActive?: boolean;
  onToggleMarkdownPreview?: () => void;
  showHistoryControls?: boolean;
  showSplitButtons?: boolean;
  endControls?: React.ReactNode;
  getTabContextMenuItems?: (tab: Tab) => ContextActionMenuItem[];
}

export const EditorTabs: React.FC<EditorTabsProps> = ({
  tabs,
  activeTab,
  activeIndicatorTab,
  onTabClick,
  onTabClose,
  onTabsReorder,
  onTabDetachToPanel,
  getEditorSplitDropTarget,
  onEditorSplitDragMove,
  onTabDropToEditorSplit,
  onPanelSnapDragStart,
  onPanelSnapDragMove,
  onPanelSnapDragEnd,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onFindInFile,
  canFindInFile = false,
  onSplitHorizontal,
  onSplitVertical,
  markdownPreviewAvailable = false,
  markdownPreviewActive = false,
  onToggleMarkdownPreview,
  showHistoryControls = true,
  showSplitButtons = true,
  endControls,
  getTabContextMenuItems,
}) => {
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [dragGhost, setDragGhost] = React.useState<DragGhostState | null>(null);
  const [draggedOutTabId, setDraggedOutTabId] = React.useState<string | null>(
    null,
  );
  const draggedOutTabIdRef = React.useRef<string | null>(null);
  const visibleActiveIndicatorTab =
    activeIndicatorTab === undefined ? activeTab : activeIndicatorTab;

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
    </>
  );

  const tabClassName = (tab: Tab) => `
    group relative flex min-w-[120px] max-w-[200px] items-center gap-2 self-stretch px-3 py-2 text-[12px]
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
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (
      (!onTabDetachToPanel && !onTabDropToEditorSplit) ||
      event.button !== 0
    ) {
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
    let latestEditorSplitTarget: EditorSplitDropTarget | null = null;
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

    const updateEditorSplitDrag = (
      nextSplitTarget: EditorSplitDropTarget | null,
    ) => {
      if (latestEditorSplitTarget?.side !== nextSplitTarget?.side) {
        onEditorSplitDragMove?.(nextSplitTarget?.side ?? null);
      }
      latestEditorSplitTarget = nextSplitTarget;
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      const dx = pointerEvent.clientX - startX;
      const dy = pointerEvent.clientY - startY;
      if (Math.hypot(dx, dy) > 4) {
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
        if (insideTabs) {
          setDraggedOutSourceTab(null);
          updateEditorSplitDrag(null);
          if (snapDragStarted) {
            updatePanelSnapDrag(null);
          }
          setDragGhost(null);
          return;
        }
        pointerEvent.preventDefault();
        document.getSelection()?.removeAllRanges();
        const editorSplitTarget = getEditorSplitDropTarget
          ? getEditorSplitDropTarget({
              x: pointerEvent.clientX,
              y: pointerEvent.clientY,
            })
          : null;
        const snapTarget = !editorSplitTarget
          ? detectPanelSnapDropTarget(
              pointerEvent.clientX,
              pointerEvent.clientY,
            )
          : null;
        setDraggedOutSourceTab(tab.id);
        updateEditorSplitDrag(editorSplitTarget);
        if (editorSplitTarget) {
          if (snapDragStarted) {
            updatePanelSnapDrag(null);
          }
        } else {
          updatePanelSnapDrag(snapTarget);
        }
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
      updateEditorSplitDrag(null);
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
        const editorSplitTarget = getEditorSplitDropTarget?.({
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
        });
        if (editorSplitTarget) {
          onTabDropToEditorSplit?.(tab, editorSplitTarget.side);
          restoreDraggedSource();
          return;
        }

        if (!onTabDetachToPanel) {
          restoreDraggedSource();
          return;
        }

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

  const handleTabAuxClick = (
    tab: Tab,
    event: React.MouseEvent<HTMLElement>,
  ) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onTabClose(tab.id);
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
        onAuxClick={(event) => handleTabAuxClick(tab, event)}
        data-tab-id={tab.id}
        data-editor-tab-active-indicator={
          visibleActiveIndicatorTab === tab.id ? "true" : undefined
        }
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
        onAuxClick={(event) => handleTabAuxClick(tab, event)}
        data-tab-id={tab.id}
        data-editor-tab-active-indicator={
          visibleActiveIndicatorTab === tab.id ? "true" : undefined
        }
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
      {showHistoryControls && tabs.length > 0 && (
        <div
          data-testid="editor-tabs-history-controls"
          className="relative z-10 flex h-full max-h-full items-center gap-1 border-r border-[var(--shell-inline-divider)] bg-[var(--editor-surface-elevated)] px-1.5 py-0"
        >
          <button
            type="button"
            onClick={onUndo}
            onMouseDown={(event) => event.preventDefault()}
            disabled={!onUndo || !canUndo}
            className="shell-control h-10 w-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
            aria-label="Undo"
            title="Undo"
          >
            <Undo2
              className="h-[17px] w-[17px] min-w-[17px] shrink-0"
              size={17}
              strokeWidth={2.8}
            />
          </button>
          <button
            type="button"
            onClick={onRedo}
            onMouseDown={(event) => event.preventDefault()}
            disabled={!onRedo || !canRedo}
            className="shell-control h-10 w-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
            aria-label="Redo"
            title="Redo"
          >
            <Redo2
              className="h-[17px] w-[17px] min-w-[17px] shrink-0"
              size={17}
              strokeWidth={2.8}
            />
          </button>
        </div>
      )}

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
            <button
              type="button"
              onClick={onFindInFile}
              onMouseDown={(event) => event.preventDefault()}
              disabled={!onFindInFile || !canFindInFile}
              data-testid="editor-tabs-find-in-file"
              className="shell-control h-10 w-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
              aria-label="Find in file"
              title="Find in file (Cmd+F)"
            >
              <Search
                className="h-[13px] w-[13px] min-w-[13px] shrink-0"
                size={13}
                strokeWidth={2.2}
              />
            </button>
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
      {endControls && (
        <div className="relative z-10 flex h-full items-stretch">
          {endControls}
        </div>
      )}
      <DragGhost ghost={dragGhost} />
    </div>
  );
};
