import { expect, test } from "@playwright/test";

test("terminal panel close handler routes TUI close through terminal store", async ({
  page,
}) => {
  await page.goto("/");

  const mainLayoutSource = await page.evaluate(async () => {
    const response = await fetch("/src/components/layout/MainLayout.tsx?raw");
    if (!response.ok) {
      return "";
    }
    return response.text();
  });

  expect(mainLayoutSource).toMatch(
    /const\s+handleTerminalPanelClose\s*=\s*\(\)\s*=>\s*\{[\s\S]*forceHideTerminalAfterTUIExitRef\.current\s*=\s*true[\s\S]*closeTerminal\(/,
  );
});
