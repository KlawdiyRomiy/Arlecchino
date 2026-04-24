package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestReadDirectory_EmptyDirectoryReturnsEmptySlice(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	app := &App{}

	entries, err := app.ReadDirectory(dir)
	if err != nil {
		t.Fatalf("ReadDirectory returned error: %v", err)
	}
	if entries == nil {
		t.Fatal("ReadDirectory returned nil slice for empty directory")
	}
	if len(entries) != 0 {
		t.Fatalf("expected empty directory to return zero entries, got %d", len(entries))
	}
}

type capturedRuntimeEvent struct {
	Name string
	Data []any
}

func captureRuntimeEvents(t *testing.T) (*[]capturedRuntimeEvent, func()) {
	t.Helper()

	events := make([]capturedRuntimeEvent, 0)
	var mu sync.Mutex
	previous := runtimeEventsEmit
	runtimeEventsEmit = func(_ context.Context, name string, data ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		copied := append([]any(nil), data...)
		events = append(events, capturedRuntimeEvent{Name: name, Data: copied})
	}

	return &events, func() {
		runtimeEventsEmit = previous
	}
}

func TestRenameProjectEntry_EmitsRenameEvent(t *testing.T) {
	projectDir := t.TempDir()
	originalPath := filepath.Join(projectDir, "notes.txt")
	if err := os.WriteFile(originalPath, []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	app := &App{ctx: context.Background()}
	app.setProjectPath(projectDir)
	events, restore := captureRuntimeEvents(t)
	defer restore()

	result, err := app.RenameProjectEntry(originalPath, "renamed.txt")
	if err != nil {
		t.Fatalf("RenameProjectEntry() error = %v", err)
	}

	expectedPath := filepath.Join(projectDir, "renamed.txt")
	if result.NewPath != expectedPath {
		t.Fatalf("RenameProjectEntry() new path = %q, want %q", result.NewPath, expectedPath)
	}
	if result.IsDirectory {
		t.Fatal("RenameProjectEntry() reported file as directory")
	}
	if _, err := os.Stat(expectedPath); err != nil {
		t.Fatalf("renamed file missing: %v", err)
	}
	if _, err := os.Stat(originalPath); !os.IsNotExist(err) {
		t.Fatalf("original path still exists or unexpected error: %v", err)
	}

	if len(*events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(*events))
	}
	if (*events)[0].Name != "project:entry:renamed" {
		t.Fatalf("event name = %q, want %q", (*events)[0].Name, "project:entry:renamed")
	}

	payload, ok := (*events)[0].Data[0].(projectEntryRenamedEvent)
	if !ok {
		t.Fatalf("event payload type = %T, want projectEntryRenamedEvent", (*events)[0].Data[0])
	}
	if payload.OldPath != originalPath || payload.NewPath != expectedPath || payload.IsDirectory {
		t.Fatalf("unexpected rename payload: %#v", payload)
	}
}

func TestRenameProjectEntry_RejectsCollision(t *testing.T) {
	projectDir := t.TempDir()
	sourcePath := filepath.Join(projectDir, "source.txt")
	targetPath := filepath.Join(projectDir, "target.txt")
	for _, path := range []string{sourcePath, targetPath} {
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", path, err)
		}
	}

	app := &App{}
	app.setProjectPath(projectDir)

	_, err := app.RenameProjectEntry(sourcePath, "target.txt")
	if err == nil {
		t.Fatal("RenameProjectEntry() error = nil, want collision error")
	}
	if !strings.Contains(err.Error(), "entry already exists") {
		t.Fatalf("RenameProjectEntry() error = %v, want collision error", err)
	}
}

func TestRenameProjectEntry_RejectsPathOutsideProject(t *testing.T) {
	projectDir := t.TempDir()
	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "outside.txt")
	if err := os.WriteFile(outsidePath, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	app := &App{}
	app.setProjectPath(projectDir)

	_, err := app.RenameProjectEntry(outsidePath, "renamed.txt")
	if err == nil {
		t.Fatal("RenameProjectEntry() error = nil, want project guard error")
	}
	if !strings.Contains(err.Error(), "outside current project") {
		t.Fatalf("RenameProjectEntry() error = %v, want outside current project", err)
	}
}

func TestTrashProjectEntry_EmitsDeletedEvent(t *testing.T) {
	projectDir := t.TempDir()
	filePath := filepath.Join(projectDir, "trash-me.txt")
	if err := os.WriteFile(filePath, []byte("bye"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	app := &App{ctx: context.Background()}
	app.setProjectPath(projectDir)
	events, restoreEvents := captureRuntimeEvents(t)
	defer restoreEvents()

	var trashedPath string
	previousTrash := trashProjectEntry
	trashProjectEntry = func(path string, isDirectory bool) error {
		trashedPath = path
		if isDirectory {
			t.Fatal("trash stub received directory for file path")
		}
		return nil
	}
	defer func() {
		trashProjectEntry = previousTrash
	}()

	if err := app.TrashProjectEntry(filePath); err != nil {
		t.Fatalf("TrashProjectEntry() error = %v", err)
	}
	if trashedPath != filePath {
		t.Fatalf("trash path = %q, want %q", trashedPath, filePath)
	}
	if len(*events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(*events))
	}
	if (*events)[0].Name != "project:entry:deleted" {
		t.Fatalf("event name = %q, want %q", (*events)[0].Name, "project:entry:deleted")
	}

	payload, ok := (*events)[0].Data[0].(projectEntryDeletedEvent)
	if !ok {
		t.Fatalf("event payload type = %T, want projectEntryDeletedEvent", (*events)[0].Data[0])
	}
	if payload.Path != filePath || payload.IsDirectory {
		t.Fatalf("unexpected delete payload: %#v", payload)
	}
}
