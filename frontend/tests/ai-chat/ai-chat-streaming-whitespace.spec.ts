import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: () => async () => null,
      },
    );

    const runtimeBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "EventsOnMultiple" || property === "EventsOn") {
            return () => "sub-id";
          }
          if (property === "EventsOff") {
            return () => undefined;
          }
          return async () => undefined;
        },
      },
    );

    Object.assign(window, {
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
    });
  });

  await page.goto("/");
});

test("AI chat streaming text preserves whitespace-only tokens", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIChatStore } = await import("/src/stores/aiChatStore.ts");
    const store = useAIChatStore.getState();
    const run = {
      id: "run-ai-chat-store-stream-whitespace",
      sessionId: "default",
      action: "ask",
      status: "running",
      canCancel: true,
      disclosureSummary: {},
      approvalSummary: {},
      consentSummary: {},
      revision: 1,
      createdAt: "2026-05-22T00:00:00Z",
      updatedAt: "2026-05-22T00:00:01Z",
    };

    store.clearRuntime();
    store.upsertRunEnvelope(run);
    store.appendRunToken(run.id, "hello");
    store.appendRunToken(run.id, " ");
    store.appendRunToken(run.id, "world");
    store.appendRunToken(run.id, "\n\n");
    store.appendRunToken(run.id, "done");

    const streamed =
      useAIChatStore.getState().streamingTextByRunId[run.id] ?? "";
    store.clearRuntime();
    return streamed;
  });

  expect(result).toBe("hello world\n\ndone");
});

test("running hydration does not overwrite richer streamed text", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIChatStore } = await import("/src/stores/aiChatStore.ts");
    const store = useAIChatStore.getState();
    const run = {
      id: "run-ai-chat-store-stale-hydration",
      sessionId: "default",
      action: "ask",
      status: "running",
      canCancel: true,
      disclosureSummary: {},
      approvalSummary: {},
      consentSummary: {},
      revision: 1,
      createdAt: "2026-05-22T00:00:00Z",
      updatedAt: "2026-05-22T00:00:01Z",
    };

    store.clearRuntime();
    store.upsertRunEnvelope(run);
    store.appendRunToken(run.id, "hello world");
    store.setHydratedRun({
      ...run,
      userPrompt: "stream",
      response: "helloworld",
    });

    const streamed =
      useAIChatStore.getState().streamingTextByRunId[run.id] ?? "";
    store.clearRuntime();
    return streamed;
  });

  expect(result).toBe("hello world");
});

test("running run card prefers live stream over stale hydrated response", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const ReactModule = await import("/node_modules/.vite/deps/react.js");
    const React = ReactModule.default ?? ReactModule;
    const ReactDOMClient =
      await import("/node_modules/.vite/deps/react-dom_client.js");
    const createRoot =
      ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot;
    const { LazyMotion, domAnimation } =
      await import("/node_modules/.vite/deps/framer-motion.js");
    const { RunCard } = await import("/src/components/ai-chat/RunCard.tsx");

    if (!createRoot) {
      throw new Error("React createRoot is unavailable");
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    createRoot(host).render(
      React.createElement(
        LazyMotion,
        { features: domAnimation },
        React.createElement(RunCard, {
          envelope: {
            id: "run-card-stream-whitespace",
            sessionId: "default",
            action: "ask",
            status: "running",
            createdAt: "2026-05-22T00:00:00Z",
            updatedAt: "2026-05-22T00:00:01Z",
          },
          run: {
            id: "run-card-stream-whitespace",
            sessionId: "default",
            action: "ask",
            status: "running",
            userPrompt: "stream",
            response: "helloworld",
            createdAt: "2026-05-22T00:00:00Z",
            updatedAt: "2026-05-22T00:00:01Z",
          },
          active: false,
          compact: false,
          streamingText: "hello world\n\ndone",
          artifacts: [],
          onSelect: () => undefined,
        }),
      ),
    );
  });

  await expect(page.locator('[data-testid="ai-chat-markdown"] p')).toHaveText([
    "hello world",
    "done",
  ]);
  await expect(page.getByText("helloworld")).toHaveCount(0);
});
