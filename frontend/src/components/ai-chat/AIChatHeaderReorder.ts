import React from "react";

import { beginDragSelectionLock } from "../../utils/dragSelectionLock";

export type AIChatHeaderItemId =
  | "history"
  | "activity"
  | "review"
  | "search"
  | "newChat"
  | "refresh"
  | "settings";

export type AIChatHeaderDropGroup = "left" | "right";

export interface AIChatHeaderLayout {
  left: AIChatHeaderItemId[];
  right: AIChatHeaderItemId[];
}

const AI_CHAT_HEADER_STORAGE_KEY = "arlecchino.ai-chat.header-layout.v1";

const DEFAULT_AI_CHAT_HEADER_LAYOUT: AIChatHeaderLayout = {
  left: ["history", "activity"],
  right: ["review", "search", "newChat", "refresh", "settings"],
};

const AI_CHAT_HEADER_ITEM_IDS: AIChatHeaderItemId[] = [
  "history",
  "activity",
  "review",
  "search",
  "newChat",
  "refresh",
  "settings",
];

export const AI_CHAT_HEADER_ITEM_LABELS: Record<AIChatHeaderItemId, string> = {
  history: "History",
  activity: "Runtime status",
  review: "Git Review",
  search: "Search session",
  newChat: "New chat",
  refresh: "Refresh runtime",
  settings: "Settings",
};

const isAIChatHeaderItemId = (value: unknown): value is AIChatHeaderItemId =>
  typeof value === "string" &&
  AI_CHAT_HEADER_ITEM_IDS.includes(value as AIChatHeaderItemId);

const normalizeAIChatHeaderLayout = (value: unknown): AIChatHeaderLayout => {
  const next: AIChatHeaderLayout = { left: [], right: [] };
  const seen = new Set<AIChatHeaderItemId>();
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<Record<AIChatHeaderDropGroup, unknown>>)
      : {};

  (["left", "right"] as const).forEach((group) => {
    const ids = Array.isArray(candidate[group]) ? candidate[group] : [];
    ids.forEach((id) => {
      if (!isAIChatHeaderItemId(id) || seen.has(id)) return;
      seen.add(id);
      next[group].push(id);
    });
  });

  DEFAULT_AI_CHAT_HEADER_LAYOUT.left.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    next.left.push(id);
  });
  DEFAULT_AI_CHAT_HEADER_LAYOUT.right.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    next.right.push(id);
  });

  return next;
};

const readStoredAIChatHeaderLayout = (): AIChatHeaderLayout => {
  if (typeof window === "undefined") {
    return normalizeAIChatHeaderLayout(null);
  }
  try {
    const raw = window.localStorage.getItem(AI_CHAT_HEADER_STORAGE_KEY);
    return normalizeAIChatHeaderLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeAIChatHeaderLayout(null);
  }
};

const storeAIChatHeaderLayout = (layout: AIChatHeaderLayout) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    AI_CHAT_HEADER_STORAGE_KEY,
    JSON.stringify(normalizeAIChatHeaderLayout(layout)),
  );
};

export function useAIChatHeaderReorder() {
  const leftGroupRef = React.useRef<HTMLDivElement | null>(null);
  const rightGroupRef = React.useRef<HTMLDivElement | null>(null);
  const suppressItemClickRef = React.useRef(false);
  const [headerLayout, setHeaderLayout] = React.useState(
    readStoredAIChatHeaderLayout,
  );
  const [dragPreviewLayout, setDragPreviewLayout] =
    React.useState<AIChatHeaderLayout | null>(null);
  const [draggedItemId, setDraggedItemId] =
    React.useState<AIChatHeaderItemId | null>(null);
  const effectiveLayout = dragPreviewLayout ?? headerLayout;

  const getDropGroup = React.useCallback(
    (clientX: number, clientY: number): AIChatHeaderDropGroup | null => {
      const targets: Array<[AIChatHeaderDropGroup, HTMLDivElement | null]> = [
        ["left", leftGroupRef.current],
        ["right", rightGroupRef.current],
      ];

      for (const [group, container] of targets) {
        const rect = container?.getBoundingClientRect();
        if (
          rect &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top - 24 &&
          clientY <= rect.bottom + 24
        ) {
          return group;
        }
      }

      return null;
    },
    [],
  );

  const resolveReorderedLayout = React.useCallback(
    (
      itemId: AIChatHeaderItemId,
      clientX: number,
      group: AIChatHeaderDropGroup,
      currentLayout: AIChatHeaderLayout,
    ): AIChatHeaderLayout => {
      const container =
        group === "left" ? leftGroupRef.current : rightGroupRef.current;
      if (!container) return currentLayout;

      const next = normalizeAIChatHeaderLayout(currentLayout);
      next.left = next.left.filter((id) => id !== itemId);
      next.right = next.right.filter((id) => id !== itemId);

      const targetOrder = [...next[group]];
      let insertIndex = targetOrder.length;
      targetOrder.some((id, index) => {
        const element = container.querySelector<HTMLElement>(
          `[data-ai-chat-header-item-id="${CSS.escape(id)}"]`,
        );
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) {
          insertIndex = index;
          return true;
        }
        return false;
      });

      targetOrder.splice(insertIndex, 0, itemId);
      next[group] = targetOrder;
      return normalizeAIChatHeaderLayout(next);
    },
    [],
  );

  const handlePointerDown = React.useCallback(
    (
      itemId: AIChatHeaderItemId,
      group: AIChatHeaderDropGroup,
      event: React.PointerEvent<HTMLElement>,
    ) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".ai-chat-popover")) {
        return;
      }

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const releaseSelectionLock = beginDragSelectionLock();
      let activeDrag = false;
      let previewLayout = normalizeAIChatHeaderLayout(headerLayout);

      const resetClickSuppression = () => {
        window.setTimeout(() => {
          suppressItemClickRef.current = false;
        }, 0);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove, true);
        window.removeEventListener("pointerup", handlePointerUp, true);
        window.removeEventListener("pointercancel", handlePointerCancel, true);
        releaseSelectionLock();
        setDragPreviewLayout(null);
        setDraggedItemId(null);
      };

      const previewDrop = (
        pointerEvent: PointerEvent,
        targetGroup: AIChatHeaderDropGroup,
      ) => {
        previewLayout = resolveReorderedLayout(
          itemId,
          pointerEvent.clientX,
          targetGroup,
          previewLayout,
        );
        setDragPreviewLayout(previewLayout);
        return previewLayout;
      };

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return;

        const dx = pointerEvent.clientX - startX;
        const dy = pointerEvent.clientY - startY;
        if (!activeDrag && Math.hypot(dx, dy) > 7) {
          activeDrag = true;
          suppressItemClickRef.current = true;
          setDraggedItemId(itemId);
          setDragPreviewLayout(previewLayout);
        }
        if (!activeDrag) return;

        pointerEvent.preventDefault();
        document.getSelection()?.removeAllRanges();

        const targetGroup =
          getDropGroup(pointerEvent.clientX, pointerEvent.clientY) ?? group;
        previewDrop(pointerEvent, targetGroup);
      };

      const handlePointerUp = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return;
        if (!activeDrag) {
          cleanup();
          return;
        }

        const targetGroup = getDropGroup(
          pointerEvent.clientX,
          pointerEvent.clientY,
        );
        const nextLayout = targetGroup
          ? previewDrop(pointerEvent, targetGroup)
          : previewLayout;
        setHeaderLayout(nextLayout);
        storeAIChatHeaderLayout(nextLayout);
        resetClickSuppression();
        cleanup();
      };

      const handlePointerCancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return;
        cleanup();
        if (activeDrag) resetClickSuppression();
      };

      window.addEventListener("pointermove", handlePointerMove, true);
      window.addEventListener("pointerup", handlePointerUp, true);
      window.addEventListener("pointercancel", handlePointerCancel, true);
    },
    [getDropGroup, headerLayout, resolveReorderedLayout],
  );

  const handleClickCapture = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!suppressItemClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  return {
    draggedItemId,
    effectiveLayout,
    handleClickCapture,
    handlePointerDown,
    leftGroupRef,
    rightGroupRef,
  };
}
