package app

import (
	"path/filepath"
	"strings"
)

func (a *App) prepareExternalOpenIntent(payload map[string]any, source string, workingDir string) (map[string]any, bool) {
	if a == nil || len(payload) == 0 {
		return nil, false
	}

	source = strings.TrimSpace(source)
	routeSource := strings.TrimSpace(stringMapValue(payload, "source"))
	prepared := cloneOpenIntentPayload(payload)
	if source != "" {
		prepared["source"] = source
	}
	if routeSource != "" && routeSource != source {
		prepared["routeSource"] = routeSource
	}

	if !a.protocolIntentAllowed(routeSource, prepared) {
		return nil, false
	}
	a.annotateExternalProtocolFileIntent(routeSource, prepared, workingDir)
	return prepared, true
}

func openIntentPayloadRouteSource(prepared map[string]any, original map[string]any) string {
	if routeSource := strings.TrimSpace(stringMapValue(prepared, "routeSource")); routeSource != "" {
		return routeSource
	}
	if source := strings.TrimSpace(stringMapValue(original, "source")); source != "" {
		return source
	}
	return strings.TrimSpace(stringMapValue(prepared, "source"))
}

func openIntentPayloadIsOAuthCallback(prepared map[string]any, original map[string]any) bool {
	return openIntentPayloadRouteSource(prepared, original) == "protocol-oauth-callback"
}

func firstLaunchProtocolTarget(args []string) string {
	for _, arg := range stripExecutableArg(args) {
		target := strings.TrimSpace(arg)
		if strings.HasPrefix(strings.ToLower(target), customProtocolScheme+"://") {
			return target
		}
	}
	return ""
}

func (a *App) protocolIntentAllowed(routeSource string, payload map[string]any) bool {
	switch strings.TrimSpace(routeSource) {
	case "protocol-agent-run":
		return a.hasKnownAIChatRun(strings.TrimSpace(stringMapValue(payload, "runId")))
	case "protocol-mcp-approval":
		return a.pendingMCPApprovalNonceMatches(
			strings.TrimSpace(stringMapValue(payload, "approvalId")),
			strings.TrimSpace(stringMapValue(payload, "nonce")),
		)
	case "protocol-oauth-callback":
		return a.pendingOAuthStateMatches(
			strings.TrimSpace(stringMapValue(payload, "providerId")),
			strings.TrimSpace(stringMapValue(payload, "oauthState")),
		)
	default:
		return true
	}
}

func (a *App) annotateExternalProtocolFileIntent(routeSource string, payload map[string]any, workingDir string) {
	if !strings.HasPrefix(strings.TrimSpace(routeSource), "protocol-") {
		return
	}
	if strings.TrimSpace(stringMapValue(payload, "kind")) != "openFile" {
		return
	}
	path := strings.TrimSpace(stringMapValue(payload, "path"))
	if path == "" {
		return
	}
	if pathWithinTrustedOpenIntentRoot(path, workingDir) || pathWithinTrustedOpenIntentRoot(path, a.currentProjectPath()) {
		return
	}
	payload["external"] = true
	payload["readOnly"] = true
	payload["requiresConfirmation"] = true
}

func pathWithinTrustedOpenIntentRoot(path string, root string) bool {
	path = strings.TrimSpace(path)
	root = strings.TrimSpace(root)
	if path == "" || root == "" {
		return false
	}
	cleanPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	cleanPath = filepath.Clean(cleanPath)
	cleanRoot = filepath.Clean(cleanRoot)
	if cleanPath == cleanRoot {
		return true
	}
	rel, err := filepath.Rel(cleanRoot, cleanPath)
	if err != nil {
		return false
	}
	return rel != "." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}

func (a *App) registerPendingProtocolMCPApproval(requestID string, nonce string) bool {
	requestID = strings.TrimSpace(requestID)
	nonce = strings.TrimSpace(nonce)
	if a == nil || !isSafeProtocolIdentifier(requestID) || !isSafeProtocolIdentifier(nonce) {
		return false
	}
	a.externalIntentMu.Lock()
	defer a.externalIntentMu.Unlock()
	if a.pendingMCPApprovalNonces == nil {
		a.pendingMCPApprovalNonces = make(map[string]string)
	}
	a.pendingMCPApprovalNonces[requestID] = nonce
	return true
}

func (a *App) pendingMCPApprovalNonceMatches(requestID string, nonce string) bool {
	if a == nil || requestID == "" || nonce == "" {
		return false
	}
	a.externalIntentMu.Lock()
	defer a.externalIntentMu.Unlock()
	return a.pendingMCPApprovalNonces != nil && a.pendingMCPApprovalNonces[requestID] == nonce
}

func (a *App) registerPendingProtocolOAuthState(provider string, state string) bool {
	provider = strings.TrimSpace(provider)
	state = strings.TrimSpace(state)
	if a == nil || !isSafeProtocolIdentifier(provider) || !isSafeProtocolIdentifier(state) {
		return false
	}
	a.externalIntentMu.Lock()
	defer a.externalIntentMu.Unlock()
	if a.pendingOAuthStates == nil {
		a.pendingOAuthStates = make(map[string]string)
	}
	a.pendingOAuthStates[provider] = state
	return true
}

func (a *App) pendingOAuthStateMatches(provider string, state string) bool {
	if a == nil || provider == "" || state == "" {
		return false
	}
	a.externalIntentMu.Lock()
	defer a.externalIntentMu.Unlock()
	return a.pendingOAuthStates != nil && a.pendingOAuthStates[provider] == state
}

func (a *App) clearPendingProtocolOAuthState(provider string, state string) {
	provider = strings.TrimSpace(provider)
	state = strings.TrimSpace(state)
	if a == nil || provider == "" || state == "" {
		return
	}
	a.externalIntentMu.Lock()
	defer a.externalIntentMu.Unlock()
	if a.pendingOAuthStates != nil && a.pendingOAuthStates[provider] == state {
		delete(a.pendingOAuthStates, provider)
	}
}

func (a *App) hasKnownAIChatRun(runID string) bool {
	runID = strings.TrimSpace(runID)
	if a == nil || runID == "" || a.aiService == nil {
		return false
	}
	session := a.activeProjectSession()
	sessionID := defaultProjectSessionID
	if session != nil && strings.TrimSpace(session.ID) != "" {
		sessionID = strings.TrimSpace(session.ID)
	}
	_, err := a.aiService.GetChatRun(sessionID, runID)
	return err == nil
}
