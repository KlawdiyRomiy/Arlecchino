package ai

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"arlecchino/internal/ai/providers"
)

const (
	settingsFileName   = "ai-provider-settings.json"
	settingsVersion    = 1
	envAISettingsPath  = "ARLECCHINO_AI_SETTINGS_PATH"
	maxProviderConfigs = 64
)

type Settings struct {
	Version                int                            `json:"version"`
	Enabled                bool                           `json:"enabled"`
	ActiveProviderID       string                         `json:"activeProviderId,omitempty"`
	ActiveModel            string                         `json:"activeModel,omitempty"`
	MnemonicDefaultEnabled bool                           `json:"mnemonicDefaultEnabled"`
	ApprovalPolicy         AIApprovalPolicy               `json:"approvalPolicy"`
	ConsentPolicy          AIConsentPolicy                `json:"consentPolicy"`
	Providers              []providers.AIProviderSettings `json:"providers"`
}

func DefaultSettings() Settings {
	return Settings{
		Version:                settingsVersion,
		Enabled:                true,
		MnemonicDefaultEnabled: true,
		ApprovalPolicy:         DefaultApprovalPolicy(),
		ConsentPolicy:          DefaultConsentPolicy(),
		Providers:              []providers.AIProviderSettings{},
	}
}

func DefaultSettingsPath() string {
	if override := strings.TrimSpace(os.Getenv(envAISettingsPath)); override != "" {
		if filepath.IsAbs(override) {
			return override
		}
		if configDir, err := os.UserConfigDir(); err == nil && strings.TrimSpace(configDir) != "" {
			return filepath.Join(configDir, "arlecchino", override)
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
	resolved := strings.TrimSpace(path)
	if resolved == "" {
		resolved = DefaultSettingsPath()
	}
	settings := DefaultSettings()
	data, err := os.ReadFile(resolved)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return settings, resolved, nil
		}
		return Settings{}, resolved, err
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return Settings{}, resolved, err
	}
	return NormalizeSettings(settings), resolved, nil
}

func SaveSettings(path string, settings Settings) (Settings, string, error) {
	resolved := strings.TrimSpace(path)
	if resolved == "" {
		resolved = DefaultSettingsPath()
	}
	normalized := NormalizeSettings(settings)
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return Settings{}, resolved, err
	}
	dir := filepath.Dir(resolved)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Settings{}, resolved, err
	}
	tmp, err := os.CreateTemp(dir, ".ai-provider-settings-*.tmp")
	if err != nil {
		return Settings{}, resolved, err
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		_ = tmp.Close()
		return Settings{}, resolved, err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return Settings{}, resolved, err
	}
	if err := tmp.Close(); err != nil {
		return Settings{}, resolved, err
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		return Settings{}, resolved, err
	}
	if err := os.Rename(tmpPath, resolved); err != nil {
		return Settings{}, resolved, err
	}
	cleanup = false
	if dirFile, err := os.Open(dir); err == nil {
		_ = dirFile.Sync()
		_ = dirFile.Close()
	}
	return normalized, resolved, nil
}

func NormalizeSettings(settings Settings) Settings {
	defaults := DefaultSettings()
	if settings.Version <= 0 {
		settings.Version = defaults.Version
		settings.Enabled = defaults.Enabled
		settings.MnemonicDefaultEnabled = defaults.MnemonicDefaultEnabled
	}
	settings.ApprovalPolicy = normalizeApprovalPolicy(settings.ApprovalPolicy)
	settings.ConsentPolicy = normalizeConsentPolicy(settings.ConsentPolicy)
	seen := make(map[string]struct{}, len(settings.Providers))
	providersOut := make([]providers.AIProviderSettings, 0, min(len(settings.Providers), maxProviderConfigs))
	for _, provider := range settings.Providers {
		provider = normalizeProviderSettings(provider)
		if provider.ID == "" || provider.Kind == "" {
			continue
		}
		if _, ok := seen[provider.ID]; ok {
			continue
		}
		seen[provider.ID] = struct{}{}
		providersOut = append(providersOut, provider)
		if len(providersOut) >= maxProviderConfigs {
			break
		}
	}
	sort.Slice(providersOut, func(i, j int) bool { return providersOut[i].ID < providersOut[j].ID })
	settings.Providers = providersOut
	settings.ActiveProviderID = strings.TrimSpace(settings.ActiveProviderID)
	settings.ActiveModel = strings.TrimSpace(settings.ActiveModel)
	return settings
}

func normalizeProviderSettings(provider providers.AIProviderSettings) providers.AIProviderSettings {
	provider.ID = strings.TrimSpace(provider.ID)
	provider.Name = strings.TrimSpace(provider.Name)
	provider.Kind = strings.TrimSpace(provider.Kind)
	provider.Endpoint = strings.TrimRight(strings.TrimSpace(provider.Endpoint), "/")
	provider.Model = strings.TrimSpace(provider.Model)
	provider.SecretRef = strings.TrimSpace(provider.SecretRef)
	provider.SecretValue = strings.TrimSpace(provider.SecretValue)
	provider.AuthMode = providers.AIProviderAuthMode(strings.TrimSpace(string(provider.AuthMode)))
	provider.OAuthClientID = strings.TrimSpace(provider.OAuthClientID)
	provider.Capabilities = normalizeCapabilities(provider.Capabilities)
	if spec, ok := providerSpecForKind(provider.Kind); ok {
		provider.AuthMode = spec.AuthMode
		provider.OAuthSupported = spec.OAuthSupported
		if !spec.OAuthSupported {
			provider.OAuthClientID = ""
		}
	}
	return provider
}

func normalizeCapabilities(input []providers.AIProviderCapability) []providers.AIProviderCapability {
	if len(input) == 0 {
		return providers.DefaultCapabilities()
	}
	seen := map[providers.AIProviderCapability]struct{}{}
	output := make([]providers.AIProviderCapability, 0, len(input))
	for _, capability := range input {
		switch capability {
		case providers.CapabilityCodeCompletion, providers.CapabilityLinePrediction, providers.CapabilityTerminalPrediction, providers.CapabilityChat:
			if _, ok := seen[capability]; !ok {
				seen[capability] = struct{}{}
				output = append(output, capability)
			}
		}
	}
	if len(output) == 0 {
		return providers.DefaultCapabilities()
	}
	return output
}
