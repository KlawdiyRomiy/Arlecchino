package ai

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const toolApprovalGrantsFileName = "tool_approval_grants.jsonl"

type ToolApprovalGrantLedger struct {
	mu   sync.Mutex
	path string
}

func openToolApprovalGrantLedger(projectRoot string) (*ToolApprovalGrantLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &ToolApprovalGrantLedger{path: filepath.Join(dir, toolApprovalGrantsFileName)}, nil
}

func (l *ToolApprovalGrantLedger) Upsert(grant AIToolApprovalGrant) error {
	if l == nil || strings.TrimSpace(grant.ID) == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	grants, err := l.readAllLocked()
	if err != nil {
		return err
	}
	replaced := false
	for i := range grants {
		if grants[i].ID == grant.ID {
			grants[i] = grant
			replaced = true
			break
		}
	}
	if !replaced {
		grants = append(grants, grant)
	}
	return l.writeAllLocked(filterActiveToolApprovalGrants(grants))
}

func (l *ToolApprovalGrantLedger) Delete(id string) error {
	if l == nil || strings.TrimSpace(id) == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	grants, err := l.readAllLocked()
	if err != nil {
		return err
	}
	next := grants[:0]
	for _, grant := range grants {
		if grant.ID == id {
			continue
		}
		next = append(next, grant)
	}
	return l.writeAllLocked(next)
}

func (l *ToolApprovalGrantLedger) ListActive() ([]AIToolApprovalGrant, error) {
	if l == nil {
		return []AIToolApprovalGrant{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	grants, err := l.readAllLocked()
	if err != nil {
		return nil, err
	}
	active := filterActiveToolApprovalGrants(grants)
	if len(active) != len(grants) {
		_ = l.writeAllLocked(active)
	}
	return active, nil
}

func (l *ToolApprovalGrantLedger) Clear() error {
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

func (l *ToolApprovalGrantLedger) readAllLocked() ([]AIToolApprovalGrant, error) {
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIToolApprovalGrant{}, nil
		}
		return nil, err
	}
	defer file.Close()
	grants := []AIToolApprovalGrant{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		var grant AIToolApprovalGrant
		if err := json.Unmarshal(scanner.Bytes(), &grant); err == nil && grant.ID != "" {
			grants = append(grants, grant)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return grants, nil
}

func (l *ToolApprovalGrantLedger) writeAllLocked(grants []AIToolApprovalGrant) error {
	dir := filepath.Dir(l.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".tool_approval_grants-*.tmp")
	if err != nil {
		return err
	}
	tempPath := file.Name()
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Remove(tempPath)
		}
	}()
	encoder := json.NewEncoder(file)
	for _, grant := range grants {
		if strings.TrimSpace(grant.ID) == "" {
			continue
		}
		if err := encoder.Encode(grant); err != nil {
			_ = file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, l.path); err != nil {
		return err
	}
	removeTemp = false
	return nil
}

func filterActiveToolApprovalGrants(grants []AIToolApprovalGrant) []AIToolApprovalGrant {
	now := time.Now().UTC()
	active := make([]AIToolApprovalGrant, 0, len(grants))
	for _, grant := range grants {
		if strings.TrimSpace(grant.ID) == "" || strings.TrimSpace(grant.UsedAt) != "" {
			continue
		}
		expiresAt, err := time.Parse(time.RFC3339, grant.ExpiresAt)
		if err != nil || !expiresAt.After(now) {
			continue
		}
		active = append(active, grant)
	}
	return active
}
