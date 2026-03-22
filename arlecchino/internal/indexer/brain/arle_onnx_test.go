package brain

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func findTestAssetsDir() string {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)

	candidates := []string{
		filepath.Join(dir, "..", "..", "..", "assets"),
		filepath.Join(dir, "..", "..", "..", "..", "assets"),
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	return ""
}

func TestONNXBackendLoad(t *testing.T) {
	assetsDir := findTestAssetsDir()
	if assetsDir == "" {
		t.Skip("Assets directory not found")
	}

	modelPath := filepath.Join(assetsDir, "arle_model.onnx")
	if _, err := os.Stat(modelPath); err != nil {
		t.Skipf("ONNX model not found at %s", modelPath)
	}

	backend, err := NewONNXBackend(modelPath)
	if err != nil {
		t.Logf("ONNX backend load error: %v", err)
		t.Skip("ONNX Runtime not available")
	}
	defer backend.Close()

	if !backend.loaded {
		t.Fatal("Backend should be loaded")
	}

	if backend.Type() != "onnx" {
		t.Errorf("Expected type 'onnx', got %s", backend.Type())
	}

	t.Log("ONNX backend loaded successfully!")
}

func TestONNXBackendScoring(t *testing.T) {
	assetsDir := findTestAssetsDir()
	if assetsDir == "" {
		t.Skip("Assets directory not found")
	}

	modelPath := filepath.Join(assetsDir, "arle_model.onnx")
	if _, err := os.Stat(modelPath); err != nil {
		t.Skipf("ONNX model not found at %s", modelPath)
	}

	backend, err := NewONNXBackend(modelPath)
	if err != nil {
		t.Skip("ONNX Runtime not available")
	}
	defer backend.Close()

	contextTokens := []int{100, 200, 300, 400, 500}
	score := backend.ScoreSuggestion(contextTokens, "function")

	t.Logf("Score for 'function': %.4f", score)

	if score < 0.1 || score > 0.95 {
		t.Errorf("Score %.4f out of expected range [0.1, 0.95]", score)
	}
}
