import { useEffect, useCallback } from "react";
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime";

interface UseIDEEventsProps {
  onOpenPanel?: (panel: string) => void;
  onToggle?: (element: string) => void;
  onWindowOpen?: (payload: unknown) => void;
  onWindowUpdate?: (payload: unknown) => void;
  onWindowClose?: (payload: unknown) => void;
  onWindowFocus?: (payload: unknown) => void;
  onWindowCloseAll?: () => void;
  onWindowCheckpointCreate?: (payload: unknown) => void;
  onWindowCheckpointRestore?: (payload: unknown) => void;
  onAppearancePreviewStart?: (payload: unknown) => void;
  onAppearancePreviewPatch?: (payload: unknown) => void;
  onAppearancePreviewApply?: () => void;
  onAppearancePreviewCancel?: () => void;
  onTUIEnter?: () => void;
  onTUIExit?: () => void;
  onTUIAssistOpenPanel?: (panel: string) => void;
  onTUIAssistClose?: () => void;
  onTUIAssistSwap?: () => void;
  onTUIAssistRatio?: (ratio: number) => void;
  onEditorSplit?: (direction: string) => void;
  onEditorClose?: (target: string) => void;
  onEditorFormat?: () => void;
  onEditorGoto?: (target: string) => void;
  onEditorToggle?: (feature: string) => void;
  onFileNew?: () => void;
  onFileSave?: () => void;
  onFileSaveAll?: () => void;
  onViewZoom?: (action: string) => void;
  onAppSettings?: () => void;
  onAppKeybindings?: () => void;
  onAppReload?: () => void;
  onGitStatus?: () => void;
  onGitCommit?: () => void;
  onGitPush?: () => void;
  onGitPull?: () => void;
}

export function useIDEEvents(handlers: UseIDEEventsProps) {
  const {
    onOpenPanel,
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
      handler: ((...args: T) => void) | undefined,
    ) => {
      if (!handler) {
        return undefined;
      }

      return (...args: T) => {
        if (!isMounted) {
          return;
        }

        handler(...args);
      };
    };

    const onOpenPanelWrapped = wrapHandler(onOpenPanel);
    if (onOpenPanelWrapped) {
      EventsOn("ide:panel:open", onOpenPanelWrapped);
      listeners.push(() => EventsOff("ide:panel:open"));
    }

    const onToggleWrapped = wrapHandler(onToggle);
    if (onToggleWrapped) {
      EventsOn("ide:toggle", onToggleWrapped);
      listeners.push(() => EventsOff("ide:toggle"));
    }

    const onWindowOpenWrapped = wrapHandler(onWindowOpen);
    if (onWindowOpenWrapped) {
      EventsOn("ide:window:open", onWindowOpenWrapped);
      listeners.push(() => EventsOff("ide:window:open"));
    }

    const onWindowUpdateWrapped = wrapHandler(onWindowUpdate);
    if (onWindowUpdateWrapped) {
      EventsOn("ide:window:update", onWindowUpdateWrapped);
      listeners.push(() => EventsOff("ide:window:update"));
    }

    const onWindowCloseWrapped = wrapHandler(onWindowClose);
    if (onWindowCloseWrapped) {
      EventsOn("ide:window:close", onWindowCloseWrapped);
      listeners.push(() => EventsOff("ide:window:close"));
    }

    const onWindowFocusWrapped = wrapHandler(onWindowFocus);
    if (onWindowFocusWrapped) {
      EventsOn("ide:window:focus", onWindowFocusWrapped);
      listeners.push(() => EventsOff("ide:window:focus"));
    }

    const onWindowCloseAllWrapped = wrapHandler(onWindowCloseAll);
    if (onWindowCloseAllWrapped) {
      EventsOn("ide:window:closeAll", onWindowCloseAllWrapped);
      listeners.push(() => EventsOff("ide:window:closeAll"));
    }

    const onWindowCheckpointCreateWrapped = wrapHandler(
      onWindowCheckpointCreate,
    );
    if (onWindowCheckpointCreateWrapped) {
      EventsOn("ide:window:checkpoint:create", onWindowCheckpointCreateWrapped);
      listeners.push(() => EventsOff("ide:window:checkpoint:create"));
    }

    const onWindowCheckpointRestoreWrapped = wrapHandler(
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
      onAppearancePreviewStart,
    );
    if (onAppearancePreviewStartWrapped) {
      EventsOn("ide:appearance:preview:start", onAppearancePreviewStartWrapped);
      listeners.push(() => EventsOff("ide:appearance:preview:start"));
    }

    const onAppearancePreviewPatchWrapped = wrapHandler(
      onAppearancePreviewPatch,
    );
    if (onAppearancePreviewPatchWrapped) {
      EventsOn("ide:appearance:preview:patch", onAppearancePreviewPatchWrapped);
      listeners.push(() => EventsOff("ide:appearance:preview:patch"));
    }

    const onAppearancePreviewApplyWrapped = wrapHandler(
      onAppearancePreviewApply,
    );
    if (onAppearancePreviewApplyWrapped) {
      EventsOn("ide:appearance:preview:apply", onAppearancePreviewApplyWrapped);
      listeners.push(() => EventsOff("ide:appearance:preview:apply"));
    }

    const onAppearancePreviewCancelWrapped = wrapHandler(
      onAppearancePreviewCancel,
    );
    if (onAppearancePreviewCancelWrapped) {
      EventsOn(
        "ide:appearance:preview:cancel",
        onAppearancePreviewCancelWrapped,
      );
      listeners.push(() => EventsOff("ide:appearance:preview:cancel"));
    }

    const onTUIEnterWrapped = wrapHandler(onTUIEnter);
    if (onTUIEnterWrapped) {
      EventsOn("ide:tui:enter", onTUIEnterWrapped);
      listeners.push(() => EventsOff("ide:tui:enter"));
    }

    const onTUIExitWrapped = wrapHandler(onTUIExit);
    if (onTUIExitWrapped) {
      EventsOn("ide:tui:exit", onTUIExitWrapped);
      listeners.push(() => EventsOff("ide:tui:exit"));
    }

    const onTUIAssistOpenPanelWrapped = wrapHandler(onTUIAssistOpenPanel);
    if (onTUIAssistOpenPanelWrapped) {
      EventsOn("ide:tui:assist:open", onTUIAssistOpenPanelWrapped);
      listeners.push(() => EventsOff("ide:tui:assist:open"));
    }

    const onTUIAssistCloseWrapped = wrapHandler(onTUIAssistClose);
    if (onTUIAssistCloseWrapped) {
      EventsOn("ide:tui:assist:close", onTUIAssistCloseWrapped);
      listeners.push(() => EventsOff("ide:tui:assist:close"));
    }

    const onTUIAssistSwapWrapped = wrapHandler(onTUIAssistSwap);
    if (onTUIAssistSwapWrapped) {
      EventsOn("ide:tui:assist:swap", onTUIAssistSwapWrapped);
      listeners.push(() => EventsOff("ide:tui:assist:swap"));
    }

    const onTUIAssistRatioWrapped = wrapHandler(onTUIAssistRatio);
    if (onTUIAssistRatioWrapped) {
      EventsOn("ide:tui:assist:ratio", onTUIAssistRatioWrapped);
      listeners.push(() => EventsOff("ide:tui:assist:ratio"));
    }

    const onEditorSplitWrapped = wrapHandler(onEditorSplit);
    if (onEditorSplitWrapped) {
      EventsOn("ide:editor:split", onEditorSplitWrapped);
      listeners.push(() => EventsOff("ide:editor:split"));
    }

    const onEditorCloseWrapped = wrapHandler(onEditorClose);
    if (onEditorCloseWrapped) {
      EventsOn("ide:editor:close", onEditorCloseWrapped);
      listeners.push(() => EventsOff("ide:editor:close"));
    }

    const onEditorFormatWrapped = wrapHandler(onEditorFormat);
    if (onEditorFormatWrapped) {
      EventsOn("ide:editor:format", onEditorFormatWrapped);
      listeners.push(() => EventsOff("ide:editor:format"));
    }

    const onEditorGotoWrapped = wrapHandler(onEditorGoto);
    if (onEditorGotoWrapped) {
      EventsOn("ide:editor:goto", onEditorGotoWrapped);
      listeners.push(() => EventsOff("ide:editor:goto"));
    }

    const onEditorToggleWrapped = wrapHandler(onEditorToggle);
    if (onEditorToggleWrapped) {
      EventsOn("ide:editor:toggle", onEditorToggleWrapped);
      listeners.push(() => EventsOff("ide:editor:toggle"));
    }

    const onFileNewWrapped = wrapHandler(onFileNew);
    if (onFileNewWrapped) {
      EventsOn("ide:file:new", onFileNewWrapped);
      listeners.push(() => EventsOff("ide:file:new"));
    }

    const onFileSaveWrapped = wrapHandler(onFileSave);
    if (onFileSaveWrapped) {
      EventsOn("ide:file:save", onFileSaveWrapped);
      listeners.push(() => EventsOff("ide:file:save"));
    }

    const onFileSaveAllWrapped = wrapHandler(onFileSaveAll);
    if (onFileSaveAllWrapped) {
      EventsOn("ide:file:saveAll", onFileSaveAllWrapped);
      listeners.push(() => EventsOff("ide:file:saveAll"));
    }

    const onViewZoomWrapped = wrapHandler(onViewZoom);
    if (onViewZoomWrapped) {
      EventsOn("ide:view:zoom", onViewZoomWrapped);
      listeners.push(() => EventsOff("ide:view:zoom"));
    }

    const onAppSettingsWrapped = wrapHandler(onAppSettings);
    if (onAppSettingsWrapped) {
      EventsOn("ide:app:settings", onAppSettingsWrapped);
      listeners.push(() => EventsOff("ide:app:settings"));
    }

    const onAppKeybindingsWrapped = wrapHandler(onAppKeybindings);
    if (onAppKeybindingsWrapped) {
      EventsOn("ide:app:keybindings", onAppKeybindingsWrapped);
      listeners.push(() => EventsOff("ide:app:keybindings"));
    }

    const onAppReloadWrapped = wrapHandler(onAppReload);
    if (onAppReloadWrapped) {
      EventsOn("ide:app:reload", onAppReloadWrapped);
      listeners.push(() => EventsOff("ide:app:reload"));
    }

    const onGitStatusWrapped = wrapHandler(onGitStatus);
    if (onGitStatusWrapped) {
      EventsOn("ide:git:status", onGitStatusWrapped);
      listeners.push(() => EventsOff("ide:git:status"));
    }

    const onGitCommitWrapped = wrapHandler(onGitCommit);
    if (onGitCommitWrapped) {
      EventsOn("ide:git:commit", onGitCommitWrapped);
      listeners.push(() => EventsOff("ide:git:commit"));
    }

    const onGitPushWrapped = wrapHandler(onGitPush);
    if (onGitPushWrapped) {
      EventsOn("ide:git:push", onGitPushWrapped);
      listeners.push(() => EventsOff("ide:git:push"));
    }

    const onGitPullWrapped = wrapHandler(onGitPull);
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
    onAppKeybindings,
    onAppReload,
    onGitStatus,
    onGitCommit,
    onGitPush,
    onGitPull,
  ]);
}
