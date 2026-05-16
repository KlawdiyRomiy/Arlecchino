import { expect, test } from "@playwright/test";

const installBaseBridges = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.clear();

    const eventHandlers = new Map<string, Array<(payload: unknown) => void>>();

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (..._args: unknown[]) => {
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
              case "ListFiles":
                return [];
              case "GetGitStatus":
                return "";
              case "GetGitBranch":
                return "main";
              case "GetGitBranches":
                return ["main"];
              case "GetGitLog":
              case "GetGitDiff":
              case "GetGitCommitDiff":
              case "RunGitCommand":
                return "";
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
              const handlers = eventHandlers.get(eventName) ?? [];
              handlers.push(callback);
              eventHandlers.set(eventName, handlers);
              return () => undefined;
            };
          }
          if (property === "EventsOff") {
            return () => undefined;
          }
          if (property === "BrowserOpenURL") {
            return async () => undefined;
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
};

const mountProjectUI = async (
  page: Parameters<typeof test>[0]["page"],
): Promise<void> => {
  await installBaseBridges(page);
  await page.goto("/");

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
    const { useEditorStore } = await import("/src/stores/editorStore.ts");
    const { usePreviewWindowStore } =
      await import("/src/stores/previewWindowStore.ts");

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
        "/workspace/index.html",
        "index.html",
        "<html><body>Zoom preview</body></html>",
        "html",
      );

    usePreviewWindowStore.getState().openWindow({
      id: "zoom-browser",
      surface: "browser",
      title: "Browser Preview",
      payload: {
        htmlContent: "<html><body>Zoom preview</body></html>",
        sourceLabel: "index.html",
      },
      width: 420,
      height: 320,
    });
    usePreviewWindowStore.getState().openWindow({
      id: "zoom-git",
      surface: "git",
      title: "Git Preview",
      width: 420,
      height: 320,
      x: 120,
      y: 120,
    });
  });

  await expect(page.getByTitle("Search")).toBeVisible();
};

const dispatchShortcut = async (
  page: Parameters<typeof test>[0]["page"],
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

test("legacy coupled zoom state resets editor font size during migration", async ({
  page,
}) => {
  await installBaseBridges(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "editor-settings",
      JSON.stringify({
        state: {
          uiScale: 1.1,
          editorFontSize: 16,
        },
        version: 0,
      }),
    );
  });

  await page.goto("/");

  const state = await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    const current = useEditorSettingsStore.getState();

    return {
      uiScale: current.uiScale,
      editorFontSize: current.editorFontSize,
    };
  });

  expect(state.uiScale).toBe(1.1);
  expect(state.editorFontSize).toBe(14);
});

test("custom editor font size survives zoom migration", async ({ page }) => {
  await installBaseBridges(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "editor-settings",
      JSON.stringify({
        state: {
          uiScale: 1.1,
          editorFontSize: 18,
        },
        version: 0,
      }),
    );
  });

  await page.goto("/");

  const state = await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    const current = useEditorSettingsStore.getState();

    return {
      uiScale: current.uiScale,
      editorFontSize: current.editorFontSize,
    };
  });

  expect(state.uiScale).toBe(1.1);
  expect(state.editorFontSize).toBe(18);
});

test("custom editor font family survives settings hydration", async ({
  page,
}) => {
  await installBaseBridges(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "editor-settings",
      JSON.stringify({
        state: {
          editorFontFamily: "  Menlo,   Monaco, monospace  ",
        },
        version: 1,
      }),
    );
  });

  await page.goto("/");

  const state = await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    const current = useEditorSettingsStore.getState();

    return {
      editorFontFamily: current.editorFontFamily,
    };
  });

  expect(state.editorFontFamily).toBe("Menlo, Monaco, monospace");
});

test("settings editor tab persists dropdown font family", async ({ page }) => {
  await mountProjectUI(page);

  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: /^Editor$/ }).click();

  const fontFamilyTrigger = page.getByTestId("editor-font-family-trigger");
  await expect(fontFamilyTrigger).toBeVisible();
  await fontFamilyTrigger.click();

  const fontFamilyContent = page.getByTestId("editor-font-family-content");
  await expect(fontFamilyContent).toBeVisible();
  await fontFamilyContent.getByRole("menuitem", { name: "Menlo" }).click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rawSettings = localStorage.getItem("editor-settings");
        if (!rawSettings) return null;
        return JSON.parse(rawSettings).state.editorFontFamily;
      }),
    )
    .toBe("Menlo, Monaco, monospace");
});

test("settings appearance tab persists system font family", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTitle("Settings").click();

  const fontFamilyTrigger = page.getByTestId("ui-font-family-trigger");
  await expect(fontFamilyTrigger).toBeVisible();
  await fontFamilyTrigger.click();

  const fontFamilyContent = page.getByTestId("ui-font-family-content");
  await expect(fontFamilyContent).toBeVisible();
  await fontFamilyContent
    .getByRole("menuitem", { name: "Avenir Next" })
    .first()
    .click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rawSettings = localStorage.getItem("editor-settings");
        if (!rawSettings) return null;
        return {
          stored: JSON.parse(rawSettings).state.uiFontFamily,
          applied: getComputedStyle(document.documentElement)
            .getPropertyValue("--ui-font-family")
            .trim(),
        };
      }),
    )
    .toEqual({
      stored: '"Avenir Next", Avenir, sans-serif',
      applied: '"Avenir Next", Avenir, sans-serif',
    });
});

test("settings appearance tab persists system font size without changing editor typography", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTitle("Settings").click();

  const topbarSearchIcon = page.getByTitle("Search").locator("svg").first();
  const beforeTopbarIconWidth = await topbarSearchIcon.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "ui-font-scale-fixture-style";
    style.textContent = "#ui-font-scale-css { font-size: 12px; }";
    document.head.appendChild(style);

    const fixture = document.createElement("div");
    fixture.id = "ui-font-scale-fixture";
    fixture.innerHTML = `
      <div id="ui-font-scale-css">Fixed CSS text</div>
      <div id="ui-font-scale-inline" style="font-size: 13px">Fixed inline text</div>
      <button id="ui-font-scale-icon-only" type="button" aria-label="Icon only">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6"></circle>
        </svg>
      </button>
    `;
    document.getElementById("root")?.appendChild(fixture);
  });

  const fontSizeInput = page.getByTestId("ui-font-size-input");
  await expect(fontSizeInput).toBeVisible();

  const systemSizeTitle = page
    .locator('[data-setting-id="system-font-size"] .text-sm')
    .first();
  const beforeTitleFontSize = await systemSizeTitle.evaluate(
    (element) => getComputedStyle(element).fontSize,
  );

  await fontSizeInput.evaluate((element) => {
    const input = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, "18");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rawSettings = localStorage.getItem("editor-settings");
        if (!rawSettings) return null;
        const state = JSON.parse(rawSettings).state;
        return {
          stored: state.uiFontSize,
          applied: getComputedStyle(document.documentElement)
            .getPropertyValue("--ui-font-size")
            .trim(),
          scale: getComputedStyle(document.documentElement)
            .getPropertyValue("--ui-font-scale")
            .trim(),
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
          editorFontSize: state.editorFontSize,
        };
      }),
    )
    .toEqual({
      stored: 18,
      applied: "18px",
      scale: "1.286",
      rootFontSize: "14px",
      editorFontSize: 14,
    });

  await expect
    .poll(async () =>
      systemSizeTitle.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    )
    .toBeGreaterThan(parseFloat(beforeTitleFontSize));
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const cssText = document.getElementById("ui-font-scale-css");
        return cssText
          ? Number.parseFloat(getComputedStyle(cssText).fontSize)
          : 0;
      }),
    )
    .toBeCloseTo(15.43, 1);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const inlineText = document.getElementById("ui-font-scale-inline");
        return inlineText
          ? Number.parseFloat(getComputedStyle(inlineText).fontSize)
          : 0;
      }),
    )
    .toBeCloseTo(16.71, 1);
  await expect
    .poll(async () =>
      topbarSearchIcon.evaluate(
        (element) => element.getBoundingClientRect().width,
      ),
    )
    .toBe(beforeTopbarIconWidth);

  await page.evaluate(() => {
    const lateText = document.createElement("div");
    lateText.id = "ui-font-scale-late";
    lateText.style.fontSize = "10px";
    lateText.textContent = "Late fixed inline text";
    document.getElementById("root")?.appendChild(lateText);
  });
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const lateText = document.getElementById("ui-font-scale-late");
        return lateText
          ? Number.parseFloat(getComputedStyle(lateText).fontSize)
          : 0;
      }),
    )
    .toBeCloseTo(12.86, 1);

  const editorFontSize = await page.evaluate(async () => {
    const { EditorState } =
      await import("/node_modules/.vite/deps/@codemirror_state.js");
    const { EditorView } =
      await import("/node_modules/.vite/deps/@codemirror_view.js");
    const { codeEditorStyles } = await import("/src/utils/codeMirrorTheme.ts");

    const parent = document.createElement("div");
    parent.style.setProperty("--editor-font-size", "14px");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "const value = 1;",
        extensions: [codeEditorStyles],
      }),
    });
    const fontSize = window.getComputedStyle(view.dom).fontSize;
    view.destroy();
    parent.remove();
    return fontSize;
  });

  expect(editorFontSize).toBe("14px");
});

test("editor typography variables update CodeMirror without changing UI zoom", async ({
  page,
}) => {
  await installBaseBridges(page);
  await page.goto("/");

  const typography = await page.evaluate(async () => {
    const { EditorState } =
      await import("/node_modules/.vite/deps/@codemirror_state.js");
    const { EditorView } =
      await import("/node_modules/.vite/deps/@codemirror_view.js");
    const { codeEditorStyles } = await import("/src/utils/codeMirrorTheme.ts");

    const parent = document.createElement("div");
    parent.style.setProperty(
      "--editor-font-family",
      "Menlo, Monaco, monospace",
    );
    parent.style.setProperty("--editor-font-size", "19px");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "const value = 1;",
        extensions: [codeEditorStyles],
      }),
    });
    const line = view.dom.querySelector<HTMLElement>(".cm-line");
    const result = {
      fontSize: window.getComputedStyle(view.dom).fontSize,
      lineFontFamily: window.getComputedStyle(line ?? view.dom).fontFamily,
      uiScale: window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-scale")
        .trim(),
    };
    view.destroy();
    parent.remove();
    return result;
  });

  expect(typography.fontSize).toBe("19px");
  expect(typography.lineFontFamily).toContain("Menlo");
  expect(typography.uiScale).toBe("1");
});

test("keyboard zoom shortcuts update the global UI zoom state", async ({
  page,
}) => {
  await mountProjectUI(page);

  await expect
    .poll(async () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--ui-scale")
          .trim(),
      ),
    )
    .toBe("1");

  await dispatchShortcut(page, {
    key: "=",
    code: "Equal",
    metaKey: true,
  });

  await expect
    .poll(async () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--ui-scale")
          .trim(),
      ),
    )
    .toBe("1.05");

  await dispatchShortcut(page, {
    key: "-",
    code: "Minus",
    metaKey: true,
  });

  await expect
    .poll(async () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--ui-scale")
          .trim(),
      ),
    )
    .toBe("1");

  await dispatchShortcut(page, {
    key: "=",
    code: "Equal",
    metaKey: true,
  });

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useEditorSettingsStore } =
          await import("/src/stores/editorSettingsStore.ts");
        return useEditorSettingsStore.getState().uiScale;
      }),
    )
    .toBe(1.05);

  await dispatchShortcut(page, {
    key: "0",
    code: "Digit0",
    metaKey: true,
  });

  await expect
    .poll(async () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--ui-scale")
          .trim(),
      ),
    )
    .toBe("1");
});

test("fullscreen problems panel tracks ui scale changes without clipping or shrinking", async ({
  page,
}) => {
  await mountProjectUI(page);

  await page.getByTestId("diagnostics-compact-indicator").click();

  const problemsPanel = page.getByTestId("panel-problems");
  await expect(problemsPanel).toBeVisible();
  await problemsPanel.getByTitle("Полный экран").click();

  const readPanelGeometry = () =>
    page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(
        '[data-testid="panel-problems"]',
      );
      const rect = panel?.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      };
    });

  await expect
    .poll(async () => {
      const geometry = await readPanelGeometry();
      return Math.abs(geometry.width - geometry.viewportWidth);
    })
    .toBeLessThanOrEqual(2);

  await expect
    .poll(async () => {
      const geometry = await readPanelGeometry();
      return Math.abs(geometry.height - geometry.viewportHeight);
    })
    .toBeLessThanOrEqual(2);

  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(0.7);
  });

  await expect
    .poll(async () => {
      const geometry = await readPanelGeometry();
      return Math.abs(geometry.width - geometry.viewportWidth);
    })
    .toBeLessThanOrEqual(2);

  await expect
    .poll(async () => {
      const geometry = await readPanelGeometry();
      return Math.abs(geometry.height - geometry.viewportHeight);
    })
    .toBeLessThanOrEqual(2);

  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(1.25);
  });

  await expect
    .poll(async () => {
      const geometry = await readPanelGeometry();
      return Math.abs(geometry.width - geometry.viewportWidth);
    })
    .toBeLessThanOrEqual(2);

  await expect
    .poll(async () => {
      const geometry = await readPanelGeometry();
      return Math.abs(geometry.height - geometry.viewportHeight);
    })
    .toBeLessThanOrEqual(2);
});

test("app shell clips the interface to a rounded outer viewport", async ({
  page,
}) => {
  await mountProjectUI(page);

  const styles = await page.evaluate(() => {
    const appShell = document.querySelector<HTMLElement>(
      '[data-testid="app-shell"]',
    );
    const blackprintBackground =
      document.querySelector<HTMLElement>(".blackprint-bg");

    return {
      shellRadius: appShell
        ? getComputedStyle(appShell).borderTopLeftRadius
        : "",
      shellOverflow: appShell ? getComputedStyle(appShell).overflow : "",
      shellClipPath: appShell ? getComputedStyle(appShell).clipPath : "",
      shellBackground: appShell
        ? getComputedStyle(appShell).backgroundColor
        : "",
      backgroundPosition: blackprintBackground
        ? getComputedStyle(blackprintBackground).position
        : "",
    };
  });

  expect(styles.shellRadius).toBe("18px");
  expect(styles.shellOverflow).toBe("hidden");
  expect(styles.shellClipPath).toContain("round");
  expect(styles.shellBackground).toBe("rgba(0, 0, 0, 0)");
  expect(styles.backgroundPosition).toBe("absolute");
});

test("global UI zoom scales the interface uniformly without transform-based root shifting or double-scaling browser and git surfaces", async ({
  page,
}) => {
  await mountProjectUI(page);

  const appShell = page.getByTestId("app-shell");
  const browserRoot = page.getByTestId("browser-preview-root");
  const gitRoot = page.getByTestId("git-panel-root");
  const browserInput = page.getByPlaceholder("http://localhost:8000");

  await expect(appShell).toBeVisible();
  await expect(browserRoot).toBeVisible();
  await expect(gitRoot).toBeVisible();

  const beforeScale = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(
      '[data-testid="app-shell"]',
    );
    const scaledSurface = document.querySelector<HTMLElement>(
      '[data-testid="app-scaled-surface"]',
    );
    const mainLayout = document.querySelector<HTMLElement>(
      '[data-testid="main-layout"]',
    );
    const search = document.querySelector<HTMLElement>('[title="Search"]');
    const browserInputElement = document.querySelector<HTMLInputElement>(
      'input[placeholder="http://localhost:8000"]',
    );
    const shellRect = shell?.getBoundingClientRect();
    const surfaceRect = scaledSurface?.getBoundingClientRect();
    const mainLayoutRect = mainLayout?.getBoundingClientRect();

    return {
      shellTransform: shell ? getComputedStyle(shell).transform : "",
      surfaceTransform: scaledSurface
        ? getComputedStyle(scaledSurface).transform
        : "",
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      shellWidth: shellRect?.width ?? 0,
      shellHeight: shellRect?.height ?? 0,
      shellLeft: shellRect?.left ?? 0,
      shellTop: shellRect?.top ?? 0,
      surfaceWidth: surfaceRect?.width ?? 0,
      surfaceHeight: surfaceRect?.height ?? 0,
      surfaceLeft: surfaceRect?.left ?? 0,
      surfaceTop: surfaceRect?.top ?? 0,
      mainLayoutWidth: mainLayoutRect?.width ?? 0,
      mainLayoutHeight: mainLayoutRect?.height ?? 0,
      mainLayoutLeft: mainLayoutRect?.left ?? 0,
      mainLayoutTop: mainLayoutRect?.top ?? 0,
      searchHeight: search?.getBoundingClientRect().height ?? 0,
      browserInputHeight:
        browserInputElement?.getBoundingClientRect().height ?? 0,
    };
  });

  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(1.25);
  });

  await expect
    .poll(async () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--ui-scale")
          .trim(),
      ),
    )
    .toBe("1.25");

  const afterScale = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(
      '[data-testid="app-shell"]',
    );
    const scaledSurface = document.querySelector<HTMLElement>(
      '[data-testid="app-scaled-surface"]',
    );
    const mainLayout = document.querySelector<HTMLElement>(
      '[data-testid="main-layout"]',
    );
    const search = document.querySelector<HTMLElement>('[title="Search"]');
    const browserInputElement = document.querySelector<HTMLInputElement>(
      'input[placeholder="http://localhost:8000"]',
    );
    const browser = document.querySelector<HTMLElement>(
      '[data-testid="browser-preview-root"]',
    );
    const git = document.querySelector<HTMLElement>(
      '[data-testid="git-panel-root"]',
    );
    const shellRect = shell?.getBoundingClientRect();
    const surfaceRect = scaledSurface?.getBoundingClientRect();
    const mainLayoutRect = mainLayout?.getBoundingClientRect();

    return {
      shellTransform: shell ? getComputedStyle(shell).transform : "",
      surfaceTransform: scaledSurface
        ? getComputedStyle(scaledSurface).transform
        : "",
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      shellWidth: shellRect?.width ?? 0,
      shellHeight: shellRect?.height ?? 0,
      shellLeft: shellRect?.left ?? 0,
      shellTop: shellRect?.top ?? 0,
      surfaceWidth: surfaceRect?.width ?? 0,
      surfaceHeight: surfaceRect?.height ?? 0,
      surfaceLeft: surfaceRect?.left ?? 0,
      surfaceTop: surfaceRect?.top ?? 0,
      mainLayoutWidth: mainLayoutRect?.width ?? 0,
      mainLayoutHeight: mainLayoutRect?.height ?? 0,
      mainLayoutLeft: mainLayoutRect?.left ?? 0,
      mainLayoutTop: mainLayoutRect?.top ?? 0,
      searchHeight: search?.getBoundingClientRect().height ?? 0,
      browserInputHeight:
        browserInputElement?.getBoundingClientRect().height ?? 0,
      browserFontSize: browser ? getComputedStyle(browser).fontSize : "",
      gitFontSize: git ? getComputedStyle(git).fontSize : "",
    };
  });

  const searchRatio = afterScale.searchHeight / beforeScale.searchHeight;
  const browserInputRatio =
    afterScale.browserInputHeight / beforeScale.browserInputHeight;

  expect(beforeScale.shellTransform).toBe("none");
  expect(afterScale.shellTransform).toBe("none");
  expect(beforeScale.surfaceTransform).toBe("matrix(1, 0, 0, 1, 0, 0)");
  expect(afterScale.surfaceTransform).not.toBe("none");
  expect(
    Math.abs(beforeScale.shellWidth - beforeScale.viewportWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(beforeScale.shellHeight - beforeScale.viewportHeight),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(afterScale.shellWidth - afterScale.viewportWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(afterScale.shellHeight - afterScale.viewportHeight),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(afterScale.mainLayoutWidth - afterScale.viewportWidth),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(afterScale.mainLayoutHeight - afterScale.viewportHeight),
  ).toBeLessThanOrEqual(2);
  expect(Math.abs(afterScale.mainLayoutLeft)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterScale.mainLayoutTop)).toBeLessThanOrEqual(2);
  expect(searchRatio).toBeGreaterThan(1.2);
  expect(searchRatio).toBeLessThan(1.3);
  expect(browserInputRatio).toBeGreaterThan(1.2);
  expect(browserInputRatio).toBeLessThan(1.3);
  expect(Math.abs(searchRatio - browserInputRatio)).toBeLessThan(0.03);
  expect(afterScale.browserFontSize).toBe("14px");
  expect(afterScale.gitFontSize).toBe("14px");
  await expect(browserInput).toBeVisible();
});

test("zooming out keeps the main workspace pinned to the viewport instead of shrinking into the top-left corner", async ({
  page,
}) => {
  await mountProjectUI(page);

  const beforeScale = await page.evaluate(() => {
    const mainLayout = document.querySelector<HTMLElement>(
      '[data-testid="main-layout"]',
    );
    const search = document.querySelector<HTMLElement>('[title="Search"]');
    const mainLayoutRect = mainLayout?.getBoundingClientRect();

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      mainLayoutWidth: mainLayoutRect?.width ?? 0,
      mainLayoutHeight: mainLayoutRect?.height ?? 0,
      mainLayoutLeft: mainLayoutRect?.left ?? 0,
      mainLayoutTop: mainLayoutRect?.top ?? 0,
      searchHeight: search?.getBoundingClientRect().height ?? 0,
    };
  });

  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(0.7);
  });

  await expect
    .poll(async () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--ui-scale")
          .trim(),
      ),
    )
    .toBe("0.7");

  const afterScale = await page.evaluate(() => {
    const mainLayout = document.querySelector<HTMLElement>(
      '[data-testid="main-layout"]',
    );
    const search = document.querySelector<HTMLElement>('[title="Search"]');
    const mainLayoutRect = mainLayout?.getBoundingClientRect();

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      mainLayoutWidth: mainLayoutRect?.width ?? 0,
      mainLayoutHeight: mainLayoutRect?.height ?? 0,
      mainLayoutLeft: mainLayoutRect?.left ?? 0,
      mainLayoutTop: mainLayoutRect?.top ?? 0,
      searchHeight: search?.getBoundingClientRect().height ?? 0,
    };
  });

  const searchRatio = afterScale.searchHeight / beforeScale.searchHeight;

  expect(
    Math.abs(beforeScale.mainLayoutWidth - beforeScale.viewportWidth),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(beforeScale.mainLayoutHeight - beforeScale.viewportHeight),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(afterScale.mainLayoutWidth - afterScale.viewportWidth),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(afterScale.mainLayoutHeight - afterScale.viewportHeight),
  ).toBeLessThanOrEqual(2);
  expect(Math.abs(afterScale.mainLayoutLeft)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterScale.mainLayoutTop)).toBeLessThanOrEqual(2);
  expect(searchRatio).toBeGreaterThan(0.65);
  expect(searchRatio).toBeLessThan(0.75);
});
