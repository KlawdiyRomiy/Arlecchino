package providers

import "testing"

func TestInferModelContextWindow(t *testing.T) {
	tests := []struct {
		name  string
		kind  string
		model string
		want  int
	}{
		{name: "openai gpt 5.5", kind: "openai", model: "gpt-5.5", want: 1_050_000},
		{name: "openrouter namespaced gpt 5.5", kind: "openrouter", model: "openai/gpt-5.5", want: 1_050_000},
		{name: "anthropic sonnet million token", kind: "anthropic", model: "claude-sonnet-4-6-20251201", want: 1_000_000},
		{name: "gemini models prefix", kind: "google-gemini", model: "models/gemini-2.5-pro", want: 1_048_576},
		{name: "unknown", kind: "unknown", model: "future-model", want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := InferModelContextWindow(tt.kind, tt.model); got != tt.want {
				t.Fatalf("InferModelContextWindow(%q, %q) = %d, want %d", tt.kind, tt.model, got, tt.want)
			}
		})
	}
}

func TestEnrichModelDescriptorPreservesExplicitContextWindow(t *testing.T) {
	model := EnrichModelDescriptor("google-gemini", AIModelDescriptor{
		ID:            "gemini-2.5-pro",
		ContextWindow: 123_456,
	})
	if model.ContextWindow != 123_456 {
		t.Fatalf("ContextWindow = %d, want explicit value preserved", model.ContextWindow)
	}
}
