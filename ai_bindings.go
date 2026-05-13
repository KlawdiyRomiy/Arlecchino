package main

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

func (a *App) aiProjectSessionID(ctx context.Context) string {
	if session := a.projectSessionForContext(ctx); session != nil {
		return session.ID
	}
	return defaultProjectSessionID
}

func (a *App) aiStrictProjectSessionID(ctx context.Context) (string, error) {
	if a == nil {
		return "", fmt.Errorf("AI project session is unavailable")
	}
	window := bindingContextWindow(ctx)
	if window == nil {
		return "", fmt.Errorf("AI project methods require a Wails window context")
	}
	session := a.ensureProjectSessions().getByWindow(window)
	if session == nil {
		return "", fmt.Errorf("AI project session is not bound to the current window")
	}
	if session.currentProjectPath() == "" {
		return "", fmt.Errorf("AI project session has no open project")
	}
	return session.ID, nil
}

func (a *App) AIGetStatus(ctx context.Context) (ai.AIStatus, error) {
	return a.ensureAIService().Status(a.aiProjectSessionID(ctx)), nil
}

func (a *App) AIListProviders() ([]ai.AIProviderDescriptor, error) {
	return a.ensureAIService().ListProviders(), nil
}

func (a *App) AIGetApprovalPolicy(ctx context.Context) (ai.AIApprovalPolicy, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIApprovalPolicy{}, err
	}
	return a.ensureAIService().GetApprovalPolicy(sessionID)
}

func (a *App) AISaveApprovalPolicy(ctx context.Context, policy ai.AIApprovalPolicy) (ai.AIApprovalPolicy, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIApprovalPolicy{}, err
	}
	return a.ensureAIService().SaveApprovalPolicy(sessionID, policy)
}

func (a *App) AIRevokeApprovalPolicy(ctx context.Context) (ai.AIApprovalPolicy, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
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

func (a *App) AIGetContextPreview(ctx context.Context, req ai.AIContextRequest) (ai.AIContextSnapshot, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIContextSnapshot{}, err
	}
	return a.ensureAIService().ContextPreview(sessionID, req)
}

func (a *App) AIGetEditorContinuation(ctx context.Context, req ai.AIContextRequest, providerID string, model string) (ai.AIContinuationResponse, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIContinuationResponse{}, err
	}
	return a.ensureAIService().EditorContinuation(ctx, sessionID, req, providerID, model)
}

func (a *App) AIGetTerminalContinuation(ctx context.Context, req ai.AIContextRequest, providerID string, model string) (ai.AIContinuationResponse, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIContinuationResponse{}, err
	}
	return a.ensureAIService().TerminalContinuation(ctx, sessionID, req, providerID, model)
}

func (a *App) AIStartChatRun(ctx context.Context, req ai.AIChatRunRequest) (ai.AIChatRun, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRun{}, err
	}
	return a.ensureAIService().StartChatRun(ctx, sessionID, req)
}

func (a *App) AICancelChatRun(ctx context.Context, runID string) (ai.AIChatRun, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRun{}, err
	}
	return a.ensureAIService().CancelChatRun(sessionID, runID)
}

func (a *App) AIGetChatRun(ctx context.Context, runID string) (ai.AIChatRun, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRun{}, err
	}
	return a.ensureAIService().GetChatRun(sessionID, runID)
}

func (a *App) AIGetChatRunEnvelope(ctx context.Context, runID string) (ai.AIChatRunEnvelope, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIChatRunEnvelope{}, err
	}
	return a.ensureAIService().GetChatRunEnvelope(sessionID, runID)
}

func (a *App) AIListChatRuns(ctx context.Context, limit int) ([]ai.AIChatRunEnvelope, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListChatRuns(sessionID, limit)
}

func (a *App) AIClearChatRuns(ctx context.Context) error {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().ClearChatRuns(sessionID)
}

func (a *App) AIListEgressRecords(ctx context.Context, limit int) ([]ai.AIEgressRecord, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
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

func (a *App) AIGetEmbeddingStatus() (ai.AIEmbeddingStatus, error) {
	return a.ensureAIService().GetEmbeddingStatus(), nil
}

func (a *App) AIClearState(ctx context.Context) error {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().ClearState(sessionID)
}

func (a *App) AISetMnemonicEnabled(ctx context.Context, enabled bool) (ai.AIStatus, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIStatus{}, err
	}
	return a.ensureAIService().SetMnemonicEnabled(sessionID, enabled)
}

func (a *App) AIClearMnemonic(ctx context.Context) error {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().ClearMnemonic(sessionID)
}

func (a *App) AISearchMnemonic(ctx context.Context, req ai.AIMnemonicSearchRequest) ([]ai.AIMnemonicEntry, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().SearchMnemonic(sessionID, req)
}

func (a *App) AIListMnemonicEntries(ctx context.Context, limit int) ([]ai.AIMnemonicEntry, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return nil, err
	}
	return a.ensureAIService().ListMnemonicEntries(sessionID, limit)
}

func (a *App) AISaveMnemonicEntry(ctx context.Context, input ai.AIMnemonicEntryInput) (ai.AIMnemonicEntry, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicEntry{}, err
	}
	return a.ensureAIService().SaveMnemonicEntry(sessionID, input)
}

func (a *App) AIUpdateMnemonicEntry(ctx context.Context, id string, patch ai.AIMnemonicEntryPatch) (ai.AIMnemonicEntry, error) {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return ai.AIMnemonicEntry{}, err
	}
	return a.ensureAIService().UpdateMnemonicEntry(sessionID, id, patch)
}

func (a *App) AIDeleteMnemonicEntry(ctx context.Context, id string) error {
	sessionID, err := a.aiStrictProjectSessionID(ctx)
	if err != nil {
		return err
	}
	return a.ensureAIService().DeleteMnemonicEntry(sessionID, id)
}
