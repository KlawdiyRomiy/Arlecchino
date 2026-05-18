package ai

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/google/uuid"
)

const runTimelineFileName = "run_timeline.jsonl"

type RunTimelineLedger struct {
	mu   sync.Mutex
	path string
}

func openRunTimelineLedger(projectRoot string) (*RunTimelineLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &RunTimelineLedger{path: filepath.Join(dir, runTimelineFileName)}, nil
}

func (l *RunTimelineLedger) Append(event AIRunTimelineEvent) (AIRunTimelineEvent, error) {
	if l == nil {
		return event, nil
	}
	if strings.TrimSpace(event.ID) == "" {
		event.ID = "run-event-" + uuid.NewString()
	}
	if strings.TrimSpace(event.CreatedAt) == "" {
		event.CreatedAt = utcNow()
	}
	event.Summary = sanitizedDisplayText(event.Summary)
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(l.path), 0o700); err != nil {
		return event, err
	}
	file, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return event, err
	}
	defer file.Close()
	if err := json.NewEncoder(file).Encode(event); err != nil {
		return event, err
	}
	return event, nil
}

func (l *RunTimelineLedger) ListByRun(runID string, limit int) ([]AIRunTimelineEvent, error) {
	if l == nil || strings.TrimSpace(runID) == "" {
		return []AIRunTimelineEvent{}, nil
	}
	events, err := l.List(0)
	if err != nil {
		return nil, err
	}
	filtered := make([]AIRunTimelineEvent, 0, len(events))
	for _, event := range events {
		if event.RunID == runID {
			filtered = append(filtered, event)
		}
	}
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}
	return filtered, nil
}

func (l *RunTimelineLedger) List(limit int) ([]AIRunTimelineEvent, error) {
	if l == nil {
		return []AIRunTimelineEvent{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIRunTimelineEvent{}, nil
		}
		return nil, err
	}
	defer file.Close()
	events := []AIRunTimelineEvent{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 4*1024*1024)
	for scanner.Scan() {
		var event AIRunTimelineEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err == nil && event.ID != "" {
			events = append(events, event)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if limit > 0 && len(events) > limit {
		events = events[len(events)-limit:]
	}
	return events, nil
}

func (l *RunTimelineLedger) Clear() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.Remove(l.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *Service) recordRunTimeline(project *ProjectSession, event AIRunTimelineEvent) {
	if s == nil || project == nil || project.RunTimeline == nil {
		return
	}
	if strings.TrimSpace(event.ProjectSessionID) == "" {
		event.ProjectSessionID = project.ID
	}
	if strings.TrimSpace(event.CreatedAt) == "" {
		event.CreatedAt = utcNow()
	}
	stored, err := project.RunTimeline.Append(event)
	if err != nil {
		return
	}
	s.emitEvent("ai:run:timeline-event", stored)
}
