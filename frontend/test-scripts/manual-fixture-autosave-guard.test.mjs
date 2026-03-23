import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectScreenPath = resolve(here, "../src/components/ProjectScreen.tsx");

test("project screen removes legacy manual fixture detection helper", () => {
  const source = readFileSync(projectScreenPath, "utf8");

  assert.doesNotMatch(
    source,
    /isManualAutocompleteFixture\s*=\s*\(filePath:\s*string\)\s*=>/,
    "ProjectScreen should not keep the deleted manual fixture helper",
  );

  assert.doesNotMatch(
    source,
    /frontend\/tests\/ide-autocomplete\/scenarios/,
    "ProjectScreen should not reference removed ide-autocomplete fixture paths",
  );
});

test("project screen autosaves without manual fixture bypass", () => {
  const source = readFileSync(projectScreenPath, "utf8");

  const scheduleToken = "scheduleAutoSave(activeTab)";
  const guardToken = "isManualAutocompleteFixture(tab.path)";
  const writeToken = "AppFunctions.WriteFile(tab.path, content)";

  assert.equal(
    source.includes(scheduleToken),
    true,
    "content changes should still schedule autosave for the active tab",
  );

  assert.equal(
    source.includes(writeToken),
    true,
    "autoSaveFile must still call AppFunctions.WriteFile(tab.path, content)",
  );

  assert.equal(
    source.includes(guardToken),
    false,
    "autoSaveFile should not keep the removed manual fixture guard",
  );
});
