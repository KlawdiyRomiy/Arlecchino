import type { ContextActionMenuItem } from "../components/ui/ContextActionMenu";

export const NATIVE_CONTEXT_MENU_ACTION_EVENT = "ide:context-menu:action";

export interface NativeContextMenuItemPayload {
  id: string;
  label?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  hidden?: boolean;
}

export interface NativeContextMenuRequest {
  menuInstanceId: string;
  scope: string;
  surfaceId?: string;
  targetId?: string;
  x: number;
  y: number;
  items: NativeContextMenuItemPayload[];
  context?: Record<string, unknown>;
}

export interface NativeContextMenuResponse {
  opened: boolean;
  menuId?: string;
  menuInstanceId?: string;
  reason?: string;
}

export interface NativeContextMenuActionPayload {
  actionId?: string;
  menuInstanceId?: string;
  scope?: string;
  surfaceId?: string;
  targetId?: string;
  context?: Record<string, unknown>;
}

type ClosestCapableTarget = {
  closest?: (selector: string) => unknown;
};

export const shouldIgnoreContextMenuTarget = (
  target: EventTarget | null,
  ignoredTargetSelector?: string,
): boolean => {
  const selector = ignoredTargetSelector?.trim();
  if (!selector) {
    return false;
  }

  const closest = (target as ClosestCapableTarget | null)?.closest;
  if (typeof closest !== "function") {
    return false;
  }

  return Boolean(closest.call(target, selector));
};

interface NativeContextMenuBridge {
  OpenNativeContextMenu?: (
    request: NativeContextMenuRequest,
  ) => Promise<NativeContextMenuResponse> | NativeContextMenuResponse;
}

interface NativeContextMenuRuntimeModule {
  Call?: {
    ByName?: (
      methodName: string,
      request: NativeContextMenuRequest,
    ) => Promise<NativeContextMenuResponse>;
  };
}

const nativeContextMenuMethodNames = [
  "arlecchino/internal/app.App.OpenNativeContextMenu",
  "main.App.OpenNativeContextMenu",
  "arlecchino.App.OpenNativeContextMenu",
] as const;

let nativeContextMenuMethodName:
  | (typeof nativeContextMenuMethodNames)[number]
  | undefined;

const getNativeContextMenuBridge = (): NativeContextMenuBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeWindow = window as unknown as {
    go?: {
      main?: {
        App?: NativeContextMenuBridge;
      };
    };
  };

  return maybeWindow.go?.main?.App ?? null;
};

const loadRuntimeModule = async (): Promise<
  NativeContextMenuRuntimeModule | undefined
> => {
  try {
    return (await import("/wails/runtime.js")) as NativeContextMenuRuntimeModule;
  } catch {
    return undefined;
  }
};

const normalizeActionId = (
  item: Pick<ContextActionMenuItem, "actionId" | "key" | "label">,
  index: number,
): string => {
  const explicitId = item.actionId ?? item.key;
  if (explicitId?.trim()) {
    return explicitId.trim();
  }

  const labelId = item.label
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return labelId ? `${labelId}-${index}` : `action-${index}`;
};

export const buildNativeContextMenuItems = (
  items: readonly ContextActionMenuItem[],
): NativeContextMenuItemPayload[] =>
  items.map((item, index) => {
    if (item.separator) {
      return {
        id: item.key ?? `separator-${index}`,
        separator: true,
        hidden: item.hidden,
      };
    }

    return {
      id: normalizeActionId(item, index),
      label: item.label,
      disabled: item.disabled,
      danger: item.danger,
      hidden: item.hidden,
    };
  });

export const getContextActionId = (
  item: Pick<ContextActionMenuItem, "actionId" | "key" | "label">,
  index: number,
): string => normalizeActionId(item, index);

export const hasNativeContextMenuBridge = (): boolean =>
  typeof getNativeContextMenuBridge()?.OpenNativeContextMenu === "function";

export const openNativeContextMenu = async (
  request: NativeContextMenuRequest,
  bridge?: NativeContextMenuBridge | null,
): Promise<NativeContextMenuResponse> => {
  const resolvedBridge =
    bridge === undefined ? getNativeContextMenuBridge() : bridge;
  if (typeof resolvedBridge?.OpenNativeContextMenu === "function") {
    return await Promise.resolve(resolvedBridge.OpenNativeContextMenu(request));
  }

  if (bridge === null) {
    return {
      opened: false,
      reason: "native context menu bridge is unavailable",
    };
  }

  const runtimeModule = await loadRuntimeModule();
  const call = runtimeModule?.Call;
  if (!call?.ByName) {
    return {
      opened: false,
      reason: "native context menu runtime call is unavailable",
    };
  }

  if (nativeContextMenuMethodName) {
    try {
      return await call.ByName(nativeContextMenuMethodName, request);
    } catch {
      nativeContextMenuMethodName = undefined;
    }
  }

  for (const methodName of nativeContextMenuMethodNames) {
    try {
      const response = await call.ByName(methodName, request);
      nativeContextMenuMethodName = methodName;
      return response;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return {
    opened: false,
    reason: "native context menu method is unavailable",
  };
};
