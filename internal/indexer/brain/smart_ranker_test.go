package brain

import (
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestSmartRanker_MainVsMake(t *testing.T) {
	ranker := NewSmartRanker(nil, nil)

	// Симулируем suggestions от keywords после "package ma"
	suggestions := []Suggestion{
		{
			Text:   "make",
			Kind:   core.SymbolKindFunction,
			Source: core.SourceKeywords,
			Score:  8.5, // Priority 85 / 10
		},
		{
			Text:   "main",
			Kind:   core.SymbolKindPackage,
			Source: core.SourceKeywords,
			Score:  9.8, // Priority 98 / 10
		},
	}

	ctx := RankingContext{
		Prefix:   "ma",
		Language: "go",
	}

	ranked := ranker.Rank(suggestions, ctx, nil)

	if len(ranked) < 2 {
		t.Fatalf("expected 2 suggestions, got %d", len(ranked))
	}

	if ranked[0].Text != "main" {
		t.Errorf("expected 'main' to be first, got '%s' (score: %.2f)", ranked[0].Text, ranked[0].Score)
		t.Errorf("'make' score: %.2f", ranked[1].Score)
	}
}

func TestSmartRanker_PackageKindScore(t *testing.T) {
	ranker := NewSmartRanker(nil, nil)

	ctx := RankingContext{
		Prefix:   "ma",
		Language: "go",
	}

	packageScore := ranker.kindScore(core.SymbolKindPackage, ctx)
	functionScore := ranker.kindScore(core.SymbolKindFunction, ctx)

	if packageScore <= functionScore {
		t.Errorf("package kind score (%.2f) should be higher than function (%.2f)", packageScore, functionScore)
	}
}
