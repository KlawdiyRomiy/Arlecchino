import { expect, test } from "@playwright/test";

const makefilePath = "/workspace/Makefile";
const makefileContent = "dev-start:\n\tvite --host 127.0.0.1\n";
const packageJsonPath = "/workspace/package.json";
const packageJsonContent = '{\n  "name": "workspace"\n}\n';
const mainTsPath = "/workspace/src/main.ts";
const mainTsContent = "export const ready = true;\n";

const installMCPFilePanelBridges = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.clear();

    const listeners = new Map<
      string,
      Array<{ callback: (...data: unknown[]) => void; remaining: number }>
    >();
    const acks: unknown[] = [];
    const fileContents: Record<string, string> = {
      "/workspace/Makefile": "dev-start:\n\tvite --host 127.0.0.1\n",
      "/workspace/package.json": '{\n  "name": "workspace"\n}\n',
      "/workspace/src/main.ts": "export const ready = true;\n",
    };
    const writeFileCalls: Array<{ path: unknown; content: unknown }> = [];
    const notifyFileCalls: Array<{
      method: string;
      path: unknown;
      language?: unknown;
      version?: unknown;
      content?: unknown;
    }> = [];
    const aiApplyPatchCalls: unknown[] = [];
    const createDirectoryCalls: unknown[] = [];
    const createdDirectories: string[] = [];
    const scrollFixtureFiles = Array.from({ length: 48 }, (_, index) => {
      const name = `scroll-fixture-${String(index).padStart(2, "0")}.ts`;
      return {
        name,
        path: `/workspace/${name}`,
        isDirectory: false,
      };
    });

    const removeListener = (
      eventName: string,
      entry: { callback: (...data: unknown[]) => void; remaining: number },
    ) => {
      const current = listeners.get(eventName) ?? [];
      listeners.set(
        eventName,
        current.filter((item) => item !== entry),
      );
    };

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (...args: unknown[]) => {
            switch (property) {
              case "GetCurrentProjectFramework":
                return null;
              case "GetRecentProjects":
                return [];
              case "GetDevToolsStatus":
                return [];
              case "OpenProject":
              case "CreateTerminal":
              case "WriteTerminal":
              case "SendTerminalText":
              case "CloseTerminal":
              case "ResizeTerminal":
                return true;
              case "NotifyFileOpened":
                notifyFileCalls.push({
                  method: property,
                  path: args[0],
                  language: args[1],
                  content: args[2],
                });
                return true;
              case "NotifyFileChanged":
                notifyFileCalls.push({
                  method: property,
                  path: args[0],
                  language: args[1],
                  version: args[2],
                  content: args[3],
                });
                return true;
              case "NotifyFileClosed":
                notifyFileCalls.push({
                  method: property,
                  path: args[0],
                  language: args[1],
                });
                return true;
              case "AIApplyPatchArtifact":
                aiApplyPatchCalls.push(args[0]);
                return {
                  artifactId:
                    (args[0] as { artifactId?: string } | undefined)
                      ?.artifactId ?? "",
                  status: "applied",
                };
              case "WriteFile":
                writeFileCalls.push({ path: args[0], content: args[1] });
                if (
                  typeof args[0] === "string" &&
                  typeof args[1] === "string"
                ) {
                  fileContents[args[0]] = args[1];
                }
                return true;
              case "CreateDirectory":
                createDirectoryCalls.push(args[0]);
                if (typeof args[0] === "string") {
                  createdDirectories.push(args[0]);
                }
                return true;
              case "ReadDirectory":
                if (args[0] === "/workspace") {
                  const dynamicRootFiles = Object.keys(fileContents)
                    .filter((path) => {
                      if (!path.startsWith("/workspace/")) {
                        return false;
                      }
                      const relative = path.slice("/workspace/".length);
                      return relative.length > 0 && !relative.includes("/");
                    })
                    .filter(
                      (path) =>
                        ![
                          "/workspace/Makefile",
                          "/workspace/package.json",
                        ].includes(path),
                    )
                    .map((path) => ({
                      name: path.split("/").pop() || path,
                      path,
                      isDirectory: false,
                    }));
                  const dynamicRootDirs = createdDirectories
                    .filter((path) => {
                      if (!path.startsWith("/workspace/")) {
                        return false;
                      }
                      const relative = path.slice("/workspace/".length);
                      return relative.length > 0 && !relative.includes("/");
                    })
                    .map((path) => ({
                      name: path.split("/").pop() || path,
                      path,
                      isDirectory: true,
                    }));
                  return [
                    {
                      name: "Makefile",
                      path: "/workspace/Makefile",
                      isDirectory: false,
                    },
                    {
                      name: "package.json",
                      path: "/workspace/package.json",
                      isDirectory: false,
                    },
                    {
                      name: "src",
                      path: "/workspace/src",
                      isDirectory: true,
                    },
                    {
                      name: "node_modules",
                      path: "/workspace/node_modules",
                      isDirectory: true,
                    },
                    ...dynamicRootDirs,
                    ...dynamicRootFiles,
                    ...scrollFixtureFiles,
                  ];
                }
                if (args[0] === "/workspace/src") {
                  return [
                    {
                      name: "main.ts",
                      path: "/workspace/src/main.ts",
                      isDirectory: false,
                    },
                  ];
                }
                if (args[0] === "/workspace/node_modules") {
                  return [
                    {
                      name: "pkg",
                      path: "/workspace/node_modules/pkg",
                      isDirectory: true,
                    },
                  ];
                }
                if (args[0] === "/workspace/node_modules/pkg") {
                  return [
                    {
                      name: "index.js",
                      path: "/workspace/node_modules/pkg/index.js",
                      isDirectory: false,
                    },
                  ];
                }
                return [];
              case "ListFiles":
                return [
                  {
                    name: "Makefile",
                    path: "/workspace/Makefile",
                    isDirectory: false,
                  },
                  {
                    name: "package.json",
                    path: "/workspace/package.json",
                    isDirectory: false,
                  },
                  {
                    name: "main.ts",
                    path: "/workspace/src/main.ts",
                    isDirectory: false,
                  },
                ];
              case "InspectEditorFile": {
                const path = String(args[0] ?? "");
                const content = fileContents[path] ?? "";
                const lines = content.split("\n");
                return {
                  path,
                  name: path.split("/").pop() || path,
                  sizeBytes: content.length,
                  formattedSize: `${content.length} B`,
                  isText: true,
                  safeForEditor: true,
                  largeDocument: false,
                  reason: "safe for interactive editing",
                  lineCount: lines.length,
                  maxLineLength: Math.max(...lines.map((line) => line.length)),
                  limitBytes: 2 * 1024 * 1024,
                  lineLimit: 20_000,
                  maxLineLengthLimit: 20_000,
                };
              }
              case "ReadFile":
                return fileContents[String(args[0] ?? "")] ?? "";
              case "GetLanguageForFile":
                if (args[0] === "/workspace/package.json") {
                  return { id: "json" };
                }
                if (args[0] === "/workspace/src/main.ts") {
                  return { id: "typescript" };
                }
                return { id: "makefile" };
              case "GetGitStatus":
                return "";
              case "GetGitBranch":
                return "main";
              case "GetGitBranches":
                return ["main"];
              case "GetGitLog":
                return [];
              case "GetGitDiff":
              case "RunGitCommand":
                return "";
              default:
                return null;
            }
          };
        },
      },
    );

    const runtimeBridge = {
      EventsOnMultiple(
        eventName: string,
        callback: (...data: unknown[]) => void,
        maxCallbacks: number,
      ) {
        const entry = { callback, remaining: maxCallbacks };
        listeners.set(eventName, [...(listeners.get(eventName) ?? []), entry]);
        return () => removeListener(eventName, entry);
      },
      EventsOff(eventName: string) {
        listeners.delete(eventName);
      },
      EventsOffAll() {
        listeners.clear();
      },
      EventsEmit(eventName: string, ...data: unknown[]) {
        if (eventName === "mcp:ui-event:ack") {
          acks.push(data[0]);
        }

        const current = [...(listeners.get(eventName) ?? [])];
        current.forEach((entry) => {
          entry.callback(...data);
          if (entry.remaining > 0) {
            entry.remaining -= 1;
            if (entry.remaining === 0) {
              removeListener(eventName, entry);
            }
          }
        });
      },
      BrowserOpenURL: async () => undefined,
    };

    Object.assign(window, {
      __mcpAcks: acks,
      __mcpFileContents: fileContents,
      __writeFileCalls: writeFileCalls,
      __notifyFileCalls: notifyFileCalls,
      __aiApplyPatchCalls: aiApplyPatchCalls,
      __createDirectoryCalls: createDirectoryCalls,
      _wails: { environment: { OS: "darwin" } },
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
    });
  });
};

const mountProjectUI = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await installMCPFilePanelBridges(page);
  await page.goto("/");

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    const { useExplorerStore } = await import("/src/stores/explorerStore.ts");

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
  });

  await expect(page.getByTitle("Search")).toBeVisible();
};

const expectNoOverlap = async (
  page: Parameters<typeof test>[0]["page"],
  firstTestId: string,
  secondTestId: string,
): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ firstTestId, secondTestId }) => {
            const first = document
              .querySelector(`[data-testid="${firstTestId}"]`)
              ?.getBoundingClientRect();
            const second = document
              .querySelector(`[data-testid="${secondTestId}"]`)
              ?.getBoundingClientRect();
            if (!first || !second) {
              return null;
            }

            return !(
              first.right <= second.left ||
              second.right <= first.left ||
              first.bottom <= second.top ||
              second.bottom <= first.top
            );
          },
          { firstTestId, secondTestId },
        ),
      { timeout: 2400 },
    )
    .toBe(false);
};

const expectPanelFillsWorkspace = async (
  page: Parameters<typeof test>[0]["page"],
  panelTestId: string,
): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate((panelTestId) => {
          const workspace = document
            .querySelector('[data-testid="panel-workspace"]')
            ?.getBoundingClientRect();
          const panels = Array.from(
            document.querySelectorAll(`[data-testid="${panelTestId}"]`),
          );
          const panel = panels[panels.length - 1]?.getBoundingClientRect();
          if (!workspace || !panel) {
            return false;
          }

          return (
            Math.abs(panel.left - workspace.left) <= 6 &&
            Math.abs(panel.top - workspace.top) <= 6 &&
            Math.abs(panel.right - workspace.right) <= 6 &&
            Math.abs(panel.bottom - workspace.bottom) <= 6 &&
            panel.width >= workspace.width - 8 &&
            panel.height >= workspace.height - 8
          );
        }, panelTestId),
      { timeout: 2400 },
    )
    .toBe(true);
};

test("MCP panel open event loads a file into the side code panel and acks", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(
    ({ path, content }) => {
      window.runtime.EventsEmit("ide:panel:open", {
        panel: "code",
        path,
        content,
        line: 1,
        position: "right",
        mode: "snapped",
        mcpRequestId: "mcp-open-file-panel-test",
      });
    },
    { path: makefilePath, content: makefileContent },
  );

  await expect(page.getByText("Makefile (Code)")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("dev-start:");

  const ack = await page.evaluate(() => window.__mcpAcks.at(-1));
  expect(ack).toMatchObject({
    requestId: "mcp-open-file-panel-test",
    event: "ide:panel:open",
    handled: true,
  });
});

test("Code panel shows AI inline patch controls from global artifact events", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(
    ({ path, content }) => {
      window.runtime.EventsEmit("ide:panel:open", {
        panel: "code",
        path,
        content,
        line: 1,
        position: "right",
        mode: "snapped",
      });
    },
    { path: makefilePath, content: makefileContent },
  );

  await expect(page.getByText("Makefile (Code)")).toBeVisible();
  await page.evaluate(async (path) => {
    const { getCurrentProjectSessionId } =
      await import("/src/shell/projectSessionRoute.ts");
    window.runtime.EventsEmit("ai:chat:artifact-updated", {
      id: "code-panel-patch-apply",
      runId: "run-code-panel",
      sessionId: "default",
      projectSessionId: getCurrentProjectSessionId(),
      kind: "patch_preview",
      status: "ready",
      title: "Update Makefile",
      summary: "Update Makefile command",
      payloadJson: JSON.stringify({
        unifiedDiff: `diff --git a/Makefile b/Makefile\n--- a/Makefile\n+++ b/Makefile\n@@ -1,2 +1,3 @@\n dev-start:\n \tvite --host 127.0.0.1\n+\tgo test ./...\n`,
        checkReady: true,
        files: [{ path, status: "modify", exists: true }],
      }),
      createdAt: "2026-05-18T00:00:00Z",
      updatedAt: "2026-05-18T00:00:00Z",
    });
  }, makefilePath);

  await expect(page.getByTestId("ai-inline-patch-toolbar")).toBeVisible();
  await page.getByTestId("ai-inline-patch-apply").click();
  await expect
    .poll(async () => page.evaluate(() => window.__aiApplyPatchCalls))
    .toContainEqual({ artifactId: "code-panel-patch-apply" });

  await page.evaluate(async (path) => {
    const { getCurrentProjectSessionId } =
      await import("/src/shell/projectSessionRoute.ts");
    window.runtime.EventsEmit("ai:chat:artifact-updated", {
      id: "code-panel-patch-reject",
      runId: "run-code-panel",
      sessionId: "default",
      projectSessionId: getCurrentProjectSessionId(),
      kind: "patch_preview",
      status: "ready",
      title: "Reject Makefile",
      summary: "Reject Makefile command",
      payloadJson: JSON.stringify({
        unifiedDiff: `diff --git a/Makefile b/Makefile\n--- a/Makefile\n+++ b/Makefile\n@@ -1,2 +1,3 @@\n dev-start:\n \tvite --host 127.0.0.1\n+\tnpm test\n`,
        checkReady: true,
        files: [{ path, status: "modify", exists: true }],
      }),
      createdAt: "2026-05-18T00:00:00Z",
      updatedAt: "2026-05-18T00:00:01Z",
    });
  }, makefilePath);

  await expect(page.getByTestId("ai-inline-patch-toolbar")).toBeVisible();
  await page.getByTestId("ai-inline-patch-reject").click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useAIInlinePatchStore } =
          await import("/src/stores/aiInlinePatchStore.ts");
        return Object.keys(useAIInlinePatchStore.getState().previews);
      }),
    )
    .not.toContain("code-panel-patch-reject");

  await page.evaluate(async (path) => {
    const { getCurrentProjectSessionId } =
      await import("/src/shell/projectSessionRoute.ts");
    const projectSessionId = getCurrentProjectSessionId();
    window.runtime.EventsEmit("ai:chat:artifact-updated", {
      id: "code-panel-captured-direct-write",
      runId: "run-code-panel",
      sessionId: "default",
      projectSessionId,
      kind: "patch_preview",
      status: "applied",
      title: "Captured Makefile edit",
      summary: "Review captured direct write",
      payloadJson: JSON.stringify({
        unifiedDiff: `diff --git a/Makefile b/Makefile\n--- a/Makefile\n+++ b/Makefile\n@@ -1,2 +1,3 @@\n dev-start:\n \tvite --host 127.0.0.1\n+\tcaptured\n`,
        checkReady: false,
        alreadyApplied: true,
        source: "captured_direct_write",
        files: [{ path, status: "modify", exists: true }],
      }),
      createdAt: "2026-05-18T00:00:02Z",
      updatedAt: "2026-05-18T00:00:02Z",
    });
    window.runtime.EventsEmit("ai:patch:artifact-applied", {
      artifactId: "code-panel-captured-direct-write",
      projectSessionId,
      source: "captured_direct_write",
      files: [{ path }],
    });
  }, makefilePath);

  await expect(page.getByTestId("ai-inline-patch-toolbar")).toBeVisible();
  await expect(page.getByTestId("ai-inline-patch-reject")).toContainText(
    "Rollback",
  );
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useAIInlinePatchStore } =
          await import("/src/stores/aiInlinePatchStore.ts");
        return Object.keys(useAIInlinePatchStore.getState().previews);
      }),
    )
    .toContain("code-panel-captured-direct-write");
});

test("Code panel blocks case-alias AI patch when the file is dirty", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(
    ({ path, content }) => {
      window.runtime.EventsEmit("ide:panel:open", {
        panel: "code",
        path,
        content,
        line: 1,
        position: "right",
        mode: "snapped",
      });
    },
    { path: makefilePath, content: makefileContent },
  );

  await expect(page.getByText("Makefile (Code)")).toBeVisible();
  await page.evaluate(async (path) => {
    const { makeEditorTabId, useEditorStore } =
      await import("/src/stores/editorStore.ts");
    const { getCurrentProjectSessionId } =
      await import("/src/shell/projectSessionRoute.ts");
    useEditorStore.getState().markTabDirty(makeEditorTabId(path), true);
    window.runtime.EventsEmit("ai:chat:artifact-updated", {
      id: "code-panel-case-dirty",
      runId: "run-code-panel-case",
      sessionId: "default",
      projectSessionId: getCurrentProjectSessionId(),
      kind: "patch_preview",
      status: "ready",
      title: "Update Makefile",
      summary: "Update Makefile command",
      payloadJson: JSON.stringify({
        unifiedDiff: `diff --git a/makefile b/makefile\n--- a/makefile\n+++ b/makefile\n@@ -1,2 +1,3 @@\n dev-start:\n \tvite --host 127.0.0.1\n+\tgo test ./...\n`,
        checkReady: true,
        files: [
          { path: "/workspace/makefile", status: "modify", exists: true },
        ],
      }),
      createdAt: "2026-05-18T00:00:00Z",
      updatedAt: "2026-05-18T00:00:00Z",
    });
  }, makefilePath);

  await expect(page.getByTestId("ai-inline-patch-toolbar")).toBeVisible();
  await page.getByTestId("ai-inline-patch-apply").click();
  await expect(page.getByText("Save editor changes first")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => window.__aiApplyPatchCalls.length))
    .toBe(0);
});

test("TUI mode lays out side file panels beside the terminal center", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();
    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal(
      "pane-1",
      "blackprint",
      "Codex",
    );
    terminalStore.enterTUIMode(terminalId, "playwright");
    window.runtime.EventsEmit("ide:tui:enter");
  });

  await expect(page.getByTestId("tui-center-terminal")).toBeVisible();

  await page.evaluate(
    ({ path, content }) => {
      window.runtime.EventsEmit("ide:panel:open", {
        panel: "code",
        path,
        content,
        line: 1,
        position: "right",
        mode: "snapped",
        mcpRequestId: "mcp-tui-open-file-panel-test",
      });
    },
    { path: makefilePath, content: makefileContent },
  );

  const codePanel = page.getByTestId("panel-code").last();
  await expect(codePanel).toBeVisible();
  await expect(codePanel.locator(".cm-content")).toContainText("dev-start:");

  await expectNoOverlap(page, "tui-center-terminal", "panel-code");

  const ack = await page.evaluate(() => window.__mcpAcks.at(-1));
  expect(ack).toMatchObject({
    requestId: "mcp-tui-open-file-panel-test",
    event: "ide:panel:open",
    handled: true,
  });
});

test("TUI assist panel open survives enter/open event bursts", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    window.runtime.EventsEmit("ide:tui:enter");
    window.runtime.EventsEmit("ide:tui:assist:open", {
      panel: "explorer",
      position: "left",
      mode: "snapped",
      mcpRequestId: "mcp-tui-assist-open-race-test",
    });
  });

  await expect(page.getByTestId("tui-center-terminal")).toBeVisible();
  const explorerPanel = page.getByTestId("panel-explorer").last();
  await expect(explorerPanel).toBeVisible();
  await expect(
    explorerPanel.locator('[data-file-path="/workspace/Makefile"]'),
  ).toBeVisible();

  const ack = await page.evaluate(() => window.__mcpAcks.at(-1));
  expect(ack).toMatchObject({
    requestId: "mcp-tui-assist-open-race-test",
    event: "ide:tui:assist:open",
    handled: true,
  });
});

test("TUI code panel refreshes when an open file changes externally", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();
    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal(
      "pane-1",
      "blackprint",
      "Codex",
    );
    terminalStore.enterTUIMode(terminalId, "playwright");
    window.runtime.EventsEmit("ide:tui:enter");
  });

  await page.evaluate(
    ({ path, content }) => {
      window.runtime.EventsEmit("ide:panel:open", {
        panel: "code",
        path,
        content,
        line: 1,
        position: "right",
        mode: "snapped",
      });
    },
    { path: makefilePath, content: makefileContent },
  );

  const codePanel = page.getByTestId("panel-code").last();
  await expect(codePanel).toBeVisible();
  await expect(codePanel.locator(".cm-content")).toContainText("dev-start:");

  await page.evaluate((path) => {
    window.__mcpFileContents[path] = "dev-start:\n\tgo test ./...\n";
    window.runtime.EventsEmit("file:changed", path.toLowerCase());
  }, makefilePath);

  await expect(codePanel.locator(".cm-content")).toContainText("go test ./...");
  await expect
    .poll(async () => page.evaluate(() => window.__notifyFileCalls))
    .toContainEqual(
      expect.objectContaining({
        content: "dev-start:\n\tgo test ./...\n",
        method: "NotifyFileChanged",
        path: makefilePath,
      }),
    );

  await page.evaluate(async (path) => {
    const { getCurrentProjectSessionId } =
      await import("/src/shell/projectSessionRoute.ts");
    window.__mcpFileContents[path] = "dev-start:\n\tnpm run build\n";
    window.runtime.EventsEmit("ai:patch:artifact-rolled-back", {
      artifactId: "patch-refresh",
      projectSessionId: getCurrentProjectSessionId(),
      files: [{ path: path.toLowerCase() }],
    });
  }, makefilePath);

  await expect(codePanel.locator(".cm-content")).toContainText("npm run build");
});

test("background created-entry events refresh Explorer without opening editor tabs", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(
    async ({ path, content }) => {
      const { useEditorStore } = await import("/src/stores/editorStore.ts");
      useEditorStore
        .getState()
        .openTab("pane-main", path, "package.json", content, "json");
    },
    { path: packageJsonPath, content: packageJsonContent },
  );

  await page.evaluate(() => {
    window.runtime.EventsEmit("project:entry:created", {
      path: "/workspace/src/generated.ts",
      isDirectory: false,
    });
  });

  await expect(page.getByText("Opening file")).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useEditorStore } = await import("/src/stores/editorStore.ts");
        return {
          activePath:
            useEditorStore.getState().getActiveTab("pane-main")?.path ?? null,
          paths: Array.from(useEditorStore.getState().tabs.values()).map(
            (tab) => tab.path,
          ),
        };
      }),
    )
    .toEqual({
      activePath: packageJsonPath,
      paths: [packageJsonPath],
    });
});

test("background dependency created-entry events do not expand skipped folders", async ({
  page,
}) => {
  await mountProjectUI(page);
  await page.evaluate(() => {
    window.runtime.EventsEmit("ide:panel:open", {
      panel: "explorer",
      position: "left",
      mode: "snapped",
    });
  });

  await expect(
    page.locator('[data-file-path="/workspace/node_modules/pkg"]'),
  ).toHaveCount(0);

  await page.evaluate(() => {
    window.runtime.EventsEmit("project:entry:created", {
      path: "/workspace/node_modules/pkg/index.js",
      isDirectory: false,
    });
  });

  await expect(
    page.locator('[data-file-path="/workspace/node_modules/pkg"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-file-path="/workspace/node_modules/pkg/index.js"]'),
  ).toHaveCount(0);
  await expect(page.getByText("Opening file")).toHaveCount(0);
});

test("TUI explorer file clicks open code panel tabs and keeps New File working", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();
    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal(
      "pane-1",
      "blackprint",
      "Codex",
    );
    terminalStore.enterTUIMode(terminalId, "playwright");
    window.runtime.EventsEmit("ide:tui:enter");
  });
  await expect(page.getByTestId("tui-center-terminal")).toBeVisible();

  await page.evaluate(() => {
    window.runtime.EventsEmit("ide:panel:open", {
      panel: "explorer",
      position: "left",
      mode: "snapped",
    });
  });

  const explorerPanel = page.getByTestId("panel-explorer").last();
  await expect(explorerPanel).toBeVisible();
  await expect(
    explorerPanel.locator('[data-file-path="/workspace/Makefile"]'),
  ).toBeVisible();
  await expect(
    explorerPanel.locator('[data-file-path="/workspace/package.json"]'),
  ).toBeVisible();

  await explorerPanel.locator('[data-file-path="/workspace/Makefile"]').click();

  const codePanel = page.getByTestId("panel-code").last();
  await expect(codePanel).toBeVisible();
  await expect(codePanel.locator(".cm-content")).toContainText("dev-start:");
  await expect(page.getByTestId("code-panel-tabs")).toBeVisible();
  await expect(
    page.getByTestId("code-panel-tab-workspace-Makefile"),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { usePreviewWindowStore } =
          await import("/src/stores/previewWindowStore.ts");
        return usePreviewWindowStore.getState().windows.length;
      }),
    )
    .toBe(0);

  await page
    .getByTestId("code-panel-tab-workspace-Makefile")
    .evaluate((element) => {
      const tabRect = element.getBoundingClientRect();
      const panelRect = document
        .querySelector('[data-testid="panel-code"]')
        ?.getBoundingClientRect();
      const startX = tabRect.left + tabRect.width / 2;
      const startY = tabRect.top + tabRect.height / 2;
      const dropX = Math.max(
        260,
        Math.min(window.innerWidth - 260, (panelRect?.left ?? startX) - 120),
      );
      const dropY = Math.max(
        220,
        Math.min(
          window.innerHeight - 220,
          panelRect ? panelRect.top + panelRect.height / 2 : startY,
        ),
      );
      const pointerId = 11;

      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: startX,
          clientY: startY,
          pointerId,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: dropX,
          clientY: dropY,
          pointerId,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          clientX: dropX,
          clientY: dropY,
          pointerId,
        }),
      );
    });

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { usePreviewWindowStore } =
          await import("/src/stores/previewWindowStore.ts");
        return usePreviewWindowStore.getState().windows.length;
      }),
    )
    .toBe(0);
  await expect(codePanel).toBeVisible();
  await expect(codePanel.locator(".cm-content")).toContainText("dev-start:");

  await page
    .getByTestId("code-panel-tab-workspace-Makefile")
    .evaluate((element) => {
      const tabRect = element.getBoundingClientRect();
      const startX = tabRect.left + tabRect.width / 2;
      const startY = tabRect.top + tabRect.height / 2;
      const pointerId = 12;

      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: startX,
          clientY: startY,
          pointerId,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: window.innerWidth / 2,
          clientY: 24,
          pointerId,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          clientX: window.innerWidth / 2,
          clientY: 24,
          pointerId,
        }),
      );
    });

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { usePreviewWindowStore } =
          await import("/src/stores/previewWindowStore.ts");
        return usePreviewWindowStore.getState().windows.length;
      }),
    )
    .toBe(0);
  await expect(codePanel).toBeVisible();
  await expect(codePanel.locator(".cm-content")).toContainText("dev-start:");
  await expectNoOverlap(page, "tui-center-terminal", "panel-code");

  await explorerPanel
    .locator('[data-file-path="/workspace/package.json"]')
    .click();
  await expect(codePanel.locator(".cm-content")).toContainText(
    '"name": "workspace"',
  );
  await expect(page.getByTestId("code-panel-tabs")).toBeVisible();
  await expect(
    page.getByTestId("code-panel-tab-workspace-Makefile"),
  ).toBeVisible();
  await expect(
    page.getByTestId("code-panel-tab-workspace-package-json"),
  ).toBeVisible();

  await page.getByTestId("code-panel-tab-workspace-Makefile").click();
  await expect(codePanel.locator(".cm-content")).toContainText("dev-start:");

  await page.keyboard.press("Control+Tab");
  await expect(codePanel.locator(".cm-content")).toContainText(
    '"name": "workspace"',
  );

  await explorerPanel
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "New File" }).click();
  await expect(page.locator('input[placeholder="notes.txt"]')).toBeVisible();
  await page.locator('input[placeholder="notes.txt"]').fill("created.txt");
  await page.getByRole("button", { name: "Create File" }).click();

  const writeCalls = await page.evaluate(() => window.__writeFileCalls);
  expect(writeCalls).toContainEqual({
    path: "/workspace/created.txt",
    content: "",
  });
  await expect(
    page.getByTestId("code-panel-tab-workspace-created-txt"),
  ).toBeVisible();
  await expect(
    explorerPanel.locator('[data-file-path="/workspace/created.txt"]'),
  ).toBeVisible();

  await explorerPanel
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "New Folder" }).click();
  await expect(page.locator('input[placeholder="new-folder"]')).toBeVisible();
  await page.locator('input[placeholder="new-folder"]').fill("generated");
  await page.getByRole("button", { name: "Create Folder" }).click();

  await expect
    .poll(async () => page.evaluate(() => window.__createDirectoryCalls))
    .toContain("/workspace/generated");
  await expect(
    explorerPanel.locator('[data-file-path="/workspace/generated"]'),
  ).toBeVisible();
  await expect(
    page.getByTestId("code-panel-tab-workspace-generated"),
  ).toHaveCount(0);
});

test("code panel tab drops back into Explorer without creating another panel", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();
    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal(
      "pane-1",
      "blackprint",
      "Codex",
    );
    terminalStore.enterTUIMode(terminalId, "playwright");
    window.runtime.EventsEmit("ide:tui:enter");
  });

  await page.evaluate(() => {
    window.runtime.EventsEmit("ide:panel:open", {
      panel: "explorer",
      position: "left",
      mode: "snapped",
    });
  });

  const explorerPanel = page.getByTestId("panel-explorer").last();
  await expect(explorerPanel).toBeVisible();
  const makefileNode = explorerPanel.locator(
    '[data-file-path="/workspace/Makefile"]',
  );
  await makefileNode.click();
  await expect(makefileNode).toHaveClass(/file-explorer-node-highlighted/);

  const codePanel = page.getByTestId("panel-code").last();
  await expect(codePanel).toBeVisible();
  await expect(
    page.getByTestId("code-panel-tab-workspace-Makefile"),
  ).toBeVisible();

  await page
    .getByTestId("code-panel-tab-workspace-Makefile")
    .evaluate((element) => {
      const tabRect = element.getBoundingClientRect();
      const explorerRect = document
        .querySelector('[data-testid="file-explorer-scroll-region"]')
        ?.getBoundingClientRect();
      if (!explorerRect) {
        throw new Error("Explorer drop target is missing");
      }

      const startX = tabRect.left + tabRect.width / 2;
      const startY = tabRect.top + tabRect.height / 2;
      const dropX = explorerRect.left + explorerRect.width / 2;
      const dropY = explorerRect.top + explorerRect.height / 2;
      const pointerId = 13;

      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: startX,
          clientY: startY,
          pointerId,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: dropX,
          clientY: dropY,
          pointerId,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          clientX: dropX,
          clientY: dropY,
          pointerId,
        }),
      );
    });

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { usePreviewWindowStore } =
          await import("/src/stores/previewWindowStore.ts");
        return usePreviewWindowStore.getState().windows.length;
      }),
    )
    .toBe(0);
  await expect(makefileNode).toHaveClass(/file-explorer-node-highlighted/);
  await expect(page.getByTestId("panel-code")).toHaveCount(0);
});

test("Explorer create menu closes on Escape and stays visible while scrolled", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(() => {
    window.runtime.EventsEmit("ide:panel:open", {
      panel: "explorer",
      position: "left",
      mode: "snapped",
    });
  });

  const explorerPanel = page.getByTestId("panel-explorer").last();
  await expect(explorerPanel).toBeVisible();
  await expect(
    explorerPanel.locator('[data-file-path="/workspace/Makefile"]'),
  ).toBeVisible();
  await expect
    .poll(async () => explorerPanel.getAttribute("data-panel-motion"))
    .toBe("settled");

  const createButton = explorerPanel.getByTestId("file-explorer-create-button");
  await createButton.click({ force: true });
  await expect(page.getByRole("menuitem", { name: "New File" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("menuitem", { name: "New File" })).toHaveCount(0);

  const scrollRegion = explorerPanel.getByTestId("file-explorer-scroll-region");
  await scrollRegion.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });

  const metrics = await page.evaluate(() => {
    const panel = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="panel-explorer"]'),
    ).at(-1);
    const button = panel?.querySelector<HTMLButtonElement>(
      'button[title="Create"]',
    );
    const scrollRegion = panel?.querySelector<HTMLElement>(
      '[data-testid="file-explorer-scroll-region"]',
    );

    if (!panel || !button || !scrollRegion) {
      return null;
    }

    const panelRect = panel.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();

    return {
      buttonBottom: buttonRect.bottom,
      buttonTop: buttonRect.top,
      panelBottom: panelRect.bottom,
      panelTop: panelRect.top,
      scrollRegionTop: scrollRegion.getBoundingClientRect().top,
      scrollTop: scrollRegion.scrollTop,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics?.scrollTop ?? 0).toBeGreaterThan(100);
  expect(metrics?.buttonTop ?? -Infinity).toBeGreaterThanOrEqual(
    metrics?.panelTop ?? Infinity,
  );
  expect(metrics?.buttonBottom ?? Infinity).toBeLessThanOrEqual(
    metrics?.panelBottom ?? -Infinity,
  );
  expect(metrics?.scrollRegionTop ?? -Infinity).toBeGreaterThanOrEqual(
    (metrics?.buttonBottom ?? Infinity) - 1,
  );
});

test("TUI Git and Problems fullscreen panels fill the panel workspace", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();
    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal(
      "pane-1",
      "blackprint",
      "Codex",
    );
    terminalStore.enterTUIMode(terminalId, "playwright");
  });

  await page.evaluate(() => {
    window.runtime.EventsEmit("ide:panel:open", {
      panel: "git",
      position: "left",
      mode: "snapped",
    });
  });

  const gitPanel = page.getByTestId("panel-git").last();
  await expect(gitPanel).toBeVisible();
  await gitPanel.locator('button[title="Полный экран"]').click();
  await expectPanelFillsWorkspace(page, "panel-git");

  await gitPanel.locator('button[title="Полный экран"]').click();
  await page.evaluate(() => {
    window.runtime.EventsEmit("ide:panel:open", {
      panel: "problems",
      position: "bottom",
      mode: "snapped",
    });
  });

  const problemsPanel = page.getByTestId("panel-problems").last();
  await expect(problemsPanel).toBeVisible();
  await problemsPanel.locator('button[title="Полный экран"]').click();
  await expectPanelFillsWorkspace(page, "panel-problems");
});
