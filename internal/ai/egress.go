package ai

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const egressFileName = "egress.jsonl"

type EgressLedger struct {
	mu   sync.Mutex
	path string
}

func openEgressLedger(projectRoot string) (*EgressLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &EgressLedger{path: filepath.Join(dir, egressFileName)}, nil
}

func (l *EgressLedger) Append(record AIEgressRecord) (AIEgressRecord, error) {
	if l == nil {
		return record, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if record.ID == "" {
		record.ID = "eg-" + record.RequestID
	}
	if record.CreatedAt == "" {
		record.CreatedAt = utcNow()
	}
	data, err := json.Marshal(record)
	if err != nil {
		return record, err
	}
	file, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return record, err
	}
	defer file.Close()
	if _, err := file.Write(append(data, '\n')); err != nil {
		return record, err
	}
	return record, nil
}

func (l *EgressLedger) List(limit int) ([]AIEgressRecord, error) {
	if l == nil {
		return []AIEgressRecord{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIEgressRecord{}, nil
		}
		return nil, err
	}
	defer file.Close()
	if limit <= 0 {
		limit = 50
	}
	records := []AIEgressRecord{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		var record AIEgressRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err == nil {
			records = append(records, record)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(records) > limit {
		records = records[len(records)-limit:]
	}
	return records, nil
}

func (l *EgressLedger) Clear() error {
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
