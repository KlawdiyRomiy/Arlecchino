package mcp

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"arlecchino/internal/ai/mnemonic"
)

const agentMemoryMnemonicSource = "mcp-agent-memory"

type mnemonicAgentMemoryStore struct {
	store       *mnemonic.Store
	contextPath string
	projectRoot string
}

func loadMnemonicAgentMemoryStore(projectRoot string, capacity int) (*mnemonicAgentMemoryStore, error) {
	store, err := mnemonic.Open(projectRoot, true)
	if err != nil {
		return nil, err
	}
	backend := &mnemonicAgentMemoryStore{
		store:       store,
		contextPath: AgentContextFilePath(projectRoot),
		projectRoot: strings.TrimSpace(projectRoot),
	}

	legacy, legacyErr := loadAgentMemoryStore(projectRoot, capacity)
	if legacyErr != nil {
		_ = store.Close()
		return nil, legacyErr
	}
	if err := backend.migrateLegacyEntries(legacy.List(capacity)); err != nil {
		_ = store.Close()
		return nil, err
	}
	if err := backend.SyncContextFile(); err != nil {
		_ = store.Close()
		return nil, err
	}
	return backend, nil
}

func (s *mnemonicAgentMemoryStore) Save(entryType string, tags []string, content string, importance int, sessionID string) (AgentMemoryEntry, error) {
	entry := normalizeAgentMemoryEntry(AgentMemoryEntry{
		Type:       entryType,
		Tags:       tags,
		Content:    content,
		Importance: importance,
		SessionID:  sessionID,
	})
	if entry.Content == "" {
		return AgentMemoryEntry{}, fmt.Errorf("memory content is empty")
	}
	saved, err := s.store.Save(mnemonic.Entry{
		Type:       entry.Type,
		Source:     agentMemoryMnemonicSource,
		Tags:       agentMemoryTagsWithSource(entry.Tags),
		Content:    entry.Content,
		Importance: entry.Importance,
		Confidence: 0.8,
		Trust:      mnemonic.TrustTrusted,
		Pinned:     entry.Importance >= 8,
		IsLatest:   true,
		Provenance: agentMemoryProvenance(entry.SessionID, ""),
	})
	if err != nil {
		return AgentMemoryEntry{}, err
	}
	if err := s.SyncContextFile(); err != nil {
		return AgentMemoryEntry{}, err
	}
	return agentMemoryEntryFromMnemonic(saved), nil
}

func (s *mnemonicAgentMemoryStore) List(limit int) []AgentMemoryEntry {
	if limit <= 0 {
		limit = 50
	}
	entries, err := s.store.SearchEntries(mnemonic.SearchRequest{Limit: limit})
	if err != nil {
		return []AgentMemoryEntry{}
	}
	return agentMemoryEntriesFromMnemonic(entries)
}

func (s *mnemonicAgentMemoryStore) Search(query string, tags []string, limit int) []AgentMemoryEntry {
	if limit <= 0 {
		limit = 25
	}
	entries, err := s.store.SearchEntries(mnemonic.SearchRequest{
		Query: strings.TrimSpace(query),
		Tags:  normalizeAgentMemoryTags(tags),
		Limit: limit,
	})
	if err != nil {
		return []AgentMemoryEntry{}
	}
	return agentMemoryEntriesFromMnemonic(entries)
}

func (s *mnemonicAgentMemoryStore) Context(maxChars int) string {
	entries := s.List(defaultAgentMemoryLimit)
	return agentMemoryContext(entries, maxChars)
}

func (s *mnemonicAgentMemoryStore) SyncContextFile() error {
	if err := os.MkdirAll(filepath.Dir(s.contextPath), 0o700); err != nil {
		return err
	}
	return os.WriteFile(s.contextPath, []byte(buildAgentContextDocument(s.Context(defaultAgentContextChars))), 0o600)
}

func (s *mnemonicAgentMemoryStore) DiskFilePath() string {
	if s == nil || s.store == nil {
		return ""
	}
	return s.store.DBPath()
}

func (s *mnemonicAgentMemoryStore) ContextFilePath() string {
	if s == nil {
		return ""
	}
	return s.contextPath
}

func (s *mnemonicAgentMemoryStore) BackendName() string {
	return "mnemonic"
}

func (s *mnemonicAgentMemoryStore) Close() error {
	if s == nil || s.store == nil {
		return nil
	}
	return s.store.Close()
}

func (s *mnemonicAgentMemoryStore) migrateLegacyEntries(entries []AgentMemoryEntry) error {
	for _, legacy := range entries {
		legacy = normalizeAgentMemoryEntry(legacy)
		if legacy.ID == "" || legacy.Content == "" {
			continue
		}
		id := "mcp-" + legacy.ID
		if _, err := s.store.Get(id); err == nil {
			continue
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		_, err := s.store.Save(mnemonic.Entry{
			ID:         id,
			Type:       legacy.Type,
			Source:     agentMemoryMnemonicSource,
			Tags:       agentMemoryTagsWithSource(legacy.Tags),
			Content:    legacy.Content,
			Importance: legacy.Importance,
			Confidence: 0.8,
			Trust:      mnemonic.TrustTrusted,
			Pinned:     legacy.Importance >= 8,
			IsLatest:   true,
			CreatedAt:  legacy.CreatedAt,
			Provenance: agentMemoryProvenance(legacy.SessionID, legacy.ID),
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func agentMemoryEntriesFromMnemonic(entries []mnemonic.Entry) []AgentMemoryEntry {
	out := make([]AgentMemoryEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, agentMemoryEntryFromMnemonic(entry))
	}
	return out
}

func agentMemoryEntryFromMnemonic(entry mnemonic.Entry) AgentMemoryEntry {
	sessionID := ""
	if entry.Provenance != nil {
		sessionID = strings.TrimSpace(entry.Provenance["sessionId"])
	}
	return normalizeAgentMemoryEntry(AgentMemoryEntry{
		ID:         entry.ID,
		Type:       entry.Type,
		Tags:       removeAgentMemorySourceTag(entry.Tags),
		Content:    entry.Content,
		Importance: entry.Importance,
		CreatedAt:  entry.CreatedAt,
		SessionID:  sessionID,
	})
}

func agentMemoryContext(entries []AgentMemoryEntry, maxChars int) string {
	if maxChars <= 0 {
		maxChars = defaultAgentContextChars
	}
	if len(entries) == 0 {
		return "No saved project memory yet."
	}

	var builder strings.Builder
	for _, entry := range entries {
		entry = normalizeAgentMemoryEntry(entry)
		line := fmt.Sprintf("- [%s][p%d] %s", entry.Type, entry.Importance, entry.Content)
		if len(entry.Tags) > 0 {
			line += fmt.Sprintf(" tags=%s", strings.Join(entry.Tags, ","))
		}
		if entry.CreatedAt != "" {
			line += fmt.Sprintf(" (%s)", entry.CreatedAt)
		}
		if builder.Len() > 0 {
			line = "\n" + line
		}
		if builder.Len()+len(line) > maxChars {
			break
		}
		builder.WriteString(line)
	}
	if builder.Len() == 0 {
		entry := normalizeAgentMemoryEntry(entries[0])
		return fmt.Sprintf("- [%s][p%d] %s", entry.Type, entry.Importance, entry.Content)
	}
	return builder.String()
}

func agentMemoryTagsWithSource(tags []string) []string {
	normalized := normalizeAgentMemoryTags(tags)
	for _, tag := range normalized {
		if tag == "mcp" {
			return normalized
		}
	}
	return append(normalized, "mcp")
}

func removeAgentMemorySourceTag(tags []string) []string {
	normalized := normalizeAgentMemoryTags(tags)
	out := normalized[:0]
	for _, tag := range normalized {
		if tag == "mcp" {
			continue
		}
		out = append(out, tag)
	}
	return append([]string(nil), out...)
}

func agentMemoryProvenance(sessionID string, legacyID string) map[string]string {
	provenance := map[string]string{
		"origin":       "mcp_agent_memory",
		"approval":     "mcp_tool_approval",
		"projectLocal": "true",
	}
	if strings.TrimSpace(sessionID) != "" {
		provenance["sessionId"] = strings.TrimSpace(sessionID)
	}
	if strings.TrimSpace(legacyID) != "" {
		provenance["legacyId"] = strings.TrimSpace(legacyID)
	}
	return provenance
}
