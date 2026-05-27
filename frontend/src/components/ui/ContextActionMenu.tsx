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
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
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
  items: ContextActionMenuItem[] | (() => ContextActionMenuItem[]);
  nativeScope?: string;
  nativeContext?: Record<string, unknown>;
  nativeSurfaceId?: string;
  nativeTargetId?: string;
  preferNative?: boolean;
  ignoredTargetSelector?: string;
  onContextMenuCapture?: (event: React.MouseEvent<HTMLElement>) => void;
}

const getItemClassName = (item: ContextActionMenuItem) =>
  [
    "shell-context-menu-item",
    item.danger ? "shell-context-menu-item--danger" : null,
    item.disabled ? "shell-context-menu-item--disabled" : null,
  ]
    .filter(Boolean)
    .join(" ");

const formatShortcutLabel = (shortcut: string): string =>
  shortcut
    .replace(/\b(?:cmd|command)\b/gi, "⌘")
    .replace(/\b(?:ctrl|control)\b/gi, "⌃")
    .replace(/\b(?:alt|option|opt)\b/gi, "⌥")
    .replace(/\bshift\b/gi, "⇧")
    .replace(/\s*\+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const filterVisibleContextItems = (items: ContextActionMenuItem[]) =>
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
  });

export const ContextActionMenu: React.FC<ContextActionMenuProps> = ({
  children,
  items,
  nativeScope = "context-action-menu",
  nativeContext,
  nativeSurfaceId,
  nativeTargetId,
  preferNative = false,
  ignoredTargetSelector,
  onContextMenuCapture,
}) => {
  const [open, setOpen] = React.useState(false);
  const resolveItems = React.useCallback(
    () => (typeof items === "function" ? items() : items),
    [items],
  );
  const [resolvedItems, setResolvedItems] = React.useState<
    ContextActionMenuItem[]
  >(() => resolveItems());
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
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
    if (typeof items !== "function") {
      setResolvedItems(items);
    }
  }, [items]);

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

  React.useEffect(() => {
    if (!open) {
      return;
    }

    let portalElement: HTMLElement | null = null;
    const frameId = window.requestAnimationFrame(() => {
      const content = document.querySelector(
        `[data-shell-context-menu-id="${menuInstanceIdRef.current}"]`,
      );
      portalElement = content?.closest("[data-radix-portal]") ?? null;
      if (!portalElement) {
        return;
      }

      portalElement.dataset.shellContextMenuPortal = "true";
      portalElement.style.width = "100%";
      portalElement.style.height = "100%";
      portalElement.style.transform = "none";
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (!portalElement) {
        return;
      }

      delete portalElement.dataset.shellContextMenuPortal;
      portalElement.style.removeProperty("width");
      portalElement.style.removeProperty("height");
      portalElement.style.removeProperty("transform");
    };
  }, [open]);

  const visibleItems = React.useMemo(
    () => filterVisibleContextItems(resolvedItems),
    [resolvedItems],
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

  if (visibleItems.length === 0 && typeof items !== "function") {
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

    if (!preferNative || !canUseShellCapability("contextMenu")) {
      setResolvedItems(resolveItems());
      return;
    }

    const nextItems = resolveItems();
    setResolvedItems(nextItems);
    const nextVisibleItems = filterVisibleContextItems(nextItems);
    const nativeItems = buildNativeContextMenuItems(nextVisibleItems);
    const actionRegistry = new Map<string, () => void>();
    nextVisibleItems.forEach((item, index) => {
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
                className="shell-context-menu-content"
                data-shell-context-menu-id={menuInstanceIdRef.current}
                data-shell-menu-content
                style={
                  {
                    "--shell-context-menu-scale": String(uiScale),
                  } as React.CSSProperties
                }
              >
                {visibleItems.map((item, index) => {
                  if (item.separator) {
                    return (
                      <ContextMenu.Separator
                        key={item.key ?? `separator-${index}`}
                        className="shell-context-menu-separator"
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
                      className="shell-context-menu-radix-item"
                    >
                      <div className={getItemClassName(item)}>
                        <span className="shell-context-menu-label">
                          {item.icon ? (
                            <span className="shell-context-menu-icon">
                              {item.icon}
                            </span>
                          ) : null}
                          <span className="shell-context-menu-text">
                            {item.label}
                          </span>
                        </span>
                        {item.shortcut ? (
                          <span className="shell-context-menu-shortcut">
                            {formatShortcutLabel(item.shortcut)}
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
