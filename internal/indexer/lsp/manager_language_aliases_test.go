package lsp

import "testing"

func TestHasConfigResolvesAliases(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{Language: "typescriptreact", Command: "tsserver"})
	m.RegisterServer(ServerConfig{Language: "bash", Command: "bash-language-server"})

	tests := []string{"tsx", ".tsx", "TypeScriptReact", "typescriptreact", "sh", "zsh", "shellscript"}
	for _, language := range tests {
		if !m.HasConfig(language) {
			t.Fatalf("expected HasConfig(%q) to resolve alias", language)
		}
	}
}

func TestConfigLanguageCandidatesDeterministic(t *testing.T) {
	candidates := configLanguageCandidates("tsx")
	if len(candidates) < 2 {
		t.Fatalf("expected multiple candidates for tsx, got %v", candidates)
	}
	if candidates[0] != "tsx" {
		t.Fatalf("expected first candidate to be tsx, got %q", candidates[0])
	}
	if candidates[1] != "typescriptreact" {
		t.Fatalf("expected second candidate to be typescriptreact, got %q", candidates[1])
	}
}
