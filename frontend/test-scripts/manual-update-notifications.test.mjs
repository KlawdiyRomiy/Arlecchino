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
          resetManualUpdateNotificationStateForTests,
          runAutoUpdateCheckWithNotification,
        } from "./src/shell/manualUpdateNotifications.ts";
        export {
          useAppNotificationStore,
        } from "./src/stores/appNotificationStore.ts";
        export {
          normalizeAutoUpdateStatusPayload,
          normalizePrivateUpdateAuthStatusPayload,
          resetAutoUpdateStartupCheckForTests,
          runAutoUpdateStartupCheckIfNeeded,
          shouldRunAutoUpdateStartupCheck,
        } from "./src/shell/autoUpdate.ts";
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

const normalizeStatus = (normalizeAutoUpdateStatusPayload, payload) => ({
  ...normalizeAutoUpdateStatusPayload(payload),
  revision: 1,
  loadedFromBackend: true,
});

test("update notification is silent while updater is idle", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "idle",
  });

  assert.equal(buildManualUpdateNotification(status), null);
});

test("update notification is silent while checking or already current", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  for (const state of ["checking", "not-available"]) {
    const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
      state,
      reason: "No actionable update notification should be shown.",
    });

    assert.equal(buildManualUpdateNotification(status), null);
  }
});

test("manual update check shows not-available feedback", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "not-available",
    channel: "alpha",
    reason: "Current version 0.2.0 is up to date for channel alpha.",
    current: {
      packaged: true,
      version: "0.2.0",
    },
  });

  assert.equal(buildManualUpdateNotification(status), null);

  const summary = buildManualUpdateNotification(status, {
    includePassive: true,
  });

  assert.ok(summary);
  assert.equal(summary.kind, "success");
  assert.equal(summary.action, null);
  assert.equal(summary.tag, "alpha");
  assert.match(summary.message, /up to date/);
});

test("update notification offers download for an available signed update", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "available",
    channel: "alpha",
    targetVersion: "0.2.0",
    releaseNotes: "ZIP is signed and ready.",
    mandatory: true,
    reason: "Version 0.2.0 is available.",
  });

  const summary = buildManualUpdateNotification(status);

  assert.ok(summary);
  assert.equal(summary.key, "available:alpha:0.2.0");
  assert.equal(summary.kind, "warning");
  assert.equal(summary.sticky, true);
  assert.equal(summary.action, "download");
  assert.equal(summary.tag, "alpha");
  assert.match(summary.message, /ZIP is signed and ready/);
});

test("update notification offers relaunch after staging", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "staged",
    channel: "alpha",
    targetVersion: "0.2.0",
    progress: 1,
    reason: "Update is verified and ready to install after confirmation.",
  });

  const summary = buildManualUpdateNotification(status);

  assert.ok(summary);
  assert.equal(summary.kind, "success");
  assert.equal(summary.action, "apply");
  assert.equal(summary.progress, 1);
});

test("update notification falls back to release page when apply is unavailable", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "manual-required",
    channel: "alpha",
    targetVersion: "0.2.0",
    reason: "Current app bundle is not writable.",
  });

  const summary = buildManualUpdateNotification(status);

  assert.ok(summary);
  assert.equal(summary.kind, "warning");
  assert.equal(summary.action, "manual");
  assert.equal(summary.tag, "alpha");
  assert.match(summary.message, /not writable/);
});

test("manual update check refreshes an unchanged visible notification", async () => {
  const {
    normalizeAutoUpdateStatusPayload,
    resetManualUpdateNotificationStateForTests,
    runAutoUpdateCheckWithNotification,
    useAppNotificationStore,
  } = await loadManualUpdateContracts();

  useAppNotificationStore.getState().clearNotifications();
  resetManualUpdateNotificationStateForTests();

  const unchangedStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "manual-required",
    channel: "alpha",
    targetVersion: "0.2.0",
    reason: "No auto-update manifest is configured.",
  });

  await runAutoUpdateCheckWithNotification(async () => unchangedStatus);
  const firstNotification = useAppNotificationStore.getState().notifications[0];

  await runAutoUpdateCheckWithNotification(async () => unchangedStatus);
  const secondNotification =
    useAppNotificationStore.getState().notifications[0];

  assert.equal(useAppNotificationStore.getState().notifications.length, 1);
  assert.equal(secondNotification.id, "auto-update");
  assert.equal(secondNotification.title, "Manual update required");
  assert.equal(secondNotification.tag, "alpha");
  assert.ok(secondNotification.revision > firstNotification.revision);
});

test("manual update check does not leave checking notification stuck after a silent result", async () => {
  const {
    normalizeAutoUpdateStatusPayload,
    resetManualUpdateNotificationStateForTests,
    runAutoUpdateCheckWithNotification,
    useAppNotificationStore,
  } = await loadManualUpdateContracts();

  useAppNotificationStore.getState().clearNotifications();
  resetManualUpdateNotificationStateForTests();

  const silentStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "idle",
    current: {
      packaged: false,
    },
  });

  await runAutoUpdateCheckWithNotification(async () => silentStatus);

  const notification = useAppNotificationStore.getState().notifications[0];
  assert.equal(notification.id, "auto-update");
  assert.equal(notification.title, "Arlecchino is up to date");
  assert.equal(notification.kind, "success");
});

test("startup update check runs only for packaged apps with a manifest URL", async () => {
  const {
    normalizeAutoUpdateStatusPayload,
    resetAutoUpdateStartupCheckForTests,
    runAutoUpdateStartupCheckIfNeeded,
    shouldRunAutoUpdateStartupCheck,
  } = await loadManualUpdateContracts();

  resetAutoUpdateStartupCheckForTests();

  const packagedStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "idle",
    current: {
      packaged: true,
      updateManifestUrl: "file:///tmp/arlecchino-update-manifest.json",
    },
  });
  const devStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "idle",
    current: {
      packaged: false,
      updateManifestUrl: "file:///tmp/arlecchino-update-manifest.json",
    },
  });
  const missingManifestStatus = normalizeStatus(
    normalizeAutoUpdateStatusPayload,
    {
      state: "idle",
      current: { packaged: true },
    },
  );

  assert.equal(shouldRunAutoUpdateStartupCheck(packagedStatus), true);
  assert.equal(shouldRunAutoUpdateStartupCheck(devStatus), false);
  assert.equal(shouldRunAutoUpdateStartupCheck(missingManifestStatus), false);

  let checkCount = 0;
  const firstRun = await runAutoUpdateStartupCheckIfNeeded(
    packagedStatus,
    async () => {
      checkCount += 1;
      return packagedStatus;
    },
  );
  const secondRun = await runAutoUpdateStartupCheckIfNeeded(
    packagedStatus,
    async () => {
      checkCount += 1;
      return packagedStatus;
    },
  );

  assert.equal(firstRun, true);
  assert.equal(secondRun, false);
  assert.equal(checkCount, 1);
});

test("private update auth status normalization does not expose token values", async () => {
  const { normalizePrivateUpdateAuthStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizePrivateUpdateAuthStatusPayload({
    Provider: "github-release",
    Repository: "KlawdiyRomiy/Arlecchino",
    ManifestSource:
      "github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-update-manifest.json",
    Configured: true,
    Source: "keychain",
    EnvOverride: false,
    KeychainService: "io.arlecchino.ide.updater",
    KeychainAccount: "github-release-token",
    Reason: "Private GitHub release token is stored in Keychain.",
    Token: "github_pat_should_not_be_read",
  });

  assert.equal(status.configured, true);
  assert.equal(status.source, "keychain");
  assert.equal(status.repository, "KlawdiyRomiy/Arlecchino");
  assert.equal(Object.hasOwn(status, "token"), false);
});
