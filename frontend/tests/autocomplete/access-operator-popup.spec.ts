import { expect, test, type Page } from "@playwright/test";

const projectPath = "/virtual/autocomplete-project";

type EditorFixture = {
  filePath: string;
  language: string;
  content: string;
};

declare global {
  interface Window {
    __autocompleteFixture?: EditorFixture;
    __autocompletePendingFixture?: EditorFixture;
  }
}

const completionsByPrefix: Record<
  string,
  Array<{ label: string; source: string; kind?: string; detail?: string }>
> = {
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

      const normalizeItems = (
        items: Array<{
          label: string;
          source: string;
          kind?: string;
          detail?: string;
        }>,
      ) =>
        items.map((item, index) => ({
          label: item.label,
          text: item.label,
          insertText: item.label,
          detail: item.detail || item.label,
          documentation: "",
          kind: item.kind || "function",
          source: item.source,
          isSnippet: false,
          priority: 100 - index,
          matchType: "prefix",
          additionalTextEdits: [],
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
          const suffix = Object.keys(completionsByPrefix)
            .filter((candidate) => textBefore.endsWith(candidate))
            .sort((a, b) => b.length - a.length)[0];
          const items = suffix ? completionsByPrefix[suffix] : [];
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
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(CodeMirrorEditor, {
            filePath: fixture.filePath,
            content: fixture.content,
            language: fixture.language,
            projectPath: "/virtual/autocomplete-project",
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
    { fixture },
  );

  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });
}

async function focusRenderedTextEnd(page: Page, text: string) {
  const token = page.getByText(text, { exact: true }).last();
  await expect(token).toBeVisible({ timeout: 10000 });
  await token.click();
  await page.keyboard.press("End");
}

async function waitForCompletionLabel(page: Page, label: string) {
  const popup = page.locator(".cm-tooltip-autocomplete");
  await expect(popup).toBeVisible({ timeout: 10000 });
  await expect(
    popup.locator(".cm-completionLabel", { hasText: label }).first(),
  ).toBeVisible({
    timeout: 10000,
  });
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
  await waitForCompletionLabel(page, expectedLabels[0]);
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
