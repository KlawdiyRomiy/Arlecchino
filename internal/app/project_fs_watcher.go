package app

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/watcher"
)

type projectEntryCreatedEvent struct {
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
}

type projectEntriesChangedEvent struct {
	Created []projectEntryCreatedEvent `json:"created,omitempty"`
	Changed []string                   `json:"changed,omitempty"`
	Deleted []projectEntryDeletedEvent `json:"deleted,omitempty"`
}

type projectEntrySnapshot struct {
	IsDirectory bool
	Size        int64
	ModifiedAt  time.Time
}

type projectEntryScanResult struct {
	Entries map[string]projectEntrySnapshot
	Bounded bool
}

const (
	projectWatchInitialInterval = 900 * time.Millisecond
	projectWatchMaxInterval     = 5 * time.Second
	projectWatchBoundedInterval = 60 * time.Second
	projectWatchMaxEntries      = 12000
	projectWatchMaxEvents       = 256
	projectWatchEventWindow     = 50 * time.Millisecond
)

var projectWatchSkippedDirs = map[string]struct{}{
	".arlecchino":  {},
	".cache":       {},
	".git":         {},
	".next":        {},
	".turbo":       {},
	"build":        {},
	"coverage":     {},
	"dist":         {},
	"node_modules": {},
	"tmp":          {},
	"vendor":       {},
}

func (a *App) startProjectFilesystemWatcher(projectPath string, generation uint64) {
	a.startProjectFilesystemWatcherForSession(a.activeProjectSession(), projectPath, generation)
}

func (a *App) startProjectFilesystemWatcherForSession(session *ProjectRuntimeSession, projectPath string, generation uint64) {
	if a == nil || session == nil || session.projectCtx == nil || strings.TrimSpace(projectPath) == "" {
		return
	}

	session.wg.Add(1)
	go func() {
		defer session.wg.Done()
		ctx, cancel := context.WithCancel(session.projectCtx)
		defer cancel()
		coalescer := newProjectWatcherEventCoalescer(projectWatchEventWindow, func(events []watcher.Event) {
			a.emitProjectWatcherEvents(session, generation, events)
		})
		defer coalescer.Close()
		service := watcher.NewProjectWatcher(watcher.Options{
			MaxEntries:          projectWatchMaxEntries,
			MaxEvents:           projectWatchMaxEvents,
			InitialPollInterval: projectWatchInitialInterval,
			MaxPollInterval:     projectWatchMaxInterval,
			BoundedPollInterval: projectWatchBoundedInterval,
			SkipDirs:            projectWatchSkipDirs(),
		})
		err := service.Start(ctx, projectPath, func(events []watcher.Event) {
			if !projectWatcherSessionActive(session, generation) {
				cancel()
				return
			}
			coalescer.Add(events)
		})
		if err != nil {
			a.logWarning("project fs watcher init failed: " + err.Error())
			return
		}
		<-ctx.Done()
	}()
}

func projectWatcherSessionActive(session *ProjectRuntimeSession, generation uint64) bool {
	return session != nil &&
		session.projectCtx != nil &&
		session.projectCtx.Err() == nil &&
		session.projectGeneration.Load() == generation
}

func (a *App) emitProjectWatcherEvents(session *ProjectRuntimeSession, generation uint64, events []watcher.Event) {
	if !projectWatcherSessionActive(session, generation) {
		return
	}

	payload := projectEntriesChangedPayload(events)
	if len(payload.Created) == 0 && len(payload.Changed) == 0 && len(payload.Deleted) == 0 {
		return
	}
	for _, entry := range payload.Deleted {
		a.pruneProjectWatcherDiagnostics(session, entry.Path)
	}
	if !projectWatcherSessionActive(session, generation) {
		return
	}
	a.emitEvent("project:entries:changed", payload)
}

func projectEntriesChangedPayload(events []watcher.Event) projectEntriesChangedEvent {
	payload := projectEntriesChangedEvent{
		Created: make([]projectEntryCreatedEvent, 0),
		Changed: make([]string, 0),
		Deleted: make([]projectEntryDeletedEvent, 0),
	}
	for _, event := range events {
		switch event.Kind {
		case watcher.EventCreated:
			payload.Created = append(payload.Created, projectEntryCreatedEvent{
				Path:        event.Path,
				IsDirectory: event.IsDirectory,
			})
		case watcher.EventChanged:
			payload.Changed = append(payload.Changed, event.Path)
		case watcher.EventDeleted:
			payload.Deleted = append(payload.Deleted, projectEntryDeletedEvent{
				Path:        event.Path,
				IsDirectory: event.IsDirectory,
			})
		}
	}
	sort.Slice(payload.Created, func(i, j int) bool {
		return payload.Created[i].Path < payload.Created[j].Path
	})
	sort.Strings(payload.Changed)
	sort.Slice(payload.Deleted, func(i, j int) bool {
		return payload.Deleted[i].Path < payload.Deleted[j].Path
	})
	return payload
}

type projectWatcherEventCoalescer struct {
	mu       sync.Mutex
	window   time.Duration
	pending  map[string]watcher.Event
	timer    *time.Timer
	closed   bool
	flushWG  sync.WaitGroup
	emitFunc func([]watcher.Event)
}

func newProjectWatcherEventCoalescer(window time.Duration, emit func([]watcher.Event)) *projectWatcherEventCoalescer {
	if window <= 0 {
		window = projectWatchEventWindow
	}
	return &projectWatcherEventCoalescer{
		window:   window,
		pending:  make(map[string]watcher.Event),
		emitFunc: emit,
	}
}

func (c *projectWatcherEventCoalescer) Add(events []watcher.Event) {
	if c == nil || len(events) == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	for _, event := range events {
		if strings.TrimSpace(event.Path) == "" {
			continue
		}
		if previous, ok := c.pending[event.Path]; ok {
			if merged, keep := mergeProjectWatcherEvent(previous, event); keep {
				c.pending[event.Path] = merged
			} else {
				delete(c.pending, event.Path)
			}
			continue
		}
		c.pending[event.Path] = event
	}
	if len(c.pending) == 0 || c.timer != nil {
		return
	}
	c.flushWG.Add(1)
	c.timer = time.AfterFunc(c.window, func() {
		defer c.flushWG.Done()
		c.flush()
	})
}

func (c *projectWatcherEventCoalescer) Close() {
	if c == nil {
		return
	}
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.pending = nil
	timer := c.timer
	c.timer = nil
	stopped := timer != nil && timer.Stop()
	c.mu.Unlock()
	if stopped {
		c.flushWG.Done()
	}
	c.flushWG.Wait()
}

func (c *projectWatcherEventCoalescer) flush() {
	c.mu.Lock()
	if c.closed || len(c.pending) == 0 {
		c.timer = nil
		c.mu.Unlock()
		return
	}
	events := make([]watcher.Event, 0, len(c.pending))
	for _, event := range c.pending {
		events = append(events, event)
	}
	c.pending = make(map[string]watcher.Event)
	c.timer = nil
	emit := c.emitFunc
	c.mu.Unlock()

	if emit != nil {
		emit(events)
	}
}

func mergeProjectWatcherEvent(previous watcher.Event, next watcher.Event) (watcher.Event, bool) {
	switch previous.Kind {
	case watcher.EventCreated:
		switch next.Kind {
		case watcher.EventChanged:
			return previous, true
		case watcher.EventDeleted:
			return watcher.Event{}, false
		}
	case watcher.EventChanged:
		if next.Kind == watcher.EventDeleted {
			return next, true
		}
	case watcher.EventDeleted:
		switch next.Kind {
		case watcher.EventCreated:
			if next.IsDirectory {
				return next, true
			}
			return watcher.Event{Kind: watcher.EventChanged, Path: next.Path}, true
		case watcher.EventChanged:
			return next, true
		}
	}
	return next, true
}

func (a *App) handleProjectWatcherEvent(session *ProjectRuntimeSession, event watcher.Event) {
	switch event.Kind {
	case watcher.EventCreated:
		a.emitEvent("project:entry:created", projectEntryCreatedEvent{
			Path:        event.Path,
			IsDirectory: event.IsDirectory,
		})
	case watcher.EventChanged:
		a.emitEvent("file:changed", event.Path)
	case watcher.EventDeleted:
		a.pruneProjectWatcherDiagnostics(session, event.Path)
		a.emitEvent("project:entry:deleted", projectEntryDeletedEvent{
			Path:        event.Path,
			IsDirectory: event.IsDirectory,
		})
	}
}

func (a *App) pruneProjectWatcherDiagnostics(session *ProjectRuntimeSession, path string) {
	if session != nil && session.lspManager != nil {
		session.lspManager.PruneDiagnosticsForPath(path)
		return
	}
	a.pruneLSPDiagnosticsForProjectEntry(path)
}

func scanProjectEntries(projectPath string) (map[string]projectEntrySnapshot, error) {
	result, err := scanProjectEntriesWithBudget(projectPath, projectWatchMaxEntries)
	return result.Entries, err
}

func scanProjectEntriesWithBudget(projectPath string, maxEntries int) (projectEntryScanResult, error) {
	result, err := watcher.ScanWithSkipDirs(context.Background(), projectPath, maxEntries, projectWatchSkipDirs())
	if err != nil {
		return projectEntryScanResult{}, err
	}
	return projectEntryScanResult{Entries: toProjectEntrySnapshots(result.Entries), Bounded: result.Bounded}, nil
}

func projectWatchSkipDirs() map[string]struct{} {
	skipDirs := make(map[string]struct{}, len(projectWatchSkippedDirs))
	for name := range projectWatchSkippedDirs {
		skipDirs[name] = struct{}{}
	}
	return skipDirs
}

func shouldSkipProjectWatchDir(name string) bool {
	_, ok := projectWatchSkippedDirs[name]
	return ok
}

func limitProjectWatchCreatedEvents(events []projectEntryCreatedEvent, limit int) []projectEntryCreatedEvent {
	if limit <= 0 || len(events) <= limit {
		return events
	}
	return events[:limit]
}

func limitProjectWatchChangedEvents(events []string, limit int) []string {
	if limit <= 0 || len(events) <= limit {
		return events
	}
	return events[:limit]
}

func diffCreatedProjectEntries(previous, current map[string]projectEntrySnapshot) []projectEntryCreatedEvent {
	events := watcher.DiffCreated(toWatcherSnapshots(previous), toWatcherSnapshots(current))
	created := make([]projectEntryCreatedEvent, 0, len(events))
	for _, event := range events {
		created = append(created, projectEntryCreatedEvent{
			Path:        event.Path,
			IsDirectory: event.IsDirectory,
		})
	}
	return created
}

func diffChangedProjectFiles(previous, current map[string]projectEntrySnapshot) []string {
	events := watcher.DiffChangedFiles(toWatcherSnapshots(previous), toWatcherSnapshots(current))
	changed := make([]string, 0, len(events))
	for _, event := range events {
		changed = append(changed, event.Path)
	}
	return changed
}

func toWatcherSnapshots(entries map[string]projectEntrySnapshot) map[string]watcher.Snapshot {
	result := make(map[string]watcher.Snapshot, len(entries))
	for path, snapshot := range entries {
		result[path] = watcher.Snapshot{
			IsDirectory: snapshot.IsDirectory,
			Size:        snapshot.Size,
			ModifiedAt:  snapshot.ModifiedAt,
		}
	}
	return result
}

func toProjectEntrySnapshots(entries map[string]watcher.Snapshot) map[string]projectEntrySnapshot {
	result := make(map[string]projectEntrySnapshot, len(entries))
	for path, snapshot := range entries {
		result[path] = projectEntrySnapshot{
			IsDirectory: snapshot.IsDirectory,
			Size:        snapshot.Size,
			ModifiedAt:  snapshot.ModifiedAt,
		}
	}
	return result
}
