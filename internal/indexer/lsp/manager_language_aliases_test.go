package lsp

import "testing"

func TestHasConfigResolvesAliases(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{Language: "typescriptreact", Command: "tsserver"})
	m.RegisterServer(ServerConfig{Language: "javascriptreact", Command: "tsserver"})
	m.RegisterServer(ServerConfig{Language: "bash", Command: "bash-language-server"})
	m.RegisterServer(ServerConfig{Language: "blade", Command: "vscode-html-language-server"})
	m.RegisterServer(ServerConfig{Language: "cpp", Command: "clangd"})
	m.RegisterServer(ServerConfig{Language: "objectivec", Command: "clangd"})

	tests := []string{"tsx", ".tsx", "TypeScriptReact", "typescriptreact", "jsx", "javascriptreact", "sh", "zsh", "shellscript", "blade", "c++", "cxx", "objective-c", "objcpp"}
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

func TestConfiguredLanguageContractForLSPRequests(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{Language: "typescriptreact", Command: "typescript-language-server"})
	m.RegisterServer(ServerConfig{Language: "javascriptreact", Command: "typescript-language-server"})
	m.RegisterServer(ServerConfig{Language: "blade", Command: "vscode-html-language-server"})
	m.RegisterServer(ServerConfig{Language: "bash", Command: "bash-language-server"})
	m.RegisterServer(ServerConfig{Language: "cpp", Command: "clangd"})
	m.RegisterServer(ServerConfig{Language: "c", Command: "clangd"})
	m.RegisterServer(ServerConfig{Language: "objectivec", Command: "clangd"})

	tests := []struct {
		input          string
		configLanguage string
		textDocumentID string
	}{
		{input: "tsx", configLanguage: "typescriptreact", textDocumentID: "typescriptreact"},
		{input: "jsx", configLanguage: "javascriptreact", textDocumentID: "javascriptreact"},
		{input: "blade", configLanguage: "blade", textDocumentID: "html"},
		{input: "shellscript", configLanguage: "bash", textDocumentID: "shellscript"},
		{input: "c++", configLanguage: "cpp", textDocumentID: "cpp"},
		{input: "c", configLanguage: "c", textDocumentID: "c"},
		{input: "objective-c", configLanguage: "objectivec", textDocumentID: "objective-c"},
	}

	for _, tt := range tests {
		resolved, ok := m.resolveConfiguredLanguage(tt.input)
		if !ok {
			t.Fatalf("resolveConfiguredLanguage(%q) returned false", tt.input)
		}
		if resolved != tt.configLanguage {
			t.Fatalf("resolveConfiguredLanguage(%q)=%q want %q", tt.input, resolved, tt.configLanguage)
		}
		if got := normalizeLanguageID(resolved); got != tt.textDocumentID {
			t.Fatalf("normalizeLanguageID(%q)=%q want %q", resolved, got, tt.textDocumentID)
		}
	}
}

func TestServerLanguageContractForHoverSignatureAndDefinition(t *testing.T) {
	m := NewManager(t.TempDir())
	m.mu.Lock()
	m.servers["typescriptreact"] = &Server{}
	m.servers["javascriptreact"] = &Server{}
	m.servers["blade"] = &Server{}
	m.servers["bash"] = &Server{}
	m.servers["cpp"] = &Server{}
	m.servers["objectivec"] = &Server{}
	m.mu.Unlock()

	tests := []struct {
		input string
		want  string
	}{
		{input: "tsx", want: "typescriptreact"},
		{input: "jsx", want: "javascriptreact"},
		{input: "blade", want: "blade"},
		{input: "zsh", want: "bash"},
		{input: "c++", want: "cpp"},
		{input: "objcpp", want: "objectivec"},
	}

	for _, tt := range tests {
		got, ok := m.resolveServerLanguage(tt.input)
		if !ok {
			t.Fatalf("resolveServerLanguage(%q) returned false", tt.input)
		}
		if got != tt.want {
			t.Fatalf("resolveServerLanguage(%q)=%q want %q", tt.input, got, tt.want)
		}
	}
}
