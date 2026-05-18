package ai

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxPatchPreviewBytes     = 256 * 1024
	maxPatchCheckpointBytes  = 2 * 1024 * 1024
	patchCheckpointDirectory = "patch_checkpoints"
)

type patchCheckpointPayload struct {
	ID               string `json:"id"`
	ArtifactID       string `json:"artifactId"`
	ProjectSessionID string `json:"projectSessionId"`
	Path             string `json:"path"`
	OriginalHash     string `json:"originalHash,omitempty"`
	Existed          bool   `json:"existed"`
	Mode             uint32 `json:"mode,omitempty"`
	ContentBase64    string `json:"contentBase64,omitempty"`
	CreatedAt        string `json:"createdAt"`
}

func (s *Service) PreviewPatch(projectID string, req AIPatchPreviewRequest) (AIPatchPreviewResult, error) {
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil {
		return AIPatchPreviewResult{}, fmt.Errorf("AI project session is not open")
	}
	run, err := s.GetChatRun(project.ID, req.RunID)
	if err != nil {
		return AIPatchPreviewResult{}, err
	}
	diff := strings.TrimSpace(req.UnifiedDiff)
	if diff == "" {
		return AIPatchPreviewResult{}, fmt.Errorf("patch diff is empty")
	}
	diff = ensurePatchTrailingNewline(diff)
	if len(diff) > maxPatchPreviewBytes {
		return AIPatchPreviewResult{}, fmt.Errorf("patch diff exceeds %d bytes", maxPatchPreviewBytes)
	}
	files, err := s.validatePatchFiles(project, diff)
	if err != nil {
		return AIPatchPreviewResult{}, err
	}
	payload := AIPatchArtifactPayload{
		UnifiedDiff: diff,
		Files:       files,
		CheckReady:  true,
	}
	if err := runGitApplyCheck(project.ProjectRoot, diff); err != nil {
		payload.CheckReady = false
		payload.CheckError = sanitizedDisplayText(err.Error())
	}
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "patch-" + uuid.NewString(),
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactPatchPreview,
		Status:           patchArtifactStatus(payload),
		Title:            firstNonEmpty(strings.TrimSpace(req.Title), "Patch preview"),
		Summary:          firstNonEmpty(strings.TrimSpace(req.Summary), patchPreviewSummary(payload)),
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIPatchPreviewResult{}, err
	}
	return AIPatchPreviewResult{Artifact: artifact, Payload: payload}, nil
}

func (s *Service) ApplyPatchArtifact(projectID string, req AIPatchApplyRequest) (AIPatchApplyResult, error) {
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil {
		return AIPatchApplyResult{}, fmt.Errorf("AI project session is not open")
	}
	artifact, err := s.GetChatRunArtifact(project.ID, req.ArtifactID)
	if err != nil {
		return AIPatchApplyResult{}, err
	}
	if artifact.Kind != AIChatRunArtifactPatchPreview {
		return AIPatchApplyResult{}, fmt.Errorf("chat artifact %q is not a patch preview", artifact.ID)
	}
	payload, err := patchPayloadFromArtifact(artifact)
	if err != nil {
		return AIPatchApplyResult{}, err
	}
	if !payload.CheckReady {
		return AIPatchApplyResult{ArtifactID: artifact.ID, Status: "blocked", Error: payload.CheckError}, fmt.Errorf("patch artifact is not check-ready: %s", payload.CheckError)
	}
	files, err := s.validatePatchFiles(project, payload.UnifiedDiff)
	if err != nil {
		return AIPatchApplyResult{}, err
	}
	if err := verifyPatchFileHashes(files, payload.Files); err != nil {
		return AIPatchApplyResult{ArtifactID: artifact.ID, Status: "blocked", Error: err.Error()}, err
	}
	if err := runGitApplyCheck(project.ProjectRoot, payload.UnifiedDiff); err != nil {
		return AIPatchApplyResult{ArtifactID: artifact.ID, Status: "blocked", Error: sanitizedDisplayText(err.Error())}, err
	}
	checkpointIDs := []string{}
	for _, file := range files {
		checkpointID, err := s.createPatchCheckpoint(project, artifact.ID, file.Path)
		if err != nil {
			return AIPatchApplyResult{ArtifactID: artifact.ID, Status: "checkpoint_error", Error: err.Error()}, err
		}
		checkpointIDs = append(checkpointIDs, checkpointID)
	}
	if err := runGitApply(project.ProjectRoot, payload.UnifiedDiff); err != nil {
		return AIPatchApplyResult{ArtifactID: artifact.ID, Status: "apply_error", CheckpointIDs: checkpointIDs, Error: sanitizedDisplayText(err.Error())}, err
	}
	payload.Files = files
	payload.CheckpointIDs = checkpointIDs
	payload.AppliedAt = utcNow()
	artifact.Status = "applied"
	artifact.Summary = patchPreviewSummary(payload)
	artifact.PayloadJSON = marshalChatArtifactPayload(payload)
	artifact.UpdatedAt = payload.AppliedAt
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIPatchApplyResult{ArtifactID: artifact.ID, Status: "artifact_update_error", CheckpointIDs: checkpointIDs, Error: err.Error()}, err
	}
	s.emitPatchApplyEvents(project, artifact, files, payload.AppliedAt)
	return AIPatchApplyResult{
		ArtifactID:    artifact.ID,
		Status:        "applied",
		CheckpointIDs: checkpointIDs,
		AppliedAt:     payload.AppliedAt,
	}, nil
}

func (s *Service) emitPatchApplyEvents(project *ProjectSession, artifact AIChatRunArtifact, files []AIPatchFile, appliedAt string) {
	if s == nil || project == nil {
		return
	}
	eventFiles := make([]map[string]any, 0, len(files))
	for _, file := range files {
		absPath, err := safeProjectPath(project.ProjectRoot, file.Path)
		if err != nil {
			continue
		}
		eventFiles = append(eventFiles, map[string]any{
			"path":         file.Path,
			"absolutePath": absPath,
			"status":       file.Status,
			"created":      !file.Exists,
		})
		if file.Exists {
			s.emitEvent("file:changed", absPath)
		} else {
			s.emitEvent("project:entry:created", map[string]any{
				"path":        absPath,
				"isDirectory": false,
			})
		}
	}
	s.emitEvent("ai:patch:artifact-applied", map[string]any{
		"artifactId":       artifact.ID,
		"runId":            artifact.RunID,
		"sessionId":        artifact.SessionID,
		"projectSessionId": project.ID,
		"appliedAt":        appliedAt,
		"files":            eventFiles,
	})
}

func (s *Service) RollbackPatchCheckpoint(projectID string, req AIPatchRollbackRequest) (AIPatchRollbackResult, error) {
	project := s.project(projectID)
	if project == nil {
		return AIPatchRollbackResult{}, fmt.Errorf("AI project session is not open")
	}
	checkpoint, err := readPatchCheckpoint(project.ProjectRoot, req.CheckpointID)
	if err != nil {
		return AIPatchRollbackResult{}, err
	}
	if checkpoint.ProjectSessionID != project.ID {
		return AIPatchRollbackResult{}, fmt.Errorf("patch checkpoint %q was not found", req.CheckpointID)
	}
	absPath, err := safeProjectPath(project.ProjectRoot, checkpoint.Path)
	if err != nil {
		return AIPatchRollbackResult{}, err
	}
	if checkpoint.Existed {
		content, err := base64.StdEncoding.DecodeString(checkpoint.ContentBase64)
		if err != nil {
			return AIPatchRollbackResult{}, err
		}
		if err := os.MkdirAll(filepath.Dir(absPath), 0o700); err != nil {
			return AIPatchRollbackResult{}, err
		}
		if err := os.WriteFile(absPath, content, os.FileMode(checkpoint.Mode)); err != nil {
			return AIPatchRollbackResult{}, err
		}
	} else if err := os.Remove(absPath); err != nil && !os.IsNotExist(err) {
		return AIPatchRollbackResult{}, err
	}
	rolledBackAt := utcNow()
	if project.ChatArtifacts != nil && strings.TrimSpace(checkpoint.ArtifactID) != "" {
		if artifact, artifactErr := project.ChatArtifacts.Get(checkpoint.ArtifactID); artifactErr == nil {
			if payload, payloadErr := patchPayloadFromArtifact(artifact); payloadErr == nil {
				payload.RolledBackAt = rolledBackAt
				artifact.Status = "rolled_back"
				artifact.Summary = patchPreviewSummary(payload)
				artifact.PayloadJSON = marshalChatArtifactPayload(payload)
				artifact.UpdatedAt = rolledBackAt
				_ = project.ChatArtifacts.Upsert(artifact)
			}
		}
	}
	return AIPatchRollbackResult{
		CheckpointID: checkpoint.ID,
		Path:         checkpoint.Path,
		Status:       "rolled_back",
		RolledBackAt: rolledBackAt,
	}, nil
}

func (s *Service) validatePatchFiles(project *ProjectSession, diff string) ([]AIPatchFile, error) {
	if strings.Contains(diff, "\nGIT binary patch") || strings.Contains(diff, "\nBinary files ") {
		return nil, fmt.Errorf("binary patches are not supported")
	}
	paths, err := patchPaths(diff)
	if err != nil {
		return nil, err
	}
	files := make([]AIPatchFile, 0, len(paths))
	for _, relPath := range paths {
		absPath, err := safeProjectPath(project.ProjectRoot, relPath)
		if err != nil {
			return nil, err
		}
		file := AIPatchFile{Path: relPath, Status: "modify"}
		info, err := os.Lstat(absPath)
		if err == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				return nil, fmt.Errorf("patch target is a symlink: %s", relPath)
			}
			if info.IsDir() {
				return nil, fmt.Errorf("patch target is a directory: %s", relPath)
			}
			if info.Size() > maxPatchCheckpointBytes {
				return nil, fmt.Errorf("patch target exceeds checkpoint limit: %s", relPath)
			}
			content, readErr := os.ReadFile(absPath)
			if readErr != nil {
				return nil, readErr
			}
			if bytes.IndexByte(content, 0) >= 0 {
				return nil, fmt.Errorf("patch target appears binary: %s", relPath)
			}
			file.Exists = true
			file.OriginalHash = contentHash(content)
			file.Bytes = len(content)
			file.Mode = uint32(info.Mode().Perm())
		} else if os.IsNotExist(err) {
			file.Status = "create"
			file.OriginalHash = "missing"
		} else {
			return nil, err
		}
		files = append(files, file)
	}
	return files, nil
}

func patchPaths(diff string) ([]string, error) {
	seen := map[string]struct{}{}
	paths := []string{}
	for _, line := range strings.Split(diff, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "diff --git ") {
			fields := strings.Fields(line)
			if len(fields) < 4 {
				return nil, fmt.Errorf("unsupported patch header: %s", line)
			}
			for _, candidate := range []string{fields[3], fields[2]} {
				relPath, ok := normalizePatchPath(candidate)
				if !ok {
					continue
				}
				if _, exists := seen[relPath]; !exists {
					seen[relPath] = struct{}{}
					paths = append(paths, relPath)
				}
				break
			}
		}
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("patch does not contain git-style file headers")
	}
	return paths, nil
}

func normalizePatchPath(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" || value == "/dev/null" {
		return "", false
	}
	if strings.HasPrefix(value, "\"") || strings.Contains(value, "\t") {
		return "", false
	}
	value = strings.TrimPrefix(value, "a/")
	value = strings.TrimPrefix(value, "b/")
	clean := filepath.Clean(value)
	if clean == "." || filepath.IsAbs(clean) || clean == ".git" || strings.HasPrefix(clean, "..") || strings.Contains(clean, string(filepath.Separator)+".."+string(filepath.Separator)) || strings.HasPrefix(clean, ".git"+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(clean), true
}

func safeProjectPath(projectRoot string, relPath string) (string, error) {
	relPath, ok := normalizePatchPath(relPath)
	if !ok {
		return "", fmt.Errorf("unsafe patch path: %s", relPath)
	}
	absPath := filepath.Join(projectRoot, filepath.FromSlash(relPath))
	rel, err := filepath.Rel(projectRoot, absPath)
	if err != nil {
		return "", err
	}
	if rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", fmt.Errorf("patch path escapes project: %s", relPath)
	}
	return absPath, nil
}

func verifyPatchFileHashes(current []AIPatchFile, preview []AIPatchFile) error {
	byPath := map[string]AIPatchFile{}
	for _, file := range preview {
		byPath[file.Path] = file
	}
	for _, file := range current {
		previous, ok := byPath[file.Path]
		if !ok {
			return fmt.Errorf("patch target changed since preview: %s", file.Path)
		}
		if previous.OriginalHash != file.OriginalHash {
			return fmt.Errorf("patch target changed since preview: %s", file.Path)
		}
	}
	return nil
}

func runGitApplyCheck(projectRoot string, diff string) error {
	return runGitApplyCommand(projectRoot, diff, "--check", "--whitespace=nowarn")
}

func runGitApply(projectRoot string, diff string) error {
	return runGitApplyCommand(projectRoot, diff, "--whitespace=nowarn")
}

func runGitApplyCommand(projectRoot string, diff string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", projectRoot, "apply"}, args...)...)
	cmd.Stdin = strings.NewReader(ensurePatchTrailingNewline(diff))
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("%s", message)
	}
	return nil
}

func ensurePatchTrailingNewline(diff string) string {
	if strings.HasSuffix(diff, "\n") {
		return diff
	}
	return diff + "\n"
}

func extractGitDiffPatch(value string) (string, bool) {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	start := strings.Index(value, "diff --git ")
	if start < 0 {
		return "", false
	}
	patch := strings.TrimSpace(value[start:])
	if end := strings.Index(patch, "\n```"); end >= 0 {
		patch = strings.TrimSpace(patch[:end])
	}
	if patch == "" {
		return "", false
	}
	return ensurePatchTrailingNewline(patch), true
}

func patchPayloadFromArtifact(artifact AIChatRunArtifact) (AIPatchArtifactPayload, error) {
	var payload AIPatchArtifactPayload
	if strings.TrimSpace(artifact.PayloadJSON) == "" {
		return payload, fmt.Errorf("patch artifact payload is empty")
	}
	if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
		return payload, err
	}
	return payload, nil
}

func (s *Service) createPatchCheckpoint(project *ProjectSession, artifactID string, relPath string) (string, error) {
	absPath, err := safeProjectPath(project.ProjectRoot, relPath)
	if err != nil {
		return "", err
	}
	payload := patchCheckpointPayload{
		ID:               "checkpoint-" + uuid.NewString(),
		ArtifactID:       artifactID,
		ProjectSessionID: project.ID,
		Path:             relPath,
		CreatedAt:        utcNow(),
	}
	info, err := os.Lstat(absPath)
	if err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("cannot checkpoint symlink: %s", relPath)
		}
		if info.IsDir() {
			return "", fmt.Errorf("cannot checkpoint directory: %s", relPath)
		}
		if info.Size() > maxPatchCheckpointBytes {
			return "", fmt.Errorf("checkpoint source exceeds %d bytes: %s", maxPatchCheckpointBytes, relPath)
		}
		content, readErr := os.ReadFile(absPath)
		if readErr != nil {
			return "", readErr
		}
		payload.Existed = true
		payload.Mode = uint32(info.Mode().Perm())
		payload.OriginalHash = contentHash(content)
		payload.ContentBase64 = base64.StdEncoding.EncodeToString(content)
	} else if !os.IsNotExist(err) {
		return "", err
	}
	path := patchCheckpointPath(project.ProjectRoot, payload.ID)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return "", err
	}
	return payload.ID, nil
}

func readPatchCheckpoint(projectRoot string, checkpointID string) (patchCheckpointPayload, error) {
	checkpointID = strings.TrimSpace(checkpointID)
	if checkpointID == "" || strings.Contains(checkpointID, string(filepath.Separator)) || strings.Contains(checkpointID, "..") {
		return patchCheckpointPayload{}, fmt.Errorf("invalid patch checkpoint id")
	}
	data, err := os.ReadFile(patchCheckpointPath(projectRoot, checkpointID))
	if err != nil {
		return patchCheckpointPayload{}, err
	}
	var payload patchCheckpointPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return patchCheckpointPayload{}, err
	}
	return payload, nil
}

func patchCheckpointPath(projectRoot string, checkpointID string) string {
	return filepath.Join(projectRoot, ".arlecchino", "ai", patchCheckpointDirectory, checkpointID+".json")
}

func contentHash(content []byte) string {
	sum := sha1.Sum(content)
	return hex.EncodeToString(sum[:])
}

func patchArtifactStatus(payload AIPatchArtifactPayload) string {
	if payload.RolledBackAt != "" {
		return "rolled_back"
	}
	if payload.AppliedAt != "" {
		return "applied"
	}
	if payload.CheckReady {
		return "ready"
	}
	return "blocked"
}

func patchPreviewSummary(payload AIPatchArtifactPayload) string {
	parts := []string{fmt.Sprintf("%d file%s", len(payload.Files), pluralSuffix(len(payload.Files)))}
	if payload.CheckReady {
		parts = append(parts, "check-ready")
	} else if payload.CheckError != "" {
		parts = append(parts, "blocked")
	}
	if len(payload.CheckpointIDs) > 0 {
		parts = append(parts, fmt.Sprintf("%d checkpoint%s", len(payload.CheckpointIDs), pluralSuffix(len(payload.CheckpointIDs))))
	}
	if payload.AppliedAt != "" {
		parts = append(parts, "applied")
	}
	if payload.RolledBackAt != "" {
		parts = append(parts, "rolled back")
	}
	return strings.Join(parts, ", ")
}

func pluralSuffix(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}
