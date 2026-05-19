package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	maxBuildEditFallbackBlockLines = 240
	maxBuildEditFallbackFileLines  = 6000
	minBuildEditFallbackMatches    = 2
)

type buildEditFallbackOutcome struct {
	Calls     []chatToolCallRequest
	Message   string
	Attempted bool
	Err       error
}

type buildEditFallbackPlan struct {
	Intent  string                  `json:"intent"`
	Message string                  `json:"message,omitempty"`
	Path    string                  `json:"path,omitempty"`
	Edit    *buildEditFallbackEdit  `json:"edit,omitempty"`
	Edits   []buildEditFallbackEdit `json:"edits,omitempty"`
}

type buildEditFallbackEdit struct {
	Position  string `json:"position,omitempty"`
	Operation string `json:"operation,omitempty"`
	OldText   string `json:"oldText,omitempty"`
	Anchor    string `json:"anchor,omitempty"`
	NewText   string `json:"newText,omitempty"`
	Text      string `json:"text,omitempty"`
	Content   string `json:"content,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Type      string `json:"type,omitempty"`
	Comment   bool   `json:"comment,omitempty"`
}

type buildEditFallbackJSONCandidate struct {
	Text   string
	Strict bool
}

type buildEditFallbackJSONParseResult struct {
	Plan    buildEditFallbackPlan
	Found   bool
	Invalid bool
	Err     error
}

type buildEditFallbackLineMatch struct {
	FileIndex  int
	BlockIndex int
}

func (s *Service) resolveBuildEditFallback(project *ProjectSession, runID string, req AIChatRunRequest, snapshot AIContextSnapshot, response string) buildEditFallbackOutcome {
	if project == nil || !buildUsesFastCurrentFileEditToolset(req) || strings.TrimSpace(response) == "" {
		return buildEditFallbackOutcome{}
	}
	parsed := parseBuildEditFallbackJSON(response)
	if parsed.Invalid {
		return buildEditFallbackOutcome{Attempted: true, Err: fmt.Errorf("model returned invalid fallback edit JSON: %w", parsed.Err)}
	}
	if parsed.Found {
		if fallbackPlanIntent(parsed.Plan) == "answer" {
			return buildEditFallbackOutcome{}
		}
		return buildEditFallbackOutcomeFromPlan(project, req, snapshot, parsed.Plan)
	}
	return buildEditFallbackOutcomeFromCodeBlocks(project, req, snapshot, response)
}

func parseBuildEditFallbackJSON(response string) buildEditFallbackJSONParseResult {
	for _, candidate := range buildEditFallbackJSONCandidates(response) {
		var probe map[string]json.RawMessage
		if err := json.Unmarshal([]byte(candidate.Text), &probe); err != nil {
			if candidate.Strict || buildEditFallbackJSONLooksLikePlan(candidate.Text) {
				return buildEditFallbackJSONParseResult{Invalid: true, Err: err}
			}
			continue
		}
		if !buildEditFallbackJSONMapLooksLikePlan(probe) {
			continue
		}
		var plan buildEditFallbackPlan
		if err := json.Unmarshal([]byte(candidate.Text), &plan); err != nil {
			return buildEditFallbackJSONParseResult{Invalid: true, Err: err}
		}
		return buildEditFallbackJSONParseResult{Plan: plan, Found: true}
	}
	return buildEditFallbackJSONParseResult{}
}

func buildEditFallbackJSONCandidates(response string) []buildEditFallbackJSONCandidate {
	trimmed := strings.TrimSpace(response)
	candidates := []buildEditFallbackJSONCandidate{}
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		candidates = append(candidates, buildEditFallbackJSONCandidate{Text: trimmed, Strict: true})
	}
	for _, block := range fencedCodeBlocks(response) {
		language := normalizeToolArgumentToken(firstField(block.Language))
		switch language {
		case "arlecchino_edit", "arlecchino_tool", "json":
			candidates = append(candidates, buildEditFallbackJSONCandidate{
				Text:   strings.TrimSpace(block.Content),
				Strict: language != "json",
			})
		}
	}
	return candidates
}

func buildEditFallbackJSONMapLooksLikePlan(value map[string]json.RawMessage) bool {
	if len(value) == 0 {
		return false
	}
	if _, ok := value["intent"]; ok {
		return true
	}
	if _, ok := value["edit"]; ok {
		return true
	}
	if _, ok := value["edits"]; ok {
		return true
	}
	return false
}

func buildEditFallbackJSONLooksLikePlan(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, `"intent"`) || strings.Contains(lower, `"edit"`) || strings.Contains(lower, `"edits"`)
}

func buildEditFallbackOutcomeFromPlan(project *ProjectSession, req AIChatRunRequest, snapshot AIContextSnapshot, plan buildEditFallbackPlan) buildEditFallbackOutcome {
	intent := fallbackPlanIntent(plan)
	switch intent {
	case "edit":
	case "unsupported":
		return buildEditFallbackOutcome{Attempted: true, Err: fmt.Errorf("model did not produce a reviewable edit operation; no file was changed")}
	default:
		return buildEditFallbackOutcome{Attempted: true, Err: fmt.Errorf("unsupported fallback edit intent %q; no file was changed", firstNonEmpty(intent, "empty"))}
	}
	relPath, before, language, err := loadBuildEditFallbackTarget(project, req, snapshot, plan.Path)
	if err != nil {
		return buildEditFallbackOutcome{Attempted: true, Err: err}
	}
	edits := append([]buildEditFallbackEdit{}, plan.Edits...)
	if plan.Edit != nil {
		edits = append([]buildEditFallbackEdit{*plan.Edit}, edits...)
	}
	call, err := buildEditFallbackToolCall(relPath, language, string(before), edits, firstNonEmpty(plan.Message, "Generated from structured edit fallback."))
	if err != nil {
		return buildEditFallbackOutcome{Attempted: true, Err: err}
	}
	return buildEditFallbackOutcome{
		Calls:     []chatToolCallRequest{call},
		Message:   firstNonEmpty(plan.Message, "Prepared fallback edit preview."),
		Attempted: true,
	}
}

func fallbackPlanIntent(plan buildEditFallbackPlan) string {
	intent := normalizeToolArgumentToken(plan.Intent)
	if intent == "" && (plan.Edit != nil || len(plan.Edits) > 0) {
		return "edit"
	}
	return intent
}

func buildEditFallbackOutcomeFromCodeBlocks(project *ProjectSession, req AIChatRunRequest, snapshot AIContextSnapshot, response string) buildEditFallbackOutcome {
	var firstErr error
	attempted := false
	for _, block := range fencedCodeBlocks(response) {
		if !buildEditFallbackCodeBlockCandidate(block, response) {
			continue
		}
		fullFileLike := codeBlockLooksLikeFullFile(block, response)
		relPath, before, language, err := loadBuildEditFallbackTarget(project, req, snapshot, "")
		if err != nil {
			return buildEditFallbackOutcome{Attempted: true, Err: err}
		}
		if fullFileLike && len(comparableLines(block.Content)) >= len(comparableLines(string(before))) {
			continue
		}
		call, err := buildEditFallbackToolCallFromCodeBlock(relPath, firstNonEmpty(language, block.Language), string(before), block.Content)
		if err == nil {
			return buildEditFallbackOutcome{
				Calls:     []chatToolCallRequest{call},
				Message:   "Prepared fallback edit preview.",
				Attempted: true,
			}
		}
		if fullFileLike {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		attempted = true
		if firstErr == nil {
			firstErr = err
		}
	}
	if attempted {
		return buildEditFallbackOutcome{Attempted: true, Err: firstNonEmptyError(firstErr, fmt.Errorf("model did not produce a reviewable edit operation; no file was changed"))}
	}
	return buildEditFallbackOutcome{}
}

func buildEditFallbackCodeBlockCandidate(block fencedCodeBlock, response string) bool {
	if strings.TrimSpace(block.Content) == "" {
		return false
	}
	language := strings.ToLower(strings.TrimSpace(firstField(block.Language)))
	if language == "" {
		return buildEditFallbackCodeBlockHasSourceSignal(block.Content)
	}
	return sourceOrDocumentLanguageHint(language)
}

func buildEditFallbackCodeBlockHasSourceSignal(content string) bool {
	lower := strings.ToLower(content)
	return strings.Contains(lower, "\npackage ") ||
		strings.Contains(lower, "\nimport ") ||
		strings.Contains(lower, "\nfunc ") ||
		strings.Contains(lower, "\nclass ") ||
		strings.Contains(lower, "\nfunction ") ||
		strings.Contains(lower, "\nexport ") ||
		strings.Contains(lower, "\n# ") ||
		strings.Contains(lower, "\n// ") ||
		strings.Contains(lower, "\n<!--")
}

func loadBuildEditFallbackTarget(project *ProjectSession, req AIChatRunRequest, snapshot AIContextSnapshot, requestedPath string) (string, []byte, string, error) {
	relPath, ok := rewriteGuardTargetPath(project.ProjectRoot, req, snapshot)
	if !ok {
		return "", nil, "", fmt.Errorf("model did not produce a reviewable edit operation; no current file target was available")
	}
	if strings.TrimSpace(requestedPath) != "" {
		requestedRel, requestedOK := normalizeRewriteGuardTargetPath(project.ProjectRoot, requestedPath)
		if !requestedOK || requestedRel != relPath {
			return "", nil, "", fmt.Errorf("fallback edit target %q does not match the current file; no file was changed", requestedPath)
		}
	}
	if toolPathLooksSensitive(relPath) || toolPathLooksBinaryByExtension(relPath) || !fileReadRangePathAllowed(relPath) {
		return "", nil, "", fmt.Errorf("fallback edit target is sensitive or binary-like; no file was changed")
	}
	absPath, err := safeProjectPath(project.ProjectRoot, relPath)
	if err != nil {
		return "", nil, "", err
	}
	info, err := os.Lstat(absPath)
	if err != nil {
		return "", nil, "", err
	}
	if info.IsDir() {
		return "", nil, "", fmt.Errorf("fallback edit target is a directory; no file was changed")
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", nil, "", fmt.Errorf("fallback edit target is a symlink; no file was changed")
	}
	before, err := os.ReadFile(absPath)
	if err != nil {
		return "", nil, "", err
	}
	if fileBytesLookBinary(before) {
		return "", nil, "", fmt.Errorf("fallback edit target appears binary; no file was changed")
	}
	if fallbackCurrentFileContextIsDirty(project.ProjectRoot, relPath, req.Context, before) {
		return "", nil, "", fmt.Errorf("fallback edit target has unsaved editor changes; no file was changed")
	}
	language := firstNonEmpty(snapshot.Language, req.Context.Language, languageForMentionPath(relPath), languageForFallbackPath(relPath))
	return relPath, before, language, nil
}

func fallbackCurrentFileContextIsDirty(projectRoot string, relPath string, req AIContextRequest, disk []byte) bool {
	if strings.TrimSpace(req.FullText) == "" {
		return false
	}
	contextRel, ok := normalizeRewriteGuardTargetPath(projectRoot, req.FilePath)
	if !ok || contextRel != relPath {
		return false
	}
	return normalizeFallbackComparableText(req.FullText) != normalizeFallbackComparableText(string(disk))
}

func normalizeFallbackComparableText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return value
}

func buildEditFallbackToolCall(relPath string, language string, content string, edits []buildEditFallbackEdit, summary string) (chatToolCallRequest, error) {
	if len(edits) == 0 {
		return chatToolCallRequest{}, fmt.Errorf("fallback edit plan did not contain edits; no file was changed")
	}
	items := make([]targetedEditSequenceItem, 0, len(edits))
	for _, edit := range edits {
		item, err := targetedEditSequenceItemFromFallbackEdit(content, relPath, language, edit)
		if err != nil {
			return chatToolCallRequest{}, err
		}
		items = append(items, item)
	}
	args := map[string]string{
		"path":    relPath,
		"title":   "AI fallback edit preview",
		"summary": summary,
	}
	if len(items) == 1 {
		args["operation"] = items[0].Operation
		args["oldText"] = items[0].OldText
		args["newText"] = items[0].NewText
	} else {
		encoded, err := json.Marshal(items)
		if err != nil {
			return chatToolCallRequest{}, err
		}
		args["edits"] = string(encoded)
	}
	if _, _, err := applyTargetedEdit([]byte(content), args); err != nil {
		return chatToolCallRequest{}, err
	}
	return chatToolCallRequestFromToolRequest(AIToolCallRequest{
		ToolID:    "file.edit.preview",
		Action:    AIToolCallActionPreview,
		Arguments: args,
	}, 0), nil
}

func targetedEditSequenceItemFromFallbackEdit(content string, relPath string, language string, edit buildEditFallbackEdit) (targetedEditSequenceItem, error) {
	position := normalizeToolArgumentToken(edit.Position)
	operation := normalizedEditOperation(edit.Operation, edit.Position)
	oldText := firstNonBlankRaw(edit.OldText, edit.Anchor)
	newText := firstNonBlankRaw(edit.NewText, edit.Text, edit.Content)
	if fallbackEditLooksLikeComment(edit) {
		newText = formatFallbackCommentText(relPath, language, newText)
	}
	switch position {
	case "start", "beginning", "top", "file_start":
		if strings.TrimSpace(content) == "" {
			return targetedEditSequenceItem{Operation: "append", NewText: ensureFallbackAppendText(content, newText)}, nil
		}
		anchor, err := fallbackAnchorForLine(content, 0)
		if err != nil {
			return targetedEditSequenceItem{}, err
		}
		return targetedEditSequenceItem{Operation: "insert_before", OldText: anchor, NewText: newText}, nil
	case "end", "bottom", "file_end", "eof":
		return targetedEditSequenceItem{Operation: "append", NewText: ensureFallbackAppendText(content, newText)}, nil
	}
	if operation == "" {
		return targetedEditSequenceItem{}, fmt.Errorf("fallback edit is missing a supported operation or position")
	}
	if operation != "append" && strings.TrimSpace(oldText) == "" {
		return targetedEditSequenceItem{}, fmt.Errorf("fallback edit operation %s requires an anchor", operation)
	}
	if operation == "append" {
		newText = ensureFallbackAppendText(content, newText)
	}
	return targetedEditSequenceItem{Operation: operation, OldText: oldText, NewText: newText}, nil
}

func fallbackEditLooksLikeComment(edit buildEditFallbackEdit) bool {
	if edit.Comment {
		return true
	}
	switch normalizeToolArgumentToken(firstNonEmpty(edit.Kind, edit.Type)) {
	case "comment", "line_comment", "doc_comment":
		return true
	default:
		return false
	}
}

func buildEditFallbackToolCallFromCodeBlock(relPath string, language string, content string, blockContent string) (chatToolCallRequest, error) {
	edits, err := insertOnlyEditsFromCodeBlock(content, blockContent)
	if err != nil {
		return chatToolCallRequest{}, err
	}
	return buildEditFallbackToolCall(relPath, language, content, edits, "Generated from a recoverable partial code block.")
}

func insertOnlyEditsFromCodeBlock(content string, blockContent string) ([]buildEditFallbackEdit, error) {
	fileLines := comparableLines(content)
	blockLines := comparableLines(blockContent)
	if len(blockLines) == 0 {
		return nil, fmt.Errorf("fallback code block was empty")
	}
	if len(blockLines) > maxBuildEditFallbackBlockLines || len(fileLines) > maxBuildEditFallbackFileLines {
		return nil, fmt.Errorf("fallback code block or file was too large for safe insert-only recovery")
	}
	matches := lcsLineMatches(fileLines, blockLines)
	requiredMatches := minInt(minBuildEditFallbackMatches, len(fileLines))
	if len(matches) < requiredMatches {
		return nil, fmt.Errorf("fallback code block did not overlap enough with the current file")
	}
	for index := 1; index < len(matches); index++ {
		if matches[index].FileIndex != matches[index-1].FileIndex+1 {
			return nil, fmt.Errorf("fallback code block omitted existing file lines; refusing replacement recovery")
		}
	}
	matchByBlock := map[int]buildEditFallbackLineMatch{}
	for _, match := range matches {
		matchByBlock[match.BlockIndex] = match
	}
	edits := []buildEditFallbackEdit{}
	pending := []string{}
	previousFileIndex := -1
	flush := func(nextFileIndex int) error {
		if len(pending) == 0 {
			return nil
		}
		text := strings.Join(pending, defaultLineBreak(content)) + defaultLineBreak(content)
		pending = nil
		switch {
		case previousFileIndex < 0 && nextFileIndex >= 0:
			anchor, err := fallbackAnchorForLine(content, nextFileIndex)
			if err != nil {
				return err
			}
			edits = append(edits, buildEditFallbackEdit{Operation: "insert_before", OldText: anchor, NewText: text})
		case previousFileIndex >= 0:
			anchor, err := fallbackAnchorForLine(content, previousFileIndex)
			if err != nil {
				return err
			}
			edits = append(edits, buildEditFallbackEdit{Operation: "insert_after", OldText: anchor, NewText: text})
		default:
			return fmt.Errorf("fallback code block had no stable insertion anchor")
		}
		return nil
	}
	for blockIndex, line := range blockLines {
		if match, ok := matchByBlock[blockIndex]; ok {
			if err := flush(match.FileIndex); err != nil {
				return nil, err
			}
			previousFileIndex = match.FileIndex
			continue
		}
		pending = append(pending, line)
	}
	if err := flush(-1); err != nil {
		return nil, err
	}
	if len(edits) == 0 {
		return nil, fmt.Errorf("fallback code block did not contain insertions")
	}
	return edits, nil
}

func lcsLineMatches(fileLines []string, blockLines []string) []buildEditFallbackLineMatch {
	rows := len(fileLines) + 1
	cols := len(blockLines) + 1
	dp := make([][]int, rows)
	for row := range dp {
		dp[row] = make([]int, cols)
	}
	for fileIndex := len(fileLines) - 1; fileIndex >= 0; fileIndex-- {
		for blockIndex := len(blockLines) - 1; blockIndex >= 0; blockIndex-- {
			if fileLines[fileIndex] == blockLines[blockIndex] {
				dp[fileIndex][blockIndex] = dp[fileIndex+1][blockIndex+1] + 1
			} else if dp[fileIndex+1][blockIndex] >= dp[fileIndex][blockIndex+1] {
				dp[fileIndex][blockIndex] = dp[fileIndex+1][blockIndex]
			} else {
				dp[fileIndex][blockIndex] = dp[fileIndex][blockIndex+1]
			}
		}
	}
	matches := []buildEditFallbackLineMatch{}
	fileIndex := 0
	blockIndex := 0
	for fileIndex < len(fileLines) && blockIndex < len(blockLines) {
		if fileLines[fileIndex] == blockLines[blockIndex] {
			matches = append(matches, buildEditFallbackLineMatch{FileIndex: fileIndex, BlockIndex: blockIndex})
			fileIndex++
			blockIndex++
			continue
		}
		if dp[fileIndex+1][blockIndex] >= dp[fileIndex][blockIndex+1] {
			fileIndex++
		} else {
			blockIndex++
		}
	}
	return matches
}

func comparableLines(value string) []string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.Trim(value, "\n")
	if value == "" {
		return nil
	}
	return strings.Split(value, "\n")
}

func fallbackAnchorForLine(content string, lineIndex int) (string, error) {
	lines := comparableLines(content)
	if lineIndex < 0 || lineIndex >= len(lines) {
		return "", fmt.Errorf("fallback edit anchor line is out of range")
	}
	for radius := 0; radius <= 4; radius++ {
		start := maxInt(0, lineIndex-radius)
		end := minInt(len(lines)-1, lineIndex+radius)
		anchor := fallbackAnchorText(content, lines, start, end)
		if strings.Count(content, anchor) == 1 {
			return anchor, nil
		}
	}
	return "", fmt.Errorf("fallback edit could not find a unique narrow anchor")
}

func fallbackAnchorText(content string, lines []string, start int, end int) string {
	lineBreak := defaultLineBreak(content)
	text := strings.Join(lines[start:end+1], lineBreak)
	if end < len(lines)-1 || strings.HasSuffix(content, "\n") || strings.HasSuffix(content, "\r\n") {
		text += lineBreak
	}
	return text
}

func formatFallbackCommentText(relPath string, language string, text string) string {
	text = strings.TrimSpace(text)
	if text == "" || fallbackTextAlreadyLooksLikeComment(text) {
		return ensureTrailingLineBreak(text)
	}
	switch fallbackCommentStyle(relPath, language) {
	case "hash":
		return prefixFallbackCommentLines("#", text)
	case "html":
		return "<!-- " + strings.TrimSpace(text) + " -->" + "\n"
	default:
		return prefixFallbackCommentLines("//", text)
	}
}

func fallbackTextAlreadyLooksLikeComment(text string) bool {
	trimmed := strings.TrimSpace(text)
	return strings.HasPrefix(trimmed, "//") ||
		strings.HasPrefix(trimmed, "#") ||
		strings.HasPrefix(trimmed, "<!--") ||
		strings.HasPrefix(trimmed, "/*") ||
		strings.HasPrefix(trimmed, "*")
}

func fallbackCommentStyle(relPath string, language string) string {
	language = normalizeToolArgumentToken(firstNonEmpty(language, languageForFallbackPath(relPath)))
	ext := strings.ToLower(filepath.Ext(relPath))
	switch language {
	case "python", "py", "ruby", "rb", "shell", "sh", "bash", "zsh", "fish", "yaml", "yml", "toml":
		return "hash"
	case "markdown", "md", "mdx", "html", "htm", "xml":
		return "html"
	}
	switch ext {
	case ".py", ".rb", ".sh", ".bash", ".zsh", ".fish", ".yaml", ".yml", ".toml":
		return "hash"
	case ".md", ".mdx", ".html", ".htm", ".xml":
		return "html"
	default:
		return "slash"
	}
}

func prefixFallbackCommentLines(prefix string, text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for index, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			lines[index] = prefix
		} else {
			lines[index] = prefix + " " + line
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func ensureFallbackAppendText(content string, text string) string {
	text = ensureTrailingLineBreak(text)
	if strings.TrimSpace(content) == "" || strings.HasSuffix(content, "\n") || strings.HasSuffix(content, "\r\n") {
		return text
	}
	return defaultLineBreak(content) + text
}

func ensureTrailingLineBreak(text string) string {
	if text == "" || strings.HasSuffix(text, "\n") || strings.HasSuffix(text, "\r") {
		return text
	}
	return text + "\n"
}

func languageForFallbackPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".py":
		return "python"
	case ".rb":
		return "ruby"
	case ".rs":
		return "rust"
	case ".java":
		return "java"
	case ".c", ".h":
		return "c"
	case ".cc", ".cpp", ".hpp":
		return "cpp"
	case ".swift":
		return "swift"
	case ".kt", ".kts":
		return "kotlin"
	case ".sh", ".bash", ".zsh", ".fish":
		return "shell"
	case ".html", ".htm":
		return "html"
	case ".xml":
		return "xml"
	case ".mdx":
		return "mdx"
	default:
		return ""
	}
}

func firstField(value string) string {
	fields := strings.Fields(strings.TrimSpace(value))
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func firstNonEmptyError(values ...error) error {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonBlankRaw(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
