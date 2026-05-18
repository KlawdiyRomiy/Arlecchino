package ai

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	maxTargetedEditTextBytes    = 32 * 1024
	maxTargetedEditAnchorBytes  = 8 * 1024
	maxTargetedEditChangedLines = 80
	maxFileCreatePreviewBytes   = 96 * 1024
)

func (s *Service) executeFileEditPreviewTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	if req.Action == AIToolCallActionExecute {
		result.Status = "blocked"
		result.Error = "file.edit.preview only creates a review artifact"
		return result
	}
	relPath := strings.TrimSpace(req.Arguments["path"])
	if relPath == "" {
		result.Status = "blocked"
		result.Error = "file edit path is empty"
		return result
	}
	if !fileReadRangePathAllowed(relPath) {
		result.Status = "blocked"
		result.Error = "file edit path is sensitive or binary-like"
		return result
	}
	absPath, err := safeProjectPath(project.ProjectRoot, relPath)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	info, err := os.Lstat(absPath)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	if info.Mode()&os.ModeSymlink != 0 {
		result.Status = "blocked"
		result.Error = "file edit target is a symlink"
		return result
	}
	if info.IsDir() {
		result.Status = "blocked"
		result.Error = "file edit target is a directory"
		return result
	}
	if info.Size() > maxPatchCheckpointBytes {
		result.Status = "blocked"
		result.Error = "file edit target exceeds checkpoint limit"
		return result
	}
	before, err := os.ReadFile(absPath)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	if bytes.IndexByte(before, 0) >= 0 {
		result.Status = "blocked"
		result.Error = "file edit target appears binary"
		return result
	}
	after, summary, err := applyTargetedEdit(before, req.Arguments)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	diff, err := buildGitStyleContentPatch(project.ProjectRoot, relPath, before, after)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	preview, err := s.PreviewPatch(project.ID, AIPatchPreviewRequest{
		RunID:       req.RunID,
		Title:       firstNonEmpty(req.Arguments["title"], "Targeted edit preview"),
		Summary:     firstNonEmpty(req.Arguments["summary"], summary),
		UnifiedDiff: diff,
	})
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	result.Status = preview.Artifact.Status
	result.ArtifactID = preview.Artifact.ID
	result.OutputPreview = preview.Artifact.Summary
	return result
}

func (s *Service) executeFileCreatePreviewTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	if req.Action == AIToolCallActionExecute {
		result.Status = "blocked"
		result.Error = "file.create.preview only creates a review artifact"
		return result
	}
	relPath := strings.TrimSpace(req.Arguments["path"])
	if relPath == "" {
		result.Status = "blocked"
		result.Error = "file create path is empty"
		return result
	}
	if strings.Contains(relPath, " ") {
		result.Status = "blocked"
		result.Error = "file create path with spaces is not supported in git-style preview"
		return result
	}
	if !fileReadRangePathAllowed(relPath) {
		result.Status = "blocked"
		result.Error = "file create path is sensitive or binary-like"
		return result
	}
	absPath, err := safeProjectPath(project.ProjectRoot, relPath)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	if _, err := os.Lstat(absPath); err == nil {
		result.Status = "blocked"
		result.Error = "file create target already exists"
		return result
	} else if !os.IsNotExist(err) {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	content := req.Arguments["content"]
	if strings.TrimSpace(content) == "" {
		result.Status = "blocked"
		result.Error = "file create content is empty"
		return result
	}
	if len(content) > maxFileCreatePreviewBytes {
		result.Status = "blocked"
		result.Error = fmt.Sprintf("file create content exceeds %d bytes", maxFileCreatePreviewBytes)
		return result
	}
	if bytes.IndexByte([]byte(content), 0) >= 0 {
		result.Status = "blocked"
		result.Error = "file create content appears binary"
		return result
	}
	diff := buildGitStyleCreatePatch(relPath, content)
	preview, err := s.PreviewPatch(project.ID, AIPatchPreviewRequest{
		RunID:       req.RunID,
		Title:       firstNonEmpty(req.Arguments["title"], "New file preview"),
		Summary:     firstNonEmpty(req.Arguments["summary"], fmt.Sprintf("create %s", filepath.ToSlash(relPath))),
		UnifiedDiff: diff,
	})
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	result.Status = preview.Artifact.Status
	result.ArtifactID = preview.Artifact.ID
	result.OutputPreview = preview.Artifact.Summary
	return result
}

func applyTargetedEdit(before []byte, arguments map[string]string) ([]byte, string, error) {
	operation := strings.TrimSpace(arguments["operation"])
	if operation == "" {
		operation = "replace"
	}
	oldText := arguments["oldText"]
	newText := arguments["newText"]
	if len(oldText) > maxTargetedEditTextBytes || len(newText) > maxTargetedEditTextBytes {
		return nil, "", fmt.Errorf("targeted edit text exceeds %d bytes", maxTargetedEditTextBytes)
	}
	if bytes.IndexByte([]byte(newText), 0) >= 0 {
		return nil, "", fmt.Errorf("targeted edit replacement appears binary")
	}
	content := string(before)
	var after string
	switch operation {
	case "replace":
		if oldText == "" {
			return nil, "", fmt.Errorf("replace operation requires oldText")
		}
		count := strings.Count(content, oldText)
		if count == 0 {
			return nil, "", fmt.Errorf("oldText was not found")
		}
		if count > 1 {
			return nil, "", fmt.Errorf("oldText matched %d times; narrow the edit", count)
		}
		after = strings.Replace(content, oldText, newText, 1)
	case "insert_before", "insert_after":
		if oldText == "" {
			return nil, "", fmt.Errorf("%s operation requires oldText anchor", operation)
		}
		count := strings.Count(content, oldText)
		if count == 0 {
			return nil, "", fmt.Errorf("anchor text was not found")
		}
		if count > 1 {
			return nil, "", fmt.Errorf("anchor text matched %d times; narrow the edit", count)
		}
		anchorIndex := strings.Index(content, oldText)
		newText = normalizeTargetedInsertionText(content, anchorIndex, oldText, newText, operation)
		replacement := newText + oldText
		if operation == "insert_after" {
			replacement = oldText + newText
		}
		after = content[:anchorIndex] + replacement + content[anchorIndex+len(oldText):]
	case "append":
		if newText == "" {
			return nil, "", fmt.Errorf("append operation requires newText")
		}
		after = content + newText
	default:
		return nil, "", fmt.Errorf("unsupported file edit operation: %s", operation)
	}
	if after == content {
		return nil, "", fmt.Errorf("targeted edit produced no changes")
	}
	if err := validateTargetedEditScope(content, after, operation, oldText, newText); err != nil {
		return nil, "", err
	}
	return []byte(after), targetedEditSummary(operation, oldText, newText), nil
}

func normalizeTargetedInsertionText(content string, anchorIndex int, oldText string, newText string, operation string) string {
	if anchorIndex < 0 || oldText == "" || newText == "" {
		return newText
	}
	switch operation {
	case "insert_after":
		if hasLeadingLineBreak(newText) {
			return newText
		}
		tail := content[anchorIndex+len(oldText):]
		if insertionAfterNeedsLineBreak(content, anchorIndex, oldText, tail, newText) {
			return lineBreakAtAfterBoundary(content, tail) + newText
		}
	case "insert_before":
		if hasTrailingLineBreak(newText) {
			return newText
		}
		head := content[:anchorIndex]
		if insertionBeforeNeedsLineBreak(content, anchorIndex, oldText, head, newText) {
			return newText + lineBreakAtBeforeBoundary(content, head)
		}
	}
	return newText
}

func insertionAfterNeedsLineBreak(content string, anchorIndex int, oldText string, tail string, newText string) bool {
	if !isAfterLineBoundary(tail) {
		return false
	}
	return targetedInsertionLooksStandaloneLine(newText) || anchorOccupiesLineBoundary(content, anchorIndex, oldText)
}

func insertionBeforeNeedsLineBreak(content string, anchorIndex int, oldText string, head string, newText string) bool {
	if !isBeforeLineBoundary(head) {
		return false
	}
	return targetedInsertionLooksStandaloneLine(newText) || anchorOccupiesLineBoundary(content, anchorIndex, oldText)
}

func targetedInsertionLooksStandaloneLine(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	if strings.Contains(trimmed, "\n") || strings.Contains(trimmed, "\r") {
		return true
	}
	for _, prefix := range []string{"//", "#", "<!--", "/*", "*", "--", ";", `"""`, "'''"} {
		if strings.HasPrefix(trimmed, prefix) {
			return true
		}
	}
	return false
}

func anchorOccupiesLineBoundary(content string, anchorIndex int, oldText string) bool {
	end := anchorIndex + len(oldText)
	return isBeforeLineBoundary(content[:anchorIndex]) && isAfterLineBoundary(content[end:])
}

func isAfterLineBoundary(tail string) bool {
	return tail == "" || strings.HasPrefix(tail, "\n") || strings.HasPrefix(tail, "\r\n")
}

func isBeforeLineBoundary(head string) bool {
	return head == "" || strings.HasSuffix(head, "\n")
}

func hasLeadingLineBreak(value string) bool {
	return strings.HasPrefix(value, "\n") || strings.HasPrefix(value, "\r\n")
}

func hasTrailingLineBreak(value string) bool {
	return strings.HasSuffix(value, "\n") || strings.HasSuffix(value, "\r")
}

func lineBreakAtAfterBoundary(content string, tail string) string {
	if strings.HasPrefix(tail, "\r\n") {
		return "\r\n"
	}
	if strings.HasPrefix(tail, "\n") {
		return "\n"
	}
	return defaultLineBreak(content)
}

func lineBreakAtBeforeBoundary(content string, head string) string {
	if strings.HasSuffix(head, "\r\n") {
		return "\r\n"
	}
	if strings.HasSuffix(head, "\n") {
		return "\n"
	}
	return defaultLineBreak(content)
}

func defaultLineBreak(content string) string {
	if strings.Contains(content, "\r\n") {
		return "\r\n"
	}
	return "\n"
}

func validateTargetedEditScope(before string, after string, operation string, oldText string, newText string) error {
	if strings.TrimSpace(oldText) != "" && strings.TrimSpace(oldText) == strings.TrimSpace(before) {
		return fmt.Errorf("targeted edit cannot replace the whole file; use a reviewed patch for broad rewrites")
	}
	if len(oldText) > maxTargetedEditAnchorBytes {
		return fmt.Errorf("targeted edit anchor is %d bytes; narrow the anchor below %d bytes", len(oldText), maxTargetedEditAnchorBytes)
	}
	changedLines := targetedEditChangedLineEstimate(operation, oldText, newText)
	if changedLines > maxTargetedEditChangedLines {
		return fmt.Errorf("targeted edit changes about %d lines; split into smaller edits or use a reviewed patch", changedLines)
	}
	if lineCount(after) > 0 && len(newText) > len(before)/2 && changedLines > 12 {
		return fmt.Errorf("targeted edit replacement is too broad for a narrow edit")
	}
	return nil
}

func targetedEditChangedLineEstimate(operation string, oldText string, newText string) int {
	switch operation {
	case "replace":
		return maxInt(lineCount(oldText), lineCount(newText))
	default:
		return lineCount(newText)
	}
}

func lineCount(value string) int {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.TrimSuffix(value, "\n")
	if value == "" {
		return 0
	}
	return strings.Count(value, "\n") + 1
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func targetedEditSummary(operation string, oldText string, newText string) string {
	switch operation {
	case "insert_before", "insert_after":
		return fmt.Sprintf("%s near %d-byte anchor", operation, len(oldText))
	case "append":
		return fmt.Sprintf("append %d bytes", len(newText))
	default:
		return fmt.Sprintf("replace %d bytes with %d bytes", len(oldText), len(newText))
	}
}

func buildGitStyleContentPatch(projectRoot string, relPath string, before []byte, after []byte) (string, error) {
	if bytes.Equal(before, after) {
		return "", fmt.Errorf("content patch has no changes")
	}
	tmpDir, err := os.MkdirTemp("", "arlecchino-ai-edit-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpDir)
	oldPath := filepath.Join(tmpDir, "old")
	newPath := filepath.Join(tmpDir, "new")
	if err := os.WriteFile(oldPath, before, 0o600); err != nil {
		return "", err
	}
	if err := os.WriteFile(newPath, after, 0o600); err != nil {
		return "", err
	}
	cmd := exec.Command("git", "diff", "--no-index", "--no-ext-diff", "--", oldPath, newPath)
	cmd.Dir = projectRoot
	output, err := cmd.CombinedOutput()
	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		if !ok || exitErr.ExitCode() != 1 {
			message := strings.TrimSpace(string(output))
			if message == "" {
				message = err.Error()
			}
			return "", fmt.Errorf("%s", message)
		}
	}
	diff := strings.TrimSpace(string(output))
	if diff == "" {
		return "", fmt.Errorf("content patch has no diff")
	}
	return ensurePatchTrailingNewline(rewriteNoIndexDiffPaths(diff, relPath)), nil
}

func buildGitStyleCreatePatch(relPath string, content string) string {
	relPath = filepath.ToSlash(strings.TrimSpace(relPath))
	content = strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	lines := strings.Split(strings.TrimSuffix(content, "\n"), "\n")
	var builder strings.Builder
	builder.WriteString("diff --git a/" + relPath + " b/" + relPath + "\n")
	builder.WriteString("new file mode 100644\n")
	builder.WriteString("index 0000000..0000000\n")
	builder.WriteString("--- /dev/null\n")
	builder.WriteString("+++ b/" + relPath + "\n")
	builder.WriteString(fmt.Sprintf("@@ -0,0 +1,%d @@\n", len(lines)))
	for _, line := range lines {
		builder.WriteString("+" + line + "\n")
	}
	return builder.String()
}

func rewriteNoIndexDiffPaths(diff string, relPath string) string {
	relPath = filepath.ToSlash(strings.TrimSpace(relPath))
	lines := strings.Split(diff, "\n")
	for index, line := range lines {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			lines[index] = "diff --git a/" + relPath + " b/" + relPath
		case strings.HasPrefix(line, "--- "):
			lines[index] = "--- a/" + relPath
		case strings.HasPrefix(line, "+++ "):
			lines[index] = "+++ b/" + relPath
		}
	}
	return strings.Join(lines, "\n")
}
