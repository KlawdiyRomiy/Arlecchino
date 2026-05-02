package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const defaultFlightRecorderMemoryLimit = 1000

type FlightRecord struct {
	ID            string         `json:"id"`
	Timestamp     string         `json:"timestamp"`
	Type          string         `json:"type"`
	Source        string         `json:"source"`
	Tool          string         `json:"tool,omitempty"`
	Risk          string         `json:"risk,omitempty"`
	Status        string         `json:"status,omitempty"`
	Error         string         `json:"error,omitempty"`
	DurationMs    int64          `json:"durationMs,omitempty"`
	CorrelationID string         `json:"correlationId,omitempty"`
	Args          map[string]any `json:"args,omitempty"`
}

type flightRecorder struct {
	mu       sync.RWMutex
	entries  []FlightRecord
	capacity int
	diskPath string
	counter  uint64
}

func newFlightRecorder(projectRoot, configuredPath string, capacity int) (*flightRecorder, error) {
	rootAbs, err := filepath.Abs(strings.TrimSpace(projectRoot))
	if err != nil {
		return nil, err
	}

	resolvedPath := strings.TrimSpace(configuredPath)
	if resolvedPath == "" {
		resolvedPath = filepath.Join(rootAbs, ".arlecchino", "agent-flight-recorder.log")
	}
	if !filepath.IsAbs(resolvedPath) {
		resolvedPath = filepath.Join(rootAbs, resolvedPath)
	}

	resolvedPathAbs, err := filepath.Abs(resolvedPath)
	if err != nil {
		return nil, err
	}
	if !isPathWithinRoot(rootAbs, resolvedPathAbs) {
		return nil, os.ErrPermission
	}

	if capacity <= 0 {
		capacity = defaultFlightRecorderMemoryLimit
	}
	if err := os.MkdirAll(filepath.Dir(resolvedPathAbs), 0o700); err != nil {
		return nil, err
	}

	return &flightRecorder{
		entries:  make([]FlightRecord, 0, capacity),
		capacity: capacity,
		diskPath: resolvedPathAbs,
	}, nil
}

func (r *flightRecorder) append(entry FlightRecord) FlightRecord {
	if r == nil {
		return entry
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.counter++
	if strings.TrimSpace(entry.ID) == "" {
		entry.ID = fmt.Sprintf("flight-%d-%d", time.Now().UTC().UnixNano(), r.counter)
	}
	if strings.TrimSpace(entry.Timestamp) == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}

	r.entries = append(r.entries, entry)
	if len(r.entries) > r.capacity {
		r.entries = append([]FlightRecord(nil), r.entries[len(r.entries)-r.capacity:]...)
	}
	r.writeToDisk(entry)
	return entry
}

func (r *flightRecorder) list(limit int) []FlightRecord {
	if r == nil {
		return []FlightRecord{}
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}
	if limit > len(r.entries) {
		limit = len(r.entries)
	}

	result := make([]FlightRecord, 0, limit)
	for i := len(r.entries) - 1; i >= 0 && len(result) < limit; i-- {
		result = append(result, r.entries[i])
	}
	return result
}

func (r *flightRecorder) diskFilePath() string {
	if r == nil {
		return ""
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.diskPath
}

func (r *flightRecorder) writeToDisk(entry FlightRecord) {
	if strings.TrimSpace(r.diskPath) == "" {
		return
	}

	line, err := json.Marshal(entry)
	if err != nil {
		return
	}

	file, err := os.OpenFile(r.diskPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()

	_, _ = file.Write(append(line, '\n'))
}
