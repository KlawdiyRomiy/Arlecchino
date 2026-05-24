package ai

import (
	"strings"
	"testing"

	"arlecchino/internal/ai/providers"
)

func TestContextWindowForBudgetInfersSelectedModelBeforeHint(t *testing.T) {
	descriptor := providers.AIProviderDescriptor{
		Kind:         "openai",
		DefaultModel: "gpt-5.5",
	}
	if got := contextWindowForBudget(descriptor, "gpt-5.5", 287_000); got != 1_050_000 {
		t.Fatalf("contextWindowForBudget = %d, want inferred provider model window", got)
	}
}

func TestContextWindowForBudgetUsesExplicitDescriptorWindow(t *testing.T) {
	descriptor := providers.AIProviderDescriptor{
		Kind: "custom",
		Models: []providers.AIModelDescriptor{
			{ID: "custom-long", ContextWindow: 777_000},
		},
		DefaultModel: "custom-long",
	}
	if got := contextWindowForBudget(descriptor, "custom-long", 287_000); got != 777_000 {
		t.Fatalf("contextWindowForBudget = %d, want explicit descriptor window", got)
	}
}

func TestExternalAgentPromptIncludesRecentHistory(t *testing.T) {
	prompt := buildExternalAgentPrompt(
		AIChatRunRequest{Action: AIChatActionAsk, Prompt: "А теперь продолжи"},
		AIContextSnapshot{Prompt: "А теперь продолжи"},
		AIContextSummary{},
		[]AIChatRun{{
			UserPrompt: "Привет",
			Response:   "Здравствуйте, чем помочь?",
			Status:     "completed",
		}},
	)
	for _, want := range []string{"<arlecchino_history>", "Привет", "Здравствуйте, чем помочь?", "<arlecchino_current_request>"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("external agent prompt did not include %q:\n%s", want, prompt)
		}
	}
}

func TestModelAPIPromptAndMessagesIncludeRecentHistory(t *testing.T) {
	history := []AIChatRun{{
		UserPrompt: "Привет",
		Response:   "Здравствуйте, чем помочь?",
		Status:     "completed",
	}}
	snapshot := AIContextSnapshot{Prompt: "А теперь продолжи"}
	prompt := buildChatPromptFromSnapshot(snapshot, history)
	for _, want := range []string{"<arlecchino_history>", "Привет", "Здравствуйте, чем помочь?", "<arlecchino_current_request>"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("model API prompt did not include %q:\n%s", want, prompt)
		}
	}
	messages := buildChatMessagesFromSnapshot(snapshot, history)
	if len(messages) < 3 {
		t.Fatalf("messages = %#v, want history user/assistant plus current request", messages)
	}
	if messages[0].Role != "user" || !strings.Contains(messages[0].Content, "Привет") {
		t.Fatalf("first history message = %#v", messages[0])
	}
	if messages[1].Role != "assistant" || !strings.Contains(messages[1].Content, "Здравствуйте") {
		t.Fatalf("assistant history message = %#v", messages[1])
	}
	if messages[len(messages)-1].Role != "user" || !strings.Contains(messages[len(messages)-1].Content, "А теперь продолжи") {
		t.Fatalf("current request message = %#v", messages[len(messages)-1])
	}
}
