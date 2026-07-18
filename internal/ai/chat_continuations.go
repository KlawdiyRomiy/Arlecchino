package ai

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
)

const (
	chatSteersFileName = "chat_steers.jsonl"
	chatQueueFileName  = "chat_queue.jsonl"
)

type ChatSteerLedger struct {
	mu   sync.Mutex
	path string
}

type ChatQueueLedger struct {
	mu   sync.Mutex
	path string
}

func openChatSteerLedger(projectRoot string) (*ChatSteerLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &ChatSteerLedger{path: filepath.Join(dir, chatSteersFileName)}, nil
}

func openChatQueueLedger(projectRoot string) (*ChatQueueLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &ChatQueueLedger{path: filepath.Join(dir, chatQueueFileName)}, nil
}

func (l *ChatSteerLedger) Upsert(steer AIChatRunSteer) error {
	if l == nil || strings.TrimSpace(steer.ID) == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	items, err := l.readLocked()
	if err != nil {
		return err
	}
	replaced := false
	for i := range items {
		if items[i].ID == steer.ID {
			items[i] = normalizeChatRunSteer(steer)
			replaced = true
			break
		}
	}
	if !replaced {
		items = append(items, normalizeChatRunSteer(steer))
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].CreatedAt < items[j].CreatedAt })
	return writeJSONLLocked(l.path, items)
}

func (l *ChatSteerLedger) ListByRun(runID string) ([]AIChatRunSteer, error) {
	if l == nil {
		return []AIChatRunSteer{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	items, err := l.readLocked()
	if err != nil {
		return nil, err
	}
	result := []AIChatRunSteer{}
	for _, item := range items {
		if item.TargetRunID == strings.TrimSpace(runID) {
			result = append(result, normalizeChatRunSteer(item))
		}
	}
	return result, nil
}

func (l *ChatSteerLedger) FindByIdempotency(runID string, key string) (AIChatRunSteer, bool, error) {
	if l == nil || strings.TrimSpace(key) == "" {
		return AIChatRunSteer{}, false, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	items, err := l.readLocked()
	if err != nil {
		return AIChatRunSteer{}, false, err
	}
	for _, item := range items {
		if item.TargetRunID == strings.TrimSpace(runID) && item.IdempotencyKey == strings.TrimSpace(key) {
			return normalizeChatRunSteer(item), true, nil
		}
	}
	return AIChatRunSteer{}, false, nil
}

func (l *ChatSteerLedger) DeleteSession(sessionID string) error {
	if l == nil {
		return nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	l.mu.Lock()
	defer l.mu.Unlock()
	items, err := l.readLocked()
	if err != nil {
		return err
	}
	kept := make([]AIChatRunSteer, 0, len(items))
	for _, item := range items {
		if normalizeChatSessionID(item.SessionID) != sessionID {
			kept = append(kept, item)
		}
	}
	return writeJSONLLocked(l.path, kept)
}

func (l *ChatSteerLedger) Clear() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return writeJSONLLocked(l.path, []AIChatRunSteer{})
}

func (l *ChatSteerLedger) readLocked() ([]AIChatRunSteer, error) {
	return readJSONLLocked[AIChatRunSteer](l.path)
}

func (l *ChatQueueLedger) ListSession(sessionID string) ([]AIQueuedChatRun, error) {
	if l == nil {
		return []AIQueuedChatRun{}, nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	l.mu.Lock()
	defer l.mu.Unlock()
	items, err := l.readLocked()
	if err != nil {
		return nil, err
	}
	result := []AIQueuedChatRun{}
	for _, item := range items {
		if normalizeChatSessionID(item.SessionID) == sessionID {
			result = append(result, normalizeQueuedChatRun(item))
		}
	}
	sortQueuedChatRuns(result)
	return result, nil
}

func (l *ChatQueueLedger) ReplaceSession(sessionID string, replacement []AIQueuedChatRun) error {
	if l == nil {
		return nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	l.mu.Lock()
	defer l.mu.Unlock()
	items, err := l.readLocked()
	if err != nil {
		return err
	}
	kept := make([]AIQueuedChatRun, 0, len(items)+len(replacement))
	for _, item := range items {
		if normalizeChatSessionID(item.SessionID) != sessionID {
			kept = append(kept, item)
		}
	}
	for _, item := range replacement {
		kept = append(kept, normalizeQueuedChatRun(item))
	}
	return writeJSONLLocked(l.path, kept)
}

func (l *ChatQueueLedger) Clear() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return writeJSONLLocked(l.path, []AIQueuedChatRun{})
}

func (l *ChatQueueLedger) readLocked() ([]AIQueuedChatRun, error) {
	return readJSONLLocked[AIQueuedChatRun](l.path)
}

func normalizeChatRunSteer(steer AIChatRunSteer) AIChatRunSteer {
	steer.ID = firstNonEmpty(strings.TrimSpace(steer.ID), "steer-"+uuid.NewString())
	steer.TargetRunID = strings.TrimSpace(steer.TargetRunID)
	steer.SessionID = normalizeChatSessionID(steer.SessionID)
	steer.Text = strings.TrimSpace(steer.Text)
	steer.Disposition = firstNonEmpty(strings.TrimSpace(steer.Disposition), "steer")
	if steer.State == "" {
		steer.State = AIChatSteerStateReceived
	}
	steer.Capability = strings.TrimSpace(steer.Capability)
	steer.Error = sanitizedDisplayText(steer.Error)
	steer.CreatedAt = firstNonEmpty(steer.CreatedAt, utcNow())
	steer.UpdatedAt = firstNonEmpty(steer.UpdatedAt, steer.CreatedAt)
	return steer
}

func normalizeQueuedChatRun(item AIQueuedChatRun) AIQueuedChatRun {
	item.ID = firstNonEmpty(strings.TrimSpace(item.ID), "queue-"+uuid.NewString())
	item.SessionID = normalizeChatSessionID(item.SessionID)
	item.Message = strings.TrimSpace(item.Message)
	item.Status = firstNonEmpty(strings.TrimSpace(item.Status), "pending")
	item.CreatedAt = firstNonEmpty(item.CreatedAt, utcNow())
	item.UpdatedAt = firstNonEmpty(item.UpdatedAt, item.CreatedAt)
	return item
}

func sortQueuedChatRuns(items []AIQueuedChatRun) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			return items[i].CreatedAt < items[j].CreatedAt
		}
		return items[i].Position < items[j].Position
	})
}

func readJSONLLocked[T any](path string) ([]T, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []T{}, nil
		}
		return nil, err
	}
	defer file.Close()
	items := []T{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 16*1024*1024)
	for scanner.Scan() {
		var item T
		if err := json.Unmarshal(scanner.Bytes(), &item); err == nil {
			items = append(items, item)
		}
	}
	return items, scanner.Err()
}

func writeJSONLLocked[T any](path string, items []T) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".chat-continuations-*.tmp")
	if err != nil {
		return err
	}
	tempPath := file.Name()
	defer os.Remove(tempPath)
	encoder := json.NewEncoder(file)
	for _, item := range items {
		if err := encoder.Encode(item); err != nil {
			_ = file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("replace continuation ledger: %w", err)
	}
	return nil
}
