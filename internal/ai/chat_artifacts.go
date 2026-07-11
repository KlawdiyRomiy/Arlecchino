package ai

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const chatArtifactsFileName = "chat_artifacts.jsonl"
const maxChatArtifactPayloadBytes = 256 * 1024

type ChatArtifactLedger struct {
	mu   sync.Mutex
	path string
}

func openChatArtifactLedger(projectRoot string) (*ChatArtifactLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &ChatArtifactLedger{path: filepath.Join(dir, chatArtifactsFileName)}, nil
}

func (l *ChatArtifactLedger) Upsert(artifact AIChatRunArtifact) error {
	if l == nil || strings.TrimSpace(artifact.ID) == "" || strings.TrimSpace(artifact.RunID) == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	artifacts, err := l.readAllLocked()
	if err != nil {
		return err
	}
	replaced := false
	for i := range artifacts {
		if artifacts[i].ID == artifact.ID {
			artifacts[i] = artifact
			replaced = true
			break
		}
	}
	if !replaced {
		artifacts = append(artifacts, artifact)
	}
	sortArtifactsNewestFirst(artifacts)
	return l.writeAllLocked(artifacts)
}

func (l *ChatArtifactLedger) ListByRun(runID string) ([]AIChatRunArtifact, error) {
	if l == nil {
		return []AIChatRunArtifact{}, nil
	}
	runID = strings.TrimSpace(runID)
	l.mu.Lock()
	defer l.mu.Unlock()

	artifacts, err := l.readAllLocked()
	if err != nil {
		return nil, err
	}
	next := artifacts[:0]
	for _, artifact := range artifacts {
		if artifact.RunID == runID {
			next = append(next, artifact)
		}
	}
	sortArtifactsNewestFirst(next)
	return next, nil
}

func (l *ChatArtifactLedger) List(limit int) ([]AIChatRunArtifact, error) {
	if l == nil {
		return []AIChatRunArtifact{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	artifacts, err := l.readAllLocked()
	if err != nil {
		return nil, err
	}
	sortArtifactsNewestFirst(artifacts)
	if limit > 0 && len(artifacts) > limit {
		artifacts = artifacts[:limit]
	}
	return artifacts, nil
}

func (l *ChatArtifactLedger) Get(artifactID string) (AIChatRunArtifact, error) {
	if l == nil {
		return AIChatRunArtifact{}, fmt.Errorf("chat artifact %q was not found", artifactID)
	}
	artifactID = strings.TrimSpace(artifactID)
	l.mu.Lock()
	defer l.mu.Unlock()

	artifacts, err := l.readAllLocked()
	if err != nil {
		return AIChatRunArtifact{}, err
	}
	for _, artifact := range artifacts {
		if artifact.ID == artifactID {
			return artifact, nil
		}
	}
	return AIChatRunArtifact{}, fmt.Errorf("chat artifact %q was not found", artifactID)
}

func (l *ChatArtifactLedger) DeleteSession(sessionID string) error {
	if l == nil {
		return nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	l.mu.Lock()
	defer l.mu.Unlock()

	artifacts, err := l.readAllLocked()
	if err != nil {
		return err
	}
	next := artifacts[:0]
	for _, artifact := range artifacts {
		if normalizeChatSessionID(artifact.SessionID) == sessionID {
			continue
		}
		next = append(next, artifact)
	}
	if len(next) == 0 {
		if err := os.Remove(l.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return l.writeAllLocked(next)
}

func (l *ChatArtifactLedger) Clear() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.Remove(l.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (l *ChatArtifactLedger) readAllLocked() ([]AIChatRunArtifact, error) {
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIChatRunArtifact{}, nil
		}
		return nil, err
	}
	defer file.Close()

	artifacts := []AIChatRunArtifact{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 16*1024*1024)
	for scanner.Scan() {
		var artifact AIChatRunArtifact
		if err := json.Unmarshal(scanner.Bytes(), &artifact); err == nil && artifact.ID != "" {
			artifacts = append(artifacts, normalizeLoadedChatArtifact(artifact))
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return artifacts, nil
}

func (l *ChatArtifactLedger) writeAllLocked(artifacts []AIChatRunArtifact) error {
	dir := filepath.Dir(l.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".chat_artifacts-*.tmp")
	if err != nil {
		return err
	}
	tempPath := file.Name()
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Remove(tempPath)
		}
	}()

	encoder := json.NewEncoder(file)
	for _, artifact := range artifacts {
		if strings.TrimSpace(artifact.ID) == "" {
			continue
		}
		if err := encoder.Encode(artifact); err != nil {
			_ = file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, l.path); err != nil {
		return err
	}
	removeTemp = false
	return nil
}

func normalizeLoadedChatArtifact(artifact AIChatRunArtifact) AIChatRunArtifact {
	artifact.SessionID = normalizeChatSessionID(artifact.SessionID)
	if artifact.Status == "" {
		artifact.Status = "recorded"
	}
	artifact.CreatedAt = firstNonEmpty(artifact.CreatedAt, utcNow())
	artifact.UpdatedAt = firstNonEmpty(artifact.UpdatedAt, artifact.CreatedAt)
	return artifact
}

func sortArtifactsNewestFirst(artifacts []AIChatRunArtifact) {
	sort.SliceStable(artifacts, func(i, j int) bool {
		left := firstNonEmpty(artifacts[i].UpdatedAt, artifacts[i].CreatedAt)
		right := firstNonEmpty(artifacts[j].UpdatedAt, artifacts[j].CreatedAt)
		return left > right
	})
}

func (s *Service) ListChatRunArtifacts(projectID string, runID string) ([]AIChatRunArtifact, error) {
	projectID = normalizeProjectID(projectID)
	runID = strings.TrimSpace(runID)
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil {
		return []AIChatRunArtifact{}, nil
	}
	if _, err := s.GetChatRun(project.ID, runID); err != nil {
		return nil, err
	}
	artifacts, err := project.ChatArtifacts.ListByRun(runID)
	if err != nil {
		return nil, err
	}
	for i := range artifacts {
		artifacts[i] = projectChatArtifactForList(artifacts[i])
	}
	return artifacts, nil
}

func (s *Service) GetChatRunArtifact(projectID string, artifactID string) (AIChatRunArtifact, error) {
	projectID = normalizeProjectID(projectID)
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil {
		return AIChatRunArtifact{}, fmt.Errorf("AI project session is not open")
	}
	artifact, err := project.ChatArtifacts.Get(artifactID)
	if err != nil {
		return AIChatRunArtifact{}, err
	}
	if normalizeProjectID(artifact.ProjectSessionID) != project.ID {
		return AIChatRunArtifact{}, fmt.Errorf("chat artifact %q was not found", artifactID)
	}
	if _, err := s.GetChatRun(project.ID, artifact.RunID); err != nil {
		return AIChatRunArtifact{}, err
	}
	return artifact, nil
}

func projectChatArtifactForList(artifact AIChatRunArtifact) AIChatRunArtifact {
	if sensitiveChatArtifactKind(artifact.Kind) {
		artifact.PayloadJSON = ""
	}
	return artifact
}

func sensitiveChatArtifactKind(kind AIChatRunArtifactKind) bool {
	switch kind {
	case AIChatRunArtifactContext,
		AIChatRunArtifactContextCompaction,
		AIChatRunArtifactEgress,
		AIChatRunArtifactTerminal,
		AIChatRunArtifactAgentTerminal:
		return true
	default:
		return false
	}
}

func (s *Service) recordChatRunArtifact(project *ProjectSession, runID string, kind AIChatRunArtifactKind, title string, summary string, payload any) {
	if project == nil || project.ChatArtifacts == nil || strings.TrimSpace(runID) == "" || kind == "" {
		return
	}
	run, err := s.GetChatRun(project.ID, runID)
	if err != nil {
		return
	}
	if !s.runCanUseProject(project, runID) {
		return
	}
	payloadJSON := marshalChatArtifactPayload(payload)
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "artifact-" + shortHash(run.ID+":"+string(kind)+":"+title),
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Kind:             kind,
		Status:           "recorded",
		Title:            strings.TrimSpace(title),
		Summary:          strings.TrimSpace(summary),
		PayloadJSON:      payloadJSON,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if artifact.Title == "" {
		artifact.Title = string(kind)
	}
	if !s.runCanUseProject(project, runID) {
		return
	}
	if err := project.ChatArtifacts.Upsert(artifact); err == nil {
		eventName := ""
		if kind == AIChatRunArtifactMemory {
			eventName = "ai:memory:artifact-recorded"
		}
		s.emitChatArtifactChanged(project, artifact, eventName)
	}
}

func (s *Service) emitChatArtifactChanged(project *ProjectSession, artifact AIChatRunArtifact, eventName string) {
	if s == nil || project == nil || strings.TrimSpace(artifact.ID) == "" {
		return
	}
	if strings.TrimSpace(artifact.RunID) != "" && !s.runCanUseProject(project, artifact.RunID) {
		return
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            artifact.RunID,
		SessionID:        normalizeChatSessionID(artifact.SessionID),
		ProjectSessionID: project.ID,
		Source:           "artifact",
		Type:             "artifact_updated",
		Status:           artifact.Status,
		Actor:            "system",
		ArtifactID:       artifact.ID,
		Summary:          firstNonEmpty(artifact.Title, string(artifact.Kind)) + ": " + artifact.Summary,
	})
	s.emitRunEvent(project, artifact.RunID, "ai:chat:artifact-updated", projectChatArtifactForList(artifact))
	if strings.TrimSpace(eventName) != "" {
		s.emitRunEvent(project, artifact.RunID, eventName, artifact)
	}
	if strings.TrimSpace(artifact.RunID) != "" {
		s.emitRunEnvelope(project.ID, artifact.RunID)
	}
}

func marshalChatArtifactPayload(payload any) string {
	if payload == nil {
		return ""
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	if len(encoded) > maxChatArtifactPayloadBytes {
		return truncateUTF8(string(encoded), maxChatArtifactPayloadBytes)
	}
	return string(encoded)
}
