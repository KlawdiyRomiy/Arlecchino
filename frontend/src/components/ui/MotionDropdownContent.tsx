import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion, useReducedMotion } from "framer-motion";
import { SHELL_DROPDOWN_TRANSITION } from "./motionContracts";
import { useInteractiveSurfaceMotion } from "./interactiveSurfaceMotion";

const POINTER_OPEN_CAPTURE_WINDOW_MS = 1200;

let lastDropdownTriggerPointerDownAt = Number.NEGATIVE_INFINITY;
let dropdownTriggerPointerTrackerInstalled = false;

const getInteractionNow = (): number =>
  typeof performance === "undefined" ? Date.now() : performance.now();

const isDropdownTriggerPointerTarget = (
  target: EventTarget | null,
): target is Element =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  target.closest('[aria-haspopup="menu"]') !== null;

const installDropdownTriggerPointerTracker = () => {
  if (dropdownTriggerPointerTrackerInstalled || typeof window === "undefined") {
    return;
  }

  dropdownTriggerPointerTrackerInstalled = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (isDropdownTriggerPointerTarget(event.target)) {
        lastDropdownTriggerPointerDownAt = getInteractionNow();
      }
    },
    true,
  );
};

installDropdownTriggerPointerTracker();

const wasOpenedFromRecentPointerTrigger = (): boolean =>
  getInteractionNow() - lastDropdownTriggerPointerDownAt <=
  POINTER_OPEN_CAPTURE_WINDOW_MS;

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
>(
  (
    {
      children,
      style,
      collisionPadding = 8,
      onEscapeKeyDown,
      onCloseAutoFocus,
      ...contentProps
    },
    ref,
  ) => {
    const prefersReducedMotion = useReducedMotion();
    const openedByPointerRef = React.useRef(
      wasOpenedFromRecentPointerTrigger(),
    );
    const escapeCloseRef = React.useRef(false);
    const { markMotionStart, reduceMotion, surfaceStyle } =
      useInteractiveSurfaceMotion("dropdown", {
        preserveTransform: true,
        reduceMotion: Boolean(prefersReducedMotion),
      });

    const handleEscapeKeyDown: DropdownMenuContentProps["onEscapeKeyDown"] = (
      event,
    ) => {
      onEscapeKeyDown?.(event);
      escapeCloseRef.current = !event.defaultPrevented;
    };

    const handleCloseAutoFocus: DropdownMenuContentProps["onCloseAutoFocus"] = (
      event,
    ) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) {
        escapeCloseRef.current = false;
        return;
      }

      if (escapeCloseRef.current && openedByPointerRef.current) {
        event.preventDefault();
        window.requestAnimationFrame(() => {
          const activeElement = document.activeElement;
          if (activeElement instanceof HTMLElement) {
            activeElement.blur();
          }
        });
      }

      escapeCloseRef.current = false;
    };

    return (
      <DropdownMenu.Content
        {...contentProps}
        collisionPadding={collisionPadding}
        onCloseAutoFocus={handleCloseAutoFocus}
        onEscapeKeyDown={handleEscapeKeyDown}
        asChild
      >
        <motion.div
          ref={ref}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: -4 }}
          animate={
            reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }
          }
          exit={
            reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98, y: -4 }
          }
          transition={
            reduceMotion ? { duration: 0 } : SHELL_DROPDOWN_TRANSITION
          }
          onAnimationStart={markMotionStart}
          style={{
            transformOrigin:
              "var(--radix-dropdown-menu-content-transform-origin)",
            ...surfaceStyle,
            ...style,
          }}
          data-motion-dropdown="true"
        >
          {children}
        </motion.div>
      </DropdownMenu.Content>
    );
  },
);

MotionDropdownContent.displayName = "MotionDropdownContent";
