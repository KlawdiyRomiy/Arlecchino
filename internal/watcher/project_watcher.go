package watcher

import (
	"context"
	"errors"
	"os"
	"os/exec"
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

	initial, err := Scan(ctx, root, w.options.MaxEntries)
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
			events := w.eventsFromFSNotify(event, known, addWatch)
			if len(events) > 0 {
				emit(limitEvents(events, w.options.MaxEvents))
			}
		}
	}
}

func (w *ProjectWatcher) eventsFromFSNotify(event fsnotify.Event, known map[string]Snapshot, addWatch func(string)) []Event {
	info, statErr := os.Stat(event.Name)
	if statErr != nil {
		delete(known, event.Name)
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

func (w *ProjectWatcher) runPolling(ctx context.Context, root string, initial ScanResult, emit func([]Event)) {
	known := initial.Entries
	interval := w.options.InitialPollInterval
	if initial.Bounded {
		interval = w.options.MaxPollInterval
	}
	timer := time.NewTimer(interval)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		current, err := Scan(ctx, root, w.options.MaxEntries)
		if err != nil {
			timer.Reset(w.options.MaxPollInterval)
			continue
		}
		created := DiffCreated(known, current.Entries)
		changed := DiffChangedFiles(known, current.Entries)
		known = current.Entries
		events := append(created, changed...)
		if len(events) > 0 {
			emit(limitEvents(events, w.options.MaxEvents))
			interval = w.options.InitialPollInterval
		} else if current.Bounded {
			interval = w.options.MaxPollInterval
		} else if interval < w.options.MaxPollInterval {
			interval *= 2
			if interval > w.options.MaxPollInterval {
				interval = w.options.MaxPollInterval
			}
		}
		timer.Reset(interval)
	}
}

func Scan(ctx context.Context, root string, maxEntries int) (ScanResult, error) {
	scanner, err := workspace.NewScanner(root, workspace.ScannerOptions{
		MaxEntries:   maxEntries,
		IncludeDirs:  true,
		UseGitIgnore: true,
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
	return options
}
