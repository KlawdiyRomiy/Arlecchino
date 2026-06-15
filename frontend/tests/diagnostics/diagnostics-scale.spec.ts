import { expect, test, type Page } from "@playwright/test";

const editorProjectPath = "/workspace";
const editorFilePath = `${editorProjectPath}/diagnostics.ts`;

const mountEditorTab = async (
  page: Page,
  content: string,
  options: {
    constrainedPerformance?: boolean;
  } = {},
): Promise<void> => {
  const { constrainedPerformance = false } = options;

  await page.evaluate(
    async ({ constrainedPerformance, editorProjectPath }) => {
      const { useWorkspaceStore } =
        await import("/src/stores/workspaceStore.ts");
      const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
      const { useDiagnosticsStore } =
        await import("/src/stores/diagnosticsStore.ts");
      const { usePerformanceStore } =
        await import("/src/stores/performanceStore.ts");

      useDiagnosticsStore.getState().reset();
      if (constrainedPerformance) {
        usePerformanceStore.getState().updateBudget({
          activeEditorCharCount: 32_000,
          activeEditorLineCount: 200,
          activeEditorLargeDocument: false,
          eventPressure: 0,
          frameGapMs: 0,
          indexerQueueDepth: 220,
          projectFileCount: 7_500,
        });
      } else {
        usePerformanceStore.getState().resetTransientBudget();
      }
      useWorkspaceStore.setState({
        projects: [
          {
            id: editorProjectPath,
            path: editorProjectPath,
            name: "workspace",
            openedAt: 1,
          },
        ],
        activeId: editorProjectPath,
        activeFramework: null,
        pendingId: null,
        ready: true,
        switchDirection: 1,
        uiBlockers: [],
      });
      useExplorerStore.getState().setProjectPath(editorProjectPath);
    },
    { constrainedPerformance, editorProjectPath },
  );

  await expect(page.getByTestId("main-layout")).toBeVisible({
    timeout: 10000,
  });

  await page.evaluate(
    async ({ content, editorFilePath }) => {
      (
        window as typeof window & {
          __diagnosticsEditorContent?: string;
          __diagnosticsEditorPath?: string;
        }
      ).__diagnosticsEditorContent = content;
      (
        window as typeof window & {
          __diagnosticsEditorContent?: string;
          __diagnosticsEditorPath?: string;
        }
      ).__diagnosticsEditorPath = editorFilePath;
    },
    { content, editorFilePath },
  );

  await page.locator(`[data-file-path="${editorFilePath}"]`).click();
  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });

  if (constrainedPerformance) {
    await page.evaluate(async () => {
      const { usePerformanceStore } =
        await import("/src/stores/performanceStore.ts");
      usePerformanceStore.getState().updateBudget({
        activeEditorCharCount: 32_000,
        activeEditorLineCount: 200,
        activeEditorLargeDocument: false,
        eventPressure: 0,
        frameGapMs: 0,
        indexerQueueDepth: 220,
        projectFileCount: 7_500,
      });
    });
  }

  await expect
    .poll(() =>
      page
        .locator(".cm-editor")
        .first()
        .evaluate((node) =>
          node.getAttribute("data-adaptive-reconfigure-count"),
        ),
    )
    .not.toBeNull();
};

const setEditorDiagnostics = async (
  page: Page,
  items: Array<{
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    severity: number;
    message: string;
    source?: string;
    code?: string;
  }>,
): Promise<void> => {
  await page.evaluate(
    async ({ editorFilePath, items }) => {
      const { useDiagnosticsStore } =
        await import("/src/stores/diagnosticsStore.ts");
      useDiagnosticsStore
        .getState()
        .setFileDiagnostics(editorFilePath, "typescript", items);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      useDiagnosticsStore
        .getState()
        .setFileDiagnostics(editorFilePath, "typescript", items);
    },
    { editorFilePath, items },
  );

  await expect
    .poll(() =>
      page.evaluate(
        async ({ editorFilePath }) => {
          const { useDiagnosticsStore } =
            await import("/src/stores/diagnosticsStore.ts");
          return (
            useDiagnosticsStore.getState().byFile.get(editorFilePath)?.items
              .length ?? 0
          );
        },
        { editorFilePath },
      ),
    )
    .toBe(items.length);
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
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

    const eventHandlers = new Map<string, Array<(payload: unknown) => void>>();

    const runtimeBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "EventsOn") {
            return (
              eventName: string,
              callback: (payload: unknown) => void,
            ) => {
              const handlers = eventHandlers.get(eventName) ?? [];
              handlers.push(callback);
              eventHandlers.set(eventName, handlers);
              return () => {
                eventHandlers.set(
                  eventName,
                  (eventHandlers.get(eventName) ?? []).filter(
                    (handler) => handler !== callback,
                  ),
                );
              };
            };
          }

          if (property === "EventsOnMultiple") {
            return (
              eventName: string,
              callback: (payload: unknown) => void,
            ) => {
              const handlers = eventHandlers.get(eventName) ?? [];
              handlers.push(callback);
              eventHandlers.set(eventName, handlers);
              return () => {
                eventHandlers.set(
                  eventName,
                  (eventHandlers.get(eventName) ?? []).filter(
                    (handler) => handler !== callback,
                  ),
                );
              };
            };
          }

          if (property === "EventsOff") {
            return () => undefined;
          }

          return () => undefined;
        },
      },
    );

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
              case "GetCurrentProjectPath":
                return "/workspace";
              case "OpenProject":
              case "CreateTerminal":
              case "WriteTerminal":
              case "SendTerminalText":
              case "CloseTerminal":
              case "ResizeTerminal":
                return true;
              case "ListFiles":
                return [];
              case "ReadDirectory":
                return [
                  {
                    name: "diagnostics.ts",
                    path: "/workspace/diagnostics.ts",
                    isDirectory: false,
                  },
                ];
              case "InspectEditorFile": {
                const path = typeof args[0] === "string" ? args[0] : "file.ts";
                const diagnosticsWindow = window as typeof window & {
                  __diagnosticsEditorContent?: string;
                  __diagnosticsEditorPath?: string;
                };
                const content =
                  diagnosticsWindow.__diagnosticsEditorPath === path &&
                  diagnosticsWindow.__diagnosticsEditorContent !== undefined
                    ? diagnosticsWindow.__diagnosticsEditorContent
                    : `// ${path}\nexport const ready = true;\n`;
                const lines = content.split("\n");
                const name = path.split("/").pop() || path;
                return {
                  path,
                  name,
                  sizeBytes: new TextEncoder().encode(content).length,
                  formattedSize: `${content.length} B`,
                  isText: true,
                  safeForEditor: true,
                  largeDocument: false,
                  reason: "safe for interactive editing",
                  lineCount: lines.length,
                  maxLineLength: Math.max(
                    ...lines.map((line) => line.length),
                    0,
                  ),
                  limitBytes: 2 * 1024 * 1024,
                  lineLimit: 20_000,
                  maxLineLengthLimit: 20_000,
                };
              }
              case "ReadFile": {
                const path = typeof args[0] === "string" ? args[0] : "file.ts";
                const diagnosticsWindow = window as typeof window & {
                  __diagnosticsEditorContent?: string;
                  __diagnosticsEditorPath?: string;
                };
                if (
                  diagnosticsWindow.__diagnosticsEditorPath === path &&
                  diagnosticsWindow.__diagnosticsEditorContent !== undefined
                ) {
                  return diagnosticsWindow.__diagnosticsEditorContent;
                }
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

    Object.assign(window, {
      __emitRuntimeEvent(eventName: string, payload: unknown) {
        const handlers = eventHandlers.get(eventName) ?? [];
        handlers.forEach((handler) => handler(payload));
      },
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
    });
  });

  await page.goto("/");
});

test("diagnostics render viewport underlines without inline overlays", async ({
  page,
}) => {
  const content = Array.from(
    { length: 120 },
    (_value, index) => `const value${index} = ${index};`,
  ).join("\n");
  const diagnostics = Array.from({ length: 100 }, (_value, index) => ({
    range: {
      start: { line: index, character: 6 },
      end: { line: index, character: 12 },
    },
    severity: index % 3 === 0 ? 1 : 2,
    message: `diagnostic ${index} intentionally long enough to exercise hover rendering`,
    source: "test",
  }));

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, diagnostics);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);
  const rangeCount = await page.locator(".cm-diagnostic-range").count();
  expect(rangeCount).toBeGreaterThan(0);
  expect(rangeCount).toBeLessThan(diagnostics.length);
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );
});

test("large documents keep visible diagnostics underlines", async ({
  page,
}) => {
  const content = Array.from({ length: 2470 }, (_value, index) =>
    index === 25
      ? 'describe("HubConnection", () => {'
      : `const value${index} = ${index};`,
  ).join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 25, character: 0 },
        end: { line: 25, character: 8 },
      },
      severity: 1,
      code: "2593",
      source: "typescript",
      message: "Cannot find name 'describe'.",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-range-error")).toHaveCount(1);
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );
});

test("diagnostics hover tooltip renders under constrained performance budget", async ({
  page,
}) => {
  const content = [
    "const ok = true;",
    "const brokenValue = missingValue;",
    "const tail = true;",
  ].join("\n");

  await mountEditorTab(page, content, { constrainedPerformance: true });
  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(1.35);
    useEditorSettingsStore.getState().setUiFontSize(16);
  });
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 1, character: 20 },
        end: { line: 1, character: 32 },
      },
      severity: 1,
      code: "2304",
      message: "Cannot find name 'missingValue'.",
      source: "tsserver",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);
  await expect(page.locator(".cm-diagnostic-range-error")).toHaveCount(1);

  await page.locator(".cm-diagnostic-range-error").hover();
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText(
    "Cannot find name 'missingValue'.",
  );
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText(
    "tsserver",
  );
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText("2304");
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText("Ln 2");
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText("Col 21");
  await expect(page.locator(".cm-diagnostic-tooltip-icon")).toBeVisible();
  const tooltipStyle = await page
    .locator(".cm-diagnostic-tooltip")
    .evaluate((node) => {
      const style = window.getComputedStyle(node);
      const icon = node.querySelector<HTMLElement>(
        ".cm-diagnostic-tooltip-icon",
      );
      const message = node.querySelector<HTMLElement>(
        ".cm-diagnostic-tooltip-message",
      );
      const iconStyle = icon ? window.getComputedStyle(icon) : null;
      const messageStyle = message ? window.getComputedStyle(message) : null;
      const textProbe = document.createElement("span");
      textProbe.style.color = "var(--text-primary)";
      const errorProbe = document.createElement("span");
      errorProbe.style.color = "var(--status-error)";
      document.body.append(textProbe, errorProbe);
      const textPrimary = window.getComputedStyle(textProbe).color;
      const statusError = window.getComputedStyle(errorProbe).color;
      textProbe.remove();
      errorProbe.remove();
      return {
        borderRadius: Number.parseFloat(style.borderTopLeftRadius),
        color: style.color,
        iconColor: iconStyle?.color ?? "",
        iconRadius: Number.parseFloat(iconStyle?.borderTopLeftRadius ?? "0"),
        iconWidth: Number.parseFloat(iconStyle?.width ?? "0"),
        messageFontSize: Number.parseFloat(messageStyle?.fontSize ?? "0"),
        statusError,
        textPrimary,
      };
    });
  expect(tooltipStyle.color).toBe(tooltipStyle.textPrimary);
  expect(tooltipStyle.iconColor).toBe(tooltipStyle.statusError);
  expect(tooltipStyle.messageFontSize).toBeGreaterThan(22);
  expect(tooltipStyle.borderRadius).toBeGreaterThan(24);
  expect(tooltipStyle.iconRadius).toBeGreaterThan(16);
  expect(tooltipStyle.iconWidth).toBeGreaterThan(60);
});

test("diagnostic underlines remain during scroll without inline overlays", async ({
  page,
}) => {
  const content = Array.from({ length: 120 }, (_value, index) =>
    index === 8
      ? "const brokenValue = missingValue;"
      : `const value${index} = ${index};`,
  ).join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 8, character: 20 },
        end: { line: 8, character: 32 },
      },
      severity: 1,
      message: "Cannot find name 'missingValue'.",
      source: "tsserver",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);
  await expect(page.locator(".cm-diagnostic-range-error")).toHaveCount(1);

  const wheelResult = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller");
    if (!scroller) {
      return {
        canceled: false,
        scrollActive: false,
        scrollTop: 0,
      };
    }

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: 0,
      deltaY: 48,
    });
    const dispatchResult = scroller.dispatchEvent(event);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    return {
      canceled: !dispatchResult && event.defaultPrevented,
      scrollActive:
        document.querySelector<HTMLElement>(".cm-editor")?.dataset
          .scrollActive === "true",
      scrollTop: scroller.scrollTop,
    };
  });

  expect(wheelResult.canceled).toBe(true);
  expect(wheelResult.scrollActive).toBe(true);
  expect(wheelResult.scrollTop).toBeGreaterThan(0);
  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);
  await expect(page.locator(".cm-diagnostic-range-error")).toHaveCount(1);
});

test("diagnostic hover tooltip appears next to the underlined range", async ({
  page,
}) => {
  const content = [
    "const ok = true;",
    "const brokenValue = missingValue;",
    "const tail = true;",
  ].join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 1, character: 20 },
        end: { line: 1, character: 32 },
      },
      severity: 1,
      message: "Cannot find name 'missingValue'.",
      source: "tsserver",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);
  const range = page.locator(".cm-diagnostic-range-error");
  await expect(range).toHaveCount(1);

  await range.hover();
  const tooltip = page.locator(".cm-diagnostic-tooltip");
  const tooltipShell = page.locator(".cm-tooltip:has(.cm-diagnostic-tooltip)");
  await expect(tooltip).toBeVisible();
  await expect(
    page.locator(".cm-tooltip:has(.cm-diagnostic-tooltip) > .cm-tooltip-arrow"),
  ).toHaveCount(0);
  await expect(tooltip).toContainText("Cannot find name 'missingValue'.");

  const [rangeBox, tooltipBox] = await Promise.all([
    range.boundingBox(),
    tooltipShell.boundingBox(),
  ]);
  expect(rangeBox).not.toBeNull();
  expect(tooltipBox).not.toBeNull();

  const rangeCenterX = rangeBox!.x + rangeBox!.width / 2;
  expect(rangeCenterX).toBeGreaterThanOrEqual(tooltipBox!.x - 2);
  expect(rangeCenterX).toBeLessThanOrEqual(
    tooltipBox!.x + tooltipBox!.width + 2,
  );

  const gapAbove = Math.abs(rangeBox!.y - (tooltipBox!.y + tooltipBox!.height));
  const gapBelow = Math.abs(tooltipBox!.y - (rangeBox!.y + rangeBox!.height));
  expect(Math.min(gapAbove, gapBelow)).toBeLessThanOrEqual(36);

  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
});

test("zero-length diagnostics render a line-local point marker on hover", async ({
  page,
}) => {
  const content = [
    "package controllers",
    "",
    "import (",
    '  "testproject/internal/services"',
    ")",
  ].join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      severity: 1,
      message: "found packages controllers and services in internal/services",
      source: "go list",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);
  const range = page.locator(".cm-diagnostic-point-error");
  await expect(range).toHaveCount(1);

  await range.hover();
  const tooltip = page.locator(".cm-diagnostic-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(
    "found packages controllers and services in internal/services",
  );
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
});

test("diagnostics hover follows marked string ranges after another tooltip", async ({
  page,
}) => {
  const importPath = '"testproject/internal/services"';
  const content = [
    "package controllers",
    "",
    "import (",
    '    "encoding/json"',
    '    "net/http"',
    '    "time"',
    "",
    `    ${importPath}`,
    '    "testproject/internal/stores"',
    ")",
  ].join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      severity: 1,
      message: "found packages controllers and services in internal/services",
      source: "go list",
    },
    {
      range: {
        start: { line: 7, character: 4 },
        end: { line: 7, character: 4 + importPath.length },
      },
      severity: 1,
      code: "BrokenImport",
      message:
        'could not import testproject/internal/services (missing metadata for import of "testproject/internal/services")',
      source: "compiler",
    },
  ]);

  const packageRange = page.locator(".cm-diagnostic-point-error");
  const importRange = page
    .locator(".cm-diagnostic-range-error")
    .filter({ hasText: "testproject/internal/services" });
  await expect(packageRange).toHaveCount(1);
  await expect(importRange).toHaveCount(1);

  await packageRange.hover();
  const tooltip = page.locator(".cm-diagnostic-tooltip");
  await expect(tooltip).toContainText(
    "found packages controllers and services in internal/services",
  );

  const importBox = await importRange.boundingBox();
  expect(importBox).not.toBeNull();
  await page.evaluate(
    ({ x, y }) => {
      const scroller = document.querySelector<HTMLElement>(".cm-scroller");
      if (!scroller) {
        throw new Error("CodeMirror scroller not found");
      }
      scroller.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: x,
          clientY: y,
          buttons: 0,
        }),
      );
    },
    {
      x: importBox!.x + Math.min(18, importBox!.width / 2),
      y: importBox!.y + importBox!.height + 6,
    },
  );
  await expect(tooltip).toContainText(
    'could not import testproject/internal/services (missing metadata for import of "testproject/internal/services")',
  );
  await expect(tooltip).toContainText("BrokenImport");
});

test("diagnostics hover follows ordinary javascript ranges below the text box", async ({
  page,
}) => {
  const content = [
    "const layoutName = selectLayoutName();",
    "const stageGrid = createStageGrid(layoutName);",
    "previewStatus.dataset.state = stageGrid;",
  ].join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 16 },
      },
      severity: 1,
      code: "JS2304",
      message: "Cannot find name 'layoutName'.",
      source: "javascript",
    },
  ]);

  const range = page
    .locator(".cm-diagnostic-range-error")
    .filter({ hasText: "layoutName" });
  await expect(range).toHaveCount(1);

  const rangeBox = await range.boundingBox();
  expect(rangeBox).not.toBeNull();
  await page.evaluate(
    ({ x, y }) => {
      const scroller = document.querySelector<HTMLElement>(".cm-scroller");
      if (!scroller) {
        throw new Error("CodeMirror scroller not found");
      }
      scroller.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: x,
          clientY: y,
          buttons: 0,
        }),
      );
    },
    {
      x: rangeBox!.x + Math.min(12, rangeBox!.width / 2),
      y: rangeBox!.y + rangeBox!.height + 6,
    },
  );

  const tooltip = page.locator(".cm-diagnostic-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Cannot find name 'layoutName'.");
  await expect(tooltip).toContainText("javascript");
  await expect(tooltip).toContainText("JS2304");
});

test("diagnostic decorations skip tsx whitespace gaps while range hover still opens", async ({
  page,
}) => {
  const content = [
    "export function DemoInspector() {",
    "  return (",
    "    <section>",
    "      <h2>Demo Inspector</h2>",
    '      <button type="button" onClick={() =>',
    '        setSelectedPanel("terminal")}>',
    "        Focus terminal",
    "      </button>",
    "    </section>",
    "  );",
    "}",
  ].join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 4, character: 6 },
        end: { line: 5, character: 39 },
      },
      severity: 1,
      code: "TSX1005",
      message: "JSX diagnostic spans a multiline button tag.",
      source: "typescript",
    },
  ]);

  const fragments = await page
    .locator(".cm-diagnostic-range-error")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(fragments.length).toBeGreaterThan(3);
  expect(fragments.every((text) => text.trim().length > 0)).toBe(true);
  expect(fragments.every((text) => text === text.trim())).toBe(true);
  expect(fragments.some((text) => text.includes("setSelectedPanel"))).toBe(
    true,
  );

  const range = page
    .locator(".cm-diagnostic-range-error")
    .filter({ hasText: "setSelectedPanel" });
  await expect(range).toHaveCount(1);
  const rangeBox = await range.boundingBox();
  expect(rangeBox).not.toBeNull();

  await page.evaluate(
    ({ x, y }) => {
      const scroller = document.querySelector<HTMLElement>(".cm-scroller");
      if (!scroller) {
        throw new Error("CodeMirror scroller not found");
      }
      const HoverEvent = window.PointerEvent ?? MouseEvent;
      scroller.dispatchEvent(
        new HoverEvent("pointermove", {
          bubbles: true,
          clientX: x,
          clientY: y,
          buttons: 0,
        }),
      );
    },
    {
      x: rangeBox!.x + Math.min(18, rangeBox!.width / 2),
      y: rangeBox!.y + rangeBox!.height + 6,
    },
  );

  const tooltip = page.locator(".cm-diagnostic-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(
    "JSX diagnostic spans a multiline button tag.",
  );
  await expect(tooltip).toContainText("TSX1005");
});

test("warning and info diagnostics keep underline and popup parity after another language clears", async ({
  page,
}) => {
  const content = [
    "const ok = true;",
    "const warningValue = 1;",
    "const infoValue = 2;",
    "const lintOnly = 3;",
  ].join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 1, character: 6 },
        end: { line: 1, character: 18 },
      },
      severity: 2,
      message: "warning remains visible",
      source: "tsserver",
      code: "TS6133",
    },
    {
      range: {
        start: { line: 2, character: 6 },
        end: { line: 2, character: 15 },
      },
      severity: 3,
      message: "info remains visible",
      source: "tsserver",
      code: "TS80006",
    },
  ]);

  await page.evaluate(
    async ({ editorFilePath }) => {
      const { useDiagnosticsStore } =
        await import("/src/stores/diagnosticsStore.ts");
      const state = useDiagnosticsStore.getState();
      state.setFileDiagnostics(editorFilePath, "eslint", [
        {
          range: {
            start: { line: 3, character: 6 },
            end: { line: 3, character: 14 },
          },
          severity: 1,
          message: "eslint transient error",
          source: "eslint",
          code: "no-demo",
        },
      ]);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      state.setFileDiagnostics(editorFilePath, "eslint", []);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    },
    { editorFilePath },
  );

  await expect(page.locator(".cm-diagnostic-range-error")).toHaveCount(0);
  await expect(page.locator(".cm-diagnostic-range-warning")).toHaveCount(1);
  await expect(page.locator(".cm-diagnostic-range-info")).toHaveCount(1);

  await page.locator(".cm-diagnostic-range-warning").hover();
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText(
    "warning remains visible",
  );
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText("TS6133");

  await page.locator(".cm-diagnostic-range-info").hover();
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText(
    "info remains visible",
  );
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText("TS80006");
});

test("runtime diagnostics ignores malformed items and explicit empty clears only matching language", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");
    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/workspace");
    const store = diagnostics.useDiagnosticsStore.getState();
    store.reset();
    store.setProjectScope("/workspace", 5);

    emit("lsp:diagnostics", {
      projectPath: "/workspace",
      generation: 5,
      filePath: "/workspace/src/shared.ts",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 6 },
          },
          severity: 1,
          message: "typescript diagnostic remains",
          source: "tsserver",
          code: "TS1005",
        },
      ],
    });
    emit("lsp:diagnostics", {
      projectPath: "/workspace",
      generation: 5,
      filePath: "/workspace/src/shared.ts",
      language: "eslint",
      items: [
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 6 },
          },
          severity: 2,
          message: "eslint diagnostic clears",
          source: "eslint",
          code: "lint/demo",
        },
      ],
    });
    emit("lsp:diagnostics", {
      projectPath: "/workspace",
      generation: 5,
      filePath: "/workspace/src/shared.ts",
      language: "typescript",
      items: null,
    });
    emit("lsp:diagnostics", {
      projectPath: "/workspace",
      generation: 5,
      filePath: "/workspace/src/shared.ts",
      language: "typescript",
    });
    emit("lsp:diagnostics", {
      projectPath: "/workspace",
      generation: 5,
      filePath: "/workspace/src/shared.ts",
      language: "eslint",
      items: [],
    });

    const snapshot = diagnostics.useDiagnosticsStore.getState();
    const group = snapshot.byFile.get("/workspace/src/shared.ts");
    return {
      total: group?.summary.total ?? 0,
      languages: group?.language ?? "",
      messages: group?.items.map((item) => item.message) ?? [],
      projectTotal: snapshot.projectSummary.total,
    };
  });

  expect(result).toEqual({
    total: 1,
    languages: "typescript",
    messages: ["typescript diagnostic remains"],
    projectTotal: 1,
  });
});

test("diagnostics stay out of text flow and aggregate hover messages", async ({
  page,
}) => {
  const content = [
    "const untouched = true;",
    "const padding = true;",
    'const brokenScore = "bad";',
    "const spacer = true;",
    "missingDemoFunction();",
    "const tail = true;",
  ].join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 2, character: 6 },
        end: { line: 2, character: 17 },
      },
      severity: 1,
      message:
        "Type 'string' is not assignable to type 'number' and should remain outside the text flow.",
      source: "tsserver",
    },
    {
      range: {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 19 },
      },
      severity: 1,
      message: "Cannot find name 'missingDemoFunction'.",
      source: "tsserver",
    },
    {
      range: {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 19 },
      },
      severity: 2,
      message: "Second diagnostic on the same visible line.",
      source: "eslint",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );

  await expect(page.locator(".cm-diagnostic-range-error")).toHaveCount(2);

  await page
    .locator(".cm-diagnostic-range-error")
    .filter({ hasText: "missingDemoFunction" })
    .hover();
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText(
    "Cannot find name 'missingDemoFunction'.",
  );
  await expect(page.locator(".cm-diagnostic-tooltip")).toContainText(
    "Second diagnostic on the same visible line.",
  );

  await page.locator(".cm-line").first().click();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );
  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );
});

test("diagnostics store drops stale project and generation events", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/beta");
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/beta", 0);

    emit("lsp:ready", {
      generation: 2,
      projectPath: "/projects/beta",
    });
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/beta", 2);

    emit("lsp:diagnostics", {
      filePath: "/projects/alpha/src/app.ts",
      generation: 1,
      projectPath: "/projects/alpha",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
          severity: 1,
          message: "alpha stale",
        },
      ],
    });

    emit("lsp:diagnostics", {
      filePath: "/projects/beta/src/stale.ts",
      generation: 1,
      projectPath: "/projects/beta",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          severity: 1,
          message: "beta stale generation",
        },
      ],
    });

    emit("lsp:diagnostics", {
      filePath: "/projects/beta/src/live.ts",
      generation: 2,
      projectPath: "/projects/beta",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 7 },
          },
          severity: 2,
          message: "beta live",
        },
      ],
    });

    const state = diagnostics.useDiagnosticsStore.getState() as {
      byFile: Map<string, { summary: { total: number } }>;
      activeProjectPath?: string | null;
      currentGeneration?: number;
    };

    return {
      activeProjectPath: state.activeProjectPath ?? null,
      currentGeneration: state.currentGeneration ?? 0,
      entries: Array.from(state.byFile.keys()),
      totals: Array.from(state.byFile.values()).map(
        (group) => group.summary.total,
      ),
    };
  });

  expect(result.activeProjectPath).toBe("/projects/beta");
  expect(result.currentGeneration).toBe(2);
  expect(result.entries).toEqual(["/projects/beta/src/live.ts"]);
  expect(result.totals).toEqual([1]);
});

test("preload lifecycle ignores mismatched project generations", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/beta");

    emit("lsp:ready", {
      generation: 7,
      projectPath: "/projects/beta",
    });

    emit("lsp:diagnostics:preload:start", {
      generation: 6,
      projectPath: "/projects/alpha",
    });
    const afterWrongStart = projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:start", {
      generation: 7,
      projectPath: "/projects/beta",
    });
    const afterCorrectStart =
      projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:complete", {
      generation: 6,
      projectPath: "/projects/alpha",
    });
    const afterWrongComplete =
      projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:complete", {
      generation: 7,
      projectPath: "/projects/beta",
    });
    const afterCorrectComplete =
      projectState.getProjectDiagnosticsPreloadSnapshot();

    return {
      afterWrongStart,
      afterCorrectStart,
      afterWrongComplete,
      afterCorrectComplete,
    };
  });

  expect(result.afterWrongStart).toEqual({
    active: false,
    bounded: false,
    checkedCandidates: 0,
    completed: false,
    coverageMode: "",
    coverageState: "pending",
    failedCandidates: 0,
    generation: 7,
    message: "",
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterCorrectStart).toEqual({
    active: true,
    bounded: false,
    checkedCandidates: 0,
    completed: false,
    coverageMode: "",
    coverageState: "running",
    failedCandidates: 0,
    generation: 7,
    message: "",
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterWrongComplete).toEqual({
    active: true,
    bounded: false,
    checkedCandidates: 0,
    completed: false,
    coverageMode: "",
    coverageState: "running",
    failedCandidates: 0,
    generation: 7,
    message: "",
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterCorrectComplete).toEqual({
    active: false,
    bounded: false,
    checkedCandidates: 0,
    completed: true,
    coverageMode: "",
    coverageState: "unavailable",
    failedCandidates: 0,
    generation: 7,
    message: "",
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });
});

test("preload lifecycle resets same-path state for a new project session", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const projectState = await import("/src/utils/projectBoundState.ts");
    const sessionRoute = await import("/src/shell/projectSessionRoute.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    try {
      sessionRoute.setProjectSessionRoutePayloadOverride({
        sessionId: "session-a",
      });
      projectState.resetProjectBoundStores();
      projectState.activateProjectScope("/projects/beta");

      emit("lsp:ready", {
        sessionId: "session-a",
        generation: 4,
        projectPath: "/projects/beta",
      });
      emit("lsp:diagnostics:preload:complete", {
        sessionId: "session-a",
        generation: 4,
        projectPath: "/projects/beta",
        coverageState: "complete",
        totalCandidates: 1,
        selectedCandidates: 1,
        checkedCandidates: 1,
        totalLanguages: 1,
        selectedLanguages: 1,
      });
      const beforeSwitch = projectState.getProjectDiagnosticsPreloadSnapshot();

      sessionRoute.setProjectSessionRoutePayloadOverride({
        sessionId: "session-b",
      });
      projectState.activateProjectScope("/projects/beta");
      const afterSwitch = projectState.getProjectDiagnosticsPreloadSnapshot();

      return { beforeSwitch, afterSwitch };
    } finally {
      sessionRoute.setProjectSessionRoutePayloadOverride(null);
    }
  });

  expect(result.beforeSwitch).toMatchObject({
    completed: true,
    coverageState: "complete",
    generation: 4,
    projectPath: "/projects/beta",
  });
  expect(result.afterSwitch).toMatchObject({
    active: false,
    checkedCandidates: 0,
    completed: false,
    coverageState: "pending",
    generation: 0,
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    totalCandidates: 0,
  });
});

test("preload lifecycle accepts backend events before explicit scope activation", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();

    emit("lsp:ready", {
      generation: 9,
      projectPath: "/projects/gamma",
    });
    emit("lsp:diagnostics:preload:start", {
      generation: 9,
      projectPath: "/projects/gamma",
    });
    const afterStart = projectState.getProjectDiagnosticsPreloadSnapshot();

    projectState.activateProjectScope("/projects/gamma");
    const afterActivate = projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:complete", {
      generation: 9,
      projectPath: "/projects/gamma",
    });
    const afterComplete = projectState.getProjectDiagnosticsPreloadSnapshot();

    return {
      afterStart,
      afterActivate,
      afterComplete,
    };
  });

  expect(result.afterStart).toEqual({
    active: true,
    bounded: false,
    checkedCandidates: 0,
    completed: false,
    coverageMode: "",
    coverageState: "running",
    failedCandidates: 0,
    generation: 9,
    message: "",
    projectPath: "/projects/gamma",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterActivate).toEqual({
    active: true,
    bounded: false,
    checkedCandidates: 0,
    completed: false,
    coverageMode: "",
    coverageState: "running",
    failedCandidates: 0,
    generation: 9,
    message: "",
    projectPath: "/projects/gamma",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterComplete).toEqual({
    active: false,
    bounded: false,
    checkedCandidates: 0,
    completed: true,
    coverageMode: "",
    coverageState: "unavailable",
    failedCandidates: 0,
    generation: 9,
    message: "",
    projectPath: "/projects/gamma",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });
});

test("preload lifecycle carries bounded metadata for large workloads", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/huge");
    emit("lsp:ready", {
      generation: 11,
      projectPath: "/projects/huge",
    });

    emit("lsp:diagnostics:preload:start", {
      generation: 11,
      projectPath: "/projects/huge",
      bounded: true,
      totalCandidates: 120,
      selectedCandidates: 16,
      totalLanguages: 5,
      selectedLanguages: 2,
    });
    const during = projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:complete", {
      generation: 11,
      projectPath: "/projects/huge",
      bounded: true,
      totalCandidates: 120,
      selectedCandidates: 16,
      totalLanguages: 5,
      selectedLanguages: 2,
    });
    const after = projectState.getProjectDiagnosticsPreloadSnapshot();

    return { during, after };
  });

  expect(result.during).toEqual({
    active: true,
    bounded: true,
    checkedCandidates: 0,
    completed: false,
    coverageMode: "",
    coverageState: "running",
    failedCandidates: 0,
    generation: 11,
    message: "",
    projectPath: "/projects/huge",
    selectedCandidates: 16,
    selectedLanguages: 2,
    timedOut: false,
    totalCandidates: 120,
    totalLanguages: 5,
  });
  expect(result.after).toEqual({
    active: false,
    bounded: true,
    checkedCandidates: 0,
    completed: true,
    coverageMode: "",
    coverageState: "incomplete",
    failedCandidates: 0,
    generation: 11,
    message: "",
    projectPath: "/projects/huge",
    selectedCandidates: 16,
    selectedLanguages: 2,
    timedOut: false,
    totalCandidates: 120,
    totalLanguages: 5,
  });
});

test("project scope activated before runtime events preserves diagnostics", async ({
  page,
}) => {
  const state = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/beta");
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/beta", 0);

    emit("lsp:ready", {
      projectPath: "/projects/beta",
      generation: 3,
    });
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/beta", 3);
    emit("lsp:diagnostics:preload:start", {
      projectPath: "/projects/beta",
      generation: 3,
    });
    emit("lsp:diagnostics", {
      projectPath: "/projects/beta",
      generation: 3,
      filePath: "/projects/beta/src/live.ts",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          severity: 1,
          message: "project open diagnostic",
        },
      ],
    });
    emit("lsp:diagnostics:preload:complete", {
      projectPath: "/projects/beta",
      generation: 3,
      coverageState: "complete",
      coverageMode: "synthetic-open",
      totalCandidates: 1,
      selectedCandidates: 1,
      checkedCandidates: 1,
      totalLanguages: 1,
      selectedLanguages: 1,
    });

    const snapshot = diagnostics.useDiagnosticsStore.getState() as {
      byFile: Map<string, { summary: { total: number } }>;
      activeProjectPath?: string | null;
      currentGeneration?: number;
    };

    return {
      activeProjectPath: snapshot.activeProjectPath ?? null,
      currentGeneration: snapshot.currentGeneration ?? 0,
      files: Array.from(snapshot.byFile.keys()),
      totals: Array.from(snapshot.byFile.values()).map(
        (group) => group.summary.total,
      ),
      preload: projectState.getProjectDiagnosticsPreloadSnapshot(),
    };
  });

  expect(state.activeProjectPath).toBe("/projects/beta");
  expect(state.currentGeneration).toBe(3);
  expect(state.files).toEqual(["/projects/beta/src/live.ts"]);
  expect(state.totals).toEqual([1]);
  expect(state.preload).toEqual({
    active: false,
    bounded: false,
    checkedCandidates: 1,
    completed: true,
    coverageMode: "synthetic-open",
    coverageState: "complete",
    failedCandidates: 0,
    generation: 3,
    message: "",
    projectPath: "/projects/beta",
    selectedCandidates: 1,
    selectedLanguages: 1,
    timedOut: false,
    totalCandidates: 1,
    totalLanguages: 1,
  });
});

test("diagnostics bind through runtime wrapper without legacy window runtime", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "runtime", {
      configurable: true,
      get: () => undefined,
      set: () => undefined,
    });
  });
  await page.reload();

  const state = await page.evaluate(async () => {
    const moduleKey = Date.now();
    const diagnostics = await import(
      `/src/stores/diagnosticsStore.ts?runtime-free=${moduleKey}`
    );
    const runtime = await import("/src/wails/runtime.ts");

    diagnostics.useDiagnosticsStore.getState().reset();
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/runtime-free", 0);

    runtime.EventsEmit("lsp:diagnostics", {
      projectPath: "/projects/runtime-free",
      generation: 1,
      filePath: "/projects/runtime-free/src/main.ts",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 6 },
          },
          severity: 1,
          message: "runtime wrapper diagnostic",
        },
      ],
    });

    const snapshot = diagnostics.useDiagnosticsStore.getState() as {
      byFile: Map<string, { summary: { total: number } }>;
      activeProjectPath?: string | null;
      currentGeneration?: number;
    };

    return {
      activeProjectPath: snapshot.activeProjectPath ?? null,
      currentGeneration: snapshot.currentGeneration ?? 0,
      files: Array.from(snapshot.byFile.keys()),
      totals: Array.from(snapshot.byFile.values()).map(
        (group) => group.summary.total,
      ),
    };
  });

  expect(state.activeProjectPath).toBe("/projects/runtime-free");
  expect(state.currentGeneration).toBe(1);
  expect(state.files).toEqual(["/projects/runtime-free/src/main.ts"]);
  expect(state.totals).toEqual([1]);
});

test("activated project without completed diagnostics coverage stays scanning until terminal outcome", async ({
  page,
}) => {
  const afterActivate = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/workspace");
    diagnostics.useDiagnosticsStore.getState().setProjectScope("/workspace", 0);

    return projectState.getProjectDiagnosticsPreloadSnapshot();
  });

  expect(afterActivate).toEqual({
    active: false,
    bounded: false,
    checkedCandidates: 0,
    completed: false,
    coverageMode: "",
    coverageState: "pending",
    failedCandidates: 0,
    generation: 0,
    message: "",
    projectPath: "/workspace",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });

  const compactIndicator = page.getByTestId("diagnostics-compact-indicator");
  await expect(compactIndicator).toBeVisible();
  await expect(compactIndicator).toHaveText(/Scanning/);
  await compactIndicator.click();

  const problemsPanel = page.getByTestId("problems-panel");
  await expect(problemsPanel).toBeVisible();
  await expect(problemsPanel.getByText("Diagnostics unavailable")).toHaveCount(
    0,
  );
  await expect(
    problemsPanel.getByText(
      "Workspace diagnostics are not available for the detected files in this project yet.",
    ),
  ).toHaveCount(0);
  await expect(problemsPanel.getByText("Scanning diagnostics")).toBeVisible();
  await expect(problemsPanel.getByText("No matching problems")).toHaveCount(0);

  const afterComplete = await page.evaluate(async () => {
    const projectState = await import("/src/utils/projectBoundState.ts");
    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    emit("lsp:diagnostics:preload:complete", {
      projectPath: "/workspace",
      generation: 0,
      totalCandidates: 0,
      selectedCandidates: 0,
      totalLanguages: 0,
      selectedLanguages: 0,
    });

    return projectState.getProjectDiagnosticsPreloadSnapshot();
  });

  expect(afterComplete).toEqual({
    active: false,
    bounded: false,
    checkedCandidates: 0,
    completed: true,
    coverageMode: "",
    coverageState: "unavailable",
    failedCandidates: 0,
    generation: 0,
    message: "",
    projectPath: "/workspace",
    selectedCandidates: 0,
    selectedLanguages: 0,
    timedOut: false,
    totalCandidates: 0,
    totalLanguages: 0,
  });

  await expect(compactIndicator).toHaveText(/Unavailable/);
  await expect(
    problemsPanel.getByText("Diagnostics unavailable"),
  ).toBeVisible();
  await expect(
    problemsPanel.getByText(
      "Workspace diagnostics are not available for the detected files in this project yet.",
    ),
  ).toBeVisible();
  await expect(problemsPanel.getByText("No matching problems")).toHaveCount(0);
});

test("problems panel stops inline scanning once preload checked every selected file", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");
    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/workspace");
    const store = diagnostics.useDiagnosticsStore.getState();
    store.reset();
    store.setProjectScope("/workspace", 7);

    emit("lsp:ready", {
      projectPath: "/workspace",
      generation: 7,
    });
    emit("lsp:diagnostics", {
      projectPath: "/workspace",
      generation: 7,
      filePath: "/workspace/src/shared.ts",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 6 },
          },
          severity: 1,
          message: "project diagnostic remains visible",
        },
      ],
    });
    emit("lsp:diagnostics:preload:start", {
      projectPath: "/workspace",
      generation: 7,
      coverageState: "running",
      coverageMode: "synthetic-open",
      totalCandidates: 1915,
      selectedCandidates: 1915,
      checkedCandidates: 1915,
      totalLanguages: 6,
      selectedLanguages: 6,
      message: "Still scanning diagnostics across this project.",
    });
  });

  await expect(page.getByTestId("diagnostics-compact-indicator")).toBeVisible();
  await page.getByTestId("diagnostics-compact-indicator").click();
  const problemsPanel = page.getByTestId("problems-panel");
  await expect(problemsPanel).toBeVisible();
  await expect(
    problemsPanel.getByText("project diagnostic remains visible"),
  ).toBeVisible();
  await expect(problemsPanel.getByText("Still scanning")).toHaveCount(0);
});

test("diagnostics status error shows unavailable problems state instead of false clear", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");
    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/workspace");
    diagnostics.useDiagnosticsStore.getState().setProjectScope("/workspace", 3);

    emit("lsp:diagnostics:status", {
      projectPath: "/workspace",
      generation: 3,
      language: "typescript",
      filePath: "/workspace/diagnostics.ts",
      state: "error",
      message: "LSP didOpen failed for diagnostics.ts",
    });
  });

  await expect(page.getByTestId("diagnostics-compact-indicator")).toBeVisible();
  await expect(page.getByTestId("diagnostics-compact-indicator")).toHaveText(
    /Unavailable/,
  );
  await page.getByTestId("diagnostics-compact-indicator").click();
  await expect(page.getByTestId("problems-panel")).toBeVisible();
  await expect(page.getByText("Diagnostics unavailable")).toBeVisible();
  await expect(
    page
      .getByTestId("problems-panel")
      .getByText("LSP didOpen failed for diagnostics.ts"),
  ).toBeVisible();
  await expect(page.getByText("No matching problems")).toHaveCount(0);
});

test("incomplete diagnostics coverage shows incomplete state instead of false clear", async ({
  page,
}) => {
  const snapshot = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");
    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/workspace");
    diagnostics.useDiagnosticsStore.getState().setProjectScope("/workspace", 3);

    emit("lsp:diagnostics:preload:complete", {
      projectPath: "/workspace",
      generation: 3,
      bounded: true,
      coverageState: "incomplete",
      coverageMode: "synthetic-open",
      totalCandidates: 100,
      selectedCandidates: 8,
      checkedCandidates: 8,
      totalLanguages: 4,
      selectedLanguages: 2,
      message: "Diagnostics scan checked a bounded subset of this project.",
    });

    return projectState.getProjectDiagnosticsPreloadSnapshot();
  });

  expect(snapshot).toMatchObject({
    active: false,
    bounded: true,
    checkedCandidates: 8,
    completed: true,
    coverageMode: "synthetic-open",
    coverageState: "incomplete",
    projectPath: "/workspace",
    selectedCandidates: 8,
    totalCandidates: 100,
  });
  await expect(page.getByTestId("diagnostics-compact-indicator")).toBeVisible();
  await expect(page.getByTestId("diagnostics-compact-indicator")).toHaveText(
    /Incomplete/,
  );
  await page.getByTestId("diagnostics-compact-indicator").click();
  const problemsPanel = page.getByTestId("problems-panel");
  await expect(problemsPanel).toBeVisible();
  await expect(problemsPanel.getByText("Diagnostics incomplete")).toHaveCount(
    2,
  );
  await expect(
    problemsPanel.getByText(
      "Diagnostics scan checked a bounded subset of this project.",
    ),
  ).toBeVisible();
  await expect(page.getByText("No matching problems")).toHaveCount(0);
});

test("preload waits for runtime listeners before backend diagnostics publish", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "LSPPreloadProjectDiagnostics") {
            return async () => {
              const emit = (
                window as typeof window & {
                  __emitRuntimeEvent?: (
                    eventName: string,
                    payload: unknown,
                  ) => void;
                }
              ).__emitRuntimeEvent;
              if (typeof emit !== "function") {
                throw new Error("runtime event emitter unavailable");
              }

              emit("lsp:ready", {
                generation: 5,
                projectPath: "/projects/race",
              });
              emit("lsp:diagnostics:preload:start", {
                generation: 5,
                projectPath: "/projects/race",
              });
              emit("lsp:diagnostics", {
                generation: 5,
                projectPath: "/projects/race",
                filePath: "/projects/race/src/main.go",
                language: "go",
                items: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 4 },
                    },
                    severity: 1,
                    message: "race diagnostic",
                  },
                ],
              });
              emit("lsp:diagnostics:preload:complete", {
                generation: 5,
                projectPath: "/projects/race",
                coverageState: "complete",
                coverageMode: "synthetic-open",
                totalCandidates: 1,
                selectedCandidates: 1,
                checkedCandidates: 1,
                totalLanguages: 1,
                selectedLanguages: 1,
              });
              return true;
            };
          }

          return async () => null;
        },
      },
    );
    const goBridge = { main: { App: appBridge } };

    Object.defineProperty(window, "go", {
      configurable: true,
      get: () => goBridge,
      set: () => undefined,
    });
    Object.defineProperty(window, "runtime", {
      configurable: true,
      get: () => undefined,
      set: () => undefined,
    });
  });

  await page.reload();

  const result = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");
    const runtime = await import("/src/wails/runtime.ts");

    (
      window as typeof window & {
        __emitRuntimeEvent?: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent = runtime.EventsEmit;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/race");

    const preloadResult =
      await projectState.preloadProjectDiagnostics("/projects/race");
    const state = diagnostics.useDiagnosticsStore.getState() as {
      byFile: Map<string, { summary: { total: number } }>;
      activeProjectPath?: string | null;
      currentGeneration?: number;
    };

    return {
      preloadResult,
      activeProjectPath: state.activeProjectPath ?? null,
      currentGeneration: state.currentGeneration ?? 0,
      files: Array.from(state.byFile.keys()),
      totals: Array.from(state.byFile.values()).map(
        (group) => group.summary.total,
      ),
      preload: projectState.getProjectDiagnosticsPreloadSnapshot(),
    };
  });

  expect(result.preloadResult).toBe(true);
  expect(result.activeProjectPath).toBe("/projects/race");
  expect(result.currentGeneration).toBe(5);
  expect(result.files).toEqual(["/projects/race/src/main.go"]);
  expect(result.totals).toEqual([1]);
  expect(result.preload).toEqual({
    active: false,
    bounded: false,
    checkedCandidates: 1,
    completed: true,
    coverageMode: "synthetic-open",
    coverageState: "complete",
    failedCandidates: 0,
    generation: 5,
    message: "",
    projectPath: "/projects/race",
    selectedCandidates: 1,
    selectedLanguages: 1,
    timedOut: false,
    totalCandidates: 1,
    totalLanguages: 1,
  });
});
