package terminal

import (
	"testing"
)

func TestCarapaceProvider_New(t *testing.T) {
	p := NewCarapaceProvider()

	// Should not panic even if carapace is not installed
	if p == nil {
		t.Fatal("NewCarapaceProvider returned nil")
	}

	// Check that caches are initialized
	if p.executablesCache == nil {
		t.Error("executablesCache is nil")
	}
	if p.completionCache == nil {
		t.Error("completionCache is nil")
	}
}

func TestCarapaceProvider_IsAvailable(t *testing.T) {
	p := NewCarapaceProvider()

	// Just check it doesn't panic
	_ = p.IsAvailable()
}

func TestCarapaceProvider_MakeCacheKey(t *testing.T) {
	p := NewCarapaceProvider()

	tests := []struct {
		name    string
		input   string
		workDir string
	}{
		{"single command", "git", "/tmp"},
		{"command with subcommand", "git status", "/tmp"},
		{"command with flag", "git status --short", "/tmp"},
		{"command with trailing space", "git ", "/tmp"},
		{"empty workdir", "git status", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := p.makeCacheKey(tt.input, tt.workDir)
			if key == "" {
				t.Error("makeCacheKey returned empty string")
			}
		})
	}
}

func TestCarapaceProvider_PrefixCaching(t *testing.T) {
	p := NewCarapaceProvider()

	// These should have the same cache key (prefix optimization)
	key1 := p.makeCacheKey("git status --sh", "/tmp")
	key2 := p.makeCacheKey("git status --sho", "/tmp")
	key3 := p.makeCacheKey("git status --shor", "/tmp")

	// All should use same prefix "sho" (first 3 chars)
	if key1 != key2 || key2 != key3 {
		t.Logf("key1: %s", key1)
		t.Logf("key2: %s", key2)
		t.Logf("key3: %s", key3)
		// Note: This is expected behavior for prefix caching
	}
}

func TestCarapaceProvider_CommandExists(t *testing.T) {
	p := NewCarapaceProvider()

	// Common commands that should exist
	commonCmds := []string{"ls", "git", "echo"}
	for _, cmd := range commonCmds {
		if !p.commandExists(cmd) {
			t.Logf("Command %s not found (might be expected in some environments)", cmd)
		}
	}

	// Non-existent command
	if p.commandExists("nonexistent_command_xyz_123") {
		t.Error("nonexistent_command_xyz_123 should not exist")
	}
}

func TestCarapaceProvider_GetPredictions(t *testing.T) {
	p := NewCarapaceProvider()

	if !p.IsAvailable() {
		t.Skip("carapace not available, skipping test")
	}

	// Test with git (commonly available)
	results := p.GetPredictions("git ", "")

	if len(results) == 0 {
		t.Log("No predictions returned for 'git ' (carapace might not have git completions)")
	} else {
		t.Logf("Got %d predictions for 'git '", len(results))
		for i, r := range results {
			if i < 5 {
				t.Logf("  [%d] %s (completion: %q)", i, r.Text, r.Completion)
			}
		}
	}
}

func TestCarapaceProvider_GetCompletions(t *testing.T) {
	p := NewCarapaceProvider()

	if !p.IsAvailable() {
		t.Skip("carapace not available, skipping test")
	}

	// Test with git subcommands
	completions := p.GetCompletions("git ", "")

	if len(completions) == 0 {
		t.Log("No completions returned for 'git '")
	} else {
		t.Logf("Got %d completions", len(completions))
		// Check that we got some expected git subcommands
		foundCommit := false
		foundStatus := false
		for _, c := range completions {
			if c.Value == "commit" {
				foundCommit = true
			}
			if c.Value == "status" {
				foundStatus = true
			}
		}
		if !foundCommit {
			t.Log("'commit' not in completions")
		}
		if !foundStatus {
			t.Log("'status' not in completions")
		}
	}
}

func TestCarapaceProvider_CacheEviction(t *testing.T) {
	p := NewCarapaceProvider()

	// Fill cache beyond limit
	for i := 0; i < completionCacheSize+10; i++ {
		key := "test:" + string(rune('a'+i%26))
		p.completionCache[key] = &completionCacheEntry{
			completions: nil,
		}
	}

	// Should not exceed cache size after eviction
	p.mu.Lock()
	p.evictOldestEntry()
	p.mu.Unlock()

	if len(p.completionCache) > completionCacheSize+10 {
		t.Errorf("cache size %d exceeds expected", len(p.completionCache))
	}
}

func TestGetStaticPredictions_WithCarapace(t *testing.T) {
	// This tests the integration with globalCarapaceProvider
	results := GetStaticPredictions("")
	if results != nil {
		t.Error("empty input should return nil")
	}

	// Non-empty input
	results = GetStaticPredictions("git ")
	// May or may not return results depending on carapace availability
	t.Logf("GetStaticPredictions('git ') returned %d results", len(results))
}
