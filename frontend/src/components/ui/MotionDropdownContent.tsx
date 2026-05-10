import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion, useReducedMotion } from "framer-motion";
import { SHELL_DROPDOWN_TRANSITION } from "./motionContracts";

type DropdownMenuContentProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenu.Content
>;

export type MotionDropdownContentProps = Omit<
  DropdownMenuContentProps,
  "asChild"
>;

export const MotionDropdownContent = React.forwardRef<
  HTMLDivElement,
  MotionDropdownContentProps
>(({ children, style, collisionPadding = 8, ...contentProps }, ref) => {
  const reduceMotion = useReducedMotion();

  return (
    <DropdownMenu.Content
      {...contentProps}
      collisionPadding={collisionPadding}
      asChild
    >
      <motion.div
        ref={ref}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: -4 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={
          reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98, y: -4 }
        }
        transition={reduceMotion ? { duration: 0 } : SHELL_DROPDOWN_TRANSITION}
        style={{
          transformOrigin:
            "var(--radix-dropdown-menu-content-transform-origin)",
          ...style,
        }}
        data-motion-dropdown="true"
      >
        {children}
      </motion.div>
    </DropdownMenu.Content>
  );
});

MotionDropdownContent.displayName = "MotionDropdownContent";
