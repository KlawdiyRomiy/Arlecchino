package plugins

import (
	"sync"

	"arlecchino/internal/indexer/core"
)

// Plugin defines the interface for IDE plugins
type Plugin interface {
	// Name returns the plugin identifier
	Name() string

	// Init initializes the plugin for a project
	Init(projectPath string) error

	// Close releases plugin resources
	Close()

	// IsApplicable checks if this plugin should be used for the project
	IsApplicable(projectPath string) bool

	// GetAdapter returns the language adapter for indexing (optional)
	GetAdapter() core.LanguageAdapter

	// OnFileChanged handles file change events
	OnFileChanged(path string, content []byte)

	// OnFileSaved handles file save events
	OnFileSaved(path string)
}

// TerminalPlugin extends Plugin with terminal command support
type TerminalPlugin interface {
	Plugin

	// ParseCommand parses terminal input for command suggestions
	ParseCommand(input string) *ParsedCommand

	// SuggestCommand returns command suggestions for input
	SuggestCommand(input string) []CommandSuggestion

	// UpdatePrediction updates pending predictions based on input
	UpdatePrediction(input string)

	// ConfirmPrediction confirms that a command was executed
	ConfirmPrediction(input string)

	// CancelPrediction cancels current predictions
	CancelPrediction()

	// GetPendingEntry returns a pending entry by name (for terminal ghost predict)
	GetPendingEntry(name string) *PendingEntry

	// SearchPending searches pending entries by prefix
	SearchPending(prefix string) []*PendingEntry

	// SearchClasses searches all classes (both pending and indexed) by prefix
	SearchClasses(prefix string) []ClassResult
}

// CommandsProvider extends Plugin with command registry exposure.
type CommandsProvider interface {
	Plugin
	Commands() *CommandRegistry
}

// ClassResult represents a class search result from plugin
type ClassResult struct {
	Name      string
	Kind      string
	Namespace string
	FilePath  string
	Line      int
	Pending   bool
}

// ParsedCommand represents a parsed terminal command
type ParsedCommand struct {
	Valid    bool
	Prefix   string            // artisan, composer, git
	Command  string            // make:model, require, etc.
	Argument string            // Model name, package name
	Flags    map[string]string // --flag=value
}

// CommandSuggestion represents a command completion suggestion
type CommandSuggestion struct {
	Text        string
	Description string
	Kind        string // command, flag, argument
}

// ProjectCreator extends Plugin with project creation capability
type ProjectCreator interface {
	Plugin

	// CreateProject creates a new project of this framework type
	CreateProject(name string, directory string) (string, error)
}

// Registry holds all registered plugins
type Registry struct {
	plugins []Plugin
	mu      sync.RWMutex
	cache   map[applicabilityCacheKey]bool
}

type applicabilityCacheKey struct {
	projectPath string
	pluginName  string
}

// NewRegistry creates a new plugin registry
func NewRegistry() *Registry {
	return &Registry{
		plugins: make([]Plugin, 0),
		cache:   make(map[applicabilityCacheKey]bool),
	}
}

// Register adds a plugin to the registry
func (r *Registry) Register(p Plugin) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.plugins = append(r.plugins, p)
}

// Get returns a plugin by name
func (r *Registry) Get(name string) Plugin {
	for _, p := range r.pluginsSnapshot() {
		if p.Name() == name {
			return p
		}
	}
	return nil
}

// GetApplicable returns plugins applicable to the project
func (r *Registry) GetApplicable(projectPath string) []Plugin {
	return r.applicablePlugins(projectPath)
}

// All returns all registered plugins
func (r *Registry) All() []Plugin {
	return r.pluginsSnapshot()
}

// DetectFramework returns the first specific applicable framework by registration order,
// falling back to common when no specific framework matches.
func (r *Registry) DetectFramework(projectPath string) string {
	fallback := ""
	for _, p := range r.applicablePlugins(projectPath) {
		if p.Name() == "common" {
			if fallback == "" {
				fallback = p.Name()
			}
			continue
		}
		return p.Name()
	}
	return fallback
}

// InitAll initializes all applicable plugins
func (r *Registry) InitAll(projectPath string) error {
	for _, p := range r.applicablePlugins(projectPath) {
		if err := p.Init(projectPath); err != nil {
			return err
		}
	}
	return nil
}

// CloseAll closes all plugins
func (r *Registry) CloseAll() {
	r.mu.Lock()
	clear(r.cache)
	plugins := append([]Plugin(nil), r.plugins...)
	r.mu.Unlock()

	for _, p := range plugins {
		p.Close()
	}
}

// GetTerminalPlugin returns the first applicable terminal plugin for the project
func (r *Registry) GetTerminalPlugin(projectPath string) TerminalPlugin {
	for _, p := range r.applicablePlugins(projectPath) {
		if tp, ok := p.(TerminalPlugin); ok {
			return tp
		}
	}
	return nil
}

// GetProjectCreator returns the project creator for the given framework
func (r *Registry) GetProjectCreator(framework string) ProjectCreator {
	for _, p := range r.pluginsSnapshot() {
		if p.Name() == framework {
			if pc, ok := p.(ProjectCreator); ok {
				return pc
			}
		}
	}
	return nil
}

// GetAllTerminalPlugins returns all applicable terminal plugins
func (r *Registry) GetAllTerminalPlugins(projectPath string) []TerminalPlugin {
	var result []TerminalPlugin
	for _, p := range r.applicablePlugins(projectPath) {
		if tp, ok := p.(TerminalPlugin); ok {
			result = append(result, tp)
		}
	}
	return result
}

// SuggestCommand aggregates command suggestions from all applicable terminal plugins
func (r *Registry) SuggestCommand(projectPath, input string) []CommandSuggestion {
	var suggestions []CommandSuggestion
	for _, tp := range r.GetAllTerminalPlugins(projectPath) {
		suggestions = append(suggestions, tp.SuggestCommand(input)...)
	}
	return suggestions
}

// ParseCommand parses input using the first applicable terminal plugin that returns a valid result.
func (r *Registry) ParseCommand(projectPath, input string) *ParsedCommand {
	for _, tp := range r.GetAllTerminalPlugins(projectPath) {
		parsed := tp.ParseCommand(input)
		if parsed != nil && parsed.Valid {
			return parsed
		}
	}
	return nil
}

// UpdatePrediction updates predictions on all applicable terminal plugins
func (r *Registry) UpdatePrediction(projectPath, input string) {
	for _, tp := range r.GetAllTerminalPlugins(projectPath) {
		tp.UpdatePrediction(input)
	}
}

// ConfirmPrediction confirms prediction on all applicable terminal plugins
func (r *Registry) ConfirmPrediction(projectPath, input string) {
	for _, tp := range r.GetAllTerminalPlugins(projectPath) {
		tp.ConfirmPrediction(input)
	}
}

// CancelPrediction cancels prediction on all applicable terminal plugins
func (r *Registry) CancelPrediction(projectPath string) {
	for _, tp := range r.GetAllTerminalPlugins(projectPath) {
		tp.CancelPrediction()
	}
}

// GetPendingEntry returns a pending entry by name from the first matching plugin
func (r *Registry) GetPendingEntry(projectPath, name string) *PendingEntry {
	for _, tp := range r.GetAllTerminalPlugins(projectPath) {
		if entry := tp.GetPendingEntry(name); entry != nil {
			return entry
		}
	}
	return nil
}

// SearchPending aggregates pending entries from all applicable terminal plugins
func (r *Registry) SearchPending(projectPath, prefix string) []*PendingEntry {
	var result []*PendingEntry
	for _, tp := range r.GetAllTerminalPlugins(projectPath) {
		result = append(result, tp.SearchPending(prefix)...)
	}
	return result
}

// SearchClasses aggregates class search results from all applicable terminal plugins
func (r *Registry) SearchClasses(projectPath, prefix string) []ClassResult {
	var result []ClassResult
	for _, tp := range r.GetAllTerminalPlugins(projectPath) {
		result = append(result, tp.SearchClasses(prefix)...)
	}
	return result
}

// GetAllCommands aggregates command definitions from all applicable command providers.
func (r *Registry) GetAllCommands(projectPath string) []*CommandDef {
	result := NewCommandRegistry()
	for _, p := range r.applicablePlugins(projectPath) {
		provider, ok := p.(CommandsProvider)
		if !ok {
			continue
		}
		result.Merge(provider.Commands())
	}
	return result.All()
}

func (r *Registry) applicablePlugins(projectPath string) []Plugin {
	plugins := r.pluginsSnapshot()
	result := make([]Plugin, 0, len(plugins))
	for _, p := range plugins {
		if r.isApplicableCached(p, projectPath) {
			result = append(result, p)
		}
	}
	return result
}

func (r *Registry) isApplicableCached(p Plugin, projectPath string) bool {
	key := applicabilityCacheKey{projectPath: projectPath, pluginName: p.Name()}

	r.mu.RLock()
	applicable, ok := r.cache[key]
	r.mu.RUnlock()
	if ok {
		return applicable
	}

	applicable = p.IsApplicable(projectPath)

	r.mu.Lock()
	if cached, ok := r.cache[key]; ok {
		r.mu.Unlock()
		return cached
	}
	r.cache[key] = applicable
	r.mu.Unlock()

	return applicable
}

func (r *Registry) pluginsSnapshot() []Plugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	plugins := make([]Plugin, len(r.plugins))
	copy(plugins, r.plugins)
	return plugins
}
