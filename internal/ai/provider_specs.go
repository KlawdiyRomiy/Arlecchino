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
	RequiresAuth       bool
	Capabilities       []providers.AIProviderCapability
	DiscoveryEndpoints []providerDiscoveryEndpoint
	Factory            providerFactory
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
	"openai": {
		Kind:           "openai",
		Name:           "OpenAI",
		DefaultID:      "openai-frontier",
		Frontier:       true,
		AuthMode:       providers.ProviderAuthModeAPIKey,
		OAuthSupported: false,
		RequiresAuth:   true,
		Capabilities:   providers.DefaultCapabilities(),
	},
	"anthropic": {
		Kind:           "anthropic",
		Name:           "Anthropic",
		DefaultID:      "anthropic-frontier",
		Frontier:       true,
		AuthMode:       providers.ProviderAuthModeAPIKey,
		OAuthSupported: false,
		RequiresAuth:   true,
		Capabilities:   providers.DefaultCapabilities(),
	},
}

var providerSpecOrder = []string{
	"ollama",
	"lm-studio",
	"llama.cpp",
	"huggingface-tgi",
	"openai",
	"anthropic",
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

func frontierProviderDescriptors() []providers.AIProviderDescriptor {
	descriptors := []providers.AIProviderDescriptor{}
	for _, kind := range orderedProviderKinds() {
		spec := providerSpecs[kind]
		if !spec.Frontier {
			continue
		}
		descriptors = append(descriptors, descriptorFromSpec(providers.AIProviderSettings{
			ID:       spec.DefaultID,
			Name:     spec.Name,
			Kind:     spec.Kind,
			AuthMode: spec.AuthMode,
		}, spec, providers.ProviderStatusDisabled))
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
		ID:             firstNonEmpty(setting.ID, spec.DefaultID),
		Name:           firstNonEmpty(setting.Name, spec.Name, spec.Kind),
		Kind:           firstNonEmpty(setting.Kind, spec.Kind),
		RuntimeFamily:  "model_api",
		Endpoint:       firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint),
		EndpointClass:  endpointClassForSpec(setting, spec),
		Manual:         setting.Manual,
		Local:          spec.Local,
		Frontier:       spec.Frontier,
		AuthMode:       spec.AuthMode,
		OAuthSupported: spec.OAuthSupported,
		RequiresAuth:   spec.RequiresAuth,
		AuthConfigured: !spec.RequiresAuth || setting.SecretRef != "" || setting.SecretValue != "",
		Capabilities:   normalizeCapabilities(firstNonEmptyCapabilities(setting.Capabilities, spec.Capabilities)),
		DefaultModel:   setting.Model,
		Status:         status,
		Reason:         reasonForProviderSpec(spec),
	}
}

func endpointClassForSpec(setting providers.AIProviderSettings, spec providerSpec) string {
	if spec.Frontier {
		return "frontier"
	}
	if isLoopbackEndpoint(firstNonEmpty(setting.Endpoint, spec.DefaultEndpoint)) {
		return "loopback"
	}
	if spec.Local {
		return "local_non_loopback"
	}
	return "remote"
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
	if !spec.Frontier {
		return ""
	}
	if spec.Kind == "anthropic" {
		return "frontier provider stub; Anthropic supports API-key auth only in Arlecchino"
	}
	return "frontier provider stub; enable explicitly and store credentials in keychain"
}
