const structuredMessageKeys = ["message", "error", "reason"] as const;

const parseStructuredErrorString = (value: string): unknown | null => {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const extractStructuredMessage = (
  value: unknown,
  seen: WeakSet<object>,
): string | null => {
  if (value instanceof Error) {
    return extractStructuredMessage(value.message, seen);
  }

  if (typeof value === "string") {
    const parsed = parseStructuredErrorString(value);
    if (parsed !== null) {
      const parsedMessage = extractStructuredMessage(parsed, seen);
      if (parsedMessage) {
        return parsedMessage;
      }
    }

    const trimmed = value.trim();
    return trimmed || null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of structuredMessageKeys) {
    const message = extractStructuredMessage(record[key], seen);
    if (message) {
      return message;
    }
  }

  return null;
};

export const toErrorMessage = (error: unknown): string => {
  const structuredMessage = extractStructuredMessage(error, new WeakSet());
  if (structuredMessage) {
    return structuredMessage;
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
};
