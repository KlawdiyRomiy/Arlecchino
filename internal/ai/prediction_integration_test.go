package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"arlecchino/internal/ai/providers"
)

func TestBackgroundPredictionDisabledByDefault(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	_, err := service.EditorContinuation(context.Background(), "main", AIContextRequest{
		Prompt:      "continue",
		OptInSource: editorPredictionBackgroundOptInSource,
	}, "", "")
	if err == nil || !strings.Contains(err.Error(), "AI predictions are disabled") {
		t.Fatalf("expected disabled prediction error, got %v", err)
	}
}

func TestBackgroundPredictionBudgetBlocksBeforeProviderCall(t *testing.T) {
	service := newTestService(t, nil)
	descriptor := service.descriptors["local-test"]
	provider := &sequenceProvider{
		descriptor: descriptor,
		responses:  []providers.GenerationResponse{{Text: "first", Model: descriptor.DefaultModel}},
	}
	service.providers[descriptor.ID] = provider
	service.settings.Prediction = DefaultPredictionSettings()
	service.settings.Prediction.Enabled = true
	service.settings.Prediction.Mode = AIPredictionModeSubtle
	service.settings.Prediction.ProviderID = descriptor.ID
	service.settings.Prediction.MinIntervalMs = 1
	service.settings.Prediction.Budget.RequestsPerMinute = 1
	service.settings.Prediction.Budget.RequestsPerFilePerMinute = 1
	service.settings.Prediction.Budget.TokensPerMinute = 1000
	service.settings.Prediction.Budget.TokensPerDay = 1000
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	req := AIContextRequest{
		Prompt:      "continue",
		FilePath:    "main.ts",
		TextBefore:  "const value =",
		OptInSource: editorPredictionBackgroundOptInSource,
	}
	if _, err := service.EditorContinuation(context.Background(), "main", req, "", ""); err != nil {
		t.Fatalf("first prediction: %v", err)
	}
	time.Sleep(260 * time.Millisecond)
	_, err = service.EditorContinuation(context.Background(), "main", req, "", "")
	if err == nil || !strings.Contains(err.Error(), "prediction request budget exhausted") {
		t.Fatalf("expected budget error, got %v", err)
	}
	if got := len(provider.Requests()); got != 1 {
		t.Fatalf("provider was called %d times, want 1", got)
	}
	records, err := project.Egress.List(10)
	if err != nil {
		t.Fatalf("List egress: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("egress records = %#v", records)
	}
	blocked := records[1]
	if blocked.Status != "blocked" || blocked.BudgetDecision != "blocked" || blocked.BudgetReason == "" {
		t.Fatalf("blocked egress record = %#v", blocked)
	}
}

func TestRemoteBYOKPredictionRequiresConsent(t *testing.T) {
	service := newTestService(t, nil)
	descriptor := providers.AIProviderDescriptor{
		ID:             "remote-byok",
		Name:           "Remote BYOK",
		Kind:           "openai-compatible",
		Endpoint:       "https://gateway.example.test/v1",
		EndpointClass:  "remote_byok",
		Local:          false,
		Frontier:       false,
		RequiresAuth:   true,
		AuthConfigured: true,
		BillingMode:    "byok",
		LegalBasis:     "user_supplied_api_key",
		RiskTier:       "remote_byok",
		Capabilities:   providers.DefaultCapabilities(),
		DefaultModel:   "remote-model",
		Status:         providers.ProviderStatusReady,
	}
	provider := &sequenceProvider{
		descriptor: descriptor,
		responses:  []providers.GenerationResponse{{Text: "remote", Model: descriptor.DefaultModel}},
	}
	service.providers[descriptor.ID] = provider
	service.descriptors[descriptor.ID] = descriptor
	service.settings.Prediction = DefaultPredictionSettings()
	service.settings.Prediction.Enabled = true
	service.settings.Prediction.Mode = AIPredictionModeSubtle
	service.settings.Prediction.ProviderID = descriptor.ID
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	req := AIContextRequest{
		Prompt:      "continue",
		TextBefore:  "const value =",
		OptInSource: editorPredictionBackgroundOptInSource,
	}
	_, err := service.EditorContinuation(context.Background(), "main", req, "", "")
	if err == nil || !strings.Contains(err.Error(), "remote BYOK provider disclosure is not accepted") {
		t.Fatalf("expected remote BYOK consent error, got %v", err)
	}
	service.settings.ConsentPolicy.RemoteBYOKProvidersAccepted = true
	response, err := service.EditorContinuation(context.Background(), "main", req, "", "")
	if err != nil {
		t.Fatalf("remote prediction after consent: %v", err)
	}
	if response.Text != "remote" {
		t.Fatalf("response = %#v", response)
	}
	if got := len(provider.Requests()); got != 1 {
		t.Fatalf("provider calls = %d, want 1", got)
	}
}

func TestRemoteBYOKProviderSettingsLoadSecretForHealthCheck(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer byok-secret" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"id": "remote-model"}},
		})
	}))
	defer server.Close()

	secrets := &mapSecretStore{}
	service := newTestService(t, nil)
	service.secretStore = secrets
	descriptor, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:          "remote-byok",
		Name:        "Remote BYOK",
		Kind:        "openai-compatible",
		Endpoint:    server.URL + "/v1",
		Model:       "remote-model",
		Enabled:     true,
		Manual:      true,
		SecretValue: "byok-secret",
	})
	if err != nil {
		t.Fatalf("SaveProviderSettings: %v", err)
	}
	if descriptor.Local || descriptor.Frontier || descriptor.EndpointClass != "remote_byok" || !descriptor.AuthConfigured {
		t.Fatalf("descriptor = %#v", descriptor)
	}
	checked, err := service.TestProvider(context.Background(), "remote-byok")
	if err != nil {
		t.Fatalf("TestProvider: %v", err)
	}
	if checked.Status != providers.ProviderStatusReady || checked.DefaultModel != "remote-model" {
		t.Fatalf("checked descriptor = %#v", checked)
	}
}

func TestRemoteBYOKProviderCanBeTestedBeforeEnable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer byok-secret" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"id": "remote-model"}},
		})
	}))
	defer server.Close()

	secrets := &mapSecretStore{}
	service := newTestService(t, nil)
	service.secretStore = secrets
	descriptor, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:          "remote-byok",
		Name:        "Remote BYOK",
		Kind:        "openai-compatible",
		Endpoint:    server.URL + "/v1",
		Model:       "remote-model",
		Enabled:     false,
		Manual:      true,
		SecretValue: "byok-secret",
	})
	if err != nil {
		t.Fatalf("SaveProviderSettings: %v", err)
	}
	if descriptor.Status != providers.ProviderStatusDisabled {
		t.Fatalf("descriptor status = %s, want disabled", descriptor.Status)
	}
	if _, ok := service.providers["remote-byok"]; ok {
		t.Fatal("disabled remote BYOK provider should not be registered before testing")
	}
	checked, err := service.TestProvider(context.Background(), "remote-byok")
	if err != nil {
		t.Fatalf("TestProvider: %v", err)
	}
	if checked.Status != providers.ProviderStatusReady || checked.DefaultModel != "remote-model" {
		t.Fatalf("checked descriptor = %#v", checked)
	}
	if _, ok := service.providers["remote-byok"]; ok {
		t.Fatal("testing a disabled remote BYOK provider should not enable it")
	}
}

func TestRemoteBYOKProviderCannotBeEnabledWithoutAPIKey(t *testing.T) {
	service := newTestService(t, nil)
	_, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:       "remote-byok",
		Name:     "Remote BYOK",
		Kind:     "openai-compatible",
		Endpoint: "https://gateway.example.test/v1",
		Model:    "remote-model",
		Enabled:  true,
		Manual:   true,
	})
	if err == nil || !strings.Contains(err.Error(), "requires an API key") {
		t.Fatalf("expected API key activation error, got %v", err)
	}
}

func TestRemoteBYOKProviderRejectsPlainHTTPNonLoopbackEndpoint(t *testing.T) {
	service := newTestService(t, nil)
	_, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:          "remote-byok",
		Name:        "Remote BYOK",
		Kind:        "openai-compatible",
		Endpoint:    "http://api.example.test/v1",
		Model:       "remote-model",
		Enabled:     true,
		Manual:      true,
		SecretValue: "byok-secret",
	})
	if err == nil || !strings.Contains(err.Error(), "must use https") {
		t.Fatalf("expected https enforcement error, got %v", err)
	}
}

func TestRemoteBYOKProviderRejectsCredentialAndQueryEndpoints(t *testing.T) {
	for _, endpoint := range []string{
		"https://token@example.test/v1",
		"https://api.example.test/v1?api_key=secret",
		"https://api.example.test/v1#secret",
	} {
		t.Run(endpoint, func(t *testing.T) {
			service := newTestService(t, nil)
			_, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
				ID:          "remote-byok",
				Name:        "Remote BYOK",
				Kind:        "openai-compatible",
				Endpoint:    endpoint,
				Model:       "remote-model",
				Enabled:     true,
				Manual:      true,
				SecretValue: "byok-secret",
			})
			if err == nil {
				t.Fatalf("expected endpoint validation error for %q", endpoint)
			}
		})
	}
}
