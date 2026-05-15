package main

import (
	"context"
	"strings"
	"time"

	"arlecchino/internal/watcher"
)

type projectEntryCreatedEvent struct {
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
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
	projectWatchMaxEntries      = 12000
	projectWatchMaxEvents       = 256
)

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
		service := watcher.NewProjectWatcher(watcher.Options{
			MaxEntries:          projectWatchMaxEntries,
			MaxEvents:           projectWatchMaxEvents,
			InitialPollInterval: projectWatchInitialInterval,
			MaxPollInterval:     projectWatchMaxInterval,
		})
		err := service.Start(ctx, projectPath, func(events []watcher.Event) {
			if session.projectGeneration.Load() != generation {
				cancel()
				return
			}
			for _, event := range events {
				switch event.Kind {
				case watcher.EventCreated:
					a.emitEvent("project:entry:created", projectEntryCreatedEvent{
						Path:        event.Path,
						IsDirectory: event.IsDirectory,
					})
				case watcher.EventChanged:
					a.emitEvent("file:changed", event.Path)
				}
			}
		})
		if err != nil {
			a.logWarning("project fs watcher init failed: " + err.Error())
			return
		}
		<-ctx.Done()
	}()
}

func scanProjectEntries(projectPath string) (map[string]projectEntrySnapshot, error) {
	result, err := scanProjectEntriesWithBudget(projectPath, projectWatchMaxEntries)
	return result.Entries, err
}

func scanProjectEntriesWithBudget(projectPath string, maxEntries int) (projectEntryScanResult, error) {
	result, err := watcher.Scan(context.Background(), projectPath, maxEntries)
	if err != nil {
		return projectEntryScanResult{}, err
	}
	return projectEntryScanResult{Entries: toProjectEntrySnapshots(result.Entries), Bounded: result.Bounded}, nil
}

func shouldSkipProjectWatchDir(name string) bool {
	return name == ".arlecchino" ||
		name == ".cache" ||
		name == ".git" ||
		name == ".next" ||
		name == ".turbo" ||
		name == "build" ||
		name == "coverage" ||
		name == "dist" ||
		name == "node_modules" ||
		name == "tmp" ||
		name == "vendor"
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
