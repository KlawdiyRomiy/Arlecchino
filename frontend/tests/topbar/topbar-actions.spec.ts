import { expect, test } from "@playwright/test";

const ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS = 700;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    const nativeWindowControlsVisibleCalls: boolean[] = [];
    const nativeWindowControlsPositionCalls: unknown[][] = [];
    const runtimeEventHandlers = new Map<
      string,
      Set<(payload: unknown) => void>
    >();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () =>
          (window as unknown as { __copiedText?: string }).__copiedText ?? "",
        writeText: async (text: string) => {
          (window as unknown as { __copiedText?: string }).__copiedText = text;
        },
      },
    });

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (...args: unknown[]) => {
            switch (property) {
              case "GetCurrentProjectFramework":
                return null;
              case "GetRecentProjects":
                return [];
              case "GetDevToolsStatus":
                return [];
              case "IsNativeFullscreen":
                return false;
              case "OpenProject":
              case "CreateTerminal":
              case "WriteTerminal":
              case "SendTerminalText":
              case "CloseTerminal":
              case "ResizeTerminal":
                return true;
              case "SetNativeWindowControlsVisible":
                nativeWindowControlsVisibleCalls.push(Boolean(args[0]));
                return true;
              case "PositionNativeWindowControls":
                nativeWindowControlsPositionCalls.push(args);
                return true;
              case "ListFiles":
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
          if (property === "EventsOn" || property === "EventsOnMultiple") {
            return (
              eventName: string,
              callback: (payload: unknown) => void,
            ) => {
              const handlers = runtimeEventHandlers.get(eventName) ?? new Set();
              handlers.add(callback);
              runtimeEventHandlers.set(eventName, handlers);
              return () => handlers.delete(callback);
            };
          }
          if (property === "EventsOff") {
            return (eventName: string, ...additionalEventNames: string[]) => {
              [eventName, ...additionalEventNames].forEach((name) =>
                runtimeEventHandlers.delete(name),
              );
            };
          }
          if (property === "EventsEmit") {
            return (eventName: string, payload?: unknown) => {
              const handlers = runtimeEventHandlers.get(eventName) ?? new Set();
              handlers.forEach((handler) => handler(payload));
            };
          }
          return async () => undefined;
        },
      },
    );

    Object.assign(window, {
      _wails: { environment: { OS: "darwin" } },
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
      __nativeWindowControlsVisibleCalls: nativeWindowControlsVisibleCalls,
      __nativeWindowControlsPositionCalls: nativeWindowControlsPositionCalls,
    });

    localStorage.setItem(
      "workspace-storage",
      JSON.stringify({
        state: {
          projects: [
            {
              id: "/workspace",
              path: "/workspace",
              name: "workspace",
              openedAt: 1,
            },
          ],
          activeId: "/workspace",
          switchDirection: 1,
        },
        version: 0,
      }),
    );
  });

  await page.goto("/");
});

async function mountProjectUI(
  page: Parameters<typeof test>[0]["page"],
  activePath = "/workspace/index.html",
  projectPath = "/workspace",
) {
  await page.evaluate(
    async ({ projectPath, filePath }) => {
      const { useWorkspaceStore } =
        await import("/src/stores/workspaceStore.ts");
      const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
      const { useEditorStore } = await import("/src/stores/editorStore.ts");

      useWorkspaceStore.setState({
        projects: [
          {
            id: projectPath,
            path: projectPath,
            name: "workspace",
            openedAt: 1,
          },
        ],
        activeId: projectPath,
        activeFramework: null,
        pendingId: null,
        ready: true,
        switchDirection: 1,
        uiBlockers: [],
      });

      useExplorerStore.getState().setProjectPath(projectPath);
      useEditorStore
        .getState()
        .openTab(
          "pane-main",
          filePath,
          filePath.split("/").pop() || "index.html",
          "<html><body>Preview shortcut</body></html>",
          "html",
        );
    },
    { projectPath, filePath: activePath },
  );

  await expect(page.getByTitle("Search").first()).toBeVisible();
}

async function enterZenMode(page: Parameters<typeof test>[0]["page"]) {
  await page.evaluate(() => {
    const eventInit = {
      key: ".",
      code: "Period",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });

  await expect(page.getByTestId("main-layout")).toHaveAttribute(
    "data-zen-mode",
    "true",
  );
}

async function revealZenTopbar(page: Parameters<typeof test>[0]["page"]) {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, 1);
  await expect(page.getByTestId("main-layout")).toHaveAttribute(
    "data-zen-topbar-visible",
    "true",
  );
}

async function readWindowDragStyles(
  page: Parameters<typeof test>[0]["page"],
  selector: string,
) {
  return page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) {
      return { webkitAppRegion: "", wailsDraggable: "" };
    }
    const styles = getComputedStyle(element);
    return {
      webkitAppRegion: styles.getPropertyValue("-webkit-app-region").trim(),
      wailsDraggable: styles.getPropertyValue("--wails-draggable").trim(),
    };
  }, selector);
}

test("search button opens command dispatcher", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("Search").click();

  await expect(page.locator('input[placeholder="Search..."]')).toBeVisible();
  await expect(
    page.locator('input[placeholder="Search commands, files..."]'),
  ).toHaveCount(0);
});

test("smart quote activates grep mode in command dispatcher", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTitle("Search").click();
  await page.locator('input[placeholder="Search..."]').fill("«needle");

  await expect(
    page.locator(".shell-pill").filter({ hasText: "Grep" }),
  ).toBeVisible();
});

test("Cmd+Shift+F opens command dispatcher", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+F");

  await expect(page.locator('input[placeholder="Search..."]')).toBeVisible();
  await expect(
    page.locator('input[placeholder="Search commands, files..."]'),
  ).toHaveCount(0);
});

test("Cmd+Shift+F does not open command dispatcher when terminal search is focused", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    const input = document.createElement("input");
    input.setAttribute("data-terminal-search-input", "true");
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(page.locator('input[placeholder="Search..."]')).toHaveCount(0);
});

test("settings button opens settings modal", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("Settings").click();

  await expect(page.getByTestId("settings-modal")).toBeVisible();
});

async function setCompactTopbarActions(
  page: Parameters<typeof test>[0]["page"],
) {
  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setShowTopbarProjectPath(false);
  });
}

test("default topbar keeps panel and update actions in the More menu", async ({
  page,
}) => {
  await mountProjectUI(page);

  await expect(page.getByTestId("topbar-action-bubble")).toBeVisible();
  await expect(page.getByTestId("topbar-sync-dependencies-button")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("topbar-ai-chat-button")).toHaveCount(0);
  await expect(page.getByTitle("More")).toBeVisible();

  await page.getByTitle("More").click();

  await expect(page.getByRole("menuitem", { name: /AI Chat/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Terminal/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Git/ })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Sync dependencies/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Check for Updates/ }),
  ).toBeVisible();
});

test("compact topbar promotes dropdown actions and hides project label", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  await expect(page.getByTestId("topbar-project-path")).toHaveCount(0);
  await expect(page.getByTestId("topbar-ai-chat-button")).toBeVisible();
  await expect(page.getByTestId("topbar-terminal-button")).toBeVisible();
  await expect(page.getByTestId("topbar-git-button")).toBeVisible();
  await expect(
    page.getByTestId("topbar-sync-dependencies-button"),
  ).toBeVisible();
  await expect(page.getByTestId("topbar-check-updates-button")).toBeVisible();
  await expect(page.getByTitle("More")).toHaveCount(0);
});

test("promoted panel buttons toggle panels and active indicators", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  const aiChatButton = page.getByTestId("topbar-ai-chat-button");
  const terminalButton = page.getByTestId("topbar-terminal-button");
  const gitButton = page.getByTestId("topbar-git-button");

  await aiChatButton.click();
  await expect(page.getByTestId("panel-aiChat")).toBeVisible();
  await expect(aiChatButton).toHaveAttribute("aria-pressed", "true");

  await terminalButton.click();
  await expect(page.getByTestId("panel-terminal")).toBeVisible();
  await expect(terminalButton).toHaveAttribute("aria-pressed", "true");

  await gitButton.click();
  await expect(page.getByTestId("panel-git")).toBeVisible();
  await expect(gitButton).toHaveAttribute("aria-pressed", "true");
});

test("compact topbar setting hides the whole project label", async ({
  page,
}) => {
  await mountProjectUI(
    page,
    "/Users/klawdiy/workspace/index.html",
    "/Users/klawdiy/workspace",
  );

  const projectPathStrip = page.getByTestId("topbar-project-path").first();

  await expect(projectPathStrip).toContainText("/Users/klawdiy/");

  await setCompactTopbarActions(page);

  await expect(page.getByTestId("topbar-project-parent-path")).toHaveCount(0);
  await expect(page.getByTestId("topbar-project-path")).toHaveCount(0);
});

test("indexing state remains visible in the compact topbar context bubble", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("indexer:started", {
      current: 0,
      total: 10,
    });
  });

  await expect(page.getByTestId("topbar-indexing-status")).toBeVisible();
  await expect(page.getByTestId("topbar-indexing-status")).toContainText(
    "Indexing",
  );
  await expect(page.getByTestId("topbar-indexing-progress")).toBeVisible();
  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("indexer:progress", {
      current: 4,
      total: 10,
    });
  });
  await expect(page.getByTestId("topbar-indexing-progress")).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await expect(page.getByTestId("topbar-project-path")).toHaveCount(0);
});

test("Cmd+Shift+. toggles zen chrome and edge hover reveals it", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    const eventInit = {
      key: ".",
      code: "Period",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });

  const layout = page.getByTestId("main-layout");
  await expect(layout).toHaveAttribute("data-zen-mode", "true");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect(layout).toHaveAttribute("data-zen-statusbar-visible", "false");
  await expect
    .poll(() => readWindowDragStyles(page, '[data-testid="topbar"]'))
    .toEqual({
      webkitAppRegion: "no-drag",
      wailsDraggable: "no-drag",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(false);

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, 1);
  await page.waitForTimeout(ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS - 250);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");
  await expect
    .poll(() => readWindowDragStyles(page, '[data-testid="topbar"]'))
    .toEqual({
      webkitAppRegion: "drag",
      wailsDraggable: "drag",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(true);
  await page.mouse.move(520, 320);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect
    .poll(() => readWindowDragStyles(page, '[data-testid="topbar"]'))
    .toEqual({
      webkitAppRegion: "no-drag",
      wailsDraggable: "no-drag",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(false);

  await page.mouse.move(viewport.width - 1, viewport.height - 1);
  await page.waitForTimeout(ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS - 250);
  await expect(layout).toHaveAttribute("data-zen-statusbar-visible", "false");
  await expect(layout).toHaveAttribute("data-zen-statusbar-visible", "true");
  await page.mouse.move(520, 320);
  await expect(layout).toHaveAttribute("data-zen-statusbar-visible", "false");
});

test("native fullscreen hides macOS window controls backdrop", async ({
  page,
}) => {
  await mountProjectUI(page);

  await expect(
    page.getByTestId("window-controls-native-backdrop"),
  ).toBeVisible();

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("shell:native-fullscreen-changed", {
      fullscreen: true,
    });
  });

  await expect(page.getByTestId("window-controls-native-backdrop")).toHaveCount(
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(false);

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("shell:native-fullscreen-changed", {
      fullscreen: false,
    });
  });

  await expect(
    page.getByTestId("window-controls-native-backdrop"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(true);
});

test("native window controls wait for project switch transition to settle", async ({
  page,
}) => {
  await mountProjectUI(page);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __nativeWindowControlsPositionCalls: unknown[][];
            }
          ).__nativeWindowControlsPositionCalls.length,
      ),
    )
    .toBeGreaterThan(0);

  await page.evaluate(async () => {
    (
      window as unknown as {
        __nativeWindowControlsPositionCalls: unknown[][];
      }
    ).__nativeWindowControlsPositionCalls.length = 0;

    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    useWorkspaceStore.setState({
      projects: [
        {
          id: "/workspace",
          path: "/workspace",
          name: "workspace",
          openedAt: 1,
        },
        { id: "/other", path: "/other", name: "other", openedAt: 2 },
      ],
      activeId: "/other",
      pendingId: "/other",
      switchSourceId: "/workspace",
      switchDirection: 1,
      ready: true,
      uiBlockers: [],
    });
  });

  await page.waitForTimeout(120);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __nativeWindowControlsPositionCalls: unknown[][];
          }
        ).__nativeWindowControlsPositionCalls.length,
    ),
  ).toBe(0);

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    useWorkspaceStore.setState({
      pendingId: null,
      switchSourceId: null,
    });
  });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __nativeWindowControlsPositionCalls: unknown[][];
            }
          ).__nativeWindowControlsPositionCalls.length,
      ),
    )
    .toBeGreaterThan(0);
});

test("native fullscreen exit does not restore backdrop while Zen topbar is hidden", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    const runtime = (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime;

    runtime.EventsEmit("shell:native-fullscreen-changed", {
      fullscreen: true,
    });
  });

  await expect(page.getByTestId("window-controls-native-backdrop")).toHaveCount(
    0,
  );

  await page.evaluate(() => {
    const eventInit = {
      key: ".",
      code: "Period",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });

  const layout = page.getByTestId("main-layout");
  await expect(layout).toHaveAttribute("data-zen-mode", "true");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("shell:native-fullscreen-changed", {
      fullscreen: false,
    });
  });

  await expect(page.getByTestId("window-controls-native-backdrop")).toHaveCount(
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(false);
});

test("zen topbar reveal avoids editor split and markdown preview controls before opening", async ({
  page,
}) => {
  await mountProjectUI(page, "/workspace/AGENT_CONTEXT.md");
  await enterZenMode(page);

  const layout = page.getByTestId("main-layout");
  const splitControls = page.getByTestId("editor-tabs-split-controls");
  const markdownToggle = page.getByTestId(
    "editor-tabs-markdown-preview-toggle",
  );
  await expect(splitControls).toBeVisible();
  await expect(markdownToggle).toBeVisible();
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  const splitBox = await splitControls.boundingBox();
  expect(splitBox).not.toBeNull();
  await page.mouse.move(
    (splitBox?.x ?? 0) + (splitBox?.width ?? 0) / 2,
    (splitBox?.y ?? 0) + (splitBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  await splitControls.locator('button[title^="Split Right"]').click();
  await expect(page.getByTitle("Close split")).toBeVisible();
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  const markdownBox = await markdownToggle.boundingBox();
  expect(markdownBox).not.toBeNull();
  await page.mouse.move(
    (markdownBox?.x ?? 0) + (markdownBox?.width ?? 0) / 2,
    (markdownBox?.y ?? 0) + (markdownBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  await markdownToggle.click();
  await expect(markdownToggle).toHaveAttribute("aria-pressed", "true");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, 1);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.mouse.move(
    (splitBox?.x ?? 0) + (splitBox?.width ?? 0) / 2,
    (splitBox?.y ?? 0) + (splitBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.mouse.move(
    (markdownBox?.x ?? 0) + (markdownBox?.width ?? 0) / 2,
    (markdownBox?.y ?? 0) + (markdownBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");
});

test("zen topbar stays visible while the more menu popup is open", async ({
  page,
}) => {
  await mountProjectUI(page);
  await enterZenMode(page);

  const layout = page.getByTestId("main-layout");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await revealZenTopbar(page);

  await page.getByTitle("More").click();
  const menuItem = page.getByRole("menuitem", { name: /AI Chat/ });
  await expect(menuItem).toBeVisible();

  const menuBox = await menuItem.boundingBox();
  expect(menuBox).not.toBeNull();
  await page.mouse.move(
    (menuBox?.x ?? 0) + (menuBox?.width ?? 0) / 2,
    (menuBox?.y ?? 0) + (menuBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.mouse.move(520, 320);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.keyboard.press("Escape");
  await expect(menuItem).toHaveCount(0);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
});

test("zen topbar stays visible while the add project popup is open", async ({
  page,
}) => {
  await mountProjectUI(page);
  await enterZenMode(page);

  const layout = page.getByTestId("main-layout");
  await revealZenTopbar(page);

  await page.getByTitle("Add project").click();
  const menuItem = page.getByRole("menuitem", { name: /Open Project/ });
  await expect(menuItem).toBeVisible();

  const menuBox = await menuItem.boundingBox();
  expect(menuBox).not.toBeNull();
  await page.mouse.move(
    (menuBox?.x ?? 0) + (menuBox?.width ?? 0) / 2,
    (menuBox?.y ?? 0) + (menuBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.mouse.move(520, 320);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.keyboard.press("Escape");
  await expect(menuItem).toHaveCount(0);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
});

test("topbar more menu closes on Escape and omits removed actions", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTitle("More").click();

  await expect(page.getByRole("menuitem", { name: /AI Chat/ })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Command Palette/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: /About Arlecchino/ }),
  ).toHaveCount(0);

  await page.keyboard.press("Escape");

  await expect(page.getByRole("menuitem", { name: /AI Chat/ })).toHaveCount(0);
});

test("sync dependencies modal closes on Escape", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: /Sync dependencies/i }).click();

  await expect(page.getByTestId("dependency-policy-modal")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.shellModalOpen ?? ""))
    .toBe("true");

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("dependency-policy-modal")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.shellModalOpen ?? ""))
    .toBe("");
});

test("add project menu closes on Escape", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("Add project").click();

  await expect(
    page.getByRole("menuitem", { name: /Open Project/ }),
  ).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(
    page.getByRole("menuitem", { name: /Open Project/ }),
  ).toHaveCount(0);
});

test("preview shortcut uses latest active tab context", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+B");
  await page.waitForTimeout(100);

  const previewPayload = await page.evaluate(async () => {
    const { usePreviewWindowStore } =
      await import("/src/stores/previewWindowStore.ts");

    const windowState = usePreviewWindowStore.getState().windows[0];
    return windowState
      ? {
          title: windowState.title,
          url: windowState.payload.url ?? null,
          htmlContent: windowState.payload.htmlContent ?? null,
          sourceLabel: windowState.payload.sourceLabel ?? null,
        }
      : null;
  });

  expect(previewPayload).not.toBeNull();
  expect(previewPayload?.sourceLabel).toBe("index.html");
  expect(previewPayload?.htmlContent).toContain("Preview shortcut");
  expect(previewPayload?.url).toBe("");
});

test("preview shortcut closes an existing browser preview", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("panel-preview-browser-default")).toBeVisible();

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("panel-preview-browser-default")).toHaveCount(
    0,
  );
});

test("panel shortcuts open compact panels", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+E");
  await expect(page.getByTestId("panel-explorer")).toBeVisible();

  await page.keyboard.press("Meta+G");
  await expect(page.getByTestId("panel-git")).toBeVisible();

  await page.keyboard.press("Meta+I");
  await expect(page.getByTestId("panel-problems")).toBeVisible();

  await page.keyboard.press("Meta+J");
  await expect(page.getByTestId("panel-terminal")).toBeVisible();
});

test("fullscreen panel shortcuts use expanded panel frames", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+G");
  const gitFrame = await page.getByTestId("panel-git").boundingBox();
  expect(gitFrame?.width ?? 0).toBeGreaterThan(900);
  expect(gitFrame?.height ?? 0).toBeGreaterThan(500);

  await page.keyboard.press("Meta+Shift+G");
  await expect(page.getByTestId("panel-git")).toBeHidden();

  await page.keyboard.press("Meta+Shift+G");
  await expect(page.getByTestId("panel-git")).toBeVisible();

  await page.keyboard.press("Meta+G");
  const compactGitFrame = await page.getByTestId("panel-git").boundingBox();
  expect(compactGitFrame?.width ?? 0).toBeLessThan(gitFrame?.width ?? 0);

  await page.keyboard.press("Meta+Shift+I");
  const problemsFrame = await page.getByTestId("panel-problems").boundingBox();
  expect(problemsFrame?.width ?? 0).toBeGreaterThan(900);
  expect(problemsFrame?.height ?? 0).toBeGreaterThan(500);

  await page.keyboard.press("Meta+Shift+I");
  await expect(page.getByTestId("panel-problems")).toBeHidden();
});

test("Option+W closes fullscreen Git, Problems, and Terminal panels", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+G");
  await expect(page.getByTestId("panel-git")).toBeVisible();
  await page.keyboard.press("Alt+W");
  await expect(page.getByTestId("panel-git")).toBeHidden();

  await page.keyboard.press("Meta+Shift+I");
  await expect(page.getByTestId("panel-problems")).toBeVisible();
  await page.keyboard.press("Alt+W");
  await expect(page.getByTestId("panel-problems")).toBeHidden();

  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: /Terminal/ }).click();
  const terminalPanel = page.getByTestId("panel-terminal");
  await expect(terminalPanel).toBeVisible();
  await terminalPanel.locator('button[title="Полный экран"]').click();
  const terminalFrame = await terminalPanel.boundingBox();
  expect(terminalFrame?.width ?? 0).toBeGreaterThan(900);

  await page.keyboard.press("Alt+W");
  await expect(terminalPanel).toBeHidden();
});

test("Cmd+Shift+C copies project path with topbar confirmation", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+C");

  const confirmation = page.getByTestId("project-path-copy-confirmation");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("Project path copied");
  await expect(confirmation).not.toContainText("cmd+shift+c");

  const confirmationBox = await confirmation.boundingBox();
  const topbarBox = await page.getByTestId("topbar").boundingBox();
  const projectPathBox = await page
    .getByTestId("topbar-project-path")
    .boundingBox();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const confirmationCenter =
    (confirmationBox?.x ?? 0) + (confirmationBox?.width ?? 0) / 2;

  expect(confirmationBox?.height ?? 0).toBeGreaterThan(28);
  expect(Math.abs(confirmationCenter - viewportWidth / 2)).toBeLessThan(24);
  expect(confirmationBox?.y ?? 0).toBeGreaterThan(
    (topbarBox?.y ?? 0) + (topbarBox?.height ?? 0),
  );
  expect(confirmationBox?.y ?? 0).toBeGreaterThan(
    (projectPathBox?.y ?? 0) + (projectPathBox?.height ?? 0),
  );

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __copiedText?: string }).__copiedText,
      ),
    )
    .toBe("/workspace");
});

test("Cmd+Shift+C does not copy project path from terminal focus", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.className = "xterm-helper-textarea";
    document.body.appendChild(input);
    input.focus();
  });

  await page.keyboard.press("Meta+Shift+C");

  await expect(page.getByTestId("project-path-copy-confirmation")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __copiedText?: string }).__copiedText,
    ),
  ).toBeUndefined();
});
