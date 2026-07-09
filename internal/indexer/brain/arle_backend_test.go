package brain

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewArleBackendSkipsONNXWhenRuntimeMissing(t *testing.T) {
	modelPath := filepath.Join(t.TempDir(), "arle_model.onnx")
	if err := os.WriteFile(modelPath, []byte("model\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(%s): %v", modelPath, err)
	}

	previousRuntimeFound := onnxRuntimeFound
	previousRuntimePath := onnxRuntimePath
	previousCandidatePaths := onnxRuntimeCandidatePaths
	previousNewONNXBackend := newONNXBackend
	onnxRuntimeFound = false
	onnxRuntimePath = ""
	onnxRuntimeCandidatePaths = func(string) []string {
		return nil
	}
	onnxAttempted := false
	newONNXBackend = func(string) (*ONNXBackend, error) {
		onnxAttempted = true
		return nil, nil
	}
	t.Cleanup(func() {
		onnxRuntimeFound = previousRuntimeFound
		onnxRuntimePath = previousRuntimePath
		onnxRuntimeCandidatePaths = previousCandidatePaths
		newONNXBackend = previousNewONNXBackend
	})

	backend, err := NewArleBackend(modelPath)
	if err != nil {
		t.Fatalf("NewArleBackend returned error: %v", err)
	}
	defer backend.Close()

	if onnxAttempted {
		t.Fatal("expected ONNX backend construction to be skipped when runtime is missing")
	}
	if backend.Type() != "pure-go" {
		t.Fatalf("backend type = %q, want pure-go", backend.Type())
	}
}
