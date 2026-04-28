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
          parseOpenPreviewInput,
          parsePanelOpenRequest,
          parseUpdatePreviewInput,
          parseWindowIdFromPayload,
        } from "./src/components/layout/mainLayoutEventParsers.ts";
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
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
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
