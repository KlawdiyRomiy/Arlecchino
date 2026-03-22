package brain

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStubProvider_LoadStubs(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	stubsDir := filepath.Join(homeDir, ".arlecchino", "stubs")

	if _, err := os.Stat(stubsDir); os.IsNotExist(err) {
		t.Skip("No stubs directory found, skipping test")
	}

	provider := NewStubProvider()
	err := provider.LoadStubs()
	if err != nil {
		t.Fatalf("Failed to load stubs: %v", err)
	}

	stats := provider.Stats()
	t.Logf("Loaded stubs: %+v", stats)

	if len(stats) == 0 {
		t.Log("No stubs loaded (directory may be empty)")
	}
}

func TestStubProvider_GetCompletions(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	stubsDir := filepath.Join(homeDir, ".arlecchino", "stubs")

	if _, err := os.Stat(stubsDir); os.IsNotExist(err) {
		t.Skip("No stubs directory found, skipping test")
	}

	provider := NewStubProvider()
	provider.LoadStubs()

	tests := []struct {
		name     string
		pkg      string
		prefix   string
		language string
		wantMin  int
	}{
		{"axios get", "axios", "ge", "javascript", 1},
		{"axios all", "axios", "", "javascript", 5},
		{"requests get", "requests", "ge", "python", 1},
		{"gin Default", "gin", "De", "go", 1},
		{"unknown package", "unknown", "", "javascript", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			suggestions := provider.GetCompletions(tt.pkg, tt.prefix, tt.language)
			if len(suggestions) < tt.wantMin {
				t.Errorf("GetCompletions(%s, %s, %s) got %d suggestions, want at least %d",
					tt.pkg, tt.prefix, tt.language, len(suggestions), tt.wantMin)
			}
			for _, s := range suggestions {
				t.Logf("  - %s (%s) score=%.2f", s.Text, s.Kind, s.Score)
			}
		})
	}
}

func TestStubProvider_HasPackage(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	stubsDir := filepath.Join(homeDir, ".arlecchino", "stubs")

	if _, err := os.Stat(stubsDir); os.IsNotExist(err) {
		t.Skip("No stubs directory found, skipping test")
	}

	provider := NewStubProvider()
	provider.LoadStubs()

	tests := []struct {
		pkg      string
		language string
		want     bool
	}{
		{"axios", "javascript", true},
		{"requests", "python", true},
		{"gin", "go", true},
		{"unknown", "javascript", false},
	}

	for _, tt := range tests {
		t.Run(tt.pkg+"/"+tt.language, func(t *testing.T) {
			got := provider.HasPackage(tt.pkg, tt.language)
			if got != tt.want {
				t.Errorf("HasPackage(%s, %s) = %v, want %v", tt.pkg, tt.language, got, tt.want)
			}
		})
	}
}
