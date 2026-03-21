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

const blurTransition = { duration: 0.35, ease: "easeInOut" } as const;
const blurInitial = { opacity: 0, filter: "blur(4px)" };
const blurAnimate = { opacity: 1, filter: "blur(0px)" };

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
            initial={blurInitial}
            animate={blurAnimate}
            exit={blurInitial}
            transition={blurTransition}
          >
            {projects.map((p) => (
              <button
                key={p.id}
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
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            className="project-indicators-expanded flex items-center gap-1"
            initial={blurInitial}
            animate={blurAnimate}
            exit={blurInitial}
            transition={blurTransition}
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
                className={`group flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] whitespace-nowrap transition-colors ${
                  activeId === p.id
                    ? "border border-[var(--border-subtle)] text-[var(--text-primary)]"
                    : "border border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <FolderOpen size={13} className="shrink-0 opacity-60" />
                <span>{p.name}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(p.id);
                    stopTimer();
                  }}
                  className="shrink-0 ml-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                >
                  <X size={10} />
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
