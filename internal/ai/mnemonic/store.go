package mnemonic

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

const (
	defaultMaxEntryBytes = 4096
	settingsFileName     = "mnemonic-settings.json"
	dbFileName           = "mnemonic.db"

	TrustTrusted   = "trusted"
	TrustGenerated = "generated"
	TrustUntrusted = "untrusted"
)

var secretLikePattern = regexp.MustCompile(`(?i)(api[_-]?key|token|secret|password|private[_-]?key|authorization|cookie)\s*[:=]\s*["']?[^"'\s]+`)

type Entry struct {
	ID             string            `json:"id"`
	Type           string            `json:"type"`
	Source         string            `json:"source,omitempty"`
	Tags           []string          `json:"tags,omitempty"`
	Content        string            `json:"content"`
	Importance     int               `json:"importance"`
	Confidence     float64           `json:"confidence"`
	Trust          string            `json:"trust,omitempty"`
	Pinned         bool              `json:"pinned"`
	IsLatest       bool              `json:"isLatest"`
	Decay          float64           `json:"decay"`
	LastAccessedAt string            `json:"lastAccessedAt,omitempty"`
	AccessCount    int               `json:"accessCount"`
	Provenance     map[string]string `json:"provenance,omitempty"`
	Relationships  []Relationship    `json:"relationships,omitempty"`
	CreatedAt      string            `json:"createdAt"`
	UpdatedAt      string            `json:"updatedAt,omitempty"`
}

type Relationship struct {
	ID        string `json:"id,omitempty"`
	FromID    string `json:"fromId"`
	ToID      string `json:"toId"`
	Type      string `json:"type"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type SearchRequest struct {
	Query             string
	Tags              []string
	Limit             int
	IncludeUntrusted  bool
	IncludeGenerated  bool
	IncludeSuperseded bool
}

type Store struct {
	mu           sync.Mutex
	db           *sql.DB
	dbPath       string
	settingsPath string
	enabled      bool
	ftsEnabled   bool
}

type settings struct {
	Enabled bool `json:"enabled"`
}

func Open(projectRoot string, defaultEnabled bool) (*Store, error) {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil, fmt.Errorf("project root is empty")
	}
	dir := filepath.Join(root, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	store := &Store{
		dbPath:       filepath.Join(dir, dbFileName),
		settingsPath: filepath.Join(dir, settingsFileName),
		enabled:      defaultEnabled,
	}
	store.enabled = store.loadEnabled(defaultEnabled)
	db, err := sql.Open("sqlite3", store.dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	store.db = db
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

func (s *Store) Enabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enabled
}

func (s *Store) SetEnabled(enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.enabled = enabled
	return s.saveEnabledLocked()
}

func (s *Store) FTSEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ftsEnabled
}

func (s *Store) Save(entry Entry) (Entry, error) {
	entry, err := normalizeEntry(entry)
	if err != nil {
		return Entry{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return Entry{}, fmt.Errorf("mnemonic store is closed")
	}
	if err := s.saveEntryLocked(entry); err != nil {
		return Entry{}, err
	}
	if err := s.replaceRelationshipsLocked(entry.ID, entry.Relationships); err != nil {
		return Entry{}, err
	}
	entry.Relationships, _ = s.relationshipsForEntryLocked(entry.ID)
	return entry, nil
}

func (s *Store) Get(id string) (Entry, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Entry{}, fmt.Errorf("mnemonic id is empty")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return Entry{}, fmt.Errorf("mnemonic store is closed")
	}
	entry, err := s.getEntryLocked(id)
	if err != nil {
		return Entry{}, err
	}
	entry.Relationships, _ = s.relationshipsForEntryLocked(entry.ID)
	return entry, nil
}

func (s *Store) List(limit int) ([]Entry, error) {
	return s.SearchEntries(SearchRequest{Limit: limit})
}

func (s *Store) ListAll(limit int) ([]Entry, error) {
	return s.SearchEntries(SearchRequest{
		Limit:             limit,
		IncludeGenerated:  true,
		IncludeUntrusted:  true,
		IncludeSuperseded: true,
	})
}

func (s *Store) Search(query string, limit int) ([]Entry, error) {
	return s.SearchEntries(SearchRequest{Query: query, Limit: limit})
}

func (s *Store) SearchEntries(req SearchRequest) ([]Entry, error) {
	req.Query = strings.TrimSpace(req.Query)
	req.Tags = normalizeTags(req.Tags)
	if req.Limit <= 0 {
		req.Limit = 20
	}
	if req.Limit > 200 {
		req.Limit = 200
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("mnemonic store is closed")
	}
	entries, err := s.searchEntriesLocked(req)
	if err != nil {
		return nil, err
	}
	if err := s.recordAccessLocked(entries); err != nil {
		return nil, err
	}
	for i := range entries {
		entries[i].Relationships, _ = s.relationshipsForEntryLocked(entries[i].ID)
	}
	return entries, nil
}

func (s *Store) Delete(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("mnemonic id is empty")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("mnemonic store is closed")
	}
	if _, err := s.db.Exec(`DELETE FROM mnemonic_relationships WHERE from_id = ? OR to_id = ?`, id, id); err != nil {
		return err
	}
	if s.ftsEnabled {
		_, _ = s.db.Exec(`DELETE FROM mnemonic_entries_fts WHERE id = ?`, id)
	}
	_, err := s.db.Exec(`DELETE FROM mnemonic_entries WHERE id = ?`, id)
	return err
}

func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		if _, err := s.db.Exec(`DELETE FROM mnemonic_relationships`); err != nil {
			return err
		}
		if s.ftsEnabled {
			if _, err := s.db.Exec(`DELETE FROM mnemonic_entries_fts`); err != nil {
				return err
			}
		}
		if _, err := s.db.Exec(`DELETE FROM mnemonic_entries`); err != nil {
			return err
		}
		if _, err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
			return err
		}
		if _, err := s.db.Exec(`VACUUM`); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DBPath() string {
	if s == nil {
		return ""
	}
	return s.dbPath
}

func (s *Store) migrate() error {
	if s.db == nil {
		return fmt.Errorf("mnemonic database is not open")
	}
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS mnemonic_entries (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		source TEXT,
		tags_json TEXT,
		content TEXT NOT NULL,
		importance INTEGER DEFAULT 0,
		confidence REAL DEFAULT 0.5,
		trust TEXT DEFAULT 'trusted',
		pinned INTEGER DEFAULT 0,
		is_latest INTEGER DEFAULT 1,
		decay REAL DEFAULT 0,
		last_accessed_at TEXT,
		access_count INTEGER DEFAULT 0,
		provenance_json TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`); err != nil {
		return err
	}
	for _, column := range []struct {
		name string
		sql  string
	}{
		{"confidence", `ALTER TABLE mnemonic_entries ADD COLUMN confidence REAL DEFAULT 0.5`},
		{"trust", `ALTER TABLE mnemonic_entries ADD COLUMN trust TEXT DEFAULT 'trusted'`},
		{"pinned", `ALTER TABLE mnemonic_entries ADD COLUMN pinned INTEGER DEFAULT 0`},
		{"is_latest", `ALTER TABLE mnemonic_entries ADD COLUMN is_latest INTEGER DEFAULT 1`},
		{"decay", `ALTER TABLE mnemonic_entries ADD COLUMN decay REAL DEFAULT 0`},
		{"last_accessed_at", `ALTER TABLE mnemonic_entries ADD COLUMN last_accessed_at TEXT`},
		{"access_count", `ALTER TABLE mnemonic_entries ADD COLUMN access_count INTEGER DEFAULT 0`},
		{"provenance_json", `ALTER TABLE mnemonic_entries ADD COLUMN provenance_json TEXT`},
	} {
		ok, err := s.columnExists("mnemonic_entries", column.name)
		if err != nil {
			return err
		}
		if !ok {
			if _, err := s.db.Exec(column.sql); err != nil {
				return err
			}
		}
	}
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS mnemonic_relationships (
		id TEXT PRIMARY KEY,
		from_id TEXT NOT NULL,
		to_id TEXT NOT NULL,
		type TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_mnemonic_latest_trust ON mnemonic_entries(is_latest, trust, updated_at)`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_mnemonic_relationships_from ON mnemonic_relationships(from_id)`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_mnemonic_relationships_to ON mnemonic_relationships(to_id)`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS mnemonic_entries_fts USING fts5(id UNINDEXED, source, tags, content)`); err == nil {
		s.ftsEnabled = true
		return s.rebuildFTSLocked()
	}
	s.ftsEnabled = false
	return nil
}

func (s *Store) loadEnabled(defaultEnabled bool) bool {
	data, err := os.ReadFile(s.settingsPath)
	if err != nil {
		return defaultEnabled
	}
	var value settings
	if err := json.Unmarshal(data, &value); err != nil {
		return defaultEnabled
	}
	return value.Enabled
}

func (s *Store) saveEnabledLocked() error {
	data, err := json.MarshalIndent(settings{Enabled: s.enabled}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.settingsPath), 0o700); err != nil {
		return err
	}
	return os.WriteFile(s.settingsPath, append(data, '\n'), 0o600)
}

func (s *Store) saveEntryLocked(entry Entry) error {
	tagsJSON, _ := json.Marshal(entry.Tags)
	provenanceJSON, _ := json.Marshal(entry.Provenance)
	_, err := s.db.Exec(
		`INSERT INTO mnemonic_entries(id, type, source, tags_json, content, importance, confidence, trust, pinned,
		 is_latest, decay, last_accessed_at, access_count, provenance_json, created_at, updated_at)
		 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET type=excluded.type, source=excluded.source, tags_json=excluded.tags_json,
		 content=excluded.content, importance=excluded.importance, confidence=excluded.confidence, trust=excluded.trust,
		 pinned=excluded.pinned, is_latest=excluded.is_latest, decay=excluded.decay, provenance_json=excluded.provenance_json,
		 updated_at=excluded.updated_at`,
		entry.ID, entry.Type, entry.Source, string(tagsJSON), entry.Content, entry.Importance, entry.Confidence, entry.Trust,
		boolToInt(entry.Pinned), boolToInt(entry.IsLatest), entry.Decay, entry.LastAccessedAt, entry.AccessCount,
		string(provenanceJSON), entry.CreatedAt, entry.UpdatedAt,
	)
	if err != nil {
		return err
	}
	return s.upsertFTSLocked(entry)
}

func (s *Store) getEntryLocked(id string) (Entry, error) {
	row := s.db.QueryRow(`SELECT id, type, source, tags_json, content, importance, confidence, trust, pinned,
		is_latest, decay, last_accessed_at, access_count, provenance_json, created_at, updated_at
		FROM mnemonic_entries WHERE id = ?`, id)
	entries, err := scanEntries(&rowScanner{row: row})
	if err != nil {
		return Entry{}, err
	}
	if len(entries) == 0 {
		return Entry{}, sql.ErrNoRows
	}
	return entries[0], nil
}

func (s *Store) searchEntriesLocked(req SearchRequest) ([]Entry, error) {
	if req.Query != "" && s.ftsEnabled {
		match := ftsQuery(req.Query)
		if match != "" {
			rows, err := s.db.Query(`SELECT e.id, e.type, e.source, e.tags_json, e.content, e.importance, e.confidence,
				e.trust, e.pinned, e.is_latest, e.decay, e.last_accessed_at, e.access_count, e.provenance_json, e.created_at, e.updated_at
				FROM mnemonic_entries e
				JOIN mnemonic_entries_fts ON mnemonic_entries_fts.id = e.id
				WHERE mnemonic_entries_fts MATCH ?
				ORDER BY bm25(mnemonic_entries_fts), e.pinned DESC, e.importance DESC, e.updated_at DESC
				LIMIT ?`, match, req.Limit*4)
			if err == nil {
				defer rows.Close()
				return filterEntries(rows, req)
			}
		}
	}
	if req.Query != "" {
		like := "%" + strings.ToLower(req.Query) + "%"
		rows, err := s.db.Query(`SELECT id, type, source, tags_json, content, importance, confidence,
			trust, pinned, is_latest, decay, last_accessed_at, access_count, provenance_json, created_at, updated_at
			FROM mnemonic_entries
			WHERE lower(content) LIKE ? OR lower(tags_json) LIKE ? OR lower(source) LIKE ?
			ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ?`, like, like, like, req.Limit*4)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return filterEntries(rows, req)
	}
	rows, err := s.db.Query(`SELECT id, type, source, tags_json, content, importance, confidence,
		trust, pinned, is_latest, decay, last_accessed_at, access_count, provenance_json, created_at, updated_at
		FROM mnemonic_entries
		ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ?`, req.Limit*4)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return filterEntries(rows, req)
}

func (s *Store) replaceRelationshipsLocked(fromID string, relationships []Relationship) error {
	if _, err := s.db.Exec(`DELETE FROM mnemonic_relationships WHERE from_id = ?`, fromID); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for _, relationship := range relationships {
		relationship.FromID = fromID
		relationship.Type = normalizeRelationshipType(relationship.Type)
		relationship.ToID = strings.TrimSpace(relationship.ToID)
		if relationship.ToID == "" || relationship.Type == "" {
			continue
		}
		if relationship.ID == "" {
			relationship.ID = fmt.Sprintf("rel-%d", time.Now().UTC().UnixNano())
		}
		if relationship.CreatedAt == "" {
			relationship.CreatedAt = now
		}
		if _, err := s.db.Exec(`INSERT OR REPLACE INTO mnemonic_relationships(id, from_id, to_id, type, created_at) VALUES(?, ?, ?, ?, ?)`,
			relationship.ID, relationship.FromID, relationship.ToID, relationship.Type, relationship.CreatedAt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) relationshipsForEntryLocked(id string) ([]Relationship, error) {
	rows, err := s.db.Query(`SELECT id, from_id, to_id, type, created_at FROM mnemonic_relationships WHERE from_id = ? ORDER BY created_at DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	relationships := []Relationship{}
	for rows.Next() {
		var relationship Relationship
		if err := rows.Scan(&relationship.ID, &relationship.FromID, &relationship.ToID, &relationship.Type, &relationship.CreatedAt); err != nil {
			return nil, err
		}
		relationships = append(relationships, relationship)
	}
	return relationships, rows.Err()
}

func (s *Store) recordAccessLocked(entries []Entry) error {
	if len(entries) == 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for _, entry := range entries {
		if _, err := s.db.Exec(`UPDATE mnemonic_entries SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`, now, entry.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) upsertFTSLocked(entry Entry) error {
	if !s.ftsEnabled {
		return nil
	}
	if _, err := s.db.Exec(`DELETE FROM mnemonic_entries_fts WHERE id = ?`, entry.ID); err != nil {
		return nil
	}
	tagsJSON, _ := json.Marshal(entry.Tags)
	_, err := s.db.Exec(`INSERT INTO mnemonic_entries_fts(id, source, tags, content) VALUES(?, ?, ?, ?)`, entry.ID, entry.Source, string(tagsJSON), entry.Content)
	return err
}

func (s *Store) rebuildFTSLocked() error {
	if !s.ftsEnabled {
		return nil
	}
	if _, err := s.db.Exec(`DELETE FROM mnemonic_entries_fts`); err != nil {
		return err
	}
	rows, err := s.db.Query(`SELECT id, source, tags_json, content FROM mnemonic_entries`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, source, tagsJSON, content string
		if err := rows.Scan(&id, &source, &tagsJSON, &content); err != nil {
			return err
		}
		if _, err := s.db.Exec(`INSERT INTO mnemonic_entries_fts(id, source, tags, content) VALUES(?, ?, ?, ?)`, id, source, tagsJSON, content); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (s *Store) columnExists(table string, column string) (bool, error) {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

type rowScanner struct {
	row *sql.Row
}

func (r *rowScanner) Next() bool {
	return r.row != nil
}

func (r *rowScanner) Scan(dest ...any) error {
	err := r.row.Scan(dest...)
	r.row = nil
	return err
}

func (r *rowScanner) Err() error {
	return nil
}

type scanner interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func filterEntries(rows scanner, req SearchRequest) ([]Entry, error) {
	entries, err := scanEntries(rows)
	if err != nil {
		return nil, err
	}
	filtered := make([]Entry, 0, min(len(entries), req.Limit))
	for _, entry := range entries {
		if !req.IncludeSuperseded && !entry.IsLatest {
			continue
		}
		if !req.IncludeGenerated && entry.Trust == TrustGenerated {
			continue
		}
		if !req.IncludeUntrusted && entry.Trust == TrustUntrusted {
			continue
		}
		if len(req.Tags) > 0 && !entryHasTags(entry, req.Tags) {
			continue
		}
		filtered = append(filtered, entry)
		if len(filtered) >= req.Limit {
			break
		}
	}
	return filtered, nil
}

func scanEntries(rows scanner) ([]Entry, error) {
	entries := []Entry{}
	for rows.Next() {
		var entry Entry
		var tagsJSON string
		var provenanceJSON sql.NullString
		var lastAccessedAt sql.NullString
		var pinned, isLatest int
		if err := rows.Scan(&entry.ID, &entry.Type, &entry.Source, &tagsJSON, &entry.Content, &entry.Importance, &entry.Confidence,
			&entry.Trust, &pinned, &isLatest, &entry.Decay, &lastAccessedAt, &entry.AccessCount, &provenanceJSON, &entry.CreatedAt, &entry.UpdatedAt); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return entries, nil
			}
			return nil, err
		}
		entry.Pinned = pinned != 0
		entry.IsLatest = isLatest != 0
		entry.LastAccessedAt = lastAccessedAt.String
		_ = json.Unmarshal([]byte(tagsJSON), &entry.Tags)
		if entry.Tags == nil {
			entry.Tags = []string{}
		}
		if provenanceJSON.Valid && provenanceJSON.String != "" {
			_ = json.Unmarshal([]byte(provenanceJSON.String), &entry.Provenance)
		}
		if entry.Provenance == nil {
			entry.Provenance = map[string]string{}
		}
		entry.Trust = normalizeTrust(entry.Trust)
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return entries, nil
}

func normalizeEntry(entry Entry) (Entry, error) {
	content := strings.TrimSpace(entry.Content)
	if content == "" {
		return Entry{}, fmt.Errorf("mnemonic content is empty")
	}
	content = sanitizeContent(content)
	if len(content) > defaultMaxEntryBytes {
		content = content[:defaultMaxEntryBytes]
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if strings.TrimSpace(entry.ID) == "" {
		entry.ID = fmt.Sprintf("mn-%d", time.Now().UTC().UnixNano())
		entry.IsLatest = true
	}
	entry.Type = strings.TrimSpace(entry.Type)
	if entry.Type == "" {
		entry.Type = "note"
	}
	entry.Source = strings.TrimSpace(entry.Source)
	entry.Content = content
	entry.Tags = normalizeTags(entry.Tags)
	entry.Trust = normalizeTrust(entry.Trust)
	if entry.Confidence <= 0 {
		entry.Confidence = 0.5
	}
	if entry.Confidence > 1 {
		entry.Confidence = 1
	}
	entry.CreatedAt = firstNonEmpty(entry.CreatedAt, now)
	entry.UpdatedAt = now
	if entry.Provenance == nil {
		entry.Provenance = map[string]string{}
	}
	return entry, nil
}

func sanitizeContent(content string) string {
	return secretLikePattern.ReplaceAllString(content, "$1=<redacted>")
}

func normalizeTags(tags []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(strings.ToLower(tag))
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		result = append(result, tag)
	}
	return result
}

func normalizeTrust(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case TrustGenerated:
		return TrustGenerated
	case TrustUntrusted:
		return TrustUntrusted
	default:
		return TrustTrusted
	}
}

func normalizeRelationshipType(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "updates", "contradicts", "supports", "related":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return ""
	}
}

func entryHasTags(entry Entry, tags []string) bool {
	if len(tags) == 0 {
		return true
	}
	entryTags := map[string]struct{}{}
	for _, tag := range entry.Tags {
		entryTags[tag] = struct{}{}
	}
	for _, tag := range tags {
		if _, ok := entryTags[tag]; !ok {
			return false
		}
	}
	return true
}

func ftsQuery(query string) string {
	terms := []string{}
	for _, term := range strings.Fields(query) {
		term = strings.Trim(term, `"*'`)
		if term == "" {
			continue
		}
		term = strings.ReplaceAll(term, `"`, `""`)
		terms = append(terms, `"`+term+`"`)
	}
	return strings.Join(terms, " ")
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
