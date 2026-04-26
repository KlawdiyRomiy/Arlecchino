import { expect, test } from "@playwright/test";

interface MountProjectUIOptions {
  panelLayoutState?: unknown;
}

const openGitPanel = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(() => {
    const eventInit = {
      key: "g",
      code: "KeyG",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });
};

const moveHeldPanelShortcut = async (
  page: Parameters<typeof test>[0]["page"],
  shortcut: {
    key: string;
    code: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  },
  arrow: { key: string; code: string },
): Promise<void> => {
  const modifiers: string[] = [];
  if (shortcut.metaKey) modifiers.push("Meta");
  if (shortcut.ctrlKey) modifiers.push("Control");
  if (shortcut.shiftKey) modifiers.push("Shift");

  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }

  await page.keyboard.down(shortcut.key);
  await page.keyboard.press(arrow.key);
  await page.keyboard.up(shortcut.key);

  for (const modifier of modifiers.reverse()) {
    await page.keyboard.up(modifier);
  }
};

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

    const runtimeHandlers = new Map<
      string,
      Set<(...args: unknown[]) => void>
    >();
    const runtimeBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "EventsOn" || property === "EventsOnMultiple") {
            return (
              eventName: string,
              callback: (...args: unknown[]) => void,
            ) => {
              const handlers = runtimeHandlers.get(eventName) ?? new Set();
              handlers.add(callback);
              runtimeHandlers.set(eventName, handlers);
              return () => handlers.delete(callback);
            };
          }
          if (property === "EventsOff") {
            return (eventName: string) => runtimeHandlers.delete(eventName);
          }
          if (property === "EventsEmit") {
            return (eventName: string, ...args: unknown[]) => {
              runtimeHandlers
                .get(eventName)
                ?.forEach((callback) => callback(...args));
            };
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
  parentOverflow: string;
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
      parentOverflow: node.parentElement
        ? window.getComputedStyle(node.parentElement).overflow
        : "",
    };
  }, selector);
};

const readElementBox = async (
  page: Parameters<typeof test>[0]["page"],
  selector: string,
): Promise<{
  bottom: number;
  height: number;
  top: number;
  width: number;
} | null> => {
  return page.evaluate((targetSelector) => {
    const node = document.querySelector<HTMLElement>(targetSelector);
    if (!node) {
      return null;
    }

    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      top: rect.top,
      width: rect.width,
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

const expectNoBoxOverlap = (
  first: { x: number; y: number; width: number; height: number } | null,
  second: { x: number; y: number; width: number; height: number } | null,
) => {
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();

  const firstRight = (first?.x ?? 0) + (first?.width ?? 0);
  const firstBottom = (first?.y ?? 0) + (first?.height ?? 0);
  const secondRight = (second?.x ?? 0) + (second?.width ?? 0);
  const secondBottom = (second?.y ?? 0) + (second?.height ?? 0);

  const overlaps =
    (first?.x ?? 0) < secondRight &&
    firstRight > (second?.x ?? 0) &&
    (first?.y ?? 0) < secondBottom &&
    firstBottom > (second?.y ?? 0);
  expect(overlaps).toBe(false);
};

const boxesOverlap = (
  first: { x: number; y: number; width: number; height: number } | null,
  second: { x: number; y: number; width: number; height: number } | null,
): boolean => {
  if (!first || !second) {
    return true;
  }

  const firstRight = first.x + first.width;
  const firstBottom = first.y + first.height;
  const secondRight = second.x + second.width;
  const secondBottom = second.y + second.height;

  return (
    first.x < secondRight &&
    firstRight > second.x &&
    first.y < secondBottom &&
    firstBottom > second.y
  );
};

const waitForPanelSettled = async (
  page: Parameters<typeof test>[0]["page"],
  testId: string,
): Promise<void> => {
  await expect
    .poll(async () =>
      page.getByTestId(testId).last().getAttribute("data-panel-motion"),
    )
    .toBe("settled");
};

const expectSnappedPanelCloseMotion = async (
  page: Parameters<typeof test>[0]["page"],
  selector: string,
  position: "left" | "right" | "top" | "bottom",
): Promise<void> => {
  await nextAnimationFrame(page);
  await page.waitForTimeout(80);

  await expect
    .poll(async () => {
      const frame = await readPanelFrame(page, selector);
      if (!frame) {
        return 0;
      }
      return position === "left" || position === "right"
        ? Math.abs(frame.translateX) / frame.width
        : Math.abs(frame.translateY) / frame.height;
    })
    .toBeGreaterThan(1.18);

  const exitFrame = await readPanelFrame(page, selector);
  expect(exitFrame).not.toBeNull();
  expect(exitFrame?.motion).toBe("exit");
  expect(exitFrame?.parentOverflow).toBe("visible");
  expectDirectionalSlide(exitFrame, position);

  await expect(page.locator(selector)).toHaveCount(0);
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
      .toBeGreaterThan(1.18);
  } else {
    await expect
      .poll(async () => {
        const frame = await readPanelFrame(page, '[data-testid="panel-git"]');
        if (!frame) {
          return 0;
        }
        return Math.abs(frame.translateY) / frame.height;
      })
      .toBeGreaterThan(1.18);
  }

  const exitFrame = await readPanelFrame(page, '[data-testid="panel-git"]');
  expect(exitFrame).not.toBeNull();
  expect(exitFrame?.motion).toBe("exit");
  expect(exitFrame?.opacity).toBe("1");
  expect(exitFrame?.parentOverflow).toBe("visible");
  expectDirectionalSlide(exitFrame, panelPosition);

  await expect(page.locator('[data-testid="panel-git"]')).toHaveCount(0);
});

for (const position of ["left", "right", "top", "bottom"] as const) {
  test(`snapped floating panel closes smoothly from ${position}`, async ({
    page,
  }) => {
    await mountProjectUI(page, {
      panelLayoutState: {
        panels: {
          explorer: false,
          terminal: false,
          aiChat: false,
          git: false,
          problems: false,
          code: false,
        },
        panelConfigs: {
          git: {
            position,
            mode: "snapped",
            size:
              position === "left" || position === "right"
                ? { width: 280, height: 0 }
                : { width: 0, height: 220 },
            x: 0,
            y: 0,
          },
        },
      },
    });

    const panel = page.locator('[data-testid="panel-git"]');
    await openGitPanel(page);
    await expect(panel).toBeVisible();
    await waitForPanelSettled(page, "panel-git");
    const editorBeforeClose = await readElementBox(
      page,
      '[data-testid="editor-area"]',
    );
    expect(editorBeforeClose).not.toBeNull();

    await panel.locator('button[title="Закрыть панель"]').click();
    await nextAnimationFrame(page);
    await page.waitForTimeout(80);

    await expect
      .poll(async () => {
        const frame = await readPanelFrame(page, '[data-testid="panel-git"]');
        if (!frame) {
          return 0;
        }
        return position === "left" || position === "right"
          ? Math.abs(frame.translateX) / frame.width
          : Math.abs(frame.translateY) / frame.height;
      })
      .toBeGreaterThan(1.18);

    const exitFrame = await readPanelFrame(page, '[data-testid="panel-git"]');
    expect(exitFrame?.motion).toBe("exit");
    expect(exitFrame?.parentOverflow).toBe("visible");
    expectDirectionalSlide(exitFrame, position);
    const editorDuringClose = await readElementBox(
      page,
      '[data-testid="editor-area"]',
    );
    expect(editorDuringClose).not.toBeNull();
    if (position === "left" || position === "right") {
      expect(editorDuringClose?.width ?? 0).toBeGreaterThan(
        (editorBeforeClose?.width ?? 0) + 4,
      );
    } else {
      expect(editorDuringClose?.height ?? 0).toBeGreaterThan(
        (editorBeforeClose?.height ?? 0) + 4,
      );
    }

    await expect(page.locator('[data-testid="panel-git"]')).toHaveCount(0);
  });
}

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

test("panel shortcuts open hidden panels on keydown without waiting for hold", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-git"]');
  await expect(panel).toHaveCount(0);

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

  await expect(panel).toBeVisible();
  await page.waitForTimeout(760);
  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "g",
        code: "KeyG",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(panel).toBeVisible();
});

test("visible panel shortcut stays visible while held and closes on keyup", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-explorer"]');
  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    const firstPress = {
      key: "e",
      code: "KeyE",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    const repeatedPress = { ...firstPress, repeat: true };
    window.dispatchEvent(new KeyboardEvent("keydown", firstPress));
    window.dispatchEvent(new KeyboardEvent("keydown", repeatedPress));
    window.dispatchEvent(new KeyboardEvent("keydown", repeatedPress));
  });

  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(panel).toHaveCount(0);
});

test("visible panel shortcut closes while command remains held when trigger keyup is missing", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-explorer"]');
  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(panel).toBeVisible();
  await page.waitForTimeout(260);
  await expect(panel).toBeVisible();
  await page.waitForTimeout(460);
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    const eventInit = {
      key: "e",
      code: "KeyE",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ...eventInit, repeat: true }),
    );
  });
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(260);
  await expect(panel).toBeVisible();
  await page.waitForTimeout(460);
  await expect(panel).toHaveCount(0);

  await page.waitForTimeout(760);
  await page.evaluate(() => {
    const emitMenuAction = () => {
      window.dispatchEvent(
        new CustomEvent("arlecchino:application-menu-action", {
          detail: { actionId: "explorer.toggle" },
        }),
      );
    };

    emitMenuAction();
    emitMenuAction();
  });
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Meta",
        code: "MetaLeft",
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "explorer.toggle" },
      }),
    );
  });

  await expect(panel).toHaveCount(0);
});

test("panel shortcut retaps while command remains held", async ({ page }) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: false,
        aiChat: false,
        git: false,
        problems: false,
        code: true,
      },
    },
  });

  const panel = page.locator('[data-testid="panel-explorer"]');
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    const eventInit = {
      key: "e",
      code: "KeyE",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  });

  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    const eventInit = {
      key: "e",
      code: "KeyE",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  });

  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(panel).toHaveCount(0);
});

test("panel shortcut closes when command is released before trigger key", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-explorer"]');
  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Meta",
        code: "MetaLeft",
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(panel).toHaveCount(0);
});

test("repeated native menu explorer shortcut opens only once while held", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: false,
        aiChat: false,
        git: false,
        problems: false,
        code: true,
      },
    },
  });

  const panel = page.locator('[data-testid="panel-explorer"]');
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    const emitMenuAction = () => {
      window.dispatchEvent(
        new CustomEvent("arlecchino:application-menu-action", {
          detail: { actionId: "explorer.toggle" },
        }),
      );
    };

    emitMenuAction();
    emitMenuAction();
    emitMenuAction();
  });

  await expect(panel).toBeVisible();
});

test("repeated native menu explorer shortcut closes only once while held", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-explorer"]');
  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    const emitMenuAction = () => {
      window.dispatchEvent(
        new CustomEvent("arlecchino:application-menu-action", {
          detail: { actionId: "explorer.toggle" },
        }),
      );
    };

    emitMenuAction();
    emitMenuAction();
    emitMenuAction();
  });

  await expect(panel).toHaveCount(0);
});

test("opened panel stays open while shortcut key repeats", async ({ page }) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-git"]');
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    const eventInit = {
      key: "g",
      code: "KeyG",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ...eventInit, repeat: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ...eventInit, repeat: true }),
    );
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });

  await expect(panel).toBeVisible();
});

test("terminal shortcut repeat does not spam open and close", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-terminal"]');
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    const eventInit = {
      key: "j",
      code: "KeyJ",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ...eventInit, repeat: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ...eventInit, repeat: true }),
    );
  });

  await expect(panel).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "j",
        code: "KeyJ",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(panel).toBeVisible();
});

test("panel arrows ignore stale shortcut state when only the modifier remains held", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openGitPanel(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]').last();
  const gitPanel = page.locator('[data-testid="panel-git"]').last();
  await expect(explorerPanel).toHaveAttribute("data-panel-position", "left");
  await expect(gitPanel).toHaveAttribute("data-panel-position", "right");

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(explorerPanel).toHaveCount(0);
  await expect(gitPanel).toHaveAttribute("data-panel-position", "right");
});

test("IDE side move action moves the panel snapped on the source side", async ({
  page,
}) => {
  await mountProjectUI(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]').last();
  await expect(explorerPanel).toHaveAttribute("data-panel-position", "left");

  await page.evaluate(() => {
    (
      window as Window & {
        runtime: { EventsEmit: (eventName: string, payload: unknown) => void };
      }
    ).runtime.EventsEmit("ide:panel:move", {
      from: "left",
      to: "right",
    });
  });

  await expect
    .poll(async () => explorerPanel.getAttribute("data-panel-position"))
    .toBe("right");
});

test("IDE browser preview move action opens and moves the canonical preview", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    (
      window as Window & {
        runtime: { EventsEmit: (eventName: string, payload: unknown) => void };
      }
    ).runtime.EventsEmit("ide:panel:move", {
      panel: "browser",
      position: "left",
    });
  });

  const previewPanel = page
    .locator('[data-testid="panel-preview-browser-default"]')
    .last();
  await expect(previewPanel).toBeVisible();
  await expect
    .poll(async () => previewPanel.getAttribute("data-panel-position"))
    .toBe("left");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");
});

test("held panel shortcut keeps moving with arrows until trigger keyup", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openGitPanel(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]').last();
  const gitPanel = page.locator('[data-testid="panel-git"]').last();
  await expect(explorerPanel).toHaveAttribute("data-panel-position", "left");
  await expect(gitPanel).toHaveAttribute("data-panel-position", "right");

  await page.evaluate(() => {
    const shortcutInit = {
      key: "e",
      code: "KeyE",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", shortcutInit));
  });

  await expect(page.locator('[data-testid="panel-explorer"]')).toBeVisible();

  await page.waitForTimeout(260);
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        repeat: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(760);
  await expect(page.locator('[data-testid="panel-explorer"]')).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(page.getByTestId("panel-workspace")).toHaveAttribute(
    "data-panel-drop-settling",
    "true",
  );
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-relocating"),
    )
    .toBe("true");

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-git"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("left");

  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "e",
        code: "KeyE",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("bottom");
});

test("dragging a snapped panel tracks the pointer and snaps cleanly", async ({
  page,
}) => {
  await mountProjectUI(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]');
  await expect(explorerPanel).toBeVisible();

  const header = page.getByTestId("panel-explorer-drag-handle");
  const startRect = await explorerPanel.boundingBox();
  const headerRect = await header.boundingBox();
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

test("mouse drag relocation preserves smooth snapped close", async ({
  page,
}) => {
  await mountProjectUI(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]').last();
  await expect(explorerPanel).toBeVisible();

  const headerRect = await page
    .getByTestId("panel-explorer-drag-handle")
    .boundingBox();
  const viewport = page.viewportSize();
  expect(headerRect).not.toBeNull();
  expect(viewport).not.toBeNull();

  const grabPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move((viewport?.width ?? 0) - 16, 48, { steps: 10 });
  await page.mouse.up();

  const relocatedExplorerPanel = page
    .locator('[data-testid="panel-explorer"]')
    .last();
  await expect
    .poll(async () =>
      relocatedExplorerPanel.getAttribute("data-panel-position"),
    )
    .toBe("right");
  await expect(page.getByTestId("panel-workspace")).toHaveAttribute(
    "data-panel-drop-settling",
    "false",
  );
  await waitForPanelSettled(page, "panel-explorer");

  await relocatedExplorerPanel
    .locator('button[title="Закрыть панель"]')
    .click();
  await expectSnappedPanelCloseMotion(
    page,
    '[data-testid="panel-explorer"]',
    "right",
  );
});

test("dragging a snapped panel stays under the pointer with ui scale", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(1.2);
  });
  await nextAnimationFrame(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]');
  const header = page.getByTestId("panel-explorer-drag-handle");
  await expect(explorerPanel).toBeVisible();

  const startRect = await explorerPanel.boundingBox();
  const headerRect = await header.boundingBox();
  expect(startRect).not.toBeNull();
  expect(headerRect).not.toBeNull();

  const grabPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };
  const midPoint = {
    x: grabPoint.x + 360,
    y: grabPoint.y + 72,
  };

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move(midPoint.x, midPoint.y, { steps: 2 });
  await nextAnimationFrame(page);

  const dragRect = await explorerPanel.boundingBox();
  expect(dragRect).not.toBeNull();
  expect(
    Math.abs((dragRect?.x ?? 0) - ((startRect?.x ?? 0) + 360)),
  ).toBeLessThan(24);
  expect(
    Math.abs((dragRect?.y ?? 0) - ((startRect?.y ?? 0) + 72)),
  ).toBeLessThan(24);
  await expect(explorerPanel).toHaveAttribute("data-panel-state", "dragging");
  await page.mouse.up();
});

test("dragging onto an occupied edge shows swap feedback from the expanded hit area", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openGitPanel(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]');
  const gitPanel = page.locator('[data-testid="panel-git"]');
  await expect(explorerPanel).toBeVisible();
  await expect(gitPanel).toBeVisible();
  await expect(gitPanel).toHaveAttribute("data-panel-position", "right");

  const headerRect = await page
    .getByTestId("panel-explorer-drag-handle")
    .boundingBox();
  const viewport = page.viewportSize();
  expect(headerRect).not.toBeNull();
  expect(viewport).not.toBeNull();

  const grabPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };
  const swapPoint = {
    x: (viewport?.width ?? 0) - 190,
    y: (viewport?.height ?? 0) / 2,
  };

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move(swapPoint.x, swapPoint.y, { steps: 10 });
  await nextAnimationFrame(page);

  const rightDropZone = page.getByTestId("panel-drop-zone-right");
  await expect(rightDropZone).toHaveAttribute("data-drop-active", "true");
  await expect(rightDropZone).toHaveAttribute("data-drop-action", "swap");
  const rightDropZoneBox = await rightDropZone.boundingBox();
  expect(rightDropZoneBox).not.toBeNull();
  expect(swapPoint.x).toBeLessThan(rightDropZoneBox?.x ?? 0);
  await expect(gitPanel).toHaveAttribute("data-panel-state", "drop-target");

  await page.mouse.up();
  await expect(page.getByTestId("panel-workspace")).toHaveAttribute(
    "data-panel-drop-settling",
    "true",
  );
  const swappedExplorerPanel = page
    .locator('[data-testid="panel-explorer"]')
    .last();
  const swappedGitPanel = page.locator('[data-testid="panel-git"]').last();
  await expect
    .poll(async () => swappedExplorerPanel.getAttribute("data-panel-position"))
    .toBe("right");
  await expect
    .poll(async () => swappedGitPanel.getAttribute("data-panel-position"))
    .toBe("left");
});

test("held panel shortcuts swap occupied horizontal edges with arrows", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openGitPanel(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]').last();
  const gitPanel = page.locator('[data-testid="panel-git"]').last();
  await expect(explorerPanel).toHaveAttribute("data-panel-position", "left");
  await expect(gitPanel).toHaveAttribute("data-panel-position", "right");

  await moveHeldPanelShortcut(
    page,
    { key: "e", code: "KeyE", metaKey: true },
    { key: "ArrowRight", code: "ArrowRight" },
  );

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-git"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("left");
});

test("held shortcut relocation preserves smooth snapped close", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openGitPanel(page);

  const explorerPanel = page.locator('[data-testid="panel-explorer"]').last();
  const gitPanel = page.locator('[data-testid="panel-git"]').last();
  await expect(explorerPanel).toHaveAttribute("data-panel-position", "left");
  await expect(gitPanel).toHaveAttribute("data-panel-position", "right");

  await moveHeldPanelShortcut(
    page,
    { key: "e", code: "KeyE", metaKey: true },
    { key: "ArrowRight", code: "ArrowRight" },
  );

  const relocatedExplorerPanel = page
    .locator('[data-testid="panel-explorer"]')
    .last();
  await expect
    .poll(async () =>
      relocatedExplorerPanel.getAttribute("data-panel-position"),
    )
    .toBe("right");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-git"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("left");
  await expect(page.getByTestId("panel-workspace")).toHaveAttribute(
    "data-panel-drop-settling",
    "false",
  );
  await waitForPanelSettled(page, "panel-explorer");

  await relocatedExplorerPanel
    .locator('button[title="Закрыть панель"]')
    .click();
  await expectSnappedPanelCloseMotion(
    page,
    '[data-testid="panel-explorer"]',
    "right",
  );
});

test("lateral panel relocation does not promote occupied top and bottom slots", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: true,
        terminal: false,
        aiChat: true,
        git: true,
        problems: false,
        code: false,
      },
      panelConfigs: {
        explorer: {
          position: "left",
          size: { width: 260, height: 0 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
        git: {
          position: "top",
          size: { width: 0, height: 180 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
        aiChat: {
          position: "bottom",
          size: { width: 0, height: 220 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        explorer: "left",
        git: "top",
        aiChat: "bottom",
      },
    },
  });

  await expect(
    page.locator('[data-testid="panel-git"]').last(),
  ).toHaveAttribute("data-panel-position", "top");
  await expect(
    page.locator('[data-testid="panel-aiChat"]').last(),
  ).toHaveAttribute("data-panel-position", "bottom");

  await page.keyboard.down("Meta");
  await page.keyboard.down("e");
  await page.keyboard.press("ArrowRight");
  await nextAnimationFrame(page);

  await expect(page.getByTestId("panel-workspace")).toHaveAttribute(
    "data-panel-drop-settling",
    "true",
  );

  const slotStyles = await page.evaluate(() => {
    const readSlotStyle = (testId: string) => {
      const panels = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
      );
      const panel = panels.at(-1);
      const slot = panel?.parentElement;
      if (!slot) {
        return null;
      }
      const styles = window.getComputedStyle(slot);
      return {
        overflow: styles.overflow,
        willChange: styles.willChange,
      };
    };

    return {
      explorer: readSlotStyle("panel-explorer"),
      git: readSlotStyle("panel-git"),
      aiChat: readSlotStyle("panel-aiChat"),
    };
  });

  expect(slotStyles.explorer).toEqual({
    overflow: "visible",
    willChange: "transform, opacity",
  });
  expect(slotStyles.git).toEqual({
    overflow: "hidden",
    willChange: "auto",
  });
  expect(slotStyles.aiChat).toEqual({
    overflow: "hidden",
    willChange: "auto",
  });

  await page.evaluate(() => {
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="panel-explorer"]'),
    );
    (
      window as Window & { __relocatedExplorerPanel?: HTMLElement | null }
    ).__relocatedExplorerPanel = panels.at(-1) ?? null;
  });

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");

  await expect(page.getByTestId("panel-workspace")).toHaveAttribute(
    "data-panel-drop-settling",
    "false",
  );
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const panels = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-testid="panel-explorer"]',
          ),
        );
        return (
          (window as Window & { __relocatedExplorerPanel?: HTMLElement | null })
            .__relocatedExplorerPanel === (panels.at(-1) ?? null)
        );
      }),
    )
    .toBe(true);

  await page.keyboard.up("e");
  await page.keyboard.up("Meta");
});

test("held browser preview shortcut swaps occupied edges with arrows", async ({
  page,
}) => {
  await mountProjectUI(page);

  await expect(
    page.locator('[data-testid="panel-explorer"]').last(),
  ).toHaveAttribute("data-panel-position", "left");

  await moveHeldPanelShortcut(
    page,
    { key: "b", code: "KeyB", metaKey: true },
    { key: "ArrowLeft", code: "ArrowLeft" },
  );

  const previewPanel = page
    .locator('[data-testid="panel-preview-browser-default"]')
    .last();
  await expect(previewPanel).toBeVisible();
  await expect
    .poll(async () => previewPanel.getAttribute("data-panel-position"))
    .toBe("left");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");

  const browserPreviewPosition = await page.evaluate(async () => {
    const { usePreviewWindowStore } =
      await import("/src/stores/previewWindowStore.ts");
    return usePreviewWindowStore
      .getState()
      .windows.find(
        (windowState) => windowState.id === "preview-browser-default",
      )?.position;
  });
  expect(browserPreviewPosition).toBe("left");
});

test("visible browser preview shortcut closes on keyup but can be held to move", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+B");
  const initialPreviewPanel = page
    .locator('[data-testid="panel-preview-browser-default"]')
    .last();
  await expect(initialPreviewPanel).toBeVisible();

  await page.keyboard.down("Meta");
  await page.keyboard.down("b");
  await expect(initialPreviewPanel).toBeVisible();
  await page.keyboard.up("b");
  await page.keyboard.up("Meta");
  await expect(
    page.locator('[data-testid="panel-preview-browser-default"]'),
  ).toHaveCount(0);

  await page.keyboard.press("Meta+B");
  await expect(
    page.locator('[data-testid="panel-preview-browser-default"]').last(),
  ).toBeVisible();

  await moveHeldPanelShortcut(
    page,
    { key: "b", code: "KeyB", metaKey: true },
    { key: "ArrowLeft", code: "ArrowLeft" },
  );

  const previewPanel = page
    .locator('[data-testid="panel-preview-browser-default"]')
    .last();
  await expect(previewPanel).toBeVisible();
  await expect
    .poll(async () => previewPanel.getAttribute("data-panel-position"))
    .toBe("left");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");
});

test("browser preview avoids top snapped panels", async ({ page }) => {
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
        explorer: {
          position: "top",
          size: { width: 0, height: 260 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        explorer: "top",
      },
    },
  });

  await page.keyboard.press("Meta+B");

  const explorerBox = await page
    .locator('[data-testid="panel-explorer"]')
    .last()
    .boundingBox();
  const previewBox = await page
    .locator('[data-testid="panel-preview-browser-default"]')
    .last()
    .boundingBox();

  expect(explorerBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expectNoBoxOverlap(explorerBox, previewBox);
});

test("browser preview resizes from the inner edge across iframe content", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+B");
  const previewPanel = page
    .locator('[data-testid="panel-preview-browser-default"]')
    .last();
  await expect(previewPanel).toBeVisible();
  await waitForPanelSettled(page, "panel-preview-browser-default");

  const startBox = await previewPanel.boundingBox();
  const resizeHandle = page.getByTestId(
    "panel-preview-browser-default-resize-w",
  );
  const handleBox = await resizeHandle.boundingBox();
  expect(startBox).not.toBeNull();
  expect(handleBox).not.toBeNull();

  const grabPoint = {
    x: (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
    y: (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
  };

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await nextAnimationFrame(page);
  await page.mouse.move(grabPoint.x + 120, grabPoint.y, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const nextBox = await previewPanel.boundingBox();
      return nextBox?.width ?? 0;
    })
    .toBeLessThan((startBox?.width ?? 0) - 60);
});

test("browser preview uses real layout slots on every edge", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: false,
        aiChat: false,
        git: false,
        problems: false,
        code: false,
      },
    },
  });

  await page.keyboard.press("Meta+B");
  const previewPanel = page
    .locator('[data-testid="panel-preview-browser-default"]')
    .last();
  const editorArea = page.getByTestId("editor-area");
  await expect(previewPanel).toBeVisible();
  await expect(page.getByTestId("preview-window-layer")).toHaveCount(0);

  const assertPreviewEdge = async (
    position: "left" | "right" | "top" | "bottom",
  ) => {
    await expect
      .poll(async () => previewPanel.getAttribute("data-panel-position"))
      .toBe(position);

    await expect
      .poll(async () => {
        const previewBox = await previewPanel.boundingBox();
        const editorBox = await editorArea.boundingBox();
        return boxesOverlap(previewBox, editorBox) ? "overlap" : "separate";
      })
      .toBe("separate");

    const previewBox = await previewPanel.boundingBox();
    const editorBox = await editorArea.boundingBox();

    if (position === "left") {
      expect(
        (previewBox?.x ?? 0) + (previewBox?.width ?? 0),
      ).toBeLessThanOrEqual((editorBox?.x ?? 0) + 1);
    } else if (position === "right") {
      expect(editorBox?.x ?? 0).toBeLessThan(previewBox?.x ?? 0);
      expect((editorBox?.x ?? 0) + (editorBox?.width ?? 0)).toBeLessThanOrEqual(
        (previewBox?.x ?? 0) + 1,
      );
    } else if (position === "top") {
      expect(
        (previewBox?.y ?? 0) + (previewBox?.height ?? 0),
      ).toBeLessThanOrEqual((editorBox?.y ?? 0) + 1);
    } else {
      expect(
        (editorBox?.y ?? 0) + (editorBox?.height ?? 0),
      ).toBeLessThanOrEqual((previewBox?.y ?? 0) + 1);
    }
  };

  await assertPreviewEdge("right");

  await moveHeldPanelShortcut(
    page,
    { key: "b", code: "KeyB", metaKey: true },
    { key: "ArrowLeft", code: "ArrowLeft" },
  );
  await assertPreviewEdge("left");

  await moveHeldPanelShortcut(
    page,
    { key: "b", code: "KeyB", metaKey: true },
    { key: "ArrowUp", code: "ArrowUp" },
  );
  await assertPreviewEdge("top");

  await moveHeldPanelShortcut(
    page,
    { key: "b", code: "KeyB", metaKey: true },
    { key: "ArrowDown", code: "ArrowDown" },
  );
  await assertPreviewEdge("bottom");
});

test("dragging browser preview swaps with occupied edges", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+B");
  const previewPanel = page
    .locator('[data-testid="panel-preview-browser-default"]')
    .last();
  await expect(previewPanel).toBeVisible();
  await expect(previewPanel).toHaveAttribute("data-panel-position", "right");
  await waitForPanelSettled(page, "panel-preview-browser-default");

  const headerRect = await page
    .getByTestId("panel-preview-browser-default-drag-handle")
    .boundingBox();
  const viewport = page.viewportSize();
  expect(headerRect).not.toBeNull();
  expect(viewport).not.toBeNull();

  const grabPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };
  const swapPoint = {
    x: 72,
    y: (viewport?.height ?? 0) / 2,
  };

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move(swapPoint.x, swapPoint.y, { steps: 10 });
  await nextAnimationFrame(page);

  const leftDropZone = page.getByTestId("panel-drop-zone-left");
  await expect(leftDropZone).toHaveAttribute("data-drop-active", "true");
  await expect(leftDropZone).toHaveAttribute("data-drop-action", "swap");
  await expect(
    page.locator('[data-testid="panel-explorer"]').last(),
  ).toHaveAttribute("data-panel-state", "drop-target");

  await page.mouse.up();
  await expect
    .poll(async () => previewPanel.getAttribute("data-panel-position"))
    .toBe("left");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");
});

test("held panel shortcuts swap occupied vertical edges with arrows", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: true,
        aiChat: false,
        git: false,
        problems: true,
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
          position: "top",
          size: { width: 0, height: 260 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        terminal: "bottom",
        problems: "top",
      },
    },
  });

  await expect(
    page.locator('[data-testid="panel-terminal"]').last(),
  ).toHaveAttribute("data-panel-position", "bottom");
  await expect(
    page.locator('[data-testid="panel-problems"]').last(),
  ).toHaveAttribute("data-panel-position", "top");

  await moveHeldPanelShortcut(
    page,
    { key: "j", code: "KeyJ", metaKey: true },
    { key: "ArrowUp", code: "ArrowUp" },
  );

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-terminal"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("top");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-problems"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("bottom");
});

test("held problems fullscreen shortcut does not swap occupied edges", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: true,
        aiChat: false,
        git: false,
        problems: true,
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
          position: "top",
          size: { width: 0, height: 260 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        terminal: "bottom",
        problems: "top",
      },
    },
  });

  await moveHeldPanelShortcut(
    page,
    { key: "i", code: "KeyI", metaKey: true, shiftKey: true },
    { key: "ArrowDown", code: "ArrowDown" },
  );

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-terminal"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("bottom");
  await expect(
    page.locator('[data-testid="panel-problems"]').last(),
  ).toHaveAttribute("data-panel-position", "top");
});

test("held compact problems shortcut swaps occupied vertical edges", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: true,
        aiChat: false,
        git: false,
        problems: true,
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
          position: "top",
          size: { width: 0, height: 260 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        terminal: "bottom",
        problems: "top",
      },
    },
  });

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  await moveHeldPanelShortcut(
    page,
    { key: "i", code: "KeyI", metaKey: true },
    { key: "ArrowDown", code: "ArrowDown" },
  );

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-problems"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("bottom");
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-terminal"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("top");
});
