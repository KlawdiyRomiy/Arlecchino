import { create } from "zustand";

export type AppNotificationKind =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "progress";

export interface AppNotificationAction {
  label: string;
  run: () => void;
}

export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  title: string;
  message?: string;
  source?: string;
  action?: AppNotificationAction;
  progress?: number;
  sticky: boolean;
  timeoutMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppNotificationInput {
  id?: string;
  kind?: AppNotificationKind;
  title: string;
  message?: string;
  source?: string;
  action?: AppNotificationAction;
  progress?: number;
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
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}

const MAX_NOTIFICATIONS = 8;

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

  return {
    id: input.id ?? createNotificationId(),
    kind,
    title: input.title,
    message: input.message,
    source: input.source,
    action: input.action,
    progress:
      typeof input.progress === "number"
        ? Math.max(0, Math.min(1, input.progress))
        : undefined,
    sticky,
    timeoutMs,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const useAppNotificationStore = create<AppNotificationState>(
  (set, get) => ({
    notifications: [],

    addNotification: (input) => {
      const next = normalizeNotification(input);
      set((state) => {
        const withoutExisting = state.notifications.filter(
          (item) => item.id !== next.id,
        );
        return {
          notifications: [next, ...withoutExisting].slice(0, MAX_NOTIFICATIONS),
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
          return {
            ...item,
            ...patch,
            kind,
            progress: nextProgress,
            sticky: patch.sticky ?? item.sticky,
            timeoutMs: patch.timeoutMs ?? item.timeoutMs,
            updatedAt: Date.now(),
          };
        }),
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
