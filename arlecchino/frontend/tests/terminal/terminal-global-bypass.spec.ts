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

test("global find shortcuts bypass when focus is inside xterm", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { shouldBypassGlobalFindShortcuts } =
      await import("/src/utils/terminalFocus.ts");

    const terminalRoot = document.createElement("div");
    terminalRoot.className = "xterm";
    const helperTextarea = document.createElement("textarea");
    helperTextarea.className = "xterm-helper-textarea";
    terminalRoot.appendChild(helperTextarea);
    document.body.appendChild(terminalRoot);

    const foreignInput = document.createElement("input");
    document.body.appendChild(foreignInput);

    const cmdF = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      metaKey: true,
    });
    const cmdG = new KeyboardEvent("keydown", {
      key: "g",
      code: "KeyG",
      metaKey: true,
    });
    const cmdShiftG = new KeyboardEvent("keydown", {
      key: "g",
      code: "KeyG",
      metaKey: true,
      shiftKey: true,
    });
    const cmdK = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: true,
    });

    return {
      bypassCmdFInTerminal: shouldBypassGlobalFindShortcuts(
        cmdF,
        helperTextarea,
      ),
      bypassCmdGInTerminal: shouldBypassGlobalFindShortcuts(
        cmdG,
        helperTextarea,
      ),
      bypassCmdShiftGInTerminal: shouldBypassGlobalFindShortcuts(
        cmdShiftG,
        helperTextarea,
      ),
      bypassCmdFOutsideTerminal: shouldBypassGlobalFindShortcuts(
        cmdF,
        foreignInput,
      ),
      bypassCmdKInTerminal: shouldBypassGlobalFindShortcuts(
        cmdK,
        helperTextarea,
      ),
    };
  });

  expect(result.bypassCmdFInTerminal).toBe(true);
  expect(result.bypassCmdGInTerminal).toBe(true);
  expect(result.bypassCmdShiftGInTerminal).toBe(true);
  expect(result.bypassCmdFOutsideTerminal).toBe(false);
  expect(result.bypassCmdKInTerminal).toBe(false);
});
