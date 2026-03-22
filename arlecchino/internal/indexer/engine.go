package indexer

import (
	"context"
	"sync"
)

type Engine struct {
	store       *Store
	speculative *SpeculativeStore
	registry    *CommandRegistry
	parser      *CommandParser
	scheduler   *Scheduler

	mu        sync.RWMutex
	projectID string
}

func NewEngine(projectPath string) (*Engine, error) {
	store, err := NewStore(projectPath)
	if err != nil {
		return nil, err
	}

	registry := NewCommandRegistry()
	parser := NewCommandParser(registry)
	speculative := NewSpeculativeStore()

	e := &Engine{
		store:       store,
		speculative: speculative,
		registry:    registry,
		parser:      parser,
		projectID:   projectPath,
	}

	e.scheduler = NewScheduler(e.handleJob, 4)
	e.scheduler.Start()

	return e, nil
}

func (e *Engine) Close() {
	if e.scheduler != nil {
		e.scheduler.Stop()
	}
}

func (e *Engine) Query() *Query {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return NewQuery(e.store, e.speculative, e.projectID)
}

func (e *Engine) ParseCommand(input string) *ParsedCommand {
	return e.parser.Parse(input)
}

func (e *Engine) SuggestCommand(input string) []Suggestion {
	return e.parser.Suggest(input)
}

func (e *Engine) UpdatePrediction(input string) {
	parsed := e.parser.Parse(input)
	if !parsed.Valid || parsed.Argument == "" {
		e.speculative.Clear(e.projectID)
		return
	}

	pending := e.registry.Predict(e.projectID, parsed.Command, parsed.Argument, parsed.Flags)
	if pending == nil {
		e.speculative.Clear(e.projectID)
		return
	}

	e.speculative.Clear(e.projectID)
	e.speculative.Add(pending)
}

func (e *Engine) ConfirmPrediction(input string) {
	parsed := e.parser.Parse(input)
	if !parsed.Valid {
		return
	}
	// Pending stays until fsnotify confirms file creation
}

func (e *Engine) CancelPrediction() {
	e.speculative.Clear(e.projectID)
}

func (e *Engine) OnFileCreated(path string) {
	pending := e.speculative.FindByPath(e.projectID, path)
	if pending != nil {
		e.speculative.Remove(pending.ID)
	}

	e.scheduler.Enqueue(Job{
		ProjectID:   e.projectID,
		ProjectRoot: e.projectID,
		Kind:        detectJobKind(path),
		Priority:    8,
	})
}

func (e *Engine) Reindex(kind JobKind) {
	e.scheduler.Enqueue(Job{
		ProjectID:   e.projectID,
		ProjectRoot: e.projectID,
		Kind:        kind,
		Priority:    5,
	})
}

func (e *Engine) ReindexAll() {
	e.scheduler.Enqueue(Job{
		ProjectID:   e.projectID,
		ProjectRoot: e.projectID,
		Kind:        JobKindFull,
		Priority:    3,
	})
}

func (e *Engine) handleJob(ctx context.Context, job Job) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	// Delegate to specific indexers - implementation in laravel.go
	return nil
}

func (e *Engine) Registry() *CommandRegistry {
	return e.registry
}

func (e *Engine) Store() *Store {
	return e.store
}

func (e *Engine) Speculative() *SpeculativeStore {
	return e.speculative
}

func detectJobKind(path string) JobKind {
	switch {
	case contains(path, "/Models/"):
		return JobKindModels
	case contains(path, "/Controllers/"):
		return JobKindControllers
	case contains(path, "/migrations/"):
		return JobKindMigrations
	case contains(path, "/views/"):
		return JobKindViews
	case contains(path, "/Livewire/"):
		return JobKindLivewire
	case contains(path, "/Components/"):
		return JobKindBlade
	case contains(path, "/Policies/"):
		return JobKindPolicies
	case contains(path, "/Requests/"):
		return JobKindFormRequests
	case contains(path, "/Events/"):
		return JobKindEvents
	case contains(path, "/Listeners/"):
		return JobKindListeners
	default:
		return JobKindFull
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && findSubstring(s, substr))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
