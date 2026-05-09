import React from "react";
import { Copy, FileText, X } from "lucide-react";
import type { CodePanelTab } from "./MainLayout.types";
import { getCodePanelTabTestId } from "./projectEntryUtils";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "../ui/ContextActionMenu";
import { DragGhost, type DragGhostState } from "../ui/DragGhost";
import { beginDragSelectionLock } from "../../utils/dragSelectionLock";
import {
  detectPanelSnapDropTarget,
  type PanelSnapDragCallbacks,
} from "../../utils/panelSnapDrag";
import { writeClipboardTextWithFallback } from "../../utils/clipboard";
import { relativeProjectPath } from "../../utils/projectPaths";

interface CodePanelTabDetachOptions {
  snapPosition?: ReturnType<typeof detectPanelSnapDropTarget>;
}

interface CodePanelTabsProps extends PanelSnapDragCallbacks {
  tabs: CodePanelTab[];
  activePath: string;
  projectPath?: string;
  onActivate: (path: string) => void;
  onClose?: (path: string) => void;
  onCloseOthers?: (path: string) => void;
  onDetachToPanel?: (
    tab: CodePanelTab,
    point: { x: number; y: number },
    options?: CodePanelTabDetachOptions,
  ) => void;
  onRevealInExplorer?: (tab: CodePanelTab) => void;
  onMoveToEditorTabs?: (tab: CodePanelTab) => void;
}

export const CodePanelTabs: React.FC<CodePanelTabsProps> = ({
  tabs,
  activePath,
  projectPath,
  onActivate,
  onClose,
  onCloseOthers,
  onDetachToPanel,
  onRevealInExplorer,
  onMoveToEditorTabs,
  onPanelSnapDragStart,
  onPanelSnapDragMove,
  onPanelSnapDragEnd,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const suppressClickRef = React.useRef(false);
  const highlightedEditorTabsRef = React.useRef<HTMLElement | null>(null);
  const highlightedExplorerRef = React.useRef<HTMLElement | null>(null);
  const [dragGhost, setDragGhost] = React.useState<DragGhostState | null>(null);
  const codePanelTabClassName =
    "h-7 max-w-48 min-w-0 flex-shrink-0 truncate rounded-md border px-2.5 text-left text-xs font-medium transition-colors";

  const getCodePanelTabStyle = (
    isActive: boolean,
    options: { ghost?: boolean } = {},
  ): React.CSSProperties => ({
    borderColor: isActive ? "var(--shell-border-strong)" : "transparent",
    backgroundColor: isActive ? "var(--surface-hover)" : "transparent",
    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
    width: options.ghost ? "100%" : undefined,
    height: options.ghost ? "100%" : undefined,
    maxWidth: options.ghost ? "none" : undefined,
  });

  const renderCodePanelTabGhostContent = (
    tab: CodePanelTab,
    isActive: boolean,
  ) => (
    <div
      className={`${codePanelTabClassName} arle-code-panel-tab-drag-copy`}
      data-drag-ghost-source="code-panel-tab"
      style={getCodePanelTabStyle(isActive, { ghost: true })}
    >
      {tab.name}
    </div>
  );

  const clearEditorTabsHighlight = React.useCallback(() => {
    highlightedEditorTabsRef.current?.classList.remove(
      "editor-tabs-code-drop-target",
    );
    highlightedEditorTabsRef.current = null;
  }, []);

  const clearExplorerHighlight = React.useCallback(() => {
    highlightedExplorerRef.current?.classList.remove(
      "file-explorer-code-drop-target",
    );
    highlightedExplorerRef.current = null;
  }, []);

  const getEditorTabsDropTarget = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    return (
      element?.closest<HTMLElement>('[data-testid="editor-tabs-bar"]') ?? null
    );
  };

  const getExplorerDropTarget = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    return (
      element?.closest<HTMLElement>(
        '[data-testid="file-explorer-scroll-region"]',
      ) ??
      element?.closest<HTMLElement>('[data-testid="panel-explorer"]') ??
      null
    );
  };

  const handleTabPointerDown = (
    tab: CodePanelTab,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const releaseSelectionLock = beginDragSelectionLock();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const sourceRect = event.currentTarget.getBoundingClientRect();
    const offsetX = startX - sourceRect.left;
    const offsetY = startY - sourceRect.top;
    const sourceActive = tab.path === activePath;
    const panelElement = containerRef.current?.closest<HTMLElement>(
      '[data-panel-id="code"]',
    );
    let activeDrag = false;
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

      const dx = pointerEvent.clientX - startX;
      const dy = pointerEvent.clientY - startY;
      if (!activeDrag && Math.hypot(dx, dy) > 7) {
        activeDrag = true;
        suppressClickRef.current = true;
      }
      if (!activeDrag) {
        return;
      }

      pointerEvent.preventDefault();
      document.getSelection()?.removeAllRanges();
      const editorTabsTarget = getEditorTabsDropTarget(
        pointerEvent.clientX,
        pointerEvent.clientY,
      );
      if (highlightedEditorTabsRef.current !== editorTabsTarget) {
        clearEditorTabsHighlight();
        if (editorTabsTarget) {
          editorTabsTarget.classList.add("editor-tabs-code-drop-target");
          highlightedEditorTabsRef.current = editorTabsTarget;
        }
      }

      const explorerTarget = editorTabsTarget
        ? null
        : getExplorerDropTarget(pointerEvent.clientX, pointerEvent.clientY);
      if (highlightedExplorerRef.current !== explorerTarget) {
        clearExplorerHighlight();
        if (explorerTarget) {
          explorerTarget.classList.add("file-explorer-code-drop-target");
          highlightedExplorerRef.current = explorerTarget;
        }
      }

      const panelRect = panelElement?.getBoundingClientRect();
      const insidePanel = Boolean(
        panelRect &&
        pointerEvent.clientX >= panelRect.left &&
        pointerEvent.clientX <= panelRect.right &&
        pointerEvent.clientY >= panelRect.top &&
        pointerEvent.clientY <= panelRect.bottom,
      );
      const canOpenSeparatePanel = tabs.length > 1;
      const snapTarget =
        canOpenSeparatePanel &&
        !editorTabsTarget &&
        !explorerTarget &&
        !insidePanel
          ? detectPanelSnapDropTarget(
              pointerEvent.clientX,
              pointerEvent.clientY,
            )
          : null;
      updatePanelSnapDrag(snapTarget);
      setDragGhost({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        label: tab.name,
        variant: "layout",
        layout: "code-panel-tab",
        content: renderCodePanelTabGhostContent(tab, sourceActive),
        width: sourceRect.width,
        height: sourceRect.height,
        offsetX,
        offsetY,
      });
    };

    const resetClickSuppression = () => {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      clearEditorTabsHighlight();
      clearExplorerHighlight();
      setDragGhost(null);
      if (snapDragStarted) {
        onPanelSnapDragEnd?.();
      }
      releaseSelectionLock();
    };

    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      resetClickSuppression();
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      if (!activeDrag) {
        return;
      }
      resetClickSuppression();

      const editorTabsTarget = getEditorTabsDropTarget(
        pointerEvent.clientX,
        pointerEvent.clientY,
      );
      if (editorTabsTarget) {
        onMoveToEditorTabs?.(tab);
        return;
      }

      const explorerTarget = getExplorerDropTarget(
        pointerEvent.clientX,
        pointerEvent.clientY,
      );
      if (explorerTarget) {
        onRevealInExplorer?.(tab);
        return;
      }

      const panelRect = panelElement?.getBoundingClientRect();
      const insidePanel = Boolean(
        panelRect &&
        pointerEvent.clientX >= panelRect.left &&
        pointerEvent.clientX <= panelRect.right &&
        pointerEvent.clientY >= panelRect.top &&
        pointerEvent.clientY <= panelRect.bottom,
      );
      if (!insidePanel && tabs.length > 1) {
        onDetachToPanel?.(
          tab,
          {
            x: pointerEvent.clientX,
            y: pointerEvent.clientY,
          },
          { snapPosition: latestSnapTarget },
        );
      }
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
  };

  return (
    <div
      ref={containerRef}
      data-testid="code-panel-tabs"
      className="flex h-9 min-h-9 items-center gap-1 overflow-x-auto border-b border-[var(--shell-border-subtle)] bg-[color-mix(in_srgb,var(--surface-shell)_88%,transparent)] px-2"
    >
      {tabs.map((tab) => {
        const isActive = tab.path === activePath;
        const contextItems: ContextActionMenuItem[] = [
          {
            label: "Activate Tab",
            icon: <FileText size={14} />,
            disabled: isActive,
            onSelect: () => onActivate(tab.path),
          },
          { separator: true },
          {
            label: "Copy Relative Path",
            icon: <Copy size={14} />,
            onSelect: () =>
              void writeClipboardTextWithFallback(
                relativeProjectPath(tab.path, projectPath),
              ),
          },
          {
            label: "Copy Absolute Path",
            icon: <Copy size={14} />,
            onSelect: () => void writeClipboardTextWithFallback(tab.path),
          },
          { separator: true },
          {
            label: "Close Tab",
            icon: <X size={14} />,
            hidden: !onClose,
            onSelect: () => onClose?.(tab.path),
          },
          {
            label: "Close Others",
            icon: <X size={14} />,
            hidden: !onCloseOthers,
            disabled: tabs.length <= 1,
            onSelect: () => onCloseOthers?.(tab.path),
          },
        ];

        return (
          <ContextActionMenu
            key={tab.path}
            items={contextItems}
            nativeScope="code-panel-tab"
            nativeTargetId={tab.path}
            nativeContext={{ path: tab.path, projectPath }}
          >
            <button
              type="button"
              data-testid={getCodePanelTabTestId(tab.path)}
              title={tab.path}
              className={codePanelTabClassName}
              style={getCodePanelTabStyle(isActive)}
              onPointerDown={(event) => handleTabPointerDown(tab, event)}
              onClick={() => {
                if (suppressClickRef.current) {
                  return;
                }
                onActivate(tab.path);
              }}
            >
              {tab.name}
            </button>
          </ContextActionMenu>
        );
      })}
      <DragGhost ghost={dragGhost} />
    </div>
  );
};
