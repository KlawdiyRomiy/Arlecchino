import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
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

test("terminal search utils count matches and navigate indexes", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const {
      countTerminalSearchMatches,
      getNextTerminalMatchIndex,
      createEmptyTerminalSearchStats,
    } = await import("/src/utils/terminalSearch.ts");

    const lines = ["foo bar foo", "Foo baz", "nope"];
    const total = countTerminalSearchMatches(lines, "foo");
    const totalCaseSensitive = countTerminalSearchMatches(lines, "Foo", true);
    const emptyStats = createEmptyTerminalSearchStats();

    return {
      total,
      totalCaseSensitive,
      emptyStats,
      nextFromFirst: getNextTerminalMatchIndex(1, 3, "next"),
      prevFromFirst: getNextTerminalMatchIndex(1, 3, "prev"),
      nextWithNoMatches: getNextTerminalMatchIndex(0, 0, "next"),
    };
  });

  expect(result.total).toBe(3);
  expect(result.totalCaseSensitive).toBe(1);
  expect(result.emptyStats.totalMatches).toBe(0);
  expect(result.emptyStats.currentMatch).toBe(0);
  expect(result.emptyStats.noMatches).toBe(false);
  expect(result.nextFromFirst).toBe(2);
  expect(result.prevFromFirst).toBe(3);
  expect(result.nextWithNoMatches).toBe(0);
});
