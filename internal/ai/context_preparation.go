package ai

import (
	"fmt"
	"strings"
	"sync"

	"arlecchino/internal/ai/providers"
)

const (
	contextAutoCompactActiveTurnsThreshold = 8
)

type preparedChatContext struct {
	Snapshot AIContextSnapshot
}

func (s *Service) prepareChatContextForRun(project *ProjectSession, runID string, req AIChatRunRequest) (preparedChatContext, error) {
	snapshot := s.buildContextSnapshot(project, req.Context)
	prepared := preparedChatContext{Snapshot: snapshot}
	if !req.Context.IncludeContinuity || project == nil || project.Continuity == nil || project.Mnemonic == nil || !project.Mnemonic.Enabled() {
		return prepared, contextBudgetOverflowError(snapshot.Budget)
	}

	sessionID := normalizeChatSessionID(req.SessionID)
	activeTurns, activeTurnErr := project.Continuity.ActiveTurnCapsules(project.ID, sessionID, contextAutoCompactActiveTurnsThreshold)
	hardOverflow := contextBudgetHardOverflow(snapshot.Budget)
	shouldCompact := hardOverflow || snapshot.Budget.AutoCompactRecommended || len(activeTurns) >= contextAutoCompactActiveTurnsThreshold
	if activeTurnErr != nil {
		if hardOverflow {
			return prepared, fmt.Errorf("context exceeds model window and active turn scan failed: %w", activeTurnErr)
		}
		s.recordContextCompactionTimeline(project, runID, req, "degraded", "Context compaction skipped: active turn scan failed.")
		return prepared, nil
	}
	if !shouldCompact {
		return prepared, nil
	}
	if len(activeTurns) == 0 {
		if hardOverflow {
			return prepared, contextBudgetOverflowError(snapshot.Budget)
		}
		return prepared, nil
	}

	reason := "auto:maintenance"
	if hardOverflow {
		reason = "auto:overflow"
	} else if snapshot.Budget.AutoCompactRecommended {
		reason = "auto:budget"
	}
	_, compactErr := s.AICompactChatSession(project.ID, AIContextCompactionRequest{
		SessionID: sessionID,
		RunID:     runID,
		Reason:    reason,
		MaxTurns:  contextContinuityCompactionMaxTurns,
	})
	if compactErr != nil {
		status := "degraded"
		if hardOverflow {
			status = "blocked"
		}
		s.recordContextCompactionTimeline(project, runID, req, status, "Context compaction failed: "+compactErr.Error())
		if hardOverflow {
			return prepared, fmt.Errorf("context exceeds model window and compaction failed: %w", compactErr)
		}
		return prepared, nil
	}

	s.recordContextCompactionTimeline(project, runID, req, "compacted", "Context compacted before provider request.")
	rebuilt := s.buildContextSnapshot(project, req.Context)
	prepared.Snapshot = rebuilt
	if err := contextBudgetOverflowError(rebuilt.Budget); err != nil {
		return prepared, err
	}
	return prepared, nil
}

func (s *Service) recordContextCompactionTimeline(project *ProjectSession, runID string, req AIChatRunRequest, status string, summary string) {
	if project == nil || runID == "" {
		return
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Source:           "context",
		Type:             "context_compaction",
		Status:           strings.TrimSpace(status),
		Actor:            "system",
		Capability:       providers.CapabilityChat,
		Summary:          sanitizedDisplayText(summary),
	})
}

func contextBudgetHardOverflow(budget AIContextBudget) bool {
	return budget.ContextWindow > 0 && budget.InputTokens > budget.ContextWindow
}

func contextBudgetOverflowError(budget AIContextBudget) error {
	if !contextBudgetHardOverflow(budget) {
		return nil
	}
	return fmt.Errorf("context exceeds model window: estimated %d input tokens for a %d token window", budget.InputTokens, budget.ContextWindow)
}

func (s *Service) revalidatePreparedContinuity(project *ProjectSession, snapshot AIContextSnapshot) error {
	if project == nil || project.Continuity == nil || len(snapshot.Continuity) == 0 {
		return nil
	}
	if project.Mnemonic == nil || !project.Mnemonic.Enabled() {
		return fmt.Errorf("context continuity became unavailable before egress")
	}
	if err := project.Continuity.CapsulesStillPromptEligible(project.ID, snapshot.SessionID, contextCapsuleIDs(snapshot.Continuity)); err != nil {
		return fmt.Errorf("selected context continuity changed before egress: %w", err)
	}
	return nil
}

func (s *Service) withContextCompactionLock(projectID string, sessionID string, fn func() (AIContextCompactionResult, error)) (AIContextCompactionResult, error) {
	lock := s.contextCompactionLock(projectID, sessionID)
	lock.Lock()
	defer lock.Unlock()
	return fn()
}

func (s *Service) contextCompactionLock(projectID string, sessionID string) *sync.Mutex {
	key := normalizeProjectID(projectID) + ":" + normalizeChatSessionID(sessionID)
	s.compactionLocksMu.Lock()
	defer s.compactionLocksMu.Unlock()
	lock := s.compactionLocks[key]
	if lock == nil {
		lock = &sync.Mutex{}
		s.compactionLocks[key] = lock
	}
	return lock
}
