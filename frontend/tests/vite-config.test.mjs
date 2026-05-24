import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfigFromFile } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, "../vite.config.ts");
const withRuntimeEnv = async (env, callback) => {
  const keys = [
    "ARLECCHINO_REAL_WAILS_RUNTIME",
    "ARLECCHINO_TEST_WAILS_RUNTIME",
    "ARLECCHINO_WEB_ONLY_WAILS_RUNTIME",
    "ARLECCHINO_WAILS_RUNTIME_JS",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );

  for (const key of keys) {
    delete process.env[key];
  }
  Object.assign(process.env, env);

  try {
    return await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
};

const loadViteConfig = (command, env = {}) =>
  withRuntimeEnv(env, async () => {
    const result = await loadConfigFromFile(
      { command, mode: command === "serve" ? "development" : "production" },
      configPath,
    );

    assert.ok(result, "expected vite config to load");
    return result.config;
  });

const findAliasReplacement = (config, find) => {
  const aliases = config.resolve?.alias ?? [];
  const entries = Array.isArray(aliases) ? aliases : Object.entries(aliases);
  const match = entries.find((entry) =>
    Array.isArray(entry) ? entry[0] === find : entry.find === find,
  );
  return Array.isArray(match) ? match[1] : match?.replacement;
};

const withTempRuntime = async (callback) => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "arlecchino-wails-runtime-"),
  );
  const runtimePath = path.join(tempDir, "runtime.js");
  await writeFile(runtimePath, "export const objectNames = {};\n", "utf8");

  try {
    return await callback({ tempDir, runtimePath });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

test("vite dev watcher does not ignore generated wails bindings", async () => {
  const config = await loadViteConfig("serve", {
    ARLECCHINO_TEST_WAILS_RUNTIME: "1",
  });

  const ignored = config.server?.watch?.ignored;
  const patterns = Array.isArray(ignored) ? ignored : ignored ? [ignored] : [];

  assert.ok(
    !patterns.includes("**/wailsjs/**"),
    "generated Wails bindings must be watched so Vite sees binding regeneration during wails dev",
  );
});

test("vite web-only and test dev modes use the Wails runtime stub", async () => {
  const config = await loadViteConfig("serve", {
    ARLECCHINO_WEB_ONLY_WAILS_RUNTIME: "1",
  });

  assert.match(
    findAliasReplacement(config, "/wails/runtime.js") ?? "",
    /src\/wails\/runtimeTestStub\.ts$/,
  );
});

test("vite plain dev mode uses the Wails runtime stub", async () => {
  const config = await loadViteConfig("serve");

  assert.match(
    findAliasReplacement(config, "/wails/runtime.js") ?? "",
    /src\/wails\/runtimeTestStub\.ts$/,
  );
});

test("vite real dev mode resolves the official Wails runtime", async () => {
  await withTempRuntime(async ({ tempDir, runtimePath }) => {
    const config = await loadViteConfig("serve", {
      ARLECCHINO_REAL_WAILS_RUNTIME: "1",
      ARLECCHINO_WAILS_RUNTIME_JS: runtimePath,
    });

    assert.equal(
      findAliasReplacement(config, "/wails/runtime.js"),
      runtimePath,
    );
    assert.deepEqual(config.server?.fs?.allow, [
      path.resolve(__dirname, "../.."),
      tempDir,
    ]);
  });
});

test("vite real dev mode does not use the minimal runtime bridge", async () => {
  await withTempRuntime(async ({ runtimePath }) => {
    const config = await loadViteConfig("serve", {
      ARLECCHINO_REAL_WAILS_RUNTIME: "1",
      ARLECCHINO_WAILS_RUNTIME_JS: runtimePath,
    });

    assert.doesNotMatch(
      findAliasReplacement(config, "/wails/runtime.js") ?? "",
      /runtimeDevBridge\.ts$/,
    );
  });
});

test("vite production build leaves the Wails runtime external", async () => {
  const config = await loadViteConfig("build", {
    ARLECCHINO_REAL_WAILS_RUNTIME: "1",
  });

  assert.equal(findAliasReplacement(config, "/wails/runtime.js"), undefined);
  assert.ok(
    config.build?.rollupOptions?.external?.includes("/wails/runtime.js"),
    "production builds must keep the Wails runtime as an external runtime module",
  );
});

test("vite test dev mode resolves the Wails runtime through the stub", async () => {
  const config = await loadViteConfig("serve", {
    ARLECCHINO_TEST_WAILS_RUNTIME: "1",
  });

  assert.match(
    findAliasReplacement(config, "/wails/runtime.js") ?? "",
    /src\/wails\/runtimeTestStub\.ts$/,
  );
});
