package main

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/lsp"
)

type diagnosticsPreloadBudget struct {
	LargeProjectFileThreshold int
	PolyglotLanguageThreshold int
	MaxDominantLanguages      int
	MaxFilesPerLanguage       int
	MaxFiles                  int
	MaxTotalBytes             int64
	MaxFileSizeBytes          int64
	Timeout                   time.Duration
}

type diagnosticsPreloadCandidate struct {
	Path       string
	Language   string
	Role       diagnosticsPreloadRole
	Size       int64
	Depth      int
	HasSymbols bool
}

type diagnosticsPreloadPlan struct {
	Candidates         []diagnosticsPreloadCandidate
	Bounded            bool
	TotalCandidates    int
	SelectedCandidates int
	TotalLanguages     int
	SelectedLanguages  int
}

type diagnosticsPreloadRole string

const (
	diagnosticsPreloadRoleSource    diagnosticsPreloadRole = "source"
	diagnosticsPreloadRoleTest      diagnosticsPreloadRole = "test"
	diagnosticsPreloadRoleConfig    diagnosticsPreloadRole = "config"
	diagnosticsPreloadRoleDocs      diagnosticsPreloadRole = "docs"
	diagnosticsPreloadRoleGenerated diagnosticsPreloadRole = "generated"
	diagnosticsPreloadRoleAsset     diagnosticsPreloadRole = "asset"
	diagnosticsPreloadRoleBinary    diagnosticsPreloadRole = "binary"
	diagnosticsPreloadRoleUnknown   diagnosticsPreloadRole = "unknown"
)

func defaultDiagnosticsPreloadBudget() diagnosticsPreloadBudget {
	return diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 80,
		PolyglotLanguageThreshold: 4,
		MaxDominantLanguages:      2,
		MaxFilesPerLanguage:       8,
		MaxFiles:                  16,
		MaxTotalBytes:             2 << 20,
		MaxFileSizeBytes:          256 << 10,
		Timeout:                   5 * time.Second,
	}
}

func newLSPDiagnosticsPreloadEvent(
	projectPath string,
	generation uint64,
	plan diagnosticsPreloadPlan,
) LSPDiagnosticsPreloadEvent {
	return LSPDiagnosticsPreloadEvent{
		ProjectPath:        projectPath,
		Generation:         generation,
		Bounded:            plan.Bounded,
		TotalCandidates:    plan.TotalCandidates,
		SelectedCandidates: plan.SelectedCandidates,
		TotalLanguages:     plan.TotalLanguages,
		SelectedLanguages:  plan.SelectedLanguages,
	}
}

func collectDiagnosticsPreloadPlan(
	root string,
	budget diagnosticsPreloadBudget,
) (diagnosticsPreloadPlan, error) {
	return collectDiagnosticsPreloadPlanWithInventory(root, nil, budget)
}

func collectDiagnosticsPreloadPlanWithInventory(
	root string,
	inventory map[string]core.File,
	budget diagnosticsPreloadBudget,
) (diagnosticsPreloadPlan, error) {
	var candidates []diagnosticsPreloadCandidate

	walkErr := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if entry.IsDir() {
			if path != root && shouldSkipPreloadDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}

		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			return nil
		}

		if budget.MaxFileSizeBytes > 0 && info.Size() > budget.MaxFileSizeBytes {
			return nil
		}

		inventoryFile, hasInventory := inventory[path]
		language := strings.TrimSpace(inventoryFile.Language)
		if language == "" {
			language = detectLanguage(path)
		}
		if language == "" {
			return nil
		}
		if !supportsDiagnosticsPreload(language) {
			return nil
		}

		depth := 0
		if relPath, relErr := filepath.Rel(root, path); relErr == nil {
			depth = len(splitPreloadPath(filepath.ToSlash(relPath)))
		}

		candidate := diagnosticsPreloadCandidate{
			Path:       path,
			Language:   language,
			Role:       classifyDiagnosticsPreloadRole(path, language, inventoryFile.Kind),
			Size:       info.Size(),
			Depth:      depth,
			HasSymbols: hasInventory && inventoryFile.HasSymbols,
		}

		candidates = append(candidates, candidate)
		return nil
	})
	if walkErr != nil {
		return diagnosticsPreloadPlan{}, walkErr
	}

	return buildDiagnosticsPreloadPlan(candidates, budget), nil
}

func collectDiagnosticsPreloadCandidates(
	root string,
	budget diagnosticsPreloadBudget,
) ([]diagnosticsPreloadCandidate, error) {
	plan, err := collectDiagnosticsPreloadPlan(root, budget)
	if err != nil {
		return nil, err
	}
	return plan.Candidates, nil
}

func supportsDiagnosticsPreload(language string) bool {
	info := lsp.GetLanguageByID(language)
	return info != nil && info.LSPServerID != ""
}

func buildDiagnosticsPreloadPlan(
	candidates []diagnosticsPreloadCandidate,
	budget diagnosticsPreloadBudget,
) diagnosticsPreloadPlan {
	grouped := groupDiagnosticsPreloadCandidates(candidates)
	totalLanguages := len(grouped)
	totalCandidates := len(candidates)

	allCandidates := flattenDiagnosticsPreloadGroups(grouped)
	plan := diagnosticsPreloadPlan{
		Candidates:      allCandidates,
		TotalCandidates: totalCandidates,
		TotalLanguages:  totalLanguages,
	}

	if totalCandidates <= budget.LargeProjectFileThreshold &&
		totalLanguages <= budget.PolyglotLanguageThreshold {
		plan.SelectedCandidates = totalCandidates
		plan.SelectedLanguages = totalLanguages
		return plan
	}

	selected := selectDiagnosticsPreloadCandidates(grouped, budget)
	plan.Candidates = selected
	plan.SelectedCandidates = len(selected)
	plan.SelectedLanguages = countSelectedDiagnosticsLanguages(selected)
	plan.Bounded = plan.SelectedCandidates < totalCandidates ||
		plan.SelectedLanguages < totalLanguages
	return plan
}

func groupDiagnosticsPreloadCandidates(
	candidates []diagnosticsPreloadCandidate,
) map[string][]diagnosticsPreloadCandidate {
	grouped := make(map[string][]diagnosticsPreloadCandidate)
	for _, candidate := range candidates {
		grouped[candidate.Language] = append(grouped[candidate.Language], candidate)
	}

	for language := range grouped {
		sort.SliceStable(grouped[language], func(i, j int) bool {
			return compareDiagnosticsPreloadCandidates(
				grouped[language][i],
				grouped[language][j],
			) < 0
		})
	}

	return grouped
}

func flattenDiagnosticsPreloadGroups(
	grouped map[string][]diagnosticsPreloadCandidate,
) []diagnosticsPreloadCandidate {
	languages := rankedDiagnosticsPreloadLanguages(grouped)
	flattened := make([]diagnosticsPreloadCandidate, 0, countDiagnosticsPreloadCandidates(grouped))
	for _, language := range languages {
		flattened = append(flattened, grouped[language]...)
	}
	return flattened
}

func selectDiagnosticsPreloadCandidates(
	grouped map[string][]diagnosticsPreloadCandidate,
	budget diagnosticsPreloadBudget,
) []diagnosticsPreloadCandidate {
	languages := rankedDiagnosticsPreloadLanguages(grouped)
	queues := cloneDiagnosticsPreloadGroups(grouped)
	selected := make([]diagnosticsPreloadCandidate, 0, minInt(countDiagnosticsPreloadCandidates(grouped), budget.MaxFiles))
	perLanguageCount := make(map[string]int, len(languages))
	selectedLanguages := make(map[string]struct{}, len(languages))
	var totalBytes int64

	tryAdd := func(candidate diagnosticsPreloadCandidate) bool {
		if budget.MaxFiles > 0 && len(selected) >= budget.MaxFiles {
			return false
		}
		if budget.MaxFilesPerLanguage > 0 &&
			perLanguageCount[candidate.Language] >= budget.MaxFilesPerLanguage {
			return false
		}
		if budget.MaxTotalBytes > 0 && totalBytes+candidate.Size > budget.MaxTotalBytes {
			return false
		}

		selected = append(selected, candidate)
		perLanguageCount[candidate.Language]++
		selectedLanguages[candidate.Language] = struct{}{}
		totalBytes += candidate.Size
		return true
	}

	matchesSourceRole := func(candidate diagnosticsPreloadCandidate) bool {
		return candidate.Role == diagnosticsPreloadRoleSource
	}
	matchesSourceLikeRole := func(candidate diagnosticsPreloadCandidate) bool {
		return candidate.Role == diagnosticsPreloadRoleSource ||
			candidate.Role == diagnosticsPreloadRoleTest
	}

	for _, language := range languages {
		if budget.MaxFiles > 0 && len(selected) >= budget.MaxFiles {
			return selected
		}
		if candidate, ok := popDiagnosticsPreloadCandidate(queues, language, matchesSourceRole); ok {
			_ = tryAdd(candidate)
		}
	}

	for {
		progress := false
		for _, language := range languages {
			if budget.MaxFiles > 0 && len(selected) >= budget.MaxFiles {
				return selected
			}
			if budget.MaxFilesPerLanguage > 0 &&
				perLanguageCount[language] >= budget.MaxFilesPerLanguage {
				continue
			}
			candidate, ok := popDiagnosticsPreloadCandidate(queues, language, matchesSourceLikeRole)
			if !ok {
				continue
			}
			if tryAdd(candidate) {
				progress = true
			}
		}
		if !progress {
			break
		}
	}

	for _, language := range languages {
		if budget.MaxFiles > 0 && len(selected) >= budget.MaxFiles {
			return selected
		}
		if _, alreadySelected := selectedLanguages[language]; alreadySelected {
			continue
		}
		if candidate, ok := popDiagnosticsPreloadCandidate(queues, language, nil); ok {
			_ = tryAdd(candidate)
		}
	}

	for {
		progress := false
		for _, language := range languages {
			if budget.MaxFiles > 0 && len(selected) >= budget.MaxFiles {
				return selected
			}
			if budget.MaxFilesPerLanguage > 0 &&
				perLanguageCount[language] >= budget.MaxFilesPerLanguage {
				continue
			}
			candidate, ok := popDiagnosticsPreloadCandidate(queues, language, nil)
			if !ok {
				continue
			}
			if tryAdd(candidate) {
				progress = true
			}
		}
		if !progress {
			return selected
		}
	}
}

func popDiagnosticsPreloadCandidate(
	queues map[string][]diagnosticsPreloadCandidate,
	language string,
	match func(diagnosticsPreloadCandidate) bool,
) (diagnosticsPreloadCandidate, bool) {
	queue := queues[language]
	for index, candidate := range queue {
		if match != nil && !match(candidate) {
			continue
		}
		queues[language] = append(queue[:index:index], queue[index+1:]...)
		return candidate, true
	}

	return diagnosticsPreloadCandidate{}, false
}

func rankedDiagnosticsPreloadLanguages(
	grouped map[string][]diagnosticsPreloadCandidate,
) []string {
	languages := make([]string, 0, len(grouped))
	for language := range grouped {
		languages = append(languages, language)
	}

	sort.SliceStable(languages, func(i, j int) bool {
		left := grouped[languages[i]]
		right := grouped[languages[j]]
		if len(left) == 0 || len(right) == 0 {
			return languages[i] < languages[j]
		}

		if diff := compareDiagnosticsPreloadCandidates(left[0], right[0]); diff != 0 {
			return diff < 0
		}
		if len(left) != len(right) {
			return len(left) > len(right)
		}
		return languages[i] < languages[j]
	})

	return languages
}

func compareDiagnosticsPreloadCandidates(
	left diagnosticsPreloadCandidate,
	right diagnosticsPreloadCandidate,
) int {
	leftRolePriority := diagnosticsPreloadRolePriority(left.Role)
	rightRolePriority := diagnosticsPreloadRolePriority(right.Role)
	if leftRolePriority != rightRolePriority {
		return leftRolePriority - rightRolePriority
	}
	if left.HasSymbols != right.HasSymbols {
		if left.HasSymbols {
			return -1
		}
		return 1
	}
	leftFilePriority := diagnosticsPreloadFilePriority(left.Path)
	rightFilePriority := diagnosticsPreloadFilePriority(right.Path)
	if leftFilePriority != rightFilePriority {
		return leftFilePriority - rightFilePriority
	}
	if left.Depth != right.Depth {
		return left.Depth - right.Depth
	}
	if left.Size != right.Size {
		if left.Size < right.Size {
			return -1
		}
		return 1
	}
	return strings.Compare(left.Path, right.Path)
}

func diagnosticsPreloadRolePriority(role diagnosticsPreloadRole) int {
	switch role {
	case diagnosticsPreloadRoleSource:
		return 0
	case diagnosticsPreloadRoleTest:
		return 1
	case diagnosticsPreloadRoleConfig:
		return 2
	case diagnosticsPreloadRoleDocs:
		return 3
	case diagnosticsPreloadRoleGenerated:
		return 4
	case diagnosticsPreloadRoleAsset:
		return 5
	case diagnosticsPreloadRoleBinary:
		return 6
	default:
		return 7
	}
}

func diagnosticsPreloadFilePriority(path string) int {
	base := strings.ToLower(filepath.Base(path))
	switch base {
	case "go.mod", "go.sum", "go.work",
		"package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
		"tsconfig.json", "jsconfig.json",
		"composer.json", "composer.lock",
		"cargo.toml", "cargo.lock",
		"gemfile", "gemfile.lock",
		"pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
		"requirements.txt", "pyproject.toml", "poetry.lock", "pipfile", "pipfile.lock":
		return 2
	}

	if strings.HasSuffix(base, "_test.go") ||
		strings.Contains(base, ".test.") ||
		strings.Contains(base, ".spec.") {
		return 1
	}

	return 0
}

func classifyDiagnosticsPreloadRole(
	path string,
	language string,
	kind core.FileKind,
) diagnosticsPreloadRole {
	lowerPath := filepath.ToSlash(strings.ToLower(path))
	base := strings.ToLower(filepath.Base(path))
	ext := strings.ToLower(filepath.Ext(base))

	switch {
	case isDiagnosticsPreloadBinaryPath(ext, kind):
		return diagnosticsPreloadRoleBinary
	case isDiagnosticsPreloadAssetPath(ext, kind):
		return diagnosticsPreloadRoleAsset
	case isDiagnosticsPreloadGeneratedPath(lowerPath, base):
		return diagnosticsPreloadRoleGenerated
	case isDiagnosticsPreloadTestPath(lowerPath, base):
		return diagnosticsPreloadRoleTest
	case isDiagnosticsPreloadConfigPath(base, ext):
		return diagnosticsPreloadRoleConfig
	case isDiagnosticsPreloadDocsPath(lowerPath, ext):
		return diagnosticsPreloadRoleDocs
	case language != "" || kind == core.FileKindSource:
		return diagnosticsPreloadRoleSource
	case kind == core.FileKindConfig:
		return diagnosticsPreloadRoleConfig
	case kind == core.FileKindText:
		return diagnosticsPreloadRoleDocs
	case kind == core.FileKindAsset:
		return diagnosticsPreloadRoleAsset
	case kind == core.FileKindBinary:
		return diagnosticsPreloadRoleBinary
	default:
		return diagnosticsPreloadRoleUnknown
	}
}

func isDiagnosticsPreloadConfigPath(base, ext string) bool {
	switch base {
	case "dockerfile", "makefile", "compose.yml", "compose.yaml",
		"docker-compose.yml", "docker-compose.yaml", ".env":
		return true
	}

	switch ext {
	case ".conf", ".cfg", ".env", ".ini", ".json", ".jsonc", ".json5",
		".toml", ".xml", ".yaml", ".yml":
		return true
	default:
		return false
	}
}

func isDiagnosticsPreloadDocsPath(path, ext string) bool {
	if strings.Contains(path, "/docs/") || strings.Contains(path, "/documentation/") {
		return true
	}

	switch ext {
	case ".csv", ".log", ".md", ".markdown", ".mdx", ".rst", ".txt", ".tsv":
		return true
	default:
		return false
	}
}

func isDiagnosticsPreloadGeneratedPath(path, base string) bool {
	if strings.Contains(path, "/dist/") ||
		strings.Contains(path, "/build/") ||
		strings.Contains(path, "/coverage/") ||
		strings.Contains(path, "/generated/") ||
		strings.Contains(path, "/.next/") ||
		strings.Contains(path, "/.nuxt/") {
		return true
	}

	return strings.Contains(base, ".generated.") ||
		strings.Contains(base, ".gen.") ||
		strings.Contains(base, ".min.") ||
		strings.Contains(base, "_generated") ||
		strings.Contains(base, ".pb.")
}

func isDiagnosticsPreloadTestPath(path, base string) bool {
	if strings.Contains(path, "/test/") ||
		strings.Contains(path, "/tests/") ||
		strings.Contains(path, "/__tests__/") ||
		strings.Contains(path, "/spec/") ||
		strings.Contains(path, "/specs/") {
		return true
	}

	return strings.HasSuffix(base, "_test.go") ||
		strings.Contains(base, ".test.") ||
		strings.Contains(base, ".spec.")
}

func isDiagnosticsPreloadAssetPath(ext string, kind core.FileKind) bool {
	if kind == core.FileKindAsset {
		return true
	}

	switch ext {
	case ".bmp", ".css", ".gif", ".ico", ".jpeg", ".jpg", ".mp3", ".mp4",
		".png", ".svg", ".webm", ".webp", ".woff", ".woff2":
		return true
	default:
		return false
	}
}

func isDiagnosticsPreloadBinaryPath(ext string, kind core.FileKind) bool {
	if kind == core.FileKindBinary {
		return true
	}

	switch ext {
	case ".a", ".bin", ".dll", ".dylib", ".exe", ".gz", ".jar", ".o", ".pdf", ".so", ".tar", ".wasm", ".zip":
		return true
	default:
		return false
	}
}

func cloneDiagnosticsPreloadGroups(
	grouped map[string][]diagnosticsPreloadCandidate,
) map[string][]diagnosticsPreloadCandidate {
	cloned := make(map[string][]diagnosticsPreloadCandidate, len(grouped))
	for language, candidates := range grouped {
		queue := make([]diagnosticsPreloadCandidate, len(candidates))
		copy(queue, candidates)
		cloned[language] = queue
	}
	return cloned
}

func countDiagnosticsPreloadCandidates(
	grouped map[string][]diagnosticsPreloadCandidate,
) int {
	total := 0
	for _, candidates := range grouped {
		total += len(candidates)
	}
	return total
}

func countSelectedDiagnosticsLanguages(
	candidates []diagnosticsPreloadCandidate,
) int {
	if len(candidates) == 0 {
		return 0
	}

	languages := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		languages[candidate.Language] = struct{}{}
	}
	return len(languages)
}

func splitPreloadPath(path string) []string {
	raw := strings.Split(path, "/")
	parts := make([]string, 0, len(raw))
	for _, part := range raw {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func (a *App) lspPreloadProjectDiagnostics(
	projectPath string,
	generation uint64,
) bool {
	a.managerMu.Lock()
	mgr := a.lspManager
	engine := a.coreEngine
	projectCtx := a.projectCtx
	a.managerMu.Unlock()
	currentProjectPath := a.currentProjectPath()

	if mgr == nil {
		return false
	}

	root := projectPath
	if root == "" {
		root = currentProjectPath
	}
	if root == "" {
		return false
	}

	budget := defaultDiagnosticsPreloadBudget()
	ctx := context.Background()
	if projectCtx != nil {
		ctx = projectCtx
	}
	timedCtx, cancel := context.WithTimeout(ctx, budget.Timeout)
	defer cancel()

	plan, err := collectDiagnosticsPreloadPlanWithInventory(root, loadDiagnosticsPreloadInventory(engine), budget)
	if err != nil {
		if err != context.Canceled {
			a.logWarning("[DiagnosticsPreload] collect error: " + err.Error())
		}
		return false
	}
	event := newLSPDiagnosticsPreloadEvent(root, generation, plan)
	a.emitEvent("lsp:diagnostics:preload:start", event)
	openedPaths := make([]string, 0, len(plan.Candidates))

preloadLoop:
	for _, candidate := range plan.Candidates {
		select {
		case <-timedCtx.Done():
			break preloadLoop
		default:
		}

		if a.projectGeneration.Load() != generation {
			return false
		}

		if mgr.IsDocOpen(candidate.Language, candidate.Path) {
			continue
		}

		content, readErr := os.ReadFile(candidate.Path)
		if readErr != nil {
			continue
		}

		opened, openErr := ensureDocOpen(mgr, candidate.Language, candidate.Path, string(content))
		if openErr != nil {
			a.logWarning("[DiagnosticsPreload] " + candidate.Path + ": " + openErr.Error())
			continue
		}
		if opened {
			openedPaths = append(openedPaths, candidate.Path)
		}
	}

	if a.projectGeneration.Load() != generation {
		return false
	}

	if len(openedPaths) > 0 {
		mgr.WaitForDiagnosticsPublications(timedCtx, openedPaths)
	}

	if timedCtx.Err() == nil || errors.Is(timedCtx.Err(), context.DeadlineExceeded) {
		a.emitEvent("lsp:diagnostics:preload:complete", event)
		return timedCtx.Err() == nil
	}

	return false
}

func loadDiagnosticsPreloadInventory(engine *core.Engine) map[string]core.File {
	if engine == nil || engine.Store() == nil {
		return nil
	}

	files, err := engine.Store().GetAllFiles()
	if err != nil {
		return nil
	}
	return files
}
