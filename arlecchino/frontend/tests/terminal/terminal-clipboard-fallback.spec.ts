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

test("clipboard helpers fallback to navigator clipboard when runtime fails", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { readClipboardTextWithFallback, writeClipboardTextWithFallback } =
      await import("/src/utils/clipboard.ts");

    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => "navigator-content",
        writeText: async (text: string) => {
          writes.push(text);
        },
      },
    });

    const readText = await readClipboardTextWithFallback(async () => {
      throw new Error("runtime unavailable");
    });
    const writeOk = await writeClipboardTextWithFallback(
      "hello-from-fallback",
      async () => {
        throw new Error("runtime unavailable");
      },
    );

    return {
      readText,
      writeOk,
      writes,
    };
  });

  expect(result.readText).toBe("navigator-content");
  expect(result.writeOk).toBe(true);
  expect(result.writes).toEqual(["hello-from-fallback"]);
});
