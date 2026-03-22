package lsp

import (
	"fmt"
	"testing"
	"time"
)

func TestCompletionCacheKeyUsesDocumentVersion(t *testing.T) {
	m := NewManager(t.TempDir())
	language := "go"
	filePath := "/tmp/test.go"
	line, column := 6, 13

	m.markDocOpen(language, filePath, 1)
	keyV1 := fmt.Sprintf("%s|%s|%d|%d|%d", language, filePath, line, column, m.docVersion(language, filePath))
	m.setCompletionCache(keyV1, completionResult{
		items:     []CompletionItem{{Label: "EventsEmit"}},
		createdAt: time.Now(),
	})

	if _, ok := m.getCompletionCache(keyV1); !ok {
		t.Fatalf("expected cache hit for version 1 key")
	}

	m.markDocOpen(language, filePath, 2)
	keyV2 := fmt.Sprintf("%s|%s|%d|%d|%d", language, filePath, line, column, m.docVersion(language, filePath))
	if keyV1 == keyV2 {
		t.Fatalf("expected different cache keys for different document versions")
	}
	if _, ok := m.getCompletionCache(keyV2); ok {
		t.Fatalf("expected cache miss for new document version key")
	}
}
