package app

import (
	"fmt"
	"os"
	"path/filepath"
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

func TestScanProjectEntriesWithBudgetBoundsLargeTrees(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 8; i++ {
		path := filepath.Join(dir, fmt.Sprintf("file-%02d.txt", i))
		if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
	}

	result, err := scanProjectEntriesWithBudget(dir, 4)
	if err != nil {
		t.Fatalf("scanProjectEntriesWithBudget: %v", err)
	}
	if !result.Bounded {
		t.Fatalf("expected bounded scan for over-budget tree")
	}
	if len(result.Entries) != 4 {
		t.Fatalf("entries = %d, want 4", len(result.Entries))
	}
}

func TestProjectWatchEventLimit(t *testing.T) {
	created := []projectEntryCreatedEvent{
		{Path: "/tmp/a"},
		{Path: "/tmp/b"},
		{Path: "/tmp/c"},
	}
	if got := limitProjectWatchCreatedEvents(created, 2); len(got) != 2 {
		t.Fatalf("created limit length = %d, want 2", len(got))
	}

	changed := []string{"/tmp/a", "/tmp/b", "/tmp/c"}
	if got := limitProjectWatchChangedEvents(changed, 2); len(got) != 2 {
		t.Fatalf("changed limit length = %d, want 2", len(got))
	}
}
