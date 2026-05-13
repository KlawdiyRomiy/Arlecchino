package ai

import (
	"fmt"
	"strings"

	"arlecchino/internal/ai/mnemonic"
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
