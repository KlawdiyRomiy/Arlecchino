package laravel

import "arlecchino/internal/plugins"

func (p *Plugin) registerComposerCommands() {
	// Initialize project
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "init",
		Description: "Create a new composer.json file",
		Flags: []plugins.FlagDef{
			{Name: "--name", HasValue: true, Description: "Package name"},
			{Name: "--description", HasValue: true, Description: "Package description"},
			{Name: "--author", HasValue: true, Description: "Package author"},
			{Name: "--type", HasValue: true, Description: "Package type"},
			{Name: "--homepage", HasValue: true, Description: "Package homepage"},
			{Name: "--require", HasValue: true, Description: "Required packages"},
			{Name: "--require-dev", HasValue: true, Description: "Dev required packages"},
			{Name: "--stability", Short: "-s", HasValue: true, Description: "Minimum stability"},
			{Name: "--license", Short: "-l", HasValue: true, Description: "License"},
			{Name: "--autoload", HasValue: true, Description: "Autoload settings"},
		},
	})

	// Package management
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "require",
		Description: "Add a package to composer.json",
		OutputKind:  "package",
		PathPattern: "vendor/{name}",
		Flags: []plugins.FlagDef{
			{Name: "--dev", Description: "Add as dev dependency"},
			{Name: "--no-update", Description: "Don't run update"},
			{Name: "--no-install", Description: "Don't install packages"},
			{Name: "--no-scripts", Description: "Skip scripts"},
			{Name: "--no-progress", Description: "Hide progress"},
			{Name: "--prefer-dist", Description: "Prefer dist packages"},
			{Name: "--prefer-source", Description: "Prefer source packages"},
			{Name: "--prefer-stable", Description: "Prefer stable versions"},
			{Name: "--prefer-lowest", Description: "Prefer lowest versions"},
			{Name: "--sort-packages", Description: "Sort packages"},
			{Name: "--with-dependencies", Short: "-W", Description: "Update with dependencies"},
			{Name: "--with-all-dependencies", Description: "Update all dependencies"},
			{Name: "--dry-run", Description: "Dry run"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "remove",
		Description: "Remove a package from composer.json",
		Flags: []plugins.FlagDef{
			{Name: "--dev", Description: "Remove from dev dependencies"},
			{Name: "--no-update", Description: "Don't run update"},
			{Name: "--no-install", Description: "Don't install packages"},
			{Name: "--no-scripts", Description: "Skip scripts"},
			{Name: "--no-progress", Description: "Hide progress"},
			{Name: "--update-with-dependencies", Short: "-W", Description: "Update dependencies"},
			{Name: "--update-with-all-dependencies", Description: "Update all dependencies"},
			{Name: "--unused", Description: "Remove unused dependencies"},
			{Name: "--dry-run", Description: "Dry run"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "update",
		Description: "Update dependencies",
		Flags: []plugins.FlagDef{
			{Name: "--dev", Description: "Update dev dependencies only"},
			{Name: "--no-dev", Description: "Skip dev dependencies"},
			{Name: "--prefer-dist", Description: "Prefer dist packages"},
			{Name: "--prefer-source", Description: "Prefer source packages"},
			{Name: "--prefer-stable", Description: "Prefer stable versions"},
			{Name: "--prefer-lowest", Description: "Prefer lowest versions"},
			{Name: "--lock", Description: "Only update lock file"},
			{Name: "--with-dependencies", Short: "-W", Description: "Update with dependencies"},
			{Name: "--with-all-dependencies", Description: "Update all dependencies"},
			{Name: "--dry-run", Description: "Show what would be updated"},
			{Name: "--no-install", Description: "Don't install packages"},
			{Name: "--no-scripts", Description: "Skip scripts"},
			{Name: "--no-progress", Description: "Hide progress"},
			{Name: "--minimal-changes", Description: "Minimal changes only"},
			{Name: "--interactive", Description: "Interactive mode"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "install",
		Description: "Install dependencies from lock file",
		Flags: []plugins.FlagDef{
			{Name: "--dev", Description: "Install dev dependencies"},
			{Name: "--no-dev", Description: "Skip dev dependencies"},
			{Name: "--prefer-dist", Description: "Prefer dist packages"},
			{Name: "--prefer-source", Description: "Prefer source packages"},
			{Name: "--dry-run", Description: "Show what would be installed"},
			{Name: "--no-scripts", Description: "Skip scripts"},
			{Name: "--no-plugins", Description: "Skip plugins"},
			{Name: "--no-progress", Description: "Hide progress"},
			{Name: "--no-autoloader", Description: "Skip autoloader generation"},
			{Name: "--optimize-autoloader", Short: "-o", Description: "Optimize autoloader"},
			{Name: "--classmap-authoritative", Short: "-a", Description: "Authoritative classmap"},
			{Name: "--apcu-autoloader", Description: "Use APCu autoloader"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "dump-autoload",
		Description: "Regenerate autoload files",
		Flags: []plugins.FlagDef{
			{Name: "--optimize", Short: "-o", Description: "Optimize autoloader"},
			{Name: "--classmap-authoritative", Short: "-a", Description: "Authoritative classmap"},
			{Name: "--apcu", Description: "Use APCu autoloader"},
			{Name: "--apcu-prefix", HasValue: true, Description: "APCu cache prefix"},
			{Name: "--no-scripts", Description: "Skip scripts"},
			{Name: "--no-dev", Description: "Skip dev autoload"},
			{Name: "--strict-psr", Description: "Strict PSR-4 validation"},
			{Name: "--dry-run", Description: "Dry run"},
		},
	})

	// Info commands
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "show",
		Description: "Show package information",
		Flags: []plugins.FlagDef{
			{Name: "--all", Short: "-a", Description: "Show all packages"},
			{Name: "--installed", Short: "-i", Description: "Show installed packages"},
			{Name: "--locked", Description: "Show locked packages"},
			{Name: "--platform", Short: "-p", Description: "Show platform packages"},
			{Name: "--available", Description: "Show available packages"},
			{Name: "--self", Short: "-s", Description: "Show root package"},
			{Name: "--name-only", Short: "-N", Description: "Show names only"},
			{Name: "--path", Short: "-P", Description: "Show package paths"},
			{Name: "--tree", Short: "-t", Description: "Show as tree"},
			{Name: "--latest", Short: "-l", Description: "Show latest version"},
			{Name: "--outdated", Short: "-o", Description: "Show outdated packages"},
			{Name: "--direct", Short: "-D", Description: "Show direct dependencies"},
			{Name: "--strict", Description: "Return non-zero exit code"},
			{Name: "--no-dev", Description: "Skip dev dependencies"},
			{Name: "--format", HasValue: true, Description: "Output format"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "search",
		Description: "Search for packages",
		Flags: []plugins.FlagDef{
			{Name: "--only-name", Short: "-N", Description: "Search only in name"},
			{Name: "--only-vendor", Short: "-O", Description: "Search only in vendor"},
			{Name: "--type", Short: "-t", HasValue: true, Description: "Filter by type"},
			{Name: "--format", HasValue: true, Description: "Output format"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "outdated",
		Description: "Show outdated packages",
		Flags: []plugins.FlagDef{
			{Name: "--all", Short: "-a", Description: "Show all packages"},
			{Name: "--direct", Short: "-D", Description: "Show direct dependencies only"},
			{Name: "--strict", Description: "Return non-zero exit code"},
			{Name: "--minor-only", Short: "-m", Description: "Show minor updates only"},
			{Name: "--patch-only", Description: "Show patch updates only"},
			{Name: "--major-only", Short: "-M", Description: "Show major updates only"},
			{Name: "--format", HasValue: true, Description: "Output format"},
			{Name: "--no-dev", Description: "Skip dev dependencies"},
			{Name: "--locked", Description: "Check locked versions"},
			{Name: "--sort-by-age", Description: "Sort by release date"},
			{Name: "--ignore", HasValue: true, Description: "Ignore packages"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "depends",
		Description: "Show which packages depend on a package",
		Flags: []plugins.FlagDef{
			{Name: "--recursive", Short: "-r", Description: "Recursively resolve"},
			{Name: "--tree", Short: "-t", Description: "Show as tree"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "prohibits",
		Description: "Show which packages prevent a package",
		Flags: []plugins.FlagDef{
			{Name: "--recursive", Short: "-r", Description: "Recursively resolve"},
			{Name: "--tree", Short: "-t", Description: "Show as tree"},
		},
	})

	// Validation and diagnostics
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "validate",
		Description: "Validate composer.json",
		Flags: []plugins.FlagDef{
			{Name: "--no-check-all", Description: "Skip all checks"},
			{Name: "--no-check-lock", Description: "Skip lock check"},
			{Name: "--check-lock", Description: "Check lock file"},
			{Name: "--no-check-publish", Description: "Skip publish check"},
			{Name: "--no-check-version", Description: "Skip version check"},
			{Name: "--with-dependencies", Short: "-A", Description: "Check dependencies"},
			{Name: "--strict", Description: "Strict validation"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "status",
		Description: "Show modified packages",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "diagnose",
		Description: "Diagnose system problems",
		Flags: []plugins.FlagDef{
			{Name: "--format", HasValue: true, Description: "Output format"},
		},
	})

	// Configuration
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "config",
		Description: "Set config options",
		Flags: []plugins.FlagDef{
			{Name: "--global", Short: "-g", Description: "Apply globally"},
			{Name: "--editor", Short: "-e", Description: "Open in editor"},
			{Name: "--auth", Short: "-a", Description: "Edit auth.json"},
			{Name: "--list", Short: "-l", Description: "List config"},
			{Name: "--unset", Description: "Unset value"},
			{Name: "--file", HasValue: true, Description: "Config file"},
			{Name: "--absolute", Description: "Absolute paths"},
			{Name: "--json", Short: "-j", Description: "JSON format"},
			{Name: "--merge", Short: "-m", Description: "Merge values"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "global",
		Description: "Run commands in global composer directory",
	})

	// Self management
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "self-update",
		Description: "Update composer itself",
		Flags: []plugins.FlagDef{
			{Name: "--rollback", Short: "-r", Description: "Rollback to previous"},
			{Name: "--clean-backups", Description: "Delete old backups"},
			{Name: "--no-progress", Description: "Hide progress"},
			{Name: "--stable", Description: "Force stable channel"},
			{Name: "--preview", Description: "Force preview channel"},
			{Name: "--snapshot", Description: "Force snapshot channel"},
			{Name: "--1", Description: "Force version 1.x"},
			{Name: "--2", Description: "Force version 2.x"},
		},
	})

	// Project creation
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "create-project",
		Description: "Create new project from package",
		Flags: []plugins.FlagDef{
			{Name: "--stability", Short: "-s", HasValue: true, Description: "Minimum stability"},
			{Name: "--prefer-dist", Description: "Prefer dist packages"},
			{Name: "--prefer-source", Description: "Prefer source packages"},
			{Name: "--repository", HasValue: true, Description: "Custom repository"},
			{Name: "--add-repository", Description: "Add repository to config"},
			{Name: "--dev", Description: "Install dev dependencies"},
			{Name: "--no-dev", Description: "Skip dev dependencies"},
			{Name: "--no-scripts", Description: "Skip scripts"},
			{Name: "--no-progress", Description: "Hide progress"},
			{Name: "--no-secure-http", Description: "Allow HTTP"},
			{Name: "--keep-vcs", Description: "Keep VCS history"},
			{Name: "--remove-vcs", Description: "Remove VCS directory"},
			{Name: "--no-install", Description: "Don't install dependencies"},
		},
	})

	// Caching
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "clear-cache",
		Description: "Clear composer cache",
	})

	// Scripts
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "run-script",
		Description: "Run a script from composer.json",
		Flags: []plugins.FlagDef{
			{Name: "--list", Short: "-l", Description: "List scripts"},
			{Name: "--timeout", HasValue: true, Description: "Set timeout"},
			{Name: "--dev", Description: "Set dev mode"},
			{Name: "--no-dev", Description: "Disable dev mode"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "exec",
		Description: "Execute vendored binary",
		Flags: []plugins.FlagDef{
			{Name: "--list", Short: "-l", Description: "List binaries"},
		},
	})

	// Licensing
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "licenses",
		Description: "Show dependency licenses",
		Flags: []plugins.FlagDef{
			{Name: "--format", HasValue: true, Description: "Output format"},
			{Name: "--no-dev", Description: "Skip dev dependencies"},
		},
	})

	// Help
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "help",
		Description: "Display help for a command",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "list",
		Description: "List all available commands",
		Flags: []plugins.FlagDef{
			{Name: "--format", HasValue: true, Description: "Output format"},
			{Name: "--raw", Description: "Raw command list"},
		},
	})

	// Aliases
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "i",
		Description: "Install dependencies (alias)",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "u",
		Description: "Update dependencies (alias)",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "why",
		Description: "Show why package is installed (alias for depends)",
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "composer",
		Name:        "why-not",
		Description: "Show why package cannot be installed (alias for prohibits)",
	})
}
