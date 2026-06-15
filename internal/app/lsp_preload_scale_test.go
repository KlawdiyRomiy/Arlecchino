package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"arlecchino/internal/indexer/core"
	indexerlsp "arlecchino/internal/indexer/lsp"
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
	if got.CoverageState != string(diagnosticsPreloadCoverageRunning) {
		t.Fatalf("CoverageState = %q, want running", got.CoverageState)
	}
	if got.TotalLanguages != 3 || got.SelectedLanguages != 2 {
		t.Fatalf("unexpected language summary: %#v", got)
	}
}

func TestCompleteDiagnosticsPreloadPlanMarksBoundedScanIncomplete(t *testing.T) {
	plan := completeDiagnosticsPreloadPlan(diagnosticsPreloadPlan{
		Bounded:            true,
		TotalCandidates:    120,
		SelectedCandidates: 16,
		TotalLanguages:     5,
		SelectedLanguages:  2,
	}, 16, 0, false)

	if plan.CoverageState != diagnosticsPreloadCoverageIncomplete {
		t.Fatalf("CoverageState = %q, want incomplete", plan.CoverageState)
	}
	if !strings.Contains(plan.Message, "bounded subset") {
		t.Fatalf("expected bounded message, got %q", plan.Message)
	}
}

func TestCompleteDiagnosticsPreloadPlanMarksTimeoutIncomplete(t *testing.T) {
	plan := completeDiagnosticsPreloadPlan(diagnosticsPreloadPlan{
		TotalCandidates:    2,
		SelectedCandidates: 2,
		TotalLanguages:     1,
		SelectedLanguages:  1,
	}, 1, 0, true)

	if plan.CoverageState != diagnosticsPreloadCoverageIncomplete {
		t.Fatalf("CoverageState = %q, want incomplete", plan.CoverageState)
	}
	if !plan.TimedOut {
		t.Fatalf("TimedOut = false, want true")
	}
}

func TestCompleteDiagnosticsPreloadPlanMarksPublishTimeoutIncompleteAfterProcessingAllFiles(t *testing.T) {
	plan := completeDiagnosticsPreloadPlan(diagnosticsPreloadPlan{
		TotalCandidates:    2,
		SelectedCandidates: 2,
		TotalLanguages:     1,
		SelectedLanguages:  1,
	}, 2, 0, true)

	if plan.CoverageState != diagnosticsPreloadCoverageIncomplete {
		t.Fatalf("CoverageState = %q, want incomplete", plan.CoverageState)
	}
	if plan.CheckedCandidates != 2 {
		t.Fatalf("CheckedCandidates = %d, want 2", plan.CheckedCandidates)
	}
	if !strings.Contains(plan.Message, "timed out") {
		t.Fatalf("expected timeout message, got %q", plan.Message)
	}
}

func TestCompleteDiagnosticsPreloadPlanMarksFullScanComplete(t *testing.T) {
	plan := completeDiagnosticsPreloadPlan(diagnosticsPreloadPlan{
		TotalCandidates:    2,
		SelectedCandidates: 2,
		TotalLanguages:     1,
		SelectedLanguages:  1,
	}, 2, 0, false)

	if plan.CoverageState != diagnosticsPreloadCoverageComplete {
		t.Fatalf("CoverageState = %q, want complete", plan.CoverageState)
	}
}

func TestBoundedDiagnosticsPreloadPlanCanProgressToFullScan(t *testing.T) {
	previewPlan := diagnosticsPreloadPlan{
		Candidates: []diagnosticsPreloadCandidate{
			{Path: "/project/a.cs", Language: "csharp"},
			{Path: "/project/b.cs", Language: "csharp"},
		},
		AllCandidates: []diagnosticsPreloadCandidate{
			{Path: "/project/a.cs", Language: "csharp"},
			{Path: "/project/b.cs", Language: "csharp"},
			{Path: "/project/c.cs", Language: "csharp"},
			{Path: "/project/d.cs", Language: "csharp"},
			{Path: "/project/app.ts", Language: "typescript"},
		},
		Bounded:            true,
		CoverageState:      diagnosticsPreloadCoverageIncomplete,
		TotalCandidates:    5,
		SelectedCandidates: 2,
		TotalLanguages:     2,
		SelectedLanguages:  1,
		Message:            "Diagnostics scan checked a bounded subset of this project.",
	}

	progressPlan := diagnosticsPreloadFullScanProgressPlan(previewPlan, 2, 0, false, "Still scanning diagnostics across this project.")
	if progressPlan.Bounded {
		t.Fatalf("full scan progress must clear bounded state")
	}
	if progressPlan.CoverageState != diagnosticsPreloadCoverageRunning {
		t.Fatalf("CoverageState = %q, want running", progressPlan.CoverageState)
	}
	if progressPlan.SelectedCandidates != 5 || len(progressPlan.Candidates) != 5 {
		t.Fatalf("expected full candidate set, got selected=%d len=%d", progressPlan.SelectedCandidates, len(progressPlan.Candidates))
	}
	if progressPlan.SelectedLanguages != 2 {
		t.Fatalf("SelectedLanguages = %d, want 2", progressPlan.SelectedLanguages)
	}
	if progressPlan.CheckedCandidates != 2 {
		t.Fatalf("CheckedCandidates = %d, want 2", progressPlan.CheckedCandidates)
	}
	if !strings.Contains(progressPlan.Message, "Still scanning") {
		t.Fatalf("expected progress message, got %q", progressPlan.Message)
	}

	completedPlan := completeDiagnosticsPreloadPlan(progressPlan, 5, 0, false)
	if completedPlan.CoverageState != diagnosticsPreloadCoverageComplete {
		t.Fatalf("CoverageState = %q, want complete", completedPlan.CoverageState)
	}
}

func TestDiagnosticsPreloadRemainingCandidatesExcludePreview(t *testing.T) {
	preview := []diagnosticsPreloadCandidate{
		{Path: "/project/a.cs", Language: "csharp"},
		{Path: "/project/b.cs", Language: "csharp"},
	}
	all := []diagnosticsPreloadCandidate{
		{Path: "/project/a.cs", Language: "csharp"},
		{Path: "/project/b.cs", Language: "csharp"},
		{Path: "/project/c.cs", Language: "csharp"},
		{Path: "/project/app.ts", Language: "typescript"},
	}

	remaining := diagnosticsPreloadRemainingCandidates(all, preview)
	if len(remaining) != 2 {
		t.Fatalf("expected 2 remaining candidates, got %#v", remaining)
	}
	if remaining[0].Path != "/project/c.cs" || remaining[1].Path != "/project/app.ts" {
		t.Fatalf("unexpected remaining candidates: %#v", remaining)
	}
}

func TestFilterDiagnosticsPreloadPlanForManagerRebuildsFromConfiguredLanguages(t *testing.T) {
	previewPlan := diagnosticsPreloadPlan{
		Candidates: []diagnosticsPreloadCandidate{
			{Path: "/project/a.cs", Language: "csharp"},
		},
		AllCandidates: []diagnosticsPreloadCandidate{
			{Path: "/project/a.cs", Language: "csharp"},
			{Path: "/project/b.cs", Language: "csharp"},
			{Path: "/project/app.ts", Language: "typescript"},
			{Path: "/project/view.tsx", Language: "typescriptreact"},
		},
		Bounded:            true,
		TotalCandidates:    4,
		SelectedCandidates: 1,
		TotalLanguages:     2,
		SelectedLanguages:  1,
	}
	mgr := indexerlsp.NewManager(t.TempDir())
	mgr.RegisterServer(indexerlsp.ServerConfig{Language: "typescript", Command: "typescript-language-server"})
	mgr.RegisterServer(indexerlsp.ServerConfig{Language: "typescriptreact", Command: "typescript-language-server"})

	filteredPlan := filterDiagnosticsPreloadPlanForManager(previewPlan, mgr, diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 1,
		PolyglotLanguageThreshold: 1,
		MaxDominantLanguages:      1,
		MaxFilesPerLanguage:       1,
		MaxFiles:                  1,
		MaxTotalBytes:             4096,
		MaxFileSizeBytes:          1024,
		Timeout:                   5 * time.Second,
	})

	if filteredPlan.TotalCandidates != 2 {
		t.Fatalf("TotalCandidates = %d, want 2", filteredPlan.TotalCandidates)
	}
	if filteredPlan.TotalLanguages != 2 {
		t.Fatalf("TotalLanguages = %d, want 2", filteredPlan.TotalLanguages)
	}
	if len(filteredPlan.Candidates) != 1 {
		t.Fatalf("expected bounded configured candidate, got %#v", filteredPlan.Candidates)
	}
	if filteredPlan.Candidates[0].Language == "csharp" {
		t.Fatalf("unsupported csharp candidate survived manager filter: %#v", filteredPlan.Candidates)
	}
}

func TestFilterDiagnosticsPreloadPlanForManagerDropsExpensiveLanguageTail(t *testing.T) {
	allCandidates := []diagnosticsPreloadCandidate{}
	for i := 0; i < 10; i++ {
		allCandidates = append(allCandidates, diagnosticsPreloadCandidate{
			Path:     fmt.Sprintf("/project/app%d.ts", i),
			Language: "typescript",
		})
	}
	for i := 0; i < 2; i++ {
		allCandidates = append(allCandidates, diagnosticsPreloadCandidate{
			Path:     fmt.Sprintf("/project/native%d.c", i),
			Language: "c",
		})
	}
	allCandidates = append(allCandidates, diagnosticsPreloadCandidate{
		Path:     "/project/native.cpp",
		Language: "cpp",
	})

	mgr := indexerlsp.NewManager(t.TempDir())
	mgr.RegisterServer(indexerlsp.ServerConfig{Language: "typescript", Command: "typescript-language-server"})
	mgr.RegisterServer(indexerlsp.ServerConfig{Language: "c", Command: "clangd"})
	mgr.RegisterServer(indexerlsp.ServerConfig{Language: "cpp", Command: "clangd"})

	filteredPlan := filterDiagnosticsPreloadPlanForManager(diagnosticsPreloadPlan{
		AllCandidates: allCandidates,
	}, mgr, diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 1,
		PolyglotLanguageThreshold: 1,
		MaxDominantLanguages:      2,
		MaxFilesPerLanguage:       20,
		MaxFiles:                  20,
		MaxTotalBytes:             4096,
		MaxFileSizeBytes:          1024,
		Timeout:                   5 * time.Second,
	})

	if filteredPlan.TotalCandidates != 10 {
		t.Fatalf("TotalCandidates = %d, want 10", filteredPlan.TotalCandidates)
	}
	for _, candidate := range filteredPlan.AllCandidates {
		if candidate.Language == "c" || candidate.Language == "cpp" {
			t.Fatalf("expensive tail candidate survived: %#v", filteredPlan.AllCandidates)
		}
	}
}

func TestFilterDiagnosticsPreloadPlanForManagerKeepsDominantExpensiveLanguages(t *testing.T) {
	allCandidates := []diagnosticsPreloadCandidate{}
	for i := 0; i < 4; i++ {
		allCandidates = append(allCandidates, diagnosticsPreloadCandidate{
			Path:     fmt.Sprintf("/project/native%d.cpp", i),
			Language: "cpp",
		})
	}
	for i := 0; i < 2; i++ {
		allCandidates = append(allCandidates, diagnosticsPreloadCandidate{
			Path:     fmt.Sprintf("/project/app%d.ts", i),
			Language: "typescript",
		})
	}

	mgr := indexerlsp.NewManager(t.TempDir())
	mgr.RegisterServer(indexerlsp.ServerConfig{Language: "typescript", Command: "typescript-language-server"})
	mgr.RegisterServer(indexerlsp.ServerConfig{Language: "cpp", Command: "clangd"})

	filteredPlan := filterDiagnosticsPreloadPlanForManager(diagnosticsPreloadPlan{
		AllCandidates: allCandidates,
	}, mgr, diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 1,
		PolyglotLanguageThreshold: 1,
		MaxDominantLanguages:      2,
		MaxFilesPerLanguage:       20,
		MaxFiles:                  20,
		MaxTotalBytes:             4096,
		MaxFileSizeBytes:          1024,
		Timeout:                   5 * time.Second,
	})

	counts := map[string]int{}
	for _, candidate := range filteredPlan.AllCandidates {
		counts[candidate.Language]++
	}
	if counts["cpp"] != 4 || counts["typescript"] != 2 {
		t.Fatalf("dominant expensive language was not preserved: %#v", counts)
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

func TestCollectDiagnosticsPreloadCandidatesHonorsDominantLanguageCap(t *testing.T) {
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

	if counts["go"] != 4 || counts["typescript"] != 0 || counts["python"] != 0 {
		t.Fatalf("expected dominant language cap to select only go candidates, got %#v", counts)
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
	if plan.SelectedLanguages != 2 {
		t.Fatalf("expected 2 selected languages, got %d", plan.SelectedLanguages)
	}
	if len(plan.Candidates) != 6 {
		t.Fatalf("expected 6 capped candidates, got %d", len(plan.Candidates))
	}

	counts := map[string]int{}
	for _, candidate := range plan.Candidates {
		counts[candidate.Language]++
	}
	if len(counts) != 2 {
		t.Fatalf("expected dominant language cap to select 2 languages, got %#v", counts)
	}
	for language, count := range counts {
		if count != 3 {
			t.Fatalf("expected per-language cap of 3 for %s, got %#v", language, counts)
		}
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

func TestCollectDiagnosticsPreloadPlanSkipsSymlinkedFiles(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "real.ts"), 64)
	outside := filepath.Join(t.TempDir(), "outside.ts")
	writeTestFile(t, outside, 64)
	linkPath := filepath.Join(root, "link.ts")
	if err := os.Symlink(outside, linkPath); err != nil {
		t.Skipf("symlink not available on this filesystem: %v", err)
	}

	plan, err := collectDiagnosticsPreloadPlan(root, diagnosticsPreloadBudget{
		LargeProjectFileThreshold: 10,
		PolyglotLanguageThreshold: 4,
		MaxFiles:                  10,
		MaxTotalBytes:             4096,
		MaxFileSizeBytes:          1024,
		Timeout:                   5 * time.Second,
	})
	if err != nil {
		t.Fatalf("collectDiagnosticsPreloadPlan error = %v", err)
	}

	if len(plan.Candidates) != 1 {
		t.Fatalf("expected only regular in-root candidate, got %#v", plan.Candidates)
	}
	if plan.Candidates[0].Path != filepath.Join(root, "real.ts") {
		t.Fatalf("expected real.ts candidate, got %s", plan.Candidates[0].Path)
	}
}

func TestReadDiagnosticsPreloadCandidateRejectsOutsideRoot(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.ts")
	writeTestFile(t, outside, 64)

	_, err := readDiagnosticsPreloadCandidate(root, diagnosticsPreloadCandidate{
		Path:     outside,
		Language: "typescript",
		Size:     64,
	})
	if !errors.Is(err, errDiagnosticsPreloadEscapedRoot) {
		t.Fatalf("expected escaped-root error, got %v", err)
	}
}

func TestReadDiagnosticsPreloadCandidateRejectsSymlinkSwap(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.ts")
	writeTestFile(t, outside, 64)
	linkPath := filepath.Join(root, "main.ts")
	if err := os.Symlink(outside, linkPath); err != nil {
		t.Skipf("symlink not available on this filesystem: %v", err)
	}

	_, err := readDiagnosticsPreloadCandidate(root, diagnosticsPreloadCandidate{
		Path:     linkPath,
		Language: "typescript",
		Size:     64,
	})
	if !errors.Is(err, errDiagnosticsPreloadUnsafePath) {
		t.Fatalf("expected unsafe-path error, got %v", err)
	}
}

func TestDiagnosticsPreloadCollectionDeadlineMapsToIncomplete(t *testing.T) {
	plan, shouldEmit := diagnosticsPreloadPlanForCollectionError(context.DeadlineExceeded)
	if !shouldEmit {
		t.Fatal("expected deadline collection error to emit a terminal preload event")
	}
	if plan.CoverageState != diagnosticsPreloadCoverageIncomplete {
		t.Fatalf("CoverageState = %q, want incomplete", plan.CoverageState)
	}
	if !plan.TimedOut {
		t.Fatalf("TimedOut = false, want true")
	}
	if plan.Message == "" {
		t.Fatalf("expected user-facing timeout message")
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
