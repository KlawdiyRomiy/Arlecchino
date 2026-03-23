package brain

import (
	"testing"
)

func TestLangDetectorHeuristics(t *testing.T) {
	ld := &LangDetector{
		idx2lang: make(map[int]string),
		lang2idx: make(map[string]int),
	}
	ld.initDefaultMapping()

	tests := []string{
		"function test() { console.log('hi'); }",
		"fn main() { println!(\"Hi\"); }",
		"func main() { fmt.Println(\"Hi\") }",
		"SELECT * FROM users WHERE id = 1;",
		"{\"key\": \"value\"}",
	}

	for _, code := range tests {
		predictions := ld.detectByHeuristics(code, 1)
		if len(predictions) == 0 {
			t.Errorf("no predictions for code")
			continue
		}
		if predictions[0].Confidence <= 0 {
			t.Errorf("zero confidence")
		}
		t.Logf("%s -> %.2f", predictions[0].Language, predictions[0].Confidence)
	}
}

func TestLangDetectorMapping(t *testing.T) {
	ld := &LangDetector{
		idx2lang: make(map[int]string),
		lang2idx: make(map[string]int),
	}
	ld.initDefaultMapping()

	if ld.numLangs != 51 {
		t.Errorf("expected 51 languages, got %d", ld.numLangs)
	}

	langs := ld.SupportedLanguages()
	if len(langs) != 51 {
		t.Errorf("expected 51 supported languages, got %d", len(langs))
	}

	expected := []string{"Python", "Go", "Rust", "SQL", "HTML", "JavaScript"}
	for _, lang := range expected {
		found := false
		for _, l := range langs {
			if l == lang {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("language %s not found in supported list", lang)
		}
	}
}
