package brain

import (
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestSelectGhostTextWithContext_SkipsCandidatesWithAdditionalTextEdits(t *testing.T) {
	b := &PredictionBrain{}
	ctx := CompletionContext{Language: "php"}

	suggestions := []Suggestion{
		{
			Text:                "get",
			Source:              core.SourceLSP,
			Score:               9.5,
			InsertText:          "Route::get()",
			AdditionalTextEdits: []core.TextEdit{{StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 1, Text: "use Foo;"}},
		},
		{
			Text:       "group",
			Source:     core.SourceKeywords,
			Score:      8.0,
			InsertText: "Route::group()",
		},
	}

	result := b.SelectGhostTextWithContext(ctx, suggestions, "g", "Route::")
	if !result.ShouldShow {
		t.Fatalf("expected ShouldShow=true")
	}
	if result.Text != "roup()" {
		t.Fatalf("expected ghost text %q, got %q", "roup()", result.Text)
	}
}

func TestSelectGhostTextWithContext_NoGhostWhenAllCandidatesUnsafe(t *testing.T) {
	b := &PredictionBrain{}
	ctx := CompletionContext{Language: "php"}

	suggestions := []Suggestion{
		{
			Text:                "get",
			Source:              core.SourceLSP,
			Score:               9.5,
			InsertText:          "Route::get()",
			AdditionalTextEdits: []core.TextEdit{{StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 1, Text: "use Foo;"}},
		},
	}

	result := b.SelectGhostTextWithContext(ctx, suggestions, "g", "Route::")
	if result.ShouldShow {
		t.Fatalf("expected ShouldShow=false")
	}
}
