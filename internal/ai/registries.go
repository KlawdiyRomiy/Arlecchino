package ai

import "arlecchino/internal/ai/providers"

func (s *Service) ListChatActions() []AIChatActionDescriptor {
	return []AIChatActionDescriptor{
		{
			ID:             AIChatActionDebug,
			Name:           "Debug",
			Description:    "Investigate failures with project context and diagnostics.",
			BuiltIn:        true,
			ReadOnlyIntent: true,
		},
		{
			ID:                AIChatActionPlan,
			Name:              "Plan",
			Description:       "Produce a project-grounded implementation plan.",
			BuiltIn:           true,
			ReadOnlyIntent:    true,
			ShowPlanStructure: true,
		},
		{
			ID:                   AIChatActionBuild,
			Name:                 "Build",
			Description:          "Prepare implementation guidance and metadata-only tool proposals.",
			BuiltIn:              true,
			MayProposeTools:      true,
			ExpectsToolProposals: true,
			ExecutionUnavailable: true,
		},
	}
}

func (s *Service) ListAgentProfiles() []AIAgentProfileDescriptor {
	return []AIAgentProfileDescriptor{
		{
			ID:          "local-debugger",
			Name:        "Local Debugger",
			Description: "Future local-only debugging agent profile.",
			BuiltIn:     true,
			Enabled:     false,
			ToolKinds:   []AIToolKind{AIToolKindContextRead},
		},
		{
			ID:          "local-builder",
			Name:        "Local Builder",
			Description: "Future local-only build agent profile with approval-gated actions.",
			BuiltIn:     true,
			Enabled:     false,
			ToolKinds:   []AIToolKind{AIToolKindContextRead, AIToolKindFileWrite, AIToolKindTerminal},
		},
		{
			ID:          "subagent-runner",
			Name:        "Subagent Runner",
			Description: "Future subagent bridge profile; execution is not available in this slice.",
			BuiltIn:     true,
			Enabled:     false,
			ToolKinds:   []AIToolKind{AIToolKindSubagent},
		},
	}
}

func (s *Service) ListPromptWorkflows() []AIPromptWorkflowDescriptor {
	return []AIPromptWorkflowDescriptor{
		{
			ID:          "slash-debug",
			Name:        "Debug",
			Slash:       "/debug",
			Action:      AIChatActionDebug,
			Description: "Inspect failure context and suggest evidence-backed fixes.",
			BuiltIn:     true,
		},
		{
			ID:          "slash-plan",
			Name:        "Plan",
			Slash:       "/plan",
			Action:      AIChatActionPlan,
			Description: "Create a backend-safe implementation plan.",
			BuiltIn:     true,
		},
		{
			ID:          "slash-build",
			Name:        "Build",
			Slash:       "/build",
			Action:      AIChatActionBuild,
			Description: "Draft implementation steps and approval-gated tool proposals.",
			BuiltIn:     true,
		},
	}
}

func (s *Service) ListContextProviders() []AIContextProviderDescriptor {
	return []AIContextProviderDescriptor{
		{
			ID:          "current_file",
			Name:        "Current File",
			Description: "Sanitized current file window.",
			Capability:  providers.CapabilityChat,
			Enabled:     true,
			Available:   true,
			LocalOnly:   true,
		},
		{
			ID:          "selection",
			Name:        "Selection",
			Description: "Sanitized active editor selection.",
			Capability:  providers.CapabilityChat,
			Enabled:     true,
			Available:   true,
			LocalOnly:   true,
		},
		{
			ID:          "terminal_input",
			Name:        "Terminal Input",
			Description: "Sanitized terminal input snapshot.",
			Capability:  providers.CapabilityTerminalPrediction,
			Enabled:     true,
			Available:   true,
			LocalOnly:   true,
		},
		{
			ID:          "mnemonic",
			Name:        "Mnemonic",
			Description: "Project-local trusted memory graph entries.",
			Capability:  providers.CapabilityChat,
			Enabled:     true,
			Available:   true,
			LocalOnly:   true,
		},
		{
			ID:          "egress",
			Name:        "Egress Ledger",
			Description: "Metadata-only provider egress activity.",
			Capability:  providers.CapabilityChat,
			Enabled:     true,
			Available:   true,
			LocalOnly:   true,
		},
		{
			ID:          "diagnostics",
			Name:        "Diagnostics",
			Description: "Future diagnostics context provider placeholder.",
			Capability:  providers.CapabilityChat,
			Enabled:     false,
			Available:   false,
			LocalOnly:   true,
		},
		{
			ID:          "git_diff",
			Name:        "Git Diff",
			Description: "Future sanitized git diff context provider placeholder.",
			Capability:  providers.CapabilityChat,
			Enabled:     false,
			Available:   false,
			LocalOnly:   true,
		},
		{
			ID:          "mcp",
			Name:        "MCP",
			Description: "Metadata-only Arlecchino MCP tool-plane summary; approvals stay separate.",
			Capability:  providers.CapabilityChat,
			Enabled:     s != nil && s.mcpContext != nil,
			Available:   s != nil && s.mcpContext != nil,
			LocalOnly:   true,
		},
	}
}

func (s *Service) GetEmbeddingStatus() AIEmbeddingStatus {
	return AIEmbeddingStatus{
		Status: "disabled_no_local_model",
		Reason: "Embeddings are intentionally disabled in this backend slice: no downloads, no external APIs, and no bundled weights.",
		Providers: []AIEmbeddingProviderDescriptor{
			{
				ID:        "local-embedding-placeholder",
				Name:      "Local embedding provider seam",
				Local:     true,
				Available: false,
				Reason:    "No local embedding model is configured.",
			},
		},
		UpdatedAt: utcNow(),
	}
}
