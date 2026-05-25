package ai

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"arlecchino/internal/ai/agents"
)

func TestBuildFollowupUsesRecentSessionHistoryRegression(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	provider := replaceLocalProviderWithRecorder(t, service, "Сделаю через узкий patch preview.", nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	first, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		SessionID: "session-build",
		Action:    AIChatActionBuild,
		Prompt:    "Добавь проверку пустого sessionId в AI chat history restore.",
		Context: AIContextRequest{
			FilePath: "frontend/src/components/ai-chat/AIChatPanel.tsx",
			FullText: "function AIChatPanelContent() { return null }\n",
			ContextItems: []AIContextItemRequest{
				{Kind: AIContextItemKindFile, Label: "AIChatPanel.tsx", Path: "frontend/src/components/ai-chat/AIChatPanel.tsx", Source: "composer"},
			},
		},
	})
	if err != nil {
		t.Fatalf("StartChatRun first: %v", err)
	}
	if final := waitForRunStatus(t, service, first.ID); final.Status != "completed" {
		t.Fatalf("first run = %#v", final)
	}

	provider.text = "Продолжу тот же history restore вариант."
	second, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		SessionID: "session-build",
		Action:    AIChatActionBuild,
		Prompt:    "А если так?",
	})
	if err != nil {
		t.Fatalf("StartChatRun second: %v", err)
	}
	if final := waitForRunStatus(t, service, second.ID); final.Status != "completed" {
		t.Fatalf("second run = %#v", final)
	}

	request := provider.requestAt(1)
	for _, want := range []string{
		chatHistoryOpenTag,
		"Recent same-session history. Use it to resolve short follow-up requests before asking for missing context.",
		"Добавь проверку пустого sessionId",
		"Сделаю через узкий patch preview.",
		"frontend/src/components/ai-chat/AIChatPanel.tsx",
		"А если так?",
	} {
		if !strings.Contains(request.Prompt, want) {
			t.Fatalf("build follow-up prompt missing %q: %q", want, request.Prompt)
		}
	}
	for _, want := range []string{
		"Selected chat mode: Build.",
		"Conversation continuity boundary:",
		"first resolve it against the recent same-session turns",
		"name the exact missing file, behavior, bug, or decision",
	} {
		if !strings.Contains(request.System, want) {
			t.Fatalf("build follow-up system missing %q: %q", want, request.System)
		}
	}
}

func TestBuildWithoutHistoryGetsExplicitMissingContextInstructionRegression(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	provider := replaceLocalProviderWithRecorder(t, service, "Нужен конкретный файл или поведение.", nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		SessionID: "empty-build",
		Action:    AIChatActionBuild,
		Prompt:    "А если так?",
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	if final := waitForRunStatus(t, service, run.ID); final.Status != "completed" {
		t.Fatalf("run = %#v", final)
	}

	request := provider.requestAt(0)
	if strings.Contains(request.Prompt, chatHistoryOpenTag) {
		t.Fatalf("empty session should not invent history: %q", request.Prompt)
	}
	if !strings.Contains(request.System, "name the exact missing file, behavior, bug, or decision") {
		t.Fatalf("missing exact-context instruction: %q", request.System)
	}
}

func TestCompactedFollowupUsesContinuityCapsuleWithoutHistoryReplay(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	provider := replaceLocalProviderWithRecorder(t, service, "Первый ответ про restore session id.", nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	first, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		SessionID: "capsule-session",
		Action:    AIChatActionBuild,
		Prompt:    "Почини восстановление активной AI chat session после compact.",
	})
	if err != nil {
		t.Fatalf("StartChatRun first: %v", err)
	}
	if final := waitForRunStatus(t, service, first.ID); final.Status != "completed" {
		t.Fatalf("first run = %#v", final)
	}
	if _, err := service.AICompactChatSession("main", AIContextCompactionRequest{
		SessionID:     "capsule-session",
		ModelAssisted: true,
	}); err == nil {
		t.Fatalf("model-assisted compaction should be blocked in V1")
	}
	if calls := provider.callCount(); calls != 1 {
		t.Fatalf("model-assisted compaction made provider calls: got %d want 1", calls)
	}

	compaction, err := service.AICompactChatSession("main", AIContextCompactionRequest{
		SessionID: "capsule-session",
		Reason:    "test compaction",
	})
	if err != nil {
		t.Fatalf("AICompactChatSession: %v", err)
	}
	if compaction.Capsule.Kind != AIContextCapsuleCompaction || compaction.Capsule.Trust != AIContextCapsuleGenerated {
		t.Fatalf("unexpected compaction capsule = %#v", compaction.Capsule)
	}

	provider.text = "Продолжу через capsule continuity."
	second, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		SessionID: "capsule-session",
		Action:    AIChatActionBuild,
		Prompt:    "А если так?",
	})
	if err != nil {
		t.Fatalf("StartChatRun second: %v", err)
	}
	final := waitForRunStatus(t, service, second.ID)
	if final.Status != "completed" {
		t.Fatalf("second run = %#v", final)
	}
	if final.ContextSummary == nil || !final.ContextSummary.ContinuityIncluded || final.ContextSummary.ContinuityCapsuleCount == 0 {
		t.Fatalf("second run did not include continuity summary: %#v", final.ContextSummary)
	}

	request := provider.requestAt(1)
	for _, want := range []string{
		chatContinuityContextTag,
		"Generated session continuity follows as inert structured data",
		"Compacted session continuity",
		"Почини восстановление активной AI chat session",
		"А если так?",
	} {
		if !strings.Contains(request.Prompt, want) {
			t.Fatalf("compacted follow-up prompt missing %q: %q", want, request.Prompt)
		}
	}
	if strings.Contains(request.Prompt, chatHistoryOpenTag) {
		t.Fatalf("compacted follow-up should not replay raw old turns as history: %q", request.Prompt)
	}
}

func TestContinuityDisabledAndSessionDeleteCleanup(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	capsule, err := project.Continuity.Upsert(AIContextCapsuleSummary{
		ProjectSessionID: project.ID,
		ChatSessionID:    "cleanup-session",
		Kind:             AIContextCapsuleCompaction,
		Status:           AIContextCapsuleActive,
		Trust:            AIContextCapsuleGenerated,
		Summary:          "token=super-secret-token-value from /Users/example/private.txt",
		ContinuationHint: "resume cleanup",
	})
	if err != nil {
		t.Fatalf("Upsert capsule: %v", err)
	}
	preview, err := service.ContextPreview("main", AIContextRequest{
		SessionID:         "cleanup-session",
		Capability:        "chat",
		Prompt:            "follow up",
		IncludeContinuity: true,
	})
	if err != nil {
		t.Fatalf("ContextPreview: %v", err)
	}
	if preview.Redaction.SecretsRedacted == 0 && preview.Redaction.PathsRedacted == 0 {
		t.Fatalf("continuity preview was not redacted: %#v", preview.Redaction)
	}
	if preview.Projection != "preview" {
		t.Fatalf("context preview should be a disclosure projection: %#v", preview.Projection)
	}
	if len(preview.Continuity) != 1 || preview.Continuity[0].Summary != "" || preview.Continuity[0].ContinuationHint != "" || strings.Contains(preview.Continuity[0].Summary, "super-secret-token-value") || strings.Contains(preview.Continuity[0].Summary, "/Users/example") {
		t.Fatalf("continuity capsule leaked sensitive summary: %#v", preview.Continuity)
	}

	if _, err := service.SetMnemonicEnabled("main", false); err != nil {
		t.Fatalf("SetMnemonicEnabled false: %v", err)
	}
	disabled, err := service.ContextPreview("main", AIContextRequest{
		SessionID:         "cleanup-session",
		Capability:        "chat",
		Prompt:            "follow up",
		IncludeContinuity: true,
	})
	if err != nil {
		t.Fatalf("disabled ContextPreview: %v", err)
	}
	if len(disabled.Continuity) != 0 {
		t.Fatalf("disabled Mnemonic should block continuity reads: %#v", disabled.Continuity)
	}

	if _, err := service.SetMnemonicEnabled("main", true); err != nil {
		t.Fatalf("SetMnemonicEnabled true: %v", err)
	}
	if _, err := project.Continuity.Upsert(capsule); err != nil {
		t.Fatalf("restore capsule: %v", err)
	}
	if err := service.DeleteChatSession("main", "cleanup-session"); err != nil {
		t.Fatalf("DeleteChatSession: %v", err)
	}
	capsules, err := service.AIListContextCapsules("main", "cleanup-session", 10)
	if err != nil {
		t.Fatalf("AIListContextCapsules: %v", err)
	}
	if len(capsules) != 0 {
		t.Fatalf("DeleteChatSession left continuity capsules: %#v", capsules)
	}
}

func TestAutoCompactionRunsBeforeProviderRequest(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	provider := replaceLocalProviderWithRecorder(t, service, "auto compacted response", nil)
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	for i := 0; i < contextAutoCompactActiveTurnsThreshold; i++ {
		upsertTestTurnCapsule(t, project, "auto-compact-session", "restore-session-history", i, AIContextCapsuleActive)
	}

	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		SessionID: "auto-compact-session",
		Action:    AIChatActionBuild,
		Prompt:    "Continue the restore-session-history work.",
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	if final := waitForRunStatus(t, service, run.ID); final.Status != "completed" {
		t.Fatalf("run = %#v", final)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	request := provider.requestAt(0)
	for _, want := range []string{"Compacted session continuity", "restore-session-history", "Continue the restore-session-history work."} {
		if !strings.Contains(request.Prompt, want) {
			t.Fatalf("auto-compacted provider prompt missing %q:\n%s", want, request.Prompt)
		}
	}
	capsules, err := project.Continuity.List(project.ID, "auto-compact-session", 32)
	if err != nil {
		t.Fatalf("List capsules: %v", err)
	}
	activeCompactions := 0
	supersededTurns := 0
	for _, capsule := range capsules {
		if capsule.Kind == AIContextCapsuleCompaction && capsule.Status == AIContextCapsuleActive {
			activeCompactions++
		}
		if capsule.Kind == AIContextCapsuleTurn && capsule.Status == AIContextCapsuleSuperseded {
			supersededTurns++
		}
	}
	if activeCompactions != 1 || supersededTurns != contextAutoCompactActiveTurnsThreshold {
		t.Fatalf("compaction state active=%d supersededTurns=%d capsules=%#v", activeCompactions, supersededTurns, capsules)
	}
}

func TestRepeatedCompactionIsCumulative(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	upsertTestTurnCapsule(t, project, "cumulative-session", "first continuity decision", 1, AIContextCapsuleActive)
	if _, err := service.AICompactChatSession("main", AIContextCompactionRequest{SessionID: "cumulative-session", Reason: "first"}); err != nil {
		t.Fatalf("first compaction: %v", err)
	}
	upsertTestTurnCapsule(t, project, "cumulative-session", "second continuity decision", 2, AIContextCapsuleActive)
	second, err := service.AICompactChatSession("main", AIContextCompactionRequest{SessionID: "cumulative-session", Reason: "second"})
	if err != nil {
		t.Fatalf("second compaction: %v", err)
	}
	for _, want := range []string{"first continuity decision", "second continuity decision"} {
		if !strings.Contains(second.Capsule.Summary, want) {
			t.Fatalf("cumulative compaction missing %q: %s", want, second.Capsule.Summary)
		}
	}
	capsules, err := project.Continuity.List(project.ID, "cumulative-session", 32)
	if err != nil {
		t.Fatalf("List capsules: %v", err)
	}
	activeCompactions := 0
	supersededCompactions := 0
	for _, capsule := range capsules {
		if capsule.Kind != AIContextCapsuleCompaction {
			continue
		}
		if capsule.Status == AIContextCapsuleActive {
			activeCompactions++
		}
		if capsule.Status == AIContextCapsuleSuperseded {
			supersededCompactions++
		}
	}
	if activeCompactions != 1 || supersededCompactions != 1 {
		t.Fatalf("compaction lifecycle active=%d superseded=%d capsules=%#v", activeCompactions, supersededCompactions, capsules)
	}
}

func TestExpiredCapsulesAreNotSelectedOrCompacted(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	expired := upsertTestTurnCapsule(t, project, "expiry-session", "expired continuity", 1, AIContextCapsuleActive)
	expired.ExpiresAt = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	if _, err := project.Continuity.Upsert(expired); err != nil {
		t.Fatalf("expire capsule: %v", err)
	}
	valid := upsertTestTurnCapsule(t, project, "expiry-session", "valid continuity", 2, AIContextCapsuleActive)
	result, err := service.AICompactChatSession("main", AIContextCompactionRequest{SessionID: "expiry-session"})
	if err != nil {
		t.Fatalf("AICompactChatSession: %v", err)
	}
	if containsString(result.CompactedCapsuleIDs, expired.ID) || !containsString(result.CompactedCapsuleIDs, valid.ID) {
		t.Fatalf("compacted sources = %#v, expired=%s valid=%s", result.CompactedCapsuleIDs, expired.ID, valid.ID)
	}
	snapshot := service.buildContextSnapshot(project, AIContextRequest{
		SessionID:         "expiry-session",
		Capability:        "chat",
		Prompt:            "continue valid continuity",
		IncludeContinuity: true,
	})
	for _, capsule := range snapshot.Continuity {
		if capsule.ID == expired.ID || capsule.Status == AIContextCapsuleExpired {
			t.Fatalf("expired capsule selected: %#v", snapshot.Continuity)
		}
	}
}

func TestContextOverflowBlocksBeforeProviderEgress(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	descriptor := service.descriptors["local-test"]
	descriptor.Models[0].ContextWindow = 1
	service.descriptors[descriptor.ID] = descriptor
	provider := replaceLocalProviderWithRecorder(t, service, "should not run", nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}

	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		SessionID: "overflow-session",
		Action:    AIChatActionBuild,
		Prompt:    strings.Repeat("overflow ", 50),
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	if final.Status != "error" || !strings.Contains(final.Error, "context exceeds model window") {
		t.Fatalf("run = %#v", final)
	}
	if provider.callCount() != 0 {
		t.Fatalf("provider should not be called, calls=%d", provider.callCount())
	}
}

func TestExternalAgentUsesPreparedCompactedContext(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	if _, err := service.SaveConsentPolicy(AIConsentPolicy{ExternalAgentCLIAccepted: true}); err != nil {
		t.Fatalf("SaveConsentPolicy: %v", err)
	}
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	for i := 0; i < contextAutoCompactActiveTurnsThreshold; i++ {
		upsertTestTurnCapsule(t, project, "agent-compact-session", "external-agent-continuity", i, AIContextCapsuleActive)
	}
	adapter := &fakeCompletedAgentAdapter{id: "agent-cli-continuity"}
	service.agents.Register(adapter)

	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		SessionID:         "agent-compact-session",
		Action:            AIChatActionAsk,
		RuntimeFamily:     agents.RuntimeFamilyJSONLExec,
		ProviderID:        adapter.id,
		Prompt:            "continue via external agent",
		IncludeContinuity: true,
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	if final := waitForAgentRunStatus(t, service, run.ID); final.Status != "completed" {
		t.Fatalf("run = %#v", final)
	}
	for _, want := range []string{"Compacted session continuity", "external-agent-continuity", "continue via external agent"} {
		if !strings.Contains(adapter.lastPrompt, want) {
			t.Fatalf("external agent prompt missing %q:\n%s", want, adapter.lastPrompt)
		}
	}
}

func TestContinuityRetrievalFiltersAndScoresCapsules(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	upsertTestTurnCapsule(t, project, "retrieval-session", "irrelevant newer topic", 10, AIContextCapsuleActive)
	relevant := upsertTestTurnCapsule(t, project, "retrieval-session", "parser restore target file", 1, AIContextCapsuleActive)
	relevant.SourceRefs = append(relevant.SourceRefs, AIContextCapsuleSourceRef{Kind: "file", Path: "internal/parser/restore.go", Label: "restore.go"})
	relevant.RetrievalTags = append(relevant.RetrievalTags, "restore.go")
	if _, err := project.Continuity.Upsert(relevant); err != nil {
		t.Fatalf("Upsert relevant capsule: %v", err)
	}
	upsertTestTurnCapsule(t, project, "retrieval-session", "parser stale", 2, AIContextCapsuleStale)
	upsertTestTurnCapsule(t, project, "retrieval-session", "parser superseded", 3, AIContextCapsuleSuperseded)

	snapshot := service.buildContextSnapshot(project, AIContextRequest{
		SessionID:         "retrieval-session",
		Capability:        "chat",
		Action:            AIChatActionBuild,
		Prompt:            "continue parser restore work",
		FilePath:          "internal/parser/restore.go",
		IncludeContinuity: true,
	})
	if len(snapshot.Continuity) == 0 || !strings.Contains(snapshot.Continuity[0].Summary, "parser restore target file") {
		t.Fatalf("relevant capsule was not ranked first: %#v", snapshot.Continuity)
	}
	for _, capsule := range snapshot.Continuity {
		if capsule.Status != AIContextCapsuleActive {
			t.Fatalf("non-active capsule selected: %#v", capsule)
		}
		if strings.Contains(capsule.Summary, "stale") || strings.Contains(capsule.Summary, "superseded") {
			t.Fatalf("filtered capsule leaked into context: %#v", snapshot.Continuity)
		}
	}
}

func TestContinuityPrivacyBudgetKeepsSelectedCapsuleNonEmpty(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	if _, err := project.Continuity.Upsert(AIContextCapsuleSummary{
		ProjectSessionID: project.ID,
		ChatSessionID:    "budget-session",
		Kind:             AIContextCapsuleCompaction,
		Status:           AIContextCapsuleActive,
		Trust:            AIContextCapsuleGenerated,
		Summary:          "token=super-secret-token-value from /Users/example/private.txt " + strings.Repeat("continuity ", 40),
		ContinuationHint: "resume budget continuity",
		CreatedAt:        time.Now().UTC().Format(time.RFC3339),
		UpdatedAt:        time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("Upsert capsule: %v", err)
	}
	snapshot := service.buildContextSnapshot(project, AIContextRequest{
		SessionID:         "budget-session",
		Capability:        "chat",
		Prompt:            strings.Repeat("prompt ", 200),
		IncludeContinuity: true,
		MaxBytes:          128,
	})
	if len(snapshot.Continuity) != 1 || strings.TrimSpace(snapshot.Continuity[0].Summary+snapshot.Continuity[0].ContinuationHint) == "" {
		t.Fatalf("continuity budget erased selected capsule: %#v", snapshot.Continuity)
	}
	if strings.Contains(snapshot.Continuity[0].Summary, "super-secret-token-value") || strings.Contains(snapshot.Continuity[0].Summary, "/Users/example") {
		t.Fatalf("continuity budget leaked sensitive content: %#v", snapshot.Continuity[0])
	}
}

func TestContinuityFTSUnavailableReportsDegradedFallback(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	relevant := upsertTestTurnCapsule(t, project, "fts-fallback-session", "fallback restore target", 1, AIContextCapsuleActive)
	if _, err := project.Continuity.db.Exec(`DROP TABLE ai_context_capsules_fts`); err != nil {
		t.Fatalf("drop FTS table: %v", err)
	}
	selection, err := project.Continuity.SelectForSession(contextCapsuleSelectionRequest{
		ProjectSessionID: project.ID,
		SessionID:        "fts-fallback-session",
		Prompt:           "fallback restore target",
		Limit:            4,
	})
	if err != nil {
		t.Fatalf("SelectForSession: %v", err)
	}
	if len(selection.Capsules) == 0 || selection.Capsules[0].ID != relevant.ID {
		t.Fatalf("fallback selection = %#v, want %s", selection.Capsules, relevant.ID)
	}
	if !strings.Contains(selection.PolicyReason, "ftsDegraded=true") {
		t.Fatalf("policy reason missing FTS degradation: %s", selection.PolicyReason)
	}
}

func TestConcurrentCompactionLeavesOneActiveCompaction(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	for i := 0; i < 6; i++ {
		upsertTestTurnCapsule(t, project, "concurrent-session", "concurrent continuity", i, AIContextCapsuleActive)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := service.AICompactChatSession("main", AIContextCompactionRequest{SessionID: "concurrent-session"})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent compaction error: %v", err)
		}
	}
	capsules, err := project.Continuity.List(project.ID, "concurrent-session", 32)
	if err != nil {
		t.Fatalf("List capsules: %v", err)
	}
	activeCompactions := 0
	for _, capsule := range capsules {
		if capsule.Kind == AIContextCapsuleCompaction && capsule.Status == AIContextCapsuleActive {
			activeCompactions++
		}
	}
	if activeCompactions != 1 {
		t.Fatalf("active compactions = %d, capsules=%#v", activeCompactions, capsules)
	}
}

func upsertTestTurnCapsule(t *testing.T, project *ProjectSession, sessionID string, summary string, offset int, status AIContextCapsuleStatus) AIContextCapsuleSummary {
	t.Helper()
	createdAt := time.Now().UTC().Add(time.Duration(offset) * time.Second).Format(time.RFC3339)
	capsule := AIContextCapsuleSummary{
		ProjectSessionID: project.ID,
		ChatSessionID:    sessionID,
		Kind:             AIContextCapsuleTurn,
		Status:           status,
		Trust:            AIContextCapsuleGenerated,
		Summary:          summary,
		ContinuationHint: "resume " + summary,
		RetrievalTags:    []string{"build", summary},
		CreatedAt:        createdAt,
		UpdatedAt:        createdAt,
	}
	capsule, err := project.Continuity.Upsert(capsule)
	if err != nil {
		t.Fatalf("Upsert test capsule: %v", err)
	}
	return capsule
}
