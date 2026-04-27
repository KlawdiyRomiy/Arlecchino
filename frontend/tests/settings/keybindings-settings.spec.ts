import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const customThemeExamplePath = path.join(
  os.homedir(),
  "Documents",
  "tomorrow-night-burns.arlecchino-theme.json",
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("__keybindings_settings_ready") !== "1") {
      localStorage.clear();
      sessionStorage.setItem("__keybindings_settings_ready", "1");
    }

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async () => {
            switch (property) {
              case "GetCurrentProjectFramework":
                return null;
              case "GetRecentProjects":
              case "GetDevToolsStatus":
                return [];
              case "OpenProject":
              case "CreateTerminal":
              case "WriteTerminal":
              case "SendTerminalText":
              case "CloseTerminal":
              case "ResizeTerminal":
                return true;
              case "ListFiles":
                return [];
              default:
                return null;
            }
          };
        },
      },
    );

    const runtimeBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "EventsOn" || property === "EventsOnMultiple") {
            return () => () => undefined;
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

    localStorage.setItem(
      "workspace-storage",
      JSON.stringify({
        state: {
          projects: [
            {
              id: "/workspace",
              path: "/workspace",
              name: "workspace",
              openedAt: 1,
            },
          ],
          activeId: "/workspace",
          switchDirection: 1,
        },
        version: 0,
      }),
    );
  });

  await page.goto("/");
});

async function mountProjectUI(page: Page) {
  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
    const { useEditorStore } = await import("/src/stores/editorStore.ts");

    useWorkspaceStore.setState({
      projects: [
        {
          id: "/workspace",
          path: "/workspace",
          name: "workspace",
          openedAt: 1,
        },
      ],
      activeId: "/workspace",
      activeFramework: null,
      pendingId: null,
      ready: true,
      switchDirection: 1,
      uiBlockers: [],
    });

    useExplorerStore.getState().setProjectPath("/workspace");
    useEditorStore
      .getState()
      .openTab(
        "pane-main",
        "/workspace/index.tsx",
        "index.tsx",
        "export const ready = true;",
        "tsx",
      );
  });

  await expect(page.getByTitle("Settings")).toBeVisible();
}

async function openKeybindings(page: Page) {
  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: /Keybindings/ }).click();
  await expect(
    page.getByRole("heading", { name: "Keybindings" }),
  ).toBeVisible();
}

const dispatchShortcut = async (
  page: Page,
  payload: { key: string; code: string; metaKey?: boolean; ctrlKey?: boolean },
): Promise<void> => {
  await page.evaluate((eventInit) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        ...eventInit,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, payload);
};

test("keybindings tab records shortcuts, blocks duplicates, persists, and resets", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openKeybindings(page);

  const explorerRow = page.getByTestId("keybinding-row-explorer.toggle");
  await explorerRow.getByLabel("Edit shortcut for Explorer").click();
  await page.keyboard.press("Meta+K");
  await expect(explorerRow).toContainText("cmd+k");

  const gitRow = page.getByTestId("keybinding-row-git.toggle");
  await gitRow.getByLabel("Edit shortcut for Git compact").click();
  await page.keyboard.press("Meta+K");
  await expect(gitRow).toContainText("Already used by Explorer");

  await page.reload();
  await mountProjectUI(page);
  await openKeybindings(page);
  await expect(
    page.getByTestId("keybinding-row-explorer.toggle"),
  ).toContainText("cmd+k");

  await page.getByRole("button", { name: "Reset all" }).click();
  await expect(
    page.getByTestId("keybinding-row-explorer.toggle"),
  ).toContainText("cmd+e");
});

test("appearance theme dropdown opens and selects a theme", async ({
  page,
}) => {
  await mountProjectUI(page);
  await page.getByTitle("Settings").click();

  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

  const catppuccinLabels = await page.evaluate(async () => {
    const { themeOptions } = await import("/src/styles/themes.ts");
    return themeOptions
      .filter((option) => option.label.startsWith("Catppuccin"))
      .map((option) => option.label);
  });
  expect(catppuccinLabels).toEqual([
    "Catppuccin Latte",
    "Catppuccin Frappe",
    "Catppuccin Macchiato",
    "Catppuccin Mocha",
  ]);

  const themeTrigger = page.getByTestId("theme-dropdown-trigger");
  await themeTrigger.click();

  const themeItem = page.getByRole("menuitem", {
    name: /Catppuccin Mocha/,
  });
  await expect(themeItem).toBeVisible();
  await themeItem.click();

  await expect(themeTrigger).toContainText("Catppuccin Mocha");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "catppuccin-mocha",
  );
});

test("appearance imports custom theme json and lists it under custom themes", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync(customThemeExamplePath),
    `Missing local custom theme example at ${customThemeExamplePath}`,
  );

  await mountProjectUI(page);
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.getByTitle("Settings").click();

  await page
    .locator('input[type="file"]')
    .setInputFiles(customThemeExamplePath);

  const themeTrigger = page.getByTestId("theme-dropdown-trigger");
  await themeTrigger.scrollIntoViewIfNeeded();
  await expect(themeTrigger).toContainText("Tomorrow Night Burns");
  await expect(page.getByText("Added Tomorrow Night Burns")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "custom:tomorrow-night-burns-example",
  );

  await themeTrigger.click();
  const dropdownContent = page.getByTestId("theme-dropdown-content");
  await expect(dropdownContent).toBeVisible();

  const [triggerBox, contentBox] = await Promise.all([
    themeTrigger.boundingBox(),
    dropdownContent.boundingBox(),
  ]);
  expect(triggerBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(
    Math.abs((triggerBox?.width ?? 0) - (contentBox?.width ?? 0)),
  ).toBeLessThanOrEqual(2);

  await expect
    .poll(async () =>
      dropdownContent.evaluate((element) => ({
        canScroll: element.scrollHeight > element.clientHeight,
        overflowY: window.getComputedStyle(element).overflowY,
      })),
    )
    .toEqual({ canScroll: true, overflowY: "auto" });

  await expect(page.getByText("Custom themes")).toBeVisible();
  await dropdownContent.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const customThemeItem = page.getByRole("menuitem", {
    name: /Tomorrow Night Burns/,
  });
  await expect(customThemeItem).toBeVisible();
  await customThemeItem.click();
});

test("settings modal scales with app zoom shortcuts", async ({ page }) => {
  await mountProjectUI(page);
  await page.getByTitle("Settings").click();

  const modal = page.getByTestId("settings-modal");
  await expect(modal).toBeVisible();

  const before = await modal.boundingBox();
  expect(before).not.toBeNull();

  await dispatchShortcut(page, { key: "=", code: "Equal", metaKey: true });

  await expect
    .poll(async () => {
      const box = await modal.boundingBox();
      return box?.width ?? 0;
    })
    .toBeGreaterThan((before?.width ?? 0) + 20);
});
