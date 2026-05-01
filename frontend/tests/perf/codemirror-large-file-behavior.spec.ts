import { expect, test, type Page } from "@playwright/test";

const projectPath = "/virtual/large-file-project";
const largeFilePath = `${projectPath}/large.go`;
const hugeGeneratedFilePath = `${projectPath}/huge-generated.cs`;
const longLineFilePath = `${projectPath}/long-line.txt`;
const horizontalFilePath = `${projectPath}/horizontal.go`;
const slowFilePath = `${projectPath}/slow.go`;
const fastFilePath = `${projectPath}/fast.go`;

type OpenedFile = {
  path: string;
  content: string;
  name: string;
};

const smallFileContent = `package main

import "fmt"

func main() {
	fmt.Println("Hello World")
}
`;
const slowFileContent = `package main

func slow() string {
	return "slow"
}
`;
const fastFileContent = `package main

func fast() string {
	return "fast"
}
`;

const largeFileContent = Array.from({ length: 2200 }, (_value, index) => {
  if (index === 0) {
    return "package main";
  }

  if (index === 2) {
    return "func main() {";
  }

  if (index === 2199) {
    return "}";
  }

  return `var line${index} = ${index}`;
}).join("\n");
const hugeGeneratedFileContent = Array.from(
  { length: 30_000 },
  (_value, index) =>
    `public static readonly string Route${index} = "${"x".repeat(96)}";`,
).join("\n");
const longLineFileContent = "x".repeat(1024 * 1024);
const horizontalFileContent = `package main

const horizontal = "${"x".repeat(12_000)}"

func main() {}
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({
      fastFileContent,
      fastFilePath,
      horizontalFileContent,
      horizontalFilePath,
      hugeGeneratedFileContent,
      hugeGeneratedFilePath,
      largeFileContent,
      largeFilePath,
      longLineFileContent,
      longLineFilePath,
      projectPath,
      slowFileContent,
      slowFilePath,
      smallFileContent,
    }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(
        "workspace-storage",
        JSON.stringify({
          state: {
            projects: [
              {
                id: projectPath,
                path: projectPath,
                name: "large-file-project",
                openedAt: Date.now(),
              },
            ],
            activeId: projectPath,
            switchDirection: 1,
          },
          version: 0,
        }),
      );

      const makeInspection = (
        path: string,
        content: string,
        safeForEditor: boolean,
        reason = "safe for interactive editing",
      ) => {
        const lines = content.split("\n");
        return {
          path,
          name: path.split("/").pop() || path,
          sizeBytes: content.length,
          formattedSize: `${content.length} B`,
          isText: true,
          safeForEditor,
          largeDocument: !safeForEditor,
          reason,
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

      const appHandlers: Record<string, (...args: unknown[]) => unknown> = {
        SelectDirectory: async () => projectPath,
        OpenProject: async () => true,
        GetCurrentProjectPath: async () => projectPath,
        GetRecentProjects: async () => [],
        ValidateEnvironment: async () => null,
        GetDevToolsStatus: async () => [],
        GetLSPInstallStatus: async () => [],
        InspectProject: async () => ({}),
        ReadDirectory: async (path?: unknown) => {
          if (path !== projectPath) {
            return [];
          }

          return [
            {
              name: "large.go",
              path: largeFilePath,
              isDirectory: false,
            },
            {
              name: "slow.go",
              path: slowFilePath,
              isDirectory: false,
            },
            {
              name: "fast.go",
              path: fastFilePath,
              isDirectory: false,
            },
            {
              name: "horizontal.go",
              path: horizontalFilePath,
              isDirectory: false,
            },
            {
              name: "huge-generated.cs",
              path: hugeGeneratedFilePath,
              isDirectory: false,
            },
            {
              name: "long-line.txt",
              path: longLineFilePath,
              isDirectory: false,
            },
          ];
        },
        InspectEditorFile: async (path?: unknown) => {
          if (path === hugeGeneratedFilePath) {
            return makeInspection(
              hugeGeneratedFilePath,
              hugeGeneratedFileContent,
              false,
              "file opens in guarded preview by default",
            );
          }
          if (path === longLineFilePath) {
            return makeInspection(
              longLineFilePath,
              longLineFileContent,
              false,
              "file has a line that is too long for interactive editing",
            );
          }
          if (path === largeFilePath) {
            return makeInspection(largeFilePath, largeFileContent, false);
          }
          if (path === slowFilePath) {
            return makeInspection(slowFilePath, slowFileContent, true);
          }
          if (path === fastFilePath) {
            return makeInspection(fastFilePath, fastFileContent, true);
          }
          if (path === horizontalFilePath) {
            return makeInspection(
              horizontalFilePath,
              horizontalFileContent,
              true,
            );
          }
          return makeInspection(`${path ?? ""}`, smallFileContent, true);
        },
        ReadEditorFilePreview: async (path?: unknown, maxBytes?: unknown) => {
          const limit = typeof maxBytes === "number" ? maxBytes : 64 * 1024;
          const content =
            path === longLineFilePath
              ? longLineFileContent
              : path === hugeGeneratedFilePath
                ? hugeGeneratedFileContent
                : largeFileContent;
          const inspection = await appHandlers.InspectEditorFile(path);
          return {
            inspection,
            content: content.slice(0, limit),
            truncated: content.length > limit,
            previewBytes: Math.min(content.length, limit),
          };
        },
        ReadFile: async (path?: unknown) => {
          if (path === hugeGeneratedFilePath || path === longLineFilePath) {
            throw new Error("guarded preview required");
          }
          if (path === largeFilePath) {
            return largeFileContent;
          }
          if (path === slowFilePath) {
            return new Promise<string>((resolve) => {
              window.setTimeout(() => resolve(slowFileContent), 250);
            });
          }
          if (path === fastFilePath) {
            return fastFileContent;
          }
          if (path === horizontalFilePath) {
            return horizontalFileContent;
          }
          return smallFileContent;
        },
      };

      const appBridge = new Proxy(
        {},
        {
          get: (_target, property: string) => {
            return appHandlers[property] ?? (async () => null);
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
    },
    {
      fastFileContent,
      fastFilePath,
      horizontalFileContent,
      horizontalFilePath,
      hugeGeneratedFileContent,
      hugeGeneratedFilePath,
      projectPath,
      largeFilePath,
      largeFileContent,
      longLineFileContent,
      longLineFilePath,
      slowFileContent,
      slowFilePath,
      smallFileContent,
    },
  );
});

async function mountEditor(page: Page, filePath: string, content: string) {
  await page.goto("/");

  await page.evaluate(
    async ({ content, filePath, projectPath }) => {
      const rootElement = document.createElement("div");
      rootElement.id = "playwright-editor-root";
      rootElement.style.width = "1000px";
      rootElement.style.height = "700px";
      document.body.innerHTML = "";
      document.body.appendChild(rootElement);

      const ReactModule = await import("/node_modules/.vite/deps/react.js");
      const React = ReactModule.default;
      const ReactDomClientModule =
        await import("/node_modules/.vite/deps/react-dom_client.js");
      const { createRoot } = ReactDomClientModule.default;
      const { ThemeProvider } = await import("/src/contexts/ThemeContext.tsx");
      const { CodeMirrorEditor } =
        await import("/src/components/CodeMirrorEditor.tsx");

      const root = createRoot(rootElement);
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(CodeMirrorEditor, {
            filePath,
            content,
            language: "go",
            projectPath,
            onChange: () => undefined,
            onSave: () => undefined,
            onToggleProblems: () => undefined,
            onOpenFile: () => undefined,
            onQuickLook: () => undefined,
            onTyping: () => undefined,
            onGhostShown: () => undefined,
            onGhostRejected: () => undefined,
          }),
        ),
      );
    },
    { content, filePath, projectPath },
  );

  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });
}

async function mountProjectFile(page: Page, filePath: string) {
  await page.goto("/");

  await page.evaluate(
    async ({ filePath, projectPath }) => {
      const rootElement = document.createElement("div");
      rootElement.id = "playwright-project-root";
      rootElement.style.width = "1000px";
      rootElement.style.height = "700px";
      document.body.innerHTML = "";
      document.body.appendChild(rootElement);

      const ReactModule = await import("/node_modules/.vite/deps/react.js");
      const React = ReactModule.default;
      const ReactDomClientModule =
        await import("/node_modules/.vite/deps/react-dom_client.js");
      const { createRoot } = ReactDomClientModule.default;
      const { ThemeProvider } = await import("/src/contexts/ThemeContext.tsx");
      const { ProjectEntryActionsProvider } =
        await import("/src/contexts/ProjectEntryActionsContext.tsx");
      const { loadEditorFile } = await import("/src/utils/editorFileLoader.ts");
      const ProjectScreenModule =
        await import("/src/components/ProjectScreen.tsx");
      const ProjectScreen = ProjectScreenModule.default;
      const file = await loadEditorFile(filePath);
      const projectEntryActions = {
        projectPath,
        getRelativePath: (path: string) => path,
        copyText: async () => true,
        copyAbsolutePath: async () => true,
        copyRelativePath: async () => true,
        copyProjectPath: async () => true,
        revealEntry: async () => true,
        requestCreateEntry: () => undefined,
        requestRenameEntry: () => undefined,
        requestTrashEntry: () => undefined,
      };

      const root = createRoot(rootElement);
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            ProjectEntryActionsProvider,
            { value: projectEntryActions },
            React.createElement(ProjectScreen, {
              projectPath,
              fileToOpen: { file },
              onFileOpened: () => undefined,
            }),
          ),
        ),
      );
    },
    { filePath, projectPath },
  );
}

async function mountExplorer(page: Page) {
  await page.goto("/");

  await page.evaluate(
    async ({ projectPath }) => {
      const testWindow = window as unknown as {
        __openedFiles: OpenedFile[];
      };
      testWindow.__openedFiles = [];

      const rootElement = document.createElement("div");
      rootElement.id = "playwright-explorer-root";
      rootElement.style.width = "420px";
      rootElement.style.height = "720px";
      document.body.innerHTML = "";
      document.body.appendChild(rootElement);

      const ReactModule = await import("/node_modules/.vite/deps/react.js");
      const React = ReactModule.default;
      const ReactDomClientModule =
        await import("/node_modules/.vite/deps/react-dom_client.js");
      const { createRoot } = ReactDomClientModule.default;
      const { ThemeProvider } = await import("/src/contexts/ThemeContext.tsx");
      const { ProjectEntryActionsProvider } =
        await import("/src/contexts/ProjectEntryActionsContext.tsx");
      const { loadEditorFile } = await import("/src/utils/editorFileLoader.ts");
      const { FileExplorer } = await import("/src/components/FileExplorer.tsx");
      let openRequestId = 0;

      const projectEntryActions = {
        projectPath,
        getRelativePath: (path: string) => path,
        copyText: async () => true,
        copyAbsolutePath: async () => true,
        copyRelativePath: async () => true,
        copyProjectPath: async () => true,
        revealEntry: async () => true,
        requestCreateEntry: () => undefined,
        requestRenameEntry: () => undefined,
        requestTrashEntry: () => undefined,
      };

      const root = createRoot(rootElement);
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            ProjectEntryActionsProvider,
            { value: projectEntryActions },
            React.createElement(FileExplorer, {
              projectPath,
              onFileOpen: (path: string, _content: string, name: string) => {
                const requestId = openRequestId + 1;
                openRequestId = requestId;
                void loadEditorFile(path).then((file) => {
                  if (openRequestId !== requestId || file.kind !== "editable") {
                    return;
                  }
                  testWindow.__openedFiles.push({
                    path,
                    content: file.content,
                    name,
                  });
                });
              },
            }),
          ),
        ),
      );
    },
    { projectPath },
  );

  await expect(page.locator(`[data-file-path="${slowFilePath}"]`)).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator(`[data-file-path="${fastFilePath}"]`)).toBeVisible({
    timeout: 10000,
  });
}

test("large files disable minimap to preserve native editor scrolling", async ({
  page,
}) => {
  await mountEditor(page, largeFilePath, largeFileContent);

  await expect(page.locator(".cm-editor").first()).toBeVisible();
  await expect(page.locator(".cm-minimap-gutter")).toHaveCount(0);
});

test("CodeMirror keeps editor theme during adaptive feature reconfiguration", async ({
  page,
}) => {
  await mountEditor(page, fastFilePath, fastFileContent);

  const readTheme = () =>
    page
      .locator(".cm-editor")
      .first()
      .evaluate((element) => {
        const styles = window.getComputedStyle(element);
        const content = element.querySelector(".cm-content");
        const contentStyles = content ? window.getComputedStyle(content) : null;
        const contentColor = contentStyles?.color ?? "";
        const scroller = element.querySelector<HTMLElement>(".cm-scroller");
        const scrollerStyles = scroller
          ? window.getComputedStyle(scroller)
          : null;
        const gutter = element.querySelector<HTMLElement>(".cm-gutters");
        const tokenColors = Array.from(
          element.querySelectorAll<HTMLElement>(".cm-content .cm-line span"),
        )
          .map((token) => window.getComputedStyle(token).color)
          .filter(
            (color, index, colors) =>
              color &&
              color !== contentColor &&
              color !== "rgb(255, 255, 255)" &&
              colors.indexOf(color) === index,
          )
          .sort();
        return {
          color: styles.color,
          backgroundColor: styles.backgroundColor,
          contentColor,
          editorBackgroundVar: styles.getPropertyValue("--editor-bg").trim(),
          fontSize: styles.fontSize,
          gutterWidth: gutter?.getBoundingClientRect().width ?? 0,
          lineHeight: scrollerStyles?.lineHeight ?? "",
          lineWrappingWhiteSpace: contentStyles?.whiteSpace ?? "",
          tokenColors,
        };
      });

  await expect
    .poll(async () => (await readTheme()).tokenColors.length, {
      timeout: 5000,
    })
    .toBeGreaterThan(0);

  const before = await readTheme();
  await page.evaluate(async () => {
    const { usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");
    usePerformanceStore.getState().updateBudget({
      activeEditorCharCount: 3_000_000,
      activeEditorLineCount: 30_000,
      activeEditorLargeDocument: true,
      eventPressure: 100,
      frameGapMs: 90,
    });
  });
  const constrained = await readTheme();
  await page.evaluate(async () => {
    const { usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");
    usePerformanceStore.getState().resetTransientBudget();
  });
  const after = await readTheme();

  expect(constrained.color).toBe(before.color);
  expect(constrained.contentColor).toBe(before.contentColor);
  expect(constrained.editorBackgroundVar).toBe(before.editorBackgroundVar);
  expect(constrained.fontSize).toBe(before.fontSize);
  expect(constrained.gutterWidth).toBe(before.gutterWidth);
  expect(constrained.lineHeight).toBe(before.lineHeight);
  expect(constrained.lineWrappingWhiteSpace).toBe(
    before.lineWrappingWhiteSpace,
  );
  expect(constrained.tokenColors.length).toBeGreaterThan(0);
  expect(after.color).toBe(before.color);
  expect(after.contentColor).toBe(before.contentColor);
  expect(after.editorBackgroundVar).toBe(before.editorBackgroundVar);
  expect(after.fontSize).toBe(before.fontSize);
  expect(after.gutterWidth).toBe(before.gutterWidth);
  expect(after.lineHeight).toBe(before.lineHeight);
  expect(after.lineWrappingWhiteSpace).toBe(before.lineWrappingWhiteSpace);
  expect(after.tokenColors.length).toBeGreaterThan(0);
  expect(before.color).not.toBe("rgb(255, 255, 255)");
  expect(before.contentColor).not.toBe("rgb(255, 255, 255)");
  expect(before.editorBackgroundVar).not.toBe("");
});

test("CodeMirror scroller uses non-strict containment for smooth WebKit repaint", async ({
  page,
}) => {
  await mountEditor(page, fastFilePath, fastFileContent);

  const containment = await page
    .locator(".cm-scroller")
    .first()
    .evaluate((element) => window.getComputedStyle(element).contain);

  expect(containment).not.toContain("strict");
});

test("CodeMirror preserves horizontal shift-scroll position across adaptive idle reconfigure", async ({
  page,
}) => {
  await mountEditor(page, horizontalFilePath, horizontalFileContent);
  await page.addStyleTag({
    content: ".cm-content { white-space: pre !important; }",
  });

  const before = await page
    .locator(".cm-scroller")
    .first()
    .evaluate(async (scroller) => {
      const waitForFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      scroller.scrollLeft = Math.min(420, scroller.scrollWidth);
      scroller.dispatchEvent(new Event("scroll"));
      await waitForFrame();

      return {
        clientWidth: scroller.clientWidth,
        scrollLeft: scroller.scrollLeft,
        scrollWidth: scroller.scrollWidth,
      };
    });

  expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);
  expect(before.scrollLeft).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const { usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");
    usePerformanceStore.getState().updateBudget({
      activeEditorCharCount: 32_000,
      activeEditorLineCount: 80,
      activeEditorLargeDocument: false,
      eventPressure: 120,
      frameGapMs: 95,
    });
  });

  const after = await page
    .locator(".cm-scroller")
    .first()
    .evaluate(async (scroller) => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 260));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      return {
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
    });

  expect(after.scrollLeft).toBeGreaterThanOrEqual(before.scrollLeft - 1);
  expect(after.scrollTop).toBe(0);
});

test("CodeMirror keeps rendered lines across rapid scroll jumps", async ({
  page,
}) => {
  await mountEditor(page, largeFilePath, largeFileContent);

  const samples = await page
    .locator(".cm-scroller")
    .first()
    .evaluate(async (scroller) => {
      const waitForFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const scrollTargets = [
        0,
        scroller.scrollHeight * 0.25,
        scroller.scrollHeight * 0.65,
        scroller.scrollHeight,
        scroller.scrollHeight * 0.12,
      ];
      const results: Array<{
        visibleLines: number;
        coveredBands: number;
        scrollActive: boolean;
      }> = [];

      for (const target of scrollTargets) {
        scroller.scrollTop = target;
        scroller.dispatchEvent(new Event("scroll"));
        await waitForFrame();
        await waitForFrame();

        const scrollerRect = scroller.getBoundingClientRect();
        const visibleLines = Array.from(
          scroller.querySelectorAll<HTMLElement>(".cm-line"),
        )
          .map((line) => line.getBoundingClientRect())
          .filter(
            (rect) =>
              rect.bottom > scrollerRect.top + 20 &&
              rect.top < scrollerRect.bottom - 20,
          );
        const bands = [0.2, 0.5, 0.8].map(
          (ratio) =>
            scrollerRect.top + (scrollerRect.bottom - scrollerRect.top) * ratio,
        );
        const coveredBands = bands.filter((band) =>
          visibleLines.some((rect) => rect.top <= band && rect.bottom >= band),
        ).length;
        results.push({
          visibleLines: visibleLines.length,
          coveredBands,
          scrollActive:
            scroller.closest<HTMLElement>(".cm-editor")?.dataset
              .scrollActive === "true",
        });
      }

      return results;
    });

  for (const sample of samples) {
    expect(sample.visibleLines).toBeGreaterThan(8);
    expect(sample.coveredBands).toBeGreaterThanOrEqual(2);
  }
  expect(samples.some((sample) => sample.scrollActive)).toBe(true);
});

test("huge generated files open as guarded preview without mounting CodeMirror", async ({
  page,
}) => {
  await mountProjectFile(page, hugeGeneratedFilePath);

  await expect(page.getByTestId("guarded-editor-preview")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await expect(page.getByText("Guarded preview").first()).toBeVisible();
});

test("single-line huge files open as guarded preview without mounting CodeMirror", async ({
  page,
}) => {
  await mountProjectFile(page, longLineFilePath);

  await expect(page.getByTestId("guarded-editor-preview")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await expect(
    page.getByText("line that is too long", { exact: false }),
  ).toBeVisible();
});

test("editor shows a loading state while a file open is pending", async ({
  page,
}) => {
  await page.goto("/");

  await page.evaluate(
    async ({ projectPath, slowFilePath }) => {
      const rootElement = document.createElement("div");
      rootElement.id = "playwright-loading-root";
      rootElement.style.width = "1000px";
      rootElement.style.height = "700px";
      document.body.innerHTML = "";
      document.body.appendChild(rootElement);

      const ReactModule = await import("/node_modules/.vite/deps/react.js");
      const React = ReactModule.default;
      const ReactDomClientModule =
        await import("/node_modules/.vite/deps/react-dom_client.js");
      const { createRoot } = ReactDomClientModule.default;
      const { ThemeProvider } = await import("/src/contexts/ThemeContext.tsx");
      const { ProjectEntryActionsProvider } =
        await import("/src/contexts/ProjectEntryActionsContext.tsx");
      const { createEditorFileLoadingLoad } =
        await import("/src/utils/editorFileLoader.ts");
      const ProjectScreenModule =
        await import("/src/components/ProjectScreen.tsx");
      const ProjectScreen = ProjectScreenModule.default;
      const projectEntryActions = {
        projectPath,
        getRelativePath: (path: string) => path,
        copyText: async () => true,
        copyAbsolutePath: async () => true,
        copyRelativePath: async () => true,
        copyProjectPath: async () => true,
        revealEntry: async () => true,
        requestCreateEntry: () => undefined,
        requestRenameEntry: () => undefined,
        requestTrashEntry: () => undefined,
      };

      const root = createRoot(rootElement);
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            ProjectEntryActionsProvider,
            { value: projectEntryActions },
            React.createElement(ProjectScreen, {
              projectPath,
              fileToOpen: {
                file: createEditorFileLoadingLoad(slowFilePath, "slow.go"),
              },
              onFileOpened: () => undefined,
            }),
          ),
        ),
      );
    },
    { projectPath, slowFilePath },
  );

  await expect(page.getByTestId("editor-file-loading")).toBeVisible();
  await expect(page.getByTestId("editor-file-loading")).toContainText(
    "slow.go",
  );
});

test("rapid explorer opens ignore stale read responses", async ({ page }) => {
  await mountExplorer(page);

  await page.evaluate(
    ({ fastFilePath, slowFilePath }) => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-file-path]"),
      );
      const slowNode = nodes.find(
        (node) => node.dataset.filePath === slowFilePath,
      );
      const fastNode = nodes.find(
        (node) => node.dataset.filePath === fastFilePath,
      );

      if (!slowNode || !fastNode) {
        throw new Error("Expected rapid-open file nodes to be mounted");
      }

      slowNode.click();
      fastNode.click();
    },
    { fastFilePath, slowFilePath },
  );

  const getOpenedFiles = () =>
    page.evaluate(() => {
      const testWindow = window as unknown as {
        __openedFiles?: OpenedFile[];
      };
      return testWindow.__openedFiles ?? [];
    });

  await expect.poll(getOpenedFiles, { timeout: 3000 }).toEqual([
    {
      path: fastFilePath,
      content: fastFileContent,
      name: "fast.go",
    },
  ]);

  await page.waitForTimeout(300);
  expect(await getOpenedFiles()).toEqual([
    {
      path: fastFilePath,
      content: fastFileContent,
      name: "fast.go",
    },
  ]);
});

test("CodeMirror display rules disable minimap for large docs and keep tooltip layers bounded", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(
    async ({ largeFileContent, smallFileContent }) => {
      const { CODEMIRROR_TOOLTIP_Z_INDEX, shouldEnableCodeMirrorMinimap } =
        await import("/src/utils/codeMirrorDisplay");
      const { shouldUseCodeMirrorLargeDocumentMode } =
        await import("/src/utils/codeMirrorDisplay");

      return {
        tooltipZIndex: CODEMIRROR_TOOLTIP_Z_INDEX,
        largeFileMinimap: shouldEnableCodeMirrorMinimap(largeFileContent),
        smallFileMinimap: shouldEnableCodeMirrorMinimap(smallFileContent),
        largeFileMode: shouldUseCodeMirrorLargeDocumentMode(largeFileContent),
        smallFileMode: shouldUseCodeMirrorLargeDocumentMode(smallFileContent),
      };
    },
    { largeFileContent, smallFileContent },
  );

  expect(result.tooltipZIndex).toBeLessThanOrEqual(60);
  expect(result.largeFileMinimap).toBe(false);
  expect(result.smallFileMinimap).toBe(true);
  expect(result.largeFileMode).toBe(true);
  expect(result.smallFileMode).toBe(false);
});
