package watcher

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"arlecchino/internal/workspace"

	"github.com/fsnotify/fsnotify"
)

type EventKind string

const (
	EventCreated EventKind = "created"
	EventChanged EventKind = "changed"
	EventDeleted EventKind = "deleted"
)

const (
	BackendFSNotify = "fsnotify"
	BackendPolling  = "polling"
	BackendWatchman = "watchman"
)

type Event struct {
	Kind        EventKind
	Path        string
	IsDirectory bool
}

type Snapshot struct {
	IsDirectory bool
	Size        int64
	ModifiedAt  time.Time
}

type ScanResult struct {
	Entries map[string]Snapshot
	Dirs    []string
	Bounded bool
}

type Options struct {
	MaxEntries          int
	MaxEvents           int
	FSNotifyDirLimit    int
	InitialPollInterval time.Duration
	MaxPollInterval     time.Duration
	BoundedPollInterval time.Duration
	SkipDirs            map[string]struct{}
}

type ProjectWatcher struct {
	options Options
}

func NewProjectWatcher(options Options) *ProjectWatcher {
	return &ProjectWatcher{options: normalizeOptions(options)}
}

func (w *ProjectWatcher) Start(ctx context.Context, root string, emit func([]Event)) error {
	if ctx == nil {
		ctx = context.Background()
	}
	root = strings.TrimSpace(root)
	if root == "" {
		return errors.New("project root is empty")
	}
	if emit == nil {
		emit = func([]Event) {}
	}

	initial, err := scanWithOptions(ctx, root, w.options.MaxEntries, w.options.SkipDirs)
	if err != nil {
		return err
	}

	backend := w.selectBackend(initial)
	switch backend {
	case BackendFSNotify:
		go w.runFSNotify(ctx, root, initial, emit)
	default:
		go w.runPolling(ctx, root, initial, emit)
	}
	return nil
}

func (w *ProjectWatcher) selectBackend(initial ScanResult) string {
	if initial.Bounded {
		if _, err := exec.LookPath("watchman"); err == nil {
			return BackendWatchman
		}
		return BackendPolling
	}
	if len(initial.Dirs) > 0 && len(initial.Dirs) <= w.options.FSNotifyDirLimit {
		return BackendFSNotify
	}
	return BackendPolling
}

func (w *ProjectWatcher) runFSNotify(ctx context.Context, root string, initial ScanResult, emit func([]Event)) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		w.runPolling(ctx, root, initial, emit)
		return
	}
	defer fsw.Close()

	watched := map[string]struct{}{}
	addWatch := func(path string) {
		if w.shouldSkipPath(root, path) {
			return
		}
		if _, ok := watched[path]; ok {
			return
		}
		if err := fsw.Add(path); err == nil {
			watched[path] = struct{}{}
		}
	}
	addWatch(root)
	for _, dir := range initial.Dirs {
		addWatch(dir)
	}

	known := initial.Entries
	for {
		select {
		case <-ctx.Done():
			return
		case err := <-fsw.Errors:
			if err != nil {
				w.runPolling(ctx, root, ScanResult{Entries: known}, emit)
				return
			}
		case event := <-fsw.Events:
			if event.Name == "" {
				continue
			}
			events := w.eventsFromFSNotify(root, event, known, addWatch)
			if len(events) > 0 {
				emit(limitEvents(events, w.options.MaxEvents))
			}
		}
	}
}

func (w *ProjectWatcher) eventsFromFSNotify(root string, event fsnotify.Event, known map[string]Snapshot, addWatch func(string)) []Event {
	if w.shouldSkipPath(root, event.Name) {
		deleteKnownPath(known, event.Name)
		return nil
	}

	if event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {
		previous, existed := deleteKnownPath(known, event.Name)
		return []Event{{
			Kind:        EventDeleted,
			Path:        event.Name,
			IsDirectory: existed && previous.IsDirectory,
		}}
	}

	info, statErr := os.Stat(event.Name)
	if statErr != nil {
		previous, existed := deleteKnownPath(known, event.Name)
		if os.IsNotExist(statErr) && existed {
			return []Event{{
				Kind:        EventDeleted,
				Path:        event.Name,
				IsDirectory: previous.IsDirectory,
			}}
		}
		return nil
	}
	snapshot := Snapshot{IsDirectory: info.IsDir(), Size: info.Size(), ModifiedAt: info.ModTime()}
	previous, existed := known[event.Name]
	known[event.Name] = snapshot
	if snapshot.IsDirectory {
		addWatch(event.Name)
	}

	switch {
	case event.Has(fsnotify.Create) && !existed:
		return []Event{{Kind: EventCreated, Path: event.Name, IsDirectory: snapshot.IsDirectory}}
	case event.Has(fsnotify.Write) || event.Has(fsnotify.Chmod):
		if !snapshot.IsDirectory && (!existed || previous.Size != snapshot.Size || !previous.ModifiedAt.Equal(snapshot.ModifiedAt)) {
			return []Event{{Kind: EventChanged, Path: event.Name}}
		}
	}
	return nil
}

func (w *ProjectWatcher) shouldSkipPath(root string, path string) bool {
	if len(w.options.SkipDirs) == 0 {
		return false
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." || rel == "" {
		return false
	}
	rel = filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return false
	}
	for _, part := range strings.Split(rel, "/") {
		if _, ok := w.options.SkipDirs[part]; ok {
			return true
		}
	}
	return false
}

func (w *ProjectWatcher) runPolling(ctx context.Context, root string, initial ScanResult, emit func([]Event)) {
	known := initial.Entries
	interval := w.initialPollingInterval(initial)
	timer := time.NewTimer(interval)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		current, err := scanWithOptions(ctx, root, w.options.MaxEntries, w.options.SkipDirs)
		if err != nil {
			timer.Reset(w.options.MaxPollInterval)
			continue
		}
		events := eventsFromPollingDiff(known, current)
		known = current.Entries
		if current.Bounded {
			if len(events) > 0 {
				emit(limitEvents(events, w.options.MaxEvents))
			}
			interval = w.options.BoundedPollInterval
		} else if len(events) > 0 {
			emit(limitEvents(events, w.options.MaxEvents))
			interval = w.options.InitialPollInterval
		} else if interval < w.options.MaxPollInterval {
			interval *= 2
			if interval > w.options.MaxPollInterval {
				interval = w.options.MaxPollInterval
			}
		}
		timer.Reset(interval)
	}
}

func eventsFromPollingDiff(previous map[string]Snapshot, current ScanResult) []Event {
	created := DiffCreated(previous, current.Entries)
	changed := DiffChangedFiles(previous, current.Entries)
	if current.Bounded {
		return append(created, changed...)
	}
	deleted := DiffDeleted(previous, current.Entries)
	events := make([]Event, 0, len(deleted)+len(created)+len(changed))
	events = append(events, deleted...)
	events = append(events, created...)
	events = append(events, changed...)
	return events
}

func (w *ProjectWatcher) initialPollingInterval(initial ScanResult) time.Duration {
	if initial.Bounded {
		return w.options.BoundedPollInterval
	}
	return w.options.InitialPollInterval
}

func Scan(ctx context.Context, root string, maxEntries int) (ScanResult, error) {
	return scanWithOptions(ctx, root, maxEntries, nil)
}

func ScanWithSkipDirs(ctx context.Context, root string, maxEntries int, skipDirs map[string]struct{}) (ScanResult, error) {
	return scanWithOptions(ctx, root, maxEntries, skipDirs)
}

func scanWithOptions(ctx context.Context, root string, maxEntries int, skipDirs map[string]struct{}) (ScanResult, error) {
	scanner, err := workspace.NewScanner(root, workspace.ScannerOptions{
		MaxEntries:   maxEntries,
		IncludeDirs:  true,
		UseGitIgnore: true,
		SkipDirs:     skipDirs,
	})
	if err != nil {
		return ScanResult{}, err
	}
	entries := map[string]Snapshot{}
	dirs := make([]string, 0)
	_, err = scanner.Walk(ctx, func(entry workspace.Entry) error {
		entries[entry.Path] = Snapshot{
			IsDirectory: entry.IsDirectory,
			Size:        entry.Size,
			ModifiedAt:  entry.ModifiedAt,
		}
		if entry.IsDirectory {
			dirs = append(dirs, entry.Path)
		}
		return nil
	})
	result := ScanResult{Entries: entries, Dirs: dirs}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return result, err
	}
	if err != nil {
		result.Bounded = errors.Is(err, workspace.ErrScanBudgetExceeded)
		return result, nil
	}
	return result, nil
}

func DiffCreated(previous, current map[string]Snapshot) []Event {
	events := make([]Event, 0)
	for path, snapshot := range current {
		if _, ok := previous[path]; ok {
			continue
		}
		events = append(events, Event{Kind: EventCreated, Path: path, IsDirectory: snapshot.IsDirectory})
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].Path == events[j].Path {
			return !events[i].IsDirectory && events[j].IsDirectory
		}
		return events[i].Path < events[j].Path
	})
	return events
}

func DiffChangedFiles(previous, current map[string]Snapshot) []Event {
	events := make([]Event, 0)
	for path, snapshot := range current {
		if snapshot.IsDirectory {
			continue
		}
		before, ok := previous[path]
		if !ok || before.IsDirectory {
			continue
		}
		if before.Size != snapshot.Size || !before.ModifiedAt.Equal(snapshot.ModifiedAt) {
			events = append(events, Event{Kind: EventChanged, Path: path})
		}
	}
	sort.Slice(events, func(i, j int) bool {
		return events[i].Path < events[j].Path
	})
	return events
}

func DiffDeleted(previous, current map[string]Snapshot) []Event {
	deletedPaths := make([]string, 0)
	for path := range previous {
		if _, ok := current[path]; ok {
			continue
		}
		deletedPaths = append(deletedPaths, path)
	}
	sort.Strings(deletedPaths)

	events := make([]Event, 0, len(deletedPaths))
	deletedDirs := make([]string, 0)
	for _, path := range deletedPaths {
		if hasDeletedAncestor(path, deletedDirs) {
			continue
		}
		snapshot := previous[path]
		events = append(events, Event{
			Kind:        EventDeleted,
			Path:        path,
			IsDirectory: snapshot.IsDirectory,
		})
		if snapshot.IsDirectory {
			deletedDirs = append(deletedDirs, filepath.Clean(path))
		}
	}
	return events
}

func deleteKnownPath(known map[string]Snapshot, path string) (Snapshot, bool) {
	previous, existed := known[path]
	delete(known, path)

	cleanPath := filepath.Clean(path)
	prefix := cleanPath + string(os.PathSeparator)
	for knownPath := range known {
		cleanKnownPath := filepath.Clean(knownPath)
		if strings.HasPrefix(cleanKnownPath, prefix) {
			delete(known, knownPath)
		}
	}
	return previous, existed
}

func hasDeletedAncestor(path string, deletedDirs []string) bool {
	cleanPath := filepath.Clean(path)
	for _, dir := range deletedDirs {
		if cleanPath == dir {
			return true
		}
		if strings.HasPrefix(cleanPath, dir+string(os.PathSeparator)) {
			return true
		}
	}
	return false
}

func limitEvents(events []Event, limit int) []Event {
	if limit <= 0 || len(events) <= limit {
		return events
	}
	return events[:limit]
}

func normalizeOptions(options Options) Options {
	if options.MaxEntries <= 0 {
		options.MaxEntries = 12000
	}
	if options.MaxEvents <= 0 {
		options.MaxEvents = 256
	}
	if options.FSNotifyDirLimit <= 0 {
		options.FSNotifyDirLimit = 3000
	}
	if options.InitialPollInterval <= 0 {
		options.InitialPollInterval = 900 * time.Millisecond
	}
	if options.MaxPollInterval <= 0 {
		options.MaxPollInterval = 5 * time.Second
	}
	if options.BoundedPollInterval <= 0 {
		options.BoundedPollInterval = 60 * time.Second
	}
	if len(options.SkipDirs) > 0 {
		skipDirs := make(map[string]struct{}, len(options.SkipDirs))
		for name := range options.SkipDirs {
			skipDirs[name] = struct{}{}
		}
		options.SkipDirs = skipDirs
	}
	return options
}
