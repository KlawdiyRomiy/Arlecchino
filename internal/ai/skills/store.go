package skills

import (
	"crypto/sha1"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/ai/storage"
)

const (
	SourceProject  = "project"
	SourceImported = "imported"

	TrustCandidate = "candidate"
	TrustTrusted   = "trusted"

	StateActive    = "active"
	StateResident  = "resident"
	StateDismissed = "dismissed"
	StateStale     = "stale"
)

const (
	defaultDigestVersion = 1
	defaultContextLimit  = 6
)

var suspiciousDigestLinePattern = regexp.MustCompile(`(?i)(api[_-]?key|token|secret|password|private[_-]?key|cookie|toolallowlist|tool[_ -]?allowlist|bypass approval|disable approval|without approval|request_permission)`)
var ErrStoreClosed = errors.New("skill store is closed")

type Store struct {
	mu          *sync.Mutex
	owner       *storage.ProjectDB
	db          *sql.DB
	projectRoot string
}

type Record struct {
	SkillID            string   `json:"skillId"`
	Name               string   `json:"name"`
	Description        string   `json:"description,omitempty"`
	Path               string   `json:"path,omitempty"`
	SourceKind         string   `json:"sourceKind"`
	SourceRepo         string   `json:"sourceRepo,omitempty"`
	SourceRef          string   `json:"sourceRef,omitempty"`
	Tags               []string `json:"tags,omitempty"`
	ActivationPatterns []string `json:"activationPatterns,omitempty"`
	ToolHints          []string `json:"toolHints,omitempty"`
	TrustState         string   `json:"trustState"`
	Pinned             bool     `json:"pinned"`
	ContentHash        string   `json:"contentHash"`
	DigestVersion      int      `json:"digestVersion"`
	Stale              bool     `json:"stale"`
	CreatedAt          string   `json:"createdAt"`
	UpdatedAt          string   `json:"updatedAt"`
	LastScannedAt      string   `json:"lastScannedAt"`
}

type Digest struct {
	SkillID            string   `json:"skillId"`
	ContentHash        string   `json:"contentHash"`
	Summary            string   `json:"summary"`
	ActivationRules    []string `json:"activationRules,omitempty"`
	OperatingReminders []string `json:"operatingReminders,omitempty"`
	AvoidRules         []string `json:"avoidRules,omitempty"`
	ToolHints          []string `json:"toolHints,omitempty"`
	VerificationHints  []string `json:"verificationHints,omitempty"`
	ResourcesIndex     []string `json:"resourcesIndex,omitempty"`
	DigestVersion      int      `json:"digestVersion"`
	TrustState         string   `json:"trustState"`
	CreatedAt          string   `json:"createdAt"`
}

type ContextSkill struct {
	Record
	Digest
	State             string  `json:"state"`
	TopicMatch        string  `json:"topicMatch,omitempty"`
	Confidence        float64 `json:"confidence"`
	SessionInstanceID string  `json:"sessionInstanceId,omitempty"`
	AgentSurface      string  `json:"agentSurface,omitempty"`
	ActivatedAt       string  `json:"activatedAt,omitempty"`
	LastUsedAt        string  `json:"lastUsedAt,omitempty"`
	DecayDeadline     string  `json:"decayDeadline,omitempty"`
	ActivationReason  string  `json:"activationReason,omitempty"`
	WorkspaceRootHash string  `json:"workspaceRootHash,omitempty"`
}

type ContextRequest struct {
	WorkspaceRootHash string
	AgentSurface      string
	SessionInstanceID string
	Limit             int
}

type ActivateRequest struct {
	SkillID           string
	WorkspaceRootHash string
	AgentSurface      string
	SessionInstanceID string
	State             string
	TopicMatch        string
	Confidence        float64
	ActivationReason  string
	TTL               time.Duration
}

type Status struct {
	Available int `json:"available"`
	Trusted   int `json:"trusted"`
	Pinned    int `json:"pinned"`
	Stale     int `json:"stale"`
	Active    int `json:"active"`
}

func Open(projectRoot string) (*Store, error) {
	owner, err := storage.Open(projectRoot)
	if err != nil {
		return nil, err
	}
	store, err := OpenWithDB(owner)
	if err != nil {
		_ = owner.Close()
		return nil, err
	}
	return store, nil
}

func OpenWithDB(owner *storage.ProjectDB) (*Store, error) {
	if owner == nil || owner.DB() == nil || owner.Mutex() == nil {
		return nil, fmt.Errorf("skill residency database is not open")
	}
	root := strings.TrimSpace(owner.ProjectRoot())
	if root == "" {
		return nil, fmt.Errorf("project root is empty")
	}
	return &Store{
		mu:          owner.Mutex(),
		owner:       owner,
		db:          owner.DB(),
		projectRoot: root,
	}, nil
}

func (s *Store) Close() error {
	if s == nil || s.mu == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	s.db = nil
	if s.owner == nil {
		return nil
	}
	return s.owner.Close()
}

func (s *Store) ensureOpen() error {
	if s == nil || s.mu == nil {
		return ErrStoreClosed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return ErrStoreClosed
	}
	return nil
}

func (s *Store) lockOpen() error {
	if s == nil || s.mu == nil {
		return ErrStoreClosed
	}
	s.mu.Lock()
	if s.db == nil {
		s.mu.Unlock()
		return ErrStoreClosed
	}
	return nil
}

func (s *Store) SyncProjectSkills() ([]Record, error) {
	if err := s.ensureOpen(); err != nil {
		return nil, err
	}
	projectRoot := s.projectRoot
	skillsRoot := filepath.Join(projectRoot, ".arlecchino", "skills")
	now := utcNow()
	records := []Record{}
	scanned := map[string]struct{}{}

	if _, err := os.Stat(skillsRoot); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return records, nil
		}
		return nil, err
	}

	err := filepath.WalkDir(skillsRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || entry.Name() != "SKILL.md" {
			return nil
		}
		content, err := readProjectSkillFile(projectRoot, path)
		if err != nil {
			return err
		}
		record := recordFromSkillFile(projectRoot, path, string(content), now)
		records = append(records, record)
		scanned[record.Path] = struct{}{}
		return nil
	})
	if err != nil {
		return nil, err
	}

	if err := s.lockOpen(); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	for _, record := range records {
		if err := s.upsertRecordLocked(record); err != nil {
			return nil, err
		}
	}
	if len(scanned) > 0 {
		rows, err := s.db.Query(`SELECT skill_id, path FROM ai_skill_registry WHERE source_kind = ?`, SourceProject)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var skillID, relPath string
			if err := rows.Scan(&skillID, &relPath); err != nil {
				return nil, err
			}
			if _, ok := scanned[relPath]; !ok {
				if _, err := s.db.Exec(`UPDATE ai_skill_registry SET stale = 1, updated_at = ? WHERE skill_id = ?`, now, skillID); err != nil {
					return nil, err
				}
				if err := s.recordEventLocked(skillID, "stale_missing", "backend", map[string]string{"path": relPath}); err != nil {
					return nil, err
				}
			}
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return s.listLocked(200)
}

func (s *Store) List(limit int) ([]Record, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if err := s.lockOpen(); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	return s.listLocked(limit)
}

func (s *Store) Status() (Status, error) {
	if err := s.lockOpen(); err != nil {
		return Status{}, err
	}
	defer s.mu.Unlock()
	var status Status
	if err := s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(CASE WHEN trust_state = ? THEN 1 ELSE 0 END), 0), COALESCE(SUM(pinned), 0), COALESCE(SUM(stale), 0) FROM ai_skill_registry`, TrustTrusted).Scan(&status.Available, &status.Trusted, &status.Pinned, &status.Stale); err != nil {
		return Status{}, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM ai_skill_residency WHERE state IN (?, ?)`, StateActive, StateResident).Scan(&status.Active); err != nil {
		return Status{}, err
	}
	return status, nil
}

func (s *Store) ReviewSkill(skillID, reviewer string, pinned bool) (Digest, error) {
	skillID = strings.TrimSpace(skillID)
	reviewer = strings.TrimSpace(reviewer)
	if skillID == "" {
		return Digest{}, fmt.Errorf("skill_id is required")
	}
	if reviewer == "" {
		return Digest{}, fmt.Errorf("reviewer is required for skill trust promotion")
	}

	if err := s.lockOpen(); err != nil {
		return Digest{}, err
	}
	defer s.mu.Unlock()
	record, err := s.getRecordLocked(skillID)
	if err != nil {
		return Digest{}, err
	}
	content, err := s.skillContentLocked(record)
	if err != nil {
		return Digest{}, err
	}
	version := record.DigestVersion + 1
	if version <= 0 {
		version = defaultDigestVersion
	}
	digest := buildDigest(record, content, version)
	digest.TrustState = TrustTrusted
	tx, err := s.db.Begin()
	if err != nil {
		return Digest{}, err
	}
	if _, err := tx.Exec(`UPDATE ai_skill_registry SET trust_state = ?, pinned = ?, digest_version = ?, stale = 0, updated_at = ? WHERE skill_id = ?`,
		TrustTrusted, boolToInt(pinned), version, utcNow(), skillID); err != nil {
		_ = tx.Rollback()
		return Digest{}, err
	}
	if err := insertDigestTx(tx, digest); err != nil {
		_ = tx.Rollback()
		return Digest{}, err
	}
	if err := insertEventTx(tx, skillID, "reviewed", reviewer, map[string]string{"pinned": fmt.Sprintf("%t", pinned)}); err != nil {
		_ = tx.Rollback()
		return Digest{}, err
	}
	if err := tx.Commit(); err != nil {
		return Digest{}, err
	}
	return digest, nil
}

func (s *Store) Activate(req ActivateRequest) (ContextSkill, error) {
	req.SkillID = strings.TrimSpace(req.SkillID)
	if req.SkillID == "" {
		return ContextSkill{}, fmt.Errorf("skill_id is required")
	}
	req.WorkspaceRootHash = firstNonEmpty(strings.TrimSpace(req.WorkspaceRootHash), hashString(s.projectRoot))
	req.AgentSurface = firstNonEmpty(strings.TrimSpace(req.AgentSurface), "agent")
	req.SessionInstanceID = firstNonEmpty(strings.TrimSpace(req.SessionInstanceID), "default")
	req.State = normalizeState(req.State)
	if req.TTL <= 0 {
		req.TTL = 30 * time.Minute
	}
	if req.Confidence < 0 {
		req.Confidence = 0
	}
	if req.Confidence > 1 {
		req.Confidence = 1
	}

	if err := s.lockOpen(); err != nil {
		return ContextSkill{}, err
	}
	defer s.mu.Unlock()
	current, err := s.currentTrustedDigestLocked(req.SkillID)
	if err != nil {
		return ContextSkill{}, err
	}
	now := time.Now().UTC()
	residentID := residencyID(req.SkillID, req.WorkspaceRootHash, req.AgentSurface, req.SessionInstanceID)
	_, err = s.db.Exec(`INSERT INTO ai_skill_residency(
		resident_id, skill_id, workspace_root_hash, agent_surface, session_instance_id, state, content_hash,
		digest_version, topic_match, confidence, activated_at, last_used_at, decay_deadline, activation_reason, created_at, updated_at
	) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(resident_id) DO UPDATE SET state=excluded.state, content_hash=excluded.content_hash,
		digest_version=excluded.digest_version, topic_match=excluded.topic_match, confidence=excluded.confidence,
		last_used_at=excluded.last_used_at, decay_deadline=excluded.decay_deadline, activation_reason=excluded.activation_reason,
		updated_at=excluded.updated_at`,
		residentID, req.SkillID, req.WorkspaceRootHash, req.AgentSurface, req.SessionInstanceID, req.State,
		current.Digest.ContentHash, current.Digest.DigestVersion, strings.TrimSpace(req.TopicMatch), req.Confidence,
		now.Format(time.RFC3339), now.Format(time.RFC3339), now.Add(req.TTL).Format(time.RFC3339),
		strings.TrimSpace(req.ActivationReason), now.Format(time.RFC3339), now.Format(time.RFC3339))
	if err != nil {
		return ContextSkill{}, err
	}
	if err := s.recordEventLocked(req.SkillID, "activated", "backend", map[string]string{"surface": req.AgentSurface, "session": req.SessionInstanceID}); err != nil {
		return ContextSkill{}, err
	}
	items, err := s.contextLocked(ContextRequest{
		WorkspaceRootHash: req.WorkspaceRootHash,
		AgentSurface:      req.AgentSurface,
		SessionInstanceID: req.SessionInstanceID,
		Limit:             1,
	})
	if err != nil {
		return ContextSkill{}, err
	}
	if len(items) == 0 {
		return ContextSkill{}, fmt.Errorf("activated skill did not produce resident context")
	}
	return items[0], nil
}

func (s *Store) Dismiss(skillID, workspaceRootHash, agentSurface, sessionInstanceID string) error {
	skillID = strings.TrimSpace(skillID)
	if skillID == "" {
		return fmt.Errorf("skill_id is required")
	}
	workspaceRootHash = firstNonEmpty(strings.TrimSpace(workspaceRootHash), hashString(s.projectRoot))
	agentSurface = firstNonEmpty(strings.TrimSpace(agentSurface), "agent")
	sessionInstanceID = firstNonEmpty(strings.TrimSpace(sessionInstanceID), "default")
	if err := s.lockOpen(); err != nil {
		return err
	}
	defer s.mu.Unlock()
	_, err := s.db.Exec(`UPDATE ai_skill_residency SET state = ?, updated_at = ? WHERE resident_id = ?`,
		StateDismissed, utcNow(), residencyID(skillID, workspaceRootHash, agentSurface, sessionInstanceID))
	if err != nil {
		return err
	}
	return s.recordEventLocked(skillID, "dismissed", "backend", map[string]string{"surface": agentSurface, "session": sessionInstanceID})
}

func (s *Store) Context(req ContextRequest) ([]ContextSkill, error) {
	if req.Limit <= 0 {
		req.Limit = defaultContextLimit
	}
	if req.Limit > 20 {
		req.Limit = 20
	}
	req.WorkspaceRootHash = firstNonEmpty(strings.TrimSpace(req.WorkspaceRootHash), hashString(s.projectRoot))
	req.AgentSurface = strings.TrimSpace(req.AgentSurface)
	req.SessionInstanceID = strings.TrimSpace(req.SessionInstanceID)
	if err := s.lockOpen(); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	return s.contextLocked(req)
}

func (s *Store) TrustedDigest(skillID string) (ContextSkill, error) {
	skillID = strings.TrimSpace(skillID)
	if skillID == "" {
		return ContextSkill{}, fmt.Errorf("skill_id is required")
	}
	if err := s.lockOpen(); err != nil {
		return ContextSkill{}, err
	}
	defer s.mu.Unlock()
	return s.currentTrustedDigestLocked(skillID)
}

func (s *Store) ClearRuntime() error {
	if err := s.lockOpen(); err != nil {
		return err
	}
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM ai_skill_residency`)
	return err
}

func (s *Store) ClearAll() error {
	if err := s.lockOpen(); err != nil {
		return err
	}
	defer s.mu.Unlock()
	for _, stmt := range []string{
		`DELETE FROM ai_skill_events`,
		`DELETE FROM ai_skill_residency`,
		`DELETE FROM ai_skill_digests`,
		`DELETE FROM ai_skill_registry`,
	} {
		if _, err := s.db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ImportCandidate(name, description, sourceRepo, sourceRef string, toolHints []string) (Record, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Record{}, fmt.Errorf("skill name is required")
	}
	now := utcNow()
	record := Record{
		SkillID:       SourceImported + ":" + slugify(name),
		Name:          name,
		Description:   strings.TrimSpace(description),
		SourceKind:    SourceImported,
		SourceRepo:    strings.TrimSpace(sourceRepo),
		SourceRef:     strings.TrimSpace(sourceRef),
		ToolHints:     normalizeList(toolHints, 20),
		TrustState:    TrustCandidate,
		ContentHash:   hashString(strings.Join([]string{name, description, sourceRepo, sourceRef}, "\n")),
		CreatedAt:     now,
		UpdatedAt:     now,
		LastScannedAt: now,
	}
	if err := s.lockOpen(); err != nil {
		return Record{}, err
	}
	defer s.mu.Unlock()
	if err := s.upsertRecordLocked(record); err != nil {
		return Record{}, err
	}
	if err := s.recordEventLocked(record.SkillID, "imported_quarantine", "backend", map[string]string{"sourceRepo": record.SourceRepo}); err != nil {
		return Record{}, err
	}
	return s.getRecordLocked(record.SkillID)
}

func (s *Store) upsertRecordLocked(record Record) error {
	if record.SkillID == "" {
		return fmt.Errorf("skill_id is empty")
	}
	if record.CreatedAt == "" {
		record.CreatedAt = utcNow()
	}
	record.UpdatedAt = firstNonEmpty(record.UpdatedAt, utcNow())
	record.LastScannedAt = firstNonEmpty(record.LastScannedAt, record.UpdatedAt)
	record.TrustState = normalizeTrust(record.TrustState)
	record.SourceKind = normalizeSourceKind(record.SourceKind)
	tagsJSON := mustJSON(record.Tags)
	activationJSON := mustJSON(record.ActivationPatterns)
	toolHintsJSON := mustJSON(record.ToolHints)
	_, err := s.db.Exec(`INSERT INTO ai_skill_registry(
		skill_id, name, description, path, source_kind, source_repo, source_ref, tags_json,
		activation_patterns_json, tool_hints_json, trust_state, pinned, content_hash,
		digest_version, stale, created_at, updated_at, last_scanned_at
	) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
	ON CONFLICT(skill_id) DO UPDATE SET
		name=excluded.name,
		description=excluded.description,
		path=excluded.path,
		source_repo=excluded.source_repo,
		source_ref=excluded.source_ref,
		tags_json=excluded.tags_json,
		activation_patterns_json=excluded.activation_patterns_json,
		tool_hints_json=excluded.tool_hints_json,
		content_hash=excluded.content_hash,
		stale=CASE WHEN ai_skill_registry.content_hash = excluded.content_hash THEN 0 ELSE 1 END,
		updated_at=excluded.updated_at,
		last_scanned_at=excluded.last_scanned_at`,
		record.SkillID, record.Name, record.Description, record.Path, record.SourceKind, record.SourceRepo, record.SourceRef,
		tagsJSON, activationJSON, toolHintsJSON, record.TrustState, boolToInt(record.Pinned), record.ContentHash,
		record.DigestVersion, record.CreatedAt, record.UpdatedAt, record.LastScannedAt)
	return err
}

func (s *Store) listLocked(limit int) ([]Record, error) {
	rows, err := s.db.Query(`SELECT skill_id, name, description, path, source_kind, source_repo, source_ref,
		tags_json, activation_patterns_json, tool_hints_json, trust_state, pinned, content_hash, digest_version,
		stale, created_at, updated_at, last_scanned_at
		FROM ai_skill_registry ORDER BY source_kind, name LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []Record{}
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *Store) getRecordLocked(skillID string) (Record, error) {
	row := s.db.QueryRow(`SELECT skill_id, name, description, path, source_kind, source_repo, source_ref,
		tags_json, activation_patterns_json, tool_hints_json, trust_state, pinned, content_hash, digest_version,
		stale, created_at, updated_at, last_scanned_at
		FROM ai_skill_registry WHERE skill_id = ?`, skillID)
	return scanRecord(row)
}

func (s *Store) currentTrustedDigestLocked(skillID string) (ContextSkill, error) {
	items, err := s.contextRowsLocked(`WHERE r.skill_id = ? AND r.source_kind = ? AND r.trust_state = ? AND r.pinned = 1 AND r.stale = 0
		AND d.content_hash = r.content_hash AND d.digest_version = r.digest_version AND d.trust_state = ?`, []any{skillID, SourceProject, TrustTrusted, TrustTrusted}, 1)
	if err != nil {
		return ContextSkill{}, err
	}
	if len(items) == 0 {
		return ContextSkill{}, fmt.Errorf("skill %q is not trusted, pinned, and current", skillID)
	}
	return items[0], nil
}

func (s *Store) contextLocked(req ContextRequest) ([]ContextSkill, error) {
	where := `WHERE r.source_kind = ? AND r.trust_state = ? AND r.pinned = 1 AND r.stale = 0
		AND d.content_hash = r.content_hash AND d.digest_version = r.digest_version AND d.trust_state = ?
		AND rs.workspace_root_hash = ? AND rs.state IN (?, ?)
		AND (rs.decay_deadline IS NULL OR rs.decay_deadline = '' OR rs.decay_deadline > ?)`
	args := []any{SourceProject, TrustTrusted, TrustTrusted, req.WorkspaceRootHash, StateActive, StateResident, utcNow()}
	if req.AgentSurface != "" {
		where += ` AND rs.agent_surface = ?`
		args = append(args, req.AgentSurface)
	}
	if req.SessionInstanceID != "" {
		where += ` AND rs.session_instance_id = ?`
		args = append(args, req.SessionInstanceID)
	}
	return s.contextRowsLocked(where, args, req.Limit)
}

func (s *Store) contextRowsLocked(where string, args []any, limit int) ([]ContextSkill, error) {
	if limit <= 0 {
		limit = defaultContextLimit
	}
	query := `SELECT r.skill_id, r.name, r.description, r.path, r.source_kind, r.source_repo, r.source_ref,
		r.tags_json, r.activation_patterns_json, r.tool_hints_json, r.trust_state, r.pinned, r.content_hash,
		r.digest_version, r.stale, r.created_at, r.updated_at, r.last_scanned_at,
		d.summary, d.activation_rules_json, d.operating_reminders_json, d.avoid_rules_json, d.tool_hints_json,
		d.verification_hints_json, d.resources_index_json, d.created_at,
		COALESCE(rs.state, ''), COALESCE(rs.topic_match, ''), COALESCE(rs.confidence, 0),
		COALESCE(rs.session_instance_id, ''), COALESCE(rs.agent_surface, ''), COALESCE(rs.activated_at, ''),
		COALESCE(rs.last_used_at, ''), COALESCE(rs.decay_deadline, ''), COALESCE(rs.activation_reason, ''),
		COALESCE(rs.workspace_root_hash, '')
		FROM ai_skill_registry r
		JOIN ai_skill_digests d ON d.skill_id = r.skill_id
		LEFT JOIN ai_skill_residency rs ON rs.skill_id = r.skill_id ` + where + `
		ORDER BY rs.last_used_at DESC, r.name LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	items := []ContextSkill{}
	stale := []struct {
		skillID string
		event   string
	}{}
	for rows.Next() {
		item, err := scanContextSkill(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		if item.State == "" && strings.Contains(where, "rs.") {
			continue
		}
		if ok, event := s.projectSkillHashCurrent(item.Record); !ok {
			stale = append(stale, struct {
				skillID string
				event   string
			}{skillID: item.Record.SkillID, event: event})
			continue
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for _, item := range stale {
		s.markSkillStaleLocked(item.skillID, item.event)
	}
	return items, nil
}

func (s *Store) projectSkillHashCurrent(record Record) (bool, string) {
	if record.SourceKind != SourceProject {
		return false, "stale_source_kind"
	}
	if strings.TrimSpace(record.Path) == "" {
		return false, "stale_unreadable"
	}
	path := filepath.Join(s.projectRoot, filepath.FromSlash(record.Path))
	data, err := readProjectSkillFile(s.projectRoot, path)
	if err != nil {
		return false, "stale_unreadable"
	}
	if contentHash(data) != record.ContentHash {
		return false, "stale_hash_mismatch"
	}
	return true, ""
}

func (s *Store) markSkillStaleLocked(skillID, eventType string) {
	now := utcNow()
	_, _ = s.db.Exec(`UPDATE ai_skill_registry SET stale = 1, updated_at = ? WHERE skill_id = ?`, now, skillID)
	_, _ = s.db.Exec(`UPDATE ai_skill_residency SET state = ?, updated_at = ? WHERE skill_id = ?`, StateStale, now, skillID)
	_ = s.recordEventLocked(skillID, eventType, "backend", nil)
}

func (s *Store) skillContentLocked(record Record) (string, error) {
	if record.SourceKind == SourceImported {
		return "", fmt.Errorf("imported skill %q requires explicit local inspection before trust promotion", record.SkillID)
	}
	if strings.TrimSpace(record.Path) == "" {
		return "", fmt.Errorf("skill %q does not have a readable project path", record.SkillID)
	}
	path := filepath.Join(s.projectRoot, filepath.FromSlash(record.Path))
	data, err := readProjectSkillFile(s.projectRoot, path)
	if err != nil {
		return "", err
	}
	hash := contentHash(data)
	if hash != record.ContentHash {
		s.markSkillStaleLocked(record.SkillID, "stale_hash_mismatch")
		return "", fmt.Errorf("skill %q changed since registry scan", record.SkillID)
	}
	return string(data), nil
}

func (s *Store) recordEventLocked(skillID, eventType, actor string, details map[string]string) error {
	return insertEvent(s.db, skillID, eventType, actor, details)
}

type recordScanner interface {
	Scan(dest ...any) error
}

func scanRecord(row recordScanner) (Record, error) {
	var record Record
	var tagsJSON, activationJSON, toolHintsJSON string
	var pinned, stale int
	if err := row.Scan(&record.SkillID, &record.Name, &record.Description, &record.Path, &record.SourceKind,
		&record.SourceRepo, &record.SourceRef, &tagsJSON, &activationJSON, &toolHintsJSON, &record.TrustState,
		&pinned, &record.ContentHash, &record.DigestVersion, &stale, &record.CreatedAt, &record.UpdatedAt,
		&record.LastScannedAt); err != nil {
		return Record{}, err
	}
	record.Pinned = pinned != 0
	record.Stale = stale != 0
	record.Tags = parseJSONList(tagsJSON)
	record.ActivationPatterns = parseJSONList(activationJSON)
	record.ToolHints = parseJSONList(toolHintsJSON)
	return record, nil
}

func scanContextSkill(rows *sql.Rows) (ContextSkill, error) {
	var item ContextSkill
	var tagsJSON, activationJSON, recordToolHintsJSON string
	var digestActivationJSON, remindersJSON, avoidJSON, digestToolHintsJSON, verificationJSON, resourcesJSON string
	var pinned, stale int
	if err := rows.Scan(&item.Record.SkillID, &item.Record.Name, &item.Record.Description, &item.Record.Path,
		&item.Record.SourceKind, &item.Record.SourceRepo, &item.Record.SourceRef, &tagsJSON, &activationJSON,
		&recordToolHintsJSON, &item.Record.TrustState, &pinned, &item.Record.ContentHash, &item.Record.DigestVersion,
		&stale, &item.Record.CreatedAt, &item.Record.UpdatedAt, &item.Record.LastScannedAt,
		&item.Digest.Summary, &digestActivationJSON, &remindersJSON, &avoidJSON, &digestToolHintsJSON,
		&verificationJSON, &resourcesJSON, &item.Digest.CreatedAt, &item.State, &item.TopicMatch, &item.Confidence,
		&item.SessionInstanceID, &item.AgentSurface, &item.ActivatedAt, &item.LastUsedAt, &item.DecayDeadline,
		&item.ActivationReason, &item.WorkspaceRootHash); err != nil {
		return ContextSkill{}, err
	}
	item.Record.Pinned = pinned != 0
	item.Record.Stale = stale != 0
	item.Record.Tags = parseJSONList(tagsJSON)
	item.Record.ActivationPatterns = parseJSONList(activationJSON)
	item.Record.ToolHints = parseJSONList(recordToolHintsJSON)
	item.Digest.SkillID = item.Record.SkillID
	item.Digest.ContentHash = item.Record.ContentHash
	item.Digest.DigestVersion = item.Record.DigestVersion
	item.Digest.TrustState = item.Record.TrustState
	item.Digest.ActivationRules = parseJSONList(digestActivationJSON)
	item.Digest.OperatingReminders = parseJSONList(remindersJSON)
	item.Digest.AvoidRules = parseJSONList(avoidJSON)
	item.Digest.ToolHints = parseJSONList(digestToolHintsJSON)
	item.Digest.VerificationHints = parseJSONList(verificationJSON)
	item.Digest.ResourcesIndex = parseJSONList(resourcesJSON)
	return item, nil
}

func insertDigestTx(tx *sql.Tx, digest Digest) error {
	_, err := tx.Exec(`INSERT OR REPLACE INTO ai_skill_digests(
		skill_id, digest_version, content_hash, summary, activation_rules_json, operating_reminders_json,
		avoid_rules_json, tool_hints_json, verification_hints_json, resources_index_json, trust_state, created_at
	) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		digest.SkillID, digest.DigestVersion, digest.ContentHash, digest.Summary, mustJSON(digest.ActivationRules),
		mustJSON(digest.OperatingReminders), mustJSON(digest.AvoidRules), mustJSON(digest.ToolHints),
		mustJSON(digest.VerificationHints), mustJSON(digest.ResourcesIndex), digest.TrustState, digest.CreatedAt)
	return err
}

func insertEventTx(tx *sql.Tx, skillID, eventType, actor string, details map[string]string) error {
	_, err := tx.Exec(`INSERT INTO ai_skill_events(event_id, skill_id, event_type, actor, details_json, created_at) VALUES(?, ?, ?, ?, ?, ?)`,
		"sk-ev-"+hashString(fmt.Sprintf("%s:%s:%d", skillID, eventType, time.Now().UTC().UnixNano())),
		skillID, eventType, strings.TrimSpace(actor), mustJSON(details), utcNow())
	return err
}

func insertEvent(db *sql.DB, skillID, eventType, actor string, details map[string]string) error {
	_, err := db.Exec(`INSERT INTO ai_skill_events(event_id, skill_id, event_type, actor, details_json, created_at) VALUES(?, ?, ?, ?, ?, ?)`,
		"sk-ev-"+hashString(fmt.Sprintf("%s:%s:%d", skillID, eventType, time.Now().UTC().UnixNano())),
		skillID, eventType, strings.TrimSpace(actor), mustJSON(details), utcNow())
	return err
}

func recordFromSkillFile(projectRoot, path, content, now string) Record {
	frontmatter, body := parseFrontmatter(content)
	rel, err := filepath.Rel(projectRoot, path)
	if err != nil {
		rel = path
	}
	rel = filepath.ToSlash(rel)
	name := firstNonEmpty(frontmatter["name"], filepath.Base(filepath.Dir(path)))
	description := frontmatter["description"]
	toolHints := extractToolHints(body)
	return Record{
		SkillID:            SourceProject + ":" + slugify(filepath.Base(filepath.Dir(path))),
		Name:               strings.TrimSpace(name),
		Description:        strings.TrimSpace(description),
		Path:               rel,
		SourceKind:         SourceProject,
		Tags:               parseLooseList(frontmatter["tags"]),
		ActivationPatterns: []string{strings.TrimSpace(description)},
		ToolHints:          toolHints,
		TrustState:         TrustCandidate,
		ContentHash:        contentHash([]byte(content)),
		CreatedAt:          now,
		UpdatedAt:          now,
		LastScannedAt:      now,
	}
}

func readProjectSkillFile(projectRoot, path string) ([]byte, error) {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil, fmt.Errorf("project root is empty")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	absRoot = filepath.Clean(absRoot)
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	absPath = filepath.Clean(absPath)
	if err := validateProjectSkillPath(absRoot, absPath); err != nil {
		return nil, err
	}
	if err := rejectSymlinkPath(absRoot, absPath); err != nil {
		return nil, err
	}
	return os.ReadFile(absPath)
}

func validateProjectSkillPath(projectRoot, path string) error {
	rel, err := filepath.Rel(projectRoot, path)
	if err != nil {
		return err
	}
	if rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("skill path escapes project root: %s", path)
	}
	if filepath.Base(path) != "SKILL.md" {
		return fmt.Errorf("skill path must point to SKILL.md: %s", path)
	}
	relSlash := filepath.ToSlash(rel)
	if !strings.HasPrefix(relSlash, ".arlecchino/skills/") {
		return fmt.Errorf("skill path is outside project skill registry: %s", relSlash)
	}
	return nil
}

func rejectSymlinkPath(projectRoot, path string) error {
	rel, err := filepath.Rel(projectRoot, path)
	if err != nil {
		return err
	}
	current := projectRoot
	for _, part := range strings.Split(rel, string(os.PathSeparator)) {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("skill path contains symlink: %s", current)
		}
	}
	return nil
}

func buildDigest(record Record, content string, version int) Digest {
	_, body := parseFrontmatter(content)
	sections := parseSections(body)
	return Digest{
		SkillID:            record.SkillID,
		ContentHash:        record.ContentHash,
		Summary:            truncate(firstNonEmpty(record.Description, record.Name), 280),
		ActivationRules:    normalizeList(append(record.ActivationPatterns, sectionLines(sections, "activation")...), 8),
		OperatingReminders: safeDigestLines(append(sectionLines(sections, "rules"), sectionLines(sections, "workflow")...), 10),
		AvoidRules:         safeDigestLines(append(sectionLines(sections, "avoid"), extractDoNotLines(body)...), 8),
		ToolHints:          normalizeList(record.ToolHints, 20),
		VerificationHints:  safeDigestLines(sectionLines(sections, "verification"), 8),
		ResourcesIndex:     normalizeList(extractResourceRefs(body), 12),
		DigestVersion:      version,
		TrustState:         TrustCandidate,
		CreatedAt:          utcNow(),
	}
}

func parseFrontmatter(content string) (map[string]string, string) {
	out := map[string]string{}
	trimmed := strings.TrimLeft(content, "\ufeff\r\n\t ")
	if !strings.HasPrefix(trimmed, "---") {
		return out, content
	}
	lines := strings.Split(trimmed, "\n")
	if len(lines) < 2 {
		return out, content
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
		line := strings.TrimSpace(lines[i])
		key, value, ok := strings.Cut(line, ":")
		if ok {
			out[strings.ToLower(strings.TrimSpace(key))] = strings.Trim(strings.TrimSpace(value), `"'`)
		}
	}
	if end == -1 {
		return out, content
	}
	return out, strings.Join(lines[end+1:], "\n")
}

func parseSections(body string) map[string][]string {
	sections := map[string][]string{}
	current := ""
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "#") {
			title := strings.TrimSpace(strings.TrimLeft(line, "#"))
			current = strings.ToLower(title)
			continue
		}
		if current == "" || !strings.HasPrefix(line, "- ") {
			continue
		}
		sections[current] = append(sections[current], strings.TrimSpace(strings.TrimPrefix(line, "- ")))
	}
	return sections
}

func sectionLines(sections map[string][]string, key string) []string {
	out := []string{}
	for title, lines := range sections {
		if strings.Contains(title, key) {
			out = append(out, lines...)
		}
	}
	return out
}

func extractDoNotLines(body string) []string {
	out := []string{}
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "- "))
		if strings.HasPrefix(strings.ToLower(trimmed), "do not ") {
			out = append(out, trimmed)
		}
	}
	return out
}

func extractToolHints(body string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, line := range strings.Split(body, "\n") {
		for _, token := range strings.Fields(strings.NewReplacer(",", " ", "`", " ", ":", " ").Replace(line)) {
			token = strings.Trim(token, "-*()[]{}")
			if !strings.Contains(token, ".") || strings.Contains(token, "/") {
				continue
			}
			if _, ok := seen[token]; ok {
				continue
			}
			seen[token] = struct{}{}
			out = append(out, token)
		}
	}
	sort.Strings(out)
	return normalizeList(out, 30)
}

func extractResourceRefs(body string) []string {
	out := []string{}
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, ".md") || strings.Contains(line, "scripts/") || strings.Contains(line, "examples/") {
			out = append(out, truncate(line, 160))
		}
	}
	return out
}

func safeDigestLines(lines []string, limit int) []string {
	out := []string{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || suspiciousDigestLinePattern.MatchString(line) {
			continue
		}
		out = append(out, truncate(line, 220))
		if len(out) >= limit {
			break
		}
	}
	return out
}

func parseJSONList(raw string) []string {
	var out []string
	_ = json.Unmarshal([]byte(raw), &out)
	if out == nil {
		return []string{}
	}
	return out
}

func parseLooseList(raw string) []string {
	raw = strings.TrimSpace(strings.Trim(raw, "[]"))
	if raw == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	for i := range parts {
		parts[i] = strings.Trim(strings.TrimSpace(parts[i]), `"'`)
	}
	return normalizeList(parts, 20)
}

func normalizeList(values []string, limit int) []string {
	if limit <= 0 {
		limit = len(values)
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func mustJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func normalizeTrust(value string) string {
	if strings.TrimSpace(strings.ToLower(value)) == TrustTrusted {
		return TrustTrusted
	}
	return TrustCandidate
}

func normalizeSourceKind(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case SourceImported:
		return SourceImported
	default:
		return SourceProject
	}
}

func normalizeState(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case StateResident:
		return StateResident
	default:
		return StateActive
	}
}

func contentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hashString(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])
}

func residencyID(skillID, workspaceRootHash, agentSurface, sessionInstanceID string) string {
	return "res-" + hashString(strings.Join([]string{skillID, workspaceRootHash, agentSurface, sessionInstanceID}, "\x00"))
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func truncate(value string, max int) string {
	value = strings.TrimSpace(value)
	if max <= 0 || len(value) <= max {
		return value
	}
	return strings.TrimSpace(value[:max])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func utcNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}
