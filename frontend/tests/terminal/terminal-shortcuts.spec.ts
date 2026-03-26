import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async () => {
            switch (property) {
              case "GetRecentProjects":
              case "GetDevToolsStatus":
                return [];
              default:
                return null;
            }
          };
        },
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

  await page.goto("/");
});

test("terminal shortcuts recognize Ctrl+F and terminal search input bypasses global search", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { shortcuts } = await import("/src/utils/keyboard.ts");
    const { shouldBypassGlobalFindShortcuts } =
      await import("/src/utils/terminalFocus.ts");

    const ctrlFindEvent = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    const terminalSearchInput = document.createElement("input");
    terminalSearchInput.setAttribute("data-terminal-search-input", "true");
    document.body.appendChild(terminalSearchInput);

    const metaFindEvent = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    return {
      ctrlFindRecognized: shortcuts.terminalFind(ctrlFindEvent),
      terminalSearchBypassesGlobal: shouldBypassGlobalFindShortcuts(
        metaFindEvent,
        terminalSearchInput,
      ),
    };
  });

  expect(result.ctrlFindRecognized).toBe(true);
  expect(result.terminalSearchBypassesGlobal).toBe(true);
});
