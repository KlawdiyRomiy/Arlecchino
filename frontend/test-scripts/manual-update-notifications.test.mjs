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
          buildReleaseNotesPresentation,
          isRawCommitDigestReleaseNotes,
          publishBackgroundAutoUpdateNotification,
          resetManualUpdateNotificationStateForTests,
          runAutoUpdateCheckWithNotification,
          runAutoUpdateDownloadWithNotification,
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
    channel: "beta",
    reason: "Current version 0.2.0 is up to date for channel beta.",
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
  assert.equal(summary.tag, "beta");
  assert.match(summary.message, /up to date/);
});

test("background update check stays silent unless an update is present", async () => {
  const {
    buildManualUpdateNotification,
    normalizeAutoUpdateStatusPayload,
    publishBackgroundAutoUpdateNotification,
    resetManualUpdateNotificationStateForTests,
    useAppNotificationStore,
  } = await loadManualUpdateContracts();

  useAppNotificationStore.getState().clearNotifications();
  resetManualUpdateNotificationStateForTests();

  for (const state of [
    "checking",
    "not-available",
    "manual-required",
    "failed",
  ]) {
    const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
      state,
      channel: "beta",
      reason: "Background checks should not interrupt the IDE.",
      current: {
        packaged: true,
        updateManifestUrl: "file:///tmp/arlecchino-update-manifest.json",
      },
    });

    assert.equal(
      buildManualUpdateNotification(status, {
        includePassive: true,
        policy: "background",
      }),
      null,
    );
    assert.equal(publishBackgroundAutoUpdateNotification(status), false);
  }

  assert.equal(useAppNotificationStore.getState().notifications.length, 0);

  const availableStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "available",
    channel: "beta",
    targetVersion: "0.2.0",
    reason: "Version 0.2.0 is available.",
  });

  assert.equal(publishBackgroundAutoUpdateNotification(availableStatus), true);
  assert.equal(
    useAppNotificationStore.getState().notifications[0].title,
    "Update available",
  );
});

test("update notification offers download for an available signed update", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "available",
    channel: "beta",
    targetVersion: "0.2.0",
    targetBuild: "42",
    releaseNotes: "ZIP is signed and ready.",
    mandatory: true,
    reason: "Version 0.2.0 is available.",
  });

  const summary = buildManualUpdateNotification(status);

  assert.ok(summary);
  assert.equal(summary.key, "available:beta:0.2.0 build 42");
  assert.equal(summary.kind, "warning");
  assert.equal(summary.sticky, true);
  assert.equal(summary.action, "download");
  assert.equal(summary.tag, "beta");
  assert.match(summary.message, /Version 0\.2\.0 build 42/);
  assert.match(summary.message, /ZIP is signed and ready/);
  assert.match(summary.details, /ZIP is signed and ready/);
});

test("update notification summarizes curated notes and hides raw commit digests", async () => {
  const {
    buildManualUpdateNotification,
    buildReleaseNotesPresentation,
    isRawCommitDigestReleaseNotes,
    normalizeAutoUpdateStatusPayload,
  } = await loadManualUpdateContracts();

  const curatedNotes = `Improved
- Faster update cards while downloading packages.
- Wails updated to v3.0.0-alpha.95.
- Private updater smoke is easier to audit.
- Release artifacts stay outside the repo.
- Extra detail remains available on GitHub.`;
  const rawNotes = `Includes changes since v0.1.3-alpha.103:

4032b7f Add grouped auto-import edits
2629e24 Add autocomplete language resolver
a21fc1d Route autocomplete sources through resolver
654a39e Expose autocomplete language capabilities`;

  assert.equal(isRawCommitDigestReleaseNotes(rawNotes), true);
  assert.deepEqual(buildReleaseNotesPresentation(rawNotes), {
    summary: [],
    rejectedRaw: true,
  });

  const curatedStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "available",
    channel: "beta",
    targetVersion: "0.2.0",
    releaseNotes: curatedNotes,
    reason: "Version 0.2.0 is available.",
  });
  const curatedSummary = buildManualUpdateNotification(curatedStatus);

  assert.ok(curatedSummary);
  assert.match(curatedSummary.message, /Faster update cards/);
  assert.match(curatedSummary.message, /Release artifacts stay outside/);
  assert.doesNotMatch(curatedSummary.message, /Extra detail remains/);
  assert.match(curatedSummary.details, /Extra detail remains/);
  assert.equal(curatedSummary.detailsLabel, "Details");

  const rawStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "available",
    channel: "beta",
    targetVersion: "0.2.0",
    releaseNotes: rawNotes,
    reason: "Version 0.2.0 is available.",
  });
  const rawSummary = buildManualUpdateNotification(rawStatus);

  assert.ok(rawSummary);
  assert.doesNotMatch(rawSummary.message, /4032b7f/);
  assert.doesNotMatch(rawSummary.details ?? "", /4032b7f/);
  assert.match(rawSummary.message, /View release notes on GitHub/);
});

test("update failure notification keeps filesystem diagnostics out of the card body", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "failed",
    channel: "beta",
    targetVersion: "0.2.0",
    reason:
      "staged Arlecchino.app codesign verification failed: /Users/klawdiy/Library/Caches/Arlecchino/updates/staged/candidate/extract/Arlecchino.app: a sealed resource is missing or invalid\nfile added: /Users/klawdiy/Library/Caches/Arlecchino/updates/staged/candidate/extract/Arlecchino.app/Contents/._Info.plist",
  });

  const summary = buildManualUpdateNotification(status, {
    policy: "manual",
  });

  assert.ok(summary);
  assert.equal(summary.kind, "error");
  assert.doesNotMatch(summary.message, /\/Users\/klawdiy/);
  assert.doesNotMatch(summary.message, /sealed resource/);
  assert.match(summary.message, /Settings diagnostics/);
});

test("update notification offers relaunch after staging", async () => {
  const { buildManualUpdateNotification, normalizeAutoUpdateStatusPayload } =
    await loadManualUpdateContracts();

  const status = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "staged",
    channel: "beta",
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
    channel: "beta",
    targetVersion: "0.2.0",
    reason: "Current app bundle is not writable.",
  });

  const summary = buildManualUpdateNotification(status);

  assert.ok(summary);
  assert.equal(summary.kind, "warning");
  assert.equal(summary.action, "manual");
  assert.equal(summary.tag, "beta");
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
    channel: "beta",
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
  assert.equal(secondNotification.tag, "beta");
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

test("download action publishes progress immediately and ignores repeated clicks", async () => {
  const {
    normalizeAutoUpdateStatusPayload,
    resetManualUpdateNotificationStateForTests,
    runAutoUpdateDownloadWithNotification,
    useAppNotificationStore,
  } = await loadManualUpdateContracts();

  useAppNotificationStore.getState().clearNotifications();
  resetManualUpdateNotificationStateForTests();

  let calls = 0;
  let finishDownload;
  const pendingDownload = new Promise((resolve) => {
    finishDownload = resolve;
  });
  const stagedStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "staged",
    channel: "beta",
    targetVersion: "0.2.0",
    progress: 1,
  });

  const firstRun = runAutoUpdateDownloadWithNotification(async () => {
    calls += 1;
    await pendingDownload;
    return stagedStatus;
  });
  const secondRun = runAutoUpdateDownloadWithNotification(async () => {
    calls += 1;
    return stagedStatus;
  });

  assert.equal(calls, 1);
  const progressNotification =
    useAppNotificationStore.getState().notifications[0];
  assert.equal(progressNotification.id, "auto-update");
  assert.equal(progressNotification.title, "Downloading update");
  assert.equal(progressNotification.kind, "progress");
  assert.equal(progressNotification.action, undefined);
  assert.ok(progressNotification.progress > 0);

  finishDownload();
  await firstRun;
  await secondRun;

  const readyNotification = useAppNotificationStore.getState().notifications[0];
  assert.equal(readyNotification.title, "Update ready");
  assert.equal(readyNotification.action?.label, "Install and relaunch");
  assert.equal(calls, 1);
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
      updateManifestUrl: "file:///tmp/arlecchino-beta-update-manifest.json",
    },
  });
  const devStatus = normalizeStatus(normalizeAutoUpdateStatusPayload, {
    state: "idle",
    current: {
      packaged: false,
      updateManifestUrl: "file:///tmp/arlecchino-beta-update-manifest.json",
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
      "github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-beta-update-manifest.json",
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
