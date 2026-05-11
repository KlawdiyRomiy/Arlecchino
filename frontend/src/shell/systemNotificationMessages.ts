import { toErrorMessage } from "../utils/errorMessages";

export interface NotificationErrorPresentation {
  message: string;
  details?: string;
}

const looksLikeStructuredPayload = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
};

const toHumanLSPRestartFailure = (message: string): string | null => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("timeout waiting for response") ||
    normalized.includes("context deadline exceeded")
  ) {
    return "Language server did not respond in time.";
  }

  return null;
};

export const buildNotificationErrorPresentation = (
  error: unknown,
  fallbackMessage: string,
  toHumanMessage?: (message: string) => string | null,
): NotificationErrorPresentation => {
  const rawMessage = toErrorMessage(error).trim();
  if (!rawMessage) {
    return { message: fallbackMessage };
  }

  const message =
    toHumanMessage?.(rawMessage) ??
    (looksLikeStructuredPayload(rawMessage) ? fallbackMessage : rawMessage);

  return {
    message,
    details: rawMessage !== message ? rawMessage : undefined,
  };
};

export const buildLSPRestartFailurePresentation = (
  error: unknown,
): NotificationErrorPresentation =>
  buildNotificationErrorPresentation(
    error,
    "Language server restart failed.",
    toHumanLSPRestartFailure,
  );
