package plugins

import (
	"sync"
	"time"
)

// CommandDef represents a terminal command definition
type CommandDef struct {
	Prefix      string    `json:"prefix"`      // "artisan", "composer", "git", "manage.py", "rails"
	Name        string    `json:"name"`        // Command name (e.g., "make:model", "require", "checkout")
	Description string    `json:"description"` // Human-readable description
	OutputKind  string    `json:"outputKind"`  // What kind of file/entity this creates (e.g., "model", "controller")
	PathPattern string    `json:"pathPattern"` // Template for output path (e.g., "app/Models/{name}.php")
	Namespace   string    `json:"namespace"`   // Default namespace for created files
	Flags       []FlagDef `json:"flags"`       // Available flags/options
}

// FlagDef represents a command flag/option
type FlagDef struct {
	Name        string `json:"name"`        // Long name (e.g., "--migration")
	Short       string `json:"short"`       // Short name (e.g., "-m")
	Description string `json:"description"` // What the flag does
	HasValue    bool   `json:"hasValue"`    // Whether flag takes a value
}

// CommandRegistry holds all commands for a plugin
type CommandRegistry struct {
	mu       sync.RWMutex
	commands map[string]*CommandDef
}

// NewCommandRegistry creates a new empty command registry
func NewCommandRegistry() *CommandRegistry {
	return &CommandRegistry{
		commands: make(map[string]*CommandDef),
	}
}

// Register adds a command to the registry
func (r *CommandRegistry) Register(cmd *CommandDef) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.commands[cmd.Name] = cmd
}

// Get returns a command by name
func (r *CommandRegistry) Get(name string) *CommandDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.commands[name]
}

// All returns all registered commands
func (r *CommandRegistry) All() []*CommandDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]*CommandDef, 0, len(r.commands))
	for _, cmd := range r.commands {
		result = append(result, cmd)
	}
	return result
}

// ByPrefix returns commands matching a specific prefix
func (r *CommandRegistry) ByPrefix(prefix string) []*CommandDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []*CommandDef
	for _, cmd := range r.commands {
		if cmd.Prefix == prefix {
			result = append(result, cmd)
		}
	}
	return result
}

// Match returns commands containing the input string (case-insensitive)
func (r *CommandRegistry) Match(input string) []*CommandDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var matches []*CommandDef
	inputLower := toLower(input)
	for _, cmd := range r.commands {
		if containsIgnoreCase(cmd.Name, inputLower) {
			matches = append(matches, cmd)
		}
	}
	return matches
}

// MatchPrefix returns commands starting with the input (case-insensitive)
func (r *CommandRegistry) MatchPrefix(input string) []*CommandDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var matches []*CommandDef
	inputLower := toLower(input)
	for _, cmd := range r.commands {
		if hasPrefix(toLower(cmd.Name), inputLower) {
			matches = append(matches, cmd)
		}
	}
	return matches
}

// MatchByPrefix returns commands of a specific prefix starting with input
func (r *CommandRegistry) MatchByPrefix(cmdPrefix, input string) []*CommandDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var matches []*CommandDef
	inputLower := toLower(input)
	for _, cmd := range r.commands {
		if cmd.Prefix == cmdPrefix && hasPrefix(toLower(cmd.Name), inputLower) {
			matches = append(matches, cmd)
		}
	}
	return matches
}

// Merge adds all commands from another registry
func (r *CommandRegistry) Merge(other *CommandRegistry) {
	if other == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	other.mu.RLock()
	defer other.mu.RUnlock()
	for name, cmd := range other.commands {
		r.commands[name] = cmd
	}
}

// PendingEntry represents a predicted file/entity that will be created
type PendingEntry struct {
	ID        string
	ProjectID string
	Kind      string // model, controller, migration, etc.
	Name      string
	Namespace string
	FilePath  string
	Extra     map[string]string
	CreatedAt time.Time
}

// Helper functions
func containsIgnoreCase(s, substr string) bool {
	return contains(toLower(s), substr)
}

func hasPrefix(s, prefix string) bool {
	if len(prefix) > len(s) {
		return false
	}
	return s[:len(prefix)] == prefix
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		} else {
			b[i] = c
		}
	}
	return string(b)
}

func contains(s, substr string) bool {
	if len(substr) > len(s) {
		return false
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
