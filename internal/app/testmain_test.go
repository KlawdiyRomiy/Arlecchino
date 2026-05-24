package app

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestMain(m *testing.M) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		fmt.Fprintln(os.Stderr, "failed to resolve test source path")
		os.Exit(1)
	}

	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
	if err := os.Chdir(repoRoot); err != nil {
		fmt.Fprintf(os.Stderr, "failed to chdir to repo root %q: %v\n", repoRoot, err)
		os.Exit(1)
	}

	os.Exit(m.Run())
}
