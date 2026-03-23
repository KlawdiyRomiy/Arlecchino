package common

import (
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/plugins"
)

// Plugin provides common commands available across all projects (git)
type Plugin struct {
	projectPath string
	registry    *plugins.CommandRegistry
	initialized bool
}

// New creates a new common plugin
func New() *Plugin {
	p := &Plugin{
		registry: plugins.NewCommandRegistry(),
	}
	p.registerGitCommands()
	return p
}

// Name returns the plugin identifier
func (p *Plugin) Name() string {
	return "common"
}

// Init initializes the plugin for a project
func (p *Plugin) Init(projectPath string) error {
	p.projectPath = projectPath
	p.initialized = true
	return nil
}

// Close releases plugin resources
func (p *Plugin) Close() {
	p.initialized = false
}

// IsApplicable - common plugin is always applicable
func (p *Plugin) IsApplicable(projectPath string) bool {
	return true
}

// GetAdapter returns nil - common plugin doesn't provide language adapters
func (p *Plugin) GetAdapter() core.LanguageAdapter {
	return nil
}

// OnFileChanged handles file change events
func (p *Plugin) OnFileChanged(path string, content []byte) {
	// Common plugin doesn't need file change notifications
}

// OnFileSaved handles file save events
func (p *Plugin) OnFileSaved(path string) {
	// Common plugin doesn't need file save notifications
}

// Commands returns the command registry
func (p *Plugin) Commands() *plugins.CommandRegistry {
	return p.registry
}

// Ensure Plugin implements the interface
var _ plugins.Plugin = (*Plugin)(nil)
