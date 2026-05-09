import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderOpen, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { WorkspaceProject } from "../../stores/workspaceStore";
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
const projectChipBaseClassName =
  "topbar-project-chip group flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-[12px] transition-colors";
const projectChipActiveClassName =
  "topbar-project-chip-active border-transparent text-[var(--text-primary)]";
const projectChipInactiveClassName =
  "border-transparent text-[var(--text-muted)] hover:border-[var(--shell-border)] hover:bg-[var(--surface-active)] hover:text-[var(--text-secondary)]";
const projectChipCloseClassName =
  "ml-0.5 shrink-0 cursor-pointer rounded-full p-0.5 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-70 hover:!opacity-100";
const projectChipGhostCloseClassName =
  "ml-0.5 shrink-0 rounded-full bg-black/10 p-0.5 opacity-70";

const getProjectChipClassName = (isActive: boolean) =>
  `${projectChipBaseClassName} ${
    isActive ? projectChipActiveClassName : projectChipInactiveClassName
  }`;

const renderProjectChipInner = (
  project: Pick<WorkspaceProject, "name">,
  options: { ghost?: boolean } = {},
) => (
  <>
    <FolderOpen size={20} className="shrink-0 opacity-80" />
    <span>{project.name}</span>
    <span
      role={options.ghost ? undefined : "button"}
      tabIndex={options.ghost ? undefined : -1}
      className={
        options.ghost
          ? projectChipGhostCloseClassName
          : projectChipCloseClassName
      }
    >
      <X size={12} />
    </span>
  </>
);

const renderProjectChipGhostContent = (
  project: Pick<WorkspaceProject, "name">,
  isActive: boolean,
) => (
  <div
    className={`${getProjectChipClassName(isActive)} arle-topbar-project-chip-drag-copy`}
    data-drag-ghost-source="topbar-project-chip"
    style={{
      width: "100%",
      height: "100%",
      cursor: "grabbing",
      borderColor: isActive ? undefined : "var(--shell-border)",
      background: isActive ? undefined : "var(--surface-active)",
      color: isActive ? undefined : "var(--text-secondary)",
    }}
  >
    {renderProjectChipInner(project, { ghost: true })}
  </div>
);

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
    const sourceRect = event.currentTarget.getBoundingClientRect();
    const offsetX = startX - sourceRect.left;
    const offsetY = startY - sourceRect.top;
    const sourceProject = projects.find((item) => item.id === projectId);
    const sourceName = sourceProject?.name ?? projectId;
    const sourceActive = activeId === projectId;
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
      setDragGhost({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        label: sourceName,
        variant: "layout",
        layout: "topbar-project-chip",
        content: renderProjectChipGhostContent(
          { name: sourceName },
          sourceActive,
        ),
        width: sourceRect.width,
        height: sourceRect.height,
        offsetX,
        offsetY,
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
                className={getProjectChipClassName(activeId === p.id)}
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
                  className={projectChipCloseClassName}
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
