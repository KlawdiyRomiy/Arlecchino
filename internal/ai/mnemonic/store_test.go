package mnemonic

import (
	"strings"
	"testing"
)

func TestSearchDefaultsToLatestTrustedEntries(t *testing.T) {
	store, err := Open(t.TempDir(), true)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	entries := []Entry{
		{ID: "trusted", Content: "alpha project rule", Importance: 3, Trust: TrustTrusted, IsLatest: true},
		{ID: "generated", Content: "alpha generated transcript", Importance: 9, Trust: TrustGenerated, IsLatest: true},
		{ID: "untrusted", Content: "alpha untrusted note", Importance: 9, Trust: TrustUntrusted, IsLatest: true},
		{ID: "old", Content: "alpha old rule", Importance: 9, Trust: TrustTrusted, IsLatest: false},
	}
	for _, entry := range entries {
		if _, err := store.Save(entry); err != nil {
			t.Fatalf("Save %s: %v", entry.ID, err)
		}
	}
	got, err := store.Search("alpha", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(got) != 1 || got[0].ID != "trusted" {
		t.Fatalf("default search returned %#v", got)
	}
	got, err = store.SearchEntries(SearchRequest{
		Query:             "alpha",
		Limit:             10,
		IncludeGenerated:  true,
		IncludeUntrusted:  true,
		IncludeSuperseded: true,
	})
	if err != nil {
		t.Fatalf("SearchEntries: %v", err)
	}
	if len(got) != 4 {
		t.Fatalf("expanded search returned %#v", got)
	}
}

func TestRelationshipsAndDeleteCleanup(t *testing.T) {
	store, err := Open(t.TempDir(), true)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	if _, err := store.Save(Entry{ID: "base", Content: "base memory", Trust: TrustTrusted, IsLatest: true}); err != nil {
		t.Fatalf("Save base: %v", err)
	}
	saved, err := store.Save(Entry{
		ID:       "next",
		Content:  "next memory",
		Trust:    TrustTrusted,
		IsLatest: true,
		Relationships: []Relationship{{
			ToID: "base",
			Type: "updates",
		}},
	})
	if err != nil {
		t.Fatalf("Save next: %v", err)
	}
	if len(saved.Relationships) != 1 || saved.Relationships[0].Type != "updates" {
		t.Fatalf("relationships = %#v", saved.Relationships)
	}
	if err := store.Delete("base"); err != nil {
		t.Fatalf("Delete base: %v", err)
	}
	next, err := store.Get("next")
	if err != nil {
		t.Fatalf("Get next: %v", err)
	}
	if len(next.Relationships) != 0 {
		t.Fatalf("relationship to deleted entry remained: %#v", next.Relationships)
	}
}

func TestFTSSearchRanksMatchingEntriesWhenAvailable(t *testing.T) {
	store, err := Open(t.TempDir(), true)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	if _, err := store.Save(Entry{ID: "weak", Content: "alpha", Importance: 1, Trust: TrustTrusted, IsLatest: true}); err != nil {
		t.Fatalf("Save weak: %v", err)
	}
	if _, err := store.Save(Entry{ID: "strong", Content: strings.Repeat("alpha ", 8), Importance: 1, Trust: TrustTrusted, IsLatest: true}); err != nil {
		t.Fatalf("Save strong: %v", err)
	}
	got, err := store.Search("alpha", 2)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("search returned %#v", got)
	}
	if store.FTSEnabled() && got[0].ID != "strong" {
		t.Fatalf("FTS ranking did not prefer stronger match: %#v", got)
	}
}

func TestSecretLikeContentIsRedactedBeforeStorage(t *testing.T) {
	store, err := Open(t.TempDir(), true)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	entry, err := store.Save(Entry{Content: "api_key=supersecretvalue", Trust: TrustTrusted})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if strings.Contains(entry.Content, "supersecretvalue") {
		t.Fatalf("stored secret-like content: %#v", entry)
	}
}

func TestSearchEntriesDoesNotRecordAccess(t *testing.T) {
	store, err := Open(t.TempDir(), true)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	if _, err := store.Save(Entry{ID: "stable", Content: "stable read path", Trust: TrustTrusted, IsLatest: true}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := store.Search("stable", 10); err != nil {
		t.Fatalf("Search: %v", err)
	}
	entry, err := store.Get("stable")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if entry.AccessCount != 0 || entry.LastAccessedAt != "" {
		t.Fatalf("read path updated access metadata: access=%d last=%q", entry.AccessCount, entry.LastAccessedAt)
	}
}

func TestDisabledStoreBlocksReadsAndWritesButAllowsClear(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root, true)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, err := store.Save(Entry{ID: "disabled", Content: "disabled memory", Trust: TrustTrusted, IsLatest: true}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := store.SetEnabled(false); err != nil {
		t.Fatalf("SetEnabled: %v", err)
	}
	if _, err := store.Search("disabled", 10); err != ErrDisabled {
		t.Fatalf("Search disabled error = %v, want ErrDisabled", err)
	}
	if _, err := store.Save(Entry{Content: "new memory"}); err != ErrDisabled {
		t.Fatalf("Save disabled error = %v, want ErrDisabled", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("Clear while disabled: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}
