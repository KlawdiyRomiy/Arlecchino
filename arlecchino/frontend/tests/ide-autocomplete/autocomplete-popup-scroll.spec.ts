import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

const projectPath =
  "/Users/a1/Documents/Arlecchino/arlecchino/frontend/tests/ide-autocomplete/scenarios";
const filePath = `${projectPath}/test.go`;
const fileContent = readFileSync(filePath, "utf8");
const completionItems = Array.from({ length: 20 }, (_value, index) => ({
  label: `PrintVariant${index}`,
  text: `PrintVariant${index}`,
  detail: `func(arg${index} string)`,
  documentation: `Test completion ${index}`,
  kind: "function",
  source: "library",
  insertText: `PrintVariant${index}`,
  isSnippet: false,
  priority: 1000 - index,
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ completionItems, fileContent, filePath, projectPath }) => {
      const appHandlers: Record<string, (...args: unknown[]) => unknown> = {
        SelectDirectory: async () => projectPath,
        OpenProject: async () => true,
        GetCurrentProjectPath: async () => projectPath,
        GetRecentProjects: async () => [],
        ValidateEnvironment: async () => null,
        GetDevToolsStatus: async () => [],
        GetLSPInstallStatus: async () => [],
        InspectProject: async () => ({}),
        ReadDirectory: async (path?: unknown) => {
          if (path !== projectPath) {
            return [];
          }

          return [
            {
              name: "test.go",
              path: filePath,
              isDirectory: false,
            },
          ];
        },
        ReadFile: async (path?: unknown) => (path === filePath ? fileContent : ""),
        GetEditorCompletions: async () => ({
          items: completionItems,
          showGhost: false,
        }),
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
    },
    { projectPath, filePath, fileContent, completionItems },
  );
});

async function openScenarioProject(page: Page) {
  await page.goto("/");

  await page.getByRole("button", { name: /open project/i }).click();

  const fileEntry = page.locator(`[data-file-path="${filePath}"]`);
  await expect(fileEntry).toBeVisible({ timeout: 10000 });
  await fileEntry.click();

  await expect(page.locator(".cm-editor").first()).toBeVisible({ timeout: 10000 });
}

async function triggerAutocompletePopup(page: Page): Promise<Locator> {
  const targetLine = page
    .locator(".cm-line")
    .filter({ hasText: 'fmt.Println("Hello World")' })
    .first();

  await expect(targetLine).toBeVisible();
  await targetLine.click();
  await page.keyboard.press("Home");

  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("ArrowRight");
  }

  await page.keyboard.press("Delete");
  await page.keyboard.type(".");

  const popup = page.locator(".cm-tooltip-autocomplete").first();
  await expect(popup).toBeVisible({ timeout: 5000 });

  return popup;
}

test("autocomplete popup stays visible and scrollable in go scenario", async ({
  page,
}) => {
  await openScenarioProject(page);
  const popup = await triggerAutocompletePopup(page);
  const popupList = popup.locator("ul").first();

  await expect(popupList).toBeVisible();

  const popupWithinViewport = await popup.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      width: rect.width,
      height: rect.height,
      withinViewport:
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth,
    };
  });

  expect(popupWithinViewport.withinViewport).toBe(true);

  const listMetrics = await popupList.evaluate((element) => ({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));

  expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);

  await popupList.hover();
  await page.mouse.wheel(0, 600);

  await expect
    .poll(async () => popupList.evaluate((element) => element.scrollTop), {
      timeout: 2000,
    })
    .toBeGreaterThan(listMetrics.scrollTop);

  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("ArrowDown");
  }

  const selectedVisible = await popup.evaluate((element) => {
    const list = element.querySelector("ul");
    const selected = list?.querySelector('li[aria-selected="true"]');

    if (!(list instanceof HTMLElement) || !(selected instanceof HTMLElement)) {
      return false;
    }

    return (
      selected.offsetTop >= list.scrollTop &&
      selected.offsetTop + selected.offsetHeight <= list.scrollTop + list.clientHeight
    );
  });

  expect(selectedVisible).toBe(true);
});
