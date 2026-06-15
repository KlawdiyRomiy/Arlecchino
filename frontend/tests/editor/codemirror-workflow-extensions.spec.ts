import { expect, test, type Page } from "@playwright/test";

const projectPath = "/workspace";

interface MountEditorOptions {
  content?: string;
  filePath?: string;
  language?: string;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async () => {
            switch (property) {
              case "GetEditorCompletions":
                return { items: [] };
              case "SearchClasses":
                return [];
              case "LSPHover":
              case "LSPSignatureHelp":
                return "";
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

  await page.goto("/");
});

const mountEditor = async (page: Page, options: MountEditorOptions = {}) => {
  const content =
    options.content ??
    `.root {
  color: #ff00aa;

  .child {
    color: rgba(10, 20, 30, 0.8);
  }
}
`;
  const filePath = options.filePath ?? `${projectPath}/src/styles/theme.scss`;
  const language = options.language ?? "scss";

  await page.evaluate(
    async ({ content, filePath, language, projectPath }) => {
      const rootElement = document.createElement("div");
      rootElement.id = "playwright-codemirror-workflow-root";
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
      const { useEditorSettingsStore } =
        await import("/src/stores/editorSettingsStore.ts");

      useEditorSettingsStore.getState().setShowFoldGutter(true);
      useEditorSettingsStore.getState().setShowIndentGuides(true);
      useEditorSettingsStore.getState().setShowColorTools(true);

      createRoot(rootElement).render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(CodeMirrorEditor, {
            filePath,
            content,
            language,
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
    { content, filePath, language, projectPath },
  );

  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });
};

const readDefinitionCursorState = async (
  page: Page,
): Promise<{
  contentCursor: string;
  decorationCount: number;
  hasActiveClass: boolean;
  lineCursor: string;
  scrollerCursor: string;
}> => {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    const content = editor?.querySelector<HTMLElement>(".cm-content") ?? null;
    const line = editor?.querySelector<HTMLElement>(".cm-line") ?? null;
    const scroller = editor?.querySelector<HTMLElement>(".cm-scroller") ?? null;

    return {
      contentCursor: content ? getComputedStyle(content).cursor : "",
      decorationCount:
        editor?.querySelectorAll(".definition-link-hover").length ?? 0,
      hasActiveClass:
        editor?.classList.contains("cm-definition-link-active") ?? false,
      lineCursor: line ? getComputedStyle(line).cursor : "",
      scrollerCursor: scroller ? getComputedStyle(scroller).cursor : "",
    };
  });
};

const activateDefinitionHover = async (
  page: Page,
): Promise<Awaited<ReturnType<typeof readDefinitionCursorState>>> => {
  return page.evaluate(async () => {
    const { EditorView } =
      await import("/node_modules/.vite/deps/@codemirror_view.js");
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    if (!editor) {
      throw new Error("Missing CodeMirror editor");
    }

    const view = EditorView.findFromDOM(editor);
    if (!view) {
      throw new Error("Missing CodeMirror view");
    }

    const source = view.state.doc.toString();
    const from = source.lastIndexOf("ready");
    if (from < 0) {
      throw new Error("Missing ready symbol");
    }

    const start = view.coordsAtPos(from + 1);
    const end = view.coordsAtPos(from + "ready".length);
    if (!start || !end) {
      throw new Error("Missing ready symbol coordinates");
    }

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        clientX: (start.left + end.right) / 2,
        clientY: start.top + (start.bottom - start.top) / 2,
        metaKey: true,
      }),
    );

    const content = editor.querySelector<HTMLElement>(".cm-content");
    const line = editor.querySelector<HTMLElement>(".cm-line");
    const scroller = editor.querySelector<HTMLElement>(".cm-scroller");

    return {
      contentCursor: content ? getComputedStyle(content).cursor : "",
      decorationCount: editor.querySelectorAll(".definition-link-hover").length,
      hasActiveClass: editor.classList.contains("cm-definition-link-active"),
      lineCursor: line ? getComputedStyle(line).cursor : "",
      scrollerCursor: scroller ? getComputedStyle(scroller).cursor : "",
    };
  });
};

test("shared CodeMirror registry resolves low-risk rollout languages", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const {
      getCodeMirrorLanguageExtension,
      inferCodeMirrorLanguageFromPath,
      isCodeMirrorColorToolTarget,
    } = await import("/src/utils/codeMirrorLanguageRegistry.ts");
    const { resolveAdaptiveEditorFeatureBudget } =
      await import("/src/stores/performanceStore.ts");
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    const {
      createCodeMirrorFoldExtensions,
      createCodeMirrorIndentGuideExtension,
    } = await import("/src/utils/codeMirrorWorkflowExtensions.ts");

    const normalBudget = resolveAdaptiveEditorFeatureBudget({
      mode: "normal",
      activeEditorCharCount: 10_000,
      activeEditorLineCount: 200,
      activeEditorLargeDocument: false,
      eventPressure: 0,
      frameGapMs: 0,
      indexerQueueDepth: 0,
      projectFileCount: 0,
      updatedAtMs: 0,
    });
    const largeBudget = resolveAdaptiveEditorFeatureBudget({
      mode: "critical",
      activeEditorCharCount: 2_000_000,
      activeEditorLineCount: 20_000,
      activeEditorLargeDocument: true,
      eventPressure: 0,
      frameGapMs: 0,
      indexerQueueDepth: 0,
      projectFileCount: 0,
      updatedAtMs: 0,
    });
    const settings = useEditorSettingsStore.getState();

    return {
      scss: Boolean(getCodeMirrorLanguageExtension("scss")),
      sass: Boolean(getCodeMirrorLanguageExtension("sass")),
      less: Boolean(getCodeMirrorLanguageExtension("less")),
      vue: Boolean(getCodeMirrorLanguageExtension("vue")),
      tsxAlias: Boolean(getCodeMirrorLanguageExtension("tsx")),
      inferredVue: inferCodeMirrorLanguageFromPath("/workspace/App.vue"),
      cssColorTarget: isCodeMirrorColorToolTarget("css"),
      themeTsColorTarget: isCodeMirrorColorToolTarget(
        "typescript",
        "/workspace/frontend/src/styles/theme.ts",
      ),
      plainTsColorTarget: isCodeMirrorColorToolTarget(
        "typescript",
        "/workspace/frontend/src/App.ts",
      ),
      normalFoldGutter: normalBudget.layoutStableFoldGutter,
      largeFoldGutter: largeBudget.layoutStableFoldGutter,
      showFoldGutter: settings.showFoldGutter,
      showDiagnosticGutter: settings.showDiagnosticGutter,
      showIndentGuides: settings.showIndentGuides,
      showColorTools: settings.showColorTools,
      enabledFoldExtensions: createCodeMirrorFoldExtensions(true, true).length,
      disabledFoldExtensions: createCodeMirrorFoldExtensions(false, false)
        .length,
      indentGuideEnabled: Array.isArray(
        createCodeMirrorIndentGuideExtension(true),
      ),
    };
  });

  expect(result).toEqual({
    scss: true,
    sass: true,
    less: true,
    vue: true,
    tsxAlias: true,
    inferredVue: "vue",
    cssColorTarget: true,
    themeTsColorTarget: true,
    plainTsColorTarget: false,
    normalFoldGutter: true,
    largeFoldGutter: false,
    showFoldGutter: false,
    showDiagnosticGutter: false,
    showIndentGuides: true,
    showColorTools: true,
    enabledFoldExtensions: 2,
    disabledFoldExtensions: 0,
    indentGuideEnabled: true,
  });
});

test("editor renders gated color tools", async ({ page }) => {
  await mountEditor(page);
  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setShowFoldGutter(true);
    useEditorSettingsStore.getState().setShowIndentGuides(true);
    useEditorSettingsStore.getState().setShowColorTools(true);
  });

  await expect(page.locator('input[type="color"]').first()).toBeAttached({
    timeout: 10000,
  });
});

test("definition hover owns pointer cursor through editor root state", async ({
  page,
}) => {
  await mountEditor(page, {
    content: `function ready() {
  return true;
}

ready();
`,
    filePath: `${projectPath}/src/index.ts`,
    language: "typescript",
  });
  await expect(
    page.locator(".cm-line").filter({ hasText: "ready();" }),
  ).toBeVisible();

  await activateDefinitionHover(page);
  await expect
    .poll(() => readDefinitionCursorState(page))
    .toEqual({
      contentCursor: "pointer",
      decorationCount: 1,
      hasActiveClass: true,
      lineCursor: "pointer",
      scrollerCursor: "pointer",
    });

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        key: "Meta",
      }),
    );
  });
  await expect
    .poll(() => readDefinitionCursorState(page))
    .toEqual({
      contentCursor: "text",
      decorationCount: 0,
      hasActiveClass: false,
      lineCursor: "text",
      scrollerCursor: "text",
    });

  await activateDefinitionHover(page);
  await expect
    .poll(() => readDefinitionCursorState(page))
    .toMatchObject({
      contentCursor: "pointer",
      hasActiveClass: true,
    });
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>(".cm-editor")
      ?.dispatchEvent(new MouseEvent("mouseleave", { cancelable: true }));
  });
  await expect
    .poll(() => readDefinitionCursorState(page))
    .toEqual({
      contentCursor: "text",
      decorationCount: 0,
      hasActiveClass: false,
      lineCursor: "text",
      scrollerCursor: "text",
    });

  await activateDefinitionHover(page);
  await expect
    .poll(() => readDefinitionCursorState(page))
    .toMatchObject({
      contentCursor: "pointer",
      hasActiveClass: true,
    });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
  });
  await expect
    .poll(() => readDefinitionCursorState(page))
    .toEqual({
      contentCursor: "text",
      decorationCount: 0,
      hasActiveClass: false,
      lineCursor: "text",
      scrollerCursor: "text",
    });
});

test("git diff review mode is backed by CodeMirror merge", async ({ page }) => {
  await page.evaluate(async () => {
    const rootElement = document.createElement("div");
    rootElement.id = "playwright-git-diff-root";
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
    const { GitDiffViewer } = await import("/src/components/GitDiffViewer.tsx");

    const diff = `diff --git a/src/styles/theme.scss b/src/styles/theme.scss
--- a/src/styles/theme.scss
+++ b/src/styles/theme.scss
@@ -1,4 +1,4 @@
 .root {
-  color: #111111;
+  color: #ff00aa;
 }
`;

    createRoot(rootElement).render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(GitDiffViewer, {
          diff,
          fileName: "src/styles/theme.scss",
          onClose: () => undefined,
        }),
      ),
    );
  });

  await page.getByRole("button", { name: "review" }).click();
  await expect(page.getByTestId("git-diff-review-view")).toBeVisible();
  await expect(page.locator(".cm-changedLine").first()).toBeAttached({
    timeout: 10000,
  });
});
