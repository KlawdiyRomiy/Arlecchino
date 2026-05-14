package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenSharesProjectDBHandleAndKeepsSchemaVersioned(t *testing.T) {
	root := t.TempDir()

	first, err := Open(root)
	if err != nil {
		t.Fatalf("Open first: %v", err)
	}
	second, err := Open(root)
	if err != nil {
		t.Fatalf("Open second: %v", err)
	}
	if first.DB() != second.DB() {
		t.Fatalf("Open returned different sql.DB handles for the same project")
	}

	var migrations int
	if err := first.DB().QueryRow(`SELECT COUNT(*) FROM ai_schema_migrations`).Scan(&migrations); err != nil {
		t.Fatalf("schema migrations table: %v", err)
	}
	if migrations < 2 {
		t.Fatalf("migration count = %d, want at least 2", migrations)
	}
	if _, err := first.DB().Exec(`SELECT 1 FROM ai_skill_registry LIMIT 1`); err != nil {
		t.Fatalf("skill registry schema missing: %v", err)
	}

	if err := first.Close(); err != nil {
		t.Fatalf("Close first: %v", err)
	}
	if err := second.DB().Ping(); err != nil {
		t.Fatalf("second handle should remain usable after first close: %v", err)
	}
	if err := second.Close(); err != nil {
		t.Fatalf("Close second: %v", err)
	}
}

func TestOpenCanonicalizesProjectRootBeforeSharingHandle(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "project")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	if err := os.Chdir(parent); err != nil {
		t.Fatalf("Chdir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	first, err := Open("project")
	if err != nil {
		t.Fatalf("Open relative: %v", err)
	}
	defer first.Close()
	second, err := Open(root)
	if err != nil {
		t.Fatalf("Open absolute: %v", err)
	}
	defer second.Close()
	if first.DB() != second.DB() {
		t.Fatalf("relative and absolute project roots did not share one sql.DB handle")
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}
	if first.ProjectRoot() != canonicalRoot || second.ProjectRoot() != canonicalRoot {
		t.Fatalf("project roots were not canonicalized: first=%q second=%q want=%q", first.ProjectRoot(), second.ProjectRoot(), canonicalRoot)
	}
}

func TestOpenCanonicalizesSymlinkedProjectRootBeforeSharingHandle(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "project")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	alias := filepath.Join(parent, "project-alias")
	if err := os.Symlink(root, alias); err != nil {
		t.Skipf("Symlink unavailable: %v", err)
	}

	first, err := Open(root)
	if err != nil {
		t.Fatalf("Open real root: %v", err)
	}
	defer first.Close()
	second, err := Open(alias)
	if err != nil {
		t.Fatalf("Open symlink root: %v", err)
	}
	defer second.Close()
	if first.DB() != second.DB() {
		t.Fatalf("real and symlinked project roots did not share one sql.DB handle")
	}
	if first.ProjectRoot() != second.ProjectRoot() || first.DBPath() != second.DBPath() {
		t.Fatalf("canonical identity mismatch: first=(%q,%q) second=(%q,%q)", first.ProjectRoot(), first.DBPath(), second.ProjectRoot(), second.DBPath())
	}
}
