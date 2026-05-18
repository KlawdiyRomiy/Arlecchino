package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"arlecchino/internal/ai/mnemonic"

	"github.com/google/uuid"
)

func (s *Service) SearchMnemonic(projectID string, req AIMnemonicSearchRequest) ([]AIMnemonicEntry, error) {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return []AIMnemonicEntry{}, nil
	}
	entries, err := project.Mnemonic.SearchEntries(mnemonic.SearchRequest{
		Query:             req.Query,
		Tags:              req.Tags,
		Limit:             req.Limit,
		IncludeUntrusted:  req.IncludeUntrusted,
		IncludeGenerated:  req.IncludeGenerated,
		IncludeSuperseded: req.IncludeSuperseded,
	})
	if err != nil {
		return nil, err
	}
	return fromMnemonicEntries(entries), nil
}

func (s *Service) ListMnemonicEntries(projectID string, limit int) ([]AIMnemonicEntry, error) {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return []AIMnemonicEntry{}, nil
	}
	entries, err := project.Mnemonic.ListAll(limit)
	if err != nil {
		return nil, err
	}
	return fromMnemonicEntries(entries), nil
}

func (s *Service) SaveMnemonicEntry(projectID string, input AIMnemonicEntryInput) (AIMnemonicEntry, error) {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return AIMnemonicEntry{}, fmt.Errorf("AI project session is not open")
	}
	entry := mnemonic.Entry{
		ID:            strings.TrimSpace(input.ID),
		Type:          input.Type,
		Source:        input.Source,
		Tags:          input.Tags,
		Content:       input.Content,
		Importance:    input.Importance,
		Confidence:    input.Confidence,
		Trust:         input.Trust,
		Pinned:        input.Pinned,
		IsLatest:      input.IsLatest,
		Decay:         input.Decay,
		Provenance:    input.Provenance,
		Relationships: toMnemonicRelationships(input.Relationships),
	}
	if strings.TrimSpace(entry.Source) == "ai-chat" && (entry.Trust == "" || entry.Trust == mnemonic.TrustTrusted) && !entry.Pinned {
		entry.Trust = mnemonic.TrustGenerated
	}
	if !entry.IsLatest {
		entry.IsLatest = true
	}
	saved, err := project.Mnemonic.Save(entry)
	if err != nil {
		return AIMnemonicEntry{}, err
	}
	out := fromMnemonicEntry(saved)
	s.emitEvent("ai:mnemonic:entry-saved", out)
	return out, nil
}

func (s *Service) UpdateMnemonicEntry(projectID string, id string, patch AIMnemonicEntryPatch) (AIMnemonicEntry, error) {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return AIMnemonicEntry{}, fmt.Errorf("AI project session is not open")
	}
	entry, err := project.Mnemonic.Get(id)
	if err != nil {
		return AIMnemonicEntry{}, err
	}
	if strings.TrimSpace(patch.Type) != "" {
		entry.Type = patch.Type
	}
	if strings.TrimSpace(patch.Source) != "" {
		entry.Source = patch.Source
	}
	if patch.Tags != nil {
		entry.Tags = patch.Tags
	}
	if strings.TrimSpace(patch.Content) != "" {
		entry.Content = patch.Content
	}
	if patch.Importance != nil {
		entry.Importance = *patch.Importance
	}
	if patch.Confidence != nil {
		entry.Confidence = *patch.Confidence
	}
	if strings.TrimSpace(patch.Trust) != "" {
		if isMnemonicTrustPromotion(entry.Trust, patch.Trust) && !mnemonicPromotionReviewed(entry, patch) {
			return AIMnemonicEntry{}, fmt.Errorf("mnemonic trust promotion requires explicit reviewed provenance and pinning")
		}
		entry.Trust = patch.Trust
	}
	if patch.Pinned != nil {
		entry.Pinned = *patch.Pinned
	}
	if patch.IsLatest != nil {
		entry.IsLatest = *patch.IsLatest
	}
	if patch.Decay != nil {
		entry.Decay = *patch.Decay
	}
	if patch.Provenance != nil {
		entry.Provenance = patch.Provenance
	}
	if patch.Relationships != nil {
		entry.Relationships = toMnemonicRelationships(patch.Relationships)
	}
	saved, err := project.Mnemonic.Save(entry)
	if err != nil {
		return AIMnemonicEntry{}, err
	}
	out := fromMnemonicEntry(saved)
	s.emitEvent("ai:mnemonic:entry-updated", out)
	return out, nil
}

func (s *Service) DeleteMnemonicEntry(projectID string, id string) error {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return nil
	}
	if err := project.Mnemonic.Delete(id); err != nil {
		return err
	}
	s.emitEvent("ai:mnemonic:entry-deleted", map[string]string{"id": strings.TrimSpace(id), "projectSessionId": project.ID})
	return nil
}

func (s *Service) InspectMnemonic(projectID string, runID string) (AIMnemonicInspection, error) {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return AIMnemonicInspection{UpdatedAt: utcNow()}, nil
	}
	entries, err := project.Mnemonic.ListAll(200)
	if err != nil {
		return AIMnemonicInspection{}, err
	}
	usedIDs := map[string]struct{}{}
	runID = strings.TrimSpace(runID)
	if runID != "" && project.ChatArtifacts != nil {
		artifacts, _ := project.ChatArtifacts.ListByRun(runID)
		for _, artifact := range artifacts {
			if artifact.Kind != AIChatRunArtifactContext {
				continue
			}
			var snapshot AIContextSnapshot
			if err := json.Unmarshal([]byte(artifact.PayloadJSON), &snapshot); err != nil {
				continue
			}
			for _, entry := range snapshot.Mnemonic {
				usedIDs[entry.ID] = struct{}{}
			}
		}
	}
	inspection := AIMnemonicInspection{RunID: runID, UpdatedAt: utcNow()}
	for _, raw := range entries {
		entry := fromMnemonicEntry(raw)
		_, used := usedIDs[entry.ID]
		item := AIMnemonicInspectionEntry{
			Entry:     entry,
			State:     mnemonicInspectionState(entry, used),
			Reason:    mnemonicInspectionReason(entry, used),
			UsedInRun: used,
		}
		if used {
			inspection.Used = append(inspection.Used, item)
		}
		if entry.Pinned {
			inspection.Pinned = append(inspection.Pinned, item)
		}
		if entry.Superseded {
			inspection.Superseded = append(inspection.Superseded, item)
		}
		if !entry.IsLatest || entry.Decay >= 0.8 {
			inspection.Stale = append(inspection.Stale, item)
		}
		if !used && !entry.Superseded {
			inspection.Candidates = append(inspection.Candidates, item)
		}
	}
	return inspection, nil
}

func (s *Service) ProposeMnemonicEntry(projectID string, req AIMnemonicWriteProposalRequest) (AIMnemonicWriteProposalResult, error) {
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil {
		return AIMnemonicWriteProposalResult{}, fmt.Errorf("AI project session is not open")
	}
	run, err := s.GetChatRun(project.ID, req.RunID)
	if err != nil {
		return AIMnemonicWriteProposalResult{}, err
	}
	if strings.TrimSpace(req.Entry.Content) == "" {
		return AIMnemonicWriteProposalResult{}, fmt.Errorf("mnemonic proposal content is empty")
	}
	req.Entry.Source = firstNonEmpty(req.Entry.Source, "ai-chat")
	req.Entry.Trust = mnemonic.TrustGenerated
	payload := AIMnemonicWriteProposalPayload{
		Entry:            req.Entry,
		Reason:           strings.TrimSpace(req.Reason),
		RequiresApproval: true,
	}
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "memory-proposal-" + uuid.NewString(),
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactMemory,
		Status:           "proposed",
		Title:            "Mnemonic write proposal",
		Summary:          firstNonEmpty(payload.Reason, "Approval required before writing durable memory"),
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIMnemonicWriteProposalResult{}, err
	}
	s.emitChatArtifactChanged(project, artifact, "ai:memory:artifact-proposed")
	return AIMnemonicWriteProposalResult{Artifact: artifact, Payload: payload, Status: artifact.Status, RequiresApproval: true}, nil
}

func (s *Service) ApproveMnemonicEntryProposal(projectID string, req AIMnemonicApproveProposalRequest) (AIMnemonicEntry, error) {
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil || project.Mnemonic == nil {
		return AIMnemonicEntry{}, fmt.Errorf("AI project session is not open")
	}
	artifact, err := s.GetChatRunArtifact(project.ID, req.ArtifactID)
	if err != nil {
		return AIMnemonicEntry{}, err
	}
	if artifact.Kind != AIChatRunArtifactMemory || artifact.Status != "proposed" {
		return AIMnemonicEntry{}, fmt.Errorf("chat artifact %q is not a mnemonic write proposal", artifact.ID)
	}
	var payload AIMnemonicWriteProposalPayload
	if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
		return AIMnemonicEntry{}, err
	}
	input := payload.Entry
	input.Source = firstNonEmpty(input.Source, "user-approved")
	input.Trust = firstNonEmpty(req.Trust, mnemonic.TrustTrusted)
	input.Pinned = req.Pinned || input.Trust == mnemonic.TrustTrusted
	input.Provenance = map[string]string{
		"reviewedBy": firstNonEmpty(strings.TrimSpace(req.ReviewedBy), "user"),
		"proposalId": artifact.ID,
		"runId":      artifact.RunID,
	}
	saved, err := s.SaveMnemonicEntry(project.ID, input)
	if err != nil {
		return AIMnemonicEntry{}, err
	}
	artifact.Status = "approved"
	artifact.Summary = "Saved to Mnemonic after approval"
	artifact.UpdatedAt = utcNow()
	artifact.PayloadJSON = marshalChatArtifactPayload(map[string]any{
		"proposal": payload,
		"entryId":  saved.ID,
		"approved": true,
	})
	if err := project.ChatArtifacts.Upsert(artifact); err == nil {
		s.emitChatArtifactChanged(project, artifact, "ai:memory:artifact-approved")
	}
	return saved, nil
}

func mnemonicInspectionState(entry AIMnemonicEntry, used bool) string {
	switch {
	case used:
		return "used"
	case entry.Pinned:
		return "pinned"
	case entry.Superseded:
		return "superseded"
	case !entry.IsLatest || entry.Decay >= 0.8:
		return "stale"
	case entry.Generated || entry.Trust == mnemonic.TrustGenerated:
		return "candidate"
	default:
		return "available"
	}
}

func mnemonicInspectionReason(entry AIMnemonicEntry, used bool) string {
	if used {
		return "included in this run context"
	}
	if entry.Pinned {
		return "pinned durable memory"
	}
	if entry.Superseded {
		return "not latest"
	}
	if entry.Generated {
		return "generated memory requires user review before promotion"
	}
	return "available trusted memory"
}

func isMnemonicTrustPromotion(current string, next string) bool {
	current = strings.TrimSpace(strings.ToLower(current))
	next = strings.TrimSpace(strings.ToLower(next))
	return next == mnemonic.TrustTrusted && (current == mnemonic.TrustGenerated || current == mnemonic.TrustUntrusted)
}

func mnemonicPromotionReviewed(entry mnemonic.Entry, patch AIMnemonicEntryPatch) bool {
	pinned := entry.Pinned
	if patch.Pinned != nil {
		pinned = *patch.Pinned
	}
	provenance := entry.Provenance
	if patch.Provenance != nil {
		provenance = patch.Provenance
	}
	if !pinned || provenance == nil {
		return false
	}
	return strings.TrimSpace(provenance["reviewedBy"]) != "" || strings.TrimSpace(provenance["promotion"]) == "user_confirmed"
}

func fromMnemonicEntries(entries []mnemonic.Entry) []AIMnemonicEntry {
	out := make([]AIMnemonicEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, fromMnemonicEntry(entry))
	}
	return out
}

func toMnemonicRelationships(input []AIMnemonicRelationship) []mnemonic.Relationship {
	out := make([]mnemonic.Relationship, 0, len(input))
	for _, relationship := range input {
		out = append(out, mnemonic.Relationship{
			ID:        relationship.ID,
			FromID:    relationship.FromID,
			ToID:      relationship.ToID,
			Type:      relationship.Type,
			CreatedAt: relationship.CreatedAt,
		})
	}
	return out
}

func fromMnemonicRelationships(input []mnemonic.Relationship) []AIMnemonicRelationship {
	out := make([]AIMnemonicRelationship, 0, len(input))
	for _, relationship := range input {
		out = append(out, AIMnemonicRelationship{
			ID:        relationship.ID,
			FromID:    relationship.FromID,
			ToID:      relationship.ToID,
			Type:      relationship.Type,
			CreatedAt: relationship.CreatedAt,
		})
	}
	return out
}
