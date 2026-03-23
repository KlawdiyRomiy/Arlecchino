import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const appBridge = new Proxy(
      {},
      {
        get: () => async () => null,
      },
    );

    const runtimeBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "EventsOnMultiple") {
            return () => "sub-id";
          }
          if (property === "EventsOff") {
            return () => undefined;
          }
          return async () => undefined;
        },
      },
    );

    Object.assign(window, {
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
    });
  });
});

test("terminal find shortcuts are excluded from global search interception", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { shouldBypassGlobalFindShortcuts } =
      await import("/src/utils/terminalFocus.ts");

    const root = document.createElement("div");
    root.className = "xterm";
    const helper = document.createElement("textarea");
    helper.className = "xterm-helper-textarea";
    root.appendChild(helper);
    document.body.appendChild(root);

    const cmdF = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      metaKey: true,
    });
    const f3 = new KeyboardEvent("keydown", {
      key: "F3",
      code: "F3",
    });

    return {
      cmdFBypass: shouldBypassGlobalFindShortcuts(cmdF, helper),
      f3Bypass: shouldBypassGlobalFindShortcuts(f3, helper),
    };
  });

  expect(result.cmdFBypass).toBe(true);
  expect(result.f3Bypass).toBe(true);
});
