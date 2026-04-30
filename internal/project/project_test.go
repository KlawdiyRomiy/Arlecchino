package project

import (
	"path/filepath"
	"testing"
)

func TestResolveDBPathUsesExplicitDataDir(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("ARLECCHINO_DATA_DIR", dataDir)
	t.Setenv("ARLECCHINO_PACKAGED_BUILD", "1")

	got := ResolveDBPath("data/projects.db")
	want := filepath.Join(dataDir, "projects.db")
	if got != want {
		t.Fatalf("ResolveDBPath() = %q, want %q", got, want)
	}
}

func TestResolveDBPathKeepsDevRelativePath(t *testing.T) {
	t.Setenv("ARLECCHINO_DATA_DIR", "")
	t.Setenv("ARLECCHINO_PACKAGED_BUILD", "")

	if got := ResolveDBPath("data/projects.db"); got != "data/projects.db" {
		t.Fatalf("ResolveDBPath() = %q, want data/projects.db", got)
	}
}
