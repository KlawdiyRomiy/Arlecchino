package ai

import "strings"

func (s *Service) recoverProjectAIRuntime(project *ProjectSession) {
	if s == nil || project == nil {
		return
	}
	s.recoverLoadedRuns(project)
	s.recoverToolApprovalGrants(project)
}

func (s *Service) recoverLoadedRuns(project *ProjectSession) {
	if project.ChatHistory == nil {
		return
	}
	runs, err := project.ChatHistory.List(0)
	if err != nil {
		return
	}
	changed := false
	for _, run := range runs {
		originalStatus := run.Status
		run = normalizeLoadedChatRun(project.ID, run)
		if (originalStatus == "running" || originalStatus == "queued") && run.Status == "canceled" {
			run.Error = firstNonEmpty(run.Error, "Run was recovered as canceled after IDE restart.")
			run.CanCancel = false
			run.Revision++
			run.UpdatedAt = utcNow()
			changed = true
			_ = project.ChatHistory.Upsert(run)
			s.recordRunTimeline(project, AIRunTimelineEvent{
				RunID:            run.ID,
				SessionID:        normalizeChatSessionID(run.SessionID),
				ProjectSessionID: project.ID,
				Source:           "runtime_recovery",
				Type:             "run_recovered",
				Status:           "canceled",
				Actor:            "system",
				ProviderID:       run.ProviderID,
				Model:            run.Model,
				Capability:       AICapabilityChat,
				Summary:          "Interrupted run was marked canceled during project recovery.",
			})
		}
	}
	if changed {
		s.emitEvent("ai:runtime:recovered", map[string]any{
			"projectSessionId": project.ID,
			"projectPathHash":  hashProjectPath(project.ProjectRoot),
		})
	}
}

func (s *Service) recoverToolApprovalGrants(project *ProjectSession) {
	if project.ToolApprovalGrants == nil {
		return
	}
	grants, err := project.ToolApprovalGrants.ListActive()
	if err != nil || len(grants) == 0 {
		return
	}
	s.mu.Lock()
	if s.toolApprovals == nil {
		s.toolApprovals = map[string]AIToolApprovalGrant{}
	}
	for _, grant := range grants {
		if strings.TrimSpace(grant.ProjectSessionID) == "" {
			grant.ProjectSessionID = project.ID
		}
		if grant.Scope != toolApprovalScopeRun {
			continue
		}
		key := strings.Join([]string{
			normalizeProjectID(grant.ProjectSessionID),
			strings.TrimSpace(grant.RunID),
			strings.TrimSpace(grant.ToolID),
			strings.TrimSpace(grant.ArgumentsHash),
		}, ":")
		s.toolApprovals[key] = grant
	}
	s.mu.Unlock()
	s.emitEvent("ai:tool:approvals-recovered", map[string]any{
		"projectSessionId": project.ID,
		"count":            len(grants),
	})
}
