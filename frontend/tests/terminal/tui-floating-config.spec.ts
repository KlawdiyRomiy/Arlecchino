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

test("tui terminal config expands to fullscreen overlay", async ({ page }) => {
  await page.goto("/");

  const configState = await page.evaluate(async () => {
    const { getTUIFloatingTerminalConfig } =
      await import("/src/utils/terminalLayout.ts");

    const config = getTUIFloatingTerminalConfig({
      viewportWidth: 1600,
      viewportHeight: 1000,
    });

    return {
      mode: config.mode,
      width: config.size.width,
      height: config.size.height,
      x: config.x,
      y: config.y,
      position: config.position,
    };
  });

  expect(configState.mode).toBe("floating");
  expect(configState.position).toBe("bottom");
  expect(configState.width).toBe(1600);
  expect(configState.height).toBe(1000);
  expect(configState.x).toBe(0);
  expect(configState.y).toBe(0);
});
