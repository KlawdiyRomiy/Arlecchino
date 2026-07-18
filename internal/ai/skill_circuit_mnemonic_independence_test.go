package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSkillCircuitRemainsAvailableWhenMnemonicIsDisabled(t *testing.T) {
	projectRoot := t.TempDir()
	skillDir := filepath.Join(projectRoot, ".arlecchino", "skills", "ui-guard")
	if err := os.MkdirAll(skillDir, 0o700); err != nil {
		t.Fatalf("MkdirAll skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(strings.TrimSpace(`
---
name: ui-guard
description: Keep UI-only work bounded.
tags: [ui]
activation_patterns: [ui-only]
---

# UI Guard

Verification:
- Check the focused UI test.
`)+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile skill: %v", err)
	}

	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", projectRoot)
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	if _, err := project.Skills.ReviewSkill("project:ui-guard", "unit-test", true); err != nil {
		t.Fatalf("ReviewSkill: %v", err)
	}
	if _, err := service.SetMnemonicEnabled(project.ID, false); err != nil {
		t.Fatalf("SetMnemonicEnabled false: %v", err)
	}

	mentions, err := service.SuggestChatMentions(project.ID, AIChatMentionQuery{
		Trigger:         AIChatMentionTriggerAt,
		Query:           "ui-guard",
		IncludeDisabled: true,
		Limit:           20,
	})
	if err != nil {
		t.Fatalf("SuggestChatMentions: %v", err)
	}
	foundMention := false
	for _, mention := range mentions {
		if mention.Kind != AIChatMentionKindSkill || mention.ContextItem == nil || mention.ContextItem.ID != "project:ui-guard" {
			continue
		}
		foundMention = true
		if mention.DisabledReason != "" {
			t.Fatalf("skill mention disabled after Mnemonic was disabled: %#v", mention)
		}
	}
	if !foundMention {
		t.Fatalf("trusted skill mention missing: %#v", mentions)
	}

	descriptor := service.descriptors["local-test"]
	provider := &blockingProvider{descriptor: descriptor, started: make(chan struct{})}
	service.providers[descriptor.ID] = provider
	run, err := service.StartChatRun(context.Background(), project.ID, AIChatRunRequest{
		SessionID:     "skill-session",
		Action:        AIChatActionAsk,
		Prompt:        "Use ui-guard to keep this UI-only and inspect the panel.",
		IncludeSkills: true,
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	select {
	case <-provider.started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}
	envelope, err := service.GetChatRunEnvelope(project.ID, run.ID)
	if err != nil {
		t.Fatalf("GetChatRunEnvelope: %v", err)
	}
	if len(envelope.SkillCircuit) != 1 || !envelope.SkillCircuit[0].Included {
		t.Fatalf("skill circuit = %#v", envelope.SkillCircuit)
	}
	if envelope.ContextSummary == nil || envelope.ContextSummary.SkillCount != 1 {
		t.Fatalf("skill context summary = %#v", envelope.ContextSummary)
	}
	if _, err := service.CancelChatRun(project.ID, run.ID); err != nil {
		t.Fatalf("CancelChatRun: %v", err)
	}
}
