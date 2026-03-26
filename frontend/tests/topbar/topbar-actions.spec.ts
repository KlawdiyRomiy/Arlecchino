import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();

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

test("preview shortcut uses latest active tab context", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+B");
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
