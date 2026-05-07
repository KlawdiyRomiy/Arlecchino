import { expect, test, type Page } from "@playwright/test";

const projectPath = "/workspace";
const filePath = `${projectPath}/src/search-target.go`;
const fileContent = `package main

func main() {
	println("needle")
	println("another needle")
}
`;

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

const mountEditor = async (page: Page) => {
  await page.goto("/");

  await page.evaluate(
    async ({ content, filePath, projectPath }) => {
      const rootElement = document.createElement("div");
      rootElement.id = "playwright-editor-search-root";
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

      createRoot(rootElement).render(
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
    { content: fileContent, filePath, projectPath },
  );

  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });
};

test("Cmd+F opens compact file search in the active editor", async ({
  page,
}) => {
  await mountEditor(page);

  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+F");

  await expect(page.getByTestId("editor-file-search")).toBeVisible();
  await expect(page.getByTestId("editor-file-search-input")).toBeFocused();
  await expect(page.getByTestId("editor-file-search-input")).toHaveAttribute(
    "placeholder",
    "Find in file",
  );
  await expect(
    page.getByTestId("editor-file-search").getByRole("button"),
  ).toHaveCount(3);

  await page.getByTestId("editor-file-search-input").fill("needle");
  await expect(page.getByTestId("editor-file-search-count")).toHaveText("1/2");

  await page.getByRole("button", { name: "Next match" }).click();
  await expect(page.getByTestId("editor-file-search-count")).toHaveText("2/2");

  const searchBox = await page.getByTestId("editor-file-search").boundingBox();
  expect(searchBox?.width).toBeLessThanOrEqual(380);
  expect(searchBox?.height).toBeLessThanOrEqual(48);
});
