package brain

import (
	"log"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var onnxRuntimeFound bool

func init() {
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{
			"/opt/homebrew/lib/libonnxruntime.dylib",
			"/usr/local/lib/libonnxruntime.dylib",
		}
	case "linux":
		candidates = []string{
			"/usr/lib/libonnxruntime.so",
			"/usr/local/lib/libonnxruntime.so",
		}
	}
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			log.Printf("[ARLE-BACKEND] ONNX Runtime found at %s", path)
			ort.SetSharedLibraryPath(path)
			onnxRuntimeFound = true
			return
		}
	}
	log.Printf("[ARLE-BACKEND] WARNING: ONNX Runtime not found, candidates: %v", candidates)
}

type ArleBackend interface {
	ScoreSuggestion(contextTokens []int, suggestion string) float64
	Generate(contextTokens []int, maxTokens int) []int
	Close()
	Type() string
}

func NewArleBackend(modelPath string) (ArleBackend, error) {
	log.Printf("[ARLE-BACKEND] NewArleBackend called, modelPath=%s onnxRuntimeFound=%v", modelPath, onnxRuntimeFound)

	if modelPath != "" && filepath.Ext(modelPath) == ".onnx" {
		if _, err := os.Stat(modelPath); err == nil {
			log.Printf("[ARLE-BACKEND] attempting ONNX backend for %s", modelPath)
			backend, err := NewONNXBackend(modelPath)
			if err == nil && backend.loaded {
				log.Printf("[ARLE-BACKEND] ONNX backend loaded successfully")
				return backend, nil
			}
			log.Printf("[ARLE-BACKEND] ONNX backend failed: %v", err)
		} else {
			log.Printf("[ARLE-BACKEND] model file not found: %s", modelPath)
		}
	}

	log.Printf("[ARLE-BACKEND] falling back to PureGoBackend")
	return NewPureGoBackend(), nil
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

	if err := backend.load(); err != nil {
		log.Printf("[ONNX] load() failed: %v", err)
		return backend, err
	}

	return backend, nil
}

func (b *ONNXBackend) load() error {
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

	log.Printf("[ONNX] creating session for %s", b.modelPath)
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
	return nil
}

func (b *ONNXBackend) ScoreSuggestion(contextTokens []int, suggestion string) float64 {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.loaded || b.session == nil {
		return 0.5
	}

	// Ranking model: concatenate context + SEP + suggestion → single score
	var suggestionTokens []int
	if b.tokenizer != nil {
		suggestionTokens = b.tokenizer.Tokenize(suggestion, 20)
	}
	if len(suggestionTokens) == 0 {
		return 0.5
	}

	// Build input: context + SEP + suggestion
	seqLen := int(b.seqLen)
	inputData := make([]int64, seqLen)

	// Calculate how much context we can fit
	maxContextLen := seqLen - len(suggestionTokens) - 1 // -1 for SEP
	if maxContextLen < 0 {
		maxContextLen = 0
	}

	pos := 0
	// Add context (truncate from beginning if too long)
	startIdx := 0
	if len(contextTokens) > maxContextLen {
		startIdx = len(contextTokens) - maxContextLen
	}
	for i := startIdx; i < len(contextTokens) && pos < seqLen-len(suggestionTokens)-1; i++ {
		inputData[pos] = int64(contextTokens[i])
		pos++
	}

	// Add SEP token
	if pos < seqLen {
		inputData[pos] = int64(b.sepTokenID)
		pos++
	}

	// Add suggestion tokens
	for _, t := range suggestionTokens {
		if pos >= seqLen {
			break
		}
		inputData[pos] = int64(t)
		pos++
	}

	inputTensor, err := ort.NewTensor(ort.NewShape(1, b.seqLen), inputData)
	if err != nil {
		return 0.5
	}
	defer inputTensor.Destroy()

	// Output: single score
	outputData := make([]float32, 1)
	outputTensor, err := ort.NewTensor(ort.NewShape(1, 1), outputData)
	if err != nil {
		return 0.5
	}
	defer outputTensor.Destroy()

	if err := b.session.Run([]ort.ArbitraryTensor{inputTensor}, []ort.ArbitraryTensor{outputTensor}); err != nil {
		return 0.5
	}

	score := float64(outputTensor.GetData()[0])
	return clamp(score, 0.1, 0.95)
}

func (b *ONNXBackend) Generate(contextTokens []int, maxTokens int) []int {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.loaded || b.session == nil || maxTokens <= 0 {
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
	ort.DestroyEnvironment()
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
