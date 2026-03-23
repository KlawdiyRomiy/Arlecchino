package brain

import (
	"testing"
)

func TestArleCreation(t *testing.T) {
	config := DefaultArleConfig()
	config.Mode = ArleModeNone
	config.LazyLoadDelay = 0

	arle := NewArle(config)
	if arle == nil {
		t.Fatal("expected arle to be created")
	}

	if arle.Mode() != ArleModeNone {
		t.Errorf("expected mode None, got %d", arle.Mode())
	}

	if arle.State() != ArleUnloaded {
		t.Errorf("expected state Unloaded, got %d", arle.State())
	}

	arle.Close()
}

func TestArleTokenizer(t *testing.T) {
	tokenizer, err := NewArleTokenizer("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if tokenizer.VocabSize() == 0 {
		t.Error("expected non-zero vocab size")
	}

	tokens := tokenizer.Tokenize("func main()", 100)
	if len(tokens) == 0 {
		t.Error("expected tokens")
	}

	text := tokenizer.Detokenize(tokens)
	if text == "" {
		t.Error("expected detokenized text")
	}
}

func TestArleTokenizerWithLanguage(t *testing.T) {
	tokenizer, _ := NewArleTokenizer("")

	tests := []struct {
		lang     string
		wantDiff bool
	}{
		{"go", true},
		{"php", true},
		{"typescript", true},
		{"python", true},
		{"unknown", true},
	}

	for _, tt := range tests {
		t.Run(tt.lang, func(t *testing.T) {
			tokens := tokenizer.TokenizeWithLanguage("func main()", tt.lang, 100)
			if len(tokens) < 2 {
				t.Error("expected at least 2 tokens (language + content)")
			}

			langToken := tokenizer.GetLanguageToken(tt.lang)
			if tokens[0] != langToken {
				t.Errorf("first token should be language token %d, got %d", langToken, tokens[0])
			}
		})
	}
}

func TestArleTokenizerLanguageTokens(t *testing.T) {
	tokenizer, _ := NewArleTokenizer("")

	langs := []string{"go", "php", "typescript", "javascript", "python", "ruby", "rust", "java"}
	seen := make(map[int]string)

	for _, lang := range langs {
		token := tokenizer.GetLanguageToken(lang)
		if prev, ok := seen[token]; ok && prev != lang {
			t.Errorf("language %s has same token %d as %s", lang, token, prev)
		}
		seen[token] = lang

		if !tokenizer.HasLanguageToken(lang) {
			t.Errorf("expected HasLanguageToken(%s) = true", lang)
		}
	}
}

func TestGeometricMean(t *testing.T) {
	tests := []struct {
		product float64
		n       int
		wantMin float64
		wantMax float64
	}{
		{1.0, 1, 0.99, 1.01},
		{0.25, 2, 0.49, 0.51},
		{0.0, 3, 0.49, 0.51},
		{0.8, 1, 0.79, 0.81},
	}

	for _, tt := range tests {
		got := geometricMean(tt.product, tt.n)
		if got < tt.wantMin || got > tt.wantMax {
			t.Errorf("geometricMean(%v, %v) = %v, want [%v, %v]", tt.product, tt.n, got, tt.wantMin, tt.wantMax)
		}
	}
}

func TestArleBackendPureGo(t *testing.T) {
	backend := NewPureGoBackend()

	score := backend.ScoreSuggestion([]int{1, 2, 3, 4, 5}, "testFunc")
	if score < 0 || score > 1 {
		t.Errorf("score should be between 0 and 1, got %f", score)
	}

	if backend.Type() != "pure-go" {
		t.Errorf("expected type pure-go, got %s", backend.Type())
	}

	backend.Close()
}

func TestProjectLearner(t *testing.T) {
	learner := NewProjectLearner(t.TempDir())

	ctx := CompletionContext{
		Language: "go",
		Scope:    "main",
	}

	learner.Record("/test/project", "TestSymbol", ctx)
	learner.Record("/test/project", "TestSymbol", ctx)

	boost := learner.GetBoost("/test/project", "TestSymbol")
	if boost <= 0 {
		t.Error("expected positive boost after recording")
	}

	count := learner.Count()
	if count != 1 {
		t.Errorf("expected 1 symbol, got %d", count)
	}

	learner.Flush()
}

func TestArleRerank(t *testing.T) {
	config := DefaultArleConfig()
	config.Mode = ArleModeArle
	config.LazyLoadDelay = 0
	config.EnableRerank = true

	arle := NewArle(config)
	defer arle.Close()

	suggestions := []Suggestion{
		{Text: "func1", Score: 0.5},
		{Text: "func2", Score: 0.8},
		{Text: "func3", Score: 0.3},
	}

	ctx := CompletionContext{
		Content:  []byte("package main\n\nfunc main() {\n\t"),
		FilePath: "/test/main.go",
		Language: "go",
	}

	result := arle.Rerank(suggestions, ctx)

	if len(result) != len(suggestions) {
		t.Errorf("expected %d suggestions, got %d", len(suggestions), len(result))
	}
}
