package brain

import (
	"testing"
	"time"

	"arlecchino/internal/indexer/lsp"
)

func TestCompletionResolveRequestMatchesRequiresStoredIdentity(t *testing.T) {
	entry := completionResolveEntry{
		documentVersion: 7,
		requestID:       "request-a",
		sessionID:       "session-a",
		surfaceID:       "editor-a",
	}

	if completionResolveRequestMatches(entry, CompletionResolveRequest{
		DocumentVersion: 7,
		SessionID:       "session-a",
		SurfaceID:       "editor-a",
	}) {
		t.Fatalf("expected missing request id to be rejected")
	}

	if completionResolveRequestMatches(entry, CompletionResolveRequest{
		DocumentVersion: 7,
		RequestID:       "request-a",
		SessionID:       "session-b",
		SurfaceID:       "editor-a",
	}) {
		t.Fatalf("expected wrong session id to be rejected")
	}

	if completionResolveRequestMatches(entry, CompletionResolveRequest{
		DocumentVersion: 6,
		RequestID:       "request-a",
		SessionID:       "session-a",
		SurfaceID:       "editor-a",
	}) {
		t.Fatalf("expected older document version to be rejected")
	}

	if !completionResolveRequestMatches(entry, CompletionResolveRequest{
		DocumentVersion: 8,
		RequestID:       "request-a",
		SessionID:       "session-a",
		SurfaceID:       "editor-a",
	}) {
		t.Fatalf("expected newer document version in same identity to pass")
	}
}

func TestRememberLSPCompletionResolveKeepsTokenLongEnoughForPopupSelection(t *testing.T) {
	b := &PredictionBrain{}
	token := b.rememberLSPCompletionResolve(CompletionContext{
		Language: "go",
		FilePath: "/tmp/main.go",
	}, lsp.CompletionItem{Label: "Fatal"})
	if token == "" {
		t.Fatalf("expected resolve token")
	}

	b.resolveMu.Lock()
	entry, ok := b.resolveEntries[token]
	b.resolveMu.Unlock()
	if !ok {
		t.Fatalf("expected resolve entry")
	}
	if remaining := time.Until(entry.expiresAt); remaining < 30*time.Second {
		t.Fatalf("resolve token TTL = %s, want at least 30s for popup selection dwell", remaining)
	}
}
