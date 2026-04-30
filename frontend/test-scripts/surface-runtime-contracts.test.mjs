import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");

async function loadRuntimeContracts() {
  const result = await build({
    stdin: {
      contents: `
        export {
          buildSurfaceSessions,
          panelSurfaceId,
          previewSurfaceId,
        } from "./src/surfaces/surfaceRuntime.ts";
        export {
          createSurfaceRuntimeEvent,
          dedupeSurfaceRuntimeEvents,
          parseSurfaceRuntimeEvent,
          surfaceRuntimeEventDedupeKey,
        } from "./src/surfaces/surfaceRuntimeEvents.ts";
        export {
          buildSurfacePromotionResult,
          buildSurfacePromotionCommands,
          buildSurfacePromotionReadModel,
          parseSurfacePromotionRequest,
        } from "./src/surfaces/surfacePromotion.ts";
        export {
          buildSurfaceWindowLeaseReadModel,
          cleanupSurfaceWindowLeases,
          getSurfaceWindowLeaseRole,
          isSurfaceWindowLeaseSupported,
        } from "./src/surfaces/windowLease.ts";
        export {
          parseOpenPreviewInput,
          parsePanelOpenRequest,
          parseUpdatePreviewInput,
          parseWindowIdFromPayload,
        } from "./src/components/layout/mainLayoutEventParsers.ts";
        export {
          clearSurfaceRuntimeEventHistory,
          getSurfaceRuntimeEventHistory,
          getSurfaceRuntimeFocusState,
          getSurfaceRuntimeReadModel,
          getSurfaceRuntimeSnapshot,
          recordSurfaceRuntimeEvent,
          subscribeSurfaceRuntime,
          subscribeSurfaceRuntimeEvents,
          syncSurfaceRuntimeFromHost,
          syncSurfaceRuntimeWindowLeaseBackendStatus,
        } from "./src/surfaces/surfaceRuntimeStore.ts";
        export {
          buildNativeContextMenuItems,
          getContextActionId,
          openNativeContextMenu,
        } from "./src/shell/nativeContextMenu.ts";
        export {
          clearPendingOpenIntents,
          flushPendingOpenIntents,
          getPendingOpenIntents,
          OPEN_INTENT_EVENT,
          parseOpenIntentPayload,
          registerOpenIntentDispatcher,
          routeOpenIntent,
        } from "./src/shell/openIntentRouter.ts";
        export {
          openExternalUrlWithCapability,
        } from "./src/shell/browser.ts";
        export {
          selectDirectoryWithCapability,
        } from "./src/shell/shellDialogs.ts";
        export {
          readClipboardTextWithFallback,
          writeClipboardTextWithFallback,
        } from "./src/utils/clipboard.ts";
        export {
          BACKGROUND_SHELL_STATUS_EVENT,
          getBackgroundShellStatusSnapshot,
          getFallbackBackgroundShellStatus,
          loadBackgroundShellStatusFromBackend,
          normalizeBackgroundShellStatusPayload,
          runBackgroundShellAction,
          subscribeBackgroundShellStatus,
          syncBackgroundShellStatusFromPayload,
        } from "./src/shell/backgroundShellStatus.ts";
        export {
          getFallbackPackagedOSIntegration,
          getPackagedOSIntegrationSnapshot,
          loadPackagedOSIntegrationFromBackend,
          normalizePackagedOSIntegrationPayload,
          runPackagedOSIntegrationAction,
          subscribePackagedOSIntegration,
          syncPackagedOSIntegrationFromPayload,
        } from "./src/shell/packagedOSIntegration.ts";
        export {
          canUseShellCapability,
          getFallbackShellCapabilities,
          getShellCapabilitiesSnapshot,
          loadShellCapabilitiesFromBackend,
          normalizeShellCapabilitiesPayload,
          subscribeShellCapabilities,
          syncShellCapabilities,
          syncShellCapabilitiesFromPayload,
        } from "./src/shell/shellCapabilities.ts";
      `,
      loader: "ts",
      resolveDir: frontendRoot,
      sourcefile: "surface-runtime-contract-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });

  const code = result.outputFiles[0]?.text;
  assert.ok(code, "expected bundled surface runtime contract module");

  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${Date.now()}-${Math.random()}`
  );
}

test("surface runtime builds stable sessions from current panel and preview state", async () => {
  const { buildSurfaceSessions } = await loadRuntimeContracts();

  const sessions = buildSurfaceSessions({
    panels: {
      explorer: true,
      terminal: false,
      aiChat: false,
      git: false,
      problems: true,
      code: false,
    },
    panelConfigs: {
      explorer: {
        position: "left",
        mode: "snapped",
        size: { width: 280, height: 600 },
        x: 12,
        y: 24,
      },
      terminal: {
        position: "bottom",
        mode: "snapped",
        size: { width: 800, height: 260 },
        x: 0,
        y: 0,
      },
      aiChat: {
        position: "right",
        mode: "floating",
        size: { width: 420, height: 640 },
        x: 60,
        y: 80,
      },
      git: {
        position: "right",
        mode: "floating",
        size: { width: 420, height: 640 },
        x: 60,
        y: 80,
      },
      problems: {
        position: "bottom",
        mode: "floating",
        size: { width: 700, height: 320 },
        x: 80,
        y: 100,
      },
      code: {
        position: "right",
        mode: "snapped",
        size: { width: 520, height: 700 },
        x: 0,
        y: 0,
      },
    },
    previewWindows: [
      {
        id: "preview-browser-default",
        title: "Preview localhost:5173",
        surface: "browser",
        payload: { url: "http://localhost:5173" },
        position: "right",
        mode: "snapped",
        width: 520,
        height: 620,
        x: 900,
        y: 70,
        isPinned: true,
        zIndex: 132,
        createdAt: 1710000000000,
        updatedAt: 1710000001000,
      },
    ],
    activePreviewWindowId: "preview-browser-default",
    activePanelId: "problems",
  });

  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions[0], {
    id: "panel:explorer",
    source: "panel",
    appletKind: "explorer",
    hostMode: "snapped",
    title: "Explorer",
    active: false,
    pinned: false,
    panelId: "explorer",
    geometry: {
      position: "left",
      width: 280,
      height: 600,
      x: 12,
      y: 24,
    },
  });
  assert.deepEqual(sessions[1], {
    id: "panel:problems",
    source: "panel",
    appletKind: "problems",
    hostMode: "floating",
    title: "Problems",
    active: true,
    pinned: false,
    panelId: "problems",
    geometry: {
      position: "bottom",
      width: 700,
      height: 320,
      x: 80,
      y: 100,
    },
  });
  assert.deepEqual(sessions[2], {
    id: "preview:preview-browser-default",
    source: "preview",
    appletKind: "browser",
    hostMode: "snapped",
    title: "Preview localhost:5173",
    active: true,
    pinned: true,
    createdAt: 1710000000000,
    updatedAt: 1710000001000,
    previewWindowId: "preview-browser-default",
    payload: { url: "http://localhost:5173" },
    geometry: {
      position: "right",
      width: 520,
      height: 620,
      x: 900,
      y: 70,
      zIndex: 132,
    },
  });
});

test("surface runtime keeps stable ids for panel and preview hosts", async () => {
  const { panelSurfaceId, previewSurfaceId } = await loadRuntimeContracts();

  assert.equal(panelSurfaceId("explorer"), "panel:explorer");
  assert.equal(
    previewSurfaceId("terminal-preview:term-1"),
    "preview:terminal-preview:term-1",
  );
});

test("surface promotion contracts parse canonical requests and reject unsupported targets", async () => {
  const {
    buildSurfacePromotionResult,
    buildSurfaceSessions,
    parseSurfacePromotionRequest,
  } = await loadRuntimeContracts();

  assert.deepEqual(
    parseSurfacePromotionRequest({
      surfaceId: "panel:explorer",
      kind: "promote-floating",
      position: "left",
    }),
    {
      surfaceId: "panel:explorer",
      kind: "promote-floating",
      source: "panel",
      panelId: "explorer",
      position: "left",
    },
  );
  assert.deepEqual(
    parseSurfacePromotionRequest({
      surfaceID: "preview:preview-browser-default",
      action: "fullscreen",
    }),
    {
      surfaceId: "preview:preview-browser-default",
      kind: "fullscreen",
      source: "preview",
      previewWindowId: "preview-browser-default",
      position: undefined,
    },
  );
  assert.equal(
    parseSurfacePromotionRequest({
      surfaceId: "detached:missing",
      kind: "snap",
    }),
    null,
  );
  assert.deepEqual(
    buildSurfacePromotionResult(
      parseSurfacePromotionRequest({
        surfaceId: "panel:git",
        kind: "detach",
      }),
      {
        handled: false,
        reason: "Detached Wails windows are gated until Window Lease System.",
      },
    ),
    {
      surfaceId: "panel:git",
      kind: "detach",
      handled: false,
      reason: "Detached Wails windows are gated until Window Lease System.",
    },
  );

  const fullscreenSessions = buildSurfaceSessions({
    panels: {
      explorer: true,
      terminal: false,
      aiChat: false,
      git: false,
      problems: false,
      code: false,
    },
    panelConfigs: {
      explorer: {
        position: "left",
        mode: "floating",
        size: { width: 1440, height: 900 },
        x: 0,
        y: 0,
      },
      terminal: {
        position: "bottom",
        mode: "snapped",
        size: { width: 800, height: 260 },
        x: 0,
        y: 0,
      },
      aiChat: {
        position: "right",
        mode: "floating",
        size: { width: 420, height: 640 },
        x: 60,
        y: 80,
      },
      git: {
        position: "right",
        mode: "floating",
        size: { width: 420, height: 640 },
        x: 60,
        y: 80,
      },
      problems: {
        position: "bottom",
        mode: "floating",
        size: { width: 700, height: 320 },
        x: 80,
        y: 100,
      },
      code: {
        position: "right",
        mode: "snapped",
        size: { width: 520, height: 700 },
        x: 0,
        y: 0,
      },
    },
    previewWindows: [],
    activePreviewWindowId: null,
    activePanelId: "explorer",
    fullscreenSurfaceIds: ["panel:explorer"],
  });
  assert.equal(fullscreenSessions[0].hostMode, "fullscreen");
});

test("window lease read model gates detach to supported applets and cleans stale leases", async () => {
  const {
    buildSurfacePromotionReadModel,
    buildSurfaceWindowLeaseReadModel,
    cleanupSurfaceWindowLeases,
    getSurfaceWindowLeaseRole,
    isSurfaceWindowLeaseSupported,
  } = await loadRuntimeContracts();

  const explorerSession = {
    id: "panel:explorer",
    source: "panel",
    appletKind: "explorer",
    hostMode: "snapped",
    title: "Explorer",
    active: false,
    pinned: false,
    panelId: "explorer",
  };
  const gitSession = {
    id: "panel:git",
    source: "panel",
    appletKind: "git",
    hostMode: "snapped",
    title: "Git",
    active: false,
    pinned: false,
    panelId: "git",
  };
  const terminalSession = {
    id: "panel:terminal",
    source: "panel",
    appletKind: "terminal",
    hostMode: "floating",
    title: "Terminal",
    active: true,
    pinned: false,
    panelId: "terminal",
  };
  const previewSession = {
    id: "preview:preview-browser-default",
    source: "preview",
    appletKind: "browser",
    hostMode: "snapped",
    title: "Preview localhost:5173",
    active: false,
    pinned: true,
    previewWindowId: "preview-browser-default",
    payload: { url: "http://localhost:5173" },
  };
  const sessions = [
    explorerSession,
    gitSession,
    terminalSession,
    previewSession,
  ];

  assert.equal(isSurfaceWindowLeaseSupported(explorerSession), false);
  assert.equal(getSurfaceWindowLeaseRole(gitSession), "git-helper");
  assert.equal(isSurfaceWindowLeaseSupported(gitSession), false);
  assert.equal(getSurfaceWindowLeaseRole(terminalSession), "terminal-helper");
  assert.equal(isSurfaceWindowLeaseSupported(terminalSession), false);
  assert.equal(getSurfaceWindowLeaseRole(previewSession), "preview");
  assert.equal(isSurfaceWindowLeaseSupported(previewSession), true);

  const gatedReadModel = buildSurfaceWindowLeaseReadModel(sessions, {
    detachedAvailable: false,
    now: 1710000000000,
  });
  assert.deepEqual(gatedReadModel.supportedSurfaceIds, [
    "preview:preview-browser-default",
  ]);
  assert.deepEqual(gatedReadModel.unsupportedSurfaceIds, [
    "panel:explorer",
    "panel:git",
    "panel:terminal",
  ]);
  assert.equal(
    gatedReadModel.leasesBySurfaceId["panel:git"],
    undefined,
  );
  assert.equal(
    gatedReadModel.commandsBySurfaceId["panel:git"].find(
      (command) => command.kind === "detach",
    ).enabled,
    false,
  );
  assert.match(
    gatedReadModel.commandsBySurfaceId["panel:git"].find(
      (command) => command.kind === "detach",
    ).reason,
    /Browser Preview only/,
  );

  const enabledReadModel = buildSurfaceWindowLeaseReadModel(sessions, {
    detachedAvailable: true,
    now: 1710000001000,
  });
  const promotionReadModel = buildSurfacePromotionReadModel(
    sessions,
    {},
    {
      detachedAvailable: enabledReadModel.detachedAvailable,
      leaseSupportedSurfaceIds: enabledReadModel.supportedSurfaceIds,
      detachReasonsBySurfaceId: Object.fromEntries(
        Object.entries(enabledReadModel.commandsBySurfaceId).map(
          ([surfaceId, commands]) => [
            surfaceId,
            commands.find((command) => command.kind === "detach")?.reason,
          ],
        ),
      ),
    },
  );
  assert.equal(
    promotionReadModel.commandsBySurfaceId["panel:git"].find(
      (command) => command.kind === "detach",
    ).enabled,
    false,
  );
  assert.match(
    promotionReadModel.commandsBySurfaceId["panel:git"].find(
      (command) => command.kind === "detach",
    ).reason,
    /Browser Preview only/,
  );
  assert.equal(
    promotionReadModel.commandsBySurfaceId[
      "preview:preview-browser-default"
    ].find((command) => command.kind === "detach").enabled,
    true,
  );
  assert.equal(
    promotionReadModel.commandsBySurfaceId["panel:explorer"].find(
      (command) => command.kind === "detach",
    ).enabled,
    false,
  );

  const detachedPreview = {
    ...previewSession,
    hostMode: "detached",
    nativeWindowId: "window:preview-browser-default",
  };
  const detachedReadModel = buildSurfaceWindowLeaseReadModel(
    [detachedPreview],
    {
      detachedAvailable: true,
      now: 1710000002000,
    },
  );
  assert.deepEqual(
    detachedReadModel.commandsBySurfaceId[
      "preview:preview-browser-default"
    ].map((command) => command.kind),
    ["focus-window", "return-to-main", "close-window"],
  );
  assert.equal(
    detachedReadModel.leasesBySurfaceId["preview:preview-browser-default"]
      .policy.return,
    "restore-main-host",
  );

  const { activeLeases, staleLeases } = cleanupSurfaceWindowLeases(
    detachedReadModel.leasesBySurfaceId,
    [gitSession],
    1710000003000,
  );
  assert.equal(activeLeases["preview:preview-browser-default"], undefined);
  assert.equal(staleLeases.length, 1);
  assert.equal(staleLeases[0].status, "stale");
  assert.equal(staleLeases[0].policy.stale, "cleanup-return-target");
});

test("surface runtime read model exposes detached backend leases without active host sessions", async () => {
  const {
    getSurfaceRuntimeReadModel,
    syncSurfaceRuntimeFromHost,
    syncSurfaceRuntimeWindowLeaseBackendStatus,
  } = await loadRuntimeContracts();

  try {
    syncSurfaceRuntimeFromHost([
      {
        id: "panel:lease-contract-anchor",
        source: "panel",
        appletKind: "explorer",
        hostMode: "snapped",
        title: "Explorer",
        active: false,
        pinned: false,
        panelId: "explorer",
      },
    ]);
    syncSurfaceRuntimeWindowLeaseBackendStatus({
      detachedAvailable: true,
      leases: [
        {
          id: "lease:preview:detached-contract",
          surfaceId: "preview:detached-contract",
          role: "preview",
          appletKind: "browser",
          nativeWindowId: "detached:preview:detached-contract",
          status: "detached",
          updatedAt: 1710000004000,
        },
      ],
    });

    const readModel = getSurfaceRuntimeReadModel({ includeEvents: false });
    assert.ok(readModel.sessionIds.includes("preview:detached-contract"));
    assert.ok(
      readModel.sessionsByHostMode.detached.includes(
        "preview:detached-contract",
      ),
    );
    assert.equal(
      readModel.windowLeases.leasesBySurfaceId["preview:detached-contract"]
        .nativeWindowId,
      "detached:preview:detached-contract",
    );
    assert.deepEqual(
      readModel.windowLeases.commandsBySurfaceId[
        "preview:detached-contract"
      ].map((command) => command.kind),
      ["focus-window", "return-to-main", "close-window"],
    );
  } finally {
    syncSurfaceRuntimeWindowLeaseBackendStatus({
      detachedAvailable: false,
      leases: [],
    });
  }
});

test("layout event parsers keep MCP preview and panel payload contracts canonical", async () => {
  const {
    parseOpenPreviewInput,
    parsePanelOpenRequest,
    parseUpdatePreviewInput,
    parseWindowIdFromPayload,
  } = await loadRuntimeContracts();

  const previewOpen = parseOpenPreviewInput({
    id: "preview-test",
    surface: "browser",
    mode: "side",
    side: "right",
    payload: {
      url: "http://localhost:3000",
      surface: "browser",
      mode: "floating",
    },
  });
  const panelOpen = parsePanelOpenRequest({
    panel: "code",
    path: "/workspace/src/main.ts",
    line: 12,
    position: "right",
    mode: "snapped",
    mcpRequestId: "request-1",
  });
  const previewUpdate = parseUpdatePreviewInput({
    id: "preview-test",
    payload: { url: "http://localhost:4000" },
    focus: true,
  });
  const focusId = parseWindowIdFromPayload([[{ id: "preview-test" }]]);

  assert.deepEqual(previewOpen, {
    id: "preview-test",
    surface: "browser",
    title: undefined,
    payload: { url: "http://localhost:3000" },
    mode: "snapped",
    position: "right",
    side: "right",
    width: undefined,
    height: undefined,
    x: undefined,
    y: undefined,
    pinned: undefined,
  });
  assert.deepEqual(panelOpen, {
    panel: "code",
    position: "right",
    mode: "snapped",
    width: undefined,
    height: undefined,
    x: undefined,
    y: undefined,
    ratio: undefined,
    anchor: "right",
    path: "/workspace/src/main.ts",
    title: undefined,
    name: undefined,
    language: undefined,
    content: undefined,
    line: 12,
    command: undefined,
    terminalName: undefined,
    focus: false,
  });
  assert.deepEqual(previewUpdate, {
    id: "preview-test",
    input: {
      title: undefined,
      payload: { url: "http://localhost:4000" },
      mode: undefined,
      position: undefined,
      width: undefined,
      height: undefined,
      x: undefined,
      y: undefined,
      pinned: undefined,
    },
    focusRequested: true,
  });
  assert.equal(focusId, "preview-test");
});

test("open intent router normalizes typed project file preview and focus intents", async () => {
  const { OPEN_INTENT_EVENT, parseOpenIntentPayload } =
    await loadRuntimeContracts();

  assert.equal(OPEN_INTENT_EVENT, "ide:intent:open");
  assert.deepEqual(
    parseOpenIntentPayload({
      action: "project.open",
      projectPath: "/workspace/project",
      source: "single-instance",
    }),
    {
      kind: "openProject",
      projectPath: "/workspace/project",
      source: "single-instance",
      id: undefined,
    },
  );
  assert.deepEqual(
    parseOpenIntentPayload({
      kind: "open_file",
      filePath: "/workspace/src/main.ts",
      line: 7,
    }),
    {
      kind: "openFile",
      path: "/workspace/src/main.ts",
      line: 7,
      id: undefined,
      source: undefined,
    },
  );
  assert.deepEqual(
    parseOpenIntentPayload({
      type: "preview.open",
      id: "preview-doc",
      surface: "browser",
      url: "http://localhost:5173",
      mode: "side",
      side: "right",
      payload: { title: "ignored payload title" },
    }),
    {
      kind: "openPreview",
      id: "preview-doc",
      source: undefined,
      preview: {
        id: "preview-doc",
        surface: "browser",
        title: undefined,
        payload: {
          title: "ignored payload title",
          url: "http://localhost:5173",
        },
        mode: "snapped",
        position: "right",
        side: "right",
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
        pinned: undefined,
      },
    },
  );
  assert.deepEqual(
    parseOpenIntentPayload({
      intent: "surface.focus",
      surfaceId: "preview:preview-doc",
    }),
    {
      kind: "focusSurface",
      surfaceId: "preview:preview-doc",
      previewWindowId: undefined,
      panelId: undefined,
      id: undefined,
      source: undefined,
    },
  );
});

test("open intent router queues until dispatcher is ready and preserves order", async () => {
  const {
    clearPendingOpenIntents,
    flushPendingOpenIntents,
    getPendingOpenIntents,
    registerOpenIntentDispatcher,
    routeOpenIntent,
  } = await loadRuntimeContracts();

  clearPendingOpenIntents();
  const first = await routeOpenIntent({
    kind: "openFile",
    path: "/workspace/first.ts",
  });
  const second = await routeOpenIntent({
    kind: "openPreview",
    surface: "browser",
    url: "http://localhost:5173",
  });

  assert.equal(first.status, "queued");
  assert.equal(second.status, "queued");
  assert.equal(getPendingOpenIntents().length, 2);

  const calls = [];
  const unregister = registerOpenIntentDispatcher({
    openProject: (projectPath) => calls.push(["project", projectPath]),
    openFile: (path, line) => calls.push(["file", path, line]),
    openPreview: (input) =>
      calls.push(["preview", input.surface, input.payload.url]),
    focusSurface: (intent) => calls.push(["focus", intent.surfaceId]),
  });
  await flushPendingOpenIntents();

  assert.deepEqual(calls, [
    ["file", "/workspace/first.ts", undefined],
    ["preview", "browser", "http://localhost:5173"],
  ]);
  assert.equal(getPendingOpenIntents().length, 0);

  const immediate = await routeOpenIntent({
    kind: "focusSurface",
    surfaceId: "panel:explorer",
  });
  assert.equal(immediate.status, "dispatched");
  assert.deepEqual(calls.at(-1), ["focus", "panel:explorer"]);

  unregister();
});

test("surface runtime store publishes read-only snapshots for host sync", async () => {
  const {
    getSurfaceRuntimeSnapshot,
    subscribeSurfaceRuntime,
    syncSurfaceRuntimeFromHost,
  } = await loadRuntimeContracts();
  const observedRevisions = [];
  const unsubscribe = subscribeSurfaceRuntime(() => {
    observedRevisions.push(getSurfaceRuntimeSnapshot().revision);
  });

  const nextSnapshot = syncSurfaceRuntimeFromHost([
    {
      id: "panel:explorer",
      source: "panel",
      appletKind: "explorer",
      hostMode: "snapped",
      title: "Explorer",
      active: false,
      pinned: false,
      panelId: "explorer",
      geometry: {
        position: "left",
        width: 280,
        height: 600,
        x: 12,
        y: 24,
      },
    },
    {
      id: "preview:preview-browser-default",
      source: "preview",
      appletKind: "browser",
      hostMode: "snapped",
      title: "Preview localhost:5173",
      active: true,
      pinned: true,
      createdAt: 1710000000000,
      updatedAt: 1710000001000,
      previewWindowId: "preview-browser-default",
      payload: { url: "http://localhost:5173" },
      geometry: {
        position: "right",
        width: 520,
        height: 620,
        x: 900,
        y: 70,
        zIndex: 132,
      },
    },
  ]);

  assert.equal(nextSnapshot.activeSurfaceId, "preview:preview-browser-default");
  assert.equal(nextSnapshot.sessions.length, 2);
  assert.equal(
    nextSnapshot.byId["preview:preview-browser-default"].payload.url,
    "http://localhost:5173",
  );
  assert.deepEqual(observedRevisions, [nextSnapshot.revision]);

  const unchangedSnapshot = syncSurfaceRuntimeFromHost(nextSnapshot.sessions);
  assert.equal(unchangedSnapshot.revision, nextSnapshot.revision);
  assert.deepEqual(observedRevisions, [nextSnapshot.revision]);

  unsubscribe();
});

test("surface runtime read model tracks active surface, focus history, and indexes", async () => {
  const {
    getSurfaceRuntimeFocusState,
    getSurfaceRuntimeReadModel,
    syncSurfaceRuntimeFromHost,
  } = await loadRuntimeContracts();

  const panelSession = {
    id: "panel:explorer",
    source: "panel",
    appletKind: "explorer",
    hostMode: "snapped",
    title: "Explorer",
    active: true,
    pinned: false,
    panelId: "explorer",
    geometry: {
      position: "left",
      width: 280,
      height: 600,
      x: 12,
      y: 24,
    },
  };
  const previewSession = {
    id: "preview:preview-browser-default",
    source: "preview",
    appletKind: "browser",
    hostMode: "snapped",
    title: "Preview localhost:5173",
    active: false,
    pinned: true,
    previewWindowId: "preview-browser-default",
    payload: { url: "http://localhost:5173" },
    geometry: {
      position: "right",
      width: 520,
      height: 620,
      x: 900,
      y: 70,
      zIndex: 132,
    },
  };

  syncSurfaceRuntimeFromHost([panelSession, previewSession]);
  syncSurfaceRuntimeFromHost([
    { ...panelSession, active: false },
    { ...previewSession, active: true },
  ]);

  const readModel = getSurfaceRuntimeReadModel({ eventLimit: 1 });
  assert.equal(readModel.activeSurfaceId, "preview:preview-browser-default");
  assert.equal(readModel.activeSurface.title, "Preview localhost:5173");
  assert.equal(readModel.openSurfaceCount, 2);
  assert.deepEqual(readModel.sessionIds, [
    "panel:explorer",
    "preview:preview-browser-default",
  ]);
  assert.deepEqual(readModel.sessionsBySource.panel, ["panel:explorer"]);
  assert.deepEqual(readModel.sessionsBySource.preview, [
    "preview:preview-browser-default",
  ]);
  assert.deepEqual(readModel.sessionsByHostMode.snapped, [
    "panel:explorer",
    "preview:preview-browser-default",
  ]);
  assert.deepEqual(readModel.sessionsByAppletKind.browser, [
    "preview:preview-browser-default",
  ]);
  assert.equal(readModel.focus.previousSurfaceId, "panel:explorer");
  assert.equal(
    readModel.focus.history.at(-1).surfaceId,
    "preview:preview-browser-default",
  );
  assert.equal(readModel.events.length, 1);
  assert.equal(readModel.events[0].type, "surface:focus");
  assert.equal(readModel.eventCursor, readModel.events[0].at);

  const focusState = getSurfaceRuntimeFocusState();
  assert.equal(focusState.activeSurfaceId, readModel.activeSurfaceId);
  assert.equal(focusState.activeSurface.title, readModel.activeSurface.title);

  const readModelWithoutEvents = getSurfaceRuntimeReadModel({
    includeEvents: false,
  });
  assert.deepEqual(readModelWithoutEvents.events, []);
  assert.equal(readModelWithoutEvents.eventCursor, readModel.eventCursor);
});

test("surface runtime store derives observable events from host transitions", async () => {
  const {
    clearSurfaceRuntimeEventHistory,
    getSurfaceRuntimeEventHistory,
    getSurfaceRuntimeReadModel,
    subscribeSurfaceRuntimeEvents,
    syncSurfaceRuntimeFromHost,
  } = await loadRuntimeContracts();

  const seedSessions = [
    {
      id: "panel:explorer",
      source: "panel",
      appletKind: "explorer",
      hostMode: "snapped",
      title: "Explorer",
      active: false,
      pinned: false,
      panelId: "explorer",
      geometry: {
        position: "left",
        width: 280,
        height: 600,
        x: 12,
        y: 24,
      },
    },
  ];
  const movedExplorerSession = {
    ...seedSessions[0],
    hostMode: "floating",
    active: true,
    geometry: {
      position: "left",
      width: 360,
      height: 620,
      x: 72,
      y: 88,
    },
  };
  const fullscreenExplorerSession = {
    ...movedExplorerSession,
    hostMode: "fullscreen",
    geometry: {
      position: "left",
      width: 1440,
      height: 900,
      x: 0,
      y: 0,
    },
  };
  const previewSession = {
    id: "preview:preview-browser-default",
    source: "preview",
    appletKind: "browser",
    hostMode: "snapped",
    title: "Preview localhost:5173",
    active: false,
    pinned: true,
    previewWindowId: "preview-browser-default",
    payload: { url: "http://localhost:5173" },
    geometry: {
      position: "right",
      width: 520,
      height: 620,
      x: 900,
      y: 70,
      zIndex: 132,
    },
  };

  syncSurfaceRuntimeFromHost(seedSessions);
  clearSurfaceRuntimeEventHistory();

  let observedEventNotifications = 0;
  const unsubscribe = subscribeSurfaceRuntimeEvents(() => {
    observedEventNotifications += 1;
  });

  syncSurfaceRuntimeFromHost([movedExplorerSession, previewSession]);

  const firstHistory = getSurfaceRuntimeEventHistory();
  assert.deepEqual(
    firstHistory.map((event) => event.type),
    ["surface:promote", "surface:open"],
  );
  assert.equal(firstHistory[0].surfaceId, "panel:explorer");
  assert.equal(firstHistory[0].hostMode, "floating");
  assert.equal(firstHistory[0].geometry.width, 360);
  assert.equal(firstHistory[1].surfaceId, "preview:preview-browser-default");
  assert.equal(firstHistory[1].session.payload.url, "http://localhost:5173");
  assert.equal(observedEventNotifications, 2);
  const promotedReadModel = getSurfaceRuntimeReadModel({
    includeEvents: false,
  });
  assert.equal(
    promotedReadModel.promotion.returnTargets["panel:explorer"].hostMode,
    "snapped",
  );
  assert.equal(
    promotedReadModel.promotion.commandsBySurfaceId["panel:explorer"].some(
      (command) => command.kind === "return-to-main" && command.enabled,
    ),
    true,
  );
  const detachCommand = promotedReadModel.promotion.commandsBySurfaceId[
    "panel:explorer"
  ].find((command) => command.kind === "detach");
  assert.equal(detachCommand.enabled, false);
  assert.equal(detachCommand.requiresDetachedWindow, true);

  syncSurfaceRuntimeFromHost([movedExplorerSession, previewSession]);
  assert.equal(getSurfaceRuntimeEventHistory().length, firstHistory.length);

  syncSurfaceRuntimeFromHost([fullscreenExplorerSession, previewSession]);
  const fullscreenHistory = getSurfaceRuntimeEventHistory();
  assert.equal(fullscreenHistory.at(-1).type, "surface:promote");
  assert.equal(fullscreenHistory.at(-1).hostMode, "fullscreen");
  assert.equal(
    getSurfaceRuntimeReadModel({ includeEvents: false }).promotion
      .returnTargets["panel:explorer"].hostMode,
    "floating",
  );

  syncSurfaceRuntimeFromHost([movedExplorerSession, previewSession]);
  assert.equal(
    getSurfaceRuntimeReadModel({ includeEvents: false }).promotion
      .returnTargets["panel:explorer"],
    undefined,
  );

  syncSurfaceRuntimeFromHost([previewSession]);
  const finalHistory = getSurfaceRuntimeEventHistory();
  assert.equal(finalHistory.at(-1).type, "surface:close");
  assert.equal(finalHistory.at(-1).surfaceId, "panel:explorer");

  unsubscribe();
});

test("surface runtime events keep operation payloads canonical", async () => {
  const {
    createSurfaceRuntimeEvent,
    dedupeSurfaceRuntimeEvents,
    parseSurfaceRuntimeEvent,
    surfaceRuntimeEventDedupeKey,
  } = await loadRuntimeContracts();

  const openEvent = createSurfaceRuntimeEvent({
    type: "surface:open",
    at: 1710000002000,
    session: {
      id: "preview:preview-browser-default",
      source: "preview",
      appletKind: "browser",
      hostMode: "snapped",
      title: "Preview localhost:5173",
      active: true,
      pinned: true,
      previewWindowId: "preview-browser-default",
      geometry: {
        position: "right",
        width: 520,
        height: 620,
        x: 900,
        y: 70,
        zIndex: 132,
      },
      payload: { url: "http://localhost:5173" },
    },
  });
  const parsedMoveEvent = parseSurfaceRuntimeEvent({
    type: "surface:move",
    surfaceId: "preview:preview-browser-default",
    at: 1710000003000,
    hostMode: "floating",
    geometry: {
      position: "right",
      width: 640,
      height: 520,
      x: 120,
      y: 90,
    },
  });
  const parsedFailure = parseSurfaceRuntimeEvent({
    type: "surface:close",
    surfaceId: "preview:missing",
    at: 1710000004000,
    ok: false,
    reason: "Surface not found.",
  });

  assert.equal(openEvent.surfaceId, "preview:preview-browser-default");
  assert.equal(openEvent.ok, true);
  assert.equal(
    surfaceRuntimeEventDedupeKey(openEvent),
    "surface:open:preview:preview-browser-default:1710000002000",
  );
  assert.deepEqual(parsedMoveEvent, {
    type: "surface:move",
    surfaceId: "preview:preview-browser-default",
    at: 1710000003000,
    session: undefined,
    geometry: {
      position: "right",
      width: 640,
      height: 520,
      x: 120,
      y: 90,
    },
    hostMode: "floating",
    reason: undefined,
    ok: true,
  });
  assert.deepEqual(parsedFailure, {
    type: "surface:close",
    surfaceId: "preview:missing",
    at: 1710000004000,
    session: undefined,
    geometry: undefined,
    hostMode: undefined,
    reason: "Surface not found.",
    ok: false,
  });
  assert.equal(
    parseSurfaceRuntimeEvent({
      type: "surface:move",
      surfaceId: "preview:preview-browser-default",
      hostMode: "invalid-mode",
    })?.hostMode,
    undefined,
  );
  assert.equal(parseSurfaceRuntimeEvent({ type: "surface:unknown" }), null);
  assert.deepEqual(
    dedupeSurfaceRuntimeEvents([openEvent, openEvent, parsedMoveEvent]),
    [openEvent, parsedMoveEvent],
  );
});

test("shell capabilities expose conservative fallback statuses and backend sync", async () => {
  const {
    canUseShellCapability,
    getFallbackShellCapabilities,
    getShellCapabilitiesSnapshot,
    subscribeShellCapabilities,
    syncShellCapabilities,
  } = await loadRuntimeContracts();
  const fallback = getFallbackShellCapabilities();
  const initialSnapshot = getShellCapabilitiesSnapshot();

  assert.equal(fallback.clipboard.status, "available");
  assert.equal(fallback.browserOpenURL.status, "available");
  assert.equal(fallback.nativeMenu.status, "available");
  assert.equal(fallback.backgroundStatus.status, "available");
  assert.equal(fallback.multiWindow.status, "experimental");
  assert.equal(fallback.contextMenu.status, "unavailable");
  assert.equal(fallback.customProtocol.status, "requires-build");
  assert.equal(fallback.fileAssociations.status, "requires-build");
  assert.equal(fallback.singleInstance.status, "requires-build");
  assert.equal(initialSnapshot.loadedFromBackend, false);
  assert.equal(canUseShellCapability("clipboard"), true);
  assert.equal(canUseShellCapability("multiWindow"), true);
  assert.equal(canUseShellCapability("contextMenu"), false);
  assert.equal(canUseShellCapability("customProtocol"), false);

  const observedRevisions = [];
  const unsubscribe = subscribeShellCapabilities(() => {
    observedRevisions.push(getShellCapabilitiesSnapshot().revision);
  });

  const nextSnapshot = syncShellCapabilities({
    contextMenu: {
      status: "available",
      reason: "Native context menu service reported ready.",
      source: "backend",
    },
  });

  assert.equal(nextSnapshot.capabilities.contextMenu.status, "available");
  assert.equal(nextSnapshot.capabilities.contextMenu.source, "backend");
  assert.equal(nextSnapshot.capabilities.tray.status, "unavailable");
  assert.equal(nextSnapshot.capabilities.backgroundStatus.status, "available");
  assert.deepEqual(observedRevisions, [nextSnapshot.revision]);

  const unchangedSnapshot = syncShellCapabilities({
    contextMenu: {
      status: "available",
      reason: "Native context menu service reported ready.",
      source: "backend",
    },
  });
  assert.equal(unchangedSnapshot.revision, nextSnapshot.revision);
  assert.deepEqual(observedRevisions, [nextSnapshot.revision]);

  unsubscribe();
});

test("packaged OS integration normalizes default-off adapters and background actions", async () => {
  const {
    getFallbackPackagedOSIntegration,
    getPackagedOSIntegrationSnapshot,
    loadPackagedOSIntegrationFromBackend,
    normalizePackagedOSIntegrationPayload,
    runPackagedOSIntegrationAction,
    subscribePackagedOSIntegration,
    syncPackagedOSIntegrationFromPayload,
  } = await loadRuntimeContracts();

  const fallback = getFallbackPackagedOSIntegration();
  assert.equal(fallback.adapters.customProtocol.status, "requires-build");
  assert.equal(fallback.adapters.tray.enabled, false);
  assert.equal(fallback.adapters.notifications.enabled, false);
  assert.equal(fallback.adapters.autoUpdate.enabled, false);

  const normalized = normalizePackagedOSIntegrationPayload({
    Version: 1,
    Platform: "darwin",
    Runtime: "wails-v3",
    PackagedBuild: true,
    SpikeEnabled: true,
    NativeTrayEnabled: false,
    NativeNotificationsSent: false,
    Adapters: {
      tray: {
        ID: "tray",
        Label: "Tray",
        Capability: "tray",
        Status: "experimental",
        Enabled: false,
        RequiresPackagedBuild: true,
        Reason: "Packaged smoke required.",
        BackgroundActionCount: 1,
      },
      notifications: {
        ID: "notifications",
        Label: "Notifications",
        Capability: "notifications",
        Status: "experimental",
        Enabled: false,
        RequiresPackagedBuild: true,
        Reason: "Packaged smoke required.",
        NotificationCandidateCount: 1,
      },
    },
    BackgroundActions: [
      {
        ID: "cancel:indexer:1",
        Label: "Cancel",
        Intent: "cancel-job",
        JobID: "indexer:1",
        Enabled: true,
      },
    ],
    NotificationCandidates: [
      {
        ID: "notification:indexer:1",
        JobID: "indexer:1",
        Severity: "error",
        Title: "Project indexing",
        Body: "Indexing failed.",
        DedupeKey: "indexer:1:failed",
        CreatedAt: 1710000000000,
        Action: {
          ID: "focus:panel:terminal",
          Label: "Focus",
          Intent: "focus-surface",
          OwnerSurfaceID: "panel:terminal",
          Enabled: true,
        },
      },
    ],
    AutoUpdateManifest: {
      Channel: "alpha",
      Version: "0.1.0",
      URL: "https://example.invalid/arlecchino.zip",
    },
  });

  assert.equal(normalized.packagedBuild, true);
  assert.equal(normalized.adapters.tray.status, "experimental");
  assert.equal(normalized.adapters.tray.backgroundActionCount, 1);
  assert.equal(normalized.notificationCandidates.length, 1);
  assert.equal(
    normalized.notificationCandidates[0].action.ownerSurfaceId,
    "panel:terminal",
  );
  assert.equal(normalized.autoUpdateManifest.version, "0.1.0");

  const observedRevisions = [];
  const unsubscribe = subscribePackagedOSIntegration(() => {
    observedRevisions.push(getPackagedOSIntegrationSnapshot().revision);
  });

  const firstSnapshot = syncPackagedOSIntegrationFromPayload(normalized);
  assert.equal(firstSnapshot.loadedFromBackend, true);
  assert.equal(firstSnapshot.revision > 0, true);
  assert.deepEqual(observedRevisions, [firstSnapshot.revision]);
  const secondSnapshot = syncPackagedOSIntegrationFromPayload(normalized);
  assert.equal(secondSnapshot.revision, firstSnapshot.revision);
  assert.deepEqual(observedRevisions, [firstSnapshot.revision]);

  const loadedSnapshot = await loadPackagedOSIntegrationFromBackend({
    GetPackagedOSIntegrationStatus: async () => normalized,
  });
  assert.equal(loadedSnapshot.adapters.autoUpdate.enabled, false);

  const actionResult = await runPackagedOSIntegrationAction(
    "background:cancel:indexer:1",
    {
      RunPackagedOSIntegrationAction: async (actionId) => ({
        handled: true,
        adapterId: "background-shell",
        backgroundAction: {
          id: actionId.slice("background:".length),
          label: "Cancel",
          intent: "cancel-job",
          jobId: "indexer:1",
          enabled: true,
        },
      }),
    },
  );
  assert.equal(actionResult.handled, true);
  assert.equal(actionResult.backgroundAction.intent, "cancel-job");

  unsubscribe();
});

test("background shell status normalizes backend snapshots without enabling native delivery", async () => {
  const {
    BACKGROUND_SHELL_STATUS_EVENT,
    getFallbackBackgroundShellStatus,
    normalizeBackgroundShellStatusPayload,
  } = await loadRuntimeContracts();

  const fallback = getFallbackBackgroundShellStatus();
  assert.equal(BACKGROUND_SHELL_STATUS_EVENT, "shell:background:status");
  assert.equal(fallback.source, "fallback");
  assert.equal(fallback.nativeTrayEnabled, false);
  assert.equal(fallback.nativeNotificationsSent, false);

  const normalized = normalizeBackgroundShellStatusPayload({
    Version: 1,
    Revision: 7,
    UpdatedAt: 1710000000000,
    ActiveCount: 1,
    ServiceCount: 1,
    AttentionCount: 1,
    NativeTrayEnabled: true,
    NativeNotificationsSent: true,
    Jobs: [
      {
        ID: "indexer:1",
        Kind: "indexing",
        Category: "job",
        Title: "Project indexing",
        Status: "running",
        Severity: "info",
        Progress: { Percent: 125, Current: 8, Total: 10 },
        Cancelable: true,
        StartedAt: 1710000000000,
        UpdatedAt: 1710000001000,
      },
      {
        ID: "broken",
        Status: "unknown",
      },
    ],
    Events: [
      {
        ID: "indexer:1:1710000001000",
        Type: "job:updated",
        JobID: "indexer:1",
        Kind: "indexing",
        Severity: "info",
        Message: "Indexed 8 of 10 project files.",
        At: 1710000001000,
      },
    ],
    NotificationCandidates: [
      {
        ID: "notification:lsp-install:gopls:1710000002000",
        JobID: "lsp-install:gopls",
        Severity: "error",
        Title: "Install gopls language server",
        Body: "go is missing",
        DedupeKey: "lsp-install:gopls:failed",
        CreatedAt: 1710000002000,
        Action: {
          ID: "focus:panel:terminal",
          Label: "Focus",
          Intent: "focus-surface",
          JobID: "lsp-install:gopls",
          OwnerSurfaceID: "panel:terminal",
          Enabled: true,
        },
      },
    ],
    Actions: [
      {
        ID: "cancel:indexer:1",
        Label: "Cancel",
        Intent: "cancel-job",
        JobID: "indexer:1",
        Enabled: true,
      },
    ],
  });

  assert.equal(normalized.source, "backend");
  assert.equal(normalized.loadedFromBackend, true);
  assert.equal(normalized.revision, 7);
  assert.equal(normalized.jobs.length, 1);
  assert.equal(normalized.jobs[0].progress.percent, 100);
  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.notificationCandidates.length, 1);
  assert.equal(
    normalized.notificationCandidates[0].action.ownerSurfaceId,
    "panel:terminal",
  );
  assert.equal(normalized.actions.length, 1);
  assert.equal(normalized.nativeTrayEnabled, false);
  assert.equal(normalized.nativeNotificationsSent, false);
});

test("background shell status syncs snapshots and keeps stable revisions", async () => {
  const {
    getBackgroundShellStatusSnapshot,
    loadBackgroundShellStatusFromBackend,
    runBackgroundShellAction,
    subscribeBackgroundShellStatus,
    syncBackgroundShellStatusFromPayload,
  } = await loadRuntimeContracts();

  const backendPayload = {
    version: 1,
    revision: 11,
    updatedAt: 1710000003000,
    activeCount: 1,
    serviceCount: 0,
    attentionCount: 0,
    jobs: [
      {
        id: "indexer:1",
        kind: "indexing",
        category: "job",
        title: "Project indexing",
        status: "running",
        severity: "info",
        cancelable: false,
        startedAt: 1710000000000,
        updatedAt: 1710000003000,
      },
    ],
  };

  const observedRevisions = [];
  const unsubscribe = subscribeBackgroundShellStatus(() => {
    observedRevisions.push(getBackgroundShellStatusSnapshot().revision);
  });

  const firstSnapshot = await loadBackgroundShellStatusFromBackend({
    GetBackgroundShellStatus: async () => backendPayload,
  });
  assert.equal(firstSnapshot.loadedFromBackend, true);
  assert.equal(firstSnapshot.revision, 11);
  assert.equal(firstSnapshot.activeCount, 1);

  const secondSnapshot = syncBackgroundShellStatusFromPayload(backendPayload);
  assert.equal(secondSnapshot.revision, firstSnapshot.revision);
  assert.deepEqual(observedRevisions, [11]);

  const missingBridgeSnapshot =
    await loadBackgroundShellStatusFromBackend(null);
  assert.equal(missingBridgeSnapshot.revision, firstSnapshot.revision);

  const actionResult = await runBackgroundShellAction("cancel:indexer:1", {
    RunBackgroundShellAction: async (actionId) => ({
      handled: true,
      action: {
        id: actionId,
        label: "Cancel",
        intent: "cancel-job",
        jobId: "indexer:1",
        enabled: true,
      },
      snapshot: {
        ...backendPayload,
        revision: 12,
        activeCount: 0,
        jobs: [
          {
            id: "indexer:1",
            kind: "indexing",
            category: "job",
            title: "Project indexing",
            status: "canceled",
            severity: "warning",
            cancelable: false,
            startedAt: 1710000000000,
            updatedAt: 1710000004000,
            completedAt: 1710000004000,
          },
        ],
      },
      message: "Background job canceled.",
    }),
  });
  assert.equal(actionResult.handled, true);
  assert.equal(actionResult.action.intent, "cancel-job");
  assert.equal(actionResult.snapshot.revision, 12);
  assert.equal(getBackgroundShellStatusSnapshot().activeCount, 0);

  unsubscribe();
});

test("native context menu adapter serializes current actions and bridge requests", async () => {
  const {
    buildNativeContextMenuItems,
    getContextActionId,
    openNativeContextMenu,
  } = await loadRuntimeContracts();

  const items = buildNativeContextMenuItems([
    {
      label: "Open File",
      onSelect: () => {},
    },
    { separator: true },
    {
      key: "copy-path",
      label: "Copy Path",
      onSelect: () => {},
    },
    {
      actionId: "danger.delete",
      label: "Move to Trash",
      danger: true,
      disabled: true,
    },
    {
      label: "Hidden",
      hidden: true,
    },
  ]);

  assert.deepEqual(items, [
    {
      id: "open-file-0",
      label: "Open File",
      disabled: undefined,
      danger: undefined,
      hidden: undefined,
    },
    {
      id: "separator-1",
      separator: true,
      hidden: undefined,
    },
    {
      id: "copy-path",
      label: "Copy Path",
      disabled: undefined,
      danger: undefined,
      hidden: undefined,
    },
    {
      id: "danger.delete",
      label: "Move to Trash",
      disabled: true,
      danger: true,
      hidden: undefined,
    },
    {
      id: "hidden-4",
      label: "Hidden",
      disabled: undefined,
      danger: undefined,
      hidden: true,
    },
  ]);
  assert.equal(getContextActionId({ label: "Open File" }, 0), "open-file-0");
  assert.equal(
    getContextActionId({ actionId: "custom.open", label: "Open File" }, 0),
    "custom.open",
  );

  const requests = [];
  const response = await openNativeContextMenu(
    {
      menuInstanceId: "menu-1",
      scope: "test",
      targetId: "/tmp/file.ts",
      x: 12,
      y: 24,
      items,
      context: { path: "/tmp/file.ts" },
    },
    {
      OpenNativeContextMenu: async (request) => {
        requests.push(request);
        return {
          opened: true,
          menuInstanceId: request.menuInstanceId,
          menuId: "native-menu-1",
        };
      },
    },
  );

  assert.equal(response.opened, true);
  assert.equal(response.menuId, "native-menu-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].scope, "test");
  assert.deepEqual(requests[0].context, { path: "/tmp/file.ts" });

  const missingBridgeResponse = await openNativeContextMenu(
    {
      menuInstanceId: "menu-2",
      scope: "test",
      x: 0,
      y: 0,
      items,
    },
    null,
  );
  assert.equal(missingBridgeResponse.opened, false);
});

test("shell wrappers route dialogs clipboard and external URL through capabilities", async () => {
  const {
    openExternalUrlWithCapability,
    readClipboardTextWithFallback,
    selectDirectoryWithCapability,
    syncShellCapabilities,
    writeClipboardTextWithFallback,
  } = await loadRuntimeContracts();

  const runtimeOpenedUrls = [];
  syncShellCapabilities({
    browserOpenURL: {
      status: "available",
      reason: "Runtime browser open is available.",
      source: "backend",
    },
    clipboard: {
      status: "available",
      reason: "Runtime clipboard is available.",
      source: "backend",
    },
    dialogs: {
      status: "available",
      reason: "Native dialogs are available.",
      source: "backend",
    },
  });

  assert.equal(
    await openExternalUrlWithCapability("https://example.test/path", {
      openWithRuntime: async (url) => runtimeOpenedUrls.push(url),
      openWithWindow: () => {
        throw new Error("window fallback should not run");
      },
    }),
    true,
  );
  assert.deepEqual(runtimeOpenedUrls, ["https://example.test/path"]);

  const writtenTexts = [];
  assert.equal(
    await writeClipboardTextWithFallback(
      "hello",
      async (text) => writtenTexts.push(text),
      async () => {
        throw new Error("navigator fallback should not run");
      },
    ),
    true,
  );
  assert.deepEqual(writtenTexts, ["hello"]);
  assert.equal(
    await readClipboardTextWithFallback(
      async () => "from-runtime",
      async () => {
        throw new Error("navigator fallback should not run");
      },
    ),
    "from-runtime",
  );
  assert.equal(
    await selectDirectoryWithCapability(
      "Open project",
      async (title) => `/tmp/${title}`,
    ),
    "/tmp/Open project",
  );

  syncShellCapabilities({
    browserOpenURL: {
      status: "unavailable",
      reason: "Runtime browser open is unavailable.",
      source: "backend",
    },
    clipboard: {
      status: "unavailable",
      reason: "Runtime clipboard is unavailable.",
      source: "backend",
    },
    dialogs: {
      status: "unavailable",
      reason: "Native dialogs are unavailable.",
      source: "backend",
    },
  });

  const fallbackOpenedUrls = [];
  assert.equal(
    await openExternalUrlWithCapability("http://localhost:5173", {
      openWithRuntime: () => {
        throw new Error("runtime open should not run");
      },
      openWithWindow: (url, target, features) => {
        fallbackOpenedUrls.push({ url, target, features });
        return {};
      },
    }),
    true,
  );
  assert.deepEqual(fallbackOpenedUrls, [
    {
      url: "http://localhost:5173/",
      target: "_blank",
      features: "noopener,noreferrer",
    },
  ]);
  assert.equal(
    await openExternalUrlWithCapability("file:///tmp/unsafe", {
      openWithRuntime: () => {
        throw new Error("runtime open should not run");
      },
      openWithWindow: () => {
        throw new Error("window fallback should not run");
      },
    }),
    false,
  );

  assert.equal(
    await writeClipboardTextWithFallback(
      "fallback",
      () => {
        throw new Error("runtime write should not run");
      },
      async (text) => text === "fallback",
    ),
    true,
  );
  assert.equal(
    await readClipboardTextWithFallback(
      () => {
        throw new Error("runtime read should not run");
      },
      async () => "from-navigator",
    ),
    "from-navigator",
  );
  await assert.rejects(
    () =>
      selectDirectoryWithCapability("Open project", async () => "/tmp/project"),
    /Native directory dialogs are unavailable/,
  );
});

test("shell capabilities normalize backend payloads without trusting invalid entries", async () => {
  const { normalizeShellCapabilitiesPayload } = await loadRuntimeContracts();

  const normalized = normalizeShellCapabilitiesPayload({
    Platform: " darwin ",
    Runtime: " wails-v3 ",
    Version: 1,
    Capabilities: {
      dialogs: {
        Status: "available",
        Reason: "Dialogs are ready.",
        Source: "backend",
      },
      clipboard: {
        status: "available",
        reason: "",
        source: "unexpected",
      },
      contextMenu: {
        status: "not-a-status",
        reason: "Invalid status must be ignored.",
      },
      unknownCapability: {
        status: "available",
        reason: "Unknown capability must be ignored.",
      },
    },
  });

  assert.equal(normalized.platform, "darwin");
  assert.equal(normalized.runtime, "wails-v3");
  assert.equal(normalized.version, 1);
  assert.deepEqual(Object.keys(normalized.capabilities).sort(), [
    "clipboard",
    "dialogs",
  ]);
  assert.equal(normalized.capabilities.dialogs.status, "available");
  assert.equal(normalized.capabilities.dialogs.reason, "Dialogs are ready.");
  assert.equal(normalized.capabilities.dialogs.source, "backend");
  assert.equal(normalized.capabilities.clipboard.source, "backend");
  assert.match(normalized.capabilities.clipboard.reason, /Clipboard/);
});

test("shell capabilities load backend snapshots and keep stable revisions", async () => {
  const {
    canUseShellCapability,
    getShellCapabilitiesSnapshot,
    loadShellCapabilitiesFromBackend,
    syncShellCapabilitiesFromPayload,
  } = await loadRuntimeContracts();

  const backendPayload = {
    platform: "darwin",
    runtime: "wails-v3",
    version: 1,
    capabilities: {
      dialogs: {
        status: "available",
        reason: "Dialogs are ready.",
        source: "backend",
      },
      contextMenu: {
        status: "available",
        reason: "Native context menu service reported ready.",
        source: "backend",
      },
    },
  };

  const firstSnapshot = await loadShellCapabilitiesFromBackend({
    GetShellCapabilities: async () => backendPayload,
  });

  assert.equal(firstSnapshot.loadedFromBackend, true);
  assert.equal(firstSnapshot.platform, "darwin");
  assert.equal(firstSnapshot.runtime, "wails-v3");
  assert.equal(firstSnapshot.version, 1);
  assert.equal(firstSnapshot.capabilities.dialogs.status, "available");
  assert.equal(firstSnapshot.capabilities.dialogs.source, "backend");
  assert.equal(canUseShellCapability("dialogs"), true);
  assert.equal(canUseShellCapability("contextMenu"), true);
  assert.equal(firstSnapshot.capabilities.tray.status, "unavailable");

  const secondSnapshot = syncShellCapabilitiesFromPayload(backendPayload);
  assert.equal(secondSnapshot.revision, firstSnapshot.revision);

  const currentSnapshot = getShellCapabilitiesSnapshot();
  const missingBridgeSnapshot = await loadShellCapabilitiesFromBackend(null);
  assert.equal(missingBridgeSnapshot.revision, currentSnapshot.revision);
});
