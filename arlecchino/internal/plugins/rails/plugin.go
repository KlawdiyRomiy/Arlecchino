package rails

import (
	"os"
	"path/filepath"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/plugins"
)

// Plugin implements Ruby on Rails-specific IDE features
// This is a stub implementation for future development
type Plugin struct {
	projectPath string
	registry    *plugins.CommandRegistry
	initialized bool
}

// New creates a new Rails plugin
func New() *Plugin {
	p := &Plugin{
		registry: plugins.NewCommandRegistry(),
	}
	p.registerRailsCommands()
	return p
}

// Name returns the plugin identifier
func (p *Plugin) Name() string {
	return "rails"
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

// IsApplicable checks if this is a Rails project
func (p *Plugin) IsApplicable(projectPath string) bool {
	// Check for Gemfile with rails
	gemfilePath := filepath.Join(projectPath, "Gemfile")
	if _, err := os.Stat(gemfilePath); err == nil {
		content, err := os.ReadFile(gemfilePath)
		if err == nil && containsRails(content) {
			return true
		}
	}

	// Check for config/application.rb (Rails marker)
	appPath := filepath.Join(projectPath, "config", "application.rb")
	if _, err := os.Stat(appPath); err == nil {
		return true
	}

	// Check for bin/rails
	binPath := filepath.Join(projectPath, "bin", "rails")
	if _, err := os.Stat(binPath); err == nil {
		return true
	}

	return false
}

// GetAdapter returns nil - Rails adapter not yet implemented
func (p *Plugin) GetAdapter() core.LanguageAdapter {
	return nil
}

// OnFileChanged handles file change events
func (p *Plugin) OnFileChanged(path string, content []byte) {
	// Not implemented yet
}

// OnFileSaved handles file save events
func (p *Plugin) OnFileSaved(path string) {
	// Not implemented yet
}

// Commands returns the command registry for this plugin
func (p *Plugin) Commands() *plugins.CommandRegistry {
	return p.registry
}

// registerRailsCommands registers Rails CLI commands
func (p *Plugin) registerRailsCommands() {
	// Server
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "server",
		Description: "Start the Rails server",
		Flags: []plugins.FlagDef{
			{Name: "-p", HasValue: true, Description: "Port number"},
			{Name: "-b", HasValue: true, Description: "Bind address"},
			{Name: "-e", HasValue: true, Description: "Environment"},
			{Name: "-d", Description: "Run as daemon"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "s",
		Description: "Start the Rails server (alias)",
	})

	// Console
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "console",
		Description: "Start Rails console",
		Flags: []plugins.FlagDef{
			{Name: "-e", HasValue: true, Description: "Environment"},
			{Name: "--sandbox", Description: "Rollback changes on exit"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "c",
		Description: "Start Rails console (alias)",
	})

	// Generate commands
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate",
		Description: "Run a generator",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "g",
		Description: "Run a generator (alias)",
	})

	// Model generator
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate model",
		Description: "Generate a model",
		OutputKind:  "model",
		PathPattern: "app/models/{name}.rb",
		Flags: []plugins.FlagDef{
			{Name: "--skip-migration", Description: "Skip migration"},
			{Name: "--skip-test", Description: "Skip tests"},
		},
	})

	// Controller generator
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate controller",
		Description: "Generate a controller",
		OutputKind:  "controller",
		PathPattern: "app/controllers/{name}_controller.rb",
		Flags: []plugins.FlagDef{
			{Name: "--skip-routes", Description: "Skip routes"},
			{Name: "--skip-helper", Description: "Skip helper"},
			{Name: "--skip-test", Description: "Skip tests"},
		},
	})

	// Migration generator
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate migration",
		Description: "Generate a migration",
		OutputKind:  "migration",
		PathPattern: "db/migrate/{timestamp}_{name}.rb",
	})

	// Scaffold generator
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate scaffold",
		Description: "Generate scaffold (model, controller, views)",
		OutputKind:  "scaffold",
		Flags: []plugins.FlagDef{
			{Name: "--api", Description: "API only scaffold"},
			{Name: "--skip-migration", Description: "Skip migration"},
		},
	})

	// Resource generator
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate resource",
		Description: "Generate resource (model, controller, routes)",
		OutputKind:  "resource",
	})

	// Mailer generator
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate mailer",
		Description: "Generate a mailer",
		OutputKind:  "mailer",
		PathPattern: "app/mailers/{name}_mailer.rb",
	})

	// Job generator
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate job",
		Description: "Generate a job",
		OutputKind:  "job",
		PathPattern: "app/jobs/{name}_job.rb",
	})

	// Channel generator (Action Cable)
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "generate channel",
		Description: "Generate a channel",
		OutputKind:  "channel",
		PathPattern: "app/channels/{name}_channel.rb",
	})

	// Database commands
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "db:migrate",
		Description: "Run pending migrations",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "db:rollback",
		Description: "Rollback last migration",
		Flags: []plugins.FlagDef{
			{Name: "STEP", HasValue: true, Description: "Number of steps"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "db:seed",
		Description: "Load seed data",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "db:create",
		Description: "Create database",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "db:drop",
		Description: "Drop database",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "db:reset",
		Description: "Drop, create and migrate database",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "db:setup",
		Description: "Create database, load schema, seed",
	})

	// Routes
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "routes",
		Description: "Show all routes",
		Flags: []plugins.FlagDef{
			{Name: "-g", HasValue: true, Description: "Grep pattern"},
			{Name: "-c", HasValue: true, Description: "Filter by controller"},
		},
	})

	// Test
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "test",
		Description: "Run tests",
		Flags: []plugins.FlagDef{
			{Name: "-v", Description: "Verbose output"},
			{Name: "-n", HasValue: true, Description: "Run specific test"},
		},
	})

	// Destroy (undo generate)
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "destroy",
		Description: "Undo a generator",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "d",
		Description: "Undo a generator (alias)",
	})

	// Runner
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "runner",
		Description: "Run Ruby code in Rails context",
		Flags: []plugins.FlagDef{
			{Name: "-e", HasValue: true, Description: "Environment"},
		},
	})

	// Assets
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "assets:precompile",
		Description: "Compile assets",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "assets:clean",
		Description: "Remove compiled assets",
	})

	// Credentials
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "credentials:edit",
		Description: "Edit encrypted credentials",
		Flags: []plugins.FlagDef{
			{Name: "-e", HasValue: true, Description: "Environment"},
		},
	})

	// New app
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "rails",
		Name:        "new",
		Description: "Create a new Rails application",
		Flags: []plugins.FlagDef{
			{Name: "--api", Description: "API only mode"},
			{Name: "--database", Short: "-d", HasValue: true, Description: "Database adapter"},
			{Name: "--skip-bundle", Description: "Skip bundle install"},
			{Name: "--skip-git", Description: "Skip git init"},
			{Name: "--skip-test", Description: "Skip test files"},
		},
	})
}

func containsRails(content []byte) bool {
	return len(content) > 0 && (containsBytes(content, []byte("'rails'")) ||
		containsBytes(content, []byte("\"rails\"")) ||
		containsBytes(content, []byte("gem 'rails'")))
}

func containsBytes(content, substr []byte) bool {
	if len(substr) > len(content) {
		return false
	}
	for i := 0; i <= len(content)-len(substr); i++ {
		match := true
		for j := 0; j < len(substr); j++ {
			if content[i+j] != substr[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

// Ensure Plugin implements the interface
var _ plugins.Plugin = (*Plugin)(nil)
