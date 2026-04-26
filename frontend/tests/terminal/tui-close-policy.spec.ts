import { expect, test } from "@playwright/test";

test("terminal panel close handler routes TUI close through terminal store", async ({
  page,
}) => {
  await page.goto("/");

  const [mainLayoutSource, panelEventsSource] = await page.evaluate(
    async () => {
      const [layoutResponse, panelEventsResponse] = await Promise.all([
        fetch("/src/components/layout/MainLayout.tsx?raw"),
        fetch("/src/components/layout/useMainLayoutPanelEvents.ts?raw"),
      ]);

      return [
        layoutResponse.ok ? await layoutResponse.text() : "",
        panelEventsResponse.ok ? await panelEventsResponse.text() : "",
      ];
    },
  );

  expect(mainLayoutSource).toMatch(
    /useMainLayoutPanelEvents\(\{[\s\S]*forceHideTerminalAfterTUIExitRef[\s\S]*\}\)/,
  );
  expect(panelEventsSource).toMatch(
    /const\s+closeTerminalPanel\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*forceHideTerminalAfterTUIExitRef\.current\s*=\s*true[\s\S]*terminalState\.closeTerminal\(/,
  );
  expect(mainLayoutSource).toMatch(
    /onCloseTerminalPanel=\{closeTerminalPanel\}/,
  );
});
