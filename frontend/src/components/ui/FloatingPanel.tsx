import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  motion,
  type MotionStyle,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";
import { X, Pin, Maximize2 } from "lucide-react";
import { useIndexingProgress } from "../../hooks/useIndexingProgress";
import { useProjectDiagnosticsPreload } from "../../utils/projectBoundState";
import { SNAPPED_PANEL_OUTER_GAP } from "../../utils/layoutHelpers";
import {
  getEffectiveUiScale,
  logicalToScreenPixels,
  screenToLogicalPixels,
} from "../../utils/logicalViewport";

export type PanelPosition = "left" | "right" | "bottom" | "top";

export interface PanelSize {
  width: number;
  height: number;
}

interface PanelBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const FLOATING_PANEL_LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 520,
  damping: 46,
  mass: 0.7,
  restDelta: 0.4,
  restSpeed: 0.4,
} as const;

export const FLOATING_PANEL_LAYOUT_TRANSITION_MS = 300;
const FLOATING_PANEL_FLOATING_SLIDE_OFFSET = 32;
const FLOATING_PANEL_EXIT_OVERSHOOT_MIN = 96;
const FLOATING_PANEL_EXIT_OVERSHOOT_RATIO = 0.28;
const FLOATING_PANEL_NO_MOTION_TRANSITION = { duration: 0 } as const;
const FLOATING_PANEL_DROP_PREVIEW_WIDTH = 150;
const FLOATING_PANEL_DROP_PREVIEW_HEIGHT = 100;
const FLOATING_PANEL_DROP_HIT_EXPANSION = 72;
const FLOATING_PANEL_DROP_HIT_WIDTH =
  FLOATING_PANEL_DROP_PREVIEW_WIDTH + FLOATING_PANEL_DROP_HIT_EXPANSION;
const FLOATING_PANEL_DROP_HIT_HEIGHT =
  FLOATING_PANEL_DROP_PREVIEW_HEIGHT + FLOATING_PANEL_DROP_HIT_EXPANSION;

const getSlideVectorForEdge = (
  edge: PanelPosition,
  distance: number = FLOATING_PANEL_FLOATING_SLIDE_OFFSET,
): { x: number; y: number } => {
  switch (edge) {
    case "left":
      return { x: -distance, y: 0 };
    case "right":
      return { x: distance, y: 0 };
    case "bottom":
      return { x: 0, y: distance };
    case "top":
    default:
      return { x: 0, y: -distance };
  }
};

const getSnappedSlideDistance = (
  edge: PanelPosition,
  size: PanelSize,
): number =>
  Math.max(
    FLOATING_PANEL_FLOATING_SLIDE_OFFSET,
    edge === "left" || edge === "right" ? size.width : size.height,
  );

const getSnappedExitSlideDistance = (
  edge: PanelPosition,
  size: PanelSize,
): number => {
  const distance = getSnappedSlideDistance(edge, size);
  return (
    distance +
    Math.max(
      FLOATING_PANEL_EXIT_OVERSHOOT_MIN,
      distance * FLOATING_PANEL_EXIT_OVERSHOOT_RATIO,
    )
  );
};

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
  onResizeStart?: (id: string) => void;
  onResizeEnd?: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragMove?: (id: string, targetPosition: PanelPosition | null) => void;
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
  hostMode?: "overlay" | "flow";
  uiScale?: number;
  isFullscreen?: boolean;
  activeDropTargetPosition?: PanelPosition | null;
  isRelocating?: boolean;
  zenModeEnabled?: boolean;
  isZenPinned?: boolean;
  onZenPinToggle?: (id: string) => void;
}

export const FloatingPanel = React.forwardRef<
  HTMLDivElement,
  FloatingPanelProps
>(
  (
    {
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
      onResizeStart,
      onResizeEnd,
      onDragStart,
      onDragMove,
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
      hostMode = "overlay",
      uiScale,
      isFullscreen = false,
      activeDropTargetPosition = null,
      isRelocating = false,
      zenModeEnabled = false,
      isZenPinned = false,
      onZenPinToggle,
    },
    forwardedRef,
  ) => {
    const effectiveUiScale = getEffectiveUiScale(uiScale);
    const indexing = useIndexingProgress();
    const diagnosticsPreload = useProjectDiagnosticsPreload();
    const prefersReducedMotion = useReducedMotion();
    const reduceMotion =
      prefersReducedMotion ||
      indexing.phase === "indexing" ||
      diagnosticsPreload.active;
    const isPresent = useIsPresent();
    const [isResizing, setIsResizing] = useState(false);
    const [resizeEdge, setResizeEdge] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [hasEntered, setHasEntered] = useState(
      reduceMotion || mode === "floating",
    );
    const panelRef = useRef<HTMLDivElement>(null);
    const latestBoundsRef = useRef<PanelBounds | null>(null);
    const latestDragOffsetRef = useRef({ x: 0, y: 0 });
    const resizeFrameRef = useRef<number | null>(null);
    const pendingResizeRef = useRef<{
      width: number;
      height: number;
      x?: number;
      y?: number;
    } | null>(null);
    const onResizeRef = useRef(onResize);
    const onResizeStartRef = useRef(onResizeStart);
    const onResizeEndRef = useRef(onResizeEnd);
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);
    const startRef = useRef({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      panelX: 0,
      panelY: 0,
    });

    useEffect(() => {
      if (reduceMotion || mode === "floating") {
        setHasEntered(true);
      }
    }, [mode, reduceMotion]);

    useEffect(() => {
      onResizeRef.current = onResize;
      onResizeStartRef.current = onResizeStart;
      onResizeEndRef.current = onResizeEnd;
    }, [onResize, onResizeEnd, onResizeStart]);

    useLayoutEffect(() => {
      if (isDragging || isResizing) {
        return;
      }

      const node = panelRef.current;
      if (!node) {
        return;
      }

      const rect = node.getBoundingClientRect();
      latestBoundsRef.current = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }, [
      hostMode,
      isDragging,
      isResizing,
      mode,
      position,
      size.height,
      size.width,
      x,
      y,
    ]);

    const setPanelNode = useCallback(
      (node: HTMLDivElement | null) => {
        panelRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
          return;
        }
        if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    const isLogicalFullscreen = useCallback(() => {
      if (isFullscreen) {
        return true;
      }

      if (typeof window === "undefined" || mode !== "floating") {
        return false;
      }

      const logicalViewportWidth = screenToLogicalPixels(
        window.innerWidth,
        effectiveUiScale,
      );
      const logicalViewportHeight = screenToLogicalPixels(
        window.innerHeight,
        effectiveUiScale,
      );

      return (
        Math.abs(x) <= 1 &&
        Math.abs(y) <= 1 &&
        size.width >= logicalViewportWidth - 1 &&
        size.height >= logicalViewportHeight - 1
      );
    }, [effectiveUiScale, isFullscreen, mode, size.height, size.width, x, y]);

    const getSlideVector = useCallback(() => {
      if (reduceMotion || isLogicalFullscreen()) {
        return { x: 0, y: 0 };
      }

      return getSlideVectorForEdge(
        position,
        getSnappedSlideDistance(position, size),
      );
    }, [isLogicalFullscreen, position, reduceMotion, size]);

    const getExitSlideVector = useCallback(() => {
      if (reduceMotion || isLogicalFullscreen()) {
        return { x: 0, y: 0 };
      }

      return getSlideVectorForEdge(
        position,
        getSnappedExitSlideDistance(position, size),
      );
    }, [isLogicalFullscreen, position, reduceMotion, size]);

    const flushResizeUpdate = useCallback(() => {
      resizeFrameRef.current = null;
      const pendingResize = pendingResizeRef.current;
      pendingResizeRef.current = null;

      if (pendingResize) {
        onResizeRef.current?.(pendingResize);
      }
    }, []);

    const scheduleResizeUpdate = useCallback(
      (updates: { width: number; height: number; x?: number; y?: number }) => {
        pendingResizeRef.current = updates;

        if (resizeFrameRef.current !== null) {
          return;
        }

        resizeFrameRef.current =
          window.requestAnimationFrame(flushResizeUpdate);
      },
      [flushResizeUpdate],
    );

    const handleResizeStart = useCallback(
      (e: React.MouseEvent, edge: string) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        setResizeEdge(edge);

        const rect = panelRef.current?.getBoundingClientRect();
        panelRef.current
          ?.querySelector<HTMLElement>('[data-panel-content="true"]')
          ?.style.setProperty("pointer-events", "none");

        startRef.current = {
          ...startRef.current,
          x: e.clientX,
          y: e.clientY,
          width:
            rect?.width || logicalToScreenPixels(size.width, effectiveUiScale),
          height:
            rect?.height ||
            logicalToScreenPixels(size.height, effectiveUiScale),
          panelX: rect?.left || logicalToScreenPixels(x, effectiveUiScale),
          panelY: rect?.top || logicalToScreenPixels(y, effectiveUiScale),
        };
        onResizeStartRef.current?.(id);
      },
      [effectiveUiScale, id, size, x, y],
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
          newHeight = Math.max(
            logicalToScreenPixels(minSize, effectiveUiScale),
            Math.min(
              logicalToScreenPixels(maxSize, effectiveUiScale),
              proposedHeight,
            ),
          );
          const actualDeltaY = startRef.current.height - newHeight;
          newY = startRef.current.panelY + actualDeltaY;
        }
        if (resizeEdge.includes("s")) {
          newHeight = Math.max(
            logicalToScreenPixels(minSize, effectiveUiScale),
            Math.min(
              logicalToScreenPixels(maxSize, effectiveUiScale),
              startRef.current.height + deltaY,
            ),
          );
        }
        if (resizeEdge.includes("w")) {
          const proposedWidth = startRef.current.width - deltaX;
          newWidth = Math.max(
            logicalToScreenPixels(minSize, effectiveUiScale),
            Math.min(
              logicalToScreenPixels(maxSize, effectiveUiScale),
              proposedWidth,
            ),
          );
          const actualDeltaX = startRef.current.width - newWidth;
          newX = startRef.current.panelX + actualDeltaX;
        }
        if (resizeEdge.includes("e")) {
          newWidth = Math.max(
            logicalToScreenPixels(minSize, effectiveUiScale),
            Math.min(
              logicalToScreenPixels(maxSize, effectiveUiScale),
              startRef.current.width + deltaX,
            ),
          );
        }

        scheduleResizeUpdate({
          width: screenToLogicalPixels(newWidth, effectiveUiScale),
          height: screenToLogicalPixels(newHeight, effectiveUiScale),
          x:
            typeof newX === "number"
              ? screenToLogicalPixels(newX, effectiveUiScale)
              : undefined,
          y:
            typeof newY === "number"
              ? screenToLogicalPixels(newY, effectiveUiScale)
              : undefined,
        });
      },
      [
        effectiveUiScale,
        isResizing,
        maxSize,
        minSize,
        resizeEdge,
        scheduleResizeUpdate,
      ],
    );

    const handleResizeEnd = useCallback(() => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        flushResizeUpdate();
      }
      setIsResizing(false);
      setResizeEdge(null);
      panelRef.current
        ?.querySelector<HTMLElement>('[data-panel-content="true"]')
        ?.style.removeProperty("pointer-events");
      onResizeEndRef.current?.(id);
    }, [flushResizeUpdate, id]);

    useEffect(() => {
      return () => {
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }
      };
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
        if (
          zenModeEnabled &&
          mode === "snapped" &&
          e.button === 0 &&
          e.metaKey &&
          onZenPinToggle
        ) {
          e.preventDefault();
          e.stopPropagation();
          onZenPinToggle(id);
          return;
        }

        e.preventDefault();
        const rect = panelRef.current?.getBoundingClientRect();
        startRef.current = {
          ...startRef.current,
          x: e.clientX,
          y: e.clientY,
          panelX: rect ? screenToLogicalPixels(rect.left, effectiveUiScale) : x,
          panelY: rect ? screenToLogicalPixels(rect.top, effectiveUiScale) : y,
          width: rect
            ? screenToLogicalPixels(rect.width, effectiveUiScale)
            : size.width,
          height: rect
            ? screenToLogicalPixels(rect.height, effectiveUiScale)
            : size.height,
        };
        setIsDragging(true);
        latestDragOffsetRef.current = { x: 0, y: 0 };
        dragX.set(0);
        dragY.set(0);
        // Tell global snap zones that a panel drag started
        window.dispatchEvent(new CustomEvent("panel-drag-start"));
        onDragStart?.(id);
      },
      [
        dragX,
        dragY,
        effectiveUiScale,
        id,
        mode,
        onDragStart,
        onZenPinToggle,
        size.height,
        size.width,
        x,
        y,
        zenModeEnabled,
      ],
    );

    const detectDropZone = useCallback(
      (x: number, y: number): PanelPosition | null => {
        const horizontalThreshold = logicalToScreenPixels(
          FLOATING_PANEL_DROP_HIT_WIDTH,
          effectiveUiScale,
        );
        const verticalThreshold = logicalToScreenPixels(
          FLOATING_PANEL_DROP_HIT_HEIGHT,
          effectiveUiScale,
        );
        const edgeGap = logicalToScreenPixels(
          SNAPPED_PANEL_OUTER_GAP,
          effectiveUiScale,
        );
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const candidates: Array<{
          position: PanelPosition;
          distance: number;
        }> = [];

        if (x <= horizontalThreshold + edgeGap) {
          candidates.push({ position: "left", distance: x });
        }
        if (x >= windowWidth - horizontalThreshold - edgeGap) {
          candidates.push({ position: "right", distance: windowWidth - x });
        }
        if (y <= verticalThreshold + edgeGap) {
          candidates.push({ position: "top", distance: y });
        }
        if (y >= windowHeight - verticalThreshold - edgeGap) {
          candidates.push({ position: "bottom", distance: windowHeight - y });
        }

        candidates.sort((left, right) => left.distance - right.distance);
        return candidates[0]?.position ?? null;
      },
      [effectiveUiScale],
    );

    const handleDragMove = useCallback(
      (e: MouseEvent) => {
        if (!isDragging) return;
        const dx = screenToLogicalPixels(
          e.clientX - startRef.current.x,
          effectiveUiScale,
        );
        const dy = screenToLogicalPixels(
          e.clientY - startRef.current.y,
          effectiveUiScale,
        );
        latestDragOffsetRef.current = { x: dx, y: dy };
        dragX.set(dx);
        dragY.set(dy);
        onDragMove?.(id, detectDropZone(e.clientX, e.clientY));
      },
      [
        detectDropZone,
        dragX,
        dragY,
        effectiveUiScale,
        id,
        isDragging,
        onDragMove,
      ],
    );

    const handleDragEndInternal = useCallback(
      (e: MouseEvent) => {
        if (isDragging) {
          const targetZone = detectDropZone(e.clientX, e.clientY);
          const dropX = startRef.current.panelX + latestDragOffsetRef.current.x;
          const dropY = startRef.current.panelY + latestDragOffsetRef.current.y;

          onDragEnd?.(
            id,
            targetZone,
            dropX,
            dropY,
            startRef.current.width,
            startRef.current.height,
          );

          latestDragOffsetRef.current = { x: 0, y: 0 };
          dragX.set(0);
          dragY.set(0);
          setIsDragging(false);
          // Notify snap zones that dragging finished after the final drop state
          // has been calculated, avoiding a one-frame snap-back.
          window.dispatchEvent(new CustomEvent("panel-drag-end"));
        }
      },
      [detectDropZone, dragX, dragY, id, isDragging, onDragEnd],
    );

    useEffect(() => {
      if (isDragging) {
        document.addEventListener("mousemove", handleDragMove);
        document.addEventListener("mouseup", handleDragEndInternal);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      return () => {
        document.removeEventListener("mousemove", handleDragMove);
        document.removeEventListener("mouseup", handleDragEndInternal);
        if (!isResizing) {
          document.body.style.cursor = "";
        }
        document.body.style.userSelect = "";
      };
    }, [isDragging, handleDragMove, handleDragEndInternal, isResizing]);

    const getContainerStyle = (): React.CSSProperties => {
      const isSnapped = mode === "snapped";
      const isFlowHosted = isSnapped && hostMode === "flow" && !isDragging;
      const isActivePanel =
        isDragging ||
        isResizing ||
        isDropTarget ||
        isRelocating ||
        mode === "floating" ||
        isPinned;
      const shouldPromoteForMotion =
        mode === "snapped" && !reduceMotion && (!hasEntered || !isPresent);
      const panelFrameRadius = "var(--radius-lg)";
      const base: React.CSSProperties = {
        position: isFlowHosted
          ? "relative"
          : useViewportPositioning
            ? "fixed"
            : isDragging
              ? "fixed"
              : "absolute",
        display: "flex",
        flexDirection: "column",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--surface-shell-soft) 97%, transparent), color-mix(in srgb, var(--surface-shell-panel) 99%, transparent))",
        border: "1px solid var(--shell-border)",
        borderRadius: panelFrameRadius,
        boxShadow: isSnapped
          ? isActivePanel
            ? "var(--shell-shadow-active)"
            : "var(--shell-shadow)"
          : isDragging
            ? "var(--shadow-drag)"
            : isResizing || isActivePanel
              ? "var(--shell-shadow-active)"
              : "var(--shell-shadow)",
        zIndex: isDragging
          ? 140
          : isRelocating
            ? 130
            : (customZIndex ?? (mode === "floating" ? 90 : 50)),
        overflow: "hidden",
        isolation: "isolate",
        pointerEvents: isPresent && isVisible ? "auto" : "none",
        willChange: isDragging
          ? "transform"
          : isResizing
            ? "width, height"
            : isRelocating
              ? "transform, opacity"
              : shouldPromoteForMotion
                ? "transform"
                : "auto",
        backfaceVisibility: "hidden" as const,
        transition:
          reduceMotion || isResizing || isDragging
            ? "none"
            : "box-shadow 0.18s ease, border-color 0.18s ease",
      };

      if (isDropTarget) {
        base.border = "1px solid var(--accent-brand)";
        base.boxShadow =
          "inset 0 0 0 1px var(--accent-brand), inset 0 0 0 999px color-mix(in srgb, var(--accent-brand) 6%, transparent), var(--shadow-overlay)";
      } else if (!isActivePanel) {
        base.border = "1px solid var(--shell-border)";
      } else {
        base.border = "1px solid var(--shell-border-strong)";
      }

      if (isDragging) {
        // Use saved dimensions from drag start to maintain shape
        return {
          ...base,
          left: startRef.current.panelX,
          top: startRef.current.panelY,
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

      if (isFlowHosted) {
        const exitingBounds = latestBoundsRef.current;
        if (!isPresent && exitingBounds) {
          const flowExitAnchor: React.CSSProperties =
            position === "right"
              ? { right: 0, top: 0 }
              : position === "bottom"
                ? { left: 0, bottom: 0 }
                : { left: 0, top: 0 };

          return {
            ...base,
            position: "absolute",
            width: exitingBounds.width,
            height: exitingBounds.height,
            minWidth: exitingBounds.width,
            minHeight: exitingBounds.height,
            ...flowExitAnchor,
          };
        }

        if (isPresent && !hasEntered && !reduceMotion) {
          const enteringFrame: React.CSSProperties =
            position === "left"
              ? {
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: size.width,
                }
              : position === "right"
                ? {
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: size.width,
                  }
                : position === "bottom"
                  ? {
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: size.height,
                    }
                  : {
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      height: size.height,
                    };

          return {
            ...base,
            ...enteringFrame,
            minWidth:
              position === "left" || position === "right" ? size.width : 0,
            minHeight:
              position === "top" || position === "bottom" ? size.height : 0,
          };
        }

        return {
          ...base,
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
        };
      }

      const gap = SNAPPED_PANEL_OUTER_GAP;
      const leftPanelWidth = adjacentPanels.left || 0;
      const rightPanelWidth = adjacentPanels.right || 0;
      const topPanelHeight = adjacentPanels.top || 0;
      const bottomPanelHeight = adjacentPanels.bottom || 0;

      switch (position) {
        case "left":
          return {
            ...base,
            left: gap,
            top: topPanelHeight > 0 ? topPanelHeight : gap,
            bottom: bottomPanelHeight > 0 ? bottomPanelHeight : gap,
            width: size.width,
          };
        case "right":
          return {
            ...base,
            right: gap,
            top: topPanelHeight > 0 ? topPanelHeight : gap,
            bottom: bottomPanelHeight > 0 ? bottomPanelHeight : gap,
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
        zIndex: 30,
        backgroundColor: "transparent",
        pointerEvents: "auto",
        touchAction: "none",
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

    const interactionMotionDisabled = isDragging || isResizing;
    const slideMotionEnabled = !reduceMotion && !interactionMotionDisabled;
    const snappedSlideMotionEnabled = slideMotionEnabled && mode === "snapped";
    const shouldResolveSlideVector =
      snappedSlideMotionEnabled && !isRelocating && (!isPresent || !hasEntered);
    const slideVector = shouldResolveSlideVector
      ? getSlideVector()
      : { x: 0, y: 0 };
    const slideMotionTarget = { x: 0, y: 0 };
    const exitSlideVector =
      snappedSlideMotionEnabled && !isRelocating
        ? getExitSlideVector()
        : slideMotionTarget;
    const panelMotionState = isRelocating
      ? "relocating"
      : !isPresent
        ? "exit"
        : snappedSlideMotionEnabled && !hasEntered
          ? "enter"
          : "settled";
    const panelState = !isPresent
      ? "exiting"
      : isDragging
        ? "dragging"
        : isResizing
          ? "resizing"
          : isDropTarget
            ? "drop-target"
            : mode === "floating"
              ? "floating"
              : "docked";
    const motionTransition = snappedSlideMotionEnabled
      ? FLOATING_PANEL_LAYOUT_TRANSITION
      : FLOATING_PANEL_NO_MOTION_TRANSITION;
    const slideMotionExit = isRelocating
      ? {
          opacity: 0,
          x: 0,
          y: 0,
          transition: FLOATING_PANEL_NO_MOTION_TRANSITION,
        }
      : snappedSlideMotionEnabled
        ? { x: exitSlideVector.x, y: exitSlideVector.y }
        : slideMotionTarget;
    const flowLayoutMotionEnabled =
      mode === "snapped" && hostMode === "flow" && !isDragging && !isResizing;
    const containerMotionStyle: MotionStyle = isDragging
      ? {
          ...(getContainerStyle() as MotionStyle),
          x: dragX,
          y: dragY,
        }
      : (getContainerStyle() as MotionStyle);
    const headerStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "40px",
      padding: "0 14px",
      background:
        "linear-gradient(180deg, color-mix(in srgb, var(--surface-shell-strong) 95%, transparent), color-mix(in srgb, var(--surface-shell) 98%, transparent))",
      borderBottom: "1px solid var(--shell-border)",
      userSelect: "none",
      flexShrink: 0,
      position: "relative",
      zIndex: 20,
      cursor: isDragging ? "grabbing" : "grab",
      boxShadow: "inset 0 1px 0 var(--shell-inner-highlight)",
    };

    const titleStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "11px",
      fontWeight: 600,
      color: "var(--text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.12em",
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
      borderRadius: 9999,
      border: "1px solid transparent",
      backgroundColor: "transparent",
      color: "var(--text-secondary)",
      cursor: "pointer",
      transition:
        "background-color 150ms ease, color 150ms ease, transform 120ms ease, border-color 150ms ease",
    };

    const contentStyle: React.CSSProperties = {
      flex: 1,
      overflow: "hidden",
      minHeight: 0,
      minWidth: 0,
      position: "relative",
      zIndex: 0,
      pointerEvents: isResizing ? "none" : "auto",
    };

    const renderResizeHandle = (edge: string) => (
      <div
        key={edge}
        data-testid={`panel-${id}-resize-${edge}`}
        style={edgeStyle(edge)}
        onMouseDown={(e) => handleResizeStart(e, edge)}
      />
    );

    return (
      <motion.div
        ref={setPanelNode}
        layout={flowLayoutMotionEnabled ? "position" : false}
        layoutId={flowLayoutMotionEnabled ? `floating-panel-${id}` : undefined}
        initial={
          snappedSlideMotionEnabled && !isRelocating
            ? {
                x: slideVector.x,
                y: slideVector.y,
              }
            : false
        }
        animate={isDragging ? undefined : slideMotionTarget}
        exit={slideMotionExit}
        transition={motionTransition}
        onAnimationComplete={() => {
          if (isPresent && !hasEntered) {
            setHasEntered(true);
          }
        }}
        style={containerMotionStyle}
        data-testid={`panel-${id}`}
        data-panel-id={id}
        data-panel-position={position}
        data-panel-state={panelState}
        data-panel-motion={panelMotionState}
        data-panel-relocating={isRelocating ? "true" : "false"}
        data-panel-zen-pinned={isZenPinned ? "true" : "false"}
      >
        {mode === "floating" ? (
          <>
            {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(
              renderResizeHandle,
            )}
          </>
        ) : (
          <>
            {position === "left" && renderResizeHandle("e")}
            {position === "right" && renderResizeHandle("w")}
            {position === "top" && renderResizeHandle("s")}
            {position === "bottom" && renderResizeHandle("n")}
          </>
        )}

        <div
          style={headerStyle}
          onMouseDown={handleDragStartInternal}
          data-testid={`panel-${id}-drag-handle`}
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

        <div style={contentStyle} data-panel-content="true">
          {children}
        </div>
      </motion.div>
    );
  },
);

FloatingPanel.displayName = "FloatingPanel";

export default FloatingPanel;
