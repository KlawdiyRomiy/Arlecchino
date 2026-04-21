import React, { useState, useRef, useCallback, useEffect } from "react";
import { X, Pin, Maximize2 } from "lucide-react";
import { useIndexingProgress } from "../../hooks/useIndexingProgress";
import { useProjectDiagnosticsPreload } from "../../utils/projectBoundState";

export type PanelPosition = "left" | "right" | "bottom" | "top";

export interface PanelSize {
  width: number;
  height: number;
}

export interface FloatingPanelProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  position: PanelPosition;
  size: PanelSize;
  minSize?: number;
  maxSize?: number;
  onClose?: () => void;
  onResize?: (updates: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  }) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: (
    id: string,
    targetPosition: PanelPosition | null,
    dropX?: number,
    dropY?: number,
    dropWidth?: number,
    dropHeight?: number,
  ) => void;
  headerExtra?: React.ReactNode;
  isDropTarget?: boolean;
  adjacentPanels?: {
    left?: number;
    right?: number;
    bottom?: number;
    top?: number;
  };
  mode?: "snapped" | "floating";
  x?: number;
  y?: number;
  isPinned?: boolean;
  onPin?: () => void;
  onFullscreen?: () => void;

  isVisible?: boolean;
  zIndex?: number;
  useViewportPositioning?: boolean;
}

export const FloatingPanel: React.FC<FloatingPanelProps> = ({
  id,
  title,
  icon,
  children,
  position,
  size,
  minSize = 150,
  maxSize = 1200,
  onClose,
  onResize,
  onDragStart,
  onDragEnd,
  headerExtra,
  isDropTarget = false,
  adjacentPanels = {},
  mode = "snapped",
  x = 0,
  y = 0,
  isPinned = false,
  onPin,
  onFullscreen,

  isVisible = true,
  zIndex: customZIndex,
  useViewportPositioning = false,
}) => {
  const indexing = useIndexingProgress();
  const diagnosticsPreload = useProjectDiagnosticsPreload();
  const reduceMotion =
    indexing.phase === "indexing" || diagnosticsPreload.active;
  const [isResizing, setIsResizing] = useState(false);
  const [resizeEdge, setResizeEdge] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const startRef = useRef({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    panelX: 0,
    panelY: 0,
  });

  const getSlideOffset = (): React.CSSProperties => {
    if (isVisible || mode === "floating") return {};
    switch (position) {
      case "left":
        return { transform: `translate3d(-${size.width}px, 0, 0)` };
      case "right":
        return { transform: `translate3d(${size.width}px, 0, 0)` };
      case "bottom":
        return { transform: `translate3d(0, ${size.height}px, 0)` };
      case "top":
        return { transform: `translate3d(0, -${size.height}px, 0)` };
      default:
        return { transform: `translate3d(-${size.width}px, 0, 0)` };
    }
  };

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, edge: string) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      setResizeEdge(edge);

      const rect = panelRef.current?.getBoundingClientRect();

      startRef.current = {
        ...startRef.current,
        x: e.clientX,
        y: e.clientY,
        width: rect?.width || size.width,
        height: rect?.height || size.height,
        panelX: rect?.left || x,
        panelY: rect?.top || y,
      };
    },
    [size, x, y],
  );

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !resizeEdge) return;

      let newWidth = startRef.current.width;
      let newHeight = startRef.current.height;
      let newX: number | undefined;
      let newY: number | undefined;

      const deltaX = e.clientX - startRef.current.x;
      const deltaY = e.clientY - startRef.current.y;

      if (resizeEdge.includes("n")) {
        const proposedHeight = startRef.current.height - deltaY;
        newHeight = Math.max(minSize, Math.min(maxSize, proposedHeight));
        const actualDeltaY = startRef.current.height - newHeight;
        newY = startRef.current.panelY + actualDeltaY;
      }
      if (resizeEdge.includes("s")) {
        newHeight = Math.max(
          minSize,
          Math.min(maxSize, startRef.current.height + deltaY),
        );
      }
      if (resizeEdge.includes("w")) {
        const proposedWidth = startRef.current.width - deltaX;
        newWidth = Math.max(minSize, Math.min(maxSize, proposedWidth));
        const actualDeltaX = startRef.current.width - newWidth;
        newX = startRef.current.panelX + actualDeltaX;
      }
      if (resizeEdge.includes("e")) {
        newWidth = Math.max(
          minSize,
          Math.min(maxSize, startRef.current.width + deltaX),
        );
      }

      onResize?.({ width: newWidth, height: newHeight, x: newX, y: newY });
    },
    [isResizing, resizeEdge, minSize, maxSize, onResize],
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setResizeEdge(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);

      let cursor = "default";
      if (resizeEdge === "n" || resizeEdge === "s") cursor = "ns-resize";
      else if (resizeEdge === "e" || resizeEdge === "w") cursor = "ew-resize";
      else if (resizeEdge === "ne" || resizeEdge === "sw")
        cursor = "nesw-resize";
      else if (resizeEdge === "nw" || resizeEdge === "se")
        cursor = "nwse-resize";

      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleResizeMove);
      document.removeEventListener("mouseup", handleResizeEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, handleResizeMove, handleResizeEnd, resizeEdge]);

  const handleDragStartInternal = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect) {
        startRef.current = {
          ...startRef.current,
          x: e.clientX,
          y: e.clientY,
          panelX: rect.left,
          panelY: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }
      setIsDragging(true);
      setDragOffset({ x: 0, y: 0 });
      // Tell global snap zones that a panel drag started
      window.dispatchEvent(new CustomEvent("panel-drag-start"));
      onDragStart?.(id);
    },
    [id, onDragStart],
  );

  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      setDragOffset({ x: dx, y: dy });
    },
    [isDragging],
  );

  const detectDropZone = useCallback(
    (x: number, y: number): PanelPosition | null => {
      const threshold = 150;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      if (y < threshold) return "top";
      if (x < threshold) return "left";
      if (x > windowWidth - threshold) return "right";
      if (y > windowHeight - threshold) return "bottom";

      return null;
    },
    [],
  );

  const handleDragEndInternal = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        const targetZone = detectDropZone(e.clientX, e.clientY);
        setIsDragging(false);
        setDragOffset({ x: 0, y: 0 });
        // Notify snap zones that dragging finished
        window.dispatchEvent(new CustomEvent("panel-drag-end"));

        const dropX =
          startRef.current.panelX + (e.clientX - startRef.current.x);
        const dropY =
          startRef.current.panelY + (e.clientY - startRef.current.y);

        onDragEnd?.(
          id,
          targetZone,
          dropX,
          dropY,
          startRef.current.width,
          startRef.current.height,
        );
      }
    },
    [isDragging, id, onDragEnd, detectDropZone],
  );

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleDragMove);
      document.addEventListener("mouseup", handleDragEndInternal);
      document.body.style.cursor = "grabbing";
    }
    return () => {
      document.removeEventListener("mousemove", handleDragMove);
      document.removeEventListener("mouseup", handleDragEndInternal);
      if (!isResizing) {
        document.body.style.cursor = "";
      }
    };
  }, [isDragging, handleDragMove, handleDragEndInternal, isResizing]);

  const getContainerStyle = (): React.CSSProperties => {
    const isSnapped = mode === "snapped";
    const isActivePanel =
      isDragging ||
      isResizing ||
      isDropTarget ||
      mode === "floating" ||
      isPinned;
    const base: React.CSSProperties = {
      position: useViewportPositioning
        ? "fixed"
        : isDragging
          ? "fixed"
          : "absolute",
      display: "flex",
      flexDirection: "column",
      backgroundColor: "var(--surface-1)",
      border: isSnapped ? "none" : "1px solid var(--border-default)",
      borderRight:
        isSnapped && position === "left"
          ? "1px solid var(--border-subtle)"
          : undefined,
      borderLeft:
        isSnapped && position === "right"
          ? "1px solid var(--border-subtle)"
          : undefined,
      borderTop:
        isSnapped && position === "bottom"
          ? "1px solid var(--border-subtle)"
          : undefined,
      borderBottom:
        isSnapped && position === "top"
          ? "1px solid var(--border-subtle)"
          : undefined,
      borderRadius: isSnapped ? 0 : "var(--radius-lg)",
      boxShadow: isSnapped
        ? "none"
        : isDragging
          ? "var(--shadow-drag)"
          : isResizing || isActivePanel
            ? "var(--shadow-overlay)"
            : "var(--shadow-soft)",
      zIndex: isDragging
        ? 140
        : (customZIndex ?? (mode === "floating" ? 90 : 50)),
      overflow: "hidden",
      pointerEvents: isVisible ? "auto" : "none",
      visibility: isVisible ? "visible" : "hidden",
      opacity: isVisible ? 1 : 0,
      willChange: isDragging || isResizing ? "transform" : "auto",
      backfaceVisibility: "hidden" as const,
      transition:
        reduceMotion || isResizing || isDragging
          ? "none"
          : isVisible
            ? "transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s ease-out, box-shadow 0.18s ease, border-color 0.18s ease"
            : "transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.12s ease-in, visibility 0s linear 0.18s",
      ...getSlideOffset(),
    };

    if (isDropTarget) {
      base.border = "1px solid var(--accent-brand)";
      base.boxShadow =
        "inset 0 0 0 1px var(--accent-brand), inset 0 0 0 999px color-mix(in srgb, var(--accent-brand) 6%, transparent), var(--shadow-overlay)";
    } else if (!isSnapped && !isActivePanel) {
      base.border = "1px solid var(--border-subtle)";
    }

    if (isDragging) {
      // Use saved dimensions from drag start to maintain shape
      return {
        ...base,
        left: startRef.current.panelX + dragOffset.x,
        top: startRef.current.panelY + dragOffset.y,
        width: startRef.current.width,
        height: startRef.current.height,
        pointerEvents: "none",
      };
    }

    if (mode === "floating") {
      return {
        ...base,
        left: x,
        top: y,
        width: size.width,
        height: size.height,
      };
    }

    const gap = 0;
    const bottomPanelHeight = adjacentPanels.bottom || 0;
    const topPanelHeight = adjacentPanels.top || 0;
    const leftPanelWidth = adjacentPanels.left || 0;
    const rightPanelWidth = adjacentPanels.right || 0;

    switch (position) {
      case "left":
        return {
          ...base,
          left: gap,
          top: gap,
          bottom: gap,
          width: size.width,
        };
      case "right":
        return {
          ...base,
          right: gap,
          top: gap,
          bottom: gap,
          width: size.width,
        };
      case "bottom":
        return {
          ...base,
          left: leftPanelWidth > 0 ? leftPanelWidth : gap,
          right: rightPanelWidth > 0 ? rightPanelWidth : gap,
          bottom: gap,
          height: size.height,
        };
      case "top":
        return {
          ...base,
          left: leftPanelWidth > 0 ? leftPanelWidth : gap,
          right: rightPanelWidth > 0 ? rightPanelWidth : gap,
          top: gap,
          height: size.height,
        };
    }
  };

  const edgeStyle = (edge: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: "absolute",
      zIndex: 10,
      backgroundColor: "transparent",
    };

    const isFloating = mode === "floating";
    const edgeSize = "14px";
    const cornerSize = "20px";
    const offset = isFloating ? "-7px" : "0";

    switch (edge) {
      case "n":
        return {
          ...base,
          left: cornerSize,
          right: cornerSize,
          top: offset,
          height: edgeSize,
          cursor: "ns-resize",
        };
      case "s":
        return {
          ...base,
          left: cornerSize,
          right: cornerSize,
          bottom: offset,
          height: edgeSize,
          cursor: "ns-resize",
        };
      case "e":
        return {
          ...base,
          top: cornerSize,
          bottom: cornerSize,
          right: offset,
          width: edgeSize,
          cursor: "ew-resize",
        };
      case "w":
        return {
          ...base,
          top: cornerSize,
          bottom: cornerSize,
          left: offset,
          width: edgeSize,
          cursor: "ew-resize",
        };
      case "ne":
        return {
          ...base,
          top: offset,
          right: offset,
          width: cornerSize,
          height: cornerSize,
          cursor: "nesw-resize",
        };
      case "nw":
        return {
          ...base,
          top: offset,
          left: offset,
          width: cornerSize,
          height: cornerSize,
          cursor: "nwse-resize",
        };
      case "se":
        return {
          ...base,
          bottom: offset,
          right: offset,
          width: cornerSize,
          height: cornerSize,
          cursor: "nwse-resize",
        };
      case "sw":
        return {
          ...base,
          bottom: offset,
          left: offset,
          width: cornerSize,
          height: cornerSize,
          cursor: "nesw-resize",
        };
      default:
        return base;
    }
  };

  const isSnappedPanel = mode === "snapped";
  const panelState = isDragging
    ? "dragging"
    : isResizing
      ? "resizing"
      : isDropTarget
        ? "drop-target"
        : isVisible
          ? mode === "floating"
            ? "floating"
            : "docked"
          : "hidden";
  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "38px",
    padding: "0 16px",
    backgroundColor: "var(--surface-panel-header)",
    borderBottom: "1px solid var(--border-subtle)",
    borderTopLeftRadius: isSnappedPanel ? 0 : 14,
    borderTopRightRadius: isSnappedPanel ? 0 : 14,
    userSelect: "none",
    flexShrink: 0,
    cursor:
      mode === "floating" ? (isDragging ? "grabbing" : "grab") : "default",
    boxShadow: isSnappedPanel
      ? "inset 0 -1px 0 rgba(255,255,255,0.02)"
      : "inset 0 1px 0 rgba(255,255,255,0.02)",
  };

  const titleStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "10px",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    pointerEvents: "none",
  };

  const controlsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  };

  const closeButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: 6,
    border: "1px solid var(--border-subtle)",
    backgroundColor: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    transition:
      "background-color 150ms ease, color 150ms ease, transform 120ms ease, border-color 150ms ease",
  };

  const contentStyle: React.CSSProperties = {
    flex: 1,
    overflow: "hidden",
    minHeight: 0,
    minWidth: 0,
  };

  return (
    <div
      ref={panelRef}
      style={getContainerStyle()}
      className={mode === "floating" ? "backdrop-blur-panel" : undefined}
      data-testid={`panel-${id}`}
      data-panel-id={id}
      data-panel-position={position}
      data-panel-state={panelState}
    >
      {mode === "floating" ? (
        <>
          <div
            style={edgeStyle("n")}
            onMouseDown={(e) => handleResizeStart(e, "n")}
          />
          <div
            style={edgeStyle("s")}
            onMouseDown={(e) => handleResizeStart(e, "s")}
          />
          <div
            style={edgeStyle("e")}
            onMouseDown={(e) => handleResizeStart(e, "e")}
          />
          <div
            style={edgeStyle("w")}
            onMouseDown={(e) => handleResizeStart(e, "w")}
          />
          <div
            style={edgeStyle("ne")}
            onMouseDown={(e) => handleResizeStart(e, "ne")}
          />
          <div
            style={edgeStyle("nw")}
            onMouseDown={(e) => handleResizeStart(e, "nw")}
          />
          <div
            style={edgeStyle("se")}
            onMouseDown={(e) => handleResizeStart(e, "se")}
          />
          <div
            style={edgeStyle("sw")}
            onMouseDown={(e) => handleResizeStart(e, "sw")}
          />
        </>
      ) : (
        <>
          {position === "left" && (
            <div
              style={edgeStyle("e")}
              onMouseDown={(e) => handleResizeStart(e, "e")}
            />
          )}
          {position === "right" && (
            <div
              style={edgeStyle("w")}
              onMouseDown={(e) => handleResizeStart(e, "w")}
            />
          )}
          {position === "top" && (
            <div
              style={edgeStyle("s")}
              onMouseDown={(e) => handleResizeStart(e, "s")}
            />
          )}
          {position === "bottom" && (
            <div
              style={edgeStyle("n")}
              onMouseDown={(e) => handleResizeStart(e, "n")}
            />
          )}
        </>
      )}

      <div
        style={headerStyle}
        onMouseDown={mode === "floating" ? handleDragStartInternal : undefined}
      >
        <div style={titleStyle}>
          {icon}
          <span>{title}</span>
        </div>

        <div style={controlsStyle}>
          {headerExtra}

          {onFullscreen && (
            <button
              style={closeButtonStyle}
              className="panel-control-button topbar-control-button"
              onClick={(e) => {
                e.stopPropagation();
                onFullscreen();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title="Полный экран"
            >
              <Maximize2 size={14} />
            </button>
          )}

          {onPin && (
            <button
              style={{
                ...closeButtonStyle,
                transform: isPinned ? "rotate(45deg)" : undefined,
              }}
              className={`panel-control-button topbar-control-button ${
                isPinned ? "panel-control-button-accent" : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onPin();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title={isPinned ? "Открепить панель" : "Закрепить панель"}
            >
              <Pin size={14} />
            </button>
          )}

          {onClose && (
            <button
              style={closeButtonStyle}
              className="panel-control-button panel-control-button-danger topbar-control-button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title="Закрыть панель"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div style={contentStyle}>{children}</div>
    </div>
  );
};

export default FloatingPanel;
