package lsp

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestSQLLanguageServerUsesManagedNPMEnvironment(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	server := installer.GetServerByID("sql-language-server")
	if server == nil {
		t.Fatal("sql-language-server should exist")
	}
	if server.InstallType != "npm-managed" {
		t.Fatalf("install type = %q, want npm-managed", server.InstallType)
	}
	for _, want := range []string{sqlLanguageServerPackage, sqlLanguageServerProtocolPackage, sqlLanguageServerJSONRPCPackage} {
		if !strings.Contains(server.InstallCmd, want) {
			t.Fatalf("install command = %q, want %q", server.InstallCmd, want)
		}
	}
	if got := registryInstallCommand(server.ID); got != nil {
		t.Fatalf("registryInstallCommand(%q) = %#v, want nil", server.ID, got)
	}
}

func TestSQLLanguageServerInstallUsesManagedNodeBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses POSIX shell")
	}

	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}
	installer.lspDir = t.TempDir()
	installDir := filepath.Join(installer.lspDir, "sql-language-server")
	resolvedInstallDir, err := filepath.EvalSymlinks(installer.lspDir)
	if err != nil {
		t.Fatalf("EvalSymlinks lsp dir: %v", err)
	}
	resolvedInstallDir = filepath.Join(resolvedInstallDir, "sql-language-server")
	binDir := t.TempDir()
	npmPath := writeExecutable(t, binDir, "npm", `#!/bin/sh
if [ "$(pwd)" != "$TEST_SQL_INSTALL_DIR" ]; then
  echo "npm ran in the wrong directory: $(pwd)" >&2
  exit 1
fi
mkdir -p node_modules/.bin
cat > node_modules/.bin/sql-language-server <<'SERVER'
#!/bin/sh
echo sql-language-server 1.7.1
SERVER
chmod +x node_modules/.bin/sql-language-server
`)
	t.Setenv("TEST_SQL_INSTALL_DIR", resolvedInstallDir)

	server := &LSPInfo{ID: "sql-language-server", BinaryName: "sql-language-server"}
	execution := installExecution{
		tools: map[string]string{"npm": npmPath},
		env:   installCommandEnv([]string{binDir}),
	}
	if err := installer.installManagedNPM(context.Background(), server, execution); err != nil {
		t.Fatalf("installManagedNPM: %v", err)
	}

	manifest, err := os.ReadFile(filepath.Join(installDir, "package.json"))
	if err != nil {
		t.Fatalf("ReadFile package.json: %v", err)
	}
	for _, want := range []string{"\"vscode-languageserver-protocol\": \"3.16.0\"", "\"vscode-jsonrpc\": \"6.0.0\""} {
		if !strings.Contains(string(manifest), want) {
			t.Fatalf("manifest missing %q: %s", want, manifest)
		}
	}
	want := filepath.Join(installDir, "node_modules", ".bin", "sql-language-server")
	if got := FindServerBinaryPath("", installer.lspDir, server.ID, server.BinaryName); got != want {
		t.Fatalf("managed npm binary = %q, want %q", got, want)
	}
}

func TestCMakeLanguageServerUsesManagedPythonEnvironment(t *testing.T) {
	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}

	server := installer.GetServerByID("cmake-language-server")
	if server == nil {
		t.Fatal("cmake-language-server should exist")
	}
	if server.InstallType != "python-venv" {
		t.Fatalf("install type = %q, want python-venv", server.InstallType)
	}
	if !strings.Contains(server.InstallCmd, cmakeLanguageServerPackage) || !strings.Contains(server.InstallCmd, cmakeLanguageServerPyglsPackage) {
		t.Fatalf("install command = %q, want pinned CMake and pygls packages", server.InstallCmd)
	}
	if !reflect.DeepEqual(server.Dependencies, []string{"python3", "cmake"}) {
		t.Fatalf("dependencies = %#v, want python3 and cmake", server.Dependencies)
	}
	if got := registryInstallCommand(server.ID); got != nil {
		t.Fatalf("registryInstallCommand(%q) = %#v, want nil", server.ID, got)
	}
}

func TestCMakeLanguageServerPythonCompatibility(t *testing.T) {
	tests := []struct {
		name  string
		major int
		minor int
		want  bool
	}{
		{name: "python 3.8", major: 3, minor: 8, want: true},
		{name: "python 3.12", major: 3, minor: 12, want: true},
		{name: "python 3.13", major: 3, minor: 13, want: false},
		{name: "python 3.14", major: 3, minor: 14, want: false},
		{name: "python 2.7", major: 2, minor: 7, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cmakeLanguageServerSupportsPython(tt.major, tt.minor); got != tt.want {
				t.Fatalf("cmakeLanguageServerSupportsPython(%d, %d) = %t, want %t", tt.major, tt.minor, got, tt.want)
			}
		})
	}
}

func TestCMakeLanguageServerInstallUsesManagedVenvBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses POSIX shell")
	}

	installer, err := NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller failed: %v", err)
	}
	installer.lspDir = t.TempDir()
	binDir := t.TempDir()
	venvArgsPath := filepath.Join(t.TempDir(), "venv-args")
	t.Setenv("TEST_CMAKE_VENV_ARGS", venvArgsPath)
	pythonPath := writeExecutable(t, binDir, "python3", `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo Python 3.9.6
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  printf '%s\n' "$@" > "$TEST_CMAKE_VENV_ARGS"
  for arg in "$@"; do
    target="$arg"
  done
  mkdir -p "$target/bin"
  cat > "$target/bin/python" <<'PYTHON'
#!/bin/sh
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  bin_dir=$(dirname "$0")
  cat > "$bin_dir/cmake-language-server" <<'SERVER'
#!/bin/sh
echo cmake-language-server 0.1.11
SERVER
  chmod +x "$bin_dir/cmake-language-server"
  exit 0
fi
exit 1
PYTHON
  chmod +x "$target/bin/python"
  exit 0
fi
exit 1
`)

	server := &LSPInfo{
		ID:         "cmake-language-server",
		BinaryName: "cmake-language-server",
	}
	execution := installExecution{
		tools: map[string]string{"python3": pythonPath},
		env:   installCommandEnv([]string{binDir}),
	}
	if err := installer.installPythonVenv(context.Background(), server, execution); err != nil {
		t.Fatalf("installPythonVenv: %v", err)
	}

	venvArgs, err := os.ReadFile(venvArgsPath)
	if err != nil {
		t.Fatalf("ReadFile venv args: %v", err)
	}
	if !strings.Contains(string(venvArgs), "--clear") {
		t.Fatalf("venv arguments = %q, want --clear", venvArgs)
	}

	_, _, want := pythonVenvPaths(installer.lspDir, server.ID, server.BinaryName)
	if got := FindServerBinaryPath("", installer.lspDir, server.ID, server.BinaryName); got != want {
		t.Fatalf("managed venv binary = %q, want %q", got, want)
	}
	if !executableFileExists(filepath.Join(installer.lspDir, server.ID, "bin", server.BinaryName)) {
		t.Fatalf("managed CMake language server was not created")
	}
}
