package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"arlecchino/internal/ai"
)

func (a *App) completeProviderOAuthCallbackFromRawTarget(rawTarget string) (ai.AIProviderAuthSession, error) {
	provider, state, code, callbackError, ok := providerOAuthCallbackValuesFromRawTarget(rawTarget)
	if !ok {
		return ai.AIProviderAuthSession{}, fmt.Errorf("invalid OAuth callback")
	}
	if !a.pendingOAuthStateMatches(provider, state) {
		return ai.AIProviderAuthSession{}, fmt.Errorf("OAuth callback state is not registered")
	}
	session, err := a.ensureAIService().CompleteProviderOAuth(context.Background(), provider, state, code, callbackError)
	a.clearPendingProtocolOAuthState(provider, state)
	return session, err
}

func providerOAuthCallbackValuesFromRawTarget(rawTarget string) (provider string, state string, code string, callbackError string, ok bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawTarget))
	if err != nil || !strings.EqualFold(parsed.Scheme, customProtocolScheme) {
		return "", "", "", "", false
	}
	host := normalizeProtocolSegment(parsed.Host)
	path := strings.Trim(strings.ToLower(parsed.EscapedPath()), "/")
	if host != "oauth" && host != "auth" {
		return "", "", "", "", false
	}
	if path != "" && path != "callback" {
		return "", "", "", "", false
	}
	values := parsed.Query()
	provider = firstQueryValue(values, "provider", "id")
	state = firstQueryValue(values, "state")
	code = firstQueryValue(values, "code")
	callbackError = firstQueryValue(values, "error", "error_description")
	if !isSafeProtocolIdentifier(provider) || !isSafeProtocolIdentifier(state) {
		return "", "", "", "", false
	}
	return provider, state, code, callbackError, true
}
