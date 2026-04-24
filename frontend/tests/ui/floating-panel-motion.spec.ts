import { expect, test } from "@playwright/test";

const openGitPanel = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "G",
        code: "KeyG",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
};

const installBaseBridges = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (..._args: unknown[]) => {
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
              case "GetGitStatus":
                return "";
              case "GetGitBranch":
                return "feature/bubble-git-panel";
              case "GetGitBranches":
                return ["feature/bubble-git-panel", "main"];
              case "GetGitLog":
                return [];
              case "GetGitDiff":
                return [
                  "diff --git a/frontend/src/components/GitPanel.tsx b/frontend/src/components/GitPanel.tsx",
                  "index 1111111..2222222 100644",
                  "--- a/frontend/src/components/GitPanel.tsx",
                  "+++ b/frontend/src/components/GitPanel.tsx",
                  "@@ -10,3 +10,4 @@",
                  '-const oldTone = "muted";',
                  "+const surfaceRadius = 24;",
                  "+const readableContrast = true;",
                  " export default GitPanel;",
                ].join("\n");
              case "GetGitCommitDiff":
                return "diff --git a/file b/file\n@@ -1 +1 @@\n-old\n+new";
              case "RunGitCommand":
                return "";
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
          if (property === "BrowserOpenURL") {
            return async () => undefined;
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
};

const mountProjectUI = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await installBaseBridges(page);
  await page.goto("/");

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
    const { useEditorStore } = await import("/src/stores/editorStore.ts");

    useWorkspaceStore.setState({
      projects: [
        {
          id: "/workspace",
          path: "/workspace",
          name: "workspace",
          openedAt: 1,
        },
      ],
      activeId: "/workspace",
      activeFramework: null,
      pendingId: null,
      ready: true,
      switchDirection: 1,
      uiBlockers: [],
    });

    useExplorerStore.getState().setProjectPath("/workspace");
    useEditorStore
      .getState()
      .openTab(
        "pane-main",
        "/workspace/index.tsx",
        "index.tsx",
        "export const ready = true;",
        "tsx",
      );
  });

  await expect(page.getByTestId("main-layout")).toBeVisible();
  await expect(page.getByTitle("Search")).toBeVisible({ timeout: 10000 });
};

const nextAnimationFrame = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      }),
  );
};

const readPanelFrame = async (
  page: Parameters<typeof test>[0]["page"],
  selector: string,
): Promise<{
  height: number;
  opacity: string;
  translateX: number;
  translateY: number;
  width: number;
  motion: string;
} | null> => {
  return page.evaluate((panelSelector) => {
    const node = document.querySelector<HTMLElement>(panelSelector);
    if (!node) {
      return null;
    }

    const styles = window.getComputedStyle(node);
    const transform = styles.transform;
    const translate = styles.translate;
    let translateX = 0;
    let translateY = 0;

    if (translate && translate !== "none") {
      const [rawX = "0", rawY = "0"] = translate.split(" ");
      translateX = Number.parseFloat(rawX) || 0;
      translateY = Number.parseFloat(rawY) || 0;
    } else if (transform && transform !== "none") {
      const matrix = new DOMMatrixReadOnly(transform);
      translateX = matrix.m41;
      translateY = matrix.m42;
    }

    const rect = node.getBoundingClientRect();
    return {
      height: rect.height,
      opacity: styles.opacity,
      translateX,
      translateY,
      width: rect.width,
      motion: node.dataset.panelMotion ?? "",
    };
  }, selector);
};

const expectDirectionalSlide = (
  frame: { translateX: number; translateY: number } | null,
  position: string | null,
) => {
  expect(frame).not.toBeNull();

  switch (position) {
    case "left":
      expect(frame?.translateX ?? 0).toBeLessThan(0);
      break;
    case "right":
      expect(frame?.translateX ?? 0).toBeGreaterThan(0);
      break;
    case "top":
      expect(frame?.translateY ?? 0).toBeLessThan(0);
      break;
    case "bottom":
      expect(frame?.translateY ?? 0).toBeGreaterThan(0);
      break;
    default:
      throw new Error(`Unexpected panel position: ${position}`);
  }
};

test("snapped floating panel uses slide-only motion for open and close", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-git"]');

  await openGitPanel(page);
  await expect(panel).toBeAttached();
  const panelPosition = await panel.getAttribute("data-panel-position");
  expect(panelPosition).toBeTruthy();

  const openingFrame = await readPanelFrame(page, '[data-testid="panel-git"]');
  expect(openingFrame).not.toBeNull();
  expect(openingFrame?.motion).toBe("enter");
  expect(openingFrame?.opacity).toBe("1");
  if (panelPosition === "left" || panelPosition === "right") {
    expect(openingFrame?.width ?? 0).toBeGreaterThan(180);
    expect(Math.abs(openingFrame?.translateX ?? 0)).toBeGreaterThan(
      (openingFrame?.width ?? 0) * 0.2,
    );
  } else {
    expect(openingFrame?.height ?? 0).toBeGreaterThan(90);
    expect(Math.abs(openingFrame?.translateY ?? 0)).toBeGreaterThan(
      (openingFrame?.height ?? 0) * 0.2,
    );
  }

  await expect(panel).toBeVisible();
  await expect
    .poll(
      async () =>
        (await readPanelFrame(page, '[data-testid="panel-git"]'))?.motion ?? "",
    )
    .toBe("settled");

  await panel.locator('button[title="Закрыть панель"]').click();
  await nextAnimationFrame(page);

  if (panelPosition === "left" || panelPosition === "right") {
    await expect
      .poll(async () => {
        const frame = await readPanelFrame(page, '[data-testid="panel-git"]');
        if (!frame) {
          return 0;
        }
        return Math.abs(frame.translateX) / frame.width;
      })
      .toBeGreaterThan(0.65);
  } else {
    await expect
      .poll(async () => {
        const frame = await readPanelFrame(page, '[data-testid="panel-git"]');
        if (!frame) {
          return 0;
        }
        return Math.abs(frame.translateY) / frame.height;
      })
      .toBeGreaterThan(0.65);
  }

  const exitFrame = await readPanelFrame(page, '[data-testid="panel-git"]');
  expect(exitFrame).not.toBeNull();
  expect(exitFrame?.motion).toBe("exit");
  expect(exitFrame?.opacity).toBe("1");
  expectDirectionalSlide(exitFrame, panelPosition);

  await expect(page.locator('[data-testid="panel-git"]')).toHaveCount(0);
});

test("fullscreen floating panel closes without a sideways slide under ui scale", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(1.2);
  });

  const panel = page.locator('[data-testid="panel-git"]');
  await openGitPanel(page);
  await expect(panel).toBeVisible();

  await panel.locator('button[title="Полный экран"]').click();
  await expect
    .poll(async () => {
      const frame = await readPanelFrame(page, '[data-testid="panel-git"]');
      return frame ? Math.round(frame.translateX) : null;
    })
    .toBe(0);

  await panel.locator('button[title="Закрыть панель"]').click();
  await nextAnimationFrame(page);

  const exitFrame = await readPanelFrame(page, '[data-testid="panel-git"]');
  if (exitFrame) {
    expect(exitFrame.motion).toBe("exit");
    expect(Math.abs(exitFrame.translateX)).toBeLessThanOrEqual(1);
    expect(Math.abs(exitFrame.translateY)).toBeLessThanOrEqual(1);
  }

  await expect(page.locator('[data-testid="panel-git"]')).toHaveCount(0);
});

test("dragging a snapped panel tracks the pointer and snaps cleanly", async ({
  page,
}) => {
  await mountProjectUI(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]');
  await expect(explorerPanel).toBeVisible();

  const header = explorerPanel.locator("div").filter({
    has: page.locator("span", { hasText: "Explorer" }),
  });
  const startRect = await explorerPanel.boundingBox();
  const headerRect = await header.first().boundingBox();
  expect(startRect).not.toBeNull();
  expect(headerRect).not.toBeNull();

  const grabPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };
  const midPoint = {
    x: grabPoint.x + 280,
    y: grabPoint.y + 40,
  };

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move(midPoint.x, midPoint.y, { steps: 12 });
  await nextAnimationFrame(page);

  const dragRect = await explorerPanel.boundingBox();
  expect(dragRect).not.toBeNull();
  expect(
    Math.abs((dragRect?.x ?? 0) - ((startRect?.x ?? 0) + 280)),
  ).toBeLessThan(28);
  expect(
    Math.abs((dragRect?.y ?? 0) - ((startRect?.y ?? 0) + 40)),
  ).toBeLessThan(28);
  await expect(explorerPanel).toHaveAttribute("data-panel-state", "dragging");

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await page.mouse.move((viewport?.width ?? 0) - 16, 48, { steps: 10 });
  await page.mouse.up();

  const dockedExplorerPanel = page
    .locator('[data-testid="panel-explorer"]')
    .last();
  await expect
    .poll(async () => dockedExplorerPanel.getAttribute("data-panel-position"))
    .toBe("right");
  await expect
    .poll(async () => dockedExplorerPanel.getAttribute("data-panel-state"))
    .toBe("docked");
});
