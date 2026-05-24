package ai

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	aistorage "arlecchino/internal/ai/storage"

	"github.com/google/uuid"
)

const (
	contextContinuityDefaultLimit = 4
	contextContinuityMaxSummary   = 1800
	contextContinuityMaxHint      = 700
)

type ContextContinuityStore struct {
	owner       *aistorage.ProjectDB
	db          *sql.DB
	mu          *sync.Mutex
	projectRoot string
}

type contextWorktreeFingerprint struct {
	Branch       string
	Head         string
	WorktreeHash string
}

type contextRetrievalEvent struct {
	ProjectSessionID    string
	ChatSessionID       string
	RunID               string
	QueryText           string
	QueryTags           []string
	SelectedCapsuleIDs  []string
	SelectedMnemonicIDs []string
	PolicyReason        string
	ResultCount         int
}

func openContextContinuityStore(projectRoot string) (*ContextContinuityStore, error) {
	owner, err := aistorage.Open(projectRoot)
	if err != nil {
		return nil, err
	}
	return &ContextContinuityStore{
		owner:       owner,
		db:          owner.DB(),
		mu:          owner.Mutex(),
		projectRoot: owner.ProjectRoot(),
	}, nil
}

func (s *ContextContinuityStore) Close() error {
	if s == nil || s.owner == nil {
		return nil
	}
	return s.owner.Close()
}

func (s *ContextContinuityStore) Upsert(capsule AIContextCapsuleSummary) (AIContextCapsuleSummary, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return AIContextCapsuleSummary{}, fmt.Errorf("context continuity store is not open")
	}
	capsule = normalizeContextCapsule(capsule)
	capsule = sanitizeContextCapsule(capsule)
	factsJSON := mustJSON(capsule.FactsCandidates, "[]")
	refsJSON := mustJSON(capsule.SourceRefs, "[]")
	tagsJSON := mustJSON(capsule.RetrievalTags, "[]")
	redactionJSON := mustJSON(capsule.Redaction, "{}")
	categoriesJSON := mustJSON(capsule.DataCategories, "[]")

	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT INTO ai_context_capsules(
		id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
		facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint,
		redaction_json, data_categories_json, branch, head, worktree_hash, stale_reason,
		byte_size, created_at, updated_at, expires_at
	) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		project_session_id=excluded.project_session_id,
		chat_session_id=excluded.chat_session_id,
		run_id=excluded.run_id,
		kind=excluded.kind,
		status=excluded.status,
		trust=excluded.trust,
		summary=excluded.summary,
		facts_candidates_json=excluded.facts_candidates_json,
		source_refs_json=excluded.source_refs_json,
		retrieval_tags_json=excluded.retrieval_tags_json,
		continuation_hint=excluded.continuation_hint,
		redaction_json=excluded.redaction_json,
		data_categories_json=excluded.data_categories_json,
		branch=excluded.branch,
		head=excluded.head,
		worktree_hash=excluded.worktree_hash,
		stale_reason=excluded.stale_reason,
		byte_size=excluded.byte_size,
		updated_at=excluded.updated_at,
		expires_at=excluded.expires_at`,
		capsule.ID,
		capsule.ProjectSessionID,
		capsule.ChatSessionID,
		capsule.RunID,
		capsule.Kind,
		capsule.Status,
		capsule.Trust,
		capsule.Summary,
		factsJSON,
		refsJSON,
		tagsJSON,
		capsule.ContinuationHint,
		redactionJSON,
		categoriesJSON,
		capsule.Branch,
		capsule.Head,
		capsule.WorktreeHash,
		capsule.StaleReason,
		capsule.ByteSize,
		capsule.CreatedAt,
		capsule.UpdatedAt,
		capsule.ExpiresAt,
	)
	if err != nil {
		return AIContextCapsuleSummary{}, err
	}
	_, _ = s.db.Exec(`DELETE FROM ai_context_capsules_fts WHERE id = ?`, capsule.ID)
	_, _ = s.db.Exec(`INSERT INTO ai_context_capsules_fts(id, summary, facts, retrieval_tags) VALUES(?, ?, ?, ?)`, capsule.ID, capsule.Summary, factsJSON, tagsJSON)
	return capsule, nil
}

func (s *ContextContinuityStore) List(projectSessionID string, sessionID string, limit int) ([]AIContextCapsuleSummary, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return []AIContextCapsuleSummary{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	sessionID = normalizeChatSessionID(sessionID)
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
		facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
		data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
		FROM ai_context_capsules
		WHERE project_session_id = ? AND (? = '' OR chat_session_id = ?) AND status != ?
		ORDER BY created_at DESC
		LIMIT ?`, projectSessionID, optionalSessionFilter(sessionID), sessionID, AIContextCapsuleRevoked, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanContextCapsules(rows)
}

func (s *ContextContinuityStore) ActiveForSession(projectSessionID string, sessionID string, explicitIDs []string, limit int) ([]AIContextCapsuleSummary, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return []AIContextCapsuleSummary{}, nil
	}
	if limit <= 0 {
		limit = contextContinuityDefaultLimit
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	sessionID = normalizeChatSessionID(sessionID)
	explicitIDs = compactStringList(explicitIDs)
	if len(explicitIDs) > 0 {
		return s.capsulesByID(projectSessionID, sessionID, explicitIDs, limit)
	}

	s.mu.Lock()
	rows, err := s.db.Query(`SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
		facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
		data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
		FROM ai_context_capsules
		WHERE project_session_id = ? AND chat_session_id = ? AND status IN (?, ?)
		ORDER BY
			CASE kind
				WHEN 'compaction' THEN 0
				WHEN 'handoff' THEN 1
				WHEN 'ide_state' THEN 2
				ELSE 3
			END,
			created_at DESC
		LIMIT ?`, projectSessionID, sessionID, AIContextCapsuleActive, AIContextCapsuleStale, limit)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	capsules, scanErr := scanContextCapsules(rows)
	rows.Close()
	s.mu.Unlock()
	if scanErr != nil {
		return nil, scanErr
	}
	return s.downgradeStaleCapsules(capsules), nil
}

func (s *ContextContinuityStore) LatestCompaction(projectSessionID string, sessionID string) (AIContextCapsuleSummary, bool, error) {
	capsules, err := s.ActiveForSession(projectSessionID, sessionID, nil, 8)
	if err != nil {
		return AIContextCapsuleSummary{}, false, err
	}
	for _, capsule := range capsules {
		if capsule.Kind == AIContextCapsuleCompaction && capsule.Status == AIContextCapsuleActive {
			return capsule, true, nil
		}
	}
	return AIContextCapsuleSummary{}, false, nil
}

func (s *ContextContinuityStore) Revoke(projectSessionID string, capsuleID string) (AIContextCapsuleSummary, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return AIContextCapsuleSummary{}, fmt.Errorf("context continuity store is not open")
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	capsuleID = strings.TrimSpace(capsuleID)
	if capsuleID == "" {
		return AIContextCapsuleSummary{}, fmt.Errorf("context capsule id is empty")
	}
	now := utcNow()
	s.mu.Lock()
	_, err := s.db.Exec(`UPDATE ai_context_capsules SET status = ?, updated_at = ? WHERE id = ? AND project_session_id = ?`,
		AIContextCapsuleRevoked, now, capsuleID, projectSessionID)
	_, _ = s.db.Exec(`DELETE FROM ai_context_capsules_fts WHERE id = ?`, capsuleID)
	s.mu.Unlock()
	if err != nil {
		return AIContextCapsuleSummary{}, err
	}
	capsules, err := s.capsulesByIDIncludingRevoked(projectSessionID, []string{capsuleID}, 1)
	if err != nil {
		return AIContextCapsuleSummary{}, err
	}
	if len(capsules) == 0 {
		return AIContextCapsuleSummary{}, fmt.Errorf("context capsule %q was not found", capsuleID)
	}
	return capsules[0], nil
}

func (s *ContextContinuityStore) Supersede(projectSessionID string, capsuleIDs []string) error {
	if s == nil || s.db == nil || s.mu == nil || len(capsuleIDs) == 0 {
		return nil
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	now := utcNow()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range compactStringList(capsuleIDs) {
		if _, err := s.db.Exec(`UPDATE ai_context_capsules SET status = ?, updated_at = ? WHERE id = ? AND project_session_id = ? AND status = ?`,
			AIContextCapsuleSuperseded, now, id, projectSessionID, AIContextCapsuleActive); err != nil {
			return err
		}
		_, _ = s.db.Exec(`DELETE FROM ai_context_capsules_fts WHERE id = ?`, id)
	}
	return nil
}

func (s *ContextContinuityStore) Link(fromCapsuleID string, toCapsuleID string, linkType string) error {
	if s == nil || s.db == nil || s.mu == nil {
		return nil
	}
	fromCapsuleID = strings.TrimSpace(fromCapsuleID)
	toCapsuleID = strings.TrimSpace(toCapsuleID)
	linkType = strings.TrimSpace(linkType)
	if fromCapsuleID == "" || toCapsuleID == "" || linkType == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT OR IGNORE INTO ai_context_capsule_links(id, from_capsule_id, to_capsule_id, link_type, created_at) VALUES(?, ?, ?, ?, ?)`,
		"link-"+shortHash(fromCapsuleID+":"+toCapsuleID+":"+linkType), fromCapsuleID, toCapsuleID, linkType, utcNow())
	return err
}

func (s *ContextContinuityStore) RecordRetrieval(event contextRetrievalEvent) error {
	if s == nil || s.db == nil || s.mu == nil {
		return nil
	}
	event.ProjectSessionID = normalizeProjectID(event.ProjectSessionID)
	event.ChatSessionID = normalizeChatSessionID(event.ChatSessionID)
	event.QueryText = truncateUTF8(sanitizedDisplayText(event.QueryText), 500)
	event.QueryTags = sanitizeStringValues(event.QueryTags)
	event.SelectedCapsuleIDs = compactStringList(event.SelectedCapsuleIDs)
	event.SelectedMnemonicIDs = compactStringList(event.SelectedMnemonicIDs)
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT INTO ai_context_retrieval_events(
		id, project_session_id, chat_session_id, run_id, query_text, query_tags_json,
		selected_capsule_ids_json, selected_mnemonic_ids_json, policy_reason, result_count, created_at
	) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"retrieval-"+uuid.NewString(),
		event.ProjectSessionID,
		event.ChatSessionID,
		strings.TrimSpace(event.RunID),
		event.QueryText,
		mustJSON(event.QueryTags, "[]"),
		mustJSON(event.SelectedCapsuleIDs, "[]"),
		mustJSON(event.SelectedMnemonicIDs, "[]"),
		strings.TrimSpace(event.PolicyReason),
		event.ResultCount,
		utcNow(),
	)
	return err
}

func (s *ContextContinuityStore) DeleteSession(projectSessionID string, sessionID string) error {
	if s == nil || s.db == nil || s.mu == nil {
		return nil
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	sessionID = normalizeChatSessionID(sessionID)
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = s.db.Exec(`DELETE FROM ai_context_capsules_fts WHERE id IN (
		SELECT id FROM ai_context_capsules WHERE project_session_id = ? AND chat_session_id = ?
	)`, projectSessionID, sessionID)
	if _, err := s.db.Exec(`DELETE FROM ai_context_retrieval_events WHERE project_session_id = ? AND chat_session_id = ?`, projectSessionID, sessionID); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM ai_context_capsules WHERE project_session_id = ? AND chat_session_id = ?`, projectSessionID, sessionID)
	return err
}

func (s *ContextContinuityStore) Clear(projectSessionID string) error {
	if s == nil || s.db == nil || s.mu == nil {
		return nil
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = s.db.Exec(`DELETE FROM ai_context_capsules_fts WHERE id IN (
		SELECT id FROM ai_context_capsules WHERE project_session_id = ?
	)`, projectSessionID)
	if _, err := s.db.Exec(`DELETE FROM ai_context_retrieval_events WHERE project_session_id = ?`, projectSessionID); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM ai_context_capsules WHERE project_session_id = ?`, projectSessionID)
	return err
}

func (s *ContextContinuityStore) capsulesByID(projectSessionID string, sessionID string, ids []string, limit int) ([]AIContextCapsuleSummary, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return []AIContextCapsuleSummary{}, nil
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	sessionID = normalizeChatSessionID(sessionID)
	if len(ids) == 0 {
		return []AIContextCapsuleSummary{}, nil
	}
	if limit <= 0 || limit > len(ids) {
		limit = len(ids)
	}
	results := make([]AIContextCapsuleSummary, 0, limit)
	s.mu.Lock()
	for _, id := range compactStringList(ids) {
		row := s.db.QueryRow(`SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
			facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
			data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
			FROM ai_context_capsules
			WHERE id = ? AND project_session_id = ? AND (? = '' OR chat_session_id = ?) AND status NOT IN (?, ?)`,
			id, projectSessionID, optionalSessionFilter(sessionID), sessionID, AIContextCapsuleRevoked, AIContextCapsuleExpired)
		capsule, err := scanContextCapsule(row)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			s.mu.Unlock()
			return nil, err
		}
		results = append(results, capsule)
		if len(results) >= limit {
			break
		}
	}
	s.mu.Unlock()
	return s.downgradeStaleCapsules(results), nil
}

func (s *ContextContinuityStore) capsulesByIDIncludingRevoked(projectSessionID string, ids []string, limit int) ([]AIContextCapsuleSummary, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return []AIContextCapsuleSummary{}, nil
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	if len(ids) == 0 {
		return []AIContextCapsuleSummary{}, nil
	}
	if limit <= 0 || limit > len(ids) {
		limit = len(ids)
	}
	results := make([]AIContextCapsuleSummary, 0, limit)
	s.mu.Lock()
	for _, id := range compactStringList(ids) {
		row := s.db.QueryRow(`SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
			facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
			data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
			FROM ai_context_capsules
			WHERE id = ? AND project_session_id = ?`,
			id, projectSessionID)
		capsule, err := scanContextCapsule(row)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			s.mu.Unlock()
			return nil, err
		}
		results = append(results, capsule)
		if len(results) >= limit {
			break
		}
	}
	s.mu.Unlock()
	return results, nil
}

func (s *ContextContinuityStore) downgradeStaleCapsules(capsules []AIContextCapsuleSummary) []AIContextCapsuleSummary {
	fingerprint := currentContextWorktreeFingerprint(s.projectRoot)
	if fingerprint.Branch == "" && fingerprint.Head == "" && fingerprint.WorktreeHash == "" {
		return capsules
	}
	now := utcNow()
	for i := range capsules {
		reason := contextCapsuleStaleReason(capsules[i], fingerprint)
		if reason == "" {
			continue
		}
		capsules[i].Status = AIContextCapsuleStale
		capsules[i].StaleReason = reason
		capsules[i].UpdatedAt = now
		if s.db != nil && s.mu != nil {
			s.mu.Lock()
			_, _ = s.db.Exec(`UPDATE ai_context_capsules SET status = ?, stale_reason = ?, updated_at = ? WHERE id = ? AND status = ?`,
				AIContextCapsuleStale, reason, now, capsules[i].ID, AIContextCapsuleActive)
			s.mu.Unlock()
		}
	}
	return capsules
}

func scanContextCapsules(rows *sql.Rows) ([]AIContextCapsuleSummary, error) {
	capsules := []AIContextCapsuleSummary{}
	for rows.Next() {
		capsule, err := scanContextCapsule(rows)
		if err != nil {
			return nil, err
		}
		capsules = append(capsules, capsule)
	}
	return capsules, rows.Err()
}

type contextCapsuleScanner interface {
	Scan(dest ...any) error
}

func scanContextCapsule(scanner contextCapsuleScanner) (AIContextCapsuleSummary, error) {
	var capsule AIContextCapsuleSummary
	var factsJSON, refsJSON, tagsJSON, redactionJSON, categoriesJSON string
	err := scanner.Scan(
		&capsule.ID,
		&capsule.ProjectSessionID,
		&capsule.ChatSessionID,
		&capsule.RunID,
		&capsule.Kind,
		&capsule.Status,
		&capsule.Trust,
		&capsule.Summary,
		&factsJSON,
		&refsJSON,
		&tagsJSON,
		&capsule.ContinuationHint,
		&redactionJSON,
		&categoriesJSON,
		&capsule.Branch,
		&capsule.Head,
		&capsule.WorktreeHash,
		&capsule.StaleReason,
		&capsule.ByteSize,
		&capsule.CreatedAt,
		&capsule.UpdatedAt,
		&capsule.ExpiresAt,
	)
	if err != nil {
		return AIContextCapsuleSummary{}, err
	}
	_ = json.Unmarshal([]byte(factsJSON), &capsule.FactsCandidates)
	_ = json.Unmarshal([]byte(refsJSON), &capsule.SourceRefs)
	_ = json.Unmarshal([]byte(tagsJSON), &capsule.RetrievalTags)
	_ = json.Unmarshal([]byte(redactionJSON), &capsule.Redaction)
	_ = json.Unmarshal([]byte(categoriesJSON), &capsule.DataCategories)
	return capsule, nil
}

func normalizeContextCapsule(capsule AIContextCapsuleSummary) AIContextCapsuleSummary {
	capsule.ID = strings.TrimSpace(capsule.ID)
	if capsule.ID == "" {
		capsule.ID = "capsule-" + uuid.NewString()
	}
	capsule.ProjectSessionID = normalizeProjectID(capsule.ProjectSessionID)
	capsule.ChatSessionID = normalizeChatSessionID(capsule.ChatSessionID)
	capsule.RunID = strings.TrimSpace(capsule.RunID)
	if capsule.Kind == "" {
		capsule.Kind = AIContextCapsuleTurn
	}
	if capsule.Status == "" {
		capsule.Status = AIContextCapsuleActive
	}
	if capsule.Trust == "" {
		capsule.Trust = AIContextCapsuleGenerated
	}
	now := utcNow()
	if strings.TrimSpace(capsule.CreatedAt) == "" {
		capsule.CreatedAt = now
	}
	capsule.UpdatedAt = now
	capsule.RetrievalTags = compactStringList(capsule.RetrievalTags)
	capsule.DataCategories = compactStringList(capsule.DataCategories)
	return capsule
}

func sanitizeContextCapsule(capsule AIContextCapsuleSummary) AIContextCapsuleSummary {
	redaction := capsule.Redaction
	originalBytes := capsule.ByteSize
	if originalBytes <= 0 {
		originalBytes = contextCapsuleByteSize(capsule)
	}
	capsule.Summary, redaction = sanitizeText(truncateUTF8(capsule.Summary, contextContinuityMaxSummary), redaction)
	capsule.ContinuationHint, redaction = sanitizeText(truncateUTF8(capsule.ContinuationHint, contextContinuityMaxHint), redaction)
	for i := range capsule.FactsCandidates {
		capsule.FactsCandidates[i].Kind, redaction = sanitizeText(capsule.FactsCandidates[i].Kind, redaction)
		capsule.FactsCandidates[i].Content, redaction = sanitizeText(truncateUTF8(capsule.FactsCandidates[i].Content, 600), redaction)
		capsule.FactsCandidates[i].Source, redaction = sanitizeText(capsule.FactsCandidates[i].Source, redaction)
	}
	for i := range capsule.SourceRefs {
		capsule.SourceRefs[i].Kind, redaction = sanitizeText(capsule.SourceRefs[i].Kind, redaction)
		capsule.SourceRefs[i].Path, redaction = sanitizePath(capsule.SourceRefs[i].Path, redaction)
		capsule.SourceRefs[i].RunID, redaction = sanitizeText(capsule.SourceRefs[i].RunID, redaction)
		capsule.SourceRefs[i].ArtifactID, redaction = sanitizeText(capsule.SourceRefs[i].ArtifactID, redaction)
		capsule.SourceRefs[i].Hash, redaction = sanitizeText(capsule.SourceRefs[i].Hash, redaction)
		capsule.SourceRefs[i].Label, redaction = sanitizeText(capsule.SourceRefs[i].Label, redaction)
		capsule.SourceRefs[i].Reason, redaction = sanitizeText(capsule.SourceRefs[i].Reason, redaction)
	}
	capsule.RetrievalTags = sanitizeStringValues(capsule.RetrievalTags)
	capsule.DataCategories = sanitizeStringValues(capsule.DataCategories)
	capsule.Branch, redaction = sanitizeText(capsule.Branch, redaction)
	capsule.Head, redaction = sanitizeText(capsule.Head, redaction)
	capsule.WorktreeHash, redaction = sanitizeText(capsule.WorktreeHash, redaction)
	capsule.StaleReason, redaction = sanitizeText(capsule.StaleReason, redaction)
	redaction.OriginalBytes = originalBytes
	capsule.ByteSize = contextCapsuleByteSize(capsule)
	redaction.SanitizedBytes = capsule.ByteSize
	capsule.Redaction = redaction
	return capsule
}

func contextCapsuleByteSize(capsule AIContextCapsuleSummary) int {
	total := len(capsule.Summary) + len(capsule.ContinuationHint) + len(capsule.Branch) + len(capsule.Head) + len(capsule.WorktreeHash) + len(capsule.StaleReason)
	for _, fact := range capsule.FactsCandidates {
		total += len(fact.Kind) + len(fact.Content) + len(fact.Source)
	}
	for _, ref := range capsule.SourceRefs {
		total += len(ref.Kind) + len(ref.Path) + len(ref.RunID) + len(ref.ArtifactID) + len(ref.Hash) + len(ref.Label) + len(ref.Reason)
	}
	for _, tag := range capsule.RetrievalTags {
		total += len(tag)
	}
	for _, category := range capsule.DataCategories {
		total += len(category)
	}
	return total
}

func sanitizeStringValues(values []string) []string {
	redaction := AIRedactionSummary{}
	values = compactStringList(values)
	for i := range values {
		values[i], redaction = sanitizeText(values[i], redaction)
	}
	return values
}

func compactStringList(values []string) []string {
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		exists := false
		for _, existing := range result {
			if existing == value {
				exists = true
				break
			}
		}
		if !exists {
			result = append(result, value)
		}
	}
	return result
}

func mustJSON(value any, fallback string) string {
	data, err := json.Marshal(value)
	if err != nil {
		return fallback
	}
	return string(data)
}

func optionalSessionFilter(sessionID string) string {
	if strings.TrimSpace(sessionID) == "" {
		return ""
	}
	return sessionID
}

func currentContextWorktreeFingerprint(projectRoot string) contextWorktreeFingerprint {
	projectRoot = strings.TrimSpace(projectRoot)
	if projectRoot == "" {
		return contextWorktreeFingerprint{}
	}
	branch, branchErr := gitOutput(projectRoot, "branch", "--show-current")
	head, headErr := gitOutput(projectRoot, "rev-parse", "HEAD")
	status, statusErr := gitOutput(projectRoot, "status", "--short")
	if branchErr != nil && headErr != nil && statusErr != nil {
		return contextWorktreeFingerprint{}
	}
	return contextWorktreeFingerprint{
		Branch:       strings.TrimSpace(branch),
		Head:         strings.TrimSpace(head),
		WorktreeHash: shortHash(strings.TrimSpace(status)),
	}
}

func contextCapsuleStaleReason(capsule AIContextCapsuleSummary, fingerprint contextWorktreeFingerprint) string {
	if strings.TrimSpace(capsule.Head) != "" && strings.TrimSpace(fingerprint.Head) != "" && capsule.Head != fingerprint.Head {
		return "git_head_changed"
	}
	if strings.TrimSpace(capsule.Branch) != "" && strings.TrimSpace(fingerprint.Branch) != "" && capsule.Branch != fingerprint.Branch {
		return "git_branch_changed"
	}
	if strings.TrimSpace(capsule.WorktreeHash) != "" && strings.TrimSpace(fingerprint.WorktreeHash) != "" && capsule.WorktreeHash != fingerprint.WorktreeHash {
		return "worktree_changed"
	}
	return ""
}
