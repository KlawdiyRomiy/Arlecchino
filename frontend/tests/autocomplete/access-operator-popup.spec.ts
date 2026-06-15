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
  primaryTextEdit?: {
    newText: string;
    range?: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    } | null;
    insert?: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    } | null;
    replace?: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    } | null;
  } | null;
  accessMemberAuthoritative?: boolean;
  resolveToken?: string;
  completionId?: string;
  stableKey?: string;
  autoImportAllowed?: boolean;
  requiresResolveBeforeApply?: boolean;
  requiresSafeEditsBeforeApply?: boolean;
  command?: unknown;
  data?: unknown;
  additionalTextEdits?: Array<{
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    text: string;
  }>;
};

type CompletionFixtureResponse = {
  items?: CompletionFixtureItem[];
  lspStatus?: string;
  isIncomplete?: boolean;
};

type CompletionResolveFixtureResponse = {
  insertText?: string;
  isSnippet?: boolean;
  primaryTextEdit?: CompletionFixtureItem["primaryTextEdit"];
  additionalTextEdits?: CompletionFixtureItem["additionalTextEdits"];
  command?: unknown;
  data?: unknown;
};

type AutocompleteRequestLogEntry = {
  textBefore: string;
  completionTriggerKind: number | null;
  triggerChar: string;
  accessOperator: string;
  lspStatus: string;
  isIncomplete: boolean;
  itemCount: number;
};

type AutocompleteApplyRejectLogEntry = {
  reason: string;
  label: string;
  source: string;
  completionId?: string;
  stableKey?: string;
  resolveToken?: string;
  requiresSafeEdits: boolean;
  requiresAdditionalSafeEdits: boolean;
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
    __autocompleteResolveDelayMs?: number;
    __autocompleteResolveDelayByToken?: Record<string, number>;
    __autocompleteRequests?: string[];
    __autocompleteRequestLog?: AutocompleteRequestLogEntry[];
    __autocompleteResponseBySuffix?: Record<string, CompletionFixtureResponse>;
    __autocompleteResponseSequenceBySuffix?: Record<
      string,
      CompletionFixtureResponse[]
    >;
    __autocompleteResolveByToken?: Record<
      string,
      CompletionResolveFixtureResponse
    >;
    __autocompleteResolveRequests?: string[];
    __autocompleteResolveRequestLog?: Array<Record<string, unknown>>;
    __autocompleteApplyRejectLog?: AutocompleteApplyRejectLogEntry[];
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
  "context.B": [
    { label: "Background", source: "lsp", kind: "function" },
    { label: "BackgroundCause", source: "lsp", kind: "function" },
  ],
  "factory().": [
    { label: "Build", source: "lsp", kind: "method" },
    { label: "Close", source: "lsp", kind: "method" },
  ],
  "alpha.": [
    { label: "Zeta", source: "lsp", kind: "method" },
    { label: "Beta10", source: "lsp", kind: "method" },
    { label: "Alpha", source: "lsp", kind: "method" },
    { label: "beta2", source: "lsp", kind: "method" },
  ],
  "ptr->": [
    { label: "begin", source: "lsp", kind: "method" },
    { label: "end", source: "lsp", kind: "method" },
  ],
  "player:": [
    { label: "MoveTo", source: "lsp", kind: "method" },
    { label: "Spawn", source: "lsp", kind: "method" },
  ],
  "axios.": [],
  wide: [{ label: "wide", source: "library", kind: "module" }],
  "wide.": wideMemberCompletions,
};

async function latestCompletionApplyReject(
  page: Page,
): Promise<AutocompleteApplyRejectLogEntry | null> {
  return page.evaluate(() => {
    const log = window.__autocompleteApplyRejectLog || [];
    return log.length ? log[log.length - 1] : null;
  });
}

const authoritativeAccessFixtureSuffixes = new Set([
  "tele.",
  "HTTP.",
  "Carbon::",
  "json.",
  "JSON.",
  "serde_json.",
  "Console.",
  "URLSession.",
  "http.",
  "sse.",
  "fmt.",
  "fmt.P",
  "fmt.Pr",
  "wide.",
]);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({
      authoritativeAccessFixtureSuffixes,
      completionsByPrefix,
      projectPath,
    }) => {
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

      const normalizeItems = (
        items: CompletionFixtureItem[],
        accessFixtureAuthoritative: boolean,
      ) =>
        items.map((item, index) => ({
          label: item.label,
          text: item.label,
          insertText: item.insertText || item.label,
          detail: item.detail || item.label,
          documentation: "",
          kind: item.kind || "function",
          source: item.source,
          accessMemberAuthoritative:
            item.accessMemberAuthoritative ??
            (item.source === "lsp" ||
              (accessFixtureAuthoritative && item.source === "library")),
          isSnippet: item.isSnippet || false,
          priority: 100 - index,
          matchType: "prefix",
          primaryTextEdit: item.primaryTextEdit || null,
          additionalTextEdits: item.additionalTextEdits || [],
          resolveToken: item.resolveToken || "",
          completionId: item.completionId || "",
          stableKey: item.stableKey || "",
          autoImportAllowed:
            item.autoImportAllowed ??
            (item.additionalTextEdits || []).length > 0,
          requiresResolveBeforeApply: item.requiresResolveBeforeApply ?? false,
          requiresSafeEditsBeforeApply:
            item.requiresSafeEditsBeforeApply ?? false,
          command: item.command,
          data: item.data,
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
        ResolveEditorCompletion: async (ctx?: Record<string, unknown>) => {
          const token = String(ctx?.resolveToken || "");
          window.__autocompleteResolveRequests = [
            ...(window.__autocompleteResolveRequests || []),
            token,
          ];
          window.__autocompleteResolveRequestLog = [
            ...(window.__autocompleteResolveRequestLog || []),
            { ...(ctx || {}) },
          ];
          const delay =
            window.__autocompleteResolveDelayByToken?.[token] ??
            window.__autocompleteResolveDelayMs ??
            0;
          if (delay > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delay));
          }
          return window.__autocompleteResolveByToken?.[token] || null;
        },
        GetEditorCompletions: async (ctx?: Record<string, unknown>) => {
          const textBefore = String(ctx?.textBefore || "");
          const fullText = String(ctx?.fullText || "");
          const completionTriggerKind =
            typeof ctx?.completionTriggerKind === "number"
              ? ctx.completionTriggerKind
              : null;
          const triggerChar = String(ctx?.triggerChar || "");
          const accessOperator = String(ctx?.accessOperator || "");
          window.__autocompleteRequests = [
            ...(window.__autocompleteRequests || []),
            textBefore,
          ];
          const suffixCandidates = new Set([
            ...Object.keys(completionsByPrefix),
            ...Object.keys(window.__autocompleteResponseBySuffix || {}),
            ...Object.keys(window.__autocompleteResponseSequenceBySuffix || {}),
          ]);
          const suffix = [...suffixCandidates]
            .filter((candidate) => textBefore.endsWith(candidate))
            .sort((a, b) => b.length - a.length)[0];
          const delay =
            (suffix ? window.__autocompleteDelayBySuffix?.[suffix] : 0) ??
            window.__autocompleteDelayMs ??
            0;
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          const sequence = suffix
            ? window.__autocompleteResponseSequenceBySuffix?.[suffix]
            : undefined;
          const sequenceOverride = sequence?.length
            ? sequence.shift()
            : undefined;
          const override =
            sequenceOverride ??
            (suffix ? window.__autocompleteResponseBySuffix?.[suffix] : null);
          let items =
            override?.items ?? (suffix ? completionsByPrefix[suffix] : []);
          if (textBefore.endsWith("account.")) {
            items = [{ label: "ID", source: "lsp", kind: "field" }];
            if (fullText.includes("DisplayName string")) {
              items = [
                ...items,
                { label: "DisplayName", source: "lsp", kind: "field" },
              ];
            }
          }
          const lspStatus =
            override?.lspStatus ?? (items.length > 0 ? "ok" : "empty");
          const isIncomplete = override?.isIncomplete ?? false;
          const accessFixtureAuthoritative = Boolean(
            suffix && authoritativeAccessFixtureSuffixes.includes(suffix),
          );
          window.__autocompleteRequestLog = [
            ...(window.__autocompleteRequestLog || []),
            {
              textBefore,
              completionTriggerKind,
              triggerChar,
              accessOperator,
              lspStatus,
              isIncomplete,
              itemCount: items.length,
            },
          ];
          return {
            primary: items[0]
              ? normalizeItems([items[0]], accessFixtureAuthoritative)[0]
              : null,
            items: normalizeItems(items, accessFixtureAuthoritative),
            ghostText: "",
            ghostConfidence: 0,
            showGhost: false,
            stale: false,
            lspStatus,
            isIncomplete,
            sourceStatuses: { lsp: lspStatus },
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
    {
      authoritativeAccessFixtureSuffixes: [
        ...authoritativeAccessFixtureSuffixes,
      ],
      completionsByPrefix,
      projectPath,
    },
  );
});

async function mountEditor(page: Page, fixture: EditorFixture) {
  await page.goto("/");

  await page.evaluate(
    async ({ fixture }) => {
      window.__autocompleteFixture = fixture;
      window.__editorText = fixture.content;
      window.__autocompleteApplyRejectLog = [];
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

async function expectNoCompletionLabel(
  page: Page,
  label: string,
  timeout = 500,
) {
  await expect(
    page
      .locator(".cm-tooltip-autocomplete")
      .locator(".cm-completionLabel", { hasText: label }),
  ).toHaveCount(0, { timeout });
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

async function moveCursorAfterText(page: Page, marker: string) {
  await page
    .locator(".cm-content")
    .first()
    .evaluate(async (element, markerText) => {
      const { EditorView } =
        await import("/node_modules/.vite/deps/@codemirror_view.js");
      type CodeMirrorContentElement = HTMLElement & {
        cmView?: {
          view?: {
            state: { doc: { toString: () => string } };
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
      const text = view.state.doc.toString();
      const index = text.indexOf(markerText);
      if (index < 0) {
        throw new Error(`Marker not found: ${markerText}`);
      }
      view.dispatch({
        selection: { anchor: index + markerText.length },
        scrollIntoView: true,
      });
      view.focus();
    }, marker);
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

async function completionLabels(page: Page): Promise<string[]> {
  return page
    .locator(".cm-tooltip-autocomplete > ul .cm-completionLabel")
    .evaluateAll((elements) =>
      elements
        .map((element) => element.textContent?.trim() || "")
        .filter(Boolean),
    );
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
  await waitForCompletionLabel(page, "Println", { timeout: 1000 });

  const initialBox = await popupBox(page);
  expect(await selectedCompletionLabel(page)).toBe("Printf");

  await page.waitForFunction(() =>
    window.__autocompleteRequests?.some((request) => request.endsWith("fmt.")),
  );
  await page.waitForTimeout(450);

  const warmedBox = await popupBox(page);
  expect(await selectedCompletionLabel(page)).toBe("Printf");
  expect(Math.abs(warmedBox.width - initialBox.width)).toBeLessThanOrEqual(5);
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
    window.__autocompleteDelayMs = 0;
    window.__autocompleteRequests = [];
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "NewRequest", { timeout: 1000 });

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

test("member popup opens after backend proof and keeps backend results", async ({
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

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type('"ok"');

  const snapshot = await editorSnapshot(page);
  const importIndex = snapshot.text.indexOf('import "fmt"');
  const callIndex = snapshot.text.indexOf('fmt.Println("ok")');
  expect(importIndex).toBeGreaterThan(-1);
  expect(callIndex).toBeGreaterThan(-1);
  expect(snapshot.text).not.toContain('import "fmt""ok"');
});

test("accepting resolved LSP access member applies import edit", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    fmt\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      "fmt.": {
        items: [
          {
            label: "Println",
            source: "lsp",
            kind: "function",
            insertText: "Println($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "fmt-println-resolve",
            completionId: "completion-println",
            stableKey: "lsp-println",
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "fmt-println-resolve": {
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
    };
  });
  await focusRenderedTextEnd(page, "fmt");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Println");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await editorSnapshot(page)).text)
    .toContain('import "fmt"');
  await page.keyboard.type('"ok"');

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain('import "fmt"');
  expect(snapshot.text).toContain('fmt.Println("ok")');
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("fmt-println-resolve");
});

test("accepting resolved LSP access member applies primary edit covering access expression", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            detail: 'func (from "log")',
            accessMemberAuthoritative: true,
            resolveToken: "log-fatal-resolve",
            completionId: "completion-log-fatal",
            stableKey: "lsp-log-fatal",
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-fatal-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
        primaryTextEdit: {
          newText: "log.Fatal($0)",
          range: {
            startLine: 4,
            startColumn: 5,
            endLine: 4,
            endColumn: 9,
          },
        },
        additionalTextEdits: [
          {
            startLine: 2,
            startColumn: 1,
            endLine: 2,
            endColumn: 1,
            text: 'import "log"\n\n',
          },
        ],
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text)
    .toContain('import "log"');
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("log.Fatal()");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("log-fatal-resolve");
});

test("LSP access member with ready import edit applies without resolve", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "log-fatal-item-edit-resolve",
            completionId: "completion-log-fatal-item-edit",
            stableKey: "lsp-log-fatal-item-edit",
            autoImportAllowed: true,
            requiresResolveBeforeApply: false,
            additionalTextEdits: [
              {
                startLine: 2,
                startColumn: 1,
                endLine: 2,
                endColumn: 1,
                text: 'import "log"\n\n',
              },
            ],
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-fatal-item-edit-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text)
    .toContain('import "log"');
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("log.Fatal()");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).not.toContain("log-fatal-item-edit-resolve");
});

test("selected unresolved package member applies item import edit from import block", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content:
      'package main\n\nimport (\n\t"context"\n\t"fmt"\n\t"strings"\n\t"time"\n\n\t"github.com/gin-gonic/gin"\n)\n\nfunc main() {\n\tlog\n}\n',
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResolveDelayByToken = {
      "log-default-video-resolve": 2000,
      "log-fatal-video-resolve": 2000,
      "log-fatalf-video-resolve": 2000,
    };
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Default",
            source: "lsp",
            kind: "function",
            detail: 'func (from "log")',
            insertText: "Default($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "log-default-video-resolve",
            completionId: "completion-log-default-video",
            stableKey: "lsp-log-default-video",
            autoImportAllowed: true,
            requiresResolveBeforeApply: false,
            additionalTextEdits: [
              {
                startLine: 8,
                startColumn: 1,
                endLine: 8,
                endColumn: 1,
                text: '\t"log"\n',
              },
            ],
          },
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            detail: 'func (from "log")',
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "log-fatal-video-resolve",
            completionId: "completion-log-fatal-video",
            stableKey: "lsp-log-fatal-video",
            autoImportAllowed: true,
            requiresResolveBeforeApply: false,
            additionalTextEdits: [
              {
                startLine: 8,
                startColumn: 1,
                endLine: 8,
                endColumn: 1,
                text: '\t"log"\n',
              },
            ],
          },
          {
            label: "Fatalf",
            source: "lsp",
            kind: "function",
            detail: 'func (from "log")',
            insertText: "Fatalf($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "log-fatalf-video-resolve",
            completionId: "completion-log-fatalf-video",
            stableKey: "lsp-log-fatalf-video",
            autoImportAllowed: true,
            requiresResolveBeforeApply: false,
            additionalTextEdits: [
              {
                startLine: 8,
                startColumn: 1,
                endLine: 8,
                endColumn: 1,
                text: '\t"log"\n',
              },
            ],
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-default-video-resolve": {
        insertText: "Default($0)",
        isSnippet: true,
      },
      "log-fatal-video-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
      },
      "log-fatalf-video-resolve": {
        insertText: "Fatalf($0)",
        isSnippet: true,
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  expect(await selectedCompletionLabel(page)).toBe("Default");
  await page.keyboard.press("ArrowDown");
  expect(await selectedCompletionLabel(page)).toBe("Fatal");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text)
    .toContain('"log"');
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("log.Fatal()");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).not.toContain("log-fatal-video-resolve");
});

test("Go access member applies gopls import-block splice edit", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content:
      'package main\n\nimport (\n    "fmt"\n)\n\nfunc main() {\n    log\n}\n',
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            completionId: "completion-log-fatal-gopls-splice",
            stableKey: "lsp-log-fatal-gopls-splice",
            autoImportAllowed: true,
            requiresResolveBeforeApply: false,
            additionalTextEdits: [
              {
                startLine: 4,
                startColumn: 9,
                endLine: 4,
                endColumn: 9,
                text: '"\n\t"log',
              },
            ],
          },
        ],
        lspStatus: "ok",
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text)
    .toContain('"log"');
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain('"fmt"');
  expect(snapshot.text).toContain('"log"');
  expect(snapshot.text).toContain("log.Fatal()");
  expect(await latestCompletionApplyReject(page)).toBeNull();
});

test("resolved additional edit supersedes item edit at the same range", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "log-fatal-supersede-resolve",
            completionId: "completion-log-fatal-supersede",
            stableKey: "lsp-log-fatal-supersede",
            autoImportAllowed: true,
            requiresResolveBeforeApply: true,
            additionalTextEdits: [
              {
                startLine: 2,
                startColumn: 1,
                endLine: 2,
                endColumn: 1,
                text: 'import "wrong/log"\n\n',
              },
            ],
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-fatal-supersede-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
        additionalTextEdits: [
          {
            startLine: 2,
            startColumn: 1,
            endLine: 2,
            endColumn: 1,
            text: 'import "log"\n\n',
          },
        ],
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text)
    .toContain('import "log"');
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("log.Fatal()");
  expect(snapshot.text).not.toContain("wrong/log");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("log-fatal-supersede-resolve");
});

test("accepting snippet access member with import edit keeps call-site cursor", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content:
      'package main\n\nimport (\n\t"context"\n\t"fmt"\n\t"strings"\n\t"time"\n\n\t"github.com/gin-gonic/gin"\n)\n\nfunc main() {\n\tlog\n}\n',
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            additionalTextEdits: [
              {
                startLine: 8,
                startColumn: 1,
                endLine: 8,
                endColumn: 1,
                text: '\t"log"\n',
              },
            ],
          },
        ],
        lspStatus: "ok",
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await editorSnapshot(page)).text)
    .toContain('"log"');
  await page.keyboard.type('"boom"');

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain('"log"');
  expect(snapshot.text).toContain('log.Fatal("boom")');
  expect(snapshot.text).not.toContain(
    'import (\n\t"context"\n\t"fmt"\n\t"strings"\n\t"time"\n\n\t"github.com/gin-gonic/gin"\n)\n\nfunc main() {\n\tlog\n}',
  );
});

test("plain-safe access member with metadata resolve preserves receiver without resolve", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    context\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      "context.": {
        items: [
          {
            label: "WithCancel",
            source: "lsp",
            kind: "function",
            accessMemberAuthoritative: true,
            resolveToken: "context-withcancel-resolve",
            completionId: "completion-withcancel",
            stableKey: "lsp-withcancel",
            autoImportAllowed: false,
            requiresResolveBeforeApply: false,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {};
  });
  await focusRenderedTextEnd(page, "context");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "WithCancel");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text, { timeout: 3000 })
    .toContain("context.WithCancel");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).not.toContain("context-withcancel-resolve");
});

test("bare import-required LSP completion applies resolved import edit", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    l\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      lo: {
        items: [
          {
            label: "log",
            source: "lsp",
            kind: "package",
            insertText: "log",
            resolveToken: "log-package-resolve",
            completionId: "completion-log-package",
            stableKey: "lsp-log-package",
            requiresResolveBeforeApply: true,
            requiresSafeEditsBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-package-resolve": {
        insertText: "log",
        additionalTextEdits: [
          {
            startLine: 2,
            startColumn: 1,
            endLine: 2,
            endColumn: 1,
            text: 'import "log"\n\n',
          },
        ],
      },
    };
  });
  await focusRenderedTextEnd(page, "l");

  await page.keyboard.type("o");
  await waitForCompletionLabel(page, "log");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text)
    .toContain('import "log"');
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("    log\n");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("log-package-resolve");
});

test("command-only resolve completion does not plain-insert", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    f\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      fo: {
        items: [
          {
            label: "formatValue",
            source: "lsp",
            kind: "function",
            insertText: "formatValue",
            resolveToken: "format-command-resolve",
            completionId: "completion-format-command",
            stableKey: "lsp-format-command",
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "format-command-resolve": {
        insertText: "formatValue",
        command: { title: "apply import", command: "applyImport" },
      },
    };
  });
  await focusRenderedTextEnd(page, "f");

  await page.keyboard.type("o");
  await waitForCompletionLabel(page, "formatValue");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("    fo\n");
  expect(snapshot.text).not.toContain("formatValue");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("format-command-resolve");
  await expect
    .poll(() => latestCompletionApplyReject(page))
    .toMatchObject({
      reason: "missing-additional-safe-edits",
      completionId: "completion-format-command",
      resolveToken: "format-command-resolve",
    });
});

test("plain-safe non-access completion still inserts on resolve timeout", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc helper() {}\n\nfunc main() {\n    h\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResolveDelayByToken = {
      "helper-timeout-resolve": 2000,
    };
    window.__autocompleteResponseBySuffix = {
      he: {
        items: [
          {
            label: "helper",
            source: "lsp",
            kind: "function",
            insertText: "helper()",
            resolveToken: "helper-timeout-resolve",
            completionId: "completion-helper-timeout",
            stableKey: "lsp-helper-timeout",
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "helper-timeout-resolve": {
        insertText: "helper()",
      },
    };
  });
  await focusRenderedTextEnd(page, "h");

  await page.keyboard.type("e");
  await waitForCompletionLabel(page, "helper");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text, { timeout: 2500 })
    .toContain("helper()");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("helper-timeout-resolve");
});

test("misflagged LSP package completion without safe edits does not plain-insert", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    l\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResolveDelayByToken = {
      "log-package-misflag-resolve": 2000,
    };
    window.__autocompleteResponseBySuffix = {
      lo: {
        items: [
          {
            label: "log",
            source: "lsp",
            kind: "package",
            insertText: "log",
            resolveToken: "log-package-misflag-resolve",
            completionId: "completion-log-package-misflag",
            stableKey: "lsp-log-package-misflag",
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-package-misflag-resolve": {
        insertText: "log",
      },
    };
  });
  await focusRenderedTextEnd(page, "l");

  await page.keyboard.type("o");
  await waitForCompletionLabel(page, "log");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1600);

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("    lo\n");
  expect(snapshot.text).not.toContain('import "log"');
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("log-package-misflag-resolve");
});

test("import-required access member does not plain-insert on resolve timeout", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResolveDelayByToken = {
      "log-fatal-timeout-resolve": 2000,
    };
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "log-fatal-timeout-resolve",
            completionId: "completion-log-fatal-timeout",
            stableKey: "lsp-log-fatal-timeout",
            autoImportAllowed: true,
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-fatal-timeout-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1600);

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("log.");
  expect(snapshot.text).not.toContain("log.Fatal");
  expect(snapshot.text).not.toContain('import "log"');
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("log-fatal-timeout-resolve");
  await expect
    .poll(() => latestCompletionApplyReject(page))
    .toMatchObject({
      reason: "resolve-timeout-or-empty",
      completionId: "completion-log-fatal-timeout",
      resolveToken: "log-fatal-timeout-resolve",
    });
});

test("import-required access member rejects resolved primary-only edit without import edit", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "log-fatal-primary-only-resolve",
            completionId: "completion-log-fatal-primary-only",
            stableKey: "lsp-log-fatal-primary-only",
            autoImportAllowed: true,
            requiresResolveBeforeApply: true,
            primaryTextEdit: {
              newText: "log.Fatal($0)",
              range: {
                startLine: 4,
                startColumn: 5,
                endLine: 4,
                endColumn: 9,
              },
            },
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-fatal-primary-only-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
        primaryTextEdit: {
          newText: "log.Fatal($0)",
          range: {
            startLine: 4,
            startColumn: 5,
            endLine: 4,
            endColumn: 9,
          },
        },
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("log.");
  expect(snapshot.text).not.toContain("log.Fatal");
  expect(snapshot.text).not.toContain('import "log"');
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("log-fatal-primary-only-resolve");
  await expect
    .poll(() => latestCompletionApplyReject(page))
    .toMatchObject({
      reason: "missing-additional-safe-edits",
      completionId: "completion-log-fatal-primary-only",
      resolveToken: "log-fatal-primary-only-resolve",
    });
});

test("import-required access member rejects unsafe import edit", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            completionId: "completion-log-fatal-unsafe-import",
            stableKey: "lsp-log-fatal-unsafe-import",
            autoImportAllowed: true,
            requiresResolveBeforeApply: false,
            additionalTextEdits: [
              {
                startLine: 4,
                startColumn: 5,
                endLine: 4,
                endColumn: 5,
                text: 'fmt.Println("not an import")\n',
              },
            ],
          },
        ],
        lspStatus: "ok",
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("log.");
  expect(snapshot.text).not.toContain("log.Fatal");
  expect(snapshot.text).not.toContain("not an import");
  await expect
    .poll(() => latestCompletionApplyReject(page))
    .toMatchObject({
      reason: "unsafe-import-edit",
      completionId: "completion-log-fatal-unsafe-import",
    });
});

test("plain-safe access member still inserts on resolve timeout", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    context\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResolveDelayByToken = {
      "context-withcancel-timeout-resolve": 2000,
    };
    window.__autocompleteResponseBySuffix = {
      "context.": {
        items: [
          {
            label: "WithCancel",
            source: "lsp",
            kind: "function",
            insertText: "WithCancel($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "context-withcancel-timeout-resolve",
            completionId: "completion-withcancel-timeout",
            stableKey: "lsp-withcancel-timeout",
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "context-withcancel-timeout-resolve": {
        insertText: "WithCancel($0)",
        isSnippet: true,
      },
    };
  });
  await focusRenderedTextEnd(page, "context");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "WithCancel");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text, { timeout: 2500 })
    .toContain("context.WithCancel()");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("context-withcancel-timeout-resolve");
});

test("accepting resolved access member falls back when primary edit starts before receiver", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    x := log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      "x := log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "wide-log-fatal-resolve",
            completionId: "completion-wide-log-fatal",
            stableKey: "lsp-wide-log-fatal",
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "wide-log-fatal-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
        primaryTextEdit: {
          newText: "x := log.Fatal($0)",
          range: {
            startLine: 4,
            startColumn: 5,
            endLine: 4,
            endColumn: 14,
          },
        },
      },
    };
  });
  await focusRenderedTextEnd(page, "log");

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");

  await page.waitForTimeout(250);
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("x := log.Fatal()");
  expect(snapshot.text).not.toContain("x := x := log.Fatal");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("wide-log-fatal-resolve");
});

test("accepting resolved access member rejects primary edit after cursor", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log.keep\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "suffix-log-fatal-resolve",
            completionId: "completion-suffix-log-fatal",
            stableKey: "lsp-suffix-log-fatal",
            requiresResolveBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "suffix-log-fatal-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
        primaryTextEdit: {
          newText: "log.Fatal($0)",
          range: {
            startLine: 4,
            startColumn: 5,
            endLine: 4,
            endColumn: 13,
          },
        },
      },
    };
  });
  await moveCursorAfterText(page, "log.");
  await startCompletionExplicitly(page);

  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");

  await page.waitForTimeout(250);
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("log.keep");
  expect(snapshot.text).not.toContain("log.Fatal");
  expect(
    await page.evaluate(() => window.__autocompleteResolveRequests),
  ).toContain("suffix-log-fatal-resolve");
  await expect
    .poll(() => latestCompletionApplyReject(page))
    .toMatchObject({
      reason: "unsafe-primary-edit",
      completionId: "completion-suffix-log-fatal",
      resolveToken: "suffix-log-fatal-resolve",
    });
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

test("access completion does not accept instant library member while backend warms", async ({
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
  await expectNoCompletionLabel(page, "Printf", 500);
  await expectNoCompletionLabel(page, "Println", 500);

  await page.keyboard.press("Tab");

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain("fmt.Pr");
  expect(snapshot.text).not.toContain("fmt.Printf");
  expect(snapshot.text).not.toContain("fmt.Println");
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

test("enter during pending access completion accepts first resolved member", async ({
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
    window.__autocompleteDelayBySuffix = { "fmt.": 350 };
    window.__autocompleteRequests = [];
    window.__autocompleteResponseBySuffix = {
      "fmt.": {
        items: [
          {
            label: "Println",
            source: "lsp",
            kind: "function",
            insertText: "Println($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
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
        ],
        lspStatus: "ok",
      },
    };
  });

  await page.keyboard.type(".");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text, { timeout: 2500 })
    .toContain("fmt.Println()");
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain('import "fmt"');
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

test("filtered unresolved access member resolves with current document version and applies import edit", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "log");
  await page.evaluate(() => {
    window.__autocompleteResolveRequests = [];
    window.__autocompleteResolveRequestLog = [];
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            resolveToken: "log-fatal-filtered-resolve",
            completionId: "completion-log-fatal-filtered",
            stableKey: "lsp-log-fatal-filtered",
            autoImportAllowed: true,
            requiresResolveBeforeApply: true,
            requiresSafeEditsBeforeApply: true,
          },
        ],
        lspStatus: "ok",
      },
    };
    window.__autocompleteResolveByToken = {
      "log-fatal-filtered-resolve": {
        insertText: "Fatal($0)",
        isSnippet: true,
        additionalTextEdits: [
          {
            startLine: 2,
            startColumn: 1,
            endLine: 2,
            endColumn: 1,
            text: 'import "log"\n\n',
          },
        ],
      },
    };
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.type("Fa", { delay: 5 });
  await waitForCompletionLabel(page, "Fatal");
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await editorSnapshot(page)).text, { timeout: 2500 })
    .toContain("log.Fatal()");
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).toContain('import "log"');

  const resolveLog = await page.evaluate(
    () => window.__autocompleteResolveRequestLog || [],
  );
  expect(resolveLog).toHaveLength(1);
  expect(resolveLog[0]).toMatchObject({
    resolveToken: "log-fatal-filtered-resolve",
    completionId: "completion-log-fatal-filtered",
    stableKey: "lsp-log-fatal-filtered",
  });
  expect(Number(resolveLog[0].documentVersion)).toBeGreaterThan(0);
});

test("complex receiver access stays in member mode while typing prefix", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    factory()\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "factory");
  await page.evaluate(() => {
    window.__autocompleteRequests = [];
    window.__autocompleteRequestLog = [];
    window.__autocompleteDelayBySuffix = {};
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Build");
  await page.keyboard.type("B", { delay: 5 });
  await waitForCompletionLabel(page, "Build");
  await expectNoCompletionLabel(page, "Close");

  const requests = await page.evaluate(
    () => window.__autocompleteRequestLog || [],
  );
  expect(
    requests.some(
      (entry) =>
        entry.textBefore.endsWith("factory().") &&
        entry.completionTriggerKind === 2 &&
        entry.accessOperator === ".",
    ),
    JSON.stringify(requests),
  ).toBe(true);
  expect(
    requests.filter((entry) => entry.textBefore.endsWith("factory().B")),
  ).toEqual([]);
});

test("bare access popup renders LSP members alphabetically without CodeMirror resorting", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    alpha\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "alpha");
  await page.evaluate(() => {
    window.__autocompleteRequests = [];
    window.__autocompleteRequestLog = [];
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Alpha");

  expect(await completionLabels(page)).toEqual([
    "Alpha",
    "beta2",
    "Beta10",
    "Zeta",
  ]);

  const request = await page.evaluate(
    () =>
      window.__autocompleteRequestLog?.find((entry) =>
        entry.textBefore.endsWith("alpha."),
      ) ?? null,
  );
  expect(request).toMatchObject({
    completionTriggerKind: 2,
    triggerChar: ".",
    accessOperator: ".",
    lspStatus: "ok",
    isIncomplete: false,
    itemCount: 4,
  });
});

test("incomplete bare member popup re-requests typed continuation", async ({
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
    window.__autocompleteRequests = [];
    window.__autocompleteRequestLog = [];
    window.__autocompleteResponseBySuffix = {
      "context.": {
        items: [{ label: "WithCancel", source: "lsp", kind: "function" }],
        lspStatus: "ok",
        isIncomplete: true,
      },
    };
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "WithCancel");
  await page.keyboard.type("B", { delay: 5 });
  await waitForCompletionLabel(page, "Background");

  const requests = await page.evaluate(
    () => window.__autocompleteRequestLog || [],
  );
  expect(
    requests.some(
      (entry) =>
        entry.textBefore.endsWith("context.") &&
        entry.completionTriggerKind === 2 &&
        entry.isIncomplete,
    ),
  ).toBe(true);
  expect(
    requests.some(
      (entry) =>
        entry.textBefore.endsWith("context.B") &&
        entry.completionTriggerKind === 3,
    ),
    JSON.stringify(requests),
  ).toBe(true);
});

test("bare member popup retries transient LSP timeout once before showing unavailable", async ({
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
    window.__autocompleteRequests = [];
    window.__autocompleteRequestLog = [];
    window.__autocompleteResponseSequenceBySuffix = {
      "context.": [
        { items: [], lspStatus: "timeout", isIncomplete: false },
        {
          items: [
            { label: "WithCancel", source: "lsp", kind: "function" },
            { label: "NewRequest", source: "lsp", kind: "function" },
          ],
          lspStatus: "ok",
          isIncomplete: false,
        },
      ],
    };
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "NewRequest", { timeout: 5000 });
  await expectNoCompletionLabel(page, "Completion unavailable");

  const requests = await page.evaluate(
    () => window.__autocompleteRequestLog || [],
  );
  const contextRequests = requests.filter((entry) =>
    entry.textBefore.endsWith("context."),
  );
  expect(contextRequests.map((entry) => entry.lspStatus).slice(0, 2)).toEqual([
    "timeout",
    "ok",
  ]);
});

test("access response with ok status but no authoritative members shows unavailable", async ({
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
    window.__autocompleteRequests = [];
    window.__autocompleteRequestLog = [];
    window.__autocompleteResponseBySuffix = {
      "context.": {
        items: [
          {
            label: "GlobalFunction",
            source: "lsp",
            kind: "function",
            accessMemberAuthoritative: false,
          },
        ],
        lspStatus: "ok",
        isIncomplete: false,
      },
    };
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Completion unavailable");
  await expectNoCompletionLabel(page, "GlobalFunction");

  const requestCountBeforeEnter = await page.evaluate(
    () => window.__autocompleteRequestLog?.length || 0,
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).not.toContain("GlobalFunction");
  expect(
    await page.evaluate(() => window.__autocompleteRequestLog?.length || 0),
  ).toBe(requestCountBeforeEnter);
});

test("empty LSP member response does not fabricate unknown library members", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/index.ts`,
    language: "typescript",
    content: "axios\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "axios");
  await page.evaluate(() => {
    window.__autocompleteRequests = [];
    window.__autocompleteRequestLog = [];
    window.__autocompleteResponseBySuffix = {
      "axios.": { items: [], lspStatus: "empty", isIncomplete: false },
    };
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "No LSP members");
  await expectNoCompletionLabel(page, "get");

  const requestCountBeforeEnter = await page.evaluate(
    () => window.__autocompleteRequestLog?.length || 0,
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => window.__autocompleteRequestLog?.length || 0),
  ).toBe(requestCountBeforeEnter);

  const request = await page.evaluate(
    () =>
      window.__autocompleteRequestLog?.find((entry) =>
        entry.textBefore.endsWith("axios."),
      ) ?? null,
  );
  expect(request).toMatchObject({
    completionTriggerKind: 2,
    triggerChar: ".",
    accessOperator: ".",
    lspStatus: "empty",
    isIncomplete: false,
    itemCount: 0,
  });
});

test("enter on loading access members does not arm hidden accept", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/index.ts`,
    language: "typescript",
    content: "axios\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "axios");
  await page.evaluate(() => {
    window.__autocompleteDelayBySuffix = { "axios.": 500 };
    window.__autocompleteResponseBySuffix = {
      "axios.": {
        items: [
          {
            label: "get",
            source: "lsp",
            kind: "function",
            accessMemberAuthoritative: true,
          },
        ],
        lspStatus: "ok",
      },
    };
  });

  await page.keyboard.type(".");
  await waitForCompletionLabel(page, "Loading members...");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).not.toContain("axios.get");
});

test("escape clears deferred pending access accept", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "log");
  await page.evaluate(() => {
    window.__autocompleteDelayBySuffix = { "log.": 450 };
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            additionalTextEdits: [
              {
                startLine: 2,
                startColumn: 1,
                endLine: 2,
                endColumn: 1,
                text: 'import "log"\n\n',
              },
            ],
          },
        ],
        lspStatus: "ok",
      },
    };
  });

  await page.keyboard.type(".");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).not.toContain("log.Fatal");
  expect(snapshot.text).not.toContain('import "log"');
});

test("blur clears deferred pending access accept", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    log\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "log");
  await page.evaluate(() => {
    let blurTarget = document.getElementById("autocomplete-blur-target");
    if (!blurTarget) {
      blurTarget = document.createElement("button");
      blurTarget.id = "autocomplete-blur-target";
      blurTarget.textContent = "blur";
      blurTarget.style.position = "fixed";
      blurTarget.style.left = "4px";
      blurTarget.style.top = "4px";
      document.body.appendChild(blurTarget);
    }
    window.__autocompleteDelayBySuffix = { "log.": 450 };
    window.__autocompleteResponseBySuffix = {
      "log.": {
        items: [
          {
            label: "Fatal",
            source: "lsp",
            kind: "function",
            insertText: "Fatal($0)",
            isSnippet: true,
            accessMemberAuthoritative: true,
            additionalTextEdits: [
              {
                startLine: 2,
                startColumn: 1,
                endLine: 2,
                endColumn: 1,
                text: 'import "log"\n\n',
              },
            ],
          },
        ],
        lspStatus: "ok",
      },
    };
  });

  await page.keyboard.type(".");
  await page.keyboard.press("Enter");
  await page.locator("#autocomplete-blur-target").focus();
  await page.waitForTimeout(800);

  const snapshot = await editorSnapshot(page);
  expect(snapshot.text).not.toContain("log.Fatal");
  expect(snapshot.text).not.toContain('import "log"');
});

test("numeric and comment suffixes do not start access member popup", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.go`,
    language: "go",
    content: "package main\n\nfunc main() {\n    1\n    // context\n}\n",
  } satisfies EditorFixture;

  await mountEditor(page, fixture);
  await focusRenderedTextEnd(page, "1");
  await page.evaluate(() => {
    window.__autocompleteRequests = [];
    window.__autocompleteRequestLog = [];
  });

  await page.keyboard.type(".");
  await expectNoCompletionLabel(page, "Loading members...");
  await expectNoCompletionLabel(page, "No LSP members");

  await focusRenderedTextEnd(page, "// context");
  await page.keyboard.type(".");
  await expectNoCompletionLabel(page, "Loading members...");
  await expectNoCompletionLabel(page, "No LSP members");

  const requests = await page.evaluate(
    () => window.__autocompleteRequestLog || [],
  );
  expect(
    requests.filter(
      (entry) =>
        entry.textBefore.endsWith("1.") ||
        entry.textBefore.endsWith("// context."),
    ),
  ).toEqual([]);
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

test("instant access popup does not surface library members before delayed backend proof", async ({
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
    await expectNoCompletionLabel(page, item.label, 500);
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

test("arrow access works for pointer-style member operators", async ({
  page,
}) => {
  const fixture = {
    filePath: `${projectPath}/main.cpp`,
    language: "cpp",
    content: "int main() {\n    ptr\n}\n",
  } satisfies EditorFixture;

  await assertAccessPopupScenario(page, fixture, "ptr", "->", ["begin", "end"]);
});

test("colon access works for Lua method operators", async ({ page }) => {
  const fixture = {
    filePath: `${projectPath}/main.lua`,
    language: "lua",
    content: "local player = {}\nplayer\n",
  } satisfies EditorFixture;

  await assertAccessPopupScenario(page, fixture, "player", ":", [
    "MoveTo",
    "Spawn",
  ]);
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
