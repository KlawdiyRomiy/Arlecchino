package storage

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

const DBFileName = "mnemonic.db"

type ProjectDB struct {
	projectRoot string
	dbPath      string
	shared      *sharedProjectDB
	closed      bool
}

type sharedProjectDB struct {
	db         *sql.DB
	mu         sync.Mutex
	refs       int
	ftsEnabled bool
}

type migration struct {
	ID    string
	Apply func(*sql.DB, *sharedProjectDB) error
}

var sharedProjectDBs = struct {
	sync.Mutex
	items map[string]*sharedProjectDB
}{items: map[string]*sharedProjectDB{}}

func Open(projectRoot string) (*ProjectDB, error) {
	root, err := canonicalProjectRoot(projectRoot)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dir, DBFileName)

	sharedProjectDBs.Lock()
	defer sharedProjectDBs.Unlock()
	if existing := sharedProjectDBs.items[dbPath]; existing != nil {
		existing.refs++
		return &ProjectDB{projectRoot: root, dbPath: dbPath, shared: existing}, nil
	}

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA busy_timeout = 5000`); err != nil {
		_ = db.Close()
		return nil, err
	}

	shared := &sharedProjectDB{db: db, refs: 1}
	shared.mu.Lock()
	err = migrate(db, shared)
	shared.mu.Unlock()
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	sharedProjectDBs.items[dbPath] = shared

	return &ProjectDB{projectRoot: root, dbPath: dbPath, shared: shared}, nil
}

func canonicalProjectRoot(projectRoot string) (string, error) {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return "", fmt.Errorf("project root is empty")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	evaluated, err := filepath.EvalSymlinks(abs)
	if err == nil {
		return filepath.Clean(evaluated), nil
	}
	if os.IsNotExist(err) {
		return abs, nil
	}
	return "", err
}

func (p *ProjectDB) Close() error {
	if p == nil || p.shared == nil || p.closed {
		return nil
	}
	p.closed = true

	sharedProjectDBs.Lock()
	defer sharedProjectDBs.Unlock()

	p.shared.refs--
	if p.shared.refs > 0 {
		return nil
	}
	delete(sharedProjectDBs.items, p.dbPath)
	return p.shared.db.Close()
}

func (p *ProjectDB) DB() *sql.DB {
	if p == nil || p.shared == nil {
		return nil
	}
	return p.shared.db
}

func (p *ProjectDB) Mutex() *sync.Mutex {
	if p == nil || p.shared == nil {
		return nil
	}
	return &p.shared.mu
}

func (p *ProjectDB) ProjectRoot() string {
	if p == nil {
		return ""
	}
	return p.projectRoot
}

func (p *ProjectDB) DBPath() string {
	if p == nil {
		return ""
	}
	return p.dbPath
}

func (p *ProjectDB) FTSEnabled() bool {
	if p == nil || p.shared == nil {
		return false
	}
	return p.shared.ftsEnabled
}

func migrate(db *sql.DB, shared *sharedProjectDB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS ai_schema_migrations (
		id TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return err
	}

	for _, item := range migrations() {
		applied, err := migrationApplied(db, item.ID)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		if err := item.Apply(db, shared); err != nil {
			return fmt.Errorf("apply AI DB migration %s: %w", item.ID, err)
		}
		if _, err := db.Exec(`INSERT OR REPLACE INTO ai_schema_migrations(id, applied_at) VALUES(?, ?)`, item.ID, utcNow()); err != nil {
			return err
		}
	}

	return configureMnemonicFTS(db, shared)
}

func migrations() []migration {
	return []migration{
		{ID: "001_mnemonic_entries", Apply: migrateMnemonicEntries},
		{ID: "002_skill_residency", Apply: migrateSkillResidency},
		{ID: "003_context_continuity", Apply: migrateContextContinuity},
		{ID: "004_context_continuity_invariants", Apply: migrateContextContinuityInvariants},
	}
}

func migrateMnemonicEntries(db *sql.DB, _ *sharedProjectDB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS mnemonic_entries (
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
		ok, err := columnExists(db, "mnemonic_entries", column.name)
		if err != nil {
			return err
		}
		if !ok {
			if _, err := db.Exec(column.sql); err != nil {
				return err
			}
		}
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS mnemonic_relationships (
		id TEXT PRIMARY KEY,
		from_id TEXT NOT NULL,
		to_id TEXT NOT NULL,
		type TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`); err != nil {
		return err
	}
	for _, stmt := range []string{
		`CREATE INDEX IF NOT EXISTS idx_mnemonic_latest_trust ON mnemonic_entries(is_latest, trust, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_mnemonic_relationships_from ON mnemonic_relationships(from_id)`,
		`CREATE INDEX IF NOT EXISTS idx_mnemonic_relationships_to ON mnemonic_relationships(to_id)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func migrateSkillResidency(db *sql.DB, _ *sharedProjectDB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS ai_skill_registry (
			skill_id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT,
			path TEXT,
			source_kind TEXT NOT NULL,
			source_repo TEXT,
			source_ref TEXT,
			tags_json TEXT NOT NULL DEFAULT '[]',
			activation_patterns_json TEXT NOT NULL DEFAULT '[]',
			tool_hints_json TEXT NOT NULL DEFAULT '[]',
			trust_state TEXT NOT NULL DEFAULT 'candidate',
			pinned INTEGER DEFAULT 0,
			content_hash TEXT NOT NULL,
			digest_version INTEGER DEFAULT 0,
			stale INTEGER DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_scanned_at TEXT NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_skill_registry_source_path ON ai_skill_registry(source_kind, path)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_skill_registry_hash ON ai_skill_registry(content_hash)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_skill_registry_trust ON ai_skill_registry(trust_state, pinned, stale)`,
		`CREATE TABLE IF NOT EXISTS ai_skill_digests (
			skill_id TEXT NOT NULL,
			digest_version INTEGER NOT NULL,
			content_hash TEXT NOT NULL,
			summary TEXT NOT NULL,
			activation_rules_json TEXT NOT NULL DEFAULT '[]',
			operating_reminders_json TEXT NOT NULL DEFAULT '[]',
			avoid_rules_json TEXT NOT NULL DEFAULT '[]',
			tool_hints_json TEXT NOT NULL DEFAULT '[]',
			verification_hints_json TEXT NOT NULL DEFAULT '[]',
			resources_index_json TEXT NOT NULL DEFAULT '[]',
			trust_state TEXT NOT NULL DEFAULT 'candidate',
			created_at TEXT NOT NULL,
			PRIMARY KEY(skill_id, digest_version, content_hash),
			FOREIGN KEY(skill_id) REFERENCES ai_skill_registry(skill_id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_skill_digests_current ON ai_skill_digests(skill_id, content_hash, digest_version)`,
		`CREATE TABLE IF NOT EXISTS ai_skill_residency (
			resident_id TEXT PRIMARY KEY,
			skill_id TEXT NOT NULL,
			workspace_root_hash TEXT NOT NULL,
			agent_surface TEXT NOT NULL,
			session_instance_id TEXT NOT NULL,
			state TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			digest_version INTEGER NOT NULL,
			topic_match TEXT,
			confidence REAL DEFAULT 0,
			activated_at TEXT NOT NULL,
			last_used_at TEXT NOT NULL,
			decay_deadline TEXT,
			activation_reason TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY(skill_id) REFERENCES ai_skill_registry(skill_id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_skill_residency_lookup ON ai_skill_residency(workspace_root_hash, agent_surface, session_instance_id, state, last_used_at)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_skill_residency_skill ON ai_skill_residency(skill_id, state, last_used_at)`,
		`CREATE TABLE IF NOT EXISTS ai_skill_events (
			event_id TEXT PRIMARY KEY,
			skill_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			actor TEXT,
			details_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			FOREIGN KEY(skill_id) REFERENCES ai_skill_registry(skill_id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_skill_events_skill_time ON ai_skill_events(skill_id, created_at)`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func migrateContextContinuity(db *sql.DB, _ *sharedProjectDB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS ai_context_capsules (
			id TEXT PRIMARY KEY,
			project_session_id TEXT NOT NULL,
			chat_session_id TEXT NOT NULL,
			run_id TEXT,
			kind TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			trust TEXT NOT NULL DEFAULT 'generated',
			summary TEXT NOT NULL,
			facts_candidates_json TEXT NOT NULL DEFAULT '[]',
			source_refs_json TEXT NOT NULL DEFAULT '[]',
			retrieval_tags_json TEXT NOT NULL DEFAULT '[]',
			continuation_hint TEXT,
			redaction_json TEXT NOT NULL DEFAULT '{}',
			data_categories_json TEXT NOT NULL DEFAULT '[]',
			branch TEXT,
			head TEXT,
			worktree_hash TEXT,
			stale_reason TEXT,
			byte_size INTEGER DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			expires_at TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS ai_context_capsule_links (
			id TEXT PRIMARY KEY,
			from_capsule_id TEXT NOT NULL,
			to_capsule_id TEXT NOT NULL,
			link_type TEXT NOT NULL,
			created_at TEXT NOT NULL,
			FOREIGN KEY(from_capsule_id) REFERENCES ai_context_capsules(id) ON DELETE CASCADE,
			FOREIGN KEY(to_capsule_id) REFERENCES ai_context_capsules(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS ai_context_retrieval_events (
			id TEXT PRIMARY KEY,
			project_session_id TEXT NOT NULL,
			chat_session_id TEXT NOT NULL,
			run_id TEXT,
			query_text TEXT,
			query_tags_json TEXT NOT NULL DEFAULT '[]',
			selected_capsule_ids_json TEXT NOT NULL DEFAULT '[]',
			selected_mnemonic_ids_json TEXT NOT NULL DEFAULT '[]',
			policy_reason TEXT,
			result_count INTEGER DEFAULT 0,
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_context_capsules_session ON ai_context_capsules(project_session_id, chat_session_id, status, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_context_capsules_kind ON ai_context_capsules(project_session_id, kind, status, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_context_capsules_trust ON ai_context_capsules(trust, status, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_context_capsule_links_from ON ai_context_capsule_links(from_capsule_id, link_type)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_context_capsule_links_to ON ai_context_capsule_links(to_capsule_id, link_type)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_context_retrieval_events_session ON ai_context_retrieval_events(project_session_id, chat_session_id, created_at)`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return ensureContextCapsuleFTSStorage(db)
}

func migrateContextContinuityInvariants(db *sql.DB, _ *sharedProjectDB) error {
	now := utcNow()
	if _, err := db.Exec(`WITH ranked AS (
			SELECT id,
				ROW_NUMBER() OVER (
					PARTITION BY project_session_id, chat_session_id
					ORDER BY created_at DESC, updated_at DESC, id DESC
				) AS rn
			FROM ai_context_capsules
			WHERE kind = 'compaction' AND status = 'active'
		)
		UPDATE ai_context_capsules
		SET status = 'superseded', updated_at = ?
		WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`, now); err != nil {
		return err
	}
	if err := ensureContextCapsuleFTSStorage(db); err != nil {
		return err
	}
	if _, err := db.Exec(`DELETE FROM ai_context_capsules_fts
		WHERE id IN (
			SELECT id FROM ai_context_capsules
			WHERE kind = 'compaction' AND status = 'superseded'
		)`); err != nil {
		return err
	}
	statements := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_context_one_active_compaction
		ON ai_context_capsules(project_session_id, chat_session_id)
		WHERE kind = 'compaction' AND status = 'active'`,
		`CREATE INDEX IF NOT EXISTS idx_ai_context_active_turns
		ON ai_context_capsules(project_session_id, chat_session_id, kind, status, created_at DESC)`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func ensureContextCapsuleFTSStorage(db *sql.DB) error {
	if _, err := db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ai_context_capsules_fts USING fts5(id UNINDEXED, summary, facts, retrieval_tags)`); err == nil {
		return nil
	}
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS ai_context_capsules_fts (
		id TEXT PRIMARY KEY,
		summary TEXT,
		facts TEXT,
		retrieval_tags TEXT
	)`)
	return err
}

func configureMnemonicFTS(db *sql.DB, shared *sharedProjectDB) error {
	existed, err := tableExists(db, "mnemonic_entries_fts")
	if err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS mnemonic_entries_fts USING fts5(id UNINDEXED, source, tags, content)`); err != nil {
		shared.ftsEnabled = false
		return nil
	}
	shared.ftsEnabled = true
	if existed {
		return nil
	}
	return rebuildMnemonicFTS(db)
}

func rebuildMnemonicFTS(db *sql.DB) error {
	if _, err := db.Exec(`DELETE FROM mnemonic_entries_fts`); err != nil {
		return err
	}
	rows, err := db.Query(`SELECT id, source, tags_json, content FROM mnemonic_entries`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, source, tagsJSON, content string
		if err := rows.Scan(&id, &source, &tagsJSON, &content); err != nil {
			return err
		}
		if _, err := db.Exec(`INSERT INTO mnemonic_entries_fts(id, source, tags, content) VALUES(?, ?, ?, ?)`, id, source, tagsJSON, content); err != nil {
			return err
		}
	}
	return rows.Err()
}

func migrationApplied(db *sql.DB, id string) (bool, error) {
	var existing string
	err := db.QueryRow(`SELECT id FROM ai_schema_migrations WHERE id = ?`, id).Scan(&existing)
	if err == nil {
		return true, nil
	}
	if err == sql.ErrNoRows {
		return false, nil
	}
	return false, err
}

func tableExists(db *sql.DB, table string) (bool, error) {
	var name string
	err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = ?`, table).Scan(&name)
	if err == nil {
		return true, nil
	}
	if err == sql.ErrNoRows {
		return false, nil
	}
	return false, err
}

func columnExists(db *sql.DB, table string, column string) (bool, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
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

func utcNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}
