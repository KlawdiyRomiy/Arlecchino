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
          if (property === "EventsOnMultiple") {
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

test("AI chat run envelope merge clears stale empty tool proposals", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIChatStore } = await import("/src/stores/aiChatStore.ts");
    const store = useAIChatStore.getState();
    const baseRun = {
      id: "run-ai-chat-store-clear",
      sessionId: "default",
      action: "build",
      status: "running",
      canCancel: true,
      disclosureSummary: {},
      approvalSummary: {},
      consentSummary: {},
      toolProposals: [
        {
          id: "tool-proposal-apply-change",
          name: "apply_code_change",
          description: "Apply a code change after explicit approval.",
          policy: "approval_required",
          kind: "file_write",
          scopeSummary: "Project-scoped file mutation proposal.",
          riskLevel: "high",
          approvalModeRequired: "full_access",
          allowedByCurrentPolicy: false,
          status: "proposed",
          executionState: "not_executable_in_this_slice",
        },
      ],
      toolProposalSummary: {
        total: 1,
        allowedByPolicy: 0,
        hardDenied: 0,
        notExecutableInSlice: 1,
      },
      mnemonicInclusion: {
        requested: false,
        enabled: false,
        included: false,
        count: 0,
      },
      revision: 1,
      createdAt: "2026-05-16T00:00:00Z",
      updatedAt: "2026-05-16T00:00:01Z",
    };

    store.clearRuntime();
    store.upsertRunEnvelope(baseRun);
    store.upsertRunEnvelope({
      ...baseRun,
      status: "completed",
      canCancel: false,
      toolProposals: [],
      toolProposalSummary: {
        total: 0,
        allowedByPolicy: 0,
        hardDenied: 0,
        notExecutableInSlice: 0,
      },
      revision: 2,
      updatedAt: "2026-05-16T00:00:02Z",
    });

    const merged = useAIChatStore
      .getState()
      .runs.find((run) => run.id === baseRun.id);
    store.clearRuntime();
    return {
      proposalCount: merged?.toolProposals?.length ?? -1,
      summaryTotal: merged?.toolProposalSummary?.total ?? -1,
    };
  });

  expect(result).toEqual({ proposalCount: 0, summaryTotal: 0 });
});

test("AI chat run envelope merge clears proposals from zero summary", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIChatStore } = await import("/src/stores/aiChatStore.ts");
    const store = useAIChatStore.getState();
    const baseRun = {
      id: "run-ai-chat-store-summary-clear",
      sessionId: "default",
      action: "debug",
      status: "running",
      canCancel: true,
      disclosureSummary: {},
      approvalSummary: {},
      consentSummary: {},
      toolProposals: [
        {
          id: "tool-proposal-terminal-check",
          name: "preview_diagnostic_command",
          description: "Preview a diagnostic terminal command.",
          policy: "approval_required",
          kind: "terminal",
          scopeSummary: "Project-scoped terminal diagnostic proposal.",
          riskLevel: "medium",
          approvalModeRequired: "full_access",
          allowedByCurrentPolicy: false,
          status: "proposed",
          executionState: "not_executable_in_this_slice",
        },
      ],
      toolProposalSummary: {
        total: 1,
        allowedByPolicy: 0,
        hardDenied: 0,
        notExecutableInSlice: 1,
      },
      mnemonicInclusion: {
        requested: false,
        enabled: false,
        included: false,
        count: 0,
      },
      revision: 1,
      createdAt: "2026-05-16T00:00:00Z",
      updatedAt: "2026-05-16T00:00:01Z",
    };

    store.clearRuntime();
    store.upsertRunEnvelope(baseRun);
    store.upsertRunEnvelope({
      ...baseRun,
      status: "completed",
      canCancel: false,
      toolProposals: undefined,
      toolProposalSummary: {
        total: 0,
        allowedByPolicy: 0,
        hardDenied: 0,
        notExecutableInSlice: 0,
      },
      revision: 2,
      updatedAt: "2026-05-16T00:00:02Z",
    });

    const merged = useAIChatStore
      .getState()
      .runs.find((run) => run.id === baseRun.id);
    store.clearRuntime();
    return {
      proposalCount: merged?.toolProposals?.length ?? -1,
      summaryTotal: merged?.toolProposalSummary?.total ?? -1,
    };
  });

  expect(result).toEqual({ proposalCount: 0, summaryTotal: 0 });
});
