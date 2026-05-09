package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewStore_QuarantinesCorruptDatabase(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "brain.db")
	if err := os.WriteFile(dbPath, []byte("not sqlite"), 0644); err != nil {
		t.Fatalf("write corrupt db: %v", err)
	}

	store, err := NewStore(dbPath, "project")
	if err != nil {
		t.Fatalf("NewStore recovered corrupt db: %v", err)
	}
	sqlDB, err := store.db.DB()
	if err != nil {
		t.Fatalf("db handle: %v", err)
	}
	defer sqlDB.Close()

	if err := store.SaveSymbols([]Symbol{{
		Name:     "main",
		Kind:     SymbolKindFunction,
		Language: "go",
		FilePath: filepath.Join(dir, "main.go"),
		Line:     1,
	}}); err != nil {
		t.Fatalf("SaveSymbols after recovery: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	foundQuarantine := false
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "brain.db.corrupt-") {
			foundQuarantine = true
			break
		}
	}
	if !foundQuarantine {
		t.Fatalf("corrupt db was not quarantined; entries=%v", entries)
	}
}
