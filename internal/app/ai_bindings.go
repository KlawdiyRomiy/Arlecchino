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
	if service.HasProject(session.ID) {
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
	if session := a.projectSessionForContext(ctx); session != nil && session.currentProjectPath() != "" {
		if err := a.ensureAIProjectSessionOpen(session); err != nil {
			a.logWarning(fmt.Sprintf("[AI] failed to sync project context: %v", err))
		}
	}
	return a.ensureAIService().Status(a.aiProjectSessionID(ctx)), nil
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
	projectID := a.aiProjectSessionID(ctx)
	if session := a.projectSessionForContext(ctx); session != nil && session.currentProjectPath() != "" {
		if err := a.ensureAIProjectSessionOpen(session); err != nil {
			a.logWarning(fmt.Sprintf("[AI] failed to sync prediction project context: %v", err))
		}
	}
	return a.ensureAIService().PredictionStatus(projectID), nil
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

func (a *App) AIApproveMnemonicEntryProposal(ctx context.Context, req ai.AIMnemonicApproveProposalRequest) (ai.AIMnemonicEntry, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicEntry{}, err
	}
	return a.ensureAIService().ApproveMnemonicEntryProposal(sessionID, req)
}

func (a *App) AISaveMnemonicEntry(ctx context.Context, input ai.AIMnemonicEntryInput) (ai.AIMnemonicEntry, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicEntry{}, err
	}
	return a.ensureAIService().SaveMnemonicEntry(sessionID, input)
}

func (a *App) AIUpdateMnemonicEntry(ctx context.Context, id string, patch ai.AIMnemonicEntryPatch) (ai.AIMnemonicEntry, error) {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicEntry{}, err
	}
	return a.ensureAIService().UpdateMnemonicEntry(sessionID, id, patch)
}

func (a *App) AIDeleteMnemonicEntry(ctx context.Context, id string) error {
	sessionID, err := a.ensureAIProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().DeleteMnemonicEntry(sessionID, id)
}
