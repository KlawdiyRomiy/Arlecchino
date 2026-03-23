package indexer

import (
	"sync"
	"time"
)

type PendingKind string

const (
	// Artisan
	PendingModel        PendingKind = "model"
	PendingController   PendingKind = "controller"
	PendingMigration    PendingKind = "migration"
	PendingSeeder       PendingKind = "seeder"
	PendingFactory      PendingKind = "factory"
	PendingPolicy       PendingKind = "policy"
	PendingRequest      PendingKind = "request"
	PendingResource     PendingKind = "resource"
	PendingEvent        PendingKind = "event"
	PendingListener     PendingKind = "listener"
	PendingJob          PendingKind = "job"
	PendingMail         PendingKind = "mail"
	PendingNotification PendingKind = "notification"
	PendingCommand      PendingKind = "command"
	PendingMiddleware   PendingKind = "middleware"
	PendingChannel      PendingKind = "channel"
	PendingException    PendingKind = "exception"
	PendingCast         PendingKind = "cast"
	PendingComponent    PendingKind = "component"
	PendingLivewire     PendingKind = "livewire"
	PendingTest         PendingKind = "test"

	// Composer
	PendingPackage PendingKind = "package"

	// Git
	PendingBranch PendingKind = "branch"
	PendingTag    PendingKind = "tag"
	PendingStash  PendingKind = "stash"
)

type PendingEntry struct {
	ID        string
	ProjectID string
	Kind      PendingKind
	Name      string
	Namespace string
	FilePath  string
	Extra     map[string]string
	CreatedAt time.Time
}

type SpeculativeStore struct {
	mu      sync.RWMutex
	entries map[string]*PendingEntry
}

func NewSpeculativeStore() *SpeculativeStore {
	return &SpeculativeStore{
		entries: make(map[string]*PendingEntry),
	}
}

func (s *SpeculativeStore) Add(entry *PendingEntry) {
	s.mu.Lock()
	entry.CreatedAt = time.Now()
	s.entries[entry.ID] = entry
	s.mu.Unlock()
}

func (s *SpeculativeStore) Remove(id string) {
	s.mu.Lock()
	delete(s.entries, id)
	s.mu.Unlock()
}

func (s *SpeculativeStore) Clear(projectID string) {
	s.mu.Lock()
	for id, e := range s.entries {
		if e.ProjectID == projectID {
			delete(s.entries, id)
		}
	}
	s.mu.Unlock()
}

func (s *SpeculativeStore) ClearByKind(projectID string, kind PendingKind) {
	s.mu.Lock()
	for id, e := range s.entries {
		if e.ProjectID == projectID && e.Kind == kind {
			delete(s.entries, id)
		}
	}
	s.mu.Unlock()
}

func (s *SpeculativeStore) Get(id string) *PendingEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.entries[id]
}

func (s *SpeculativeStore) List(projectID string) []*PendingEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*PendingEntry
	for _, e := range s.entries {
		if e.ProjectID == projectID {
			result = append(result, e)
		}
	}
	return result
}

func (s *SpeculativeStore) FindByName(projectID string, kind PendingKind, name string) *PendingEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, e := range s.entries {
		if e.ProjectID == projectID && e.Kind == kind && e.Name == name {
			return e
		}
	}
	return nil
}

func (s *SpeculativeStore) FindByPath(projectID, path string) *PendingEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, e := range s.entries {
		if e.ProjectID == projectID && e.FilePath == path {
			return e
		}
	}
	return nil
}
