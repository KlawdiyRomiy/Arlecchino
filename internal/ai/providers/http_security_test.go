package providers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestOpenAICompatibleProviderBlocksCrossOriginRedirects(t *testing.T) {
	var redirected atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected.Store(true)
		http.Error(w, "redirect target should not be reached", http.StatusTeapot)
	}))
	defer target.Close()

	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/v1/models", http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	provider := NewOpenAICompatibleProvider(OpenAICompatibleOptions{
		ID:            "remote-byok",
		Name:          "Remote BYOK",
		Kind:          "openai-compatible",
		Endpoint:      source.URL + "/v1",
		Model:         "remote-model",
		Local:         false,
		EndpointClass: "remote_byok",
		RequiresAuth:  true,
		Secret:        "byok-secret",
	})
	_, err := provider.ListModels(context.Background())
	if err == nil || !strings.Contains(err.Error(), "provider redirect blocked") {
		t.Fatalf("expected redirect block, got %v", err)
	}
	if redirected.Load() {
		t.Fatal("redirect target should not be reached")
	}
}
