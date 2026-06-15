package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type cancelTestAdapter struct{}

func (a *cancelTestAdapter) Language() string     { return "go" }
func (a *cancelTestAdapter) Extensions() []string { return []string{".go"} }
func (a *cancelTestAdapter) ParseFile(string) ([]Symbol, []Edge, error) {
	return nil, nil, nil
}
func (a *cancelTestAdapter) ParseContent(string, []byte) ([]Symbol, []Edge, error) {
	return nil, nil, nil
}

func TestIndexProjectContext_CancelDuringWalkDoesNotEmitTerminalFailure(t *testing.T) {
	dir := t.TempDir()
	goFile := filepath.Join(dir, "main.go")
	if err := os.WriteFile(goFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	eng, err := NewEngine(EngineConfig{
		ProjectID:   "cancel-project",
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	eng.RegisterAdapter(&cancelTestAdapter{})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events := make(chan IndexingEvent, 16)
	eng.OnIndexing(func(evt IndexingEvent) {
		events <- evt
		if evt.Type == IndexingStarted {
			cancel()
		}
	})

	err = eng.IndexProjectContext(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("IndexProjectContext error = %v, want context.Canceled", err)
	}

	close(events)
	for evt := range events {
		if evt.Type == IndexingFailed && evt.Terminal {
			t.Fatalf("unexpected terminal failure event for cancellation: %#v", evt)
		}
	}
}
