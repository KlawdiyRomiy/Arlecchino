package app

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"arlecchino/internal/indexer/core"
)

func TestNewLSPDiagnosticsEventIncludesProjectMetadata(t *testing.T) {
	got := newLSPDiagnosticsEvent(
		"/tmp",
		42,
		"go",
		"/tmp/test.go",
		nil,
	)

	if got.ProjectPath != "/tmp" {
		t.Fatalf("expected project path /tmp, got %q", got.ProjectPath)
	}
	if got.Generation != 42 {
		t.Fatalf("expected generation 42, got %d", got.Generation)
	}
}

func TestNewLSPDiagnosticsPreloadEventIncludesGeneration(t *testing.T) {
	got := newLSPDiagnosticsPreloadEvent("/tmp/project", 7, diagnosticsPreloadPlan{
		Bounded:            true,
		TotalCandidates:    20,
		SelectedCandidates: 8,
		TotalLanguages:     3,
		SelectedLanguages:  2,
	})

	if got.ProjectPath != "/tmp/project" {
		t.Fatalf("expected project path /tmp/project, got %q", got.ProjectPath)
	}
	if got.Generation != 7 {
		t.Fatalf("expected generation 7, got %d", got.Generation)
	}
	if !got.Bounded || got.TotalCandidates != 20 || got.SelectedCandidates != 8 {
		t.Fatalf("unexpected preload summary: %#v", got)
	}
	if got.TotalLanguages != 3 || got.SelectedLanguages != 2 {
		t.Fatalf("unexpected language summary: %#v", got)
	}
}

func TestCollectDiagnosticsPreloadCandidatesReturnsAllSmallProjects(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "main.go"), 64)
	writeTestFile(t, filepath.Join(root, "pkg", "helper.go"), 64)
	writeTestFile(t, filepath.Join(root, "web", "app.ts"), 64)

	budget := diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 10,
		MaxFileSizeBytes:          1024,
		MaxFiles:                  2,
		MaxTotalBytes:             128,
		PolyglotLanguageThreshold: 4,
		Timeout:                   5 * time.Second,
	}

	candidates, err := collectDiagnosticsPreloadCandidates(root, budget)
	if err != nil {
		t.Fatalf("collectDiagnosticsPreloadCandidates error = %v", err)
	}

	if len(candidates) != 3 {
		t.Fatalf("expected 3 candidates for small project, got %d", len(candidates))
	}
}

func TestCollectDiagnosticsPreloadCandidatesSpreadAcrossLargePolyglotProjects(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 5; i++ {
		writeTestFile(t, filepath.Join(root, "go", fmt.Sprintf("file%d.go", i)), 64)
	}
	for i := 0; i < 3; i++ {
		writeTestFile(t, filepath.Join(root, "ts", fmt.Sprintf("file%d.ts", i)), 64)
	}
	for i := 0; i < 2; i++ {
		writeTestFile(t, filepath.Join(root, "py", fmt.Sprintf("file%d.py", i)), 64)
	}

	budget := diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 4,
		MaxDominantLanguages:      1,
		MaxFilesPerLanguage:       4,
		MaxFileSizeBytes:          1024,
		MaxFiles:                  4,
		MaxTotalBytes:             256,
		PolyglotLanguageThreshold: 2,
		Timeout:                   5 * time.Second,
	}

	candidates, err := collectDiagnosticsPreloadCandidates(root, budget)
	if err != nil {
		t.Fatalf("collectDiagnosticsPreloadCandidates error = %v", err)
	}

	if len(candidates) != 4 {
		t.Fatalf("expected 4 capped candidates, got %d", len(candidates))
	}

	counts := map[string]int{}
	for _, candidate := range candidates {
		counts[candidate.Language]++
	}

	if counts["go"] != 2 || counts["typescript"] != 1 || counts["python"] != 1 {
		t.Fatalf("expected breadth-first language spread, got %#v", counts)
	}
	for language, count := range counts {
		if count == 0 {
			t.Fatalf("expected %s to be represented in bounded selection", language)
		}
	}
}

func TestCollectDiagnosticsPreloadPlanLimitsLanguagesAndPerLanguage(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 6; i++ {
		writeTestFile(t, filepath.Join(root, "go", fmt.Sprintf("file%d.go", i)), 64)
	}
	for i := 0; i < 5; i++ {
		writeTestFile(t, filepath.Join(root, "ts", fmt.Sprintf("file%d.ts", i)), 64)
	}
	for i := 0; i < 4; i++ {
		writeTestFile(t, filepath.Join(root, "py", fmt.Sprintf("file%d.py", i)), 64)
	}

	plan, err := collectDiagnosticsPreloadPlan(root, diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 4,
		PolyglotLanguageThreshold: 2,
		MaxDominantLanguages:      2,
		MaxFilesPerLanguage:       3,
		MaxFiles:                  10,
		MaxTotalBytes:             4096,
		MaxFileSizeBytes:          1024,
		Timeout:                   5 * time.Second,
	})
	if err != nil {
		t.Fatalf("collectDiagnosticsPreloadPlan error = %v", err)
	}

	if !plan.Bounded {
		t.Fatalf("expected bounded preload plan for large polyglot project")
	}
	if plan.TotalLanguages != 3 {
		t.Fatalf("expected 3 total languages, got %d", plan.TotalLanguages)
	}
	if plan.SelectedLanguages != 3 {
		t.Fatalf("expected 3 selected languages, got %d", plan.SelectedLanguages)
	}
	if len(plan.Candidates) != 9 {
		t.Fatalf("expected 9 capped candidates, got %d", len(plan.Candidates))
	}

	counts := map[string]int{}
	for _, candidate := range plan.Candidates {
		counts[candidate.Language]++
	}
	if counts["go"] != 3 || counts["typescript"] != 3 || counts["python"] != 3 {
		t.Fatalf("expected per-language cap of 3 with broad language coverage, got %#v", counts)
	}
}

func TestCollectDiagnosticsPreloadPlanPrefersSourceLanguagesOverDocs(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 8; i++ {
		writeTestFile(t, filepath.Join(root, "docs", fmt.Sprintf("doc%d.md", i)), 64)
	}
	for i := 0; i < 7; i++ {
		writeTestFile(t, filepath.Join(root, "config", fmt.Sprintf("cfg%d.json", i)), 64)
	}
	for i := 0; i < 4; i++ {
		writeTestFile(t, filepath.Join(root, "internal", fmt.Sprintf("file%d.go", i)), 64)
	}

	plan, err := collectDiagnosticsPreloadPlan(root, diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 4,
		PolyglotLanguageThreshold: 2,
		MaxDominantLanguages:      2,
		MaxFilesPerLanguage:       3,
		MaxFiles:                  6,
		MaxTotalBytes:             4096,
		MaxFileSizeBytes:          1024,
		Timeout:                   5 * time.Second,
	})
	if err != nil {
		t.Fatalf("collectDiagnosticsPreloadPlan error = %v", err)
	}

	if !plan.Bounded {
		t.Fatalf("expected bounded preload plan for doc-heavy project")
	}

	langs := make(map[string]int)
	for _, candidate := range plan.Candidates {
		langs[candidate.Language]++
	}

	if langs["go"] == 0 {
		t.Fatalf("expected source language go to survive bounded selection, got %#v", langs)
	}
}

func TestCollectDiagnosticsPreloadPlanPrefersSourceFilesOverManifests(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "go.mod"), 64)
	writeTestFile(t, filepath.Join(root, "go.sum"), 64)
	writeTestFile(t, filepath.Join(root, "cmd", "app", "main.go"), 64)
	writeTestFile(t, filepath.Join(root, "internal", "broken.go"), 64)
	writeTestFile(t, filepath.Join(root, "pkg", "helper.go"), 64)

	plan, err := collectDiagnosticsPreloadPlan(root, diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 1,
		PolyglotLanguageThreshold: 1,
		MaxDominantLanguages:      1,
		MaxFilesPerLanguage:       2,
		MaxFiles:                  2,
		MaxTotalBytes:             4096,
		MaxFileSizeBytes:          1024,
		Timeout:                   5 * time.Second,
	})
	if err != nil {
		t.Fatalf("collectDiagnosticsPreloadPlan error = %v", err)
	}

	if len(plan.Candidates) != 2 {
		t.Fatalf("expected capped source selection, got %d candidates", len(plan.Candidates))
	}

	for _, candidate := range plan.Candidates {
		if strings.HasSuffix(candidate.Path, "go.mod") || strings.HasSuffix(candidate.Path, "go.sum") {
			t.Fatalf("expected source files to outrank manifests, got %s", candidate.Path)
		}
	}
}

func TestCollectDiagnosticsPreloadPlanUsesInventorySymbolsToPrioritizeUsefulSourceFiles(t *testing.T) {
	root := t.TempDir()
	entryPath := filepath.Join(root, "cmd", "app", "main.go")
	helperPath := filepath.Join(root, "pkg", "helper.go")
	sparePath := filepath.Join(root, "pkg", "spare.go")
	writeTestFile(t, entryPath, 64)
	writeTestFile(t, helperPath, 64)
	writeTestFile(t, sparePath, 64)

	inventory := map[string]core.File{
		entryPath: {
			Path:       entryPath,
			Language:   "go",
			Kind:       core.FileKindSource,
			HasSymbols: true,
		},
		helperPath: {
			Path:       helperPath,
			Language:   "go",
			Kind:       core.FileKindSource,
			HasSymbols: false,
		},
		sparePath: {
			Path:       sparePath,
			Language:   "go",
			Kind:       core.FileKindSource,
			HasSymbols: false,
		},
	}

	plan, err := collectDiagnosticsPreloadPlanWithInventory(root, inventory, diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 1,
		PolyglotLanguageThreshold: 1,
		MaxFilesPerLanguage:       1,
		MaxFiles:                  1,
		MaxTotalBytes:             4096,
		MaxFileSizeBytes:          1024,
		Timeout:                   5 * time.Second,
	})
	if err != nil {
		t.Fatalf("collectDiagnosticsPreloadPlanWithInventory error = %v", err)
	}

	if len(plan.Candidates) != 1 {
		t.Fatalf("expected single selected candidate, got %d", len(plan.Candidates))
	}
	if plan.Candidates[0].Path != entryPath {
		t.Fatalf("expected inventory-rich source file to be selected first, got %s", plan.Candidates[0].Path)
	}
}

func TestAdaptDiagnosticsPreloadBudgetConstrainedByProjectPressure(t *testing.T) {
	budget := adaptDiagnosticsPreloadBudget(defaultDiagnosticsPreloadBudget(), 6000, 0)

	if budget.MaxFiles != 8 {
		t.Fatalf("MaxFiles = %d, want 8 for constrained project", budget.MaxFiles)
	}
	if budget.MaxFilesPerLanguage != 2 {
		t.Fatalf("MaxFilesPerLanguage = %d, want 2", budget.MaxFilesPerLanguage)
	}
	if budget.Timeout > 3*time.Second {
		t.Fatalf("Timeout = %s, want <= 3s", budget.Timeout)
	}
}

func TestAdaptDiagnosticsPreloadBudgetCriticalByQueueDepth(t *testing.T) {
	budget := adaptDiagnosticsPreloadBudget(defaultDiagnosticsPreloadBudget(), 0, 500)

	if budget.MaxFiles != 4 {
		t.Fatalf("MaxFiles = %d, want 4 for critical queue", budget.MaxFiles)
	}
	if budget.MaxTotalBytes > 512<<10 {
		t.Fatalf("MaxTotalBytes = %d, want <= 512KiB", budget.MaxTotalBytes)
	}
	if budget.Timeout > 2*time.Second {
		t.Fatalf("Timeout = %s, want <= 2s", budget.Timeout)
	}
}

func TestBeginDiagnosticsPreloadCancelsPreviousRequest(t *testing.T) {
	app := &App{}

	firstCtx, firstCancel, firstSeq := app.beginDiagnosticsPreload(context.Background(), time.Minute)
	defer firstCancel()
	secondCtx, secondCancel, secondSeq := app.beginDiagnosticsPreload(context.Background(), time.Minute)
	defer secondCancel()

	select {
	case <-firstCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("first preload context was not canceled by newer request")
	}
	if app.isCurrentDiagnosticsPreload(firstSeq) {
		t.Fatalf("first preload sequence is still current")
	}
	if !app.isCurrentDiagnosticsPreload(secondSeq) {
		t.Fatalf("second preload sequence is not current")
	}
	if err := secondCtx.Err(); err != nil {
		t.Fatalf("second preload context error = %v", err)
	}
}

func writeTestFile(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir failed for %s: %v", path, err)
	}
	content := bytes.Repeat([]byte("a"), size)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write failed for %s: %v", path, err)
	}
}
