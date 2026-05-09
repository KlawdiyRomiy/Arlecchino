import { useEffect } from "react";
import { EventsOn, EventsEmit } from "../wails/runtime";

type IDEEventHandler<T extends Array<unknown>> = (
  ...args: T
) => unknown | Promise<unknown>;

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

  if (first.mcpWrappedPayload === true) {
    if (Object.prototype.hasOwnProperty.call(first, "payload")) {
      return { requestId, args: [first.payload, ...args.slice(1)] };
    }
    return { requestId, args: args.slice(1) };
  }

  const sanitizedPayload = { ...first };
  delete sanitizedPayload.mcpRequestId;
  delete sanitizedPayload.mcpWrappedPayload;
  return { requestId, args: [sanitizedPayload, ...args.slice(1)] };
};

const emitMCPEventAck = (
  requestId: string | undefined,
  event: string,
  handled: boolean,
  error?: unknown,
  result?: unknown,
) => {
  if (!requestId) {
    return;
  }

  const payload: {
    requestId: string;
    event: string;
    handled: boolean;
    error: string;
    result?: unknown;
  } = {
    requestId,
    event,
    handled,
    error: error instanceof Error ? error.message : error ? String(error) : "",
  };
  if (result !== undefined) {
    payload.result = result;
  }

  EventsEmit(MCP_UI_EVENT_ACK, payload);
};

interface UseIDEEventsProps {
  onOpenIntent?: IDEEventHandler<[unknown]>;
  onOpenPanel?: IDEEventHandler<[unknown]>;
  onClosePanel?: IDEEventHandler<[unknown]>;
  onMovePanel?: IDEEventHandler<[unknown]>;
  onToggle?: IDEEventHandler<[string]>;
  onWindowOpen?: IDEEventHandler<[unknown]>;
  onWindowUpdate?: IDEEventHandler<[unknown]>;
  onWindowClose?: IDEEventHandler<[unknown]>;
  onWindowFocus?: IDEEventHandler<[unknown]>;
  onWindowCloseAll?: IDEEventHandler<[]>;
  onWindowCheckpointCreate?: IDEEventHandler<[unknown]>;
  onWindowCheckpointRestore?: IDEEventHandler<[unknown]>;
  onSurfaceRead?: IDEEventHandler<[unknown]>;
  onSurfacePromote?: IDEEventHandler<[unknown]>;
  onAppearancePreviewStart?: IDEEventHandler<[unknown]>;
  onAppearancePreviewPatch?: IDEEventHandler<[unknown]>;
  onAppearancePreviewApply?: IDEEventHandler<[]>;
  onAppearancePreviewCancel?: IDEEventHandler<[]>;
  onTUIEnter?: IDEEventHandler<[]>;
  onTUIExit?: IDEEventHandler<[]>;
  onTUIAssistOpenPanel?: IDEEventHandler<[unknown]>;
  onTUIAssistClose?: IDEEventHandler<[]>;
  onTUIAssistSwap?: IDEEventHandler<[]>;
  onTUIAssistRatio?: IDEEventHandler<[number]>;
  onEditorOpen?: IDEEventHandler<[unknown]>;
  onEditorSplit?: IDEEventHandler<[unknown]>;
  onEditorClose?: IDEEventHandler<[string]>;
  onEditorFormat?: IDEEventHandler<[]>;
  onEditorGoto?: IDEEventHandler<[string]>;
  onEditorToggle?: IDEEventHandler<[string]>;
  onFileNew?: IDEEventHandler<[]>;
  onFileSave?: IDEEventHandler<[]>;
  onFileSaveAll?: IDEEventHandler<[]>;
  onViewZoom?: IDEEventHandler<[string]>;
  onAppSettings?: IDEEventHandler<[]>;
  onAppRun?: IDEEventHandler<[unknown]>;
  onAppKeybindings?: IDEEventHandler<[]>;
  onAppReload?: IDEEventHandler<[]>;
  onGitStatus?: IDEEventHandler<[]>;
  onGitCommit?: IDEEventHandler<[]>;
  onGitPush?: IDEEventHandler<[]>;
  onGitPull?: IDEEventHandler<[]>;
}

export function useIDEEvents(handlers: UseIDEEventsProps) {
  const {
    onOpenIntent,
    onOpenPanel,
    onClosePanel,
    onMovePanel,
    onToggle,
    onWindowOpen,
    onWindowUpdate,
    onWindowClose,
    onWindowFocus,
    onWindowCloseAll,
    onWindowCheckpointCreate,
    onWindowCheckpointRestore,
    onSurfaceRead,
    onSurfacePromote,
    onAppearancePreviewStart,
    onAppearancePreviewPatch,
    onAppearancePreviewApply,
    onAppearancePreviewCancel,
    onTUIEnter,
    onTUIExit,
    onTUIAssistOpenPanel,
    onTUIAssistClose,
    onTUIAssistSwap,
    onTUIAssistRatio,
    onEditorOpen,
    onEditorSplit,
    onEditorClose,
    onEditorFormat,
    onEditorGoto,
    onEditorToggle,
    onFileNew,
    onFileSave,
    onFileSaveAll,
    onViewZoom,
    onAppSettings,
    onAppRun,
    onAppKeybindings,
    onAppReload,
    onGitStatus,
    onGitCommit,
    onGitPush,
    onGitPull,
  } = handlers;

  useEffect(() => {
    let isMounted = true;
    const listeners: Array<() => void> = [];

    const wrapHandler = <T extends Array<unknown>>(
      eventName: string,
      handler: IDEEventHandler<T> | undefined,
    ) => {
      if (!handler) {
        return undefined;
      }

      return (...args: T) => {
        const normalized = normalizeMCPEventArgs(args);
        if (!isMounted) {
          emitMCPEventAck(normalized.requestId, eventName, false, "unmounted");
          return;
        }

        try {
          const maybePromise = handler(...(normalized.args as T));
          if (
            maybePromise &&
            typeof (maybePromise as Promise<unknown>).then === "function"
          ) {
            void (maybePromise as Promise<unknown>)
              .then((result) => {
                emitMCPEventAck(
                  normalized.requestId,
                  eventName,
                  true,
                  undefined,
                  result,
                );
              })
              .catch((error) => {
                emitMCPEventAck(normalized.requestId, eventName, false, error);
              });
            return;
          }

          emitMCPEventAck(
            normalized.requestId,
            eventName,
            true,
            undefined,
            maybePromise,
          );
        } catch (error) {
          emitMCPEventAck(normalized.requestId, eventName, false, error);
        }
      };
    };

    const registerHandler = <T extends Array<unknown>>(
      eventName: string,
      handler: IDEEventHandler<T> | undefined,
    ) => {
      const wrapped = wrapHandler(eventName, handler);
      if (wrapped) {
        listeners.push(EventsOn(eventName, wrapped));
      }
    };

    registerHandler("ide:intent:open", onOpenIntent);
    registerHandler("ide:panel:open", onOpenPanel);
    registerHandler("ide:panel:close", onClosePanel);
    registerHandler("ide:panel:move", onMovePanel);
    registerHandler("ide:toggle", onToggle);
    registerHandler("ide:window:open", onWindowOpen);
    registerHandler("ide:window:update", onWindowUpdate);
    registerHandler("ide:window:close", onWindowClose);
    registerHandler("ide:window:focus", onWindowFocus);
    registerHandler("ide:window:closeAll", onWindowCloseAll);
    registerHandler("ide:window:checkpoint:create", onWindowCheckpointCreate);
    registerHandler("ide:window:checkpoint:restore", onWindowCheckpointRestore);
    registerHandler("ide:surface:read", onSurfaceRead);
    registerHandler("ide:surface:promote", onSurfacePromote);
    registerHandler("ide:appearance:preview:start", onAppearancePreviewStart);
    registerHandler("ide:appearance:preview:patch", onAppearancePreviewPatch);
    registerHandler("ide:appearance:preview:apply", onAppearancePreviewApply);
    registerHandler("ide:appearance:preview:cancel", onAppearancePreviewCancel);
    registerHandler("ide:tui:enter", onTUIEnter);
    registerHandler("ide:tui:exit", onTUIExit);
    registerHandler("ide:tui:assist:open", onTUIAssistOpenPanel);
    registerHandler("ide:tui:assist:close", onTUIAssistClose);
    registerHandler("ide:tui:assist:swap", onTUIAssistSwap);
    registerHandler("ide:tui:assist:ratio", onTUIAssistRatio);
    registerHandler("ide:editor:open", onEditorOpen);
    registerHandler("ide:editor:split", onEditorSplit);
    registerHandler("ide:editor:close", onEditorClose);
    registerHandler("ide:editor:format", onEditorFormat);
    registerHandler("ide:editor:goto", onEditorGoto);
    registerHandler("ide:editor:toggle", onEditorToggle);
    registerHandler("ide:file:new", onFileNew);
    registerHandler("ide:file:save", onFileSave);
    registerHandler("ide:file:saveAll", onFileSaveAll);
    registerHandler("ide:view:zoom", onViewZoom);
    registerHandler("ide:app:settings", onAppSettings);
    registerHandler("ide:app:run", onAppRun);
    registerHandler("ide:app:keybindings", onAppKeybindings);
    registerHandler("ide:app:reload", onAppReload);
    registerHandler("ide:git:status", onGitStatus);
    registerHandler("ide:git:commit", onGitCommit);
    registerHandler("ide:git:push", onGitPush);
    registerHandler("ide:git:pull", onGitPull);

    return () => {
      isMounted = false;
      listeners.forEach((cleanup) => cleanup());
    };
  }, [
    onOpenIntent,
    onOpenPanel,
    onClosePanel,
    onMovePanel,
    onToggle,
    onWindowOpen,
    onWindowUpdate,
    onWindowClose,
    onWindowFocus,
    onWindowCloseAll,
    onWindowCheckpointCreate,
    onWindowCheckpointRestore,
    onSurfaceRead,
    onSurfacePromote,
    onAppearancePreviewStart,
    onAppearancePreviewPatch,
    onAppearancePreviewApply,
    onAppearancePreviewCancel,
    onTUIEnter,
    onTUIExit,
    onTUIAssistOpenPanel,
    onTUIAssistClose,
    onTUIAssistSwap,
    onTUIAssistRatio,
    onEditorOpen,
    onEditorSplit,
    onEditorClose,
    onEditorFormat,
    onEditorGoto,
    onEditorToggle,
    onFileNew,
    onFileSave,
    onFileSaveAll,
    onViewZoom,
    onAppSettings,
    onAppRun,
    onAppKeybindings,
    onAppReload,
    onGitStatus,
    onGitCommit,
    onGitPush,
    onGitPull,
  ]);
}
