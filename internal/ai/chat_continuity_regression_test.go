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
