import { expect, test, type Page } from "@playwright/test";

const projectPath = "/workspace";
const filePath = `${projectPath}/README.md`;

const makeReadmeLikeContent = (lineCount = 360): string =>
  Array.from({ length: lineCount }, (_value, index) => {
    if (index % 17 === 0) {
      return `## Section ${index}`;
    }
    if (index % 11 === 0) {
      return "";
    }
    if (index % 5 === 0) {
      return `This paragraph intentionally uses enough words to wrap in the editor viewport and exercise CodeMirror height-map updates while the application shell is scaled. It includes markdown links [docs/wails-v3-spike.md](docs/wails-v3-spike.md), inline code \`symbol_${index}\`, and release text. It is line ${index}.`;
    }
    if (index % 7 === 0) {
      return [
        "```bash",
        "./scripts/wails-dev-macos.sh",
        "./scripts/wails3-dev-macos.sh",
        "```",
      ].join("\n");
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
        EventsOnMultiple: () => () => undefined,
      },
    });
  });
});

const mountScaledEditor = async (
  page: Page,
  content: string,
  options: { constrainedPerformance?: boolean } = {},
) => {
  const { constrainedPerformance = false } = options;
  await page.goto("/");

  await page.evaluate(
    async ({ constrainedPerformance, content, filePath, projectPath }) => {
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
      const { useEditorSettingsStore } =
        await import("/src/stores/editorSettingsStore.ts");
      const { usePerformanceStore } =
        await import("/src/stores/performanceStore.ts");

      useEditorSettingsStore.getState().setShowMinimap(true);
      usePerformanceStore.getState().resetTransientBudget();
      usePerformanceStore.getState().resetActiveEditorBudget();
      if (constrainedPerformance) {
        usePerformanceStore.getState().updateBudget({
          activeEditorCharCount: content.length,
          activeEditorLineCount: content.split("\n").length,
          activeEditorLargeDocument: false,
          eventPressure: 0,
          frameGapMs: 0,
          indexerQueueDepth: 220,
          projectFileCount: 7_500,
        });
      }

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
    { constrainedPerformance, content, filePath, projectPath },
  );

  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });
};

const sampleEditorViewport = async (page: Page) =>
  page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    if (!editor) {
      return {
        gapBottom: true,
        gapTop: true,
        hasDetachedViewport: true,
        hasVisibleLine: false,
      };
    }

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
          state: { doc: { length: number } };
          viewportLineBlocks: Array<{
            bottom: number;
            to: number;
            top: number;
          }>;
        };
      }
    ).__testCodeMirrorView;
    if (!view) {
      return {
        gapBottom: true,
        gapTop: true,
        hasDetachedViewport: true,
        hasVisibleLine,
      };
    }

    const firstBlock = view.viewportLineBlocks[0];
    const lastBlock =
      view.viewportLineBlocks[view.viewportLineBlocks.length - 1];
    if (!firstBlock || !lastBlock) {
      return {
        gapBottom: true,
        gapTop: true,
        hasDetachedViewport: true,
        hasVisibleLine,
      };
    }

    const scaleY =
      Number.isFinite(view.scaleY) && view.scaleY > 0 ? view.scaleY : 1;
    const visibleTop = view.scrollDOM.scrollTop * scaleY;
    const visibleBottom = visibleTop + view.scrollDOM.clientHeight * scaleY;
    const lineGap = 48 * scaleY;
    const gapTop = firstBlock.top > visibleTop + lineGap;
    const gapBottom =
      lastBlock.to < view.state.doc.length &&
      lastBlock.bottom < visibleBottom - lineGap;

    return {
      gapBottom,
      gapTop,
      hasDetachedViewport: gapTop || gapBottom,
      hasVisibleLine,
    };
  });

test("prevents native wheel scrolling and repairs viewport before paint", async ({
  page,
}) => {
  await mountScaledEditor(page, makeReadmeLikeContent(600));
  await page.waitForTimeout(800);

  const wheelResult = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller");
    if (!scroller) {
      return {
        afterScrollTop: 0,
        beforeScrollTop: 0,
        canceled: false,
        scrollActive: false,
      };
    }

    const beforeScrollTop = scroller.scrollTop;
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: 0,
      deltaY: 9000,
    });
    const dispatchResult = scroller.dispatchEvent(event);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    return {
      afterScrollTop: scroller.scrollTop,
      beforeScrollTop,
      canceled: !dispatchResult && event.defaultPrevented,
      scrollActive:
        document.querySelector<HTMLElement>(".cm-editor")?.dataset
          .scrollActive === "true",
    };
  });

  expect(wheelResult.canceled).toBe(true);
  expect(wheelResult.afterScrollTop).toBeGreaterThan(
    wheelResult.beforeScrollTop,
  );
  expect(wheelResult.scrollActive).toBe(true);
  await expect
    .poll(async () => (await sampleEditorViewport(page)).hasDetachedViewport)
    .toBe(false);
});

test("does not mount minimap under constrained runtime budget", async ({
  page,
}) => {
  await mountScaledEditor(page, makeReadmeLikeContent(900), {
    constrainedPerformance: true,
  });

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { usePerformanceStore } =
          await import("/src/stores/performanceStore.ts");
        return usePerformanceStore.getState().mode;
      }),
    )
    .toBe("constrained");
  await expect(page.locator(".cm-minimap-gutter")).toHaveCount(0);
});

test("keeps visible lines during scaled rapid scrolling", async ({ page }) => {
  await mountScaledEditor(page, makeReadmeLikeContent(900));
  await page.waitForTimeout(800);

  const scroller = page.locator(".cm-scroller").first();
  const box = await scroller.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  let blankSamples = 0;
  let detachedSamples = 0;
  const wheelDeltas = [
    2600, 5200, 9000, -5200, -9000, 12_000, -12_000, 18_000, -18_000, 6200,
  ];

  for (const delta of wheelDeltas) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(16);

    const sample = await sampleEditorViewport(page);

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
