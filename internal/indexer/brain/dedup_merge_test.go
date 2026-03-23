package brain

import (
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestDeduplicate_MergesMetadata(t *testing.T) {
	b := &PredictionBrain{}

	lspEdits := []core.TextEdit{{
		StartLine:   1,
		StartColumn: 1,
		EndLine:     1,
		EndColumn:   1,
		Text:        "use Foo;",
	}}

	index := Suggestion{
		Text:       "Foo",
		Kind:       core.SymbolKindFunction,
		Source:     core.SourceIndex,
		Score:      1.2,
		Detail:     "",
		InsertText: "Foo()",
	}

	lsp := Suggestion{
		Text:                "Foo",
		Kind:                core.SymbolKindFunction,
		Source:              core.SourceLSP,
		Score:               0.8,
		Detail:              "from lsp",
		Documentation:       "Foo docs",
		InsertText:          "Foo()",
		AdditionalTextEdits: lspEdits,
	}

	got := b.deduplicate([]Suggestion{index, lsp})
	if len(got) != 1 {
		t.Fatalf("expected 1 suggestion, got %d", len(got))
	}

	if got[0].Source != core.SourceIndex {
		t.Fatalf("expected to keep higher-score SourceIndex, got %s", got[0].Source)
	}
	if got[0].Documentation != "Foo docs" {
		t.Fatalf("expected merged documentation, got %q", got[0].Documentation)
	}
	if got[0].Detail != "from lsp" {
		t.Fatalf("expected merged detail, got %q", got[0].Detail)
	}
	if len(got[0].AdditionalTextEdits) != 1 {
		t.Fatalf("expected merged additionalTextEdits, got %d", len(got[0].AdditionalTextEdits))
	}
}
