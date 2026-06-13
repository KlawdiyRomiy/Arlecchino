package agents

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/ai/providers"
)

const (
	RuntimeFamilyStructuredAgent     = "structured_agent_runtime"
	RuntimeFamilyJSONLExec           = "jsonl_exec_runtime"
	RuntimeFamilyModelAgent          = "model_agent_runtime"
	RuntimeFamilyInteractiveFallback = "interactive_fallback_runtime"
	ProviderKindExternalAgentCLI     = "external_agent_cli"

	TransportAppServerSTDIO = "app_server_stdio"
	TransportJSONLExec      = "jsonl_exec"
	TransportModelAPI       = "model_api"
	TransportPTYFallback    = "pty_fallback"
	TransportHTTPServerSSE  = "http_sse"

	EndpointClassLocalProcess    = "local_process"
	EndpointClassLocalStdio      = "local_stdio"
	EndpointClassLocalLoopback   = "local_loopback"
	EndpointClassExternalAccount = "local_process_external_account"
)

type EventType string

const (
	EventStatus       EventType = "status"
	EventTerminalData EventType = "terminal_data"
	EventMessage      EventType = "message"
	EventError        EventType = "error"
	EventUsage        EventType = "usage"
	EventArtifact     EventType = "artifact"
)

const (
	FailureProviderNotConfigured   = "provider_not_configured"
	FailureProviderNotRunning      = "provider_not_running"
	FailureAuthRequired            = "auth_required"
	FailureTrustPromptRequired     = "trust_prompt_required"
	FailureConsentRequired         = "consent_required"
	FailureToolDenied              = "tool_denied"
	FailureProtectedResourceDenied = "protected_resource_denied"
	FailureNoReviewableArtifact    = "no_reviewable_artifact"
	FailureStaleCompletion         = "stale_completion"
	FailureDirtyBaseline           = "dirty_baseline"
	FailureAdapterProtocolChanged  = "adapter_protocol_changed"
	FailureRuntimeTimeout          = "runtime_timeout"
	FailureRuntimeCancelled        = "runtime_cancelled"
	FailureRuntimeUnhealthy        = "runtime_unhealthy"
	FailureQuotaOrBillingBlocked   = "quota_or_billing_blocked"

	FailureRuntimeUnavailable       = FailureProviderNotRunning
	FailureProtocolDrift            = FailureAdapterProtocolChanged
	FailureProviderApprovalBypass   = FailureToolDenied
	FailureUnsupportedHostCallback  = "unsupported_host_callback"
	FailureBuildArtifactMissing     = FailureNoReviewableArtifact
	FailurePatchCaptureFailed       = FailureNoReviewableArtifact
	FailureProviderError            = FailureRuntimeUnhealthy
	FailureCanceled                 = FailureRuntimeCancelled
	FailurePromptArgvLeakPrevented  = FailureProtectedResourceDenied
	FailureExpandedPermissionDenied = FailureProtectedResourceDenied
)

type Descriptor struct {
	ID                 string
	Name               string
	Kind               string
	RuntimeFamily      string
	Transport          string
	Binary             string
	EndpointClass      string
	AuthMode           providers.AIProviderAuthMode
	AuthStatus         string
	BillingMode        string
	LegalBasis         string
	RiskTier           string
	Capabilities       []providers.AIProviderCapability
	SupportedActions   []string
	Models             []providers.AIModelDescriptor
	DefaultModel       string
	Status             providers.AIProviderStatusValue
	Reason             string
	SourceLinks        []string
	RuntimeVersion     string
	AdapterVersion     string
	ProtocolVersion    string
	CompatibilityRange string
	LastCheckedAt      string
}

func ValidateDescriptor(descriptor Descriptor) error {
	missing := []string{}
	for _, field := range []struct {
		name  string
		value string
	}{
		{name: "id", value: descriptor.ID},
		{name: "name", value: descriptor.Name},
		{name: "kind", value: descriptor.Kind},
		{name: "runtimeFamily", value: descriptor.RuntimeFamily},
		{name: "transport", value: descriptor.Transport},
		{name: "endpointClass", value: descriptor.EndpointClass},
		{name: "authMode", value: string(descriptor.AuthMode)},
		{name: "billingMode", value: descriptor.BillingMode},
		{name: "legalBasis", value: descriptor.LegalBasis},
		{name: "riskTier", value: descriptor.RiskTier},
		{name: "runtimeVersion", value: descriptor.RuntimeVersion},
		{name: "adapterVersion", value: descriptor.AdapterVersion},
		{name: "protocolVersion", value: descriptor.ProtocolVersion},
		{name: "compatibilityRange", value: descriptor.CompatibilityRange},
	} {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.name)
		}
	}
	if len(descriptor.Capabilities) == 0 {
		missing = append(missing, "capabilities")
	}
	if len(descriptor.SourceLinks) == 0 {
		missing = append(missing, "sourceLinks")
	}
	if len(missing) > 0 {
		return fmt.Errorf("runtime descriptor %q missing required proof fields: %s", descriptor.ID, strings.Join(missing, ", "))
	}
	if !knownRuntimeFamily(descriptor.RuntimeFamily) {
		return fmt.Errorf("runtime descriptor %q has unknown runtime family %q", descriptor.ID, descriptor.RuntimeFamily)
	}
	if !knownTransport(descriptor.Transport) {
		return fmt.Errorf("runtime descriptor %q has unknown transport %q", descriptor.ID, descriptor.Transport)
	}
	if !knownEndpointClass(descriptor.EndpointClass) {
		return fmt.Errorf("runtime descriptor %q has unknown endpoint class %q", descriptor.ID, descriptor.EndpointClass)
	}
	return nil
}

func knownRuntimeFamily(value string) bool {
	switch strings.TrimSpace(value) {
	case RuntimeFamilyStructuredAgent, RuntimeFamilyJSONLExec, RuntimeFamilyModelAgent, RuntimeFamilyInteractiveFallback:
		return true
	default:
		return false
	}
}

func knownTransport(value string) bool {
	switch strings.TrimSpace(value) {
	case TransportAppServerSTDIO, TransportJSONLExec, TransportModelAPI, TransportPTYFallback, TransportHTTPServerSSE:
		return true
	default:
		return false
	}
}

func knownEndpointClass(value string) bool {
	switch strings.TrimSpace(value) {
	case EndpointClassLocalProcess, EndpointClassLocalStdio, EndpointClassLocalLoopback, EndpointClassExternalAccount:
		return true
	default:
		return false
	}
}

type RunRequest struct {
	RunID           string
	SessionID       string
	ProjectRoot     string
	Action          string
	Prompt          string
	Model           string
	ReasoningEffort string
	RuntimeFamily   string
	Transport       string
	Rows            uint16
	Cols            uint16
	DataCategories  []string
	RegisterInput   func(runID string, write func([]byte) error, resize func(uint16, uint16) error)
}

type AuthRequest struct {
	RunID         string
	SessionID     string
	ProjectRoot   string
	Rows          uint16
	Cols          uint16
	RegisterInput func(runID string, write func([]byte) error, resize func(uint16, uint16) error)
}

type Event struct {
	RunID     string
	Type      EventType
	Status    string
	Data      []byte
	Text      string
	Payload   map[string]any
	CreatedAt string
}

type Result struct {
	Status     string
	Message    string
	Error      string
	ExitCode   int
	Transport  string
	Transcript string
	StartedAt  string
	FinishedAt string
}

type Adapter interface {
	ID() string
	Descriptor(ctx context.Context) Descriptor
	Run(ctx context.Context, req RunRequest, emit func(Event)) Result
}

type AuthRunner interface {
	RunAuth(ctx context.Context, req AuthRequest, emit func(Event)) Result
}

type CacheInvalidator interface {
	Invalidate()
}

type Registry struct {
	mu       sync.RWMutex
	adapters map[string]Adapter
}

func NewRegistry() *Registry {
	registry := NewEmptyRegistry()
	registry.Register(NewCodexAdapter())
	return registry
}

func NewEmptyRegistry() *Registry {
	return &Registry{adapters: map[string]Adapter{}}
}

func (r *Registry) Register(adapter Adapter) {
	if r == nil || adapter == nil || strings.TrimSpace(adapter.ID()) == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters[adapter.ID()] = adapter
}

func (r *Registry) Adapters() []Adapter {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	adapters := make([]Adapter, 0, len(r.adapters))
	for _, adapter := range r.adapters {
		adapters = append(adapters, adapter)
	}
	return adapters
}

func (r *Registry) Adapter(id string) (Adapter, bool) {
	if r == nil {
		return nil, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	adapter, ok := r.adapters[strings.TrimSpace(id)]
	return adapter, ok
}

func (r *Registry) Descriptors(ctx context.Context) []Descriptor {
	if r == nil {
		return nil
	}
	adapters := r.Adapters()
	descriptors := make([]Descriptor, 0, len(adapters))
	for _, adapter := range adapters {
		descriptors = append(descriptors, adapter.Descriptor(ctx))
	}
	sort.SliceStable(descriptors, func(i, j int) bool {
		return descriptors[i].Name < descriptors[j].Name
	})
	return descriptors
}

func DescriptorToProvider(descriptor Descriptor) providers.AIProviderDescriptor {
	status := descriptor.Status
	if status == "" {
		status = providers.ProviderStatusError
	}
	authStatus := strings.ToLower(strings.TrimSpace(descriptor.AuthStatus))
	authConfigured := authStatus == "ready" || authStatus == "authenticated"
	runtimeFamily := firstNonEmpty(descriptor.RuntimeFamily, RuntimeFamilyStructuredAgent)
	endpointClass := firstNonEmpty(descriptor.EndpointClass, EndpointClassLocalProcess)
	return providers.EnrichProviderDescriptorModels(providers.AIProviderDescriptor{
		ID:                 descriptor.ID,
		Name:               descriptor.Name,
		Kind:               firstNonEmpty(descriptor.Kind, ProviderKindExternalAgentCLI),
		RuntimeFamily:      runtimeFamily,
		Transport:          descriptor.Transport,
		Endpoint:           endpointClass,
		EndpointClass:      endpointClass,
		ExternalAccount:    true,
		Binary:             descriptor.Binary,
		Local:              false,
		Manual:             true,
		Frontier:           true,
		AuthMode:           descriptor.AuthMode,
		AuthStatus:         descriptor.AuthStatus,
		BillingMode:        descriptor.BillingMode,
		LegalBasis:         descriptor.LegalBasis,
		RiskTier:           descriptor.RiskTier,
		SourceLinks:        descriptor.SourceLinks,
		RuntimeVersion:     descriptor.RuntimeVersion,
		AdapterVersion:     descriptor.AdapterVersion,
		ProtocolVersion:    descriptor.ProtocolVersion,
		CompatibilityRange: descriptor.CompatibilityRange,
		SupportedActions:   descriptor.SupportedActions,
		OAuthSupported:     false,
		RequiresAuth:       true,
		AuthConfigured:     authConfigured,
		Capabilities:       descriptor.Capabilities,
		Models:             descriptor.Models,
		DefaultModel:       descriptor.DefaultModel,
		Status:             status,
		Reason:             descriptor.Reason,
		LastCheckedAt:      descriptor.LastCheckedAt,
	})
}

func NewEvent(runID string, eventType EventType, status string, text string, data []byte) Event {
	return Event{
		RunID:     strings.TrimSpace(runID),
		Type:      eventType,
		Status:    strings.TrimSpace(status),
		Text:      text,
		Data:      data,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func UnsupportedResult(message string) Result {
	return Result{
		Status:     "error",
		Error:      strings.TrimSpace(message),
		ExitCode:   -1,
		FinishedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

func FormatExitError(exitCode int, output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return fmt.Sprintf("agent CLI exited with code %d", exitCode)
	}
	return fmt.Sprintf("agent CLI exited with code %d: %s", exitCode, output)
}
