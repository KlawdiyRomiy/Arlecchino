import React from "react";
import { colors, radius, shadows, zIndex } from "../../styles/colors";

export interface MainLayoutNotification {
  type: "success" | "error";
  message: string;
}

interface NotificationToastProps {
  notification: MainLayoutNotification | null;
  onClose: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  notification,
  onClose,
}) => {
  if (!notification) {
    return null;
  }

  const notificationStyle: React.CSSProperties = {
    position: "fixed",
    bottom: "60px",
    right: "16px",
    maxWidth: "400px",
    padding: "12px 16px",
    borderRadius: radius.lg,
    boxShadow: shadows.lg,
    color: "#FFFFFF",
    fontSize: "14px",
    zIndex: zIndex.notification,
    backgroundColor:
      notification.type === "success"
        ? colors.status.success
        : colors.status.error,
  };

  const closeNotificationStyle: React.CSSProperties = {
    position: "absolute",
    top: "4px",
    right: "8px",
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.7)",
    fontSize: "18px",
    cursor: "pointer",
    lineHeight: 1,
  };

  return (
    <div style={notificationStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <span style={{ flexShrink: 0 }}>
          {notification.type === "success" ? "✓" : "✕"}
        </span>
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {notification.message}
        </div>
      </div>
      <button
        onClick={onClose}
        style={closeNotificationStyle}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = "#FFFFFF";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = "rgba(255,255,255,0.7)";
        }}
      >
        ×
      </button>
    </div>
  );
};
