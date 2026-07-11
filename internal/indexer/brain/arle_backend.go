package brain

import (
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	ort "github.com/yalue/onnxruntime_go"
)

const (
	onnxRuntimePathEnv = "ARLE_ONNX_RUNTIME_PATH"
	onnxRuntimeDirEnv  = "ARLE_ONNX_RUNTIME_DIR"
)

var (
	onnxRuntimeMu             sync.Mutex
	onnxRuntimeFound          bool
	onnxRuntimePath           string
	onnxRuntimeCandidatePaths = defaultONNXRuntimeCandidatePaths
	newONNXBackend            = NewONNXBackend
)

type ArleBackend interface {
	ScoreSuggestion(contextTokens []int, suggestion string) float64
	Generate(contextTokens []int, maxTokens int) []int
	Close()
	Type() string
}

// arleBatchScorer is an optional backend capability. Backends that do not
// implement it retain the existing one-suggestion-at-a-time scoring path.
type arleBatchScorer interface {
	ScoreSuggestions(contextTokens []int, suggestions []string) []float64
}

const onnxRankingBatchSize = 12

func NewArleBackend(modelPath string) (ArleBackend, error) {
	runtimePath, runtimeAvailable, runtimeCandidates := inspectONNXRuntimeForModel(modelPath)
	log.Printf("[ARLE-BACKEND] NewArleBackend called, modelPath=%s onnxRuntimeConfigured=%v onnxRuntimeAvailable=%v onnxRuntimePath=%s onnxRuntimeCandidates=%d", modelPath, onnxRuntimeFound, runtimeAvailable, runtimePath, runtimeCandidates)

	if modelPath != "" && filepath.Ext(modelPath) == ".onnx" {
		if _, err := os.Stat(modelPath); err == nil {
			if !configureONNXRuntimeForModel(modelPath) {
				log.Printf("[ARLE-BACKEND] ONNX Runtime unavailable, skipping ONNX backend for %s", modelPath)
			} else {
				log.Printf("[ARLE-BACKEND] attempting ONNX backend for %s", modelPath)
				backend, err := newONNXBackend(modelPath)
				if err == nil && backend != nil && backend.loaded {
					log.Printf("[ARLE-BACKEND] ONNX backend loaded successfully")
					return backend, nil
				}
				log.Printf("[ARLE-BACKEND] ONNX backend failed: %v", err)
			}
		} else {
			log.Printf("[ARLE-BACKEND] model file not found: %s", modelPath)
		}
	}

	log.Printf("[ARLE-BACKEND] falling back to PureGoBackend")
	return NewPureGoBackend(), nil
}

func configureONNXRuntimeForModel(modelPath string) bool {
	onnxRuntimeMu.Lock()
	defer onnxRuntimeMu.Unlock()

	if onnxRuntimeFound && onnxRuntimePath != "" {
		log.Printf("[ARLE-BACKEND] ONNX Runtime already configured at %s", onnxRuntimePath)
		return true
	}

	candidates := onnxRuntimeCandidatePaths(modelPath)
	for _, candidate := range candidates {
		if !isReadableRuntimeLibrary(candidate) {
			continue
		}
		ort.SetSharedLibraryPath(candidate)
		onnxRuntimePath = candidate
		onnxRuntimeFound = true
		log.Printf("[ARLE-BACKEND] ONNX Runtime found at %s", candidate)
		return true
	}

	log.Printf("[ARLE-BACKEND] WARNING: ONNX Runtime not found, candidates: %v", candidates)
	onnxRuntimeFound = false
	onnxRuntimePath = ""
	return false
}

func inspectONNXRuntimeForModel(modelPath string) (string, bool, int) {
	candidates := onnxRuntimeCandidatePaths(modelPath)
	for _, candidate := range candidates {
		if isReadableRuntimeLibrary(candidate) {
			return candidate, true, len(candidates)
		}
	}
	return "", false, len(candidates)
}

func defaultONNXRuntimeCandidatePaths(modelPath string) []string {
	runtimeFile := onnxRuntimeLibraryFileName()
	if runtimeFile == "" {
		return nil
	}

	var candidates []string
	addPath := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		candidates = append(candidates, filepath.Clean(path))
	}
	addDir := func(dir string) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			return
		}
		addPath(filepath.Join(dir, runtimeFile))
	}

	addPath(os.Getenv(onnxRuntimePathEnv))
	addDir(os.Getenv(onnxRuntimeDirEnv))

	if modelPath != "" {
		modelDir := filepath.Dir(modelPath)
		addDir(modelDir)
		addDir(filepath.Join(modelDir, "onnxruntime"))
	}

	if exe, err := os.Executable(); err == nil && exe != "" {
		exeDir := filepath.Dir(exe)
		if runtime.GOOS == "darwin" {
			addDir(filepath.Join(exeDir, "..", "Frameworks"))
			addDir(filepath.Join(exeDir, "..", "Resources"))
			addDir(filepath.Join(exeDir, "..", "Resources", "onnxruntime"))
			addDir(filepath.Join(exeDir, "..", "Resources", "assets"))
		}
		addDir(filepath.Join(exeDir, "onnxruntime"))
	}

	for _, dir := range installerRuntimeDirs() {
		addDir(dir)
	}

	return uniqueNonEmptyPaths(candidates)
}

func onnxRuntimeLibraryFileName() string {
	switch runtime.GOOS {
	case "darwin":
		return "libonnxruntime.dylib"
	case "linux":
		return "libonnxruntime.so"
	case "windows":
		return "onnxruntime.dll"
	default:
		return ""
	}
}

func installerRuntimeDirs() []string {
	var dirs []string
	add := func(dir string) {
		if strings.TrimSpace(dir) != "" {
			dirs = append(dirs, dir)
		}
	}

	switch runtime.GOOS {
	case "darwin":
		add("/opt/homebrew/opt/onnxruntime/lib")
		add("/opt/homebrew/lib")
		add("/usr/local/opt/onnxruntime/lib")
		add("/usr/local/lib")
		add("/opt/local/lib")
		add("/Library/Frameworks/onnxruntime/lib")
	case "linux":
		add("/usr/lib")
		add("/usr/local/lib")
		add("/usr/lib64")
		add("/usr/local/lib64")
	}

	add(filepath.Join(os.Getenv("CONDA_PREFIX"), "lib"))
	add(filepath.Join(os.Getenv("MAMBA_ROOT_PREFIX"), "lib"))
	for _, profile := range strings.Fields(os.Getenv("NIX_PROFILES")) {
		add(filepath.Join(profile, "lib"))
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		add(filepath.Join(home, ".nix-profile", "lib"))
	}
	add("/run/current-system/sw/lib")

	return dirs
}

func uniqueNonEmptyPaths(paths []string) []string {
	seen := make(map[string]struct{}, len(paths))
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		result = append(result, path)
	}
	return result
}

func isReadableRuntimeLibrary(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}

type ONNXBackend struct {
	mu             sync.Mutex
	modelPath      string
	tokenizerPath  string
	loaded         bool
	session        *ort.DynamicAdvancedSession
	tokenizer      *ArleTokenizer
	vocabSize      int64
	seqLen         int64
	isRankingModel bool // true if model outputs single score, false for logits
	sepTokenID     int  // <SEP> token for ranking model
}

func NewONNXBackend(modelPath string) (*ONNXBackend, error) {
	log.Printf("[ONNX] NewONNXBackend called, modelPath=%s", modelPath)

	backend := &ONNXBackend{
		modelPath: modelPath,
		vocabSize: 32000,
		seqLen:    128,
	}

	tokenizerPath := filepath.Join(filepath.Dir(modelPath), "arle_tokenizer.json")
	if _, err := os.Stat(tokenizerPath); err == nil {
		backend.tokenizerPath = tokenizerPath
		log.Printf("[ONNX] tokenizer found at %s", tokenizerPath)
	} else {
		tokenizerPath = filepath.Join(filepath.Dir(modelPath), "arle_tokenizer.json")
		if _, err := os.Stat(tokenizerPath); err == nil {
			backend.tokenizerPath = tokenizerPath
			log.Printf("[ONNX] fallback tokenizer found at %s", tokenizerPath)
		} else {
			log.Printf("[ONNX] WARNING: no tokenizer found")
		}
	}

	if !configureONNXRuntimeForModel(modelPath) {
		return backend, fmt.Errorf("ONNX Runtime shared library not found")
	}

	if err := backend.load(); err != nil {
		log.Printf("[ONNX] load() failed: %v", err)
		return backend, err
	}

	return backend, nil
}

func (b *ONNXBackend) load() error {
	started := time.Now()
	log.Printf("[ONNX] load() starting")
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.loaded {
		log.Printf("[ONNX] already loaded")
		return nil
	}

	log.Printf("[ONNX] InitializeEnvironment...")
	if err := ort.InitializeEnvironment(); err != nil {
		// Ignore "already initialized" error - this is fine
		if err.Error() != "The onnxruntime has already been initialized" {
			log.Printf("[ONNX] InitializeEnvironment failed: %v", err)
			return err
		}
		log.Printf("[ONNX] ONNX runtime already initialized (ok)")
	}

	// New model is always ranking model (outputs single score)
	// Legacy next-token model is no longer supported
	inputNames := []string{"input_ids"}
	outputNames := []string{"score"}
	b.isRankingModel = true
	b.sepTokenID = 4 // <SEP> is token 4 in new tokenizer (PAD=0, UNK=1, BOS=2, EOS=3, SEP=4)
	log.Printf("[ONNX] using RANKING model format")

	runtimePath, runtimeAvailable, runtimeCandidates := inspectONNXRuntimeForModel(b.modelPath)
	log.Printf("[ONNX] creating session for %s runtimeAvailable=%v runtimePath=%s runtimeCandidates=%d", b.modelPath, runtimeAvailable, runtimePath, runtimeCandidates)
	session, err := ort.NewDynamicAdvancedSession(
		b.modelPath,
		inputNames,
		outputNames,
		nil,
	)
	if err != nil {
		log.Printf("[ONNX] session creation failed: %v", err)
		return err
	}
	b.session = session
	log.Printf("[ONNX] session created successfully")

	if b.tokenizerPath != "" {
		tokenizer, _ := NewArleTokenizer(b.tokenizerPath)
		b.tokenizer = tokenizer
		// Get SEP token ID from tokenizer if available
		if tokenizer != nil {
			if sepID := tokenizer.GetTokenID("<SEP>"); sepID > 0 {
				b.sepTokenID = sepID
			}
		}
	}

	b.loaded = true
	log.Printf("[ONNX] model state: loaded=%v model=%s tokenizer=%s tokenizerLoaded=%v seqLen=%d vocabSize=%d sepTokenID=%d duration=%s", b.loaded, b.modelPath, b.tokenizerPath, b.tokenizer != nil, b.seqLen, b.vocabSize, b.sepTokenID, time.Since(started))
	return nil
}

func (b *ONNXBackend) ScoreSuggestion(contextTokens []int, suggestion string) float64 {
	b.mu.Lock()
	defer b.mu.Unlock()

	scores := b.scoreSuggestionsLocked(contextTokens, []string{suggestion})
	if len(scores) == 0 {
		return 0.5
	}
	return scores[0]
}

// ScoreSuggestions scores ranking candidates in batches supported by the
// model's dynamic batch_size dimension. The result index always corresponds to
// the input index; candidates that cannot be tokenized retain the same neutral
// score used by ScoreSuggestion.
func (b *ONNXBackend) ScoreSuggestions(contextTokens []int, suggestions []string) []float64 {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.scoreSuggestionsLocked(contextTokens, suggestions)
}

func (b *ONNXBackend) scoreSuggestionsLocked(contextTokens []int, suggestions []string) []float64 {
	scores := make([]float64, len(suggestions))
	for i := range scores {
		scores[i] = 0.5
	}

	if !b.loaded || b.session == nil {
		return scores
	}

	for batchStart := 0; batchStart < len(suggestions); batchStart += onnxRankingBatchSize {
		batchEnd := minInt(batchStart+onnxRankingBatchSize, len(suggestions))
		b.scoreSuggestionBatchLocked(contextTokens, suggestions, scores, batchStart, batchEnd)
	}

	return scores
}

func (b *ONNXBackend) scoreSuggestionBatchLocked(contextTokens []int, suggestions []string, scores []float64, start, end int) {
	if start < 0 || end > len(suggestions) || start >= end || b.tokenizer == nil {
		return
	}

	seqLen := int(b.seqLen)
	if seqLen <= 0 {
		return
	}

	validIndexes := make([]int, 0, end-start)
	inputData := make([]int64, 0, (end-start)*seqLen)
	for suggestionIndex := start; suggestionIndex < end; suggestionIndex++ {
		if strings.TrimSpace(suggestions[suggestionIndex]) == "" {
			continue
		}
		suggestionTokens := b.tokenizer.Tokenize(suggestions[suggestionIndex], 20)
		if len(suggestionTokens) == 0 {
			continue
		}

		rowStart := len(inputData)
		inputData = inputData[:rowStart+seqLen]
		b.fillRankingInput(inputData[rowStart:], contextTokens, suggestionTokens)
		validIndexes = append(validIndexes, suggestionIndex)
	}

	batchSize := len(validIndexes)
	if batchSize == 0 {
		return
	}

	inputTensor, err := ort.NewTensor(ort.NewShape(int64(batchSize), b.seqLen), inputData)
	if err != nil {
		return
	}
	defer inputTensor.Destroy()

	outputData := make([]float32, batchSize)
	outputTensor, err := ort.NewTensor(ort.NewShape(int64(batchSize), 1), outputData)
	if err != nil {
		return
	}
	defer outputTensor.Destroy()

	if err := b.session.Run([]ort.ArbitraryTensor{inputTensor}, []ort.ArbitraryTensor{outputTensor}); err != nil {
		return
	}

	output := outputTensor.GetData()
	for batchIndex, suggestionIndex := range validIndexes {
		if batchIndex >= len(output) {
			break
		}
		scores[suggestionIndex] = clamp(float64(output[batchIndex]), 0.1, 0.95)
	}
}

func (b *ONNXBackend) fillRankingInput(inputData []int64, contextTokens, suggestionTokens []int) {
	seqLen := len(inputData)
	maxContextLen := seqLen - len(suggestionTokens) - 1
	if maxContextLen < 0 {
		maxContextLen = 0
	}

	startIdx := 0
	if len(contextTokens) > maxContextLen {
		startIdx = len(contextTokens) - maxContextLen
	}
	pos := 0
	for i := startIdx; i < len(contextTokens) && pos < seqLen-len(suggestionTokens)-1; i++ {
		inputData[pos] = int64(contextTokens[i])
		pos++
	}

	if pos < seqLen {
		inputData[pos] = int64(b.sepTokenID)
		pos++
	}

	for _, token := range suggestionTokens {
		if pos >= seqLen {
			break
		}
		inputData[pos] = int64(token)
		pos++
	}
}

func (b *ONNXBackend) Generate(contextTokens []int, maxTokens int) []int {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.loaded || b.session == nil || maxTokens <= 0 {
		return nil
	}
	if b.isRankingModel {
		return nil
	}

	seqLen := int(b.seqLen)
	generated := make([]int, 0, maxTokens)
	currentContext := make([]int, len(contextTokens))
	copy(currentContext, contextTokens)

	for i := 0; i < maxTokens; i++ {
		inputData := make([]int64, seqLen)
		startIdx := 0
		if len(currentContext) > seqLen {
			startIdx = len(currentContext) - seqLen
		}
		copy(inputData, int64Slice(currentContext[startIdx:]))

		inputTensor, err := ort.NewTensor(ort.NewShape(1, b.seqLen), inputData)
		if err != nil {
			break
		}

		outputData := make([]float32, seqLen*int(b.vocabSize))
		outputTensor, err := ort.NewTensor(ort.NewShape(1, b.seqLen, b.vocabSize), outputData)
		if err != nil {
			inputTensor.Destroy()
			break
		}

		if err := b.session.Run([]ort.ArbitraryTensor{inputTensor}, []ort.ArbitraryTensor{outputTensor}); err != nil {
			inputTensor.Destroy()
			outputTensor.Destroy()
			break
		}

		logits := outputTensor.GetData()
		lastPos := minInt(len(currentContext)-1, seqLen-1)
		if lastPos < 0 {
			lastPos = 0
		}
		startLogitIdx := lastPos * int(b.vocabSize)

		maxIdx := 0
		maxVal := logits[startLogitIdx]
		for j := 1; j < int(b.vocabSize); j++ {
			if logits[startLogitIdx+j] > maxVal {
				maxVal = logits[startLogitIdx+j]
				maxIdx = j
			}
		}

		inputTensor.Destroy()
		outputTensor.Destroy()

		if maxIdx == 0 || maxIdx == 3 {
			break
		}

		generated = append(generated, maxIdx)
		currentContext = append(currentContext, maxIdx)
	}

	return generated
}

func (b *ONNXBackend) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.session != nil {
		b.session.Destroy()
		b.session = nil
	}
	b.loaded = false
	// The ONNX environment is process-global and is shared with LangDetector.
	// Destroying it from one backend can invalidate another live session or a
	// replacement ARLE load. Sessions are still released here; the process owns
	// the shared environment lifetime.
}

func (b *ONNXBackend) Type() string {
	return "onnx"
}

type PureGoBackend struct {
	hiddenSize int
	vocabSize  int
	hidden     []float32
	cell       []float32
}

func NewPureGoBackend() *PureGoBackend {
	log.Printf("[PURE-GO] NewPureGoBackend created (fallback mode, no ML inference)")
	return &PureGoBackend{
		hiddenSize: 256,
		vocabSize:  32000,
		hidden:     make([]float32, 256),
		cell:       make([]float32, 256),
	}
}

func (b *PureGoBackend) ScoreSuggestion(contextTokens []int, suggestion string) float64 {
	if len(contextTokens) == 0 {
		return 0.5
	}

	score := 0.5

	if len(contextTokens) > 100 {
		score += 0.1
	}

	if len(suggestion) > 0 && len(suggestion) < 50 {
		score += 0.1
	}

	variance := b.calculateTokenVariance(contextTokens)
	score += variance * 0.2

	return clamp(score, 0.0, 1.0)
}

func (b *PureGoBackend) Generate(contextTokens []int, maxTokens int) []int {
	log.Printf("[PURE-GO] Generate called with %d context tokens, maxTokens=%d (returning empty - no ML model)", len(contextTokens), maxTokens)
	return []int{}
}

func (b *PureGoBackend) Close() {
	b.hidden = nil
	b.cell = nil
}

func (b *PureGoBackend) Type() string {
	return "pure-go"
}

func (b *PureGoBackend) calculateTokenVariance(tokens []int) float64 {
	if len(tokens) < 2 {
		return 0.5
	}

	sum := 0.0
	for _, t := range tokens {
		sum += float64(t)
	}
	mean := sum / float64(len(tokens))

	variance := 0.0
	for _, t := range tokens {
		diff := float64(t) - mean
		variance += diff * diff
	}
	variance /= float64(len(tokens))

	return math.Min(variance/10000.0, 1.0)
}

func int64Slice(ints []int) []int64 {
	result := make([]int64, len(ints))
	for i, v := range ints {
		result[i] = int64(v)
	}
	return result
}

func clamp(v, minVal, maxVal float64) float64 {
	if v < minVal {
		return minVal
	}
	if v > maxVal {
		return maxVal
	}
	return v
}

func sigmoid32(x float32) float32 {
	return 1.0 / (1.0 + float32(math.Exp(float64(-x))))
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
