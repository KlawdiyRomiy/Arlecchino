package ai

import (
	"fmt"
	"path/filepath"
	"strings"
)

const contextContinuityCompactionMaxTurns = 24

func (s *Service) AIListContextCapsules(projectID string, sessionID string, limit int) ([]AIContextCapsuleSummary, error) {
	project := s.project(projectID)
	if project == nil || project.Continuity == nil {
		return []AIContextCapsuleSummary{}, nil
	}
	return project.Continuity.List(project.ID, normalizeChatSessionID(sessionID), limit)
}

func (s *Service) AIGetContextContinuationPlan(projectID string, sessionID string) (AIContextContinuationPlan, error) {
	project := s.project(projectID)
	if project == nil {
		return AIContextContinuationPlan{}, fmt.Errorf("AI project session is not open")
	}
	sessionID = normalizeChatSessionID(sessionID)
	plan := AIContextContinuationPlan{
		SessionID:    sessionID,
		PolicyReason: "Session-scoped generated continuity only; stale capsules are conversation intent, not facts.",
		CreatedAt:    utcNow(),
	}
	if project.Continuity == nil || project.Mnemonic == nil || !project.Mnemonic.Enabled() {
		plan.PolicyReason = "Mnemonic is disabled, so shared AI memory context is disabled."
		return plan, nil
	}
	capsules, err := project.Continuity.ActiveForSession(project.ID, sessionID, nil, contextContinuityDefaultLimit)
	if err != nil {
		return AIContextContinuationPlan{}, err
	}
	for _, capsule := range capsules {
		if capsule.Status == AIContextCapsuleStale || capsule.StaleReason != "" {
			plan.Stale = append(plan.Stale, capsule)
			continue
		}
		plan.Included = append(plan.Included, capsule)
	}
	return plan, nil
}

func (s *Service) AIRevokeContextCapsule(projectID string, capsuleID string) (AIContextCapsuleSummary, error) {
	project := s.project(projectID)
	if project == nil || project.Continuity == nil {
		return AIContextCapsuleSummary{}, fmt.Errorf("AI project session is not open")
	}
	capsule, err := project.Continuity.Revoke(project.ID, capsuleID)
	if err != nil {
		return AIContextCapsuleSummary{}, err
	}
	s.emitEvent("ai:context:capsule-revoked", capsule)
	return capsule, nil
}

func (s *Service) AICompactChatSession(projectID string, req AIContextCompactionRequest) (AIContextCompactionResult, error) {
	project := s.project(projectID)
	if project == nil || project.Continuity == nil {
		return AIContextCompactionResult{}, fmt.Errorf("AI project session is not open")
	}
	if project.Mnemonic == nil || !project.Mnemonic.Enabled() {
		return AIContextCompactionResult{}, fmt.Errorf("Mnemonic is disabled, so shared AI memory context is disabled")
	}
	if req.ModelAssisted {
		return AIContextCompactionResult{}, fmt.Errorf("model-assisted context compaction is not implemented in V1; deterministic local compaction avoids hidden provider egress")
	}
	sessionID := normalizeChatSessionID(req.SessionID)
	maxTurns := req.MaxTurns
	if maxTurns <= 0 || maxTurns > contextContinuityCompactionMaxTurns {
		maxTurns = contextContinuityCompactionMaxTurns
	}
	capsules, err := project.Continuity.List(project.ID, sessionID, maxTurns*2)
	if err != nil {
		return AIContextCompactionResult{}, err
	}
	turns := make([]AIContextCapsuleSummary, 0, maxTurns)
	for _, capsule := range capsules {
		if capsule.Kind != AIContextCapsuleTurn || capsule.Status != AIContextCapsuleActive {
			continue
		}
		turns = append(turns, capsule)
		if len(turns) >= maxTurns {
			break
		}
	}
	reverseContextCapsules(turns)
	if len(turns) == 0 {
		return AIContextCompactionResult{}, fmt.Errorf("no active turn capsules found for chat session %q", sessionID)
	}
	fingerprint := currentContextWorktreeFingerprint(project.ProjectRoot)
	now := utcNow()
	sourceIDs := contextCapsuleIDs(turns)
	capsule := AIContextCapsuleSummary{
		ProjectSessionID: project.ID,
		ChatSessionID:    sessionID,
		RunID:            strings.TrimSpace(req.RunID),
		Kind:             AIContextCapsuleCompaction,
		Status:           AIContextCapsuleActive,
		Trust:            AIContextCapsuleGenerated,
		Summary:          deterministicCompactionSummary(turns, req.Reason),
		ContinuationHint: deterministicCompactionHint(turns),
		SourceRefs:       compactionSourceRefs(turns),
		RetrievalTags:    append([]string{"compaction", "continuity"}, compactionRetrievalTags(turns)...),
		DataCategories:   []string{"context_continuity"},
		Branch:           fingerprint.Branch,
		Head:             fingerprint.Head,
		WorktreeHash:     fingerprint.WorktreeHash,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	capsule, err = project.Continuity.Upsert(capsule)
	if err != nil {
		return AIContextCompactionResult{}, err
	}
	for _, sourceID := range sourceIDs {
		_ = project.Continuity.Link(capsule.ID, sourceID, "compacts")
	}
	if err := project.Continuity.Supersede(project.ID, sourceIDs); err != nil {
		return AIContextCompactionResult{}, err
	}
	result := AIContextCompactionResult{
		Capsule:             capsule,
		CompactedCapsuleIDs: sourceIDs,
		PolicyReason:        "Deterministic local compaction; generated continuity is not trusted Mnemonic.",
		CreatedAt:           utcNow(),
	}
	if strings.TrimSpace(req.RunID) != "" {
		s.recordChatRunArtifact(project, req.RunID, AIChatRunArtifactContextCompaction, "Context compaction", result.PolicyReason, result)
	}
	s.emitEvent("ai:context:compacted", result)
	return result, nil
}

func (s *Service) recordTurnContextCapsule(project *ProjectSession, runID string, req AIChatRunRequest, summary AIContextSummary, response string) {
	if project == nil || project.Continuity == nil || project.Mnemonic == nil || !project.Mnemonic.Enabled() {
		return
	}
	sessionID := normalizeChatSessionID(req.SessionID)
	fingerprint := currentContextWorktreeFingerprint(project.ProjectRoot)
	capsule := AIContextCapsuleSummary{
		ProjectSessionID: project.ID,
		ChatSessionID:    sessionID,
		RunID:            runID,
		Kind:             AIContextCapsuleTurn,
		Status:           AIContextCapsuleActive,
		Trust:            AIContextCapsuleGenerated,
		Summary:          summarizeForMnemonic(req.Prompt, response),
		ContinuationHint: "Resume short follow-ups against this run only when the current session, branch, and files still match.",
		SourceRefs: []AIContextCapsuleSourceRef{
			{Kind: "chat_run", RunID: runID, Label: chatActionLabel(req.Action)},
		},
		RetrievalTags:  turnRetrievalTags(req, summary),
		DataCategories: append([]string{"context_continuity"}, summary.DataCategories...),
		Branch:         fingerprint.Branch,
		Head:           fingerprint.Head,
		WorktreeHash:   fingerprint.WorktreeHash,
		CreatedAt:      utcNow(),
		UpdatedAt:      utcNow(),
	}
	if strings.TrimSpace(summary.FilePath) != "" {
		capsule.SourceRefs = append(capsule.SourceRefs, AIContextCapsuleSourceRef{Kind: "file", Path: summary.FilePath, Label: filepath.Base(summary.FilePath)})
	}
	_, _ = project.Continuity.Upsert(capsule)
}

func reverseContextCapsules(capsules []AIContextCapsuleSummary) {
	for i, j := 0, len(capsules)-1; i < j; i, j = i+1, j-1 {
		capsules[i], capsules[j] = capsules[j], capsules[i]
	}
}

func deterministicCompactionSummary(turns []AIContextCapsuleSummary, reason string) string {
	lines := []string{}
	if strings.TrimSpace(reason) != "" {
		lines = append(lines, "Reason: "+sanitizedDisplayText(reason))
	}
	lines = append(lines, "Compacted session continuity:")
	for _, turn := range turns {
		lines = append(lines, "- "+truncateUTF8(strings.TrimSpace(turn.Summary), 500))
	}
	return truncateUTF8(strings.Join(lines, "\n"), contextContinuityMaxSummary)
}

func deterministicCompactionHint(turns []AIContextCapsuleSummary) string {
	if len(turns) == 0 {
		return ""
	}
	last := turns[len(turns)-1]
	return truncateUTF8(firstNonEmpty(last.ContinuationHint, last.Summary), contextContinuityMaxHint)
}

func compactionSourceRefs(turns []AIContextCapsuleSummary) []AIContextCapsuleSourceRef {
	refs := []AIContextCapsuleSourceRef{}
	seen := map[string]struct{}{}
	for _, turn := range turns {
		if strings.TrimSpace(turn.RunID) != "" {
			key := "run:" + turn.RunID
			if _, ok := seen[key]; !ok {
				seen[key] = struct{}{}
				refs = append(refs, AIContextCapsuleSourceRef{Kind: "chat_run", RunID: turn.RunID, Label: "compacted turn"})
			}
		}
		for _, ref := range turn.SourceRefs {
			key := ref.Kind + ":" + ref.Path + ":" + ref.RunID + ":" + ref.ArtifactID
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			refs = append(refs, ref)
		}
	}
	return refs
}

func compactionRetrievalTags(turns []AIContextCapsuleSummary) []string {
	tags := []string{}
	for _, turn := range turns {
		tags = append(tags, turn.RetrievalTags...)
	}
	return compactStringList(tags)
}

func turnRetrievalTags(req AIChatRunRequest, summary AIContextSummary) []string {
	tags := []string{string(req.Action)}
	if summary.FilePath != "" {
		tags = append(tags, filepath.Base(summary.FilePath))
	}
	for _, category := range summary.DataCategories {
		tags = append(tags, category)
	}
	return compactStringList(tags)
}
