import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");

async function loadModule() {
  const result = await build({
    stdin: {
      contents: `
        export {
          AI_WORKFLOW_MODES,
          createAIChatCommandIntent,
          parseAICommandInput,
        } from "./src/utils/commandPaletteAI.ts";
      `,
      loader: "ts",
      resolveDir: frontendRoot,
      sourcefile: "command-palette-ai-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });

  const code = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
}

test("@ai without prompt returns mode suggestions state", async () => {
  const { parseAICommandInput } = await loadModule();
  assert.deepEqual(parseAICommandInput("@ai"), { kind: "empty" });
});

test("@ai default prompt maps to project ask workflow", async () => {
  const { parseAICommandInput } = await loadModule();
  const parsed = parseAICommandInput("@ai explain dispatcher");
  assert.equal(parsed.kind, "start");
  assert.equal(parsed.prompt, "explain dispatcher");
  assert.equal(parsed.mode.slash, "/ask");
  assert.equal(parsed.mode.workflowId, "slash-ask");
});

test("@ai slash workflow strips directive and preserves prompt", async () => {
  const { parseAICommandInput } = await loadModule();
  const parsed = parseAICommandInput("@ai /build add tests");
  assert.equal(parsed.kind, "start");
  assert.equal(parsed.prompt, "add tests");
  assert.equal(parsed.mode.slash, "/build");
  assert.equal(parsed.mode.workflowId, "slash-build");
});

test("@ai unknown slash mode does not start a run", async () => {
  const { parseAICommandInput } = await loadModule();
  assert.deepEqual(parseAICommandInput("@ai /ship it"), {
    kind: "unknown-mode",
    mode: "/ship",
  });
});

test("startFromInput intent carries resolved workflow payload", async () => {
  const { createAIChatCommandIntent } = await loadModule();
  const intent = createAIChatCommandIntent("ai.startFromInput", {
    input: "@ai /plan stabilize palette",
  });
  assert.equal(intent.actionId, "ai.startFromInput");
  assert.equal(intent.prompt, "stabilize palette");
  assert.equal(intent.workflowId, "slash-plan");
  assert.equal(intent.workflowSlash, "/plan");
  assert.equal(intent.profileId, "plan-architect");
});
