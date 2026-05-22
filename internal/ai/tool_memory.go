package ai

import (
	"errors"
	"fmt"
	"strings"

	"arlecchino/internal/ai/mnemonic"
	"arlecchino/internal/ai/providers"
)

const (
	defaultMemorySearchLimit = 8
	maxMemoryToolEntries     = 12
	defaultMemoryContextMax  = 1600
	maxMemoryContextMax      = 4000
	minMemoryContextMax      = 200
)

func (s *Service) executeMemorySearchTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	limit := parsePositiveToolInt(req.Arguments["limit"], defaultMemorySearchLimit)
	if limit > maxMemoryToolEntries {
		limit = maxMemoryToolEntries
	}
	entries, status, err := memoryToolSearchEntries(project, mnemonic.SearchRequest{
		Query:            req.Arguments["query"],
		Tags:             parseMemoryToolTags(req.Arguments["tags"]),
		Limit:            limit,
		IncludeGenerated: true,
		IncludeUntrusted: true,
	})
	if err != nil {
		result.Status = "error"
		result.Error = err.Error()
		s.recordMemoryToolTimeline(project, req, result, "memory_search", "error", "Mnemonic memory search failed: "+err.Error())
		return result
	}
	result.Status = "executed"
	if status == "disabled" {
		result.OutputPreview = "Mnemonic memory is disabled or unavailable."
	} else if result.OutputPreview = formatMemoryToolEntries(entries, maxMemoryContextMax); result.OutputPreview == "" {
		result.OutputPreview = "Mnemonic memory: no matching entries."
	}
	s.recordMemoryToolTimeline(project, req, result, "memory_search", status, memoryToolSummary("Mnemonic memory search", status, len(entries)))
	return result
}

func (s *Service) executeMemoryContextTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	maxChars := parsePositiveToolInt(firstNonEmpty(req.Arguments["maxChars"], req.Arguments["max_chars"]), defaultMemoryContextMax)
	if maxChars < minMemoryContextMax {
		maxChars = minMemoryContextMax
	}
	if maxChars > maxMemoryContextMax {
		maxChars = maxMemoryContextMax
	}
	entries, status, err := memoryToolSearchEntries(project, mnemonic.SearchRequest{
		Limit:            maxMemoryToolEntries,
		IncludeGenerated: true,
		IncludeUntrusted: true,
	})
	if err != nil {
		result.Status = "error"
		result.Error = err.Error()
		s.recordMemoryToolTimeline(project, req, result, "memory_context", "error", "Mnemonic context read failed: "+err.Error())
		return result
	}
	result.Status = "executed"
	if status == "disabled" {
		result.OutputPreview = "Shared Mnemonic memory is disabled or unavailable."
	} else if result.OutputPreview = formatMemoryToolEntries(entries, maxChars); result.OutputPreview == "" {
		result.OutputPreview = "Shared Mnemonic memory: no entries available."
	}
	s.recordMemoryToolTimeline(project, req, result, "memory_context", status, memoryToolSummary("Mnemonic context", status, len(entries)))
	return result
}

func (s *Service) executeMemoryProposeSaveTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	content := strings.TrimSpace(req.Arguments["content"])
	if content == "" {
		result.Status = "blocked"
		result.Error = "mnemonic proposal content is empty"
		s.recordMemoryToolTimeline(project, req, result, "memory_propose_save", "blocked", "Mnemonic memory-save proposal blocked: empty content.")
		return result
	}
	importance := parsePositiveToolInt(req.Arguments["importance"], 5)
	if importance > 10 {
		importance = 10
	}
	proposal, err := s.ProposeMnemonicEntry(project.ID, AIMnemonicWriteProposalRequest{
		RunID: req.RunID,
		Entry: AIMnemonicEntryInput{
			Type:       firstNonEmpty(req.Arguments["type"], "note"),
			Source:     "ai-chat",
			Tags:       parseMemoryToolTags(req.Arguments["tags"]),
			Content:    content,
			Importance: importance,
			Trust:      mnemonic.TrustGenerated,
			IsLatest:   true,
			Provenance: map[string]string{
				"source":     "memory.propose_save",
				"toolCallId": result.ID,
				"runId":      req.RunID,
			},
		},
		Reason: req.Arguments["reason"],
	})
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		s.recordMemoryToolTimeline(project, req, result, "memory_propose_save", "blocked", "Mnemonic memory-save proposal blocked: "+err.Error())
		return result
	}
	result.Status = proposal.Status
	result.ArtifactID = proposal.Artifact.ID
	result.OutputPreview = proposal.Artifact.Summary
	s.recordMemoryToolTimeline(project, req, result, "memory_propose_save", "proposed", "Mnemonic memory-save proposal ready for review.")
	return result
}

func memoryToolSearchEntries(project *ProjectSession, req mnemonic.SearchRequest) ([]AIMnemonicEntry, string, error) {
	if project == nil || project.Mnemonic == nil {
		return nil, "disabled", nil
	}
	if !project.Mnemonic.Enabled() {
		return nil, "disabled", nil
	}
	entries, err := project.Mnemonic.SearchEntries(req)
	if errors.Is(err, mnemonic.ErrDisabled) {
		return nil, "disabled", nil
	}
	if err != nil {
		return nil, "error", err
	}
	if len(entries) == 0 {
		return nil, "empty", nil
	}
	return fromMnemonicEntries(entries), "executed", nil
}

func formatMemoryToolEntries(entries []AIMnemonicEntry, maxChars int) string {
	if len(entries) == 0 {
		return ""
	}
	var out strings.Builder
	out.WriteString("Shared Mnemonic memory:\n")
	for _, entry := range entries {
		labels := []string{
			firstNonEmpty(entry.Trust, "unknown"),
			firstNonEmpty(entry.Source, "unknown"),
			firstNonEmpty(entry.Type, "note"),
			fmt.Sprintf("p%d", entry.Importance),
		}
		content := strings.TrimSpace(entry.Content)
		if content == "" {
			continue
		}
		out.WriteString("- [")
		out.WriteString(strings.Join(labels, "/"))
		out.WriteString("] ")
		out.WriteString(content)
		if len(entry.Tags) > 0 {
			out.WriteString(" #")
			out.WriteString(strings.Join(entry.Tags, " #"))
		}
		out.WriteString("\n")
	}
	text := strings.TrimSpace(sanitizedDisplayText(out.String()))
	if maxChars > 0 {
		text = truncateUTF8(text, maxChars)
	}
	return text
}

func parseMemoryToolTags(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n'
	})
	tags := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		tag := strings.Trim(strings.TrimSpace(part), "#")
		if tag == "" {
			continue
		}
		key := strings.ToLower(tag)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		tags = append(tags, tag)
	}
	return tags
}

func memoryToolSummary(prefix string, status string, count int) string {
	switch status {
	case "disabled":
		return prefix + ": disabled."
	case "empty":
		return prefix + ": no entries found."
	case "executed":
		return fmt.Sprintf("%s: %d entries returned.", prefix, count)
	default:
		return prefix + ": " + firstNonEmpty(status, "updated") + "."
	}
}

func (s *Service) recordMemoryToolTimeline(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult, eventType string, status string, summary string) {
	if strings.TrimSpace(req.RunID) == "" {
		return
	}
	projectID := ""
	if project != nil {
		projectID = project.ID
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            req.RunID,
		ProjectSessionID: projectID,
		Source:           "mnemonic_tool",
		Type:             eventType,
		Status:           firstNonEmpty(status, result.Status),
		Actor:            "tool",
		ToolID:           result.ToolID,
		ArtifactID:       result.ArtifactID,
		CorrelationID:    result.ID,
		Summary:          summary,
		DataCategories:   []string{"mnemonic"},
		Capability:       providers.CapabilityChat,
	})
}
