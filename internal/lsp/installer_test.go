package lsp

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

func TestPublicAlphaDoesNotExposeInstallableBinaryDownloads(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	for _, server := range installer.GetAllServers() {
		if server.CanInstall && server.InstallType == "binary" {
			t.Fatalf("%s must not expose direct binary download install without pin/checksum", server.ID)
		}
	}
}

func TestMacAlphaUsesHomebrewForFormerBinaryDownloads(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS Homebrew policy is only asserted on darwin")
	}

	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	for _, id := range []string{"zls", "marksman", "lua-language-server"} {
		server := installer.GetServerByID(id)
		if server == nil {
			t.Fatalf("%s should exist", id)
		}
		if server.InstallType != "brew" {
			t.Fatalf("%s install type = %q, want brew", id, server.InstallType)
		}
		if !server.CanInstall {
			t.Fatalf("%s should remain installable through Homebrew", id)
		}
		if !strings.HasPrefix(server.InstallCmd, "brew install ") {
			t.Fatalf("%s install command = %q, want brew install", id, server.InstallCmd)
		}
	}
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

func TestExtractZipRejectsPathTraversal(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	src := filepath.Join(t.TempDir(), "bad.zip")
	dest := t.TempDir()
	outside := filepath.Join(dest, "..", "escape.txt")

	zipFile, err := os.Create(src)
	if err != nil {
		t.Fatalf("Create(zip) error = %v", err)
	}
	zw := zip.NewWriter(zipFile)
	w, err := zw.Create("../escape.txt")
	if err != nil {
		t.Fatalf("Create(zip entry) error = %v", err)
	}
	if _, err := w.Write([]byte("escape")); err != nil {
		t.Fatalf("Write(zip entry) error = %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("Close(zip writer) error = %v", err)
	}
	if err := zipFile.Close(); err != nil {
		t.Fatalf("Close(zip file) error = %v", err)
	}

	err = installer.extractZip(src, dest)
	if err == nil {
		t.Fatalf("extractZip should reject traversal entry")
	}
	if !strings.Contains(err.Error(), "escapes destination") {
		t.Fatalf("extractZip error = %v, want contains %q", err, "escapes destination")
	}
	if _, statErr := os.Stat(outside); !os.IsNotExist(statErr) {
		t.Fatalf("traversal should not create %q, stat err = %v", outside, statErr)
	}
}

func TestExtractTarGzRejectsPathTraversal(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	src := filepath.Join(t.TempDir(), "bad.tar.gz")
	dest := t.TempDir()
	outside := filepath.Join(dest, "..", "escape.txt")

	tarFile, err := os.Create(src)
	if err != nil {
		t.Fatalf("Create(tar) error = %v", err)
	}
	gw := gzip.NewWriter(tarFile)
	tw := tar.NewWriter(gw)
	body := []byte("escape")
	if err := tw.WriteHeader(&tar.Header{
		Name: "../escape.txt",
		Mode: 0o644,
		Size: int64(len(body)),
	}); err != nil {
		t.Fatalf("WriteHeader(tar) error = %v", err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatalf("Write(tar) error = %v", err)
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("Close(tar writer) error = %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("Close(gzip writer) error = %v", err)
	}
	if err := tarFile.Close(); err != nil {
		t.Fatalf("Close(tar file) error = %v", err)
	}

	err = installer.extractTarGz(src, dest)
	if err == nil {
		t.Fatalf("extractTarGz should reject traversal entry")
	}
	if !strings.Contains(err.Error(), "escapes destination") {
		t.Fatalf("extractTarGz error = %v, want contains %q", err, "escapes destination")
	}
	if _, statErr := os.Stat(outside); !os.IsNotExist(statErr) {
		t.Fatalf("traversal should not create %q, stat err = %v", outside, statErr)
	}
}
