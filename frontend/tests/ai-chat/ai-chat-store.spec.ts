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
      _wails: { environment: { OS: "darwin" } },
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

test("AI chat run envelope merge accepts explicit empty Mnemonic inclusion", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIChatStore } = await import("/src/stores/aiChatStore.ts");
    const store = useAIChatStore.getState();
    const baseRun = {
      id: "run-ai-chat-store-mnemonic-clear",
      sessionId: "default",
      action: "plan",
      status: "running",
      canCancel: true,
      disclosureSummary: {},
      approvalSummary: {},
      consentSummary: {},
      mnemonicInclusion: {
        requested: true,
        enabled: true,
        included: true,
        count: 2,
        trusts: ["trusted"],
      },
      revision: 1,
      createdAt: "2026-05-16T00:00:00Z",
      updatedAt: "2026-05-16T00:00:01Z",
    };

    store.clearRuntime();
    store.upsertRunEnvelope(baseRun);
    store.upsertRunEnvelope({
      ...baseRun,
      mnemonicInclusion: {
        requested: true,
        enabled: true,
        included: false,
        count: 0,
        trusts: [],
      },
      revision: 2,
      updatedAt: "2026-05-16T00:00:02Z",
    });

    const merged = useAIChatStore
      .getState()
      .runs.find((run) => run.id === baseRun.id);
    store.clearRuntime();
    return merged?.mnemonicInclusion;
  });

  expect(result).toEqual({
    requested: true,
    enabled: true,
    included: false,
    count: 0,
    trusts: [],
  });
});

test("AI chat run envelope merge clears stale egress summary", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIChatStore } = await import("/src/stores/aiChatStore.ts");
    const store = useAIChatStore.getState();
    const baseRun = {
      id: "run-ai-chat-store-egress-clear",
      sessionId: "default",
      action: "ask",
      status: "running",
      canCancel: true,
      disclosureSummary: {},
      approvalSummary: {},
      consentSummary: {},
      egressSummary: {
        recordId: "eg-old",
        status: "completed",
        providerId: "local-test",
        model: "test-model",
        totalTokens: 123,
        estimatedTokens: true,
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
      egressSummary: null,
      revision: 2,
      updatedAt: "2026-05-16T00:00:02Z",
    });

    const merged = useAIChatStore
      .getState()
      .runs.find((run) => run.id === baseRun.id);
    store.clearRuntime();
    return merged?.egressSummary ?? null;
  });

  expect(result).toBeNull();
});

test("AI inline patch artifact sync preserves previews from other runs", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIInlinePatchStore } =
      await import("/src/stores/aiInlinePatchStore.ts");
    const store = useAIInlinePatchStore.getState();
    const makeArtifact = (
      id: string,
      runId: string,
      status: string,
      diff: string,
    ) => ({
      id,
      runId,
      sessionId: "default",
      projectSessionId: "main",
      kind: "patch_preview",
      status,
      title: id,
      summary: id,
      payloadJson: JSON.stringify({
        unifiedDiff: diff,
        checkReady: true,
        files: [
          {
            path: `${id}.md`,
            status: "modify",
            exists: true,
          },
        ],
      }),
      createdAt: "2026-05-18T00:00:00Z",
      updatedAt: "2026-05-18T00:00:00Z",
    });

    useAIInlinePatchStore.setState({ previews: {}, dismissedIds: {} });
    store.syncArtifacts([
      makeArtifact("patch-run-1", "run-1", "ready", "+run 1"),
      makeArtifact("patch-run-2", "run-2", "ready", "+run 2"),
    ]);
    store.syncArtifacts([
      makeArtifact("patch-run-1", "run-1", "applied", "+run 1"),
      makeArtifact("patch-run-2", "run-2", "ready", "+run 2"),
    ]);

    const previews = useAIInlinePatchStore.getState().previews;
    useAIInlinePatchStore.setState({ previews: {}, dismissedIds: {} });
    return Object.keys(previews).sort();
  });

  expect(result).toEqual(["patch-run-2"]);
});

test("AI inline patch artifact sync prunes previews outside current scope", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIInlinePatchStore } =
      await import("/src/stores/aiInlinePatchStore.ts");
    const store = useAIInlinePatchStore.getState();
    const artifact = {
      id: "patch-stale",
      runId: "run-1",
      sessionId: "default",
      projectSessionId: "main",
      kind: "patch_preview",
      status: "ready",
      title: "stale",
      summary: "stale",
      payloadJson: JSON.stringify({
        unifiedDiff: "+stale",
        checkReady: true,
        files: [{ path: "stale.md", status: "modify", exists: true }],
      }),
      createdAt: "2026-05-18T00:00:00Z",
      updatedAt: "2026-05-18T00:00:00Z",
    };

    useAIInlinePatchStore.setState({ previews: {}, dismissedIds: {} });
    store.syncArtifacts([artifact]);
    store.syncArtifacts([]);
    const previews = useAIInlinePatchStore.getState().previews;
    useAIInlinePatchStore.setState({ previews: {}, dismissedIds: {} });
    return Object.keys(previews);
  });

  expect(result).toEqual([]);
});

test("AI inline patch artifact event upsert preserves other previews and acknowledgements", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIInlinePatchStore } =
      await import("/src/stores/aiInlinePatchStore.ts");
    const store = useAIInlinePatchStore.getState();
    const makeArtifact = (id: string, status = "ready") => ({
      id,
      runId: `run-${id}`,
      sessionId: "default",
      projectSessionId: "main",
      kind: "patch_preview",
      status,
      title: id,
      summary: id,
      payloadJson: JSON.stringify({
        unifiedDiff: `diff --git a/${id}.md b/${id}.md\n--- a/${id}.md\n+++ b/${id}.md\n@@ -1 +1,2 @@\n old\n+new\n`,
        checkReady: true,
        files: [{ path: `${id}.md`, status: "modify", exists: true }],
      }),
      createdAt: "2026-05-18T00:00:00Z",
      updatedAt: "2026-05-18T00:00:00Z",
    });

    useAIInlinePatchStore.setState({ previews: {}, dismissedIds: {} });
    store.upsertArtifact(makeArtifact("patch-one"));
    store.upsertArtifact(makeArtifact("patch-two"));
    store.upsertArtifact(makeArtifact("patch-one", "applied"));
    const afterApplied = Object.keys(
      useAIInlinePatchStore.getState().previews,
    ).sort();

    store.acknowledgePreview("patch-two", { projectSessionId: "main" });
    store.upsertArtifact(makeArtifact("patch-two"));
    const afterAcknowledged = Object.keys(
      useAIInlinePatchStore.getState().previews,
    ).sort();
    const dismissed = Object.keys(useAIInlinePatchStore.getState().dismissedIds)
      .map((key) => key.replace("\0", ":"))
      .sort();
    useAIInlinePatchStore.setState({ previews: {}, dismissedIds: {} });
    return { afterAcknowledged, afterApplied, dismissed };
  });

  expect(result).toEqual({
    afterApplied: ["patch-two"],
    afterAcknowledged: [],
    dismissed: ["main:patch-two"],
  });
});

test("AI inline patch previews are scoped by project session and exact project paths", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const {
      resolveAIInlinePatchFilePath,
      selectAIInlinePatchPreviewForPath,
      useAIInlinePatchStore,
    } = await import("/src/stores/aiInlinePatchStore.ts");
    const store = useAIInlinePatchStore.getState();
    const makeArtifact = (
      id: string,
      projectSessionId: string,
      patchPath = "src/main.ts",
    ) => ({
      id,
      runId: `run-${id}`,
      sessionId: "default",
      projectSessionId,
      kind: "patch_preview",
      status: "ready",
      title: id,
      summary: id,
      payloadJson: JSON.stringify({
        unifiedDiff: `diff --git a/${patchPath} b/${patchPath}\n--- a/${patchPath}\n+++ b/${patchPath}\n@@ -1 +1,2 @@\n old\n+new\n`,
        checkReady: true,
        files: [{ path: patchPath, status: "modify", exists: true }],
      }),
      createdAt: "2026-05-18T00:00:00Z",
      updatedAt: "2026-05-18T00:00:00Z",
    });

    useAIInlinePatchStore.setState({ previews: {}, dismissedIds: {} });
    store.syncArtifacts([makeArtifact("patch-a", "project-a")], {
      projectSessionId: "project-a",
    });
    store.syncArtifacts([makeArtifact("patch-b", "project-b")], {
      projectSessionId: "project-b",
    });
    store.syncArtifacts([], { projectSessionId: "project-a" });

    const remainingAfterScopedPrune = Object.keys(
      useAIInlinePatchStore.getState().previews,
    );
    const wrongProjectPath =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/project-a/src/main.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;
    const exactProjectPath =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/project-b/src/main.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;
    store.upsertArtifact(
      makeArtifact(
        "patch-absolute",
        "project-b",
        "/workspace/project-b/src/absolute.ts",
      ),
      { projectSessionId: "project-b" },
    );
    const absoluteProjectPath =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/project-b/src/absolute.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;
    const absoluteWrongProjectPath =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/project-a/src/absolute.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;
    store.upsertArtifact(
      makeArtifact(
        "patch-outside-root",
        "project-b",
        "/workspace/other/src/escape.ts",
      ),
      { projectSessionId: "project-b" },
    );
    const outsideRootPath =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/other/src/escape.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;
    store.upsertArtifact(
      makeArtifact("patch-top-level-a", "project-b", "a/foo.ts"),
      {
        projectSessionId: "project-b",
      },
    );
    const topLevelADirectoryPath =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/project-b/a/foo.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;
    const strippedTopLevelADirectoryPath = resolveAIInlinePatchFilePath(
      "/workspace/project-b",
      "a/foo.ts",
    );
    const rawDiffTopLevelADirectoryPath = resolveAIInlinePatchFilePath(
      "/workspace/project-b",
      "a/foo.ts",
      { stripGitPrefix: true },
    );
    store.upsertArtifact(
      makeArtifact("patch-case", "project-b", "src/CaseFile.ts"),
      {
        projectSessionId: "project-b",
      },
    );
    const caseInsensitiveProjectPath =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/project-b/src/casefile.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;
    store.upsertArtifact(
      makeArtifact("patch-missing-session", "", "src/missing.ts"),
      { projectSessionId: "project-b" },
    );
    const missingProjectSessionPath =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/project-b/src/missing.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;
    store.upsertArtifact(
      makeArtifact("patch-shared", "project-a", "src/shared.ts"),
      {
        projectSessionId: "project-a",
      },
    );
    store.acknowledgePreview("patch-shared", {
      projectSessionId: "project-a",
    });
    store.upsertArtifact(
      makeArtifact("patch-shared", "project-b", "src/shared.ts"),
      {
        projectSessionId: "project-b",
      },
    );
    const sharedIdAfterOtherProjectDismiss =
      selectAIInlinePatchPreviewForPath(
        useAIInlinePatchStore.getState().previews,
        "/workspace/project-b/src/shared.ts",
        { projectPath: "/workspace/project-b", projectSessionId: "project-b" },
      )?.id ?? null;

    useAIInlinePatchStore.setState({ previews: {}, dismissedIds: {} });
    return {
      absoluteProjectPath,
      absoluteWrongProjectPath,
      caseInsensitiveProjectPath,
      exactProjectPath,
      missingProjectSessionPath,
      outsideRootPath,
      rawDiffTopLevelADirectoryPath,
      remainingAfterScopedPrune,
      sharedIdAfterOtherProjectDismiss,
      strippedTopLevelADirectoryPath,
      topLevelADirectoryPath,
      wrongProjectPath,
    };
  });

  expect(result).toEqual({
    absoluteProjectPath: "patch-absolute",
    absoluteWrongProjectPath: null,
    caseInsensitiveProjectPath: "patch-case",
    exactProjectPath: "patch-b",
    missingProjectSessionPath: null,
    outsideRootPath: null,
    rawDiffTopLevelADirectoryPath: "/workspace/project-b/foo.ts",
    remainingAfterScopedPrune: ["patch-b"],
    sharedIdAfterOtherProjectDismiss: "patch-shared",
    strippedTopLevelADirectoryPath: "/workspace/project-b/a/foo.ts",
    topLevelADirectoryPath: "patch-top-level-a",
    wrongProjectPath: null,
  });
});

test("AI inline patch busy lock is shared across surfaces", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { useAIInlinePatchStore } =
      await import("/src/stores/aiInlinePatchStore.ts");
    useAIInlinePatchStore.setState({
      previews: {},
      dismissedIds: {},
      busyIds: {},
    });
    const store = useAIInlinePatchStore.getState();
    const firstAcquire = store.beginBusy("patch-one");
    const secondAcquire = store.beginBusy("patch-one");
    const busyWhileHeld = Object.keys(useAIInlinePatchStore.getState().busyIds);
    store.endBusy("patch-one");
    const thirdAcquire = store.beginBusy("patch-one");
    const busyAfterRelease = Object.keys(
      useAIInlinePatchStore.getState().busyIds,
    );
    useAIInlinePatchStore.setState({
      previews: {},
      dismissedIds: {},
      busyIds: {},
    });
    return {
      busyAfterRelease,
      busyWhileHeld,
      firstAcquire,
      secondAcquire,
      thirdAcquire,
    };
  });

  expect(result).toEqual({
    busyAfterRelease: ["patch-one"],
    busyWhileHeld: ["patch-one"],
    firstAcquire: true,
    secondAcquire: false,
    thirdAcquire: true,
  });
});
