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
	CapabilityToolCalling        AIProviderCapability = "tool_calling"
	CapabilityStructuredOutput   AIProviderCapability = "structured_output"
	CapabilityPatchGeneration    AIProviderCapability = "patch_generation"
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
	ID               string   `json:"id"`
	DisplayName      string   `json:"displayName"`
	ContextWindow    int      `json:"contextWindow,omitempty"`
	Streaming        bool     `json:"streaming"`
	ToolCalling      bool     `json:"toolCalling,omitempty"`
	StructuredOutput bool     `json:"structuredOutput,omitempty"`
	PatchGeneration  bool     `json:"patchGeneration,omitempty"`
	LowLatency       bool     `json:"lowLatency,omitempty"`
	CostTier         string   `json:"costTier,omitempty"`
	ReasoningEfforts []string `json:"reasoningEfforts,omitempty"`
	AccountScoped    bool     `json:"accountScoped,omitempty"`
}

type AIProviderDescriptor struct {
	ID                 string                 `json:"id"`
	Name               string                 `json:"name"`
	Kind               string                 `json:"kind"`
	RuntimeFamily      string                 `json:"runtimeFamily,omitempty"`
	Transport          string                 `json:"transport,omitempty"`
	Endpoint           string                 `json:"endpoint,omitempty"`
	EndpointClass      string                 `json:"endpointClass,omitempty"`
	ExternalAccount    bool                   `json:"externalAccount,omitempty"`
	Binary             string                 `json:"binary,omitempty"`
	Local              bool                   `json:"local"`
	Manual             bool                   `json:"manual"`
	Frontier           bool                   `json:"frontier"`
	AuthMode           AIProviderAuthMode     `json:"authMode,omitempty"`
	AuthStatus         string                 `json:"authStatus,omitempty"`
	BillingMode        string                 `json:"billingMode,omitempty"`
	LegalBasis         string                 `json:"legalBasis,omitempty"`
	RiskTier           string                 `json:"riskTier,omitempty"`
	SourceLinks        []string               `json:"sourceLinks,omitempty"`
	RuntimeVersion     string                 `json:"runtimeVersion,omitempty"`
	AdapterVersion     string                 `json:"adapterVersion,omitempty"`
	ProtocolVersion    string                 `json:"protocolVersion,omitempty"`
	CompatibilityRange string                 `json:"compatibilityRange,omitempty"`
	SupportedActions   []string               `json:"supportedActions,omitempty"`
	OAuthSupported     bool                   `json:"oauthSupported"`
	RequiresAuth       bool                   `json:"requiresAuth"`
	AuthConfigured     bool                   `json:"authConfigured"`
	Capabilities       []AIProviderCapability `json:"capabilities"`
	Models             []AIModelDescriptor    `json:"models"`
	DefaultModel       string                 `json:"defaultModel,omitempty"`
	Status             AIProviderStatusValue  `json:"status"`
	Reason             string                 `json:"reason,omitempty"`
	LastCheckedAt      string                 `json:"lastCheckedAt,omitempty"`
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
	Capability      AIProviderCapability `json:"capability"`
	Prompt          string               `json:"prompt"`
	System          string               `json:"system,omitempty"`
	Messages        []GenerationMessage  `json:"messages,omitempty"`
	Model           string               `json:"model,omitempty"`
	ReasoningEffort string               `json:"reasoningEffort,omitempty"`
	MaxTokens       int                  `json:"maxTokens,omitempty"`
	Temperature     float64              `json:"temperature,omitempty"`
	Stop            []string             `json:"stop,omitempty"`
	Stream          bool                 `json:"stream,omitempty"`
	Tools           []GenerationTool     `json:"tools,omitempty"`
	ToolChoice      string               `json:"toolChoice,omitempty"`
}

type GenerationMessage struct {
	Role       string               `json:"role"`
	Content    string               `json:"content"`
	ToolCallID string               `json:"toolCallId,omitempty"`
	Name       string               `json:"name,omitempty"`
	ToolCalls  []GenerationToolCall `json:"toolCalls,omitempty"`
}

type GenerationTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type GenerationToolCall struct {
	ID               string `json:"id,omitempty"`
	Name             string `json:"name"`
	ArgumentsJSON    string `json:"argumentsJson,omitempty"`
	ProviderIndex    *int   `json:"-"`
	ThoughtSignature string `json:"-"`
}

type GenerationResponse struct {
	Text          string               `json:"text"`
	ReasoningText string               `json:"reasoningText,omitempty"`
	Model         string               `json:"model,omitempty"`
	RawStatus     int                  `json:"rawStatus,omitempty"`
	FinishedAt    string               `json:"finishedAt,omitempty"`
	ToolCalls     []GenerationToolCall `json:"toolCalls,omitempty"`
	Usage         GenerationTokenUsage `json:"usage,omitempty"`
}

type GenerationTokenUsage struct {
	InputTokens  int    `json:"inputTokens,omitempty"`
	OutputTokens int    `json:"outputTokens,omitempty"`
	TotalTokens  int    `json:"totalTokens,omitempty"`
	Estimated    bool   `json:"estimated,omitempty"`
	Source       string `json:"source,omitempty"`
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

func CloudCapabilities() []AIProviderCapability {
	return []AIProviderCapability{
		CapabilityCodeCompletion,
		CapabilityLinePrediction,
		CapabilityTerminalPrediction,
		CapabilityChat,
		CapabilityToolCalling,
		CapabilityStructuredOutput,
		CapabilityPatchGeneration,
	}
}

func NowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}
