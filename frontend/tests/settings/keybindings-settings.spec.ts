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

    const testWindow = window as typeof window & {
      __appCalls: Array<{ method: string; args: unknown[] }>;
      __selectedDirectory?: string | null;
    };
    testWindow.__appCalls = [];
    testWindow.__selectedDirectory = null;

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string | symbol) => {
          if (typeof property !== "string") {
            return undefined;
          }

          return async (...args: unknown[]) => {
            testWindow.__appCalls.push({ method: property, args });
            switch (property) {
              case "GetCurrentProjectFramework":
                return null;
              case "GetShellCapabilities":
                return {
                  capabilities: {
                    dialogs: {
                      status: "available",
                      reason: "test dialog bridge",
                    },
                  },
                };
              case "GetProjectWindowSession":
                return {
                  sessionId: args[0],
                  projectPath: "/launched",
                  windowName: "project:project-session-1",
                };
              case "SelectDirectory":
                return testWindow.__selectedDirectory ?? "";
              case "GetRecentProjects":
              case "GetDevToolsStatus":
                return [];
              case "GetAutocompleteLanguageCapabilities":
                return [
                  {
                    id: "typescript",
                    name: "TypeScript",
                    extensions: [".ts", ".mts", ".cts"],
                    canonicalId: "typescript",
                    tier: "native",
                    sources: {
                      syntax: true,
                      lspDeclared: true,
                      lspAvailable: true,
                      index: true,
                      local: true,
                      predictive: true,
                      imports: true,
                      stubs: true,
                      keywords: true,
                      fillAll: true,
                    },
                    lspServerId: "typescript-language-server",
                    lspInstalled: true,
                    lspCanInstall: true,
                    lspInstalling: false,
                    notes: [],
                  },
                  {
                    id: "rust",
                    name: "Rust",
                    extensions: [".rs"],
                    canonicalId: "rust",
                    tier: "lsp-only",
                    sources: {
                      syntax: true,
                      lspDeclared: true,
                      lspAvailable: false,
                      index: false,
                      local: false,
                      predictive: false,
                      imports: true,
                      stubs: true,
                      keywords: true,
                      fillAll: false,
                    },
                    lspServerId: "rust-analyzer",
                    lspInstalled: false,
                    lspCanInstall: true,
                    lspInstalling: false,
                    notes: ["Autocomplete is LSP-first"],
                  },
                ];
              case "InstallLSPServer":
                return true;
              case "IsLSPInstalling":
                return true;
              case "InspectProjectAccess":
                return { path: args[0], accessible: true, reason: "" };
              case "OpenProject":
              case "OpenProjectWindow":
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
  activeId: string | null = "/workspace",
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

      if (nextActiveId) {
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
      }
    },
    { nextProjects: projects, nextActiveId: activeId },
  );

  if (activeId) {
    await expect(page.getByTitle("Settings")).toBeVisible();
  }
}

async function openKeybindings(page: Page) {
  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: /Keybindings/ }).click();
  await expect(
    page.getByRole("heading", { name: "Keybindings" }),
  ).toBeVisible();
}

async function openAppearance(page: Page) {
  await page.getByTitle("Settings").click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
}

async function openBrowserPreviewSettings(page: Page) {
  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: /Browser Preview/ }).click();
  await expect(
    page.getByRole("heading", { name: "Browser Preview" }),
  ).toBeVisible();
}

async function openDiagnosticsSettings(page: Page) {
  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: /Diagnostics/ }).click();
  await expect(
    page.getByRole("heading", { name: "Diagnostics" }),
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

const setSelectedDirectory = async (page: Page, projectPath: string | null) => {
  await page.evaluate((selectedPath) => {
    (
      window as typeof window & {
        __selectedDirectory?: string | null;
      }
    ).__selectedDirectory = selectedPath;
  }, projectPath);
};

const clearAppCalls = async (page: Page) => {
  await page.evaluate(() => {
    (
      window as typeof window & {
        __appCalls: Array<{ method: string; args: unknown[] }>;
      }
    ).__appCalls = [];
  });
};

const getAppCalls = async (page: Page) =>
  page.evaluate(
    () =>
      (
        window as typeof window & {
          __appCalls: Array<{ method: string; args: unknown[] }>;
        }
      ).__appCalls,
  );

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

test("appearance tab persists Project opening mode", async ({ page }) => {
  await mountProjectUI(page);
  await openAppearance(page);

  const projectOpeningGroup = page.getByRole("group", {
    name: "Project opening",
  });
  const projectsButton = projectOpeningGroup.getByRole("button", {
    name: "Projects",
  });
  const windowsButton = projectOpeningGroup.getByRole("button", {
    name: "Windows",
  });

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
        return JSON.parse(rawSettings).state.projectWindowMode;
      }),
    )
    .toBe("windows");

  await page.reload();
  await mountProjectUI(page);
  await openAppearance(page);
  const reloadedGroup = page.getByRole("group", { name: "Project opening" });
  await expect(
    reloadedGroup.getByRole("button", { name: "Windows" }),
  ).toHaveAttribute("aria-pressed", "true");

  await reloadedGroup.getByRole("button", { name: "Projects" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rawSettings = localStorage.getItem("editor-settings");
        if (!rawSettings) return null;
        return JSON.parse(rawSettings).state.projectWindowMode;
      }),
    )
    .toBe("projects");
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
    useEditorSettingsStore.getState().setProjectWindowMode("windows");
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

test("project opening mode routes second project in current window or new macOS window", async ({
  page,
}) => {
  await mountProjectUI(
    page,
    [{ id: "/alpha", path: "/alpha", name: "alpha", openedAt: 1 }],
    "/alpha",
  );

  await setSelectedDirectory(page, "/beta");
  await clearAppCalls(page);
  await page.getByTitle("Add project").click();
  await page.getByRole("menuitem", { name: /Open Project/ }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useWorkspaceStore } =
          await import("/src/stores/workspaceStore.ts");
        return useWorkspaceStore
          .getState()
          .projects.map((project) => project.path);
      }),
    )
    .toEqual(["/alpha", "/beta"]);
  let calls = await getAppCalls(page);
  expect(
    calls.some(
      (call) => call.method === "OpenProject" && call.args[0] === "/beta",
    ),
  ).toBe(true);
  expect(calls.some((call) => call.method === "OpenProjectWindow")).toBe(false);

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useWorkspaceStore.setState({
      projects: [{ id: "/alpha", path: "/alpha", name: "alpha", openedAt: 1 }],
      activeId: "/alpha",
      pendingId: null,
      switchSourceId: null,
      switchDirection: 1,
      uiBlockers: [],
    });
    useEditorSettingsStore.getState().setProjectWindowMode("windows");
  });

  await setSelectedDirectory(page, "/gamma");
  await clearAppCalls(page);
  await page.getByTitle("Add project").click();
  await page.getByRole("menuitem", { name: /Open Project/ }).click();

  await expect
    .poll(async () => {
      const calls = await getAppCalls(page);
      return calls.some(
        (call) =>
          call.method === "OpenProjectWindow" && call.args[0] === "/gamma",
      );
    })
    .toBe(true);
  calls = await getAppCalls(page);
  expect(
    calls.some(
      (call) => call.method === "OpenProject" && call.args[0] === "/gamma",
    ),
  ).toBe(false);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useWorkspaceStore } =
          await import("/src/stores/workspaceStore.ts");
        return useWorkspaceStore
          .getState()
          .projects.map((project) => project.path);
      }),
    )
    .toEqual(["/alpha"]);
});

test("windows project opening mode uses current window when welcome has no active project", async ({
  page,
}) => {
  await mountProjectUI(page, [], null);
  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setProjectWindowMode("windows");
  });
  await expect(page.getByText("Open Project")).toBeVisible();

  await setSelectedDirectory(page, "/alpha");
  await clearAppCalls(page);
  await page
    .getByRole("button", { name: /Open Project/ })
    .first()
    .click();

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useWorkspaceStore } =
          await import("/src/stores/workspaceStore.ts");
        return useWorkspaceStore
          .getState()
          .projects.map((project) => project.path);
      }),
    )
    .toEqual(["/alpha"]);
  const calls = await getAppCalls(page);
  expect(
    calls.some(
      (call) => call.method === "OpenProject" && call.args[0] === "/alpha",
    ),
  ).toBe(true);
  expect(calls.some((call) => call.method === "OpenProjectWindow")).toBe(false);
});

test("project session route ignores shared workspace storage", async ({
  page,
}) => {
  await page.goto("/?arleProjectSession=session-1");

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useWorkspaceStore } =
          await import("/src/stores/workspaceStore.ts");
        return {
          activeId: useWorkspaceStore.getState().activeId,
          projects: useWorkspaceStore
            .getState()
            .projects.map((project) => project.path),
        };
      }),
    )
    .toEqual({ activeId: "/launched", projects: ["/launched"] });
});

test("Browser Preview settings persist Markdown links mode", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openBrowserPreviewSettings(page);

  const markdownLinksGroup = page.getByRole("group", {
    name: "Markdown links",
  });
  const browserButton = markdownLinksGroup.getByRole("button", {
    name: "Browser",
  });
  const previewButton = markdownLinksGroup.getByRole("button", {
    name: "Preview",
  });

  await expect(browserButton).toHaveAttribute("aria-pressed", "true");
  await expect(previewButton).toHaveAttribute("aria-pressed", "false");

  await previewButton.click();
  await expect(browserButton).toHaveAttribute("aria-pressed", "false");
  await expect(previewButton).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rawSettings = localStorage.getItem("browser-preview-settings.v1");
        if (!rawSettings) return null;
        return JSON.parse(rawSettings).state.markdownLinkOpenMode;
      }),
    )
    .toBe("preview");

  await page.reload();
  await mountProjectUI(page);
  await openBrowserPreviewSettings(page);

  const reloadedGroup = page.getByRole("group", { name: "Markdown links" });
  await expect(
    reloadedGroup.getByRole("button", { name: "Preview" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("diagnostics tab shows autocomplete capability matrix and install action", async ({
  page,
}) => {
  await mountProjectUI(page);
  await openDiagnosticsSettings(page);

  const support = page.getByTestId("autocomplete-support");
  await expect(support).toContainText("Autocomplete support");
  await expect(support).toContainText("Native");
  await expect(support).toContainText("LSP only");
  await expect(support).toContainText("TypeScript");
  await expect(support).toContainText("Rust");

  await page.getByTestId("autocomplete-support-search").fill("rust");
  await expect(support).toContainText("Rust");
  await expect(support).not.toContainText("TypeScript");

  const installButton = support.getByRole("button", { name: /Install LSP/ });
  await expect(installButton).toBeVisible();
  await installButton.click();

  await expect
    .poll(async () => {
      const calls = await getAppCalls(page);
      return calls.some(
        (call) =>
          call.method === "InstallLSPServer" &&
          call.args[0] === "rust-analyzer",
      );
    })
    .toBe(true);
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
  await page.waitForLoadState("domcontentloaded");
  await mountProjectUI(page);
  await page.getByTitle("Settings").click();
  await expect(
    page.getByRole("switch", { name: "Rainbow brackets" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("light theme switches use dark readable thumbs", async ({ page }) => {
  await mountProjectUI(page);
  await openAppearance(page);

  const themeTrigger = page.getByTestId("theme-dropdown-trigger");
  await themeTrigger.click();
  await page.getByRole("menuitem", { name: /Catppuccin Latte/ }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "catppuccin-latte",
  );

  const rainbowBracketsSwitch = page.getByRole("switch", {
    name: "Rainbow brackets",
  });
  const thumbTone = await rainbowBracketsSwitch
    .locator("span")
    .evaluate((element) => {
      const color = window.getComputedStyle(element).backgroundColor;
      const channels = color
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
      if (!channels || channels.length < 3) {
        return 255;
      }
      const rgb = channels.map((channel) =>
        channel <= 1 ? channel * 255 : channel,
      );
      return rgb.reduce((sum, channel) => sum + channel, 0) / rgb.length;
    });

  expect(thumbTone).toBeLessThan(125);
});

test("Ctrl+Tab switcher inherits the active light theme surface", async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem(
      "editorTabs:/workspace",
      JSON.stringify({
        tabs: [
          { path: "/workspace/index.tsx", label: "index.tsx" },
          { path: "/workspace/second.ts", label: "second.ts" },
        ],
        activeTabId: "tab--workspace-index-tsx",
      }),
    );
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  await mountProjectUI(page);
  await openAppearance(page);

  const themeTrigger = page.getByTestId("theme-dropdown-trigger");
  await themeTrigger.click();
  await page.getByRole("menuitem", { name: /Catppuccin Latte/ }).click();
  await page.getByLabel("Close settings").click();
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);

  await dispatchShortcut(page, { key: "Tab", code: "Tab", ctrlKey: true });

  const switcherPanel = page.getByTestId("tab-switcher-panel");
  await expect(switcherPanel).toBeVisible();
  const panelTone = await switcherPanel.evaluate((element) => {
    const color = window.getComputedStyle(element).backgroundColor;
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length < 3) {
      return 0;
    }
    const rgb = channels.map((channel) =>
      channel <= 1 ? channel * 255 : channel,
    );
    return rgb.reduce((sum, channel) => sum + channel, 0) / rgb.length;
  });

  expect(panelTone).toBeGreaterThan(160);
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
