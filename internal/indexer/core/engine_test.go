package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
