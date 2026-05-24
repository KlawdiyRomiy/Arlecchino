package app

import (
	"arlecchino/internal/mcp"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestResolveMCPBootstrapOptions_DefaultGlobalEnabled(t *testing.T) {
	options, err := resolveMCPBootstrapOptions(nil)
	if err != nil {
		t.Fatalf("resolveMCPBootstrapOptions() error = %v", err)
	}

	if options.projectRoot == "" {
		t.Fatalf("resolveMCPBootstrapOptions() projectRoot should not be empty")
	}
	if options.executablePath == "" {
		t.Fatalf("resolveMCPBootstrapOptions() executablePath should not be empty")
	}
	if !options.global {
		t.Fatalf("resolveMCPBootstrapOptions() global should be true by default")
	}
}

func TestResolveMCPBootstrapOptions_ProjectOnlyDisablesGlobal(t *testing.T) {
	options, err := resolveMCPBootstrapOptions([]string{"--project-only"})
	if err != nil {
		t.Fatalf("resolveMCPBootstrapOptions(--project-only) error = %v", err)
	}

	if options.global {
		t.Fatalf("resolveMCPBootstrapOptions(--project-only) global should be false")
	}
}

func TestResolveMCPBootstrapOptions_Help(t *testing.T) {
	_, err := resolveMCPBootstrapOptions([]string{"--help"})
	if !errors.Is(err, errMCPBootstrapUsageRequested) {
		t.Fatalf("resolveMCPBootstrapOptions(--help) err = %v, want errMCPBootstrapUsageRequested", err)
	}
}

func TestResolveMCPBootstrapOptions_DevModeDefaultsToCurrentDirectory(t *testing.T) {
	options, err := resolveMCPBootstrapOptions([]string{"--dev"})
	if err != nil {
		t.Fatalf("resolveMCPBootstrapOptions(--dev) error = %v", err)
	}

	if !options.devMode {
		t.Fatalf("resolveMCPBootstrapOptions(--dev) devMode should be true")
	}
	if strings.TrimSpace(options.devRepoRoot) == "" {
		t.Fatalf("resolveMCPBootstrapOptions(--dev) devRepoRoot should not be empty")
	}
}

func TestResolveMCPBootstrapOptions_DevRepoRequiresDevFlag(t *testing.T) {
	_, err := resolveMCPBootstrapOptions([]string{"--dev-repo", "/tmp/repo"})
	if err == nil {
		t.Fatalf("resolveMCPBootstrapOptions(--dev-repo without --dev) should fail")
	}
	if !strings.Contains(err.Error(), "--dev-repo requires --dev") {
		t.Fatalf("resolveMCPBootstrapOptions(--dev-repo) error = %v, want contains %q", err, "--dev-repo requires --dev")
	}
}

func TestResolveMCPBootstrapOptions_DevDisallowsExecutable(t *testing.T) {
	_, err := resolveMCPBootstrapOptions([]string{"--dev", "--executable", "/usr/local/bin/arlecchino"})
	if err == nil {
		t.Fatalf("resolveMCPBootstrapOptions(--dev --executable ...) should fail")
	}
	if !strings.Contains(err.Error(), "cannot be used with --dev") {
		t.Fatalf("resolveMCPBootstrapOptions(--dev --executable) error = %v, want contains %q", err, "cannot be used with --dev")
	}
}

func TestResolveMCPBootstrapServerCommand_DevModeUsesGoRun(t *testing.T) {
	repoRoot := t.TempDir()
	repoAbs, err := filepath.Abs(repoRoot)
	if err != nil {
		t.Fatalf("filepath.Abs(repoRoot) error = %v", err)
	}

	command, err := resolveMCPBootstrapServerCommand(mcpBootstrapOptions{
		devMode:     true,
		devRepoRoot: repoAbs,
	})
	if err != nil {
		t.Fatalf("resolveMCPBootstrapServerCommand(dev) error = %v", err)
	}

	if command.Executable != "go" {
		t.Fatalf("dev command executable = %q, want %q", command.Executable, "go")
	}
	wantPrefix := []string{"-C", repoAbs, "run", "."}
	if !reflect.DeepEqual(command.PrefixArgs, wantPrefix) {
		t.Fatalf("dev command prefixArgs = %#v, want %#v", command.PrefixArgs, wantPrefix)
	}
}

func TestResolveMCPBootstrapServerCommand_ReleaseModeUsesExecutable(t *testing.T) {
	command, err := resolveMCPBootstrapServerCommand(mcpBootstrapOptions{
		executablePath: "/usr/local/bin/arlecchino",
	})
	if err != nil {
		t.Fatalf("resolveMCPBootstrapServerCommand(release) error = %v", err)
	}

	if command.Executable != "/usr/local/bin/arlecchino" {
		t.Fatalf("release command executable = %q, want %q", command.Executable, "/usr/local/bin/arlecchino")
	}
	if len(command.PrefixArgs) != 0 {
		t.Fatalf("release command prefixArgs = %#v, want empty", command.PrefixArgs)
	}
}

func TestRenderBootstrapServerCommand_DevModeIncludesProject(t *testing.T) {
	repoRoot := "/Users/dev/My Repo"
	projectRoot := "/Users/dev/Workspace/My Project"

	command := mcp.BootstrapServerCommand{
		Executable: "go",
		PrefixArgs: []string{"-C", repoRoot, "run", "."},
	}

	rendered := renderBootstrapServerCommand(command, projectRoot)
	wantFragments := []string{"" + `"go"`, `"-C"`, `"` + repoRoot + `"`, `"run"`, `"."`, `"mcp-server"`, `"--project"`, `"` + projectRoot + `"`}
	for _, fragment := range wantFragments {
		if !strings.Contains(rendered, fragment) {
			t.Fatalf("renderBootstrapServerCommand() = %q, missing fragment %q", rendered, fragment)
		}
	}
}
