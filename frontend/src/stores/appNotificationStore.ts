import { create } from "zustand";

export type AppNotificationKind =
  "info" | "success" | "warning" | "error" | "progress";

export interface AppNotificationAction {
  label: string;
  run: () => void;
}

export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  title: string;
  message?: string;
  details?: string;
  detailsLabel?: string;
  source?: string;
  tag?: string;
  action?: AppNotificationAction;
  progress?: number;
  minimized: boolean;
  sticky: boolean;
  timeoutMs: number;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface AppNotificationInput {
  id?: string;
  kind?: AppNotificationKind;
  title: string;
  message?: string;
  details?: string;
  detailsLabel?: string;
  source?: string;
  tag?: string;
  action?: AppNotificationAction;
  progress?: number;
  minimized?: boolean;
  sticky?: boolean;
  timeoutMs?: number;
}

export type AppNotificationPatch = Partial<
  Omit<AppNotification, "id" | "createdAt">
>;

interface AppNotificationState {
  notifications: AppNotification[];
  addNotification: (input: AppNotificationInput) => string;
  updateNotification: (id: string, patch: AppNotificationPatch) => void;
  minimizeNotification: (id: string) => void;
  restoreNotification: (id: string) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}

const MAX_NOTIFICATIONS = 24;
const MAX_NOTIFICATION_TITLE_LENGTH = 160;
const MAX_NOTIFICATION_MESSAGE_LENGTH = 480;

const truncateNotificationText = (value: string, maxLength: number): string =>
  value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;

const normalizeNotificationContent = <
  T extends Pick<
    AppNotification,
    "title" | "message" | "details" | "detailsLabel"
  >,
>(
  notification: T,
): T => {
  const fullMessage = notification.message?.trim();
  const message = fullMessage
    ? truncateNotificationText(fullMessage, MAX_NOTIFICATION_MESSAGE_LENGTH)
    : undefined;
  const messageWasTruncated = message !== fullMessage;
  const details =
    notification.details?.trim() ||
    (messageWasTruncated ? fullMessage : undefined);

  return {
    ...notification,
    title: truncateNotificationText(
      notification.title.trim(),
      MAX_NOTIFICATION_TITLE_LENGTH,
    ),
    message,
    details,
    detailsLabel:
      notification.detailsLabel ??
      (messageWasTruncated ? "Full output" : undefined),
  };
};

const defaultTimeoutMs = (kind: AppNotificationKind): number => {
  switch (kind) {
    case "error":
      return 7000;
    case "warning":
      return 6000;
    case "progress":
      return 0;
    case "success":
      return 3200;
    case "info":
    default:
      return 4200;
  }
};

const createNotificationId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const normalizeNotification = (
  input: AppNotificationInput,
): AppNotification => {
  const kind = input.kind ?? "info";
  const timestamp = Date.now();
  const sticky = input.sticky ?? kind === "progress";
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs(kind);

  return normalizeNotificationContent({
    id: input.id ?? createNotificationId(),
    kind,
    title: input.title,
    message: input.message,
    details: input.details,
    detailsLabel: input.detailsLabel,
    source: input.source,
    tag: input.tag,
    action: input.action,
    progress:
      typeof input.progress === "number"
        ? Math.max(0, Math.min(1, input.progress))
        : undefined,
    minimized: input.minimized ?? false,
    sticky,
    timeoutMs,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  });
};

export const useAppNotificationStore = create<AppNotificationState>(
  (set, get) => ({
    notifications: [],

    addNotification: (input) => {
      const next = normalizeNotification(input);
      set((state) => {
        const previous = state.notifications.find(
          (item) => item.id === next.id,
        );
        const withoutExisting = state.notifications.filter(
          (item) => item.id !== next.id,
        );
        const refreshed = previous
          ? {
              ...next,
              createdAt: previous.createdAt,
              revision: previous.revision + 1,
            }
          : next;
        return {
          notifications: [refreshed, ...withoutExisting].slice(
            0,
            MAX_NOTIFICATIONS,
          ),
        };
      });
      return next.id;
    },

    updateNotification: (id, patch) => {
      const current = get().notifications.find((item) => item.id === id);
      if (!current) {
        return;
      }

      set((state) => ({
        notifications: state.notifications.map((item) => {
          if (item.id !== id) {
            return item;
          }
          const kind = patch.kind ?? item.kind;
          const nextProgress =
            typeof patch.progress === "number"
              ? Math.max(0, Math.min(1, patch.progress))
              : patch.progress;
          return normalizeNotificationContent({
            ...item,
            ...patch,
            kind,
            progress: nextProgress,
            minimized: patch.minimized ?? item.minimized,
            sticky: patch.sticky ?? item.sticky,
            timeoutMs: patch.timeoutMs ?? item.timeoutMs,
            updatedAt: Date.now(),
            revision: item.revision + 1,
          });
        }),
      }));
    },

    minimizeNotification: (id) => {
      set((state) => ({
        notifications: state.notifications.map((item) =>
          item.id === id
            ? {
                ...item,
                minimized: true,
                updatedAt: Date.now(),
                revision: item.revision + 1,
              }
            : item,
        ),
      }));
    },

    restoreNotification: (id) => {
      set((state) => ({
        notifications: state.notifications.map((item) =>
          item.id === id
            ? {
                ...item,
                minimized: false,
                updatedAt: Date.now(),
                revision: item.revision + 1,
              }
            : item,
        ),
      }));
    },

    dismissNotification: (id) => {
      set((state) => ({
        notifications: state.notifications.filter((item) => item.id !== id),
      }));
    },

    clearNotifications: () => set({ notifications: [] }),
  }),
);
