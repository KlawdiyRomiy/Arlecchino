package brain

import (
	"strconv"
	"time"

	"arlecchino/internal/indexer/core"
)

// VirtualStore manages virtual (predicted/pending) symbols in the database.
// Virtual symbols are symbols that don't exist yet but are predicted to be created.
// They are stored in SQLite with IsPending=true until confirmed.
type VirtualStore struct {
	store    *core.Store
	ttl      time.Duration
	stopChan chan struct{}
}

// VirtualEntry represents a virtual symbol with metadata
type VirtualEntry struct {
	Symbol    core.Symbol
	CreatedAt time.Time
	UsedCount int
	Accepted  bool
	Context   string
}

// NewVirtualStore creates a new virtual store backed by SQLite
func NewVirtualStore(store *core.Store, ttl time.Duration) *VirtualStore {
	vs := &VirtualStore{
		store:    store,
		ttl:      ttl,
		stopChan: make(chan struct{}),
	}
	go vs.cleanupLoop()
	return vs
}

// Add saves a virtual symbol to the database with IsPending=true
func (vs *VirtualStore) Add(sym core.Symbol, context string) {
	if vs.store == nil {
		return
	}

	sym.IsPending = true
	sym.Source = core.SourceVirtual

	// Store context in Extra if provided
	if sym.Extra == nil {
		sym.Extra = make(map[string]string)
	}
	if context != "" {
		sym.Extra["virtual_context"] = context
	}
	sym.Extra["virtual_created"] = strconv.FormatInt(time.Now().Unix(), 10)

	vs.store.SaveSymbols([]core.Symbol{sym})
}

// Get retrieves virtual symbols for a file/language from database
func (vs *VirtualStore) Get(filePath, language string) []*VirtualEntry {
	if vs.store == nil {
		return nil
	}

	// NOTE: Don't lock vs.mu here - store.QuerySymbols has its own mutex
	// Nested locking causes deadlock

	// Query pending symbols from database
	symbols, err := vs.store.QuerySymbols(core.SymbolQuery{
		Language:       language,
		IncludePending: true,
		Limit:          100,
	})
	if err != nil {
		return nil
	}

	// Filter only pending/virtual symbols
	result := make([]*VirtualEntry, 0)
	for _, sym := range symbols {
		if !sym.IsPending || sym.Source != core.SourceVirtual {
			continue
		}

		// Include if matches language or file path
		if sym.Language == language || sym.FilePath == filePath {
			entry := &VirtualEntry{
				Symbol:   sym,
				Accepted: false,
			}

			// Extract metadata from Extra
			if sym.Extra != nil {
				if created, ok := sym.Extra["virtual_created"]; ok {
					if ts, err := strconv.ParseInt(created, 10, 64); err == nil {
						entry.CreatedAt = time.Unix(ts, 0)
					}
				}
				if ctx, ok := sym.Extra["virtual_context"]; ok {
					entry.Context = ctx
				}
			}

			result = append(result, entry)
		}
	}
	return result
}

// MarkAccepted marks a virtual symbol as accepted (no longer pending)
func (vs *VirtualStore) MarkAccepted(name, filePath string) {
	if vs.store == nil {
		return
	}

	symbols, err := vs.store.QuerySymbols(core.SymbolQuery{
		Name:           name,
		FilePath:       filePath,
		IncludePending: true,
		Limit:          1,
	})
	if err != nil || len(symbols) == 0 {
		return
	}

	// Mark as no longer pending
	vs.store.UpdateSymbolPending(symbols[0].ID, false)
}

// OnFileCreated handles when a predicted file is actually created
func (vs *VirtualStore) OnFileCreated(filePath string) {
	if vs.store == nil {
		return
	}

	symbols, err := vs.store.QuerySymbols(core.SymbolQuery{
		FilePath:       filePath,
		IncludePending: true,
	})
	if err != nil {
		return
	}

	// Mark them as confirmed (not pending anymore)
	for _, sym := range symbols {
		if sym.IsPending && sym.Source == core.SourceVirtual {
			vs.store.UpdateSymbolPending(sym.ID, false)
		}
	}
}

// cleanupLoop periodically removes old unaccepted virtual symbols
func (vs *VirtualStore) cleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			vs.cleanup()
		case <-vs.stopChan:
			return
		}
	}
}

// cleanup removes old pending virtual symbols that were never accepted
func (vs *VirtualStore) cleanup() {
	if vs.store == nil {
		return
	}

	symbols, err := vs.store.QuerySymbols(core.SymbolQuery{
		IncludePending: true,
		Limit:          500,
	})
	if err != nil {
		return
	}

	now := time.Now()
	for _, sym := range symbols {
		if !sym.IsPending || sym.Source != core.SourceVirtual {
			continue
		}

		// Check creation time from Extra
		if sym.Extra != nil {
			if created, ok := sym.Extra["virtual_created"]; ok {
				if ts, err := strconv.ParseInt(created, 10, 64); err == nil {
					createdTime := time.Unix(ts, 0)
					if now.Sub(createdTime) > vs.ttl {
						// Delete old unaccepted virtual symbol
						vs.store.DeleteSymbol(sym.ID)
					}
				}
			}
		}
	}
}

// Stop stops the background cleanup goroutine
func (vs *VirtualStore) Stop() {
	close(vs.stopChan)
}

// Cleanup performs immediate cleanup and stops the background goroutine
func (vs *VirtualStore) Cleanup() {
	vs.cleanup()
	vs.Stop()
}
