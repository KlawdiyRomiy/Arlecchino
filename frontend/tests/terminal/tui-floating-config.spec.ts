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

test("tui assist helpers support all four anchors", async ({ page }) => {
  await page.goto("/");

  const helperState = await page.evaluate(async () => {
    const {
      flipTUIAssistAnchor,
      getTUIAssistFlexDirection,
      normalizeTUIAssistAnchor,
    } = await import("/src/utils/terminalLayout.ts");

    return {
      normalizedTop: normalizeTUIAssistAnchor("top"),
      fallbackAnchor: normalizeTUIAssistAnchor("invalid", "bottom"),
      flippedLeft: flipTUIAssistAnchor("left"),
      flippedTop: flipTUIAssistAnchor("top"),
      rightDirection: getTUIAssistFlexDirection("right"),
      leftDirection: getTUIAssistFlexDirection("left"),
      topDirection: getTUIAssistFlexDirection("top"),
      bottomDirection: getTUIAssistFlexDirection("bottom"),
    };
  });

  expect(helperState.normalizedTop).toBe("top");
  expect(helperState.fallbackAnchor).toBe("bottom");
  expect(helperState.flippedLeft).toBe("right");
  expect(helperState.flippedTop).toBe("bottom");
  expect(helperState.rightDirection).toBe("row");
  expect(helperState.leftDirection).toBe("row-reverse");
  expect(helperState.topDirection).toBe("column-reverse");
  expect(helperState.bottomDirection).toBe("column");
});
