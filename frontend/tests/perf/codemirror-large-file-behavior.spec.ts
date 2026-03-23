import { expect, test, type Page } from "@playwright/test";

const projectPath = "/virtual/large-file-project";
const largeFilePath = `${projectPath}/large.go`;

const smallFileContent = `package main

import "fmt"

func main() {
	fmt.Println("Hello World")
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
    ({ largeFileContent, largeFilePath, projectPath, smallFileContent }) => {
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
          ];
        },
        ReadFile: async (path?: unknown) =>
          path === largeFilePath ? largeFileContent : smallFileContent,
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
      projectPath,
      largeFilePath,
      largeFileContent,
      smallFileContent,
    },
  );
});

async function openProject(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /open project/i }).click();
}

async function openFile(page: Page, filePath: string) {
  const fileEntry = page.locator(`[data-file-path="${filePath}"]`);
  await expect(fileEntry).toBeVisible({ timeout: 10000 });
  await fileEntry.click();
  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });
}

test("large files disable minimap to preserve native editor scrolling", async ({
  page,
}) => {
  await openProject(page);
  await openFile(page, largeFilePath);

  await expect(page.locator(".cm-editor").first()).toBeVisible();
  await expect(page.locator(".cm-minimap-gutter")).toHaveCount(0);
});

test("CodeMirror display rules disable minimap for large docs and keep tooltip layers bounded", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(
    async ({ largeFileContent, smallFileContent }) => {
      const { CODEMIRROR_TOOLTIP_Z_INDEX, shouldEnableCodeMirrorMinimap } =
        await import("/src/utils/codeMirrorDisplay");

      return {
        tooltipZIndex: CODEMIRROR_TOOLTIP_Z_INDEX,
        largeFileMinimap: shouldEnableCodeMirrorMinimap(largeFileContent),
        smallFileMinimap: shouldEnableCodeMirrorMinimap(smallFileContent),
      };
    },
    { largeFileContent, smallFileContent },
  );

  expect(result.tooltipZIndex).toBeLessThanOrEqual(60);
  expect(result.largeFileMinimap).toBe(false);
  expect(result.smallFileMinimap).toBe(true);
});
