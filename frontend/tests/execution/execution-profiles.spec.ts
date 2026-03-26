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

test("execution profiles surface preview and Go run/debug actions", async ({
  page,
}) => {
  await page.goto("/");

  const profiles = await page.evaluate(async () => {
    const { resolveExecutionProfiles } =
      await import("/src/utils/executionProfiles.ts");

    return {
      html: resolveExecutionProfiles({
        projectPath: "/workspace",
        activeTab: {
          id: "tab-index-html",
          path: "/workspace/index.html",
          name: "index.html",
          content: "<html><body>Hello</body></html>",
          isDirty: false,
          language: "html",
        },
      }),
      go: resolveExecutionProfiles({
        projectPath: "/workspace",
        activeTab: {
          id: "tab-main-go",
          path: "/workspace/cmd/api/main.go",
          name: "main.go",
          content: "package main\n\nfunc main() {}\n",
          isDirty: false,
          language: "go",
        },
      }),
    };
  });

  expect(profiles.html.runProfiles[0]).toMatchObject({
    kind: "preview",
    mode: "run",
  });
  expect(profiles.go.runProfiles[0].command).toBe(
    'go run "/workspace/cmd/api/main.go"',
  );
  expect(profiles.go.debugProfiles[0].command).toBe(
    'dlv debug "/workspace/cmd/api"',
  );
});
