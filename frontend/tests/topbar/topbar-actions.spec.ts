import { expect, test } from "@playwright/test";

const ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS = 700;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    const nativeWindowControlsVisibleCalls: boolean[] = [];
    const nativeWindowControlsPositionCalls: unknown[][] = [];
    const runtimeEventHandlers = new Map<
      string,
      Set<(payload: unknown) => void>
    >();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () =>
          (window as unknown as { __copiedText?: string }).__copiedText ?? "",
        writeText: async (text: string) => {
          (window as unknown as { __copiedText?: string }).__copiedText = text;
        },
      },
    });

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (...args: unknown[]) => {
            const overrides = (
              window as unknown as {
                __appBridgeOverrides?: Record<
                  string,
                  (...args: unknown[]) => unknown
                >;
              }
            ).__appBridgeOverrides;
            const override = overrides?.[property];
            if (override) {
              return override(...args);
            }
            switch (property) {
              case "GetCurrentProjectFramework":
                return null;
              case "GetRecentProjects":
                return [];
              case "GetDevToolsStatus":
                return [];
              case "IsNativeFullscreen":
                return false;
              case "OpenProject":
              case "CreateTerminal":
              case "WriteTerminal":
              case "SendTerminalText":
              case "CloseTerminal":
              case "ResizeTerminal":
                return true;
              case "SetNativeWindowControlsVisible":
                nativeWindowControlsVisibleCalls.push(Boolean(args[0]));
                return true;
              case "PositionNativeWindowControls":
                nativeWindowControlsPositionCalls.push(args);
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
            return (
              eventName: string,
              callback: (payload: unknown) => void,
            ) => {
              const handlers = runtimeEventHandlers.get(eventName) ?? new Set();
              handlers.add(callback);
              runtimeEventHandlers.set(eventName, handlers);
              return () => handlers.delete(callback);
            };
          }
          if (property === "EventsOff") {
            return (eventName: string, ...additionalEventNames: string[]) => {
              [eventName, ...additionalEventNames].forEach((name) =>
                runtimeEventHandlers.delete(name),
              );
            };
          }
          if (property === "EventsEmit") {
            return (eventName: string, payload?: unknown) => {
              const handlers = runtimeEventHandlers.get(eventName) ?? new Set();
              handlers.forEach((handler) => handler(payload));
            };
          }
          return async () => undefined;
        },
      },
    );

    Object.assign(window, {
      _wails: { environment: { OS: "darwin" } },
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
      __nativeWindowControlsVisibleCalls: nativeWindowControlsVisibleCalls,
      __nativeWindowControlsPositionCalls: nativeWindowControlsPositionCalls,
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
  page: Parameters<typeof test>[0]["page"],
  activePath = "/workspace/index.html",
  projectPath = "/workspace",
) {
  await page.evaluate(
    async ({ projectPath, filePath }) => {
      const { useWorkspaceStore } =
        await import("/src/stores/workspaceStore.ts");
      const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
      const { useEditorStore } = await import("/src/stores/editorStore.ts");

      useWorkspaceStore.setState({
        projects: [
          {
            id: projectPath,
            path: projectPath,
            name: "workspace",
            openedAt: 1,
          },
        ],
        activeId: projectPath,
        activeFramework: null,
        pendingId: null,
        ready: true,
        switchDirection: 1,
        uiBlockers: [],
      });

      useExplorerStore.getState().setProjectPath(projectPath);
      useEditorStore
        .getState()
        .openTab(
          "pane-main",
          filePath,
          filePath.split("/").pop() || "index.html",
          "<html><body>Preview shortcut</body></html>",
          "html",
        );
    },
    { projectPath, filePath: activePath },
  );

  await expect(page.getByTitle("Search").first()).toBeVisible();
}

async function enterZenMode(page: Parameters<typeof test>[0]["page"]) {
  await page.evaluate(() => {
    const eventInit = {
      key: ".",
      code: "Period",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });

  await expect(page.getByTestId("main-layout")).toHaveAttribute(
    "data-zen-mode",
    "true",
  );
}

async function revealZenTopbar(page: Parameters<typeof test>[0]["page"]) {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, 1);
  await expect(page.getByTestId("main-layout")).toHaveAttribute(
    "data-zen-topbar-visible",
    "true",
  );
}

async function readWindowDragStyles(
  page: Parameters<typeof test>[0]["page"],
  selector: string,
) {
  return page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) {
      return { webkitAppRegion: "", wailsDraggable: "" };
    }
    const styles = getComputedStyle(element);
    return {
      webkitAppRegion: styles.getPropertyValue("-webkit-app-region").trim(),
      wailsDraggable: styles.getPropertyValue("--wails-draggable").trim(),
    };
  }, selector);
}

type TestedThemeId = "arlecchino-light" | "blackprint";

async function applyThemeVariables(
  page: Parameters<typeof test>[0]["page"],
  themeId: TestedThemeId,
) {
  await page.evaluate(async (nextThemeId: TestedThemeId) => {
    const { getThemeDefinition } = await import("/src/styles/themes.ts");
    const nextTheme = getThemeDefinition(nextThemeId);
    const htmlElement = document.documentElement;

    Object.entries(nextTheme.cssVariables).forEach(([name, value]) => {
      htmlElement.style.setProperty(name, value);
    });
    htmlElement.classList.remove("light", "dark");
    htmlElement.classList.add(
      nextTheme.appearance === "dark" ? "dark" : "light",
    );
    htmlElement.dataset.theme = nextTheme.id;
    htmlElement.dataset.themeAppearance = nextTheme.appearance;
  }, themeId);
}

async function readTopbarButtonThemeColors(
  page: Parameters<typeof test>[0]["page"],
  testId: string,
) {
  return page.getByTestId(testId).evaluate((button) => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);

    const resolveColor = (value: string) => {
      probe.style.color = value.trim();
      return getComputedStyle(probe).color;
    };
    const rootStyles = getComputedStyle(document.documentElement);
    const buttonStyles = getComputedStyle(button);
    const colors = {
      backgroundColor: buttonStyles.backgroundColor,
      borderRadius: buttonStyles.borderRadius,
      color: buttonStyles.color,
      textPrimary: resolveColor(rootStyles.getPropertyValue("--text-primary")),
      surfaceCanvas: resolveColor(
        rootStyles.getPropertyValue("--surface-canvas"),
      ),
      softenedBackground: resolveColor(
        "color-mix(in srgb, var(--text-primary) 84%, var(--surface-canvas) 16%)",
      ),
      softenedForeground: resolveColor(
        "color-mix(in srgb, var(--surface-canvas) 82%, var(--text-primary) 18%)",
      ),
    };

    probe.remove();
    return colors;
  });
}

test("search button opens command dispatcher", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("Search").click();

  await expect(page.locator('input[placeholder="Search..."]')).toBeVisible();
  await expect(
    page.locator('input[placeholder="Search commands, files..."]'),
  ).toHaveCount(0);
});

test("smart quote activates grep mode in command dispatcher", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTitle("Search").click();
  await page.locator('input[placeholder="Search..."]').fill("«needle");

  await expect(
    page.locator(".shell-pill").filter({ hasText: "Grep" }),
  ).toBeVisible();
});

test("command dispatcher hides risky git write actions", async ({ page }) => {
  await mountProjectUI(page);
  await page.evaluate(() => {
    Object.assign(window as unknown as Record<string, unknown>, {
      __appBridgeOverrides: {
        GetDispatcherSuggestions: async () => [
          {
            id: "panel.git",
            icon: "git-branch",
            title: ">Open Git Panel",
            subtitle: "Show Git panel",
            action: "execute",
          },
          {
            id: "shortcut.git.toggle",
            icon: "git-branch",
            title: ">Toggle Git Panel",
            subtitle: "Open or close Git panel",
            action: "execute",
            actionLabel: "cmd+g",
          },
          {
            id: "git.status",
            icon: "git-branch",
            title: ">Git Status",
            subtitle: "Show Git status panel",
            action: "execute",
          },
        ],
      },
    });
  });

  await page.getByTitle("Search").click();
  const searchInput = page.locator('input[placeholder="Search..."]');
  await searchInput.fill(">git");

  await expect(page.getByText(">Git Status")).toBeVisible();
  await expect(page.getByText(/Git Commit/)).toHaveCount(0);
  await expect(page.getByText(/Git Pull/)).toHaveCount(0);
  await expect(page.getByText(/Git Push/)).toHaveCount(0);
});

test("tag commands launch directly without command preview", async ({
  page,
}) => {
  await mountProjectUI(page);
  await page.evaluate(() => {
    const terminalWrites: string[] = [];
    Object.assign(window as unknown as Record<string, unknown>, {
      __terminalWrites: terminalWrites,
      __appBridgeOverrides: {
        ExpandTag: async () => "php artisan migrate",
        CreateTerminal: async () => true,
        WriteTerminal: async (_id: string, data: string) => {
          terminalWrites.push(atob(data));
          return true;
        },
      },
    });
  });

  await page.getByTitle("Search").click();
  const searchInput = page.locator('input[placeholder="Search..."]');
  await searchInput.fill("@artisan migrate");

  await expect(page.getByText("Expanded command")).toHaveCount(0);
  await expect(page.getByText("Execution preview")).toHaveCount(0);
  await expect(page.getByText("Preview")).toHaveCount(0);

  await page.keyboard.press("Enter");

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            (window as unknown as { __terminalWrites?: string[] })
              .__terminalWrites ?? []
          ).at(-1) ?? "",
      ),
    )
    .toBe("php artisan migrate\n");
});

test("run app action opens execution dialog instead of executing profile", async ({
  page,
}) => {
  await mountProjectUI(page);
  await page.evaluate(() => {
    const terminalWrites: string[] = [];
    Object.assign(window as unknown as Record<string, unknown>, {
      __terminalWrites: terminalWrites,
      __appBridgeOverrides: {
        WriteTerminal: async (_id: string, data: string) => {
          terminalWrites.push(atob(data));
          return true;
        },
      },
    });
  });
  await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/stores/editorStore.ts");
    useEditorStore
      .getState()
      .syncActiveTab(
        "pane-main",
        "/workspace/main.go",
        "main.go",
        "package main\n\nfunc main() {}\n",
        "go",
        false,
      );
  });

  await page.evaluate(() => window.runtime.EventsEmit("ide:app:run", "run"));

  await expect(page.getByTestId("execution-dialog")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            (window as unknown as { __terminalWrites?: string[] })
              .__terminalWrites ?? []
          ).length,
      ),
    )
    .toBe(0);
});

test("command dispatcher executes local AI palette action", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTitle("Search").click();
  const searchInput = page.locator('input[placeholder="Search..."]');
  await searchInput.fill(">ai");

  await expect(page.getByText("AI: Plan")).toBeVisible();
  await page.getByText("AI: Plan").click();

  await expect(page.getByTestId("ai-chat-panel")).toBeVisible();
  await expect(searchInput).toHaveCount(0);
});

test("@ai prompt mode shows workflow suggestions and blocks unknown modes", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTitle("Search").click();
  const searchInput = page.locator('input[placeholder="Search..."]');
  await searchInput.fill("@ai");

  await expect(page.getByText("@ai /plan")).toBeVisible();
  await searchInput.fill("@ai /ship it");

  await expect(page.getByText("Unknown AI mode /ship")).toBeVisible();
});

test("@ai plan launcher preserves fullscreen and visible mode with partial action catalog", async ({
  page,
}) => {
  await mountProjectUI(page);
  await page.evaluate(() => {
    const now = () => new Date().toISOString();
    const provider = {
      id: "palette-smoke",
      name: "Palette Smoke",
      kind: "ollama",
      local: true,
      manual: false,
      frontier: false,
      oauthSupported: false,
      requiresAuth: false,
      authConfigured: true,
      capabilities: ["chat"],
      models: [
        { id: "palette-code", displayName: "palette-code", streaming: true },
      ],
      defaultModel: "palette-code",
      status: "ready",
      lastCheckedAt: now(),
    };
    const startRequests: Record<string, unknown>[] = [];
    Object.assign(window as unknown as Record<string, unknown>, {
      __aiStartRequests: startRequests,
      __appBridgeOverrides: {
        AIGetStatus: async () => ({
          enabled: true,
          mnemonicEnabled: false,
          providers: [provider],
          activeProviderId: provider.id,
          activeModel: "palette-code",
          settingsConfigured: true,
        }),
        AIGetConsentPolicy: async () => ({
          localProvidersAccepted: true,
          remoteProvidersAccepted: false,
          frontierProvidersAccepted: false,
          providerPolicies: [],
          acceptedAt: now(),
          updatedAt: now(),
        }),
        AIGetApprovalPolicy: async () => ({
          mode: "ask_each_time",
          scope: {},
          allowedToolKinds: ["context_read"],
          hardDenyCategories: [],
        }),
        AIGetEmbeddingStatus: async () => ({
          status: "disabled",
          reason: "",
          providers: [],
          updatedAt: now(),
        }),
        AIListProviderRuntimes: async () => [],
        AIListChatActions: async () => [
          {
            id: "ask",
            name: "Ask",
            description: "Ask with project context",
            builtIn: true,
            mayProposeTools: false,
            expectsToolProposals: false,
            readOnlyIntent: true,
          },
        ],
        AIListContextProviders: async () => [],
        AIListEgressRecords: async () => [],
        AIListAgentProfiles: async () => [],
        AIListPromptWorkflows: async () => [],
        AIListTools: async () => [],
        AIListToolAudit: async () => [],
        AIListModelCapabilities: async () => [],
        AIListMnemonicEntries: async () => [],
        AIListPendingApprovals: async () => [],
        AIListChatRuns: async () => [],
        AIGetContextPreview: async (request: Record<string, unknown>) => ({
          id: "palette-preview",
          capability: "chat",
          prompt: request.prompt,
          contextItems: [],
          snippets: [],
          dataCategories: ["user_prompt"],
          redaction: {},
          createdAt: now(),
        }),
        AIStartChatRun: async (request: Record<string, unknown>) => {
          startRequests.push(request);
          return {
            id: "palette-run-1",
            sessionId:
              typeof request.sessionId === "string"
                ? request.sessionId
                : "default",
            action: request.action,
            status: "completed",
            providerId: provider.id,
            model: "palette-code",
            userPrompt: request.prompt,
            response: "planned",
            createdAt: now(),
            updatedAt: now(),
            completedAt: now(),
          };
        },
      },
    });
  });

  await page.keyboard.press("Meta+Shift+R");
  await expect(page.getByTestId("panel-aiChat")).toBeVisible();
  const fullscreenFrame = await page.getByTestId("panel-aiChat").boundingBox();
  expect(fullscreenFrame?.width ?? 0).toBeGreaterThan(900);

  await page.keyboard.press("Meta+Shift+F");
  const searchInput = page.locator('input[placeholder="Search..."]');
  await searchInput.fill("@ai /plan expand command palette");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("ai-chat-panel")).toBeVisible();
  const preservedFrame = await page.getByTestId("panel-aiChat").boundingBox();
  expect(preservedFrame?.width ?? 0).toBeGreaterThan(900);
  await expect(page.getByTestId("ai-chat-mode-plan")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __aiStartRequests?: Record<string, unknown>[];
            }
          ).__aiStartRequests?.length ?? 0,
      ),
    )
    .toBe(1);
  const request = await page.evaluate(
    () =>
      (
        window as unknown as {
          __aiStartRequests?: Record<string, unknown>[];
        }
      ).__aiStartRequests?.[0],
  );
  expect(request).toMatchObject({
    action: "plan",
    workflowId: "slash-plan",
    profileId: "plan-architect",
    prompt: "expand command palette",
    providerId: "palette-smoke",
    model: "palette-code",
  });
});

test("Cmd+Shift+F opens command dispatcher", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+F");

  await expect(page.locator('input[placeholder="Search..."]')).toBeVisible();
  await expect(
    page.locator('input[placeholder="Search commands, files..."]'),
  ).toHaveCount(0);
});

test("Cmd+Shift+F does not open command dispatcher when terminal search is focused", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    const input = document.createElement("input");
    input.setAttribute("data-terminal-search-input", "true");
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(page.locator('input[placeholder="Search..."]')).toHaveCount(0);
});

test("settings button opens settings modal", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("Settings").click();

  await expect(page.getByTestId("settings-modal")).toBeVisible();
});

async function setCompactTopbarActions(
  page: Parameters<typeof test>[0]["page"],
) {
  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setShowTopbarProjectPath(false);
  });
}

async function setTopbarItemOrder(
  page: Parameters<typeof test>[0]["page"],
  order: string[],
) {
  await page.evaluate(async (nextOrder) => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    const settings = useEditorSettingsStore.getState();
    settings.setShowTopbarProjectPath(false);
    settings.setTopbarItemOrder(nextOrder);
  }, order);
}

async function dragTopbarItemToBubble(
  page: Parameters<typeof test>[0]["page"],
  itemId: string,
  bubbleTestId: string,
) {
  const item = page.getByTestId(`topbar-item-${itemId}`);
  const bubble = page.getByTestId(bubbleTestId);
  const itemBox = await item.boundingBox();
  const bubbleBox = await bubble.boundingBox();
  expect(itemBox).not.toBeNull();
  expect(bubbleBox).not.toBeNull();

  await page.mouse.move(
    (itemBox?.x ?? 0) + (itemBox?.width ?? 0) / 2,
    (itemBox?.y ?? 0) + (itemBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    (bubbleBox?.x ?? 0) + (bubbleBox?.width ?? 0) / 2,
    (bubbleBox?.y ?? 0) + (bubbleBox?.height ?? 0) / 2,
    { steps: 8 },
  );
  await page.mouse.up();
}

test("default topbar keeps panel and update actions in the More menu", async ({
  page,
}) => {
  await mountProjectUI(page);

  await expect(page.getByTestId("topbar-action-bubble")).toBeVisible();
  await expect(page.getByTestId("topbar-sync-dependencies-button")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("topbar-ai-chat-button")).toHaveCount(0);
  await expect(page.getByTitle("More")).toBeVisible();

  await page.getByTitle("More").click();

  await expect(page.getByRole("menuitem", { name: /AI Chat/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Terminal/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Git/ })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Sync dependencies/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Check for Updates/ }),
  ).toBeVisible();
});

test("compact topbar promotes dropdown actions and hides project label", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  await expect(page.getByTestId("topbar-project-path")).toHaveCount(0);
  await expect(page.getByTestId("topbar-ai-chat-button")).toBeVisible();
  await expect(page.getByTestId("topbar-terminal-button")).toBeVisible();
  await expect(page.getByTestId("topbar-git-button")).toBeVisible();
  await expect(
    page.getByTestId("topbar-sync-dependencies-button"),
  ).toBeVisible();
  await expect(page.getByTestId("topbar-check-updates-button")).toBeVisible();
  await expect(page.getByTitle("More")).toHaveCount(0);
});

test("topbar actions can be dragged between the left and right groups", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  const searchItem = page.getByTestId("topbar-item-search");
  const rightGroup = page.getByTestId("topbar-action-bubble");
  const searchBox = await searchItem.boundingBox();
  const rightGroupBox = await rightGroup.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(rightGroupBox).not.toBeNull();

  await page.mouse.move(
    (searchBox?.x ?? 0) + (searchBox?.width ?? 0) / 2,
    (searchBox?.y ?? 0) + (searchBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    (rightGroupBox?.x ?? 0) + (rightGroupBox?.width ?? 0) - 8,
    (rightGroupBox?.y ?? 0) + (rightGroupBox?.height ?? 0) / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(
    page.getByTestId("topbar-action-bubble").getByTestId("topbar-item-search"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("topbar-left-action-bubble")
      .getByTestId("topbar-item-search"),
  ).toHaveCount(0);
});

test("topbar action drag outside both groups keeps the original order", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  const beforeOrder = await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    return useEditorSettingsStore.getState().topbarItemOrder;
  });

  const settingsItem = page.getByTestId("topbar-item-settings");
  const settingsBox = await settingsItem.boundingBox();
  expect(settingsBox).not.toBeNull();

  await page.mouse.move(
    (settingsBox?.x ?? 0) + (settingsBox?.width ?? 0) / 2,
    (settingsBox?.y ?? 0) + (settingsBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move(640, 220, { steps: 8 });
  await page.mouse.up();

  const afterOrder = await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    return useEditorSettingsStore.getState().topbarItemOrder;
  });

  expect(afterOrder).toEqual(beforeOrder);
  await expect(
    page
      .getByTestId("topbar-left-action-bubble")
      .getByTestId("topbar-item-settings"),
  ).toBeVisible();
});

test("empty topbar action groups accept returned items", async ({ page }) => {
  await mountProjectUI(page);

  await setTopbarItemOrder(page, [
    "projects",
    "addProject",
    "context",
    "explorer",
    "search",
    "settings",
    "debug",
    "run",
    "preview",
    "aiChat",
    "terminal",
    "git",
    "syncDependencies",
    "checkUpdates",
  ]);
  await expect(page.getByTestId("topbar-left-action-bubble")).toBeVisible();
  await expect(
    page
      .getByTestId("topbar-left-action-bubble")
      .getByTestId("topbar-item-search"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("topbar-action-bubble").getByTestId("topbar-item-search"),
  ).toBeVisible();

  await dragTopbarItemToBubble(page, "search", "topbar-left-action-bubble");

  await expect(
    page
      .getByTestId("topbar-left-action-bubble")
      .getByTestId("topbar-item-search"),
  ).toBeVisible();

  await setTopbarItemOrder(page, [
    "explorer",
    "search",
    "settings",
    "debug",
    "run",
    "preview",
    "aiChat",
    "terminal",
    "git",
    "syncDependencies",
    "checkUpdates",
    "projects",
    "addProject",
    "context",
  ]);
  await expect(page.getByTestId("topbar-action-bubble")).toBeVisible();
  await expect(
    page
      .getByTestId("topbar-action-bubble")
      .getByTestId("topbar-item-terminal"),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("topbar-left-action-bubble")
      .getByTestId("topbar-item-terminal"),
  ).toBeVisible();

  await dragTopbarItemToBubble(page, "terminal", "topbar-action-bubble");

  await expect(
    page
      .getByTestId("topbar-action-bubble")
      .getByTestId("topbar-item-terminal"),
  ).toBeVisible();
});

test("promoted panel buttons toggle panels and active indicators", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  const aiChatButton = page.getByTestId("topbar-ai-chat-button");
  const terminalButton = page.getByTestId("topbar-terminal-button");
  const gitButton = page.getByTestId("topbar-git-button");

  await aiChatButton.click();
  await expect(page.getByTestId("panel-aiChat")).toBeVisible();
  await expect(aiChatButton).toHaveAttribute("aria-pressed", "true");

  await terminalButton.click();
  await expect(page.getByTestId("panel-terminal")).toBeVisible();
  await expect(terminalButton).toHaveAttribute("aria-pressed", "true");

  await gitButton.click();
  await expect(page.getByTestId("panel-git")).toBeVisible();
  await expect(gitButton).toHaveAttribute("aria-pressed", "true");
});

test("active topbar panel buttons invert against the current theme", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  const terminalButton = page.getByTestId("topbar-terminal-button");
  await terminalButton.click();
  await expect(terminalButton).toHaveAttribute("aria-pressed", "true");

  for (const themeId of ["arlecchino-light", "blackprint"] as const) {
    await applyThemeVariables(page, themeId);
    await page.waitForTimeout(220);
    const colors = await readTopbarButtonThemeColors(
      page,
      "topbar-terminal-button",
    );

    expect(colors.backgroundColor).toBe(colors.softenedBackground);
    expect(colors.color).toBe(colors.softenedForeground);
    expect(colors.backgroundColor).not.toBe(colors.textPrimary);
    expect(colors.color).not.toBe(colors.surfaceCanvas);
    expect(colors.borderRadius).toBe("9999px");
  }
});

test("compact topbar setting hides the whole project label", async ({
  page,
}) => {
  await mountProjectUI(
    page,
    "/Users/klawdiy/workspace/index.html",
    "/Users/klawdiy/workspace",
  );

  const projectPathStrip = page.getByTestId("topbar-project-path").first();

  await expect(projectPathStrip).toContainText("/Users/klawdiy/");

  await setCompactTopbarActions(page);

  await expect(page.getByTestId("topbar-project-parent-path")).toHaveCount(0);
  await expect(page.getByTestId("topbar-project-path")).toHaveCount(0);
});

test("indexing state remains visible in the compact topbar context bubble", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("indexer:started", {
      current: 0,
      total: 10,
    });
  });

  await expect(page.getByTestId("topbar-indexing-status")).toBeVisible();
  await expect(page.getByTestId("topbar-indexing-status")).toContainText(
    "Indexing",
  );
  await expect(page.getByTestId("topbar-indexing-progress")).toBeVisible();
  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("indexer:progress", {
      current: 4,
      total: 10,
    });
  });
  await expect(page.getByTestId("topbar-indexing-progress")).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await expect(page.getByTestId("topbar-project-path")).toHaveCount(0);
});

test("terminal indexer errors clear the compact topbar indexing state", async ({
  page,
}) => {
  await mountProjectUI(page);
  await setCompactTopbarActions(page);

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("indexer:started", {
      current: 0,
      total: 10,
    });
  });
  await expect(page.getByTestId("topbar-indexing-status")).toBeVisible();

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("indexer:error", {
      terminal: false,
      error: "single file failed",
    });
  });
  await expect(page.getByTestId("topbar-indexing-status")).toBeVisible();

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("indexer:error", {
      terminal: true,
      error: "scan canceled",
    });
  });

  await expect(page.getByTestId("topbar-indexing-status")).toHaveCount(0);
});

test("Cmd+Shift+. toggles zen chrome and edge hover reveals it", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    const eventInit = {
      key: ".",
      code: "Period",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });

  const layout = page.getByTestId("main-layout");
  await expect(layout).toHaveAttribute("data-zen-mode", "true");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect(layout).toHaveAttribute("data-zen-statusbar-visible", "false");
  await expect
    .poll(() => readWindowDragStyles(page, '[data-testid="topbar"]'))
    .toEqual({
      webkitAppRegion: "no-drag",
      wailsDraggable: "no-drag",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(false);

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, 1);
  await page.waitForTimeout(ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS - 250);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");
  await expect
    .poll(() => readWindowDragStyles(page, '[data-testid="topbar"]'))
    .toEqual({
      webkitAppRegion: "drag",
      wailsDraggable: "drag",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(true);
  await page.mouse.move(520, 320);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await expect
    .poll(() => readWindowDragStyles(page, '[data-testid="topbar"]'))
    .toEqual({
      webkitAppRegion: "no-drag",
      wailsDraggable: "no-drag",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(false);

  await page.mouse.move(viewport.width - 1, viewport.height - 1);
  await page.waitForTimeout(ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS - 250);
  await expect(layout).toHaveAttribute("data-zen-statusbar-visible", "false");
  await expect(layout).toHaveAttribute("data-zen-statusbar-visible", "true");
  await page.mouse.move(520, 320);
  await expect(layout).toHaveAttribute("data-zen-statusbar-visible", "false");
});

test("native fullscreen hides macOS window controls backdrop", async ({
  page,
}) => {
  await mountProjectUI(page);

  await expect(
    page.getByTestId("window-controls-native-backdrop"),
  ).toBeVisible();

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("shell:native-fullscreen-changed", {
      fullscreen: true,
    });
  });

  await expect(page.getByTestId("window-controls-native-backdrop")).toHaveCount(
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(false);

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("shell:native-fullscreen-changed", {
      fullscreen: false,
    });
  });

  await expect(
    page.getByTestId("window-controls-native-backdrop"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(true);
});

test("native window controls wait for project switch transition to settle", async ({
  page,
}) => {
  await mountProjectUI(page);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __nativeWindowControlsPositionCalls: unknown[][];
            }
          ).__nativeWindowControlsPositionCalls.length,
      ),
    )
    .toBeGreaterThan(0);

  await page.evaluate(async () => {
    (
      window as unknown as {
        __nativeWindowControlsPositionCalls: unknown[][];
      }
    ).__nativeWindowControlsPositionCalls.length = 0;

    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    useWorkspaceStore.setState({
      projects: [
        {
          id: "/workspace",
          path: "/workspace",
          name: "workspace",
          openedAt: 1,
        },
        { id: "/other", path: "/other", name: "other", openedAt: 2 },
      ],
      activeId: "/other",
      pendingId: "/other",
      switchSourceId: "/workspace",
      switchDirection: 1,
      ready: true,
      uiBlockers: [],
    });
  });

  await page.waitForTimeout(120);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __nativeWindowControlsPositionCalls: unknown[][];
          }
        ).__nativeWindowControlsPositionCalls.length,
    ),
  ).toBe(0);

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    useWorkspaceStore.setState({
      pendingId: null,
      switchSourceId: null,
    });
  });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __nativeWindowControlsPositionCalls: unknown[][];
            }
          ).__nativeWindowControlsPositionCalls.length,
      ),
    )
    .toBeGreaterThan(0);
});

test("native fullscreen exit does not restore backdrop while Zen topbar is hidden", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    const runtime = (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime;

    runtime.EventsEmit("shell:native-fullscreen-changed", {
      fullscreen: true,
    });
  });

  await expect(page.getByTestId("window-controls-native-backdrop")).toHaveCount(
    0,
  );

  await page.evaluate(() => {
    const eventInit = {
      key: ".",
      code: "Period",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  });

  const layout = page.getByTestId("main-layout");
  await expect(layout).toHaveAttribute("data-zen-mode", "true");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  await page.evaluate(() => {
    (
      window as unknown as {
        runtime: {
          EventsEmit: (eventName: string, payload?: unknown) => void;
        };
      }
    ).runtime.EventsEmit("shell:native-fullscreen-changed", {
      fullscreen: false,
    });
  });

  await expect(page.getByTestId("window-controls-native-backdrop")).toHaveCount(
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __nativeWindowControlsVisibleCalls: boolean[];
          }
        ).__nativeWindowControlsVisibleCalls.at(-1),
      ),
    )
    .toBe(false);
});

test("zen topbar reveal avoids editor split and markdown preview controls before opening", async ({
  page,
}) => {
  await mountProjectUI(page, "/workspace/AGENT_CONTEXT.md");
  await enterZenMode(page);

  const layout = page.getByTestId("main-layout");
  const splitControls = page.getByTestId("editor-tabs-split-controls");
  const markdownToggle = page.getByTestId(
    "editor-tabs-markdown-preview-toggle",
  );
  await expect(splitControls).toBeVisible();
  await expect(markdownToggle).toBeVisible();
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  const splitBox = await splitControls.boundingBox();
  expect(splitBox).not.toBeNull();
  await page.mouse.move(
    (splitBox?.x ?? 0) + (splitBox?.width ?? 0) / 2,
    (splitBox?.y ?? 0) + (splitBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  await splitControls.locator('button[title^="Split Right"]').click();
  await expect(page.getByTitle("Close split")).toBeVisible();
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  const markdownBox = await markdownToggle.boundingBox();
  expect(markdownBox).not.toBeNull();
  await page.mouse.move(
    (markdownBox?.x ?? 0) + (markdownBox?.width ?? 0) / 2,
    (markdownBox?.y ?? 0) + (markdownBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  await markdownToggle.click();
  await expect(markdownToggle).toHaveAttribute("aria-pressed", "true");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, 1);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.mouse.move(
    (splitBox?.x ?? 0) + (splitBox?.width ?? 0) / 2,
    (splitBox?.y ?? 0) + (splitBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.mouse.move(
    (markdownBox?.x ?? 0) + (markdownBox?.width ?? 0) / 2,
    (markdownBox?.y ?? 0) + (markdownBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");
});

test("zen topbar stays visible while the more menu popup is open", async ({
  page,
}) => {
  await mountProjectUI(page);
  await enterZenMode(page);

  const layout = page.getByTestId("main-layout");
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
  await revealZenTopbar(page);

  await page.getByTitle("More").click();
  const menuItem = page.getByRole("menuitem", { name: /AI Chat/ });
  await expect(menuItem).toBeVisible();

  const menuBox = await menuItem.boundingBox();
  expect(menuBox).not.toBeNull();
  await page.mouse.move(
    (menuBox?.x ?? 0) + (menuBox?.width ?? 0) / 2,
    (menuBox?.y ?? 0) + (menuBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.mouse.move(520, 320);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.keyboard.press("Escape");
  await expect(menuItem).toHaveCount(0);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
});

test("zen topbar stays visible while the add project popup is open", async ({
  page,
}) => {
  await mountProjectUI(page);
  await enterZenMode(page);

  const layout = page.getByTestId("main-layout");
  await revealZenTopbar(page);

  await page.getByTitle("Add project").click();
  const menuItem = page.getByRole("menuitem", { name: /Open Project/ });
  await expect(menuItem).toBeVisible();

  const menuBox = await menuItem.boundingBox();
  expect(menuBox).not.toBeNull();
  await page.mouse.move(
    (menuBox?.x ?? 0) + (menuBox?.width ?? 0) / 2,
    (menuBox?.y ?? 0) + (menuBox?.height ?? 0) / 2,
  );
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.mouse.move(520, 320);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "true");

  await page.keyboard.press("Escape");
  await expect(menuItem).toHaveCount(0);
  await expect(layout).toHaveAttribute("data-zen-topbar-visible", "false");
});

test("topbar more menu closes on Escape and omits removed actions", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTitle("More").click();

  await expect(page.getByRole("menuitem", { name: /AI Chat/ })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Command Palette/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: /About Arlecchino/ }),
  ).toHaveCount(0);

  await page.keyboard.press("Escape");

  await expect(page.getByRole("menuitem", { name: /AI Chat/ })).toHaveCount(0);
});

test("sync dependencies modal closes on Escape", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: /Sync dependencies/i }).click();

  await expect(page.getByTestId("dependency-policy-modal")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.shellModalOpen ?? ""))
    .toBe("true");

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("dependency-policy-modal")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.shellModalOpen ?? ""))
    .toBe("");
});

test("add project menu closes on Escape", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("Add project").click();

  await expect(
    page.getByRole("menuitem", { name: /Open Project/ }),
  ).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(
    page.getByRole("menuitem", { name: /Open Project/ }),
  ).toHaveCount(0);
});

test("preview shortcut uses latest active tab context", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+B");
  await page.waitForTimeout(100);

  const previewPayload = await page.evaluate(async () => {
    const { usePreviewWindowStore } =
      await import("/src/stores/previewWindowStore.ts");

    const windowState = usePreviewWindowStore.getState().windows[0];
    return windowState
      ? {
          title: windowState.title,
          url: windowState.payload.url ?? null,
          htmlContent: windowState.payload.htmlContent ?? null,
          sourceLabel: windowState.payload.sourceLabel ?? null,
        }
      : null;
  });

  expect(previewPayload).not.toBeNull();
  expect(previewPayload?.sourceLabel).toBe("index.html");
  expect(previewPayload?.htmlContent).toContain("Preview shortcut");
  expect(previewPayload?.url).toBe("");
});

test("preview shortcut closes an existing browser preview", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("panel-preview-browser-default")).toBeVisible();

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("panel-preview-browser-default")).toHaveCount(
    0,
  );
});

test("panel shortcuts open compact panels", async ({ page }) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+E");
  await expect(page.getByTestId("panel-explorer")).toBeVisible();

  await page.keyboard.press("Meta+G");
  await expect(page.getByTestId("panel-git")).toBeVisible();

  await page.keyboard.press("Meta+I");
  await expect(page.getByTestId("panel-problems")).toBeVisible();

  await page.keyboard.press("Meta+J");
  await expect(page.getByTestId("panel-terminal")).toBeVisible();
});

test("fullscreen panel shortcuts use expanded panel frames", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+G");
  const gitFrame = await page.getByTestId("panel-git").boundingBox();
  expect(gitFrame?.width ?? 0).toBeGreaterThan(900);
  expect(gitFrame?.height ?? 0).toBeGreaterThan(500);

  await page.keyboard.press("Meta+Shift+G");
  await expect(page.getByTestId("panel-git")).toBeHidden();

  await page.keyboard.press("Meta+Shift+G");
  await expect(page.getByTestId("panel-git")).toBeVisible();

  await page.keyboard.press("Meta+G");
  const compactGitFrame = await page.getByTestId("panel-git").boundingBox();
  expect(compactGitFrame?.width ?? 0).toBeLessThan(gitFrame?.width ?? 0);

  await page.keyboard.press("Meta+Shift+I");
  const problemsFrame = await page.getByTestId("panel-problems").boundingBox();
  expect(problemsFrame?.width ?? 0).toBeGreaterThan(900);
  expect(problemsFrame?.height ?? 0).toBeGreaterThan(500);

  await page.keyboard.press("Meta+Shift+I");
  await expect(page.getByTestId("panel-problems")).toBeHidden();
});

test("Option+W closes fullscreen Git, Problems, and Terminal panels", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+G");
  await expect(page.getByTestId("panel-git")).toBeVisible();
  await page.keyboard.press("Alt+W");
  await expect(page.getByTestId("panel-git")).toBeHidden();

  await page.keyboard.press("Meta+Shift+I");
  await expect(page.getByTestId("panel-problems")).toBeVisible();
  await page.keyboard.press("Alt+W");
  await expect(page.getByTestId("panel-problems")).toBeHidden();

  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: /Terminal/ }).click();
  const terminalPanel = page.getByTestId("panel-terminal");
  await expect(terminalPanel).toBeVisible();
  await terminalPanel.locator('button[title="Fullscreen"]').click();
  const terminalFrame = await terminalPanel.boundingBox();
  expect(terminalFrame?.width ?? 0).toBeGreaterThan(900);

  await page.keyboard.press("Alt+W");
  await expect(terminalPanel).toBeHidden();
});

test("Cmd+Shift+C copies project path with topbar confirmation", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.keyboard.press("Meta+Shift+C");

  const confirmation = page.getByTestId("project-path-copy-confirmation");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("Project path copied");
  await expect(confirmation).not.toContainText("cmd+shift+c");

  const confirmationBox = await confirmation.boundingBox();
  const topbarBox = await page.getByTestId("topbar").boundingBox();
  const projectPathBox = await page
    .getByTestId("topbar-project-path")
    .boundingBox();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const confirmationCenter =
    (confirmationBox?.x ?? 0) + (confirmationBox?.width ?? 0) / 2;

  expect(confirmationBox?.height ?? 0).toBeGreaterThan(28);
  expect(Math.abs(confirmationCenter - viewportWidth / 2)).toBeLessThan(24);
  expect(confirmationBox?.y ?? 0).toBeGreaterThan(
    (topbarBox?.y ?? 0) + (topbarBox?.height ?? 0),
  );
  expect(confirmationBox?.y ?? 0).toBeGreaterThan(
    (projectPathBox?.y ?? 0) + (projectPathBox?.height ?? 0),
  );

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __copiedText?: string }).__copiedText,
      ),
    )
    .toBe("/workspace");
});

test("Cmd+Shift+C does not copy project path from terminal focus", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.className = "xterm-helper-textarea";
    document.body.appendChild(input);
    input.focus();
  });

  await page.keyboard.press("Meta+Shift+C");

  await expect(page.getByTestId("project-path-copy-confirmation")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __copiedText?: string }).__copiedText,
    ),
  ).toBeUndefined();
});
