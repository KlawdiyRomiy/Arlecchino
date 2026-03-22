package django

import (
	"os"
	"path/filepath"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/plugins"
)

// Plugin implements Django-specific IDE features
// This is a stub implementation for future development
type Plugin struct {
	projectPath string
	registry    *plugins.CommandRegistry
	initialized bool
}

// New creates a new Django plugin
func New() *Plugin {
	p := &Plugin{
		registry: plugins.NewCommandRegistry(),
	}
	p.registerManageCommands()
	return p
}

// Name returns the plugin identifier
func (p *Plugin) Name() string {
	return "django"
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

// IsApplicable checks if this is a Django project
func (p *Plugin) IsApplicable(projectPath string) bool {
	// Check for manage.py file (Django marker)
	managePath := filepath.Join(projectPath, "manage.py")
	if _, err := os.Stat(managePath); err == nil {
		return true
	}

	// Check for settings.py in typical locations
	settingsPaths := []string{
		filepath.Join(projectPath, "settings.py"),
		filepath.Join(projectPath, "config", "settings.py"),
	}
	for _, path := range settingsPaths {
		if _, err := os.Stat(path); err == nil {
			return true
		}
	}

	// Check for requirements.txt with Django
	reqPath := filepath.Join(projectPath, "requirements.txt")
	if _, err := os.Stat(reqPath); err == nil {
		content, err := os.ReadFile(reqPath)
		if err == nil && containsDjango(content) {
			return true
		}
	}

	return false
}

// GetAdapter returns nil - Django adapter not yet implemented
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

// registerManageCommands registers Django management commands
func (p *Plugin) registerManageCommands() {
	// Start development server
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "runserver",
		Description: "Start the development server",
		Flags: []plugins.FlagDef{
			{Name: "--noreload", Description: "Disable auto-reloader"},
			{Name: "--nothreading", Description: "Disable threading"},
			{Name: "--ipv6", Short: "-6", Description: "Use IPv6"},
		},
	})

	// Database commands
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "migrate",
		Description: "Apply database migrations",
		Flags: []plugins.FlagDef{
			{Name: "--fake", Description: "Mark migrations as applied"},
			{Name: "--fake-initial", Description: "Detect if initial applied"},
			{Name: "--plan", Description: "Show migration plan"},
			{Name: "--run-syncdb", Description: "Create tables for unmigrated apps"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "makemigrations",
		Description: "Create new migrations",
		OutputKind:  "migration",
		PathPattern: "{app}/migrations/{name}.py",
		Flags: []plugins.FlagDef{
			{Name: "--empty", Description: "Create empty migration"},
			{Name: "--dry-run", Description: "Show what would be created"},
			{Name: "--merge", Description: "Merge conflicting migrations"},
			{Name: "--name", Short: "-n", HasValue: true, Description: "Migration name"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "showmigrations",
		Description: "Show all migrations",
		Flags: []plugins.FlagDef{
			{Name: "--list", Short: "-l", Description: "List format"},
			{Name: "--plan", Short: "-p", Description: "Show plan"},
		},
	})

	// App creation
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "startapp",
		Description: "Create a new Django app",
		OutputKind:  "app",
		PathPattern: "{name}/",
	})

	// Shell commands
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "shell",
		Description: "Start interactive Python shell",
		Flags: []plugins.FlagDef{
			{Name: "--interface", Short: "-i", HasValue: true, Description: "Shell interface"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "dbshell",
		Description: "Start database shell",
	})

	// Testing
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "test",
		Description: "Run tests",
		Flags: []plugins.FlagDef{
			{Name: "--verbosity", Short: "-v", HasValue: true, Description: "Verbosity level"},
			{Name: "--failfast", Description: "Stop on first failure"},
			{Name: "--keepdb", Description: "Keep test database"},
			{Name: "--parallel", HasValue: true, Description: "Run in parallel"},
		},
	})

	// Static files
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "collectstatic",
		Description: "Collect static files",
		Flags: []plugins.FlagDef{
			{Name: "--noinput", Description: "No user prompts"},
			{Name: "--clear", Description: "Clear destination first"},
			{Name: "--link", Short: "-l", Description: "Create symlinks"},
			{Name: "--dry-run", Short: "-n", Description: "Dry run"},
		},
	})

	// User management
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "createsuperuser",
		Description: "Create a superuser",
		Flags: []plugins.FlagDef{
			{Name: "--username", HasValue: true, Description: "Username"},
			{Name: "--email", HasValue: true, Description: "Email"},
			{Name: "--noinput", Description: "No prompts"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "changepassword",
		Description: "Change user password",
	})

	// Cache
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "clearsessions",
		Description: "Clear expired sessions",
	})

	// Database inspection
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "inspectdb",
		Description: "Generate models from database",
		Flags: []plugins.FlagDef{
			{Name: "--database", HasValue: true, Description: "Database alias"},
			{Name: "--include-views", Description: "Include views"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "sqlmigrate",
		Description: "Show SQL for migration",
		Flags: []plugins.FlagDef{
			{Name: "--backwards", Description: "Show reverse SQL"},
		},
	})

	// Fixtures
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "loaddata",
		Description: "Load data from fixtures",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "dumpdata",
		Description: "Dump data to fixtures",
		Flags: []plugins.FlagDef{
			{Name: "--format", HasValue: true, Description: "Output format"},
			{Name: "--indent", HasValue: true, Description: "Indentation"},
			{Name: "--natural-foreign", Description: "Natural foreign keys"},
			{Name: "--natural-primary", Description: "Natural primary keys"},
		},
	})

	// Check
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "check",
		Description: "Check for problems",
		Flags: []plugins.FlagDef{
			{Name: "--deploy", Description: "Check deployment settings"},
			{Name: "--fail-level", HasValue: true, Description: "Fail level"},
		},
	})
}

func containsDjango(content []byte) bool {
	return len(content) > 0 && containsBytes(content, []byte("django")) ||
		containsBytes(content, []byte("Django"))
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
