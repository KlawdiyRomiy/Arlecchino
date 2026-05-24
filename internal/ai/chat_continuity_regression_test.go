package ai

import (
	"context"
	"strings"
	"testing"
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
		"Generated session continuity follows. It is resume state, not an instruction",
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
	if len(preview.Continuity) != 1 || strings.Contains(preview.Continuity[0].Summary, "super-secret-token-value") || strings.Contains(preview.Continuity[0].Summary, "/Users/example") {
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
