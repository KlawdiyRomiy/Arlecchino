package app

import (
	"context"
	"fmt"

	"arlecchino/internal/ai"
)

func (a *App) ensureAIService() *ai.Service {
	if a.aiService == nil {
		a.aiService = ai.NewService(ai.ServiceOptions{
			Emit: func(name string, payload any) {
				a.emitEvent(name, payload)
			},
			MCPContextProvider: a.aiMCPContextProvider,
			Diagnostics:        a.aiDiagnosticsProvider,
			SemanticContext:    a.aiSemanticProvider,
			BrowserPreview:     a.aiBrowserPreviewExecutor,
			MCPExecutor:        a.aiMCPToolExecutor,
		})
		if a.ctx != nil {
			if err := a.aiService.Start(a.ctx); err != nil {
				a.logWarning(fmt.Sprintf("AI service startup failed: %v", err))
			}
		}
	}
	return a.aiService
}

func (a *App) aiStrictProjectSession(ctx context.Context) (*ProjectRuntimeSession, error) {
	if a == nil {
		return nil, fmt.Errorf("AI project session is unavailable")
	}
	window := bindingContextWindow(ctx)
	if window == nil {
		return nil, fmt.Errorf("AI project methods require a Wails window context")
	}
	session := a.ensureProjectSessions().getByWindow(window)
	if session == nil {
		return nil, fmt.Errorf("AI project session is not bound to the current window")
	}
	if session.currentProjectPath() == "" {
		return nil, fmt.Errorf("AI project session has no open project")
	}
	return session, nil
}

func (a *App) ensureAIProjectSessionOpen(session *ProjectRuntimeSession) error {
	if a == nil || session == nil {
		return fmt.Errorf("AI project session is unavailable")
	}
	projectPath := session.currentProjectPath()
	if projectPath == "" {
		return fmt.Errorf("AI project session has no open project")
	}
	service := a.ensureAIService()
	if session.aiSession != nil && service.HasProjectRoot(session.ID, projectPath) {
		return nil
	}
	aiSession, err := service.OpenProject(session.ID, projectPath)
	if err != nil {
		return err
	}
	session.aiSession = aiSession
	if session.IsDefault {
		a.syncDefaultProjectSession(session)
	}
	return nil
}

func (a *App) ensureAIProjectSessionID(ctx context.Context) (string, error) {
	session, err := a.aiStrictProjectSession(ctx)
	if err != nil {
		return "", err
	}
	if err := a.ensureAIProjectSessionOpen(session); err != nil {
		return "", err
	}
	return session.ID, nil
}

func (a *App) aiProjectSessionID(ctx context.Context) string {
	if session := a.projectSessionForContext(ctx); session != nil {
		return session.ID
	}
	return defaultProjectSessionID
}

func (a *App) aiStrictProjectSessionID(ctx context.Context) (string, error) {
	session, err := a.aiStrictProjectSession(ctx)
	if err != nil {
		return "", err
	}
	return session.ID, nil
}

func (a *App) AIGetStatus(ctx context.Context) (ai.AIStatus, error) {
	service := a.ensureAIService()
	if session := a.projectSessionForContext(ctx); session != nil {
		if projectPath := session.currentProjectPath(); projectPath != "" && service.HasProjectRoot(session.ID, projectPath) {
			return service.Status(session.ID), nil
		}
	}
	return service.StatusWithoutProject(), nil
}

func (a *App) AIExecuteAgentProtocol(ctx context.Context, req ai.AIAgentProtocolRequest) (ai.AIAgentProtocolResponse, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIAgentProtocolResponse{}, err
	}
	return a.ensureAIService().ExecuteAgentProtocol(ctx, projectID, req)
}

func (a *App) AIListProviders() ([]ai.AIProviderDescriptor, error) {
	return a.ensureAIService().ListProviders(), nil
}

func (a *App) AIGetApprovalPolicy(ctx context.Context) (ai.AIApprovalPolicy, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIApprovalPolicy{}, err
	}
	return a.ensureAIService().GetApprovalPolicy(sessionID)
}

func (a *App) AISaveApprovalPolicy(ctx context.Context, policy ai.AIApprovalPolicy) (ai.AIApprovalPolicy, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIApprovalPolicy{}, err
	}
	return a.ensureAIService().SaveApprovalPolicy(sessionID, policy)
}

func (a *App) AIRevokeApprovalPolicy(ctx context.Context) (ai.AIApprovalPolicy, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIApprovalPolicy{}, err
	}
	return a.ensureAIService().RevokeApprovalPolicy(sessionID)
}

func (a *App) AIGetConsentPolicy() (ai.AIConsentPolicy, error) {
	return a.ensureAIService().GetConsentPolicy(), nil
}

func (a *App) AISaveConsentPolicy(policy ai.AIConsentPolicy) (ai.AIConsentPolicy, error) {
	return a.ensureAIService().SaveConsentPolicy(policy)
}

func (a *App) AIRefreshLocalProviders(ctx context.Context) (ai.AIDiscoveryResult, error) {
	return a.ensureAIService().RefreshLocalProviders(ctx)
}

func (a *App) AISaveProviderSettings(ctx context.Context, settings ai.AIProviderSettings) (ai.AIProviderDescriptor, error) {
	return a.ensureAIService().SaveProviderSettings(ctx, settings)
}

func (a *App) AIClearProviderSecret(ctx context.Context, providerID string) (ai.AIProviderDescriptor, error) {
	return a.ensureAIService().ClearProviderSecret(ctx, providerID)
}

func (a *App) AITestProvider(ctx context.Context, providerID string) (ai.AIProviderDescriptor, error) {
	return a.ensureAIService().TestProvider(ctx, providerID)
}

func (a *App) AIStartProviderOAuth(ctx context.Context, providerID string) (ai.AIProviderAuthSession, error) {
	session, err := a.ensureAIService().StartProviderOAuth(ctx, providerID)
	if err != nil {
		return ai.AIProviderAuthSession{}, err
	}
	if !a.registerPendingProtocolOAuthState(session.ProviderID, session.State) {
		_, _ = a.ensureAIService().CancelProviderAuth(session.ID)
		return ai.AIProviderAuthSession{}, fmt.Errorf("failed to register OAuth callback state")
	}
	return session, nil
}

func (a *App) AIGetProviderAuthSession(sessionID string) (ai.AIProviderAuthSession, error) {
	session, err := a.ensureAIService().GetProviderAuthSession(sessionID)
	if err == nil && providerAuthSessionTerminal(session.Status) {
		a.clearPendingProtocolOAuthState(session.ProviderID, session.State)
	}
	return session, err
}

func (a *App) AICancelProviderAuth(sessionID string) (ai.AIProviderAuthSession, error) {
	session, err := a.ensureAIService().CancelProviderAuth(sessionID)
	if err == nil {
		a.clearPendingProtocolOAuthState(session.ProviderID, session.State)
	}
	return session, err
}

func providerAuthSessionTerminal(status string) bool {
	switch status {
	case ai.AIProviderAuthStatusCompleted,
		ai.AIProviderAuthStatusFailed,
		ai.AIProviderAuthStatusCanceled,
		ai.AIProviderAuthStatusExpired:
		return true
	default:
		return false
	}
}

func (a *App) AIGetPredictionStatus(ctx context.Context) (ai.AIPredictionStatus, error) {
	return a.ensureAIService().PredictionStatus(""), nil
}

func (a *App) AISavePredictionSettings(settings ai.AIPredictionSettings) (ai.AIPredictionStatus, error) {
	return a.ensureAIService().SavePredictionSettings(settings)
}

func (a *App) AIListProviderRuntimes() ([]ai.AIProviderRuntimeDescriptor, error) {
	return a.ensureAIService().ListProviderRuntimes(), nil
}

func (a *App) AIStartProviderRuntime(ctx context.Context, req ai.AIProviderRuntimeStartRequest) (ai.AIProviderRuntimeDescriptor, error) {
	return a.ensureAIService().StartProviderRuntime(ctx, req)
}

func (a *App) AIStopProviderRuntime(ctx context.Context, providerID string) (ai.AIProviderRuntimeDescriptor, error) {
	return a.ensureAIService().StopProviderRuntime(ctx, providerID)
}

func (a *App) AIGetContextPreview(ctx context.Context, req ai.AIContextRequest) (ai.AIContextSnapshot, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIContextSnapshot{}, err
	}
	return a.ensureAIService().ContextPreview(sessionID, req)
}

func (a *App) AISuggestChatMentions(ctx context.Context, req ai.AIChatMentionQuery) ([]ai.AIChatMentionCandidate, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().SuggestChatMentions(sessionID, req)
}

func (a *App) AIGetEditorContinuation(ctx context.Context, req ai.AIContextRequest, providerID string, model string) (ai.AIContinuationResponse, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIContinuationResponse{}, err
	}
	return a.ensureAIService().EditorContinuation(ctx, sessionID, req, providerID, model)
}

func (a *App) AIGetTerminalContinuation(ctx context.Context, req ai.AIContextRequest, providerID string, model string) (ai.AIContinuationResponse, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIContinuationResponse{}, err
	}
	return a.ensureAIService().TerminalContinuation(ctx, sessionID, req, providerID, model)
}

func (a *App) AIStartChatRun(ctx context.Context, req ai.AIChatRunRequest) (ai.AIChatRun, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRun{}, err
	}
	a.logInfof("[Activation] subsystem=ai-chat reason=%s session=%s", activationAIChatOpen, sessionID)
	return a.ensureAIService().StartChatRun(ctx, sessionID, req)
}

func (a *App) AIStartAgentAuthRun(ctx context.Context, providerID string) (ai.AIChatRun, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRun{}, err
	}
	return a.ensureAIService().StartAgentAuthRun(ctx, sessionID, providerID)
}

func (a *App) AISubmitQuestionAnswer(ctx context.Context, req ai.AIQuestionAnswerRequest) (ai.AIQuestionAnswerResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIQuestionAnswerResult{}, err
	}
	return a.ensureAIService().SubmitQuestionAnswer(ctx, sessionID, req)
}

func (a *App) AIAcceptPlan(ctx context.Context, req ai.AIAcceptPlanRequest) (ai.AIWorkflowRunResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIWorkflowRunResult{}, err
	}
	return a.ensureAIService().AcceptPlan(ctx, sessionID, req)
}

func (a *App) AIRequestPlanRevision(ctx context.Context, req ai.AIRequestPlanRevisionRequest) (ai.AIWorkflowRunResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIWorkflowRunResult{}, err
	}
	return a.ensureAIService().RequestPlanRevision(ctx, sessionID, req)
}

func (a *App) AIStartLinkedReview(ctx context.Context, req ai.AIStartLinkedReviewRequest) (ai.AIWorkflowRunResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIWorkflowRunResult{}, err
	}
	return a.ensureAIService().StartLinkedReview(ctx, sessionID, req)
}

func (a *App) AICancelChatRun(ctx context.Context, runID string) (ai.AIChatRun, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRun{}, err
	}
	return a.ensureAIService().CancelChatRun(sessionID, runID)
}

func (a *App) AISteerChatRun(ctx context.Context, req ai.AISteerChatRunRequest) (ai.AIChatSteerResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatSteerResult{}, err
	}
	return a.ensureAIService().SteerChatRun(ctx, sessionID, req)
}

func (a *App) AIQueueChatRun(ctx context.Context, req ai.AIQueueChatRunRequest) (ai.AIQueuedChatRun, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIQueuedChatRun{}, err
	}
	return a.ensureAIService().QueueChatRun(sessionID, req)
}

func (a *App) AIListQueuedChatRuns(ctx context.Context, sessionID string) ([]ai.AIQueuedChatRun, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListQueuedChatRuns(projectID, sessionID)
}

func (a *App) AIListRunGraph(ctx context.Context, sessionID string) ([]ai.AIRunGraphNode, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListRunGraph(projectID, sessionID)
}

func (a *App) AIListSkillCircuit(ctx context.Context, runID string) ([]ai.AISkillCircuitController, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListSkillCircuit(projectID, runID)
}

func (a *App) AIInstallAgentPlugin(ctx context.Context, req ai.AIAgentPluginInstallRequest) (ai.AIAgentPluginRecord, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIAgentPluginRecord{}, err
	}
	return a.ensureAIService().InstallAgentPlugin(projectID, req)
}

func (a *App) AIListAgentPlugins(ctx context.Context) ([]ai.AIAgentPluginRecord, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListAgentPlugins(projectID)
}

func (a *App) AISetAgentPluginEnabled(ctx context.Context, pluginID string, enabled bool) (ai.AIAgentPluginRecord, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIAgentPluginRecord{}, err
	}
	return a.ensureAIService().SetAgentPluginEnabled(projectID, pluginID, enabled)
}

func (a *App) AIRollbackAgentPlugin(ctx context.Context, pluginID string) (ai.AIAgentPluginRecord, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIAgentPluginRecord{}, err
	}
	return a.ensureAIService().RollbackAgentPlugin(projectID, pluginID)
}

func (a *App) AIListAgentPluginEvents(ctx context.Context, pluginID string, limit int) ([]ai.AIAgentPluginEvent, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListAgentPluginEvents(projectID, pluginID, limit)
}

func (a *App) AIGetAgentPluginStorage(ctx context.Context, pluginID string, key string) (ai.AIAgentPluginStorageValue, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIAgentPluginStorageValue{}, err
	}
	return a.ensureAIService().GetAgentPluginStorage(projectID, pluginID, key)
}

func (a *App) AIPutAgentPluginStorage(ctx context.Context, value ai.AIAgentPluginStorageValue) (ai.AIAgentPluginStorageValue, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIAgentPluginStorageValue{}, err
	}
	return a.ensureAIService().PutAgentPluginStorage(projectID, value)
}

func (a *App) AIListAgentPluginTools(ctx context.Context) ([]ai.AIAgentPluginToolDefinition, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListAgentPluginTools(projectID)
}

// AIRunAgentPluginSandbox executes a reviewed plugin only through the
// capability-scoped out-of-process host bridge. The plugin still cannot
// bypass the normal tool approval gateway.
func (a *App) AIRunAgentPluginSandbox(ctx context.Context, pluginID string, req ai.AIAgentPluginRuntimeRequest) (ai.AIAgentPluginRuntimeResult, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIAgentPluginRuntimeResult{}, err
	}
	return a.ensureAIService().RunAgentPluginSandbox(ctx, projectID, pluginID, req)
}

func (a *App) AIUpsertManagedMCPServer(ctx context.Context, server ai.AIMCPServerRecord) (ai.AIMCPServerRecord, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMCPServerRecord{}, err
	}
	return a.ensureAIService().UpsertManagedMCPServer(projectID, server)
}

func (a *App) AIListManagedMCPServers(ctx context.Context) ([]ai.AIMCPServerRecord, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListManagedMCPServers(projectID)
}

func (a *App) AISetManagedMCPServerEnabled(ctx context.Context, serverID string, enabled bool) (ai.AIMCPServerRecord, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMCPServerRecord{}, err
	}
	return a.ensureAIService().SetManagedMCPServerEnabled(projectID, serverID, enabled)
}

func (a *App) AIDiscoverManagedMCPTools(ctx context.Context, serverID string) (ai.AIMCPManagedDiscoveryResult, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMCPManagedDiscoveryResult{}, err
	}
	return a.ensureAIService().DiscoverManagedMCPTools(ctx, projectID, serverID)
}

func (a *App) AIListManagedMCPTools(ctx context.Context, serverID string) ([]ai.AIMCPManagedTool, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListManagedMCPTools(projectID, serverID)
}

func (a *App) AISetManagedMCPToolEnabled(ctx context.Context, serverID string, toolName string, enabled bool) (ai.AIMCPManagedTool, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMCPManagedTool{}, err
	}
	return a.ensureAIService().SetManagedMCPToolEnabled(projectID, serverID, toolName, enabled)
}

func (a *App) AIStartSubagentRun(ctx context.Context, req ai.AIStartSubagentRunRequest) (ai.AIStartSubagentRunResult, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIStartSubagentRunResult{}, err
	}
	return a.ensureAIService().StartSubagentRun(ctx, projectID, req)
}

func (a *App) AIStopSubagentRun(ctx context.Context, parentRunID string, childRunID string) (ai.AIChatRun, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRun{}, err
	}
	return a.ensureAIService().StopSubagentRun(projectID, parentRunID, childRunID)
}

func (a *App) AISteerSubagentRun(ctx context.Context, parentRunID string, req ai.AISteerChatRunRequest) (ai.AIChatSteerResult, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatSteerResult{}, err
	}
	return a.ensureAIService().SteerSubagentRun(ctx, projectID, parentRunID, req)
}

func (a *App) AIUpdateQueuedChatRun(ctx context.Context, sessionID string, req ai.AIUpdateQueuedChatRunRequest) (ai.AIQueuedChatRun, error) {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIQueuedChatRun{}, err
	}
	return a.ensureAIService().UpdateQueuedChatRun(projectID, sessionID, req)
}

func (a *App) AIRemoveQueuedChatRun(ctx context.Context, sessionID string, queueID string) error {
	projectID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().RemoveQueuedChatRun(projectID, sessionID, queueID)
}

func (a *App) AIWriteAgentTerminalInput(ctx context.Context, runID string, data string) error {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().WriteAgentTerminalInput(sessionID, runID, data)
}

func (a *App) AIResizeAgentTerminal(ctx context.Context, runID string, rows int, cols int) error {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().ResizeAgentTerminal(sessionID, runID, rows, cols)
}

func (a *App) AIGetChatRun(ctx context.Context, runID string) (ai.AIChatRun, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRun{}, err
	}
	return a.ensureAIService().GetChatRun(sessionID, runID)
}

func (a *App) AIGetChatRunEnvelope(ctx context.Context, runID string) (ai.AIChatRunEnvelope, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRunEnvelope{}, err
	}
	return a.ensureAIService().GetChatRunEnvelope(sessionID, runID)
}

func (a *App) AIListChatRunArtifacts(ctx context.Context, runID string) ([]ai.AIChatRunArtifact, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListChatRunArtifacts(sessionID, runID)
}

func (a *App) AIGetChatRunArtifact(ctx context.Context, artifactID string) (ai.AIChatRunArtifact, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRunArtifact{}, err
	}
	return a.ensureAIService().GetChatRunArtifact(sessionID, artifactID)
}

func (a *App) AIPreviewPatch(ctx context.Context, req ai.AIPatchPreviewRequest) (ai.AIPatchPreviewResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIPatchPreviewResult{}, err
	}
	return a.ensureAIService().PreviewPatch(sessionID, req)
}

func (a *App) AIApplyPatchArtifact(ctx context.Context, req ai.AIPatchApplyRequest) (ai.AIPatchApplyResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIPatchApplyResult{}, err
	}
	return a.ensureAIService().ApplyPatchArtifact(sessionID, req)
}

func (a *App) AIRollbackPatchCheckpoint(ctx context.Context, req ai.AIPatchRollbackRequest) (ai.AIPatchRollbackResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIPatchRollbackResult{}, err
	}
	return a.ensureAIService().RollbackPatchCheckpoint(sessionID, req)
}

func (a *App) AIListChatRuns(ctx context.Context, limit int) ([]ai.AIChatRunEnvelope, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListChatRuns(sessionID, limit)
}

func (a *App) AIClearChatRuns(ctx context.Context) error {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().ClearChatRuns(sessionID)
}

func (a *App) AIDeleteChatSession(ctx context.Context, chatSessionID string) error {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().DeleteChatSession(sessionID, chatSessionID)
}

func (a *App) AIListContextCapsules(ctx context.Context, chatSessionID string, limit int) ([]ai.AIContextCapsuleSummary, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().AIListContextCapsules(sessionID, chatSessionID, limit)
}

func (a *App) AICompactChatSession(ctx context.Context, req ai.AIContextCompactionRequest) (ai.AIContextCompactionResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIContextCompactionResult{}, err
	}
	return a.ensureAIService().AICompactChatSession(sessionID, req)
}

func (a *App) AIRevokeContextCapsule(ctx context.Context, capsuleID string) (ai.AIContextCapsuleSummary, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIContextCapsuleSummary{}, err
	}
	return a.ensureAIService().AIRevokeContextCapsule(sessionID, capsuleID)
}

func (a *App) AIGetContextContinuationPlan(ctx context.Context, chatSessionID string) (ai.AIContextContinuationPlan, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIContextContinuationPlan{}, err
	}
	return a.ensureAIService().AIGetContextContinuationPlan(sessionID, chatSessionID)
}

func (a *App) AIListEgressRecords(ctx context.Context, limit int) ([]ai.AIEgressRecord, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListEgressRecords(sessionID, limit)
}

func (a *App) AIListChatActions() ([]ai.AIChatActionDescriptor, error) {
	return a.ensureAIService().ListChatActions(), nil
}

func (a *App) AIListAgentProfiles() ([]ai.AIAgentProfileDescriptor, error) {
	return a.ensureAIService().ListAgentProfiles(), nil
}

func (a *App) AIListPromptWorkflows() ([]ai.AIPromptWorkflowDescriptor, error) {
	return a.ensureAIService().ListPromptWorkflows(), nil
}

func (a *App) AIListContextProviders() ([]ai.AIContextProviderDescriptor, error) {
	return a.ensureAIService().ListContextProviders(), nil
}

func (a *App) AIListTools() ([]ai.AIToolDescriptor, error) {
	return a.ensureAIService().ListTools(), nil
}

func (a *App) AIExecuteToolCall(ctx context.Context, req ai.AIToolCallRequest) (ai.AIToolCallResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIToolCallResult{}, err
	}
	return a.ensureAIService().ExecuteToolCall(ctx, sessionID, req)
}

func (a *App) AIListToolAudit(ctx context.Context, limit int) ([]ai.AIToolAuditRecord, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListToolAudit(sessionID, limit)
}

func (a *App) AIGetEmbeddingStatus() (ai.AIEmbeddingStatus, error) {
	return a.ensureAIService().GetEmbeddingStatus(), nil
}

func (a *App) AIListModelCapabilities(ctx context.Context) ([]ai.AIModelCapabilityDescriptor, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListModelCapabilities(sessionID), nil
}

func (a *App) AIProbeModelCapability(ctx context.Context, req ai.AIModelCapabilityProbeRequest) (ai.AIModelCapabilityProbeResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIModelCapabilityProbeResult{}, err
	}
	return a.ensureAIService().ProbeModelCapability(ctx, sessionID, req)
}

func (a *App) AIListPendingApprovals(ctx context.Context, limit int) ([]ai.AIPendingApproval, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListPendingApprovals(sessionID, limit)
}

func (a *App) AIPreviewBackgroundAgent(ctx context.Context, req ai.AIBackgroundAgentPreviewRequest) (ai.AIBackgroundAgentPreviewResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIBackgroundAgentPreviewResult{}, err
	}
	return a.ensureAIService().PreviewBackgroundAgent(sessionID, req)
}

func (a *App) AIClearState(ctx context.Context) error {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().ClearState(sessionID)
}

func (a *App) AISetMnemonicEnabled(ctx context.Context, enabled bool) (ai.AIStatus, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIStatus{}, err
	}
	return a.ensureAIService().SetMnemonicEnabled(sessionID, enabled)
}

func (a *App) AIClearMnemonic(ctx context.Context) error {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().ClearMnemonic(sessionID)
}

func (a *App) AISearchMnemonic(ctx context.Context, req ai.AIMnemonicSearchRequest) ([]ai.AIMnemonicEntry, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().SearchMnemonic(sessionID, req)
}

func (a *App) AIListMnemonicEntries(ctx context.Context, limit int) ([]ai.AIMnemonicEntry, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListMnemonicEntries(sessionID, limit)
}

func (a *App) AIInspectMnemonic(ctx context.Context, runID string) (ai.AIMnemonicInspection, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicInspection{}, err
	}
	return a.ensureAIService().InspectMnemonic(sessionID, runID)
}

func (a *App) AIProposeMnemonicEntry(ctx context.Context, req ai.AIMnemonicWriteProposalRequest) (ai.AIMnemonicWriteProposalResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicWriteProposalResult{}, err
	}
	return a.ensureAIService().ProposeMnemonicEntry(sessionID, req)
}

// AIProposeManagedMCPFactForMnemonic creates an approval-required Mnemonic
// proposal only after the named managed-MCP egress was recorded for this run.
// The frontend cannot turn arbitrary model text into a managed-MCP fact.
func (a *App) AIProposeManagedMCPFactForMnemonic(ctx context.Context, runID, serverID, toolName, reviewedFact, reviewedBy string) (ai.AIMnemonicWriteProposalResult, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicWriteProposalResult{}, err
	}
	return a.ensureAIService().ProposeManagedMCPFactForMnemonic(sessionID, runID, serverID, toolName, reviewedFact, reviewedBy)
}

func (a *App) AIApproveMnemonicEntryProposal(ctx context.Context, req ai.AIMnemonicApproveProposalRequest) (ai.AIMnemonicEntry, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicEntry{}, err
	}
	return a.ensureAIService().ApproveMnemonicEntryProposal(sessionID, req)
}

func (a *App) AISaveMnemonicEntry(ctx context.Context, input ai.AIMnemonicEntryInput) (ai.AIMnemonicEntry, error) {
	return ai.AIMnemonicEntry{}, fmt.Errorf("direct mnemonic save requires proposal-approved review path")
}

func (a *App) AIUpdateMnemonicEntry(ctx context.Context, id string, patch ai.AIMnemonicEntryPatch) (ai.AIMnemonicEntry, error) {
	return ai.AIMnemonicEntry{}, fmt.Errorf("direct mnemonic update requires proposal-approved review path")
}

func (a *App) AIDeleteMnemonicEntry(ctx context.Context, id string) error {
	return fmt.Errorf("direct mnemonic delete requires proposal-approved review path")
}
