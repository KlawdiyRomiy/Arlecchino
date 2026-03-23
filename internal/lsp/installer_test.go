package lsp

import (
	"testing"
)

func TestNewInstaller(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	if installer.lspDir == "" {
		t.Error("lspDir should not be empty")
	}

	servers := installer.GetAllServers()
	if len(servers) == 0 {
		t.Error("should have registered servers")
	}

	t.Logf("Registered %d LSP servers", len(servers))
}

func TestGetServerForExtension(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	tests := []struct {
		ext      string
		wantID   string
		wantName string
	}{
		{".go", "gopls", "Go Language Server"},
		{".ts", "typescript-language-server", "TypeScript/JavaScript"},
		{".py", "pyright", "Python (Pyright)"},
		{".php", "phpactor", "PHP Language Server"},
		{".rs", "rust-analyzer", "Rust Language Server"},
		{".css", "vscode-css-language-server", "CSS/SCSS/Less"},
		{".html", "vscode-html-language-server", "HTML Language Server"},
		{".json", "vscode-json-language-server", "JSON Language Server"},
		{".yaml", "yaml-language-server", "YAML Language Server"},
		{".md", "marksman", "Markdown Language Server"},
		{".sh", "bash-language-server", "Bash Language Server"},
		{".lua", "lua-language-server", "Lua Language Server"},
		{".rb", "solargraph", "Ruby Language Server"},
		{".zig", "zls", "Zig Language Server"},
	}

	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			server := installer.GetServerForExtension(tt.ext)
			if server == nil {
				t.Errorf("no server for %s", tt.ext)
				return
			}
			if server.ID != tt.wantID {
				t.Errorf("got ID %s, want %s", server.ID, tt.wantID)
			}
			if server.Name != tt.wantName {
				t.Errorf("got Name %s, want %s", server.Name, tt.wantName)
			}
			t.Logf("%s -> %s (installed: %v)", tt.ext, server.Name, server.Installed)
		})
	}
}

func TestGetServerByID(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	server := installer.GetServerByID("gopls")
	if server == nil {
		t.Fatal("gopls should exist")
	}
	if server.ID != "gopls" {
		t.Errorf("got %s, want gopls", server.ID)
	}

	t.Logf("gopls installed: %v, version: %s", server.Installed, server.Version)
}

func TestLanguagesRegistry(t *testing.T) {
	langs := GetAllLanguages()
	if len(langs) < 51 {
		t.Errorf("expected at least 51 languages, got %d", len(langs))
	}
	t.Logf("Registered %d languages", len(langs))

	withLSP := GetLanguagesWithLSP()
	t.Logf("Languages with LSP: %d", len(withLSP))

	arleSupported := GetARLESupportedLanguages()
	t.Logf("ARLE supported: %d", len(arleSupported))
}

func TestGetLanguageByExtension(t *testing.T) {
	tests := []struct {
		ext    string
		wantID string
	}{
		{".go", "go"},
		{".ts", "typescript"},
		{".tsx", "typescriptreact"},
		{".py", "python"},
		{".php", "php"},
		{".rs", "rust"},
		{".js", "javascript"},
		{".jsx", "javascriptreact"},
		{".css", "css"},
		{".html", "html"},
		{".json", "json"},
		{".yaml", "yaml"},
		{".md", "markdown"},
		{".sql", "sql"},
		{".sh", "bash"},
		{".rb", "ruby"},
		{".kt", "kotlin"},
		{".lua", "lua"},
		{".zig", "zig"},
		{".ex", "elixir"},
		{".scala", "scala"},
		{".hs", "haskell"},
		{".jl", "julia"},
		{".clj", "clojure"},
	}

	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			lang := GetLanguageByExtension(tt.ext)
			if lang == nil {
				t.Errorf("no language for %s", tt.ext)
				return
			}
			if lang.ID != tt.wantID {
				t.Errorf("got %s, want %s", lang.ID, tt.wantID)
			}
		})
	}
}

func TestInstalledServersDetection(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	servers := installer.GetAllServers()

	var installed, notInstalled int
	for _, s := range servers {
		if s.Installed {
			installed++
			t.Logf("INSTALLED: %s (%s) - %s", s.ID, s.Name, s.Version)
		} else {
			notInstalled++
		}
	}

	t.Logf("Total: %d installed, %d not installed", installed, notInstalled)
}
