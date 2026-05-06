import React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { AnimatePresence, motion } from "framer-motion";
import {
  buildNativeContextMenuItems,
  getContextActionId,
  NATIVE_CONTEXT_MENU_ACTION_EVENT,
  openNativeContextMenu,
  shouldIgnoreContextMenuTarget,
  type NativeContextMenuActionPayload,
} from "../../shell/nativeContextMenu";
import { canUseShellCapability } from "../../shell/shellCapabilities";
import { EventsOn } from "../../wails/runtime";

export interface ContextActionMenuItem {
  actionId?: string;
  key?: string;
  label?: string;
  shortcut?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  hidden?: boolean;
  onSelect?: () => void;
}

interface ContextActionMenuProps {
  children: React.ReactNode;
  items: ContextActionMenuItem[];
  nativeScope?: string;
  nativeContext?: Record<string, unknown>;
  nativeSurfaceId?: string;
  nativeTargetId?: string;
  ignoredTargetSelector?: string;
  onContextMenuCapture?: (event: React.MouseEvent<HTMLElement>) => void;
}

const baseItemClassName =
  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[13px] outline-none transition-colors";

export const ContextActionMenu: React.FC<ContextActionMenuProps> = ({
  children,
  items,
  nativeScope = "context-action-menu",
  nativeContext,
  nativeSurfaceId,
  nativeTargetId,
  ignoredTargetSelector,
  onContextMenuCapture,
}) => {
  const [open, setOpen] = React.useState(false);
  const menuInstanceIdRef = React.useRef(
    `context-menu-${Math.random().toString(36).slice(2, 10)}`,
  );
  const actionRegistryRef = React.useRef(new Map<string, () => void>());
  const suppressNextOpenRef = React.useRef(false);
  const closeAndRun = React.useCallback((action?: () => void) => {
    setOpen(false);

    if (!action) {
      return;
    }

    window.setTimeout(() => {
      action();
    }, 0);
  }, []);
  const setContextMenuOpen = React.useCallback((nextOpen: boolean) => {
    if (nextOpen && suppressNextOpenRef.current) {
      suppressNextOpenRef.current = false;
      return;
    }

    if (!nextOpen) {
      suppressNextOpenRef.current = false;
    }

    setOpen(nextOpen);
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  const visibleItems = React.useMemo(
    () =>
      items.filter((item, index, array) => {
        if (item.hidden) {
          return false;
        }

        if (!item.separator) {
          return true;
        }

        const previousVisibleAction = array
          .slice(0, index)
          .some((entry) => !entry.hidden && !entry.separator);
        const nextVisibleAction = array
          .slice(index + 1)
          .some((entry) => !entry.hidden && !entry.separator);
        return previousVisibleAction && nextVisibleAction;
      }),
    [items],
  );

  React.useEffect(() => {
    return EventsOn<[NativeContextMenuActionPayload]>(
      NATIVE_CONTEXT_MENU_ACTION_EVENT,
      (payload) => {
        if (payload.menuInstanceId !== menuInstanceIdRef.current) {
          return;
        }

        const actionId = payload.actionId?.trim();
        if (!actionId) {
          return;
        }

        closeAndRun(actionRegistryRef.current.get(actionId));
      },
    );
  }, [closeAndRun]);

  if (visibleItems.length === 0) {
    return <>{children}</>;
  }

  const handleNativeContextMenuCapture = (
    event: React.MouseEvent<HTMLElement>,
  ) => {
    onContextMenuCapture?.(event);

    if (shouldIgnoreContextMenuTarget(event.target, ignoredTargetSelector)) {
      suppressNextOpenRef.current = true;
      window.setTimeout(() => {
        suppressNextOpenRef.current = false;
      }, 0);
      return;
    }

    if (!canUseShellCapability("contextMenu")) {
      return;
    }

    const nativeItems = buildNativeContextMenuItems(visibleItems);
    const actionRegistry = new Map<string, () => void>();
    visibleItems.forEach((item, index) => {
      if (item.separator || item.disabled || !item.onSelect) {
        return;
      }
      actionRegistry.set(getContextActionId(item, index), item.onSelect);
    });
    if (actionRegistry.size === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    actionRegistryRef.current = actionRegistry;

    void openNativeContextMenu({
      menuInstanceId: menuInstanceIdRef.current,
      scope: nativeScope,
      surfaceId: nativeSurfaceId,
      targetId: nativeTargetId,
      x: event.clientX,
      y: event.clientY,
      items: nativeItems,
      context: nativeContext,
    });
  };

  return (
    <ContextMenu.Root onOpenChange={setContextMenuOpen}>
      <ContextMenu.Trigger
        asChild
        onContextMenuCapture={handleNativeContextMenuCapture}
      >
        {children}
      </ContextMenu.Trigger>

      <AnimatePresence>
        {open ? (
          <ContextMenu.Portal forceMount>
            <ContextMenu.Content
              asChild
              onEscapeKeyDown={(event) => {
                event.preventDefault();
                setOpen(false);
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -5 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                className="z-[120] min-w-[196px] overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-1 shadow-xl"
              >
                {visibleItems.map((item, index) => {
                  if (item.separator) {
                    return (
                      <ContextMenu.Separator
                        key={item.key ?? `separator-${index}`}
                        className="my-1 h-px bg-[var(--border-subtle)]"
                      />
                    );
                  }

                  return (
                    <ContextMenu.Item
                      key={item.key ?? item.label ?? `item-${index}`}
                      disabled={item.disabled}
                      onSelect={() => {
                        if (item.disabled) {
                          return;
                        }

                        closeAndRun(item.onSelect);
                      }}
                      className="outline-none"
                    >
                      <div
                        className={`${baseItemClassName} ${
                          item.danger
                            ? "text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:hover:bg-transparent"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:hover:bg-transparent"
                        } ${item.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {item.icon ? (
                            <span className="shrink-0">{item.icon}</span>
                          ) : null}
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.shortcut ? (
                          <span className="ml-6 shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                            {item.shortcut}
                          </span>
                        ) : null}
                      </div>
                    </ContextMenu.Item>
                  );
                })}
              </motion.div>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        ) : null}
      </AnimatePresence>
    </ContextMenu.Root>
  );
};

export default ContextActionMenu;
