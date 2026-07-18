package ai

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/ai/providers"
	"arlecchino/internal/ai/skills"

	"github.com/google/uuid"
)

const skillCircuitFileName = "skill_circuit.jsonl"

type SkillCircuitLedger struct {
	mu   sync.Mutex
	path string
}

func openSkillCircuitLedger(projectRoot string) (*SkillCircuitLedger, error) {
	path, err := ledgerPath(projectRoot, skillCircuitFileName)
	if err != nil {
		return nil, err
	}
	return &SkillCircuitLedger{path: path}, nil
}

func (l *SkillCircuitLedger) Upsert(controller AISkillCircuitController) (AISkillCircuitController, error) {
	if l == nil || strings.TrimSpace(controller.ID) == "" {
		return controller, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	controllers, err := readJSONLLocked[AISkillCircuitController](l.path)
	if err != nil {
		return AISkillCircuitController{}, err
	}
	controller = normalizeSkillCircuitController(controller)
	for index := range controllers {
		if controllers[index].ID == controller.ID {
			controller.CreatedAt = firstNonEmpty(controllers[index].CreatedAt, controller.CreatedAt)
			controllers[index] = controller
			return controller, writeJSONLLocked(l.path, controllers)
		}
	}
	controllers = append(controllers, controller)
	sort.SliceStable(controllers, func(i, j int) bool { return controllers[i].CreatedAt < controllers[j].CreatedAt })
	return controller, writeJSONLLocked(l.path, controllers)
}

func (l *SkillCircuitLedger) ListByRun(runID string) ([]AISkillCircuitController, error) {
	if l == nil || strings.TrimSpace(runID) == "" {
		return []AISkillCircuitController{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	controllers, err := readJSONLLocked[AISkillCircuitController](l.path)
	if err != nil {
		return nil, err
	}
	result := []AISkillCircuitController{}
	for _, controller := range controllers {
		if controller.RunID == strings.TrimSpace(runID) {
			result = append(result, normalizeSkillCircuitController(controller))
		}
	}
	return result, nil
}

func (l *SkillCircuitLedger) ListSession(sessionID string) ([]AISkillCircuitController, error) {
	if l == nil {
		return []AISkillCircuitController{}, nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	l.mu.Lock()
	defer l.mu.Unlock()
	controllers, err := readJSONLLocked[AISkillCircuitController](l.path)
	if err != nil {
		return nil, err
	}
	result := []AISkillCircuitController{}
	for _, controller := range controllers {
		if normalizeChatSessionID(controller.SessionID) == sessionID {
			result = append(result, normalizeSkillCircuitController(controller))
		}
	}
	return result, nil
}

func (l *SkillCircuitLedger) TransitionRun(runID string, state AISkillCircuitState) error {
	if l == nil || strings.TrimSpace(runID) == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	controllers, err := readJSONLLocked[AISkillCircuitController](l.path)
	if err != nil {
		return err
	}
	changed := false
	for index := range controllers {
		if controllers[index].RunID == strings.TrimSpace(runID) {
			controllers[index].State = state
			controllers[index].UpdatedAt = utcNow()
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return writeJSONLLocked(l.path, controllers)
}

func (l *SkillCircuitLedger) DecaySessionBefore(sessionID string, epoch int64) error {
	if l == nil || epoch <= 0 {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	controllers, err := readJSONLLocked[AISkillCircuitController](l.path)
	if err != nil {
		return err
	}
	changed := false
	for index := range controllers {
		if normalizeChatSessionID(controllers[index].SessionID) == normalizeChatSessionID(sessionID) &&
			controllers[index].TaskEpoch < epoch &&
			(controllers[index].State == AISkillCircuitStateActive || controllers[index].State == AISkillCircuitStateResident) {
			controllers[index].State = AISkillCircuitStateDecaying
			controllers[index].UpdatedAt = utcNow()
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return writeJSONLLocked(l.path, controllers)
}

func (l *SkillCircuitLedger) DeleteRuns(runIDs []string) error {
	if l == nil || len(runIDs) == 0 {
		return nil
	}
	set := map[string]struct{}{}
	for _, runID := range runIDs {
		if runID = strings.TrimSpace(runID); runID != "" {
			set[runID] = struct{}{}
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	controllers, err := readJSONLLocked[AISkillCircuitController](l.path)
	if err != nil {
		return err
	}
	kept := controllers[:0]
	for _, controller := range controllers {
		if _, remove := set[controller.RunID]; !remove {
			kept = append(kept, controller)
		}
	}
	return writeJSONLLocked(l.path, kept)
}

func (l *SkillCircuitLedger) Clear() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return writeJSONLLocked(l.path, []AISkillCircuitController{})
}

func normalizeSkillCircuitController(controller AISkillCircuitController) AISkillCircuitController {
	controller.ID = firstNonEmpty(strings.TrimSpace(controller.ID), "skill-circuit-"+uuid.NewString())
	controller.RunID = strings.TrimSpace(controller.RunID)
	controller.SessionID = normalizeChatSessionID(controller.SessionID)
	controller.ProjectSessionID = strings.TrimSpace(controller.ProjectSessionID)
	controller.SkillID = strings.TrimSpace(controller.SkillID)
	controller.Name = strings.TrimSpace(controller.Name)
	controller.SourceKind = strings.TrimSpace(controller.SourceKind)
	controller.TrustState = strings.TrimSpace(controller.TrustState)
	controller.ContentHash = strings.TrimSpace(controller.ContentHash)
	if controller.TaskEpoch <= 0 {
		controller.TaskEpoch = 1
	}
	if controller.State == "" {
		controller.State = AISkillCircuitStateCandidate
	}
	controller.MatchReason = sanitizedDisplayText(controller.MatchReason)
	controller.Scope = firstNonEmpty(strings.TrimSpace(controller.Scope), "run")
	controller.MandatoryChecks = sanitizeCircuitChecks(controller.MandatoryChecks)
	controller.ContextRestrictions = sanitizeCircuitChecks(controller.ContextRestrictions)
	controller.ToolRestrictions = sanitizeCircuitChecks(controller.ToolRestrictions)
	controller.CreatedAt = firstNonEmpty(controller.CreatedAt, utcNow())
	controller.UpdatedAt = firstNonEmpty(controller.UpdatedAt, controller.CreatedAt)
	return controller
}

func sanitizeCircuitChecks(values []string) []string {
	result := []string{}
	for _, value := range values {
		if value = strings.TrimSpace(sanitizedDisplayText(value)); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func skillCircuitSessionInstance(sessionID string, epoch int64) string {
	if epoch <= 0 {
		epoch = 1
	}
	return fmt.Sprintf("%s:epoch:%d", normalizeChatSessionID(sessionID), epoch)
}

func (s *Service) prepareSkillCircuitForRun(project *ProjectSession, runID string, req *AIChatRunRequest) {
	if s == nil || project == nil || req == nil || project.SkillCircuit == nil {
		return
	}
	node := s.runGraphNode(project, runID)
	if node == nil {
		return
	}
	req.Context.RunID = runID
	req.Context.TaskEpoch = node.TaskEpoch
	if !req.IncludeSkills && !req.Context.IncludeSkills {
		return
	}
	if project.Skills == nil {
		return
	}
	if node.Source == AIRunGraphSourceUser || node.Source == AIRunGraphSourceQueue {
		_ = project.SkillCircuit.DecaySessionBefore(req.SessionID, node.TaskEpoch)
	}
	records, err := project.Skills.List(100)
	if err != nil {
		return
	}
	for _, record := range records {
		matchReason, confidence := skillCircuitMatch(record, req.Prompt, req.Action)
		if confidence == 0 || record.SourceKind != skills.SourceProject || record.TrustState != skills.TrustTrusted || !record.Pinned || record.Stale {
			continue
		}
		resident, activateErr := project.Skills.Activate(skills.ActivateRequest{
			SkillID:           record.SkillID,
			WorkspaceRootHash: hashProjectPath(project.ProjectRoot),
			AgentSurface:      string(providers.CapabilityChat),
			SessionInstanceID: skillCircuitSessionInstance(req.SessionID, node.TaskEpoch),
			State:             skills.StateResident,
			TopicMatch:        matchReason,
			Confidence:        confidence,
			ActivationReason:  "skill_circuit:" + matchReason,
			TTL:               30 * time.Minute,
		})
		state := AISkillCircuitStateResident
		included := activateErr == nil
		if activateErr != nil {
			state = AISkillCircuitStateRejected
		}
		controller, upsertErr := project.SkillCircuit.Upsert(AISkillCircuitController{
			ID:                  "skill-circuit-" + runID + "-" + record.SkillID,
			RunID:               runID,
			SessionID:           req.SessionID,
			ProjectSessionID:    project.ID,
			SkillID:             record.SkillID,
			Name:                record.Name,
			SourceKind:          record.SourceKind,
			TrustState:          record.TrustState,
			ContentHash:         record.ContentHash,
			DigestVersion:       record.DigestVersion,
			TaskEpoch:           node.TaskEpoch,
			State:               state,
			MatchReason:         matchReason,
			Scope:               "task_epoch",
			AllowedModes:        []AIChatAction{req.Action},
			MandatoryChecks:     skillCircuitChecks(resident.Digest.VerificationHints, "verify"),
			ContextRestrictions: skillCircuitChecks(resident.Digest.AvoidRules, "context"),
			ToolRestrictions:    skillCircuitToolRestrictions(resident.Digest.ToolHints),
			Included:            included,
			CreatedAt:           utcNow(),
			UpdatedAt:           utcNow(),
		})
		if upsertErr == nil {
			s.recordRunTimeline(project, AIRunTimelineEvent{
				RunID:            runID,
				SessionID:        normalizeChatSessionID(req.SessionID),
				ProjectSessionID: project.ID,
				Source:           "skill_circuit",
				Type:             "before_context",
				Status:           string(controller.State),
				Actor:            "system",
				Capability:       providers.CapabilityChat,
				CorrelationID:    controller.ID,
				Summary:          "Skill circuit " + firstNonEmpty(controller.Name, controller.SkillID) + " " + string(controller.State),
			})
		}
	}
}

func skillCircuitMatch(record skills.Record, prompt string, action AIChatAction) (string, float64) {
	prompt = strings.ToLower(strings.TrimSpace(prompt))
	if prompt == "" {
		return "", 0
	}
	for _, pattern := range record.ActivationPatterns {
		if pattern = strings.ToLower(strings.TrimSpace(pattern)); pattern != "" && strings.Contains(prompt, pattern) {
			return "activation_pattern:" + pattern, 1
		}
	}
	name := strings.ToLower(strings.TrimSpace(record.Name))
	if name != "" && strings.Contains(prompt, name) {
		return "name_match:" + name, 0.9
	}
	for _, tag := range record.Tags {
		if tag = strings.ToLower(strings.TrimSpace(tag)); len(tag) >= 3 && strings.Contains(prompt, tag) {
			return "tag_match:" + tag, 0.75
		}
	}
	if action == AIChatActionBuild {
		for _, hint := range record.ToolHints {
			if hint = strings.TrimSpace(hint); strings.HasPrefix(strings.ToLower(hint), "mode:build") {
				return "build_mode_hint", 0.6
			}
		}
	}
	return "", 0
}

func skillCircuitChecks(values []string, prefix string) []string {
	checks := []string{}
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			checks = append(checks, prefix+":"+value)
		}
	}
	return checks
}

func skillCircuitToolRestrictions(hints []string) []string {
	restrictions := []string{}
	for _, hint := range hints {
		hint = strings.ToLower(strings.TrimSpace(hint))
		if strings.HasPrefix(hint, "deny:") {
			restrictions = append(restrictions, hint)
		}
	}
	return restrictions
}

func (s *Service) skillCircuitContext(project *ProjectSession, req AIContextRequest, workspaceHash string) []skills.ContextSkill {
	if project == nil || project.Skills == nil || req.RunID == "" || req.TaskEpoch <= 0 {
		return nil
	}
	items, err := project.Skills.Context(skills.ContextRequest{
		WorkspaceRootHash: workspaceHash,
		AgentSurface:      string(providers.CapabilityChat),
		SessionInstanceID: skillCircuitSessionInstance(req.SessionID, req.TaskEpoch),
		Limit:             6,
	})
	if err != nil {
		return nil
	}
	return items
}

func (s *Service) skillCircuitToolDenied(project *ProjectSession, runID string, toolID string) string {
	if project == nil || project.SkillCircuit == nil || strings.TrimSpace(runID) == "" {
		return ""
	}
	controllers, err := project.SkillCircuit.ListByRun(runID)
	if err != nil {
		return ""
	}
	toolID = strings.ToLower(strings.TrimSpace(toolID))
	for _, controller := range controllers {
		if !controller.Included || (controller.State != AISkillCircuitStateActive && controller.State != AISkillCircuitStateResident) {
			continue
		}
		for _, restriction := range controller.ToolRestrictions {
			if strings.TrimPrefix(strings.ToLower(restriction), "deny:") == toolID {
				return "Skill circuit restriction from " + firstNonEmpty(controller.Name, controller.SkillID)
			}
		}
	}
	return ""
}

func (s *Service) skillCircuitAfterToolResult(project *ProjectSession, result AIToolCallResult) {
	runID := strings.TrimSpace(result.Audit.RunID)
	if project == nil || runID == "" {
		return
	}
	if controllers, err := s.ListSkillCircuit(project.ID, runID); err == nil && len(controllers) > 0 {
		sessionID := defaultChatSessionID
		if run, runErr := s.GetChatRun(project.ID, runID); runErr == nil {
			sessionID = run.SessionID
		}
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runID,
			SessionID:        sessionID,
			ProjectSessionID: project.ID,
			Source:           "skill_circuit",
			Type:             "after_tool_result",
			Status:           result.Status,
			Actor:            "system",
			ToolID:           result.ToolID,
			Capability:       providers.CapabilityChat,
			Summary:          "Skill circuit recorded tool result",
		})
	}
}

func (s *Service) skillCircuitOnTaskTerminal(project *ProjectSession, run AIChatRun) {
	if project == nil || project.SkillCircuit == nil || !isTerminalChatRunStatus(run.Status) {
		return
	}
	if controllers, err := project.SkillCircuit.ListByRun(run.ID); err == nil && len(controllers) > 0 {
		_ = project.SkillCircuit.TransitionRun(run.ID, AISkillCircuitStateDecaying)
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            run.ID,
			SessionID:        run.SessionID,
			ProjectSessionID: project.ID,
			Source:           "skill_circuit",
			Type:             "on_task_terminal",
			Status:           "decaying",
			Actor:            "system",
			Capability:       providers.CapabilityChat,
			Summary:          "Skill circuit controllers decaying after terminal run",
		})
	}
}

func (s *Service) ListSkillCircuit(projectID string, runID string) ([]AISkillCircuitController, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.SkillCircuit == nil {
		return []AISkillCircuitController{}, nil
	}
	return project.SkillCircuit.ListByRun(runID)
}
