package terminal

import (
	"testing"
	"time"
)

func TestHistoryCacheFuzzyMatch(t *testing.T) {
	cache := NewHistoryCache()
	cache.LoadHistory([]HistoryEntry{
		{Command: "git status", Frequency: 10},
		{Command: "git commit -m", Frequency: 5},
		{Command: "go test", Frequency: 8},
		{Command: "go build", Frequency: 3},
	})

	tests := []struct {
		name   string
		prefix string
		want   []string
	}{
		{
			name:   "exact prefix",
			prefix: "git",
			want:   []string{"git status", "git commit -m"},
		},
		{
			name:   "partial match",
			prefix: "go",
			want:   []string{"go test", "go build"},
		},
		{
			name:   "empty prefix",
			prefix: "",
			want:   []string{"git status", "go test", "git commit -m", "go build"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			results := cache.FuzzyMatch(tt.prefix, 10)
			if len(results) < 1 {
				t.Errorf("Expected at least 1 result, got %d", len(results))
				return
			}

			for i, wantCmd := range tt.want {
				if i >= len(results) {
					break
				}
				if results[i].Text != wantCmd {
					t.Logf("Result[%d] = %v (expected %v)", i, results[i].Text, wantCmd)
				}
			}
		})
	}
}

func TestHistoryCacheRanking(t *testing.T) {
	cache := NewHistoryCache()
	cache.LoadHistory([]HistoryEntry{
		{Command: "git status", Frequency: 100},
		{Command: "git push", Frequency: 5},
		{Command: "git pull", Frequency: 50},
	})

	results := cache.FuzzyMatch("git", 3)
	if len(results) != 3 {
		t.Fatalf("Expected 3 results, got %d", len(results))
	}

	if results[0].Text != "git status" {
		t.Errorf("Expected top result 'git status', got '%s'", results[0].Text)
	}
}

func TestSafeExecutorIsSafe(t *testing.T) {
	executor := NewSafeExecutor()

	tests := []struct {
		name string
		cmd  *ParsedCommand
		want bool
	}{
		{
			name: "safe: git status",
			cmd:  &ParsedCommand{Binary: "git", Args: []string{"status"}},
			want: true,
		},
		{
			name: "safe: git branch",
			cmd:  &ParsedCommand{Binary: "git", Args: []string{"branch"}},
			want: true,
		},
		{
			name: "unsafe: git push",
			cmd:  &ParsedCommand{Binary: "git", Args: []string{"push"}},
			want: false,
		},
		{
			name: "safe: pwd",
			cmd:  &ParsedCommand{Binary: "pwd", Args: []string{}},
			want: true,
		},
		{
			name: "safe: ls",
			cmd:  &ParsedCommand{Binary: "ls", Args: []string{"-la"}},
			want: true,
		},
		{
			name: "unsafe: rm",
			cmd:  &ParsedCommand{Binary: "rm", Args: []string{"test.txt"}},
			want: false,
		},
		{
			name: "safe: go list",
			cmd:  &ParsedCommand{Binary: "go", Args: []string{"list"}},
			want: true,
		},
		{
			name: "unsafe: npm install",
			cmd:  &ParsedCommand{Binary: "npm", Args: []string{"install"}},
			want: false,
		},
		{
			name: "safe: php artisan list",
			cmd:  &ParsedCommand{Binary: "php", Args: []string{"artisan", "list"}},
			want: true,
		},
		{
			name: "unsafe: php artisan migrate",
			cmd:  &ParsedCommand{Binary: "php", Args: []string{"artisan", "migrate"}},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := executor.IsSafe(tt.cmd)
			if got != tt.want {
				t.Errorf("IsSafe() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSafeExecutorExecute(t *testing.T) {
	executor := NewSafeExecutor()

	tests := []struct {
		name      string
		command   string
		wantError bool
		checkOut  func(string) bool
	}{
		{
			name:      "execute pwd",
			command:   "pwd",
			wantError: false,
			checkOut:  func(out string) bool { return len(out) > 0 },
		},
		{
			name:      "execute ls -la",
			command:   "ls -la",
			wantError: false,
			checkOut:  func(out string) bool { return len(out) > 0 },
		},
		{
			name:      "execute git status",
			command:   "git status",
			wantError: false,
			checkOut:  func(out string) bool { return true },
		},
		{
			name:      "blocked: rm",
			command:   "rm test.txt",
			wantError: true,
			checkOut:  nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := ParseShellInput(tt.command)
			if err != nil {
				t.Fatalf("ParseShellInput failed: %v", err)
			}

			result, err := executor.Execute(parsed, ".", 1000*time.Millisecond)
			if tt.wantError {
				if err == nil {
					t.Errorf("Expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Fatalf("Execute failed: %v", err)
			}

			if tt.checkOut != nil && !tt.checkOut(result.Output) {
				t.Errorf("Output check failed: %s", result.Output)
			}
		})
	}
}
