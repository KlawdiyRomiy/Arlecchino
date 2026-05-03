import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");

async function loadNotificationStore() {
  const result = await build({
    stdin: {
      contents: `
        export {
          useAppNotificationStore,
        } from "./src/stores/appNotificationStore.ts";
      `,
      loader: "ts",
      resolveDir: frontendRoot,
      sourcefile: "app-notification-store-entry.ts",
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

test("app notification store adds, updates, and dismisses notifications", async () => {
  const { useAppNotificationStore } = await loadNotificationStore();
  const store = useAppNotificationStore.getState();
  store.clearNotifications();

  const id = store.addNotification({
    kind: "progress",
    title: "Checking for updates",
    message: "alpha channel",
    details: "Full release notes",
    detailsLabel: "Details",
    tag: "alpha",
    progress: 1.4,
  });

  let notifications = useAppNotificationStore.getState().notifications;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, id);
  assert.equal(notifications[0].tag, "alpha");
  assert.equal(notifications[0].details, "Full release notes");
  assert.equal(notifications[0].detailsLabel, "Details");
  assert.equal(notifications[0].sticky, true);
  assert.equal(notifications[0].progress, 1);

  useAppNotificationStore.getState().updateNotification(id, {
    kind: "success",
    title: "Update ready",
    progress: undefined,
    sticky: false,
    timeoutMs: 1200,
  });

  notifications = useAppNotificationStore.getState().notifications;
  assert.equal(notifications[0].kind, "success");
  assert.equal(notifications[0].sticky, false);
  assert.equal(notifications[0].timeoutMs, 1200);
  assert.equal(notifications[0].revision, 1);

  useAppNotificationStore.getState().dismissNotification(id);
  assert.equal(useAppNotificationStore.getState().notifications.length, 0);
});

test("app notification store refreshes same-id notifications without duplicating them", async () => {
  const { useAppNotificationStore } = await loadNotificationStore();
  const store = useAppNotificationStore.getState();
  store.clearNotifications();

  store.addNotification({
    id: "auto-update",
    kind: "progress",
    title: "Checking for Updates",
    tag: "alpha",
  });
  store.addNotification({
    id: "auto-update",
    kind: "warning",
    title: "Manual update required",
    tag: "alpha",
  });

  const notifications = useAppNotificationStore.getState().notifications;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, "auto-update");
  assert.equal(notifications[0].title, "Manual update required");
  assert.equal(notifications[0].tag, "alpha");
  assert.equal(notifications[0].revision, 1);
});

test("app notification store keeps a bounded newest-first queue", async () => {
  const { useAppNotificationStore } = await loadNotificationStore();
  const store = useAppNotificationStore.getState();
  store.clearNotifications();

  for (let index = 0; index < 10; index += 1) {
    store.addNotification({
      id: `notice-${index}`,
      kind: "info",
      title: `Notice ${index}`,
    });
  }

  const notifications = useAppNotificationStore.getState().notifications;
  assert.equal(notifications.length, 8);
  assert.equal(notifications[0].id, "notice-9");
  assert.equal(notifications[7].id, "notice-2");
});
