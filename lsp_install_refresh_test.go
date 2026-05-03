package main

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
