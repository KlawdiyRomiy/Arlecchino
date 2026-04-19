package main

import (
	"sort"

	"arlecchino/internal/plugins"
)

type FlagDefJS struct {
	Name        string `json:"name"`
	Short       string `json:"short"`
	Description string `json:"description"`
	HasValue    bool   `json:"hasValue"`
}

type PluginCommandDefJS struct {
	Plugin      string      `json:"plugin"`
	Prefix      string      `json:"prefix"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	OutputKind  string      `json:"outputKind"`
	PathPattern string      `json:"pathPattern"`
	Namespace   string      `json:"namespace"`
	Flags       []FlagDefJS `json:"flags"`
}

func (a *App) GetPluginCommands() []PluginCommandDefJS {
	if a == nil || a.plugins == nil {
		return nil
	}

	projectPath := a.currentProjectPath()
	if projectPath == "" {
		return nil
	}

	commands := make([]PluginCommandDefJS, 0)
	for _, p := range a.plugins.GetApplicable(projectPath) {
		provider, ok := p.(plugins.CommandsProvider)
		if !ok {
			continue
		}

		for _, cmd := range provider.Commands().All() {
			flags := make([]FlagDefJS, 0, len(cmd.Flags))
			for _, flag := range cmd.Flags {
				flags = append(flags, FlagDefJS{
					Name:        flag.Name,
					Short:       flag.Short,
					Description: flag.Description,
					HasValue:    flag.HasValue,
				})
			}

			commands = append(commands, PluginCommandDefJS{
				Plugin:      p.Name(),
				Prefix:      cmd.Prefix,
				Name:        cmd.Name,
				Description: cmd.Description,
				OutputKind:  cmd.OutputKind,
				PathPattern: cmd.PathPattern,
				Namespace:   cmd.Namespace,
				Flags:       flags,
			})
		}
	}

	sort.Slice(commands, func(i, j int) bool {
		if commands[i].Plugin != commands[j].Plugin {
			return commands[i].Plugin < commands[j].Plugin
		}
		if commands[i].Prefix != commands[j].Prefix {
			return commands[i].Prefix < commands[j].Prefix
		}
		return commands[i].Name < commands[j].Name
	})

	return commands
}
