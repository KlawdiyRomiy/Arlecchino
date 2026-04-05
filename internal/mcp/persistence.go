package mcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	changeJournalStateFileName = "mcp-change-journal.json"
	layoutStateFileName        = "mcp-layout-state.json"
)

type changeJournalDiskRecord struct {
	Meta       Checkpoint `json:"meta"`
	BeforeData []byte     `json:"beforeData"`
}

type changeJournalDiskState struct {
	Counter uint64                             `json:"counter"`
	Order   []string                           `json:"order"`
	Records map[string]changeJournalDiskRecord `json:"records"`
}

type layoutRegistryDiskState struct {
	Version         int                       `json:"version"`
	SnapshotCounter int                       `json:"snapshotCounter"`
	Profiles        map[string]LayoutProfile  `json:"profiles"`
	Snapshots       map[string]LayoutSnapshot `json:"snapshots"`
	SnapshotOrder   []string                  `json:"snapshotOrder"`
}

func arlecchinoStateDir(projectRoot string) string {
	return filepath.Join(strings.TrimSpace(projectRoot), ".arlecchino")
}

func projectStateFilePath(projectRoot, fileName string) string {
	return filepath.Join(arlecchinoStateDir(projectRoot), fileName)
}

func ensureArlecchinoStateDir(projectRoot string) error {
	return os.MkdirAll(arlecchinoStateDir(projectRoot), 0o700)
}

func readJSONFile(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, target)
}

func writeJSONFile(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tempFile, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()

	cleanup := func() {
		_ = tempFile.Close()
		_ = os.Remove(tempPath)
	}

	if _, err := tempFile.Write(data); err != nil {
		cleanup()
		return err
	}
	if err := tempFile.Chmod(0o600); err != nil {
		cleanup()
		return err
	}
	if err := tempFile.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		cleanup()
		return err
	}

	return nil
}

func loadChangeJournal(projectRoot string, capacity int) (*changeJournal, error) {
	journal := newChangeJournal(capacity)
	statePath := projectStateFilePath(projectRoot, changeJournalStateFileName)

	var state changeJournalDiskState
	if err := readJSONFile(statePath, &state); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return journal, nil
		}
		return nil, err
	}

	if err := journal.applyDiskState(projectRoot, state); err != nil {
		return nil, err
	}

	return journal, nil
}

func (s *ToolService) persistJournal() error {
	if s == nil || s.journal == nil {
		return nil
	}
	return writeJSONFile(projectStateFilePath(s.projectRoot, changeJournalStateFileName), s.journal.diskState())
}

func (j *changeJournal) diskState() changeJournalDiskState {
	j.mu.RLock()
	defer j.mu.RUnlock()

	records := make(map[string]changeJournalDiskRecord, len(j.records))
	for id, record := range j.records {
		records[id] = changeJournalDiskRecord{
			Meta: Checkpoint{
				ID:        record.meta.ID,
				Path:      record.meta.Path,
				Label:     record.meta.Label,
				CreatedAt: record.meta.CreatedAt,
				Existed:   record.meta.Existed,
			},
			BeforeData: append([]byte(nil), record.beforeData...),
		}
	}

	return changeJournalDiskState{
		Counter: j.counter,
		Order:   append([]string(nil), j.order...),
		Records: records,
	}
}

func (j *changeJournal) applyDiskState(projectRoot string, state changeJournalDiskState) error {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.records = make(map[string]checkpointRecord, len(state.Records))
	j.order = make([]string, 0, min(len(state.Order), j.capacity))
	j.counter = state.Counter

	for _, id := range state.Order {
		diskRecord, ok := state.Records[id]
		if !ok {
			continue
		}
		if strings.TrimSpace(diskRecord.Meta.Path) == "" {
			continue
		}

		absPath, err := resolveProjectPath(projectRoot, diskRecord.Meta.Path)
		if err != nil {
			return fmt.Errorf("restore checkpoint %s: %w", id, err)
		}

		meta := diskRecord.Meta
		meta.ID = strings.TrimSpace(meta.ID)
		meta.Path = toRelativePath(projectRoot, absPath)
		if meta.ID == "" {
			continue
		}

		j.records[meta.ID] = checkpointRecord{
			meta:       meta,
			absPath:    absPath,
			beforeData: append([]byte(nil), diskRecord.BeforeData...),
		}
		j.order = append(j.order, meta.ID)
	}

	if len(j.order) > j.capacity {
		j.order = append([]string(nil), j.order[len(j.order)-j.capacity:]...)
		trimmed := make(map[string]checkpointRecord, len(j.order))
		for _, id := range j.order {
			trimmed[id] = j.records[id]
		}
		j.records = trimmed
	}

	if j.counter < uint64(len(j.order)) {
		j.counter = uint64(len(j.order))
	}

	return nil
}

func loadLayoutRegistry(projectRoot string) (*layoutRegistry, error) {
	registry := newLayoutRegistry()
	statePath := projectStateFilePath(projectRoot, layoutStateFileName)

	var state layoutRegistryDiskState
	if err := readJSONFile(statePath, &state); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return registry, nil
		}
		return nil, err
	}

	registry.applyDiskState(state)
	return registry, nil
}

func (s *ToolService) persistLayouts() error {
	if s == nil || s.layouts == nil {
		return nil
	}
	return writeJSONFile(projectStateFilePath(s.projectRoot, layoutStateFileName), s.layouts.diskState())
}

func (r *layoutRegistry) diskState() layoutRegistryDiskState {
	r.mu.RLock()
	defer r.mu.RUnlock()

	profiles := make(map[string]LayoutProfile, len(r.profiles))
	for key, profile := range r.profiles {
		profiles[key] = LayoutProfile{
			Name:      profile.Name,
			Version:   profile.Version,
			UpdatedAt: profile.UpdatedAt,
			Actions:   append([]LayoutAction(nil), profile.Actions...),
		}
	}

	snapshots := make(map[string]LayoutSnapshot, len(r.snapshots))
	for key, snapshot := range r.snapshots {
		snapshots[key] = LayoutSnapshot{
			ID:        snapshot.ID,
			Label:     snapshot.Label,
			Source:    snapshot.Source,
			Version:   snapshot.Version,
			CreatedAt: snapshot.CreatedAt,
			Actions:   append([]LayoutAction(nil), snapshot.Actions...),
		}
	}

	return layoutRegistryDiskState{
		Version:         r.version,
		SnapshotCounter: r.snapshotCounter,
		Profiles:        profiles,
		Snapshots:       snapshots,
		SnapshotOrder:   append([]string(nil), r.snapshotOrder...),
	}
}

func (r *layoutRegistry) applyDiskState(state layoutRegistryDiskState) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if state.Version > r.version {
		r.version = state.Version
	}
	if state.SnapshotCounter > r.snapshotCounter {
		r.snapshotCounter = state.SnapshotCounter
	}

	for key, profile := range state.Profiles {
		normalized := normalizeLayoutProfileName(profile.Name)
		if normalized == "" {
			normalized = normalizeLayoutProfileName(key)
		}
		if normalized == "" {
			continue
		}
		profile.Name = normalized
		profile.Actions = append([]LayoutAction(nil), profile.Actions...)
		r.profiles[normalized] = profile
	}

	r.snapshots = make(map[string]LayoutSnapshot, len(state.Snapshots))
	r.snapshotOrder = make([]string, 0, min(len(state.SnapshotOrder), maxSnapshotsPerRegistry))
	for _, snapshotID := range state.SnapshotOrder {
		snapshot, ok := state.Snapshots[snapshotID]
		if !ok {
			continue
		}
		snapshot.ID = strings.TrimSpace(snapshot.ID)
		if snapshot.ID == "" {
			continue
		}
		snapshot.Actions = append([]LayoutAction(nil), snapshot.Actions...)
		r.snapshots[snapshot.ID] = snapshot
		r.snapshotOrder = append(r.snapshotOrder, snapshot.ID)
	}

	if len(r.snapshotOrder) > maxSnapshotsPerRegistry {
		r.snapshotOrder = append([]string(nil), r.snapshotOrder[len(r.snapshotOrder)-maxSnapshotsPerRegistry:]...)
		trimmed := make(map[string]LayoutSnapshot, len(r.snapshotOrder))
		for _, snapshotID := range r.snapshotOrder {
			trimmed[snapshotID] = r.snapshots[snapshotID]
		}
		r.snapshots = trimmed
	}

	if r.snapshotCounter < len(r.snapshotOrder) {
		r.snapshotCounter = len(r.snapshotOrder)
	}
}
