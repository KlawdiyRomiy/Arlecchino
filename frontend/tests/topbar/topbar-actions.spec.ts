import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
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
              case "OpenProject":
              case "CreateTerminal":
              case "WriteTerminal":
              case "SendTerminalText":
              case "CloseTerminal":
              case "ResizeTerminal":
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
            return () => () => undefined;
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
    { projectPath: "/workspace", filePath: activePath },
  );

  await expect(page.getByTitle("Search")).toBeVisible();
}

test("search button opens command dispatcher", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("Search").click();

  await expect(page.locator('input[placeholder="Search..."]')).toBeVisible();
  await expect(
    page.locator('input[placeholder="Search commands, files..."]'),
  ).toHaveCount(0);
});

test("Cmd+F opens command dispatcher", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+F");

  await expect(page.locator('input[placeholder="Search..."]')).toBeVisible();
  await expect(
    page.locator('input[placeholder="Search commands, files..."]'),
  ).toHaveCount(0);
});

test("Cmd+F does not open command dispatcher when terminal search is focused", async ({
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
