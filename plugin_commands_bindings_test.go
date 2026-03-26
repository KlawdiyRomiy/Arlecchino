package main

import (
	"testing"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/plugins"
)

type commandBindingStubPlugin struct {
	name       string
	applicable bool
	registry   *plugins.CommandRegistry
}

func (p *commandBindingStubPlugin) Name() string { return p.name }

func (p *commandBindingStubPlugin) Init(projectPath string) error { return nil }

func (p *commandBindingStubPlugin) Close() {}

func (p *commandBindingStubPlugin) IsApplicable(projectPath string) bool {
	return p.applicable
}

func (p *commandBindingStubPlugin) GetAdapter() core.LanguageAdapter { return nil }

func (p *commandBindingStubPlugin) OnFileChanged(path string, content []byte) {}

func (p *commandBindingStubPlugin) OnFileSaved(path string) {}

func (p *commandBindingStubPlugin) Commands() *plugins.CommandRegistry {
	return p.registry
}

func TestGetPluginCommands_ReturnsApplicablePluginCommands(t *testing.T) {
	registry := plugins.NewRegistry()

	laravelRegistry := plugins.NewCommandRegistry()
	laravelRegistry.Register(&plugins.CommandDef{
		Prefix:      "artisan",
		Name:        "make:model",
		Description: "Create a model",
		OutputKind:  "model",
		PathPattern: "app/Models/{name}.php",
		Namespace:   "App\\Models",
		Flags: []plugins.FlagDef{{
			Name:        "--all",
			Short:       "-a",
			Description: "Generate everything",
			HasValue:    false,
		}},
	})

	djangoRegistry := plugins.NewCommandRegistry()
	djangoRegistry.Register(&plugins.CommandDef{
		Prefix:      "manage.py",
		Name:        "runserver",
		Description: "Run development server",
	})

	registry.Register(&commandBindingStubPlugin{
		name:       "laravel",
		applicable: true,
		registry:   laravelRegistry,
	})
	registry.Register(&commandBindingStubPlugin{
		name:       "django",
		applicable: false,
		registry:   djangoRegistry,
	})

	app := &App{plugins: registry, projectPath: "/tmp/project"}

	commands := app.GetPluginCommands()
	if len(commands) != 1 {
		t.Fatalf("GetPluginCommands len = %d, want 1", len(commands))
	}

	command := commands[0]
	if command.Plugin != "laravel" {
		t.Fatalf("command.Plugin = %q, want laravel", command.Plugin)
	}
	if command.Prefix != "artisan" || command.Name != "make:model" {
		t.Fatalf("command = %#v, want artisan make:model", command)
	}
	if len(command.Flags) != 1 {
		t.Fatalf("command.Flags len = %d, want 1", len(command.Flags))
	}
	if command.Flags[0].Name != "--all" || command.Flags[0].Short != "-a" {
		t.Fatalf("command.Flags[0] = %#v, want --all/-a", command.Flags[0])
	}
}
