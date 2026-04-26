import { expect, test, type Page } from "@playwright/test";

const projectPath = "/virtual/large-file-project";
const largeFilePath = `${projectPath}/large.go`;
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({
      fastFileContent,
      fastFilePath,
      largeFileContent,
      largeFilePath,
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
          ];
        },
        ReadFile: async (path?: unknown) => {
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
      projectPath,
      largeFilePath,
      largeFileContent,
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
      const { FileExplorer } = await import("/src/components/FileExplorer.tsx");

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
              onFileOpen: (path: string, content: string, name: string) => {
                testWindow.__openedFiles.push({ path, content, name });
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
