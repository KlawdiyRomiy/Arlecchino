import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectScreenPath = resolve(here, "../src/components/ProjectScreen.tsx");

test("project screen defines manual fixture detection helper", () => {
  const source = readFileSync(projectScreenPath, "utf8");

  assert.match(
    source,
    /isManualAutocompleteFixture\s*=\s*\(filePath:\s*string\)\s*=>/,
    "ProjectScreen must define isManualAutocompleteFixture(filePath) helper",
  );

  assert.match(
    source,
    /frontend\/tests\/ide-autocomplete\/scenarios/,
    "manual fixture helper must target frontend/tests/ide-autocomplete/scenarios",
  );
});

test("project screen blocks autosave writes for manual fixtures", () => {
  const source = readFileSync(projectScreenPath, "utf8");

  const guardToken = "isManualAutocompleteFixture(tab.path)";
  const writeToken = "AppFunctions.WriteFile(tab.path, content)";

  assert.equal(
    source.includes(guardToken),
    true,
    "autoSaveFile must check isManualAutocompleteFixture(tab.path)",
  );

  assert.equal(
    source.includes(writeToken),
    true,
    "autoSaveFile must still call AppFunctions.WriteFile(tab.path, content)",
  );

  assert.equal(
    source.indexOf(guardToken) < source.indexOf(writeToken),
    true,
    "manual fixture guard must run before WriteFile call",
  );
});
