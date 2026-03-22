package brain

import (
	"testing"
)

func TestArleLanguageTokens(t *testing.T) {
	tokenizer, err := NewArleTokenizer("")
	if err != nil {
		t.Fatalf("NewArleTokenizer failed: %v", err)
	}

	tier1 := []string{"python", "javascript", "typescript", "java", "csharp", "cpp", "c", "go", "rust", "php", "ruby", "swift", "kotlin", "scala", "shell"}
	tier2 := []string{"lua", "r", "perl", "haskell", "clojure", "elixir", "erlang", "julia", "dart", "groovy", "powershell", "objectivec"}
	tier3 := []string{"fsharp", "ocaml", "fortran", "cobol", "ada", "prolog", "lisp", "scheme", "racket", "commonlisp", "assembly", "vhdl", "verilog", "zig", "nim", "crystal"}
	dataConfig := []string{"json", "yaml", "toml", "xml", "markdown", "dockerfile"}

	allLangs := append(tier1, tier2...)
	allLangs = append(allLangs, tier3...)
	allLangs = append(allLangs, dataConfig...)

	t.Logf("Testing %d languages", len(allLangs))

	var supported, missing []string
	for _, lang := range allLangs {
		if tokenizer.HasLanguageToken(lang) {
			supported = append(supported, lang)
		} else {
			missing = append(missing, lang)
		}
	}

	t.Logf("TIER 1 (15): %d supported", len(tier1))
	t.Logf("TIER 2 (12): %d supported", len(tier2))
	t.Logf("TIER 3 (16): %d supported", len(tier3))
	t.Logf("DATA/CONFIG (6): %d supported", len(dataConfig))
	t.Logf("TOTAL: %d languages supported", len(supported))

	if len(missing) > 0 {
		t.Errorf("Missing language tokens: %v", missing)
	}

	aliases := map[string]string{
		"typescriptreact": "typescript",
		"javascriptreact": "javascript",
		"bash":            "shell",
		"sh":              "shell",
		"zsh":             "shell",
		"cs":              "csharp",
		"c++":             "cpp",
		"objective-c":     "objectivec",
		"f#":              "fsharp",
		"common-lisp":     "commonlisp",
		"md":              "markdown",
		"yml":             "yaml",
	}

	for alias, expected := range aliases {
		if !tokenizer.HasLanguageToken(alias) {
			t.Errorf("Alias %s should map to %s", alias, expected)
		} else {
			aliasToken := tokenizer.GetLanguageToken(alias)
			expectedToken := tokenizer.GetLanguageToken(expected)
			if aliasToken != expectedToken {
				t.Errorf("Alias %s token %d != %s token %d", alias, aliasToken, expected, expectedToken)
			}
		}
	}
}

func TestArleTokenizeWithLanguage(t *testing.T) {
	tokenizer, err := NewArleTokenizer("")
	if err != nil {
		t.Fatalf("NewArleTokenizer failed: %v", err)
	}

	tests := []struct {
		lang string
		code string
	}{
		{"python", "def hello():"},
		{"go", "func main() {"},
		{"javascript", "function test() {"},
		{"rust", "fn main() {"},
		{"typescript", "const x: number = 1"},
	}

	for _, tt := range tests {
		t.Run(tt.lang, func(t *testing.T) {
			tokens := tokenizer.TokenizeWithLanguage(tt.code, tt.lang, 50)
			if len(tokens) == 0 {
				t.Error("should produce tokens")
			}

			langToken := tokenizer.GetLanguageToken(tt.lang)
			if tokens[0] != langToken {
				t.Errorf("first token should be language token %d, got %d", langToken, tokens[0])
			}

			t.Logf("%s: %d tokens, lang_token=%d", tt.lang, len(tokens), langToken)
		})
	}
}
