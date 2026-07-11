package brain

import (
	"context"
	"log"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ArleMode int

const (
	ArleModeNone         ArleMode = iota // Deterministic only
	ArleModeArle                         // Deterministic + local ML
	ArleModeArleProvider                 // Deterministic + local ML + external AI
)

func (m ArleMode) String() string {
	switch m {
	case ArleModeNone:
		return "none"
	case ArleModeArle:
		return "arle"
	case ArleModeArleProvider:
		return "arle-provider"
	default:
		return "unknown"
	}
}

type ArleState int

const (
	ArleUnloaded ArleState = iota
	ArleLoading
	ArleReady
	ArleFailed
)

func (s ArleState) String() string {
	switch s {
	case ArleUnloaded:
		return "unloaded"
	case ArleLoading:
		return "loading"
	case ArleReady:
		return "ready"
	case ArleFailed:
		return "failed"
	default:
		return "unknown"
	}
}

type ArleConfig struct {
	Mode            ArleMode
	ModelPath       string
	VocabPath       string
	DataDir         string
	ContextSize     int
	MaxGhostTokens  int
	MaxRerankItems  int
	LazyLoadDelay   time.Duration
	IdleUnloadTime  time.Duration
	EnableLearning  bool
	EnableGhostText bool
	EnableRerank    bool
}

func DefaultArleConfig() ArleConfig {
	homeDir, _ := os.UserHomeDir()
	dataDir := filepath.Join(homeDir, ".arlecchino")

	assetsDir := findAssetsDir()
	log.Printf("[ARLE] assetsDir=%s", assetsDir)

	modelPath := filepath.Join(assetsDir, "arle_model.onnx")
	if _, err := os.Stat(modelPath); err != nil {
		log.Printf("[ARLE] ONNX model not found at %s, trying .pt", modelPath)
		modelPath = filepath.Join(assetsDir, "arle_model.pt")
	}

	vocabPath := filepath.Join(assetsDir, "arle_tokenizer.json")

	if _, err := os.Stat(modelPath); err != nil {
		log.Printf("[ARLE] WARNING: model not found at %s", modelPath)
	} else {
		log.Printf("[ARLE] model found at %s", modelPath)
	}

	if _, err := os.Stat(vocabPath); err != nil {
		log.Printf("[ARLE] WARNING: tokenizer not found at %s", vocabPath)
	} else {
		log.Printf("[ARLE] tokenizer found at %s", vocabPath)
	}

	config := ArleConfig{
		Mode:            ArleModeArle,
		ModelPath:       modelPath,
		VocabPath:       vocabPath,
		DataDir:         dataDir,
		ContextSize:     128,
		MaxGhostTokens:  4,
		MaxRerankItems:  12,
		LazyLoadDelay:   0,
		IdleUnloadTime:  5 * time.Minute,
		EnableLearning:  true,
		EnableGhostText: true,
		EnableRerank:    true,
	}

	logArleConfiguredModelState(config)
	return config
}

func logArleConfiguredModelState(config ArleConfig) {
	modelInfo, modelErr := os.Stat(config.ModelPath)
	modelExists := modelErr == nil && !modelInfo.IsDir()
	tokenizerInfo, tokenizerErr := os.Stat(config.VocabPath)
	tokenizerExists := tokenizerErr == nil && !tokenizerInfo.IsDir()
	runtimePath, runtimeAvailable, runtimeCandidates := inspectONNXRuntimeForModel(config.ModelPath)
	log.Printf(
		"[ARLE] model state: phase=config mode=%s state=%s backend=deferred modelExists=%v modelBytes=%d modelPath=%s tokenizerExists=%v tokenizerBytes=%d tokenizerPath=%s onnxRuntimeAvailable=%v onnxRuntimePath=%s onnxRuntimeCandidates=%d lazyLoadDelay=%s",
		config.Mode,
		ArleUnloaded,
		modelExists,
		fileSizeOrZero(modelInfo, modelExists),
		config.ModelPath,
		tokenizerExists,
		fileSizeOrZero(tokenizerInfo, tokenizerExists),
		config.VocabPath,
		runtimeAvailable,
		runtimePath,
		runtimeCandidates,
		config.LazyLoadDelay,
	)
}

func fileSizeOrZero(info os.FileInfo, ok bool) int64 {
	if !ok || info == nil {
		return 0
	}
	return info.Size()
}

func findAssetsDir() string {
	exe, err := os.Executable()
	log.Printf("[ARLE] findAssetsDir: executable=%s err=%v", exe, err)

	cwd, _ := os.Getwd()
	log.Printf("[ARLE] findAssetsDir: cwd=%s", cwd)
	homeDir, _ := os.UserHomeDir()

	return resolveAssetsDir(assetsDirLookup{
		exePath: exe,
		cwd:     cwd,
		homeDir: homeDir,
		goos:    runtime.GOOS,
	}, func(format string, args ...any) {
		log.Printf(format, args...)
	})
}

type assetsDirLookup struct {
	exePath string
	cwd     string
	homeDir string
	goos    string
}

func resolveAssetsDir(lookup assetsDirLookup, logf func(string, ...any)) string {
	if logf == nil {
		logf = func(string, ...any) {}
	}

	if lookup.exePath != "" {
		exeDir := filepath.Dir(lookup.exePath)
		logf("[ARLE] findAssetsDir: exeDir=%s", exeDir)

		candidates := []string{
			filepath.Join(exeDir, "assets"),
			filepath.Join(exeDir, "..", "assets"),
			filepath.Join(exeDir, "..", "Resources", "assets"),
		}

		if lookup.goos == "darwin" {
			candidates = append(candidates, filepath.Join(exeDir, "..", "Resources"))
		}

		for _, dir := range candidates {
			if hasArleModel(dir) {
				logf("[ARLE] findAssetsDir: found exeDir candidate with model %s", dir)
				return dir
			}
		}
	}

	candidates := []string{
		filepath.Join(lookup.cwd, "assets"),
		filepath.Join(lookup.cwd, "..", "assets"),
		filepath.Join(lookup.cwd, "..", "..", "assets"),
		filepath.Join(lookup.cwd, "..", "..", "..", "assets"),
		filepath.Join(lookup.cwd, "arlecchino", "assets"),
		filepath.Join(lookup.cwd, "..", "arlecchino", "assets"),
	}

	for _, dir := range candidates {
		if hasArleModel(dir) {
			logf("[ARLE] findAssetsDir: found cwd candidate with model %s", dir)
			return dir
		}
	}

	if found := findAssetsDirByMarker(lookup.cwd); found != "" {
		logf("[ARLE] findAssetsDir: found by marker %s", found)
		return found
	}

	if lookup.exePath != "" {
		exeDir := filepath.Dir(lookup.exePath)
		if found := findAssetsDirByMarker(exeDir); found != "" {
			logf("[ARLE] findAssetsDir: found by marker from exeDir %s", found)
			return found
		}
	}

	fallback := filepath.Join(lookup.homeDir, ".arlecchino", "models")
	logf("[ARLE] findAssetsDir: using fallback %s", fallback)
	return fallback
}

func hasArleModel(dir string) bool {
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return false
	}
	markers := []string{
		filepath.Join(dir, "arle_tokenizer.json"),
		filepath.Join(dir, "arle_model.onnx"),
		filepath.Join(dir, "arle_model.pt"),
	}
	for _, marker := range markers {
		if _, err := os.Stat(marker); err == nil {
			return true
		}
	}
	return false
}

func findAssetsDirByMarker(startDir string) string {
	dir := startDir
	for i := 0; i < 10; i++ {
		assetsDir := filepath.Join(dir, "assets")
		markerFile := filepath.Join(assetsDir, "arle_tokenizer.json")
		if _, err := os.Stat(markerFile); err == nil {
			return assetsDir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

type Arle struct {
	mu             sync.RWMutex
	config         ArleConfig
	state          atomic.Int32
	tokenizer      *ArleTokenizer
	backend        ArleBackend
	projectLearn   *ProjectLearner
	lastUsed       atomic.Int64
	closed         atomic.Bool
	loadCycle      *arleLoadCycle
	unloadTimer    *time.Timer
	cancelPrefetch context.CancelFunc
}

type arleLoadCycle struct {
	done chan struct{}
	err  error
}

func NewArle(config ArleConfig) *Arle {
	if config.ContextSize == 0 {
		config.ContextSize = 1024
	}
	if config.MaxGhostTokens == 0 {
		config.MaxGhostTokens = 4
	}
	if config.MaxRerankItems == 0 {
		config.MaxRerankItems = 12
	}
	if config.IdleUnloadTime == 0 {
		config.IdleUnloadTime = 5 * time.Minute
	}

	a := &Arle{
		config: config,
	}
	a.state.Store(int32(ArleUnloaded))
	log.Printf("[ARLE] lifecycle: phase=create mode=%s state=%s lazyLoadDelay=%s idleUnload=%s rerank=%v rerankItems=%d ghostText=%v ghostTokens=%d backendLoad=deferred", config.Mode, ArleUnloaded, config.LazyLoadDelay, config.IdleUnloadTime, config.EnableRerank, config.MaxRerankItems, config.EnableGhostText, config.MaxGhostTokens)

	if config.Mode == ArleModeNone {
		return a
	}

	if config.LazyLoadDelay > 0 {
		ctx, cancel := context.WithCancel(context.Background())
		a.cancelPrefetch = cancel
		go func() {
			timer := time.NewTimer(config.LazyLoadDelay)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				a.EnsureLoaded()
			}
		}()
	}

	return a
}

func (a *Arle) StartLoadingAsync() {
	cycle, owner := a.beginLoad()
	if !owner {
		return
	}
	a.mu.RLock()
	mode := a.config.Mode
	modelPath := a.config.ModelPath
	a.mu.RUnlock()
	log.Printf("[ARLE] model state: phase=async-load-request mode=%s state=%s modelPath=%s", mode, a.State(), modelPath)
	go func() {
		if err := a.load(cycle); err != nil {
			log.Printf("[ARLE] async load failed: %v", err)
		}
	}()
}

func (a *Arle) beginLoad() (*arleLoadCycle, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.closed.Load() || a.config.Mode == ArleModeNone {
		return nil, false
	}

	switch a.State() {
	case ArleLoading:
		return a.loadCycle, false
	case ArleReady:
		return nil, false
	case ArleUnloaded, ArleFailed:
		cycle := &arleLoadCycle{done: make(chan struct{})}
		a.loadCycle = cycle
		a.state.Store(int32(ArleLoading))
		return cycle, true
	default:
		return nil, false
	}
}

func (a *Arle) State() ArleState {
	return ArleState(a.state.Load())
}

func (a *Arle) Mode() ArleMode {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.config.Mode
}

func (a *Arle) SetMode(mode ArleMode) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.config.Mode == mode {
		return
	}

	oldMode := a.config.Mode
	a.config.Mode = mode

	if mode == ArleModeNone && oldMode != ArleModeNone {
		a.unloadLocked()
	}
}

func (a *Arle) EnsureLoaded() error {
	cycle, owner := a.beginLoad()
	if cycle == nil {
		if a.State() == ArleReady {
			a.touchLastUsed()
		}
		return nil
	}
	if !owner {
		return a.waitForLoad(cycle)
	}

	return a.load(cycle)
}

func (a *Arle) waitForLoad(cycle *arleLoadCycle) error {
	if cycle == nil {
		return nil
	}
	<-cycle.done
	if a.State() == ArleReady {
		a.touchLastUsed()
	}
	return cycle.err
}

func (a *Arle) finishLoadLocked(cycle *arleLoadCycle, state ArleState, err error) bool {
	if cycle == nil || a.loadCycle != cycle {
		return false
	}
	cycle.err = err
	a.loadCycle = nil
	a.state.Store(int32(state))
	close(cycle.done)
	return true
}

func (a *Arle) load(cycle *arleLoadCycle) error {
	started := time.Now()

	a.mu.Lock()
	if a.loadCycle != cycle {
		err := cycle.err
		a.mu.Unlock()
		return err
	}
	if a.closed.Load() || a.config.Mode == ArleModeNone {
		a.finishLoadLocked(cycle, ArleUnloaded, nil)
		a.mu.Unlock()
		return nil
	}
	config := a.config
	needsLearner := config.EnableLearning && a.projectLearn == nil
	a.mu.Unlock()

	mode := config.Mode
	modelPath := config.ModelPath
	vocabPath := config.VocabPath
	log.Printf("[ARLE] load() starting, modelPath=%s vocabPath=%s", modelPath, vocabPath)

	// Tokenizer, ONNX session creation, and learner hydration all perform file or
	// runtime work. Keep them outside a.mu so completion requests can observe the
	// Loading state and fall back immediately instead of waiting for model setup.
	tokenizer, err := NewArleTokenizer(vocabPath)
	if err != nil || tokenizer == nil {
		log.Printf("[ARLE] tokenizer load failed: %v, using default", err)
		tokenizer, _ = NewArleTokenizer("")
	} else {
		log.Printf("[ARLE] tokenizer loaded, vocabSize=%d", tokenizer.VocabSize())
	}

	backend, err := NewArleBackend(modelPath)
	if err != nil || backend == nil {
		log.Printf("[ARLE] backend load failed: %v, using PureGoBackend", err)
		backend = NewPureGoBackend()
	}
	log.Printf("[ARLE] backend type=%s", backend.Type())

	var learner *ProjectLearner
	if needsLearner {
		learner = NewProjectLearner(config.DataDir)
	}

	a.mu.Lock()
	if a.loadCycle != cycle || a.closed.Load() || a.config.Mode == ArleModeNone {
		cycleErr := cycle.err
		a.mu.Unlock()
		backend.Close()
		return cycleErr
	}

	a.tokenizer = tokenizer
	a.backend = backend
	if a.projectLearn == nil && learner != nil {
		a.projectLearn = learner
	}
	a.touchLastUsed()
	backendType := backend.Type()
	a.finishLoadLocked(cycle, ArleReady, nil)
	a.scheduleIdleUnloadLocked(config.IdleUnloadTime)
	a.mu.Unlock()

	log.Printf("[ARLE] model state: phase=ready mode=%s state=%s backend=%s duration=%s modelPath=%s", mode, ArleReady, backendType, time.Since(started), modelPath)
	return nil
}

func (a *Arle) unloadLocked() {
	if a.backend != nil {
		a.backend.Close()
		a.backend = nil
	}
	a.tokenizer = nil
	if a.unloadTimer != nil {
		a.unloadTimer.Stop()
		a.unloadTimer = nil
	}
	a.state.Store(int32(ArleUnloaded))
	if a.loadCycle != nil {
		cycle := a.loadCycle
		a.loadCycle = nil
		cycle.err = nil
		close(cycle.done)
	}
}

func (a *Arle) touchLastUsed() {
	a.lastUsed.Store(time.Now().UnixNano())
}

func (a *Arle) scheduleIdleUnloadLocked(delay time.Duration) {
	if delay <= 0 || a.closed.Load() || a.config.Mode == ArleModeNone || a.State() != ArleReady {
		return
	}

	if a.unloadTimer != nil {
		a.unloadTimer.Stop()
	}

	a.unloadTimer = time.AfterFunc(delay, func() {
		a.mu.Lock()
		defer a.mu.Unlock()

		if a.closed.Load() || a.config.Mode == ArleModeNone || a.State() != ArleReady {
			a.unloadTimer = nil
			return
		}

		lastUsed := time.Unix(0, a.lastUsed.Load())
		idleFor := time.Since(lastUsed)
		if idleFor >= a.config.IdleUnloadTime {
			a.unloadLocked()
		} else {
			a.scheduleIdleUnloadLocked(a.config.IdleUnloadTime - idleFor)
		}
	})
}

func (a *Arle) Rerank(suggestions []Suggestion, ctx CompletionContext) []Suggestion {
	a.mu.RLock()
	if a.closed.Load() || a.config.Mode == ArleModeNone || !a.config.EnableRerank {
		a.mu.RUnlock()
		return suggestions
	}

	if a.State() != ArleReady {
		a.mu.RUnlock()
		a.StartLoadingAsync()
		return suggestions
	}
	defer a.mu.RUnlock()

	if a.backend == nil || a.tokenizer == nil {
		return suggestions
	}

	a.touchLastUsed()

	contextTokens := a.tokenizer.TokenizeWithLanguage(string(ctx.Content), ctx.Language, a.config.ContextSize)
	if len(contextTokens) == 0 {
		return suggestions
	}

	rerankLimit := minInt(len(suggestions), a.config.MaxRerankItems)
	if rerankLimit > 0 {
		if batchScorer, ok := a.backend.(arleBatchScorer); ok {
			if ctx.Ctx != nil && ctx.Ctx.Err() != nil {
				return suggestions
			}
			texts := make([]string, rerankLimit)
			for i := range texts {
				texts[i] = suggestions[i].Text
			}
			scores := batchScorer.ScoreSuggestions(contextTokens, texts)
			if len(scores) == rerankLimit {
				for i, score := range scores {
					suggestions[i].Score = suggestions[i].Score*0.6 + score*0.4
				}
			} else if !a.rerankIndividually(suggestions[:rerankLimit], contextTokens, ctx) {
				return suggestions
			}
		} else if !a.rerankIndividually(suggestions[:rerankLimit], contextTokens, ctx) {
			return suggestions
		}
	}

	if a.projectLearn != nil && a.config.EnableLearning {
		projectID := a.getProjectID(ctx.FilePath)
		for i := range suggestions {
			boost := a.projectLearn.GetBoost(projectID, suggestions[i].Text)
			suggestions[i].Score *= (1.0 + boost*0.2)
		}
	}

	stableSortSuggestions(suggestions)

	return suggestions
}

func (a *Arle) rerankIndividually(suggestions []Suggestion, contextTokens []int, ctx CompletionContext) bool {
	for i := range suggestions {
		if ctx.Ctx != nil && ctx.Ctx.Err() != nil {
			return false
		}
		score := a.scoreMultiToken(contextTokens, suggestions[i].Text)
		suggestions[i].Score = suggestions[i].Score*0.6 + score*0.4
	}
	return true
}

func (a *Arle) scoreMultiToken(contextTokens []int, text string) float64 {
	if strings.TrimSpace(text) == "" {
		return 0.5
	}
	return a.backend.ScoreSuggestion(contextTokens, text)
}

func geometricMean(product float64, n int) float64 {
	if n <= 0 || product <= 0 {
		return 0.5
	}
	return math.Pow(product, 1.0/float64(n))
}

func (a *Arle) GenerateGhostText(ctx CompletionContext) string {
	a.mu.RLock()
	if a.closed.Load() || a.config.Mode == ArleModeNone || !a.config.EnableGhostText {
		a.mu.RUnlock()
		return ""
	}

	if a.State() != ArleReady {
		a.mu.RUnlock()
		a.StartLoadingAsync()
		return ""
	}
	defer a.mu.RUnlock()

	if a.backend == nil || a.tokenizer == nil {
		return ""
	}

	if ctx.InString || ctx.InComment || ctx.InImport {
		return ""
	}
	if ctx.Ctx != nil && ctx.Ctx.Err() != nil {
		return ""
	}

	a.touchLastUsed()

	contextTokens := a.tokenizer.TokenizeWithLanguage(string(ctx.Content), ctx.Language, a.config.ContextSize)
	if len(contextTokens) < 10 {
		return ""
	}
	if ctx.Ctx != nil && ctx.Ctx.Err() != nil {
		return ""
	}

	generatedTokens := a.backend.Generate(contextTokens, a.config.MaxGhostTokens)
	if len(generatedTokens) == 0 {
		return ""
	}

	text := a.tokenizer.Detokenize(generatedTokens)
	text = a.applyStoppingConditions(text)

	return text
}

func (a *Arle) applyStoppingConditions(text string) string {
	for i, c := range text {
		if c == '\n' {
			return text[:i]
		}
	}

	stopChars := []rune{'{', '[', '('}
	for _, stop := range stopChars {
		for i, c := range text {
			if c == stop {
				return text[:i]
			}
		}
	}

	return text
}

func (a *Arle) getProjectID(filePath string) string {
	dir := filepath.Dir(filePath)
	markers := []string{"go.mod", "package.json", "composer.json", ".git"}

	for {
		for _, marker := range markers {
			if _, err := os.Stat(filepath.Join(dir, marker)); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return filepath.Dir(filePath)
}

func (a *Arle) RecordAccepted(suggestion *Suggestion, ctx CompletionContext) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if a.closed.Load() || a.config.Mode == ArleModeNone || !a.config.EnableLearning || a.projectLearn == nil {
		return
	}

	projectID := a.getProjectID(ctx.FilePath)
	a.projectLearn.Record(projectID, suggestion.Text, ctx)
}

func (a *Arle) HasLanguageToken(language string) bool {
	a.mu.RLock()
	tokenizer := a.tokenizer
	a.mu.RUnlock()

	if tokenizer == nil {
		fallback, err := NewArleTokenizer("")
		if err != nil {
			return false
		}
		tokenizer = fallback
	}

	return tokenizer.HasLanguageToken(language)
}

func (a *Arle) Close() {
	a.closed.Store(true)
	if a.cancelPrefetch != nil {
		a.cancelPrefetch()
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	a.unloadLocked()

	if a.projectLearn != nil {
		a.projectLearn.Flush()
		a.projectLearn = nil
	}
}

func (a *Arle) Stats() ArleStats {
	a.mu.RLock()
	defer a.mu.RUnlock()

	stats := ArleStats{
		Mode:  a.config.Mode,
		State: ArleState(a.state.Load()),
	}

	if a.tokenizer != nil {
		stats.VocabSize = a.tokenizer.VocabSize()
	}

	if a.backend != nil {
		stats.BackendType = a.backend.Type()
	}

	if a.projectLearn != nil {
		stats.LearningEnabled = true
		stats.LearnedSymbols = a.projectLearn.Count()
	}

	return stats
}

type ArleStats struct {
	Mode            ArleMode
	State           ArleState
	VocabSize       int
	BackendType     string
	LearningEnabled bool
	LearnedSymbols  int
}
