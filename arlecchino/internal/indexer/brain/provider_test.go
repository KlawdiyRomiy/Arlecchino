package brain

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOllamaProvider_Creation(t *testing.T) {
	p := NewOllamaProvider("", "")

	if p.Name() != "ollama" {
		t.Errorf("expected name 'ollama', got %s", p.Name())
	}

	if !p.IsLocal() {
		t.Error("ollama should be local")
	}

	if !p.IsAvailable() {
		t.Error("ollama should be available by default")
	}
}

func TestOllamaProvider_Complete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/generate" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"response": "fmt.Println(\"test\")\nfmt.Printf()", "done": true}`))
	}))
	defer server.Close()

	p := NewOllamaProvider(server.URL, "codellama")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	results, err := p.Complete(ctx, "fmt.Print", 50)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(results) == 0 {
		t.Error("expected completions")
	}
}

func TestOllamaProvider_Unavailable(t *testing.T) {
	p := NewOllamaProvider("http://localhost:99999", "test")

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	_, err := p.Complete(ctx, "test", 10)
	if err != ErrProviderUnavailable {
		t.Errorf("expected ErrProviderUnavailable, got %v", err)
	}

	if p.IsAvailable() {
		t.Error("should be unavailable after failed request")
	}
}

func TestOpenAIProvider_Creation(t *testing.T) {
	p := NewOpenAIProvider("", "")

	if p.Name() != "openai" {
		t.Errorf("expected name 'openai', got %s", p.Name())
	}

	if p.IsLocal() {
		t.Error("openai should not be local")
	}

	if p.IsAvailable() {
		t.Error("openai without API key should not be available")
	}
}

func TestOpenAIProvider_NotConfigured(t *testing.T) {
	p := NewOpenAIProvider("", "gpt-4o-mini")

	ctx := context.Background()
	_, err := p.Complete(ctx, "test", 10)

	if err != ErrProviderNotConfigured {
		t.Errorf("expected ErrProviderNotConfigured, got %v", err)
	}
}

func TestAnthropicProvider_Creation(t *testing.T) {
	p := NewAnthropicProvider("", "")

	if p.Name() != "anthropic" {
		t.Errorf("expected name 'anthropic', got %s", p.Name())
	}

	if p.IsLocal() {
		t.Error("anthropic should not be local")
	}

	if p.IsAvailable() {
		t.Error("anthropic without API key should not be available")
	}
}

func TestProviderManager_Register(t *testing.T) {
	m := NewProviderManager()

	ollama := NewOllamaProvider("", "")
	m.Register(ollama)

	if len(m.List()) != 1 {
		t.Errorf("expected 1 provider, got %d", len(m.List()))
	}

	if m.Get("ollama") == nil {
		t.Error("expected to get ollama provider")
	}

	if m.Get("unknown") != nil {
		t.Error("expected nil for unknown provider")
	}
}

func TestProviderManager_PrimaryFallback(t *testing.T) {
	m := NewProviderManager()

	ollama := NewOllamaProvider("", "")
	openai := NewOpenAIProvider("test-key", "")

	m.Register(ollama)
	m.Register(openai)

	m.SetPrimary("ollama")
	m.SetFallback("openai")

	providers := m.List()
	if len(providers) != 2 {
		t.Errorf("expected 2 providers, got %d", len(providers))
	}
}

func TestParseCompletions(t *testing.T) {
	tests := []struct {
		name     string
		response string
		wantLen  int
	}{
		{
			name:     "multiple lines",
			response: "fmt.Println()\nfmt.Printf()\nfmt.Sprintf()",
			wantLen:  3,
		},
		{
			name:     "with comments",
			response: "// comment\nfmt.Println()\n# another comment\nfmt.Printf()",
			wantLen:  2,
		},
		{
			name:     "empty lines",
			response: "\n\nfmt.Println()\n\n",
			wantLen:  1,
		},
		{
			name:     "max 5",
			response: "a\nb\nc\nd\ne\nf\ng",
			wantLen:  5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseCompletions(tt.response)
			if len(result) != tt.wantLen {
				t.Errorf("parseCompletions() got %d, want %d", len(result), tt.wantLen)
			}
		})
	}
}
