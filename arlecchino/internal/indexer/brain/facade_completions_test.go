package brain

import (
	"strings"
	"testing"
)

func TestFacadeMethods_InsertTextHasNoSnippetPlaceholders(t *testing.T) {
	b := &PredictionBrain{}
	ctx := CompletionContext{
		Language:     "php",
		IsStaticCall: true,
		AccessChain:  "Route::",
		Prefix:       "g",
	}

	suggestions := b.fromFacadeMethods(ctx)
	if len(suggestions) == 0 {
		t.Fatalf("expected facade method suggestions")
	}

	for _, s := range suggestions {
		if strings.Contains(s.InsertText, "$") {
			t.Fatalf("InsertText must not contain snippet placeholders, got %q", s.InsertText)
		}
	}
}
