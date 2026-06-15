package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type flakyAdapter struct {
	badPath string
}

func (a *flakyAdapter) Language() string     { return "go" }
func (a *flakyAdapter) Extensions() []string { return []string{".go"} }
func (a *flakyAdapter) ParseFile(path string) ([]Symbol, []Edge, error) {
	if path == a.badPath {
		return nil, nil, errors.New("bufio.Scanner: token too long")
	}
	return []Symbol{{
		Name:     "IndexedAfterFailure",
		Kind:     SymbolKindFunction,
		Language: "go",
		FilePath: path,
		Line:     1,
		Source:   SourceIndex,
	}}, nil, nil
}
func (a *flakyAdapter) ParseContent(path string, content []byte) ([]Symbol, []Edge, error) {
	return nil, nil, nil
}

func TestIndexProject_DegradesPerFileParseErrorWithoutTerminalFailure(t *testing.T) {
	dir := t.TempDir()
	badFile := filepath.Join(dir, "bad.go")
	okFile := filepath.Join(dir, "ok.go")
	if err := os.WriteFile(badFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write bad file: %v", err)
	}
	if err := os.WriteFile(okFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write ok file: %v", err)
	}

	eng, err := NewEngine(EngineConfig{
		ProjectID:   "parse-error-project",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&flakyAdapter{badPath: badFile})

	events := make(chan IndexingEvent, 16)
	eng.OnIndexing(func(evt IndexingEvent) {
		events <- evt
	})
	eng.Start()
	if err := eng.IndexProjectContext(context.Background()); err != nil {
		t.Fatalf("IndexProjectContext: %v", err)
	}

	timeout := time.After(2 * time.Second)
	for {
		select {
		case evt := <-events:
			if evt.Type == IndexingFailed && evt.Terminal {
				t.Fatalf("unexpected terminal failure event: %#v", evt)
			}
			if evt.Type == IndexingCompleted {
				goto completed
			}
		case <-timeout:
			t.Fatal("timed out waiting for indexing completion")
		}
	}

completed:
	badMeta, err := eng.store.GetFile(badFile)
	if err != nil {
		t.Fatalf("GetFile(bad): %v", err)
	}
	if badMeta == nil {
		t.Fatal("expected metadata for parse-failed file")
	}
	if badMeta.HasSymbols {
		t.Fatalf("parse-failed file HasSymbols = true, want false")
	}

	okMeta, err := eng.store.GetFile(okFile)
	if err != nil {
		t.Fatalf("GetFile(ok): %v", err)
	}
	if okMeta == nil || !okMeta.HasSymbols {
		t.Fatalf("ok file metadata = %#v, want HasSymbols", okMeta)
	}
	symbols, err := eng.store.QuerySymbols(SymbolQuery{FilePath: okFile})
	if err != nil {
		t.Fatalf("QuerySymbols(ok): %v", err)
	}
	if len(symbols) != 1 || symbols[0].Name != "IndexedAfterFailure" {
		t.Fatalf("ok file symbols = %#v", symbols)
	}
}

func TestOnFileCreatedAndSaved_QueuesLargeFiles(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "huge.go")
	eng, err := NewEngine(EngineConfig{
		ProjectID:   "large-foreground-project",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&stubAdapter{})

	largeContent := []byte(strings.Repeat("x", foregroundIndexMaxBytes+1))
	eng.OnFileCreated(goFile, largeContent)
	if queued := drainQueuedPaths(eng.scheduler); len(queued) != 1 || queued[0] != goFile {
		t.Fatalf("OnFileCreated queued = %v, want [%s]", queued, goFile)
	}
	if entry := eng.speculative.Get(goFile); entry != nil {
		t.Fatalf("large created file should not stay in speculative store")
	}

	if err := os.WriteFile(goFile, largeContent, 0644); err != nil {
		t.Fatalf("write large file: %v", err)
	}
	eng.OnFileSaved(goFile)
	if queued := drainQueuedPaths(eng.scheduler); len(queued) != 1 || queued[0] != goFile {
		t.Fatalf("OnFileSaved queued = %v, want [%s]", queued, goFile)
	}
}
