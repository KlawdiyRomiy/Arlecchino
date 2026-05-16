package ai

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const toolAuditFileName = "tool_audit.jsonl"

type ToolAuditLedger struct {
	mu   sync.Mutex
	path string
}

func openToolAuditLedger(projectRoot string) (*ToolAuditLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &ToolAuditLedger{path: filepath.Join(dir, toolAuditFileName)}, nil
}

func (l *ToolAuditLedger) Append(record AIToolAuditRecord) (AIToolAuditRecord, error) {
	if l == nil {
		return record, nil
	}
	if strings.TrimSpace(record.ID) == "" {
		record.ID = "tool-audit-" + shortHash(record.ToolID+":"+record.CreatedAt+":"+record.CommandPreview)
	}
	if record.CreatedAt == "" {
		record.CreatedAt = utcNow()
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(l.path), 0o700); err != nil {
		return record, err
	}
	file, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return record, err
	}
	defer file.Close()
	if err := json.NewEncoder(file).Encode(record); err != nil {
		return record, err
	}
	return record, nil
}

func (l *ToolAuditLedger) List(limit int) ([]AIToolAuditRecord, error) {
	if l == nil {
		return []AIToolAuditRecord{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIToolAuditRecord{}, nil
		}
		return nil, err
	}
	defer file.Close()
	records := []AIToolAuditRecord{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 4*1024*1024)
	for scanner.Scan() {
		var record AIToolAuditRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err == nil && record.ID != "" {
			records = append(records, record)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}
	if limit > 0 && len(records) > limit {
		records = records[:limit]
	}
	return records, nil
}

func (l *ToolAuditLedger) Clear() error {
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
