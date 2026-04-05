package main

import (
	"testing"
	"time"
)

func TestDiffChangedProjectFiles(t *testing.T) {
	now := time.Now()
	previous := map[string]projectEntrySnapshot{
		"/tmp/project/package.json": {
			Size:       10,
			ModifiedAt: now,
		},
		"/tmp/project/src": {
			IsDirectory: true,
			ModifiedAt:  now,
		},
	}
	current := map[string]projectEntrySnapshot{
		"/tmp/project/package.json": {
			Size:       11,
			ModifiedAt: now.Add(time.Second),
		},
		"/tmp/project/src": {
			IsDirectory: true,
			ModifiedAt:  now.Add(time.Second),
		},
		"/tmp/project/new.txt": {
			Size:       5,
			ModifiedAt: now.Add(time.Second),
		},
	}

	changed := diffChangedProjectFiles(previous, current)
	if len(changed) != 1 || changed[0] != "/tmp/project/package.json" {
		t.Fatalf("expected only modified file to be reported, got %#v", changed)
	}
}

func TestDiffCreatedProjectEntries(t *testing.T) {
	now := time.Now()
	previous := map[string]projectEntrySnapshot{
		"/tmp/project/package.json": {Size: 10, ModifiedAt: now},
	}
	current := map[string]projectEntrySnapshot{
		"/tmp/project/package.json": {Size: 10, ModifiedAt: now},
		"/tmp/project/src": {
			IsDirectory: true,
			ModifiedAt:  now,
		},
		"/tmp/project/go.mod": {Size: 20, ModifiedAt: now},
	}

	created := diffCreatedProjectEntries(previous, current)
	if len(created) != 2 {
		t.Fatalf("expected 2 created entries, got %d", len(created))
	}
	if created[0].Path != "/tmp/project/go.mod" || created[1].Path != "/tmp/project/src" {
		t.Fatalf("unexpected created ordering/content: %#v", created)
	}
}
