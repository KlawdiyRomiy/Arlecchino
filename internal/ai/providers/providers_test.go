package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOllamaProviderListsModelsAndGenerates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"models": []map[string]any{{"name": "codellama:7b-code"}},
			})
		case "/api/generate":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if payload["prompt"] == "" {
				t.Fatal("prompt was empty")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"response": "fmt.Println(\"ok\")",
				"done":     true,
				"model":    "codellama:7b-code",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewOllamaProvider("ollama-test", server.URL, "codellama:7b-code", true, 0)
	models, err := provider.ListModels(context.Background())
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if len(models) != 1 || models[0].ID != "codellama:7b-code" {
		t.Fatalf("models = %#v", models)
	}

	response, err := provider.Generate(context.Background(), GenerationRequest{Prompt: "complete this", Model: "codellama:7b-code"}, nil)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if response.Text != "fmt.Println(\"ok\")" {
		t.Fatalf("response text = %q", response.Text)
	}
}

func TestOpenAICompatibleProviderListsModelsAndGenerates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{{"id": "local-model"}},
			})
		case "/v1/chat/completions":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if payload["model"] != "local-model" {
				t.Fatalf("model = %v", payload["model"])
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{{
					"message": map[string]any{"content": "next-token"},
				}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewOpenAICompatibleProvider(OpenAICompatibleOptions{
		ID:       "lm-test",
		Name:     "LM Studio",
		Kind:     "lm-studio",
		Endpoint: server.URL + "/v1",
		Model:    "local-model",
		Local:    true,
	})
	descriptor := provider.HealthCheck(context.Background())
	if descriptor.Status != ProviderStatusReady {
		t.Fatalf("descriptor = %#v", descriptor)
	}

	response, err := provider.Generate(context.Background(), GenerationRequest{Prompt: "continue", Model: "local-model"}, nil)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if response.Text != "next-token" {
		t.Fatalf("response text = %q", response.Text)
	}
}

func TestOllamaProviderStreamsGenerateChunks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/generate" {
			http.NotFound(w, r)
			return
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload["stream"] != true {
			t.Fatalf("stream = %v", payload["stream"])
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = w.Write([]byte(`{"response":"hello ","model":"codellama"}` + "\n"))
		_, _ = w.Write([]byte(`{"response":"world","model":"codellama","done":true}` + "\n"))
	}))
	defer server.Close()

	provider := NewOllamaProvider("ollama-test", server.URL, "codellama", true, 0)
	tokens := []string{}
	response, err := provider.Generate(context.Background(), GenerationRequest{Prompt: "complete", Model: "codellama", Stream: true}, func(token string) error {
		tokens = append(tokens, token)
		return nil
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if response.Text != "hello world" || strings.Join(tokens, "") != "hello world" {
		t.Fatalf("response=%#v tokens=%#v", response, tokens)
	}
}

func TestOpenAICompatibleProviderStreamsChatChunks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload["stream"] != true {
			t.Fatalf("stream = %v", payload["stream"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"next-\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"token\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	provider := NewOpenAICompatibleProvider(OpenAICompatibleOptions{
		ID:       "lm-test",
		Name:     "LM Studio",
		Kind:     "lm-studio",
		Endpoint: server.URL + "/v1",
		Model:    "local-model",
		Local:    true,
	})
	tokens := []string{}
	response, err := provider.Generate(context.Background(), GenerationRequest{Prompt: "continue", Model: "local-model", Stream: true}, func(token string) error {
		tokens = append(tokens, token)
		return nil
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if response.Text != "next-token" || strings.Join(tokens, "") != "next-token" {
		t.Fatalf("response=%#v tokens=%#v", response, tokens)
	}
}
