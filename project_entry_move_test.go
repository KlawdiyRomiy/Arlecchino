package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMoveProjectEntry_RewritesRelativeJSTSImports(t *testing.T) {
	projectDir := t.TempDir()
	sourceDir := filepath.Join(projectDir, "src", "a")
	targetDir := filepath.Join(projectDir, "src", "b", "nested")
	sharedDir := filepath.Join(projectDir, "src", "shared")
	for _, dir := range []string{sourceDir, targetDir, sharedDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("MkdirAll(%q) error = %v", dir, err)
		}
	}

	sourcePath := filepath.Join(sourceDir, "foo.ts")
	consumerPath := filepath.Join(projectDir, "src", "consumer.ts")
	sharedPath := filepath.Join(sharedDir, "util.ts")
	if err := os.WriteFile(sourcePath, []byte("import { util } from \"../shared/util\";\nexport const foo = util;\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(source) error = %v", err)
	}
	if err := os.WriteFile(consumerPath, []byte("import { foo } from \"./a/foo\";\nexport const value = foo;\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(consumer) error = %v", err)
	}
	if err := os.WriteFile(sharedPath, []byte("export const util = 1;\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(shared) error = %v", err)
	}

	app := &App{ctx: context.Background()}
	app.setProjectPath(projectDir)

	result, err := app.MoveProjectEntry(sourcePath, targetDir)
	if err != nil {
		t.Fatalf("MoveProjectEntry() error = %v", err)
	}
	if result.RewrittenFiles != 2 {
		t.Fatalf("RewrittenFiles = %d, want 2", result.RewrittenFiles)
	}
	if result.RewrittenImports != 2 {
		t.Fatalf("RewrittenImports = %d, want 2", result.RewrittenImports)
	}

	movedPath := filepath.Join(targetDir, "foo.ts")
	movedContent, err := os.ReadFile(movedPath)
	if err != nil {
		t.Fatalf("ReadFile(moved) error = %v", err)
	}
	if !strings.Contains(string(movedContent), `"../../shared/util"`) {
		t.Fatalf("moved import was not rewritten correctly:\n%s", movedContent)
	}

	consumerContent, err := os.ReadFile(consumerPath)
	if err != nil {
		t.Fatalf("ReadFile(consumer) error = %v", err)
	}
	if !strings.Contains(string(consumerContent), `"./b/nested/foo"`) {
		t.Fatalf("consumer import was not rewritten correctly:\n%s", consumerContent)
	}
}

func TestMoveProjectEntry_RejectsCollision(t *testing.T) {
	projectDir := t.TempDir()
	sourcePath := filepath.Join(projectDir, "source.txt")
	targetDir := filepath.Join(projectDir, "target")
	targetPath := filepath.Join(targetDir, "source.txt")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	for _, path := range []string{sourcePath, targetPath} {
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", path, err)
		}
	}

	app := &App{}
	app.setProjectPath(projectDir)

	_, err := app.MoveProjectEntry(sourcePath, targetDir)
	if err == nil {
		t.Fatal("MoveProjectEntry() error = nil, want collision error")
	}
	if !strings.Contains(err.Error(), "entry already exists") {
		t.Fatalf("MoveProjectEntry() error = %v, want collision error", err)
	}
}

func TestMoveProjectEntry_RejectsDirectoryIntoItself(t *testing.T) {
	projectDir := t.TempDir()
	sourceDir := filepath.Join(projectDir, "source")
	childDir := filepath.Join(sourceDir, "child")
	if err := os.MkdirAll(childDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	app := &App{}
	app.setProjectPath(projectDir)

	_, err := app.MoveProjectEntry(sourceDir, childDir)
	if err == nil {
		t.Fatal("MoveProjectEntry() error = nil, want self-move error")
	}
	if !strings.Contains(err.Error(), "cannot move a directory into itself") {
		t.Fatalf("MoveProjectEntry() error = %v, want self-move error", err)
	}
}
