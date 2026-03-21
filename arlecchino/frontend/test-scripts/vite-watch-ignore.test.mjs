import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const viteConfigPath = resolve(here, "../vite.config.ts");

test("vite watch ignores arlecchino runtime database directory", () => {
  const source = readFileSync(viteConfigPath, "utf8");

  assert.match(
    source,
    /ignored:\s*\[[\s\S]*"\*\*\/\.arlecchino\/\*\*"/,
    "vite server.watch.ignored must include **/.arlecchino/** to prevent reload loops",
  );
});
