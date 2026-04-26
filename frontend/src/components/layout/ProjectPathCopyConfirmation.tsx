import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

interface ProjectPathCopyConfirmationProps {
  visible: boolean;
  projectPath: string;
}

export const ProjectPathCopyConfirmation: React.FC<
  ProjectPathCopyConfirmationProps
> = ({ visible, projectPath }) => (
  <AnimatePresence>
    {visible && projectPath ? (
      <motion.div
        key="project-path-copy-confirmation"
        initial={{ opacity: 0, x: "-50%", y: -4, scale: 0.98 }}
        animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
        exit={{ opacity: 0, x: "-50%", y: -4, scale: 0.98 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        className="pointer-events-none fixed left-1/2 top-[72px] z-[80] inline-flex items-center gap-2 rounded-[18px] border border-[var(--shell-border-strong)] bg-[var(--surface-shell-strong)] px-3 py-2 text-[12px] font-medium text-[var(--text-primary)] shadow-[var(--shadow-overlay)]"
        data-testid="project-path-copy-confirmation"
      >
        <CheckCircle2 size={14} className="text-[var(--status-success)]" />
        <span>Project path copied</span>
      </motion.div>
    ) : null}
  </AnimatePresence>
);
