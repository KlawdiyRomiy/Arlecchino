package ai

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/ai/mnemonic"
	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

type EventEmitter func(name string, payload any)
type MCPContextProvider func(projectRoot string) (AIMCPContextPlane, error)

type ServiceOptions struct {
	SettingsPath       string
	SecretStore        SecretStore
	Emit               EventEmitter
	MCPContextProvider MCPContextProvider
}

type Service struct {
	mu           sync.RWMutex
	settings     Settings
	settingsPath string
	secretStore  SecretStore
	emit         EventEmitter
	mcpContext   MCPContextProvider
	providers    map[string]providers.Provider
	descriptors  map[string]providers.AIProviderDescriptor
	projects     map[string]*ProjectSession
	runs         map[string]*AIChatRun
	runCancels   map[string]context.CancelFunc
	runDone      map[string]chan struct{}
	started      bool
}

type ProjectSession struct {
	ID          string
	ProjectRoot string
	Mnemonic    *mnemonic.Store
	Egress      *EgressLedger
}

func NewService(options ServiceOptions) *Service {
	secretStore := options.SecretStore
	if secretStore == nil {
		secretStore = DefaultSecretStore()
	}
	return &Service{
		settingsPath: options.SettingsPath,
		secretStore:  secretStore,
		emit:         options.Emit,
		mcpContext:   options.MCPContextProvider,
		providers:    map[string]providers.Provider{},
		descriptors:  map[string]providers.AIProviderDescriptor{},
		projects:     map[string]*ProjectSession{},
		runs:         map[string]*AIChatRun{},
		runCancels:   map[string]context.CancelFunc{},
		runDone:      map[string]chan struct{}{},
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
	s.mu.Lock()
	s.runCancels = map[string]context.CancelFunc{}
	s.runDone = map[string]chan struct{}{}
	s.runs = map[string]*AIChatRun{}
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
	projectRoot = strings.TrimSpace(projectRoot)
	if projectRoot == "" {
		return nil, fmt.Errorf("project root is empty")
	}
	s.waitForRuns(s.cancelRuns(projectID))
	defaultEnabled := s.currentSettings().MnemonicDefaultEnabled
	store, err := mnemonic.Open(projectRoot, defaultEnabled)
	if err != nil {
		return nil, err
	}
	ledger, err := openEgressLedger(projectRoot)
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	project := &ProjectSession{
		ID:          projectID,
		ProjectRoot: projectRoot,
		Mnemonic:    store,
		Egress:      ledger,
	}
	s.mu.Lock()
	if previous := s.projects[projectID]; previous != nil {
		_ = previous.Close()
	}
	s.projects[projectID] = project
	s.mu.Unlock()
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

func (p *ProjectSession) Close() error {
	if p == nil || p.Mnemonic == nil {
		return nil
	}
	return p.Mnemonic.Close()
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
	defer s.mu.RUnlock()
	result := make([]providers.AIProviderDescriptor, 0, len(s.descriptors))
	for _, descriptor := range s.descriptors {
		result = append(result, descriptor)
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
	if err := project.Mnemonic.SetEnabled(enabled); err != nil {
		return AIStatus{}, err
	}
	return s.Status(projectID), nil
}

func (s *Service) ClearMnemonic(projectID string) error {
	project := s.project(projectID)
	if project == nil || project.Mnemonic == nil {
		return nil
	}
	return project.Mnemonic.Clear()
}

func (s *Service) ClearState(projectID string) error {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		projectID = "main"
	}
	s.waitForRuns(s.cancelRuns(projectID))
	project := s.project(projectID)
	if project != nil {
		if project.Egress != nil {
			if err := project.Egress.Clear(); err != nil {
				return err
			}
		}
		if project.Mnemonic != nil {
			if err := project.Mnemonic.Clear(); err != nil {
				return err
			}
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
	if req.FilePath != "" || req.FullText != "" || req.TextBefore != "" || req.TextAfter != "" {
		snapshot.DataCategories = append(snapshot.DataCategories, "current_file_context")
		content := currentFileWindow(req)
		if content != "" {
			snapshot.Snippets = append(snapshot.Snippets, AIContextSnippet{
				Type:     "current_file",
				Path:     req.FilePath,
				Language: req.Language,
				Content:  content,
			})
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
	}
	if req.TerminalInput != "" {
		snapshot.DataCategories = append(snapshot.DataCategories, "terminal_input")
	}
	if req.IncludeMCP && s.mcpContext != nil {
		if plane, err := s.mcpContext(project.ProjectRoot); err == nil {
			snapshot.MCPContext = &plane
			if plane.Available {
				snapshot.DataCategories = append(snapshot.DataCategories, "mcp_tool_metadata")
				if content := formatMCPContextForPrompt(plane); content != "" {
					snapshot.Snippets = append(snapshot.Snippets, AIContextSnippet{
						Type:    "mcp_context",
						Content: content,
					})
				}
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
	}
	snapshot = newPrivacyGate().SanitizeSnapshot(snapshot, req.MaxBytes, req.MaxSnippets)
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
		MCPIncluded:       snapshot.MCPContext != nil && snapshot.MCPContext.Available,
		MCPContext:        snapshot.MCPContext,
		SnippetBreakdown:  snapshot.SnippetBreakdown,
		DataCategories:    snapshot.DataCategories,
		Redaction:         snapshot.Redaction,
		DisclosureSummary: snapshot.DisclosureSummary,
		ByteSize:          snapshot.ByteSize,
		CreatedAt:         snapshot.CreatedAt,
	}
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
	providerCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
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
	return strings.Join(parts, "\n\n")
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
