package dispatcher

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSearchContentFindsMakefile(t *testing.T) {
	root := t.TempDir()
	makefilePath := filepath.Join(root, "Makefile")
	if err := os.WriteFile(makefilePath, []byte("dev-start:\n\tgo run .\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(Makefile) error = %v", err)
	}

	engine := NewSearchEngine(root)
	results := engine.SearchContent("dev-start", false)
	if len(results) != 1 {
		t.Fatalf("SearchContent() len = %d, want 1", len(results))
	}
	if results[0].FilePath != makefilePath {
		t.Fatalf("SearchContent() FilePath = %q, want %q", results[0].FilePath, makefilePath)
	}
	if results[0].Line != 1 {
		t.Fatalf("SearchContent() Line = %d, want 1", results[0].Line)
	}
}

func TestSearchContentNoMatchesReturnsEmptySlice(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(main.go) error = %v", err)
	}

	engine := NewSearchEngine(root)
	results := engine.SearchContent("missing-value", false)
	if results == nil {
		t.Fatal("SearchContent() returned nil, want empty slice")
	}
	if len(results) != 0 {
		t.Fatalf("SearchContent() len = %d, want 0", len(results))
	}
}
