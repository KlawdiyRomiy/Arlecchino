import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  SHELL_DIALOG_OVERLAY_TRANSITION,
  SHELL_DIALOG_PANEL_TRANSITION,
} from "./motionContracts";
import {
  interactiveSurfaceOverlayStyle,
  useInteractiveSurfaceMotion,
} from "./interactiveSurfaceMotion";

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
  const { markMotionStart, surfaceStyle } = useInteractiveSurfaceMotion(
    "dialog",
    {
      preserveTransform: true,
      reduceMotion: Boolean(reduceMotion),
    },
  );

  return (
    <motion.div
      className={overlayClassName}
      data-shell-dialog-motion="true"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
      transition={
        reduceMotion ? { duration: 0 } : SHELL_DIALOG_OVERLAY_TRANSITION
      }
      onAnimationStart={markMotionStart}
      style={interactiveSurfaceOverlayStyle}
    >
      <motion.div
        className={panelClassName}
        data-testid={panelTestId}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={
          reduceMotion
            ? { opacity: 1, scale: 1, y: 0 }
            : { opacity: 0, scale: 0.985, y: 8 }
        }
        transition={
          reduceMotion ? { duration: 0 } : SHELL_DIALOG_PANEL_TRANSITION
        }
        onAnimationStart={markMotionStart}
        style={surfaceStyle}
      >
        {children}
      </motion.div>
    </motion.div>
  );
};
