import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";

import {
  type AppNotification,
  useAppNotificationStore,
} from "../../stores/appNotificationStore";
import { MotionDropdownContent } from "../ui/MotionDropdownContent";

interface NotificationCenterButtonProps {
  buttonClassName: string;
  activeButtonClassName?: string;
  iconSize: number;
  onOpenChange?: (open: boolean) => void;
}

const kindAccent: Record<AppNotification["kind"], string> = {
  info: "var(--status-info)",
  success: "var(--status-success)",
  warning: "var(--status-warning)",
  error: "var(--status-error)",
  progress: "var(--status-info)",
};

const formatNotificationAge = (updatedAt: number): string => {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - updatedAt) / 1000),
  );
  if (elapsedSeconds < 45) {
    return "now";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }

  return `${Math.floor(elapsedHours / 24)}d`;
};

const getNotificationIcon = (notification: AppNotification) => {
  const iconProps = {
    size: 16,
    strokeWidth: 2.25,
    color: kindAccent[notification.kind],
  };

  switch (notification.kind) {
    case "success":
      return <CheckCircle2 {...iconProps} />;
    case "warning":
      return <AlertTriangle {...iconProps} />;
    case "error":
      return <AlertCircle {...iconProps} />;
    case "progress":
      return <Loader2 {...iconProps} />;
    case "info":
    default:
      return <Info {...iconProps} />;
  }
};

const NotificationCenterRow: React.FC<{
  notification: AppNotification;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
}> = ({ notification, onDismiss, onRestore }) => {
  const accent = kindAccent[notification.kind];

  return (
    <div
      className="rounded-lg border border-[var(--border-subtle)] bg-[color:var(--surface-1)]/70 px-3 py-2.5"
      data-testid={`notification-center-item-${notification.id}`}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{
            color: accent,
            background: `color-mix(in srgb, ${accent} 12%, var(--surface-1))`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 32%, var(--border-subtle))`,
          }}
        >
          {getNotificationIcon(notification)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {notification.source ? (
              <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {notification.source}
              </span>
            ) : null}
            {notification.tag ? (
              <span className="max-w-[120px] truncate rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                {notification.tag}
              </span>
            ) : null}
            {notification.minimized ? (
              <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Minimized
              </span>
            ) : null}
            <span className="ml-auto shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">
              {formatNotificationAge(notification.updatedAt)}
            </span>
          </div>

          <div className="mt-1 truncate text-[13px] font-semibold leading-tight text-[var(--text-primary)]">
            {notification.title}
          </div>
          {notification.message ? (
            <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-[var(--text-secondary)]">
              {notification.message}
            </div>
          ) : null}
          {notification.details ? (
            <div className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-subtle)] bg-[color:var(--surface-2)]/55 px-2 py-1.5 text-[11px] leading-snug text-[var(--text-muted)]">
              {notification.details}
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {notification.action ? (
              <button
                type="button"
                className="shell-control h-8 gap-1.5 rounded-full px-3 text-[12px] font-semibold text-[var(--text-primary)]"
                onClick={() => notification.action?.run()}
              >
                {notification.action.label}
              </button>
            ) : null}
            {notification.minimized ? (
              <button
                type="button"
                className="shell-control h-8 gap-1.5 rounded-full px-3 text-[12px] font-semibold text-[var(--text-secondary)]"
                onClick={() => onRestore(notification.id)}
              >
                <RotateCcw size={13} strokeWidth={2.2} />
                Show
              </button>
            ) : null}
            <button
              type="button"
              className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              aria-label={`Dismiss ${notification.title}`}
              onClick={() => onDismiss(notification.id)}
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const NotificationCenterButton: React.FC<
  NotificationCenterButtonProps
> = ({
  buttonClassName,
  activeButtonClassName = "",
  iconSize,
  onOpenChange,
}) => {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const notifications = useAppNotificationStore((state) => state.notifications);
  const dismissNotification = useAppNotificationStore(
    (state) => state.dismissNotification,
  );
  const restoreNotification = useAppNotificationStore(
    (state) => state.restoreNotification,
  );
  const unreadCount = notifications.length;
  const errorCount = notifications.filter(
    (notification) => notification.kind === "error",
  ).length;
  const warningCount = notifications.filter(
    (notification) => notification.kind === "warning",
  ).length;
  const attentionCount = errorCount + warningCount;
  const attentionAccent =
    errorCount > 0 ? kindAccent.error : kindAccent.warning;

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
      if (!nextOpen) {
        window.requestAnimationFrame(() => triggerRef.current?.blur());
        window.setTimeout(() => triggerRef.current?.blur(), 0);
      }
    },
    [onOpenChange],
  );
  const handleTriggerPointerDownOutside = React.useCallback((event: Event) => {
    const target = event.target;
    if (target instanceof Node && triggerRef.current?.contains(target)) {
      event.preventDefault();
    }
  }, []);

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={`${buttonClassName} ${open ? activeButtonClassName : ""} relative outline-none focus:outline-none`}
          title="Notifications"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount}` : ""}`}
          aria-expanded={open}
          data-testid="topbar-notifications-button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => handleOpenChange(!open)}
        >
          <Bell size={iconSize} />
          {unreadCount > 0 ? (
            <span
              className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white"
              style={{
                background:
                  attentionCount > 0 ? attentionAccent : "var(--status-info)",
              }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <MotionDropdownContent
          align="end"
          sideOffset={8}
          className="shell-menu-content w-[400px] max-w-[calc(100vw-32px)] p-0"
          data-shell-menu-content
          data-testid="topbar-notifications-menu"
          onPointerDownOutside={handleTriggerPointerDownOutside}
        >
          <div className="flex items-center justify-between border-b border-[var(--shell-inline-divider)] px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                Notifications
              </div>
              {unreadCount > 0 ? (
                <div className="text-[11px] font-medium text-[var(--text-muted)]">
                  {unreadCount} in notification center
                </div>
              ) : null}
            </div>
            {attentionCount > 0 ? (
              <span
                className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  borderColor: `color-mix(in srgb, ${attentionAccent} 30%, transparent)`,
                  color: attentionAccent,
                }}
              >
                {attentionCount} attention
              </span>
            ) : null}
          </div>

          <div className="max-h-[min(440px,calc(100vh-120px))] overflow-y-auto p-2">
            {notifications.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-7 text-center text-[15px] font-semibold text-[var(--text-muted)]">
                No active system notifications
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {notifications.map((notification) => (
                  <NotificationCenterRow
                    key={`${notification.id}:${notification.revision}`}
                    notification={notification}
                    onDismiss={dismissNotification}
                    onRestore={restoreNotification}
                  />
                ))}
              </div>
            )}
          </div>
        </MotionDropdownContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
