package indexer

import (
	"path/filepath"
	"strings"
	"time"
)

type CommandDef struct {
	Prefix      string // "artisan", "composer", "git"
	Name        string
	Description string
	OutputKind  PendingKind
	PathPattern string
	Namespace   string
	Flags       []FlagDef
}

type FlagDef struct {
	Name        string
	Short       string
	Description string
	HasValue    bool
	Affects     string
}

type CommandRegistry struct {
	commands map[string]*CommandDef
}

func NewCommandRegistry() *CommandRegistry {
	r := &CommandRegistry{commands: make(map[string]*CommandDef)}
	r.registerCoreCommands()
	return r
}

func (r *CommandRegistry) Register(cmd *CommandDef) {
	r.commands[cmd.Name] = cmd
}

func (r *CommandRegistry) Get(name string) *CommandDef {
	return r.commands[name]
}

func (r *CommandRegistry) Match(input string) []*CommandDef {
	input = strings.ToLower(input)
	var matches []*CommandDef
	for _, cmd := range r.commands {
		if strings.Contains(strings.ToLower(cmd.Name), input) {
			matches = append(matches, cmd)
		}
	}
	return matches
}

// MatchPrefix returns commands that start with the given prefix
func (r *CommandRegistry) MatchPrefix(prefix string) []*CommandDef {
	prefix = strings.ToLower(prefix)
	var matches []*CommandDef
	for _, cmd := range r.commands {
		if strings.HasPrefix(strings.ToLower(cmd.Name), prefix) {
			matches = append(matches, cmd)
		}
	}
	return matches
}

func (r *CommandRegistry) All() []*CommandDef {
	result := make([]*CommandDef, 0, len(r.commands))
	for _, cmd := range r.commands {
		result = append(result, cmd)
	}
	return result
}

func (r *CommandRegistry) ByPrefix(prefix string) []*CommandDef {
	var result []*CommandDef
	for _, cmd := range r.commands {
		if cmd.Prefix == prefix {
			result = append(result, cmd)
		}
	}
	return result
}

func (r *CommandRegistry) MatchByPrefix(cmdPrefix, input string) []*CommandDef {
	input = strings.ToLower(input)
	var matches []*CommandDef
	for _, cmd := range r.commands {
		if cmd.Prefix == cmdPrefix && strings.HasPrefix(strings.ToLower(cmd.Name), input) {
			matches = append(matches, cmd)
		}
	}
	return matches
}

func (r *CommandRegistry) Predict(projectPath, cmdName, arg string, flags map[string]string) *PendingEntry {
	cmd := r.Get(cmdName)
	if cmd == nil || cmd.OutputKind == "" || arg == "" {
		return nil
	}

	name := arg
	if idx := strings.LastIndex(arg, "/"); idx >= 0 {
		name = arg[idx+1:]
	}

	path := r.resolvePath(projectPath, cmd.PathPattern, arg, flags)
	ns := r.resolveNamespace(cmd.Namespace, arg)

	return &PendingEntry{
		ID:        projectPath + "|" + string(cmd.OutputKind) + "|" + name,
		ProjectID: projectPath,
		Kind:      cmd.OutputKind,
		Name:      name,
		Namespace: ns,
		FilePath:  path,
		Extra:     flags,
		CreatedAt: time.Now(),
	}
}

func (r *CommandRegistry) resolvePath(projectPath, pattern, arg string, flags map[string]string) string {
	name := arg
	subdir := ""
	if idx := strings.LastIndex(arg, "/"); idx >= 0 {
		subdir = arg[:idx]
		name = arg[idx+1:]
	}

	path := strings.ReplaceAll(pattern, "{name}", name)
	path = strings.ReplaceAll(path, "{subdir}", subdir)

	if subdir != "" {
		parts := strings.Split(path, "/")
		for i, p := range parts {
			if p == "{subdir}" || strings.Contains(p, "{subdir}") {
				break
			}
			if i > 0 && parts[i-1] != subdir && !strings.Contains(parts[i-1], subdir) {
				continue
			}
		}
	}

	path = strings.ReplaceAll(path, "{subdir}/", "")
	path = strings.ReplaceAll(path, "//", "/")

	if subdir != "" {
		dir := filepath.Dir(path)
		base := filepath.Base(path)
		path = filepath.Join(dir, subdir, base)
	}

	return filepath.Join(projectPath, path)
}

func (r *CommandRegistry) resolveNamespace(baseNs, arg string) string {
	if idx := strings.LastIndex(arg, "/"); idx >= 0 {
		subNs := strings.ReplaceAll(arg[:idx], "/", "\\")
		return baseNs + "\\" + subNs
	}
	return baseNs
}

func (r *CommandRegistry) registerCoreCommands() {
	r.registerArtisanCommands()
	r.registerUtilityCommands()
	r.registerThirdPartyCommands()
	r.registerComposerCommands()
	r.registerGitCommands()
}

func (r *CommandRegistry) registerArtisanCommands() {
	// Models
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:model",
		Description: "Create a new Eloquent model class",
		OutputKind:  PendingModel,
		PathPattern: "app/Models/{name}.php",
		Namespace:   "App\\Models",
		Flags: []FlagDef{
			{Name: "--migration", Short: "-m", Description: "Create a migration file"},
			{Name: "--controller", Short: "-c", Description: "Create a controller"},
			{Name: "--resource", Short: "-r", Description: "Create a resource controller"},
			{Name: "--factory", Short: "-f", Description: "Create a factory"},
			{Name: "--seed", Short: "-s", Description: "Create a seeder"},
			{Name: "--policy", Short: "-p", Description: "Create a policy"},
			{Name: "--all", Short: "-a", Description: "Generate all"},
		},
	})

	// Controllers
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:controller",
		Description: "Create a new controller class",
		OutputKind:  PendingController,
		PathPattern: "app/Http/Controllers/{name}.php",
		Namespace:   "App\\Http\\Controllers",
		Flags: []FlagDef{
			{Name: "--resource", Short: "-r", Description: "Generate resource methods"},
			{Name: "--api", Description: "Generate API controller"},
			{Name: "--invokable", Short: "-i", Description: "Generate invokable controller"},
			{Name: "--model", Short: "-m", HasValue: true, Description: "Generate for model"},
			{Name: "--parent", HasValue: true, Description: "Parent controller"},
			{Name: "--requests", Description: "Generate form requests"},
			{Name: "--singleton", Description: "Generate singleton controller"},
		},
	})

	// Migrations
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:migration",
		Description: "Create a new migration file",
		OutputKind:  PendingMigration,
		PathPattern: "database/migrations/{name}.php",
		Namespace:   "",
		Flags: []FlagDef{
			{Name: "--create", HasValue: true, Description: "Table to create"},
			{Name: "--table", HasValue: true, Description: "Table to modify"},
		},
	})

	// Seeders
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:seeder",
		Description: "Create a new seeder class",
		OutputKind:  PendingSeeder,
		PathPattern: "database/seeders/{name}.php",
		Namespace:   "Database\\Seeders",
	})

	// Factories
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:factory",
		Description: "Create a new model factory",
		OutputKind:  PendingFactory,
		PathPattern: "database/factories/{name}.php",
		Namespace:   "Database\\Factories",
		Flags: []FlagDef{
			{Name: "--model", Short: "-m", HasValue: true, Description: "Model for factory"},
		},
	})

	// Policies
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:policy",
		Description: "Create a new policy class",
		OutputKind:  PendingPolicy,
		PathPattern: "app/Policies/{name}.php",
		Namespace:   "App\\Policies",
		Flags: []FlagDef{
			{Name: "--model", Short: "-m", HasValue: true, Description: "Model for policy"},
		},
	})

	// Form Requests
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:request",
		Description: "Create a new form request class",
		OutputKind:  PendingRequest,
		PathPattern: "app/Http/Requests/{name}.php",
		Namespace:   "App\\Http\\Requests",
	})

	// Resources
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:resource",
		Description: "Create a new resource",
		OutputKind:  PendingResource,
		PathPattern: "app/Http/Resources/{name}.php",
		Namespace:   "App\\Http\\Resources",
		Flags: []FlagDef{
			{Name: "--collection", Short: "-c", Description: "Create resource collection"},
		},
	})

	// Events
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:event",
		Description: "Create a new event class",
		OutputKind:  PendingEvent,
		PathPattern: "app/Events/{name}.php",
		Namespace:   "App\\Events",
	})

	// Listeners
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:listener",
		Description: "Create a new event listener class",
		OutputKind:  PendingListener,
		PathPattern: "app/Listeners/{name}.php",
		Namespace:   "App\\Listeners",
		Flags: []FlagDef{
			{Name: "--event", Short: "-e", HasValue: true, Description: "Event to listen for"},
			{Name: "--queued", Description: "Create queued listener"},
		},
	})

	// Jobs
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:job",
		Description: "Create a new job class",
		OutputKind:  PendingJob,
		PathPattern: "app/Jobs/{name}.php",
		Namespace:   "App\\Jobs",
		Flags: []FlagDef{
			{Name: "--sync", Description: "Create synchronous job"},
		},
	})

	// Mail
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:mail",
		Description: "Create a new email class",
		OutputKind:  PendingMail,
		PathPattern: "app/Mail/{name}.php",
		Namespace:   "App\\Mail",
		Flags: []FlagDef{
			{Name: "--markdown", Short: "-m", HasValue: true, Description: "Create markdown template"},
		},
	})

	// Notifications
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:notification",
		Description: "Create a new notification class",
		OutputKind:  PendingNotification,
		PathPattern: "app/Notifications/{name}.php",
		Namespace:   "App\\Notifications",
		Flags: []FlagDef{
			{Name: "--markdown", Short: "-m", HasValue: true, Description: "Create markdown template"},
		},
	})

	// Commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:command",
		Description: "Create a new Artisan command",
		OutputKind:  PendingCommand,
		PathPattern: "app/Console/Commands/{name}.php",
		Namespace:   "App\\Console\\Commands",
		Flags: []FlagDef{
			{Name: "--command", HasValue: true, Description: "Terminal command name"},
		},
	})

	// Middleware
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:middleware",
		Description: "Create a new middleware class",
		OutputKind:  PendingMiddleware,
		PathPattern: "app/Http/Middleware/{name}.php",
		Namespace:   "App\\Http\\Middleware",
	})

	// Channels
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:channel",
		Description: "Create a new channel class",
		OutputKind:  PendingChannel,
		PathPattern: "app/Broadcasting/{name}.php",
		Namespace:   "App\\Broadcasting",
	})

	// Exceptions
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:exception",
		Description: "Create a new exception class",
		OutputKind:  PendingException,
		PathPattern: "app/Exceptions/{name}.php",
		Namespace:   "App\\Exceptions",
		Flags: []FlagDef{
			{Name: "--render", Description: "Create with render method"},
			{Name: "--report", Description: "Create with report method"},
		},
	})

	// Casts
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:cast",
		Description: "Create a new custom cast class",
		OutputKind:  PendingCast,
		PathPattern: "app/Casts/{name}.php",
		Namespace:   "App\\Casts",
		Flags: []FlagDef{
			{Name: "--inbound", Description: "Create inbound cast"},
		},
	})

	// Components
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:component",
		Description: "Create a new view component class",
		OutputKind:  PendingComponent,
		PathPattern: "app/View/Components/{name}.php",
		Namespace:   "App\\View\\Components",
		Flags: []FlagDef{
			{Name: "--inline", Description: "Create inline component"},
		},
	})

	// Observer
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:observer",
		Description: "Create a new observer class",
		OutputKind:  PendingComponent,
		PathPattern: "app/Observers/{name}.php",
		Namespace:   "App\\Observers",
		Flags: []FlagDef{
			{Name: "--model", Short: "-m", HasValue: true, Description: "Model to observe"},
		},
	})

	// Provider
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:provider",
		Description: "Create a new service provider class",
		OutputKind:  PendingComponent,
		PathPattern: "app/Providers/{name}.php",
		Namespace:   "App\\Providers",
	})

	// Rule
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:rule",
		Description: "Create a new validation rule",
		OutputKind:  PendingComponent,
		PathPattern: "app/Rules/{name}.php",
		Namespace:   "App\\Rules",
		Flags: []FlagDef{
			{Name: "--implicit", Description: "Create implicit rule"},
		},
	})

	// View
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:view",
		Description: "Create a new view file",
		OutputKind:  PendingComponent,
		PathPattern: "resources/views/{name}.blade.php",
		Namespace:   "",
	})

	// Livewire
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "livewire:make",
		Description: "Create a new Livewire component",
		OutputKind:  PendingLivewire,
		PathPattern: "app/Livewire/{name}.php",
		Namespace:   "App\\Livewire",
		Flags: []FlagDef{
			{Name: "--inline", Description: "Create inline component"},
		},
	})

	// Tests
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:test",
		Description: "Create a new test class",
		OutputKind:  PendingTest,
		PathPattern: "tests/Feature/{name}.php",
		Namespace:   "Tests\\Feature",
		Flags: []FlagDef{
			{Name: "--unit", Description: "Create unit test"},
			{Name: "--pest", Description: "Create Pest test"},
			{Name: "--phpunit", Description: "Create PHPUnit test"},
		},
	})

	r.registerLivewireCommands()
	r.registerFortifyCommands()
	r.registerInertiaCommands()
	r.registerFilamentCommands()
	r.registerNovaCommands()
}

func (r *CommandRegistry) registerLivewireCommands() {
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "livewire:form",
		Description: "Create a new Livewire form class",
		OutputKind:  PendingLivewire,
		PathPattern: "app/Livewire/Forms/{name}.php",
		Namespace:   "App\\Livewire\\Forms",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "livewire:layout",
		Description: "Create a new Livewire layout",
		OutputKind:  PendingComponent,
		PathPattern: "resources/views/components/layouts/{name}.blade.php",
		Namespace:   "",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "livewire:publish",
		Description: "Publish Livewire assets and config",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
		Flags: []FlagDef{
			{Name: "--config", Description: "Publish config file"},
			{Name: "--assets", Description: "Publish assets"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "livewire:discover",
		Description: "Discover Livewire components",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "volt:install",
		Description: "Install Volt into the application",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
	})
}

func (r *CommandRegistry) registerFortifyCommands() {
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "fortify:install",
		Description: "Install Fortify resources",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "fortify:publish",
		Description: "Publish Fortify views and config",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
	})
}

func (r *CommandRegistry) registerInertiaCommands() {
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "inertia:middleware",
		Description: "Create Inertia middleware",
		OutputKind:  PendingMiddleware,
		PathPattern: "app/Http/Middleware/HandleInertiaRequests.php",
		Namespace:   "App\\Http\\Middleware",
	})
}

func (r *CommandRegistry) registerFilamentCommands() {
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "filament:install",
		Description: "Install Filament panels",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
		Flags: []FlagDef{
			{Name: "--panels", Description: "Install panels"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "filament:upgrade",
		Description: "Upgrade Filament assets",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:filament-resource",
		Description: "Create a new Filament resource",
		OutputKind:  PendingResource,
		PathPattern: "app/Filament/Resources/{name}Resource.php",
		Namespace:   "App\\Filament\\Resources",
		Flags: []FlagDef{
			{Name: "--generate", Short: "-G", Description: "Generate form and table"},
			{Name: "--simple", Short: "-S", Description: "Simple resource"},
			{Name: "--view", Description: "Generate view page"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:filament-page",
		Description: "Create a new Filament page",
		OutputKind:  PendingComponent,
		PathPattern: "app/Filament/Pages/{name}.php",
		Namespace:   "App\\Filament\\Pages",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:filament-widget",
		Description: "Create a new Filament widget",
		OutputKind:  PendingComponent,
		PathPattern: "app/Filament/Widgets/{name}.php",
		Namespace:   "App\\Filament\\Widgets",
		Flags: []FlagDef{
			{Name: "--chart", Description: "Create chart widget"},
			{Name: "--stats", Description: "Create stats widget"},
			{Name: "--table", Description: "Create table widget"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:filament-relation-manager",
		Description: "Create a new Filament relation manager",
		OutputKind:  PendingComponent,
		PathPattern: "app/Filament/Resources/{name}RelationManager.php",
		Namespace:   "App\\Filament\\Resources",
	})
}

func (r *CommandRegistry) registerNovaCommands() {
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:install",
		Description: "Install Nova resources",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:publish",
		Description: "Publish Nova assets",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:user",
		Description: "Create a Nova admin user",
		OutputKind:  "",
		PathPattern: "",
		Namespace:   "",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:resource",
		Description: "Create a new Nova resource",
		OutputKind:  PendingResource,
		PathPattern: "app/Nova/{name}.php",
		Namespace:   "App\\Nova",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:action",
		Description: "Create a new Nova action",
		OutputKind:  PendingComponent,
		PathPattern: "app/Nova/Actions/{name}.php",
		Namespace:   "App\\Nova\\Actions",
		Flags: []FlagDef{
			{Name: "--destructive", Description: "Destructive action"},
			{Name: "--queued", Description: "Queued action"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:filter",
		Description: "Create a new Nova filter",
		OutputKind:  PendingComponent,
		PathPattern: "app/Nova/Filters/{name}.php",
		Namespace:   "App\\Nova\\Filters",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:lens",
		Description: "Create a new Nova lens",
		OutputKind:  PendingComponent,
		PathPattern: "app/Nova/Lenses/{name}.php",
		Namespace:   "App\\Nova\\Lenses",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:field",
		Description: "Create a new Nova field",
		OutputKind:  PendingComponent,
		PathPattern: "nova-components/{name}/src/{name}.php",
		Namespace:   "",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "nova:dashboard",
		Description: "Create a new Nova dashboard",
		OutputKind:  PendingComponent,
		PathPattern: "app/Nova/Dashboards/{name}.php",
		Namespace:   "App\\Nova\\Dashboards",
	})
}

// registerUtilityCommands registers all artisan utility commands
func (r *CommandRegistry) registerUtilityCommands() {
	// Application info
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "about",
		Description: "Display basic information about the application",
		Flags: []FlagDef{
			{Name: "--only", HasValue: true, Description: "Filter by section"},
			{Name: "--json", Description: "Output as JSON"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "env",
		Description: "Display current environment",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "inspire",
		Description: "Display an inspiring quote",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "list",
		Description: "List all available commands",
		Flags: []FlagDef{
			{Name: "--raw", Description: "Raw output"},
			{Name: "--format", HasValue: true, Description: "Output format"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "help",
		Description: "Display help for a command",
	})

	// Cache commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "cache:clear",
		Description: "Flush the application cache",
		Flags: []FlagDef{
			{Name: "--tags", HasValue: true, Description: "Clear by tags"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "cache:forget",
		Description: "Remove an item from the cache",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "cache:table",
		Description: "Create a migration for the cache database table",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "cache:prune-stale-tags",
		Description: "Prune stale cache tags (Redis)",
	})

	// Config commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "config:cache",
		Description: "Create a cache file for faster config loading",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "config:clear",
		Description: "Remove the configuration cache file",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "config:publish",
		Description: "Publish configuration files",
		Flags: []FlagDef{
			{Name: "--all", Description: "Publish all config files"},
			{Name: "--force", Description: "Overwrite existing files"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "config:show",
		Description: "Display a configuration value",
	})

	// Database commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "db",
		Description: "Start a database CLI session",
		Flags: []FlagDef{
			{Name: "--read", Description: "Connect to read connection"},
			{Name: "--write", Description: "Connect to write connection"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "db:monitor",
		Description: "Monitor database connections",
		Flags: []FlagDef{
			{Name: "--databases", HasValue: true, Description: "Databases to monitor"},
			{Name: "--max", HasValue: true, Description: "Maximum connections"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "db:seed",
		Description: "Seed the database with records",
		Flags: []FlagDef{
			{Name: "--class", HasValue: true, Description: "Seeder class to run"},
			{Name: "--database", HasValue: true, Description: "Database connection"},
			{Name: "--force", Description: "Force in production"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "db:show",
		Description: "Display information about the database",
		Flags: []FlagDef{
			{Name: "--json", Description: "Output as JSON"},
			{Name: "--counts", Description: "Show row counts"},
			{Name: "--views", Description: "Show views"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "db:table",
		Description: "Display information about a table",
		Flags: []FlagDef{
			{Name: "--database", HasValue: true, Description: "Database connection"},
			{Name: "--json", Description: "Output as JSON"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "db:wipe",
		Description: "Drop all tables, views, and types",
		Flags: []FlagDef{
			{Name: "--database", HasValue: true, Description: "Database connection"},
			{Name: "--drop-views", Description: "Drop views"},
			{Name: "--drop-types", Description: "Drop types"},
			{Name: "--force", Description: "Force in production"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "db:prune",
		Description: "Prune models from the database",
		Flags: []FlagDef{
			{Name: "--model", HasValue: true, Description: "Model to prune"},
			{Name: "--chunk", HasValue: true, Description: "Chunk size"},
			{Name: "--pretend", Description: "Dry run"},
		},
	})

	// Event commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "event:cache",
		Description: "Discover and cache event/listener mappings",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "event:clear",
		Description: "Clear all cached events and listeners",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "event:list",
		Description: "List the application events and listeners",
		Flags: []FlagDef{
			{Name: "--event", HasValue: true, Description: "Filter by event"},
		},
	})

	// Migrate commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "migrate",
		Description: "Run the database migrations",
		Flags: []FlagDef{
			{Name: "--database", HasValue: true, Description: "Database connection"},
			{Name: "--force", Description: "Force in production"},
			{Name: "--path", HasValue: true, Description: "Migration path"},
			{Name: "--pretend", Description: "Dry run"},
			{Name: "--seed", Description: "Run seeders"},
			{Name: "--step", Description: "Run one migration at a time"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "migrate:fresh",
		Description: "Drop all tables and re-run all migrations",
		Flags: []FlagDef{
			{Name: "--drop-views", Description: "Drop views"},
			{Name: "--drop-types", Description: "Drop types"},
			{Name: "--seed", Description: "Run seeders"},
			{Name: "--seeder", HasValue: true, Description: "Seeder class"},
			{Name: "--force", Description: "Force in production"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "migrate:install",
		Description: "Create the migration repository",
		Flags: []FlagDef{
			{Name: "--database", HasValue: true, Description: "Database connection"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "migrate:refresh",
		Description: "Reset and re-run all migrations",
		Flags: []FlagDef{
			{Name: "--path", HasValue: true, Description: "Migration path"},
			{Name: "--seed", Description: "Run seeders"},
			{Name: "--seeder", HasValue: true, Description: "Seeder class"},
			{Name: "--step", HasValue: true, Description: "Number of migrations"},
			{Name: "--force", Description: "Force in production"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "migrate:reset",
		Description: "Rollback all database migrations",
		Flags: []FlagDef{
			{Name: "--database", HasValue: true, Description: "Database connection"},
			{Name: "--force", Description: "Force in production"},
			{Name: "--path", HasValue: true, Description: "Migration path"},
			{Name: "--pretend", Description: "Dry run"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "migrate:rollback",
		Description: "Rollback the last database migration",
		Flags: []FlagDef{
			{Name: "--database", HasValue: true, Description: "Database connection"},
			{Name: "--force", Description: "Force in production"},
			{Name: "--path", HasValue: true, Description: "Migration path"},
			{Name: "--pretend", Description: "Dry run"},
			{Name: "--step", HasValue: true, Description: "Number of migrations"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "migrate:status",
		Description: "Show the status of each migration",
		Flags: []FlagDef{
			{Name: "--database", HasValue: true, Description: "Database connection"},
			{Name: "--path", HasValue: true, Description: "Migration path"},
		},
	})

	// Model commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "model:prune",
		Description: "Prune models that are no longer needed",
		Flags: []FlagDef{
			{Name: "--model", HasValue: true, Description: "Model to prune"},
			{Name: "--chunk", HasValue: true, Description: "Chunk size"},
			{Name: "--pretend", Description: "Dry run"},
		},
	})

	// Optimize commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "optimize",
		Description: "Cache the framework bootstrap files",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "optimize:clear",
		Description: "Remove the cached bootstrap files",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "clear-compiled",
		Description: "Remove the compiled class file",
	})

	// Package commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "package:discover",
		Description: "Rebuild the cached package manifest",
	})

	// Queue commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:work",
		Description: "Start processing jobs on the queue",
		Flags: []FlagDef{
			{Name: "--queue", HasValue: true, Description: "Queue to process"},
			{Name: "--once", Description: "Process a single job"},
			{Name: "--stop-when-empty", Description: "Stop when queue is empty"},
			{Name: "--max-jobs", HasValue: true, Description: "Maximum jobs"},
			{Name: "--max-time", HasValue: true, Description: "Maximum time"},
			{Name: "--memory", HasValue: true, Description: "Memory limit"},
			{Name: "--sleep", HasValue: true, Description: "Sleep seconds"},
			{Name: "--tries", HasValue: true, Description: "Max attempts"},
			{Name: "--timeout", HasValue: true, Description: "Job timeout"},
			{Name: "--daemon", Description: "Run in daemon mode"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:listen",
		Description: "Listen to a given queue",
		Flags: []FlagDef{
			{Name: "--queue", HasValue: true, Description: "Queue to listen"},
			{Name: "--delay", HasValue: true, Description: "Delay failed jobs"},
			{Name: "--memory", HasValue: true, Description: "Memory limit"},
			{Name: "--timeout", HasValue: true, Description: "Job timeout"},
			{Name: "--tries", HasValue: true, Description: "Max attempts"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:restart",
		Description: "Restart queue worker daemons",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:retry",
		Description: "Retry a failed queue job",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:retry-batch",
		Description: "Retry failed jobs for a batch",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:failed",
		Description: "List all of the failed queue jobs",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:flush",
		Description: "Flush all of the failed queue jobs",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:forget",
		Description: "Delete a failed queue job",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:clear",
		Description: "Delete all of the jobs from the queue",
		Flags: []FlagDef{
			{Name: "--queue", HasValue: true, Description: "Queue to clear"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:monitor",
		Description: "Monitor the size of queues",
		Flags: []FlagDef{
			{Name: "--max", HasValue: true, Description: "Maximum queue size"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:prune-batches",
		Description: "Prune stale entries from the batches database",
		Flags: []FlagDef{
			{Name: "--hours", HasValue: true, Description: "Hours to retain"},
			{Name: "--unfinished", HasValue: true, Description: "Unfinished hours"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:prune-failed",
		Description: "Prune stale entries from the failed jobs table",
		Flags: []FlagDef{
			{Name: "--hours", HasValue: true, Description: "Hours to retain"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:table",
		Description: "Create a migration for the queue jobs table",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:failed-table",
		Description: "Create a migration for the failed queue jobs table",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "queue:batches-table",
		Description: "Create a migration for the batches table",
	})

	// Route commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "route:cache",
		Description: "Create a route cache file",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "route:clear",
		Description: "Remove the route cache file",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "route:list",
		Description: "List all registered routes",
		Flags: []FlagDef{
			{Name: "--method", HasValue: true, Description: "Filter by method"},
			{Name: "--path", HasValue: true, Description: "Filter by path"},
			{Name: "--name", HasValue: true, Description: "Filter by name"},
			{Name: "--domain", HasValue: true, Description: "Filter by domain"},
			{Name: "--except-vendor", Description: "Exclude vendor routes"},
			{Name: "--only-vendor", Description: "Only vendor routes"},
			{Name: "--json", Description: "Output as JSON"},
		},
	})

	// Schedule commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "schedule:run",
		Description: "Run the scheduled commands",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "schedule:work",
		Description: "Start the schedule worker",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "schedule:list",
		Description: "List all scheduled tasks",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "schedule:test",
		Description: "Run a scheduled command",
		Flags: []FlagDef{
			{Name: "--name", HasValue: true, Description: "Command name"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "schedule:clear-cache",
		Description: "Delete the cached mutex files",
	})

	// Schema commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "schema:dump",
		Description: "Dump the database schema",
		Flags: []FlagDef{
			{Name: "--database", HasValue: true, Description: "Database connection"},
			{Name: "--path", HasValue: true, Description: "Output path"},
			{Name: "--prune", Description: "Delete existing migrations"},
		},
	})

	// Server commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "serve",
		Description: "Serve the application on the PHP development server",
		Flags: []FlagDef{
			{Name: "--host", HasValue: true, Description: "Host address"},
			{Name: "--port", HasValue: true, Description: "Port number"},
			{Name: "--tries", HasValue: true, Description: "Max port attempts"},
			{Name: "--no-reload", Description: "Disable .env reload"},
		},
	})

	// Session commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "session:table",
		Description: "Create a migration for the session database table",
	})

	// Storage commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "storage:link",
		Description: "Create the symbolic links configured for the application",
		Flags: []FlagDef{
			{Name: "--relative", Description: "Create relative symlinks"},
			{Name: "--force", Description: "Recreate existing symlinks"},
		},
	})

	// Stub commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "stub:publish",
		Description: "Publish all stubs that are available for customization",
	})

	// Testing commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "test",
		Description: "Run the application tests",
		Flags: []FlagDef{
			{Name: "--without-tty", Description: "Disable TTY"},
			{Name: "--compact", Description: "Compact output"},
			{Name: "--coverage", Description: "Enable code coverage"},
			{Name: "--min", HasValue: true, Description: "Minimum coverage"},
			{Name: "--parallel", Description: "Run tests in parallel"},
			{Name: "--profile", Description: "Show slowest tests"},
			{Name: "--recreate-databases", Description: "Recreate databases"},
			{Name: "--drop-databases", Description: "Drop databases after"},
		},
	})

	// Tinker command
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "tinker",
		Description: "Interact with your application (REPL)",
		Flags: []FlagDef{
			{Name: "--execute", HasValue: true, Description: "Execute code"},
		},
	})

	// Maintenance mode
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "down",
		Description: "Put the application into maintenance mode",
		Flags: []FlagDef{
			{Name: "--redirect", HasValue: true, Description: "Redirect URL"},
			{Name: "--render", HasValue: true, Description: "View to render"},
			{Name: "--retry", HasValue: true, Description: "Retry-After seconds"},
			{Name: "--refresh", HasValue: true, Description: "Refresh header"},
			{Name: "--secret", HasValue: true, Description: "Bypass secret"},
			{Name: "--with-secret", Description: "Generate secret"},
			{Name: "--status", HasValue: true, Description: "HTTP status code"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "up",
		Description: "Bring the application out of maintenance mode",
	})

	// Vendor commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "vendor:publish",
		Description: "Publish any publishable assets from vendor packages",
		Flags: []FlagDef{
			{Name: "--all", Description: "Publish all assets"},
			{Name: "--force", Description: "Overwrite existing files"},
			{Name: "--provider", HasValue: true, Description: "Provider class"},
			{Name: "--tag", HasValue: true, Description: "Asset tag"},
		},
	})

	// View commands
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "view:cache",
		Description: "Compile all Blade templates",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "view:clear",
		Description: "Clear all compiled view files",
	})

	// Notifications table
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "notifications:table",
		Description: "Create a migration for the notifications table",
	})

	// Channel list
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "channel:list",
		Description: "List all registered private broadcast channels",
	})
}

// registerThirdPartyCommands registers commands from popular Laravel packages
func (r *CommandRegistry) registerThirdPartyCommands() {
	// Horizon
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon",
		Description: "Start Laravel Horizon",
		Flags: []FlagDef{
			{Name: "--environment", HasValue: true, Description: "Environment"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:install",
		Description: "Install Horizon resources",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:publish",
		Description: "Publish Horizon assets",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:status",
		Description: "Get the current status of Horizon",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:pause",
		Description: "Pause Horizon master supervisor",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:continue",
		Description: "Instruct Horizon to continue processing jobs",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:terminate",
		Description: "Terminate Horizon master supervisor",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:purge",
		Description: "Terminate any rogue Horizon processes",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:snapshot",
		Description: "Store a snapshot of the queue metrics",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "horizon:clear",
		Description: "Delete all jobs from Horizon queue",
		Flags: []FlagDef{
			{Name: "--queue", HasValue: true, Description: "Queue to clear"},
		},
	})

	// Telescope
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "telescope:install",
		Description: "Install Telescope resources",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "telescope:publish",
		Description: "Publish Telescope assets",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "telescope:prune",
		Description: "Prune stale entries from Telescope database",
		Flags: []FlagDef{
			{Name: "--hours", HasValue: true, Description: "Hours to retain"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "telescope:clear",
		Description: "Delete all Telescope data",
	})

	// Breeze
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "breeze:install",
		Description: "Install Laravel Breeze",
		Flags: []FlagDef{
			{Name: "--dark", Description: "Install dark mode"},
			{Name: "--pest", Description: "Use Pest for testing"},
			{Name: "--ssr", Description: "Enable SSR"},
			{Name: "--typescript", Description: "Use TypeScript"},
		},
	})

	// Jetstream
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "jetstream:install",
		Description: "Install Laravel Jetstream",
		Flags: []FlagDef{
			{Name: "--teams", Description: "Enable teams"},
			{Name: "--api", Description: "Enable API support"},
			{Name: "--dark", Description: "Install dark mode"},
			{Name: "--pest", Description: "Use Pest for testing"},
			{Name: "--ssr", Description: "Enable SSR"},
		},
	})

	// Passport
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "passport:install",
		Description: "Install Laravel Passport",
		Flags: []FlagDef{
			{Name: "--uuids", Description: "Use UUIDs"},
			{Name: "--force", Description: "Overwrite existing keys"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "passport:keys",
		Description: "Create encryption keys for API authentication",
		Flags: []FlagDef{
			{Name: "--force", Description: "Overwrite existing keys"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "passport:client",
		Description: "Create a client for issuing access tokens",
		Flags: []FlagDef{
			{Name: "--personal", Description: "Personal access client"},
			{Name: "--password", Description: "Password grant client"},
			{Name: "--client", Description: "Client credentials"},
		},
	})

	// Sanctum
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "sanctum:prune-expired",
		Description: "Prune expired Sanctum tokens",
		Flags: []FlagDef{
			{Name: "--hours", HasValue: true, Description: "Hours to retain"},
		},
	})

	// Scout
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "scout:import",
		Description: "Import all model records into search index",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "scout:flush",
		Description: "Flush all model records from search index",
	})

	// Octane
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "octane:install",
		Description: "Install Laravel Octane",
		Flags: []FlagDef{
			{Name: "--server", HasValue: true, Description: "Server to use"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "octane:start",
		Description: "Start Laravel Octane server",
		Flags: []FlagDef{
			{Name: "--host", HasValue: true, Description: "Host address"},
			{Name: "--port", HasValue: true, Description: "Port number"},
			{Name: "--workers", HasValue: true, Description: "Worker count"},
			{Name: "--max-requests", HasValue: true, Description: "Max requests"},
			{Name: "--watch", Description: "Watch for changes"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "octane:reload",
		Description: "Reload Octane workers",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "octane:stop",
		Description: "Stop Laravel Octane server",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "octane:status",
		Description: "Get the current status of Octane server",
	})

	// Pulse
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "pulse:install",
		Description: "Install Laravel Pulse",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "pulse:check",
		Description: "Check Pulse health",
	})

	// Reverb (WebSockets)
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "reverb:install",
		Description: "Install Laravel Reverb",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "reverb:start",
		Description: "Start the Reverb WebSocket server",
		Flags: []FlagDef{
			{Name: "--host", HasValue: true, Description: "Host address"},
			{Name: "--port", HasValue: true, Description: "Port number"},
		},
	})

	// Pennant (Feature Flags)
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "pennant:install",
		Description: "Install Laravel Pennant",
	})

	// Dusk
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "dusk",
		Description: "Run the Dusk tests",
		Flags: []FlagDef{
			{Name: "--browse", Description: "Open browser"},
			{Name: "--without-tty", Description: "Disable TTY"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "dusk:install",
		Description: "Install Dusk into the application",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "dusk:make",
		Description: "Create a new Dusk test class",
	})

	// Pint
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "pint",
		Description: "Run Laravel Pint code style fixer",
		Flags: []FlagDef{
			{Name: "--test", Description: "Test mode only"},
			{Name: "--dirty", Description: "Only uncommitted files"},
		},
	})

	// Sail
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "sail:install",
		Description: "Install Laravel Sail Docker files",
		Flags: []FlagDef{
			{Name: "--devcontainer", Description: "Add devcontainer config"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "sail:publish",
		Description: "Publish Sail Docker files",
	})

	// Spatie Backup
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "backup:run",
		Description: "Run the backup",
		Flags: []FlagDef{
			{Name: "--only-db", Description: "Only backup database"},
			{Name: "--only-files", Description: "Only backup files"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "backup:list",
		Description: "Display a list of all backups",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "backup:clean",
		Description: "Remove old backups",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "backup:monitor",
		Description: "Monitor backup health",
	})

	// Spatie Permission
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "permission:cache-reset",
		Description: "Reset the permission cache",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "permission:show",
		Description: "Show a table of roles and permissions",
	})

	// Spatie Activity Log
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "activitylog:clean",
		Description: "Clean old activity log records",
		Flags: []FlagDef{
			{Name: "--keep-last", HasValue: true, Description: "Records to keep"},
		},
	})

	// Spatie Media Library
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "medialibrary:regenerate",
		Description: "Regenerate media conversions",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "medialibrary:clear",
		Description: "Delete all media items",
	})

	// Spatie Sitemap
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "sitemap:generate",
		Description: "Generate the sitemap",
	})

	// Spatie Data
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:data",
		Description: "Create a new data object",
	})

	// IDE Helper
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "ide-helper:generate",
		Description: "Generate IDE helper file",
		Flags: []FlagDef{
			{Name: "--helpers", Description: "Include helpers"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "ide-helper:models",
		Description: "Generate model helper file",
		Flags: []FlagDef{
			{Name: "--nowrite", Description: "Don't write to model files"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "ide-helper:meta",
		Description: "Generate PhpStorm meta file",
	})

	// Debugbar
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "debugbar:clear",
		Description: "Clear the Debugbar storage",
	})

	// Ziggy
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "ziggy:generate",
		Description: "Generate Ziggy routes file",
	})

	// Laravel UI
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "ui:auth",
		Description: "Scaffold basic login and registration views and routes",
		Flags: []FlagDef{
			{Name: "--views", Description: "Only scaffold views"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "ui:controllers",
		Description: "Scaffold auth controllers",
	})

	// Maatwebsite Excel
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:export",
		Description: "Create a new export class",
	})

	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:import",
		Description: "Create a new import class",
	})

	// Service Generator
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:service",
		Description: "Create a new service class",
		OutputKind:  PendingComponent,
		PathPattern: "app/Services/{name}.php",
		Namespace:   "App\\Services",
	})

	// Action Generator
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:action",
		Description: "Create a new action class",
		OutputKind:  PendingComponent,
		PathPattern: "app/Actions/{name}.php",
		Namespace:   "App\\Actions",
	})

	// Yajra Datatables
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "datatables:make",
		Description: "Create a new DataTable class",
	})

	// WebSockets (beyondcode)
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "websockets:serve",
		Description: "Serve the WebSocket server",
		Flags: []FlagDef{
			{Name: "--host", HasValue: true, Description: "Host address"},
			{Name: "--port", HasValue: true, Description: "Port number"},
		},
	})

	// Pail (log tail)
	r.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "pail",
		Description: "Tail application logs",
		Flags: []FlagDef{
			{Name: "--filter", HasValue: true, Description: "Filter logs"},
			{Name: "--message", HasValue: true, Description: "Filter by message"},
			{Name: "--level", HasValue: true, Description: "Filter by level"},
			{Name: "--user", HasValue: true, Description: "Filter by user"},
		},
	})
}
