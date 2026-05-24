package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"arlecchino/internal/ai/providers"
)

func installOAuthTestProviderSpec(t *testing.T, authURL string, tokenURL string) {
	t.Helper()
	const kind = "oauth-test"
	previous, existed := providerSpecs[kind]
	providerSpecs[kind] = providerSpec{
		Kind:            kind,
		Name:            "OAuth Test",
		DefaultID:       "oauth-test",
		DefaultEndpoint: "https://oauth-test.invalid/v1",
		AuthMode:        providers.ProviderAuthModeOAuth,
		OAuthSupported:  true,
		OAuth: &providerOAuthConfig{
			AuthURL:  authURL,
			TokenURL: tokenURL,
			ClientID: "oauth-test-client",
			Scopes:   []string{"models.read", "chat.write"},
		},
		RequiresAuth: true,
		Capabilities: providers.CloudCapabilities(),
		DefaultModel: "oauth-test-model",
		Factory: func(setting providers.AIProviderSettings, spec providerSpec, secret string) providers.Provider {
			descriptor := descriptorFromSpec(setting, spec, providers.ProviderStatusNeedsAuth)
			descriptor.AuthConfigured = strings.TrimSpace(secret) != ""
			descriptor.Models = []providers.AIModelDescriptor{
				{ID: "oauth-test-model", DisplayName: "OAuth Test Model", Streaming: true},
			}
			if descriptor.AuthConfigured {
				descriptor.Status = providers.ProviderStatusReady
			}
			return fakeProvider{descriptor: descriptor, text: "oauth ok"}
		},
	}
	t.Cleanup(func() {
		if existed {
			providerSpecs[kind] = previous
			return
		}
		delete(providerSpecs, kind)
	})
}

func TestProviderOAuthStartRejectsProvidersWithoutOAuthConfig(t *testing.T) {
	service := newTestService(t, nil)

	if _, err := service.StartProviderOAuth(context.Background(), "openai-frontier"); err == nil {
		t.Fatal("StartProviderOAuth(openai-frontier) error = nil, want provider without OAuth config rejected")
	}
}

func TestProviderOAuthStartCreatesStateAndPKCE(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "test-token"})
	}))
	defer tokenServer.Close()
	installOAuthTestProviderSpec(t, tokenServer.URL+"/authorize", tokenServer.URL+"/token")
	service := newTestService(t, nil)

	session, err := service.StartProviderOAuth(context.Background(), "oauth-test")
	if err != nil {
		t.Fatalf("StartProviderOAuth: %v", err)
	}
	if session.Status != AIProviderAuthStatusWaiting {
		t.Fatalf("Status = %q, want waiting", session.Status)
	}
	if session.State == "" || session.CodeVerifier == "" {
		t.Fatalf("session missing state or PKCE verifier: %#v", session)
	}
	authorizationURL, err := url.Parse(session.AuthorizationURL)
	if err != nil {
		t.Fatalf("AuthorizationURL parse: %v", err)
	}
	query := authorizationURL.Query()
	if query.Get("state") != session.State {
		t.Fatalf("state query = %q, want session state", query.Get("state"))
	}
	if query.Get("code_challenge") == "" || query.Get("code_challenge_method") != "S256" {
		t.Fatalf("PKCE query = %#v, want S256 challenge", query)
	}
	if strings.Contains(session.AuthorizationURL, session.CodeVerifier) {
		t.Fatal("AuthorizationURL leaked code_verifier")
	}

	loaded, err := service.GetProviderAuthSession(session.ID)
	if err != nil {
		t.Fatalf("GetProviderAuthSession: %v", err)
	}
	if loaded.ID != session.ID || loaded.Status != AIProviderAuthStatusWaiting {
		t.Fatalf("loaded session = %#v, want same waiting session", loaded)
	}
}

func TestProviderOAuthCompleteStoresCredentialAndReadiesProvider(t *testing.T) {
	var tokenForm url.Values
	var tokenParseErr error
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/token" {
			http.NotFound(w, r)
			return
		}
		if err := r.ParseForm(); err != nil {
			tokenParseErr = err
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		tokenForm = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-from-oauth","refresh_token":"refresh-from-oauth"}`))
	}))
	defer tokenServer.Close()
	installOAuthTestProviderSpec(t, tokenServer.URL+"/authorize", tokenServer.URL+"/token")
	secrets := &mapSecretStore{}
	service := newTestService(t, nil)
	service.secretStore = secrets

	session, err := service.StartProviderOAuth(context.Background(), "oauth-test")
	if err != nil {
		t.Fatalf("StartProviderOAuth: %v", err)
	}
	completed, err := service.CompleteProviderOAuth(context.Background(), "oauth-test", session.State, "callback-code", "")
	if err != nil {
		t.Fatalf("CompleteProviderOAuth: %v", err)
	}
	if completed.Status != AIProviderAuthStatusCompleted {
		t.Fatalf("completed status = %q, want completed", completed.Status)
	}
	if tokenParseErr != nil {
		t.Fatalf("ParseForm: %v", tokenParseErr)
	}
	if tokenForm.Get("grant_type") != "authorization_code" ||
		tokenForm.Get("code") != "callback-code" ||
		tokenForm.Get("code_verifier") != session.CodeVerifier {
		t.Fatalf("token form = %#v, want OAuth authorization_code exchange with PKCE", tokenForm)
	}
	stored := secrets.values[secretRefForProvider("oauth-test")]
	if !strings.Contains(stored, "access-from-oauth") || !strings.Contains(stored, "refresh-from-oauth") {
		t.Fatalf("stored OAuth credential = %q, want opaque token JSON in secret store", stored)
	}

	service.mu.RLock()
	descriptor := service.descriptors["oauth-test"]
	_, providerReady := service.providers["oauth-test"]
	service.mu.RUnlock()
	if !providerReady {
		t.Fatal("provider was not registered after successful OAuth test")
	}
	if descriptor.Status != providers.ProviderStatusReady || !descriptor.AuthConfigured {
		t.Fatalf("descriptor = %#v, want ready auth-configured provider", descriptor)
	}
}

func TestProviderOAuthCancelMarksSessionCanceled(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "test-token"})
	}))
	defer tokenServer.Close()
	installOAuthTestProviderSpec(t, tokenServer.URL+"/authorize", tokenServer.URL+"/token")
	service := newTestService(t, nil)

	session, err := service.StartProviderOAuth(context.Background(), "oauth-test")
	if err != nil {
		t.Fatalf("StartProviderOAuth: %v", err)
	}
	canceled, err := service.CancelProviderAuth(session.ID)
	if err != nil {
		t.Fatalf("CancelProviderAuth: %v", err)
	}
	if canceled.Status != AIProviderAuthStatusCanceled {
		t.Fatalf("Status = %q, want canceled", canceled.Status)
	}
	if _, err := service.CompleteProviderOAuth(context.Background(), "oauth-test", session.State, "callback-code", ""); err == nil {
		t.Fatal("CompleteProviderOAuth after cancel error = nil, want rejected")
	}
}

func TestProviderOAuthGetExpiresStaleSession(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "test-token"})
	}))
	defer tokenServer.Close()
	installOAuthTestProviderSpec(t, tokenServer.URL+"/authorize", tokenServer.URL+"/token")
	service := newTestService(t, nil)

	session, err := service.StartProviderOAuth(context.Background(), "oauth-test")
	if err != nil {
		t.Fatalf("StartProviderOAuth: %v", err)
	}
	service.mu.Lock()
	service.authSessions[session.ID].ExpiresAt = "2000-01-01T00:00:00Z"
	service.mu.Unlock()

	expired, err := service.GetProviderAuthSession(session.ID)
	if err != nil {
		t.Fatalf("GetProviderAuthSession: %v", err)
	}
	if expired.Status != AIProviderAuthStatusExpired {
		t.Fatalf("Status = %q, want expired", expired.Status)
	}
	if _, err := service.CompleteProviderOAuth(context.Background(), "oauth-test", session.State, "callback-code", ""); err == nil {
		t.Fatal("CompleteProviderOAuth after expiry error = nil, want rejected")
	}
}
