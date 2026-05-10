import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  type Variants,
  useReducedMotion,
} from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  X,
} from "lucide-react";
import {
  type AppNotification,
  useAppNotificationStore,
} from "../../stores/appNotificationStore";
import { radius, zIndex } from "../../styles/colors";

const visibleNotificationLimit = 4;
const collapsedStackOffset = 12;
const expandedStackOffset = 166;
const primaryRailHeight = 178;

const kindAccent: Record<AppNotification["kind"], string> = {
  info: "var(--status-info)",
  success: "var(--status-success)",
  warning: "var(--status-warning)",
  error: "var(--status-error)",
  progress: "var(--status-info)",
};

interface RailMotionState {
  expanded: boolean;
  index: number;
  reducedMotion: boolean;
}

const railVariants: Variants = {
  enter: ({ reducedMotion }: RailMotionState) =>
    reducedMotion ? { opacity: 0 } : { opacity: 0, x: 28, y: 10, scale: 0.97 },
  active: ({ expanded, index, reducedMotion }: RailMotionState) => {
    const collapsedOpacity = index < 3 ? 1 - index * 0.18 : 0;
    if (reducedMotion) {
      return {
        opacity: expanded ? 1 : collapsedOpacity,
      };
    }

    return {
      opacity: expanded ? 1 : collapsedOpacity,
      x: 0,
      y: -index * (expanded ? expandedStackOffset : collapsedStackOffset),
      scale: expanded ? 1 : Math.max(0.9, 1 - index * 0.035),
      filter:
        !expanded && index > 0
          ? `blur(${Math.min(index * 0.45, 1)}px)`
          : "blur(0px)",
    };
  },
  exit: ({ reducedMotion }: RailMotionState) =>
    reducedMotion ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.96 },
};

const stackStyle: React.CSSProperties = {
  position: "fixed",
  right: "calc(24px + env(safe-area-inset-right, 0px))",
  bottom: "calc(58px + env(safe-area-inset-bottom, 0px))",
  width: "min(520px, calc(100vw - 40px))",
  pointerEvents: "none",
  zIndex: zIndex.notification,
};

const cardBaseStyle: React.CSSProperties = {
  width: "100%",
  position: "relative",
  overflow: "hidden",
  borderRadius: "22px",
  border: "1px solid var(--shell-border-strong)",
  background:
    "linear-gradient(150deg, color-mix(in srgb, var(--surface-shell-soft) 96%, transparent), color-mix(in srgb, var(--surface-shell-panel) 98%, transparent) 58%, color-mix(in srgb, var(--surface-shell) 94%, transparent))",
  boxShadow:
    "var(--shadow-overlay), inset 0 1px 0 var(--shell-inner-highlight), inset 0 0 0 1px color-mix(in srgb, var(--border-subtle) 64%, transparent)",
  backdropFilter: "blur(22px) saturate(1.16)",
  WebkitBackdropFilter: "blur(22px) saturate(1.16)",
  color: "var(--text-primary)",
  pointerEvents: "auto",
  transformOrigin: "100% 100%",
};

const contentBaseStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "32px minmax(0, 1fr) 28px",
  columnGap: "12px",
  position: "relative",
  zIndex: 1,
};

const iconBubbleStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  flex: "0 0 32px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: radius.full,
  lineHeight: 0,
};

const iconStyle: React.CSSProperties = {
  display: "block",
  flexShrink: 0,
};

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
};

const sourceStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: "11px",
  fontWeight: 760,
  letterSpacing: "0.16em",
  lineHeight: 1.1,
  textTransform: "uppercase",
};

const tagChipStyle: React.CSSProperties = {
  minHeight: "22px",
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid var(--border-subtle)",
  borderRadius: radius.full,
  padding: "0 9px",
  background: "color-mix(in srgb, var(--surface-active) 72%, transparent)",
  color: "var(--text-secondary)",
  fontSize: "12px",
  fontWeight: 650,
  lineHeight: 1,
};

const titleStyle: React.CSSProperties = {
  marginTop: "8px",
  fontSize: "22px",
  fontWeight: 720,
  lineHeight: 1.16,
  letterSpacing: 0,
};

const compactTitleStyle: React.CSSProperties = {
  marginTop: "5px",
  fontSize: "14px",
  fontWeight: 680,
  lineHeight: 1.2,
  letterSpacing: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const messageStyle: React.CSSProperties = {
  marginTop: "10px",
  color: "var(--text-secondary)",
  fontSize: "18px",
  lineHeight: 1.34,
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
};

const closeButtonStyle: React.CSSProperties = {
  width: "28px",
  height: "28px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--border-subtle)",
  borderRadius: radius.full,
  background: "color-mix(in srgb, var(--surface-1) 76%, transparent)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const actionButtonStyle: React.CSSProperties = {
  minHeight: "34px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 14px",
  border: "1px solid var(--border-default)",
  borderRadius: radius.full,
  background: "color-mix(in srgb, var(--surface-active) 78%, transparent)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 720,
};

const detailsButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  minHeight: "30px",
  padding: "0 12px",
  background: "color-mix(in srgb, var(--surface-1) 76%, transparent)",
  color: "var(--text-secondary)",
  fontSize: "12px",
  fontWeight: 680,
};

const footerActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  flexWrap: "wrap",
};

const footerRowStyle: React.CSSProperties = {
  marginTop: "16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const timeStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "var(--text-muted)",
  fontSize: "12px",
  fontWeight: 620,
};

const detailsPanelStyle: React.CSSProperties = {
  marginTop: "12px",
  maxHeight: "168px",
  overflow: "auto",
  border: "1px solid var(--border-subtle)",
  borderRadius: "14px",
  padding: "10px 12px",
  background: "color-mix(in srgb, var(--surface-1) 68%, transparent)",
  color: "var(--text-secondary)",
  fontSize: "12px",
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const progressTrackStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: "3px",
  background: "color-mix(in srgb, var(--border-subtle) 46%, transparent)",
};

const getIconBubbleStyle = (
  notificationKind: AppNotification["kind"],
): React.CSSProperties => {
  const accent = kindAccent[notificationKind];

  return {
    ...iconBubbleStyle,
    background: `color-mix(in srgb, ${accent} 12%, var(--surface-1))`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 34%, var(--border-subtle))`,
    color: accent,
  };
};

const getIcon = (notification: AppNotification, reducedMotion: boolean) => {
  const iconProps = {
    size: 17,
    strokeWidth: 2.25,
    color: kindAccent[notification.kind],
    style: iconStyle,
  };

  switch (notification.kind) {
    case "success":
      return <CheckCircle2 {...iconProps} />;
    case "warning":
      return <AlertTriangle {...iconProps} />;
    case "error":
      return <AlertCircle {...iconProps} />;
    case "progress":
      if (reducedMotion) {
        return <Loader2 {...iconProps} />;
      }
      return (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
          style={{
            width: "17px",
            height: "17px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 0,
          }}
        >
          <Loader2 {...iconProps} />
        </motion.span>
      );
    case "info":
    default:
      return <Info {...iconProps} />;
  }
};

const formatNotificationAge = (updatedAt: number): string => {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - updatedAt) / 1000),
  );
  if (elapsedSeconds < 45) {
    return "just now";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  return `${Math.floor(elapsedHours / 24)}d ago`;
};

interface NotificationCardProps {
  notification: AppNotification;
  index: number;
  expanded: boolean;
  reducedMotion: boolean;
  visibleCount: number;
  detailsExpanded: boolean;
  onDismiss: (id: string) => void;
  onToggleDetails: (id: string) => void;
}

const NotificationCard: React.FC<NotificationCardProps> = ({
  notification,
  index,
  expanded,
  reducedMotion,
  visibleCount,
  detailsExpanded,
  onDismiss,
  onToggleDetails,
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

  const isReadable = expanded || index === 0;
  const canInteract = isReadable;
  const motionState: RailMotionState = {
    expanded,
    index,
    reducedMotion,
  };
  const stackOffset = expanded ? expandedStackOffset : collapsedStackOffset;
  const shouldShowExternalIcon = /^open\b/i.test(
    notification.action?.label ?? "",
  );
  const hasDetails = Boolean(notification.details);
  const showProgress =
    notification.kind === "progress" ||
    typeof notification.progress === "number";
  const progressValue =
    typeof notification.progress === "number"
      ? Math.max(0.08, Math.min(1, notification.progress))
      : 0.28;

  return (
    <motion.div
      custom={motionState}
      variants={railVariants}
      initial="enter"
      animate="active"
      exit="exit"
      transition={
        reducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 430, damping: 36, mass: 0.8 }
      }
      data-testid={`app-notification-${notification.id}`}
      data-kind={notification.kind}
      data-notification-state={isReadable ? "expanded" : "collapsed"}
      style={{
        ...cardBaseStyle,
        minHeight: isReadable ? `${primaryRailHeight}px` : "68px",
        position: "absolute",
        right: 0,
        bottom: reducedMotion ? `${index * stackOffset}px` : 0,
        zIndex: visibleCount - index,
        pointerEvents: canInteract ? "auto" : "none",
      }}
    >
      <div
        style={{
          ...contentBaseStyle,
          padding: isReadable ? "18px 16px 26px 24px" : "13px 14px 18px 24px",
        }}
      >
        <div style={getIconBubbleStyle(notification.kind)}>
          {getIcon(notification, reducedMotion)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={headerRowStyle}>
            {notification.source ? (
              <div style={sourceStyle}>{notification.source}</div>
            ) : null}
            {notification.tag ? (
              <div style={tagChipStyle}>{notification.tag}</div>
            ) : null}
          </div>
          <div style={isReadable ? titleStyle : compactTitleStyle}>
            {notification.title}
          </div>
          {isReadable && notification.message ? (
            <div style={messageStyle}>{notification.message}</div>
          ) : null}
          {isReadable && hasDetails && detailsExpanded ? (
            <div style={detailsPanelStyle}>{notification.details}</div>
          ) : null}
          {isReadable ? (
            <div style={footerRowStyle}>
              <div style={footerActionsStyle}>
                {notification.action ? (
                  <button
                    type="button"
                    style={actionButtonStyle}
                    onClick={() => notification.action?.run()}
                  >
                    {notification.action.label}
                    {shouldShowExternalIcon ? (
                      <ExternalLink size={14} strokeWidth={2.3} />
                    ) : null}
                  </button>
                ) : null}
                {hasDetails ? (
                  <button
                    type="button"
                    aria-expanded={detailsExpanded}
                    style={detailsButtonStyle}
                    onClick={() => onToggleDetails(notification.id)}
                  >
                    {detailsExpanded
                      ? "Hide details"
                      : (notification.detailsLabel ?? "Details")}
                  </button>
                ) : null}
              </div>
              <div style={timeStyle}>
                {formatNotificationAge(notification.updatedAt)}
              </div>
            </div>
          ) : null}
        </div>
        {isReadable ? (
          <button
            type="button"
            aria-label={`Dismiss ${notification.title}`}
            style={closeButtonStyle}
            onClick={() => onDismiss(notification.id)}
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        ) : (
          <span />
        )}
      </div>
      {showProgress ? (
        <div style={progressTrackStyle}>
          <motion.div
            initial={false}
            animate={{ width: `${progressValue * 100}%` }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: 0.22, ease: "easeOut" }
            }
            style={{
              height: "100%",
              borderRadius: radius.full,
              background: kindAccent[notification.kind],
              boxShadow: `0 0 14px color-mix(in srgb, ${kindAccent[notification.kind]} 42%, transparent)`,
            }}
          />
        </div>
      ) : null}
    </motion.div>
  );
};

export const AppNotificationStack: React.FC = () => {
  const reducedMotion = Boolean(useReducedMotion());
  const [expanded, setExpanded] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState<
    Record<string, boolean>
  >({});
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const notifications = useAppNotificationStore((state) => state.notifications);
  const dismissNotification = useAppNotificationStore(
    (state) => state.dismissNotification,
  );
  const visibleNotifications = notifications.slice(0, visibleNotificationLimit);
  const stackHeight =
    primaryRailHeight +
    Math.max(0, visibleNotifications.length - 1) *
      (expanded ? expandedStackOffset : collapsedStackOffset);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  if (visibleNotifications.length === 0 || !portalTarget) {
    return null;
  }

  return createPortal(
    <div
      aria-live="polite"
      aria-relevant="additions text"
      data-app-notification-stack="true"
      data-testid="app-notification-stack"
      data-stack-expanded={expanded ? "true" : "false"}
      style={{
        ...stackStyle,
        height: stackHeight,
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setExpanded(false);
        }
      }}
    >
      <AnimatePresence initial={false}>
        {visibleNotifications.map((notification, index) => (
          <NotificationCard
            key={`${notification.id}:${notification.revision}`}
            notification={notification}
            index={index}
            expanded={expanded}
            reducedMotion={reducedMotion}
            visibleCount={visibleNotifications.length}
            detailsExpanded={Boolean(expandedDetails[notification.id])}
            onDismiss={dismissNotification}
            onToggleDetails={(id) =>
              setExpandedDetails((current) => ({
                ...current,
                [id]: !current[id],
              }))
            }
          />
        ))}
      </AnimatePresence>
      {notifications.length > visibleNotificationLimit ? (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          style={{
            position: "absolute",
            right: 0,
            bottom: stackHeight + (expanded ? 10 : 0),
            borderRadius: radius.full,
            padding: "5px 10px",
            background:
              "color-mix(in srgb, var(--surface-overlay) 92%, transparent)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
            fontSize: "11px",
            pointerEvents: "auto",
          }}
        >
          +{notifications.length - visibleNotificationLimit} more
        </motion.div>
      ) : null}
    </div>,
    portalTarget,
  );
};
