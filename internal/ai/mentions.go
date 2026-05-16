package ai

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"arlecchino/internal/ai/skills"
)

const (
	mentionSource        = "mention"
	mentionDefaultLimit  = 40
	mentionMaxLimit      = 80
	mentionFileMaxBytes  = 64 * 1024
	mentionFileSnippet   = 4800
	mentionFileScanLimit = 40
)

func (s *Service) SuggestChatMentions(projectID string, req AIChatMentionQuery) ([]AIChatMentionCandidate, error) {
	trigger := req.Trigger
	if trigger != AIChatMentionTriggerAt && trigger != AIChatMentionTriggerSlash {
		return nil, fmt.Errorf("unsupported chat mention trigger %q", trigger)
	}
	project := s.project(projectID)
	if project == nil {
		return nil, fmt.Errorf("AI project session is not open")
	}
	limit := req.Limit
	if limit <= 0 {
		limit = mentionDefaultLimit
	}
	if limit > mentionMaxLimit {
		limit = mentionMaxLimit
	}
	query := normalizeMentionQuery(req.Query, trigger)
	candidates := []AIChatMentionCandidate{}
	if trigger == AIChatMentionTriggerAt {
		candidates = append(candidates, s.agentMentionCandidates(query, "Agents", "@", req.IncludeDisabled)...)
		candidates = append(candidates, skillMentionCandidates(project, query, "Skills", "@", req.IncludeDisabled)...)
		candidates = append(candidates, fileMentionCandidates(project.ProjectRoot, query, "Files", "@", req.IncludeDisabled, mentionFileScanLimit)...)
		candidates = append(candidates, s.contextMentionCandidates(query, "Context", "@", req.IncludeDisabled)...)
	} else {
		candidates = append(candidates, s.workflowMentionCandidates(query, req.IncludeDisabled)...)
		candidates = append(candidates, s.actionMentionCandidates(query, req.IncludeDisabled)...)
		candidates = append(candidates, fileMentionCandidates(project.ProjectRoot, query, "Attach File", "/file ", req.IncludeDisabled, mentionFileScanLimit)...)
		candidates = append(candidates, skillMentionCandidates(project, query, "Attach Skill", "/skill ", req.IncludeDisabled)...)
		candidates = append(candidates, s.agentMentionCandidates(query, "Use Agent", "/agent ", req.IncludeDisabled)...)
	}
	sortMentionCandidates(candidates)
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates, nil
}

func normalizeMentionQuery(query string, trigger AIChatMentionTrigger) string {
	query = strings.TrimSpace(query)
	query = strings.TrimPrefix(query, string(trigger))
	query = strings.TrimLeftFunc(query, unicode.IsSpace)
	return strings.ToLower(query)
}

func (s *Service) agentMentionCandidates(query, group, insertPrefix string, includeDisabled bool) []AIChatMentionCandidate {
	out := []AIChatMentionCandidate{}
	for _, profile := range s.ListAgentProfiles() {
		score, ok := mentionMatchScore(query, string(profile.ID), profile.Name, profile.Description)
		if !ok {
			continue
		}
		disabledReason := ""
		if !profile.Enabled {
			disabledReason = "not available"
		}
		if disabledReason != "" && !includeDisabled {
			continue
		}
		out = append(out, AIChatMentionCandidate{
			ID:             "agent:" + profile.ID,
			Kind:           AIChatMentionKindAgent,
			Group:          group,
			Label:          profile.Name,
			Description:    profile.Description,
			Detail:         profile.ID,
			InsertText:     insertPrefix + profile.ID,
			DisabledReason: disabledReason,
			Score:          score,
			Operation:      AIChatMentionOperationSetProfile,
			Action:         profile.Action,
			ProfileID:      profile.ID,
		})
	}
	return out
}

func (s *Service) workflowMentionCandidates(query string, includeDisabled bool) []AIChatMentionCandidate {
	out := []AIChatMentionCandidate{}
	for _, workflow := range s.ListPromptWorkflows() {
		score, ok := mentionMatchScore(query, workflow.Slash, workflow.Name, workflow.Description)
		if !ok {
			continue
		}
		out = append(out, AIChatMentionCandidate{
			ID:          "workflow:" + workflow.ID,
			Kind:        AIChatMentionKindWorkflow,
			Group:       "Workflows",
			Label:       workflow.Name,
			Description: workflow.Description,
			Detail:      workflow.Slash,
			InsertText:  workflow.Slash,
			Score:       score,
			Operation:   AIChatMentionOperationSetWorkflow,
			Action:      workflow.Action,
			ProfileID:   workflow.ProfileID,
			WorkflowID:  workflow.ID,
		})
	}
	return out
}

func (s *Service) actionMentionCandidates(query string, includeDisabled bool) []AIChatMentionCandidate {
	out := []AIChatMentionCandidate{}
	for _, action := range s.ListChatActions() {
		score, ok := mentionMatchScore(query, string(action.ID), action.Name, action.Description)
		if !ok {
			continue
		}
		out = append(out, AIChatMentionCandidate{
			ID:          "action:" + string(action.ID),
			Kind:        AIChatMentionKindAction,
			Group:       "Actions",
			Label:       action.Name,
			Description: action.Description,
			Detail:      action.ApprovalBoundary,
			InsertText:  "/" + string(action.ID),
			Score:       score,
			Operation:   AIChatMentionOperationSetAction,
			Action:      action.ID,
		})
	}
	return out
}

func (s *Service) contextMentionCandidates(query, group, insertPrefix string, includeDisabled bool) []AIChatMentionCandidate {
	out := []AIChatMentionCandidate{}
	for _, provider := range s.ListContextProviders() {
		if !chatMentionContextProviderSupported(provider.ID) {
			continue
		}
		score, ok := mentionMatchScore(query, provider.ID, provider.Name, provider.Description)
		if !ok {
			continue
		}
		disabledReason := ""
		if !provider.Enabled || !provider.Available {
			disabledReason = "not available"
		}
		if disabledReason != "" && !includeDisabled {
			continue
		}
		kind := contextProviderMentionKind(provider.ID)
		out = append(out, AIChatMentionCandidate{
			ID:             "context:" + provider.ID,
			Kind:           AIChatMentionKindContext,
			Group:          group,
			Label:          provider.Name,
			Description:    provider.Description,
			Detail:         provider.ID,
			InsertText:     insertPrefix + provider.ID,
			DisabledReason: disabledReason,
			Score:          score,
			Operation:      AIChatMentionOperationAttachContext,
			ContextItem: &AIContextItemRequest{
				ID:     provider.ID,
				Kind:   kind,
				Label:  provider.Name,
				Source: mentionSource,
			},
		})
	}
	return out
}

func skillMentionCandidates(project *ProjectSession, query, group, insertPrefix string, includeDisabled bool) []AIChatMentionCandidate {
	if project == nil || project.Skills == nil {
		return nil
	}
	mnemonicEnabled := project.Mnemonic != nil && project.Mnemonic.Enabled()
	records, err := project.Skills.List(100)
	if err != nil {
		return nil
	}
	out := []AIChatMentionCandidate{}
	for _, record := range records {
		score, ok := mentionMatchScore(query, record.SkillID, record.Name, record.Description, record.Path)
		if !ok {
			continue
		}
		disabledReason := skillMentionDisabledReason(record, mnemonicEnabled)
		if disabledReason != "" && !includeDisabled {
			continue
		}
		out = append(out, AIChatMentionCandidate{
			ID:             "skill:" + record.SkillID,
			Kind:           AIChatMentionKindSkill,
			Group:          group,
			Label:          record.Name,
			Description:    record.Description,
			Detail:         record.Path,
			InsertText:     insertPrefix + record.Name,
			DisabledReason: disabledReason,
			Score:          score,
			Operation:      AIChatMentionOperationAttachSkill,
			ContextItem: &AIContextItemRequest{
				ID:     record.SkillID,
				Kind:   AIContextItemKindSkill,
				Label:  record.Name,
				Path:   record.Path,
				Source: mentionSource,
			},
		})
	}
	return out
}

func skillMentionDisabledReason(record skills.Record, mnemonicEnabled bool) string {
	if !mnemonicEnabled {
		return "disabled"
	}
	if record.SourceKind != skills.SourceProject {
		return "not trusted"
	}
	if record.Stale {
		return "stale"
	}
	if record.TrustState != skills.TrustTrusted {
		return "needs review"
	}
	if !record.Pinned {
		return "not pinned"
	}
	return ""
}

func fileMentionCandidates(projectRoot, query, group, insertPrefix string, includeDisabled bool, limit int) []AIChatMentionCandidate {
	projectRoot = strings.TrimSpace(projectRoot)
	if projectRoot == "" || limit <= 0 {
		return nil
	}
	root, err := filepath.Abs(projectRoot)
	if err != nil {
		return nil
	}
	root = filepath.Clean(root)
	out := []AIChatMentionCandidate{}
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || len(out) >= limit {
			return nil
		}
		name := entry.Name()
		if entry.IsDir() {
			if mentionSkipDir(name) {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || !fastContextFileAllowed(name) {
			return nil
		}
		info, statErr := entry.Info()
		if statErr != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > mentionFileMaxBytes {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		score, ok := mentionMatchScore(query, rel, filepath.Base(rel))
		if !ok {
			return nil
		}
		out = append(out, AIChatMentionCandidate{
			ID:          "file:" + rel,
			Kind:        AIChatMentionKindFile,
			Group:       group,
			Label:       filepath.Base(rel),
			Description: rel,
			Detail:      filepath.Dir(rel),
			InsertText:  insertPrefix + rel,
			Score:       score,
			Operation:   AIChatMentionOperationAttachFile,
			ContextItem: &AIContextItemRequest{
				Kind:   AIContextItemKindFile,
				Label:  filepath.Base(rel),
				Path:   rel,
				Source: mentionSource,
			},
		})
		return nil
	})
	return out
}

func mentionMatchScore(query string, values ...string) (float64, bool) {
	query = strings.TrimSpace(strings.ToLower(query))
	if query == "" {
		return 0.25, true
	}
	best := 0.0
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		value = strings.TrimPrefix(value, "/")
		if value == query {
			if best < 1 {
				best = 1
			}
			continue
		}
		if strings.HasPrefix(value, query) {
			if best < 0.9 {
				best = 0.9
			}
			continue
		}
		if strings.Contains(value, query) {
			if best < 0.55 {
				best = 0.55
			}
		}
	}
	return best, best > 0
}

func sortMentionCandidates(candidates []AIChatMentionCandidate) {
	sort.SliceStable(candidates, func(i, j int) bool {
		left := candidates[i]
		right := candidates[j]
		leftGroup := mentionGroupRank(left.Group)
		rightGroup := mentionGroupRank(right.Group)
		if leftGroup != rightGroup {
			return leftGroup < rightGroup
		}
		if (left.DisabledReason == "") != (right.DisabledReason == "") {
			return left.DisabledReason == ""
		}
		if left.Score != right.Score {
			return left.Score > right.Score
		}
		return strings.ToLower(left.Label) < strings.ToLower(right.Label)
	})
}

func mentionGroupRank(group string) int {
	switch group {
	case "Agents":
		return 10
	case "Workflows":
		return 11
	case "Actions":
		return 12
	case "Skills":
		return 20
	case "Attach File":
		return 21
	case "Attach Skill":
		return 22
	case "Use Agent":
		return 23
	case "Files":
		return 30
	case "Context":
		return 40
	default:
		return 100
	}
}

func contextProviderMentionKind(id string) AIContextItemKind {
	switch id {
	case "current_file":
		return AIContextItemKindFile
	case "selection":
		return AIContextItemKindSelection
	case "terminal_input":
		return AIContextItemKindTerminal
	case "mnemonic":
		return AIContextItemKindMnemonic
	case "mcp":
		return AIContextItemKindMCP
	case "diagnostics":
		return AIContextItemKindDiagnostics
	case "git_diff":
		return AIContextItemKindGitDiff
	default:
		return AIContextItemKindWorkspace
	}
}

func chatMentionContextProviderSupported(id string) bool {
	switch id {
	case "current_file", "mnemonic", "mcp", "fast_context":
		return true
	default:
		return false
	}
}

func (s *Service) materializeMentionContextItem(project *ProjectSession, snapshot *AIContextSnapshot, req AIContextRequest, item AIContextItemRequest) bool {
	if project == nil || snapshot == nil || item.Source != mentionSource {
		return false
	}
	switch item.Kind {
	case AIContextItemKindFile:
		s.materializeMentionFile(project, snapshot, item)
		return true
	case AIContextItemKindSkill:
		s.materializeMentionSkill(project, snapshot, item)
		return true
	case AIContextItemKindMnemonic:
		s.discloseMentionMnemonic(project, snapshot, item)
		return true
	case AIContextItemKindMCP:
		s.discloseMentionMCP(snapshot, item)
		return true
	case AIContextItemKindWorkspace:
		s.discloseMentionWorkspace(project, snapshot, req, item)
		return true
	default:
		return false
	}
}

func (s *Service) materializeMentionFile(project *ProjectSession, snapshot *AIContextSnapshot, item AIContextItemRequest) {
	absPath, relPath, reason := resolveMentionFilePath(project.ProjectRoot, item.Path)
	label := firstNonEmpty(item.Label, filepath.Base(relPath), filepath.Base(item.Path), "File")
	if reason != "" {
		addContextItemDisclosure(snapshot, AIContextItemKindFile, label, firstNonEmpty(relPath, item.Path), mentionSource, true, false, 0, reason)
		return
	}
	content, readErr := os.ReadFile(absPath)
	if readErr != nil {
		addContextItemDisclosure(snapshot, AIContextItemKindFile, label, relPath, mentionSource, true, false, 0, "read_error")
		return
	}
	if len(content) == 0 {
		addContextItemDisclosure(snapshot, AIContextItemKindFile, label, relPath, mentionSource, true, false, 0, "empty")
		return
	}
	if strings.Contains(string(content), "\x00") {
		addContextItemDisclosure(snapshot, AIContextItemKindFile, label, relPath, mentionSource, true, false, 0, "binary")
		return
	}
	snippet := truncateUTF8(string(content), mentionFileSnippet)
	snapshot.Snippets = append(snapshot.Snippets, AIContextSnippet{
		Type:     "mentioned_file",
		Path:     relPath,
		Language: languageForMentionPath(relPath),
		Content:  snippet,
	})
	addSnapshotDataCategory(snapshot, "mentioned_file_context")
	addContextItemDisclosure(snapshot, AIContextItemKindFile, label, relPath, mentionSource, true, true, len(snippet), "")
}

func (s *Service) materializeMentionSkill(project *ProjectSession, snapshot *AIContextSnapshot, item AIContextItemRequest) {
	label := firstNonEmpty(item.Label, item.ID, "Skill")
	if project.Skills == nil || project.Mnemonic == nil || !project.Mnemonic.Enabled() {
		addContextItemDisclosure(snapshot, AIContextItemKindSkill, label, item.Path, mentionSource, true, false, 0, "disabled")
		return
	}
	skillID := strings.TrimSpace(item.ID)
	if skillID == "" {
		addContextItemDisclosure(snapshot, AIContextItemKindSkill, label, item.Path, mentionSource, true, false, 0, "missing_skill_id")
		return
	}
	digest, err := project.Skills.TrustedDigest(skillID)
	if err != nil {
		addContextItemDisclosure(snapshot, AIContextItemKindSkill, label, item.Path, mentionSource, true, false, 0, skillMentionInclusionReason(err))
		return
	}
	context := fromSkillContext(digest)
	snapshot.Skills = append(snapshot.Skills, context)
	addSnapshotDataCategory(snapshot, "mentioned_skill_context")
	addContextItemDisclosure(snapshot, AIContextItemKindSkill, firstNonEmpty(context.Name, label), item.Path, mentionSource, true, true, skillContextBytes(context), "")
}

func (s *Service) discloseMentionMnemonic(project *ProjectSession, snapshot *AIContextSnapshot, item AIContextItemRequest) {
	label := firstNonEmpty(item.Label, "Mnemonic")
	included := project.Mnemonic != nil && project.Mnemonic.Enabled()
	reason := ""
	if !included {
		reason = "disabled"
	}
	addContextItemDisclosure(snapshot, AIContextItemKindMnemonic, label, item.Path, mentionSource, true, included, 0, reason)
}

func (s *Service) discloseMentionMCP(snapshot *AIContextSnapshot, item AIContextItemRequest) {
	label := firstNonEmpty(item.Label, "MCP")
	included := s.mcpContext != nil
	reason := ""
	if !included {
		reason = "disabled"
	}
	addContextItemDisclosure(snapshot, AIContextItemKindMCP, label, item.Path, mentionSource, true, included, 0, reason)
}

func (s *Service) discloseMentionWorkspace(project *ProjectSession, snapshot *AIContextSnapshot, req AIContextRequest, item AIContextItemRequest) {
	label := firstNonEmpty(item.Label, "Fast context")
	if strings.TrimSpace(req.Prompt) == "" {
		addContextItemDisclosure(snapshot, AIContextItemKindWorkspace, label, item.Path, mentionSource, true, false, 0, "empty_prompt")
		return
	}
	addContextItemDisclosure(snapshot, AIContextItemKindWorkspace, label, item.Path, mentionSource, true, true, 0, "fast_context")
}

func resolveMentionFilePath(projectRoot, requestedPath string) (string, string, string) {
	root := strings.TrimSpace(projectRoot)
	path := strings.TrimSpace(requestedPath)
	if root == "" {
		return "", "", "project_unavailable"
	}
	if path == "" {
		return "", "", "missing_path"
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", "", "invalid_project_root"
	}
	absRoot = filepath.Clean(absRoot)
	if filepath.IsAbs(path) {
		path = filepath.Clean(path)
	} else {
		path = filepath.Join(absRoot, filepath.FromSlash(path))
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", "", "invalid_path"
	}
	absPath = filepath.Clean(absPath)
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", filepath.ToSlash(rel), "outside_project"
	}
	rel = filepath.ToSlash(rel)
	if mentionPathHasSkippedSegment(rel) {
		return "", rel, "ignored"
	}
	if !fastContextFileAllowed(filepath.Base(absPath)) {
		return "", rel, "unsafe_file"
	}
	info, err := os.Lstat(absPath)
	if err != nil {
		return "", rel, "not_found"
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", rel, "symlink"
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		return "", rel, "not_file"
	}
	if info.Size() <= 0 {
		return "", rel, "empty"
	}
	if info.Size() > mentionFileMaxBytes {
		return "", rel, "too_large"
	}
	return absPath, rel, ""
}

func mentionPathHasSkippedSegment(path string) bool {
	for _, segment := range strings.Split(filepath.ToSlash(path), "/") {
		if mentionSkipDir(segment) {
			return true
		}
	}
	return false
}

func mentionSkipDir(name string) bool {
	switch name {
	case ".git", "node_modules", "dist", "build", ".wails", ".arlecchino", "vendor":
		return true
	default:
		return false
	}
}

func languageForMentionPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go":
		return "go"
	case ".ts":
		return "typescript"
	case ".tsx":
		return "typescriptreact"
	case ".js":
		return "javascript"
	case ".jsx":
		return "javascriptreact"
	case ".css":
		return "css"
	case ".md":
		return "markdown"
	case ".json":
		return "json"
	case ".yaml", ".yml":
		return "yaml"
	case ".toml":
		return "toml"
	default:
		return ""
	}
}

func skillMentionInclusionReason(err error) string {
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	switch {
	case strings.Contains(message, "stale"):
		return "stale"
	case strings.Contains(message, "trusted") || strings.Contains(message, "pinned") || strings.Contains(message, "current"):
		return "needs review"
	default:
		return "not included"
	}
}

func addSnapshotDataCategory(snapshot *AIContextSnapshot, category string) {
	if snapshot == nil || strings.TrimSpace(category) == "" {
		return
	}
	for _, existing := range snapshot.DataCategories {
		if existing == category {
			return
		}
	}
	snapshot.DataCategories = append(snapshot.DataCategories, category)
}
