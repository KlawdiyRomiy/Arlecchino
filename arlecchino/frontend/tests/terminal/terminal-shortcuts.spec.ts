import { expect, test } from "@playwright/test";

test("terminal shortcut map supports copy/paste/find/tab-management combos", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { shortcuts } = await import("/src/utils/keyboard.ts");
    const shortcutMap = shortcuts as unknown as Record<
      string,
      ((event: KeyboardEvent) => boolean) | undefined
    >;

    const macCopyEvent = new KeyboardEvent("keydown", {
      key: "C",
      code: "KeyC",
      metaKey: true,
      shiftKey: true,
    });

    const macPasteEvent = new KeyboardEvent("keydown", {
      key: "V",
      code: "KeyV",
      metaKey: true,
      shiftKey: true,
    });

    const plainCtrlC = new KeyboardEvent("keydown", {
      key: "c",
      code: "KeyC",
      ctrlKey: true,
    });

    const macSelectAllEvent = new KeyboardEvent("keydown", {
      key: "A",
      code: "KeyA",
      metaKey: true,
    });

    const macClearEvent = new KeyboardEvent("keydown", {
      key: "K",
      code: "KeyK",
      metaKey: true,
    });

    const macFindEvent = new KeyboardEvent("keydown", {
      key: "F",
      code: "KeyF",
      metaKey: true,
    });

    const macNewTabEvent = new KeyboardEvent("keydown", {
      key: "T",
      code: "KeyT",
      metaKey: true,
    });

    const macCloseTabEvent = new KeyboardEvent("keydown", {
      key: "W",
      code: "KeyW",
      metaKey: true,
    });

    const macReopenTabEvent = new KeyboardEvent("keydown", {
      key: "T",
      code: "KeyT",
      metaKey: true,
      shiftKey: true,
    });

    const macClearLineEvent = new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      metaKey: true,
    });

    const macDeleteLineEvent = new KeyboardEvent("keydown", {
      key: "Delete",
      code: "Delete",
      metaKey: true,
    });

    const macFindNextEvent = new KeyboardEvent("keydown", {
      key: "G",
      code: "KeyG",
      metaKey: true,
    });

    const macFindPrevEvent = new KeyboardEvent("keydown", {
      key: "G",
      code: "KeyG",
      metaKey: true,
      shiftKey: true,
    });

    const f3NextEvent = new KeyboardEvent("keydown", {
      key: "F3",
      code: "F3",
    });

    const f3PrevEvent = new KeyboardEvent("keydown", {
      key: "F3",
      code: "F3",
      shiftKey: true,
    });

    return {
      hasCopy: typeof shortcutMap.terminalCopy === "function",
      hasPaste: typeof shortcutMap.terminalPaste === "function",
      hasSelectAll: typeof shortcutMap.terminalSelectAll === "function",
      hasClear: typeof shortcutMap.terminalClear === "function",
      hasFind: typeof shortcutMap.terminalFind === "function",
      hasFindNext: typeof shortcutMap.terminalFindNext === "function",
      hasFindPrev: typeof shortcutMap.terminalFindPrev === "function",
      hasNewTab: typeof shortcutMap.terminalNewTab === "function",
      hasCloseTab: typeof shortcutMap.terminalCloseTab === "function",
      hasReopenTab: typeof shortcutMap.terminalReopenTab === "function",
      hasClearLine: typeof shortcutMap.terminalClearLine === "function",
      copyMatch: shortcutMap.terminalCopy?.(macCopyEvent) ?? false,
      pasteMatch: shortcutMap.terminalPaste?.(macPasteEvent) ?? false,
      selectAllMatch:
        shortcutMap.terminalSelectAll?.(macSelectAllEvent) ?? false,
      clearMatch: shortcutMap.terminalClear?.(macClearEvent) ?? false,
      findMatch: shortcutMap.terminalFind?.(macFindEvent) ?? false,
      findNextMatch: shortcutMap.terminalFindNext?.(macFindNextEvent) ?? false,
      findPrevMatch: shortcutMap.terminalFindPrev?.(macFindPrevEvent) ?? false,
      f3NextMatch: shortcutMap.terminalFindNext?.(f3NextEvent) ?? false,
      f3PrevMatch: shortcutMap.terminalFindPrev?.(f3PrevEvent) ?? false,
      newTabMatch: shortcutMap.terminalNewTab?.(macNewTabEvent) ?? false,
      closeTabMatch: shortcutMap.terminalCloseTab?.(macCloseTabEvent) ?? false,
      reopenTabMatch:
        shortcutMap.terminalReopenTab?.(macReopenTabEvent) ?? false,
      clearLineMatch:
        shortcutMap.terminalClearLine?.(macClearLineEvent) ?? false,
      deleteLineMatch:
        shortcutMap.terminalClearLine?.(macDeleteLineEvent) ?? false,
      ctrlCDoesNotMatch: shortcutMap.terminalCopy?.(plainCtrlC) ?? false,
    };
  });

  expect(result.hasCopy).toBe(true);
  expect(result.hasPaste).toBe(true);
  expect(result.hasSelectAll).toBe(true);
  expect(result.hasClear).toBe(true);
  expect(result.hasFind).toBe(true);
  expect(result.hasFindNext).toBe(true);
  expect(result.hasFindPrev).toBe(true);
  expect(result.hasNewTab).toBe(true);
  expect(result.hasCloseTab).toBe(true);
  expect(result.hasReopenTab).toBe(true);
  expect(result.hasClearLine).toBe(true);
  expect(result.copyMatch).toBe(true);
  expect(result.pasteMatch).toBe(true);
  expect(result.selectAllMatch).toBe(true);
  expect(result.clearMatch).toBe(true);
  expect(result.findMatch).toBe(true);
  expect(result.findNextMatch).toBe(true);
  expect(result.findPrevMatch).toBe(true);
  expect(result.f3NextMatch).toBe(true);
  expect(result.f3PrevMatch).toBe(true);
  expect(result.newTabMatch).toBe(true);
  expect(result.closeTabMatch).toBe(true);
  expect(result.reopenTabMatch).toBe(true);
  expect(result.clearLineMatch).toBe(true);
  expect(result.deleteLineMatch).toBe(true);
  expect(result.ctrlCDoesNotMatch).toBe(false);
});
