package core

import (
	"strings"
	"sync"
)

type SpeculativeStore struct {
	mu      sync.RWMutex
	entries map[string]*SpecEntry
	symbols []Symbol
}

type SpecEntry struct {
	Path     string
	Content  []byte
	Symbols  []Symbol
	Language string
}

func NewSpeculativeStore() *SpeculativeStore {
	return &SpeculativeStore{
		entries: make(map[string]*SpecEntry),
	}
}

func (s *SpeculativeStore) Add(path string, content []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.entries[path] = &SpecEntry{
		Path:    path,
		Content: content,
	}
}

func (s *SpeculativeStore) AddWithSymbols(path string, content []byte, symbols []Symbol) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range symbols {
		symbols[i].IsPending = true
		symbols[i].Source = SourceVirtual
	}

	s.entries[path] = &SpecEntry{
		Path:    path,
		Content: content,
		Symbols: symbols,
	}
}

func (s *SpeculativeStore) Remove(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, path)
}

func (s *SpeculativeStore) Get(path string) *SpecEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.entries[path]
}

func (s *SpeculativeStore) GetContent(path string) []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if entry, ok := s.entries[path]; ok {
		return entry.Content
	}
	return nil
}

func (s *SpeculativeStore) GetSymbols(q SymbolQuery) []Symbol {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []Symbol
	for _, entry := range s.entries {
		for _, sym := range entry.Symbols {
			if s.matchQuery(sym, q) {
				result = append(result, sym)
			}
		}
	}
	return result
}

func (s *SpeculativeStore) AllEntries() []*SpecEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries := make([]*SpecEntry, 0, len(s.entries))
	for _, e := range s.entries {
		entries = append(entries, e)
	}
	return entries
}

func (s *SpeculativeStore) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = make(map[string]*SpecEntry)
}

func (s *SpeculativeStore) matchQuery(sym Symbol, q SymbolQuery) bool {
	if q.Name != "" && !strings.HasPrefix(strings.ToLower(sym.Name), strings.ToLower(q.Name)) {
		return false
	}
	if q.Kind != "" && sym.Kind != q.Kind {
		return false
	}
	if q.Language != "" && sym.Language != q.Language {
		return false
	}
	if q.Namespace != "" && sym.Namespace != q.Namespace {
		return false
	}
	if q.FilePath != "" && sym.FilePath != q.FilePath {
		return false
	}
	return true
}
