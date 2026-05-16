import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  getLogicalViewportSize,
  screenToLogicalPixels,
} from "../../utils/logicalViewport";

const FALLBACK_MENU_WIDTH = 224;
const FALLBACK_MENU_HEIGHT = 42;
const VIEWPORT_MARGIN = 8;
const MAIN_LAYOUT_SELECTOR = '[data-testid="main-layout"]';
const SHELL_MENU_SELECTOR = "[data-shell-menu-content]";

interface FallbackMenuState {
  x: number;
  y: number;
}

const clampMenuPosition = (x: number, y: number): FallbackMenuState => {
  if (typeof window === "undefined") {
    return { x, y };
  }

  const logicalX = screenToLogicalPixels(x);
  const logicalY = screenToLogicalPixels(y);
  const viewport = getLogicalViewportSize();

  return {
    x: Math.min(
      Math.max(logicalX, VIEWPORT_MARGIN),
      Math.max(
        VIEWPORT_MARGIN,
        viewport.width - FALLBACK_MENU_WIDTH - VIEWPORT_MARGIN,
      ),
    ),
    y: Math.min(
      Math.max(logicalY, VIEWPORT_MARGIN),
      Math.max(
        VIEWPORT_MARGIN,
        viewport.height - FALLBACK_MENU_HEIGHT - VIEWPORT_MARGIN,
      ),
    ),
  };
};

export const ShellContextMenuFallback: React.FC = () => {
  const [menu, setMenu] = React.useState<FallbackMenuState | null>(null);

  React.useEffect(() => {
    const closeMenu = () => setMenu(null);

    const handleContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(MAIN_LAYOUT_SELECTOR)) {
        return;
      }

      if (target.closest(SHELL_MENU_SELECTOR)) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      setMenu(clampMenuPosition(event.clientX, event.clientY));
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(SHELL_MENU_SELECTOR)) {
        return;
      }
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, []);

  return (
    <AnimatePresence>
      {menu ? (
        <motion.div
          aria-label="No context actions"
          className="shell-context-menu-content shell-context-menu-content--fallback"
          data-shell-menu-content
          initial={{ opacity: 0, scale: 0.95, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -5 }}
          role="menu"
          style={{ left: menu.x, position: "fixed", top: menu.y }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            className="shell-context-menu-item shell-context-menu-item--disabled shell-context-menu-empty-item"
            role="menuitem"
            aria-disabled="true"
          >
            <span className="shell-context-menu-label">
              <span className="shell-context-menu-text">No actions</span>
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

export default ShellContextMenuFallback;
