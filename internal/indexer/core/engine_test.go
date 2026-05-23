package core

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

type stubAdapter struct {
	parseCalls int
}

func (a *stubAdapter) Language() string     { return "go" }
func (a *stubAdapter) Extensions() []string { return []string{".go"} }
func (a *stubAdapter) ParseFile(path string) ([]Symbol, []Edge, error) {
	a.parseCalls++
	return nil, nil, nil
}
func (a *stubAdapter) ParseContent(path string, content []byte) ([]Symbol, []Edge, error) {
	return nil, nil, nil
}

type languageTestAdapter struct {
	language   string
	extensions []string
}

func (a languageTestAdapter) Language() string     { return a.language }
func (a languageTestAdapter) Extensions() []string { return a.extensions }
func (a languageTestAdapter) ParseFile(path string) ([]Symbol, []Edge, error) {
	return nil, nil, nil
}
func (a languageTestAdapter) ParseContent(path string, content []byte) ([]Symbol, []Edge, error) {
	return nil, nil, nil
}

type ownerTestAdapter struct {
	language   string
	extensions []string
}

func (a *ownerTestAdapter) Language() string     { return a.language }
func (a *ownerTestAdapter) Extensions() []string { return a.extensions }
func (a *ownerTestAdapter) ParseFile(path string) ([]Symbol, []Edge, error) {
	return nil, nil, nil
}
func (a *ownerTestAdapter) ParseContent(path string, content []byte) ([]Symbol, []Edge, error) {
	return nil, nil, nil
}

func drainQueuedPaths(s *Scheduler) []string {
	paths := make([]string, 0, s.PendingCount())
	for {
		job, ok := s.dequeue()
		if !ok {
			return paths
		}
		paths = append(paths, job.FilePath)
	}
}

func TestEngineDetectLanguageUsesExactNamesAndLongestSuffixes(t *testing.T) {
	dir := t.TempDir()
	eng, err := NewEngine(EngineConfig{
		ProjectID:   "detect",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(languageTestAdapter{language: "php", extensions: []string{".php"}})
	eng.RegisterAdapter(languageTestAdapter{language: "blade", extensions: []string{".blade.php"}})
	eng.RegisterAdapter(languageTestAdapter{language: "makefile", extensions: []string{"Makefile"}})

	if got := eng.detectLanguage("/tmp/views/welcome.blade.php"); got != "blade" {
		t.Fatalf("detectLanguage(.blade.php)=%q, want blade", got)
	}
	if got := eng.detectLanguage("/tmp/Makefile"); got != "makefile" {
		t.Fatalf("detectLanguage(Makefile)=%q, want makefile", got)
	}
}

func TestRegisterAdapterPreservesFirstLanguageOwnerAndAddsLaterExtensions(t *testing.T) {
	dir := t.TempDir()
	eng, err := NewEngine(EngineConfig{
		ProjectID:   "owner",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()

	first := &ownerTestAdapter{language: "example", extensions: []string{".first"}}
	second := &ownerTestAdapter{language: "example", extensions: []string{".second"}}
	eng.RegisterAdapter(first)
	eng.RegisterAdapter(second)

	if got := eng.adapters["example"]; got != first {
		t.Fatalf("engine adapter owner = %#v, want first registered adapter", got)
	}
	eng.scheduler.mu.Lock()
	schedulerOwner := eng.scheduler.adapters["example"]
	eng.scheduler.mu.Unlock()
	if schedulerOwner != first {
		t.Fatalf("scheduler adapter owner = %#v, want first registered adapter", schedulerOwner)
	}
	if got := eng.detectLanguage(filepath.Join(dir, "file.second")); got != "example" {
		t.Fatalf("detectLanguage(.second)=%q, want example", got)
	}
}

func TestRecommendedWorkerCountUsesAvailableGoParallelism(t *testing.T) {
	got := RecommendedWorkerCount()
	if got < 2 {
		t.Fatalf("RecommendedWorkerCount() = %d, want at least 2", got)
	}
	if got > indexProjectWorkerCap {
		t.Fatalf("RecommendedWorkerCount() = %d, want <= %d", got, indexProjectWorkerCap)
	}
}

func TestIndexProject_SkipsUnchangedFiles(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "main.go")
	if err := os.WriteFile(goFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	dbPath := filepath.Join(dir, "test.db")
	eng, err := NewEngine(EngineConfig{ProjectID: "p1", ProjectRoot: dir, DBPath: dbPath, Workers: 1})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	adapter := &stubAdapter{}
	eng.RegisterAdapter(adapter)

	info, err := os.Stat(goFile)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if err := eng.store.SaveFile(File{
		Path:     goFile,
		Language: "go",
		Hash:     fileFingerprint(info),
		Size:     info.Size(),
	}); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}

	eng.IndexProject()

	queued := drainQueuedPaths(eng.scheduler)
	for _, p := range queued {
		if p == goFile {
			t.Errorf("unchanged file was enqueued: %s", p)
		}
	}
	if adapter.parseCalls != 0 {
		t.Errorf("ParseFile called %d times, want 0", adapter.parseCalls)
	}
}

func TestIndexProject_QueuesChangedFiles(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "main.go")
	if err := os.WriteFile(goFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	dbPath := filepath.Join(dir, "test.db")
	eng, err := NewEngine(EngineConfig{ProjectID: "p2", ProjectRoot: dir, DBPath: dbPath, Workers: 1})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	if err := eng.store.SaveFile(File{
		Path:     goFile,
		Language: "go",
		Hash:     "stale",
		Size:     9999,
	}); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}

	eng.IndexProject()

	queued := drainQueuedPaths(eng.scheduler)
	found := false
	for _, p := range queued {
		if p == goFile {
			found = true
		}
	}
	if !found {
		t.Errorf("changed file was not enqueued; queued: %v", queued)
	}
}

func TestIndexProject_KeepsQueuedChangedFilePendingUntilParsed(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "main.go")
	if err := os.WriteFile(goFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	eng, err := NewEngine(EngineConfig{
		ProjectID:   "pending",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, "test.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	if err := eng.IndexProjectContext(context.Background()); err != nil {
		t.Fatalf("IndexProjectContext: %v", err)
	}
	drainQueuedPaths(eng.scheduler)

	meta, err := eng.store.GetFile(goFile)
	if err != nil {
		t.Fatalf("GetFile: %v", err)
	}
	if meta == nil {
		t.Fatal("expected file metadata")
	}
	if !strings.Contains(meta.Hash, dependencyIndexPendingMarker) {
		t.Fatalf("queued file hash = %q, want pending marker", meta.Hash)
	}

	if err := eng.IndexProjectContext(context.Background()); err != nil {
		t.Fatalf("second IndexProjectContext: %v", err)
	}
	queued := drainQueuedPaths(eng.scheduler)
	for _, path := range queued {
		if path == goFile {
			return
		}
	}
	t.Fatalf("pending file was not requeued; queued=%v", queued)
}

func TestIndexProject_ReportsEachSmallBatchProgress(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 3; i++ {
		goFile := filepath.Join(dir, "file"+strconv.Itoa(i)+".go")
		if err := os.WriteFile(goFile, []byte("package main"), 0644); err != nil {
			t.Fatalf("write %s: %v", goFile, err)
		}
	}

	eng, err := NewEngine(EngineConfig{
		ProjectID:   "progress-project",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	events := make(chan IndexingEvent, 16)
	eng.OnIndexing(func(evt IndexingEvent) {
		events <- evt
	})
	eng.Start()
	eng.IndexProject()

	var progress []int
	completed := false
	timeout := time.After(2 * time.Second)
	for !completed {
		select {
		case evt := <-events:
			if evt.Type == IndexingProgress {
				progress = append(progress, evt.Current)
			}
			if evt.Type == IndexingCompleted {
				completed = true
			}
		case <-timeout:
			t.Fatalf("timed out waiting for indexing completion; progress=%v", progress)
		}
	}

	want := []int{1, 2, 3}
	if !reflect.DeepEqual(progress, want) {
		t.Fatalf("progress = %v, want %v", progress, want)
	}
}

func TestFailedIndexingBatchStillEmitsCompletion(t *testing.T) {
	eng := &Engine{}
	eng.activeBatchID.Store(7)
	eng.batchScanDone.Store(true)
	eng.batchTotal.Store(2)
	eng.batchDone.Store(2)
	eng.batchFailed.Store(true)

	events := make(chan IndexingEvent, 2)
	eng.OnIndexing(func(evt IndexingEvent) {
		events <- evt
	})

	eng.completeActiveBatchIfReady(7)

	select {
	case evt := <-events:
		if evt.Type != IndexingCompleted || evt.Current != 2 || evt.Total != 2 {
			t.Fatalf("completion event = %#v", evt)
		}
	case <-time.After(time.Second):
		t.Fatal("failed indexing batch did not emit completion")
	}
}

func TestProcessFile_SavesFileMetadata(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "main.go")
	if err := os.WriteFile(goFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	dbPath := filepath.Join(dir, "test.db")
	eng, err := NewEngine(EngineConfig{ProjectID: "p3", ProjectRoot: dir, DBPath: dbPath, Workers: 1})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	job := Job{
		ProjectID:   "p3",
		ProjectRoot: dir,
		Kind:        JobKindSingleFile,
		FilePath:    goFile,
		Language:    "go",
		Priority:    5,
	}
	if err := eng.scheduler.processFile(job); err != nil {
		t.Fatalf("processFile: %v", err)
	}

	f, err := eng.store.GetFile(goFile)
	if err != nil {
		t.Fatalf("GetFile: %v", err)
	}
	if f == nil {
		t.Fatal("file metadata not saved after processFile")
	}
	if f.Language != "go" {
		t.Errorf("Language = %q, want %q", f.Language, "go")
	}
	info, _ := os.Stat(goFile)
	if f.Size != info.Size() {
		t.Errorf("Size = %d, want %d", f.Size, info.Size())
	}
	wantHash := fileFingerprint(info)
	if f.Hash != wantHash {
		t.Errorf("Hash = %q, want %q", f.Hash, wantHash)
	}
}

func TestOnFileDeleted_RemovesFileMetadata(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "main.go")
	if err := os.WriteFile(goFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	dbPath := filepath.Join(dir, "test.db")
	eng, err := NewEngine(EngineConfig{ProjectID: "p4", ProjectRoot: dir, DBPath: dbPath, Workers: 1})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	info, _ := os.Stat(goFile)
	if err := eng.store.SaveFile(File{
		Path:     goFile,
		Language: "go",
		Hash:     fileFingerprint(info),
		Size:     info.Size(),
	}); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}

	f, _ := eng.store.GetFile(goFile)
	if f == nil {
		t.Fatal("precondition: metadata not seeded")
	}

	eng.OnFileDeleted(goFile)

	f, err = eng.store.GetFile(goFile)
	if err != nil {
		t.Fatalf("GetFile after delete: %v", err)
	}
	if f != nil {
		t.Errorf("file metadata still exists after OnFileDeleted")
	}
}

func TestIndexProject_IgnoredDirs(t *testing.T) {
	dir := t.TempDir()

	srcDir := filepath.Join(dir, "src")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "main.go"), []byte("package main"), 0644); err != nil {
		t.Fatalf("write main.go: %v", err)
	}

	nmDir := filepath.Join(dir, "node_modules", "pkg")
	if err := os.MkdirAll(nmDir, 0755); err != nil {
		t.Fatalf("mkdir node_modules: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nmDir, "index.go"), []byte("package pkg"), 0644); err != nil {
		t.Fatalf("write node_modules/index.go: %v", err)
	}

	gitDir := filepath.Join(dir, ".git")
	if err := os.MkdirAll(gitDir, 0755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte("ref: refs/heads/main"), 0644); err != nil {
		t.Fatalf("write .git/HEAD: %v", err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "hook.go"), []byte("package git"), 0644); err != nil {
		t.Fatalf("write .git/hook.go: %v", err)
	}

	dbPath := filepath.Join(dir, "test.db")
	eng, err := NewEngine(EngineConfig{
		ProjectID:   "test-project",
		ProjectRoot: dir,
		DBPath:      dbPath,
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()

	eng.RegisterAdapter(&stubAdapter{})

	eng.IndexProject()

	queued := drainQueuedPaths(eng.scheduler)

	for _, p := range queued {
		if strings.Contains(p, "node_modules") {
			t.Errorf("node_modules файл попал в очередь: %s", p)
		}
		if strings.Contains(p, string(filepath.Separator)+".git"+string(filepath.Separator)) ||
			strings.HasSuffix(p, string(filepath.Separator)+".git") {
			t.Errorf(".git файл попал в очередь: %s", p)
		}
	}

	var hasMain bool
	for _, p := range queued {
		if strings.HasSuffix(p, "main.go") {
			hasMain = true
		}
	}
	if !hasMain {
		t.Errorf("src/main.go не попал в очередь; queued: %v", queued)
	}
}

func TestIndexProject_RegistersUnknownFilesInInventory(t *testing.T) {
	dir := t.TempDir()

	goFile := filepath.Join(dir, "src", "main.go")
	readmeFile := filepath.Join(dir, "README.md")
	logoFile := filepath.Join(dir, "assets", "logo.png")

	for path, content := range map[string]string{
		goFile:     "package main",
		readmeFile: "# docs",
		logoFile:   "png",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatalf("mkdir %s: %v", path, err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}

	eng, err := NewEngine(EngineConfig{
		ProjectID:   "inventory-project",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	eng.IndexProject()

	queued := drainQueuedPaths(eng.scheduler)
	if len(queued) != 1 || queued[0] != goFile {
		t.Fatalf("expected only supported source file enqueued, got %v", queued)
	}

	assertFile := func(path string, wantKind FileKind, wantLanguage string) {
		t.Helper()

		meta, err := eng.store.GetFile(path)
		if err != nil {
			t.Fatalf("GetFile(%s): %v", path, err)
		}
		if meta == nil {
			t.Fatalf("expected file %s in inventory", path)
		}
		if meta.Kind != wantKind {
			t.Fatalf("Kind(%s) = %q, want %q", path, meta.Kind, wantKind)
		}
		if meta.Language != wantLanguage {
			t.Fatalf("Language(%s) = %q, want %q", path, meta.Language, wantLanguage)
		}
	}

	assertFile(goFile, FileKindSource, "go")
	assertFile(readmeFile, FileKindText, "")
	assertFile(logoFile, FileKindAsset, "")
}

func TestOnFileChanged_DoesNotPersistExistingFileInventoryOnTyping(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "main.go")
	if err := os.WriteFile(goFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	eng, err := NewEngine(EngineConfig{
		ProjectID:   "typing-project",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	if err := eng.store.SaveFile(File{
		Path:     goFile,
		Language: "go",
		Hash:     "saved-hash",
		Size:     12,
	}); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}

	eng.OnFileChanged(goFile, []byte("package main\nfunc main() {}"))

	meta, err := eng.store.GetFile(goFile)
	if err != nil {
		t.Fatalf("GetFile: %v", err)
	}
	if meta == nil {
		t.Fatal("expected seeded file metadata")
	}
	if meta.Hash != "saved-hash" {
		t.Fatalf("Hash = %q, want saved-hash", meta.Hash)
	}
}

func TestOnFileChanged_SkipsHugeSpeculativeContent(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "huge.go")
	eng, err := NewEngine(EngineConfig{
		ProjectID:   "huge-project",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	eng.OnFileChanged(goFile, []byte(strings.Repeat("x", speculativeChangeMaxBytes+1)))

	if entry := eng.speculative.Get(goFile); entry != nil {
		t.Fatalf("expected huge speculative content to be skipped, got entry with %d bytes", len(entry.Content))
	}
}
