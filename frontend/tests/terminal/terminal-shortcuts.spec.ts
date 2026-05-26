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

test("terminal tab shortcuts on macOS require cmd modifiers", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });

    const { shortcuts } = await import("/src/utils/keyboard.ts");

    const cmdNewTabEvent = new KeyboardEvent("keydown", {
      key: "t",
      code: "KeyT",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const ctrlNewTabEvent = new KeyboardEvent("keydown", {
      key: "t",
      code: "KeyT",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const cmdReopenEvent = new KeyboardEvent("keydown", {
      key: "T",
      code: "KeyT",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const ctrlReopenEvent = new KeyboardEvent("keydown", {
      key: "T",
      code: "KeyT",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    return {
      cmdNewTab: shortcuts.terminalNewTab(cmdNewTabEvent),
      ctrlNewTab: shortcuts.terminalNewTab(ctrlNewTabEvent),
      cmdReopen: shortcuts.terminalReopenTab(cmdReopenEvent),
      ctrlReopen: shortcuts.terminalReopenTab(ctrlReopenEvent),
    };
  });

  expect(result.cmdNewTab).toBe(true);
  expect(result.ctrlNewTab).toBe(false);
  expect(result.cmdReopen).toBe(true);
  expect(result.ctrlReopen).toBe(false);
});

test("terminal and global copy shortcuts can share Cmd+Shift+C in separate scopes", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { shortcuts } = await import("/src/utils/keyboard.ts");

    const copyEvent = new KeyboardEvent("keydown", {
      key: "C",
      code: "KeyC",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    return {
      terminalCopy: shortcuts.terminalCopy(copyEvent),
      projectPathCopy: shortcuts.copyProjectPath(copyEvent),
    };
  });

  expect(result.terminalCopy).toBe(true);
  expect(result.projectPathCopy).toBe(true);
});

test("shortcut matching is exact for compact and fullscreen panel shortcuts", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { shortcuts } = await import("/src/utils/keyboard.ts");

    const gitFullscreenEvent = new KeyboardEvent("keydown", {
      key: "G",
      code: "KeyG",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const gitCompactEvent = new KeyboardEvent("keydown", {
      key: "g",
      code: "KeyG",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const terminalToggleEvent = new KeyboardEvent("keydown", {
      key: "j",
      code: "KeyJ",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const oldTerminalToggleEvent = new KeyboardEvent("keydown", {
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const problemsCompactEvent = new KeyboardEvent("keydown", {
      key: "i",
      code: "KeyI",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const problemsFullscreenEvent = new KeyboardEvent("keydown", {
      key: "I",
      code: "KeyI",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const aiHistoryEvent = new KeyboardEvent("keydown", {
      key: "d",
      code: "KeyD",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    return {
      fullscreenMatchesFullscreen:
        shortcuts.toggleGitFullscreen(gitFullscreenEvent),
      fullscreenMatchesCompact: shortcuts.toggleGit(gitFullscreenEvent),
      compactMatchesCompact: shortcuts.toggleGit(gitCompactEvent),
      compactMatchesFullscreen: shortcuts.toggleGitFullscreen(gitCompactEvent),
      terminalMatchesNewShortcut: shortcuts.toggleTerminal(terminalToggleEvent),
      terminalIgnoresOldShortcut: shortcuts.toggleTerminal(
        oldTerminalToggleEvent,
      ),
      problemsCompactMatchesCompact:
        shortcuts.toggleProblems(problemsCompactEvent),
      problemsCompactMatchesFullscreen:
        shortcuts.toggleProblemsFullscreen(problemsCompactEvent),
      problemsFullscreenMatchesFullscreen: shortcuts.toggleProblemsFullscreen(
        problemsFullscreenEvent,
      ),
      problemsFullscreenMatchesCompact: shortcuts.toggleProblems(
        problemsFullscreenEvent,
      ),
      aiHistoryMatchesHistory: shortcuts.toggleAIHistory(aiHistoryEvent),
      aiHistoryMatchesTerminal: shortcuts.toggleTerminal(aiHistoryEvent),
    };
  });

  expect(result.fullscreenMatchesFullscreen).toBe(true);
  expect(result.fullscreenMatchesCompact).toBe(false);
  expect(result.compactMatchesCompact).toBe(true);
  expect(result.compactMatchesFullscreen).toBe(false);
  expect(result.terminalMatchesNewShortcut).toBe(true);
  expect(result.terminalIgnoresOldShortcut).toBe(false);
  expect(result.problemsCompactMatchesCompact).toBe(true);
  expect(result.problemsCompactMatchesFullscreen).toBe(false);
  expect(result.problemsFullscreenMatchesFullscreen).toBe(true);
  expect(result.problemsFullscreenMatchesCompact).toBe(false);
  expect(result.aiHistoryMatchesHistory).toBe(true);
  expect(result.aiHistoryMatchesTerminal).toBe(false);
});

test("application menu payload exposes updated panel shortcuts", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { getApplicationMenuShortcutPayload } =
      await import("/src/utils/applicationMenu.ts");

    const payload = getApplicationMenuShortcutPayload({});
    const byAction = Object.fromEntries(
      payload.map((item) => [item.actionId, item.shortcuts]),
    );

    return {
      terminal: byAction["terminal.toggle"],
      browserPreview: byAction["browser.preview"],
      problems: byAction["problems.toggle"],
      problemsFullscreen: byAction["problems.fullscreen"],
      aiHistory: byAction["ai.history"],
    };
  });

  expect(result.terminal).toEqual(["cmd+j"]);
  expect(result.browserPreview).toEqual(["cmd+b"]);
  expect(result.problems).toEqual(["cmd+i"]);
  expect(result.problemsFullscreen).toEqual(["cmd+shift+i"]);
  expect(result.aiHistory).toEqual(["cmd+d"]);
});

test("Fn+F is recognized as the window fullscreen shortcut", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { shortcuts, formatShortcut, getEffectiveShortcuts } =
      await import("/src/utils/keyboard.ts");

    const fnFullscreenEvent = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(fnFullscreenEvent, "getModifierState", {
      value: (key: string) => key === "Fn",
    });

    const plainFullscreenEvent = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      bubbles: true,
      cancelable: true,
    });

    const shortcut = getEffectiveShortcuts("window.toggleFullscreen")[0];

    return {
      fnFullscreen: shortcuts.toggleWindowFullscreen(fnFullscreenEvent),
      plainFullscreen: shortcuts.toggleWindowFullscreen(plainFullscreenEvent),
      formatted: formatShortcut(shortcut),
    };
  });

  expect(result.fnFullscreen).toBe(true);
  expect(result.plainFullscreen).toBe(false);
  expect(result.formatted).toBe("fn+f");
});
