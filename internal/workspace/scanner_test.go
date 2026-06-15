package workspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScanner_GitIgnoreWithLongLineKeepsReadingPatterns(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(dir, ".gitignore"),
		[]byte(strings.Repeat("a", 70*1024)+"\nignored.txt\n"),
		0644,
	); err != nil {
		t.Fatalf("write .gitignore: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ignored.txt"), []byte("ignored"), 0644); err != nil {
		t.Fatalf("write ignored.txt: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("keep"), 0644); err != nil {
		t.Fatalf("write keep.txt: %v", err)
	}

	scanner, err := NewScanner(dir, ScannerOptions{UseGitIgnore: true})
	if err != nil {
		t.Fatalf("NewScanner: %v", err)
	}
	entries, _, err := scanner.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}

	var sawKeep bool
	for _, entry := range entries {
		switch entry.Name {
		case "ignored.txt":
			t.Fatalf("ignored.txt was scanned despite .gitignore pattern: %#v", entries)
		case "keep.txt":
			sawKeep = true
		}
	}
	if !sawKeep {
		t.Fatalf("keep.txt was not scanned: %#v", entries)
	}
}
