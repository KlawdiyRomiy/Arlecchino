import { expect, test } from "@playwright/test";

type GitPanelFixture = {
  missing: boolean;
  statusV2: string;
  statusV1: string;
  branch: string;
  branches: string[];
  remoteOutput: string;
};

declare global {
  interface Window {
    __gitPanelFixture?: GitPanelFixture;
  }
}

const openGitPanel = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "g",
        code: "KeyG",
        metaKey: true,
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

    const defaultGitFixture: GitPanelFixture = {
      missing: false,
      statusV2: "",
      statusV1: "",
      branch: "feature/bubble-git-panel",
      branches: ["feature/bubble-git-panel", "main"],
      remoteOutput: "",
    };
    window.__gitPanelFixture = defaultGitFixture;

    const getGitFixture = (): GitPanelFixture =>
      window.__gitPanelFixture ?? defaultGitFixture;

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
                if (getGitFixture().missing) {
                  throw new Error("not a git repository");
                }
                return getGitFixture().statusV1;
              case "GetGitBranch":
                if (getGitFixture().missing) {
                  throw new Error("not a git repository");
                }
                return getGitFixture().branch;
              case "GetGitBranches":
                if (getGitFixture().missing) {
                  throw new Error("not a git repository");
                }
                return getGitFixture().branches;
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
              case "RunGitCommand": {
                const args = (_args[0] ?? []) as string[];
                const fixture = getGitFixture();
                if (args[0] === "init") {
                  window.__gitPanelFixture = {
                    ...defaultGitFixture,
                    remoteOutput: fixture.remoteOutput,
                  };
                  return "Initialized empty Git repository";
                }
                if (fixture.missing) {
                  throw new Error("not a git repository");
                }
                if (args[0] === "status") {
                  return fixture.statusV2;
                }
                if (args[0] === "remote") {
                  return fixture.remoteOutput;
                }
                return "";
              }
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

  await expect(page.getByTitle("Search")).toBeVisible();
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

const waitForGitPanelInitialRefresh = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await expect(page.getByText("Working tree is clean.")).toBeVisible();
};

const readPanelFrame = async (
  page: Parameters<typeof test>[0]["page"],
  selector: string,
): Promise<{
  width: number;
  height: number;
  opacity: string;
  translateX: number;
  translateY: number;
} | null> => {
  return page.evaluate((panelSelector) => {
    const node = document.querySelector<HTMLElement>(panelSelector);
    if (!node) {
      return null;
    }

    const rect = node.getBoundingClientRect();
    const styles = window.getComputedStyle(node);
    const transform = styles.transform;
    const matrix =
      transform && transform !== "none"
        ? new DOMMatrixReadOnly(transform)
        : new DOMMatrixReadOnly();

    return {
      width: rect.width,
      height: rect.height,
      opacity: styles.opacity,
      translateX: matrix.m41,
      translateY: matrix.m42,
    };
  }, selector);
};

const seedGitState = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(() => {
    window.__gitPanelFixture = {
      missing: false,
      branch: "feature/bubble-git-panel",
      branches: ["feature/bubble-git-panel", "main"],
      remoteOutput: "origin",
      statusV1: "",
      statusV2: [
        "# branch.oid 1234567",
        "# branch.head feature/bubble-git-panel",
        "# branch.upstream origin/feature/bubble-git-panel",
        "# branch.ab +2 -1",
        "1 M. N... 100644 100644 100644 abc abc frontend/src/components/GitPanel.tsx",
        "1 A. N... 000000 100644 100644 000 abc frontend/src/components/gitPanelStyles.ts",
        "1 .M N... 100644 100644 100644 abc abc frontend/src/components/layout/MainLayout.tsx",
        "1 .M N... 100644 100644 100644 abc abc frontend/src/components/ui/FloatingPanel.tsx",
      ].join("\n"),
    };
  });
  await page.getByTitle("Refresh status").click();
};

const seedLargeGitState = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(() => {
    const makeEntries = (
      prefix: string,
      count: number,
      status: "conflicted" | "modified" | "added",
      staged: boolean,
    ): string[] =>
      Array.from({ length: count }, (_value, index) => {
        const path = `.arlecchino/${prefix}-${String(index).padStart(2, "0")}.txt`;
        if (status === "conflicted") {
          return `u UU N... 100644 100644 100644 100644 a b c d ${path}`;
        }
        return staged
          ? `1 M. N... 100644 100644 100644 abc abc ${path}`
          : `1 .M N... 100644 100644 100644 abc abc ${path}`;
      });

    window.__gitPanelFixture = {
      missing: false,
      branch: "main",
      branches: ["main", "feature/bubble-git-panel"],
      remoteOutput: "origin",
      statusV1: "",
      statusV2: [
        "# branch.oid 7654321",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +0 -0",
        ...makeEntries("staged", 12, "modified", true),
        ...makeEntries("working-tree", 12, "modified", false),
        ...makeEntries("conflict", 28, "conflicted", false),
      ].join("\n"),
    };
  });
  await page.getByTitle("Refresh status").click();
};

test("git panel stays compact by default and expands into split fullscreen workspace", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openGitPanel(page);

  const panel = page.getByTestId("panel-git");
  const root = page.getByTestId("git-panel-root");

  await expect(panel).toBeVisible();
  await waitForGitPanelInitialRefresh(page);
  await seedGitState(page);
  await expect(root).toHaveAttribute("data-git-mode", "compact");
  await expect(root).toHaveAttribute("data-git-layout", "stacked");
  await expect(root.locator("img")).toHaveCount(0);
  await expect(page.locator('[data-testid="git-side-rail"]')).toHaveCount(0);
  await expect(page.getByText("GitPanel.tsx")).toBeVisible();
  await expect
    .poll(async () => panel.getAttribute("data-panel-motion"))
    .toBe("settled");
  await page.waitForTimeout(300);

  const dockedBox = await panel.boundingBox();
  expect(dockedBox).not.toBeNull();

  await page.getByTitle("View diff").first().click();
  await expect(page.getByTestId("git-compact-detail-overlay")).toBeVisible();
  await expect(page.getByTestId("git-diff-viewer")).toBeVisible();
  const preFullscreenBox = await panel.boundingBox();
  expect(preFullscreenBox).not.toBeNull();

  await page
    .locator('[data-testid="panel-git"] button[title="Полный экран"]')
    .click();
  await nextAnimationFrame(page);

  const transitionFrame = await readPanelFrame(
    page,
    '[data-testid="panel-git"]',
  );
  expect(transitionFrame).not.toBeNull();
  expect(transitionFrame?.opacity).toBe("1");
  expect(transitionFrame?.width ?? 0).toBeGreaterThan(
    preFullscreenBox?.width ?? 0,
  );
  expect(transitionFrame?.height ?? 0).toBeGreaterThanOrEqual(
    preFullscreenBox?.height ?? 0,
  );

  await expect(root).toHaveAttribute("data-git-mode", "expanded");
  await expect(root).toHaveAttribute("data-git-layout", "split");
  await expect(page.getByTestId("git-expanded-workspace")).toBeVisible();
  await expect(page.getByTestId("git-expanded-sidebar")).toBeVisible();
  await expect(page.getByTestId("git-detail-pane")).toBeVisible();

  await page.getByTitle("View diff").first().click();
  await expect(page.getByTestId("git-diff-viewer")).toBeVisible();

  const fullscreenBox = await panel.boundingBox();
  const panelHostBox = await panel.evaluate((node) => {
    const host = node.parentElement?.getBoundingClientRect();
    if (!host) {
      return null;
    }

    return {
      x: host.x,
      y: host.y,
      width: host.width,
      height: host.height,
    };
  });
  expect(fullscreenBox).not.toBeNull();
  expect(panelHostBox).not.toBeNull();
  expect(
    Math.abs((fullscreenBox?.x ?? 0) - (panelHostBox?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((fullscreenBox?.y ?? 0) - (panelHostBox?.y ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(fullscreenBox?.width ?? 0).toBeGreaterThanOrEqual(
    panelHostBox?.width ?? 0,
  );
  expect(fullscreenBox?.width ?? 0).toBeLessThanOrEqual(
    (panelHostBox?.width ?? 0) + 1,
  );
  expect(fullscreenBox?.height ?? 0).toBeGreaterThanOrEqual(
    panelHostBox?.height ?? 0,
  );
  expect(fullscreenBox?.height ?? 0).toBeLessThanOrEqual(
    (panelHostBox?.height ?? 0) + 1,
  );
  expect(fullscreenBox?.width ?? 0).toBeGreaterThan(
    (dockedBox?.width ?? 0) * 2,
  );
  expect(fullscreenBox?.height ?? 0).toBeGreaterThanOrEqual(
    dockedBox?.height ?? 0,
  );

  await page
    .locator('[data-testid="panel-git"] button[title="Полный экран"]')
    .click();

  await expect(page.getByTestId("git-panel-root")).toHaveCount(1);
  await expect(root).toHaveAttribute("data-git-mode", "compact");
  await expect(root).toHaveAttribute("data-git-layout", "stacked");
});

test("git panel keeps list regions scrollable in compact and expanded modes", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openGitPanel(page);

  const panel = page.getByTestId("panel-git");
  const root = page.getByTestId("git-panel-root");

  await expect(panel).toBeVisible();
  await waitForGitPanelInitialRefresh(page);
  await seedLargeGitState(page);
  await expect(page.getByText("conflict-00.txt")).toBeVisible();

  const compactScrollRegion = page.getByTestId("git-compact-scroll-region");
  await expect(compactScrollRegion).toBeVisible();
  const compactMetrics = await compactScrollRegion.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(compactMetrics.scrollHeight).toBeGreaterThan(
    compactMetrics.clientHeight,
  );
  const compactScrollTop = await compactScrollRegion.evaluate((node) => {
    node.scrollTop = 640;
    return node.scrollTop;
  });
  expect(compactScrollTop).toBeGreaterThan(0);

  await page
    .locator('[data-testid="panel-git"] button[title="Полный экран"]')
    .click();

  await expect(root).toHaveAttribute("data-git-mode", "expanded");
  const expandedScrollRegion = page.getByTestId("git-expanded-scroll-region");
  await expect(expandedScrollRegion).toBeVisible();
  const expandedMetrics = await expandedScrollRegion.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(expandedMetrics.scrollHeight).toBeGreaterThan(
    expandedMetrics.clientHeight,
  );
  const expandedScrollTop = await expandedScrollRegion.evaluate((node) => {
    node.scrollTop = 960;
    return node.scrollTop;
  });
  expect(expandedScrollTop).toBeGreaterThan(0);
});

test("git panel shows only initialization action when project is not a git repository", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openGitPanel(page);

  await expect(page.getByTestId("panel-git")).toBeVisible();
  await waitForGitPanelInitialRefresh(page);

  await page.evaluate(() => {
    window.__gitPanelFixture = {
      missing: true,
      statusV1: "",
      statusV2: "",
      branch: "",
      branches: [],
      remoteOutput: "",
    };
  });
  await page.getByTitle("Refresh status").click();

  const initState = page.getByTestId("git-init-empty-state");
  await expect(initState).toBeVisible();
  await expect(page.getByText("It's not a Git repository.")).toBeVisible();
  await expect(page.getByText("Want to initialize Git?")).toBeVisible();
  await expect(page.getByTestId("git-compact-scroll-region")).toHaveCount(0);
  await expect(page.getByText("Working Tree")).toHaveCount(0);

  await page.getByRole("button", { name: "Initialize Git" }).click();

  await expect(initState).toHaveCount(0);
  await expect(page.getByTestId("git-compact-scroll-region")).toBeVisible();
});
