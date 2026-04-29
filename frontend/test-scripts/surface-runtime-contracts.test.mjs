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
          parseOpenPreviewInput,
          parsePanelOpenRequest,
          parseUpdatePreviewInput,
          parseWindowIdFromPayload,
        } from "./src/components/layout/mainLayoutEventParsers.ts";
        export {
          clearSurfaceRuntimeEventHistory,
          getSurfaceRuntimeEventHistory,
          getSurfaceRuntimeSnapshot,
          recordSurfaceRuntimeEvent,
          subscribeSurfaceRuntime,
          subscribeSurfaceRuntimeEvents,
          syncSurfaceRuntimeFromHost,
        } from "./src/surfaces/surfaceRuntimeStore.ts";
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

test("surface runtime store derives observable events from host transitions", async () => {
  const {
    clearSurfaceRuntimeEventHistory,
    getSurfaceRuntimeEventHistory,
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

  syncSurfaceRuntimeFromHost([movedExplorerSession, previewSession]);
  assert.equal(getSurfaceRuntimeEventHistory().length, firstHistory.length);

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
