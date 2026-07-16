package lsp

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAstroInitParamsNestTypeScriptSDKInInitializationOptions(t *testing.T) {
	root := t.TempDir()
	tsdk := filepath.Join(root, "node_modules", "typescript", "lib")
	if err := os.MkdirAll(tsdk, 0755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", tsdk, err)
	}
	if err := os.WriteFile(filepath.Join(tsdk, "typescript.js"), []byte("// fixture\n"), 0644); err != nil {
		t.Fatalf("WriteFile(typescript.js): %v", err)
	}

	params := initParamsForServer(root, "astro-ls")
	options, ok := params["initializationOptions"].(map[string]any)
	if !ok {
		t.Fatalf("initializationOptions = %#v, want object", params["initializationOptions"])
	}
	typescript, ok := options["typescript"].(map[string]any)
	if !ok {
		t.Fatalf("initializationOptions.typescript = %#v, want object", options["typescript"])
	}
	if got := typescript["tsdk"]; got != tsdk {
		t.Fatalf("initializationOptions.typescript.tsdk = %#v, want %q", got, tsdk)
	}
	if _, ok := params["typescript"]; ok {
		t.Fatalf("typescript must be nested under initializationOptions: %#v", params)
	}
}
