package mcp

import (
	"fmt"
	"strings"
	"time"

	"arlecchino/internal/ai/skills"
)

type AgentSkillsBackend interface {
	List(limit int) []AgentSkillRecord
	Status() AgentSkillStatus
	Context(maxChars int, surface string, sessionID string) string
	Activate(skillID string, surface string, sessionID string, reason string) (AgentSkillContext, error)
	Dismiss(skillID string, surface string, sessionID string) error
	Pin(skillID string, reviewer string) (AgentSkillContext, error)
	ImportCandidate(name string, description string, sourceRepo string, sourceRef string, toolHints []string) (AgentSkillRecord, error)
	Close() error
}

type AgentSkillRecord struct {
	SkillID       string   `json:"skillId"`
	Name          string   `json:"name"`
	Description   string   `json:"description,omitempty"`
	SourceKind    string   `json:"sourceKind"`
	TrustState    string   `json:"trustState"`
	Pinned        bool     `json:"pinned"`
	Stale         bool     `json:"stale"`
	DigestVersion int      `json:"digestVersion"`
	ToolHints     []string `json:"toolHints,omitempty"`
	UpdatedAt     string   `json:"updatedAt,omitempty"`
}

type AgentSkillContext struct {
	AgentSkillRecord
	State              string   `json:"state,omitempty"`
	Summary            string   `json:"summary,omitempty"`
	OperatingReminders []string `json:"operatingReminders,omitempty"`
	AvoidRules         []string `json:"avoidRules,omitempty"`
	VerificationHints  []string `json:"verificationHints,omitempty"`
	Confidence         float64  `json:"confidence,omitempty"`
	LastUsedAt         string   `json:"lastUsedAt,omitempty"`
	DecayDeadline      string   `json:"decayDeadline,omitempty"`
}

type AgentSkillStatus struct {
	Available int    `json:"available"`
	Trusted   int    `json:"trusted"`
	Pinned    int    `json:"pinned"`
	Stale     int    `json:"stale"`
	Active    int    `json:"active"`
	Backend   string `json:"backend"`
}

type mnemonicAgentSkillsStore struct {
	store       *skills.Store
	projectRoot string
}

func loadMnemonicAgentSkillsStore(projectRoot string) (*mnemonicAgentSkillsStore, error) {
	store, err := skills.Open(projectRoot)
	if err != nil {
		return nil, err
	}
	if _, err := store.SyncProjectSkills(); err != nil {
		_ = store.Close()
		return nil, err
	}
	return &mnemonicAgentSkillsStore{store: store, projectRoot: strings.TrimSpace(projectRoot)}, nil
}

func (s *ToolService) ListAgentSkills(limit int) []AgentSkillRecord {
	if s == nil || s.skills == nil {
		return []AgentSkillRecord{}
	}
	return s.skills.List(limit)
}

func (s *ToolService) AgentSkillsStatus() AgentSkillStatus {
	if s == nil || s.skills == nil {
		return AgentSkillStatus{Backend: "unavailable"}
	}
	return s.skills.Status()
}

func (s *ToolService) AgentSkillsContext(maxChars int, surface string, sessionID string) string {
	if s == nil || s.skills == nil {
		return "Skill residency is unavailable."
	}
	return s.skills.Context(maxChars, surface, sessionID)
}

func (s *ToolService) PinAgentSkill(skillID string, reviewer string) (AgentSkillContext, error) {
	if s == nil || s.skills == nil {
		return AgentSkillContext{}, fmt.Errorf("skill residency is unavailable")
	}
	return s.skills.Pin(skillID, reviewer)
}

func (s *ToolService) ActivateAgentSkill(skillID string, surface string, sessionID string, reason string) (AgentSkillContext, error) {
	if s == nil || s.skills == nil {
		return AgentSkillContext{}, fmt.Errorf("skill residency is unavailable")
	}
	return s.skills.Activate(skillID, surface, sessionID, reason)
}

func (s *ToolService) DismissAgentSkill(skillID string, surface string, sessionID string) error {
	if s == nil || s.skills == nil {
		return fmt.Errorf("skill residency is unavailable")
	}
	return s.skills.Dismiss(skillID, surface, sessionID)
}

func (s *ToolService) ImportAgentSkillCandidate(name string, description string, sourceRepo string, sourceRef string, toolHints []string) (AgentSkillRecord, error) {
	if s == nil || s.skills == nil {
		return AgentSkillRecord{}, fmt.Errorf("skill residency is unavailable")
	}
	return s.skills.ImportCandidate(name, description, sourceRepo, sourceRef, toolHints)
}

func (s *mnemonicAgentSkillsStore) List(limit int) []AgentSkillRecord {
	if s == nil || s.store == nil {
		return []AgentSkillRecord{}
	}
	records, err := s.store.List(limit)
	if err != nil {
		return []AgentSkillRecord{}
	}
	out := make([]AgentSkillRecord, 0, len(records))
	for _, record := range records {
		out = append(out, agentSkillRecordFromSkill(record))
	}
	return out
}

func (s *mnemonicAgentSkillsStore) Status() AgentSkillStatus {
	if s == nil || s.store == nil {
		return AgentSkillStatus{Backend: "unavailable"}
	}
	status, err := s.store.Status()
	if err != nil {
		return AgentSkillStatus{Backend: "mnemonic"}
	}
	return AgentSkillStatus{
		Available: status.Available,
		Trusted:   status.Trusted,
		Pinned:    status.Pinned,
		Stale:     status.Stale,
		Active:    status.Active,
		Backend:   "mnemonic",
	}
}

func (s *mnemonicAgentSkillsStore) Context(maxChars int, surface string, sessionID string) string {
	if s == nil || s.store == nil {
		return "Skill residency is unavailable."
	}
	items, err := s.store.Context(skills.ContextRequest{
		AgentSurface:      strings.TrimSpace(surface),
		SessionInstanceID: strings.TrimSpace(sessionID),
		Limit:             8,
	})
	if err != nil || len(items) == 0 {
		return "No trusted resident skills are active. Use agent_skills.list for candidates and agent_skills.pin plus agent_skills.activate after explicit approval."
	}
	if maxChars <= 0 {
		maxChars = 2400
	}
	var builder strings.Builder
	for _, item := range items {
		context := agentSkillContextFromSkill(item)
		line := fmt.Sprintf("- [%s][%s] %s", context.SkillID, context.State, context.Summary)
		if len(context.OperatingReminders) > 0 {
			line += " reminders=" + strings.Join(context.OperatingReminders, "; ")
		}
		if len(context.AvoidRules) > 0 {
			line += " avoid=" + strings.Join(context.AvoidRules, "; ")
		}
		if len(context.AgentSkillRecord.ToolHints) > 0 {
			line += " tool_hints=" + strings.Join(context.AgentSkillRecord.ToolHints, ",")
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
		return "Trusted resident skills exist, but their compact context exceeded the requested character budget."
	}
	return builder.String()
}

func (s *mnemonicAgentSkillsStore) Activate(skillID string, surface string, sessionID string, reason string) (AgentSkillContext, error) {
	if s == nil || s.store == nil {
		return AgentSkillContext{}, fmt.Errorf("skill residency is unavailable")
	}
	item, err := s.store.Activate(skills.ActivateRequest{
		SkillID:           skillID,
		AgentSurface:      strings.TrimSpace(surface),
		SessionInstanceID: strings.TrimSpace(sessionID),
		ActivationReason:  strings.TrimSpace(reason),
		Confidence:        1,
		TTL:               45 * time.Minute,
	})
	if err != nil {
		return AgentSkillContext{}, err
	}
	return agentSkillContextFromSkill(item), nil
}

func (s *mnemonicAgentSkillsStore) Dismiss(skillID string, surface string, sessionID string) error {
	if s == nil || s.store == nil {
		return fmt.Errorf("skill residency is unavailable")
	}
	return s.store.Dismiss(skillID, "", surface, sessionID)
}

func (s *mnemonicAgentSkillsStore) Pin(skillID string, reviewer string) (AgentSkillContext, error) {
	if s == nil || s.store == nil {
		return AgentSkillContext{}, fmt.Errorf("skill residency is unavailable")
	}
	if _, err := s.store.ReviewSkill(skillID, reviewer, true); err != nil {
		return AgentSkillContext{}, err
	}
	item, err := s.store.TrustedDigest(skillID)
	if err != nil {
		return AgentSkillContext{}, err
	}
	return agentSkillContextFromSkill(item), nil
}

func (s *mnemonicAgentSkillsStore) ImportCandidate(name string, description string, sourceRepo string, sourceRef string, toolHints []string) (AgentSkillRecord, error) {
	if s == nil || s.store == nil {
		return AgentSkillRecord{}, fmt.Errorf("skill residency is unavailable")
	}
	record, err := s.store.ImportCandidate(name, description, sourceRepo, sourceRef, toolHints)
	if err != nil {
		return AgentSkillRecord{}, err
	}
	return agentSkillRecordFromSkill(record), nil
}

func (s *mnemonicAgentSkillsStore) Close() error {
	if s == nil || s.store == nil {
		return nil
	}
	return s.store.Close()
}

func agentSkillRecordFromSkill(record skills.Record) AgentSkillRecord {
	return AgentSkillRecord{
		SkillID:       record.SkillID,
		Name:          record.Name,
		Description:   record.Description,
		SourceKind:    record.SourceKind,
		TrustState:    record.TrustState,
		Pinned:        record.Pinned,
		Stale:         record.Stale,
		DigestVersion: record.DigestVersion,
		ToolHints:     append([]string(nil), record.ToolHints...),
		UpdatedAt:     record.UpdatedAt,
	}
}

func agentSkillContextFromSkill(item skills.ContextSkill) AgentSkillContext {
	record := agentSkillRecordFromSkill(item.Record)
	record.ToolHints = append([]string(nil), item.Digest.ToolHints...)
	return AgentSkillContext{
		AgentSkillRecord:   record,
		State:              item.State,
		Summary:            item.Digest.Summary,
		OperatingReminders: append([]string(nil), item.Digest.OperatingReminders...),
		AvoidRules:         append([]string(nil), item.Digest.AvoidRules...),
		VerificationHints:  append([]string(nil), item.Digest.VerificationHints...),
		Confidence:         item.Confidence,
		LastUsedAt:         item.LastUsedAt,
		DecayDeadline:      item.DecayDeadline,
	}
}
