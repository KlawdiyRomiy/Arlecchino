package main

import "testing"

func TestProviderOAuthCallbackParserKeepsCodeServerSide(t *testing.T) {
	provider, state, code, callbackError, ok := providerOAuthCallbackValuesFromRawTarget(
		"arlecchino://oauth/callback?provider=oauth-test&state=state_123&code=secret-code",
	)
	if !ok {
		t.Fatal("providerOAuthCallbackValuesFromRawTarget ok = false, want true")
	}
	if provider != "oauth-test" || state != "state_123" || code != "secret-code" || callbackError != "" {
		t.Fatalf("callback values = provider=%q state=%q code=%q error=%q", provider, state, code, callbackError)
	}

	payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", "arlecchino://oauth/callback?provider=oauth-test&state=state_123&code=secret-code"},
		"/",
	)
	if !ok {
		t.Fatal("buildOpenIntentFromLaunchArgs ok = false, want sanitized frontend focus payload")
	}
	if _, exposed := payload["code"]; exposed {
		t.Fatalf("frontend payload exposed OAuth code: %#v", payload)
	}
	if payload["providerId"] != "oauth-test" || payload["oauthState"] != "state_123" {
		t.Fatalf("payload = %#v, want provider and state only", payload)
	}
}

func TestProviderOAuthCallbackParserRejectsUnsafeState(t *testing.T) {
	if _, _, _, _, ok := providerOAuthCallbackValuesFromRawTarget(
		"arlecchino://oauth/callback?provider=oauth-test&state=../../bad&code=secret-code",
	); ok {
		t.Fatal("providerOAuthCallbackValuesFromRawTarget ok = true, want unsafe state rejected")
	}
}
