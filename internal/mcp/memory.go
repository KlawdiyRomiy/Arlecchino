package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	agentMemoryDirectoryName  = "memory"
	agentMemoryFileName       = "memory/session-memory.jsonl"
	agentContextFileName      = "memory/CONTEXT.md"
	legacyAgentMemoryFileName = "session-memory.jsonl"
	defaultAgentMemoryLimit   = 2000
	defaultAgentContextChars  = 4000
	maxAgentMemoryEntryLength = 4096
)

type AgentMemoryEntry struct {
	ID         string   `json:"id"`
	Type       string   `json:"type"`
	Tags       []string `json:"tags,omitempty"`
	Content    string   `json:"content"`
	Importance int      `json:"importance"`
	CreatedAt  string   `json:"createdAt"`
	SessionID  string   `json:"sessionId,omitempty"`
}

type agentMemoryStore struct {
	mu          sync.RWMutex
	entries     []AgentMemoryEntry
	capacity    int
	counter     uint64
	diskPath    string
	contextPath string
	projectRoot string
}

func AgentContextFilePath(projectRoot string) string {
	return projectStateFilePath(projectRoot, agentContextFileName)
}

func EnsureAgentContextFile(projectRoot string) (string, error) {
	store, err := loadAgentMemoryStore(projectRoot, defaultAgentMemoryLimit)
	if err != nil {
		return "", err
	}
	if err := store.SyncContextFile(); err != nil {
		return "", err
	}
	return store.ContextFilePath(), nil
}

func loadAgentMemoryStore(projectRoot string, capacity int) (*agentMemoryStore, error) {
	if capacity <= 0 {
		capacity = defaultAgentMemoryLimit
	}
	if err := ensureArlecchinoStateDir(projectRoot); err != nil {
		return nil, err
	}
	memoryDir := projectStateFilePath(projectRoot, agentMemoryDirectoryName)
	if err := os.MkdirAll(memoryDir, 0o700); err != nil {
		return nil, err
	}

	store := &agentMemoryStore{
		entries:     make([]AgentMemoryEntry, 0, capacity),
		capacity:    capacity,
		diskPath:    projectStateFilePath(projectRoot, agentMemoryFileName),
		contextPath: projectStateFilePath(projectRoot, agentContextFileName),
		projectRoot: strings.TrimSpace(projectRoot),
	}

	file, err := os.Open(store.diskPath)
	if err != nil {
		if os.IsNotExist(err) {
			legacyPath := projectStateFilePath(projectRoot, legacyAgentMemoryFileName)
			legacyFile, legacyErr := os.Open(legacyPath)
			if legacyErr == nil {
				file = legacyFile
			} else {
				if !os.IsNotExist(legacyErr) {
					return nil, legacyErr
				}
				if err := store.syncContextFileLocked(); err != nil {
					return nil, err
				}
				return store, nil
			}
		} else {
			return nil, err
		}
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var entry AgentMemoryEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			return nil, err
		}
		store.entries = append(store.entries, normalizeAgentMemoryEntry(entry))
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	if len(store.entries) > store.capacity {
		store.entries = append([]AgentMemoryEntry(nil), store.entries[len(store.entries)-store.capacity:]...)
		if err := store.rewriteLocked(); err != nil {
			return nil, err
		}
	} else if file.Name() != store.diskPath && len(store.entries) > 0 {
		if err := store.rewriteLocked(); err != nil {
			return nil, err
		}
	}

	store.counter = uint64(len(store.entries))
	if err := store.syncContextFileLocked(); err != nil {
		return nil, err
	}

	return store, nil
}

func (s *agentMemoryStore) Save(entryType string, tags []string, content string, importance int, sessionID string) (AgentMemoryEntry, error) {
	trimmedContent := strings.TrimSpace(content)
	if trimmedContent == "" {
		return AgentMemoryEntry{}, fmt.Errorf("memory content is empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.counter++
	entry := normalizeAgentMemoryEntry(AgentMemoryEntry{
		ID:         fmt.Sprintf("mem-%d-%03d", time.Now().UTC().UnixMilli(), s.counter),
		Type:       entryType,
		Tags:       tags,
		Content:    trimmedContent,
		Importance: importance,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		SessionID:  strings.TrimSpace(sessionID),
	})

	s.entries = append(s.entries, entry)
	if len(s.entries) > s.capacity {
		s.entries = append([]AgentMemoryEntry(nil), s.entries[len(s.entries)-s.capacity:]...)
		if err := s.rewriteLocked(); err != nil {
			return AgentMemoryEntry{}, err
		}
	} else if err := s.appendLocked(entry); err != nil {
		return AgentMemoryEntry{}, err
	}

	if err := s.syncContextFileLocked(); err != nil {
		return AgentMemoryEntry{}, err
	}

	return entry, nil
}

func (s *agentMemoryStore) List(limit int) []AgentMemoryEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}
	if len(s.entries) == 0 {
		return []AgentMemoryEntry{}
	}
	if limit > len(s.entries) {
		limit = len(s.entries)
	}

	result := make([]AgentMemoryEntry, 0, limit)
	for index := len(s.entries) - 1; index >= 0 && len(result) < limit; index-- {
		result = append(result, cloneAgentMemoryEntry(s.entries[index]))
	}
	return result
}

func (s *agentMemoryStore) Search(query string, tags []string, limit int) []AgentMemoryEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 25
	}
	if len(s.entries) == 0 {
		return []AgentMemoryEntry{}
	}

	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
	normalizedTags := normalizeAgentMemoryTags(tags)
	result := make([]AgentMemoryEntry, 0, min(limit, len(s.entries)))

	for index := len(s.entries) - 1; index >= 0 && len(result) < limit; index-- {
		entry := s.entries[index]
		if len(normalizedTags) > 0 && !agentMemoryTagsMatch(entry.Tags, normalizedTags) {
			continue
		}
		if normalizedQuery != "" && !agentMemoryQueryMatch(entry, normalizedQuery) {
			continue
		}
		result = append(result, cloneAgentMemoryEntry(entry))
	}

	return result
}

func (s *agentMemoryStore) Context(maxChars int) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.contextLocked(maxChars)
}

func (s *agentMemoryStore) SyncContextFile() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.syncContextFileLocked()
}

func (s *agentMemoryStore) DiskFilePath() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.diskPath
}

func (s *agentMemoryStore) ContextFilePath() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.contextPath
}

func (s *agentMemoryStore) appendLocked(entry AgentMemoryEntry) error {
	line, err := json.Marshal(entry)
	if err != nil {
		return err
	}

	file, err := os.OpenFile(s.diskPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = file.Write(append(line, '\n'))
	return err
}

func (s *agentMemoryStore) rewriteLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.diskPath), 0o700); err != nil {
		return err
	}

	tempFile, err := os.CreateTemp(filepath.Dir(s.diskPath), ".mem-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()

	cleanup := func() {
		_ = tempFile.Close()
		_ = os.Remove(tempPath)
	}

	for _, entry := range s.entries {
		line, err := json.Marshal(entry)
		if err != nil {
			cleanup()
			return err
		}
		if _, err := tempFile.Write(append(line, '\n')); err != nil {
			cleanup()
			return err
		}
	}

	if err := tempFile.Chmod(0o600); err != nil {
		cleanup()
		return err
	}
	if err := tempFile.Close(); err != nil {
		cleanup()
		return err
	}

	if err := os.Rename(tempPath, s.diskPath); err != nil {
		cleanup()
		return err
	}

	return nil
}

func (s *agentMemoryStore) syncContextFileLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.contextPath), 0o700); err != nil {
		return err
	}
	return os.WriteFile(s.contextPath, []byte(buildAgentContextDocument(s.contextLocked(defaultAgentContextChars))), 0o600)
}

func (s *agentMemoryStore) contextLocked(maxChars int) string {
	if maxChars <= 0 {
		maxChars = defaultAgentContextChars
	}
	if len(s.entries) == 0 {
		return "No saved project memory yet."
	}

	var builder strings.Builder
	for index := len(s.entries) - 1; index >= 0; index-- {
		entry := s.entries[index]
		line := fmt.Sprintf("- [%s][p%d] %s", entry.Type, entry.Importance, entry.Content)
		if len(entry.Tags) > 0 {
			line += fmt.Sprintf(" tags=%s", strings.Join(entry.Tags, ","))
		}
		line += fmt.Sprintf(" (%s)", entry.CreatedAt)

		if builder.Len() > 0 {
			line = "\n" + line
		}
		if builder.Len()+len(line) > maxChars {
			break
		}
		builder.WriteString(line)
	}

	if builder.Len() == 0 {
		lastEntry := s.entries[len(s.entries)-1]
		return fmt.Sprintf("- [%s][p%d] %s", lastEntry.Type, lastEntry.Importance, lastEntry.Content)
	}

	return builder.String()
}

func buildAgentContextDocument(summary string) string {
	trimmedSummary := strings.TrimSpace(summary)
	if trimmedSummary == "" {
		trimmedSummary = "No saved project memory yet."
	}

	return fmt.Sprintf("# Arlecchino Mnemonic Memory\n\nThis file is generated from project-local memory entries in `.arlecchino/memory/session-memory.jsonl`.\n\nUse it as a compact recall surface: durable decisions, workflow facts, bug fixes, and handoff notes. Save new durable facts with `agent_memory.save`; search or list memory before relying on older context.\n\n%s\n", trimmedSummary)
}

func normalizeAgentMemoryEntry(entry AgentMemoryEntry) AgentMemoryEntry {
	entry.ID = strings.TrimSpace(entry.ID)
	entry.Type = normalizeAgentMemoryType(entry.Type)
	entry.Tags = normalizeAgentMemoryTags(entry.Tags)
	entry.Content = strings.TrimSpace(entry.Content)
	if len(entry.Content) > maxAgentMemoryEntryLength {
		entry.Content = entry.Content[:maxAgentMemoryEntryLength]
	}
	entry.Importance = normalizeAgentMemoryImportance(entry.Importance)
	if strings.TrimSpace(entry.CreatedAt) == "" {
		entry.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	entry.SessionID = strings.TrimSpace(entry.SessionID)
	return entry
}

func normalizeAgentMemoryType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "decision", "fact", "pattern", "bug-fix", "workflow", "session-summary":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return "note"
	}
}

func normalizeAgentMemoryTags(tags []string) []string {
	if len(tags) == 0 {
		return []string{}
	}

	seen := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		normalized := strings.ToLower(strings.TrimSpace(tag))
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}

	return result
}

func normalizeAgentMemoryImportance(value int) int {
	if value <= 0 {
		return 5
	}
	if value > 10 {
		return 10
	}
	return value
}

func cloneAgentMemoryEntry(entry AgentMemoryEntry) AgentMemoryEntry {
	return AgentMemoryEntry{
		ID:         entry.ID,
		Type:       entry.Type,
		Tags:       append([]string(nil), entry.Tags...),
		Content:    entry.Content,
		Importance: entry.Importance,
		CreatedAt:  entry.CreatedAt,
		SessionID:  entry.SessionID,
	}
}

func agentMemoryQueryMatch(entry AgentMemoryEntry, query string) bool {
	if strings.Contains(strings.ToLower(entry.Content), query) {
		return true
	}
	if strings.Contains(strings.ToLower(entry.Type), query) {
		return true
	}
	for _, tag := range entry.Tags {
		if strings.Contains(tag, query) {
			return true
		}
	}
	return false
}

func agentMemoryTagsMatch(entryTags, requested []string) bool {
	if len(requested) == 0 {
		return true
	}
	available := make(map[string]struct{}, len(entryTags))
	for _, tag := range entryTags {
		available[tag] = struct{}{}
	}
	for _, tag := range requested {
		if _, ok := available[tag]; ok {
			return true
		}
	}
	return false
}

func (s *ToolService) SaveAgentMemory(entryType string, tags []string, content string, importance int) (AgentMemoryEntry, error) {
	if err := s.requireUserApproval("agent_memory.save"); err != nil {
		return AgentMemoryEntry{}, err
	}
	if s.memory == nil {
		return AgentMemoryEntry{}, fmt.Errorf("agent memory is not available")
	}
	return s.memory.Save(entryType, tags, content, importance, s.sessionID)
}

func (s *ToolService) SearchAgentMemory(query string, tags []string, limit int) []AgentMemoryEntry {
	if s.memory == nil {
		return []AgentMemoryEntry{}
	}
	return s.memory.Search(query, tags, limit)
}

func (s *ToolService) ListAgentMemory(limit int) []AgentMemoryEntry {
	if s.memory == nil {
		return []AgentMemoryEntry{}
	}
	return s.memory.List(limit)
}

func (s *ToolService) AgentMemoryContext(maxChars int) string {
	if s.memory == nil {
		return ""
	}
	return s.memory.Context(maxChars)
}

func (s *ToolService) InitializeInstructions() string {
	parts := []string{
		"Use ide_control.* and change_journal.* for safe file operations, checkpoints, audit, and approval flow. When live bridge is available, use ide_backend.* for backend control and ide_ui.* for runtime UI state changes.",
		"Use ide_ui.surface_read to inspect visible panels and ide_ui.open_panel/move_panel/close_panel/open_file_panel for confirmed panel control.",
		"Use agent_memory.list/search/context early for project-local mnemonic memory and agent_memory.save after durable decisions, workflows, fixes, or context handoffs. Memory is stored under .arlecchino/memory/.",
	}

	contextSummary := strings.TrimSpace(s.AgentMemoryContext(2400))
	if contextSummary != "" {
		parts = append(parts, "Project-local memory:\n"+contextSummary)
	}

	return strings.Join(parts, "\n\n")
}
