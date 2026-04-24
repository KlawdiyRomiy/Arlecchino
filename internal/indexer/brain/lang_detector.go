package brain

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

// LangDetector detects programming language from code content using ML model
type LangDetector struct {
	mu        sync.RWMutex
	session   *ort.DynamicAdvancedSession
	tokenizer *ArleTokenizer
	loaded    bool
	modelPath string

	// Language mapping from model training
	idx2lang map[int]string
	lang2idx map[string]int

	// Model config
	seqLen    int64
	numLangs  int
	vocabSize int64
}

// LangMapping JSON structure from training
type LangMapping struct {
	Lang2Idx     map[string]int    `json:"lang2idx"`
	Idx2Lang     map[string]string `json:"idx2lang"`
	NumLanguages int               `json:"num_languages"`
}

// LangPrediction represents a language prediction with confidence
type LangPrediction struct {
	Language   string
	Confidence float32
}

// NewLangDetector creates a new language detector
func NewLangDetector(assetsDir string) (*LangDetector, error) {
	ld := &LangDetector{
		seqLen:    512,
		vocabSize: 32000,
		idx2lang:  make(map[int]string),
		lang2idx:  make(map[string]int),
	}

	// Find model and mapping files
	modelPath := filepath.Join(assetsDir, "arle_model.onnx")
	mappingPath := filepath.Join(assetsDir, "arle_lang_mapping.json")
	tokenizerPath := filepath.Join(assetsDir, "arle_tokenizer.json")

	if _, err := os.Stat(modelPath); err != nil {
		log.Printf("[LANG-DETECTOR] Model not found: %s", modelPath)
		ld.initDefaultMapping()
		return ld, nil
	}
	ld.modelPath = modelPath

	// Load language mapping
	if err := ld.loadMapping(mappingPath); err != nil {
		log.Printf("[LANG-DETECTOR] Mapping not found, using default: %v", err)
		ld.initDefaultMapping()
	}

	// Load tokenizer
	var err error
	ld.tokenizer, err = NewArleTokenizer(tokenizerPath)
	if err != nil {
		log.Printf("[LANG-DETECTOR] Tokenizer error: %v", err)
		ld.tokenizer, _ = NewArleTokenizer("")
	}

	// Load ONNX model
	if err := ld.loadModel(); err != nil {
		log.Printf("[LANG-DETECTOR] Model load failed: %v", err)
		return ld, nil
	}

	log.Printf("[LANG-DETECTOR] Loaded: %d languages, model=%s", ld.numLangs, modelPath)
	return ld, nil
}

func (ld *LangDetector) loadMapping(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var mapping LangMapping
	if err := json.Unmarshal(data, &mapping); err != nil {
		return err
	}

	ld.lang2idx = mapping.Lang2Idx
	ld.numLangs = mapping.NumLanguages

	ld.idx2lang = make(map[int]string)
	for k, v := range mapping.Idx2Lang {
		var idx int
		if err := json.Unmarshal([]byte(k), &idx); err == nil {
			ld.idx2lang[idx] = v
		}
	}

	// Fallback: build idx2lang from lang2idx
	if len(ld.idx2lang) == 0 {
		for lang, idx := range ld.lang2idx {
			ld.idx2lang[idx] = lang
		}
	}

	return nil
}

func (ld *LangDetector) initDefaultMapping() {
	// Default 51 languages matching training notebook
	languages := []string{
		"Ada", "Assembly", "C", "C#", "C++", "COBOL", "Clojure", "Common Lisp",
		"Crystal", "Dart", "Dockerfile", "Elixir", "Emacs Lisp", "Erlang",
		"F#", "Fortran", "Go", "Groovy", "HTML", "Haskell", "JSON", "Java",
		"JavaScript", "Julia", "Kotlin", "Lua", "Markdown", "Nim", "OCaml",
		"Objective-C", "PHP", "Perl", "PowerShell", "Prolog", "Python", "R",
		"Racket", "Ruby", "Rust", "SQL", "Scala", "Scheme", "Shell", "Swift",
		"TOML", "TypeScript", "VHDL", "Verilog", "XML", "YAML", "Zig",
	}

	sort.Strings(languages)
	ld.numLangs = len(languages)

	for i, lang := range languages {
		ld.lang2idx[lang] = i
		ld.idx2lang[i] = lang
	}
}

func (ld *LangDetector) loadModel() error {
	if !onnxRuntimeFound {
		return nil
	}

	ld.mu.Lock()
	defer ld.mu.Unlock()

	if err := ort.InitializeEnvironment(); err != nil {
		if err.Error() != "The onnxruntime has already been initialized" {
			return err
		}
	}

	// Model expects: input [batch, seq_len] -> output [batch, num_classes]
	inputNames := []string{"input"}
	outputNames := []string{"output"}

	session, err := ort.NewDynamicAdvancedSession(
		ld.modelPath,
		inputNames,
		outputNames,
		nil,
	)
	if err != nil {
		return err
	}

	ld.session = session
	ld.loaded = true
	return nil
}

// Detect predicts the programming language of the given code
func (ld *LangDetector) Detect(code string) (string, float32) {
	predictions := ld.DetectTopK(code, 1)
	if len(predictions) == 0 {
		return "unknown", 0
	}
	return predictions[0].Language, predictions[0].Confidence
}

// DetectTopK returns top K language predictions
func (ld *LangDetector) DetectTopK(code string, k int) []LangPrediction {
	ld.mu.RLock()
	defer ld.mu.RUnlock()

	if !ld.loaded || ld.session == nil || ld.tokenizer == nil {
		return ld.detectByHeuristics(code, k)
	}

	// Tokenize code
	tokens := ld.tokenizer.Tokenize(code, int(ld.seqLen))
	if len(tokens) == 0 {
		return ld.detectByHeuristics(code, k)
	}

	// Pad to seq_len
	inputData := make([]int64, ld.seqLen)
	for i, t := range tokens {
		if i >= int(ld.seqLen) {
			break
		}
		inputData[i] = int64(t)
	}

	// Create input tensor
	inputTensor, err := ort.NewTensor(ort.NewShape(1, ld.seqLen), inputData)
	if err != nil {
		return ld.detectByHeuristics(code, k)
	}
	defer inputTensor.Destroy()

	// Create output tensor
	outputData := make([]float32, ld.numLangs)
	outputTensor, err := ort.NewTensor(ort.NewShape(1, int64(ld.numLangs)), outputData)
	if err != nil {
		return ld.detectByHeuristics(code, k)
	}
	defer outputTensor.Destroy()

	// Run inference
	if err := ld.session.Run(
		[]ort.ArbitraryTensor{inputTensor},
		[]ort.ArbitraryTensor{outputTensor},
	); err != nil {
		return ld.detectByHeuristics(code, k)
	}

	// Get predictions
	logits := outputTensor.GetData()
	return ld.topKFromLogits(logits, k)
}

func (ld *LangDetector) topKFromLogits(logits []float32, k int) []LangPrediction {
	// Softmax
	probs := softmax(logits)

	// Create predictions
	type idxProb struct {
		idx  int
		prob float32
	}
	items := make([]idxProb, len(probs))
	for i, p := range probs {
		items[i] = idxProb{idx: i, prob: p}
	}

	// Sort by probability descending
	sort.Slice(items, func(i, j int) bool {
		return items[i].prob > items[j].prob
	})

	// Take top K
	if k > len(items) {
		k = len(items)
	}

	results := make([]LangPrediction, k)
	for i := 0; i < k; i++ {
		lang := ld.idx2lang[items[i].idx]
		if lang == "" {
			lang = "unknown"
		}
		results[i] = LangPrediction{
			Language:   lang,
			Confidence: items[i].prob,
		}
	}

	return results
}

func (ld *LangDetector) detectByHeuristics(code string, k int) []LangPrediction {
	// Simple heuristic fallback
	code = strings.ToLower(code)

	patterns := map[string][]string{
		"Python":     {"def ", "import ", "from ", "if __name__"},
		"JavaScript": {"function ", "const ", "let ", "=>", "console.log"},
		"TypeScript": {"interface ", ": string", ": number", "export "},
		"Go":         {"func ", "package ", "import (", "fmt."},
		"Rust":       {"fn ", "let mut", "impl ", "pub fn"},
		"PHP":        {"<?php", "function ", "$", "->"},
		"Ruby":       {"def ", "end", "puts ", "require "},
		"Java":       {"public class", "public static", "System.out"},
		"C#":         {"namespace ", "using System", "public void"},
		"C++":        {"#include", "std::", "cout", "int main"},
		"C":          {"#include", "int main", "printf"},
		"Shell":      {"#!/bin/bash", "echo ", "if ["},
		"SQL":        {"select ", "from ", "where ", "insert into"},
		"JSON":       {"{\"", "\": ", "},"},
		"YAML":       {"---", ": ", "- "},
		"Markdown":   {"# ", "## ", "```", "**"},
	}

	scores := make(map[string]int)
	for lang, pats := range patterns {
		for _, pat := range pats {
			if strings.Contains(code, pat) {
				scores[lang]++
			}
		}
	}

	// Sort by score
	type langScore struct {
		lang  string
		score int
	}
	var items []langScore
	for l, s := range scores {
		items = append(items, langScore{l, s})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].score > items[j].score
	})

	// Return top K
	if k > len(items) {
		k = len(items)
	}
	if k == 0 {
		return []LangPrediction{{Language: "unknown", Confidence: 0}}
	}

	results := make([]LangPrediction, k)
	maxScore := float32(items[0].score)
	if maxScore == 0 {
		maxScore = 1
	}
	for i := 0; i < k; i++ {
		results[i] = LangPrediction{
			Language:   items[i].lang,
			Confidence: float32(items[i].score) / maxScore,
		}
	}

	return results
}

// IsLoaded returns true if model is loaded
func (ld *LangDetector) IsLoaded() bool {
	ld.mu.RLock()
	defer ld.mu.RUnlock()
	return ld.loaded
}

// NumLanguages returns number of supported languages
func (ld *LangDetector) NumLanguages() int {
	return ld.numLangs
}

// SupportedLanguages returns list of supported languages
func (ld *LangDetector) SupportedLanguages() []string {
	languages := make([]string, 0, len(ld.idx2lang))
	for _, lang := range ld.idx2lang {
		languages = append(languages, lang)
	}
	sort.Strings(languages)
	return languages
}

// Close releases resources
func (ld *LangDetector) Close() {
	ld.mu.Lock()
	defer ld.mu.Unlock()

	if ld.session != nil {
		ld.session.Destroy()
		ld.session = nil
	}
	ld.loaded = false
}

// softmax computes softmax over logits
func softmax(logits []float32) []float32 {
	if len(logits) == 0 {
		return nil
	}

	// Find max for numerical stability
	max := logits[0]
	for _, v := range logits[1:] {
		if v > max {
			max = v
		}
	}

	// Compute exp and sum
	probs := make([]float32, len(logits))
	var sum float32
	for i, v := range logits {
		probs[i] = exp32(v - max)
		sum += probs[i]
	}

	// Normalize
	if sum > 0 {
		for i := range probs {
			probs[i] /= sum
		}
	}

	return probs
}

// exp32 computes float32 exponential
func exp32(x float32) float32 {
	// Fast approximation for exp
	if x < -88 {
		return 0
	}
	if x > 88 {
		return 1e38
	}
	// Use Taylor series approximation for small values
	if x >= -1 && x <= 1 {
		return 1 + x + x*x/2 + x*x*x/6 + x*x*x*x/24
	}
	// For larger values, use standard library through float64
	return float32(expFloat64(float64(x)))
}

func expFloat64(x float64) float64 {
	// Simple exp implementation
	if x == 0 {
		return 1
	}
	if x < 0 {
		return 1 / expFloat64(-x)
	}

	// For positive x, use identity e^x = (e^(x/n))^n
	n := 1
	for x > 1 {
		x /= 2
		n *= 2
	}

	// Taylor series for small x
	result := 1.0 + x + x*x/2 + x*x*x/6 + x*x*x*x/24 + x*x*x*x*x/120

	// Raise to power n
	for i := 0; i < n; i++ {
		result *= result
		n /= 2
		if n == 0 {
			break
		}
	}

	return result
}
