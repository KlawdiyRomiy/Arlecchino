package mcp

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	settingsFileName       = "mcp-settings.json"
	settingsVersion        = 1
	envMCPSettingsPath     = "ARLECCHINO_MCP_SETTINGS_PATH"
	maxDisabledToolEntries = 512
	maxToolNameLength      = 160
)

type Settings struct {
	Version                   int      `json:"version"`
	Enabled                   bool     `json:"enabled"`
	ApprovalRequired          bool     `json:"approvalRequired"`
	DefaultApprovalTTLSeconds int      `json:"defaultApprovalTtlSeconds"`
	DisabledTools             []string `json:"disabledTools"`
}

type ToolSettingsEntry struct {
	Name             string `json:"name"`
	Description      string `json:"description"`
	Group            string `json:"group"`
	Enabled          bool   `json:"enabled"`
	EffectiveEnabled bool   `json:"effectiveEnabled"`
}

func DefaultSettings() Settings {
	return Settings{
		Version:                   settingsVersion,
		Enabled:                   true,
		ApprovalRequired:          true,
		DefaultApprovalTTLSeconds: defaultApprovalTTLSeconds,
		DisabledTools:             []string{},
	}
}

func DefaultSettingsPath() string {
	if override := strings.TrimSpace(os.Getenv(envMCPSettingsPath)); override != "" {
		if filepath.IsAbs(override) {
			return override
		}
		if configDir, err := os.UserConfigDir(); err == nil && strings.TrimSpace(configDir) != "" {
			return filepath.Join(configDir, "arlecchino", override)
		}
		if absOverride, err := filepath.Abs(override); err == nil {
			return absOverride
		}
		return override
	}

	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return filepath.Join(os.TempDir(), "arlecchino", settingsFileName)
	}
	return filepath.Join(configDir, "arlecchino", settingsFileName)
}

func LoadSettings(path string) (Settings, string, error) {
	resolvedPath := strings.TrimSpace(path)
	if resolvedPath == "" {
		resolvedPath = DefaultSettingsPath()
	}

	settings := DefaultSettings()
	if err := readJSONFile(resolvedPath, &settings); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return settings, resolvedPath, nil
		}
		return Settings{}, resolvedPath, err
	}

	return NormalizeSettings(settings), resolvedPath, nil
}

func SaveSettings(path string, settings Settings) (Settings, string, error) {
	resolvedPath := strings.TrimSpace(path)
	if resolvedPath == "" {
		resolvedPath = DefaultSettingsPath()
	}

	normalized := NormalizeSettings(settings)
	if err := writeJSONFile(resolvedPath, normalized); err != nil {
		return Settings{}, resolvedPath, err
	}
	return normalized, resolvedPath, nil
}

func NormalizeSettings(settings Settings) Settings {
	defaults := DefaultSettings()
	if settings.Version <= 0 {
		settings.Version = defaults.Version
	}
	if settings.DefaultApprovalTTLSeconds <= 0 {
		settings.DefaultApprovalTTLSeconds = defaults.DefaultApprovalTTLSeconds
	}
	settings.DefaultApprovalTTLSeconds = normalizeApprovalTTLWithDefault(
		settings.DefaultApprovalTTLSeconds,
		defaults.DefaultApprovalTTLSeconds,
	)
	settings.DisabledTools = normalizeDisabledTools(settings.DisabledTools)
	return settings
}

func normalizeDisabledTools(tools []string) []string {
	if len(tools) == 0 {
		return []string{}
	}

	seen := make(map[string]struct{}, len(tools))
	normalized := make([]string, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool)
		if name == "" {
			continue
		}
		if len(name) > maxToolNameLength {
			name = name[:maxToolNameLength]
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		normalized = append(normalized, name)
		if len(normalized) >= maxDisabledToolEntries {
			break
		}
	}
	sort.Strings(normalized)
	return normalized
}

func (settings Settings) disabledToolSet() map[string]struct{} {
	disabled := make(map[string]struct{}, len(settings.DisabledTools))
	for _, tool := range settings.DisabledTools {
		name := strings.TrimSpace(tool)
		if name != "" {
			disabled[name] = struct{}{}
		}
	}
	return disabled
}

func (settings Settings) ToolEnabled(name string) bool {
	if !settings.Enabled {
		return false
	}
	_, disabled := settings.disabledToolSet()[strings.TrimSpace(name)]
	return !disabled
}

func BuildToolSettingsEntries(settings Settings) []ToolSettingsEntry {
	normalized := NormalizeSettings(settings)
	disabled := normalized.disabledToolSet()
	definitions := AllToolDefinitions()
	entries := make([]ToolSettingsEntry, 0, len(definitions))

	for _, definition := range definitions {
		name := strings.TrimSpace(definition.Name)
		if name == "" {
			continue
		}
		_, isDisabled := disabled[name]
		toolEnabled := !isDisabled
		entries = append(entries, ToolSettingsEntry{
			Name:             name,
			Description:      definition.Description,
			Group:            ToolGroupForName(name),
			Enabled:          toolEnabled,
			EffectiveEnabled: normalized.Enabled && toolEnabled,
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Group != entries[j].Group {
			return entries[i].Group < entries[j].Group
		}
		return entries[i].Name < entries[j].Name
	})

	return entries
}

func ToolGroupForName(name string) string {
	switch {
	case strings.HasPrefix(name, "ide_control."):
		return "IDE Control"
	case strings.HasPrefix(name, "ide_backend."):
		return "IDE Backend"
	case strings.HasPrefix(name, "ide_ui."):
		return "IDE UI"
	case strings.HasPrefix(name, "change_journal."):
		return "Change Journal"
	case strings.HasPrefix(name, "agent_memory."):
		return "Agent Memory"
	case strings.HasPrefix(name, "agent_skills."):
		return "Agent Skills"
	default:
		return "Other"
	}
}
