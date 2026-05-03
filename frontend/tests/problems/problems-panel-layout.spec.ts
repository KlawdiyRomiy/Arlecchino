import { expect, test } from "@playwright/test";

interface MountProjectUIOptions {
  panelLayoutState?: unknown;
}

const installBaseBridges = async (
  page: Parameters<typeof test>[0]["page"],
  options: MountProjectUIOptions = {},
): Promise<void> => {
  await page.addInitScript(({ panelLayoutState }: MountProjectUIOptions) => {
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
              case "ReadFile": {
                const path = typeof args[0] === "string" ? args[0] : "file.ts";
                return `// ${path}\nexport const ready = true;\n`;
              }
              case "GetLanguageForFile":
                return "typescript";
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
    if (panelLayoutState) {
      localStorage.setItem(
        "panelState:/workspace",
        JSON.stringify(panelLayoutState),
      );
    }
  }, options);
};

const mountProjectUI = async (
  page: Parameters<typeof test>[0]["page"],
  options: MountProjectUIOptions = {},
): Promise<void> => {
  await installBaseBridges(page, options);
  await page.goto("/");

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
    const { useEditorStore } = await import("/src/stores/editorStore.ts");
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");

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

    useEditorSettingsStore.setState({ showCompactDiagnostics: true });
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

  await expect(page.getByTestId("diagnostics-compact-indicator")).toBeVisible();
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

const openProblemsPanel = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.getByTestId("diagnostics-compact-indicator").click();
};

const seedProblemsState = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(async () => {
    const { useDiagnosticsStore } =
      await import("/src/stores/diagnosticsStore.ts");

    const makeItem = (
      line: number,
      severity: number,
      message: string,
      code: string,
    ) => ({
      range: {
        start: { line: line - 1, character: 2 },
        end: { line: line - 1, character: 10 },
      },
      severity,
      code,
      source: "tsserver",
      message,
    });

    const state = useDiagnosticsStore.getState();
    state.reset();
    state.setProjectScope("/workspace", 1);
    state.setFileDiagnostics("/workspace/index.tsx", "typescript", [
      makeItem(3, 1, "Current file type mismatch", "TS2322"),
      makeItem(11, 2, "Unused variable in current file", "TS6133"),
      makeItem(18, 3, "Suggested cleanup for import order", "TS80006"),
    ]);
    state.setFileDiagnostics("/workspace/src/ProblemsPanel.tsx", "typescript", [
      makeItem(7, 1, "Problems summary layout is inconsistent", "TS1001"),
      makeItem(19, 2, "Filter chip spacing is too tight", "TS2002"),
      makeItem(26, 2, "Bubble contrast token is too muted", "TS2003"),
    ]);
    state.setFileDiagnostics("/workspace/src/MainLayout.tsx", "typescript", [
      makeItem(42, 1, "Problems fullscreen state is missing", "TS3001"),
      makeItem(58, 2, "Panel width is clamped too aggressively", "TS3002"),
    ]);
  });
};

test("status bar diagnostics opens persisted floating problems panel as snapped bottom", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: true,
        terminal: false,
        aiChat: false,
        git: false,
        problems: false,
        code: false,
      },
      panelConfigs: {
        problems: {
          position: "bottom",
          size: { width: 360, height: 180 },
          mode: "floating",
          x: 32,
          y: 48,
        },
      },
      rememberedSnappedPositions: {
        problems: "right",
      },
    },
  });

  await openProblemsPanel(page);

  const panel = page.locator('[data-testid="panel-problems"]').last();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-panel-position", "bottom");
  await expect(panel).toHaveAttribute("data-panel-state", "docked");
});

test("status bar diagnostics uses another free snapped slot when bottom is occupied", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: true,
        aiChat: false,
        git: false,
        problems: false,
        code: false,
      },
      panelConfigs: {
        terminal: {
          position: "bottom",
          size: { width: 0, height: 220 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
        problems: {
          position: "bottom",
          size: { width: 360, height: 180 },
          mode: "floating",
          x: 32,
          y: 48,
        },
      },
      rememberedSnappedPositions: {
        terminal: "bottom",
        problems: "bottom",
      },
    },
  });

  await openProblemsPanel(page);

  const terminal = page.locator('[data-testid="panel-terminal"]').last();
  const problems = page.locator('[data-testid="panel-problems"]').last();
  await expect(terminal).toBeVisible();
  await expect(terminal).toHaveAttribute("data-panel-position", "bottom");
  await expect(problems).toBeVisible();
  await expect(problems).toHaveAttribute("data-panel-position", "left");
  await expect(problems).toHaveAttribute("data-panel-state", "docked");
});

const seedErrorsOnlyProblemsState = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(async () => {
    const { useDiagnosticsStore } =
      await import("/src/stores/diagnosticsStore.ts");

    const makeItem = (line: number, message: string, code: string) => ({
      range: {
        start: { line: line - 1, character: 2 },
        end: { line: line - 1, character: 12 },
      },
      severity: 1,
      code,
      source: "tsserver",
      message,
    });

    const state = useDiagnosticsStore.getState();
    state.reset();
    state.setProjectScope("/workspace", 1);
    state.setFileDiagnostics("/workspace/rollup.config.ts", "typescript", [
      makeItem(3, "Cannot find module '@rollup/plugin-alias'", "TS2307"),
      makeItem(8, "Cannot find name 'node:fs/promises'", "TS2591"),
    ]);
  });
};

const seedLargeProblemsState = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(async () => {
    const { useDiagnosticsStore } =
      await import("/src/stores/diagnosticsStore.ts");

    const makeItems = (fileIndex: number, count: number) =>
      Array.from({ length: count }, (_value, problemIndex) => ({
        range: {
          start: { line: problemIndex + 1, character: 2 },
          end: { line: problemIndex + 1, character: 12 },
        },
        severity: problemIndex % 3 === 0 ? 1 : problemIndex % 3 === 1 ? 2 : 3,
        code: `TS${fileIndex}${problemIndex}`,
        source: "tsserver",
        message: `Problem ${problemIndex + 1} for diagnostics-file-${String(
          fileIndex,
        ).padStart(2, "0")}.ts`,
      }));

    const state = useDiagnosticsStore.getState();
    state.reset();
    state.setProjectScope("/workspace", 1);

    state.setFileDiagnostics(
      "/workspace/index.tsx",
      "typescript",
      makeItems(0, 28),
    );

    Array.from({ length: 18 }, (_value, fileIndex) => {
      const path = `/workspace/src/diagnostics-file-${String(
        fileIndex + 1,
      ).padStart(2, "0")}.ts`;
      state.setFileDiagnostics(path, "typescript", makeItems(fileIndex + 1, 8));
    });
  });
};

test("problems panel stays compact by default and expands into split fullscreen workspace", async ({
  page,
}) => {
  await mountProjectUI(page);
  await seedProblemsState(page);
  await openProblemsPanel(page);

  const panel = page.getByTestId("panel-problems");
  const root = page.getByTestId("problems-panel");

  await expect(panel).toBeVisible();
  await expect(root).toHaveAttribute("data-problems-mode", "compact");
  await expect(root).toHaveAttribute("data-problems-layout", "stacked");
  await expect(
    page.locator('[data-testid="problems-compact-detail-overlay"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="problems-expanded-workspace"]'),
  ).toHaveCount(0);
  await expect(
    page.getByText("ProblemsPanel.tsx", { exact: true }).first(),
  ).toBeVisible();
  await expect
    .poll(async () => panel.getAttribute("data-panel-motion"))
    .toBe("settled");

  const dockedBox = await panel.boundingBox();
  expect(dockedBox).not.toBeNull();

  await page
    .locator('[data-testid="panel-problems"] button[title="Полный экран"]')
    .click();
  await nextAnimationFrame(page);

  const transitionFrame = await readPanelFrame(
    page,
    '[data-testid="panel-problems"]',
  );
  expect(transitionFrame).not.toBeNull();
  expect(transitionFrame?.opacity).toBe("1");
  expect(transitionFrame?.height ?? 0).toBeGreaterThan(dockedBox?.height ?? 0);

  await expect(root).toHaveAttribute("data-problems-mode", "expanded");
  await expect(root).toHaveAttribute("data-problems-layout", "split");
  await expect(page.getByTestId("problems-expanded-workspace")).toBeVisible();
  await expect(page.getByTestId("problems-expanded-sidebar")).toBeVisible();
  await expect(page.getByTestId("problems-file-summary-pane")).toBeVisible();
  await expect(page.getByTestId("problems-file-summary-pane")).toContainText(
    "index.tsx",
  );

  await page.getByRole("button", { name: /ProblemsPanel\.tsx/i }).click();
  await expect(page.getByTestId("problems-file-summary-pane")).toContainText(
    "ProblemsPanel.tsx",
  );
  await expect(
    page.getByText("Bubble contrast token is too muted"),
  ).toBeVisible();

  await page.getByText("Bubble contrast token is too muted").click();
  await expect(page.getByTestId("statusbar-file")).toContainText(
    "ProblemsPanel.tsx",
  );
  await expect(page.getByTestId("problems-file-summary-pane")).toContainText(
    "ProblemsPanel.tsx",
  );

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
  expect(fullscreenBox?.height ?? 0).toBeGreaterThan(dockedBox?.height ?? 0);

  await page
    .locator('[data-testid="panel-problems"] button[title="Полный экран"]')
    .click();

  await expect(root).toHaveAttribute("data-problems-mode", "compact");
  await expect(root).toHaveAttribute("data-problems-layout", "stacked");
  await expect(panel).toHaveAttribute("data-panel-position", "bottom");
  await expect(panel).toHaveAttribute("data-panel-state", "docked");

  await expect
    .poll(async () => {
      const restoredBox = await panel.boundingBox();
      return Math.abs((restoredBox?.width ?? 0) - (dockedBox?.width ?? 0));
    })
    .toBeLessThanOrEqual(2);
  await expect
    .poll(async () => {
      const restoredBox = await panel.boundingBox();
      return Math.abs((restoredBox?.x ?? 0) - (dockedBox?.x ?? 0));
    })
    .toBeLessThanOrEqual(2);
});

test("problems panel keeps compact, expanded left, and expanded summary regions scrollable", async ({
  page,
}) => {
  await mountProjectUI(page);
  await seedLargeProblemsState(page);
  await openProblemsPanel(page);

  const panel = page.getByTestId("panel-problems");
  const root = page.getByTestId("problems-panel");

  await expect(panel).toBeVisible();
  await expect(root).toHaveAttribute("data-problems-mode", "compact");

  const compactScrollRegion = page.getByTestId(
    "problems-compact-scroll-region",
  );
  await expect(compactScrollRegion).toBeVisible();
  const compactMetrics = await compactScrollRegion.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(compactMetrics.scrollHeight).toBeGreaterThan(
    compactMetrics.clientHeight,
  );
  const compactScrollTop = await compactScrollRegion.evaluate((node) => {
    node.scrollTop = 720;
    return node.scrollTop;
  });
  expect(compactScrollTop).toBeGreaterThan(0);

  await page
    .locator('[data-testid="panel-problems"] button[title="Полный экран"]')
    .click();

  await expect(root).toHaveAttribute("data-problems-mode", "expanded");

  const leftScrollRegion = page.getByTestId(
    "problems-expanded-left-scroll-region",
  );
  await expect(leftScrollRegion).toBeVisible();
  const leftMetrics = await leftScrollRegion.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(leftMetrics.scrollHeight).toBeGreaterThan(leftMetrics.clientHeight);
  const leftScrollTop = await leftScrollRegion.evaluate((node) => {
    node.scrollTop = 640;
    return node.scrollTop;
  });
  expect(leftScrollTop).toBeGreaterThan(0);

  const rightScrollRegion = page.getByTestId(
    "problems-expanded-right-scroll-region",
  );
  await expect(rightScrollRegion).toBeVisible();
  const rightMetrics = await rightScrollRegion.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(rightMetrics.scrollHeight).toBeGreaterThan(rightMetrics.clientHeight);
  const rightScrollTop = await rightScrollRegion.evaluate((node) => {
    node.scrollTop = 960;
    return node.scrollTop;
  });
  expect(rightScrollTop).toBeGreaterThan(0);
});

test("problems panel fullscreen toggle restores compact layout after ui scale changes", async ({
  page,
}) => {
  await mountProjectUI(page);
  await seedProblemsState(page);
  await openProblemsPanel(page);

  const panel = page.getByTestId("panel-problems");
  const root = page.getByTestId("problems-panel");
  const fullscreenButton = page.locator(
    '[data-testid="panel-problems"] button[title="Полный экран"]',
  );
  const scaledUi = 1.2;

  await expect
    .poll(async () => panel.getAttribute("data-panel-motion"))
    .toBe("settled");
  const dockedBox = await panel.boundingBox();
  expect(dockedBox).not.toBeNull();

  await fullscreenButton.click();
  await expect(root).toHaveAttribute("data-problems-mode", "expanded");

  await page.evaluate(async (nextUiScale) => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(nextUiScale);
  }, scaledUi);

  await expect(root).toHaveAttribute("data-problems-mode", "expanded");

  await fullscreenButton.click();
  await expect(root).toHaveAttribute("data-problems-mode", "compact");
  await expect(panel).toHaveAttribute("data-panel-position", "bottom");
  await expect(panel).toHaveAttribute("data-panel-state", "docked");
  await expect
    .poll(async () => {
      const restoredBox = await panel.boundingBox();
      return Math.abs((restoredBox?.x ?? 0) / scaledUi - (dockedBox?.x ?? 0));
    })
    .toBeLessThanOrEqual(2);
});

test("persisted fullscreen problems panel can restore without an in-memory snapshot", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: { problems: true },
      panelConfigs: {
        problems: {
          position: "bottom",
          size: { width: 1280, height: 720 },
          mode: "floating",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: { problems: "bottom" },
    },
  });
  await seedProblemsState(page);

  const panel = page.getByTestId("panel-problems");
  const root = page.getByTestId("problems-panel");
  const fullscreenButton = page.locator(
    '[data-testid="panel-problems"] button[title="Полный экран"]',
  );

  await expect(panel).toBeVisible();
  await expect(root).toHaveAttribute("data-problems-mode", "expanded");

  await fullscreenButton.click();

  await expect(root).toHaveAttribute("data-problems-mode", "compact");
  await expect(root).toHaveAttribute("data-problems-layout", "stacked");
  await expect(panel).toHaveAttribute("data-panel-state", "docked");
});

test("problems panel keeps diagnostics visible during split-view diagnostics refresh", async ({
  page,
}) => {
  await mountProjectUI(page);
  await seedProblemsState(page);
  await openProblemsPanel(page);

  await expect(page.getByText("Current file type mismatch")).toBeVisible();

  await page.evaluate(async () => {
    const { useDiagnosticsStore } =
      await import("/src/stores/diagnosticsStore.ts");

    window.dispatchEvent(new CustomEvent("arlecchino:editor-split-transition"));
    const state = useDiagnosticsStore.getState();
    state.reset();
    state.setProjectScope("/workspace", 1);
  });
  await nextAnimationFrame(page);

  await expect(
    page.getByText(/No matching problems|Diagnostics unavailable/),
  ).toHaveCount(0);
  await expect(page.getByText("Current file type mismatch")).toBeVisible();

  await seedProblemsState(page);
  await expect(page.getByText("Current file type mismatch")).toBeVisible();
});

test("expanded problems panel keeps filters visible when warnings filter has no matches", async ({
  page,
}) => {
  await mountProjectUI(page);
  await seedErrorsOnlyProblemsState(page);
  await openProblemsPanel(page);

  const root = page.getByTestId("problems-panel");
  const fullscreenButton = page.locator(
    '[data-testid="panel-problems"] button[title="Полный экран"]',
  );
  const sidebar = page.getByTestId("problems-expanded-sidebar");

  await fullscreenButton.click();
  await expect(root).toHaveAttribute("data-problems-mode", "expanded");
  await expect(page.getByTestId("problems-file-summary-pane")).toContainText(
    "rollup.config.ts",
  );

  await sidebar.getByRole("button", { name: "Warnings" }).click();

  await expect(root).toHaveAttribute("data-problems-mode", "expanded");
  await expect(page.getByTestId("problems-expanded-workspace")).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "All files" }),
  ).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Warnings" })).toBeVisible();
  await expect(
    page.getByText(
      /No matching problems|Diagnostics unavailable|Partial results only/,
    ),
  ).toBeVisible();

  await sidebar.getByRole("button", { name: "All files" }).click();

  await expect(root).toHaveAttribute("data-problems-mode", "expanded");
  await expect(page.getByTestId("problems-file-summary-pane")).toContainText(
    "rollup.config.ts",
  );
});
