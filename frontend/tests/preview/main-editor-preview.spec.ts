import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    const files: Record<string, string> = {
      "/workspace/index.html":
        "<!doctype html><html><body>Main editor preview</body></html>",
      "/workspace/README.md":
        '# Initial live preview\n\n<p align="center"><img src="https://example.test/badge.svg" alt="Preview badge" width="128" /></p>\n\n<h2 align="center">HTML heading</h2>\n\n- [docs](https://example.test/docs)\n\n- ready',
    };
    const imageDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    (window as Window & { __writeCalls?: number }).__writeCalls = 0;
    (
      window as Window & {
        __externalOpenCalls?: Array<{
          url: string;
          target: string | undefined;
          features: string | undefined;
        }>;
      }
    ).__externalOpenCalls = [];
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      (
        window as Window & {
          __externalOpenCalls?: Array<{
            url: string;
            target: string | undefined;
            features: string | undefined;
          }>;
        }
      ).__externalOpenCalls?.push({
        url: url?.toString() ?? "",
        target,
        features,
      });
      return window;
    }) as typeof window.open;

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (...args: unknown[]) => {
            switch (property) {
              case "GetCurrentProjectFramework":
                return null;
              case "GetCurrentProjectPath":
                return "/workspace";
              case "GetRecentProjects":
              case "GetDevToolsStatus":
                return [];
              case "OpenProject":
              case "CreateTerminal":
              case "WriteTerminal":
              case "SendTerminalText":
              case "CloseTerminal":
              case "ResizeTerminal":
                return true;
              case "WriteFile":
                (window as Window & { __writeCalls?: number }).__writeCalls =
                  ((window as Window & { __writeCalls?: number })
                    .__writeCalls ?? 0) + 1;
                return true;
              case "ReadDirectory":
                return [
                  {
                    name: "index.html",
                    path: "/workspace/index.html",
                    isDirectory: false,
                  },
                  {
                    name: "README.md",
                    path: "/workspace/README.md",
                    isDirectory: false,
                  },
                  {
                    name: "logo.png",
                    path: "/workspace/logo.png",
                    isDirectory: false,
                  },
                ];
              case "InspectEditorFile":
                if (typeof args[0] === "string" && args[0] in files) {
                  const content = files[args[0]];
                  return {
                    path: args[0],
                    name: args[0].split("/").pop(),
                    sizeBytes: content.length,
                    formattedSize: `${content.length} B`,
                    isText: true,
                    safeForEditor: true,
                    largeDocument: false,
                    reason: "safe for interactive editing",
                    lineCount: content.split("\n").length,
                    maxLineLength: Math.max(
                      ...content.split("\n").map((line) => line.length),
                    ),
                    limitBytes: 2 * 1024 * 1024,
                    lineLimit: 20_000,
                    maxLineLengthLimit: 20_000,
                  };
                }
                return null;
              case "ReadEditorVisualFile":
                return {
                  path: "/workspace/logo.png",
                  name: "logo.png",
                  sizeBytes: 68,
                  formattedSize: "68 B",
                  mimeType: "image/png",
                  dataUrl: imageDataUrl,
                };
              case "ReadFile":
                return files[typeof args[0] === "string" ? args[0] : ""] ?? "";
              case "GetLanguageForFile":
                if (args[0] === "/workspace/README.md") {
                  return { id: "markdown" };
                }
                return { id: "html" };
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
});

test("Browser Preview uses file opened in the main editor", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator('[data-file-path="/workspace/index.html"]').click();
  await expect(page.getByText("Main editor preview")).toBeVisible();
  await expect(
    page.getByTestId("editor-tabs-markdown-preview-toggle"),
  ).toHaveCount(0);

  await page.getByTestId("topbar-preview-button").click();

  const previewPayload = await page.evaluate(async () => {
    const { usePreviewWindowStore } =
      await import("/src/stores/previewWindowStore.ts");

    const windowState = usePreviewWindowStore.getState().windows[0];
    return windowState
      ? {
          url: windowState.payload.url ?? null,
          htmlContent: windowState.payload.htmlContent ?? null,
          sourceLabel: windowState.payload.sourceLabel ?? null,
        }
      : null;
  });

  expect(previewPayload).not.toBeNull();
  expect(previewPayload?.url).toBe("");
  expect(previewPayload?.sourceLabel).toBe("index.html");
  expect(previewPayload?.htmlContent).toContain("Main editor preview");
});

test("image files open inline in the main editor surface", async ({ page }) => {
  await page.goto("/");

  const loaderResult = await page.evaluate(async () => {
    const { loadEditorFile } = await import("/src/utils/editorFileLoader.ts");
    const file = await loadEditorFile("/workspace/logo.png");
    return { kind: file.kind, name: file.name };
  });
  expect(loaderResult).toEqual({ kind: "visualPreview", name: "logo.png" });

  await page.locator('[data-file-path="/workspace/logo.png"]').click();

  await expect(page.getByTestId("image-editor-preview")).toBeVisible();
  await expect(page.getByTestId("image-editor-preview")).toContainText(
    "image/png",
  );
  await expect(
    page.getByTestId("editor-tabs-markdown-preview-toggle"),
  ).toHaveCount(0);
  await expect(page.getByTestId("panel-markdownPreview")).toHaveCount(0);

  const previewWindowCount = await page.evaluate(async () => {
    const { usePreviewWindowStore } =
      await import("/src/stores/previewWindowStore.ts");

    return usePreviewWindowStore.getState().windows.length;
  });
  expect(previewWindowCount).toBe(0);
});

test("Markdown preview panel follows the active tab and updates before autosave", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator('[data-file-path="/workspace/README.md"]').click();
  const toggle = page.getByTestId("editor-tabs-markdown-preview-toggle");
  await expect(toggle).toBeEnabled();
  await toggle.click();

  const panel = page.getByTestId("panel-markdownPreview");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Initial live preview");
  await expect(panel).not.toContainText('<p align="center">');
  await expect(
    panel.getByRole("heading", { name: "HTML heading" }),
  ).toBeVisible();
  await expect(panel.locator('img[alt="Preview badge"]')).toHaveAttribute(
    "width",
    "128",
  );

  await page.locator(".cm-content").first().click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.keyboard.type("# Changed\n\npreview-now");

  await expect(panel).toContainText("preview-now", { timeout: 500 });
  const writeCalls = await page.evaluate(
    () => (window as Window & { __writeCalls?: number }).__writeCalls ?? 0,
  );
  expect(writeCalls).toBe(0);

  await page.locator('[data-file-path="/workspace/index.html"]').click();
  await expect(
    page.getByTestId("editor-tabs-markdown-preview-toggle"),
  ).toHaveCount(0);
  await expect(panel).toContainText("Open a Markdown tab");
});

test("Markdown preview opens external links through the shell fallback", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator('[data-file-path="/workspace/README.md"]').click();
  const toggle = page.getByTestId("editor-tabs-markdown-preview-toggle");
  await expect(toggle).toBeEnabled();
  await toggle.click();

  await page.evaluate(async () => {
    const { syncShellCapabilities } =
      await import("/src/shell/shellCapabilities.ts");
    syncShellCapabilities({
      browserOpenURL: {
        status: "unavailable",
        reason: "Runtime browser open disabled for fallback test.",
        source: "backend",
      },
    });
  });

  const panel = page.getByTestId("panel-markdownPreview");
  const link = panel.getByRole("link", { name: "docs" });
  await expect(link).toBeVisible();
  await link.click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __externalOpenCalls?: Array<{
                url: string;
                target: string | undefined;
                features: string | undefined;
              }>;
            }
          ).__externalOpenCalls ?? [],
      ),
    )
    .toEqual([
      {
        url: "https://example.test/docs",
        target: "_blank",
        features: "noopener,noreferrer",
      },
    ]);
});

test("Markdown preview opens external links in Browser Preview when configured", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator('[data-file-path="/workspace/README.md"]').click();
  const toggle = page.getByTestId("editor-tabs-markdown-preview-toggle");
  await expect(toggle).toBeEnabled();
  await toggle.click();

  await page.evaluate(async () => {
    const { useBrowserPreviewStore } =
      await import("/src/stores/browserPreviewStore.ts");
    useBrowserPreviewStore.getState().setMarkdownLinkOpenMode("preview");
  });

  const panel = page.getByTestId("panel-markdownPreview");
  const link = panel.getByRole("link", { name: "docs" });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page.getByTestId("panel-markdown-link-preview")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { usePreviewWindowStore } =
          await import("/src/stores/previewWindowStore.ts");
        const windowState = usePreviewWindowStore
          .getState()
          .windows.find(
            (candidate) => candidate.id === "markdown-link-preview",
          );
        return windowState
          ? {
              surface: windowState.surface,
              mode: windowState.mode,
              url: windowState.payload.url ?? null,
              htmlContent: windowState.payload.htmlContent ?? null,
              sourceLabel: windowState.payload.sourceLabel ?? null,
            }
          : null;
      }),
    )
    .toEqual({
      surface: "browser",
      mode: "floating",
      url: "https://example.test/docs",
      htmlContent: "",
      sourceLabel: "",
    });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __externalOpenCalls?: Array<{
                url: string;
                target: string | undefined;
                features: string | undefined;
              }>;
            }
          ).__externalOpenCalls ?? [],
      ),
    )
    .toEqual([]);
});
