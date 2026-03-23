import { expect, test } from "@playwright/test";

test("main layout does not keep a dedicated TUI overlay plane", async ({
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

  expect(mainLayoutSource).not.toMatch(/const\s+tuiWorkspaceStyle/);
  expect(mainLayoutSource).not.toMatch(/backdropFilter\s*:\s*"blur\(2px\)"/);
});

test("tui terminal overlay is viewport-positioned", async ({ page }) => {
  await page.goto("/");

  const [mainLayoutSource, floatingPanelSource] = await page.evaluate(
    async () => {
      const [layoutResponse, panelResponse] = await Promise.all([
        fetch("/src/components/layout/MainLayout.tsx?raw"),
        fetch("/src/components/ui/FloatingPanel.tsx?raw"),
      ]);

      return [
        layoutResponse.ok ? await layoutResponse.text() : "",
        panelResponse.ok ? await panelResponse.text() : "",
      ];
    },
  );

  expect(mainLayoutSource).toMatch(/useViewportPositioning=\{tuiModeActive\}/);
  expect(floatingPanelSource).toMatch(/useViewportPositioning\?:\s*boolean/);
  expect(floatingPanelSource).toMatch(
    /position:\s*useViewportPositioning[\s\S]*isDragging[\s\S]*absolute/,
  );
});
