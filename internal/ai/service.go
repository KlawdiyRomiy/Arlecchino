package ai

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/ai/agents"
	"arlecchino/internal/ai/mnemonic"
	"arlecchino/internal/ai/providers"
	"arlecchino/internal/ai/skills"

	"github.com/google/uuid"
)

type EventEmitter func(name string, payload any)
type MCPContextProvider func(projectRoot string) (AIMCPContextPlane, error)
type DiagnosticsProvider func(projectRoot string, filePath string, language string, limit int) (string, error)
type MCPToolExecutor func(ctx context.Context, projectRoot string, toolName string, arguments map[string]any) (any, error)

type ServiceOptions struct {
	SettingsPath       string
	SecretStore        SecretStore
	Emit               EventEmitter
	MCPContextProvider MCPContextProvider
	Diagnostics        DiagnosticsProvider
	MCPExecutor        MCPToolExecutor
}

type Service struct {
	mu            sync.RWMutex
	settings      Settings
	settingsPath  string
	secretStore   SecretStore
	emit          EventEmitter
	mcpContext    MCPContextProvider
	diagnostics   DiagnosticsProvider
	mcpExecutor   MCPToolExecutor
	providers     map[string]providers.Provider
	descriptors   map[string]providers.AIProviderDescriptor
	projects      map[string]*ProjectSession
	runs          map[string]*AIChatRun
	runCancels    map[string]context.CancelFunc
	runDone       map[string]chan struct{}
	agentInputs   map[string]func([]byte) error
	agentResizes  map[string]func(uint16, uint16) error
	toolApprovals map[string]AIToolApprovalGrant
	runtimes      *providerRuntimeManager
	agents        *agents.Registry
	started       bool
}

type ProjectSession struct {
	ID                    string
	ProjectRoot           string
	Mnemonic              *mnemonic.Store
	Skills                *skills.Store
	Egress                *EgressLedger
	ChatHistory           *ChatHistoryLedger
	ChatArtifacts         *ChatArtifactLedger
	ToolAudit             *ToolAuditLedger
	RunTimeline           *RunTimelineLedger
	ToolApprovalGrants    *ToolApprovalGrantLedger
	ModelCapabilityProbes *ModelCapabilityProbeLedger
}

func NewService(options ServiceOptions) *Service {
	secretStore := options.SecretStore
	if secretStore == nil {
		secretStore = DefaultSecretStore()
	}
	return &Service{
		settingsPath:  options.SettingsPath,
		secretStore:   secretStore,
		emit:          options.Emit,
		mcpContext:    options.MCPContextProvider,
		diagnostics:   options.Diagnostics,
		mcpExecutor:   options.MCPExecutor,
		providers:     map[string]providers.Provider{},
		descriptors:   map[string]providers.AIProviderDescriptor{},
		projects:      map[string]*ProjectSession{},
		runs:          map[string]*AIChatRun{},
		runCancels:    map[string]context.CancelFunc{},
		runDone:       map[string]chan struct{}{},
		agentInputs:   map[string]func([]byte) error{},
		agentResizes:  map[string]func(uint16, uint16) error{},
		toolApprovals: map[string]AIToolApprovalGrant{},
		runtimes:      newProviderRuntimeManager(),
		agents:        agents.NewRegistry(),
	}
}

func (s *Service) Start(ctx context.Context) error {
	settings, path, err := LoadSettings(s.settingsPath)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.settings = settings
	s.settingsPath = path
	s.started = true
	s.registerFrontierPlaceholdersLocked()
	s.registerConfiguredProvidersLocked()
	s.mu.Unlock()

	go func() {
		discoveryCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		_, _ = s.RefreshLocalProviders(discoveryCtx)
	}()
	return nil
}

func (s *Service) Close() error {
	s.waitForRuns(s.cancelRuns(""))
	if s.runtimes != nil {
		s.runtimes.stopAll()
	}
	s.mu.Lock()
	s.runCancels = map[string]context.CancelFunc{}
	s.runDone = map[string]chan struct{}{}
	s.agentInputs = map[string]func([]byte) error{}
	s.agentResizes = map[string]func(uint16, uint16) error{}
	s.runs = map[string]*AIChatRun{}
	s.toolApprovals = map[string]AIToolApprovalGrant{}
	projects := make([]*ProjectSession, 0, len(s.projects))
	for _, project := range s.projects {
		projects = append(projects, project)
	}
	s.projects = map[string]*ProjectSession{}
	s.mu.Unlock()

	var firstErr error
	for _, project := range projects {
		if err := project.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (s *Service) emitEvent(name string, payload any) {
	if s == nil || s.emit == nil {
		return
	}
	s.emit(name, payload)
}

func (s *Service) OpenProject(projectID string, projectRoot string) (*ProjectSession, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		projectID = "main"
	}
	projectRoot, err := canonicalProjectRoot(projectRoot)
	if err != nil {
		return nil, err
	}
	s.waitForRuns(s.cancelRuns(projectID))
	defaultEnabled := s.currentSettings().MnemonicDefaultEnabled
	store, err := mnemonic.Open(projectRoot, defaultEnabled)
	if err != nil {
		return nil, err
	}
	skillStore, err := skills.Open(projectRoot)
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	if _, err := skillStore.SyncProjectSkills(); err != nil {
		_ = skillStore.Close()
		_ = store.Close()
		return nil, err
	}
	ledger, err := openEgressLedger(projectRoot)
	if err != nil {
		_ = skillStore.Close()
		_ = store.Close()
		return nil, err
	}
	chatHistory, err := openChatHistoryLedger(projectRoot)
	if err != nil {
		_ = skillStore.Close()
		_ = store.Close()
		return nil, err
	}
	chatArtifacts, err := openChatArtifactLedger(projectRoot)
	if err != nil {
		_ = skillStore.Close()
		_ = store.Close()
		return nil, err
	}
	toolAudit, err := openToolAuditLedger(projectRoot)
	if err != nil {
		_ = skillStore.Close()
		_ = store.Close()
		return nil, err
	}
	runTimeline, err := openRunTimelineLedger(projectRoot)
	if err != nil {
		_ = skillStore.Close()
		_ = store.Close()
		return nil, err
	}
	toolApprovalGrants, err := openToolApprovalGrantLedger(projectRoot)
	if err != nil {
		_ = skillStore.Close()
		_ = store.Close()
		return nil, err
	}
	modelCapabilityProbes, err := openModelCapabilityProbeLedger(projectRoot)
	if err != nil {
		_ = skillStore.Close()
		_ = store.Close()
		return nil, err
	}
	project := &ProjectSession{
		ID:                    projectID,
		ProjectRoot:           projectRoot,
		Mnemonic:              store,
		Skills:                skillStore,
		Egress:                ledger,
		ChatHistory:           chatHistory,
		ChatArtifacts:         chatArtifacts,
		ToolAudit:             toolAudit,
		RunTimeline:           runTimeline,
		ToolApprovalGrants:    toolApprovalGrants,
		ModelCapabilityProbes: modelCapabilityProbes,
	}
	s.mu.Lock()
	if previous := s.projects[projectID]; previous != nil {
		_ = previous.Close()
	}
	s.projects[projectID] = project
	s.mu.Unlock()
	s.recoverProjectAIRuntime(project)
	return project, nil
}

func (s *Service) CloseProject(projectID string) error {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		projectID = "main"
	}
	s.waitForRuns(s.cancelRuns(projectID))
	s.mu.Lock()
	project := s.projects[projectID]
	delete(s.projects, projectID)
	s.mu.Unlock()
	if project == nil {
		return nil
	}
	return project.Close()
}

func (s *Service) HasProject(projectID string) bool {
	if s == nil {
		return false
	}
	return s.project(projectID) != nil
}

func (p *ProjectSession) Close() error {
	if p == nil {
		return nil
	}
	var firstErr error
	if p.Skills != nil {
		if err := p.Skills.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if p.Mnemonic != nil {
		if err := p.Mnemonic.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (s *Service) Status(projectID string) AIStatus {
	settings := s.currentSettings()
	project := s.project(projectID)
	status := AIStatus{
		Enabled:            settings.Enabled,
		MnemonicEnabled:    settings.MnemonicDefaultEnabled,
		Providers:          s.ListProviders(),
		ActiveProviderID:   settings.ActiveProviderID,
		ActiveModel:        settings.ActiveModel,
		SettingsConfigured: s.settingsPath != "",
	}
	if project != nil {
		status.ProjectPathHash = hashProjectPath(project.ProjectRoot)
		status.ProjectSessionID = project.ID
		if project.Mnemonic != nil {
			status.MnemonicEnabled = project.Mnemonic.Enabled()
		}
	}
	return status
}

func (s *Service) ListProviders() []providers.AIProviderDescriptor {
	s.mu.RLock()
	result := make([]providers.AIProviderDescriptor, 0, len(s.descriptors))
	for _, descriptor := range s.descriptors {
		result = append(result, descriptor)
	}
	s.mu.RUnlock()
	if s.agents != nil {
		ctx, cancel := context.WithTimeout(context.Background(), agentDescriptorProbeTimeout)
		defer cancel()
		for _, descriptor := range s.agents.Descriptors(ctx) {
			result = append(result, agents.DescriptorToProvider(descriptor))
		}
	}
	sortDescriptors(result)
	return result
}

func (s *Service) SaveProviderSettings(ctx context.Context, providerSettings providers.AIProviderSettings) (providers.AIProviderDescriptor, error) {
	providerSettings = normalizeProviderSettings(providerSettings)
	if providerSettings.ID == "" {
		return providers.AIProviderDescriptor{}, fmt.Errorf("provider id is empty")
	}
	if err := validateProviderSettings(providerSettings); err != nil {
		return providers.AIProviderDescriptor{}, err
	}
	existingSecretRef := ""
	s.mu.RLock()
	for _, existing := range s.settings.Providers {
		if existing.ID == providerSettings.ID {
			existingSecretRef = existing.SecretRef
			break
		}
	}
	s.mu.RUnlock()
	if providerSettings.SecretRef == "" {
		providerSettings.SecretRef = existingSecretRef
	}
	if providerSettings.ClearSecret {
		ref := firstNonEmpty(providerSettings.SecretRef, existingSecretRef)
		if ref != "" {
			if err := s.secretStore.ClearSecret(ctx, ref); err != nil {
				return providers.AIProviderDescriptor{}, err
			}
		}
		providerSettings.SecretRef = ""
		providerSettings.SecretValue = ""
		providerSettings.ClearSecret = false
	}
	if strings.TrimSpace(providerSettings.SecretValue) != "" {
		ref := providerSettings.SecretRef
		if ref == "" {
			ref = secretRefForProvider(providerSettings.ID)
		}
		if err := s.secretStore.SaveSecret(ctx, ref, providerSettings.SecretValue); err != nil {
			return providers.AIProviderDescriptor{}, err
		}
		providerSettings.SecretRef = ref
		providerSettings.SecretValue = ""
	}

	s.mu.Lock()
	settings := s.settings
	replaced := false
	for i := range settings.Providers {
		if settings.Providers[i].ID == providerSettings.ID {
			settings.Providers[i] = providerSettings
			replaced = true
			break
		}
	}
	if !replaced {
		settings.Providers = append(settings.Providers, providerSettings)
	}
	if providerSettings.Enabled && settings.ActiveProviderID == "" && !isFrontierProviderKind(providerSettings.Kind) {
		settings.ActiveProviderID = providerSettings.ID
		settings.ActiveModel = providerSettings.Model
	}
	normalized, path, err := SaveSettings(s.settingsPath, settings)
	if err != nil {
		s.mu.Unlock()
		return providers.AIProviderDescriptor{}, err
	}
	s.settings = normalized
	s.settingsPath = path
	s.registerConfiguredProvidersLocked()
	descriptor := s.descriptors[providerSettings.ID]
	s.mu.Unlock()
	s.emitEvent("ai:provider:status", descriptor)
	return descriptor, nil
}

func (s *Service) ClearProviderSecret(ctx context.Context, providerID string) (providers.AIProviderDescriptor, error) {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return providers.AIProviderDescriptor{}, fmt.Errorf("provider id is empty")
	}
	s.mu.RLock()
	var setting providers.AIProviderSettings
	found := false
	for _, candidate := range s.settings.Providers {
		if candidate.ID == providerID {
			setting = candidate
			found = true
			break
		}
	}
	s.mu.RUnlock()
	if !found {
		return providers.AIProviderDescriptor{}, fmt.Errorf("provider %q is not configured", providerID)
	}
	setting.ClearSecret = true
	return s.SaveProviderSettings(ctx, setting)
}

func (s *Service) RefreshLocalProviders(ctx context.Context) (AIDiscoveryResult, error) {
	return s.refreshLocalProviders(ctx, localDiscoveryProviderSettings())
}

func (s *Service) refreshLocalProviders(ctx context.Context, candidates []providers.AIProviderSettings) (AIDiscoveryResult, error) {
	discovered := []providers.AIProviderDescriptor{}
	discoveredIDs := map[string]struct{}{}
	checkedIDs := map[string]struct{}{}
	for _, candidate := range candidates {
		if !isLoopbackEndpoint(candidate.Endpoint) {
			continue
		}
		checkedIDs[candidate.ID] = struct{}{}
		provider := s.providerFromSettings(candidate)
		if provider == nil {
			continue
		}
		checkCtx, cancel := context.WithTimeout(ctx, 350*time.Millisecond)
		descriptor := provider.HealthCheck(checkCtx)
		cancel()
		if descriptor.Status != providers.ProviderStatusReady {
			s.mu.Lock()
			delete(s.providers, descriptor.ID)
			s.descriptors[descriptor.ID] = descriptor
			s.mu.Unlock()
			s.emitEvent("ai:provider:status", descriptor)
			continue
		}
		discoveredIDs[descriptor.ID] = struct{}{}
		s.mu.Lock()
		s.providers[descriptor.ID] = provider
		s.descriptors[descriptor.ID] = descriptor
		s.mu.Unlock()
		discovered = append(discovered, descriptor)
		s.emitEvent("ai:provider:status", descriptor)
	}
	s.mu.Lock()
	if _, checked := checkedIDs[s.settings.ActiveProviderID]; s.settings.ActiveProviderID == "" || checked {
		if _, ready := discoveredIDs[s.settings.ActiveProviderID]; !ready {
			s.settings.ActiveProviderID = ""
			s.settings.ActiveModel = ""
		}
	}
	if s.settings.ActiveProviderID == "" && len(discovered) > 0 {
		s.settings.ActiveProviderID = discovered[0].ID
		s.settings.ActiveModel = discovered[0].DefaultModel
	}
	s.mu.Unlock()
	result := AIDiscoveryResult{Providers: discovered, CheckedAt: utcNow()}
	s.emitEvent("ai:discovery:completed", result)
	return result, nil
}

func (s *Service) TestProvider(ctx context.Context, providerID string) (providers.AIProviderDescriptor, error) {
	provider, ok := s.provider(providerID)
	if !ok {
		return providers.AIProviderDescriptor{}, fmt.Errorf("provider %q is not configured", providerID)
	}
	checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	descriptor := provider.HealthCheck(checkCtx)
	s.mu.Lock()
	s.descriptors[descriptor.ID] = descriptor
	s.mu.Unlock()
	s.emitEvent("ai:provider:status", descriptor)
	if descriptor.Status != providers.ProviderStatusReady {
		return descriptor, errors.New(descriptor.Reason)
	}
	return descriptor, nil
}

func (s *Service) ContextPreview(projectID string, req AIContextRequest) (AIContextSnapshot, error) {
	project := s.project(projectID)
	if project == nil {
		return AIContextSnapshot{}, fmt.Errorf("AI project session is not open")
	}
	return s.buildContextSnapshot(project, req), nil
}

func (s *Service) EditorContinuation(ctx context.Context, projectID string, req AIContextRequest, providerID string, model string) (AIContinuationResponse, error) {
	req.Capability = providers.CapabilityLinePrediction
	return s.generateContinuation(ctx, projectID, req, providerID, model, 96)
}

func (s *Service) TerminalContinuation(ctx context.Context, projectID string, req AIContextRequest, providerID string, model string) (AIContinuationResponse, error) {
	req.Capability = providers.CapabilityTerminalPrediction
	return s.generateContinuation(ctx, projectID, req, providerID, model, 48)
}

func (s *Service) SetMnemonicEnabled(projectID string, enabled bool) (AIStatus, error) {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return AIStatus{}, fmt.Errorf("AI project session is not open")
	}
	if !enabled {
		s.waitForRuns(s.cancelRuns(projectID))
	}
	if err := project.Mnemonic.SetEnabled(enabled); err != nil {
		return AIStatus{}, err
	}
	if !enabled {
		if project.Skills != nil {
			if err := project.Skills.ClearRuntime(); err != nil {
				return AIStatus{}, err
			}
		}
		if err := resetMnemonicContextFile(project.ProjectRoot); err != nil {
			return AIStatus{}, err
		}
	}
	return s.Status(projectID), nil
}

func (s *Service) ClearMnemonic(projectID string) error {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return nil
	}
	s.waitForRuns(s.cancelRuns(projectID))
	if err := project.Mnemonic.Clear(); err != nil {
		return err
	}
	if project.Skills != nil {
		if err := project.Skills.ClearRuntime(); err != nil {
			return err
		}
	}
	if err := resetMnemonicContextFile(project.ProjectRoot); err != nil {
		return err
	}
	return nil
}

func (s *Service) ClearState(projectID string) error {
	projectID = normalizeProjectID(projectID)
	s.waitForRuns(s.cancelRuns(projectID))
	s.clearToolApprovalsForProject(projectID)
	project := s.project(projectID)
	if project != nil {
		if project.Egress != nil {
			if err := project.Egress.Clear(); err != nil {
				return err
			}
		}
		if project.ToolAudit != nil {
			if err := project.ToolAudit.Clear(); err != nil {
				return err
			}
		}
		if project.RunTimeline != nil {
			if err := project.RunTimeline.Clear(); err != nil {
				return err
			}
		}
		if project.ToolApprovalGrants != nil {
			if err := project.ToolApprovalGrants.Clear(); err != nil {
				return err
			}
		}
		if project.ModelCapabilityProbes != nil {
			if err := project.ModelCapabilityProbes.Clear(); err != nil {
				return err
			}
		}
		if project.Mnemonic != nil {
			if err := project.Mnemonic.Clear(); err != nil {
				return err
			}
		}
		if project.Skills != nil {
			if err := project.Skills.ClearRuntime(); err != nil {
				return err
			}
		}
		if err := resetMnemonicContextFile(project.ProjectRoot); err != nil {
			return err
		}
	}
	s.mu.Lock()
	for runID, run := range s.runs {
		if run.ProjectSessionID == projectID {
			delete(s.runs, runID)
			delete(s.runCancels, runID)
			delete(s.runDone, runID)
		}
	}
	s.mu.Unlock()
	return nil
}

func (s *Service) generateContinuation(ctx context.Context, projectID string, req AIContextRequest, providerID string, model string, maxTokens int) (AIContinuationResponse, error) {
	project := s.project(projectID)
	if project == nil {
		return AIContinuationResponse{}, fmt.Errorf("AI project session is not open")
	}
	snapshot := s.buildContextSnapshot(project, req)
	provider, descriptor, err := s.resolveProvider(providerID)
	if err != nil {
		return AIContinuationResponse{Context: snapshot}, err
	}
	if !capabilityAllowed(descriptor.Capabilities, req.Capability) {
		return AIContinuationResponse{Context: snapshot}, fmt.Errorf("provider %s does not support %s", descriptor.ID, req.Capability)
	}
	prompt := buildPromptFromSnapshot(snapshot)
	optInSource := "editor_continuation"
	if req.Capability == providers.CapabilityTerminalPrediction {
		optInSource = "terminal_continuation"
	}
	record, response, err := s.callProvider(ctx, project, descriptor, provider, providers.GenerationRequest{
		Capability: req.Capability,
		Prompt:     prompt,
		System:     "Return only the next safe code or terminal continuation. Do not include explanations.",
		Model:      firstNonEmpty(model, descriptor.DefaultModel),
		MaxTokens:  maxTokens,
	}, snapshot, optInSource)
	if err != nil {
		return AIContinuationResponse{Context: snapshot, Egress: &record}, err
	}
	return AIContinuationResponse{
		RequestID:       snapshot.RequestID,
		DocumentVersion: snapshot.DocumentVersion,
		Text:            response.Text,
		ProviderID:      descriptor.ID,
		Model:           response.Model,
		Context:         snapshot,
		Egress:          &record,
	}, nil
}

func (s *Service) buildContextSnapshot(project *ProjectSession, req AIContextRequest) AIContextSnapshot {
	if req.Capability == "" {
		req.Capability = providers.CapabilityChat
	}
	snapshot := AIContextSnapshot{
		ID:               uuid.NewString(),
		RequestID:        strings.TrimSpace(req.RequestID),
		DocumentVersion:  strings.TrimSpace(req.DocumentVersion),
		Capability:       req.Capability,
		ProjectPathHash:  hashProjectPath(project.ProjectRoot),
		ProjectSessionID: project.ID,
		FilePath:         req.FilePath,
		Language:         strings.TrimSpace(req.Language),
		Line:             req.Line,
		Column:           req.Column,
		Prompt:           req.Prompt,
		TerminalInput:    req.TerminalInput,
		TerminalWorkDir:  req.TerminalWorkDir,
		DataCategories:   []string{"user_prompt"},
		ApprovalSummary:  s.approvalSummaryForProject(project),
		CreatedAt:        utcNow(),
	}
	for _, item := range req.ContextItems {
		if s.materializeMentionContextItem(project, &snapshot, req, item) {
			continue
		}
		addContextItemDisclosure(&snapshot, item.Kind, item.Label, item.Path, firstNonEmpty(item.Source, "request"), true, false, 0, "requested")
	}
	if req.FilePath != "" || req.FullText != "" || req.TextBefore != "" || req.TextAfter != "" {
		snapshot.DataCategories = append(snapshot.DataCategories, "current_file_context")
		content, displayPath, reason := currentFileContextContent(project.ProjectRoot, req)
		if displayPath == "" {
			displayPath = req.FilePath
		}
		if content != "" {
			snapshot.Snippets = append(snapshot.Snippets, AIContextSnippet{
				Type:     "current_file",
				Path:     displayPath,
				Language: req.Language,
				Content:  content,
			})
			addContextItemDisclosure(&snapshot, AIContextItemKindFile, filepath.Base(displayPath), displayPath, "current_file", true, true, len(content), "")
		} else {
			addContextItemDisclosure(&snapshot, AIContextItemKindFile, filepath.Base(displayPath), displayPath, "current_file", true, false, 0, firstNonEmpty(reason, "empty"))
		}
	}
	if req.Selection != "" {
		snapshot.DataCategories = append(snapshot.DataCategories, "selection")
		snapshot.Snippets = append(snapshot.Snippets, AIContextSnippet{
			Type:     "selection",
			Path:     req.FilePath,
			Language: req.Language,
			Content:  req.Selection,
		})
		addContextItemDisclosure(&snapshot, AIContextItemKindSelection, "Selection", req.FilePath, "selection", true, true, len(req.Selection), "")
	}
	if req.MaxSnippets > 3 && strings.TrimSpace(req.Prompt) != "" {
		fastSnippets := fastContextSnippets(project.ProjectRoot, req.Prompt, req.FilePath, 3)
		if len(fastSnippets) > 0 {
			snapshot.DataCategories = append(snapshot.DataCategories, "fast_context")
			bytes := 0
			for _, snippet := range fastSnippets {
				bytes += len(snippet.Content)
				snapshot.Snippets = append(snapshot.Snippets, snippet)
			}
			addContextItemDisclosure(&snapshot, AIContextItemKindWorkspace, "Fast context", "", "fast_context", true, true, bytes, fmt.Sprintf("%d local matches", len(fastSnippets)))
		} else {
			addContextItemDisclosure(&snapshot, AIContextItemKindWorkspace, "Fast context", "", "fast_context", true, false, 0, "no local matches")
		}
	}
	if req.TerminalInput != "" {
		snapshot.DataCategories = append(snapshot.DataCategories, "terminal_input")
		addContextItemDisclosure(&snapshot, AIContextItemKindTerminal, "Terminal input", req.TerminalWorkDir, "terminal", true, true, len(req.TerminalInput), "")
	}
	if req.IncludeMCP && s.mcpContext != nil {
		if plane, err := s.mcpContext(project.ProjectRoot); err == nil {
			snapshot.MCPContext = &plane
			if plane.Available {
				snapshot.DataCategories = append(snapshot.DataCategories, "mcp_tool_metadata")
				content := formatMCPContextForPrompt(plane)
				if content != "" {
					snapshot.Snippets = append(snapshot.Snippets, AIContextSnippet{
						Type:    "mcp_context",
						Content: content,
					})
				}
				addContextItemDisclosure(&snapshot, AIContextItemKindMCP, "MCP metadata", "", "mcp", true, true, len(content), "")
			} else {
				addContextItemDisclosure(&snapshot, AIContextItemKindMCP, "MCP metadata", "", "mcp", true, false, 0, plane.ExecutionState)
			}
		}
	}
	if req.IncludeMnemonic && project.Mnemonic != nil && project.Mnemonic.Enabled() {
		entries, _ := project.Mnemonic.List(12)
		for _, entry := range entries {
			snapshot.Mnemonic = append(snapshot.Mnemonic, fromMnemonicEntry(entry))
		}
		if len(snapshot.Mnemonic) > 0 {
			snapshot.DataCategories = append(snapshot.DataCategories, "mnemonic")
		}
		addContextItemDisclosure(&snapshot, AIContextItemKindMnemonic, "Mnemonic", "", "mnemonic", true, len(snapshot.Mnemonic) > 0, len(snapshot.Mnemonic), mnemonicContextReason(snapshot.Mnemonic))
	} else if req.IncludeMnemonic {
		addContextItemDisclosure(&snapshot, AIContextItemKindMnemonic, "Mnemonic", "", "mnemonic", true, false, 0, "disabled")
	}
	if req.IncludeSkills && project.Skills != nil && project.Mnemonic != nil && project.Mnemonic.Enabled() {
		items, _ := project.Skills.Context(skills.ContextRequest{
			WorkspaceRootHash: snapshot.ProjectPathHash,
			AgentSurface:      string(snapshot.Capability),
			Limit:             6,
		})
		for _, item := range items {
			snapshot.Skills = append(snapshot.Skills, fromSkillContext(item))
		}
		if len(snapshot.Skills) > 0 {
			snapshot.DataCategories = append(snapshot.DataCategories, "skill_residency")
		}
		addContextItemDisclosure(&snapshot, AIContextItemKindSkill, "Skills", "", "skills", true, len(snapshot.Skills) > 0, len(snapshot.Skills), skillContextReason(snapshot.Skills))
	} else if req.IncludeSkills {
		addContextItemDisclosure(&snapshot, AIContextItemKindSkill, "Skills", "", "skills", true, false, 0, "disabled")
	}
	snapshot = newPrivacyGate().SanitizeSnapshot(snapshot, req.MaxBytes, req.MaxSnippets)
	for i := range snapshot.ContextItems {
		if snapshot.Redaction.Truncated && snapshot.ContextItems[i].Included {
			snapshot.ContextItems[i].Truncated = true
		}
	}
	snapshot.SnippetBreakdown = snippetBreakdown(snapshot.Snippets)
	snapshot.Disclosure = AIContextDisclosure{
		Capability:     snapshot.Capability,
		DataCategories: snapshot.DataCategories,
		Redaction:      snapshot.Redaction,
	}
	snapshot.DisclosureSummary = AIContextDisclosureSummary{
		DataCategories: snapshot.DataCategories,
		OptInSource:    "context_preview",
	}
	return snapshot
}

func currentFileContextContent(projectRoot string, req AIContextRequest) (string, string, string) {
	content := currentFileWindow(req)
	if strings.TrimSpace(content) != "" {
		return content, req.FilePath, ""
	}
	if req.Capability != providers.CapabilityChat || strings.TrimSpace(req.FilePath) == "" {
		return "", req.FilePath, ""
	}
	absPath, relPath, reason := resolveMentionFilePath(projectRoot, req.FilePath)
	if reason != "" {
		return "", firstNonEmpty(relPath, req.FilePath), reason
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", relPath, "read_error"
	}
	if len(data) == 0 {
		return "", relPath, "empty"
	}
	if strings.Contains(string(data), "\x00") {
		return "", relPath, "binary"
	}
	return truncateUTF8(string(data), mentionFileSnippet), relPath, ""
}

func summarizeContextSnapshot(snapshot AIContextSnapshot) AIContextSummary {
	return AIContextSummary{
		ID:                snapshot.ID,
		RequestID:         snapshot.RequestID,
		DocumentVersion:   snapshot.DocumentVersion,
		Capability:        snapshot.Capability,
		ProjectSessionID:  snapshot.ProjectSessionID,
		FilePath:          snapshot.FilePath,
		Language:          snapshot.Language,
		SnippetCount:      len(snapshot.Snippets),
		MnemonicCount:     len(snapshot.Mnemonic),
		SkillCount:        len(snapshot.Skills),
		MCPIncluded:       snapshot.MCPContext != nil && snapshot.MCPContext.Available,
		MCPContext:        snapshot.MCPContext,
		SnippetBreakdown:  snapshot.SnippetBreakdown,
		ContextItems:      snapshot.ContextItems,
		DataCategories:    snapshot.DataCategories,
		Redaction:         snapshot.Redaction,
		DisclosureSummary: snapshot.DisclosureSummary,
		ByteSize:          snapshot.ByteSize,
		CreatedAt:         snapshot.CreatedAt,
	}
}

func addContextItemDisclosure(snapshot *AIContextSnapshot, kind AIContextItemKind, label string, path string, source string, requested bool, included bool, bytes int, reason string) {
	if snapshot == nil || kind == "" {
		return
	}
	label = strings.TrimSpace(label)
	if label == "" {
		label = string(kind)
	}
	id := string(kind) + ":" + strings.TrimSpace(source) + ":" + strings.TrimSpace(path) + ":" + label
	for i := range snapshot.ContextItems {
		item := &snapshot.ContextItems[i]
		if item.Kind == kind && item.Path == path && item.Source == source {
			item.Requested = item.Requested || requested
			item.Included = item.Included || included
			item.Bytes += bytes
			if reason != "" {
				item.Reason = reason
			}
			if label != string(kind) {
				item.Label = label
			}
			return
		}
	}
	snapshot.ContextItems = append(snapshot.ContextItems, AIContextItemDisclosure{
		ID:        shortHash(id),
		Kind:      kind,
		Label:     label,
		Path:      strings.TrimSpace(path),
		Source:    strings.TrimSpace(source),
		Requested: requested,
		Included:  included,
		Bytes:     bytes,
		Reason:    strings.TrimSpace(reason),
	})
}

func mnemonicContextReason(entries []AIMnemonicEntry) string {
	if len(entries) == 0 {
		return "no_entries"
	}
	pinned := 0
	generated := 0
	stale := 0
	for _, entry := range entries {
		if entry.Pinned {
			pinned++
		}
		if entry.Generated || entry.Trust == mnemonic.TrustGenerated {
			generated++
		}
		if entry.Superseded || !entry.IsLatest {
			stale++
		}
	}
	parts := []string{fmt.Sprintf("%d included", len(entries))}
	if pinned > 0 {
		parts = append(parts, fmt.Sprintf("%d pinned", pinned))
	}
	if generated > 0 {
		parts = append(parts, fmt.Sprintf("%d generated", generated))
	}
	if stale > 0 {
		parts = append(parts, fmt.Sprintf("%d stale", stale))
	}
	return strings.Join(parts, ", ")
}

func fastContextSnippets(projectRoot string, prompt string, currentPath string, limit int) []AIContextSnippet {
	terms := fastContextTerms(prompt)
	if len(terms) == 0 || limit <= 0 {
		return nil
	}
	currentPath = filepath.Clean(currentPath)
	snippets := []AIContextSnippet{}
	_ = filepath.WalkDir(projectRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil || len(snippets) >= limit {
			return nil
		}
		name := entry.Name()
		if entry.IsDir() {
			switch name {
			case ".git", "node_modules", "dist", "build", ".wails", ".arlecchino", "vendor":
				return filepath.SkipDir
			}
			return nil
		}
		if currentPath != "." && filepath.Clean(path) == currentPath {
			return nil
		}
		if !fastContextFileAllowed(name) {
			return nil
		}
		info, statErr := entry.Info()
		if statErr != nil || info.Size() <= 0 || info.Size() > 64*1024 {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil || strings.Contains(string(content), "\x00") {
			return nil
		}
		lower := strings.ToLower(string(content))
		score := 0
		for _, term := range terms {
			if strings.Contains(lower, term) {
				score++
			}
		}
		if score == 0 {
			return nil
		}
		rel, _ := filepath.Rel(projectRoot, path)
		snippets = append(snippets, AIContextSnippet{
			Type:    "fast_context",
			Path:    filepath.ToSlash(rel),
			Content: truncateUTF8(string(content), 2400),
		})
		return nil
	})
	return snippets
}

func fastContextTerms(prompt string) []string {
	fields := strings.FieldsFunc(strings.ToLower(prompt), func(r rune) bool {
		return !(r == '_' || r == '-' || r == '.' || r == '/' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	})
	seen := map[string]struct{}{}
	terms := []string{}
	for _, field := range fields {
		field = strings.Trim(field, " ./_-")
		if len(field) < 4 {
			continue
		}
		if _, ok := seen[field]; ok {
			continue
		}
		seen[field] = struct{}{}
		terms = append(terms, field)
		if len(terms) >= 8 {
			break
		}
	}
	return terms
}

func fastContextFileAllowed(name string) bool {
	lower := strings.ToLower(name)
	if strings.HasPrefix(lower, ".env") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") {
		return false
	}
	switch filepath.Ext(lower) {
	case ".go", ".ts", ".tsx", ".js", ".jsx", ".css", ".md", ".json", ".yaml", ".yml", ".toml":
		return true
	default:
		return false
	}
}

func skillContextReason(items []AISkillContext) string {
	if len(items) == 0 {
		return "no_matching_skills"
	}
	return "included"
}

func snippetBreakdown(snippets []AIContextSnippet) []AIContextSnippetBreakdown {
	if len(snippets) == 0 {
		return nil
	}
	byType := map[string]int{}
	bytesByType := map[string]int{}
	order := []string{}
	for _, snippet := range snippets {
		typ := strings.TrimSpace(snippet.Type)
		if typ == "" {
			typ = "unknown"
		}
		if _, ok := byType[typ]; !ok {
			order = append(order, typ)
		}
		byType[typ]++
		bytesByType[typ] += len(snippet.Content)
	}
	breakdown := make([]AIContextSnippetBreakdown, 0, len(order))
	for _, typ := range order {
		breakdown = append(breakdown, AIContextSnippetBreakdown{
			Type:  typ,
			Count: byType[typ],
			Bytes: bytesByType[typ],
		})
	}
	return breakdown
}

func currentFileWindow(req AIContextRequest) string {
	if req.FullText == "" {
		return strings.TrimSpace(strings.Join([]string{req.TextBefore, req.LineText, req.TextAfter}, "\n"))
	}
	lines := strings.Split(req.FullText, "\n")
	if req.Line <= 0 || req.Line > len(lines) {
		return truncateUTF8(req.FullText, 12*1024)
	}
	start := req.Line - 20
	if start < 1 {
		start = 1
	}
	end := req.Line + 20
	if end > len(lines) {
		end = len(lines)
	}
	return strings.Join(lines[start-1:end], "\n")
}

func (s *Service) callProvider(ctx context.Context, project *ProjectSession, descriptor providers.AIProviderDescriptor, provider providers.Provider, req providers.GenerationRequest, snapshot AIContextSnapshot, optInSource string) (AIEgressRecord, providers.GenerationResponse, error) {
	started := time.Now()
	requestID := uuid.NewString()
	record := AIEgressRecord{
		ID:               "eg-" + requestID,
		RequestID:        requestID,
		ProviderID:       descriptor.ID,
		ProviderKind:     descriptor.Kind,
		Endpoint:         descriptor.Endpoint,
		Model:            firstNonEmpty(req.Model, descriptor.DefaultModel),
		ReasoningEffort:  req.ReasoningEffort,
		Capability:       req.Capability,
		ProjectPathHash:  hashProjectPath(project.ProjectRoot),
		ProjectSessionID: project.ID,
		DataCategories:   snapshot.DataCategories,
		Redaction:        snapshot.Redaction,
		Status:           "started",
		OptInSource:      optInSource,
		CreatedAt:        utcNow(),
		Source:           optInSource,
	}
	providerCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	response, err := provider.Generate(providerCtx, req, nil)
	record.LatencyMs = time.Since(started).Milliseconds()
	if err != nil {
		record.Status = "error"
		record.ErrorClass = errorClass(err)
		record.Canceled = errors.Is(providerCtx.Err(), context.Canceled) || errors.Is(ctx.Err(), context.Canceled)
	} else {
		record.Status = "completed"
	}
	applyGenerationUsageToEgress(&record, req, response, descriptor, chatToolset{Profile: chatToolProfileNone, ToolSupport: true})
	if project.Egress != nil {
		stored, ledgerErr := project.Egress.Append(record)
		if ledgerErr == nil {
			record = stored
		}
	}
	s.emitEvent("ai:chat:egress-recorded", record)
	return record, response, err
}

func (s *Service) ListEgressRecords(projectID string, limit int) ([]AIEgressRecord, error) {
	project := s.project(projectID)
	if project == nil || project.Egress == nil {
		return []AIEgressRecord{}, nil
	}
	return project.Egress.List(limit)
}

func (s *Service) currentSettings() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings
}

func (s *Service) project(projectID string) *ProjectSession {
	projectID = normalizeProjectID(projectID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.projects[projectID]
}

func (s *Service) projectIsCurrent(projectID string, project *ProjectSession) bool {
	if project == nil {
		return false
	}
	projectID = normalizeProjectID(projectID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.projects[projectID] == project
}

func normalizeProjectID(projectID string) string {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return "main"
	}
	return projectID
}

func (s *Service) provider(providerID string) (providers.Provider, bool) {
	providerID = strings.TrimSpace(providerID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	provider, ok := s.providers[providerID]
	return provider, ok
}

func (s *Service) resolveProvider(providerID string) (providers.Provider, providers.AIProviderDescriptor, error) {
	settings := s.currentSettings()
	if !settings.Enabled {
		return nil, providers.AIProviderDescriptor{}, fmt.Errorf("AI providers are disabled")
	}
	if !normalizeConsentPolicy(settings.ConsentPolicy).LocalProvidersAccepted {
		return nil, providers.AIProviderDescriptor{}, fmt.Errorf("local AI provider disclosure is not accepted")
	}
	if strings.TrimSpace(providerID) == "" {
		providerID = settings.ActiveProviderID
	}
	s.mu.RLock()
	provider := s.providers[providerID]
	descriptor := s.descriptors[providerID]
	s.mu.RUnlock()
	if descriptor.Frontier || !descriptor.Local {
		return nil, descriptor, fmt.Errorf("frontier providers are disabled in this backend slice")
	}
	if provider == nil {
		return nil, descriptor, fmt.Errorf("AI provider %q is not ready", providerID)
	}
	if descriptor.Status != providers.ProviderStatusReady && descriptor.Status != providers.ProviderStatusDiscovered {
		return nil, descriptor, fmt.Errorf("AI provider %q status is %s", providerID, descriptor.Status)
	}
	return provider, descriptor, nil
}

func (s *Service) registerConfiguredProvidersLocked() {
	for _, setting := range s.settings.Providers {
		if !setting.Enabled {
			descriptor := descriptorFromSettings(setting)
			descriptor.Status = providers.ProviderStatusDisabled
			s.descriptors[descriptor.ID] = descriptor
			delete(s.providers, descriptor.ID)
			continue
		}
		provider := s.providerFromSettingsLocked(setting)
		if provider == nil {
			descriptor := descriptorFromSettings(setting)
			if descriptor.ID != "" {
				s.descriptors[descriptor.ID] = descriptor
				delete(s.providers, descriptor.ID)
			}
			continue
		}
		descriptor := provider.Descriptor()
		s.providers[descriptor.ID] = provider
		s.descriptors[descriptor.ID] = descriptor
	}
	s.registerFrontierPlaceholdersLocked()
}

func (s *Service) registerFrontierPlaceholdersLocked() {
	for _, descriptor := range frontierProviderDescriptors() {
		if _, exists := s.descriptors[descriptor.ID]; !exists {
			s.descriptors[descriptor.ID] = descriptor
		}
	}
}

func (s *Service) providerFromSettings(setting providers.AIProviderSettings) providers.Provider {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.providerFromSettingsLocked(setting)
}

func (s *Service) providerFromSettingsLocked(setting providers.AIProviderSettings) providers.Provider {
	spec, ok := providerSpecForKind(setting.Kind)
	if !ok || spec.Factory == nil {
		return nil
	}
	if spec.Local && setting.Endpoint != "" && !isLoopbackEndpoint(setting.Endpoint) {
		return nil
	}
	return spec.Factory(setting, spec, "")
}

func descriptorFromSettings(setting providers.AIProviderSettings) providers.AIProviderDescriptor {
	spec, ok := providerSpecForKind(setting.Kind)
	if !ok {
		return providers.AIProviderDescriptor{
			ID:           setting.ID,
			Name:         firstNonEmpty(setting.Name, setting.Kind),
			Kind:         setting.Kind,
			Endpoint:     setting.Endpoint,
			Manual:       setting.Manual,
			Capabilities: normalizeCapabilities(setting.Capabilities),
			DefaultModel: setting.Model,
			Status:       providers.ProviderStatusDisabled,
		}
	}
	return descriptorFromSpec(setting, spec, providers.ProviderStatusDisabled)
}

func isLocalProviderKind(kind string) bool {
	spec, ok := providerSpecForKind(kind)
	return ok && spec.Local
}

func isFrontierProviderKind(kind string) bool {
	spec, ok := providerSpecForKind(kind)
	return ok && spec.Frontier
}

func validateProviderSettings(setting providers.AIProviderSettings) error {
	spec, ok := providerSpecForKind(setting.Kind)
	if !ok {
		return nil
	}
	if spec.Local && setting.Endpoint != "" && !isLoopbackEndpoint(setting.Endpoint) {
		return fmt.Errorf("local AI provider %q endpoint must use localhost, 127.0.0.1, or ::1", setting.ID)
	}
	return nil
}

func isLoopbackEndpoint(endpoint string) bool {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func buildPromptFromSnapshot(snapshot AIContextSnapshot) string {
	parts := []string{}
	if snapshot.Prompt != "" {
		parts = append(parts, "User intent:\n"+snapshot.Prompt)
	}
	for _, snippet := range snapshot.Snippets {
		if strings.TrimSpace(snippet.Content) == "" {
			continue
		}
		label := snippet.Type
		if snippet.Path != "" {
			label += " " + filepath.Base(snippet.Path)
		}
		parts = append(parts, label+":\n"+snippet.Content)
	}
	if snapshot.TerminalInput != "" {
		parts = append(parts, "Terminal input:\n"+snapshot.TerminalInput)
	}
	if len(snapshot.Mnemonic) > 0 {
		lines := []string{}
		for _, entry := range snapshot.Mnemonic {
			lines = append(lines, "- "+entry.Content)
		}
		parts = append(parts, "Mnemonic context:\n"+strings.Join(lines, "\n"))
	}
	if len(snapshot.Skills) > 0 {
		lines := []string{}
		for _, skill := range snapshot.Skills {
			line := "- " + skill.Name + ": " + skill.Summary
			if len(skill.OperatingReminders) > 0 {
				line += " | reminders: " + strings.Join(skill.OperatingReminders, "; ")
			}
			if len(skill.AvoidRules) > 0 {
				line += " | avoid: " + strings.Join(skill.AvoidRules, "; ")
			}
			if len(skill.ToolHints) > 0 {
				line += " | tool hints: " + strings.Join(skill.ToolHints, ", ")
			}
			lines = append(lines, line)
		}
		parts = append(parts, "Resident skill context:\n"+strings.Join(lines, "\n"))
	}
	return strings.Join(parts, "\n\n")
}

func fromSkillContext(item skills.ContextSkill) AISkillContext {
	return AISkillContext{
		SkillID:            item.Record.SkillID,
		Name:               item.Record.Name,
		Description:        item.Record.Description,
		SourceKind:         item.Record.SourceKind,
		TrustState:         item.Record.TrustState,
		State:              item.State,
		ContentHash:        item.Record.ContentHash,
		DigestVersion:      item.Record.DigestVersion,
		Summary:            item.Digest.Summary,
		ActivationRules:    item.Digest.ActivationRules,
		OperatingReminders: item.Digest.OperatingReminders,
		AvoidRules:         item.Digest.AvoidRules,
		ToolHints:          item.Digest.ToolHints,
		VerificationHints:  item.Digest.VerificationHints,
		ResourcesIndex:     item.Digest.ResourcesIndex,
		TopicMatch:         item.TopicMatch,
		Confidence:         item.Confidence,
		ActivatedAt:        item.ActivatedAt,
		LastUsedAt:         item.LastUsedAt,
		DecayDeadline:      item.DecayDeadline,
	}
}

func fromMnemonicEntry(entry mnemonic.Entry) AIMnemonicEntry {
	out := AIMnemonicEntry{
		ID:             entry.ID,
		Type:           entry.Type,
		Source:         entry.Source,
		Tags:           entry.Tags,
		Content:        entry.Content,
		Importance:     entry.Importance,
		Confidence:     entry.Confidence,
		Trust:          entry.Trust,
		Pinned:         entry.Pinned,
		IsLatest:       entry.IsLatest,
		Decay:          entry.Decay,
		LastAccessedAt: entry.LastAccessedAt,
		AccessCount:    entry.AccessCount,
		Provenance:     entry.Provenance,
		Relationships:  fromMnemonicRelationships(entry.Relationships),
		CreatedAt:      entry.CreatedAt,
		UpdatedAt:      entry.UpdatedAt,
	}
	out.OriginKind = mnemonicOriginKind(entry)
	out.Generated = entry.Trust == mnemonic.TrustGenerated
	out.Superseded = !entry.IsLatest
	return out
}

func mnemonicOriginKind(entry mnemonic.Entry) string {
	switch entry.Trust {
	case mnemonic.TrustGenerated:
		return "generated"
	case mnemonic.TrustUntrusted:
		return "untrusted"
	default:
		if strings.TrimSpace(entry.Source) == "user" || strings.TrimSpace(entry.Source) == "" {
			return "user"
		}
		return "trusted"
	}
}

func capabilityAllowed(capabilities []providers.AIProviderCapability, capability providers.AIProviderCapability) bool {
	for _, candidate := range capabilities {
		if candidate == capability {
			return true
		}
	}
	return false
}

func hashProjectPath(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	sum := sha1.Sum([]byte(path))
	return hex.EncodeToString(sum[:])
}

func canonicalProjectRoot(projectRoot string) (string, error) {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return "", fmt.Errorf("project root is empty")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	evaluated, err := filepath.EvalSymlinks(abs)
	if err == nil {
		return filepath.Clean(evaluated), nil
	}
	if os.IsNotExist(err) {
		return abs, nil
	}
	return "", err
}

func resetMnemonicContextFile(projectRoot string) error {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil
	}
	path := filepath.Join(root, ".arlecchino", "memory", "CONTEXT.md")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(emptyMnemonicContextDocument()), 0o600)
}

func emptyMnemonicContextDocument() string {
	return "# Arlecchino Mnemonic Memory\n\nThis file is generated from project-local Mnemonic entries in `.arlecchino/ai/mnemonic.db`.\n\nUse it as a compact TUI recall surface: durable decisions, workflow facts, bug fixes, and handoff notes. Save new durable facts with `agent_memory.save`; search or list memory before relying on older context.\n\nNo saved project memory yet.\n"
}

func errorClass(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "auth"), strings.Contains(message, "key"):
		return "auth"
	case strings.Contains(message, "timeout"), strings.Contains(message, "deadline"):
		return "timeout"
	case strings.Contains(message, "connection"), strings.Contains(message, "refused"):
		return "unavailable"
	default:
		return "provider_error"
	}
}

type runWaiter struct {
	runID string
	done  <-chan struct{}
}

func (s *Service) cancelRuns(projectID string) []runWaiter {
	projectID = strings.TrimSpace(projectID)
	s.mu.Lock()
	defer s.mu.Unlock()
	waiters := []runWaiter{}
	for runID, run := range s.runs {
		if projectID != "" && run.ProjectSessionID != projectID {
			continue
		}
		if done := s.runDone[runID]; done != nil {
			waiters = append(waiters, runWaiter{runID: runID, done: done})
		}
		if run.Status == "running" {
			run.Status = "canceled"
			run.CanCancel = false
			run.UpdatedAt = utcNow()
		}
		if cancel := s.runCancels[runID]; cancel != nil {
			cancel()
		}
		delete(s.runCancels, runID)
	}
	return waiters
}

func (s *Service) waitForRuns(waiters []runWaiter) {
	if len(waiters) == 0 {
		return
	}
	timeout := time.NewTimer(2 * time.Second)
	defer timeout.Stop()
	for _, waiter := range waiters {
		if waiter.done == nil {
			continue
		}
		select {
		case <-waiter.done:
		case <-timeout.C:
			return
		}
	}
}

func sortDescriptors(descriptors []providers.AIProviderDescriptor) {
	for i := 0; i < len(descriptors); i++ {
		for j := i + 1; j < len(descriptors); j++ {
			if descriptors[j].ID < descriptors[i].ID {
				descriptors[i], descriptors[j] = descriptors[j], descriptors[i]
			}
		}
	}
}
