package brain

import (
	"os"
	"path/filepath"
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestImportCompletionProvider_GetGoPackageCompletions_FromGoMod(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "go.mod"), `module example.com/demo

go 1.26

require (
	charm.land/bubbletea/v2 v2.0.0
	github.com/gin-gonic/gin v1.10.0
)
`)

	provider := &ImportCompletionProvider{catalog: NewDependencyCatalog(root), projectRoot: root}
	ctx := CompletionContext{InImport: true, Language: "go", Prefix: "char"}

	suggestions := provider.GetCompletions(ctx)
	assertSuggestionText(t, suggestions, "charm.land/bubbletea/v2")
	assertSuggestionSource(t, suggestions, "charm.land/bubbletea/v2", core.SourceLibrary)
	assertSuggestionInsertText(t, suggestions, "charm.land/bubbletea/v2", `"charm.land/bubbletea/v2"`)
}

func TestImportCompletionProvider_GetNodeModuleCompletions_FromPackageJSON(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "package.json"), `{
	"dependencies": {
		"@tanstack/react-query": "^5.0.0",
		"tailwindcss": "^4.1.0"
	},
	"devDependencies": {
		"vitest": "^3.0.0"
	}
}`)

	provider := &ImportCompletionProvider{catalog: NewDependencyCatalog(root), projectRoot: root}
	ctx := CompletionContext{InImport: true, Language: "typescript", Prefix: "@tan"}

	suggestions := provider.GetCompletions(ctx)
	assertSuggestionText(t, suggestions, "@tanstack/react-query")
	assertSuggestionSource(t, suggestions, "@tanstack/react-query", core.SourceLibrary)
	assertSuggestionInsertText(t, suggestions, "@tanstack/react-query", "'@tanstack/react-query'")
}

func TestImportCompletionProvider_GetNodeModuleCompletions_FromPackageLockOnly(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "package-lock.json"), `{
		"dependencies": {
			"@tanstack/react-query": {"version":"5.59.0"}
		}
	}`)

	provider := &ImportCompletionProvider{catalog: NewDependencyCatalog(root), projectRoot: root}
	ctx := CompletionContext{InImport: true, Language: "typescript", Prefix: "@tan"}

	suggestions := provider.GetCompletions(ctx)
	assertSuggestionText(t, suggestions, "@tanstack/react-query")
	assertSuggestionSource(t, suggestions, "@tanstack/react-query", core.SourceLocal)
}

func TestImportCompletionProvider_GetPHPCompletions_FromComposerLockOnly(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "composer.lock"), `{
		"packages": [{"name":"nesbot/carbon","version":"3.8.0"}]
	}`)

	provider := &ImportCompletionProvider{catalog: NewDependencyCatalog(root), projectRoot: root}
	ctx := CompletionContext{InImport: true, Language: "php", Prefix: "nes"}

	suggestions := provider.GetCompletions(ctx)
	assertSuggestionText(t, suggestions, "nesbot/carbon")
	assertSuggestionSource(t, suggestions, "nesbot/carbon", core.SourceLocal)
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func assertSuggestionText(t *testing.T, suggestions []Suggestion, want string) {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.Text == want {
			return
		}
	}
	t.Fatalf("expected suggestion %q, got %#v", want, suggestions)
}

func assertSuggestionSource(t *testing.T, suggestions []Suggestion, wantText string, wantSource core.SymbolSource) {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.Text == wantText {
			if suggestion.Source != wantSource {
				t.Fatalf("suggestion %q source=%q want %q", wantText, suggestion.Source, wantSource)
			}
			return
		}
	}
	t.Fatalf("expected suggestion %q", wantText)
}

func assertSuggestionInsertText(t *testing.T, suggestions []Suggestion, wantText, wantInsert string) {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.Text == wantText {
			if suggestion.InsertText != wantInsert {
				t.Fatalf("suggestion %q insert=%q want %q", wantText, suggestion.InsertText, wantInsert)
			}
			return
		}
	}
	t.Fatalf("expected suggestion %q", wantText)
}
