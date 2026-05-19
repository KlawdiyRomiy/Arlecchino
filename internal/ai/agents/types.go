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
	RuntimeFamilyExternalAgentCLI = "external_agent_cli"
	EndpointClassExternalAccount  = "local_process_external_account"
)

type EventType string

const (
	EventStatus       EventType = "status"
	EventTerminalData EventType = "terminal_data"
	EventMessage      EventType = "message"
	EventError        EventType = "error"
)

type Descriptor struct {
	ID               string
	Name             string
	Kind             string
	Binary           string
	EndpointClass    string
	AuthMode         providers.AIProviderAuthMode
	AuthStatus       string
	BillingMode      string
	LegalBasis       string
	RiskTier         string
	Capabilities     []providers.AIProviderCapability
	SupportedActions []string
	Models           []providers.AIModelDescriptor
	DefaultModel     string
	Status           providers.AIProviderStatusValue
	Reason           string
	SourceLinks      []string
	LastCheckedAt    string
}

type RunRequest struct {
	RunID          string
	SessionID      string
	ProjectRoot    string
	Action         string
	Prompt         string
	Model          string
	Rows           uint16
	Cols           uint16
	DataCategories []string
	RegisterInput  func(runID string, write func([]byte) error, resize func(uint16, uint16) error)
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
	CreatedAt string
}

type Result struct {
	Status     string
	Message    string
	Error      string
	ExitCode   int
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
	registry := &Registry{adapters: map[string]Adapter{}}
	registry.Register(NewCodexAdapter())
	return registry
}

func (r *Registry) Register(adapter Adapter) {
	if r == nil || adapter == nil || strings.TrimSpace(adapter.ID()) == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters[adapter.ID()] = adapter
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
	r.mu.RLock()
	adapters := make([]Adapter, 0, len(r.adapters))
	for _, adapter := range r.adapters {
		adapters = append(adapters, adapter)
	}
	r.mu.RUnlock()
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
	return providers.AIProviderDescriptor{
		ID:               descriptor.ID,
		Name:             descriptor.Name,
		Kind:             firstNonEmpty(descriptor.Kind, RuntimeFamilyExternalAgentCLI),
		RuntimeFamily:    RuntimeFamilyExternalAgentCLI,
		Endpoint:         descriptor.EndpointClass,
		EndpointClass:    descriptor.EndpointClass,
		ExternalAccount:  true,
		Binary:           descriptor.Binary,
		Local:            false,
		Manual:           true,
		Frontier:         true,
		AuthMode:         descriptor.AuthMode,
		AuthStatus:       descriptor.AuthStatus,
		BillingMode:      descriptor.BillingMode,
		LegalBasis:       descriptor.LegalBasis,
		RiskTier:         descriptor.RiskTier,
		SourceLinks:      descriptor.SourceLinks,
		SupportedActions: descriptor.SupportedActions,
		OAuthSupported:   false,
		RequiresAuth:     true,
		AuthConfigured:   descriptor.AuthStatus == "ready",
		Capabilities:     descriptor.Capabilities,
		Models:           descriptor.Models,
		DefaultModel:     descriptor.DefaultModel,
		Status:           status,
		Reason:           descriptor.Reason,
		LastCheckedAt:    descriptor.LastCheckedAt,
	}
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
