import { expect, test, type Page } from "@playwright/test";

const projectPath = "/virtual/autocomplete-project";

type EditorFixture = {
  filePath: string;
  language: string;
  content: string;
};

type CompletionFixtureItem = {
  label: string;
  source: string;
  kind?: string;
  detail?: string;
  insertText?: string;
  isSnippet?: boolean;
  additionalTextEdits?: Array<{
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    text: string;
  }>;
};

type CodeMirrorSnapshot = {
  text: string;
  cursor: number;
};

const wideMemberCompletions = Array.from(
  { length: 36 },
  (_, index): CompletionFixtureItem => ({
    label: `member${String(index + 1).padStart(2, "0")}`,
    source: "library",
    kind: index % 3 === 0 ? "property" : "function",
    detail:
      index % 2 === 0
        ? "long signature with several arguments and a return type"
        : "member",
  }),
);

declare global {
  interface Window {
    __autocompleteFixture?: EditorFixture;
    __autocompletePendingFixture?: EditorFixture;
    __autocompleteDelayMs?: number;
    __autocompleteDelayBySuffix?: Record<string, number>;
    __autocompleteRequests?: string[];
    __editorText?: string;
    __autocompleteRoot?: {
      render?: (node: unknown) => void;
      unmount: () => void;
    };
    __autocompleteAutosaveRenderCount?: number;
  }
}

const completionsByPrefix: Record<string, CompletionFixtureItem[]> = {
  Pri: [
    {
      label: "PrintlnHello",
      source: "predictive",
      kind: "function",
      insertText: 'Println("hello world")',
    },
  ],
  app: [
    {
      label: "appendReallyLongMethodNameWithoutEllipsis",
      source: "library",
      kind: "function",
      detail: "method",
    },
  ],
  func: [
    {
      label: "func",
      source: "keyword",
      kind: "keyword",
      insertText: "func ${1:main}() {\n$0\n}",
      isSnippet: true,
    },
  ],
  str: [
    {
      label: "struct",
      source: "keyword",
      kind: "keyword",
      insertText: "struct {\n$0\n}",
      isSnippet: true,
    },
  ],
  tele: [{ label: "tele", source: "library", kind: "module" }],
  "tele.": [
    { label: "Send", source: "library", kind: "function" },
    { label: "StopPoller", source: "library", kind: "function" },
  ],
  HTTP: [{ label: "HTTP", source: "library", kind: "module" }],
  "HTTP.": [
    { label: "create", source: "library", kind: "function" },
    { label: "interceptors", source: "library", kind: "property" },
  ],
  Carbon: [{ label: "Carbon", source: "library", kind: "class" }],
  "Carbon::": [
    { label: "create", source: "library", kind: "method" },
    { label: "now", source: "library", kind: "method" },
  ],
  json: [{ label: "json", source: "library", kind: "module" }],
  "json.": [
    { label: "loads", source: "library", kind: "function" },
    { label: "dumps", source: "library", kind: "function" },
  ],
  JSON: [{ label: "JSON", source: "library", kind: "module" }],
  "JSON.": [
    { label: "parse", source: "library", kind: "function" },
    { label: "generate", source: "library", kind: "function" },
  ],
  serde_json: [{ label: "serde_json", source: "library", kind: "module" }],
  "serde_json.": [
    { label: "from_str", source: "library", kind: "function" },
    { label: "to_string", source: "library", kind: "function" },
  ],
  Console: [{ label: "Console", source: "library", kind: "class" }],
  "Console.": [
    { label: "WriteLine", source: "library", kind: "method" },
    { label: "ReadLine", source: "library", kind: "method" },
  ],
  URLSession: [{ label: "URLSession", source: "library", kind: "class" }],
  "URLSession.": [
    { label: "shared", source: "library", kind: "property" },
    { label: "configuration", source: "library", kind: "property" },
  ],
  http: [{ label: "http", source: "library", kind: "module" }],
  "http.": [
    { label: "get", source: "library", kind: "function" },
    { label: "post", source: "library", kind: "function" },
  ],
  sse: [{ label: "sse", source: "library", kind: "module" }],
  "sse.": [
    { label: "Decode", source: "library", kind: "function" },
    { label: "Encode", source: "library", kind: "function" },
  ],
  fm: [{ label: "fmt", source: "library", kind: "module" }],
  fmt: [{ label: "fmt", source: "library", kind: "module" }],
  "fmt.": [
    {
      label: "Println",
      source: "library",
      kind: "function",
      insertText: "Println($0)",
      isSnippet: true,
      additionalTextEdits: [
        {
          startLine: 2,
          startColumn: 1,
          endLine: 2,
          endColumn: 1,
          text: 'import "fmt"\n\n',
        },
      ],
    },
    { label: "Printf", source: "library", kind: "function" },
  ],
  "fmt.P": [
    { label: "Println", source: "library", kind: "function" },
    { label: "Printf", source: "library", kind: "function" },
  ],
  "fmt.Pr": [
    { label: "Println", source: "library", kind: "function" },
    { label: "Printf", source: "library", kind: "function" },
  ],
  "context.": [
    { label: "NewRequest", source: "lsp", kind: "function" },
    { label: "WithCancel", source: "lsp", kind: "function" },
  ],
  wide: [{ label: "wide", source: "library", kind: "module" }],
  "wide.": wideMemberCompletions,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ completionsByPrefix, projectPath }) => {
      localStorage.clear();

      const pendingFixture = window.__autocompletePendingFixture;
      if (pendingFixture) {
        window.__autocompleteFixture = pendingFixture;
        localStorage.setItem(
          `editorTabs:${projectPath}`,
          JSON.stringify({
            tabs: [
              {
                path: pendingFixture.filePath,
                label:
                  pendingFixture.filePath.split("/").pop() ||
                  pendingFixture.filePath,
              },
            ],
            activeTabId: `tab-${pendingFixture.filePath.replace(/[^a-zA-Z0-9]/g, "-")}`,
          }),
        );
      }

      const readFile = async (filePath?: string) => {
        const fixture = window.__autocompleteFixture;
        if (fixture && fixture.filePath === filePath) {
          return fixture.content;
        }

        return "";
      };

      const normalizeItems = (items: CompletionFixtureItem[]) =>
        items.map((item, index) => ({
          label: item.label,
          text: item.label,
          insertText: item.insertText || item.label,
          detail: item.detail || item.label,
          documentation: "",
          kind: item.kind || "function",
          source: item.source,
          isSnippet: item.isSnippet || false,
          priority: 100 - index,
          matchType: "prefix",
          additionalTextEdits: item.additionalTextEdits || [],
        }));

      const appHandlers: Record<string, (...args: unknown[]) => unknown> = {
        GetCurrentProjectPath: async () => projectPath,
        GetRecentProjects: async () => [],
        GetDevToolsStatus: async () => [],
        GetLSPInstallStatus: async () => [],
        ValidateEnvironment: async () => null,
        InspectProject: async () => ({}),
        OpenProject: async () => true,
        ReadDirectory: async () => [],
        ReadFile: readFile,
        NotifyFileChanged: async () => true,
        RecordCompletionUsage: async () => true,
        GetEditorCompletions: async (ctx?: Record<string, unknown>) => {
          const textBefore = String(ctx?.textBefore || "");
          const fullText = String(ctx?.fullText || "");
          window.__autocompleteRequests = [
            ...(window.__autocompleteRequests || []),
            textBefore,
          ];
          const suffix = Object.keys(completionsByPrefix)
            .filter((candidate) => textBefore.endsWith(candidate))
            .sort((a, b) => b.length - a.length)[0];
          const delay =
            (suffix ? window.__autocompleteDelayBySuffix?.[suffix] : 0) ??
            window.__autocompleteDelayMs ??
            0;
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          let items = suffix ? completionsByPrefix[suffix] : [];
          if (textBefore.endsWith("account.")) {
            items = [{ label: "ID", source: "lsp", kind: "field" }];
            if (fullText.includes("DisplayName string")) {
              items = [
                ...items,
                { label: "DisplayName", source: "lsp", kind: "field" },
              ];
            }
          }
          return {
            primary: items[0] ? normalizeItems([items[0]])[0] : null,
            items: normalizeItems(items),
            ghostText: "",
            ghostConfidence: 0,
            showGhost: false,
            stale: false,
          };
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
              return () => () => undefined;
            }
            if (property === "EventsOff") {
              return () => undefined;
            }
            if (property === "EventsOffAll") {
              return () => undefined;
            }

            return async () => undefined;
          },
        },
      );

      const globals = {
        go: { main: { App: appBridge } },
        runtime: runtimeBridge,
      };
      Object.assign(window, globals);
      Object.assign(globalThis, globals);
      if (typeof self !== "undefined") {
        Object.assign(self, globals);
      }

      localStorage.setItem(
        "workspace-storage",
        JSON.stringify({
          state: {
            projects: [
              {
                id: projectPath,
                path: projectPath,
                name: "autocomplete-project",
                openedAt: 1,
              },
            ],
            activeId: projectPath,
            switchDirection: 1,
          },
          version: 0,
        }),
      );
    },
    { completionsByPrefix, projectPath },
  );
});

async function mountEditor(page: Page, fixture: EditorFixture) {
  await page.goto("/");

  await page.evaluate(
    async ({ fixture }) => {
      window.__autocompleteFixture = fixture;
      window.__editorText = fixture.content;
      window.__autocompleteRoot?.unmount();
      window.__autocompleteRoot = undefined;

      const existing = document.getElementById("playwright-editor-root");
      existing?.remove();

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
      window.__autocompleteRoot = root;
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(CodeMirrorEditor, {
            filePath: fixture.filePath,
            content: fixture.content,
            language: fixture.language,
            projectPath: "/virtual/autocomplete-project",
            onChange: (value: string) => {
              window.__editorText = value;
            },
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
    { fixture },
  );

  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });
}

async function rerenderEditorWithFreshAutosaveCallbacks(
  page: Page,
  fixture: EditorFixture,
) {
  await page.evaluate(
    async ({ fixture }) => {
      const ReactModule = await import("/node_modules/.vite/deps/react.js");
      const React = ReactModule.default;
      const { ThemeProvider } = await import("/src/contexts/ThemeContext.tsx");
      const { CodeMirrorEditor } =
        await import("/src/components/CodeMirrorEditor.tsx");

      const root = window.__autocompleteRoot;
      if (!root?.render) {
        throw new Error("Autocomplete test root is not mounted");
      }

      window.__autocompleteAutosaveRenderCount =
        (window.__autocompleteAutosaveRenderCount || 0) + 1;
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(CodeMirrorEditor, {
            filePath: fixture.filePath,
            content: window.__editorText || fixture.content,
            language: fixture.language,
            projectPath: "/virtual/autocomplete-project",
            onChange: (value: string) => {
              window.__editorText = value;
            },
            onSave: () => {
              window.__autocompleteAutosaveRenderCount =
                (window.__autocompleteAutosaveRenderCount || 0) + 1;
            },
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
    { fixture },
  );
}

async function focusRenderedTextEnd(page: Page, text: string) {
  const token = page.getByText(text, { exact: true }).last();
  await expect(token).toBeVisible({ timeout: 10000 });
  await token.click();
  await page.keyboard.press("End");
}

async function waitForCompletionLabel(
  page: Page,
  label: string,
  options: { fallbackToExplicit?: boolean; timeout?: number } = {},
) {
  const popup = page.locator(".cm-tooltip-autocomplete");
  const timeout = options.timeout ?? 10000;
  if (options.fallbackToExplicit) {
    try {
      await expect(popup).toBeVisible({ timeout: Math.min(timeout, 2500) });
    } catch {
      await startCompletionExplicitly(page);
      await expect(popup).toBeVisible({ timeout: 10000 });
    }
  } else {
    await expect(popup).toBeVisible({ timeout });
  }
  await expect(
    popup.locator(".cm-completionLabel", { hasText: label }).first(),
  ).toBeVisible({
    timeout,
  });
}

async function startCompletionExplicitly(page: Page) {
  await page
    .locator(".cm-content")
    .first()
    .evaluate(async (element) => {
      const { EditorView } =
        await import("/node_modules/.vite/deps/@codemirror_view.js");
      const { startCompletion } =
        await import("/node_modules/.vite/deps/@codemirror_autocomplete.js");
      type CodeMirrorContentElement = HTMLElement & {
        cmView?: {
          view?: unknown;
        };
      };
      const view =
        (element as CodeMirrorContentElement).cmView?.view ??
        EditorView.findFromDOM(element);
      if (!view) {
        throw new Error("CodeMirror view is not available");
      }
      startCompletion(view);
    });
}

async function moveCursorToDocumentEnd(page: Page) {
  await page
    .locator(".cm-content")
    .first()
    .evaluate(async (element) => {
      const { EditorView } =
        await import("/node_modules/.vite/deps/@codemirror_view.js");
      type CodeMirrorContentElement = HTMLElement & {
        cmView?: {
          view?: {
            state: { doc: { length: number } };
            dispatch: (spec: {
              selection: { anchor: number };
              scrollIntoView?: boolean;
            }) => void;
            focus: () => void;
          };
        };
      };

      const view =
        (element as CodeMirrorContentElement).cmView?.view ??
        EditorView.findFromDOM(element);
      if (!view) {
        throw new Error("CodeMirror view is not available");
      }
      view.dispatch({
        selection: { anchor: view.state.doc.length },
        scrollIntoView: true,
      });
      view.focus();
    });
}

async function editorSnapshot(page: Page): Promise<CodeMirrorSnapshot> {
  return page
    .locator(".cm-content")
    .first()
    .evaluate((element) => {
      type CodeMirrorContentElement = HTMLElement & {
        cmView?: {
          view?: {
            state?: {
              doc?: { toString: () => string };
              selection?: { main?: { head: number } };
            };
          };
        };
      };

      const state = (element as CodeMirrorContentElement).cmView?.view?.state;
      return {
        text:
          window.__editorText ||
          state?.doc?.toString() ||
          element.textContent ||
          "",
        cursor: state?.selection?.main?.head ?? -1,
      };
    });
}

async function popupBox(page: Page) {
  const box = await page.locator(".cm-tooltip-autocomplete").boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function selectedCompletionLabel(page: Page): Promise<string> {
  return (
    (await page
      .locator(".cm-tooltip-autocomplete > ul > li[aria-selected]")
      .locator(".cm-completionLabel")
      .first()
      .textContent()) || ""
  ).trim();
}

async function assertAccessPopupScenario(
  page: Page,
  fixture: EditorFixture,
  token: string,
  operator: string,
  expectedLabels: [string, string],
) {
  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, token);
  await page.keyboard.type(operator);
  await waitForCompletionLabel(page, expectedLabels[0], {
    fallbackToExplicit: true,
  });
  await expect(
    page
      .locator(".cm-tooltip-autocomplete")
      .locator(".cm-completionLabel", { hasText: expectedLabels[1] })
      .first(),
  ).toBeVisible();
}

test("dot access restarts popup immediately for imported Go alias", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content:
      'package main\n\nimport tele "gopkg.in/telebot.v3"\n\nfunc main() {\n    tele\n}\n',
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "tele");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Send");
  await expect(
    page
      .locator(".cm-tooltip-autocomplete")
      .locator(".cm-completionLabel", { hasText: "StopPoller" })
      .first(),
  ).toBeVisible();
});

test("instant member popup keeps first option and geometry while backend warms", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    fmt\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "fmt");
  await page.evaluate(() => {
    window.__autocompleteRequests = [];
    window.__autocompleteDelayBySuffix = { "fmt.": 300 };
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Println", { timeout: 500 });

  const initialBox = await popupBox(page);
  expect(await selectedCompletionLabel(page)).toBe("Println");

  await page.waitForFunction(() =>
    window.__autocompleteRequests?.some((request) => request.endsWith("fmt.")),
  );
  await page.waitForTimeout(450);

  const warmedBox = await popupBox(page);
  expect(await selectedCompletionLabel(page)).toBe("Println");
  expect(Math.abs(warmedBox.width - initialBox.width)).toBeLessThanOrEqual(4);
  expect(Math.abs(warmedBox.x - initialBox.x)).toBeLessThanOrEqual(4);
});

test("popup row selection does not resize the tooltip", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    context\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "context");
  await page.evaluate(() => {
    window.__autocompleteDelayMs = 1200;
    window.__autocompleteRequests = [];
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Background", { timeout: 500 });

  const initialBox = await popupBox(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();

  const movedBox = await popupBox(page);
  expect(Math.abs(movedBox.width - initialBox.width)).toBeLessThanOrEqual(4);
  expect(Math.abs(movedBox.x - initialBox.x)).toBeLessThanOrEqual(4);
});

test("popup stays open when its result list scrolls", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    wide\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "wide");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "member01");

  const list = page.locator(".cm-tooltip-autocomplete > ul").first();
  const scrollable = await list.evaluate(
    (element) => element.scrollHeight > element.clientHeight,
  );
  expect(scrollable).toBe(true);

  await list.hover();
  for (let index = 0; index < 5; index += 1) {
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(80);
    await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
    await expect(list).toBeVisible();
  }

  await page.keyboard.press("Enter");
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("wide.member01");
  expect(snapshot.text).not.toContain("wide.\n");
});

test("popup stays compact for short keyword results", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.locator(".cm-content").first().click();
  await page.evaluate(() => {
    window.__autocompleteDelayMs = 1200;
    window.__autocompleteRequests = [];
  });

  await page.keyboard.type("pack", { delay: 5 });
  await waitForCompletionLabel(page, "package", { timeout: 500 });

  const box = await popupBox(page);
  expect(box.width).toBeLessThanOrEqual(520);
});

test("enter accepts Go package name completion after package keyword", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package ",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await moveCursorToDocumentEnd(page);
  await waitForCompletionLabel(page, "main", {
    fallbackToExplicit: true,
    timeout: 500,
  });
  await page.keyboard.press("Enter");

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toBe("package main");
});

test("member popup opens immediately after dot and keeps backend results", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    context\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "context");
  await page.evaluate(() => {
    window.__autocompleteDelayBySuffix = { "context.": 450 };
    window.__autocompleteRequests = [];
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "AfterFunc", { timeout: 500 });
  await waitForCompletionLabel(page, "NewRequest", { timeout: 2000 });

  const requests = await page.evaluate(
    () => window.__autocompleteRequests || [],
  );
  expect(requests.some((request) => request.endsWith("context."))).toBe(true);
});

test("popup survives autosave parent rerender", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    wide\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "wide");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "member01");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await selectedCompletionLabel(page)).toBe("member03");

  await rerenderEditorWithFreshAutosaveCallbacks(page, fixture);
  await page.waitForTimeout(100);

  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
  expect(await selectedCompletionLabel(page)).toBe("member03");

  await page.keyboard.press("Enter");
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("wide.member03");
  expect(snapshot.text).not.toContain("wide.\n");
});

test("enter accepts selected completion after popup navigation", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    wide\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "wide");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "member01");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await selectedCompletionLabel(page)).toBe("member04");

  await page.keyboard.press("Enter");
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("wide.member04");
  expect(snapshot.text).not.toContain("wide.\n");
});

test("dot access refreshes cached member fields after editing current buffer", async ({
  page,
}) => {
  const initialContent =
    "package main\n\n" +
    "type Account struct { ID string }\n\n" +
    "func main() {\n" +
    "    account := Account{}\n" +
    "    account\n" +
    "}\n";
  const updatedContent =
    "package main\n\n" +
    "type Account struct { ID string; DisplayName string }\n\n" +
    "func main() {\n" +
    "    account := Account{}\n" +
    "    account\n" +
    "}\n";
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: initialContent,
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "account");
  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "ID");
  await expect(
    page
      .locator(".cm-tooltip-autocomplete")
      .locator(".cm-completionLabel", { hasText: "DisplayName" })
      .first(),
  ).toBeHidden();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.keyboard.insertText(updatedContent);

  await focusRenderedTextEnd(page, "account");
  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "DisplayName");
});

test("popup renders long function labels without ellipsis", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    ap\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "ap");
  await page.keyboard.type("p");
  await waitForCompletionLabel(
    page,
    "appendReallyLongMethodNameWithoutEllipsis",
  );

  const label = page
    .locator(".cm-tooltip-autocomplete")
    .locator(".cm-completionLabel", {
      hasText: "appendReallyLongMethodNameWithoutEllipsis",
    })
    .first();
  const metrics = await label.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      text: element.textContent,
      textOverflow: style.textOverflow,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });

  expect(metrics.text).toBe("appendReallyLongMethodNameWithoutEllipsis");
  expect(metrics.textOverflow).not.toBe("ellipsis");
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});

test("accepting struct snippet places cursor inside braces without tab line", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\ntype Test st\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "st");
  await page.keyboard.type("r");
  await startCompletionExplicitly(page);
  await waitForCompletionLabel(page, "struct");

  await page.keyboard.press("Enter");
  await page.keyboard.type("Name string");

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("type Test struct {\nName string\n}");
  expect(snapshot.text).not.toContain("struct {\n\tName string");
});

test("accepting completion with import edit keeps cursor at call site", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    fmt\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "fmt");
  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Println");

  await page.keyboard.press("Enter");
  await page.keyboard.type('"ok"');

  const snapshot = await editorSnapshot(page);
  const importIndex = snapshot.text.indexOf('import "fmt"');
  const callIndex = snapshot.text.indexOf('fmt.Println("ok")');
  expect(importIndex).toBeGreaterThan(-1);
  expect(callIndex).toBeGreaterThan(-1);
  expect(snapshot.text).not.toContain('import "fmt""ok"');
});

test("accepting function snippet does not duplicate braces", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfun\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "fun");
  await page.keyboard.type("c");
  await startCompletionExplicitly(page);
  await waitForCompletionLabel(page, "func");

  await page.keyboard.press("Enter");

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("func main() {\n\n}");
  expect(snapshot.text).not.toContain("func main(){}");
  expect(snapshot.text).not.toContain("func main(){");
});

test("tab accepts the full ghost text instead of only the first token", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    Pri\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "Pri");
  await startCompletionExplicitly(page);
  await waitForCompletionLabel(page, "PrintlnHello");
  await page.waitForTimeout(80);

  await page.keyboard.press("Tab");

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain('Println("hello world")');
  expect(snapshot.text).not.toContain('Println("hello \n');
});

test("tab accepts an instant ghost candidate while backend warms", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    fmt\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "fmt");
  await page.evaluate(() => {
    window.__autocompleteDelayMs = 1200;
    window.__autocompleteRequests = [];
  });

  await page.keyboard.type(".");
  await page.keyboard.type("Pr", { delay: 5 });
  await waitForCompletionLabel(page, "Printf", { timeout: 500 });

  const selected = await selectedCompletionLabel(page);
  expect(selected.length).toBeGreaterThan(0);

  await page.keyboard.press("Tab");

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain(`fmt.${selected}`);
  expect(snapshot.text).not.toContain("fmt.Pr");
});

test("close brackets remains active under constrained performance", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(async () => {
    const { usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");
    usePerformanceStore.getState().updateBudget({
      eventPressure: 40,
      frameGapMs: 40,
    });
  });
  await page.waitForTimeout(50);

  await page.locator(".cm-content").first().click();
  await page.keyboard.type("func main(");

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toBe("func main()");
});

test("escape closes active autocomplete popup", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content:
      'package main\n\nimport tele "gopkg.in/telebot.v3"\n\nfunc main() {\n    tele\n}\n',
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "tele");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Send");

  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeHidden();
  await page.waitForTimeout(250);
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeHidden();
});

test("fast typing restarts pending autocomplete for the latest prefix", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    f\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "f");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => {
    window.__autocompleteDelayBySuffix = { f: 300 };
  });

  await page.keyboard.type("fm", { delay: 5 });
  await waitForCompletionLabel(page, "fmt");
});

test("fast typing after dot restarts pending member autocomplete", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    fmt\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "fmt");
  await page.evaluate(() => {
    window.__autocompleteRequests = [];
    window.__autocompleteDelayBySuffix = { "fmt.": 300 };
  });

  await page.keyboard.type(".");
  await page.keyboard.type("Pr", { delay: 5 });
  await page.waitForFunction(() =>
    window.__autocompleteRequests?.some((request) =>
      request.endsWith("fmt.Pr"),
    ),
  );
  await waitForCompletionLabel(page, "Println");
});

test("active member popup stays open while filtering typed prefix", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    fmt\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "fmt");
  await page.evaluate(() => {
    window.__autocompleteRequests = [];
    window.__autocompleteDelayBySuffix = {};
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Println");

  await page.keyboard.type("Pr", { delay: 5 });
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
  await waitForCompletionLabel(page, "Println");

  const memberPrefixRequests = await page.evaluate(
    () =>
      window.__autocompleteRequests?.filter((request) =>
        request.endsWith("fmt.Pr"),
      ) || [],
  );
  expect(memberPrefixRequests).toEqual([]);
});

test("instant keyword popup appears before delayed backend", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.locator(".cm-content").first().click();
  await page.evaluate(() => {
    window.__autocompleteDelayMs = 1200;
    window.__autocompleteRequests = [];
  });

  await page.keyboard.type("pa", { delay: 5 });
  await waitForCompletionLabel(page, "package", { timeout: 500 });
});

test("instant access popup covers non-Go library stubs before delayed backend", async ({
  page,
}) => {
  const cases = [
    {
      language: "typescript",
      fileName: "main.ts",
      content: "axios\n",
      token: "axios",
      label: "get",
    },
    {
      language: "python",
      fileName: "main.py",
      content: "requests\n",
      token: "requests",
      label: "get",
    },
    {
      language: "ruby",
      fileName: "main.rb",
      content: "JSON\n",
      token: "JSON",
      label: "parse",
    },
  ] satisfies Array<{
    language: string;
    fileName: string;
    content: string;
    token: string;
    label: string;
  }>;

  for (const item of cases) {
    await mountEditor(page, {
      filePath: `${projectPath}/${item.fileName}`,
      language: item.language,
      content: item.content,
    });
    await focusRenderedTextEnd(page, item.token);
    await page.evaluate(() => {
      window.__autocompleteDelayMs = 1200;
      window.__autocompleteRequests = [];
    });

    await page.keyboard.type(".");
    await waitForCompletionLabel(page, item.label, { timeout: 500 });
  }
});

test("dot access restarts popup immediately for TypeScript namespace alias", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/index.ts`,
    language: "typescript",
    content:
      'import * as HTTP from "axios";\n\nexport function load() {\n  HTTP\n}\n',
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "HTTP");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "create");
  await expect(
    page
      .locator(".cm-tooltip-autocomplete")
      .locator(".cm-completionLabel", { hasText: "interceptors" })
      .first(),
  ).toBeVisible();
});

test("static access restarts popup immediately for PHP class alias", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/test.php`,
    language: "php",
    content:
      "<?php\n\nuse Carbon\\Carbon;\n\nfunction run(): void\n{\n    Carbon\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "Carbon");

  await page.keyboard.type("::");
  await waitForCompletionLabel(page, "create");
  await expect(
    page
      .locator(".cm-tooltip-autocomplete")
      .locator(".cm-completionLabel", { hasText: "now" })
      .first(),
  ).toBeVisible();
});

test("unresolved package member popup appears immediately after dot", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/sse.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    sse\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "sse");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Decode");
  await expect(
    page
      .locator(".cm-tooltip-autocomplete")
      .locator(".cm-completionLabel", { hasText: "Encode" })
      .first(),
  ).toBeVisible();
});

test("dot access works for Python standard library module", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.py`,
    language: "python",
    content: "import json\n\ndef run():\n    json\n",
  } satisfies EditorFixture;

  await assertAccessPopupScenario(page, fixture, "json", ".", [
    "loads",
    "dumps",
  ]);
});

test("dot access works for Ruby JSON module", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.rb`,
    language: "ruby",
    content: "def run\n  JSON\nend\n",
  } satisfies EditorFixture;

  await assertAccessPopupScenario(page, fixture, "JSON", ".", [
    "parse",
    "generate",
  ]);
});

test("dot access works for Rust serde_json module", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.rs`,
    language: "rust",
    content: "fn main() {\n    serde_json\n}\n",
  } satisfies EditorFixture;

  await assertAccessPopupScenario(page, fixture, "serde_json", ".", [
    "from_str",
    "to_string",
  ]);
});

test("dot access works for Swift URLSession type", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.swift`,
    language: "swift",
    content: "func run() {\n    URLSession\n}\n",
  } satisfies EditorFixture;

  await assertAccessPopupScenario(page, fixture, "URLSession", ".", [
    "shared",
    "configuration",
  ]);
});

test("dot access works for Dart http package", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.dart`,
    language: "dart",
    content: "void main() {\n  http\n}\n",
  } satisfies EditorFixture;

  await assertAccessPopupScenario(page, fixture, "http", ".", ["get", "post"]);
});
