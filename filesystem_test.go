package main

import (
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
