package ai

import (
	"sort"
	"strings"
	"time"

	"arlecchino/internal/ai/providers"
)

type providerFactory func(setting providers.AIProviderSettings, spec providerSpec, secret string) providers.Provider

type providerSpec struct {
	Kind               string
	Name               string
	DefaultID          string
	DefaultEndpoint    string
	Local              bool
	Frontier           bool
	AuthMode           providers.AIProviderAuthMode
	OAuthSupported     bool
	OAuth              *providerOAuthConfig
	RequiresAuth       bool
	Capabilities       []providers.AIProviderCapability
	DefaultModel       string
	DiscoveryEndpoints []providerDiscoveryEndpoint
	Factory            providerFactory
}

type providerOAuthConfig struct {
	AuthURL      string
	TokenURL     string
	ClientID     string
	Scopes       []string
	RedirectMode string
}

type providerDiscoveryEndpoint struct {
	ID       string
	Name     string
	Endpoint string
}

const localProviderRequestTimeout = 5 * time.Minute

var providerSpecs = map[string]providerSpec{
	"ollama": {
		Kind:            "ollama",
		Name:            "Ollama",
		DefaultID:       "ollama-local",
		DefaultEndpoint: providers.DefaultOllamaEndpoint,
		Local:           true,
		AuthMode:        providers.ProviderAuthModeNone,
		Capabilities:    providers.DefaultCapabilities(),
		DiscoveryEndpoints: []providerDiscoveryEndpoint{
			{ID: "ollama-local", Name: "Ollama", Endpoint: providers.DefaultOllamaEndpoint},
		},
		Factory: func(setting providers.AIProviderSettings, _ providerSpec, _ string) providers.Provider {
			return providers.NewOllamaProvider(setting.ID, setting.Endpoint, setting.Model, setting.Manual, localProviderRequestTimeout)
		},
	},
	"lm-studio": {
		Kind:            "lm-studio",
		Name:            "LM Studio",
		DefaultID:       "lm-studio-local",
		DefaultEndpoint: providers.DefaultLMStudioEndpoint,
		Local:           true,
		AuthMode:        providers.ProviderAuthModeNone,
		Capabilities:    providers.DefaultCapabilities(),
		DiscoveryEndpoints: []providerDiscoveryEndpoint{
			{ID: "lm-studio-local", Name: "LM Studio", Endpoint: providers.DefaultLMStudioEndpoint},
		},
		Factory: newOpenAICompatibleLocalProvider,
	},
	"llama.cpp": {
		Kind:            "llama.cpp",
		Name:            "llama.cpp",
		DefaultID:       "llama-cpp-local",
		DefaultEndpoint: providers.DefaultLlamaEndpoint,
		Local:           true,
		AuthMode:        providers.ProviderAuthModeNone,
		Capabilities:    providers.DefaultCapabilities(),
		DiscoveryEndpoints: []providerDiscoveryEndpoint{
			{ID: "llama-cpp-local", Name: "llama.cpp", Endpoint: providers.DefaultLlamaEndpoint},
		},
		Factory: newOpenAICompatibleLocalProvider,
	},
	"huggingface-tgi": {
		Kind:            "huggingface-tgi",
		Name:            "Hugging Face TGI",
		DefaultID:       "huggingface-tgi-local",
		DefaultEndpoint: providers.DefaultTGIEndpoint,
		Local:           true,
		AuthMode:        providers.ProviderAuthModeNone,
		Capabilities:    providers.DefaultCapabilities(),
		DiscoveryEndpoints: []providerDiscoveryEndpoint{
			{ID: "huggingface-tgi-local", Name: "Hugging Face TGI", Endpoint: providers.DefaultTGIEndpoint},
			{ID: "huggingface-tgi-8080-local", Name: "Hugging Face TGI", Endpoint: providers.DefaultLlamaEndpoint},
		},
		Factory: newOpenAICompatibleLocalProvider,
	},
	"openai-compatible": {
		Kind:           "openai-compatible",
		Name:           "OpenAI-compatible",
		DefaultID:      "openai-compatible-byok",
		Local:          false,
		Frontier:       false,
		AuthMode:       providers.ProviderAuthModeAPIKey,
		OAuthSupported: false,
		RequiresAuth:   true,
		Capabilities:   providers.DefaultCapabilities(),
		Factory:        newOpenAICompatibleRemoteBYOKProvider,
	},
	"openrouter": {
		Kind:            "openrouter",
		Name:            "OpenRouter",
		DefaultID:       "openrouter-byok",
		DefaultEndpoint: providers.DefaultOpenRouterEndpoint,
		Local:           false,
		Frontier:        false,
		AuthMode:        providers.ProviderAuthModeAPIKey,
		OAuthSupported:  false,
		RequiresAuth:    true,
		Capabilities:    cloudProviderCapabilities(),
		Factory:         newOpenAICompatibleRemoteBYOKProvider,
	},
	"openai": {
		Kind:            "openai",
		Name:            "OpenAI",
		DefaultID:       "openai-frontier",
		DefaultEndpoint: providers.DefaultOpenAIEndpoint,
		Frontier:        true,
		AuthMode:        providers.ProviderAuthModeAPIKey,
		OAuthSupported:  false,
		RequiresAuth:    true,
		Capabilities:    cloudProviderCapabilities(),
		Factory:         newOpenAICompatibleFrontierProvider,
	},
	"anthropic": {
		Kind:            "anthropic",
		Name:            "Anthropic",
		DefaultID:       "anthropic-frontier",
		DefaultEndpoint: providers.DefaultAnthropicEndpoint,
		Frontier:        true,
		AuthMode:        providers.ProviderAuthModeAPIKey,
		OAuthSupported:  false,
		RequiresAuth:    true,
		Capabilities:    cloudProviderCapabilities(),
		Factory:         newAnthropicProvider,
	},
	"google-gemini": {
		Kind:            "google-gemini",
		Name:            "Google Gemini",
		DefaultID:       "google-gemini-frontier",
		DefaultEndpoint: providers.DefaultGeminiEndpoint,
		Frontier:        true,
		AuthMode:        providers.ProviderAuthModeAPIKey,
		OAuthSupported:  false,
		RequiresAuth:    true,
		Capabilities:    cloudProviderCapabilities(),
		Factory:         newGeminiProvider,
	},
}

var providerSpecOrder = []string{
	"ollama",
	"lm-studio",
	"llama.cpp",
	"huggingface-tgi",
	"openai-compatible",
	"openrouter",
	"openai",
	"anthropic",
	"google-gemini",
}

func newOpenAICompatibleLocalProvider(setting providers.AIProviderSettings, spec providerSpec, _ string) providers.Provider {
	return providers.NewOpenAICompatibleProvider(providers.OpenAICompatibleOptions{
		ID:       setting.ID,
		Name:     firstNonEmpty(setting.Name, spec.Name),
		Kind:     setting.Kind,
		Endpoint: firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint),
		Model:    setting.Model,
		Manual:   setting.Manual,
		Local:    true,
		Timeout:  localProviderRequestTimeout,
	})
}

func newOpenAICompatibleRemoteBYOKProvider(setting providers.AIProviderSettings, spec providerSpec, secret string) providers.Provider {
	return providers.NewOpenAICompatibleProvider(providers.OpenAICompatibleOptions{
		ID:            setting.ID,
		Name:          firstNonEmpty(setting.Name, spec.Name),
		Kind:          setting.Kind,
		Endpoint:      firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint),
		Model:         firstNonEmpty(setting.Model, spec.DefaultModel),
		Manual:        true,
		Local:         false,
		Frontier:      false,
		EndpointClass: "remote_byok",
		RequiresAuth:  true,
		Secret:        secret,
		Timeout:       localProviderRequestTimeout,
	})
}

func newOpenAICompatibleFrontierProvider(setting providers.AIProviderSettings, spec providerSpec, secret string) providers.Provider {
	return providers.NewOpenAICompatibleProvider(providers.OpenAICompatibleOptions{
		ID:            setting.ID,
		Name:          firstNonEmpty(setting.Name, spec.Name),
		Kind:          setting.Kind,
		Endpoint:      firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint),
		Model:         firstNonEmpty(setting.Model, spec.DefaultModel),
		Manual:        setting.Manual,
		Local:         false,
		Frontier:      true,
		EndpointClass: "frontier",
		RequiresAuth:  true,
		Secret:        secret,
		Timeout:       localProviderRequestTimeout,
	})
}

func newAnthropicProvider(setting providers.AIProviderSettings, spec providerSpec, secret string) providers.Provider {
	return providers.NewAnthropicProvider(providers.AnthropicOptions{
		ID:            setting.ID,
		Name:          firstNonEmpty(setting.Name, spec.Name),
		Kind:          setting.Kind,
		Endpoint:      firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint),
		Model:         firstNonEmpty(setting.Model, spec.DefaultModel),
		Manual:        setting.Manual,
		Frontier:      true,
		EndpointClass: "frontier",
		Secret:        secret,
		Timeout:       localProviderRequestTimeout,
	})
}

func newGeminiProvider(setting providers.AIProviderSettings, spec providerSpec, secret string) providers.Provider {
	return providers.NewGeminiProvider(providers.GeminiOptions{
		ID:            setting.ID,
		Name:          firstNonEmpty(setting.Name, spec.Name),
		Kind:          setting.Kind,
		Endpoint:      firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint),
		Model:         firstNonEmpty(setting.Model, spec.DefaultModel),
		Manual:        setting.Manual,
		Frontier:      true,
		EndpointClass: "frontier",
		Secret:        secret,
		Timeout:       localProviderRequestTimeout,
	})
}

func cloudProviderCapabilities() []providers.AIProviderCapability {
	return []providers.AIProviderCapability{
		providers.CapabilityCodeCompletion,
		providers.CapabilityLinePrediction,
		providers.CapabilityTerminalPrediction,
		providers.CapabilityChat,
		providers.CapabilityToolCalling,
		providers.CapabilityStructuredOutput,
		providers.CapabilityPatchGeneration,
	}
}

func providerSpecForKind(kind string) (providerSpec, bool) {
	spec, ok := providerSpecs[strings.TrimSpace(kind)]
	return spec, ok
}

func localDiscoveryProviderSettings() []providers.AIProviderSettings {
	settings := []providers.AIProviderSettings{}
	for _, kind := range orderedProviderKinds() {
		spec := providerSpecs[kind]
		if !spec.Local {
			continue
		}
		for _, endpoint := range spec.DiscoveryEndpoints {
			settings = append(settings, providers.AIProviderSettings{
				ID:       endpoint.ID,
				Name:     firstNonEmpty(endpoint.Name, spec.Name),
				Kind:     spec.Kind,
				Endpoint: endpoint.Endpoint,
				Enabled:  true,
				AuthMode: spec.AuthMode,
			})
		}
	}
	return settings
}

func catalogProviderDescriptors() []providers.AIProviderDescriptor {
	descriptors := []providers.AIProviderDescriptor{}
	for _, kind := range orderedProviderKinds() {
		spec := providerSpecs[kind]
		if spec.Local || spec.DefaultID == "" {
			continue
		}
		status := providers.ProviderStatusDisabled
		if spec.Factory != nil && spec.RequiresAuth {
			status = providers.ProviderStatusNeedsAuth
		}
		descriptors = append(descriptors, descriptorFromSpec(providers.AIProviderSettings{
			ID:       spec.DefaultID,
			Name:     spec.Name,
			Kind:     spec.Kind,
			Endpoint: spec.DefaultEndpoint,
			Model:    spec.DefaultModel,
			AuthMode: spec.AuthMode,
		}, spec, status))
	}
	return descriptors
}

func orderedProviderKinds() []string {
	seen := map[string]struct{}{}
	kinds := make([]string, 0, len(providerSpecs))
	for _, kind := range providerSpecOrder {
		if _, ok := providerSpecs[kind]; !ok {
			continue
		}
		seen[kind] = struct{}{}
		kinds = append(kinds, kind)
	}
	extras := make([]string, 0, len(providerSpecs))
	for kind := range providerSpecs {
		if _, ok := seen[kind]; ok {
			continue
		}
		extras = append(extras, kind)
	}
	sort.Strings(extras)
	return append(kinds, extras...)
}

func descriptorFromSpec(setting providers.AIProviderSettings, spec providerSpec, status providers.AIProviderStatusValue) providers.AIProviderDescriptor {
	return providers.AIProviderDescriptor{
		ID:                 firstNonEmpty(setting.ID, spec.DefaultID),
		Name:               firstNonEmpty(setting.Name, spec.Name, spec.Kind),
		Kind:               firstNonEmpty(setting.Kind, spec.Kind),
		RuntimeFamily:      "model_agent_runtime",
		Transport:          "model_api",
		Endpoint:           firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint),
		EndpointClass:      endpointClassForSpec(setting, spec),
		AdapterVersion:     "arlecchino-model-runtime-v1",
		ProtocolVersion:    firstNonEmpty(spec.Kind, setting.Kind, "model_api"),
		CompatibilityRange: "provider_api_descriptor",
		Manual:             setting.Manual,
		Local:              spec.Local,
		Frontier:           spec.Frontier,
		AuthMode:           spec.AuthMode,
		OAuthSupported:     spec.OAuthSupported,
		RequiresAuth:       spec.RequiresAuth,
		AuthConfigured:     !spec.RequiresAuth || setting.SecretRef != "" || setting.SecretValue != "",
		Capabilities:       normalizeCapabilities(firstNonEmptyCapabilities(setting.Capabilities, spec.Capabilities)),
		DefaultModel:       firstNonEmpty(setting.Model, spec.DefaultModel),
		Status:             status,
		Reason:             reasonForProviderSpec(spec),
		BillingMode:        billingModeForSpec(spec),
		LegalBasis:         legalBasisForSpec(spec),
		RiskTier:           riskTierForSpec(spec),
	}
}

func endpointClassForSpec(setting providers.AIProviderSettings, spec providerSpec) string {
	if spec.Frontier {
		return "frontier"
	}
	if !spec.Local && spec.RequiresAuth {
		return "remote_byok"
	}
	if isLoopbackEndpoint(firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint)) {
		return "loopback"
	}
	if spec.Local {
		return "local_non_loopback"
	}
	return "remote"
}

func billingModeForSpec(spec providerSpec) string {
	switch {
	case spec.Local:
		return "local"
	case !spec.Frontier && spec.RequiresAuth:
		return "byok"
	case spec.Frontier:
		return "byok"
	default:
		return ""
	}
}

func legalBasisForSpec(spec providerSpec) string {
	switch {
	case spec.Local:
		return "local_runtime"
	case !spec.Frontier && spec.RequiresAuth:
		return "user_supplied_api_key"
	case spec.Frontier && spec.Factory != nil:
		return "official_provider_api_key"
	case spec.Frontier:
		return "blocked_until_provider_specific_adapter"
	default:
		return ""
	}
}

func riskTierForSpec(spec providerSpec) string {
	switch {
	case spec.Local:
		return "local"
	case !spec.Frontier && spec.RequiresAuth:
		return "remote_byok"
	case spec.Frontier && spec.Factory != nil:
		return "frontier_byok"
	case spec.Frontier:
		return "frontier_blocked"
	default:
		return ""
	}
}

func firstNonEmptyCapabilities(values ...[]providers.AIProviderCapability) []providers.AIProviderCapability {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func reasonForProviderSpec(spec providerSpec) string {
	if spec.RequiresAuth && spec.Factory != nil {
		return "API key required"
	}
	if !spec.Frontier {
		return ""
	}
	if spec.Kind == "anthropic" {
		return "frontier provider stub; Anthropic supports API-key auth only in Arlecchino"
	}
	return "frontier provider stub; enable explicitly and store credentials in keychain"
}
