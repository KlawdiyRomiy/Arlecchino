package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"arlecchino/internal/ai/mnemonic"
	"arlecchino/internal/ai/providers"
	"arlecchino/internal/mcp"
)

type fakeProvider struct {
	descriptor providers.AIProviderDescriptor
	text       string
}

func (p fakeProvider) Descriptor() providers.AIProviderDescriptor {
	return p.descriptor
}

func (p fakeProvider) ListModels(context.Context) ([]providers.AIModelDescriptor, error) {
	return p.descriptor.Models, nil
}

func (p fakeProvider) HealthCheck(context.Context) providers.AIProviderDescriptor {
	descriptor := p.descriptor
	descriptor.Status = providers.ProviderStatusReady
	return descriptor
}

func (p fakeProvider) Generate(_ context.Context, _ providers.GenerationRequest, sink providers.TokenSink) (providers.GenerationResponse, error) {
	if sink != nil {
		if err := sink(p.text); err != nil {
			return providers.GenerationResponse{}, err
		}
	}
	return providers.GenerationResponse{Text: p.text, Model: p.descriptor.DefaultModel}, nil
}

type blockingProvider struct {
	descriptor providers.AIProviderDescriptor
	started    chan struct{}
}

func (p *blockingProvider) Descriptor() providers.AIProviderDescriptor {
	return p.descriptor
}

func (p *blockingProvider) ListModels(context.Context) ([]providers.AIModelDescriptor, error) {
	return p.descriptor.Models, nil
}

func (p *blockingProvider) HealthCheck(context.Context) providers.AIProviderDescriptor {
	return p.descriptor
}

func (p *blockingProvider) Generate(ctx context.Context, _ providers.GenerationRequest, _ providers.TokenSink) (providers.GenerationResponse, error) {
	close(p.started)
	<-ctx.Done()
	return providers.GenerationResponse{}, ctx.Err()
}

type mapSecretStore struct {
	values  map[string]string
	cleared []string
}

func (s *mapSecretStore) FindSecret(_ context.Context, ref string) (string, error) {
	value, ok := s.values[ref]
	if !ok {
		return "", ErrSecretNotFound
	}
	return value, nil
}

func (s *mapSecretStore) SaveSecret(_ context.Context, ref string, value string) error {
	if s.values == nil {
		s.values = map[string]string{}
	}
	s.values[ref] = value
	return nil
}

func (s *mapSecretStore) ClearSecret(_ context.Context, ref string) error {
	delete(s.values, ref)
	s.cleared = append(s.cleared, ref)
	return nil
}

type eventLog struct {
	mu    sync.Mutex
	names []string
}

func (l *eventLog) emit(name string, _ any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.names = append(l.names, name)
}

func (l *eventLog) snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.names...)
}

func newTestService(t *testing.T, emit EventEmitter) *Service {
	t.Helper()
	settingsPath := filepath.Join(t.TempDir(), "ai-settings.json")
	service := NewService(ServiceOptions{SettingsPath: settingsPath, Emit: emit})
	service.settings = DefaultSettings()
	descriptor := providers.AIProviderDescriptor{
		ID:           "local-test",
		Name:         "Local Test",
		Kind:         "lm-studio",
		Endpoint:     "http://127.0.0.1:1234/v1",
		Local:        true,
		Capabilities: providers.DefaultCapabilities(),
		DefaultModel: "local-model",
		Status:       providers.ProviderStatusReady,
		Models:       []providers.AIModelDescriptor{{ID: "local-model", DisplayName: "local-model", Streaming: true}},
	}
	service.providers[descriptor.ID] = fakeProvider{descriptor: descriptor, text: "generated output"}
	service.descriptors[descriptor.ID] = descriptor
	service.settings.ActiveProviderID = descriptor.ID
	service.settings.ActiveModel = descriptor.DefaultModel
	return service
}

func TestPrivacyGateRedactsSecretsAndPaths(t *testing.T) {
	projectRoot := t.TempDir()
	service := newTestService(t, nil)
	project, err := service.OpenProject("main", projectRoot)
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	_, err = project.Mnemonic.Save(fromAIEntry(AIMnemonicEntry{
		Type:       "note",
		Content:    "token=super-secret-token-value",
		Importance: 3,
	}))
	if err != nil {
		t.Fatalf("save mnemonic: %v", err)
	}

	snapshot, err := service.ContextPreview("main", AIContextRequest{
		Capability:      providers.CapabilityChat,
		Prompt:          "debug /Users/tester/private/project with api_key=abc123456789",
		FullText:        "const password = \"abc123456789\"",
		FilePath:        "/Users/tester/private/project/main.go",
		TerminalInput:   "curl -H 'Authorization: Bearer abc123456789' http://127.0.0.1",
		IncludeMnemonic: true,
	})
	if err != nil {
		t.Fatalf("ContextPreview: %v", err)
	}
	encoded, _ := json.Marshal(snapshot)
	value := string(encoded)
	for _, forbidden := range []string{"abc123456789", "super-secret-token-value", "/Users/tester/private"} {
		if strings.Contains(value, forbidden) {
			t.Fatalf("snapshot leaked %q: %s", forbidden, value)
		}
	}
	if snapshot.Redaction.SecretsRedacted == 0 || snapshot.Redaction.PathsRedacted == 0 {
		t.Fatalf("redaction summary = %#v", snapshot.Redaction)
	}
}

func TestMnemonicIsProjectLocalAndClearable(t *testing.T) {
	service := newTestService(t, nil)
	projectA := t.TempDir()
	projectB := t.TempDir()
	sessionA, err := service.OpenProject("a", projectA)
	if err != nil {
		t.Fatalf("OpenProject a: %v", err)
	}
	if _, err := sessionA.Mnemonic.Save(fromAIEntry(AIMnemonicEntry{Type: "note", Content: "project a context", Importance: 5})); err != nil {
		t.Fatalf("save mnemonic: %v", err)
	}
	if _, err := service.OpenProject("b", projectB); err != nil {
		t.Fatalf("OpenProject b: %v", err)
	}

	snapshotA, err := service.ContextPreview("a", AIContextRequest{Prompt: "x", IncludeMnemonic: true})
	if err != nil {
		t.Fatalf("ContextPreview a: %v", err)
	}
	snapshotB, err := service.ContextPreview("b", AIContextRequest{Prompt: "x", IncludeMnemonic: true})
	if err != nil {
		t.Fatalf("ContextPreview b: %v", err)
	}
	if len(snapshotA.Mnemonic) != 1 {
		t.Fatalf("snapshotA mnemonic = %#v", snapshotA.Mnemonic)
	}
	if len(snapshotB.Mnemonic) != 0 {
		t.Fatalf("project b saw project a mnemonic: %#v", snapshotB.Mnemonic)
	}
	if err := service.ClearMnemonic("a"); err != nil {
		t.Fatalf("ClearMnemonic: %v", err)
	}
	snapshotA, err = service.ContextPreview("a", AIContextRequest{Prompt: "x", IncludeMnemonic: true})
	if err != nil {
		t.Fatalf("ContextPreview a after clear: %v", err)
	}
	if len(snapshotA.Mnemonic) != 0 {
		t.Fatalf("mnemonic was not cleared: %#v", snapshotA.Mnemonic)
	}
}

func TestMCPAgentMemoryDoesNotAutoPromoteIntoAIContext(t *testing.T) {
	projectRoot := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_SETTINGS_PATH", filepath.Join(t.TempDir(), "mcp-settings.json"))
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "shared-memory-code")

	toolService, err := mcp.NewToolService(projectRoot)
	if err != nil {
		t.Fatalf("NewToolService: %v", err)
	}
	defer toolService.Close()
	if _, err := toolService.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "shared-memory-code",
		"tool_name":     "agent_memory.save",
	}); err != nil {
		t.Fatalf("request memory permission: %v", err)
	}
	if _, err := toolService.CallTool("agent_memory.save", map[string]any{
		"type":       "decision",
		"tags":       []any{"tui", "mcp"},
		"importance": 8,
		"content":    "TUI agents should reuse Mnemonic context for project-local handoffs.",
	}); err != nil {
		t.Fatalf("save MCP memory: %v", err)
	}
	memoryContext, err := toolService.CallTool("agent_memory.context", map[string]any{"max_chars": 800})
	if err != nil {
		t.Fatalf("agent_memory.context: %v", err)
	}
	if !strings.Contains(fmt.Sprint(memoryContext), "TUI agents should reuse Mnemonic context") {
		t.Fatalf("MCP memory context did not include saved memory: %#v", memoryContext)
	}

	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", projectRoot); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	snapshot, err := service.ContextPreview("main", AIContextRequest{Prompt: "handoff", IncludeMnemonic: true})
	if err != nil {
		t.Fatalf("ContextPreview: %v", err)
	}
	for _, entry := range snapshot.Mnemonic {
		if strings.Contains(entry.Content, "TUI agents should reuse Mnemonic context") {
			t.Fatalf("generated MCP memory leaked into trusted AI context: %#v", snapshot.Mnemonic)
		}
	}
}

func TestContextPreviewIncludesMCPMetadataOnly(t *testing.T) {
	service := newTestService(t, nil)
	service.mcpContext = func(projectRoot string) (AIMCPContextPlane, error) {
		return AIMCPContextPlane{
			Enabled:               true,
			Available:             true,
			BridgeRunning:         true,
			ToolCount:             3,
			EnabledToolCount:      3,
			MemoryBackend:         "mnemonic",
			MnemonicSharedContext: true,
			ExecutionState:        string(AIToolExecutionStateNotExecutable),
			ToolGroups:            []AIMCPToolGroupSummary{{Name: "Agent Memory", Total: 3, Enabled: 3}},
			DataCategories:        []string{"mcp_tool_metadata"},
			UpdatedAt:             utcNow(),
		}, nil
	}
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	snapshot, err := service.ContextPreview("main", AIContextRequest{Prompt: "x", IncludeMCP: true})
	if err != nil {
		t.Fatalf("ContextPreview: %v", err)
	}
	if snapshot.MCPContext == nil || !snapshot.MCPContext.MnemonicSharedContext {
		t.Fatalf("MCP context missing: %#v", snapshot.MCPContext)
	}
	encoded, _ := json.Marshal(snapshot)
	value := string(encoded)
	if !strings.Contains(value, "mcp_tool_metadata") {
		t.Fatalf("MCP data category missing: %s", value)
	}
	for _, forbidden := range []string{"raw tool output", "terminal stdout", "git diff bodies"} {
		if strings.Contains(value, forbidden+" SECRET_VALUE") {
			t.Fatalf("MCP context leaked raw payload marker: %s", value)
		}
	}
	summary := summarizeContextSnapshot(snapshot)
	if !summary.MCPIncluded || summary.MCPContext == nil {
		t.Fatalf("MCP summary missing: %#v", summary)
	}
}

func TestFullAccessDoesNotGrantMCPPermission(t *testing.T) {
	projectRoot := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_SETTINGS_PATH", filepath.Join(t.TempDir(), "mcp-settings.json"))

	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", projectRoot); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	_, err := service.SaveApprovalPolicy("main", AIApprovalPolicy{
		Mode:             AIApprovalModeFullAccess,
		ProjectSessionID: "main",
		ProjectPathHash:  hashProjectPath(projectRoot),
		ExpiresAt:        time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
		AllowedToolKinds: []AIToolKind{AIToolKindMCP, AIToolKindFileWrite},
	})
	if err != nil {
		t.Fatalf("SaveApprovalPolicy: %v", err)
	}

	toolService, err := mcp.NewToolService(projectRoot)
	if err != nil {
		t.Fatalf("NewToolService: %v", err)
	}
	defer toolService.Close()
	_, err = toolService.CallTool("ide_control.write_file", map[string]any{
		"path":    "main.go",
		"content": "package main\n",
	})
	if err == nil {
		t.Fatal("MCP write should still require MCP approval under AI Full Access")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("MCP write error = %v", err)
	}
}

func TestContinuationWritesMetadataOnlyEgress(t *testing.T) {
	projectRoot := t.TempDir()
	service := newTestService(t, nil)
	project, err := service.OpenProject("main", projectRoot)
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	response, err := service.EditorContinuation(context.Background(), "main", AIContextRequest{
		Prompt:   "complete this sensitive prompt",
		FullText: "const secret = \"do-not-write-this\"",
		FilePath: filepath.Join(projectRoot, "main.ts"),
	}, "", "")
	if err != nil {
		t.Fatalf("EditorContinuation: %v", err)
	}
	if response.Text != "generated output" {
		t.Fatalf("response = %#v", response)
	}
	records, err := project.Egress.List(10)
	if err != nil {
		t.Fatalf("List egress: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("egress records = %#v", records)
	}
	data, err := os.ReadFile(filepath.Join(projectRoot, ".arlecchino", "ai", egressFileName))
	if err != nil {
		t.Fatalf("read egress file: %v", err)
	}
	for _, forbidden := range []string{"complete this sensitive prompt", "do-not-write-this", "generated output"} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("egress leaked %q: %s", forbidden, string(data))
		}
	}
}

func TestContinuationPreservesWhitespace(t *testing.T) {
	service := newTestService(t, nil)
	descriptor := service.descriptors["local-test"]
	service.providers[descriptor.ID] = fakeProvider{descriptor: descriptor, text: "\n  indented();\n"}
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	response, err := service.EditorContinuation(context.Background(), "main", AIContextRequest{
		RequestID:       "req-1",
		DocumentVersion: "v3",
		Prompt:          "continue",
	}, "", "")
	if err != nil {
		t.Fatalf("EditorContinuation: %v", err)
	}
	if response.Text != "\n  indented();\n" {
		t.Fatalf("continuation whitespace was changed: %q", response.Text)
	}
	if response.RequestID != "req-1" || response.DocumentVersion != "v3" {
		t.Fatalf("stale guards were not echoed: %#v", response)
	}
}

func TestMnemonicContentRespectsContextByteBudget(t *testing.T) {
	service := newTestService(t, nil)
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	if _, err := project.Mnemonic.Save(fromAIEntry(AIMnemonicEntry{Type: "note", Content: strings.Repeat("m", 100), Importance: 5})); err != nil {
		t.Fatalf("save mnemonic: %v", err)
	}
	snapshot, err := service.ContextPreview("main", AIContextRequest{
		Prompt:          "p",
		IncludeMnemonic: true,
		MaxBytes:        16,
	})
	if err != nil {
		t.Fatalf("ContextPreview: %v", err)
	}
	if snapshot.ByteSize > 16 {
		t.Fatalf("byte budget exceeded: size=%d mnemonic=%#v", snapshot.ByteSize, snapshot.Mnemonic)
	}
	if !snapshot.Redaction.Truncated {
		t.Fatalf("expected truncated redaction summary: %#v", snapshot.Redaction)
	}
}

func TestBuildChatRunEmitsToolProposalWithoutExecution(t *testing.T) {
	events := &eventLog{}
	service := newTestService(t, events.emit)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		Action:          AIChatActionBuild,
		Prompt:          "build this",
		IncludeMnemonic: true,
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	var final AIChatRun
	for i := 0; i < 100; i++ {
		final, err = service.GetChatRun("main", run.ID)
		if err == nil && final.Status != "running" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if final.Status != "completed" {
		t.Fatalf("final run = %#v", final)
	}
	if len(final.ToolProposals) == 0 {
		t.Fatalf("expected tool proposal in build mode")
	}
	if final.ToolProposals[0].Policy != AIToolPolicyReadOnly {
		t.Fatalf("proposal policy = %#v", final.ToolProposals)
	}
	for _, proposal := range final.ToolProposals {
		if proposal.ExecutionState != AIToolExecutionStateNotExecutable {
			t.Fatalf("proposal is executable in backend slice: %#v", proposal)
		}
		if proposal.AllowedByCurrentPolicy {
			t.Fatalf("proposal should not be policy-allowed by default: %#v", proposal)
		}
		if proposal.Kind == "" || proposal.RiskLevel == "" || proposal.ApprovalModeRequired == "" {
			t.Fatalf("proposal metadata incomplete: %#v", proposal)
		}
	}
	if !hasMCPToolProposal(final.ToolProposals, "ide_ui.open_file_panel") {
		t.Fatalf("expected metadata-only MCP proposal: %#v", final.ToolProposals)
	}
	for _, toolName := range []string{
		"ide_ui.surface_read",
		"ide_ui.open_panel",
		"ide_ui.move_panel",
		"ide_ui.close_panel",
	} {
		if !hasMCPToolProposal(final.ToolProposals, toolName) {
			t.Fatalf("expected metadata-only MCP proposal for %s: %#v", toolName, final.ToolProposals)
		}
	}
	eventNames := events.snapshot()
	if !containsEvent(eventNames, "ai:chat:tool-proposed") {
		t.Fatalf("events did not include tool proposal: %#v", eventNames)
	}
}

func TestAskChatActionIsReadOnlyAndRunnable(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		Action: AIChatActionAsk,
		Prompt: "what does this project do?",
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	if final.Status != "completed" {
		t.Fatalf("final run = %#v", final)
	}
	if final.Action != AIChatActionAsk {
		t.Fatalf("action = %q, want ask", final.Action)
	}
	if final.Response == "" {
		t.Fatalf("expected generated response: %#v", final)
	}
	if len(final.ToolProposals) != 0 {
		t.Fatalf("ask must not propose tools: %#v", final.ToolProposals)
	}
	if !containsChatAction(service.ListChatActions(), AIChatActionAsk) {
		t.Fatalf("ask action missing from registry")
	}
	if !containsPromptWorkflow(service.ListPromptWorkflows(), "/ask", AIChatActionAsk) {
		t.Fatalf("ask workflow missing from registry")
	}
}

func TestFullAccessMarksBuildProposalsAllowedButNeverExecutable(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	policy, err := service.SaveApprovalPolicy("main", AIApprovalPolicy{
		Mode:             AIApprovalModeFullAccess,
		AllowedToolKinds: []AIToolKind{AIToolKindContextRead, AIToolKindFileWrite, AIToolKindMCP},
		ExpiresAt:        time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
		GrantedBy:        "test",
	})
	if err != nil {
		t.Fatalf("SaveApprovalPolicy: %v", err)
	}
	if policy.Mode != AIApprovalModeFullAccess {
		t.Fatalf("policy = %#v", policy)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{Action: AIChatActionBuild, Prompt: "build"})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	if final.Status != "completed" {
		t.Fatalf("final run = %#v", final)
	}
	if len(final.ToolProposals) == 0 {
		t.Fatal("expected proposals")
	}
	for _, proposal := range final.ToolProposals {
		if !proposal.AllowedByCurrentPolicy {
			t.Fatalf("full access did not mark proposal allowed: %#v", proposal)
		}
		if proposal.ExecutionState != AIToolExecutionStateNotExecutable {
			t.Fatalf("proposal became executable: %#v", proposal)
		}
	}
}

func hasMCPToolProposal(proposals []AIToolProposal, toolName string) bool {
	for _, proposal := range proposals {
		if proposal.Kind == AIToolKindMCP && proposal.MCPToolName == toolName {
			return true
		}
	}
	return false
}

func containsChatAction(actions []AIChatActionDescriptor, action AIChatAction) bool {
	for _, candidate := range actions {
		if candidate.ID == action {
			return true
		}
	}
	return false
}

func containsPromptWorkflow(workflows []AIPromptWorkflowDescriptor, slash string, action AIChatAction) bool {
	for _, candidate := range workflows {
		if candidate.Slash == slash && candidate.Action == action {
			return true
		}
	}
	return false
}

func TestApprovalPolicyDefaultRevokeAndNoProviderEgressGrant(t *testing.T) {
	service := newTestService(t, nil)
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	policy, err := service.GetApprovalPolicy("main")
	if err != nil {
		t.Fatalf("GetApprovalPolicy: %v", err)
	}
	if policy.Mode != AIApprovalModeAskEachTime {
		t.Fatalf("default policy = %#v", policy)
	}
	policy, err = service.SaveApprovalPolicy("main", AIApprovalPolicy{
		Mode:             AIApprovalModeFullAccess,
		AllowedToolKinds: []AIToolKind{AIToolKindContextRead, AIToolKindFileWrite},
		ExpiresAt:        time.Now().UTC().Add(3 * time.Hour).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("SaveApprovalPolicy: %v", err)
	}
	if policy.ProjectSessionID != project.ID || policy.ProjectPathHash != hashProjectPath(project.ProjectRoot) {
		t.Fatalf("policy scope = %#v", policy)
	}
	summary := service.approvalSummaryForProject(project)
	if !summary.FullAccessActive {
		t.Fatalf("full access should be active: %#v", summary)
	}
	if expiresAt, err := time.Parse(time.RFC3339, policy.ExpiresAt); err != nil || time.Until(expiresAt) > fullAccessMaxTTL+time.Second {
		t.Fatalf("expiration was not capped: policy=%#v err=%v", policy, err)
	}
	settings := service.currentSettings()
	settings.Enabled = false
	service.settings = settings
	_, err = service.EditorContinuation(context.Background(), "main", AIContextRequest{Prompt: "x"}, "", "")
	if err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("full access should not grant provider egress, err=%v", err)
	}
	revoked, err := service.RevokeApprovalPolicy("main")
	if err != nil {
		t.Fatalf("RevokeApprovalPolicy: %v", err)
	}
	if revoked.Mode != AIApprovalModeAskEachTime || revoked.RevokedAt == "" {
		t.Fatalf("revoked policy = %#v", revoked)
	}
	if service.approvalSummaryForProject(project).FullAccessActive {
		t.Fatal("full access remained active after revoke")
	}
}

func TestConsentPolicyKeepsRemoteAndFrontierBlocked(t *testing.T) {
	service := newTestService(t, nil)
	policy, err := service.SaveConsentPolicy(AIConsentPolicy{
		LocalProvidersAccepted:    false,
		RemoteProvidersAccepted:   true,
		FrontierProvidersAccepted: true,
		ProviderPolicies: []AIProviderDataPolicy{{
			ProviderID: "remote",
			Local:      false,
			Frontier:   true,
			Allowed:    true,
		}},
	})
	if err != nil {
		t.Fatalf("SaveConsentPolicy: %v", err)
	}
	if !policy.LocalProvidersAccepted || policy.RemoteProvidersAccepted || policy.FrontierProvidersAccepted {
		t.Fatalf("consent policy weakened local-only default: %#v", policy)
	}
	if len(policy.ProviderPolicies) != 1 || policy.ProviderPolicies[0].Allowed {
		t.Fatalf("remote provider policy allowed: %#v", policy.ProviderPolicies)
	}
}

func TestChatRunEnvelopeIsMetadataOnly(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		Action: AIChatActionPlan,
		Prompt: "plan with api_key=abc123456789",
		Context: AIContextRequest{
			FullText:      "const secret = \"do-not-bridge-this\"",
			TerminalInput: "curl -H 'Authorization: Bearer do-not-bridge-token'",
		},
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	if final.Status != "completed" {
		t.Fatalf("final run = %#v", final)
	}
	envelope, err := service.GetChatRunEnvelope("main", run.ID)
	if err != nil {
		t.Fatalf("GetChatRunEnvelope: %v", err)
	}
	encoded, _ := json.Marshal(envelope)
	value := string(encoded)
	for _, forbidden := range []string{"abc123456789", "do-not-bridge-this", "do-not-bridge-token", "generated output"} {
		if strings.Contains(value, forbidden) {
			t.Fatalf("envelope leaked %q: %s", forbidden, value)
		}
	}
	if envelope.ContextSummary == nil || envelope.ProviderEnvelope == nil || envelope.EgressSummary == nil {
		t.Fatalf("envelope missing metadata summaries: %#v", envelope)
	}
}

func TestChatContextReadyEventUsesSummaryOnly(t *testing.T) {
	var contextReady any
	var contextReadyMu sync.Mutex
	service := newTestService(t, func(name string, payload any) {
		if name == "ai:chat:context-ready" {
			contextReadyMu.Lock()
			defer contextReadyMu.Unlock()
			contextReady = payload
		}
	})
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		Action: AIChatActionPlan,
		Prompt: "plan with api_key=abc123456789",
		Context: AIContextRequest{
			FullText: "const secret = \"do-not-bridge-this\"",
		},
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	for i := 0; i < 100; i++ {
		final, err := service.GetChatRun("main", run.ID)
		if err == nil && final.Status != "running" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	contextReadyMu.Lock()
	encoded, _ := json.Marshal(contextReady)
	contextReadyMu.Unlock()
	value := string(encoded)
	for _, forbidden := range []string{"abc123456789", "do-not-bridge-this", "snippets"} {
		if strings.Contains(value, forbidden) {
			t.Fatalf("context-ready leaked %q: %s", forbidden, value)
		}
	}
}

func TestChatCancelIsTerminalAndSingleEvent(t *testing.T) {
	events := &eventLog{}
	service := newTestService(t, events.emit)
	descriptor := service.descriptors["local-test"]
	provider := &blockingProvider{descriptor: descriptor, started: make(chan struct{})}
	service.providers[descriptor.ID] = provider
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{Action: AIChatActionPlan, Prompt: "cancel me"})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	select {
	case <-provider.started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}
	if _, err := service.CancelChatRun("main", run.ID); err != nil {
		t.Fatalf("CancelChatRun: %v", err)
	}
	var final AIChatRun
	for i := 0; i < 100; i++ {
		final, err = service.GetChatRun("main", run.ID)
		if err == nil && final.Status == "canceled" && !final.CanCancel {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if final.Status != "canceled" {
		t.Fatalf("final run = %#v", final)
	}
	eventNames := events.snapshot()
	if countEvent(eventNames, "ai:chat:run-canceled") != 1 {
		t.Fatalf("cancel events = %#v", eventNames)
	}
	if containsEvent(eventNames, "ai:chat:run-completed") {
		t.Fatalf("run completed after cancel: %#v", eventNames)
	}
}

func TestChatRunAccessIsProjectScoped(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.OpenProject("a", t.TempDir()); err != nil {
		t.Fatalf("OpenProject a: %v", err)
	}
	if _, err := service.OpenProject("b", t.TempDir()); err != nil {
		t.Fatalf("OpenProject b: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "a", AIChatRunRequest{Action: AIChatActionPlan, Prompt: "scoped"})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	if _, err := service.GetChatRun("b", run.ID); err == nil {
		t.Fatal("project b read project a chat run")
	}
	if _, err := service.CancelChatRun("b", run.ID); err == nil {
		t.Fatal("project b canceled project a chat run")
	}
	if _, err := service.GetChatRun("a", run.ID); err != nil {
		t.Fatalf("project a could not read own run: %v", err)
	}
}

func TestToolProposalEvaluatorAppliesHardDeny(t *testing.T) {
	approval := AIApprovalSummary{
		Mode:             AIApprovalModeFullAccess,
		FullAccessActive: true,
		AllowedToolKinds: []AIToolKind{AIToolKindTerminal, AIToolKindFileWrite, AIToolKindNetworkLocal},
	}
	root := t.TempDir()
	destructive := evaluateToolProposal(AIToolProposal{
		Kind:                 AIToolKindTerminal,
		CommandPreview:       "rm -rf .",
		ApprovalModeRequired: AIApprovalModeFullAccess,
		Status:               AIToolProposalStatusProposed,
		ExecutionState:       AIToolExecutionStateNotExecutable,
	}, approval, root)
	if destructive.AllowedByCurrentPolicy || destructive.HardDenyReason != AIToolHardDenyReasonDestructiveShell {
		t.Fatalf("destructive proposal = %#v", destructive)
	}
	outside := evaluateToolProposal(AIToolProposal{
		Kind:                 AIToolKindFileWrite,
		TargetPaths:          []string{filepath.Join(filepath.Dir(root), "outside.go")},
		ApprovalModeRequired: AIApprovalModeFullAccess,
		Status:               AIToolProposalStatusProposed,
		ExecutionState:       AIToolExecutionStateNotExecutable,
	}, approval, root)
	if outside.AllowedByCurrentPolicy || outside.HardDenyReason != AIToolHardDenyReasonOutsideProjectWrite {
		t.Fatalf("outside-project proposal = %#v", outside)
	}
	network := evaluateToolProposal(AIToolProposal{
		Kind:                 AIToolKindNetworkLocal,
		Arguments:            map[string]string{"endpoint": "https://example.com"},
		ApprovalModeRequired: AIApprovalModeFullAccess,
		Status:               AIToolProposalStatusProposed,
		ExecutionState:       AIToolExecutionStateNotExecutable,
	}, approval, root)
	if network.AllowedByCurrentPolicy || network.HardDenyReason != AIToolHardDenyReasonNonLoopbackNetwork {
		t.Fatalf("network proposal = %#v", network)
	}
}

func TestMnemonicTrustPromotionRequiresReviewedPinnedState(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	entry, err := service.SaveMnemonicEntry("main", AIMnemonicEntryInput{
		Source:  "ai-chat",
		Content: "generated memory",
	})
	if err != nil {
		t.Fatalf("SaveMnemonicEntry: %v", err)
	}
	if entry.Trust != mnemonic.TrustGenerated || !entry.Generated {
		t.Fatalf("generated entry = %#v", entry)
	}
	if _, err := service.UpdateMnemonicEntry("main", entry.ID, AIMnemonicEntryPatch{Trust: mnemonic.TrustTrusted}); err == nil {
		t.Fatal("generated entry was promoted without review")
	}
	pinned := true
	promoted, err := service.UpdateMnemonicEntry("main", entry.ID, AIMnemonicEntryPatch{
		Trust:      mnemonic.TrustTrusted,
		Pinned:     &pinned,
		Provenance: map[string]string{"reviewedBy": "user"},
	})
	if err != nil {
		t.Fatalf("reviewed promotion failed: %v", err)
	}
	if promoted.Trust != mnemonic.TrustTrusted || promoted.Generated {
		t.Fatalf("promoted entry = %#v", promoted)
	}
}

func TestCloseProjectCancelsRunningChatRun(t *testing.T) {
	service := newTestService(t, nil)
	descriptor := service.descriptors["local-test"]
	provider := &blockingProvider{descriptor: descriptor, started: make(chan struct{})}
	service.providers[descriptor.ID] = provider
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{Action: AIChatActionPlan, Prompt: "cancel on close"})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	select {
	case <-provider.started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}
	if err := service.CloseProject("main"); err != nil {
		t.Fatalf("CloseProject: %v", err)
	}
	final, err := service.GetChatRun("main", run.ID)
	if err != nil {
		t.Fatalf("GetChatRun: %v", err)
	}
	if final.Status != "canceled" || final.CanCancel {
		t.Fatalf("run was not canceled before project close: %#v", final)
	}
	if project := service.project("main"); project != nil {
		t.Fatalf("project remained open: %#v", project)
	}
}

func TestChatRespectsProviderCapabilities(t *testing.T) {
	service := newTestService(t, nil)
	descriptor := service.descriptors["local-test"]
	descriptor.Capabilities = []providers.AIProviderCapability{providers.CapabilityLinePrediction}
	service.descriptors[descriptor.ID] = descriptor
	service.providers[descriptor.ID] = fakeProvider{descriptor: descriptor, text: "should not run"}
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{Action: AIChatActionPlan, Prompt: "chat"})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	var final AIChatRun
	for i := 0; i < 100; i++ {
		final, err = service.GetChatRun("main", run.ID)
		if err == nil && final.Status != "running" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if final.Status != "error" || !strings.Contains(final.Error, "does not support") {
		t.Fatalf("final run = %#v", final)
	}
}

func TestFrontierProviderSettingsRemainDisabledStubs(t *testing.T) {
	service := newTestService(t, nil)
	service.settings.ActiveProviderID = ""
	service.settings.ActiveModel = ""
	descriptor, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:      "openai-frontier",
		Name:    "OpenAI",
		Kind:    "openai",
		Enabled: true,
		Model:   "gpt-test",
	})
	if err != nil {
		t.Fatalf("SaveProviderSettings: %v", err)
	}
	if !descriptor.Frontier || descriptor.Status != providers.ProviderStatusDisabled {
		t.Fatalf("descriptor = %#v", descriptor)
	}
	if _, ok := service.provider("openai-frontier"); ok {
		t.Fatal("frontier provider should not be callable")
	}
	if service.currentSettings().ActiveProviderID == "openai-frontier" {
		t.Fatalf("frontier provider became active: %#v", service.currentSettings())
	}
}

func TestAnthropicFrontierIsAPIKeyOnly(t *testing.T) {
	service := newTestService(t, nil)
	service.settings.ActiveProviderID = ""
	service.settings.ActiveModel = ""
	descriptor, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:             "anthropic-frontier",
		Name:           "Anthropic",
		Kind:           "anthropic",
		Enabled:        true,
		Model:          "claude-test",
		OAuthClientID:  "should-be-ignored",
		OAuthSupported: true,
		AuthMode:       providers.ProviderAuthModeOAuth,
	})
	if err != nil {
		t.Fatalf("SaveProviderSettings: %v", err)
	}
	if !descriptor.Frontier || descriptor.Status != providers.ProviderStatusDisabled {
		t.Fatalf("descriptor = %#v", descriptor)
	}
	if descriptor.AuthMode != providers.ProviderAuthModeAPIKey || descriptor.OAuthSupported {
		t.Fatalf("anthropic auth metadata = %#v", descriptor)
	}
	if _, ok := service.provider("anthropic-frontier"); ok {
		t.Fatal("anthropic frontier provider should not be callable in this backend slice")
	}
	settings := service.currentSettings()
	if settings.ActiveProviderID == "anthropic-frontier" {
		t.Fatalf("anthropic provider became active: %#v", settings)
	}
	for _, saved := range settings.Providers {
		if saved.ID == "anthropic-frontier" {
			if saved.AuthMode != providers.ProviderAuthModeAPIKey || saved.OAuthSupported || saved.OAuthClientID != "" {
				t.Fatalf("saved anthropic settings = %#v", saved)
			}
			return
		}
	}
	t.Fatalf("anthropic settings were not saved: %#v", settings.Providers)
}

func TestManualLocalProviderSettingsUseConfiguredEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{{"id": "manual-local-model"}},
			})
		case "/v1/chat/completions":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{{
					"message": map[string]any{"content": "manual output"},
				}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	service := newTestService(t, nil)
	descriptor, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:       "manual-lm-studio",
		Name:     "Manual LM Studio",
		Kind:     "lm-studio",
		Endpoint: server.URL + "/v1",
		Model:    "manual-local-model",
		Enabled:  true,
		Manual:   true,
	})
	if err != nil {
		t.Fatalf("SaveProviderSettings: %v", err)
	}
	if !descriptor.Manual || !descriptor.Local || descriptor.Endpoint != server.URL+"/v1" {
		t.Fatalf("descriptor = %#v", descriptor)
	}
	checked, err := service.TestProvider(context.Background(), "manual-lm-studio")
	if err != nil {
		t.Fatalf("TestProvider: %v", err)
	}
	if checked.Status != providers.ProviderStatusReady || checked.DefaultModel != "manual-local-model" {
		t.Fatalf("checked descriptor = %#v", checked)
	}
}

func TestManualLocalProviderRejectsNonLoopbackEndpoint(t *testing.T) {
	service := newTestService(t, nil)
	_, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:       "manual-lan-lm-studio",
		Name:     "LAN LM Studio",
		Kind:     "lm-studio",
		Endpoint: "http://192.168.1.42:1234/v1",
		Model:    "local-model",
		Enabled:  true,
		Manual:   true,
	})
	if err == nil {
		t.Fatal("expected non-loopback local endpoint to be rejected")
	}
	if !strings.Contains(err.Error(), "localhost") {
		t.Fatalf("error = %v", err)
	}
}

func TestProviderSecretCanBeCleared(t *testing.T) {
	secrets := &mapSecretStore{}
	service := newTestService(t, nil)
	service.secretStore = secrets
	descriptor, err := service.SaveProviderSettings(context.Background(), providers.AIProviderSettings{
		ID:          "anthropic-frontier",
		Name:        "Anthropic",
		Kind:        "anthropic",
		Enabled:     true,
		Model:       "claude-test",
		SecretValue: "secret-value",
	})
	if err != nil {
		t.Fatalf("SaveProviderSettings with secret: %v", err)
	}
	if !descriptor.AuthConfigured || descriptor.Status != providers.ProviderStatusDisabled {
		t.Fatalf("frontier auth metadata/status = %#v", descriptor)
	}
	settings := service.currentSettings()
	ref := ""
	for _, saved := range settings.Providers {
		if saved.ID == "anthropic-frontier" {
			ref = saved.SecretRef
			break
		}
	}
	if ref == "" || secrets.values[ref] != "secret-value" {
		t.Fatalf("secret was not saved out-of-band: ref=%q values=%#v", ref, secrets.values)
	}
	if _, err := service.ClearProviderSecret(context.Background(), "anthropic-frontier"); err != nil {
		t.Fatalf("ClearProviderSecret: %v", err)
	}
	if _, ok := secrets.values[ref]; ok {
		t.Fatalf("secret was not cleared: %#v", secrets.values)
	}
	settings = service.currentSettings()
	for _, saved := range settings.Providers {
		if saved.ID == "anthropic-frontier" && saved.SecretRef != "" {
			t.Fatalf("secret ref remained in settings: %#v", saved)
		}
	}
}

func TestRefreshLocalProvidersMarksStaleUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{{"id": "manual-local-model"}},
			})
			return
		}
		http.NotFound(w, r)
	}))
	service := newTestService(t, nil)
	candidate := providers.AIProviderSettings{
		ID:       "lm-studio-local",
		Name:     "LM Studio",
		Kind:     "lm-studio",
		Endpoint: server.URL + "/v1",
		Enabled:  true,
	}
	if _, err := service.refreshLocalProviders(context.Background(), []providers.AIProviderSettings{candidate}); err != nil {
		t.Fatalf("refresh ready: %v", err)
	}
	if _, ok := service.provider(candidate.ID); !ok {
		t.Fatal("provider was not registered")
	}
	server.Close()
	if _, err := service.refreshLocalProviders(context.Background(), []providers.AIProviderSettings{candidate}); err != nil {
		t.Fatalf("refresh stale: %v", err)
	}
	if _, ok := service.provider(candidate.ID); ok {
		t.Fatal("stale provider remained callable")
	}
	descriptor := service.descriptors[candidate.ID]
	if descriptor.Status != providers.ProviderStatusError {
		t.Fatalf("stale descriptor = %#v", descriptor)
	}
}

func TestDisabledAIRejectsContinuationWithoutCloudFallback(t *testing.T) {
	service := newTestService(t, nil)
	service.settings.Enabled = false
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	_, err := service.EditorContinuation(context.Background(), "main", AIContextRequest{Prompt: "x"}, "", "")
	if err == nil {
		t.Fatal("expected disabled AI to reject continuation")
	}
	if !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("error = %v", err)
	}
}

func fromAIEntry(entry AIMnemonicEntry) mnemonic.Entry {
	return mnemonic.Entry{
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
		CreatedAt:      entry.CreatedAt,
		UpdatedAt:      entry.UpdatedAt,
	}
}

func waitForRunStatus(t *testing.T, service *Service, runID string) AIChatRun {
	t.Helper()
	var final AIChatRun
	var err error
	for i := 0; i < 200; i++ {
		final, err = service.GetChatRun("main", runID)
		if err == nil && final.Status != "running" {
			return final
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("run did not finish: final=%#v err=%v", final, err)
	return AIChatRun{}
}

func containsEvent(events []string, want string) bool {
	for _, event := range events {
		if event == want {
			return true
		}
	}
	return false
}

func countEvent(events []string, want string) int {
	count := 0
	for _, event := range events {
		if event == want {
			count++
		}
	}
	return count
}
