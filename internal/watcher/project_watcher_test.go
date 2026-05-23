package watcher

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/fsnotify/fsnotify"
)

func TestProjectWatcherSkipsDynamicIgnoredDirectoryEvents(t *testing.T) {
	root := t.TempDir()
	w := NewProjectWatcher(Options{
		SkipDirs: map[string]struct{}{
			".arlecchino":  {},
			"node_modules": {},
		},
	})

	ignoredDir := filepath.Join(root, "node_modules")
	if err := os.MkdirAll(ignoredDir, 0755); err != nil {
		t.Fatalf("mkdir ignored dir: %v", err)
	}
	addWatchCalled := false
	events := w.eventsFromFSNotify(
		root,
		fsnotify.Event{Name: ignoredDir, Op: fsnotify.Create},
		map[string]Snapshot{},
		func(string) { addWatchCalled = true },
	)
	if len(events) != 0 {
		t.Fatalf("ignored dir emitted events: %#v", events)
	}
	if addWatchCalled {
		t.Fatalf("ignored dir should not be added as a watch")
	}

	nestedIgnoredDir := filepath.Join(root, "frontend", "node_modules")
	if err := os.MkdirAll(nestedIgnoredDir, 0755); err != nil {
		t.Fatalf("mkdir nested ignored dir: %v", err)
	}
	events = w.eventsFromFSNotify(
		root,
		fsnotify.Event{Name: nestedIgnoredDir, Op: fsnotify.Create},
		map[string]Snapshot{},
		func(string) { addWatchCalled = true },
	)
	if len(events) != 0 {
		t.Fatalf("nested ignored dir emitted events: %#v", events)
	}
	if addWatchCalled {
		t.Fatalf("nested ignored dir should not be added as a watch")
	}
}

func TestProjectWatcherSkipsNestedIgnoredPathEvents(t *testing.T) {
	root := t.TempDir()
	w := NewProjectWatcher(Options{
		SkipDirs: map[string]struct{}{
			"node_modules": {},
		},
	})
	path := filepath.Join(root, "frontend", "node_modules", "pkg", "index.js")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir nested ignored parent: %v", err)
	}
	if err := os.WriteFile(path, []byte("module.exports = {}"), 0644); err != nil {
		t.Fatalf("write nested ignored file: %v", err)
	}

	events := w.eventsFromFSNotify(
		root,
		fsnotify.Event{Name: path, Op: fsnotify.Create},
		map[string]Snapshot{},
		func(string) { t.Fatalf("file event should not add a watch") },
	)
	if len(events) != 0 {
		t.Fatalf("nested ignored file emitted events: %#v", events)
	}
}

func TestProjectWatcherStillEmitsNormalCreatedFiles(t *testing.T) {
	root := t.TempDir()
	w := NewProjectWatcher(Options{
		SkipDirs: map[string]struct{}{
			"node_modules": {},
		},
	})
	path := filepath.Join(root, "src", "main.go")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir source parent: %v", err)
	}
	if err := os.WriteFile(path, []byte("package main\n"), 0644); err != nil {
		t.Fatalf("write source file: %v", err)
	}

	events := w.eventsFromFSNotify(
		root,
		fsnotify.Event{Name: path, Op: fsnotify.Create},
		map[string]Snapshot{},
		func(string) { t.Fatalf("file event should not add a watch") },
	)
	if len(events) != 1 {
		t.Fatalf("events length = %d, want 1 (%#v)", len(events), events)
	}
	if events[0].Kind != EventCreated || events[0].Path != path || events[0].IsDirectory {
		t.Fatalf("unexpected event: %#v", events[0])
	}
}
