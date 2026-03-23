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

test("terminal perf helper emits terminal scoped metric", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PERF_EVENT_NAME, recordTerminalPerf } =
      await import("/src/utils/terminalPerf.ts");

    const events: Array<Record<string, unknown>> = [];
    window.addEventListener(PERF_EVENT_NAME, (event) => {
      const customEvent = event as CustomEvent<Record<string, unknown>>;
      events.push(customEvent.detail);
    });

    const value = recordTerminalPerf("search.navigate", () => "ok", {
      direction: "next",
      queryLength: 4,
    });

    return {
      value,
      events,
    };
  });

  expect(result.value).toBe("ok");
  expect(result.events.length).toBe(1);
  expect(result.events[0].scope).toBe("terminal");
  expect(result.events[0].name).toBe("search.navigate");
});
