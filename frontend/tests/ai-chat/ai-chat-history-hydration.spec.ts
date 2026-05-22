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

test("history rail title updates after passive run hydration", async ({
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
    const { ChatHistoryRail } =
      await import("/src/components/ai-chat/ChatHistoryRail.tsx");

    if (!createRoot) {
      throw new Error("React createRoot is unavailable");
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const runs = [
      {
        id: "run-title",
        sessionId: "session-title",
        action: "build",
        status: "completed",
        createdAt: "2026-05-17T00:00:00Z",
        updatedAt: "2026-05-17T00:00:01Z",
      },
    ];
    const render = (hydratedRuns: Record<string, unknown>) =>
      root.render(
        React.createElement(
          LazyMotion,
          { features: domAnimation },
          React.createElement(ChatHistoryRail, {
            activeSessionId: "session-title",
            canMove: false,
            hydratedRuns,
            runs,
            searchQuery: "",
            onClose: () => undefined,
            onDragStart: () => undefined,
            onNewChat: () => undefined,
            onDeleteSession: () => undefined,
            onSearchChange: () => undefined,
            onSelectSession: () => undefined,
          }),
        ),
      );

    render({});
    window.setTimeout(() => {
      render({
        "run-title": {
          id: "run-title",
          sessionId: "session-title",
          action: "build",
          status: "completed",
          userPrompt: "Restore saved assistant messages",
          response: "Done",
          createdAt: "2026-05-17T00:00:00Z",
          updatedAt: "2026-05-17T00:00:01Z",
        },
      });
    }, 0);
  });

  await expect(
    page.getByText("Restore saved assistant messages"),
  ).toBeVisible();
});

test("passive AI chat hydration does not change active run selection", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIChatStore } = await import("/src/stores/aiChatStore.ts");
    useAIChatStore.setState({
      activeRunId: "run-active",
      hydratedRuns: {},
      streamingTextByRunId: {},
    });
    useAIChatStore.getState().upsertHydratedRun({
      id: "run-inactive",
      sessionId: "session-inactive",
      action: "build",
      status: "completed",
      userPrompt: "Inactive title",
      response: "Inactive response",
      createdAt: "2026-05-17T00:00:00Z",
      updatedAt: "2026-05-17T00:00:01Z",
    });
    return {
      activeRunId: useAIChatStore.getState().activeRunId,
      hydrated: Boolean(useAIChatStore.getState().hydratedRuns["run-inactive"]),
    };
  });

  expect(result).toEqual({ activeRunId: "run-active", hydrated: true });
});

test("AI Chat hydrates envelope-only restart history before rendering saved text", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const now = () => new Date().toISOString();
    const provider = {
      id: "ollama-history",
      name: "Ollama History",
      kind: "ollama",
      local: true,
      manual: false,
      frontier: false,
      oauthSupported: false,
      requiresAuth: false,
      authConfigured: true,
      capabilities: ["chat"],
      models: [
        { id: "history-code", displayName: "history-code", streaming: true },
      ],
      defaultModel: "history-code",
      status: "ready",
      lastCheckedAt: now(),
    };
    const envelopeRuns = [
      {
        id: "run-new",
        sessionId: "default",
        action: "build",
        status: "completed",
        providerId: provider.id,
        model: "history-code",
        canCancel: false,
        revision: 1,
        createdAt: "2026-05-17T00:01:00Z",
        updatedAt: "2026-05-17T00:01:02Z",
      },
      {
        id: "run-old",
        sessionId: "default",
        action: "ask",
        status: "completed",
        providerId: provider.id,
        model: "history-code",
        canCancel: false,
        revision: 1,
        createdAt: "2026-05-17T00:00:00Z",
        updatedAt: "2026-05-17T00:00:02Z",
      },
    ];
    const fullRuns = new Map(
      envelopeRuns.map((run) => [
        run.id,
        {
          ...run,
          userPrompt:
            run.id === "run-old"
              ? "What did the previous agent do?"
              : "A esli tak?",
          response:
            run.id === "run-old"
              ? "It restored the chat transcript."
              : "It continued from the previous task.",
          mnemonicRequested: false,
        },
      ]),
    );
    const appBridge = {
      AIGetStatus: async () => ({
        enabled: true,
        mnemonicEnabled: false,
        providers: [provider],
        activeProviderId: provider.id,
        activeModel: "history-code",
        settingsConfigured: true,
      }),
      AIGetConsentPolicy: async () => ({
        localProvidersAccepted: true,
        remoteProvidersAccepted: false,
        frontierProvidersAccepted: false,
        providerPolicies: [],
        acceptedAt: now(),
        updatedAt: now(),
      }),
      AIGetApprovalPolicy: async () => ({
        mode: "ask_each_time",
        scope: {},
        allowedToolKinds: ["context_read"],
        hardDenyCategories: [],
      }),
      AIGetEmbeddingStatus: async () => ({
        status: "disabled",
        reason: "",
        providers: [],
        updatedAt: now(),
      }),
      AIListChatRuns: async () => envelopeRuns,
      AIGetChatRun: async (id: string) => fullRuns.get(id),
      AIGetChatRunEnvelope: async (id: string) =>
        envelopeRuns.find((run) => run.id === id),
      AIListChatRunArtifacts: async () => [],
      AIGetContextPreview: async (request: Record<string, unknown>) => ({
        id: "preview-history",
        capability: "chat",
        prompt: request.prompt,
        contextItems: [],
        snippets: [],
        dataCategories: ["user_prompt"],
        redaction: {},
        createdAt: now(),
      }),
      AIListChatActions: async () => [
        {
          id: "ask",
          name: "Ask",
          description: "Ask with context",
          builtIn: true,
          mayProposeTools: false,
          expectsToolProposals: false,
          readOnlyIntent: true,
        },
        {
          id: "build",
          name: "Build",
          description: "Build with approval",
          builtIn: true,
          mayProposeTools: true,
          expectsToolProposals: true,
          readOnlyIntent: false,
        },
      ],
      AIListContextProviders: async () => [],
      AIListEgressRecords: async () => [],
      AIListAgentProfiles: async () => [],
      AIListPromptWorkflows: async () => [],
      AIListTools: async () => [],
      AIListToolAudit: async () => [],
      AIListModelCapabilities: async () => [],
      AIListMnemonicEntries: async () => [],
      AIListProviderRuntimes: async () => [],
      AIListPendingApprovals: async () => [],
    };
    Object.assign(window, { go: { main: { App: appBridge } } });

    const ReactModule = await import("/node_modules/.vite/deps/react.js");
    const React = ReactModule.default ?? ReactModule;
    const ReactDOMClient =
      await import("/node_modules/.vite/deps/react-dom_client.js");
    const createRoot =
      ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot;
    const { LazyMotion, domAnimation } =
      await import("/node_modules/.vite/deps/framer-motion.js");
    const { AIChatPanelContent } =
      await import("/src/components/ai-chat/AIChatPanel.tsx");

    if (!createRoot) {
      throw new Error("React createRoot is unavailable");
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    createRoot(host).render(
      React.createElement(
        LazyMotion,
        { features: domAnimation },
        React.createElement(AIChatPanelContent, { presentation: "panel" }),
      ),
    );
  });

  await expect(page.getByText("What did the previous agent do?")).toBeVisible();
  await expect(
    page.getByText("It restored the chat transcript."),
  ).toBeVisible();
  await expect(page.getByText("A esli tak?")).toBeVisible();
  await expect(
    page.getByText("It continued from the previous task."),
  ).toBeVisible();
});
