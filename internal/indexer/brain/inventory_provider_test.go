package brain

import (
	"os"
	"path/filepath"
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestInventoryProvider_PathCompletionsFromInventory(t *testing.T) {
	dir := t.TempDir()
	paths := []string{
		filepath.Join(dir, "assets", "images", "logo.png"),
		filepath.Join(dir, "assets", "icons", "app.svg"),
		filepath.Join(dir, "docs", "readme.md"),
	}

	for _, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatalf("mkdir %s: %v", path, err)
		}
		if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}

	eng, err := core.NewEngine(core.EngineConfig{
		ProjectID:   "inventory-provider",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()

	eng.IndexProject()

	provider := NewInventoryProvider(eng)

	t.Run("directory segment", func(t *testing.T) {
		got := provider.GetPathCompletions(CompletionContext{
			FilePath:          filepath.Join(dir, "page.tsx"),
			InString:          true,
			StringContextType: string(core.StringContextPath),
			StringValue:       "assets/im",
		})

		if len(got) != 1 {
			t.Fatalf("expected 1 suggestion, got %d", len(got))
		}
		if got[0].InsertText != "images/" {
			t.Fatalf("expected directory suggestion %q, got %q", "images/", got[0].InsertText)
		}
	})

	t.Run("file leaf", func(t *testing.T) {
		got := provider.GetPathCompletions(CompletionContext{
			FilePath:          filepath.Join(dir, "page.tsx"),
			InString:          true,
			StringContextType: string(core.StringContextPath),
			StringValue:       "assets/images/lo",
		})

		if len(got) != 1 {
			t.Fatalf("expected 1 suggestion, got %d", len(got))
		}
		if got[0].InsertText != "logo.png" {
			t.Fatalf("expected file suggestion %q, got %q", "logo.png", got[0].InsertText)
		}
		if got[0].Source != core.SourceIndex {
			t.Fatalf("expected source %q, got %q", core.SourceIndex, got[0].Source)
		}
	})

	t.Run("absolute path", func(t *testing.T) {
		got := provider.GetPathCompletions(CompletionContext{
			FilePath:          filepath.Join(dir, "page.tsx"),
			InString:          true,
			StringContextType: string(core.StringContextPath),
			StringValue:       "/assets/ic",
		})

		if len(got) != 1 {
			t.Fatalf("expected 1 suggestion, got %d", len(got))
		}
		if got[0].InsertText != "icons/" {
			t.Fatalf("expected absolute directory suggestion %q, got %q", "icons/", got[0].InsertText)
		}
	})
}
