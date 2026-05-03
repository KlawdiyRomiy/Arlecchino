package lsp

import "testing"

func TestLanguageCandidates(t *testing.T) {
	cases := []struct {
		input    string
		expected []string
	}{
		{input: "tsx", expected: []string{"tsx", "typescriptreact", "typescript"}},
		{input: "jsx", expected: []string{"jsx", "javascriptreact", "javascript"}},
		{input: ".sh", expected: []string{"sh", "bash"}},
		{input: "c++", expected: []string{"c++", "cpp"}},
		{input: "Objective-C", expected: []string{"objective-c", "objectivec"}},
		{input: "objcpp", expected: []string{"objcpp", "objectivec"}},
		{input: "c#", expected: []string{"c#", "csharp"}},
	}

	for _, tc := range cases {
		candidates := LanguageCandidates(tc.input)
		if len(candidates) == 0 {
			t.Fatalf("LanguageCandidates(%q) returned no candidates", tc.input)
		}

		for _, expected := range tc.expected {
			if !containsCandidate(candidates, expected) {
				t.Fatalf("LanguageCandidates(%q) missing %q in %v", tc.input, expected, candidates)
			}
		}
	}
}

func TestTextDocumentLanguageID(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{input: "bash", want: "shellscript"},
		{input: "blade", want: "html"},
		{input: "objectivec", want: "objective-c"},
		{input: "typescriptreact", want: "typescriptreact"},
		{input: "javascriptreact", want: "javascriptreact"},
		{input: "cpp", want: "cpp"},
		{input: "typescript", want: "typescript"},
	}

	for _, tt := range tests {
		if got := TextDocumentLanguageID(tt.input); got != tt.want {
			t.Fatalf("TextDocumentLanguageID(%q)=%q, want %q", tt.input, got, tt.want)
		}
	}
}

func containsCandidate(candidates []string, value string) bool {
	for _, candidate := range candidates {
		if candidate == value {
			return true
		}
	}
	return false
}
