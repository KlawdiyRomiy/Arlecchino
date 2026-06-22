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
import { flushSync } from "react-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Maximize2,
  Pin,
  X,
} from "lucide-react";
import { SNAPPED_PANEL_OUTER_GAP } from "../../utils/layoutHelpers";
import { usePerformanceStore } from "../../stores/performanceStore";
import {
  getEffectiveUiScale,
  logicalToScreenPixels,
  screenToLogicalPixels,
} from "../../utils/logicalViewport";
import { beginDragSelectionLock } from "../../utils/dragSelectionLock";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ContextActionMenu";
import { PANEL_FULLSCREEN_MOTION_TRANSITION } from "./motionContracts";
import {
  FLOATING_PANEL_LAYOUT_TRANSITION,
  FLOATING_PANEL_LAYOUT_TRANSITION_MS,
} from "./floatingPanelMotion";
import {
  beginInteractiveSurfaceMotionSession,
  markInteractiveSurfaceMotion,
} from "./interactiveSurfaceMotion";

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

interface PanelDragSession {
  captureTarget: HTMLElement | null;
  finishMotionSession: () => void;
  handlePointerCancel: (event: PointerEvent) => void;
  handlePointerMove: (event: PointerEvent) => void;
  handlePointerUp: (event: PointerEvent) => void;
  pointerId: number;
}

interface PanelResizeSession {
  captureTarget: HTMLElement | null;
  cursor: string;
  cursorOwner: string;
  edge: string;
  finishMotionSession: () => void;
  handleLostPointerCapture: (event: PointerEvent) => void;
  handlePageHide: () => void;
  handlePointerCancel: (event: PointerEvent) => void;
  handlePointerMove: (event: PointerEvent) => void;
  handlePointerUp: (event: PointerEvent) => void;
  handleVisibilityChange: () => void;
  handleWindowBlur: () => void;
  pointerId: number;
  previousCursor: string;
  previousCursorOwner: string | null;
  previousUserSelect: string;
}

const FLOATING_PANEL_FLOATING_SLIDE_OFFSET = 32;
const FLOATING_PANEL_NO_MOTION_TRANSITION = { duration: 0 } as const;
const FLOATING_PANEL_MOTION_SHADOW =
  "0 0 0 1px var(--shell-border), 0 10px 24px -22px rgba(0, 0, 0, 0.68)";
const FLOATING_PANEL_MOTION_ACTIVE_SHADOW =
  "0 0 0 1px var(--shell-border-strong), 0 12px 28px -24px rgba(0, 0, 0, 0.72)";
const FLOATING_PANEL_MOTION_DROP_SHADOW =
  "inset 0 0 0 1px var(--accent-brand), 0 0 0 1px color-mix(in srgb, var(--accent-brand) 18%, transparent)";
const FLOATING_PANEL_DROP_PREVIEW_WIDTH = 150;
const FLOATING_PANEL_DROP_PREVIEW_HEIGHT = 100;
const FLOATING_PANEL_DROP_HIT_EXPANSION = 72;
const FLOATING_PANEL_DROP_HIT_WIDTH =
  FLOATING_PANEL_DROP_PREVIEW_WIDTH + FLOATING_PANEL_DROP_HIT_EXPANSION;
const FLOATING_PANEL_DROP_HIT_HEIGHT =
  FLOATING_PANEL_DROP_PREVIEW_HEIGHT + FLOATING_PANEL_DROP_HIT_EXPANSION;
const WAILS_NO_DRAG_STYLE = {
  "--wails-draggable": "no-drag",
  WebkitAppRegion: "no-drag",
} as React.CSSProperties;
const PANEL_HEADER_NO_DRAG_SELECTOR =
  'button,input,textarea,select,[data-panel-controls="true"],[data-panel-no-drag="true"],[data-panel-resize-handle="true"]';
const BODY_CURSOR_OWNER_ATTRIBUTE = "data-arle-cursor-owner";
const warmedPanelContentIds = new Set<string>();
const PROJECTED_READABLE_SCALE_MIN = 0.05;
const PROJECTED_READABLE_SCALE_MAX = 12;

const getResizeCursor = (edge: string): string => {
  if (edge === "n" || edge === "s") return "ns-resize";
  if (edge === "e" || edge === "w") return "ew-resize";
  if (edge === "ne" || edge === "sw") return "nesw-resize";
  if (edge === "nw" || edge === "se") return "nwse-resize";
  return "default";
};

const clampProjectedReadableScale = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(
        PROJECTED_READABLE_SCALE_MAX,
        Math.max(PROJECTED_READABLE_SCALE_MIN, value),
      )
    : 1;

const parseProjectedReadableScale = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return clampProjectedReadableScale(parsed);
};

const readInlineProjectedScale = (
  node: HTMLElement,
): { x: number; y: number } => {
  const inlineScale = node.style.scale;

  if (inlineScale && inlineScale !== "none") {
    const [rawX = "1", rawY = rawX] = inlineScale.trim().split(/\s+/);
    return {
      x: parseProjectedReadableScale(rawX),
      y: parseProjectedReadableScale(rawY),
    };
  }

  const inlineTransform = node.style.transform;
  if (inlineTransform && inlineTransform !== "none") {
    try {
      const matrix = new DOMMatrixReadOnly(inlineTransform);
      return {
        x: clampProjectedReadableScale(Math.hypot(matrix.a, matrix.b) || 1),
        y: clampProjectedReadableScale(Math.hypot(matrix.c, matrix.d) || 1),
      };
    } catch {
      return { x: 1, y: 1 };
    }
  }

  return { x: 1, y: 1 };
};

const writeProjectedReadableScale = (
  node: HTMLElement,
  scale: { x: number; y: number },
) => {
  const nextScaleX = scale.x.toFixed(4);
  const nextScaleY = scale.y.toFixed(4);
  if (
    node.style.getPropertyValue("--panel-projected-scale-x") === nextScaleX &&
    node.style.getPropertyValue("--panel-projected-scale-y") === nextScaleY
  ) {
    return;
  }

  node.style.setProperty("--panel-projected-scale-x", nextScaleX);
  node.style.setProperty("--panel-projected-scale-y", nextScaleY);
  node.style.setProperty(
    "--panel-projected-inverse-scale-x",
    (1 / scale.x).toFixed(4),
  );
  node.style.setProperty(
    "--panel-projected-inverse-scale-y",
    (1 / scale.y).toFixed(4),
  );
};

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
  onMoveToPosition?: (position: PanelPosition) => void;
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
  immersiveOverlay?: boolean;
  hostMode?: "overlay" | "flow";
  snappedOverlayInsets?: { top: number; bottom: number };
  zenTopChromeAvoidanceTop?: number;
  uiScale?: number;
  isFullscreen?: boolean;
  fullscreenLayoutId?: string;
  fullscreenMotionActive?: boolean;
  preserveFullscreenLayoutIdentity?: boolean;
  isSlotExiting?: boolean;
  activeDropTargetPosition?: PanelPosition | null;
  isRelocating?: boolean;
  motionPressureActive?: boolean;
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
      onMoveToPosition,
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
      immersiveOverlay = false,
      hostMode = "overlay",
      snappedOverlayInsets,
      zenTopChromeAvoidanceTop = 0,
      uiScale,
      isFullscreen = false,
      fullscreenLayoutId,
      fullscreenMotionActive = false,
      preserveFullscreenLayoutIdentity = false,
      isSlotExiting = false,
      activeDropTargetPosition = null,
      isRelocating = false,
      motionPressureActive = false,
      zenModeEnabled = false,
      isZenPinned = false,
      onZenPinToggle,
    },
    forwardedRef,
  ) => {
    const effectiveUiScale = getEffectiveUiScale(uiScale);
    const prefersReducedMotion = useReducedMotion();
    const reduceMotion = prefersReducedMotion;
    const adaptivePerformancePaintConstrained = usePerformanceStore(
      (state) => state.mode !== "normal",
    );
    const isPresent = useIsPresent();
    const [isResizing, setIsResizing] = useState(false);
    const [resizeEdge, setResizeEdge] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [hasEntered, setHasEntered] = useState(
      reduceMotion || mode === "floating",
    );
    const [contentReady, setContentReady] = useState(
      reduceMotion || mode === "floating" || warmedPanelContentIds.has(id),
    );
    const panelRef = useRef<HTMLDivElement>(null);
    const readableLayerRef = useRef<HTMLDivElement>(null);
    const latestBoundsRef = useRef<PanelBounds | null>(null);
    const frozenExitBoundsRef = useRef<PanelBounds | null>(null);
    const latestDragOffsetRef = useRef({ x: 0, y: 0 });
    const latestDragTargetRef = useRef<PanelPosition | null>(null);
    const pendingDragTargetRef = useRef<{ x: number; y: number } | null>(null);
    const dragMoveFrameRef = useRef<number | null>(null);
    const dragSessionRef = useRef<PanelDragSession | null>(null);
    const resizeSessionRef = useRef<PanelResizeSession | null>(null);
    const resizeSessionIdRef = useRef(0);
    const lastInteractiveMotionRefreshRef = useRef(Number.NEGATIVE_INFINITY);
    const dragSelectionReleaseRef = useRef<(() => void) | null>(null);
    const metaKeyPressedRef = useRef(false);
    const isResizingRef = useRef(isResizing);
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
    const onDragStartRef = useRef(onDragStart);
    const onDragMoveRef = useRef(onDragMove);
    const onDragEndRef = useRef(onDragEnd);
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

    const refreshInteractiveMotionWindow = useCallback(() => {
      if (reduceMotion) {
        return;
      }

      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastInteractiveMotionRefreshRef.current < 120) {
        return;
      }

      lastInteractiveMotionRefreshRef.current = now;
      markInteractiveSurfaceMotion(FLOATING_PANEL_LAYOUT_TRANSITION_MS + 180);
    }, [reduceMotion]);

    useEffect(() => {
      if (reduceMotion || mode === "floating") {
        setHasEntered(true);
      }
      if (isPresent && !isSlotExiting) {
        frozenExitBoundsRef.current = null;
      }
    }, [isPresent, isSlotExiting, mode, reduceMotion]);

    useEffect(() => {
      if (
        contentReady ||
        reduceMotion ||
        mode === "floating" ||
        isRelocating ||
        !isPresent
      ) {
        if (!contentReady) {
          warmedPanelContentIds.add(id);
          setContentReady(true);
        }
        return;
      }

      const frameId = window.requestAnimationFrame(() => {
        warmedPanelContentIds.add(id);
        setContentReady(true);
      });

      return () => window.cancelAnimationFrame(frameId);
    }, [contentReady, id, isPresent, isRelocating, mode, reduceMotion]);

    useEffect(() => {
      if (hasEntered || reduceMotion || mode === "floating" || !isPresent) {
        return;
      }

      const timer = window.setTimeout(() => {
        warmedPanelContentIds.add(id);
        setHasEntered(true);
        setContentReady(true);
      }, FLOATING_PANEL_LAYOUT_TRANSITION_MS + 80);

      return () => window.clearTimeout(timer);
    }, [hasEntered, id, isPresent, mode, reduceMotion]);

    useEffect(() => {
      isResizingRef.current = isResizing;
    }, [isResizing]);

    useEffect(() => {
      onResizeRef.current = onResize;
      onResizeStartRef.current = onResizeStart;
      onResizeEndRef.current = onResizeEnd;
      onDragStartRef.current = onDragStart;
      onDragMoveRef.current = onDragMove;
      onDragEndRef.current = onDragEnd;
    }, [
      onDragEnd,
      onDragMove,
      onDragStart,
      onResize,
      onResizeEnd,
      onResizeStart,
    ]);

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Meta" || event.metaKey) {
          metaKeyPressedRef.current = true;
        }
      };
      const handleKeyUp = (event: KeyboardEvent) => {
        if (event.key === "Meta" || !event.metaKey) {
          metaKeyPressedRef.current = false;
        }
      };
      const handleBlur = () => {
        metaKeyPressedRef.current = false;
      };

      window.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("keyup", handleKeyUp, true);
      window.addEventListener("blur", handleBlur);
      return () => {
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("keyup", handleKeyUp, true);
        window.removeEventListener("blur", handleBlur);
      };
    }, []);

    const readLogicalPanelBounds = useCallback(
      (node: HTMLDivElement | null): PanelBounds | null => {
        if (!node) {
          return null;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }

        return {
          left: screenToLogicalPixels(rect.left, effectiveUiScale),
          top: screenToLogicalPixels(rect.top, effectiveUiScale),
          width: screenToLogicalPixels(rect.width, effectiveUiScale),
          height: screenToLogicalPixels(rect.height, effectiveUiScale),
        };
      },
      [effectiveUiScale],
    );

    useLayoutEffect(() => {
      if (isDragging || isResizing || isSlotExiting) {
        return;
      }

      const node = panelRef.current;
      if (!node) {
        return;
      }

      const nextBounds = readLogicalPanelBounds(node);
      if (nextBounds) {
        latestBoundsRef.current = nextBounds;
      }
    }, [
      readLogicalPanelBounds,
      hostMode,
      isDragging,
      isResizing,
      mode,
      position,
      size.height,
      size.width,
      x,
      y,
      adjacentPanels.bottom,
      adjacentPanels.left,
      adjacentPanels.right,
      adjacentPanels.top,
      isSlotExiting,
      zenTopChromeAvoidanceTop,
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

    const captureLatestBounds = useCallback(() => {
      const nextBounds = readLogicalPanelBounds(panelRef.current);
      if (nextBounds) {
        latestBoundsRef.current = nextBounds;
      }
    }, [readLogicalPanelBounds]);

    const freezeExitBounds = useCallback(() => {
      if (frozenExitBoundsRef.current) {
        return frozenExitBoundsRef.current;
      }

      const measuredBounds = readLogicalPanelBounds(panelRef.current);
      const nextBounds = measuredBounds ?? latestBoundsRef.current;
      frozenExitBoundsRef.current = nextBounds;
      return nextBounds;
    }, [readLogicalPanelBounds]);

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
        getSnappedSlideDistance(position, size),
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

    const releasePointerCapture = useCallback(
      (target: HTMLElement | null, pointerId: number) => {
        try {
          if (target?.hasPointerCapture?.(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
        } catch {
          // Synthetic pointer events used in tests may not create a browser
          // capture target; window-level listeners remain the fallback.
        }
      },
      [],
    );

    const applyResizeMove = useCallback(
      (e: PointerEvent, edge: string) => {
        let newWidth = startRef.current.width;
        let newHeight = startRef.current.height;
        let newX: number | undefined;
        let newY: number | undefined;

        const deltaX = e.clientX - startRef.current.x;
        const deltaY = e.clientY - startRef.current.y;

        if (edge.includes("n")) {
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
        if (edge.includes("s")) {
          newHeight = Math.max(
            logicalToScreenPixels(minSize, effectiveUiScale),
            Math.min(
              logicalToScreenPixels(maxSize, effectiveUiScale),
              startRef.current.height + deltaY,
            ),
          );
        }
        if (edge.includes("w")) {
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
        if (edge.includes("e")) {
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
      [effectiveUiScale, maxSize, minSize, scheduleResizeUpdate],
    );

    const finishActiveResizeSession = useCallback(() => {
      const session = resizeSessionRef.current;
      if (!session) {
        return;
      }

      resizeSessionRef.current = null;
      window.removeEventListener(
        "pointermove",
        session.handlePointerMove,
        true,
      );
      window.removeEventListener("pointerup", session.handlePointerUp, true);
      window.removeEventListener(
        "pointercancel",
        session.handlePointerCancel,
        true,
      );
      window.removeEventListener("blur", session.handleWindowBlur, true);
      window.removeEventListener("pagehide", session.handlePageHide, true);
      document.removeEventListener(
        "visibilitychange",
        session.handleVisibilityChange,
        true,
      );
      session.captureTarget?.removeEventListener(
        "lostpointercapture",
        session.handleLostPointerCapture,
      );
      releasePointerCapture(session.captureTarget, session.pointerId);
      session.finishMotionSession();

      if (resizeFrameRef.current !== null || pendingResizeRef.current) {
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }
        flushResizeUpdate();
      }

      isResizingRef.current = false;
      setIsResizing(false);
      setResizeEdge(null);
      panelRef.current
        ?.querySelector<HTMLElement>('[data-panel-content="true"]')
        ?.style.removeProperty("pointer-events");

      if (
        document.body.getAttribute(BODY_CURSOR_OWNER_ATTRIBUTE) ===
        session.cursorOwner
      ) {
        if (document.body.style.cursor === session.cursor) {
          document.body.style.cursor = session.previousCursor;
        }
        if (document.body.style.userSelect === "none") {
          document.body.style.userSelect = session.previousUserSelect;
        }
        if (session.previousCursorOwner) {
          document.body.setAttribute(
            BODY_CURSOR_OWNER_ATTRIBUTE,
            session.previousCursorOwner,
          );
        } else {
          document.body.removeAttribute(BODY_CURSOR_OWNER_ATTRIBUTE);
        }
      }

      onResizeEndRef.current?.(id);
    }, [flushResizeUpdate, id, releasePointerCapture]);

    const handleResizeStart = useCallback(
      (e: React.PointerEvent<HTMLDivElement>, edge: string) => {
        if (e.button !== 0 || !e.isPrimary) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        refreshInteractiveMotionWindow();

        if (resizeSessionRef.current) {
          finishActiveResizeSession();
        }
        if (dragSessionRef.current) {
          return;
        }

        const finishMotionSession = beginInteractiveSurfaceMotionSession(
          FLOATING_PANEL_LAYOUT_TRANSITION_MS + 180,
        );
        const pointerId = e.pointerId;
        const captureTarget = e.currentTarget;
        const cursor = getResizeCursor(edge);
        const cursorOwner = `floating-panel:${id}:resize:${++resizeSessionIdRef.current}`;

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

        try {
          captureTarget.setPointerCapture(pointerId);
        } catch {
          // Window listeners below still keep rapid resizes connected.
        }

        const handlePointerMove = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) {
            return;
          }

          event.preventDefault();
          document.getSelection()?.removeAllRanges();
          refreshInteractiveMotionWindow();
          applyResizeMove(event, edge);
        };

        const handlePointerUp = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) {
            return;
          }
          finishActiveResizeSession();
        };

        const handlePointerCancel = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) {
            return;
          }
          finishActiveResizeSession();
        };

        const handleLostPointerCapture = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) {
            return;
          }
          finishActiveResizeSession();
        };

        const handleWindowBlur = () => {
          finishActiveResizeSession();
        };

        const handlePageHide = () => {
          finishActiveResizeSession();
        };

        const handleVisibilityChange = () => {
          if (document.visibilityState === "hidden") {
            finishActiveResizeSession();
          }
        };

        resizeSessionRef.current = {
          captureTarget,
          cursor,
          cursorOwner,
          edge,
          finishMotionSession,
          handleLostPointerCapture,
          handlePageHide,
          handlePointerCancel,
          handlePointerMove,
          handlePointerUp,
          handleVisibilityChange,
          handleWindowBlur,
          pointerId,
          previousCursor: document.body.style.cursor,
          previousCursorOwner: document.body.getAttribute(
            BODY_CURSOR_OWNER_ATTRIBUTE,
          ),
          previousUserSelect: document.body.style.userSelect,
        };

        window.addEventListener("pointermove", handlePointerMove, true);
        window.addEventListener("pointerup", handlePointerUp, true);
        window.addEventListener("pointercancel", handlePointerCancel, true);
        window.addEventListener("blur", handleWindowBlur, true);
        window.addEventListener("pagehide", handlePageHide, true);
        document.addEventListener(
          "visibilitychange",
          handleVisibilityChange,
          true,
        );
        captureTarget.addEventListener(
          "lostpointercapture",
          handleLostPointerCapture,
        );

        document.body.setAttribute(BODY_CURSOR_OWNER_ATTRIBUTE, cursorOwner);
        document.body.style.cursor = cursor;
        document.body.style.userSelect = "none";

        isResizingRef.current = true;
        flushSync(() => {
          setIsResizing(true);
          setResizeEdge(edge);
          onResizeStartRef.current?.(id);
        });
      },
      [
        applyResizeMove,
        effectiveUiScale,
        finishActiveResizeSession,
        id,
        refreshInteractiveMotionWindow,
        size.height,
        size.width,
        x,
        y,
      ],
    );

    useEffect(() => {
      return () => {
        if (resizeSessionRef.current) {
          finishActiveResizeSession();
        } else if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }
      };
    }, [finishActiveResizeSession]);

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

    const scheduleDragTargetUpdate = useCallback(
      (x: number, y: number) => {
        pendingDragTargetRef.current = { x, y };
        if (dragMoveFrameRef.current !== null) {
          return;
        }

        dragMoveFrameRef.current = window.requestAnimationFrame(() => {
          dragMoveFrameRef.current = null;
          const pendingTarget = pendingDragTargetRef.current;
          pendingDragTargetRef.current = null;
          if (!pendingTarget) {
            return;
          }

          const nextTarget = detectDropZone(pendingTarget.x, pendingTarget.y);
          if (latestDragTargetRef.current === nextTarget) {
            return;
          }

          latestDragTargetRef.current = nextTarget;
          onDragMoveRef.current?.(id, nextTarget);
        });
      },
      [detectDropZone, id],
    );

    const cancelDragTargetUpdate = useCallback(() => {
      pendingDragTargetRef.current = null;
      latestDragTargetRef.current = null;
      if (dragMoveFrameRef.current === null) {
        return;
      }

      window.cancelAnimationFrame(dragMoveFrameRef.current);
      dragMoveFrameRef.current = null;
    }, []);

    const finishActiveDragSession = useCallback(
      (options: { event?: PointerEvent; commitDrop: boolean }) => {
        const session = dragSessionRef.current;
        if (!session) {
          return;
        }

        dragSessionRef.current = null;
        window.removeEventListener(
          "pointermove",
          session.handlePointerMove,
          true,
        );
        window.removeEventListener("pointerup", session.handlePointerUp, true);
        window.removeEventListener(
          "pointercancel",
          session.handlePointerCancel,
          true,
        );
        releasePointerCapture(session.captureTarget, session.pointerId);
        session.finishMotionSession();
        cancelDragTargetUpdate();

        if (options.commitDrop && options.event) {
          const event = options.event;
          const dx = screenToLogicalPixels(
            event.clientX - startRef.current.x,
            effectiveUiScale,
          );
          const dy = screenToLogicalPixels(
            event.clientY - startRef.current.y,
            effectiveUiScale,
          );
          latestDragOffsetRef.current = { x: dx, y: dy };
          dragX.set(dx);
          dragY.set(dy);

          const targetZone = detectDropZone(event.clientX, event.clientY);
          const dropX = startRef.current.panelX + dx;
          const dropY = startRef.current.panelY + dy;

          onDragEndRef.current?.(
            id,
            targetZone,
            dropX,
            dropY,
            startRef.current.width,
            startRef.current.height,
          );
        } else {
          onDragEndRef.current?.(id, null);
        }

        latestDragOffsetRef.current = { x: 0, y: 0 };
        dragX.set(0);
        dragY.set(0);
        setIsDragging(false);
        dragSelectionReleaseRef.current?.();
        dragSelectionReleaseRef.current = null;
        if (!isResizingRef.current) {
          document.body.style.cursor = "";
        }
        document.body.style.userSelect = "";
        // Notify snap zones after final drop or cancellation state has been
        // calculated, avoiding a one-frame snap-back.
        window.dispatchEvent(new CustomEvent("panel-drag-end"));
      },
      [
        cancelDragTargetUpdate,
        detectDropZone,
        dragX,
        dragY,
        effectiveUiScale,
        id,
        releasePointerCapture,
      ],
    );

    const handleHeaderPointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !e.isPrimary) {
          return;
        }

        const targetElement = e.target instanceof Element ? e.target : null;
        if (targetElement?.closest(PANEL_HEADER_NO_DRAG_SELECTOR)) {
          return;
        }

        if (
          zenModeEnabled &&
          mode === "snapped" &&
          (e.metaKey || metaKeyPressedRef.current) &&
          onZenPinToggle
        ) {
          e.preventDefault();
          e.stopPropagation();
          onZenPinToggle(id);
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        refreshInteractiveMotionWindow();

        if (dragSessionRef.current) {
          finishActiveDragSession({ commitDrop: false });
        }
        if (resizeSessionRef.current) {
          finishActiveResizeSession();
        }

        const finishMotionSession = beginInteractiveSurfaceMotionSession(
          FLOATING_PANEL_LAYOUT_TRANSITION_MS + 180,
        );
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
        latestDragOffsetRef.current = { x: 0, y: 0 };
        latestDragTargetRef.current = null;
        pendingDragTargetRef.current = null;
        dragSelectionReleaseRef.current?.();
        dragSelectionReleaseRef.current = beginDragSelectionLock();
        if (dragMoveFrameRef.current !== null) {
          window.cancelAnimationFrame(dragMoveFrameRef.current);
          dragMoveFrameRef.current = null;
        }
        dragX.set(0);
        dragY.set(0);

        const pointerId = e.pointerId;
        const captureTarget = e.currentTarget;

        try {
          captureTarget.setPointerCapture(pointerId);
        } catch {
          // Window listeners below still keep rapid drags connected.
        }

        const handlePointerMove = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) {
            return;
          }

          event.preventDefault();
          document.getSelection()?.removeAllRanges();
          refreshInteractiveMotionWindow();

          const dx = screenToLogicalPixels(
            event.clientX - startRef.current.x,
            effectiveUiScale,
          );
          const dy = screenToLogicalPixels(
            event.clientY - startRef.current.y,
            effectiveUiScale,
          );
          latestDragOffsetRef.current = { x: dx, y: dy };
          dragX.set(dx);
          dragY.set(dy);
          scheduleDragTargetUpdate(event.clientX, event.clientY);
        };

        const handlePointerUp = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) {
            return;
          }
          finishActiveDragSession({ event, commitDrop: true });
        };

        const handlePointerCancel = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) {
            return;
          }
          finishActiveDragSession({ event, commitDrop: false });
        };

        dragSessionRef.current = {
          captureTarget,
          finishMotionSession,
          handlePointerCancel,
          handlePointerMove,
          handlePointerUp,
          pointerId,
        };

        window.addEventListener("pointermove", handlePointerMove, true);
        window.addEventListener("pointerup", handlePointerUp, true);
        window.addEventListener("pointercancel", handlePointerCancel, true);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";

        // Tell global snap zones that a panel drag started.
        window.dispatchEvent(new CustomEvent("panel-drag-start"));
        flushSync(() => {
          setIsDragging(true);
          onDragStartRef.current?.(id);
        });
      },
      [
        dragX,
        dragY,
        effectiveUiScale,
        finishActiveDragSession,
        finishActiveResizeSession,
        id,
        mode,
        onZenPinToggle,
        refreshInteractiveMotionWindow,
        scheduleDragTargetUpdate,
        size.height,
        size.width,
        x,
        y,
        zenModeEnabled,
      ],
    );

    useEffect(() => {
      return () => {
        if (dragSessionRef.current) {
          finishActiveDragSession({ commitDrop: false });
        }
      };
    }, [finishActiveDragSession]);

    const handleHeaderControlPointerDown = useCallback(
      (e: React.PointerEvent) => {
        e.stopPropagation();
      },
      [],
    );

    const getTopChromeAvoidanceOffset = (): number => {
      const avoidanceTop = Math.max(0, zenTopChromeAvoidanceTop);
      if (
        avoidanceTop <= 0 ||
        isDragging ||
        isResizing ||
        isFullscreen ||
        !isPresent
      ) {
        return 0;
      }

      if (mode === "floating") {
        return Math.max(0, avoidanceTop - y);
      }

      if (position === "bottom") {
        return 0;
      }

      const adjacentTop = adjacentPanels.top || 0;
      const snappedTop =
        hostMode === "flow"
          ? 0
          : Math.max(
              adjacentTop > 0 ? adjacentTop : SNAPPED_PANEL_OUTER_GAP,
              hostMode === "overlay" ? (snappedOverlayInsets?.top ?? 0) : 0,
            );

      return Math.max(0, avoidanceTop - snappedTop);
    };

    const zenTopChromeAvoidanceOffset = getTopChromeAvoidanceOffset();
    const viewportWidth =
      typeof window === "undefined"
        ? size.width
        : screenToLogicalPixels(window.innerWidth, effectiveUiScale);
    const viewportHeight =
      typeof window === "undefined"
        ? size.height
        : screenToLogicalPixels(window.innerHeight, effectiveUiScale);
    const immersiveOverlayCoversViewport =
      immersiveOverlay &&
      useViewportPositioning &&
      mode === "floating" &&
      x <= 1 &&
      y <= 1 &&
      x + size.width >= viewportWidth - 1 &&
      y + size.height >= viewportHeight - 1;
    const immersiveFrameActive =
      immersiveOverlayCoversViewport && !isDragging && !isResizing;
    const flowSlotExitActive =
      mode === "snapped" &&
      hostMode === "flow" &&
      isSlotExiting &&
      !isDragging &&
      !isResizing;
    const panelMotionAffected =
      isDropTarget ||
      activeDropTargetPosition !== null ||
      fullscreenMotionActive ||
      flowSlotExitActive ||
      (!isPresent && mode === "snapped") ||
      (isPresent && mode === "snapped" && !hasEntered && !reduceMotion);
    // The parent pressure prop is broad while any panel is moving; only use it
    // for the panel that is actually participating in that motion.
    const motionPaintConstrained =
      adaptivePerformancePaintConstrained ||
      isDragging ||
      isResizing ||
      isRelocating ||
      fullscreenMotionActive ||
      (motionPressureActive && panelMotionAffected);
    const contentVisibilityStyle: React.CSSProperties =
      mode === "floating" || isDragging || isResizing || isRelocating
        ? {}
        : {
            contentVisibility: "auto",
            containIntrinsicSize: "1px 480px",
          };

    const getContainerStyle = (): React.CSSProperties => {
      const isSnapped = mode === "snapped";
      const isFlowHosted = isSnapped && hostMode === "flow" && !isDragging;
      const isInteractivePanel =
        isDragging || isResizing || isDropTarget || isRelocating || isPinned;
      const isActivePanel = isInteractivePanel;
      const shouldPromoteForMotion =
        mode === "snapped" &&
        !reduceMotion &&
        (!hasEntered || !isPresent || flowSlotExitActive);
      const panelFrameRadius = immersiveFrameActive ? 0 : "var(--radius-lg)";
      const panelFrameShadow = immersiveFrameActive
        ? "none"
        : motionPaintConstrained
          ? isActivePanel
            ? FLOATING_PANEL_MOTION_ACTIVE_SHADOW
            : FLOATING_PANEL_MOTION_SHADOW
          : isSnapped
            ? isActivePanel
              ? "var(--shell-shadow-active)"
              : "var(--shell-shadow)"
            : isDragging
              ? "var(--shadow-drag)"
              : isResizing || isActivePanel
                ? "var(--shell-shadow-active)"
                : "var(--shell-shadow)";
      const base: React.CSSProperties = {
        ...WAILS_NO_DRAG_STYLE,
        position: isFlowHosted
          ? "relative"
          : useViewportPositioning
            ? "fixed"
            : isDragging
              ? "fixed"
              : "absolute",
        display: "flex",
        flexDirection: "column",
        background: immersiveFrameActive
          ? "var(--terminal-bg)"
          : motionPaintConstrained
            ? "var(--surface-shell-panel)"
            : "linear-gradient(180deg, color-mix(in srgb, var(--surface-shell-soft) 97%, transparent), color-mix(in srgb, var(--surface-shell-panel) 99%, transparent))",
        border: "1px solid var(--shell-border)",
        borderRadius: panelFrameRadius,
        boxShadow: panelFrameShadow,
        zIndex: isDragging
          ? 140
          : isRelocating
            ? 130
            : (customZIndex ?? (mode === "floating" ? 90 : 50)),
        overflow: "hidden",
        isolation: "isolate",
        pointerEvents:
          isPresent && isVisible && !flowSlotExitActive ? "auto" : "none",
        willChange: isDragging
          ? "transform"
          : isResizing
            ? "auto"
            : isRelocating
              ? "transform, opacity"
              : shouldPromoteForMotion
                ? "transform"
                : zenTopChromeAvoidanceOffset > 0
                  ? "transform"
                  : "auto",
        contain: motionPaintConstrained ? "layout paint style" : "paint",
        backfaceVisibility: "hidden" as const,
        transition:
          reduceMotion || motionPaintConstrained
            ? "none"
            : "box-shadow 0.18s ease, border-color 0.18s ease",
      };

      if (immersiveFrameActive) {
        base.border = "0";
      } else if (isDropTarget) {
        base.border = "1px solid var(--accent-brand)";
        base.boxShadow = motionPaintConstrained
          ? FLOATING_PANEL_MOTION_DROP_SHADOW
          : "inset 0 0 0 1px var(--accent-brand), inset 0 0 0 999px color-mix(in srgb, var(--accent-brand) 6%, transparent), var(--shadow-overlay)";
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
        if (!isPresent || flowSlotExitActive) {
          const exitingBounds = freezeExitBounds();
          const flowExitAnchor: React.CSSProperties =
            position === "right"
              ? { right: 0, top: 0 }
              : position === "bottom"
                ? { left: 0, bottom: 0 }
                : { left: 0, top: 0 };
          const fallbackWidth =
            position === "left" || position === "right" ? size.width : "100%";
          const fallbackHeight =
            position === "top" || position === "bottom" ? size.height : "100%";
          const exitWidth = exitingBounds?.width ?? fallbackWidth;
          const exitHeight = exitingBounds?.height ?? fallbackHeight;

          return {
            ...base,
            position: "absolute",
            width: exitWidth,
            height: exitHeight,
            minWidth:
              typeof exitWidth === "number" &&
              (position === "left" || position === "right")
                ? exitWidth
                : 0,
            minHeight:
              typeof exitHeight === "number" &&
              (position === "top" || position === "bottom")
                ? exitHeight
                : 0,
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
      const overlayTopInset =
        hostMode === "overlay" ? (snappedOverlayInsets?.top ?? 0) : 0;
      const overlayBottomInset =
        hostMode === "overlay" ? (snappedOverlayInsets?.bottom ?? 0) : 0;
      const resolvedTopInset = Math.max(
        topPanelHeight > 0 ? topPanelHeight : gap,
        overlayTopInset,
      );
      const resolvedBottomInset = Math.max(
        bottomPanelHeight > 0 ? bottomPanelHeight : gap,
        overlayBottomInset,
      );

      switch (position) {
        case "left":
          return {
            ...base,
            left: gap,
            top: resolvedTopInset,
            bottom: resolvedBottomInset,
            width: size.width,
          };
        case "right":
          return {
            ...base,
            right: gap,
            top: resolvedTopInset,
            bottom: resolvedBottomInset,
            width: size.width,
          };
        case "bottom":
          return {
            ...base,
            left: leftPanelWidth > 0 ? leftPanelWidth : gap,
            right: rightPanelWidth > 0 ? rightPanelWidth : gap,
            bottom: resolvedBottomInset,
            height: size.height,
          };
        case "top":
          return {
            ...base,
            left: leftPanelWidth > 0 ? leftPanelWidth : gap,
            right: rightPanelWidth > 0 ? rightPanelWidth : gap,
            top: resolvedTopInset,
            height: size.height,
          };
      }
    };

    const edgeStyle = (edge: string): React.CSSProperties => {
      const base: React.CSSProperties = {
        ...WAILS_NO_DRAG_STYLE,
        position: "absolute",
        zIndex: 30,
        backgroundColor: "transparent",
        pointerEvents: "auto",
        touchAction: "none",
      };

      const isFloating = mode === "floating";
      const edgeSize = `${screenToLogicalPixels(
        isFloating ? 18 : 24,
        effectiveUiScale,
      )}px`;
      const cornerSize = `${screenToLogicalPixels(
        isFloating ? 22 : 28,
        effectiveUiScale,
      )}px`;
      const offset = "0";

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
      snappedSlideMotionEnabled &&
      !isRelocating &&
      (!isPresent || !hasEntered || flowSlotExitActive);
    const slideVector = shouldResolveSlideVector
      ? getSlideVector()
      : { x: 0, y: 0 };
    const slideMotionSettledTarget = {
      x: 0,
      y: zenTopChromeAvoidanceOffset,
    };
    const exitSlideVector =
      snappedSlideMotionEnabled && !isRelocating
        ? getExitSlideVector()
        : slideMotionSettledTarget;
    const slideMotionTarget = slideMotionSettledTarget;
    const panelMotionState = isRelocating
      ? "relocating"
      : !isPresent || flowSlotExitActive
        ? "exit"
        : snappedSlideMotionEnabled && !hasEntered
          ? "enter"
          : "settled";
    const panelState =
      !isPresent || flowSlotExitActive
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
    const slideMotionExit = isRelocating
      ? {
          opacity: 0,
          x: 0,
          y: 0,
          transition: FLOATING_PANEL_NO_MOTION_TRANSITION,
        }
      : snappedSlideMotionEnabled
        ? { x: exitSlideVector.x, y: exitSlideVector.y }
        : slideMotionSettledTarget;
    const fullscreenLayoutIdentityEnabled =
      Boolean(fullscreenLayoutId) &&
      !reduceMotion &&
      !isDragging &&
      !isResizing &&
      isPresent &&
      !flowSlotExitActive &&
      (fullscreenMotionActive ||
        (mode === "snapped" && hostMode === "flow") ||
        (preserveFullscreenLayoutIdentity && mode === "floating"));
    const fullscreenLayoutMotionEnabled =
      fullscreenLayoutIdentityEnabled && fullscreenMotionActive;
    const flowLayoutMotionEnabled =
      mode === "snapped" &&
      hostMode === "flow" &&
      !isDragging &&
      !isResizing &&
      !flowSlotExitActive;
    const motionTransition = fullscreenLayoutMotionEnabled
      ? PANEL_FULLSCREEN_MOTION_TRANSITION
      : snappedSlideMotionEnabled
        ? FLOATING_PANEL_LAYOUT_TRANSITION
        : FLOATING_PANEL_NO_MOTION_TRANSITION;
    const panelLayoutMotion = fullscreenLayoutMotionEnabled
      ? true
      : flowLayoutMotionEnabled
        ? "position"
        : false;
    const panelLayoutId = fullscreenLayoutMotionEnabled
      ? fullscreenLayoutId
      : fullscreenLayoutIdentityEnabled
        ? fullscreenLayoutId
        : flowLayoutMotionEnabled
          ? `floating-panel-${id}`
          : undefined;
    const readableLayerLayoutMotionEnabled = fullscreenLayoutMotionEnabled;
    useLayoutEffect(() => {
      const panelNode = panelRef.current;
      const readableLayerNode = readableLayerRef.current;
      if (!panelNode || !readableLayerNode) {
        return;
      }

      if (
        !readableLayerLayoutMotionEnabled ||
        !fullscreenMotionActive ||
        reduceMotion
      ) {
        writeProjectedReadableScale(readableLayerNode, { x: 1, y: 1 });
        return;
      }

      const updateProjectedScale = () => {
        writeProjectedReadableScale(
          readableLayerNode,
          readInlineProjectedScale(panelNode),
        );
      };
      const observer = new MutationObserver(() => {
        updateProjectedScale();
      });

      observer.observe(panelNode, {
        attributes: true,
        attributeFilter: ["style"],
      });
      updateProjectedScale();

      return () => {
        observer.disconnect();
        writeProjectedReadableScale(readableLayerNode, { x: 1, y: 1 });
      };
    }, [
      fullscreenMotionActive,
      readableLayerLayoutMotionEnabled,
      reduceMotion,
    ]);
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
      cursor: isDragging ? "grabbing" : "grab",
      boxShadow: motionPaintConstrained
        ? "none"
        : "inset 0 1px 0 var(--shell-inner-highlight)",
      touchAction: "none",
      ...WAILS_NO_DRAG_STYLE,
      ...(immersiveFrameActive
        ? {
            position: "absolute",
            top: 0,
            right: "8px",
            height: "40px",
            width: "160px",
            padding: "0",
            background: "transparent",
            borderBottom: "0",
            boxShadow: "none",
            justifyContent: "flex-end",
            zIndex: 80,
          }
        : null),
    };

    const titleStyle: React.CSSProperties = {
      display: immersiveFrameActive ? "none" : "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "11px",
      fontWeight: 600,
      color: "var(--text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.12em",
      pointerEvents: "none",
    };

    const controlsBubbleStyle: React.CSSProperties = {
      padding: "4px",
      borderRadius: 9999,
      background:
        "color-mix(in srgb, var(--surface-shell-soft) 74%, transparent)",
      border:
        "1px solid color-mix(in srgb, var(--shell-border) 72%, transparent)",
      boxShadow: motionPaintConstrained ? "none" : "var(--shell-shadow)",
      backdropFilter: motionPaintConstrained ? "none" : "blur(12px)",
      WebkitBackdropFilter: motionPaintConstrained ? "none" : "blur(12px)",
    };

    const controlsStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      position: "relative",
      zIndex: 40,
      flexShrink: 0,
      ...WAILS_NO_DRAG_STYLE,
      ...controlsBubbleStyle,
    };

    const closeButtonStyle: React.CSSProperties = {
      ...WAILS_NO_DRAG_STYLE,
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
      transition: motionPaintConstrained
        ? "none"
        : "background-color 150ms ease, color 150ms ease, transform 120ms ease, border-color 150ms ease",
    };

    const contentStyle: React.CSSProperties = {
      ...WAILS_NO_DRAG_STYLE,
      flex: 1,
      overflow: "hidden",
      minHeight: 0,
      minWidth: 0,
      position: "relative",
      zIndex: 0,
      pointerEvents: isResizing ? "none" : "auto",
      contain: motionPaintConstrained ? "layout paint style" : "paint",
      ...contentVisibilityStyle,
      isolation: "isolate",
      transform: "translateZ(0)",
      willChange: motionPaintConstrained ? "transform" : "auto",
    };

    const readableClipStyle: React.CSSProperties = {
      ...WAILS_NO_DRAG_STYLE,
      display: "flex",
      flexDirection: "column",
      flex: 1,
      width: "100%",
      height: "100%",
      minWidth: 0,
      minHeight: 0,
      position: "relative",
      overflow: "hidden",
      contain: motionPaintConstrained ? "layout paint style" : "paint",
      isolation: "isolate",
    };

    const readableLayerStyle: React.CSSProperties = {
      ...WAILS_NO_DRAG_STYLE,
      display: "flex",
      flexDirection: "column",
      flex: readableLayerLayoutMotionEnabled ? "0 0 auto" : 1,
      width: readableLayerLayoutMotionEnabled
        ? "calc(100% * var(--panel-projected-scale-x, 1))"
        : "100%",
      height: readableLayerLayoutMotionEnabled
        ? "calc(100% * var(--panel-projected-scale-y, 1))"
        : "100%",
      minWidth: 0,
      minHeight: 0,
      position: "relative",
      transform: readableLayerLayoutMotionEnabled
        ? "scale(var(--panel-projected-inverse-scale-x, 1), var(--panel-projected-inverse-scale-y, 1))"
        : undefined,
      transformOrigin: "top left",
      willChange:
        readableLayerLayoutMotionEnabled || motionPaintConstrained
          ? "transform"
          : "auto",
      contain: motionPaintConstrained ? "layout paint style" : "paint",
      backfaceVisibility: "hidden",
    };

    const renderResizeHandle = (edge: string) => (
      <div
        key={edge}
        role="separator"
        aria-label={`Resize panel from ${edge}`}
        aria-orientation={
          edge.includes("left") || edge.includes("right")
            ? "vertical"
            : "horizontal"
        }
        data-testid={`panel-${id}-resize-${edge}`}
        data-panel-resize-handle="true"
        style={edgeStyle(edge)}
        onPointerDown={(e) => handleResizeStart(e, edge)}
      />
    );

    const panelHeaderContextMenuItems: ContextActionMenuItem[] = [
      {
        label: "Move to Left",
        icon: <ArrowLeft size={14} />,
        hidden: !onMoveToPosition,
        disabled: mode === "snapped" && position === "left",
        onSelect: () => {
          refreshInteractiveMotionWindow();
          onMoveToPosition?.("left");
        },
      },
      {
        label: "Move to Right",
        icon: <ArrowRight size={14} />,
        hidden: !onMoveToPosition,
        disabled: mode === "snapped" && position === "right",
        onSelect: () => {
          refreshInteractiveMotionWindow();
          onMoveToPosition?.("right");
        },
      },
      {
        label: "Move to Top",
        icon: <ArrowUp size={14} />,
        hidden: !onMoveToPosition,
        disabled: mode === "snapped" && position === "top",
        onSelect: () => {
          refreshInteractiveMotionWindow();
          onMoveToPosition?.("top");
        },
      },
      {
        label: "Move to Bottom",
        icon: <ArrowDown size={14} />,
        hidden: !onMoveToPosition,
        disabled: mode === "snapped" && position === "bottom",
        onSelect: () => {
          refreshInteractiveMotionWindow();
          onMoveToPosition?.("bottom");
        },
      },
      { separator: true, hidden: !onFullscreen && !onPin && !onZenPinToggle },
      {
        label: isFullscreen ? "Exit Full Screen" : "Full Screen",
        icon: <Maximize2 size={14} />,
        hidden: !onFullscreen,
        onSelect: () => {
          refreshInteractiveMotionWindow();
          onFullscreen?.();
        },
      },
      {
        label: isZenPinned ? "Unpin in Zen" : "Pin in Zen",
        icon: <Pin size={14} />,
        hidden: !zenModeEnabled || mode !== "snapped" || !onZenPinToggle,
        onSelect: () => onZenPinToggle?.(id),
      },
      {
        label: isPinned ? "Unpin Panel" : "Pin Panel",
        icon: <Pin size={14} />,
        hidden: !onPin,
        onSelect: onPin,
      },
      { separator: true, hidden: !onClose },
      {
        label: "Close Panel",
        icon: <X size={14} />,
        danger: true,
        hidden: !onClose,
        onSelect: () => {
          refreshInteractiveMotionWindow();
          captureLatestBounds();
          onClose?.();
        },
      },
    ];

    const panelHeader = (
      <div
        role="toolbar"
        aria-label={`${title} panel header`}
        style={headerStyle}
        onPointerDown={handleHeaderPointerDown}
        data-testid={`panel-${id}-drag-handle`}
        data-panel-drag-handle="true"
      >
        <div style={titleStyle}>
          {icon}
          <span>{title}</span>
        </div>

        <div
          style={controlsStyle}
          data-panel-controls="true"
          data-panel-controls-variant="bubble"
          data-panel-no-drag="true"
          onPointerDown={handleHeaderControlPointerDown}
        >
          {headerExtra}

          {onFullscreen && (
            <button
              type="button"
              style={closeButtonStyle}
              className="panel-control-button topbar-control-button"
              onClick={(e) => {
                e.stopPropagation();
                refreshInteractiveMotionWindow();
                onFullscreen();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title="Fullscreen"
            >
              <Maximize2 size={14} />
            </button>
          )}

          {onPin && (
            <button
              type="button"
              style={{
                ...closeButtonStyle,
                transform: isPinned ? "rotate(45deg)" : undefined,
              }}
              className={`panel-control-button topbar-control-button ${
                isPinned ? "panel-control-button-accent" : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                refreshInteractiveMotionWindow();
                onPin();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title={isPinned ? "Unpin panel" : "Pin panel"}
            >
              <Pin size={14} />
            </button>
          )}

          {onClose && (
            <button
              type="button"
              style={closeButtonStyle}
              className="panel-control-button panel-control-button-danger topbar-control-button"
              onClick={(e) => {
                e.stopPropagation();
                refreshInteractiveMotionWindow();
                captureLatestBounds();
                onClose();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title="Close panel"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    );
    const panelBody = (
      <>
        <ContextActionMenu
          items={panelHeaderContextMenuItems}
          nativeScope="floating-panel-header"
          nativeTargetId={id}
          nativeContext={{ panelId: id, position, mode }}
        >
          {panelHeader}
        </ContextActionMenu>

        <div
          style={contentStyle}
          data-panel-content="true"
          data-panel-content-ready={contentReady ? "true" : "false"}
        >
          {contentReady ? children : null}
        </div>
      </>
    );

    return (
      <motion.div
        ref={setPanelNode}
        layout={panelLayoutMotion}
        layoutId={panelLayoutId}
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
            warmedPanelContentIds.add(id);
            setHasEntered(true);
            setContentReady(true);
          }
        }}
        style={containerMotionStyle}
        data-testid={`panel-${id}`}
        data-panel-id={id}
        data-panel-position={position}
        data-panel-state={panelState}
        data-panel-motion={panelMotionState}
        data-panel-fullscreen-motion={
          fullscreenLayoutMotionEnabled ? "true" : "false"
        }
        data-panel-immersive={immersiveFrameActive ? "true" : "false"}
        data-panel-relocating={isRelocating ? "true" : "false"}
        data-panel-motion-pressure={motionPaintConstrained ? "true" : "false"}
        data-panel-zen-pinned={isZenPinned ? "true" : "false"}
        data-panel-top-chrome-avoidance={Math.round(
          zenTopChromeAvoidanceOffset,
        )}
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

        {readableLayerLayoutMotionEnabled ? (
          <div style={readableClipStyle} data-panel-readable-clip="true">
            <div
              ref={readableLayerRef}
              style={readableLayerStyle}
              data-panel-readable-layer="true"
              data-panel-readable-motion="true"
            >
              {panelBody}
            </div>
          </div>
        ) : (
          panelBody
        )}
      </motion.div>
    );
  },
);

FloatingPanel.displayName = "FloatingPanel";

export default FloatingPanel;
