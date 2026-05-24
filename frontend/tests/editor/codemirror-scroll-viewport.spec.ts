import { expect, test, type Page } from "@playwright/test";

const projectPath = "/workspace";
const filePath = `${projectPath}/README.md`;

const makeReadmeLikeContent = (): string =>
  Array.from({ length: 360 }, (_value, index) => {
    if (index % 17 === 0) {
      return `## Section ${index}`;
    }
    if (index % 11 === 0) {
      return "";
    }
    if (index % 5 === 0) {
      return `This paragraph intentionally uses enough words to wrap in the editor viewport and exercise CodeMirror height-map updates while the application shell is scaled. It is line ${index}.`;
    }
    return `- checklist item ${index} with a short but realistic release note`;
  }).join("\n");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();

    document.documentElement.style.setProperty("--ui-scale", "0.9");
    document.documentElement.style.setProperty(
      "--ui-inverse-scale",
      String(1 / 0.9),
    );

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async () => {
            switch (property) {
              case "AIGetPredictionStatus":
                return null;
              case "GetEditorCompletions":
                return { items: [] };
              case "SearchClasses":
                return [];
              default:
                return true;
            }
          };
        },
      },
    );

    Object.assign(window, {
      _wails: { environment: { OS: "darwin" } },
      go: { main: { App: appBridge } },
      runtime: {
        EventsOn: () => () => undefined,
        EventsOff: () => undefined,
      },
    });
  });
});

const mountScaledEditor = async (page: Page, content: string) => {
  await page.goto("/");

  await page.evaluate(
    async ({ content, filePath, projectPath }) => {
      const shell = document.createElement("div");
      shell.style.position = "fixed";
      shell.style.inset = "0";
      shell.style.overflow = "hidden";

      const scaledSurface = document.createElement("div");
      scaledSurface.style.position = "absolute";
      scaledSurface.style.top = "0";
      scaledSurface.style.left = "0";
      scaledSurface.style.width = `${100 / 0.9}%`;
      scaledSurface.style.height = `${100 / 0.9}%`;
      scaledSurface.style.transform = "scale(0.9)";
      scaledSurface.style.transformOrigin = "top left";
      scaledSurface.style.overflow = "hidden";

      const rootElement = document.createElement("div");
      rootElement.id = "playwright-editor-scroll-viewport-root";
      rootElement.style.width = "980px";
      rootElement.style.height = "860px";

      scaledSurface.appendChild(rootElement);
      shell.appendChild(scaledSurface);
      document.body.innerHTML = "";
      document.body.appendChild(shell);

      const ReactModule = await import("/node_modules/.vite/deps/react.js");
      const React = ReactModule.default;
      const ReactDomClientModule =
        await import("/node_modules/.vite/deps/react-dom_client.js");
      const { createRoot } = ReactDomClientModule.default;
      const { ThemeProvider } = await import("/src/contexts/ThemeContext.tsx");
      const { CodeMirrorEditor } =
        await import("/src/components/CodeMirrorEditor.tsx");

      createRoot(rootElement).render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(CodeMirrorEditor, {
            filePath,
            content,
            language: "markdown",
            projectPath,
            onChange: () => undefined,
            onSave: () => undefined,
            onToggleProblems: () => undefined,
            onOpenFile: () => undefined,
            onQuickLook: () => undefined,
            onTyping: () => undefined,
            onGhostShown: () => undefined,
            onGhostRejected: () => undefined,
            onEditorViewReady: (view: unknown) => {
              Object.assign(window, { __testCodeMirrorView: view });
            },
          }),
        ),
      );
    },
    { content, filePath, projectPath },
  );

  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });
};

test("keeps visible lines during scaled rapid scrolling", async ({ page }) => {
  await mountScaledEditor(page, makeReadmeLikeContent());
  await page.waitForTimeout(800);

  const scroller = page.locator(".cm-scroller").first();
  const box = await scroller.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  let blankSamples = 0;
  let detachedSamples = 0;

  for (let burst = 0; burst < 8; burst += 1) {
    await page.mouse.wheel(0, 2600);
    await page.waitForTimeout(16);

    const sample = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>(".cm-editor");
      if (!editor) return { hasVisibleLine: false, hasDetachedViewport: true };

      const editorRect = editor.getBoundingClientRect();
      const hasVisibleLine = Array.from(
        document.querySelectorAll<HTMLElement>(".cm-line"),
      ).some((line) => {
        const rect = line.getBoundingClientRect();
        return rect.bottom > editorRect.top && rect.top < editorRect.bottom;
      });

      const view = (
        window as unknown as {
          __testCodeMirrorView?: {
            scaleY: number;
            scrollDOM: HTMLElement;
            viewportLineBlocks: Array<{ top: number; bottom: number }>;
          };
        }
      ).__testCodeMirrorView;
      if (!view) return { hasVisibleLine, hasDetachedViewport: true };

      const firstBlock = view.viewportLineBlocks[0];
      if (!firstBlock) return { hasVisibleLine, hasDetachedViewport: true };

      const scaleY =
        Number.isFinite(view.scaleY) && view.scaleY > 0 ? view.scaleY : 1;
      const visibleTop = view.scrollDOM.scrollTop * scaleY;
      const visibleBottom = visibleTop + view.scrollDOM.clientHeight * scaleY;
      return {
        hasVisibleLine,
        hasDetachedViewport: firstBlock.top > visibleBottom,
      };
    });

    if (!sample.hasVisibleLine) {
      blankSamples += 1;
    }
    if (sample.hasDetachedViewport) {
      detachedSamples += 1;
    }
  }

  expect({ blankSamples, detachedSamples }).toEqual({
    blankSamples: 0,
    detachedSamples: 0,
  });
});
