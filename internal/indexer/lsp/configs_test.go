package lsp

import (
	"os"
	"path/filepath"
	"testing"

	lspregistry "arlecchino/internal/lsp"
)

func TestConfigsFromInstallerUsesProjectLocalPhpactor(t *testing.T) {
	root := t.TempDir()
	phpactorPath := writeConfigTestExecutable(t, filepath.Join(root, "vendor", "bin"), "phpactor")

	installer, err := lspregistry.NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller: %v", err)
	}

	configs := ConfigsFromInstaller(root, installer)
	for _, cfg := range configs {
		if cfg.Language == "php" {
			if cfg.Command != phpactorPath {
				t.Fatalf("php command = %q, want %q", cfg.Command, phpactorPath)
			}
			return
		}
	}
	t.Fatalf("expected php config from project-local phpactor")
}

func TestFindExecutableDoesNotReturnPhantomCommand(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("HOME", t.TempDir())

	if got := findExecutable(t.TempDir(), "arlecchino-definitely-missing-lsp"); got != "" {
		t.Fatalf("missing executable resolved to %q", got)
	}
}

func writeConfigTestExecutable(t *testing.T, dir, name string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", dir, err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho ok\n"), 0755); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}
	return path
}
