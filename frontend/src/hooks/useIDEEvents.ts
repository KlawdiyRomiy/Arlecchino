import { useEffect } from "react";
import { EventsOn, EventsOff, EventsEmit } from "../wails/runtime";

type IDEEventHandler<T extends Array<unknown>> = (
  ...args: T
) => void | Promise<void>;

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
) => {
  if (!requestId) {
    return;
  }

  EventsEmit(MCP_UI_EVENT_ACK, {
    requestId,
    event,
    handled,
    error: error instanceof Error ? error.message : error ? String(error) : "",
  });
};

interface UseIDEEventsProps {
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
            typeof (maybePromise as Promise<void>).then === "function"
          ) {
            void (maybePromise as Promise<void>)
              .then(() => {
                emitMCPEventAck(normalized.requestId, eventName, true);
              })
              .catch((error) => {
                emitMCPEventAck(normalized.requestId, eventName, false, error);
              });
            return;
          }

          emitMCPEventAck(normalized.requestId, eventName, true);
        } catch (error) {
          emitMCPEventAck(normalized.requestId, eventName, false, error);
        }
      };
    };

    const onOpenPanelWrapped = wrapHandler("ide:panel:open", onOpenPanel);
    if (onOpenPanelWrapped) {
      EventsOn("ide:panel:open", onOpenPanelWrapped);
      listeners.push(() => EventsOff("ide:panel:open"));
    }

    const onClosePanelWrapped = wrapHandler("ide:panel:close", onClosePanel);
    if (onClosePanelWrapped) {
      EventsOn("ide:panel:close", onClosePanelWrapped);
      listeners.push(() => EventsOff("ide:panel:close"));
    }

    const onMovePanelWrapped = wrapHandler("ide:panel:move", onMovePanel);
    if (onMovePanelWrapped) {
      EventsOn("ide:panel:move", onMovePanelWrapped);
      listeners.push(() => EventsOff("ide:panel:move"));
    }

    const onToggleWrapped = wrapHandler("ide:toggle", onToggle);
    if (onToggleWrapped) {
      EventsOn("ide:toggle", onToggleWrapped);
      listeners.push(() => EventsOff("ide:toggle"));
    }

    const onWindowOpenWrapped = wrapHandler("ide:window:open", onWindowOpen);
    if (onWindowOpenWrapped) {
      EventsOn("ide:window:open", onWindowOpenWrapped);
      listeners.push(() => EventsOff("ide:window:open"));
    }

    const onWindowUpdateWrapped = wrapHandler(
      "ide:window:update",
      onWindowUpdate,
    );
    if (onWindowUpdateWrapped) {
      EventsOn("ide:window:update", onWindowUpdateWrapped);
      listeners.push(() => EventsOff("ide:window:update"));
    }

    const onWindowCloseWrapped = wrapHandler("ide:window:close", onWindowClose);
    if (onWindowCloseWrapped) {
      EventsOn("ide:window:close", onWindowCloseWrapped);
      listeners.push(() => EventsOff("ide:window:close"));
    }

    const onWindowFocusWrapped = wrapHandler("ide:window:focus", onWindowFocus);
    if (onWindowFocusWrapped) {
      EventsOn("ide:window:focus", onWindowFocusWrapped);
      listeners.push(() => EventsOff("ide:window:focus"));
    }

    const onWindowCloseAllWrapped = wrapHandler(
      "ide:window:closeAll",
      onWindowCloseAll,
    );
    if (onWindowCloseAllWrapped) {
      EventsOn("ide:window:closeAll", onWindowCloseAllWrapped);
      listeners.push(() => EventsOff("ide:window:closeAll"));
    }

    const onWindowCheckpointCreateWrapped = wrapHandler(
      "ide:window:checkpoint:create",
      onWindowCheckpointCreate,
    );
    if (onWindowCheckpointCreateWrapped) {
      EventsOn("ide:window:checkpoint:create", onWindowCheckpointCreateWrapped);
      listeners.push(() => EventsOff("ide:window:checkpoint:create"));
    }

    const onWindowCheckpointRestoreWrapped = wrapHandler(
      "ide:window:checkpoint:restore",
      onWindowCheckpointRestore,
    );
    if (onWindowCheckpointRestoreWrapped) {
      EventsOn(
        "ide:window:checkpoint:restore",
        onWindowCheckpointRestoreWrapped,
      );
      listeners.push(() => EventsOff("ide:window:checkpoint:restore"));
    }

    const onAppearancePreviewStartWrapped = wrapHandler(
      "ide:appearance:preview:start",
      onAppearancePreviewStart,
    );
    if (onAppearancePreviewStartWrapped) {
      EventsOn("ide:appearance:preview:start", onAppearancePreviewStartWrapped);
      listeners.push(() => EventsOff("ide:appearance:preview:start"));
    }

    const onAppearancePreviewPatchWrapped = wrapHandler(
      "ide:appearance:preview:patch",
      onAppearancePreviewPatch,
    );
    if (onAppearancePreviewPatchWrapped) {
      EventsOn("ide:appearance:preview:patch", onAppearancePreviewPatchWrapped);
      listeners.push(() => EventsOff("ide:appearance:preview:patch"));
    }

    const onAppearancePreviewApplyWrapped = wrapHandler(
      "ide:appearance:preview:apply",
      onAppearancePreviewApply,
    );
    if (onAppearancePreviewApplyWrapped) {
      EventsOn("ide:appearance:preview:apply", onAppearancePreviewApplyWrapped);
      listeners.push(() => EventsOff("ide:appearance:preview:apply"));
    }

    const onAppearancePreviewCancelWrapped = wrapHandler(
      "ide:appearance:preview:cancel",
      onAppearancePreviewCancel,
    );
    if (onAppearancePreviewCancelWrapped) {
      EventsOn(
        "ide:appearance:preview:cancel",
        onAppearancePreviewCancelWrapped,
      );
      listeners.push(() => EventsOff("ide:appearance:preview:cancel"));
    }

    const onTUIEnterWrapped = wrapHandler("ide:tui:enter", onTUIEnter);
    if (onTUIEnterWrapped) {
      EventsOn("ide:tui:enter", onTUIEnterWrapped);
      listeners.push(() => EventsOff("ide:tui:enter"));
    }

    const onTUIExitWrapped = wrapHandler("ide:tui:exit", onTUIExit);
    if (onTUIExitWrapped) {
      EventsOn("ide:tui:exit", onTUIExitWrapped);
      listeners.push(() => EventsOff("ide:tui:exit"));
    }

    const onTUIAssistOpenPanelWrapped = wrapHandler(
      "ide:tui:assist:open",
      onTUIAssistOpenPanel,
    );
    if (onTUIAssistOpenPanelWrapped) {
      EventsOn("ide:tui:assist:open", onTUIAssistOpenPanelWrapped);
      listeners.push(() => EventsOff("ide:tui:assist:open"));
    }

    const onTUIAssistCloseWrapped = wrapHandler(
      "ide:tui:assist:close",
      onTUIAssistClose,
    );
    if (onTUIAssistCloseWrapped) {
      EventsOn("ide:tui:assist:close", onTUIAssistCloseWrapped);
      listeners.push(() => EventsOff("ide:tui:assist:close"));
    }

    const onTUIAssistSwapWrapped = wrapHandler(
      "ide:tui:assist:swap",
      onTUIAssistSwap,
    );
    if (onTUIAssistSwapWrapped) {
      EventsOn("ide:tui:assist:swap", onTUIAssistSwapWrapped);
      listeners.push(() => EventsOff("ide:tui:assist:swap"));
    }

    const onTUIAssistRatioWrapped = wrapHandler(
      "ide:tui:assist:ratio",
      onTUIAssistRatio,
    );
    if (onTUIAssistRatioWrapped) {
      EventsOn("ide:tui:assist:ratio", onTUIAssistRatioWrapped);
      listeners.push(() => EventsOff("ide:tui:assist:ratio"));
    }

    const onEditorOpenWrapped = wrapHandler("ide:editor:open", onEditorOpen);
    if (onEditorOpenWrapped) {
      EventsOn("ide:editor:open", onEditorOpenWrapped);
      listeners.push(() => EventsOff("ide:editor:open"));
    }

    const onEditorSplitWrapped = wrapHandler("ide:editor:split", onEditorSplit);
    if (onEditorSplitWrapped) {
      EventsOn("ide:editor:split", onEditorSplitWrapped);
      listeners.push(() => EventsOff("ide:editor:split"));
    }

    const onEditorCloseWrapped = wrapHandler("ide:editor:close", onEditorClose);
    if (onEditorCloseWrapped) {
      EventsOn("ide:editor:close", onEditorCloseWrapped);
      listeners.push(() => EventsOff("ide:editor:close"));
    }

    const onEditorFormatWrapped = wrapHandler(
      "ide:editor:format",
      onEditorFormat,
    );
    if (onEditorFormatWrapped) {
      EventsOn("ide:editor:format", onEditorFormatWrapped);
      listeners.push(() => EventsOff("ide:editor:format"));
    }

    const onEditorGotoWrapped = wrapHandler("ide:editor:goto", onEditorGoto);
    if (onEditorGotoWrapped) {
      EventsOn("ide:editor:goto", onEditorGotoWrapped);
      listeners.push(() => EventsOff("ide:editor:goto"));
    }

    const onEditorToggleWrapped = wrapHandler(
      "ide:editor:toggle",
      onEditorToggle,
    );
    if (onEditorToggleWrapped) {
      EventsOn("ide:editor:toggle", onEditorToggleWrapped);
      listeners.push(() => EventsOff("ide:editor:toggle"));
    }

    const onFileNewWrapped = wrapHandler("ide:file:new", onFileNew);
    if (onFileNewWrapped) {
      EventsOn("ide:file:new", onFileNewWrapped);
      listeners.push(() => EventsOff("ide:file:new"));
    }

    const onFileSaveWrapped = wrapHandler("ide:file:save", onFileSave);
    if (onFileSaveWrapped) {
      EventsOn("ide:file:save", onFileSaveWrapped);
      listeners.push(() => EventsOff("ide:file:save"));
    }

    const onFileSaveAllWrapped = wrapHandler("ide:file:saveAll", onFileSaveAll);
    if (onFileSaveAllWrapped) {
      EventsOn("ide:file:saveAll", onFileSaveAllWrapped);
      listeners.push(() => EventsOff("ide:file:saveAll"));
    }

    const onViewZoomWrapped = wrapHandler("ide:view:zoom", onViewZoom);
    if (onViewZoomWrapped) {
      EventsOn("ide:view:zoom", onViewZoomWrapped);
      listeners.push(() => EventsOff("ide:view:zoom"));
    }

    const onAppSettingsWrapped = wrapHandler("ide:app:settings", onAppSettings);
    if (onAppSettingsWrapped) {
      EventsOn("ide:app:settings", onAppSettingsWrapped);
      listeners.push(() => EventsOff("ide:app:settings"));
    }

    const onAppRunWrapped = wrapHandler("ide:app:run", onAppRun);
    if (onAppRunWrapped) {
      EventsOn("ide:app:run", onAppRunWrapped);
      listeners.push(() => EventsOff("ide:app:run"));
    }

    const onAppKeybindingsWrapped = wrapHandler(
      "ide:app:keybindings",
      onAppKeybindings,
    );
    if (onAppKeybindingsWrapped) {
      EventsOn("ide:app:keybindings", onAppKeybindingsWrapped);
      listeners.push(() => EventsOff("ide:app:keybindings"));
    }

    const onAppReloadWrapped = wrapHandler("ide:app:reload", onAppReload);
    if (onAppReloadWrapped) {
      EventsOn("ide:app:reload", onAppReloadWrapped);
      listeners.push(() => EventsOff("ide:app:reload"));
    }

    const onGitStatusWrapped = wrapHandler("ide:git:status", onGitStatus);
    if (onGitStatusWrapped) {
      EventsOn("ide:git:status", onGitStatusWrapped);
      listeners.push(() => EventsOff("ide:git:status"));
    }

    const onGitCommitWrapped = wrapHandler("ide:git:commit", onGitCommit);
    if (onGitCommitWrapped) {
      EventsOn("ide:git:commit", onGitCommitWrapped);
      listeners.push(() => EventsOff("ide:git:commit"));
    }

    const onGitPushWrapped = wrapHandler("ide:git:push", onGitPush);
    if (onGitPushWrapped) {
      EventsOn("ide:git:push", onGitPushWrapped);
      listeners.push(() => EventsOff("ide:git:push"));
    }

    const onGitPullWrapped = wrapHandler("ide:git:pull", onGitPull);
    if (onGitPullWrapped) {
      EventsOn("ide:git:pull", onGitPullWrapped);
      listeners.push(() => EventsOff("ide:git:pull"));
    }

    return () => {
      isMounted = false;
      listeners.forEach((cleanup) => cleanup());
    };
  }, [
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
