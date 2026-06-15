import { expect, test } from "@playwright/test";

const ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS = 700;
const ZEN_TOP_CHROME_OCCLUDED_REVEAL_DELAY_MS = 1400;

interface MountProjectUIOptions {
  editorContent?: string;
  panelLayoutState?: unknown;
}

const largeEditorContent = Array.from({ length: 800 }, (_value, index) => {
  const paddedIndex = String(index + 1).padStart(4, "0");
  return `export const row${paddedIndex} = "${"stable-scroll-geometry ".repeat(
    4,
  )}${paddedIndex}";`;
}).join("\n");

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

const openExplorerPanel = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate(() => {
    const eventInit = {
      key: "e",
      code: "KeyE",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });
};

const mountHiddenGitPanelAtPosition = async (
  page: Parameters<typeof test>[0]["page"],
  position: "left" | "right" | "top" | "bottom",
): Promise<void> => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: false,
        aiChat: false,
        git: false,
        problems: false,
        code: false,
        markdownPreview: false,
      },
      panelConfigs: {
        git: {
          position,
          mode: "snapped",
          size:
            position === "left" || position === "right"
              ? { width: 320, height: 0 }
              : { width: 0, height: 220 },
          x: 0,
          y: 0,
        },
      },
    },
  });

  await openGitPanel(page);
  await expect(page.locator('[data-testid="panel-git"]')).toBeVisible();
  await waitForPanelSettled(page, "panel-git");
};

const setZenMode = async (
  page: Parameters<typeof test>[0]["page"],
  enabled: boolean,
): Promise<void> => {
  await page.evaluate(async (nextEnabled) => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setZenModeEnabled(nextEnabled);
  }, enabled);

  await expect(page.getByTestId("main-layout")).toHaveAttribute(
    "data-zen-mode",
    enabled ? "true" : "false",
  );
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
  await page.addInitScript(({ editorContent, panelLayoutState }) => {
    localStorage.clear();
    const editorPath = "/workspace/index.tsx";
    const defaultEditorContent = "export const ready = true;";
    const mountedEditorContent = editorContent ?? defaultEditorContent;
    const getMountedEditorContent = () =>
      (
        window as Window & {
          __arlecchinoTestEditorContent?: string;
        }
      ).__arlecchinoTestEditorContent ?? mountedEditorContent;
    const makeEditorInspection = (path: string, content: string) => {
      const lines = content.split("\n");
      return {
        path,
        name: path.split("/").pop() || path,
        sizeBytes: content.length,
        formattedSize: `${content.length} B`,
        isText: true,
        safeForEditor: true,
        largeDocument: false,
        reason: "safe for interactive editing",
        lineCount: content.length === 0 ? 1 : lines.length,
        maxLineLength: lines.reduce(
          (max, line) => Math.max(max, line.length),
          0,
        ),
        limitBytes: 2 * 1024 * 1024,
        lineLimit: 20_000,
        maxLineLengthLimit: 20_000,
      };
    };

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
              case "InspectEditorFile":
                return makeEditorInspection(
                  typeof _args[0] === "string" ? _args[0] : editorPath,
                  getMountedEditorContent(),
                );
              case "ReadFile":
                return getMountedEditorContent();
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

    if (editorContent) {
      localStorage.setItem(
        "editorTabs:/workspace",
        JSON.stringify({
          tabs: [{ path: editorPath, label: "index.tsx" }],
          activeTabId: "tab--workspace-index-tsx",
        }),
      );
    }
  }, options satisfies MountProjectUIOptions);
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
  await expect(
    page.getByTestId("topbar-item-search").getByRole("button", {
      name: "Search",
    }),
  ).toBeVisible({ timeout: 10000 });
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

type ReadableMotionSample = {
  clipOutsidePanel: number;
  effectiveReadableScaleX: number;
  effectiveReadableScaleY: number;
  fullscreenMotion: string;
  panelHeight: number;
  panelScaleX: number;
  panelScaleY: number;
  projectedScaleX: number;
  projectedScaleY: number;
  panelWidth: number;
  readableLayerClipGap: number;
  readableLayerClipOffset: number;
  readableLayerHeight: number;
  readableLayerOutsidePanel: number;
  readableLayerScaleX: number;
  readableLayerScaleY: number;
  readableLayerWidth: number;
  readableMotion: string;
};

type ReadableMotionTrigger =
  | { kind: "button"; title: string }
  | { actionId: string; kind: "menu-action" };

const collectReadableFullscreenMotionSamples = async (
  page: Parameters<typeof test>[0]["page"],
  options: {
    panelSelector: string;
    sampleCount?: number;
    trigger: ReadableMotionTrigger;
  },
): Promise<{
  samples: ReadableMotionSample[];
  start: { height: number; width: number; x: number; y: number };
  workspace: { height: number; width: number; x: number; y: number } | null;
} | null> => {
  return page.evaluate(async ({ panelSelector, sampleCount, trigger }) => {
    type RectSample = {
      bottom: number;
      height: number;
      left: number;
      right: number;
      top: number;
      width: number;
      x: number;
      y: number;
    };

    const readRect = (element: Element): RectSample => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    };
    const readScale = (element: Element): { x: number; y: number } => {
      const styles = window.getComputedStyle(element);
      if (styles.scale && styles.scale !== "none") {
        const [rawX = "1", rawY = rawX] = styles.scale.split(" ");
        return {
          x: Number.parseFloat(rawX) || 1,
          y: Number.parseFloat(rawY) || 1,
        };
      }
      if (styles.transform && styles.transform !== "none") {
        const matrix = new DOMMatrixReadOnly(styles.transform);
        return { x: matrix.a, y: matrix.d };
      }
      return { x: 1, y: 1 };
    };
    const readOutside = (inner: RectSample, outer: RectSample) =>
      Math.max(
        0,
        outer.left - inner.left,
        inner.right - outer.right,
        outer.top - inner.top,
        inner.bottom - outer.bottom,
      );
    const waitForFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const findPanel = () => document.querySelector<HTMLElement>(panelSelector);
    const panel = findPanel();
    const workspace = document.querySelector<HTMLElement>(
      '[data-testid="panel-workspace"]',
    );
    if (!panel) {
      return null;
    }

    const startRect = readRect(panel);
    const workspaceRect = workspace ? readRect(workspace) : null;
    const start = {
      height: startRect.height,
      width: startRect.width,
      x: startRect.x,
      y: startRect.y,
    };
    const workspaceSample = workspaceRect
      ? {
          height: workspaceRect.height,
          width: workspaceRect.width,
          x: workspaceRect.x,
          y: workspaceRect.y,
        }
      : null;

    if (trigger.kind === "button") {
      const button = Array.from(
        panel.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.title === trigger.title);
      if (!button) {
        return null;
      }
      button.click();
    } else {
      window.dispatchEvent(
        new CustomEvent("arlecchino:application-menu-action", {
          detail: { actionId: trigger.actionId },
        }),
      );
    }

    const samples: ReadableMotionSample[] = [];
    for (let index = 0; index < (sampleCount ?? 14); index += 1) {
      await waitForFrame();
      const currentPanel = findPanel();
      const currentReadableLayer = currentPanel?.querySelector<HTMLElement>(
        '[data-panel-readable-layer="true"]',
      );
      const currentReadableClip = currentPanel?.querySelector<HTMLElement>(
        '[data-panel-readable-clip="true"]',
      );
      if (!currentPanel || !currentReadableLayer || !currentReadableClip) {
        continue;
      }

      const panelRect = readRect(currentPanel);
      const clipRect = readRect(currentReadableClip);
      const readableLayerRect = readRect(currentReadableLayer);
      const panelScale = readScale(currentPanel);
      const readableLayerScale = readScale(currentReadableLayer);
      const projectedScaleX = Number.parseFloat(
        currentReadableLayer.style.getPropertyValue(
          "--panel-projected-scale-x",
        ) || "1",
      );
      const projectedScaleY = Number.parseFloat(
        currentReadableLayer.style.getPropertyValue(
          "--panel-projected-scale-y",
        ) || "1",
      );
      const readableLayerClipGap = Math.max(
        Math.abs(readableLayerRect.width - clipRect.width),
        Math.abs(readableLayerRect.height - clipRect.height),
      );
      const readableLayerClipOffset = Math.max(
        Math.abs(readableLayerRect.left - clipRect.left),
        Math.abs(readableLayerRect.top - clipRect.top),
      );
      samples.push({
        clipOutsidePanel: readOutside(clipRect, panelRect),
        effectiveReadableScaleX: panelScale.x * readableLayerScale.x,
        effectiveReadableScaleY: panelScale.y * readableLayerScale.y,
        fullscreenMotion: currentPanel.dataset.panelFullscreenMotion ?? "",
        panelHeight: panelRect.height,
        panelScaleX: panelScale.x,
        panelScaleY: panelScale.y,
        projectedScaleX,
        projectedScaleY,
        panelWidth: panelRect.width,
        readableLayerClipGap,
        readableLayerClipOffset,
        readableLayerHeight: readableLayerRect.height,
        readableLayerOutsidePanel: readOutside(readableLayerRect, panelRect),
        readableLayerScaleX: readableLayerScale.x,
        readableLayerScaleY: readableLayerScale.y,
        readableLayerWidth: readableLayerRect.width,
        readableMotion: currentReadableLayer.dataset.panelReadableMotion ?? "",
      });
    }

    return { samples, start, workspace: workspaceSample };
  }, options);
};

const expectReadableFullscreenMotionSafe = (
  samples: ReadableMotionSample[],
) => {
  const fullscreenSamples = samples.filter(
    (sample) => sample.fullscreenMotion === "true",
  );
  expect(fullscreenSamples.length).toBeGreaterThan(0);
  const scaledFullscreenSamples = fullscreenSamples.filter(
    (sample) =>
      Math.abs(sample.panelScaleX - 1) > 0.02 ||
      Math.abs(sample.panelScaleY - 1) > 0.02,
  );
  expect(scaledFullscreenSamples.length).toBeGreaterThan(0);

  for (const sample of scaledFullscreenSamples) {
    expect(sample.readableMotion).toBe("true");
    expect(Math.abs(sample.projectedScaleX - sample.panelScaleX)).toBeLessThan(
      0.08,
    );
    expect(Math.abs(sample.projectedScaleY - sample.panelScaleY)).toBeLessThan(
      0.08,
    );
    expect(Math.abs(sample.effectiveReadableScaleX - 1)).toBeLessThan(0.08);
    expect(Math.abs(sample.effectiveReadableScaleY - 1)).toBeLessThan(0.08);
    expect(sample.clipOutsidePanel).toBeLessThanOrEqual(2);
    expect(sample.readableLayerClipGap).toBeLessThanOrEqual(4);
    expect(sample.readableLayerClipOffset).toBeLessThanOrEqual(4);
  }
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

test("initial snapped panel renders content on first project mount", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.getByTestId("panel-explorer");
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-panel-content="true"]')).toHaveAttribute(
    "data-panel-content-ready",
    "true",
  );
});

test("snapped panel open expands the editor slot with the panel slide", async ({
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
        markdownPreview: false,
      },
      panelConfigs: {
        git: {
          position: "left",
          mode: "snapped",
          size: { width: 320, height: 0 },
          x: 0,
          y: 0,
        },
      },
    },
  });

  const editorArea = page.getByTestId("editor-area");
  const startBox = await editorArea.boundingBox();
  expect(startBox).not.toBeNull();

  const frames = await page.evaluate(async (startEditorX) => {
    const readTranslateX = (node: HTMLElement): number => {
      const styles = window.getComputedStyle(node);
      if (styles.translate && styles.translate !== "none") {
        return Number.parseFloat(styles.translate.split(" ")[0] ?? "0") || 0;
      }
      if (styles.transform && styles.transform !== "none") {
        return new DOMMatrixReadOnly(styles.transform).m41;
      }
      return 0;
    };

    const eventInit = {
      key: "g",
      code: "KeyG",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));

    const samples: Array<{
      editorShift: number;
      motion: string;
      panelWidth: number;
      translateX: number;
    }> = [];

    for (let index = 0; index < 8; index += 1) {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const panel = document.querySelector<HTMLElement>(
        '[data-testid="panel-git"]',
      );
      const editor = document.querySelector<HTMLElement>(
        '[data-testid="editor-area"]',
      );
      if (!panel || !editor) {
        continue;
      }

      samples.push({
        editorShift: editor.getBoundingClientRect().x - startEditorX,
        motion: panel.dataset.panelMotion ?? "",
        panelWidth: panel.getBoundingClientRect().width,
        translateX: readTranslateX(panel),
      });
    }

    return samples;
  }, startBox?.x ?? 0);

  await waitForPanelSettled(page, "panel-git");
  const finalBox = await editorArea.boundingBox();
  expect(finalBox).not.toBeNull();
  const finalShift = (finalBox?.x ?? 0) - (startBox?.x ?? 0);
  expect(finalShift).toBeGreaterThan(200);

  const enteringFrame = frames.find(
    (frame) =>
      frame.motion === "enter" &&
      Math.abs(frame.translateX) > frame.panelWidth * 0.2 &&
      frame.editorShift > 8,
  );
  expect(enteringFrame).toBeTruthy();
  expect((enteringFrame?.editorShift ?? 0) / finalShift).toBeLessThan(0.92);
});

test("floating code panel opens fullscreen with shared panel motion", async ({
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
        markdownPreview: false,
      },
    },
  });

  await page.evaluate(() => {
    (
      window as Window & {
        runtime: { EventsEmit: (eventName: string, payload: unknown) => void };
      }
    ).runtime.EventsEmit("ide:panel:open", {
      panel: "code",
      path: "/workspace/code-panel-fullscreen.ts",
      content: "export const codePanelFullscreen = true;",
      line: 1,
      mode: "floating",
      x: 96,
      y: 96,
      width: 520,
      height: 320,
    });
  });

  const codePanel = page.getByTestId("panel-code").last();
  await expect(codePanel).toBeVisible();
  await expect(codePanel.locator(".cm-content")).toContainText(
    "codePanelFullscreen",
  );

  const motionSamples = await collectReadableFullscreenMotionSamples(page, {
    panelSelector: '[data-testid="panel-code"]',
    trigger: { kind: "button", title: "Fullscreen" },
  });

  if (!motionSamples) {
    throw new Error("Code panel fullscreen motion should be measurable");
  }
  expectReadableFullscreenMotionSafe(motionSamples.samples);
  const workspace = motionSamples.workspace;
  expect(workspace).not.toBeNull();
  if (!workspace) {
    throw new Error("Panel workspace should be measurable");
  }
  expect(
    motionSamples.samples.some(
      (sample) =>
        sample.panelWidth > motionSamples.start.width + 80 &&
        sample.panelWidth < workspace.width - 40,
    ),
  ).toBe(true);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="panel-code"]',
        );
        const workspace = document.querySelector<HTMLElement>(
          '[data-testid="panel-workspace"]',
        );
        if (!panel || !workspace) {
          return false;
        }
        const panelRect = panel.getBoundingClientRect();
        const workspaceRect = workspace.getBoundingClientRect();
        return (
          panelRect.width >= workspaceRect.width - 8 &&
          panelRect.height >= workspaceRect.height - 8
        );
      }),
    )
    .toBe(true);
});

test("AI Chat fullscreen shortcut keeps readable content clipped", async ({
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
        markdownPreview: false,
      },
    },
  });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "ai.toggle" },
      }),
    );
  });

  const chatPanel = page.locator('[data-testid="panel-aiChat"]').last();
  await expect(chatPanel).toBeVisible();
  await waitForPanelSettled(page, "panel-aiChat");

  const motionSamples = await collectReadableFullscreenMotionSamples(page, {
    panelSelector: '[data-testid="panel-aiChat"]',
    trigger: { kind: "menu-action", actionId: "ai.fullscreen" },
  });

  if (!motionSamples) {
    throw new Error("AI Chat fullscreen shortcut motion should be measurable");
  }
  expectReadableFullscreenMotionSafe(motionSamples.samples);
});

test("AI Chat fullscreen shortcuts route to chat history search and review", async ({
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
        markdownPreview: false,
      },
    },
  });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "ai.fullscreen" },
      }),
    );
  });

  await expect(
    page.locator('[data-testid="panel-aiChat"]').last(),
  ).toBeVisible();
  await waitForPanelSettled(page, "panel-aiChat");

  await page.keyboard.press("Meta+D");
  await expect(page.getByTestId("ai-chat-history-drawer")).toBeVisible();

  await page.keyboard.press("Meta+F");
  await expect(page.getByTestId("ai-chat-session-search")).toBeFocused();

  await page.keyboard.press("Meta+G");
  await expect(page.getByTestId("ai-chat-review-drawer")).toBeVisible();
  await expect(page.locator('[data-testid="panel-git"]')).toHaveCount(0);

  await page.keyboard.press("Meta+Shift+G");
  await expect(page.getByTestId("ai-chat-review-expanded")).toBeVisible();
  await expect(page.locator('[data-testid="panel-git"]')).toHaveCount(0);
});

test("Git fullscreen restore keeps readable content filling the projected frame", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: false,
        aiChat: true,
        git: false,
        problems: true,
        code: false,
        markdownPreview: false,
      },
      panelConfigs: {
        aiChat: {
          position: "right",
          mode: "snapped",
          size: { width: 360, height: 0 },
          x: 0,
          y: 0,
        },
        problems: {
          position: "left",
          mode: "snapped",
          size: { width: 520, height: 0 },
          x: 0,
          y: 0,
        },
        git: {
          position: "left",
          mode: "snapped",
          size: { width: 520, height: 0 },
          x: 0,
          y: 0,
        },
      },
    },
  });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "git.fullscreen" },
      }),
    );
  });

  const gitPanel = page.locator('[data-testid="panel-git"]').last();
  await expect(gitPanel).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="panel-git"]',
        );
        const workspace = document.querySelector<HTMLElement>(
          '[data-testid="panel-workspace"]',
        );
        if (!panel || !workspace) {
          return false;
        }
        const panelRect = panel.getBoundingClientRect();
        const workspaceRect = workspace.getBoundingClientRect();
        return (
          panelRect.width >= workspaceRect.width - 8 &&
          panelRect.height >= workspaceRect.height - 8
        );
      }),
    )
    .toBe(true);

  const motionSamples = await collectReadableFullscreenMotionSamples(page, {
    panelSelector: '[data-testid="panel-git"]',
    trigger: { kind: "button", title: "Fullscreen" },
  });

  if (!motionSamples) {
    throw new Error("Git fullscreen restore motion should be measurable");
  }
  expectReadableFullscreenMotionSafe(motionSamples.samples);
});

test("light theme readable layer does not leave a fullscreen trail", async ({
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
        markdownPreview: false,
      },
    },
  });

  await page.evaluate(async () => {
    const { getThemeDefinition } = await import("/src/styles/themes.ts");
    const nextTheme = getThemeDefinition("arlecchino-light");
    const htmlElement = document.documentElement;

    Object.entries(nextTheme.cssVariables).forEach(([name, value]) => {
      htmlElement.style.setProperty(name, value);
    });

    htmlElement.classList.remove("light", "dark");
    htmlElement.classList.add("light");
    htmlElement.dataset.theme = nextTheme.id;
    htmlElement.dataset.themeAppearance = nextTheme.appearance;
    localStorage.setItem("arlecchino-theme", nextTheme.id);
  });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "ai.toggle" },
      }),
    );
  });

  const chatPanel = page.locator('[data-testid="panel-aiChat"]').last();
  await expect(chatPanel).toBeVisible();
  await waitForPanelSettled(page, "panel-aiChat");

  const motionSamples = await collectReadableFullscreenMotionSamples(page, {
    panelSelector: '[data-testid="panel-aiChat"]',
    trigger: { kind: "button", title: "Fullscreen" },
  });

  if (!motionSamples) {
    throw new Error("Light theme fullscreen trail motion should be measurable");
  }
  expectReadableFullscreenMotionSafe(motionSamples.samples);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="panel-aiChat"]',
        );
        return panel?.dataset.panelFullscreenMotion ?? "";
      }),
    )
    .toBe("false");

  await chatPanel.locator('button[title="Close panel"]').click();
  await expect(page.locator('[data-testid="panel-aiChat"]')).toHaveCount(0);
  await expect(page.locator('[data-panel-readable-layer="true"]')).toHaveCount(
    0,
  );
});

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

const readElementRect = async (
  page: Parameters<typeof test>[0]["page"],
  selector: string,
): Promise<{
  height: number;
  width: number;
  x: number;
  y: number;
} | null> => {
  return page.evaluate((targetSelector) => {
    const node = document.querySelector<HTMLElement>(targetSelector);
    if (!node) {
      return null;
    }

    const rect = node.getBoundingClientRect();
    return {
      height: rect.height,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    };
  }, selector);
};

const readNoDragStyles = async (
  page: Parameters<typeof test>[0]["page"],
  selector: string,
): Promise<{ webkitAppRegion: string; wailsDraggable: string }> => {
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
};

const readPanelResizeCleanupState = async (
  page: Parameters<typeof test>[0]["page"],
  panelTestId: string,
): Promise<{
  contentPointerEvents: string;
  cursor: string;
  cursorOwner: string;
  isResizing: boolean;
  userSelect: string;
}> => {
  return page.evaluate((targetPanelTestId) => {
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>(
        `[data-testid="${targetPanelTestId}"]`,
      ),
    );
    const panel = panels[panels.length - 1] ?? null;
    const content =
      panel?.querySelector<HTMLElement>('[data-panel-content="true"]') ?? null;

    return {
      contentPointerEvents: content?.style.pointerEvents ?? "",
      cursor: document.body.style.cursor,
      cursorOwner: document.body.getAttribute("data-arle-cursor-owner") ?? "",
      isResizing: panel?.dataset.panelState === "resizing",
      userSelect: document.body.style.userSelect,
    };
  }, panelTestId);
};

const readPanelResizeHoverState = async (
  page: Parameters<typeof test>[0]["page"],
  panelTestId: string,
  handleTestId: string,
): Promise<{
  computedCursor: string;
  handleWidth: number;
  hitResizeHandle: string;
  hitTestId: string;
}> => {
  return page.evaluate(
    ({ panelTestId, handleTestId }) => {
      const panels = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-testid="${panelTestId}"]`,
        ),
      );
      const panel = panels[panels.length - 1] ?? null;
      const handles = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-testid="${handleTestId}"]`,
        ),
      );
      const handle = handles[handles.length - 1] ?? null;
      if (!panel || !handle) {
        return {
          computedCursor: "",
          handleWidth: 0,
          hitResizeHandle: "",
          hitTestId: "",
        };
      }

      const panelRect = panel.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(
        panelRect.right - 18,
        panelRect.top + panelRect.height / 2,
      ) as HTMLElement | null;
      const hitHandle = hitTarget?.closest<HTMLElement>(
        '[data-panel-resize-handle="true"]',
      );
      const hitTestElement = hitTarget?.closest<HTMLElement>("[data-testid]");

      return {
        computedCursor: getComputedStyle(handle).cursor,
        handleWidth: Math.round(handleRect.width),
        hitResizeHandle:
          hitHandle?.getAttribute("data-panel-resize-handle") ?? "",
        hitTestId: hitTestElement?.dataset.testid ?? "",
      };
    },
    { panelTestId, handleTestId },
  );
};

const startSyntheticPanelResize = async (
  page: Parameters<typeof test>[0]["page"],
  handleTestId: string,
  pointerId: number,
): Promise<void> => {
  const handleBox = await page.getByTestId(handleTestId).boundingBox();
  expect(handleBox).not.toBeNull();

  await page.evaluate(
    ({ handleTestId, pointerId, x, y }) => {
      const handle = document.querySelector<HTMLElement>(
        `[data-testid="${handleTestId}"]`,
      );
      if (!handle) {
        throw new Error(`Missing resize handle ${handleTestId}`);
      }

      const base = {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      } as const;

      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...base,
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: y,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          ...base,
          button: 0,
          buttons: 1,
          clientX: x + 36,
          clientY: y,
        }),
      );
    },
    {
      handleTestId,
      pointerId,
      x: (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
      y: (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
    },
  );
};

const expectRectStable = (
  current: Awaited<ReturnType<typeof readElementRect>>,
  baseline: Awaited<ReturnType<typeof readElementRect>>,
  tolerance = 1,
) => {
  expect(current).not.toBeNull();
  expect(baseline).not.toBeNull();
  expect(Math.abs((current?.x ?? 0) - (baseline?.x ?? 0))).toBeLessThanOrEqual(
    tolerance,
  );
  expect(Math.abs((current?.y ?? 0) - (baseline?.y ?? 0))).toBeLessThanOrEqual(
    tolerance,
  );
  expect(
    Math.abs((current?.width ?? 0) - (baseline?.width ?? 0)),
  ).toBeLessThanOrEqual(tolerance);
  expect(
    Math.abs((current?.height ?? 0) - (baseline?.height ?? 0)),
  ).toBeLessThanOrEqual(tolerance);
};

const openLargeEditorContent = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.evaluate((content) => {
    (
      window as Window & {
        __arlecchinoTestEditorContent?: string;
        runtime: { EventsEmit: (eventName: string, payload: unknown) => void };
      }
    ).__arlecchinoTestEditorContent = content;
    (
      window as Window & {
        runtime: { EventsEmit: (eventName: string, payload: unknown) => void };
      }
    ).runtime.EventsEmit("ide:editor:open", {
      path: "/workspace/index.tsx",
    });
  }, largeEditorContent);

  await expect(page.locator(".cm-editor").first()).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator(".cm-scroller")
        .first()
        .evaluate((scroller) => scroller.scrollHeight > scroller.clientHeight),
    )
    .toBe(true);
};

const collectSnappedEditorGeometryFrames = async (
  page: Parameters<typeof test>[0]["page"],
  panelTestId: string,
  frameCount = 8,
): Promise<
  Array<{
    cmEditor: { height: number; width: number; x: number; y: number } | null;
    editor: { height: number; width: number; x: number; y: number } | null;
    panel: { height: number; width: number; x: number; y: number } | null;
    scroller: { height: number; width: number; x: number; y: number } | null;
    slot: {
      height: number;
      overflow: string;
      width: number;
      x: number;
      y: number;
    } | null;
  }>
> => {
  return page.evaluate(
    async ({ frameCount, panelTestId }) => {
      type RectSample = {
        height: number;
        width: number;
        x: number;
        y: number;
      };
      const waitForFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const readRect = (element: Element | null): RectSample | null => {
        if (!element) {
          return null;
        }

        const rect = element.getBoundingClientRect();
        return {
          height: Math.round(rect.height * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          x: Math.round(rect.x * 100) / 100,
          y: Math.round(rect.y * 100) / 100,
        };
      };
      const readFrame = () => {
        const panel = document.querySelector<HTMLElement>(
          `[data-testid="${panelTestId}"]`,
        );
        const slot = panel?.parentElement ?? null;
        const editor = document.querySelector<HTMLElement>(
          '[data-testid="editor-area"]',
        );
        const cmEditor = document.querySelector<HTMLElement>(".cm-editor");
        const scroller = document.querySelector<HTMLElement>(".cm-scroller");
        return {
          cmEditor: readRect(cmEditor),
          editor: readRect(editor),
          panel: readRect(panel),
          scroller: readRect(scroller),
          slot: slot
            ? {
                ...readRect(slot)!,
                overflow: window.getComputedStyle(slot).overflow,
              }
            : null,
        };
      };
      const samples: ReturnType<typeof readFrame>[] = [];

      for (let index = 0; index < frameCount; index += 1) {
        await waitForFrame();
        samples.push(readFrame());
      }

      return samples;
    },
    { frameCount, panelTestId },
  );
};

const collectCodeMirrorScrollGeometryFrames = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<
  Array<{
    cmEditor: { height: number; left: number; top: number; width: number };
    content: { left: number; width: number };
    editor: { height: number; left: number; top: number; width: number };
    gutters: { height: number; left: number; top: number; width: number };
    scroller: { height: number; left: number; top: number; width: number };
    scrollTop: number;
  }>
> => {
  return page
    .locator(".cm-scroller")
    .first()
    .evaluate(async (scroller) => {
      type BoxSample = {
        height: number;
        left: number;
        top: number;
        width: number;
      };
      const cmEditor = scroller.closest<HTMLElement>(".cm-editor");
      const editor = document.querySelector<HTMLElement>(
        '[data-testid="editor-area"]',
      );
      const gutters = cmEditor?.querySelector<HTMLElement>(".cm-gutters");
      const content = cmEditor?.querySelector<HTMLElement>(".cm-content");
      if (!cmEditor || !editor || !gutters || !content) {
        throw new Error("CodeMirror geometry nodes were not mounted");
      }

      const waitForFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const readBox = (element: HTMLElement): BoxSample => {
        const rect = element.getBoundingClientRect();
        return {
          height: Math.round(rect.height * 100) / 100,
          left: Math.round(rect.left * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
        };
      };
      const readFrame = () => ({
        cmEditor: readBox(cmEditor),
        content: {
          left: readBox(content).left,
          width: readBox(content).width,
        },
        editor: readBox(editor),
        gutters: readBox(gutters),
        scroller: readBox(scroller),
        scrollTop: scroller.scrollTop,
      });
      const samples = [readFrame()];
      const scrollTargets = [160, 420, 760, 280, 920];

      for (const target of scrollTargets) {
        scroller.scrollTop = target;
        scroller.dispatchEvent(new Event("scroll"));
        await waitForFrame();
        samples.push(readFrame());
      }

      return samples;
    });
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
  expectedSize?: { width: number; height: number },
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
    .toBeGreaterThan(0.82);

  const exitFrame = await readPanelFrame(page, selector);
  expect(exitFrame).not.toBeNull();
  expect(exitFrame?.motion).toBe("exit");
  expect(exitFrame?.parentOverflow).toBe("visible");
  if (expectedSize) {
    expect(
      Math.abs((exitFrame?.width ?? 0) - expectedSize.width),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs((exitFrame?.height ?? 0) - expectedSize.height),
    ).toBeLessThanOrEqual(2);
  }
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

  await panel.locator('button[title="Close panel"]').click();
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
      .toBeGreaterThan(0.82);
  } else {
    await expect
      .poll(async () => {
        const frame = await readPanelFrame(page, '[data-testid="panel-git"]');
        if (!frame) {
          return 0;
        }
        return Math.abs(frame.translateY) / frame.height;
      })
      .toBeGreaterThan(0.82);
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
    await expect
      .poll(async () => {
        const frame = await readPanelFrame(page, '[data-testid="panel-git"]');
        if (!frame) {
          return Number.POSITIVE_INFINITY;
        }
        return Math.max(Math.abs(frame.translateX), Math.abs(frame.translateY));
      })
      .toBeLessThanOrEqual(2);
    const panelBeforeClose = await panel.boundingBox();
    expect(panelBeforeClose).not.toBeNull();
    const editorBeforeClose = await readElementBox(
      page,
      '[data-testid="editor-area"]',
    );
    expect(editorBeforeClose).not.toBeNull();

    const closeFrames = await page.evaluate(async () => {
      const panelSelector = '[data-testid="panel-git"]';
      const readFrame = () => {
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

        return {
          motion: node.dataset.panelMotion ?? "",
          translateX,
          translateY,
        };
      };

      document
        .querySelector<HTMLButtonElement>(
          `${panelSelector} button[title="Close panel"]`,
        )
        ?.click();

      const frames: ReturnType<typeof readFrame>[] = [];
      for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
        frames.push(readFrame());
      }
      return frames;
    });
    const firstExitFrame = closeFrames.find(
      (frame): frame is NonNullable<(typeof closeFrames)[number]> =>
        frame !== null,
    );
    expect(firstExitFrame).not.toBeNull();
    expect(firstExitFrame?.motion).toBe("exit");
    expect(Math.abs(firstExitFrame?.translateX ?? 0)).toBeLessThanOrEqual(8);
    expect(Math.abs(firstExitFrame?.translateY ?? 0)).toBeLessThanOrEqual(8);
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
      .toBeGreaterThan(0.82);

    const exitFrame = await readPanelFrame(page, '[data-testid="panel-git"]');
    expect(exitFrame?.motion).toBe("exit");
    expect(exitFrame?.parentOverflow).toBe("visible");
    expect(
      Math.abs((exitFrame?.width ?? 0) - (panelBeforeClose?.width ?? 0)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs((exitFrame?.height ?? 0) - (panelBeforeClose?.height ?? 0)),
    ).toBeLessThanOrEqual(2);
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
    const editorAfterClose = await readElementBox(
      page,
      '[data-testid="editor-area"]',
    );
    expect(editorAfterClose).not.toBeNull();
    if (position === "left" || position === "right") {
      expect(editorAfterClose?.width ?? 0).toBeGreaterThan(
        (editorBeforeClose?.width ?? 0) + 4,
      );
    } else {
      expect(editorAfterClose?.height ?? 0).toBeGreaterThan(
        (editorBeforeClose?.height ?? 0) + 4,
      );
    }
  });
}

test("snapped terminal shortcut close preserves panel size during exit", async ({
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
        markdownPreview: false,
      },
      panelConfigs: {
        terminal: {
          position: "bottom",
          mode: "snapped",
          size: { width: 0, height: 260 },
          x: 0,
          y: 0,
        },
      },
    },
  });

  const terminalPanel = page.locator('[data-testid="panel-terminal"]').last();
  await expect(terminalPanel).toBeVisible();
  await waitForPanelSettled(page, "panel-terminal");
  const panelBeforeClose = await terminalPanel.boundingBox();
  expect(panelBeforeClose).not.toBeNull();

  const closeFrames = await page.evaluate(async () => {
    const readFrame = () => {
      const node = document.querySelector<HTMLElement>(
        '[data-testid="panel-terminal"]',
      );
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      const styles = window.getComputedStyle(node);
      return {
        cssPosition: styles.position,
        height: rect.height,
        motion: node.dataset.panelMotion ?? "",
        state: node.dataset.panelState ?? "",
        width: rect.width,
      };
    };

    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "terminal.toggle" },
      }),
    );

    const frames: ReturnType<typeof readFrame>[] = [];
    for (let frameIndex = 0; frameIndex < 8; frameIndex += 1) {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      frames.push(readFrame());
    }
    return frames;
  });

  expect(closeFrames.filter(Boolean).length).toBeGreaterThan(0);
  expect(
    closeFrames.some(
      (frame) => frame?.motion === "exit" || frame?.state === "exiting",
    ),
  ).toBe(true);
  for (const frame of closeFrames) {
    if (!frame) {
      continue;
    }
    if (frame.motion !== "exit" && frame.state !== "exiting") {
      continue;
    }
    expect(frame.cssPosition).toBe("absolute");
    expect(
      Math.abs(frame.width - (panelBeforeClose?.width ?? 0)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(frame.height - (panelBeforeClose?.height ?? 0)),
    ).toBeLessThanOrEqual(2);
  }

  await page.waitForTimeout(80);

  const exitFrame = await readPanelFrame(
    page,
    '[data-testid="panel-terminal"]',
  );
  expect(exitFrame).not.toBeNull();
  expect(exitFrame?.motion).toBe("exit");
  expect(
    Math.abs((exitFrame?.width ?? 0) - (panelBeforeClose?.width ?? 0)),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs((exitFrame?.height ?? 0) - (panelBeforeClose?.height ?? 0)),
  ).toBeLessThanOrEqual(2);
  expectDirectionalSlide(exitFrame, "bottom");

  await expect(terminalPanel).toHaveCount(0);
});

test("snapped right chat panel close keeps frozen bounds while the slot collapses", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: false,
        aiChat: true,
        git: false,
        problems: false,
        code: false,
        markdownPreview: false,
      },
      panelConfigs: {
        aiChat: {
          position: "right",
          mode: "snapped",
          size: { width: 360, height: 0 },
          x: 0,
          y: 0,
        },
      },
    },
  });
  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(1.2);
  });
  await nextAnimationFrame(page);

  const chatPanel = page.locator('[data-testid="panel-aiChat"]').last();
  await expect(chatPanel).toBeVisible();
  await waitForPanelSettled(page, "panel-aiChat");
  const panelBeforeClose = await chatPanel.boundingBox();
  expect(panelBeforeClose).not.toBeNull();

  const closeFrames = await page.evaluate(async () => {
    const panelSelector = '[data-testid="panel-aiChat"]';
    const readFrame = () => {
      const node = document.querySelector<HTMLElement>(panelSelector);
      if (!node) {
        return null;
      }

      const rect = node.getBoundingClientRect();
      const styles = window.getComputedStyle(node);
      return {
        cssLeft: Number.parseFloat(styles.left) || 0,
        cssPosition: styles.position,
        cssTop: Number.parseFloat(styles.top) || 0,
        height: rect.height,
        motion: node.dataset.panelMotion ?? "",
        state: node.dataset.panelState ?? "",
        width: rect.width,
      };
    };

    document
      .querySelector<HTMLButtonElement>(
        `${panelSelector} button[title="Close panel"]`,
      )
      ?.click();

    const frames: ReturnType<typeof readFrame>[] = [];
    for (let frameIndex = 0; frameIndex < 10; frameIndex += 1) {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      frames.push(readFrame());
    }
    return frames;
  });

  const measuredFrames = closeFrames.filter(
    (frame): frame is NonNullable<(typeof closeFrames)[number]> =>
      frame !== null,
  );
  expect(measuredFrames.length).toBeGreaterThan(2);
  expect(
    measuredFrames.some(
      (frame) => frame.motion === "exit" || frame.state === "exiting",
    ),
  ).toBe(true);

  for (const frame of measuredFrames) {
    expect(frame.cssPosition).toBe("absolute");
    expect(
      Math.abs(frame.width - (panelBeforeClose?.width ?? 0)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(frame.height - (panelBeforeClose?.height ?? 0)),
    ).toBeLessThanOrEqual(2);
  }

  await page.waitForTimeout(80);

  const exitFrame = await readPanelFrame(page, '[data-testid="panel-aiChat"]');
  expect(exitFrame).not.toBeNull();
  expect(exitFrame?.motion).toBe("exit");
  expectDirectionalSlide(exitFrame, "right");

  await expect(chatPanel).toHaveCount(0);
});

test("snapped top panel close keeps its size with adjacent panels mounted", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: true,
        aiChat: false,
        git: true,
        problems: true,
        code: false,
        markdownPreview: false,
      },
      panelConfigs: {
        terminal: {
          position: "right",
          mode: "snapped",
          size: { width: 320, height: 0 },
          x: 0,
          y: 0,
        },
        git: {
          position: "bottom",
          mode: "snapped",
          size: { width: 0, height: 240 },
          x: 0,
          y: 0,
        },
        problems: {
          position: "top",
          mode: "snapped",
          size: { width: 0, height: 240 },
          x: 0,
          y: 0,
        },
      },
    },
  });

  const problemsPanel = page.locator('[data-testid="panel-problems"]').last();
  const editorArea = page.getByTestId("editor-area");
  await expect(problemsPanel).toBeVisible();
  await expect(page.locator('[data-testid="panel-git"]').last()).toBeVisible();
  await expect(
    page.locator('[data-testid="panel-terminal"]').last(),
  ).toBeVisible();
  await waitForPanelSettled(page, "panel-problems");
  const panelBeforeClose = await problemsPanel.boundingBox();
  const editorBeforeClose = await editorArea.boundingBox();
  expect(panelBeforeClose).not.toBeNull();
  expect(editorBeforeClose).not.toBeNull();

  const closeFrames = await page.evaluate(async () => {
    const panelSelector = '[data-testid="panel-problems"]';
    const readFrame = () => {
      const node = document.querySelector<HTMLElement>(panelSelector);
      const editor = document.querySelector<HTMLElement>(
        '[data-testid="editor-area"]',
      );
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      const editorRect = editor?.getBoundingClientRect() ?? null;
      const styles = window.getComputedStyle(node);
      return {
        cssPosition: styles.position,
        editorHeight: editorRect?.height ?? 0,
        height: rect.height,
        motion: node.dataset.panelMotion ?? "",
        state: node.dataset.panelState ?? "",
        width: rect.width,
      };
    };

    document
      .querySelector<HTMLButtonElement>(
        `${panelSelector} button[title="Close panel"]`,
      )
      ?.click();

    const frames: ReturnType<typeof readFrame>[] = [];
    for (let frameIndex = 0; frameIndex < 10; frameIndex += 1) {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      frames.push(readFrame());
    }
    return frames;
  });

  const measuredFrames = closeFrames.filter(
    (frame): frame is NonNullable<(typeof closeFrames)[number]> =>
      frame !== null,
  );
  expect(measuredFrames.length).toBeGreaterThan(2);
  expect(
    measuredFrames.some(
      (frame) => frame.motion === "exit" || frame.state === "exiting",
    ),
  ).toBe(true);

  for (const frame of measuredFrames) {
    expect(frame.cssPosition).toBe("absolute");
    expect(
      Math.abs(frame.width - (panelBeforeClose?.width ?? 0)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(frame.height - (panelBeforeClose?.height ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(
    measuredFrames.some(
      (frame) => frame.editorHeight > (editorBeforeClose?.height ?? 0) + 20,
    ),
  ).toBe(true);

  await expect(problemsPanel).toHaveCount(0);
});

test("snapped panel keeps slide motion while indexing and diagnostics preload are active", async ({
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
        markdownPreview: false,
      },
    },
  });

  await page.evaluate(async () => {
    const { activateProjectScope } =
      await import("/src/utils/projectBoundState.ts");
    activateProjectScope("/workspace");
    const runtimeWindow = window as Window & {
      runtime: { EventsEmit: (eventName: string, payload: unknown) => void };
    };
    runtimeWindow.runtime.EventsEmit("indexer:started", {
      current: 0,
      total: 500,
      queueDepth: 240,
      projectFileCount: 7500,
      sessionId: "main",
    });
    runtimeWindow.runtime.EventsEmit("lsp:diagnostics:preload:start", {
      projectPath: "/workspace",
      generation: 1,
      selectedCandidates: 4,
      totalCandidates: 8,
      sessionId: "main",
    });
  });

  const panel = page.locator('[data-testid="panel-git"]');
  await openGitPanel(page);
  await expect(panel).toBeAttached();

  const openingFrame = await readPanelFrame(page, '[data-testid="panel-git"]');
  expect(openingFrame).not.toBeNull();
  expect(openingFrame?.motion).toBe("enter");

  const panelPosition = await panel.getAttribute("data-panel-position");
  await waitForPanelSettled(page, "panel-git");
  await panel.locator('button[title="Close panel"]').click();

  await expectSnappedPanelCloseMotion(
    page,
    '[data-testid="panel-git"]',
    panelPosition as "left" | "right" | "top" | "bottom",
  );
});

test("first snapped panel open warms content after the enter frame", async ({
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
        markdownPreview: false,
      },
    },
  });

  const panel = page.locator('[data-testid="panel-git"]');
  const panelContent = panel.locator('[data-panel-content="true"]');

  await openGitPanel(page);
  await expect(panel).toBeAttached();
  expect(await panelContent.getAttribute("data-panel-content-ready")).toBe(
    "false",
  );

  await waitForPanelSettled(page, "panel-git");
  await expect(panelContent).toHaveAttribute(
    "data-panel-content-ready",
    "true",
  );

  await page.keyboard.press("Meta+G");
  await expect(panel).toHaveCount(0);

  await openGitPanel(page);
  await expect(panel).toBeAttached();
  await expect(panelContent).toHaveAttribute(
    "data-panel-content-ready",
    "true",
  );
});

test("snapped panel close control matches shortcut exit geometry", async ({
  page,
}) => {
  for (const position of ["left", "right", "top", "bottom"] as const) {
    await mountHiddenGitPanelAtPosition(page, position);
    const panel = page.locator('[data-testid="panel-git"]');
    const closeControlStart = await readPanelFrame(
      page,
      '[data-testid="panel-git"]',
    );
    expect(closeControlStart).not.toBeNull();

    await panel.locator('button[title="Close panel"]').click();
    await expectSnappedPanelCloseMotion(
      page,
      '[data-testid="panel-git"]',
      position,
      {
        width: closeControlStart?.width ?? 0,
        height: closeControlStart?.height ?? 0,
      },
    );

    await mountHiddenGitPanelAtPosition(page, position);
    const shortcutStart = await readPanelFrame(
      page,
      '[data-testid="panel-git"]',
    );
    expect(shortcutStart).not.toBeNull();

    await page.keyboard.press("Meta+G");
    await expectSnappedPanelCloseMotion(
      page,
      '[data-testid="panel-git"]',
      position,
      {
        width: shortcutStart?.width ?? 0,
        height: shortcutStart?.height ?? 0,
      },
    );
  }
});

test("close control stays above the snapped resize rail", async ({ page }) => {
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
          position: "bottom",
          mode: "snapped",
          size: { width: 0, height: 220 },
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

  const closeButton = panel.locator('button[title="Close panel"]');
  const closeButtonBox = await closeButton.boundingBox();
  expect(closeButtonBox).not.toBeNull();
  if (!closeButtonBox) {
    throw new Error("Close button should be measurable");
  }

  await page.mouse.click(
    closeButtonBox.x + closeButtonBox.width / 2,
    closeButtonBox.y + 4,
  );

  await expectSnappedPanelCloseMotion(
    page,
    '[data-testid="panel-git"]',
    "bottom",
  );
});

for (const position of ["top", "bottom"] as const) {
  test(`snapped ${position} panel keeps editor geometry stable during open and scroll`, async ({
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
          markdownPreview: false,
        },
        panelConfigs: {
          git: {
            position,
            mode: "snapped",
            size: { width: 0, height: 220 },
            x: 0,
            y: 0,
          },
        },
      },
    });
    await openLargeEditorContent(page);

    const panel = page.locator('[data-testid="panel-git"]');
    await openGitPanel(page);
    await expect(panel).toBeAttached();

    const openingFrames = await collectSnappedEditorGeometryFrames(
      page,
      "panel-git",
    );

    for (const frame of openingFrames) {
      expect(frame.panel).not.toBeNull();
      expect(frame.slot).not.toBeNull();
      expect(frame.editor).not.toBeNull();
      expect(frame.cmEditor).not.toBeNull();
      expect(frame.scroller).not.toBeNull();
      expect(frame.slot?.height ?? 0).toBeGreaterThan(24);
      expect(frame.slot?.overflow).toBe("hidden");
      expect(boxesOverlap(frame.panel, frame.editor)).toBe(false);

      if (position === "top") {
        expect(
          (frame.slot?.y ?? 0) + (frame.slot?.height ?? 0),
        ).toBeLessThanOrEqual((frame.editor?.y ?? 0) + 1);
      } else {
        expect(
          (frame.editor?.y ?? 0) + (frame.editor?.height ?? 0),
        ).toBeLessThanOrEqual((frame.slot?.y ?? 0) + 1);
      }

      expect(frame.cmEditor?.x ?? 0).toBeGreaterThanOrEqual(
        (frame.editor?.x ?? 0) - 1,
      );
      expect(
        (frame.cmEditor?.x ?? 0) + (frame.cmEditor?.width ?? 0),
      ).toBeLessThanOrEqual(
        (frame.editor?.x ?? 0) + (frame.editor?.width ?? 0) + 1,
      );
      expect(frame.scroller?.x ?? 0).toBeGreaterThanOrEqual(
        (frame.editor?.x ?? 0) - 1,
      );
      expect(
        (frame.scroller?.x ?? 0) + (frame.scroller?.width ?? 0),
      ).toBeLessThanOrEqual(
        (frame.editor?.x ?? 0) + (frame.editor?.width ?? 0) + 1,
      );
    }

    await waitForPanelSettled(page, "panel-git");

    const scrollFrames = await collectCodeMirrorScrollGeometryFrames(page);
    const baseline = scrollFrames[0];
    const stableBoxKeys = ["cmEditor", "editor", "scroller"] as const;
    const stableMetrics = ["height", "left", "top", "width"] as const;
    const maxStableDelta = scrollFrames.slice(1).reduce((maxDelta, frame) => {
      const frameDelta = stableBoxKeys.reduce((boxMaxDelta, key) => {
        const metricDelta = stableMetrics.reduce((metricMaxDelta, metric) => {
          const delta = Math.abs(frame[key][metric] - baseline[key][metric]);
          return Math.max(metricMaxDelta, delta);
        }, 0);
        return Math.max(boxMaxDelta, metricDelta);
      }, 0);
      return Math.max(maxDelta, frameDelta);
    }, 0);
    const maxContentInlineDelta = scrollFrames
      .slice(1)
      .reduce((maxDelta, frame) => {
        const leftDelta = Math.abs(frame.content.left - baseline.content.left);
        const widthDelta = Math.abs(
          frame.content.width - baseline.content.width,
        );
        const gutterLeftDelta = Math.abs(
          frame.gutters.left - baseline.gutters.left,
        );
        const gutterWidthDelta = Math.abs(
          frame.gutters.width - baseline.gutters.width,
        );
        return Math.max(
          maxDelta,
          leftDelta,
          widthDelta,
          gutterLeftDelta,
          gutterWidthDelta,
        );
      }, 0);

    expect(scrollFrames.at(-1)?.scrollTop ?? 0).toBeGreaterThan(
      baseline.scrollTop,
    );
    expect(maxStableDelta).toBeLessThanOrEqual(1);
    expect(maxContentInlineDelta).toBeLessThanOrEqual(1);
  });
}

test("zen mode does not render panel edge hover or reveal unpinned snapped panels", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: true,
        terminal: false,
        aiChat: true,
        git: true,
        problems: true,
        code: false,
      },
      panelConfigs: {
        explorer: {
          position: "left",
          mode: "snapped",
          size: { width: 260, height: 0 },
          x: 0,
          y: 0,
        },
        git: {
          position: "right",
          mode: "snapped",
          size: { width: 300, height: 0 },
          x: 0,
          y: 0,
        },
        aiChat: {
          position: "top",
          mode: "snapped",
          size: { width: 0, height: 180 },
          x: 0,
          y: 0,
        },
        problems: {
          position: "bottom",
          mode: "snapped",
          size: { width: 0, height: 220 },
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        explorer: "left",
        git: "right",
        aiChat: "top",
        problems: "bottom",
      },
    },
  });
  await setZenMode(page, true);

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const editorBeforeSweep = await readElementRect(
    page,
    '[data-testid="editor-area"]',
  );
  const cases = [
    {
      panelId: "explorer",
      position: "left",
      point: { x: 1, y: viewport.height / 2 },
    },
    {
      panelId: "git",
      position: "right",
      point: { x: viewport.width - 1, y: viewport.height / 2 },
    },
    {
      panelId: "aiChat",
      position: "top",
      point: { x: viewport.width / 2, y: 1 },
    },
    {
      panelId: "problems",
      position: "bottom",
      point: { x: viewport.width / 2, y: viewport.height - 1 },
    },
  ] as const;

  for (const { panelId, position, point } of cases) {
    await expect(page.getByTestId(`zen-panel-hover-${position}`)).toHaveCount(
      0,
    );
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await expect(page.getByTestId(`panel-${panelId}`)).toHaveCount(0);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(45);
    await expect(page.getByTestId(`panel-${panelId}`)).toHaveCount(0);
    expectRectStable(
      await readElementRect(page, '[data-testid="editor-area"]'),
      editorBeforeSweep,
    );
  }
});

test("cmd-clicking an explicitly opened zen panel header unpins and shortcut repins it", async ({
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
  await setZenMode(page, true);

  const panel = page.locator('[data-testid="panel-explorer"]');
  await openExplorerPanel(page);
  await expect(panel).toBeVisible();
  await waitForPanelSettled(page, "panel-explorer");
  await expect(panel).toHaveAttribute("data-panel-zen-pinned", "true");

  await page
    .getByTestId("panel-explorer-drag-handle")
    .click({ modifiers: ["Meta"] });
  await expect(panel).toHaveCount(0);

  await openExplorerPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-panel-zen-pinned", "true");
});

test("zen explicit panel header stays no-drag and tracks panel drag", async ({
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
  await setZenMode(page, true);

  const panel = page.locator('[data-testid="panel-explorer"]');
  await openExplorerPanel(page);
  await expect(panel).toBeVisible();
  await waitForPanelSettled(page, "panel-explorer");

  for (const selector of [
    '[data-testid="panel-explorer"]',
    '[data-testid="panel-explorer-drag-handle"]',
    '[data-testid="panel-explorer"] [data-panel-content="true"]',
    '[data-testid="panel-explorer"] [data-panel-controls="true"]',
    '[data-testid="panel-explorer-resize-e"]',
  ]) {
    await expect
      .poll(() => readNoDragStyles(page, selector))
      .toEqual({
        webkitAppRegion: "no-drag",
        wailsDraggable: "no-drag",
      });
  }

  const startRect = await panel.boundingBox();
  const headerRect = await page
    .getByTestId("panel-explorer-drag-handle")
    .boundingBox();
  expect(startRect).not.toBeNull();
  expect(headerRect).not.toBeNull();

  const grabPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move(grabPoint.x + 180, grabPoint.y + 36, { steps: 8 });
  await nextAnimationFrame(page);

  const dragRect = await panel.boundingBox();
  expect(dragRect).not.toBeNull();
  expect(
    Math.abs((dragRect?.x ?? 0) - ((startRect?.x ?? 0) + 180)),
  ).toBeLessThan(32);
  expect(
    Math.abs((dragRect?.y ?? 0) - ((startRect?.y ?? 0) + 36)),
  ).toBeLessThan(32);
  await expect(panel).toHaveAttribute("data-panel-state", "dragging");

  await page.mouse.up();
});

for (const scenario of [
  {
    panelId: "explorer",
    position: "left",
    size: { width: 260, height: 0 },
    dragOffset: { x: 180, y: 48 },
  },
  {
    panelId: "aiChat",
    position: "right",
    size: { width: 320, height: 0 },
    dragOffset: { x: -180, y: 48 },
  },
  {
    panelId: "git",
    position: "top",
    size: { width: 0, height: 190 },
    dragOffset: { x: 160, y: 72 },
  },
] as const) {
  test(`zen ${scenario.position} snapped panel header drag is not blocked by topbar edge`, async ({
    page,
  }) => {
    await mountProjectUI(page, {
      panelLayoutState: {
        panels: {
          explorer: scenario.panelId === "explorer",
          terminal: false,
          aiChat: scenario.panelId === "aiChat",
          git: scenario.panelId === "git",
          problems: false,
          code: false,
        },
        panelConfigs: {
          [scenario.panelId]: {
            position: scenario.position,
            mode: "snapped",
            size: scenario.size,
            x: 0,
            y: 0,
          },
        },
        rememberedSnappedPositions: {
          [scenario.panelId]: scenario.position,
        },
        zenPinnedPanels: {
          explorer: scenario.panelId === "explorer",
          terminal: false,
          aiChat: scenario.panelId === "aiChat",
          git: scenario.panelId === "git",
          problems: false,
          code: false,
          markdownPreview: false,
        },
      },
    });
    await setZenMode(page, true);

    const layout = page.getByTestId("main-layout");
    const panel = page.locator(`[data-testid="panel-${scenario.panelId}"]`);
    const header = page.getByTestId(`panel-${scenario.panelId}-drag-handle`);
    await expect(panel).toBeVisible();
    await waitForPanelSettled(page, `panel-${scenario.panelId}`);

    const startRect = await panel.boundingBox();
    const headerRect = await header.boundingBox();
    expect(startRect).not.toBeNull();
    expect(headerRect).not.toBeNull();

    const grabPoint = {
      x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
      y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
    };

    await page.mouse.move(grabPoint.x, grabPoint.y);
    await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

    await page.mouse.down();
    await page.mouse.move(
      grabPoint.x + scenario.dragOffset.x,
      grabPoint.y + scenario.dragOffset.y,
      { steps: 8 },
    );
    await nextAnimationFrame(page);
    await page.waitForTimeout(160);

    const dragRect = await panel.boundingBox();
    expect(dragRect).not.toBeNull();
    expect(
      Math.abs(
        (dragRect?.x ?? 0) - ((startRect?.x ?? 0) + scenario.dragOffset.x),
      ),
    ).toBeLessThan(34);
    expect(
      Math.abs(
        (dragRect?.y ?? 0) - ((startRect?.y ?? 0) + scenario.dragOffset.y),
      ),
    ).toBeLessThan(34);
    await expect(panel).toHaveAttribute("data-panel-state", "dragging");
    await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

    await page.mouse.up();
  });
}

test("keyboard shortcut opens a snapped panel pinned in zen and keeps arrow movement", async ({
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
  await setZenMode(page, true);

  const panel = page.locator('[data-testid="panel-git"]').last();
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    const shortcutInit = {
      key: "g",
      code: "KeyG",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", shortcutInit));
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(new KeyboardEvent("keyup", shortcutInit));
  });

  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-panel-zen-pinned", "true");
  await expect
    .poll(async () => panel.getAttribute("data-panel-position"))
    .toBe("right");

  await page.mouse.move(560, 320);
  await page.waitForTimeout(220);
  await expect(panel).toBeVisible();
});

test("zen topbar hover does not reveal panels or resize the editor", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setZenMode(page, true);
  const editorBeforeHover = await readElementRect(
    page,
    '[data-testid="editor-area"]',
  );

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, 1);
  await page.waitForTimeout(ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS - 250);
  await expect(page.getByTestId("main-layout")).toHaveAttribute(
    "data-zen-topbar-visible",
    "false",
  );
  await expect(page.getByTestId("main-layout")).toHaveAttribute(
    "data-zen-topbar-visible",
    "true",
  );
  expectRectStable(
    await readElementRect(page, '[data-testid="editor-area"]'),
    editorBeforeHover,
  );
  await page.mouse.move(1, viewport.height / 2);
  await expect(page.getByTestId("panel-explorer")).toHaveCount(0);
  expectRectStable(
    await readElementRect(page, '[data-testid="editor-area"]'),
    editorBeforeHover,
  );
});

test("zen topbar dwell reveal works over side pinned panel headers and offsets the panel", async ({
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
        explorer: {
          position: "left",
          mode: "snapped",
          size: { width: 260, height: 0 },
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        explorer: "left",
      },
      zenPinnedPanels: {
        explorer: true,
        terminal: false,
        aiChat: false,
        git: false,
        problems: false,
        code: false,
        markdownPreview: false,
      },
    },
  });
  await setZenMode(page, true);

  const layout = page.getByTestId("main-layout");
  const panel = page.getByTestId("panel-explorer");
  const header = page.getByTestId("panel-explorer-drag-handle");
  await expect(panel).toBeVisible();
  await waitForPanelSettled(page, "panel-explorer");

  const editorBeforeHover = await readElementRect(
    page,
    '[data-testid="editor-area"]',
  );
  const panelBeforeHover = await readElementRect(
    page,
    '[data-testid="panel-explorer"]',
  );
  const headerRect = await header.boundingBox();
  expect(panelBeforeHover).not.toBeNull();
  expect(headerRect).not.toBeNull();

  const hoverPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };
  await page.mouse.move(hoverPoint.x, hoverPoint.y);

  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await page.waitForTimeout(ZEN_TOP_CHROME_OCCLUDED_REVEAL_DELAY_MS - 650);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect(panel).toHaveAttribute("data-panel-top-chrome-avoidance", "0");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");
  await expect
    .poll(async () =>
      Number(
        (await panel.getAttribute("data-panel-top-chrome-avoidance")) ?? "0",
      ),
    )
    .toBeGreaterThan(0);
  await page.mouse.move(hoverPoint.x + 12, hoverPoint.y);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await expect
    .poll(async () => {
      const topbarAfterHover = await readElementRect(
        page,
        '[data-testid="topbar"]',
      );
      const panelAfterHover = await readElementRect(
        page,
        '[data-testid="panel-explorer"]',
      );
      return (
        (panelAfterHover?.y ?? 0) +
        1 -
        ((topbarAfterHover?.y ?? 0) + (topbarAfterHover?.height ?? 0))
      );
    })
    .toBeGreaterThanOrEqual(0);

  const panelAfterHover = await readElementRect(
    page,
    '[data-testid="panel-explorer"]',
  );
  expect(panelAfterHover).not.toBeNull();
  expect(
    (panelAfterHover?.y ?? 0) - (panelBeforeHover?.y ?? 0),
  ).toBeGreaterThan(8);
  expectRectStable(
    await readElementRect(page, '[data-testid="editor-area"]'),
    editorBeforeHover,
  );
});

test("zen topbar dwell reveal works over top snapped panel headers", async ({
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
        explorer: {
          position: "top",
          mode: "snapped",
          size: { width: 0, height: 190 },
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        explorer: "top",
      },
      zenPinnedPanels: {
        explorer: true,
        terminal: false,
        aiChat: false,
        git: false,
        problems: false,
        code: false,
        markdownPreview: false,
      },
    },
  });
  await setZenMode(page, true);

  const layout = page.getByTestId("main-layout");
  const panel = page.getByTestId("panel-explorer");
  const header = page.getByTestId("panel-explorer-drag-handle");
  await expect(panel).toBeVisible();
  await waitForPanelSettled(page, "panel-explorer");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  const editorBeforeHover = await readElementRect(
    page,
    '[data-testid="editor-area"]',
  );
  const panelBeforeHover = await readElementRect(
    page,
    '[data-testid="panel-explorer"]',
  );
  const headerRect = await header.boundingBox();
  expect(panelBeforeHover).not.toBeNull();
  expect(headerRect).not.toBeNull();

  const hoverPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };
  expect(hoverPoint.y).toBeGreaterThan(12);
  await page.mouse.move(hoverPoint.x, hoverPoint.y);

  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await page.waitForTimeout(ZEN_TOP_CHROME_OCCLUDED_REVEAL_DELAY_MS - 650);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect(panel).toHaveAttribute("data-panel-top-chrome-avoidance", "0");
  await page.mouse.move(hoverPoint.x + 12, hoverPoint.y);
  await page.waitForTimeout(ZEN_TOP_CHROME_OCCLUDED_REVEAL_DELAY_MS - 650);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect(panel).toHaveAttribute("data-panel-top-chrome-avoidance", "0");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");
  await expect
    .poll(async () =>
      Number(
        (await panel.getAttribute("data-panel-top-chrome-avoidance")) ?? "0",
      ),
    )
    .toBeGreaterThan(0);
  await page.mouse.move(hoverPoint.x + 12, hoverPoint.y);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  const panelAfterHover = await readElementRect(
    page,
    '[data-testid="panel-explorer"]',
  );
  expect(panelAfterHover).not.toBeNull();
  expect(
    (panelAfterHover?.y ?? 0) - (panelBeforeHover?.y ?? 0),
  ).toBeGreaterThan(8);
  expectRectStable(
    await readElementRect(page, '[data-testid="editor-area"]'),
    editorBeforeHover,
  );
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

  await panel.locator('button[title="Fullscreen"]').click();
  await expect
    .poll(async () => {
      const frame = await readPanelFrame(page, '[data-testid="panel-git"]');
      return frame ? Math.round(frame.translateX) : null;
    })
    .toBe(0);

  await panel.locator('button[title="Close panel"]').click();
  await nextAnimationFrame(page);

  const exitFrame = await readPanelFrame(page, '[data-testid="panel-git"]');
  if (exitFrame) {
    expect(exitFrame.motion).toBe("exit");
    expect(Math.abs(exitFrame.translateX)).toBeLessThanOrEqual(1);
    expect(Math.abs(exitFrame.translateY)).toBeLessThanOrEqual(1);
  }

  await expect(page.locator('[data-testid="panel-git"]')).toHaveCount(0);
});

test("problems shortcut opens a persisted floating panel into a free snapped side", async ({
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
        problems: {
          position: "bottom",
          mode: "floating",
          size: { width: 420, height: 260 },
          x: 140,
          y: 120,
        },
      },
    },
  });

  const panel = page.locator('[data-testid="panel-problems"]');
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "problems.toggle" },
      }),
    );
  });

  await expect(panel).toBeAttached();
  await nextAnimationFrame(page);

  await expect(panel).toHaveAttribute("data-panel-state", "docked");
  await expect(panel).toHaveAttribute("data-panel-position", "bottom");
});

test("problems shortcut falls back to floating when every side is occupied", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: true,
        terminal: true,
        aiChat: true,
        git: true,
        problems: false,
        code: false,
      },
      panelConfigs: {
        explorer: {
          position: "left",
          mode: "snapped",
          size: { width: 260, height: 0 },
          x: 0,
          y: 0,
        },
        terminal: {
          position: "bottom",
          mode: "snapped",
          size: { width: 0, height: 220 },
          x: 0,
          y: 0,
        },
        aiChat: {
          position: "right",
          mode: "snapped",
          size: { width: 320, height: 0 },
          x: 0,
          y: 0,
        },
        git: {
          position: "top",
          mode: "snapped",
          size: { width: 0, height: 220 },
          x: 0,
          y: 0,
        },
        problems: {
          position: "bottom",
          mode: "floating",
          size: { width: 420, height: 260 },
          x: 140,
          y: 120,
        },
      },
    },
  });

  const panel = page.locator('[data-testid="panel-problems"]');
  await expect(panel).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "problems.toggle" },
      }),
    );
  });

  await expect(panel).toBeAttached();
  await nextAnimationFrame(page);

  const openingFrame = await readPanelFrame(
    page,
    '[data-testid="panel-problems"]',
  );
  expect(openingFrame).not.toBeNull();
  await expect(panel).toHaveAttribute("data-panel-state", "floating");
  expect(openingFrame?.motion).toBe("settled");
  expect(Math.abs(openingFrame?.translateX ?? 0)).toBeLessThanOrEqual(1);
  expect(Math.abs(openingFrame?.translateY ?? 0)).toBeLessThanOrEqual(1);

  await panel.locator('button[title="Close panel"]').click();
  await nextAnimationFrame(page);
  await page.waitForTimeout(80);

  const exitFrame = await readPanelFrame(
    page,
    '[data-testid="panel-problems"]',
  );
  if (exitFrame) {
    expect(exitFrame.motion).toBe("exit");
    expect(Math.abs(exitFrame.translateX)).toBeLessThanOrEqual(1);
    expect(Math.abs(exitFrame.translateY)).toBeLessThanOrEqual(1);
  }

  await expect(page.locator('[data-testid="panel-problems"]')).toHaveCount(0);
});

test("free floating panel drags by the header", async ({ page }) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: false,
        aiChat: false,
        git: false,
        problems: true,
        code: false,
      },
      panelConfigs: {
        problems: {
          position: "bottom",
          mode: "floating",
          size: { width: 420, height: 260 },
          x: 140,
          y: 120,
        },
      },
    },
  });

  const panel = page.locator('[data-testid="panel-problems"]');
  const header = page.getByTestId("panel-problems-drag-handle");
  await expect(panel).toBeVisible();
  await waitForPanelSettled(page, "panel-problems");

  const startRect = await panel.boundingBox();
  const headerRect = await header.boundingBox();
  expect(startRect).not.toBeNull();
  expect(headerRect).not.toBeNull();

  const grabPoint = {
    x: (headerRect?.x ?? 0) + (headerRect?.width ?? 0) / 2,
    y: (headerRect?.y ?? 0) + (headerRect?.height ?? 0) / 2,
  };

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move(grabPoint.x + 140, grabPoint.y + 48, { steps: 8 });
  await nextAnimationFrame(page);

  const dragRect = await panel.boundingBox();
  expect(dragRect).not.toBeNull();
  expect(
    Math.abs((dragRect?.x ?? 0) - ((startRect?.x ?? 0) + 140)),
  ).toBeLessThan(28);
  expect(
    Math.abs((dragRect?.y ?? 0) - ((startRect?.y ?? 0) + 48)),
  ).toBeLessThan(28);
  await expect(panel).toHaveAttribute("data-panel-state", "dragging");

  await page.mouse.up();
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

  await relocatedExplorerPanel.locator('button[title="Close panel"]').click();
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

test("hidden explorer reopens in a free slot when git occupies its last side", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: false,
        aiChat: false,
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
          position: "left",
          size: { width: 280, height: 0 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        explorer: "left",
        git: "left",
      },
    },
  });

  await expect(
    page.locator('[data-testid="panel-git"]').last(),
  ).toHaveAttribute("data-panel-position", "left");

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "explorer.toggle" },
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
    .toBe("right");
  await expect(
    page.locator('[data-testid="panel-git"]').last(),
  ).toHaveAttribute("data-panel-position", "left");
});

test("ordinary panel toggle opens hidden panel without duplicating snapped sides", async ({
  page,
}) => {
  await mountProjectUI(page, {
    panelLayoutState: {
      panels: {
        explorer: false,
        terminal: true,
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
        terminal: {
          position: "bottom",
          size: { width: 0, height: 220 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
        aiChat: {
          position: "right",
          size: { width: 320, height: 0 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
        git: {
          position: "left",
          size: { width: 280, height: 0 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        explorer: "left",
        terminal: "bottom",
        aiChat: "right",
        git: "left",
      },
    },
  });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:application-menu-action", {
        detail: { actionId: "explorer.toggle" },
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
    .toBe("top");

  const positions = await page
    .locator('[data-testid^="panel-"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLElement).dataset.panelPosition)
        .filter(Boolean),
    );
  expect(new Set(positions).size).toBe(positions.length);
});

test("panel remembered snapped side survives close and reopen when free", async ({
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
        explorer: {
          position: "left",
          size: { width: 260, height: 0 },
          mode: "snapped",
          x: 0,
          y: 0,
        },
      },
      rememberedSnappedPositions: {
        explorer: "right",
      },
    },
  });

  const toggleExplorer = async () => {
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("arlecchino:application-menu-action", {
          detail: { actionId: "explorer.toggle" },
        }),
      );
    });
  };

  await toggleExplorer();
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");
  await waitForPanelSettled(page, "panel-explorer");

  await page
    .locator('[data-testid="panel-explorer"]')
    .last()
    .locator('button[title="Close panel"]')
    .click();
  await expect(page.locator('[data-testid="panel-explorer"]')).toHaveCount(0);

  await toggleExplorer();
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="panel-explorer"]')
        .last()
        .getAttribute("data-panel-position"),
    )
    .toBe("right");
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

  await relocatedExplorerPanel.locator('button[title="Close panel"]').click();
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
    willChange: "width, transform, opacity",
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

test("snapped panel resize rail owns hover hit testing before drag", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-explorer"]').last();
  await expect(panel).toBeVisible();
  await waitForPanelSettled(page, "panel-explorer");

  await expect
    .poll(() =>
      readPanelResizeHoverState(
        page,
        "panel-explorer",
        "panel-explorer-resize-e",
      ),
    )
    .toEqual({
      computedCursor: "ew-resize",
      handleWidth: 24,
      hitResizeHandle: "true",
      hitTestId: "panel-explorer-resize-e",
    });
});

test("panel resize clears owned cursor state on cancellation paths", async ({
  page,
}) => {
  await mountProjectUI(page);

  const panel = page.locator('[data-testid="panel-explorer"]').last();
  await expect(panel).toBeVisible();
  await waitForPanelSettled(page, "panel-explorer");

  await startSyntheticPanelResize(page, "panel-explorer-resize-e", 31);
  await expect
    .poll(() => readPanelResizeCleanupState(page, "panel-explorer"))
    .toEqual({
      contentPointerEvents: "none",
      cursor: "ew-resize",
      cursorOwner: "floating-panel:explorer:resize:1",
      isResizing: true,
      userSelect: "none",
    });

  await page.evaluate(() => {
    window.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId: 31,
        pointerType: "mouse",
      }),
    );
  });
  await expect
    .poll(() => readPanelResizeCleanupState(page, "panel-explorer"))
    .toEqual({
      contentPointerEvents: "auto",
      cursor: "",
      cursorOwner: "",
      isResizing: false,
      userSelect: "",
    });

  await startSyntheticPanelResize(page, "panel-explorer-resize-e", 32);
  await expect
    .poll(() => readPanelResizeCleanupState(page, "panel-explorer"))
    .toEqual({
      contentPointerEvents: "none",
      cursor: "ew-resize",
      cursorOwner: "floating-panel:explorer:resize:2",
      isResizing: true,
      userSelect: "none",
    });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
  });
  await expect
    .poll(() => readPanelResizeCleanupState(page, "panel-explorer"))
    .toEqual({
      contentPointerEvents: "auto",
      cursor: "",
      cursorOwner: "",
      isResizing: false,
      userSelect: "",
    });
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

test("snapped panel close resizes the editor without resizing the panel", async ({
  page,
}) => {
  await mountProjectUI(page, { editorContent: largeEditorContent });

  const explorerPanel = page.locator('[data-testid="panel-explorer"]').last();
  const editorArea = page.getByTestId("editor-area");
  await expect(explorerPanel).toBeVisible();
  await waitForPanelSettled(page, "panel-explorer");

  const startBox = await editorArea.boundingBox();
  expect(startBox).not.toBeNull();
  const startPanelBox = await explorerPanel.boundingBox();
  expect(startPanelBox).not.toBeNull();

  await page.keyboard.press("Meta+E");

  await expect
    .poll(async () => {
      const panelStillExiting = (await explorerPanel.count()) > 0;
      const nextBox = await editorArea.boundingBox();
      return (
        panelStillExiting && (nextBox?.width ?? 0) > (startBox?.width ?? 0) + 20
      );
    })
    .toBe(true);

  const exitFrame = await readPanelFrame(
    page,
    '[data-testid="panel-explorer"]',
  );
  expect(exitFrame).not.toBeNull();
  expect(exitFrame?.motion).toBe("exit");
  expect(
    Math.abs((exitFrame?.width ?? 0) - (startPanelBox?.width ?? 0)),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs((exitFrame?.height ?? 0) - (startPanelBox?.height ?? 0)),
  ).toBeLessThanOrEqual(2);

  await expect(explorerPanel).toHaveCount(0);
});

test("browser preview iframe scrolls with wheel input", async ({ page }) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    (
      window as Window & {
        runtime: { EventsEmit: (eventName: string, payload: unknown) => void };
      }
    ).runtime.EventsEmit("ide:window:open", {
      id: "scroll-preview",
      surface: "browser",
      title: "Scroll Preview",
      mode: "snapped",
      position: "right",
      payload: {
        sourceLabel: "scroll-preview.html",
        revision: 1,
        htmlContent: `
          <!doctype html>
          <html>
            <body style="margin:0; min-height: 2400px; font-family: sans-serif;">
              <main style="height: 2400px; padding: 24px;">
                <h1>Scrollable preview</h1>
                <p>Wheel input should scroll this iframe.</p>
              </main>
            </body>
          </html>
        `,
      },
    });
  });

  const previewPanel = page
    .locator('[data-testid="panel-scroll-preview"]')
    .last();
  await expect(previewPanel).toBeVisible();
  await expect(
    page.locator('[data-testid="browser-preview-root"] iframe'),
  ).toBeVisible();

  const iframe = page.locator('[data-testid="browser-preview-root"] iframe');
  const iframeBox = await iframe.boundingBox();
  expect(iframeBox).not.toBeNull();

  await page.mouse.move(
    (iframeBox?.x ?? 0) + (iframeBox?.width ?? 0) / 2,
    (iframeBox?.y ?? 0) + (iframeBox?.height ?? 0) / 2,
  );
  await page.mouse.wheel(0, 700);

  await expect
    .poll(async () =>
      iframe.evaluate(
        (element) => (element as HTMLIFrameElement).contentWindow?.scrollY ?? 0,
      ),
    )
    .toBeGreaterThan(120);
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
