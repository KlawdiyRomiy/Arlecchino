package laravel

import "arlecchino/internal/plugins"

func (p *Plugin) registerArtisanCommands() {
	// Models
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:model",
		Description: "Create a new Eloquent model class",
		OutputKind:  "model",
		PathPattern: "app/Models/{name}.php",
		Namespace:   "App\\Models",
		Flags: []plugins.FlagDef{
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
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:controller",
		Description: "Create a new controller class",
		OutputKind:  "controller",
		PathPattern: "app/Http/Controllers/{name}.php",
		Namespace:   "App\\Http\\Controllers",
		Flags: []plugins.FlagDef{
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
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:migration",
		Description: "Create a new migration file",
		OutputKind:  "migration",
		PathPattern: "database/migrations/{name}.php",
		Namespace:   "",
		Flags: []plugins.FlagDef{
			{Name: "--create", HasValue: true, Description: "Table to create"},
			{Name: "--table", HasValue: true, Description: "Table to modify"},
		},
	})

	// Seeders
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:seeder",
		Description: "Create a new seeder class",
		OutputKind:  "seeder",
		PathPattern: "database/seeders/{name}.php",
		Namespace:   "Database\\Seeders",
	})

	// Factories
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:factory",
		Description: "Create a new model factory",
		OutputKind:  "factory",
		PathPattern: "database/factories/{name}.php",
		Namespace:   "Database\\Factories",
		Flags: []plugins.FlagDef{
			{Name: "--model", Short: "-m", HasValue: true, Description: "Model for factory"},
		},
	})

	// Policies
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:policy",
		Description: "Create a new policy class",
		OutputKind:  "policy",
		PathPattern: "app/Policies/{name}.php",
		Namespace:   "App\\Policies",
		Flags: []plugins.FlagDef{
			{Name: "--model", Short: "-m", HasValue: true, Description: "Model for policy"},
		},
	})

	// Form Requests
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:request",
		Description: "Create a new form request class",
		OutputKind:  "request",
		PathPattern: "app/Http/Requests/{name}.php",
		Namespace:   "App\\Http\\Requests",
	})

	// Resources
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:resource",
		Description: "Create a new resource",
		OutputKind:  "resource",
		PathPattern: "app/Http/Resources/{name}.php",
		Namespace:   "App\\Http\\Resources",
		Flags: []plugins.FlagDef{
			{Name: "--collection", Short: "-c", Description: "Create resource collection"},
		},
	})

	// Events
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:event",
		Description: "Create a new event class",
		OutputKind:  "event",
		PathPattern: "app/Events/{name}.php",
		Namespace:   "App\\Events",
	})

	// Listeners
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:listener",
		Description: "Create a new event listener class",
		OutputKind:  "listener",
		PathPattern: "app/Listeners/{name}.php",
		Namespace:   "App\\Listeners",
		Flags: []plugins.FlagDef{
			{Name: "--event", Short: "-e", HasValue: true, Description: "Event to listen for"},
			{Name: "--queued", Description: "Create queued listener"},
		},
	})

	// Jobs
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:job",
		Description: "Create a new job class",
		OutputKind:  "job",
		PathPattern: "app/Jobs/{name}.php",
		Namespace:   "App\\Jobs",
		Flags: []plugins.FlagDef{
			{Name: "--sync", Description: "Create synchronous job"},
		},
	})

	// Mail
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:mail",
		Description: "Create a new email class",
		OutputKind:  "mail",
		PathPattern: "app/Mail/{name}.php",
		Namespace:   "App\\Mail",
		Flags: []plugins.FlagDef{
			{Name: "--markdown", Short: "-m", HasValue: true, Description: "Create markdown template"},
		},
	})

	// Notifications
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:notification",
		Description: "Create a new notification class",
		OutputKind:  "notification",
		PathPattern: "app/Notifications/{name}.php",
		Namespace:   "App\\Notifications",
		Flags: []plugins.FlagDef{
			{Name: "--markdown", Short: "-m", HasValue: true, Description: "Create markdown template"},
		},
	})

	// Commands
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:command",
		Description: "Create a new Artisan command",
		OutputKind:  "command",
		PathPattern: "app/Console/Commands/{name}.php",
		Namespace:   "App\\Console\\Commands",
		Flags: []plugins.FlagDef{
			{Name: "--command", HasValue: true, Description: "Terminal command name"},
		},
	})

	// Middleware
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:middleware",
		Description: "Create a new middleware class",
		OutputKind:  "middleware",
		PathPattern: "app/Http/Middleware/{name}.php",
		Namespace:   "App\\Http\\Middleware",
	})

	// Channels
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:channel",
		Description: "Create a new channel class",
		OutputKind:  "channel",
		PathPattern: "app/Broadcasting/{name}.php",
		Namespace:   "App\\Broadcasting",
	})

	// Exceptions
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:exception",
		Description: "Create a new exception class",
		OutputKind:  "exception",
		PathPattern: "app/Exceptions/{name}.php",
		Namespace:   "App\\Exceptions",
		Flags: []plugins.FlagDef{
			{Name: "--render", Description: "Create with render method"},
			{Name: "--report", Description: "Create with report method"},
		},
	})

	// Casts
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:cast",
		Description: "Create a new custom cast class",
		OutputKind:  "cast",
		PathPattern: "app/Casts/{name}.php",
		Namespace:   "App\\Casts",
		Flags: []plugins.FlagDef{
			{Name: "--inbound", Description: "Create inbound cast"},
		},
	})

	// Components
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:component",
		Description: "Create a new view component class",
		OutputKind:  "component",
		PathPattern: "app/View/Components/{name}.php",
		Namespace:   "App\\View\\Components",
		Flags: []plugins.FlagDef{
			{Name: "--inline", Description: "Create inline component"},
		},
	})

	// Observer
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:observer",
		Description: "Create a new observer class",
		OutputKind:  "observer",
		PathPattern: "app/Observers/{name}.php",
		Namespace:   "App\\Observers",
		Flags: []plugins.FlagDef{
			{Name: "--model", Short: "-m", HasValue: true, Description: "Model to observe"},
		},
	})

	// Provider
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:provider",
		Description: "Create a new service provider class",
		OutputKind:  "provider",
		PathPattern: "app/Providers/{name}.php",
		Namespace:   "App\\Providers",
	})

	// Rule
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:rule",
		Description: "Create a new validation rule",
		OutputKind:  "rule",
		PathPattern: "app/Rules/{name}.php",
		Namespace:   "App\\Rules",
		Flags: []plugins.FlagDef{
			{Name: "--implicit", Description: "Create implicit rule"},
		},
	})

	// View
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:view",
		Description: "Create a new view file",
		OutputKind:  "view",
		PathPattern: "resources/views/{name}.blade.php",
		Namespace:   "",
	})

	// Tests
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:test",
		Description: "Create a new test class",
		OutputKind:  "test",
		PathPattern: "tests/Feature/{name}.php",
		Namespace:   "Tests\\Feature",
		Flags: []plugins.FlagDef{
			{Name: "--unit", Description: "Create unit test"},
			{Name: "--pest", Description: "Create Pest test"},
			{Name: "--phpunit", Description: "Create PHPUnit test"},
		},
	})

	// Enum (Laravel 11+)
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:enum",
		Description: "Create a new enum",
		OutputKind:  "enum",
		PathPattern: "app/Enums/{name}.php",
		Namespace:   "App\\Enums",
	})

	// Interface
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:interface",
		Description: "Create a new interface",
		OutputKind:  "interface",
		PathPattern: "app/Contracts/{name}.php",
		Namespace:   "App\\Contracts",
	})

	// Trait
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:trait",
		Description: "Create a new trait",
		OutputKind:  "trait",
		PathPattern: "app/Traits/{name}.php",
		Namespace:   "App\\Traits",
	})

	// Class
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:class",
		Description: "Create a new class",
		OutputKind:  "class",
		PathPattern: "app/{name}.php",
		Namespace:   "App",
	})

	// Register third-party package commands
	p.registerLivewireCommands()
	p.registerFilamentCommands()
	p.registerNovaCommands()
}

func (p *Plugin) registerLivewireCommands() {
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "livewire:make",
		Description: "Create a new Livewire component",
		OutputKind:  "livewire",
		PathPattern: "app/Livewire/{name}.php",
		Namespace:   "App\\Livewire",
		Flags: []plugins.FlagDef{
			{Name: "--inline", Description: "Create inline component"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "livewire:form",
		Description: "Create a new Livewire form class",
		OutputKind:  "livewire",
		PathPattern: "app/Livewire/Forms/{name}.php",
		Namespace:   "App\\Livewire\\Forms",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "livewire:layout",
		Description: "Create a new Livewire layout",
		OutputKind:  "view",
		PathPattern: "resources/views/components/layouts/{name}.blade.php",
		Namespace:   "",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "volt:install",
		Description: "Install Volt into the application",
	})
}

func (p *Plugin) registerFilamentCommands() {
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "filament:install",
		Description: "Install Filament panels",
		Flags: []plugins.FlagDef{
			{Name: "--panels", Description: "Install panels"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:filament-resource",
		Description: "Create a new Filament resource",
		OutputKind:  "filament-resource",
		PathPattern: "app/Filament/Resources/{name}Resource.php",
		Namespace:   "App\\Filament\\Resources",
		Flags: []plugins.FlagDef{
			{Name: "--generate", Short: "-G", Description: "Generate form and table"},
			{Name: "--simple", Short: "-S", Description: "Simple resource"},
			{Name: "--view", Description: "Generate view page"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:filament-page",
		Description: "Create a new Filament page",
		OutputKind:  "filament-page",
		PathPattern: "app/Filament/Pages/{name}.php",
		Namespace:   "App\\Filament\\Pages",
		Flags: []plugins.FlagDef{
			{Name: "--resource", Short: "-R", HasValue: true, Description: "Resource for page"},
			{Name: "--type", HasValue: true, Description: "Page type"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:filament-widget",
		Description: "Create a new Filament widget",
		OutputKind:  "filament-widget",
		PathPattern: "app/Filament/Widgets/{name}.php",
		Namespace:   "App\\Filament\\Widgets",
		Flags: []plugins.FlagDef{
			{Name: "--resource", Short: "-R", HasValue: true, Description: "Resource for widget"},
			{Name: "--chart", Description: "Create chart widget"},
			{Name: "--stats", Description: "Create stats widget"},
			{Name: "--table", Description: "Create table widget"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:filament-relation-manager",
		Description: "Create a new Filament relation manager",
		OutputKind:  "filament-relation",
		PathPattern: "app/Filament/Resources/{name}RelationManager.php",
		Namespace:   "App\\Filament\\Resources",
	})
}

func (p *Plugin) registerNovaCommands() {
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "nova:resource",
		Description: "Create a new Nova resource",
		OutputKind:  "nova-resource",
		PathPattern: "app/Nova/{name}.php",
		Namespace:   "App\\Nova",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "nova:action",
		Description: "Create a new Nova action",
		OutputKind:  "nova-action",
		PathPattern: "app/Nova/Actions/{name}.php",
		Namespace:   "App\\Nova\\Actions",
		Flags: []plugins.FlagDef{
			{Name: "--destructive", Description: "Create destructive action"},
			{Name: "--queued", Description: "Create queued action"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "nova:filter",
		Description: "Create a new Nova filter",
		OutputKind:  "nova-filter",
		PathPattern: "app/Nova/Filters/{name}.php",
		Namespace:   "App\\Nova\\Filters",
		Flags: []plugins.FlagDef{
			{Name: "--boolean", Description: "Create boolean filter"},
			{Name: "--date", Description: "Create date filter"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "nova:lens",
		Description: "Create a new Nova lens",
		OutputKind:  "nova-lens",
		PathPattern: "app/Nova/Lenses/{name}.php",
		Namespace:   "App\\Nova\\Lenses",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "nova:metric",
		Description: "Create a new Nova metric",
		OutputKind:  "nova-metric",
		PathPattern: "app/Nova/Metrics/{name}.php",
		Namespace:   "App\\Nova\\Metrics",
		Flags: []plugins.FlagDef{
			{Name: "--value", Description: "Create value metric"},
			{Name: "--trend", Description: "Create trend metric"},
			{Name: "--partition", Description: "Create partition metric"},
			{Name: "--progress", Description: "Create progress metric"},
			{Name: "--table", Description: "Create table metric"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "nova:card",
		Description: "Create a new Nova card",
		OutputKind:  "nova-card",
		PathPattern: "app/Nova/Cards/{name}.php",
		Namespace:   "App\\Nova\\Cards",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "nova:field",
		Description: "Create a new Nova field",
		OutputKind:  "nova-field",
		PathPattern: "app/Nova/Fields/{name}.php",
		Namespace:   "App\\Nova\\Fields",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "nova:tool",
		Description: "Create a new Nova tool",
		OutputKind:  "nova-tool",
		PathPattern: "app/Nova/Tools/{name}.php",
		Namespace:   "App\\Nova\\Tools",
	})
}
