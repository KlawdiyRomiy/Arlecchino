package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

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

type contextCapsuleSelectionRequest struct {
	ProjectSessionID string
	SessionID        string
	Prompt           string
	FilePath         string
	ExplicitIDs      []string
	QueryTags        []string
	Limit            int
	AllowStale       bool
}

type contextCapsuleSelection struct {
	Capsules           []AIContextCapsuleSummary
	PolicyReason       string
	StaleFiltered      int
	ExpiredFiltered    int
	SupersededFiltered int
	FTSMatches         int
	FTSDegraded        bool
	BudgetDropped      int
}

type contextCapsuleExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type contextCapsuleQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type contextCompactionMutation struct {
	Capsule   AIContextCapsuleSummary
	SourceIDs []string
	Reused    bool
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

	s.mu.Lock()
	defer s.mu.Unlock()
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AIContextCapsuleSummary{}, err
	}
	if err := execUpsertContextCapsule(ctx, tx, capsule); err != nil {
		_ = tx.Rollback()
		return AIContextCapsuleSummary{}, err
	}
	if err := writeContextCapsuleFTS(ctx, tx, capsule); err != nil {
		_ = tx.Rollback()
		return AIContextCapsuleSummary{}, err
	}
	if err := tx.Commit(); err != nil {
		return AIContextCapsuleSummary{}, err
	}
	return capsule, nil
}

func execUpsertContextCapsule(ctx context.Context, exec contextCapsuleExecutor, capsule AIContextCapsuleSummary) error {
	factsJSON := mustJSON(capsule.FactsCandidates, "[]")
	refsJSON := mustJSON(capsule.SourceRefs, "[]")
	tagsJSON := mustJSON(capsule.RetrievalTags, "[]")
	redactionJSON := mustJSON(capsule.Redaction, "{}")
	categoriesJSON := mustJSON(capsule.DataCategories, "[]")
	_, err := exec.ExecContext(ctx, `INSERT INTO ai_context_capsules(
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
	return err
}

func writeContextCapsuleFTS(ctx context.Context, exec contextCapsuleExecutor, capsule AIContextCapsuleSummary) error {
	if _, err := exec.ExecContext(ctx, `DELETE FROM ai_context_capsules_fts WHERE id = ?`, capsule.ID); err != nil {
		return err
	}
	if capsule.Status != AIContextCapsuleActive {
		return nil
	}
	factsJSON := mustJSON(capsule.FactsCandidates, "[]")
	tagsJSON := mustJSON(capsule.RetrievalTags, "[]")
	_, err := exec.ExecContext(ctx, `INSERT INTO ai_context_capsules_fts(id, summary, facts, retrieval_tags) VALUES(?, ?, ?, ?)`, capsule.ID, capsule.Summary, factsJSON, tagsJSON)
	return err
}

func deleteContextCapsuleFTS(ctx context.Context, exec contextCapsuleExecutor, capsuleID string) error {
	_, err := exec.ExecContext(ctx, `DELETE FROM ai_context_capsules_fts WHERE id = ?`, capsuleID)
	return err
}

func expireContextCapsules(ctx context.Context, exec contextCapsuleExecutor, projectSessionID string, sessionID string) error {
	now := utcNow()
	if _, err := exec.ExecContext(ctx, `UPDATE ai_context_capsules
		SET status = ?, updated_at = ?
		WHERE project_session_id = ?
			AND (? = '' OR chat_session_id = ?)
			AND status = ?
			AND expires_at IS NOT NULL
			AND expires_at != ''
			AND expires_at <= ?`,
		AIContextCapsuleExpired, now, projectSessionID, optionalSessionFilter(sessionID), sessionID, AIContextCapsuleActive, now); err != nil {
		return err
	}
	_, err := exec.ExecContext(ctx, `DELETE FROM ai_context_capsules_fts
		WHERE id IN (
			SELECT id FROM ai_context_capsules
			WHERE project_session_id = ?
				AND (? = '' OR chat_session_id = ?)
				AND status = ?
		)`, projectSessionID, optionalSessionFilter(sessionID), sessionID, AIContextCapsuleExpired)
	if contextFTSUnavailableError(err) {
		return nil
	}
	return err
}

func downgradeStaleContextCapsules(ctx context.Context, exec contextCapsuleExecutor, projectSessionID string, sessionID string, fingerprint contextWorktreeFingerprint) error {
	now := utcNow()
	updates := []struct {
		value  string
		reason string
		column string
	}{
		{value: strings.TrimSpace(fingerprint.Head), reason: "git_head_changed", column: "head"},
		{value: strings.TrimSpace(fingerprint.Branch), reason: "git_branch_changed", column: "branch"},
		{value: strings.TrimSpace(fingerprint.WorktreeHash), reason: "worktree_changed", column: "worktree_hash"},
	}
	for _, update := range updates {
		if update.value == "" {
			continue
		}
		stmt := fmt.Sprintf(`UPDATE ai_context_capsules
			SET status = ?, stale_reason = ?, updated_at = ?
			WHERE project_session_id = ?
				AND (? = '' OR chat_session_id = ?)
				AND status = ?
				AND %s IS NOT NULL
				AND %s != ''
				AND %s != ?`, update.column, update.column, update.column)
		if _, err := exec.ExecContext(ctx, stmt,
			AIContextCapsuleStale, update.reason, now, projectSessionID, optionalSessionFilter(sessionID), sessionID, AIContextCapsuleActive, update.value); err != nil {
			return err
		}
	}
	_, err := exec.ExecContext(ctx, `DELETE FROM ai_context_capsules_fts
		WHERE id IN (
			SELECT id FROM ai_context_capsules
			WHERE project_session_id = ?
				AND (? = '' OR chat_session_id = ?)
				AND status = ?
		)`, projectSessionID, optionalSessionFilter(sessionID), sessionID, AIContextCapsuleStale)
	if contextFTSUnavailableError(err) {
		return nil
	}
	return err
}

func contextFTSUnavailableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such table: ai_context_capsules_fts") || strings.Contains(msg, "no such module: fts5")
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
	if err := expireContextCapsules(context.Background(), s.db, projectSessionID, sessionID); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
		facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
		data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
		FROM ai_context_capsules
		WHERE project_session_id = ? AND (? = '' OR chat_session_id = ?) AND status != ?
		ORDER BY created_at DESC
		LIMIT ?`, projectSessionID, optionalSessionFilter(sessionID), sessionID, AIContextCapsuleRevoked, limit)
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

func (s *ContextContinuityStore) ActiveForSession(projectSessionID string, sessionID string, explicitIDs []string, limit int) ([]AIContextCapsuleSummary, error) {
	selection, err := s.SelectForSession(contextCapsuleSelectionRequest{
		ProjectSessionID: projectSessionID,
		SessionID:        sessionID,
		ExplicitIDs:      explicitIDs,
		Limit:            limit,
	})
	if err != nil {
		return nil, err
	}
	return selection.Capsules, nil
}

func (s *ContextContinuityStore) SelectForSession(req contextCapsuleSelectionRequest) (contextCapsuleSelection, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return contextCapsuleSelection{}, nil
	}
	if req.Limit <= 0 {
		req.Limit = contextContinuityDefaultLimit
	}
	req.ProjectSessionID = normalizeProjectID(req.ProjectSessionID)
	req.SessionID = normalizeChatSessionID(req.SessionID)
	req.ExplicitIDs = compactStringList(req.ExplicitIDs)
	req.QueryTags = compactStringList(req.QueryTags)
	selected := []AIContextCapsuleSummary{}
	seen := map[string]struct{}{}
	selection := contextCapsuleSelection{}

	if len(req.ExplicitIDs) > 0 {
		explicit, err := s.capsulesByID(req.ProjectSessionID, req.SessionID, req.ExplicitIDs, len(req.ExplicitIDs))
		if err != nil {
			return contextCapsuleSelection{}, err
		}
		explicit = s.filterPromptEligibleCapsules(explicit, req.AllowStale, &selection)
		for _, capsule := range explicit {
			if len(selected) >= req.Limit {
				selection.BudgetDropped++
				break
			}
			selected = append(selected, capsule)
			seen[capsule.ID] = struct{}{}
		}
	}

	candidates, err := s.promptCandidateCapsules(req.ProjectSessionID, req.SessionID, 128)
	if err != nil {
		return contextCapsuleSelection{}, err
	}
	candidates = s.filterPromptEligibleCapsules(candidates, req.AllowStale, &selection)
	ftsMatches, ftsDegraded := s.contextCapsuleFTSMatches(req.ProjectSessionID, req.SessionID, contextCapsuleFTSQuery(req), 64)
	selection.FTSMatches = len(ftsMatches)
	selection.FTSDegraded = ftsDegraded

	if len(selected) < req.Limit {
		if compaction, ok := latestIncludedCompactionCapsule(candidates); ok {
			if _, exists := seen[compaction.ID]; !exists {
				selected = append(selected, compaction)
				seen[compaction.ID] = struct{}{}
			}
		}
	}

	ranked := make([]AIContextCapsuleSummary, 0, len(candidates))
	for _, capsule := range candidates {
		if _, exists := seen[capsule.ID]; exists {
			continue
		}
		if capsule.Kind == AIContextCapsuleCompaction {
			continue
		}
		ranked = append(ranked, capsule)
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		leftScore := contextCapsuleScore(ranked[i], req, ftsMatches)
		rightScore := contextCapsuleScore(ranked[j], req, ftsMatches)
		if leftScore != rightScore {
			return leftScore > rightScore
		}
		return contextCapsuleCreatedAt(ranked[i]).After(contextCapsuleCreatedAt(ranked[j]))
	})
	for _, capsule := range ranked {
		if len(selected) >= req.Limit {
			selection.BudgetDropped++
			continue
		}
		selected = append(selected, capsule)
		seen[capsule.ID] = struct{}{}
	}

	selection.Capsules = selected
	selection.PolicyReason = fmt.Sprintf(
		"includeContinuity=true; selected=%d staleFiltered=%d expiredFiltered=%d supersededFiltered=%d budgetDropped=%d ftsMatches=%d ftsDegraded=%t scoring=file_exact,suffix,basename,fts,tags,recency",
		len(selection.Capsules),
		selection.StaleFiltered,
		selection.ExpiredFiltered,
		selection.SupersededFiltered,
		selection.BudgetDropped,
		selection.FTSMatches,
		selection.FTSDegraded,
	)
	return selection, nil
}

func (s *ContextContinuityStore) ActiveTurnCapsules(projectSessionID string, sessionID string, limit int) ([]AIContextCapsuleSummary, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return []AIContextCapsuleSummary{}, nil
	}
	if limit <= 0 {
		limit = contextContinuityCompactionMaxTurns
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	sessionID = normalizeChatSessionID(sessionID)
	s.mu.Lock()
	if err := expireContextCapsules(context.Background(), s.db, projectSessionID, sessionID); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
		facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
		data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
		FROM ai_context_capsules
		WHERE project_session_id = ? AND chat_session_id = ? AND kind = ? AND status = ?
		ORDER BY created_at DESC
		LIMIT ?`, projectSessionID, sessionID, AIContextCapsuleTurn, AIContextCapsuleActive, limit)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	turns, scanErr := scanContextCapsules(rows)
	rows.Close()
	s.mu.Unlock()
	if scanErr != nil {
		return nil, scanErr
	}
	selection := contextCapsuleSelection{}
	return s.filterPromptEligibleCapsules(s.downgradeStaleCapsules(turns), false, &selection), nil
}

func (s *ContextContinuityStore) CompactSession(projectSessionID string, sessionID string, runID string, reason string, maxTurns int, fingerprint contextWorktreeFingerprint) (contextCompactionMutation, error) {
	if s == nil || s.db == nil || s.mu == nil {
		return contextCompactionMutation{}, fmt.Errorf("context continuity store is not open")
	}
	if maxTurns <= 0 {
		maxTurns = contextContinuityCompactionMaxTurns
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	sessionID = normalizeChatSessionID(sessionID)
	runID = strings.TrimSpace(runID)

	ctx := context.Background()
	s.mu.Lock()
	defer s.mu.Unlock()

	conn, err := s.db.Conn(ctx)
	if err != nil {
		return contextCompactionMutation{}, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return contextCompactionMutation{}, err
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(ctx, `ROLLBACK`)
		}
	}()

	if err := expireContextCapsules(ctx, conn, projectSessionID, sessionID); err != nil {
		return contextCompactionMutation{}, err
	}
	if err := downgradeStaleContextCapsules(ctx, conn, projectSessionID, sessionID, fingerprint); err != nil {
		return contextCompactionMutation{}, err
	}

	previous, hasPrevious, err := queryLatestActiveCompaction(ctx, conn, projectSessionID, sessionID)
	if err != nil {
		return contextCompactionMutation{}, err
	}
	turns, err := queryActiveTurnCapsules(ctx, conn, projectSessionID, sessionID, maxTurns)
	if err != nil {
		return contextCompactionMutation{}, err
	}
	reverseContextCapsules(turns)
	if len(turns) == 0 {
		if hasPrevious {
			if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
				return contextCompactionMutation{}, err
			}
			committed = true
			return contextCompactionMutation{Capsule: previous, Reused: true}, nil
		}
		return contextCompactionMutation{}, fmt.Errorf("no active turn capsules found for chat session %q", sessionID)
	}

	sources := make([]AIContextCapsuleSummary, 0, len(turns)+1)
	if hasPrevious {
		sources = append(sources, previous)
		if _, err := conn.ExecContext(ctx, `UPDATE ai_context_capsules
			SET status = ?, updated_at = ?
			WHERE id = ? AND project_session_id = ? AND status = ?`,
			AIContextCapsuleSuperseded, utcNow(), previous.ID, projectSessionID, AIContextCapsuleActive); err != nil {
			return contextCompactionMutation{}, err
		}
		if err := deleteContextCapsuleFTS(ctx, conn, previous.ID); err != nil {
			return contextCompactionMutation{}, err
		}
	}
	sources = append(sources, turns...)
	sourceIDs := contextCapsuleIDs(sources)
	now := utcNow()
	capsule := AIContextCapsuleSummary{
		ProjectSessionID: projectSessionID,
		ChatSessionID:    sessionID,
		RunID:            runID,
		Kind:             AIContextCapsuleCompaction,
		Status:           AIContextCapsuleActive,
		Trust:            AIContextCapsuleGenerated,
		Summary:          deterministicCompactionSummary(sources, reason),
		FactsCandidates:  compactionFactsCandidates(sources),
		ContinuationHint: deterministicCompactionHint(sources),
		SourceRefs:       compactionSourceRefs(sources),
		RetrievalTags:    append([]string{"compaction", "continuity"}, compactionRetrievalTags(sources)...),
		DataCategories:   []string{"context_continuity"},
		Branch:           fingerprint.Branch,
		Head:             fingerprint.Head,
		WorktreeHash:     fingerprint.WorktreeHash,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	capsule = normalizeContextCapsule(capsule)
	capsule = sanitizeContextCapsule(capsule)
	if err := execUpsertContextCapsule(ctx, conn, capsule); err != nil {
		return contextCompactionMutation{}, err
	}
	if err := writeContextCapsuleFTS(ctx, conn, capsule); err != nil {
		return contextCompactionMutation{}, err
	}
	for _, sourceID := range sourceIDs {
		if _, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO ai_context_capsule_links(id, from_capsule_id, to_capsule_id, link_type, created_at) VALUES(?, ?, ?, ?, ?)`,
			"link-"+shortHash(capsule.ID+":"+sourceID+":compacts"), capsule.ID, sourceID, "compacts", utcNow()); err != nil {
			return contextCompactionMutation{}, err
		}
		if sourceID == previous.ID {
			continue
		}
		if _, err := conn.ExecContext(ctx, `UPDATE ai_context_capsules
			SET status = ?, updated_at = ?
			WHERE id = ? AND project_session_id = ? AND status = ?`,
			AIContextCapsuleSuperseded, utcNow(), sourceID, projectSessionID, AIContextCapsuleActive); err != nil {
			return contextCompactionMutation{}, err
		}
		if err := deleteContextCapsuleFTS(ctx, conn, sourceID); err != nil {
			return contextCompactionMutation{}, err
		}
	}
	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return contextCompactionMutation{}, err
	}
	committed = true
	return contextCompactionMutation{Capsule: capsule, SourceIDs: sourceIDs}, nil
}

func queryLatestActiveCompaction(ctx context.Context, queryer contextCapsuleQueryer, projectSessionID string, sessionID string) (AIContextCapsuleSummary, bool, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
		facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
		data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
		FROM ai_context_capsules
		WHERE project_session_id = ? AND chat_session_id = ? AND kind = ? AND status = ?
		ORDER BY created_at DESC, updated_at DESC, id DESC
		LIMIT 1`, projectSessionID, sessionID, AIContextCapsuleCompaction, AIContextCapsuleActive)
	if err != nil {
		return AIContextCapsuleSummary{}, false, err
	}
	defer rows.Close()
	capsules, err := scanContextCapsules(rows)
	if err != nil {
		return AIContextCapsuleSummary{}, false, err
	}
	if len(capsules) == 0 {
		return AIContextCapsuleSummary{}, false, nil
	}
	return capsules[0], true, nil
}

func queryActiveTurnCapsules(ctx context.Context, queryer contextCapsuleQueryer, projectSessionID string, sessionID string, limit int) ([]AIContextCapsuleSummary, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
		facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
		data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
		FROM ai_context_capsules
		WHERE project_session_id = ? AND chat_session_id = ? AND kind = ? AND status = ?
		ORDER BY created_at DESC, updated_at DESC, id DESC
		LIMIT ?`, projectSessionID, sessionID, AIContextCapsuleTurn, AIContextCapsuleActive, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanContextCapsules(rows)
}

func (s *ContextContinuityStore) promptCandidateCapsules(projectSessionID string, sessionID string, limit int) ([]AIContextCapsuleSummary, error) {
	if limit <= 0 {
		limit = 128
	}
	s.mu.Lock()
	if err := expireContextCapsules(context.Background(), s.db, projectSessionID, sessionID); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
		facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
		data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
		FROM ai_context_capsules
		WHERE project_session_id = ? AND chat_session_id = ? AND status IN (?, ?, ?)
		ORDER BY created_at DESC
		LIMIT ?`, projectSessionID, sessionID, AIContextCapsuleActive, AIContextCapsuleStale, AIContextCapsuleSuperseded, limit)
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

func (s *ContextContinuityStore) filterPromptEligibleCapsules(capsules []AIContextCapsuleSummary, allowStale bool, selection *contextCapsuleSelection) []AIContextCapsuleSummary {
	filtered := make([]AIContextCapsuleSummary, 0, len(capsules))
	for _, capsule := range capsules {
		switch capsule.Status {
		case AIContextCapsuleActive:
			filtered = append(filtered, capsule)
		case AIContextCapsuleStale:
			if allowStale {
				filtered = append(filtered, capsule)
			} else if selection != nil {
				selection.StaleFiltered++
			}
		case AIContextCapsuleSuperseded:
			if selection != nil {
				selection.SupersededFiltered++
			}
		case AIContextCapsuleExpired:
			if selection != nil {
				selection.ExpiredFiltered++
			}
		}
	}
	return filtered
}

func (s *ContextContinuityStore) contextCapsuleFTSMatches(projectSessionID string, sessionID string, query string, limit int) (map[string]struct{}, bool) {
	matches := map[string]struct{}{}
	query = strings.TrimSpace(query)
	if s == nil || s.db == nil || s.mu == nil || query == "" {
		return matches, false
	}
	if limit <= 0 {
		limit = 64
	}
	s.mu.Lock()
	rows, err := s.db.Query(`SELECT c.id
		FROM ai_context_capsules_fts
		JOIN ai_context_capsules c ON c.id = ai_context_capsules_fts.id
		WHERE ai_context_capsules_fts MATCH ?
			AND c.project_session_id = ?
			AND c.chat_session_id = ?
			AND c.status = ?
			AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at > ?)
		LIMIT ?`, query, projectSessionID, sessionID, AIContextCapsuleActive, utcNow(), limit)
	if err != nil {
		s.mu.Unlock()
		return matches, true
	}
	for rows.Next() {
		var id string
		if scanErr := rows.Scan(&id); scanErr == nil && strings.TrimSpace(id) != "" {
			matches[id] = struct{}{}
		}
	}
	degraded := rows.Err() != nil
	rows.Close()
	s.mu.Unlock()
	return matches, degraded
}

func contextCapsuleScore(capsule AIContextCapsuleSummary, req contextCapsuleSelectionRequest, ftsMatches map[string]struct{}) int {
	score := 0
	if _, ok := ftsMatches[capsule.ID]; ok {
		score += 400
	}
	score += contextCapsuleFileScore(capsule, req.FilePath)
	query := strings.ToLower(strings.TrimSpace(req.Prompt))
	if query != "" {
		text := strings.ToLower(capsule.Summary + " " + capsule.ContinuationHint + " " + strings.Join(capsule.RetrievalTags, " "))
		for _, term := range contextCapsuleSearchTerms(query) {
			if strings.Contains(text, strings.ToLower(term)) {
				score += 35
			}
		}
	}
	tagSet := map[string]struct{}{}
	for _, tag := range req.QueryTags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag != "" {
			tagSet[tag] = struct{}{}
		}
	}
	for _, tag := range capsule.RetrievalTags {
		if _, ok := tagSet[strings.ToLower(strings.TrimSpace(tag))]; ok {
			score += 180
		}
	}
	switch capsule.Kind {
	case AIContextCapsuleHandoff:
		score += 90
	case AIContextCapsuleIDEState:
		score += 50
	case AIContextCapsuleTurn:
		score += 25
	}
	return score
}

func contextCapsuleFileScore(capsule AIContextCapsuleSummary, filePath string) int {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return 0
	}
	filePath = strings.Trim(strings.ReplaceAll(filePath, "\\", "/"), "/")
	fileBase := strings.TrimSpace(filepathBase(filePath))
	best := 0
	for _, ref := range capsule.SourceRefs {
		refPath := strings.Trim(strings.ReplaceAll(strings.TrimSpace(ref.Path), "\\", "/"), "/")
		if refPath == "" {
			continue
		}
		switch {
		case refPath == filePath:
			best = maxContextCapsuleScore(best, 900)
		case strings.HasSuffix(refPath, "/"+filePath) || strings.HasSuffix(filePath, "/"+refPath):
			best = maxContextCapsuleScore(best, 700)
		case fileBase != "" && filepathBase(refPath) == fileBase:
			best = maxContextCapsuleScore(best, 300)
		}
	}
	for _, tag := range capsule.RetrievalTags {
		tag = strings.Trim(strings.ReplaceAll(strings.TrimSpace(tag), "\\", "/"), "/")
		switch {
		case strings.EqualFold(tag, filePath):
			best = maxContextCapsuleScore(best, 450)
		case fileBase != "" && strings.EqualFold(tag, fileBase):
			best = maxContextCapsuleScore(best, 220)
		}
	}
	return best
}

func maxContextCapsuleScore(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func contextCapsuleCreatedAt(capsule AIContextCapsuleSummary) time.Time {
	createdAt, err := time.Parse(time.RFC3339, strings.TrimSpace(capsule.CreatedAt))
	if err != nil {
		return time.Time{}
	}
	return createdAt
}

func contextCapsuleFTSQuery(req contextCapsuleSelectionRequest) string {
	terms := contextCapsuleSearchTerms(req.Prompt + " " + req.FilePath + " " + strings.Join(req.QueryTags, " "))
	if len(terms) == 0 {
		return ""
	}
	phrases := make([]string, 0, len(terms))
	for _, term := range terms {
		term = strings.ReplaceAll(term, `"`, `""`)
		phrases = append(phrases, `"`+term+`"`)
	}
	return strings.Join(phrases, " OR ")
}

func contextCapsuleSearchTerms(text string) []string {
	text = strings.ToLower(strings.TrimSpace(text))
	if text == "" {
		return nil
	}
	seen := map[string]struct{}{}
	terms := []string{}
	for _, raw := range strings.FieldsFunc(text, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' || r == '.')
	}) {
		term := strings.Trim(raw, "._-")
		if len([]rune(term)) < 3 {
			continue
		}
		if _, ok := seen[term]; ok {
			continue
		}
		seen[term] = struct{}{}
		terms = append(terms, term)
		if len(terms) >= 8 {
			break
		}
	}
	return terms
}

func filepathBase(path string) string {
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	if path == "" {
		return ""
	}
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		return path[idx+1:]
	}
	return path
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

func (s *ContextContinuityStore) CapsulesStillPromptEligible(projectSessionID string, sessionID string, ids []string) error {
	if s == nil || s.db == nil || s.mu == nil || len(ids) == 0 {
		return nil
	}
	projectSessionID = normalizeProjectID(projectSessionID)
	sessionID = normalizeChatSessionID(sessionID)
	ids = compactStringList(ids)
	s.mu.Lock()
	if err := expireContextCapsules(context.Background(), s.db, projectSessionID, sessionID); err != nil {
		s.mu.Unlock()
		return err
	}
	capsules := make([]AIContextCapsuleSummary, 0, len(ids))
	for _, id := range ids {
		row := s.db.QueryRow(`SELECT id, project_session_id, chat_session_id, run_id, kind, status, trust, summary,
			facts_candidates_json, source_refs_json, retrieval_tags_json, continuation_hint, redaction_json,
			data_categories_json, branch, head, worktree_hash, stale_reason, byte_size, created_at, updated_at, expires_at
			FROM ai_context_capsules
			WHERE id = ? AND project_session_id = ? AND chat_session_id = ?`,
			id, projectSessionID, sessionID)
		capsule, err := scanContextCapsule(row)
		if err == sql.ErrNoRows {
			s.mu.Unlock()
			return fmt.Errorf("context capsule %q is no longer available", id)
		}
		if err != nil {
			s.mu.Unlock()
			return err
		}
		capsules = append(capsules, capsule)
	}
	s.mu.Unlock()
	capsules = s.downgradeStaleCapsules(capsules)
	for _, capsule := range capsules {
		if capsule.Status != AIContextCapsuleActive {
			return fmt.Errorf("context capsule %q became %s before egress", capsule.ID, capsule.Status)
		}
	}
	return nil
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
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		s.mu.Unlock()
		return AIContextCapsuleSummary{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE ai_context_capsules SET status = ?, updated_at = ? WHERE id = ? AND project_session_id = ?`,
		AIContextCapsuleRevoked, now, capsuleID, projectSessionID)
	if err == nil {
		err = deleteContextCapsuleFTS(ctx, tx, capsuleID)
	}
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
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
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, id := range compactStringList(capsuleIDs) {
		if _, err := tx.ExecContext(ctx, `UPDATE ai_context_capsules SET status = ?, updated_at = ? WHERE id = ? AND project_session_id = ? AND status = ?`,
			AIContextCapsuleSuperseded, now, id, projectSessionID, AIContextCapsuleActive); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := deleteContextCapsuleFTS(ctx, tx, id); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
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
	redaction := AIRedactionSummary{}
	event.QueryText, redaction = sanitizeText(event.QueryText, redaction)
	event.QueryText = truncateUTF8(event.QueryText, 500)
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
	if err := expireContextCapsules(context.Background(), s.db, projectSessionID, sessionID); err != nil {
		s.mu.Unlock()
		return nil, err
	}
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
	if len(capsules) == 0 {
		return capsules
	}
	fingerprint := currentContextWorktreeFingerprint(s.projectRoot)
	if fingerprint.Branch == "" && fingerprint.Head == "" && fingerprint.WorktreeHash == "" {
		return capsules
	}
	now := utcNow()
	for i := range capsules {
		if capsules[i].Status != AIContextCapsuleActive {
			continue
		}
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
