package app

import (
	"os"
	"path/filepath"
	"testing"

	indexerlsp "arlecchino/internal/indexer/lsp"
	lspinstaller "arlecchino/internal/lsp"
)

func TestRefreshLSPConfigsFromInstallerRegistersProjectBinary(t *testing.T) {
	root := t.TempDir()
	phpactorPath := filepath.Join(root, "vendor", "bin", "phpactor")
	if err := os.MkdirAll(filepath.Dir(phpactorPath), 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(phpactorPath, []byte("#!/bin/sh\necho phpactor\n"), 0755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	installer, err := lspinstaller.NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller: %v", err)
	}
	manager := indexerlsp.NewManager(root)
	session := &ProjectRuntimeSession{
		ID:         defaultProjectSessionID,
		IsDefault:  true,
		lspManager: manager,
		brain:      &fakeBrain{},
	}
	session.setProjectPath(root)
	session.projectGeneration.Store(1)

	app := &App{lspInstaller: installer}
	app.refreshLSPConfigsFromInstallerForSession(session)

	if !manager.HasConfig("php") {
		t.Fatalf("expected php LSP config to be registered")
	}
	server, ok := manager.GetServer("php")
	if ok && server != nil {
		t.Fatalf("refresh should register config without starting server")
	}
}

func TestAutocompleteCapabilitiesUseUsableLSPAvailability(t *testing.T) {
	root := t.TempDir()
	phpactorPath := filepath.Join(root, "vendor", "bin", "phpactor")
	if err := os.MkdirAll(filepath.Dir(phpactorPath), 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(phpactorPath, []byte("#!/bin/sh\necho phpactor\n"), 0755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	installer, err := lspinstaller.NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller: %v", err)
	}
	manager := indexerlsp.NewManager(root)
	manager.RegisterServer(indexerlsp.ServerConfig{Language: "php", Command: phpactorPath})

	app := &App{lspInstaller: installer, lspManager: manager}
	app.setProjectPath(root)

	php := findCapability(t, app.GetAutocompleteLanguageCapabilities(), "php")
	if !php.LSPConfigured {
		t.Fatalf("expected php to be configured")
	}
	if !php.LSPInstalled || php.LSPBinaryPath != phpactorPath {
		t.Fatalf("expected project phpactor installed, got installed=%v path=%q", php.LSPInstalled, php.LSPBinaryPath)
	}
	if !php.Sources.LSPAvailable {
		t.Fatalf("expected lspAvailable for configured project phpactor")
	}
	if php.LSPRunning {
		t.Fatalf("capability getter should not report running before server start")
	}
}

func TestAutocompleteCapabilitiesDoNotTreatConfigAsAvailableWithoutBinary(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", t.TempDir())
	if got := lspinstaller.FindBinaryPath("", "", "phpactor", "phpactor"); got != "" {
		t.Skipf("phpactor exists on this machine at %s", got)
	}

	root := t.TempDir()
	installer, err := lspinstaller.NewInstaller(nil)
	if err != nil {
		t.Fatalf("NewInstaller: %v", err)
	}
	manager := indexerlsp.NewManager(root)
	manager.RegisterServer(indexerlsp.ServerConfig{Language: "php", Command: filepath.Join(root, "missing-phpactor")})

	app := &App{lspInstaller: installer, lspManager: manager}
	app.setProjectPath(root)

	php := findCapability(t, app.GetAutocompleteLanguageCapabilities(), "php")
	if !php.LSPConfigured {
		t.Fatalf("expected php to be configured")
	}
	if php.LSPInstalled || php.Sources.LSPAvailable {
		t.Fatalf("configured missing phpactor should not be available: installed=%v available=%v", php.LSPInstalled, php.Sources.LSPAvailable)
	}
	if !php.LSPCanInstall {
		t.Fatalf("expected missing phpactor to remain installable")
	}
}

func findCapability(t *testing.T, capabilities []AutocompleteLanguageCapability, id string) AutocompleteLanguageCapability {
	t.Helper()
	for _, capability := range capabilities {
		if capability.ID == id {
			return capability
		}
	}
	t.Fatalf("capability %q not found", id)
	return AutocompleteLanguageCapability{}
}
