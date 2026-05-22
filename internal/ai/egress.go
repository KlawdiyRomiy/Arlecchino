package ai

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
	if limit <= 0 {
		limit = 50
	}
	records, err := l.readAllLocked()
	if err != nil {
		return nil, err
	}
	if len(records) > limit {
		records = records[len(records)-limit:]
	}
	return records, nil
}

func (l *EgressLedger) ListByRun(runID string, limit int) ([]AIEgressRecord, error) {
	if l == nil {
		return []AIEgressRecord{}, nil
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return []AIEgressRecord{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	records, err := l.readAllLocked()
	if err != nil {
		return nil, err
	}
	filtered := make([]AIEgressRecord, 0, len(records))
	for _, record := range records {
		if strings.TrimSpace(record.RunID) == runID {
			filtered = append(filtered, record)
		}
	}
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}
	return filtered, nil
}

func (l *EgressLedger) ListByRuns(runIDs []string, perRunLimit int) (map[string][]AIEgressRecord, error) {
	result := map[string][]AIEgressRecord{}
	if l == nil {
		return result, nil
	}
	wanted := map[string]struct{}{}
	for _, runID := range runIDs {
		runID = strings.TrimSpace(runID)
		if runID == "" {
			continue
		}
		wanted[runID] = struct{}{}
		result[runID] = []AIEgressRecord{}
	}
	if len(wanted) == 0 {
		return result, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	records, err := l.readAllLocked()
	if err != nil {
		return nil, err
	}
	for _, record := range records {
		runID := strings.TrimSpace(record.RunID)
		if _, ok := wanted[runID]; ok {
			result[runID] = append(result[runID], record)
		}
	}
	if perRunLimit > 0 {
		for runID, records := range result {
			if len(records) > perRunLimit {
				result[runID] = records[len(records)-perRunLimit:]
			}
		}
	}
	return result, nil
}

func (l *EgressLedger) FindByID(recordID string) (AIEgressRecord, bool, error) {
	if l == nil {
		return AIEgressRecord{}, false, nil
	}
	recordID = strings.TrimSpace(recordID)
	if recordID == "" {
		return AIEgressRecord{}, false, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	records, err := l.readAllLocked()
	if err != nil {
		return AIEgressRecord{}, false, err
	}
	for i := len(records) - 1; i >= 0; i-- {
		if records[i].ID == recordID {
			return records[i], true, nil
		}
	}
	return AIEgressRecord{}, false, nil
}

func (l *EgressLedger) readAllLocked() ([]AIEgressRecord, error) {
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIEgressRecord{}, nil
		}
		return nil, err
	}
	defer file.Close()
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
