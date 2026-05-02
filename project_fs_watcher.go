package main

import (
	"errors"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"time"
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

var errProjectWatchBudgetExceeded = errors.New("project watch scan budget exceeded")

func (a *App) startProjectFilesystemWatcher(projectPath string, generation uint64) {
	a.startProjectFilesystemWatcherForSession(a.activeProjectSession(), projectPath, generation)
}

func (a *App) startProjectFilesystemWatcherForSession(session *ProjectRuntimeSession, projectPath string, generation uint64) {
	if a == nil || session == nil || session.projectCtx == nil || strings.TrimSpace(projectPath) == "" {
		return
	}

	initialScan, err := scanProjectEntriesWithBudget(projectPath, projectWatchMaxEntries)
	if err != nil {
		a.logWarning("project fs watcher init failed: " + err.Error())
		return
	}
	knownEntries := initialScan.Entries

	ctx := session.projectCtx
	session.wg.Add(1)
	go func() {
		defer session.wg.Done()

		interval := projectWatchInitialInterval
		if initialScan.Bounded {
			interval = projectWatchMaxInterval
		}
		timer := time.NewTimer(interval)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}

			if session.projectGeneration.Load() != generation {
				return
			}

			currentScan, err := scanProjectEntriesWithBudget(projectPath, projectWatchMaxEntries)
			if err != nil {
				timer.Reset(projectWatchMaxInterval)
				continue
			}
			currentEntries := currentScan.Entries

			createdEntries := diffCreatedProjectEntries(knownEntries, currentEntries)
			changedFiles := diffChangedProjectFiles(knownEntries, currentEntries)
			knownEntries = currentEntries
			hadChanges := len(createdEntries) > 0 || len(changedFiles) > 0

			for _, entry := range limitProjectWatchCreatedEvents(createdEntries, projectWatchMaxEvents) {
				a.emitEvent("project:entry:created", projectEntryCreatedEvent{
					Path:        entry.Path,
					IsDirectory: entry.IsDirectory,
				})
			}

			for _, path := range limitProjectWatchChangedEvents(changedFiles, projectWatchMaxEvents) {
				a.emitEvent("file:changed", path)
			}

			switch {
			case currentScan.Bounded:
				interval = projectWatchMaxInterval
			case hadChanges:
				interval = projectWatchInitialInterval
			case interval < projectWatchMaxInterval:
				interval *= 2
				if interval > projectWatchMaxInterval {
					interval = projectWatchMaxInterval
				}
			}
			timer.Reset(interval)
		}
	}()
}

func scanProjectEntries(projectPath string) (map[string]projectEntrySnapshot, error) {
	result, err := scanProjectEntriesWithBudget(projectPath, projectWatchMaxEntries)
	return result.Entries, err
}

func scanProjectEntriesWithBudget(projectPath string, maxEntries int) (projectEntryScanResult, error) {
	entries := make(map[string]projectEntrySnapshot, 256)
	bounded := false

	err := filepath.WalkDir(projectPath, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if path == projectPath {
			return nil
		}

		if d.IsDir() && shouldSkipProjectWatchDir(d.Name()) {
			return filepath.SkipDir
		}

		info, err := d.Info()
		if err != nil {
			return nil
		}

		entries[path] = projectEntrySnapshot{
			IsDirectory: d.IsDir(),
			Size:        info.Size(),
			ModifiedAt:  info.ModTime(),
		}
		if maxEntries > 0 && len(entries) >= maxEntries {
			bounded = true
			return errProjectWatchBudgetExceeded
		}
		return nil
	})

	if err != nil && !errors.Is(err, errProjectWatchBudgetExceeded) {
		return projectEntryScanResult{}, err
	}

	return projectEntryScanResult{Entries: entries, Bounded: bounded}, nil
}

func shouldSkipProjectWatchDir(name string) bool {
	switch name {
	case ".arlecchino", ".cache", ".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "tmp", "vendor":
		return true
	default:
		return false
	}
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
	if len(current) == 0 {
		return nil
	}

	created := make([]projectEntryCreatedEvent, 0)
	for path, snapshot := range current {
		if _, exists := previous[path]; exists {
			continue
		}
		created = append(created, projectEntryCreatedEvent{
			Path:        path,
			IsDirectory: snapshot.IsDirectory,
		})
	}

	sort.Slice(created, func(i, j int) bool {
		if created[i].Path == created[j].Path {
			return !created[i].IsDirectory && created[j].IsDirectory
		}
		return created[i].Path < created[j].Path
	})

	return created
}

func diffChangedProjectFiles(previous, current map[string]projectEntrySnapshot) []string {
	if len(previous) == 0 || len(current) == 0 {
		return nil
	}

	changed := make([]string, 0)
	for path, snapshot := range current {
		if snapshot.IsDirectory {
			continue
		}

		previousSnapshot, exists := previous[path]
		if !exists || previousSnapshot.IsDirectory {
			continue
		}

		if previousSnapshot.Size == snapshot.Size && previousSnapshot.ModifiedAt.Equal(snapshot.ModifiedAt) {
			continue
		}

		changed = append(changed, path)
	}

	sort.Strings(changed)
	return changed
}
