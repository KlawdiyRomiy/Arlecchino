import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { interactiveSurfaceOverlayStyle } from "./interactiveSurfaceMotion";
import {
  SHELL_DIALOG_PANEL_TRANSITION,
  SHELL_MODAL_PANEL_ANIMATE,
  SHELL_MODAL_PANEL_EXIT,
  SHELL_MODAL_PANEL_INITIAL,
} from "./motionContracts";

interface MotionShellDialogFrameProps {
  children: React.ReactNode;
  overlayClassName: string;
  panelClassName: string;
  panelTestId?: string;
}

export const MotionShellDialogFrame: React.FC<MotionShellDialogFrameProps> = ({
  children,
  overlayClassName,
  panelClassName,
  panelTestId,
}) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={overlayClassName}
      data-shell-dialog-motion="true"
      style={interactiveSurfaceOverlayStyle}
    >
      <motion.div
        className={`${panelClassName} shell-modal-surface`}
        data-testid={panelTestId}
        initial={reduceMotion ? false : SHELL_MODAL_PANEL_INITIAL}
        animate={SHELL_MODAL_PANEL_ANIMATE}
        exit={reduceMotion ? SHELL_MODAL_PANEL_ANIMATE : SHELL_MODAL_PANEL_EXIT}
        transition={
          reduceMotion ? { duration: 0 } : SHELL_DIALOG_PANEL_TRANSITION
        }
      >
        {children}
      </motion.div>
    </motion.div>
  );
};
