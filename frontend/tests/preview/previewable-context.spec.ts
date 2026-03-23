import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: () => async () => null,
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
  });
});

test("preview button prefers last known live target", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(async () => {
    const { resolvePreviewButtonState } =
      await import("/src/hooks/usePreviewableContext.ts");

    return resolvePreviewButtonState({
      activeTab: {
        id: "tab-index-html",
        path: "/workspace/index.html",
        name: "index.html",
        content: "<html><body>local file</body></html>",
        isDirty: false,
        language: "html",
      },
      projectPath: "/workspace",
      lastKnownTarget: {
        url: "http://localhost:3000/app",
        sessionId: "term-1",
        source: "terminal",
        updatedAt: 1710000000000,
      },
      allowedOrigins: ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"],
    });
  });

  expect(state.enabled).toBe(true);
  expect(state.kind).toBe("live-url");
  expect(state.launchInput?.payload?.url).toBe("http://localhost:3000/app");
});

test("preview button falls back to static html document", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(async () => {
    const { resolvePreviewButtonState } =
      await import("/src/hooks/usePreviewableContext.ts");

    return resolvePreviewButtonState({
      activeTab: {
        id: "tab-index-html",
        path: "/workspace/index.html",
        name: "index.html",
        content: "<html><body><h1>Hello preview</h1></body></html>",
        isDirty: false,
        language: "html",
      },
      projectPath: "/workspace",
      lastKnownTarget: null,
      allowedOrigins: ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"],
    });
  });

  expect(state.enabled).toBe(true);
  expect(state.kind).toBe("static-html");
  expect(state.launchInput?.payload?.htmlContent).toContain("Hello preview");
  expect(state.launchInput?.payload?.sourceLabel).toBe("index.html");
});

test("preview button opens empty state for previewable non-html files", async ({
  page,
}) => {
  await page.goto("/");

  const state = await page.evaluate(async () => {
    const { resolvePreviewButtonState } =
      await import("/src/hooks/usePreviewableContext.ts");

    return resolvePreviewButtonState({
      activeTab: {
        id: "tab-app-tsx",
        path: "/workspace/src/App.tsx",
        name: "App.tsx",
        content: "export function App() { return <main>Hello</main>; }",
        isDirty: true,
        language: "typescriptreact",
      },
      projectPath: "/workspace",
      lastKnownTarget: null,
      allowedOrigins: ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"],
    });
  });

  expect(state.enabled).toBe(true);
  expect(state.kind).toBe("empty-state");
  expect(state.launchInput?.payload?.htmlContent).toContain(
    "No running preview",
  );
  expect(state.buttonTitle).toContain("No running preview");
});

test("preview button enables frontend config contexts", async ({ page }) => {
  await page.goto("/");

  const state = await page.evaluate(async () => {
    const { resolvePreviewButtonState } =
      await import("/src/hooks/usePreviewableContext.ts");

    return resolvePreviewButtonState({
      activeTab: {
        id: "tab-vite-config",
        path: "/workspace/vite.config.ts",
        name: "vite.config.ts",
        content:
          "import { defineConfig } from 'vite'; export default defineConfig({});",
        isDirty: false,
        language: "typescript",
      },
      projectPath: "/workspace",
      lastKnownTarget: null,
      allowedOrigins: ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"],
    });
  });

  expect(state.enabled).toBe(true);
  expect(state.kind).toBe("empty-state");
});
