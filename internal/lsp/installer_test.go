package lsp

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
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

func TestPHPActorInstallUsesStandalonePHARForPlainPHP(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	server := installer.GetServerByID("phpactor")
	if server == nil {
		t.Fatal("phpactor should exist")
	}
	if server.InstallType != "phar" {
		t.Fatalf("phpactor install type = %q, want phar", server.InstallType)
	}
	if strings.Contains(server.InstallCmd, "composer") {
		t.Fatalf("phpactor plain PHP install must not require composer, got %q", server.InstallCmd)
	}
	if len(server.Dependencies) != 1 || server.Dependencies[0] != "php" {
		t.Fatalf("phpactor dependencies = %#v, want only php", server.Dependencies)
	}
	if !strings.HasSuffix(server.DownloadURL, "/phpactor.phar") {
		t.Fatalf("phpactor download URL = %q, want phpactor.phar", server.DownloadURL)
	}
}

func TestInstallPHARDownloadsExecutable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PHAR executable fixture uses POSIX shebang")
	}

	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}
	installer.lspDir = t.TempDir()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("#!/bin/sh\necho fake-phar 1.0\n"))
	}))
	t.Cleanup(server.Close)

	installer.servers["fake-phar"] = &LSPInfo{
		ID:          "fake-phar",
		Name:        "Fake PHAR",
		InstallType: "phar",
		DownloadURL: server.URL + "/fake.phar",
		BinaryName:  "fake-phar",
		CanInstall:  true,
	}

	if err := installer.Install(context.Background(), "fake-phar"); err != nil {
		t.Fatalf("Install fake PHAR: %v", err)
	}
	path := filepath.Join(installer.lspDir, "fake-phar", "fake-phar")
	if !executableFileExists(path) {
		t.Fatalf("expected executable PHAR at %s", path)
	}
}

func TestSolargraphInstallCommandPinsLegacyVersionForOldRuby(t *testing.T) {
	parts, message := solargraphGemInstallParts([]string{"gem", "install", "solargraph"}, "2.6.10")
	if !containsAdjacent(parts, "-v", "0.50.0") {
		t.Fatalf("expected Ruby 2.6 solargraph install to pin 0.50.0, got %#v", parts)
	}
	if !strings.Contains(message, "0.50.0") {
		t.Fatalf("expected install message to mention pinned version, got %q", message)
	}

	parts, _ = solargraphGemInstallParts([]string{"gem", "install", "solargraph"}, "3.2.2")
	if containsAdjacent(parts, "-v", "0.50.0") {
		t.Fatalf("expected Ruby 3.2 solargraph install to use latest, got %#v", parts)
	}
}

func TestInstallAsyncMarksInstallingBeforeReturn(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture uses POSIX sh")
	}

	installer, binDir := newInstallerCommandFixture(t)
	writeExecutable(t, binDir, "fake-install", `#!/bin/sh
sleep 0.2
cat > "$TEST_BIN/fake-server" <<'EOF'
#!/bin/sh
echo fake-server 1.0
EOF
chmod +x "$TEST_BIN/fake-server"
`)
	installer.servers["fake-server"] = &LSPInfo{
		ID:           "fake-server",
		Name:         "Fake Server",
		InstallType:  "go",
		InstallCmd:   "fake-install",
		BinaryName:   "fake-server",
		CanInstall:   true,
		Dependencies: []string{"fake-install"},
	}

	done := make(chan error, 1)
	if err := installer.InstallAsync(context.Background(), "fake-server", func(err error) {
		done <- err
	}); err != nil {
		t.Fatalf("InstallAsync: %v", err)
	}
	if !installer.IsInstalling("fake-server") {
		t.Fatalf("expected installer to be marked running before InstallAsync returns")
	}
	if err := installer.InstallAsync(context.Background(), "fake-server", nil); err != nil {
		t.Fatalf("duplicate InstallAsync should preserve running state, got %v", err)
	}
	if !installer.IsInstalling("fake-server") {
		t.Fatalf("duplicate InstallAsync cleared running state")
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("install finished with error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for fake install")
	}
	if installer.IsInstalling("fake-server") {
		t.Fatalf("expected installer state to be cleared after success")
	}
	state := installer.GetInstallState("fake-server")
	if state.Stage != "done" || state.Running {
		t.Fatalf("unexpected final state: %+v", state)
	}
}

func TestInstallTimeoutClearsInstallingState(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture uses POSIX sh")
	}

	installer, binDir := newInstallerCommandFixture(t)
	installer.installTimeout = 25 * time.Millisecond
	writeExecutable(t, binDir, "slow-install", `#!/bin/sh
sleep 2
`)
	installer.servers["slow-server"] = &LSPInfo{
		ID:           "slow-server",
		Name:         "Slow Server",
		InstallType:  "go",
		InstallCmd:   "slow-install",
		BinaryName:   "slow-server",
		CanInstall:   true,
		Dependencies: []string{"slow-install"},
	}

	err := installer.Install(context.Background(), "slow-server")
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if installer.IsInstalling("slow-server") {
		t.Fatalf("timeout left installer marked running")
	}
	state := installer.GetInstallState("slow-server")
	if state.Stage != "error" || state.Error == "" || state.Running {
		t.Fatalf("unexpected timeout state: %+v", state)
	}
}

func TestInstallMissingDependencyReportsState(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}
	installer.lspDir = t.TempDir()
	installer.servers["missing-dep-server"] = &LSPInfo{
		ID:           "missing-dep-server",
		Name:         "Missing Dep Server",
		InstallType:  "go",
		InstallCmd:   "missing-dep-install",
		BinaryName:   "missing-dep-server",
		CanInstall:   true,
		Dependencies: []string{"arlecchino-definitely-missing-dep"},
	}

	err = installer.Install(context.Background(), "missing-dep-server")
	if err == nil {
		t.Fatal("expected missing dependency error")
	}
	if installer.IsInstalling("missing-dep-server") {
		t.Fatalf("missing dependency left installer marked running")
	}
	state := installer.GetInstallState("missing-dep-server")
	if state.Stage != "error" || !strings.Contains(state.Error, "missing dependency") {
		t.Fatalf("unexpected missing dependency state: %+v", state)
	}
}

func TestFindBinaryPathDiscoversProjectComposerAndUserGemBins(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("executable fixture uses POSIX permissions")
	}

	home := t.TempDir()
	pathDir := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PATH", pathDir)

	root := t.TempDir()
	projectPhpactor := writeExecutable(t, filepath.Join(root, "vendor", "bin"), "phpactor", "#!/bin/sh\necho phpactor\n")
	if got := FindBinaryPath(root, "", "phpactor", "phpactor"); got != projectPhpactor {
		t.Fatalf("project phpactor path = %q, want %q", got, projectPhpactor)
	}

	userSolargraph := writeExecutable(t, filepath.Join(home, ".gem", "ruby", "3.2.0", "bin"), "solargraph", "#!/bin/sh\necho solargraph\n")
	if got := FindBinaryPath("", "", "solargraph", "solargraph"); got != userSolargraph {
		t.Fatalf("user solargraph path = %q, want %q", got, userSolargraph)
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

func newInstallerCommandFixture(t *testing.T) (*Installer, string) {
	t.Helper()
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}
	installer.lspDir = t.TempDir()
	binDir := t.TempDir()
	t.Setenv("TEST_BIN", binDir)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return installer, binDir
}

func writeExecutable(t *testing.T, dir, name, body string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", dir, err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(body), 0755); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}
	return path
}

func containsAdjacent(values []string, first, second string) bool {
	for i := 0; i+1 < len(values); i++ {
		if values[i] == first && values[i+1] == second {
			return true
		}
	}
	return false
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
