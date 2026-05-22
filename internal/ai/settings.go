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
	Prediction             AIPredictionSettings           `json:"prediction"`
	Providers              []providers.AIProviderSettings `json:"providers"`
}

func DefaultSettings() Settings {
	return Settings{
		Version:                settingsVersion,
		Enabled:                true,
		MnemonicDefaultEnabled: true,
		ApprovalPolicy:         DefaultApprovalPolicy(),
		ConsentPolicy:          DefaultConsentPolicy(),
		Prediction:             DefaultPredictionSettings(),
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
	settings.Prediction = normalizePredictionSettings(settings.Prediction)
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

func DefaultPredictionSettings() AIPredictionSettings {
	return AIPredictionSettings{
		Enabled:         false,
		Mode:            AIPredictionModeOff,
		IdleMs:          600,
		MinIntervalMs:   1200,
		MaxPending:      1,
		MaxOutputTokens: 96,
		MaxPromptBytes:  12 * 1024,
		Budget: AIPredictionBudgetSettings{
			RequestsPerMinute:        20,
			TokensPerMinute:          12_000,
			TokensPerDay:             100_000,
			RequestsPerFilePerMinute: 8,
		},
	}
}

func normalizePredictionSettings(settings AIPredictionSettings) AIPredictionSettings {
	defaults := DefaultPredictionSettings()
	settings.ProviderID = strings.TrimSpace(settings.ProviderID)
	settings.Model = strings.TrimSpace(settings.Model)
	switch settings.Mode {
	case AIPredictionModeSubtle, AIPredictionModeEager:
	default:
		if settings.Enabled {
			settings.Mode = AIPredictionModeSubtle
		} else {
			settings.Mode = AIPredictionModeOff
		}
	}
	if !settings.Enabled {
		settings.Mode = AIPredictionModeOff
	}
	if settings.IdleMs <= 0 {
		settings.IdleMs = defaults.IdleMs
	}
	if settings.IdleMs < 350 {
		settings.IdleMs = 350
	}
	if settings.IdleMs > 5000 {
		settings.IdleMs = 5000
	}
	if settings.MinIntervalMs <= 0 {
		settings.MinIntervalMs = defaults.MinIntervalMs
	}
	if settings.MinIntervalMs < 250 {
		settings.MinIntervalMs = 250
	}
	if settings.MinIntervalMs > 10000 {
		settings.MinIntervalMs = 10000
	}
	if settings.MaxPending <= 0 {
		settings.MaxPending = defaults.MaxPending
	}
	if settings.MaxPending > 2 {
		settings.MaxPending = 2
	}
	if settings.MaxOutputTokens <= 0 {
		settings.MaxOutputTokens = defaults.MaxOutputTokens
	}
	if settings.MaxOutputTokens > 256 {
		settings.MaxOutputTokens = 256
	}
	if settings.MaxPromptBytes <= 0 {
		settings.MaxPromptBytes = defaults.MaxPromptBytes
	}
	if settings.MaxPromptBytes > 48*1024 {
		settings.MaxPromptBytes = 48 * 1024
	}
	if settings.Budget.RequestsPerMinute <= 0 {
		settings.Budget.RequestsPerMinute = defaults.Budget.RequestsPerMinute
	}
	if settings.Budget.TokensPerMinute <= 0 {
		settings.Budget.TokensPerMinute = defaults.Budget.TokensPerMinute
	}
	if settings.Budget.TokensPerDay <= 0 {
		settings.Budget.TokensPerDay = defaults.Budget.TokensPerDay
	}
	if settings.Budget.RequestsPerFilePerMinute <= 0 {
		settings.Budget.RequestsPerFilePerMinute = defaults.Budget.RequestsPerFilePerMinute
	}
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
		case providers.CapabilityCodeCompletion,
			providers.CapabilityLinePrediction,
			providers.CapabilityTerminalPrediction,
			providers.CapabilityChat,
			providers.CapabilityToolCalling,
			providers.CapabilityStructuredOutput,
			providers.CapabilityPatchGeneration:
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
