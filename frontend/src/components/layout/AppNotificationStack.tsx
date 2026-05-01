import React, { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
} from "lucide-react";
import {
  type AppNotification,
  useAppNotificationStore,
} from "../../stores/appNotificationStore";
import { radius, shadows, zIndex } from "../../styles/colors";

const visibleNotificationLimit = 4;

const kindAccent: Record<AppNotification["kind"], string> = {
  info: "#78a8ff",
  success: "#5dd48a",
  warning: "#f2c76b",
  error: "#ff6b77",
  progress: "#91b7ff",
};

const stackStyle: React.CSSProperties = {
  position: "fixed",
  top: "calc(18px + env(safe-area-inset-top, 0px))",
  right: "calc(18px + env(safe-area-inset-right, 0px))",
  width: "min(392px, calc(100vw - 32px))",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  pointerEvents: "none",
  zIndex: zIndex.notification,
};

const cardBaseStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  borderRadius: radius.lg,
  border: "1px solid rgba(255, 255, 255, 0.11)",
  background:
    "linear-gradient(180deg, rgba(24, 27, 31, 0.96), rgba(13, 15, 18, 0.96))",
  boxShadow: `${shadows.floating}, 0 0 0 1px rgba(0, 0, 0, 0.28)`,
  color: "rgba(245, 247, 250, 0.94)",
  pointerEvents: "auto",
};

const contentStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr) 28px",
  gap: "10px",
  padding: "13px 13px 13px 14px",
};

const titleStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 620,
  lineHeight: 1.25,
  letterSpacing: 0,
};

const messageStyle: React.CSSProperties = {
  marginTop: "4px",
  color: "rgba(222, 228, 236, 0.72)",
  fontSize: "12px",
  lineHeight: 1.38,
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
};

const sourceStyle: React.CSSProperties = {
  marginBottom: "4px",
  color: "rgba(168, 179, 194, 0.66)",
  fontSize: "10px",
  fontWeight: 650,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const closeButtonStyle: React.CSSProperties = {
  width: "28px",
  height: "28px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: radius.md,
  background: "rgba(255, 255, 255, 0.04)",
  color: "rgba(237, 241, 247, 0.66)",
  cursor: "pointer",
};

const actionButtonStyle: React.CSSProperties = {
  marginTop: "10px",
  height: "30px",
  padding: "0 12px",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: radius.md,
  background: "rgba(255, 255, 255, 0.08)",
  color: "rgba(248, 250, 252, 0.94)",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 650,
};

const getIcon = (notification: AppNotification) => {
  const iconProps = {
    size: 18,
    strokeWidth: 2.2,
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
      return (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
          style={{ display: "inline-flex" }}
        >
          <Loader2 {...iconProps} />
        </motion.span>
      );
    case "info":
    default:
      return <Info {...iconProps} />;
  }
};

interface NotificationCardProps {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}

const NotificationCard: React.FC<NotificationCardProps> = ({
  notification,
  onDismiss,
}) => {
  useEffect(() => {
    if (notification.sticky || notification.timeoutMs <= 0) {
      return;
    }

    const elapsed = Date.now() - notification.updatedAt;
    const timeout = window.setTimeout(
      () => onDismiss(notification.id),
      Math.max(400, notification.timeoutMs - elapsed),
    );

    return () => window.clearTimeout(timeout);
  }, [
    notification.id,
    notification.sticky,
    notification.timeoutMs,
    notification.updatedAt,
    onDismiss,
  ]);

  const progress =
    typeof notification.progress === "number"
      ? Math.max(0, Math.min(1, notification.progress))
      : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 18, scale: 0.98 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={cardBaseStyle}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderLeft: `3px solid ${kindAccent[notification.kind]}`,
          pointerEvents: "none",
        }}
      />
      <div style={contentStyle}>
        <div style={{ paddingTop: "1px" }}>{getIcon(notification)}</div>
        <div style={{ minWidth: 0 }}>
          {notification.source ? (
            <div style={sourceStyle}>{notification.source}</div>
          ) : null}
          <div style={titleStyle}>{notification.title}</div>
          {notification.message ? (
            <div style={messageStyle}>{notification.message}</div>
          ) : null}
          {notification.action ? (
            <button
              type="button"
              style={actionButtonStyle}
              onClick={() => notification.action?.run()}
            >
              {notification.action.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          style={closeButtonStyle}
          onClick={() => onDismiss(notification.id)}
        >
          <X size={15} strokeWidth={2.3} />
        </button>
      </div>
      {progress !== null ? (
        <div
          aria-hidden
          style={{
            height: "2px",
            background: "rgba(255, 255, 255, 0.08)",
          }}
        >
          <div
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: "100%",
              background: kindAccent[notification.kind],
              transition: "width 160ms ease-out",
            }}
          />
        </div>
      ) : null}
    </motion.div>
  );
};

export const AppNotificationStack: React.FC = () => {
  const reducedMotion = useReducedMotion();
  const notifications = useAppNotificationStore((state) => state.notifications);
  const dismissNotification = useAppNotificationStore(
    (state) => state.dismissNotification,
  );
  const visibleNotifications = notifications.slice(0, visibleNotificationLimit);

  if (visibleNotifications.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      aria-relevant="additions text"
      style={stackStyle}
      data-testid="app-notification-stack"
    >
      <AnimatePresence initial={false}>
        {visibleNotifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={dismissNotification}
          />
        ))}
      </AnimatePresence>
      {notifications.length > visibleNotificationLimit ? (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          style={{
            alignSelf: "flex-end",
            borderRadius: radius.full,
            padding: "5px 10px",
            background: "rgba(11, 13, 16, 0.86)",
            border: "1px solid rgba(255, 255, 255, 0.09)",
            color: "rgba(222, 228, 236, 0.72)",
            fontSize: "11px",
            pointerEvents: "auto",
          }}
        >
          +{notifications.length - visibleNotificationLimit} more
        </motion.div>
      ) : null}
    </div>
  );
};
