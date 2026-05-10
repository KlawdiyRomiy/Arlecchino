import { useEffect } from "react";
import { EventsEmit, EventsOn } from "../wails/runtime";
import { OPEN_INTENT_EVENT, routeOpenIntent } from "./openIntentRouter";

const OPEN_INTENT_FRONTEND_READY_EVENT = "ide:frontend:ready";
const MCP_UI_EVENT_ACK = "mcp:ui-event:ack";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeMCPEventArgs = (
  args: Array<unknown>,
): { requestId?: string; args: Array<unknown> } => {
  if (args.length === 0) {
    return { args };
  }

  const first = args[0];
  if (!isRecord(first) || typeof first.mcpRequestId !== "string") {
    return { args };
  }

  const requestId = first.mcpRequestId.trim();
  if (!requestId) {
    return { args };
  }

  const sanitizedPayload = { ...first };
  delete sanitizedPayload.mcpRequestId;
  delete sanitizedPayload.mcpWrappedPayload;
  return { requestId, args: [sanitizedPayload, ...args.slice(1)] };
};

const emitMCPEventAck = (
  requestId: string | undefined,
  handled: boolean,
  error?: unknown,
  result?: unknown,
) => {
  if (!requestId) {
    return;
  }

  EventsEmit(MCP_UI_EVENT_ACK, {
    requestId,
    event: OPEN_INTENT_EVENT,
    handled,
    error: error instanceof Error ? error.message : error ? String(error) : "",
    result,
  });
};

export const useOpenIntentEventBridge = () => {
  useEffect(() => {
    const handleOpenIntent = (...args: unknown[]) => {
      const normalized = normalizeMCPEventArgs(args);
      void routeOpenIntent(normalized.args[0])
        .then((result) => {
          const handled =
            result.ok === true &&
            result.queued === false &&
            result.status === "dispatched";
          emitMCPEventAck(
            normalized.requestId,
            handled,
            handled ? undefined : result.reason,
            result,
          );
        })
        .catch((error) => {
          emitMCPEventAck(normalized.requestId, false, error);
        });
    };

    const unsubscribe = EventsOn(OPEN_INTENT_EVENT, handleOpenIntent);
    EventsEmit(OPEN_INTENT_FRONTEND_READY_EVENT, {
      contract: "open-intent",
      version: 1,
      bridge: "app",
    });

    return unsubscribe;
  }, []);
};
