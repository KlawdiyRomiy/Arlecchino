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
  type: "tween",
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
} as const;

export const FLOATING_PANEL_LAYOUT_TRANSITION_MS = 240;
const FLOATING_PANEL_FLOATING_SLIDE_OFFSET = 32;
const FLOATING_PANEL_NO_MOTION_TRANSITION = { duration: 0 } as const;

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

const getNearestViewportEdge = (
  bounds: PanelBounds,
  viewportWidth: number,
  viewportHeight: number,
): PanelPosition => {
  const distances: Array<{ edge: PanelPosition; distance: number }> = [
    { edge: "left", distance: Math.abs(bounds.left) },
    {
      edge: "right",
      distance: Math.abs(viewportWidth - (bounds.left + bounds.width)),
    },
    { edge: "top", distance: Math.abs(bounds.top) },
    {
      edge: "bottom",
      distance: Math.abs(viewportHeight - (bounds.top + bounds.height)),
    },
  ];

  distances.sort((left, right) => left.distance - right.distance);
  return distances[0]?.edge ?? "top";
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
  hostMode?: "overlay" | "flow";
  uiScale?: number;
  isFullscreen?: boolean;
  activeDropTargetPosition?: PanelPosition | null;
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
      hostMode = "overlay",
      uiScale,
      isFullscreen = false,
      activeDropTargetPosition = null,
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
    const [hasEntered, setHasEntered] = useState(reduceMotion);
    const panelRef = useRef<HTMLDivElement>(null);
    const latestBoundsRef = useRef<PanelBounds | null>(null);
    const latestDragOffsetRef = useRef({ x: 0, y: 0 });
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
      if (reduceMotion) {
        setHasEntered(true);
      }
    }, [reduceMotion]);

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

      if (mode === "snapped") {
        return getSlideVectorForEdge(
          position,
          getSnappedSlideDistance(position, size),
        );
      }

      if (typeof window === "undefined") {
        return getSlideVectorForEdge("top");
      }

      const fallbackBounds: PanelBounds = {
        left: x,
        top: y,
        width: size.width,
        height: size.height,
      };
      const nearestEdge = getNearestViewportEdge(
        latestBoundsRef.current ?? fallbackBounds,
        window.innerWidth,
        window.innerHeight,
      );

      return getSlideVectorForEdge(nearestEdge);
    }, [
      isLogicalFullscreen,
      mode,
      position,
      reduceMotion,
      size.height,
      size.width,
      x,
      y,
    ]);

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
          width:
            rect?.width || logicalToScreenPixels(size.width, effectiveUiScale),
          height:
            rect?.height ||
            logicalToScreenPixels(size.height, effectiveUiScale),
          panelX: rect?.left || logicalToScreenPixels(x, effectiveUiScale),
          panelY: rect?.top || logicalToScreenPixels(y, effectiveUiScale),
        };
      },
      [effectiveUiScale, size, x, y],
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

        onResize?.({
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
      [effectiveUiScale, isResizing, maxSize, minSize, onResize, resizeEdge],
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
        startRef.current = {
          ...startRef.current,
          x: e.clientX,
          y: e.clientY,
          panelX: rect?.left || logicalToScreenPixels(x, effectiveUiScale),
          panelY: rect?.top || logicalToScreenPixels(y, effectiveUiScale),
          width:
            rect?.width || logicalToScreenPixels(size.width, effectiveUiScale),
          height:
            rect?.height ||
            logicalToScreenPixels(size.height, effectiveUiScale),
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
        onDragStart,
        size.height,
        size.width,
        x,
        y,
      ],
    );

    const handleDragMove = useCallback(
      (e: MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        latestDragOffsetRef.current = { x: dx, y: dy };
        dragX.set(dx);
        dragY.set(dy);
      },
      [dragX, dragY, isDragging],
    );

    const detectDropZone = useCallback(
      (x: number, y: number): PanelPosition | null => {
        const horizontalThreshold = 150;
        const verticalThreshold = 100;
        const edgeGap = SNAPPED_PANEL_OUTER_GAP;
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
      [],
    );

    const handleDragEndInternal = useCallback(
      (e: MouseEvent) => {
        if (isDragging) {
          const targetZone =
            activeDropTargetPosition ?? detectDropZone(e.clientX, e.clientY);
          const dropX = startRef.current.panelX + latestDragOffsetRef.current.x;
          const dropY = startRef.current.panelY + latestDragOffsetRef.current.y;

          onDragEnd?.(
            id,
            targetZone,
            screenToLogicalPixels(dropX, effectiveUiScale),
            screenToLogicalPixels(dropY, effectiveUiScale),
            screenToLogicalPixels(startRef.current.width, effectiveUiScale),
            screenToLogicalPixels(startRef.current.height, effectiveUiScale),
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
      [
        detectDropZone,
        activeDropTargetPosition,
        dragX,
        dragY,
        effectiveUiScale,
        id,
        isDragging,
        onDragEnd,
      ],
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
      const isFlowHosted = isSnapped && hostMode === "flow" && !isDragging;
      const isActivePanel =
        isDragging ||
        isResizing ||
        isDropTarget ||
        mode === "floating" ||
        isPinned;
      const shouldPromoteForMotion =
        !reduceMotion && (!hasEntered || !isPresent);
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
          : (customZIndex ?? (mode === "floating" ? 90 : 50)),
        overflow: "hidden",
        pointerEvents: isPresent && isVisible ? "auto" : "none",
        willChange: isDragging
          ? "transform"
          : isResizing
            ? "width, height"
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

    const interactionMotionDisabled = isDragging || isResizing;
    const slideMotionEnabled = !reduceMotion && !interactionMotionDisabled;
    const shouldResolveSlideVector =
      slideMotionEnabled && (!isPresent || !hasEntered);
    const slideVector = shouldResolveSlideVector
      ? getSlideVector()
      : { x: 0, y: 0 };
    const panelMotionState = !isPresent
      ? "exit"
      : slideMotionEnabled && !hasEntered
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
    const motionTransition = slideMotionEnabled
      ? FLOATING_PANEL_LAYOUT_TRANSITION
      : FLOATING_PANEL_NO_MOTION_TRANSITION;
    const slideMotionTarget = { x: 0, y: 0 };
    const slideMotionExit = slideMotionEnabled
      ? { x: slideVector.x, y: slideVector.y }
      : slideMotionTarget;
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
    };

    return (
      <motion.div
        ref={setPanelNode}
        layout={false}
        initial={
          slideMotionEnabled
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

        <div style={headerStyle} onMouseDown={handleDragStartInternal}>
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
      </motion.div>
    );
  },
);

FloatingPanel.displayName = "FloatingPanel";

export default FloatingPanel;
