package ai

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const chatHistoryFileName = "chat_runs.jsonl"

type ChatHistoryLedger struct {
	mu   sync.Mutex
	path string
}

func openChatHistoryLedger(projectRoot string) (*ChatHistoryLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &ChatHistoryLedger{path: filepath.Join(dir, chatHistoryFileName)}, nil
}

func (l *ChatHistoryLedger) Upsert(run AIChatRun) error {
	if l == nil || strings.TrimSpace(run.ID) == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	runs, err := l.readAllLocked()
	if err != nil {
		return err
	}
	replaced := false
	for i := range runs {
		if runs[i].ID == run.ID {
			if runs[i].Revision > run.Revision || (runs[i].Revision == run.Revision && chatRunPersistenceRichness(runs[i]) > chatRunPersistenceRichness(run)) {
				return nil
			}
			runs[i] = run
			replaced = true
			break
		}
	}
	if !replaced {
		runs = append(runs, run)
	}
	sortRunsNewestFirst(runs)
	return l.writeAllLocked(runs)
}

func chatRunPersistenceRichness(run AIChatRun) int {
	richness := 0
	switch strings.TrimSpace(run.Status) {
	case "completed":
		richness += 400
	case "error":
		richness += 300
	case "canceled":
		richness += 200
	case "running", "queued":
		richness += 100
	}
	if strings.TrimSpace(run.Response) != "" {
		richness += 20
	}
	if strings.TrimSpace(run.Error) != "" {
		richness += 10
	}
	if strings.TrimSpace(run.EgressRecordID) != "" {
		richness += 4
	}
	if run.ContextSummary != nil {
		richness += 2
	}
	if run.AgentRuntime != nil {
		richness++
	}
	return richness
}

func (l *ChatHistoryLedger) List(limit int) ([]AIChatRun, error) {
	if l == nil {
		return []AIChatRun{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	runs, err := l.readAllLocked()
	if err != nil {
		return nil, err
	}
	sortRunsNewestFirst(runs)
	if limit > 0 && len(runs) > limit {
		runs = runs[:limit]
	}
	return runs, nil
}

func (l *ChatHistoryLedger) DeleteSession(sessionID string) error {
	if l == nil {
		return nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	l.mu.Lock()
	defer l.mu.Unlock()

	runs, err := l.readAllLocked()
	if err != nil {
		return err
	}
	next := runs[:0]
	for _, run := range runs {
		if normalizeChatSessionID(run.SessionID) == sessionID {
			continue
		}
		next = append(next, run)
	}
	if len(next) == 0 {
		if err := os.Remove(l.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return l.writeAllLocked(next)
}

func (l *ChatHistoryLedger) Clear() error {
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

func (l *ChatHistoryLedger) readAllLocked() ([]AIChatRun, error) {
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIChatRun{}, nil
		}
		return nil, err
	}
	defer file.Close()

	runs := []AIChatRun{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 16*1024*1024)
	for scanner.Scan() {
		var run AIChatRun
		if err := json.Unmarshal(scanner.Bytes(), &run); err == nil && run.ID != "" {
			runs = append(runs, run)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return runs, nil
}

func (l *ChatHistoryLedger) writeAllLocked(runs []AIChatRun) error {
	dir := filepath.Dir(l.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".chat_runs-*.tmp")
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
	for _, run := range runs {
		if strings.TrimSpace(run.ID) == "" {
			continue
		}
		if err := encoder.Encode(run); err != nil {
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

func normalizeChatSessionID(sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return defaultChatSessionID
	}
	return sessionID
}

func normalizeLoadedChatRun(projectID string, run AIChatRun) AIChatRun {
	run.ProjectSessionID = normalizeProjectID(projectID)
	run.SessionID = normalizeChatSessionID(run.SessionID)
	if run.Revision <= 0 {
		run.Revision = 1
	}
	if run.Status == "running" || run.Status == "queued" {
		run.Status = "canceled"
		run.CanCancel = false
		run.Revision++
		run.UpdatedAt = firstNonEmpty(run.UpdatedAt, run.CreatedAt, utcNow())
	}
	return normalizeChatRunForDisplay(run)
}
