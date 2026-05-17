import React from "react";
import {
  m,
  useReducedMotion,
  type HTMLMotionProps,
} from "framer-motion";

interface AIChatPopoverFrameProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
}

export function AIChatPopoverFrame({
  children,
  className = "",
  ...props
}: AIChatPopoverFrameProps) {
  const reduceMotion = useReducedMotion();
  return (
    <m.div
      {...props}
      className={`ai-chat-popover ai-chat-popover-frame ${className}`.trim()}
      initial={
        reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }
      }
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.985 }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.16,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </m.div>
  );
}
