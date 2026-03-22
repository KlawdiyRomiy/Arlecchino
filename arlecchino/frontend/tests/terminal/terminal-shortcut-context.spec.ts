import { expect, test } from "@playwright/test";

test("terminal shortcut context follows actual terminal focus", async ({
  page,
}) => {
  await page.goto("/");

  const checks = await page.evaluate(async () => {
    const mod = await import("/src/utils/terminalFocus.ts");
    const resolver = mod as unknown as {
      isTerminalShortcutContext?: (input: {
        activeElement: Element | null;
        tuiModeActive: boolean;
        terminalPanelVisible: boolean;
      }) => boolean;
    };

    const fn = resolver.isTerminalShortcutContext;
    const terminalRoot = document.createElement("div");
    terminalRoot.className = "xterm";

    const terminalTextarea = document.createElement("textarea");
    terminalTextarea.className = "xterm-helper-textarea";

    const ideElement = document.createElement("div");

    return {
      hasResolver: typeof fn === "function",
      fromTerminalRoot: fn?.({
        activeElement: terminalRoot,
        tuiModeActive: false,
        terminalPanelVisible: false,
      }),
      fromTerminalTextarea: fn?.({
        activeElement: terminalTextarea,
        tuiModeActive: false,
        terminalPanelVisible: false,
      }),
      fromIDEElement: fn?.({
        activeElement: ideElement,
        tuiModeActive: false,
        terminalPanelVisible: false,
      }),
      fromPanelVisible: fn?.({
        activeElement: null,
        tuiModeActive: false,
        terminalPanelVisible: true,
      }),
      fromTUI: fn?.({
        activeElement: null,
        tuiModeActive: true,
        terminalPanelVisible: false,
      }),
      fromNone: fn?.({
        activeElement: null,
        tuiModeActive: false,
        terminalPanelVisible: false,
      }),
    };
  });

  expect(checks.hasResolver).toBe(true);
  expect(checks.fromTerminalRoot).toBe(true);
  expect(checks.fromTerminalTextarea).toBe(true);
  expect(checks.fromIDEElement).toBe(false);
  expect(checks.fromPanelVisible).toBe(false);
  expect(checks.fromTUI).toBe(true);
  expect(checks.fromNone).toBe(false);
});
