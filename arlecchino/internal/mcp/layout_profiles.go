package mcp

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

type LayoutAction struct {
	Event   string `json:"event"`
	Payload any    `json:"payload,omitempty"`
}

type LayoutProfile struct {
	Name      string         `json:"name"`
	Version   int            `json:"version"`
	UpdatedAt string         `json:"updatedAt"`
	Actions   []LayoutAction `json:"actions"`
}

type LayoutSnapshot struct {
	ID        string         `json:"id"`
	Label     string         `json:"label"`
	Source    string         `json:"source"`
	Version   int            `json:"version"`
	CreatedAt string         `json:"createdAt"`
	Actions   []LayoutAction `json:"actions"`
}

type layoutRegistry struct {
	mu              sync.RWMutex
	version         int
	snapshotCounter int
	profiles        map[string]LayoutProfile
	snapshots       map[string]LayoutSnapshot
	snapshotOrder   []string
}

const (
	maxSnapshotsPerRegistry = 64
	maxActionsPerSnapshot   = 20
)

func newLayoutRegistry() *layoutRegistry {
	registry := &layoutRegistry{
		version:       0,
		profiles:      map[string]LayoutProfile{},
		snapshots:     map[string]LayoutSnapshot{},
		snapshotOrder: []string{},
	}

	for _, profile := range defaultLayoutProfiles() {
		registry.version++
		profile.Version = registry.version
		profile.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		registry.profiles[normalizeLayoutProfileName(profile.Name)] = profile
	}

	return registry
}

func (r *layoutRegistry) list() []LayoutProfile {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]LayoutProfile, 0, len(r.profiles))
	for _, profile := range r.profiles {
		items = append(items, profile)
	}

	return items
}

func (r *layoutRegistry) get(name string) (LayoutProfile, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	profile, ok := r.profiles[normalizeLayoutProfileName(name)]
	return profile, ok
}

func (r *layoutRegistry) upsert(name string, actions []LayoutAction) (LayoutProfile, error) {
	normalized := normalizeLayoutProfileName(name)
	if normalized == "" {
		return LayoutProfile{}, fmt.Errorf("layout profile name is empty")
	}
	if len(actions) == 0 {
		return LayoutProfile{}, fmt.Errorf("layout profile actions are empty")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.version++
	profile := LayoutProfile{
		Name:      normalized,
		Version:   r.version,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Actions:   append([]LayoutAction(nil), actions...),
	}
	r.profiles[normalized] = profile
	return profile, nil
}

func (r *layoutRegistry) listSnapshots(limit int) []LayoutSnapshot {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	if len(r.snapshotOrder) == 0 {
		return []LayoutSnapshot{}
	}

	result := make([]LayoutSnapshot, 0, limit)
	for i := len(r.snapshotOrder) - 1; i >= 0 && len(result) < limit; i-- {
		snapshotID := r.snapshotOrder[i]
		snapshot, ok := r.snapshots[snapshotID]
		if !ok {
			continue
		}
		result = append(result, snapshot)
	}

	return result
}

func (r *layoutRegistry) getSnapshot(snapshotID string) (LayoutSnapshot, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	snapshot, ok := r.snapshots[strings.TrimSpace(snapshotID)]
	return snapshot, ok
}

func (r *layoutRegistry) createSnapshot(label, source string, actions []LayoutAction) LayoutSnapshot {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshotActions := append([]LayoutAction(nil), actions...)
	if len(snapshotActions) > maxActionsPerSnapshot {
		snapshotActions = snapshotActions[:maxActionsPerSnapshot]
	}

	r.snapshotCounter++
	snapshot := LayoutSnapshot{
		ID:        fmt.Sprintf("ls-%d-%d", time.Now().UTC().UnixMilli(), r.snapshotCounter),
		Label:     strings.TrimSpace(label),
		Source:    strings.TrimSpace(source),
		Version:   r.version,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Actions:   snapshotActions,
	}

	r.snapshots[snapshot.ID] = snapshot
	r.snapshotOrder = append(r.snapshotOrder, snapshot.ID)

	if len(r.snapshotOrder) > maxSnapshotsPerRegistry {
		staleID := r.snapshotOrder[0]
		r.snapshotOrder = append([]string(nil), r.snapshotOrder[1:]...)
		delete(r.snapshots, staleID)
	}

	return snapshot
}

func normalizeLayoutProfileName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func defaultLayoutProfiles() []LayoutProfile {
	return []LayoutProfile{
		{
			Name: "terminal_focus",
			Actions: []LayoutAction{
				{Event: "ide:panel:open", Payload: "terminal"},
				{Event: "ide:tui:enter"},
				{Event: "ide:tui:assist:open"},
			},
		},
		{
			Name: "coding_focus",
			Actions: []LayoutAction{
				{Event: "ide:panel:open", Payload: "explorer"},
				{Event: "ide:panel:open", Payload: "terminal"},
				{Event: "ide:editor:split", Payload: "vertical"},
			},
		},
		{
			Name: "review_focus",
			Actions: []LayoutAction{
				{Event: "ide:panel:open", Payload: "git"},
				{Event: "ide:editor:split", Payload: "horizontal"},
				{Event: "ide:tui:assist:open"},
			},
		},
	}
}

func parseLayoutActions(raw any) ([]LayoutAction, error) {
	rawSlice, ok := raw.([]any)
	if !ok {
		if direct, ok := raw.([]map[string]any); ok {
			rawSlice = make([]any, 0, len(direct))
			for _, item := range direct {
				rawSlice = append(rawSlice, item)
			}
		} else {
			return nil, fmt.Errorf("actions must be array")
		}
	}

	actions := make([]LayoutAction, 0, len(rawSlice))
	for index, item := range rawSlice {
		actionMap, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("actions[%d] must be object", index)
		}

		eventNameValue, ok := actionMap["event"]
		if !ok {
			return nil, fmt.Errorf("actions[%d].event is required", index)
		}

		eventName, ok := eventNameValue.(string)
		if !ok {
			return nil, fmt.Errorf("actions[%d].event must be string", index)
		}

		actions = append(actions, LayoutAction{
			Event:   strings.TrimSpace(eventName),
			Payload: actionMap["payload"],
		})
	}

	if len(actions) == 0 {
		return nil, fmt.Errorf("actions are empty")
	}

	return actions, nil
}
