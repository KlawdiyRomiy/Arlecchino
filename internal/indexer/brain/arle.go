package brain

import (
	"context"
	"log"
	"math"
	"os"
	"path/filepath"
	"runtime"
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

type ArleState int

const (
	ArleUnloaded ArleState = iota
	ArleLoading
	ArleReady
	ArleFailed
)

type ArleConfig struct {
	Mode            ArleMode
	ModelPath       string
	VocabPath       string
	DataDir         string
	ContextSize     int
	MaxGhostTokens  int
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

	return ArleConfig{
		Mode:            ArleModeArle,
		ModelPath:       modelPath,
		VocabPath:       vocabPath,
		DataDir:         dataDir,
		ContextSize:     128,
		MaxGhostTokens:  20,
		LazyLoadDelay:   500 * time.Millisecond,
		IdleUnloadTime:  5 * time.Minute,
		EnableLearning:  true,
		EnableGhostText: true,
		EnableRerank:    true,
	}
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
	loadOnce       sync.Once
	unloadTimer    *time.Timer
	cancelPrefetch context.CancelFunc
}

func NewArle(config ArleConfig) *Arle {
	if config.ContextSize == 0 {
		config.ContextSize = 1024
	}
	if config.MaxGhostTokens == 0 {
		config.MaxGhostTokens = 20
	}
	if config.LazyLoadDelay == 0 {
		config.LazyLoadDelay = 500 * time.Millisecond
	}
	if config.IdleUnloadTime == 0 {
		config.IdleUnloadTime = 5 * time.Minute
	}

	a := &Arle{
		config: config,
	}
	a.state.Store(int32(ArleUnloaded))

	if config.Mode == ArleModeNone {
		return a
	}

	if config.LazyLoadDelay > 0 {
		ctx, cancel := context.WithCancel(context.Background())
		a.cancelPrefetch = cancel
		go func() {
			select {
			case <-ctx.Done():
				return
			case <-time.After(config.LazyLoadDelay):
				a.EnsureLoaded()
			}
		}()
	}

	return a
}

func (a *Arle) State() ArleState {
	return ArleState(a.state.Load())
}

func (a *Arle) Mode() ArleMode {
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
	if a.config.Mode == ArleModeNone {
		return nil
	}

	state := ArleState(a.state.Load())
	if state == ArleReady {
		a.touchLastUsed()
		return nil
	}
	if state == ArleLoading {
		for i := 0; i < 100; i++ {
			time.Sleep(50 * time.Millisecond)
			if ArleState(a.state.Load()) != ArleLoading {
				break
			}
		}
		return nil
	}

	var loadErr error
	a.loadOnce.Do(func() {
		loadErr = a.load()
	})

	if loadErr != nil {
		a.loadOnce = sync.Once{}
	}

	return loadErr
}

func (a *Arle) load() error {
	log.Printf("[ARLE] load() starting, modelPath=%s vocabPath=%s", a.config.ModelPath, a.config.VocabPath)
	a.state.Store(int32(ArleLoading))

	a.mu.Lock()

	var err error
	a.tokenizer, err = NewArleTokenizer(a.config.VocabPath)
	if err != nil || a.tokenizer == nil {
		log.Printf("[ARLE] tokenizer load failed: %v, using default", err)
		a.tokenizer, _ = NewArleTokenizer("")
	} else {
		log.Printf("[ARLE] tokenizer loaded, vocabSize=%d", a.tokenizer.VocabSize())
	}

	a.backend, err = NewArleBackend(a.config.ModelPath)
	if err != nil || a.backend == nil {
		log.Printf("[ARLE] backend load failed: %v, using PureGoBackend", err)
		a.backend = NewPureGoBackend()
	}
	log.Printf("[ARLE] backend type=%s", a.backend.Type())

	if a.config.EnableLearning {
		a.projectLearn = NewProjectLearner(a.config.DataDir)
	}

	a.state.Store(int32(ArleReady))
	a.touchLastUsed()
	a.mu.Unlock()

	a.scheduleIdleUnload()

	log.Printf("[ARLE] load() complete, state=ArleReady")
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
	a.loadOnce = sync.Once{}
}

func (a *Arle) touchLastUsed() {
	a.lastUsed.Store(time.Now().UnixNano())
}

func (a *Arle) scheduleIdleUnload() {
	if a.config.IdleUnloadTime <= 0 {
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if a.unloadTimer != nil {
		a.unloadTimer.Stop()
	}

	a.unloadTimer = time.AfterFunc(a.config.IdleUnloadTime, func() {
		a.mu.Lock()
		defer a.mu.Unlock()

		lastUsed := time.Unix(0, a.lastUsed.Load())
		if time.Since(lastUsed) >= a.config.IdleUnloadTime {
			a.unloadLocked()
		} else {
			remaining := a.config.IdleUnloadTime - time.Since(lastUsed)
			a.scheduleIdleUnloadWithDuration(remaining)
		}
	})
}

func (a *Arle) scheduleIdleUnloadWithDuration(d time.Duration) {
	if a.unloadTimer != nil {
		a.unloadTimer.Stop()
	}
	a.unloadTimer = time.AfterFunc(d, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		lastUsed := time.Unix(0, a.lastUsed.Load())
		if time.Since(lastUsed) >= a.config.IdleUnloadTime {
			a.unloadLocked()
		}
	})
}

func (a *Arle) Rerank(suggestions []Suggestion, ctx CompletionContext) []Suggestion {
	if a.config.Mode == ArleModeNone || !a.config.EnableRerank {
		return suggestions
	}

	if err := a.EnsureLoaded(); err != nil {
		return suggestions
	}

	a.mu.RLock()
	defer a.mu.RUnlock()

	if a.backend == nil || a.tokenizer == nil {
		return suggestions
	}

	a.touchLastUsed()

	contextTokens := a.tokenizer.TokenizeWithLanguage(string(ctx.Content), ctx.Language, a.config.ContextSize)
	if len(contextTokens) == 0 {
		return suggestions
	}

	for i := range suggestions {
		score := a.scoreMultiToken(contextTokens, suggestions[i].Text)
		suggestions[i].Score = suggestions[i].Score*0.6 + score*0.4
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

func (a *Arle) scoreMultiToken(contextTokens []int, text string) float64 {
	tokens := a.tokenizer.Tokenize(text, 10)
	if len(tokens) == 0 {
		return 0.5
	}

	if len(tokens) == 1 {
		return a.backend.ScoreSuggestion(contextTokens, text)
	}

	product := 1.0
	for _, token := range tokens {
		tokenText := a.tokenizer.Detokenize([]int{token})
		score := a.backend.ScoreSuggestion(contextTokens, tokenText)
		if score > 0 {
			product *= score
		}
	}

	return geometricMean(product, len(tokens))
}

func geometricMean(product float64, n int) float64 {
	if n <= 0 || product <= 0 {
		return 0.5
	}
	return math.Pow(product, 1.0/float64(n))
}

func (a *Arle) GenerateGhostText(ctx CompletionContext) string {
	if a.config.Mode == ArleModeNone || !a.config.EnableGhostText {
		return ""
	}

	if err := a.EnsureLoaded(); err != nil {
		return ""
	}

	a.mu.RLock()
	defer a.mu.RUnlock()

	if a.backend == nil || a.tokenizer == nil {
		return ""
	}

	if ctx.InString || ctx.InComment || ctx.InImport {
		return ""
	}

	a.touchLastUsed()

	contextTokens := a.tokenizer.TokenizeWithLanguage(string(ctx.Content), ctx.Language, a.config.ContextSize)
	if len(contextTokens) < 10 {
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
	if a.config.Mode == ArleModeNone || !a.config.EnableLearning || a.projectLearn == nil {
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
