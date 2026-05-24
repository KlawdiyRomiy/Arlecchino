package ai

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const pendingApprovalsFileName = "pending_approvals.jsonl"

type PendingApprovalLedger struct {
	mu   sync.Mutex
	path string
}

func openPendingApprovalLedger(projectRoot string) (*PendingApprovalLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &PendingApprovalLedger{path: filepath.Join(dir, pendingApprovalsFileName)}, nil
}

func (l *PendingApprovalLedger) Upsert(approval AIPendingApproval) error {
	if l == nil || strings.TrimSpace(approval.ID) == "" || strings.TrimSpace(approval.RunID) == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	approvals, err := l.readAllLocked()
	if err != nil {
		return err
	}
	replaced := false
	for i := range approvals {
		if approvals[i].ID == approval.ID {
			approvals[i] = normalizePendingApproval(approval)
			replaced = true
			break
		}
	}
	if !replaced {
		approvals = append(approvals, normalizePendingApproval(approval))
	}
	sortPendingApprovalsNewestFirst(approvals)
	return l.writeAllLocked(approvals)
}

func (l *PendingApprovalLedger) Resolve(runID string, toolID string, arguments map[string]string, status string) error {
	if l == nil {
		return nil
	}
	runID = strings.TrimSpace(runID)
	toolID = strings.TrimSpace(toolID)
	status = firstNonEmpty(strings.TrimSpace(status), "resolved")
	l.mu.Lock()
	defer l.mu.Unlock()
	approvals, err := l.readAllLocked()
	if err != nil {
		return err
	}
	key := pendingApprovalKey(runID, toolID, arguments)
	changed := false
	now := utcNow()
	for i := range approvals {
		if pendingApprovalKey(approvals[i].RunID, approvals[i].ToolID, approvals[i].Arguments) != key {
			continue
		}
		if !pendingApprovalStatusOpen(approvals[i].Status) {
			continue
		}
		approvals[i].Status = status
		approvals[i].UpdatedAt = now
		changed = true
	}
	if !changed {
		return nil
	}
	sortPendingApprovalsNewestFirst(approvals)
	return l.writeAllLocked(approvals)
}

func (l *PendingApprovalLedger) DeleteRuns(runIDs []string) error {
	if l == nil || len(runIDs) == 0 {
		return nil
	}
	runSet := map[string]struct{}{}
	for _, runID := range runIDs {
		if runID = strings.TrimSpace(runID); runID != "" {
			runSet[runID] = struct{}{}
		}
	}
	if len(runSet) == 0 {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	approvals, err := l.readAllLocked()
	if err != nil {
		return err
	}
	next := approvals[:0]
	for _, approval := range approvals {
		if _, remove := runSet[approval.RunID]; remove {
			continue
		}
		next = append(next, approval)
	}
	return l.writeOrRemoveLocked(next)
}

func (l *PendingApprovalLedger) DeleteSession(sessionID string) error {
	if l == nil {
		return nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	l.mu.Lock()
	defer l.mu.Unlock()
	approvals, err := l.readAllLocked()
	if err != nil {
		return err
	}
	next := approvals[:0]
	for _, approval := range approvals {
		if normalizeChatSessionID(approval.SessionID) == sessionID {
			continue
		}
		next = append(next, approval)
	}
	return l.writeOrRemoveLocked(next)
}

func (l *PendingApprovalLedger) ListPending(limit int) ([]AIPendingApproval, error) {
	if l == nil {
		return []AIPendingApproval{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	approvals, err := l.readAllLocked()
	if err != nil {
		return nil, err
	}
	pending := make([]AIPendingApproval, 0, limit)
	for _, approval := range approvals {
		approval = normalizePendingApproval(approval)
		if !pendingApprovalStatusOpen(approval.Status) {
			continue
		}
		pending = append(pending, approval)
		if len(pending) >= limit {
			break
		}
	}
	return pending, nil
}

func (l *PendingApprovalLedger) HasRecords() (bool, error) {
	if l == nil {
		return false, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	approvals, err := l.readAllLocked()
	if err != nil {
		return false, err
	}
	return len(approvals) > 0, nil
}

func (l *PendingApprovalLedger) Clear() error {
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

func (l *PendingApprovalLedger) readAllLocked() ([]AIPendingApproval, error) {
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIPendingApproval{}, nil
		}
		return nil, err
	}
	defer file.Close()
	approvals := []AIPendingApproval{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 4*1024*1024)
	for scanner.Scan() {
		var approval AIPendingApproval
		if err := json.Unmarshal(scanner.Bytes(), &approval); err == nil && approval.ID != "" {
			approvals = append(approvals, normalizePendingApproval(approval))
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	sortPendingApprovalsNewestFirst(approvals)
	return approvals, nil
}

func (l *PendingApprovalLedger) writeOrRemoveLocked(approvals []AIPendingApproval) error {
	if len(approvals) == 0 {
		if err := os.Remove(l.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return l.writeAllLocked(approvals)
}

func (l *PendingApprovalLedger) writeAllLocked(approvals []AIPendingApproval) error {
	dir := filepath.Dir(l.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".pending_approvals-*.tmp")
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
	for _, approval := range approvals {
		if strings.TrimSpace(approval.ID) == "" {
			continue
		}
		if err := encoder.Encode(normalizePendingApproval(approval)); err != nil {
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

func normalizePendingApproval(approval AIPendingApproval) AIPendingApproval {
	approval.SessionID = normalizeChatSessionID(approval.SessionID)
	approval.Status = firstNonEmpty(strings.TrimSpace(approval.Status), "approval_required")
	approval.CreatedAt = firstNonEmpty(approval.CreatedAt, utcNow())
	approval.UpdatedAt = firstNonEmpty(approval.UpdatedAt, approval.CreatedAt)
	return approval
}

func pendingApprovalStatusOpen(status string) bool {
	switch strings.TrimSpace(status) {
	case "approval_required", "proposed":
		return true
	default:
		return false
	}
}

func sortPendingApprovalsNewestFirst(approvals []AIPendingApproval) {
	sort.SliceStable(approvals, func(i, j int) bool {
		left := firstNonEmpty(approvals[i].UpdatedAt, approvals[i].CreatedAt)
		right := firstNonEmpty(approvals[j].UpdatedAt, approvals[j].CreatedAt)
		return left > right
	})
}
