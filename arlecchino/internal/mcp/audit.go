package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const defaultAuditMemoryLimit = 1000

type AuditEntry struct {
	Timestamp  string         `json:"timestamp"`
	Tool       string         `json:"tool"`
	Risk       string         `json:"risk"`
	Status     string         `json:"status"`
	Error      string         `json:"error,omitempty"`
	DurationMs int64          `json:"durationMs"`
	Mode       string         `json:"mode"`
	Args       map[string]any `json:"args,omitempty"`
}

type auditLogger struct {
	mu       sync.RWMutex
	entries  []AuditEntry
	capacity int
	diskPath string
}

func newAuditLogger(projectRoot, configuredPath string, capacity int) (*auditLogger, error) {
	rootAbs, err := filepath.Abs(strings.TrimSpace(projectRoot))
	if err != nil {
		return nil, err
	}

	resolvedPath := strings.TrimSpace(configuredPath)
	if resolvedPath == "" {
		resolvedPath = filepath.Join(rootAbs, ".arlecchino", "mcp-audit.log")
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
		capacity = defaultAuditMemoryLimit
	}

	if err := os.MkdirAll(filepath.Dir(resolvedPathAbs), 0o700); err != nil {
		return nil, err
	}

	return &auditLogger{
		entries:  make([]AuditEntry, 0, capacity),
		capacity: capacity,
		diskPath: resolvedPathAbs,
	}, nil
}

func (a *auditLogger) append(entry AuditEntry) {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.entries = append(a.entries, entry)
	if len(a.entries) > a.capacity {
		a.entries = append([]AuditEntry(nil), a.entries[len(a.entries)-a.capacity:]...)
	}

	a.writeToDisk(entry)
}

func (a *auditLogger) list(limit int) []AuditEntry {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	if len(a.entries) == 0 {
		return []AuditEntry{}
	}

	if limit > len(a.entries) {
		limit = len(a.entries)
	}

	result := make([]AuditEntry, 0, limit)
	for i := len(a.entries) - 1; i >= 0 && len(result) < limit; i-- {
		entry := a.entries[i]
		result = append(result, entry)
	}

	return result
}

func (a *auditLogger) diskFilePath() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.diskPath
}

func (a *auditLogger) writeToDisk(entry AuditEntry) {
	if strings.TrimSpace(a.diskPath) == "" {
		return
	}

	line, err := json.Marshal(entry)
	if err != nil {
		return
	}

	file, err := os.OpenFile(a.diskPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()

	_, _ = file.Write(append(line, '\n'))
}

func newAuditEntry(toolName, risk, status, mode string, args map[string]any, err error, startedAt time.Time) AuditEntry {
	entry := AuditEntry{
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Tool:       toolName,
		Risk:       risk,
		Status:     status,
		DurationMs: time.Since(startedAt).Milliseconds(),
		Mode:       mode,
		Args:       args,
	}

	if err != nil {
		entry.Error = err.Error()
	}

	return entry
}
