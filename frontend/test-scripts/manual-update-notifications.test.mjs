import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");

async function loadManualUpdateContracts() {
  const result = await build({
    stdin: {
      contents: `
        export {
          buildManualUpdateNotification,
        } from "./src/shell/manualUpdateNotifications.ts";
        export {
          getFallbackPackagedOSIntegration,
          normalizePackagedOSIntegrationPayload,
        } from "./src/shell/packagedOSIntegration.ts";
      `,
      loader: "ts",
      resolveDir: frontendRoot,
      sourcefile: "manual-update-notification-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });

  const code = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
}

test("manual update notification is silent without a validated manifest", async () => {
  const { buildManualUpdateNotification, getFallbackPackagedOSIntegration } =
    await loadManualUpdateContracts();

  assert.equal(
    buildManualUpdateNotification(getFallbackPackagedOSIntegration()),
    null,
  );
});

test("manual update notification summarizes a validated manifest", async () => {
  const {
    buildManualUpdateNotification,
    normalizePackagedOSIntegrationPayload,
  } = await loadManualUpdateContracts();

  const snapshot = normalizePackagedOSIntegrationPayload({
    adapters: {
      autoUpdate: {
        id: "autoUpdate",
        label: "Auto Update",
        capability: "autoUpdate",
        status: "experimental",
        enabled: false,
        defaultEnabled: false,
        requiresPackagedBuild: true,
        reason: "Manifest read; install disabled.",
      },
    },
    autoUpdateManifest: {
      channel: "alpha",
      version: "0.2.0",
      releaseNotes: "Manual download only.",
      mandatory: true,
      artifacts: [
        {
          platform: "darwin",
          arch: "universal",
          url: "https://example.test/arlecchino-macos-universal.dmg",
          sha256: "a".repeat(64),
          signature: "signature",
        },
      ],
    },
  });

  const summary = buildManualUpdateNotification({
    ...snapshot,
    revision: 1,
    loadedFromBackend: true,
  });

  assert.ok(summary);
  assert.equal(summary.key, "alpha:0.2.0");
  assert.equal(summary.kind, "warning");
  assert.equal(summary.sticky, true);
  assert.match(summary.message, /Version 0\.2\.0/);
  assert.match(summary.message, /Manual download only/);
});
