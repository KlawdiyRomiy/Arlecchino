package brain

import (
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestStableSortSuggestions_TieBreakDeterministic(t *testing.T) {
	suggestions := []Suggestion{
		{
			Text:   "zeta",
			Kind:   core.SymbolKindFunction,
			Source: core.SourceIndex,
			Score:  1.0,
		},
		{
			Text:   "alpha",
			Kind:   core.SymbolKindFunction,
			Source: core.SourceIndex,
			Score:  1.0,
		},
	}

	stableSortSuggestions(suggestions)
	if suggestions[0].Text != "alpha" {
		t.Fatalf("expected alphabetical tie-break, got %q", suggestions[0].Text)
	}
}
