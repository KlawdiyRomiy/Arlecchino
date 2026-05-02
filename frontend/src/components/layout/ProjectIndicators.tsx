import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderOpen, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useCollapseTimer } from "../../hooks/useCollapseTimer";

interface ProjectIndicatorsProps {
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}

const fadeTransition = { duration: 0.16, ease: "easeOut" } as const;
const fadeInitial = { opacity: 0, y: -2 };
const fadeAnimate = { opacity: 1, y: 0 };

export const ProjectIndicators: React.FC<ProjectIndicatorsProps> = ({
  onSwitch,
  onClose,
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
            className="project-indicators-expanded flex items-center gap-1"
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
                onClick={() => {
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
                  className="ml-0.5 shrink-0 cursor-pointer rounded-full p-0.5 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-70 hover:!opacity-100"
                >
                  <X size={12} />
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
