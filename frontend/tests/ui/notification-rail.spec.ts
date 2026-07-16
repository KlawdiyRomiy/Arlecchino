import { expect, test, type Page } from "@playwright/test";

const installBaseBridges = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async () => {
            switch (property) {
              case "GetRecentProjects":
              case "GetDevToolsStatus":
                return [];
              case "GetCurrentProjectFramework":
                return null;
              case "SetNativeWindowControlsVisible":
              case "OpenProject":
                return true;
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
  });
};

const mountNotificationRail = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const { useAppNotificationStore } =
      await import("/src/stores/appNotificationStore.ts");
    const store = useAppNotificationStore.getState();
    store.clearNotifications();
    store.addNotification({
      id: "sync",
      kind: "success",
      source: "Sync",
      title: "Repository synced",
      message: "Fetched origin/main.",
      sticky: true,
      timeoutMs: 0,
    });
    store.addNotification({
      id: "indexer",
      kind: "info",
      source: "Indexer",
      title: "Workspace scan complete",
      message: "3,218 files indexed.",
      sticky: true,
      timeoutMs: 0,
    });
    store.addNotification({
      id: "auto-update",
      kind: "warning",
      source: "Updates",
      tag: "beta",
      title: "Manual update required",
      message:
        "Version unknown\nNo auto-update manifest is configured; use the manual DMG release flow.",
      sticky: true,
      timeoutMs: 0,
      action: {
        label: "Open GitHub Releases",
        run: () => {
          (
            window as Window & { __notificationActionRan?: boolean }
          ).__notificationActionRan = true;
        },
      },
    });
  });
};

const applyThemeVariables = async (
  page: Page,
  themeId: string,
): Promise<void> => {
  await page.evaluate(async (nextThemeId) => {
    const { getThemeDefinition } = await import("/src/styles/themes.ts");
    const nextTheme = getThemeDefinition(
      nextThemeId as Parameters<typeof getThemeDefinition>[0],
    );
    const htmlElement = document.documentElement;

    Object.entries(nextTheme.cssVariables).forEach(([name, value]) => {
      htmlElement.style.setProperty(name, value);
    });

    htmlElement.dataset.theme = nextTheme.id;
    htmlElement.dataset.themeAppearance = nextTheme.appearance;
  }, themeId);
};

const resolveColor = async (page: Page, cssColor: string): Promise<string> => {
  return page.evaluate((nextColor) => {
    const probe = document.createElement("span");
    probe.style.color = nextColor;
    document.body.appendChild(probe);
    const resolvedColor = getComputedStyle(probe).color;
    probe.remove();
    return resolvedColor;
  }, cssColor);
};

test.beforeEach(async ({ page }) => {
  await installBaseBridges(page);
  await page.goto("/");
});

test("notification rail renders bottom-right and supports primary actions", async ({
  page,
}) => {
  await mountNotificationRail(page);

  const stack = page.getByTestId("app-notification-stack");
  const primary = page.getByTestId("app-notification-auto-update");
  await expect(stack).toBeVisible();
  await expect(primary).toHaveAttribute("data-notification-state", "expanded");
  await expect(page.getByText("UPDATES")).toBeVisible();
  await expect(page.getByText("beta")).toBeVisible();
  await expect(page.getByText("Manual update required")).toBeVisible();
  await expect(page.getByText("Open GitHub Releases")).toBeVisible();

  const viewport = page.viewportSize();
  const box = await stack.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(viewport!.width - (box!.x + box!.width)).toBeGreaterThanOrEqual(18);
  expect(viewport!.width - (box!.x + box!.width)).toBeLessThanOrEqual(34);
  expect(viewport!.height - (box!.y + box!.height)).toBeGreaterThanOrEqual(48);
  expect(viewport!.height - (box!.y + box!.height)).toBeLessThanOrEqual(70);

  await page.getByText("Open GitHub Releases").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __notificationActionRan?: boolean })
            .__notificationActionRan === true,
      ),
    )
    .toBe(true);

  await page
    .getByRole("button", { name: "Dismiss Manual update required" })
    .click();
  await expect(page.getByText("Manual update required")).toHaveCount(0);
  await expect(page.getByText("Workspace scan complete")).toBeVisible();
});

test("notification rail inherits active theme variables", async ({ page }) => {
  await applyThemeVariables(page, "arlecchino-matinee");
  await mountNotificationRail(page);

  const primary = page.getByTestId("app-notification-auto-update");
  await expect(primary).toBeVisible();

  const rootVariables = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      textPrimary: rootStyle.getPropertyValue("--text-primary").trim(),
      shellBorderStrong: rootStyle
        .getPropertyValue("--shell-border-strong")
        .trim(),
    };
  });

  const expectedTextColor = await resolveColor(page, rootVariables.textPrimary);
  const expectedBorderColor = await resolveColor(
    page,
    rootVariables.shellBorderStrong,
  );
  const titleColor = await page
    .getByText("Manual update required")
    .evaluate((element) => getComputedStyle(element).color);
  const actionColor = await page
    .getByText("Open GitHub Releases")
    .evaluate((element) => getComputedStyle(element).color);
  const borderColor = await primary.evaluate(
    (element) => getComputedStyle(element).borderTopColor,
  );

  expect(titleColor).toBe(expectedTextColor);
  expect(actionColor).toBe(expectedTextColor);
  expect(borderColor).toBe(expectedBorderColor);
});

test("notification rail stays above modal overlay surfaces", async ({
  page,
}) => {
  await mountNotificationRail(page);

  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-testid", "synthetic-modal-overlay");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "111",
      background: "rgba(0, 0, 0, 0.01)",
      pointerEvents: "auto",
    });
    document.body.appendChild(overlay);
  });

  const stack = page.getByTestId("app-notification-stack");
  const primary = page.getByTestId("app-notification-auto-update");
  await expect(stack).toBeVisible();
  await expect(primary).toBeVisible();
  await expect(page.getByTestId("synthetic-modal-overlay")).toBeVisible();

  await expect
    .poll(() =>
      stack.evaluate((element) => element.parentElement === document.body),
    )
    .toBe(false);
  await expect
    .poll(() =>
      page
        .getByTestId("app-notification-surface")
        .evaluate((element) => element.parentElement === document.body),
    )
    .toBe(true);

  const zIndex = await stack.evaluate((element) =>
    Number.parseInt(getComputedStyle(element).zIndex, 10),
  );
  expect(zIndex).toBeGreaterThan(111);

  const box = await primary.boundingBox();
  expect(box).not.toBeNull();
  const topElementIsNotification = await page.evaluate(
    ({ x, y }) => {
      const topElement = document.elementFromPoint(x, y);
      return Boolean(
        topElement?.closest('[data-testid="app-notification-auto-update"]'),
      );
    },
    {
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    },
  );
  expect(topElementIsNotification).toBe(true);
});

test("notification rail expands older app notifications on hover and focus", async ({
  page,
}) => {
  await mountNotificationRail(page);

  const stack = page.getByTestId("app-notification-stack");
  const older = page.getByTestId("app-notification-indexer");
  await expect(stack).toHaveAttribute("data-stack-expanded", "false");
  await expect(older).toHaveAttribute("data-notification-state", "collapsed");
  await expect(page.getByText("3,218 files indexed.")).toHaveCount(0);

  await stack.hover();
  await expect(stack).toHaveAttribute("data-stack-expanded", "true");
  await expect(older).toHaveAttribute("data-notification-state", "expanded");
  await expect(page.getByText("3,218 files indexed.")).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(stack).toHaveAttribute("data-stack-expanded", "false");
  await page
    .getByRole("button", { name: "Dismiss Manual update required" })
    .focus();
  await expect(stack).toHaveAttribute("data-stack-expanded", "true");
});

test("notification rail uses opacity-only motion when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mountNotificationRail(page);

  const primary = page.getByTestId("app-notification-auto-update");
  await expect(primary).toBeVisible();
  const transform = await primary.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(transform).toBe("none");
});

test("notification rail scales with UI and keeps long output dismissible", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    useEditorSettingsStore.getState().setUiScale(1.25);

    const { useAppNotificationStore } =
      await import("/src/stores/appNotificationStore.ts");
    const store = useAppNotificationStore.getState();
    store.clearNotifications();
    store.addNotification({
      id: "long-output",
      kind: "error",
      title: "CMake LSP error",
      message: "trace line\n".repeat(1_000),
      sticky: false,
      timeoutMs: 20,
    });
  });

  const card = page.getByTestId("app-notification-long-output");
  const dismiss = page.getByRole("button", {
    name: "Dismiss CMake LSP error",
  });
  await expect(card).toBeVisible();
  await expect(dismiss).toBeVisible();

  const viewport = page.viewportSize();
  const cardBox = await card.boundingBox();
  expect(viewport).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(cardBox!.width).toBeGreaterThan(600);
  expect(cardBox!.y).toBeGreaterThanOrEqual(0);
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(viewport!.height);

  await expect(card).toHaveCount(0, { timeout: 1_000 });
});

test("notification rail scrolls long runtime details without hiding dismiss", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { useAppNotificationStore } =
      await import("/src/stores/appNotificationStore.ts");
    const store = useAppNotificationStore.getState();
    store.clearNotifications();
    store.addNotification({
      id: "runtime-output",
      kind: "error",
      title: "SQL LSP error",
      message: "The language server exited unexpectedly.",
      details: "stack trace line\n".repeat(1_000),
      detailsLabel: "Runtime details",
      sticky: true,
      timeoutMs: 0,
    });
  });

  const card = page.getByTestId("app-notification-runtime-output");
  const body = page.getByTestId("app-notification-body-runtime-output");
  const footer = page.getByTestId("app-notification-footer-runtime-output");
  const dismiss = page.getByRole("button", {
    name: "Dismiss SQL LSP error",
  });
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Runtime details" }).click();
  await expect(body).toBeVisible();
  await expect(footer).toBeVisible();
  await expect(dismiss).toBeVisible();

  const footerBoxBeforeScroll = await footer.boundingBox();
  const scrollMetrics = await body.evaluate((element) => {
    const container = element as HTMLDivElement;
    container.scrollTop = 240;
    return {
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
  });
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(
    scrollMetrics.clientHeight,
  );
  expect(scrollMetrics.scrollTop).toBeGreaterThan(0);
  const footerBoxAfterScroll = await footer.boundingBox();
  expect(footerBoxBeforeScroll).not.toBeNull();
  expect(footerBoxAfterScroll).not.toBeNull();
  expect(footerBoxAfterScroll!.y).toBe(footerBoxBeforeScroll!.y);
  expect(
    await body.evaluate((element) => getComputedStyle(element).scrollbarGutter),
  ).not.toBe("stable");
  await expect(dismiss).toBeVisible();
});
