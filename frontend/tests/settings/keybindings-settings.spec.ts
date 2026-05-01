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

    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });

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

async function mountProjectUI(
  page: Page,
  projects = [
    {
      id: "/workspace",
      path: "/workspace",
      name: "workspace",
      openedAt: 1,
    },
  ],
  activeId = "/workspace",
) {
  await page.evaluate(
    async ({ nextProjects, nextActiveId }) => {
      const { useWorkspaceStore } =
        await import("/src/stores/workspaceStore.ts");
      const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
      const { useEditorStore } = await import("/src/stores/editorStore.ts");

      useWorkspaceStore.setState({
        projects: nextProjects,
        activeId: nextActiveId,
        activeFramework: null,
        pendingId: null,
        ready: true,
        switchDirection: 1,
        uiBlockers: [],
      });

      useExplorerStore.getState().setProjectPath(nextActiveId);
      useEditorStore
        .getState()
        .openTab(
          "pane-main",
          `${nextActiveId}/index.tsx`,
          "index.tsx",
          "export const ready = true;",
          "tsx",
        );
    },
    { nextProjects: projects, nextActiveId: activeId },
  );

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
): Promise<boolean> =>
  page.evaluate((eventInit) => {
    const event = new KeyboardEvent("keydown", {
      ...eventInit,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, payload);

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

test("keybindings tab persists Cmd+Backquote behavior", async ({ page }) => {
  await mountProjectUI(page);
  await openKeybindings(page);

  const projectsButton = page.getByRole("button", { name: "Projects" });
  const windowsButton = page.getByRole("button", { name: "Windows" });

  await expect(projectsButton).toHaveAttribute("aria-pressed", "true");
  await expect(windowsButton).toHaveAttribute("aria-pressed", "false");

  await windowsButton.click();
  await expect(projectsButton).toHaveAttribute("aria-pressed", "false");
  await expect(windowsButton).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rawSettings = localStorage.getItem("editor-settings");
        if (!rawSettings) return null;
        return JSON.parse(rawSettings).state.projectSwitchShortcutBehavior;
      }),
    )
    .toBe("window-cycle");

  await page.reload();
  await mountProjectUI(page);
  await openKeybindings(page);
  await expect(page.getByRole("button", { name: "Windows" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Projects" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rawSettings = localStorage.getItem("editor-settings");
        if (!rawSettings) return null;
        return JSON.parse(rawSettings).state.projectSwitchShortcutBehavior;
      }),
    )
    .toBe("project-switch");
});

test("Cmd+Backquote switches projects or yields to native windows by setting", async ({
  page,
}) => {
  const projects = [
    { id: "/alpha", path: "/alpha", name: "alpha", openedAt: 1 },
    { id: "/beta", path: "/beta", name: "beta", openedAt: 2 },
  ];
  const shortcut = { key: "`", code: "Backquote", metaKey: true };

  await mountProjectUI(page, projects, "/alpha");

  const projectSwitchPrevented = await dispatchShortcut(page, shortcut);
  expect(projectSwitchPrevented).toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useWorkspaceStore } =
          await import("/src/stores/workspaceStore.ts");
        return useWorkspaceStore.getState().activeId;
      }),
    )
    .toBe("/beta");

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useWorkspaceStore.setState({
      activeId: "/alpha",
      pendingId: null,
      switchSourceId: null,
      switchDirection: 1,
      uiBlockers: [],
    });
    useEditorSettingsStore
      .getState()
      .setProjectSwitchShortcutBehavior("window-cycle");
  });

  const windowCyclePrevented = await dispatchShortcut(page, shortcut);
  expect(windowCyclePrevented).toBe(false);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useWorkspaceStore } =
          await import("/src/stores/workspaceStore.ts");
        return useWorkspaceStore.getState().activeId;
      }),
    )
    .toBe("/alpha");
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

test("appearance toggles rainbow brackets setting", async ({ page }) => {
  await mountProjectUI(page);
  await page.getByTitle("Settings").click();

  const rainbowBracketsSwitch = page.getByRole("switch", {
    name: "Rainbow brackets",
  });
  await expect(rainbowBracketsSwitch).toHaveAttribute("aria-checked", "true");

  await rainbowBracketsSwitch.click();
  await expect(rainbowBracketsSwitch).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rawSettings = localStorage.getItem("editor-settings");
        if (!rawSettings) return null;
        return JSON.parse(rawSettings).state.showRainbowBrackets;
      }),
    )
    .toBe(false);

  await page.reload();
  await mountProjectUI(page);
  await page.getByTitle("Settings").click();
  await expect(
    page.getByRole("switch", { name: "Rainbow brackets" }),
  ).toHaveAttribute("aria-checked", "false");
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
