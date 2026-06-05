import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { ChangeDesc } from "@codemirror/state";

const MAX_COMMIT_CHARACTERS = 16;

export type CompletionSemanticKeyReader = (
  context: CompletionContext,
) => string | null;

type StableCompletionResultOptions = {
  from: number;
  options: readonly Completion[];
  validFor: RegExp | CompletionResult["validFor"];
  semanticKey: string;
  readSemanticKey: CompletionSemanticKeyReader;
};

type StableStatusCompletionResultOptions = Omit<
  StableCompletionResultOptions,
  "validFor"
> & {
  keepThroughPrefix?: boolean;
};

export type CompletionSessionStatus =
  | "pending"
  | "active"
  | "empty"
  | "error"
  | "dismissed";

export type CompletionSessionRecord = {
  id: string;
  filePath: string;
  semanticKey: string;
  version: number;
  requestId: number;
  status: CompletionSessionStatus;
  isAccess: boolean;
  isIncomplete: boolean;
  result?: CompletionResult;
};

type BeginCompletionSessionOptions = {
  id: string;
  filePath: string;
  semanticKey: string;
  version: number;
  requestId: number;
  isAccess: boolean;
};

export type CompletionSessionController = {
  current: () => CompletionSessionRecord | null;
  clear: () => void;
  matches: (
    filePath: string,
    semanticKey: string,
    version: number,
  ) => CompletionSessionRecord | null;
  beginPending: (
    options: BeginCompletionSessionOptions,
  ) => CompletionSessionRecord;
  activate: (
    id: string,
    result: CompletionResult,
    options: { version: number; requestId: number; isIncomplete: boolean },
  ) => CompletionSessionRecord | null;
  finishEmpty: (
    id: string,
    result: CompletionResult,
    options: { version: number; requestId: number },
  ) => CompletionSessionRecord | null;
  finishError: (
    id: string,
    result: CompletionResult,
    options: { version: number; requestId: number },
  ) => CompletionSessionRecord | null;
  cancelPending: (id: string, options: { requestId: number }) => boolean;
  dismiss: () => void;
};

export function createCompletionSessionController(): CompletionSessionController {
  let session: CompletionSessionRecord | null = null;

  const updateFinished = (
    id: string,
    status: CompletionSessionStatus,
    result: CompletionResult,
    options: { version: number; requestId: number; isIncomplete?: boolean },
  ): CompletionSessionRecord | null => {
    if (
      !session ||
      session.id !== id ||
      session.requestId !== options.requestId
    ) {
      return null;
    }
    session = {
      ...session,
      status,
      result,
      version: Math.max(session.version, options.version),
      isIncomplete: options.isIncomplete ?? false,
    };
    return session;
  };

  return {
    current: () => session,
    clear: () => {
      session = null;
    },
    matches: (filePath, semanticKey, version) => {
      if (
        !session ||
        session.filePath !== filePath ||
        session.semanticKey !== semanticKey
      ) {
        return null;
      }
      if (!session.isAccess && session.version !== version) {
        return null;
      }
      if (session.isAccess && version < session.version) {
        return null;
      }
      if (
        session.isAccess &&
        (session.status === "pending" ||
          session.status === "empty" ||
          session.status === "error" ||
          session.status === "dismissed") &&
        session.version !== version
      ) {
        return null;
      }
      return session;
    },
    beginPending: (options) => {
      if (
        session?.filePath === options.filePath &&
        session.semanticKey === options.semanticKey &&
        options.version === session.version &&
        session.status === "pending"
      ) {
        return session;
      }
      session = {
        ...options,
        status: "pending",
        isIncomplete: false,
      };
      return session;
    },
    activate: (id, result, options) =>
      updateFinished(id, "active", result, options),
    finishEmpty: (id, result, options) =>
      updateFinished(id, "empty", result, options),
    finishError: (id, result, options) =>
      updateFinished(id, "error", result, options),
    cancelPending: (id, options) => {
      if (
        !session ||
        session.id !== id ||
        session.requestId !== options.requestId ||
        session.status !== "pending"
      ) {
        return false;
      }
      session = null;
      return true;
    },
    dismiss: () => {
      if (!session) return;
      session = { ...session, status: "dismissed" };
    },
  };
}

function completionTextMatchesValidFor(
  validFor: CompletionResult["validFor"],
  text: string,
  from: number,
  to: number,
  context: CompletionContext,
): boolean {
  if (!validFor) {
    return false;
  }
  if (typeof validFor === "function") {
    return validFor(text, from, to, context.state);
  }
  validFor.lastIndex = 0;
  return validFor.test(text);
}

export function stableCompletionResult({
  from,
  options,
  validFor,
  semanticKey,
  readSemanticKey,
}: StableCompletionResultOptions): CompletionResult {
  return {
    from,
    options,
    validFor,
    update(current, updateFrom, updateTo, context) {
      if (context.aborted) {
        return null;
      }
      if (readSemanticKey(context) !== semanticKey) {
        return null;
      }
      const completedText = context.state.sliceDoc(updateFrom, updateTo);
      if (
        !completionTextMatchesValidFor(
          validFor,
          completedText,
          updateFrom,
          updateTo,
          context,
        )
      ) {
        return null;
      }
      return {
        ...current,
        from: updateFrom,
        to: updateTo,
        validFor,
      };
    },
    map(current, changes: ChangeDesc) {
      return {
        ...current,
        from: changes.mapPos(current.from, 1),
        to:
          current.to === undefined ? undefined : changes.mapPos(current.to, -1),
      };
    },
  };
}

export function stableStatusCompletionResult({
  from,
  options,
  semanticKey,
  readSemanticKey,
  keepThroughPrefix = true,
}: StableStatusCompletionResultOptions): CompletionResult {
  return {
    from,
    options,
    filter: false,
    update(current, updateFrom, updateTo, context) {
      if (context.aborted) {
        return null;
      }
      if (readSemanticKey(context) !== semanticKey) {
        return null;
      }
      const completedText = context.state.sliceDoc(updateFrom, updateTo);
      if (!keepThroughPrefix && completedText.length > 0) {
        return null;
      }
      return {
        ...current,
        from: updateFrom,
        to: updateTo,
        filter: false,
      };
    },
    map(current, changes: ChangeDesc) {
      return {
        ...current,
        from: changes.mapPos(current.from, 1),
        to:
          current.to === undefined ? undefined : changes.mapPos(current.to, -1),
      };
    },
  };
}

export function lspCommitCharacters(
  value: unknown,
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const characters: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const chars = Array.from(item);
    if (chars.length !== 1 || chars[0] === "\n" || chars[0] === "\r") {
      continue;
    }
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    characters.push(item);
    if (characters.length >= MAX_COMMIT_CHARACTERS) {
      break;
    }
  }

  return characters.length > 0 ? characters : undefined;
}
