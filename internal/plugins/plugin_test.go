package plugins

import (
	"sync/atomic"
	"testing"

	"arlecchino/internal/indexer/core"
)

type stubPlugin struct {
	name       string
	applicable bool
	applyCalls atomic.Int32
	closeCalls atomic.Int32
}

func (p *stubPlugin) Name() string { return p.name }

func (p *stubPlugin) Init(projectPath string) error { return nil }

func (p *stubPlugin) Close() { p.closeCalls.Add(1) }

func (p *stubPlugin) IsApplicable(projectPath string) bool {
	p.applyCalls.Add(1)
	return p.applicable
}

func (p *stubPlugin) GetAdapter() core.LanguageAdapter { return nil }

func (p *stubPlugin) OnFileChanged(path string, content []byte) {}

func (p *stubPlugin) OnFileSaved(path string) {}

type stubTerminalPlugin struct {
	*stubPlugin
	parsed *ParsedCommand
}

type stubCommandsPlugin struct {
	*stubPlugin
	registry *CommandRegistry
}

func (p *stubCommandsPlugin) Commands() *CommandRegistry {
	return p.registry
}

func (p *stubTerminalPlugin) ParseCommand(input string) *ParsedCommand {
	if p.parsed != nil {
		return p.parsed
	}
	return &ParsedCommand{Valid: true, Prefix: p.name}
}

func (p *stubTerminalPlugin) SuggestCommand(input string) []CommandSuggestion { return nil }

func (p *stubTerminalPlugin) UpdatePrediction(input string) {}

func (p *stubTerminalPlugin) ConfirmPrediction(input string) {}

func (p *stubTerminalPlugin) CancelPrediction() {}

func (p *stubTerminalPlugin) GetPendingEntry(name string) *PendingEntry { return nil }

func (p *stubTerminalPlugin) SearchPending(prefix string) []*PendingEntry { return nil }

func (p *stubTerminalPlugin) SearchClasses(prefix string) []ClassResult { return nil }

func TestRegistry_GetApplicable_CachesApplicability(t *testing.T) {
	r := NewRegistry()
	common := &stubPlugin{name: "common", applicable: true}
	laravel := &stubPlugin{name: "laravel", applicable: true}
	django := &stubPlugin{name: "django", applicable: false}
	r.Register(common)
	r.Register(laravel)
	r.Register(django)

	if got := len(r.GetApplicable("/tmp/project")); got != 2 {
		t.Fatalf("first GetApplicable len = %d, want 2", got)
	}
	if got := len(r.GetApplicable("/tmp/project")); got != 2 {
		t.Fatalf("second GetApplicable len = %d, want 2", got)
	}

	if got := common.applyCalls.Load(); got != 1 {
		t.Errorf("common IsApplicable calls = %d, want 1", got)
	}
	if got := laravel.applyCalls.Load(); got != 1 {
		t.Errorf("laravel IsApplicable calls = %d, want 1", got)
	}
	if got := django.applyCalls.Load(); got != 1 {
		t.Errorf("django IsApplicable calls = %d, want 1", got)
	}
}

func TestRegistry_GetApplicable_CacheIsProjectScoped(t *testing.T) {
	r := NewRegistry()
	plugin := &stubPlugin{name: "laravel", applicable: true}
	r.Register(plugin)

	r.GetApplicable("/tmp/project-a")
	r.GetApplicable("/tmp/project-a")
	r.GetApplicable("/tmp/project-b")

	if got := plugin.applyCalls.Load(); got != 2 {
		t.Errorf("IsApplicable calls across two project paths = %d, want 2", got)
	}
}

func TestRegistry_GetTerminalPlugin_UsesCachedApplicability(t *testing.T) {
	r := NewRegistry()
	common := &stubPlugin{name: "common", applicable: true}
	laravel := &stubTerminalPlugin{stubPlugin: &stubPlugin{name: "laravel", applicable: true}}
	r.Register(common)
	r.Register(laravel)

	first := r.GetTerminalPlugin("/tmp/project")
	second := r.GetTerminalPlugin("/tmp/project")
	if first == nil || second == nil {
		t.Fatalf("GetTerminalPlugin returned nil")
	}
	if first.Name() != "laravel" || second.Name() != "laravel" {
		t.Fatalf("terminal plugin = %q / %q, want laravel", first.Name(), second.Name())
	}

	if got := common.applyCalls.Load(); got != 1 {
		t.Errorf("common IsApplicable calls = %d, want 1", got)
	}
	if got := laravel.applyCalls.Load(); got != 1 {
		t.Errorf("laravel IsApplicable calls = %d, want 1", got)
	}
}

func TestRegistry_CloseAll_ClearsApplicabilityCache(t *testing.T) {
	r := NewRegistry()
	plugin := &stubPlugin{name: "laravel", applicable: true}
	r.Register(plugin)

	r.GetApplicable("/tmp/project")
	r.GetApplicable("/tmp/project")
	r.CloseAll()
	r.GetApplicable("/tmp/project")

	if got := plugin.applyCalls.Load(); got != 2 {
		t.Errorf("IsApplicable calls after CloseAll = %d, want 2", got)
	}
	if got := plugin.closeCalls.Load(); got != 1 {
		t.Errorf("Close calls = %d, want 1", got)
	}
}

func TestRegistry_DetectFramework_PrefersSpecificOverCommon(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubPlugin{name: "common", applicable: true})
	r.Register(&stubPlugin{name: "laravel", applicable: true})
	r.Register(&stubPlugin{name: "django", applicable: false})

	if got := r.DetectFramework("/tmp/project"); got != "laravel" {
		t.Fatalf("DetectFramework = %q, want laravel", got)
	}
}

func TestRegistry_DetectFramework_FallsBackToCommon(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubPlugin{name: "common", applicable: true})
	r.Register(&stubPlugin{name: "laravel", applicable: false})

	if got := r.DetectFramework("/tmp/project"); got != "common" {
		t.Fatalf("DetectFramework = %q, want common", got)
	}
}

func TestRegistry_ParseCommand_PrefersFirstValidTerminalPlugin(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubPlugin{name: "common", applicable: true})
	r.Register(&stubTerminalPlugin{
		stubPlugin: &stubPlugin{name: "django", applicable: true},
		parsed:     &ParsedCommand{Valid: false, Prefix: "django"},
	})
	r.Register(&stubTerminalPlugin{
		stubPlugin: &stubPlugin{name: "laravel", applicable: true},
		parsed: &ParsedCommand{
			Valid:   true,
			Prefix:  "laravel",
			Command: "make:model",
		},
	})

	parsed := r.ParseCommand("/tmp/project", "php artisan make:model User")
	if parsed == nil {
		t.Fatal("ParseCommand returned nil")
	}
	if parsed.Prefix != "laravel" || parsed.Command != "make:model" {
		t.Fatalf("ParseCommand = %#v, want laravel make:model", parsed)
	}
}

func TestRegistry_GetAllCommands_AggregatesApplicableCommandProviders(t *testing.T) {
	r := NewRegistry()

	laravelRegistry := NewCommandRegistry()
	laravelRegistry.Register(&CommandDef{
		Prefix:      "artisan",
		Name:        "make:model",
		Description: "Create a model",
	})

	djangoRegistry := NewCommandRegistry()
	djangoRegistry.Register(&CommandDef{
		Prefix:      "manage.py",
		Name:        "makemigrations",
		Description: "Create migrations",
	})

	r.Register(&stubCommandsPlugin{
		stubPlugin: &stubPlugin{name: "laravel", applicable: true},
		registry:   laravelRegistry,
	})
	r.Register(&stubCommandsPlugin{
		stubPlugin: &stubPlugin{name: "django", applicable: false},
		registry:   djangoRegistry,
	})

	commands := r.GetAllCommands("/tmp/project")
	if len(commands) != 1 {
		t.Fatalf("GetAllCommands len = %d, want 1", len(commands))
	}

	if commands[0].Prefix != "artisan" || commands[0].Name != "make:model" {
		t.Fatalf("GetAllCommands[0] = %#v, want artisan make:model", commands[0])
	}
}
