package providers

import (
	"context"
	"time"
)

type AIProviderCapability string

const (
	CapabilityCodeCompletion     AIProviderCapability = "code_completion"
	CapabilityLinePrediction     AIProviderCapability = "line_prediction"
	CapabilityTerminalPrediction AIProviderCapability = "terminal_prediction"
	CapabilityChat               AIProviderCapability = "chat"
)

type AIProviderStatusValue string

const (
	ProviderStatusDisabled   AIProviderStatusValue = "disabled"
	ProviderStatusDiscovered AIProviderStatusValue = "discovered"
	ProviderStatusNeedsAuth  AIProviderStatusValue = "needs_auth"
	ProviderStatusReady      AIProviderStatusValue = "ready"
	ProviderStatusDegraded   AIProviderStatusValue = "degraded"
	ProviderStatusError      AIProviderStatusValue = "error"
)

type AIProviderAuthMode string

const (
	ProviderAuthModeNone   AIProviderAuthMode = "none"
	ProviderAuthModeAPIKey AIProviderAuthMode = "api_key"
	ProviderAuthModeOAuth  AIProviderAuthMode = "oauth"
)

type AIModelDescriptor struct {
	ID            string `json:"id"`
	DisplayName   string `json:"displayName"`
	ContextWindow int    `json:"contextWindow,omitempty"`
	Streaming     bool   `json:"streaming"`
}

type AIProviderDescriptor struct {
	ID             string                 `json:"id"`
	Name           string                 `json:"name"`
	Kind           string                 `json:"kind"`
	Endpoint       string                 `json:"endpoint,omitempty"`
	Local          bool                   `json:"local"`
	Manual         bool                   `json:"manual"`
	Frontier       bool                   `json:"frontier"`
	AuthMode       AIProviderAuthMode     `json:"authMode,omitempty"`
	OAuthSupported bool                   `json:"oauthSupported"`
	RequiresAuth   bool                   `json:"requiresAuth"`
	AuthConfigured bool                   `json:"authConfigured"`
	Capabilities   []AIProviderCapability `json:"capabilities"`
	Models         []AIModelDescriptor    `json:"models"`
	DefaultModel   string                 `json:"defaultModel,omitempty"`
	Status         AIProviderStatusValue  `json:"status"`
	Reason         string                 `json:"reason,omitempty"`
	LastCheckedAt  string                 `json:"lastCheckedAt,omitempty"`
}

type AIProviderSettings struct {
	ID             string                 `json:"id"`
	Name           string                 `json:"name,omitempty"`
	Kind           string                 `json:"kind"`
	Endpoint       string                 `json:"endpoint,omitempty"`
	Model          string                 `json:"model,omitempty"`
	Enabled        bool                   `json:"enabled"`
	Manual         bool                   `json:"manual"`
	Capabilities   []AIProviderCapability `json:"capabilities,omitempty"`
	SecretRef      string                 `json:"secretRef,omitempty"`
	SecretValue    string                 `json:"secretValue,omitempty"`
	ClearSecret    bool                   `json:"clearSecret,omitempty"`
	AuthMode       AIProviderAuthMode     `json:"authMode,omitempty"`
	OAuthClientID  string                 `json:"oauthClientId,omitempty"`
	OAuthSupported bool                   `json:"oauthSupported,omitempty"`
}

type GenerationRequest struct {
	Capability  AIProviderCapability `json:"capability"`
	Prompt      string               `json:"prompt"`
	System      string               `json:"system,omitempty"`
	Model       string               `json:"model,omitempty"`
	MaxTokens   int                  `json:"maxTokens,omitempty"`
	Temperature float64              `json:"temperature,omitempty"`
	Stop        []string             `json:"stop,omitempty"`
	Stream      bool                 `json:"stream,omitempty"`
}

type GenerationResponse struct {
	Text       string `json:"text"`
	Model      string `json:"model,omitempty"`
	RawStatus  int    `json:"rawStatus,omitempty"`
	FinishedAt string `json:"finishedAt,omitempty"`
}

type TokenSink func(token string) error

type Provider interface {
	Descriptor() AIProviderDescriptor
	ListModels(ctx context.Context) ([]AIModelDescriptor, error)
	HealthCheck(ctx context.Context) AIProviderDescriptor
	Generate(ctx context.Context, req GenerationRequest, sink TokenSink) (GenerationResponse, error)
}

func DefaultCapabilities() []AIProviderCapability {
	return []AIProviderCapability{
		CapabilityCodeCompletion,
		CapabilityLinePrediction,
		CapabilityTerminalPrediction,
		CapabilityChat,
	}
}

func NowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}
