import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfigFromFile } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("vite dev watcher does not ignore generated wails bindings", async () => {
  const configPath = path.resolve(__dirname, "../vite.config.ts");
  const result = await loadConfigFromFile(
    { command: "serve", mode: "development" },
    configPath,
  );

  assert.ok(result, "expected vite config to load");

  const ignored = result.config.server?.watch?.ignored;
  const patterns = Array.isArray(ignored) ? ignored : ignored ? [ignored] : [];

  assert.ok(
    !patterns.includes("**/wailsjs/**"),
    "generated Wails bindings must be watched so Vite sees binding regeneration during wails dev",
  );
});
