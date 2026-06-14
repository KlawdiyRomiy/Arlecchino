package app

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
	indexerlsp "arlecchino/internal/indexer/lsp"
	"arlecchino/internal/lsp"
)

var (
	errDiagnosticsPreloadUnsafePath  = errors.New("diagnostics preload candidate is not a regular project file")
	errDiagnosticsPreloadEscapedRoot = errors.New("diagnostics preload candidate is outside the project root")
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

type diagnosticsPreloadOpen struct {
	Language string
	Path     string
}

type diagnosticsPreloadPlan struct {
	Candidates         []diagnosticsPreloadCandidate
	AllCandidates      []diagnosticsPreloadCandidate
	Bounded            bool
	CoverageState      diagnosticsPreloadCoverageState
	CoverageMode       string
	TotalCandidates    int
	SelectedCandidates int
	CheckedCandidates  int
	FailedCandidates   int
	TotalLanguages     int
	SelectedLanguages  int
	TimedOut           bool
	Message            string
}

type diagnosticsPreloadRole string
type diagnosticsPreloadCoverageState string

type diagnosticsPreloadScanResult struct {
	CheckedCandidates int
	FailedCandidates  int
	TimedOut          bool
	Aborted           bool
}

type diagnosticsPreloadScanOptions struct {
	BatchSize            int
	BatchTimeout         time.Duration
	BatchPause           time.Duration
	CandidateOpenTimeout time.Duration
	OnCandidateProcessed func(diagnosticsPreloadScanResult)
	OnBatchComplete      func(diagnosticsPreloadScanResult)
}

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

const (
	diagnosticsPreloadCoveragePending           diagnosticsPreloadCoverageState = "pending"
	diagnosticsPreloadCoverageRunning           diagnosticsPreloadCoverageState = "running"
	diagnosticsPreloadCoverageComplete          diagnosticsPreloadCoverageState = "complete"
	diagnosticsPreloadCoverageIncomplete        diagnosticsPreloadCoverageState = "incomplete"
	diagnosticsPreloadCoverageUnavailable       diagnosticsPreloadCoverageState = "unavailable"
	diagnosticsPreloadCoverageCanceled          diagnosticsPreloadCoverageState = "canceled"
	diagnosticsPreloadCoverageModeSyntheticOpen                                 = "synthetic-open"
)

const (
	diagnosticsPreloadStartupDelay         = 1500 * time.Millisecond
	diagnosticsPreloadIndexerPollInterval  = 750 * time.Millisecond
	diagnosticsPreloadMaxIndexerWait       = 12 * time.Second
	diagnosticsPreloadBatchSize            = 8
	diagnosticsPreloadBatchTimeout         = 1500 * time.Millisecond
	diagnosticsPreloadPreviewBatchPause    = 80 * time.Millisecond
	diagnosticsPreloadBackgroundBatchPause = 250 * time.Millisecond
	diagnosticsPreloadCandidateOpenTimeout = 900 * time.Millisecond
	diagnosticsPreloadCollectionMinTimeout = 10 * time.Second
	diagnosticsPreloadProgressEmitEvery    = 8
	diagnosticsPreloadAutoBackgroundScan   = false
)

func defaultDiagnosticsPreloadBudget() diagnosticsPreloadBudget {
	return diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 80,
		PolyglotLanguageThreshold: 2,
		MaxDominantLanguages:      2,
		MaxFilesPerLanguage:       6,
		MaxFiles:                  12,
		MaxTotalBytes:             2 << 20,
		MaxFileSizeBytes:          256 << 10,
		Timeout:                   4 * time.Second,
	}
}

func adaptDiagnosticsPreloadBudget(
	budget diagnosticsPreloadBudget,
	projectFileCount int,
	queueDepth int,
) diagnosticsPreloadBudget {
	switch {
	case projectFileCount >= 15000 || queueDepth >= 500:
		budget.LargeProjectFileThreshold = 1
		budget.MaxDominantLanguages = 1
		budget.MaxFilesPerLanguage = 1
		budget.MaxFiles = 4
		budget.MaxTotalBytes = 512 << 10
		budget.MaxFileSizeBytes = 128 << 10
		budget.Timeout = 2 * time.Second
		return budget
	case projectFileCount >= 5000 || queueDepth >= 160:
		budget.LargeProjectFileThreshold = 8
		budget.MaxDominantLanguages = 2
		budget.MaxFilesPerLanguage = 2
		budget.MaxFiles = 8
		budget.MaxTotalBytes = 1 << 20
		budget.MaxFileSizeBytes = 192 << 10
		budget.Timeout = 3 * time.Second
		return budget
	default:
		return budget
	}
}

func newLSPDiagnosticsPreloadEvent(
	projectPath string,
	generation uint64,
	plan diagnosticsPreloadPlan,
) LSPDiagnosticsPreloadEvent {
	return newLSPDiagnosticsPreloadEventForSession("", projectPath, generation, plan)
}

func newLSPDiagnosticsPreloadEventForSession(
	sessionID string,
	projectPath string,
	generation uint64,
	plan diagnosticsPreloadPlan,
) LSPDiagnosticsPreloadEvent {
	coverageState := plan.CoverageState
	if coverageState == "" {
		coverageState = diagnosticsPreloadCoverageRunning
	}
	return LSPDiagnosticsPreloadEvent{
		ProjectPath:        projectPath,
		SessionID:          sessionID,
		Generation:         generation,
		Bounded:            plan.Bounded,
		CoverageState:      string(coverageState),
		CoverageMode:       plan.CoverageMode,
		TotalCandidates:    plan.TotalCandidates,
		SelectedCandidates: plan.SelectedCandidates,
		CheckedCandidates:  plan.CheckedCandidates,
		FailedCandidates:   plan.FailedCandidates,
		TotalLanguages:     plan.TotalLanguages,
		SelectedLanguages:  plan.SelectedLanguages,
		TimedOut:           plan.TimedOut,
		Message:            plan.Message,
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
	return collectDiagnosticsPreloadPlanWithInventoryContext(
		context.Background(),
		root,
		inventory,
		budget,
	)
}

func collectDiagnosticsPreloadPlanWithInventoryContext(
	ctx context.Context,
	root string,
	inventory map[string]core.File,
	budget diagnosticsPreloadBudget,
) (diagnosticsPreloadPlan, error) {
	var candidates []diagnosticsPreloadCandidate

	walkErr := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err != nil {
			return nil
		}

		if entry.IsDir() {
			if path != root && shouldSkipPreloadDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}

		if entry.Type()&os.ModeSymlink != 0 {
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
		AllCandidates:   allCandidates,
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
	if budget.MaxDominantLanguages > 0 && len(languages) > budget.MaxDominantLanguages {
		languages = languages[:budget.MaxDominantLanguages]
	}
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

func candidateTargetsForDiagnosticsPreload(candidates []diagnosticsPreloadCandidate) []indexerlsp.DiagnosticsPublicationTarget {
	targets := make([]indexerlsp.DiagnosticsPublicationTarget, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Path != "" {
			targets = append(targets, indexerlsp.DiagnosticsPublicationTarget{
				Language: candidate.Language,
				FilePath: candidate.Path,
			})
		}
	}
	return targets
}

func filterDiagnosticsPreloadPlanForManager(
	plan diagnosticsPreloadPlan,
	mgr *indexerlsp.Manager,
	budget diagnosticsPreloadBudget,
) diagnosticsPreloadPlan {
	if mgr == nil || len(plan.AllCandidates) == 0 {
		return plan
	}

	candidates := make([]diagnosticsPreloadCandidate, 0, len(plan.AllCandidates))
	for _, candidate := range plan.AllCandidates {
		if mgr.HasConfig(candidate.Language) {
			candidates = append(candidates, candidate)
		}
	}
	candidates = filterExpensiveDiagnosticsPreloadTail(candidates, budget)
	return buildDiagnosticsPreloadPlan(candidates, budget)
}

func filterExpensiveDiagnosticsPreloadTail(
	candidates []diagnosticsPreloadCandidate,
	budget diagnosticsPreloadBudget,
) []diagnosticsPreloadCandidate {
	if len(candidates) <= budget.LargeProjectFileThreshold {
		return candidates
	}

	expensiveTotal := 0
	for _, candidate := range candidates {
		if isExpensiveDiagnosticsPreloadLanguage(candidate.Language) {
			expensiveTotal++
		}
	}
	if expensiveTotal == 0 || expensiveTotal*2 >= len(candidates) {
		return candidates
	}

	filtered := make([]diagnosticsPreloadCandidate, 0, len(candidates)-expensiveTotal)
	for _, candidate := range candidates {
		if isExpensiveDiagnosticsPreloadLanguage(candidate.Language) {
			continue
		}
		filtered = append(filtered, candidate)
	}
	if len(filtered) == 0 {
		return candidates
	}
	return filtered
}

func isExpensiveDiagnosticsPreloadLanguage(language string) bool {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "c", "cpp", "c++", "objectivec", "objective-c":
		return true
	default:
		return false
	}
}

func diagnosticsPreloadFullScanProgressPlan(
	previewPlan diagnosticsPreloadPlan,
	checkedCandidates int,
	failedCandidates int,
	timedOut bool,
	message string,
) diagnosticsPreloadPlan {
	fullPlan := previewPlan
	fullPlan.Candidates = previewPlan.AllCandidates
	if len(fullPlan.Candidates) == 0 {
		fullPlan.Candidates = previewPlan.Candidates
	}
	fullPlan.Bounded = false
	fullPlan.CoverageState = diagnosticsPreloadCoverageRunning
	fullPlan.CoverageMode = diagnosticsPreloadCoverageModeSyntheticOpen
	fullPlan.SelectedCandidates = fullPlan.TotalCandidates
	fullPlan.SelectedLanguages = fullPlan.TotalLanguages
	fullPlan.CheckedCandidates = checkedCandidates
	fullPlan.FailedCandidates = failedCandidates
	fullPlan.TimedOut = timedOut
	fullPlan.Message = message
	return fullPlan
}

func diagnosticsPreloadRemainingCandidates(
	allCandidates []diagnosticsPreloadCandidate,
	alreadySelected []diagnosticsPreloadCandidate,
) []diagnosticsPreloadCandidate {
	if len(allCandidates) == 0 || len(alreadySelected) == 0 {
		return allCandidates
	}

	seen := make(map[string]struct{}, len(alreadySelected))
	for _, candidate := range alreadySelected {
		seen[diagnosticsPreloadCandidateKey(candidate)] = struct{}{}
	}

	remaining := make([]diagnosticsPreloadCandidate, 0, maxInt(0, len(allCandidates)-len(seen)))
	for _, candidate := range allCandidates {
		if _, ok := seen[diagnosticsPreloadCandidateKey(candidate)]; ok {
			continue
		}
		remaining = append(remaining, candidate)
	}
	return remaining
}

func diagnosticsPreloadCandidateKey(candidate diagnosticsPreloadCandidate) string {
	return candidate.Language + "\x00" + candidate.Path
}

func diagnosticsPreloadPlanCollectionTimeout(budget diagnosticsPreloadBudget) time.Duration {
	if budget.Timeout > diagnosticsPreloadCollectionMinTimeout {
		return budget.Timeout
	}
	return diagnosticsPreloadCollectionMinTimeout
}

func diagnosticsPreloadPlanForCollectionError(err error) (diagnosticsPreloadPlan, bool) {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return diagnosticsPreloadPlan{
			CoverageState: diagnosticsPreloadCoverageIncomplete,
			CoverageMode:  diagnosticsPreloadCoverageModeSyntheticOpen,
			TimedOut:      true,
			Message:       "Diagnostics scan timed out before selecting project files.",
		}, true
	case errors.Is(err, context.Canceled):
		return diagnosticsPreloadPlan{}, false
	default:
		return diagnosticsPreloadPlan{
			CoverageState: diagnosticsPreloadCoverageUnavailable,
			Message:       "Diagnostics preload could not collect project files.",
		}, true
	}
}

func readDiagnosticsPreloadCandidate(root string, candidate diagnosticsPreloadCandidate) ([]byte, error) {
	if root == "" || candidate.Path == "" {
		return nil, errDiagnosticsPreloadEscapedRoot
	}

	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	pathAbs, err := filepath.Abs(candidate.Path)
	if err != nil {
		return nil, err
	}
	if !diagnosticsPreloadPathWithinRoot(rootAbs, pathAbs) {
		return nil, errDiagnosticsPreloadEscapedRoot
	}

	info, err := os.Lstat(pathAbs)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errDiagnosticsPreloadUnsafePath
	}

	rootReal, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return nil, err
	}
	pathReal, err := filepath.EvalSymlinks(pathAbs)
	if err != nil {
		return nil, err
	}
	if !diagnosticsPreloadPathWithinRoot(rootReal, pathReal) {
		return nil, errDiagnosticsPreloadEscapedRoot
	}

	return os.ReadFile(pathAbs)
}

func diagnosticsPreloadPathWithinRoot(root string, path string) bool {
	root = filepath.Clean(root)
	path = filepath.Clean(path)
	if root == "" || path == "" {
		return false
	}
	if path == root {
		return true
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." || filepath.IsAbs(rel) {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func (a *App) runDiagnosticsPreloadScanForSession(
	ctx context.Context,
	session *ProjectRuntimeSession,
	mgr *indexerlsp.Manager,
	root string,
	generation uint64,
	preloadSeq uint64,
	candidates []diagnosticsPreloadCandidate,
) diagnosticsPreloadScanResult {
	return a.runDiagnosticsPreloadScanForSessionWithOptions(ctx, session, mgr, root, generation, preloadSeq, candidates, diagnosticsPreloadScanOptions{})
}

func (a *App) runDiagnosticsPreloadScanForSessionWithOptions(
	ctx context.Context,
	session *ProjectRuntimeSession,
	mgr *indexerlsp.Manager,
	root string,
	generation uint64,
	preloadSeq uint64,
	candidates []diagnosticsPreloadCandidate,
	options diagnosticsPreloadScanOptions,
) diagnosticsPreloadScanResult {
	if ctx == nil {
		ctx = context.Background()
	}
	if mgr == nil || len(candidates) == 0 {
		return diagnosticsPreloadScanResult{}
	}
	batchSize := options.BatchSize
	if batchSize <= 0 {
		batchSize = diagnosticsPreloadBatchSize
	}
	batchTimeout := options.BatchTimeout
	if batchTimeout <= 0 {
		batchTimeout = diagnosticsPreloadBatchTimeout
	}
	candidateOpenTimeout := options.CandidateOpenTimeout
	if candidateOpenTimeout <= 0 {
		candidateOpenTimeout = diagnosticsPreloadCandidateOpenTimeout
	}

	result := diagnosticsPreloadScanResult{}
	markCandidateProcessed := func() {
		result.CheckedCandidates++
		if options.OnCandidateProcessed != nil {
			options.OnCandidateProcessed(result)
		}
	}
	for start := 0; start < len(candidates); start += batchSize {
		select {
		case <-ctx.Done():
			result.TimedOut = result.TimedOut || errors.Is(ctx.Err(), context.DeadlineExceeded)
			return result
		default:
		}

		if session.projectGeneration.Load() != generation || !a.isCurrentDiagnosticsPreloadForSession(session, preloadSeq) {
			result.Aborted = true
			return result
		}

		end := start + batchSize
		if end > len(candidates) {
			end = len(candidates)
		}
		batch := candidates[start:end]
		baseline := mgr.CaptureDiagnosticsPublicationBaseline(candidateTargetsForDiagnosticsPreload(batch))
		openedDocs := make([]diagnosticsPreloadOpen, 0, len(batch))
		tracked := make(map[string]uint64, len(baseline))

		for _, candidate := range batch {
			targetKey := indexerlsp.DiagnosticsPublicationKey(candidate.Language, candidate.Path)
			version, ok := baseline[targetKey]
			if !ok {
				continue
			}
			if mgr.IsDocOpen(candidate.Language, candidate.Path) && version > 0 {
				continue
			}
			tracked[targetKey] = version
		}

		for _, candidate := range batch {
			select {
			case <-ctx.Done():
				result.TimedOut = result.TimedOut || errors.Is(ctx.Err(), context.DeadlineExceeded)
				closeDiagnosticsPreloadDocs(a, mgr, openedDocs)
				return result
			default:
			}

			if session.projectGeneration.Load() != generation || !a.isCurrentDiagnosticsPreloadForSession(session, preloadSeq) {
				result.Aborted = true
				closeDiagnosticsPreloadDocs(a, mgr, openedDocs)
				return result
			}

			if mgr.IsDocOpen(candidate.Language, candidate.Path) {
				markCandidateProcessed()
				continue
			}

			content, readErr := readDiagnosticsPreloadCandidate(root, candidate)
			if readErr != nil {
				result.FailedCandidates++
				delete(tracked, indexerlsp.DiagnosticsPublicationKey(candidate.Language, candidate.Path))
				markCandidateProcessed()
				continue
			}

			openCtx := ctx
			var openCancel context.CancelFunc
			if candidateOpenTimeout > 0 {
				openCtx, openCancel = context.WithTimeout(ctx, candidateOpenTimeout)
			}
			openCtx = indexerlsp.WithStartReason(openCtx, activationManualProjectScan)
			opened, openErr := mgr.DidOpenTransientWithContext(openCtx, candidate.Language, candidate.Path, string(content))
			if openCancel != nil {
				openCancel()
			}
			if openErr != nil {
				if errors.Is(openErr, context.DeadlineExceeded) || errors.Is(openErr, context.Canceled) {
					result.TimedOut = true
				} else {
					message := "Diagnostics preload could not open one selected file."
					a.emitLSPDiagnosticsStatusForSession(session.ID, root, generation, candidate.Language, "", "error", message)
				}
				a.logWarning("[DiagnosticsPreload] " + candidate.Path + ": " + openErr.Error())
				result.FailedCandidates++
				delete(tracked, indexerlsp.DiagnosticsPublicationKey(candidate.Language, candidate.Path))
				markCandidateProcessed()
				continue
			}
			if opened {
				openedDocs = append(openedDocs, diagnosticsPreloadOpen{Language: candidate.Language, Path: candidate.Path})
			} else if !mgr.IsDocOpen(candidate.Language, candidate.Path) {
				result.FailedCandidates++
				delete(tracked, indexerlsp.DiagnosticsPublicationKey(candidate.Language, candidate.Path))
			}
			markCandidateProcessed()
		}

		publicationsComplete := true
		if len(tracked) > 0 {
			waitCtx, cancel := context.WithTimeout(ctx, batchTimeout)
			publicationsComplete = mgr.WaitForDiagnosticsPublicationsSince(waitCtx, tracked)
			cancel()
		}
		if !publicationsComplete {
			result.TimedOut = true
		}

		closeDiagnosticsPreloadDocs(a, mgr, openedDocs)
		if options.OnBatchComplete != nil {
			options.OnBatchComplete(result)
		}
		if options.BatchPause > 0 && end < len(candidates) {
			timer := time.NewTimer(options.BatchPause)
			select {
			case <-ctx.Done():
				timer.Stop()
				result.TimedOut = result.TimedOut || errors.Is(ctx.Err(), context.DeadlineExceeded)
				return result
			case <-timer.C:
			}
		}
	}

	return result
}

func closeDiagnosticsPreloadDocs(a *App, mgr *indexerlsp.Manager, openedDocs []diagnosticsPreloadOpen) {
	if mgr == nil {
		return
	}
	for index := len(openedDocs) - 1; index >= 0; index-- {
		doc := openedDocs[index]
		if err := mgr.DidCloseTransient(doc.Language, doc.Path); err != nil && a != nil {
			a.logWarning("[DiagnosticsPreload] failed to close transient doc " + doc.Path + ": " + err.Error())
		}
	}
}

func completeDiagnosticsPreloadPlan(
	plan diagnosticsPreloadPlan,
	checkedCandidates int,
	failedCandidates int,
	timedOut bool,
) diagnosticsPreloadPlan {
	plan.CoverageMode = diagnosticsPreloadCoverageModeSyntheticOpen
	plan.CheckedCandidates = checkedCandidates
	plan.FailedCandidates = failedCandidates
	plan.TimedOut = timedOut

	switch {
	case plan.TotalCandidates == 0:
		plan.CoverageState = diagnosticsPreloadCoverageUnavailable
		plan.Message = "Workspace diagnostics are not available for the detected files in this project yet."
	case plan.Bounded || plan.SelectedCandidates < plan.TotalCandidates:
		plan.CoverageState = diagnosticsPreloadCoverageIncomplete
		plan.Message = "Diagnostics scan checked a bounded subset of this project."
	case timedOut:
		plan.CoverageState = diagnosticsPreloadCoverageIncomplete
		plan.Message = "Diagnostics scan timed out before all selected files published diagnostics."
	case failedCandidates > 0:
		plan.CoverageState = diagnosticsPreloadCoverageIncomplete
		plan.Message = "Diagnostics scan could not open every selected file."
	case checkedCandidates < plan.SelectedCandidates:
		plan.CoverageState = diagnosticsPreloadCoverageIncomplete
		plan.Message = "Diagnostics scan did not receive diagnostics publications for every selected file."
	default:
		plan.CoverageState = diagnosticsPreloadCoverageComplete
	}

	return plan
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

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func (a *App) lspPreloadProjectDiagnostics(
	projectPath string,
	generation uint64,
) bool {
	return a.lspPreloadProjectDiagnosticsForSession(a.activeProjectSession(), projectPath, generation)
}

func (a *App) startProjectDiagnosticsPreloadForSession(
	session *ProjectRuntimeSession,
	projectPath string,
	generation uint64,
) {
	if session == nil || session.projectCtx == nil {
		return
	}

	ctx := session.projectCtx
	session.wg.Add(1)
	go func() {
		defer session.wg.Done()
		a.logInfof("[DiagnosticsPreload] scheduled session=%s project=%s generation=%d delayMs=%d",
			session.ID,
			filepath.Base(projectPath),
			generation,
			diagnosticsPreloadStartupDelay.Milliseconds(),
		)
		if !a.waitForDiagnosticsPreloadWindow(ctx, session, projectPath, generation) {
			return
		}
		if session.projectGeneration.Load() != generation ||
			!diagnosticsPreloadProjectMatches(session.currentProjectPath(), projectPath) {
			return
		}
		a.logInfof("[DiagnosticsPreload] starting session=%s project=%s generation=%d",
			session.ID,
			filepath.Base(projectPath),
			generation,
		)
		a.lspPreloadProjectDiagnosticsForSession(session, projectPath, generation)
	}()
}

func (a *App) waitForDiagnosticsPreloadWindow(
	ctx context.Context,
	session *ProjectRuntimeSession,
	projectPath string,
	generation uint64,
) bool {
	if !sleepWithContext(ctx, diagnosticsPreloadStartupDelay) {
		return false
	}

	startedAt := time.Now()
	for {
		if session == nil ||
			session.projectGeneration.Load() != generation ||
			!diagnosticsPreloadProjectMatches(session.currentProjectPath(), projectPath) {
			return false
		}

		engine := session.coreEngine
		if engine == nil {
			return true
		}
		stats := engine.SchedulerStats()
		if stats.Pending == 0 {
			return true
		}
		if time.Since(startedAt) >= diagnosticsPreloadMaxIndexerWait {
			a.logInfof("[DiagnosticsPreload] starting before indexer idle session=%s project=%s generation=%d pending=%d waitedMs=%d",
				session.ID,
				filepath.Base(projectPath),
				generation,
				stats.Pending,
				time.Since(startedAt).Milliseconds(),
			)
			return true
		}
		if !sleepWithContext(ctx, diagnosticsPreloadIndexerPollInterval) {
			return false
		}
	}
}

func sleepWithContext(ctx context.Context, duration time.Duration) bool {
	if duration <= 0 {
		return true
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func diagnosticsPreloadProjectMatches(currentPath string, expectedPath string) bool {
	currentPath = strings.TrimSpace(currentPath)
	expectedPath = strings.TrimSpace(expectedPath)
	if currentPath == "" || expectedPath == "" {
		return currentPath == expectedPath
	}
	return filepath.Clean(currentPath) == filepath.Clean(expectedPath)
}

func (a *App) lspPreloadProjectDiagnosticsForSession(
	session *ProjectRuntimeSession,
	projectPath string,
	generation uint64,
) bool {
	if session == nil {
		session = defaultProjectSessionFromApp(a)
	}
	a.managerMu.Lock()
	mgr := session.lspManager
	engine := session.coreEngine
	projectCtx := session.projectCtx
	a.managerMu.Unlock()
	currentProjectPath := session.currentProjectPath()

	root := projectPath
	if root == "" {
		root = currentProjectPath
	}
	if root == "" {
		return false
	}
	if session.projectGeneration.Load() != generation ||
		!diagnosticsPreloadProjectMatches(currentProjectPath, root) {
		a.logInfof("[DiagnosticsPreload] skipped stale request session=%s project=%s current=%s generation=%d currentGeneration=%d",
			session.ID,
			filepath.Base(root),
			filepath.Base(currentProjectPath),
			generation,
			session.projectGeneration.Load(),
		)
		return false
	}
	if mgr == nil {
		a.emitLSPDiagnosticsStatusForSession(session.ID, root, generation, "", "", "unavailable", "LSP diagnostics manager is not available")
		unavailablePlan := diagnosticsPreloadPlan{
			CoverageState: diagnosticsPreloadCoverageUnavailable,
			Message:       "LSP diagnostics manager is not available",
		}
		a.recordBackgroundDiagnosticsScan(session.ID, root, generation, unavailablePlan, 0, 0, BackgroundShellJobFailed, unavailablePlan.Message)
		a.emitEvent("lsp:diagnostics:preload:complete", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, unavailablePlan))
		return false
	}

	ctx := context.Background()
	if projectCtx != nil {
		ctx = projectCtx
	}
	inventory := loadDiagnosticsPreloadInventory(engine)
	budget := defaultDiagnosticsPreloadBudget()
	queueDepth := 0
	projectFileCount := len(inventory)
	if engine != nil {
		queueDepth = engine.SchedulerStats().Pending
		stats := engine.Stats()
		if projectFileCount == 0 {
			projectFileCount = stats.TotalFiles
		}
	}
	budget = adaptDiagnosticsPreloadBudget(budget, projectFileCount, queueDepth)
	a.logInfof("[DiagnosticsPreload] collect session=%s project=%s generation=%d files=%d queue=%d maxFiles=%d maxPerLanguage=%d timeoutMs=%d",
		session.ID,
		filepath.Base(root),
		generation,
		projectFileCount,
		queueDepth,
		budget.MaxFiles,
		budget.MaxFilesPerLanguage,
		budget.Timeout.Milliseconds(),
	)
	preloadCtx, cancel, preloadSeq := a.beginDiagnosticsPreloadForSession(session, ctx, 0)
	defer cancel()
	diagnosticsJobID := backgroundDiagnosticsJobID(session.ID, generation)
	a.registerBackgroundJobCancel(diagnosticsJobID, cancel)
	defer a.unregisterBackgroundJobCancel(diagnosticsJobID)
	a.recordBackgroundDiagnosticsScan(session.ID, root, generation, diagnosticsPreloadPlan{}, 0, 0, BackgroundShellJobRunning, "Collecting project diagnostics.")

	collectCtx, collectCancel := context.WithTimeout(preloadCtx, diagnosticsPreloadPlanCollectionTimeout(budget))
	plan, err := collectDiagnosticsPreloadPlanWithInventoryContext(collectCtx, root, inventory, budget)
	collectCancel()
	if err != nil {
		failedPlan, shouldEmit := diagnosticsPreloadPlanForCollectionError(err)
		if errors.Is(err, context.Canceled) {
			canceledPlan := diagnosticsPreloadPlan{
				CoverageState: diagnosticsPreloadCoverageCanceled,
				CoverageMode:  diagnosticsPreloadCoverageModeSyntheticOpen,
				Message:       "Project diagnostics scan was canceled.",
			}
			a.recordBackgroundDiagnosticsScan(session.ID, root, generation, canceledPlan, 0, 0, BackgroundShellJobCanceled, canceledPlan.Message)
			a.emitEvent("lsp:diagnostics:preload:complete", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, canceledPlan))
			return false
		}
		if shouldEmit {
			a.logWarning("[DiagnosticsPreload] collect error: " + err.Error())
			if failedPlan.CoverageState == diagnosticsPreloadCoverageUnavailable {
				a.emitLSPDiagnosticsStatusForSession(session.ID, root, generation, "", "", "error", failedPlan.Message)
			}
			a.recordBackgroundDiagnosticsScan(session.ID, root, generation, failedPlan, failedPlan.CheckedCandidates, failedPlan.FailedCandidates, BackgroundShellJobFailed, failedPlan.Message)
			a.emitEvent("lsp:diagnostics:preload:complete", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, failedPlan))
		}
		return false
	}
	plan = filterDiagnosticsPreloadPlanForManager(plan, mgr, budget)
	plan.CoverageState = diagnosticsPreloadCoverageRunning
	plan.CoverageMode = diagnosticsPreloadCoverageModeSyntheticOpen
	a.logInfof("[DiagnosticsPreload] plan session=%s project=%s generation=%d total=%d selected=%d languages=%d selectedLanguages=%d bounded=%t",
		session.ID,
		filepath.Base(root),
		generation,
		plan.TotalCandidates,
		plan.SelectedCandidates,
		plan.TotalLanguages,
		plan.SelectedLanguages,
		plan.Bounded,
	)
	a.recordBackgroundDiagnosticsScan(session.ID, root, generation, plan, 0, 0, BackgroundShellJobRunning, "Collecting project diagnostics.")
	a.emitEvent("lsp:diagnostics:preload:start", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, plan))

	emitPreviewProgress := func(result diagnosticsPreloadScanResult) {
		a.recordBackgroundDiagnosticsScan(session.ID, root, generation, plan, result.CheckedCandidates, result.FailedCandidates, BackgroundShellJobRunning, "")
	}
	previewCtx, previewCancel := context.WithTimeout(preloadCtx, budget.Timeout)
	previewResult := a.runDiagnosticsPreloadScanForSessionWithOptions(
		previewCtx,
		session,
		mgr,
		root,
		generation,
		preloadSeq,
		plan.Candidates,
		diagnosticsPreloadScanOptions{
			BatchPause:      diagnosticsPreloadPreviewBatchPause,
			OnBatchComplete: emitPreviewProgress,
		},
	)
	previewCancel()
	if previewResult.Aborted {
		a.logInfof("[DiagnosticsPreload] preview aborted session=%s project=%s generation=%d checked=%d failed=%d",
			session.ID,
			filepath.Base(root),
			generation,
			previewResult.CheckedCandidates,
			previewResult.FailedCandidates,
		)
		canceledPlan := plan
		canceledPlan.CoverageState = diagnosticsPreloadCoverageCanceled
		canceledPlan.CoverageMode = diagnosticsPreloadCoverageModeSyntheticOpen
		canceledPlan.CheckedCandidates = previewResult.CheckedCandidates
		canceledPlan.FailedCandidates = previewResult.FailedCandidates
		canceledPlan.Message = "Project diagnostics scan was canceled."
		a.recordBackgroundDiagnosticsScan(session.ID, root, generation, canceledPlan, previewResult.CheckedCandidates, previewResult.FailedCandidates, BackgroundShellJobCanceled, canceledPlan.Message)
		a.emitEvent("lsp:diagnostics:preload:complete", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, canceledPlan))
		return false
	}

	checkedCandidates := previewResult.CheckedCandidates
	failedCandidates := previewResult.FailedCandidates
	timedOut := previewResult.TimedOut

	remainingCandidates := diagnosticsPreloadRemainingCandidates(plan.AllCandidates, plan.Candidates)
	if plan.Bounded && len(remainingCandidates) > 0 && !diagnosticsPreloadAutoBackgroundScan {
		a.logInfof("[DiagnosticsPreload] deferred full scan session=%s project=%s generation=%d remaining=%d",
			session.ID,
			filepath.Base(root),
			generation,
			len(remainingCandidates),
		)
	}
	if diagnosticsPreloadAutoBackgroundScan && plan.Bounded && len(remainingCandidates) > 0 && preloadCtx.Err() == nil {
		fullProgressPlan := diagnosticsPreloadFullScanProgressPlan(
			plan,
			checkedCandidates,
			failedCandidates,
			timedOut,
			"Still scanning diagnostics across this project.",
		)
		a.emitEvent("lsp:diagnostics:preload:start", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, fullProgressPlan))

		lastProgressChecked := checkedCandidates
		emitBackgroundProgress := func(result diagnosticsPreloadScanResult, force bool) {
			totalChecked := previewResult.CheckedCandidates + result.CheckedCandidates
			if !force && totalChecked-lastProgressChecked < diagnosticsPreloadProgressEmitEvery {
				return
			}
			lastProgressChecked = totalChecked
			progressPlan := diagnosticsPreloadFullScanProgressPlan(
				plan,
				totalChecked,
				previewResult.FailedCandidates+result.FailedCandidates,
				previewResult.TimedOut || result.TimedOut,
				"Still scanning diagnostics across this project.",
			)
			a.emitEvent("lsp:diagnostics:preload:start", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, progressPlan))
		}

		backgroundResult := a.runDiagnosticsPreloadScanForSessionWithOptions(
			preloadCtx,
			session,
			mgr,
			root,
			generation,
			preloadSeq,
			remainingCandidates,
			diagnosticsPreloadScanOptions{
				BatchPause: diagnosticsPreloadBackgroundBatchPause,
				OnCandidateProcessed: func(result diagnosticsPreloadScanResult) {
					emitBackgroundProgress(result, false)
				},
				OnBatchComplete: func(result diagnosticsPreloadScanResult) {
					emitBackgroundProgress(result, true)
				},
			},
		)
		if backgroundResult.Aborted {
			a.logInfof("[DiagnosticsPreload] background aborted session=%s project=%s generation=%d checked=%d failed=%d",
				session.ID,
				filepath.Base(root),
				generation,
				backgroundResult.CheckedCandidates,
				backgroundResult.FailedCandidates,
			)
			canceledPlan := plan
			canceledPlan.CoverageState = diagnosticsPreloadCoverageCanceled
			canceledPlan.CoverageMode = diagnosticsPreloadCoverageModeSyntheticOpen
			canceledPlan.CheckedCandidates = checkedCandidates + backgroundResult.CheckedCandidates
			canceledPlan.FailedCandidates = failedCandidates + backgroundResult.FailedCandidates
			canceledPlan.Message = "Project diagnostics scan was canceled."
			a.recordBackgroundDiagnosticsScan(session.ID, root, generation, canceledPlan, canceledPlan.CheckedCandidates, canceledPlan.FailedCandidates, BackgroundShellJobCanceled, canceledPlan.Message)
			a.emitEvent("lsp:diagnostics:preload:complete", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, canceledPlan))
			return false
		}
		checkedCandidates += backgroundResult.CheckedCandidates
		failedCandidates += backgroundResult.FailedCandidates
		timedOut = timedOut || backgroundResult.TimedOut
		plan = diagnosticsPreloadFullScanProgressPlan(plan, checkedCandidates, failedCandidates, timedOut, "")
	}

	completedPlan := completeDiagnosticsPreloadPlan(plan, checkedCandidates, failedCandidates, timedOut)
	if preloadCtx.Err() == nil || errors.Is(preloadCtx.Err(), context.DeadlineExceeded) {
		a.logInfof("[DiagnosticsPreload] complete session=%s project=%s generation=%d coverage=%s checked=%d failed=%d timedOut=%t",
			session.ID,
			filepath.Base(root),
			generation,
			completedPlan.CoverageState,
			checkedCandidates,
			failedCandidates,
			timedOut,
		)
		a.emitEvent("lsp:diagnostics:preload:complete", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, completedPlan))
		a.recordBackgroundDiagnosticsScan(session.ID, root, generation, completedPlan, checkedCandidates, failedCandidates, BackgroundShellJobSucceeded, completedPlan.Message)
		return completedPlan.CoverageState == diagnosticsPreloadCoverageComplete
	}

	a.logInfof("[DiagnosticsPreload] canceled session=%s project=%s generation=%d err=%v",
		session.ID,
		filepath.Base(root),
		generation,
		preloadCtx.Err(),
	)
	canceledPlan := plan
	canceledPlan.CoverageState = diagnosticsPreloadCoverageCanceled
	canceledPlan.CoverageMode = diagnosticsPreloadCoverageModeSyntheticOpen
	canceledPlan.CheckedCandidates = checkedCandidates
	canceledPlan.FailedCandidates = failedCandidates
	canceledPlan.TimedOut = timedOut
	canceledPlan.Message = "Project diagnostics scan was canceled."
	a.recordBackgroundDiagnosticsScan(session.ID, root, generation, canceledPlan, checkedCandidates, failedCandidates, BackgroundShellJobCanceled, canceledPlan.Message)
	a.emitEvent("lsp:diagnostics:preload:complete", newLSPDiagnosticsPreloadEventForSession(session.ID, root, generation, canceledPlan))
	return false
}

func (a *App) beginDiagnosticsPreload(
	ctx context.Context,
	timeout time.Duration,
) (context.Context, context.CancelFunc, uint64) {
	return a.beginDiagnosticsPreloadForSession(a.activeProjectSession(), ctx, timeout)
}

func (a *App) beginDiagnosticsPreloadForSession(
	session *ProjectRuntimeSession,
	ctx context.Context,
	timeout time.Duration,
) (context.Context, context.CancelFunc, uint64) {
	if ctx == nil {
		ctx = context.Background()
	}
	if session == nil {
		session = defaultProjectSessionFromApp(a)
	}

	var timedCtx context.Context
	var cancel context.CancelFunc
	if timeout > 0 {
		timedCtx, cancel = context.WithTimeout(ctx, timeout)
	} else {
		timedCtx, cancel = context.WithCancel(ctx)
	}

	session.diagnosticsPreloadMu.Lock()
	if session.diagnosticsPreloadCancel != nil {
		session.diagnosticsPreloadCancel()
	}
	session.diagnosticsPreloadSeq++
	seq := session.diagnosticsPreloadSeq
	session.diagnosticsPreloadCancel = cancel
	session.diagnosticsPreloadMu.Unlock()

	return timedCtx, func() {
		cancel()
		session.diagnosticsPreloadMu.Lock()
		if session.diagnosticsPreloadSeq == seq {
			session.diagnosticsPreloadCancel = nil
		}
		session.diagnosticsPreloadMu.Unlock()
	}, seq
}

func (a *App) isCurrentDiagnosticsPreload(seq uint64) bool {
	return a.isCurrentDiagnosticsPreloadForSession(a.activeProjectSession(), seq)
}

func (a *App) isCurrentDiagnosticsPreloadForSession(session *ProjectRuntimeSession, seq uint64) bool {
	if session == nil {
		session = defaultProjectSessionFromApp(a)
	}
	session.diagnosticsPreloadMu.Lock()
	defer session.diagnosticsPreloadMu.Unlock()
	return session.diagnosticsPreloadSeq == seq
}

func (a *App) cancelDiagnosticsPreload() {
	a.cancelDiagnosticsPreloadForSession(a.activeProjectSession())
}

func (a *App) cancelDiagnosticsPreloadForSession(session *ProjectRuntimeSession) {
	if session == nil {
		session = defaultProjectSessionFromApp(a)
	}
	session.diagnosticsPreloadMu.Lock()
	cancel := session.diagnosticsPreloadCancel
	session.diagnosticsPreloadSeq++
	session.diagnosticsPreloadCancel = nil
	session.diagnosticsPreloadMu.Unlock()

	if cancel != nil {
		cancel()
	}
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
