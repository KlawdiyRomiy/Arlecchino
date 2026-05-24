package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const (
	providerOAuthSessionTTL        = 10 * time.Minute
	providerOAuthTokenResponseCap  = 64 * 1024
	providerOAuthRedirectModeProto = "custom_protocol"
)

func (s *Service) StartProviderOAuth(ctx context.Context, providerID string) (AIProviderAuthSession, error) {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return AIProviderAuthSession{}, fmt.Errorf("provider id is empty")
	}
	setting, spec, err := s.providerOAuthSettingAndSpec(providerID)
	if err != nil {
		return AIProviderAuthSession{}, err
	}
	if spec.OAuth == nil || strings.TrimSpace(spec.OAuth.AuthURL) == "" || strings.TrimSpace(spec.OAuth.TokenURL) == "" || strings.TrimSpace(spec.OAuth.ClientID) == "" {
		return AIProviderAuthSession{}, fmt.Errorf("AI provider %q does not expose a configured OAuth flow", providerID)
	}
	if spec.AuthMode != providers.ProviderAuthModeOAuth || !spec.OAuthSupported {
		return AIProviderAuthSession{}, fmt.Errorf("AI provider %q is not configured for OAuth auth", providerID)
	}
	state, err := randomURLToken(32)
	if err != nil {
		return AIProviderAuthSession{}, err
	}
	verifier, err := randomURLToken(48)
	if err != nil {
		return AIProviderAuthSession{}, err
	}
	now := time.Now().UTC()
	session := AIProviderAuthSession{
		ID:               uuid.NewString(),
		ProviderID:       setting.ID,
		Status:           AIProviderAuthStatusWaiting,
		StartedAt:        now.Format(time.RFC3339),
		ExpiresAt:        now.Add(providerOAuthSessionTTL).Format(time.RFC3339),
		AuthMode:         string(providers.ProviderAuthModeOAuth),
		State:            state,
		CodeVerifier:     verifier,
		RedirectURI:      providerOAuthRedirectURI(setting.ID, spec.OAuth),
		AuthorizationURL: providerOAuthAuthorizationURL(setting.ID, state, verifier, spec.OAuth),
	}
	s.mu.Lock()
	if s.authSessions == nil {
		s.authSessions = map[string]*AIProviderAuthSession{}
	}
	sessionCopy := session
	s.authSessions[session.ID] = &sessionCopy
	s.mu.Unlock()
	s.emitEvent("ai:provider:auth-session", session)
	return session, nil
}

func (s *Service) GetProviderAuthSession(sessionID string) (AIProviderAuthSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return AIProviderAuthSession{}, fmt.Errorf("provider auth session id is empty")
	}
	s.mu.Lock()
	session, ok := s.authSessions[sessionID]
	if !ok {
		s.mu.Unlock()
		return AIProviderAuthSession{}, fmt.Errorf("provider auth session %q was not found", sessionID)
	}
	changed := false
	if providerOAuthSessionExpired(*session) && session.Status == AIProviderAuthStatusWaiting {
		session.Status = AIProviderAuthStatusExpired
		session.Error = "OAuth session expired."
		changed = true
	}
	result := *session
	s.mu.Unlock()
	if changed {
		s.emitEvent("ai:provider:auth-session", result)
	}
	return result, nil
}

func (s *Service) CancelProviderAuth(sessionID string) (AIProviderAuthSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return AIProviderAuthSession{}, fmt.Errorf("provider auth session id is empty")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.authSessions[sessionID]
	if !ok {
		return AIProviderAuthSession{}, fmt.Errorf("provider auth session %q was not found", sessionID)
	}
	if session.Status == AIProviderAuthStatusCompleted {
		return *session, nil
	}
	session.Status = AIProviderAuthStatusCanceled
	session.Error = ""
	result := *session
	go s.emitEvent("ai:provider:auth-session", result)
	return result, nil
}

func (s *Service) CompleteProviderOAuth(ctx context.Context, providerID string, state string, code string, callbackError string) (AIProviderAuthSession, error) {
	providerID = strings.TrimSpace(providerID)
	state = strings.TrimSpace(state)
	code = strings.TrimSpace(code)
	callbackError = strings.TrimSpace(callbackError)
	session, spec, err := s.providerOAuthSessionByState(providerID, state)
	if err != nil {
		return AIProviderAuthSession{}, err
	}
	if callbackError != "" {
		return s.finishProviderOAuthSession(session.ID, AIProviderAuthStatusFailed, sanitizedDisplayText(callbackError), nil)
	}
	if code == "" {
		return s.finishProviderOAuthSession(session.ID, AIProviderAuthStatusFailed, "OAuth callback did not include an authorization code.", nil)
	}
	tokenJSON, err := exchangeProviderOAuthCode(ctx, code, *session, spec.OAuth)
	if err != nil {
		return s.finishProviderOAuthSession(session.ID, AIProviderAuthStatusFailed, sanitizedDisplayText(err.Error()), nil)
	}
	ref := secretRefForProvider(session.ProviderID)
	if err := s.secretStore.SaveSecret(ctx, ref, tokenJSON); err != nil {
		return s.finishProviderOAuthSession(session.ID, AIProviderAuthStatusFailed, sanitizedDisplayText(err.Error()), nil)
	}
	setting := s.providerOAuthSettingFromSession(session.ProviderID, spec, ref)
	descriptor, err := s.SaveProviderSettings(ctx, setting)
	if err != nil {
		return s.finishProviderOAuthSession(session.ID, AIProviderAuthStatusFailed, sanitizedDisplayText(err.Error()), nil)
	}
	if _, err := s.TestProvider(ctx, descriptor.ID); err != nil {
		descriptor.Reason = sanitizedDisplayText(err.Error())
		s.emitEvent("ai:provider:status", descriptor)
		return s.finishProviderOAuthSession(session.ID, AIProviderAuthStatusFailed, descriptor.Reason, nil)
	}
	return s.finishProviderOAuthSession(session.ID, AIProviderAuthStatusCompleted, "", nil)
}

func (s *Service) providerOAuthSettingAndSpec(providerID string) (providers.AIProviderSettings, providerSpec, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, setting := range s.settings.Providers {
		if setting.ID == providerID {
			spec, ok := providerSpecForKind(setting.Kind)
			if !ok {
				return providers.AIProviderSettings{}, providerSpec{}, fmt.Errorf("AI provider %q has unknown kind %q", providerID, setting.Kind)
			}
			setting.ID = firstNonEmpty(setting.ID, spec.DefaultID)
			setting.Name = firstNonEmpty(setting.Name, spec.Name)
			setting.Endpoint = firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint)
			return setting, spec, nil
		}
	}
	if descriptor, ok := s.descriptors[providerID]; ok {
		spec, ok := providerSpecForKind(descriptor.Kind)
		if !ok {
			return providers.AIProviderSettings{}, providerSpec{}, fmt.Errorf("AI provider %q has unknown kind %q", providerID, descriptor.Kind)
		}
		return providers.AIProviderSettings{
			ID:       firstNonEmpty(descriptor.ID, spec.DefaultID),
			Name:     firstNonEmpty(descriptor.Name, spec.Name),
			Kind:     spec.Kind,
			Endpoint: firstNonEmpty(descriptor.Endpoint, spec.DefaultEndpoint),
			Model:    firstNonEmpty(descriptor.DefaultModel, spec.DefaultModel),
			Enabled:  true,
		}, spec, nil
	}
	for _, spec := range providerSpecs {
		if providerID == spec.DefaultID {
			return providers.AIProviderSettings{
				ID:       spec.DefaultID,
				Name:     spec.Name,
				Kind:     spec.Kind,
				Endpoint: spec.DefaultEndpoint,
				Model:    spec.DefaultModel,
				Enabled:  true,
			}, spec, nil
		}
	}
	return providers.AIProviderSettings{}, providerSpec{}, fmt.Errorf("AI provider %q was not found", providerID)
}

func (s *Service) providerOAuthSettingFromSession(providerID string, spec providerSpec, secretRef string) providers.AIProviderSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, setting := range s.settings.Providers {
		if setting.ID == providerID {
			setting.Enabled = true
			setting.SecretRef = secretRef
			setting.SecretValue = ""
			setting.ClearSecret = false
			setting.AuthMode = providers.ProviderAuthModeOAuth
			setting.OAuthSupported = true
			setting.OAuthClientID = spec.OAuth.ClientID
			if setting.Endpoint == "" {
				setting.Endpoint = spec.DefaultEndpoint
			}
			if setting.Model == "" {
				setting.Model = spec.DefaultModel
			}
			return setting
		}
	}
	return providers.AIProviderSettings{
		ID:             firstNonEmpty(providerID, spec.DefaultID),
		Name:           spec.Name,
		Kind:           spec.Kind,
		Endpoint:       spec.DefaultEndpoint,
		Model:          spec.DefaultModel,
		Enabled:        true,
		SecretRef:      secretRef,
		AuthMode:       providers.ProviderAuthModeOAuth,
		OAuthClientID:  spec.OAuth.ClientID,
		OAuthSupported: true,
	}
}

func (s *Service) providerOAuthSessionByState(providerID string, state string) (*AIProviderAuthSession, providerSpec, error) {
	if providerID == "" || state == "" {
		return nil, providerSpec{}, fmt.Errorf("OAuth callback is missing provider or state")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, session := range s.authSessions {
		if session.ProviderID != providerID || session.State != state {
			continue
		}
		if providerOAuthSessionExpired(*session) && session.Status == AIProviderAuthStatusWaiting {
			session.Status = AIProviderAuthStatusExpired
			session.Error = "OAuth session expired."
			return nil, providerSpec{}, fmt.Errorf("OAuth session expired")
		}
		if session.Status != AIProviderAuthStatusWaiting && session.Status != AIProviderAuthStatusOpening {
			return nil, providerSpec{}, fmt.Errorf("OAuth session is %s", session.Status)
		}
		setting, spec, err := s.providerOAuthSettingAndSpecLocked(providerID)
		if err != nil {
			return nil, providerSpec{}, err
		}
		if setting.ID == "" {
			return nil, providerSpec{}, fmt.Errorf("AI provider %q was not found", providerID)
		}
		return session, spec, nil
	}
	return nil, providerSpec{}, fmt.Errorf("OAuth session was not found")
}

func (s *Service) providerOAuthSettingAndSpecLocked(providerID string) (providers.AIProviderSettings, providerSpec, error) {
	for _, setting := range s.settings.Providers {
		if setting.ID == providerID {
			spec, ok := providerSpecForKind(setting.Kind)
			if !ok {
				return providers.AIProviderSettings{}, providerSpec{}, fmt.Errorf("AI provider %q has unknown kind %q", providerID, setting.Kind)
			}
			return setting, spec, nil
		}
	}
	if descriptor, ok := s.descriptors[providerID]; ok {
		spec, ok := providerSpecForKind(descriptor.Kind)
		if !ok {
			return providers.AIProviderSettings{}, providerSpec{}, fmt.Errorf("AI provider %q has unknown kind %q", providerID, descriptor.Kind)
		}
		return providers.AIProviderSettings{ID: descriptor.ID, Kind: descriptor.Kind, Name: descriptor.Name, Endpoint: descriptor.Endpoint, Model: descriptor.DefaultModel, Enabled: true}, spec, nil
	}
	for _, spec := range providerSpecs {
		if providerID == spec.DefaultID {
			return providers.AIProviderSettings{
				ID:       spec.DefaultID,
				Name:     spec.Name,
				Kind:     spec.Kind,
				Endpoint: spec.DefaultEndpoint,
				Model:    spec.DefaultModel,
				Enabled:  true,
			}, spec, nil
		}
	}
	return providers.AIProviderSettings{}, providerSpec{}, fmt.Errorf("AI provider %q was not found", providerID)
}

func (s *Service) finishProviderOAuthSession(sessionID string, status string, message string, update func(*AIProviderAuthSession)) (AIProviderAuthSession, error) {
	s.mu.Lock()
	session, ok := s.authSessions[sessionID]
	if !ok {
		s.mu.Unlock()
		return AIProviderAuthSession{}, fmt.Errorf("provider auth session %q was not found", sessionID)
	}
	session.Status = status
	session.Error = message
	if update != nil {
		update(session)
	}
	result := *session
	s.mu.Unlock()
	s.emitEvent("ai:provider:auth-session", result)
	if status == AIProviderAuthStatusFailed {
		return result, fmt.Errorf("%s", message)
	}
	return result, nil
}

func providerOAuthSessionExpired(session AIProviderAuthSession) bool {
	expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(session.ExpiresAt))
	return err == nil && time.Now().UTC().After(expiresAt)
}

func providerOAuthRedirectURI(providerID string, config *providerOAuthConfig) string {
	mode := providerOAuthRedirectModeProto
	if config != nil && strings.TrimSpace(config.RedirectMode) != "" {
		mode = strings.TrimSpace(config.RedirectMode)
	}
	switch mode {
	default:
		values := url.Values{}
		values.Set("provider", providerID)
		return (&url.URL{Scheme: "arlecchino", Host: "oauth", Path: "/callback", RawQuery: values.Encode()}).String()
	}
}

func providerOAuthAuthorizationURL(providerID string, state string, verifier string, config *providerOAuthConfig) string {
	authURL, err := url.Parse(strings.TrimSpace(config.AuthURL))
	if err != nil {
		return strings.TrimSpace(config.AuthURL)
	}
	query := authURL.Query()
	query.Set("response_type", "code")
	query.Set("client_id", strings.TrimSpace(config.ClientID))
	query.Set("redirect_uri", providerOAuthRedirectURI(providerID, config))
	query.Set("state", state)
	query.Set("code_challenge_method", "S256")
	query.Set("code_challenge", providerOAuthCodeChallenge(verifier))
	if len(config.Scopes) > 0 {
		query.Set("scope", strings.Join(config.Scopes, " "))
	}
	authURL.RawQuery = query.Encode()
	return authURL.String()
}

func exchangeProviderOAuthCode(ctx context.Context, code string, session AIProviderAuthSession, config *providerOAuthConfig) (string, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", session.RedirectURI)
	form.Set("client_id", strings.TrimSpace(config.ClientID))
	form.Set("code_verifier", session.CodeVerifier)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSpace(config.TokenURL), strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, providerOAuthTokenResponseCap))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("OAuth token exchange failed with status %d", resp.StatusCode)
	}
	var token map[string]any
	if err := json.Unmarshal(body, &token); err != nil {
		return "", fmt.Errorf("OAuth token response was not valid JSON")
	}
	if strings.TrimSpace(fmt.Sprint(token["access_token"])) == "" && strings.TrimSpace(fmt.Sprint(token["refresh_token"])) == "" {
		return "", fmt.Errorf("OAuth token response did not include a usable token")
	}
	token["stored_at"] = time.Now().UTC().Format(time.RFC3339)
	safe, err := json.Marshal(token)
	if err != nil {
		return "", err
	}
	return string(safe), nil
}

func providerOAuthCodeChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func randomURLToken(byteCount int) (string, error) {
	buf := make([]byte, byteCount)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
