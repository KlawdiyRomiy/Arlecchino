package main

import (
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

func (a *App) startProjectFilesystemWatcher(projectPath string, generation uint64) {
	if a == nil || a.projectCtx == nil || strings.TrimSpace(projectPath) == "" {
		return
	}

	knownEntries, err := scanProjectEntries(projectPath)
	if err != nil {
		a.logWarning("project fs watcher init failed: " + err.Error())
		return
	}

	ctx := a.projectCtx
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()

		ticker := time.NewTicker(700 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}

			if a.projectGeneration.Load() != generation {
				return
			}

			currentEntries, err := scanProjectEntries(projectPath)
			if err != nil {
				continue
			}

			createdEntries := diffCreatedProjectEntries(knownEntries, currentEntries)
			changedFiles := diffChangedProjectFiles(knownEntries, currentEntries)
			knownEntries = currentEntries

			for _, entry := range createdEntries {
				a.emitEvent("project:entry:created", projectEntryCreatedEvent{
					Path:        entry.Path,
					IsDirectory: entry.IsDirectory,
				})
			}

			for _, path := range changedFiles {
				a.emitEvent("file:changed", path)
			}
		}
	}()
}

func scanProjectEntries(projectPath string) (map[string]projectEntrySnapshot, error) {
	entries := make(map[string]projectEntrySnapshot, 256)

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
		return nil
	})

	if err != nil {
		return nil, err
	}

	return entries, nil
}

func shouldSkipProjectWatchDir(name string) bool {
	switch name {
	case ".git", "node_modules", "vendor", ".arlecchino":
		return true
	default:
		return false
	}
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
