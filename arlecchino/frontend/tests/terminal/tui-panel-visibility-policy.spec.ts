import { expect, test } from "@playwright/test";

test("tui visibility policy keeps existing panels and forces terminal", async ({
  page,
}) => {
  await page.goto("/");

  const policy = await page.evaluate(async () => {
    const mod = await import("/src/utils/terminalLayout.ts");
    const resolver = mod as unknown as {
      getTUIPanelVisibility?: (input: {
        explorer: boolean;
        terminal: boolean;
        aiChat: boolean;
        git: boolean;
        browser: boolean;
      }) => {
        explorer: boolean;
        terminal: boolean;
        aiChat: boolean;
        git: boolean;
        browser: boolean;
      };
    };

    const fn = resolver.getTUIPanelVisibility;

    return {
      hasResolver: typeof fn === "function",
      fromMixed: fn?.({
        explorer: true,
        terminal: false,
        aiChat: true,
        git: false,
        browser: true,
      }),
      fromAllHidden: fn?.({
        explorer: false,
        terminal: false,
        aiChat: false,
        git: false,
        browser: false,
      }),
    };
  });

  expect(policy.hasResolver).toBe(true);
  expect(policy.fromMixed).toEqual({
    explorer: true,
    terminal: true,
    aiChat: true,
    git: false,
    browser: true,
  });
  expect(policy.fromAllHidden).toEqual({
    explorer: false,
    terminal: true,
    aiChat: false,
    git: false,
    browser: false,
  });
});
