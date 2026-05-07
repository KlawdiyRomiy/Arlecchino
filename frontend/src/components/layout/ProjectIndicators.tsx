import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderOpen, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useCollapseTimer } from "../../hooks/useCollapseTimer";
import { DragGhost, type DragGhostState } from "../ui/DragGhost";
import { beginDragSelectionLock } from "../../utils/dragSelectionLock";

interface ProjectIndicatorsProps {
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onReorder?: (ids: string[]) => void;
  onDetach?: (id: string) => void;
}

const fadeTransition = { duration: 0.16, ease: "easeOut" } as const;
const fadeInitial = { opacity: 0, y: -2 };
const fadeAnimate = { opacity: 1, y: 0 };

export const ProjectIndicators: React.FC<ProjectIndicatorsProps> = ({
  onSwitch,
  onClose,
  onReorder,
  onDetach,
}) => {
  const { projects, activeId } = useWorkspaceStore(
    useShallow((s) => ({ projects: s.projects, activeId: s.activeId })),
  );

  const collapseEnabled = projects.length > 1;
  const { isCollapsed, resetTimer, stopTimer } = useCollapseTimer(
    60_000,
    collapseEnabled,
  );

  const shouldCollapse = collapseEnabled && isCollapsed;
  const expandedRef = React.useRef<HTMLDivElement | null>(null);
  const suppressClickRef = React.useRef(false);
  const [dragGhost, setDragGhost] = React.useState<DragGhostState | null>(null);

  const handleProjectPointerDown = (
    projectId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }

    const releaseSelectionLock = beginDragSelectionLock();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let activeDrag = false;

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      pointerEvent.preventDefault();
      document.getSelection()?.removeAllRanges();
      const dx = pointerEvent.clientX - startX;
      const dy = pointerEvent.clientY - startY;
      if (!activeDrag && Math.hypot(dx, dy) > 7) {
        activeDrag = true;
        suppressClickRef.current = true;
        stopTimer();
      }
      if (!activeDrag) {
        return;
      }

      const container = expandedRef.current;
      const project = projects.find((item) => item.id === projectId);
      setDragGhost({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        label: project?.name ?? projectId,
        detail: "Reorder or open in separate window",
      });
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      if (
        pointerEvent.clientY >= rect.top - 24 &&
        pointerEvent.clientY <= rect.bottom + 24
      ) {
        if (pointerEvent.clientX < rect.left + 42) {
          container.scrollLeft -= 18;
        } else if (pointerEvent.clientX > rect.right - 42) {
          container.scrollLeft += 18;
        }
      }
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
      releaseSelectionLock();
      setDragGhost(null);
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

      const topbar = document.querySelector<HTMLElement>(
        '[data-testid="topbar"]',
      );
      const topbarRect = topbar?.getBoundingClientRect();
      const insideTopbar = Boolean(
        topbarRect &&
        pointerEvent.clientX >= topbarRect.left &&
        pointerEvent.clientX <= topbarRect.right &&
        pointerEvent.clientY >= topbarRect.top &&
        pointerEvent.clientY <= topbarRect.bottom,
      );
      if (!insideTopbar) {
        onDetach?.(projectId);
        return;
      }

      const container = expandedRef.current;
      if (!container) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const insideContainer =
        pointerEvent.clientX >= containerRect.left &&
        pointerEvent.clientX <= containerRect.right &&
        pointerEvent.clientY >= containerRect.top &&
        pointerEvent.clientY <= containerRect.bottom;
      if (!insideContainer) {
        return;
      }

      const ids = projects.map((project) => project.id);
      const withoutDragged = ids.filter((id) => id !== projectId);
      let insertIndex = withoutDragged.length;
      withoutDragged.some((id, index) => {
        const element = container.querySelector<HTMLElement>(
          `[data-project-id="${CSS.escape(id)}"]`,
        );
        if (!element) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        if (pointerEvent.clientX < rect.left + rect.width / 2) {
          insertIndex = index;
          return true;
        }
        return false;
      });

      const nextIds = [...withoutDragged];
      nextIds.splice(insertIndex, 0, projectId);
      if (!nextIds.every((id, index) => id === ids[index])) {
        onReorder?.(nextIds);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
  };

  if (projects.length === 0) return null;

  return (
    <div
      onMouseEnter={() => {
        if (shouldCollapse) resetTimer();
      }}
      onMouseLeave={() => {
        if (collapseEnabled && !shouldCollapse) resetTimer();
      }}
    >
      <AnimatePresence mode="wait">
        {shouldCollapse ? (
          <motion.div
            key="collapsed"
            className="flex items-center gap-1.5 py-1"
            initial={fadeInitial}
            animate={fadeAnimate}
            exit={fadeInitial}
            transition={fadeTransition}
          >
            {projects.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-center w-2.5 h-2.5"
              >
                <button
                  onClick={() => {
                    onSwitch(p.id);
                    resetTimer();
                  }}
                  className={`topbar-space-dot w-2 h-2 p-0 rounded-full shrink-0 ${
                    activeId === p.id
                      ? "topbar-space-dot-active bg-[var(--text-primary)] shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                      : "bg-[var(--text-muted)]"
                  }`}
                  title={p.name}
                />
              </div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            ref={expandedRef}
            className="project-indicators-expanded flex items-center gap-1"
            data-testid="project-indicators-expanded"
            initial={fadeInitial}
            animate={fadeAnimate}
            exit={fadeInitial}
            transition={fadeTransition}
            onWheel={(e) => {
              if (e.deltaY !== 0) {
                e.currentTarget.scrollLeft += e.deltaY;
                e.preventDefault();
              }
            }}
          >
            {projects.map((p) => (
              <button
                key={p.id}
                data-project-id={p.id}
                onPointerDown={(event) => handleProjectPointerDown(p.id, event)}
                onClick={() => {
                  if (suppressClickRef.current) {
                    return;
                  }
                  onSwitch(p.id);
                  stopTimer();
                }}
                className={`topbar-project-chip group flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-[12px] transition-colors ${
                  activeId === p.id
                    ? "topbar-project-chip-active border-transparent text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-muted)] hover:border-[var(--shell-border)] hover:bg-[var(--surface-active)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <FolderOpen size={20} className="shrink-0 opacity-80" />
                <span>{p.name}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(p.id);
                    stopTimer();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="ml-0.5 shrink-0 cursor-pointer rounded-full p-0.5 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-70 hover:!opacity-100"
                >
                  <X size={12} />
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <DragGhost ghost={dragGhost} />
    </div>
  );
};
