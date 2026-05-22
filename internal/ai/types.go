package ai

import (
	"time"

	"arlecchino/internal/ai/providers"
)

type AIProviderDescriptor = providers.AIProviderDescriptor
type AIProviderSettings = providers.AIProviderSettings
type AIModelDescriptor = providers.AIModelDescriptor
type AIProviderCapability = providers.AIProviderCapability
type AIProviderStatus = providers.AIProviderStatusValue
type AIProviderStatusValue = providers.AIProviderStatusValue

const (
	AICapabilityCodeCompletion     = providers.CapabilityCodeCompletion
	AICapabilityLinePrediction     = providers.CapabilityLinePrediction
	AICapabilityTerminalPrediction = providers.CapabilityTerminalPrediction
	AICapabilityChat               = providers.CapabilityChat
)

type AIStatus struct {
	Enabled            bool                   `json:"enabled"`
	MnemonicEnabled    bool                   `json:"mnemonicEnabled"`
	Providers          []AIProviderDescriptor `json:"providers"`
	ActiveProviderID   string                 `json:"activeProviderId,omitempty"`
	ActiveModel        string                 `json:"activeModel,omitempty"`
	SettingsConfigured bool                   `json:"settingsConfigured"`
	ProjectPathHash    string                 `json:"projectPathHash,omitempty"`
	ProjectSessionID   string                 `json:"projectSessionId,omitempty"`
}

type AIDiscoveryResult struct {
	Providers []AIProviderDescriptor `json:"providers"`
	CheckedAt string                 `json:"checkedAt"`
}

type AIApprovalMode string

const (
	AIApprovalModeAskEachTime     AIApprovalMode = "ask_each_time"
	AIApprovalModeReadOnlyAllowed AIApprovalMode = "read_only_allowed"
	AIApprovalModeFullAccess      AIApprovalMode = "full_access"
)

type AIToolKind string

const (
	AIToolKindContextRead  AIToolKind = "context_read"
	AIToolKindFileWrite    AIToolKind = "file_write"
	AIToolKindTerminal     AIToolKind = "terminal"
	AIToolKindMCP          AIToolKind = "mcp"
	AIToolKindSubagent     AIToolKind = "subagent"
	AIToolKindNetworkLocal AIToolKind = "network_local"
)

type AIApprovalHardDeny string

const (
	AIApprovalHardDenySecrets             AIApprovalHardDeny = "secrets"
	AIApprovalHardDenySensitivePaths      AIApprovalHardDeny = "sensitive_paths"
	AIApprovalHardDenyNonLoopbackNetwork  AIApprovalHardDeny = "non_loopback_network"
	AIApprovalHardDenyFrontierCloudEgress AIApprovalHardDeny = "frontier_cloud_egress"
	AIApprovalHardDenyDestructiveShell    AIApprovalHardDeny = "destructive_shell_commands"
	AIApprovalHardDenyOutsideProjectWrite AIApprovalHardDeny = "outside_project_writes"
)

type AIApprovalScope struct {
	ProjectSessionID string `json:"projectSessionId,omitempty"`
	ProjectPathHash  string `json:"projectPathHash,omitempty"`
}

type AIApprovalPolicy struct {
	Mode               AIApprovalMode       `json:"mode"`
	Scope              AIApprovalScope      `json:"scope"`
	ProjectSessionID   string               `json:"projectSessionId,omitempty"`
	ProjectPathHash    string               `json:"projectPathHash,omitempty"`
	ExpiresAt          string               `json:"expiresAt,omitempty"`
	GrantedAt          string               `json:"grantedAt,omitempty"`
	GrantedBy          string               `json:"grantedBy,omitempty"`
	RevokedAt          string               `json:"revokedAt,omitempty"`
	AllowedToolKinds   []AIToolKind         `json:"allowedToolKinds"`
	HardDenyCategories []AIApprovalHardDeny `json:"hardDenyCategories"`
	UpdatedAt          string               `json:"updatedAt,omitempty"`
}

type AIApprovalSummary struct {
	Mode               AIApprovalMode       `json:"mode"`
	FullAccessActive   bool                 `json:"fullAccessActive"`
	ProjectSessionID   string               `json:"projectSessionId,omitempty"`
	ProjectPathHash    string               `json:"projectPathHash,omitempty"`
	ExpiresAt          string               `json:"expiresAt,omitempty"`
	RevokedAt          string               `json:"revokedAt,omitempty"`
	AllowedToolKinds   []AIToolKind         `json:"allowedToolKinds"`
	HardDenyCategories []AIApprovalHardDeny `json:"hardDenyCategories"`
}

type AIProviderDataPolicy struct {
	ProviderID       string   `json:"providerId,omitempty"`
	ProviderKind     string   `json:"providerKind,omitempty"`
	Endpoint         string   `json:"endpoint,omitempty"`
	Model            string   `json:"model,omitempty"`
	Local            bool     `json:"local"`
	Frontier         bool     `json:"frontier"`
	Allowed          bool     `json:"allowed"`
	DataCategories   []string `json:"dataCategories,omitempty"`
	RetentionSummary string   `json:"retentionSummary,omitempty"`
	UpdatedAt        string   `json:"updatedAt,omitempty"`
}

type AIConsentPolicy struct {
	LocalProvidersAccepted      bool                   `json:"localProvidersAccepted"`
	RemoteProvidersAccepted     bool                   `json:"remoteProvidersAccepted"`
	RemoteBYOKProvidersAccepted bool                   `json:"remoteByokProvidersAccepted"`
	FrontierProvidersAccepted   bool                   `json:"frontierProvidersAccepted"`
	ExternalAgentCLIAccepted    bool                   `json:"externalAgentCliAccepted"`
	ProviderPolicies            []AIProviderDataPolicy `json:"providerPolicies,omitempty"`
	AcceptedAt                  string                 `json:"acceptedAt,omitempty"`
	UpdatedAt                   string                 `json:"updatedAt,omitempty"`
}

type AIConsentSummary struct {
	LocalProvidersAccepted      bool   `json:"localProvidersAccepted"`
	RemoteProvidersAccepted     bool   `json:"remoteProvidersAccepted"`
	RemoteBYOKProvidersAccepted bool   `json:"remoteByokProvidersAccepted"`
	FrontierProvidersAccepted   bool   `json:"frontierProvidersAccepted"`
	ExternalAgentCLIAccepted    bool   `json:"externalAgentCliAccepted"`
	PolicySource                string `json:"policySource"`
}

type AIContextDisclosure struct {
	ProviderID     string               `json:"providerId,omitempty"`
	ProviderKind   string               `json:"providerKind,omitempty"`
	Endpoint       string               `json:"endpoint,omitempty"`
	Model          string               `json:"model,omitempty"`
	Capability     AIProviderCapability `json:"capability,omitempty"`
	OptInSource    string               `json:"optInSource,omitempty"`
	DataCategories []string             `json:"dataCategories,omitempty"`
	Redaction      AIRedactionSummary   `json:"redaction"`
}

type AIContextDisclosureSummary struct {
	ProviderID            string   `json:"providerId,omitempty"`
	ProviderKind          string   `json:"providerKind,omitempty"`
	EndpointClass         string   `json:"endpointClass,omitempty"`
	Model                 string   `json:"model,omitempty"`
	Local                 bool     `json:"local"`
	Frontier              bool     `json:"frontier"`
	ProviderPolicyAllowed bool     `json:"providerPolicyAllowed"`
	OptInSource           string   `json:"optInSource,omitempty"`
	RetentionSummary      string   `json:"retentionSummary,omitempty"`
	DataCategories        []string `json:"dataCategories,omitempty"`
}

type AIProviderEnvelope struct {
	ProviderID         string                `json:"providerId,omitempty"`
	Kind               string                `json:"kind,omitempty"`
	RuntimeFamily      string                `json:"runtimeFamily,omitempty"`
	Transport          string                `json:"transport,omitempty"`
	Endpoint           string                `json:"endpoint,omitempty"`
	EndpointClass      string                `json:"endpointClass,omitempty"`
	Model              string                `json:"model,omitempty"`
	Status             AIProviderStatusValue `json:"status,omitempty"`
	AuthStatus         string                `json:"authStatus,omitempty"`
	BillingMode        string                `json:"billingMode,omitempty"`
	LegalBasis         string                `json:"legalBasis,omitempty"`
	RiskTier           string                `json:"riskTier,omitempty"`
	SourceLinks        []string              `json:"sourceLinks,omitempty"`
	RuntimeVersion     string                `json:"runtimeVersion,omitempty"`
	AdapterVersion     string                `json:"adapterVersion,omitempty"`
	ProtocolVersion    string                `json:"protocolVersion,omitempty"`
	CompatibilityRange string                `json:"compatibilityRange,omitempty"`
	Local              bool                  `json:"local"`
	Frontier           bool                  `json:"frontier"`
	ExternalAccount    bool                  `json:"externalAccount,omitempty"`
}

type AIContextSnippetBreakdown struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
	Bytes int    `json:"bytes"`
}

type AIContextItemKind string

const (
	AIContextItemKindFile        AIContextItemKind = "file"
	AIContextItemKindSelection   AIContextItemKind = "selection"
	AIContextItemKindTerminal    AIContextItemKind = "terminal"
	AIContextItemKindDiagnostics AIContextItemKind = "diagnostics"
	AIContextItemKindGitDiff     AIContextItemKind = "git_diff"
	AIContextItemKindMnemonic    AIContextItemKind = "mnemonic"
	AIContextItemKindMCP         AIContextItemKind = "mcp"
	AIContextItemKindSkill       AIContextItemKind = "skill"
	AIContextItemKindWorkspace   AIContextItemKind = "workspace"
)

type AIContextItemRequest struct {
	ID     string            `json:"id,omitempty"`
	Kind   AIContextItemKind `json:"kind"`
	Label  string            `json:"label,omitempty"`
	Path   string            `json:"path,omitempty"`
	Source string            `json:"source,omitempty"`
}

type AIChatMentionTrigger string

const (
	AIChatMentionTriggerAt    AIChatMentionTrigger = "@"
	AIChatMentionTriggerSlash AIChatMentionTrigger = "/"
)

type AIChatMentionKind string

const (
	AIChatMentionKindAgent    AIChatMentionKind = "agent"
	AIChatMentionKindSkill    AIChatMentionKind = "skill"
	AIChatMentionKindFile     AIChatMentionKind = "file"
	AIChatMentionKindContext  AIChatMentionKind = "context"
	AIChatMentionKindWorkflow AIChatMentionKind = "workflow"
	AIChatMentionKindAction   AIChatMentionKind = "action"
	AIChatMentionKindCommand  AIChatMentionKind = "command"
)

type AIChatMentionOperation string

const (
	AIChatMentionOperationSetAction     AIChatMentionOperation = "set_action"
	AIChatMentionOperationSetProfile    AIChatMentionOperation = "set_profile"
	AIChatMentionOperationSetWorkflow   AIChatMentionOperation = "set_workflow"
	AIChatMentionOperationAttachFile    AIChatMentionOperation = "attach_file"
	AIChatMentionOperationAttachSkill   AIChatMentionOperation = "attach_skill"
	AIChatMentionOperationAttachContext AIChatMentionOperation = "attach_context"
	AIChatMentionOperationInsertText    AIChatMentionOperation = "insert_text"
)

type AIChatMentionQuery struct {
	Trigger         AIChatMentionTrigger `json:"trigger"`
	Query           string               `json:"query,omitempty"`
	SessionID       string               `json:"sessionId,omitempty"`
	Limit           int                  `json:"limit,omitempty"`
	IncludeDisabled bool                 `json:"includeDisabled"`
}

type AIChatMentionCandidate struct {
	ID             string                 `json:"id"`
	Kind           AIChatMentionKind      `json:"kind"`
	Group          string                 `json:"group"`
	Label          string                 `json:"label"`
	Description    string                 `json:"description,omitempty"`
	Detail         string                 `json:"detail,omitempty"`
	InsertText     string                 `json:"insertText,omitempty"`
	DisabledReason string                 `json:"disabledReason,omitempty"`
	Score          float64                `json:"score"`
	Operation      AIChatMentionOperation `json:"operation"`
	Action         AIChatAction           `json:"action,omitempty"`
	ProfileID      string                 `json:"profileId,omitempty"`
	WorkflowID     string                 `json:"workflowId,omitempty"`
	ContextItem    *AIContextItemRequest  `json:"contextItem,omitempty"`
}

type AIContextItemDisclosure struct {
	ID        string            `json:"id"`
	Kind      AIContextItemKind `json:"kind"`
	Label     string            `json:"label"`
	Path      string            `json:"path,omitempty"`
	Source    string            `json:"source,omitempty"`
	Requested bool              `json:"requested"`
	Included  bool              `json:"included"`
	Redacted  bool              `json:"redacted"`
	Truncated bool              `json:"truncated"`
	Bytes     int               `json:"bytes,omitempty"`
	Reason    string            `json:"reason,omitempty"`
}

type AIMCPToolGroupSummary struct {
	Name     string `json:"name"`
	Total    int    `json:"total"`
	Enabled  int    `json:"enabled"`
	Disabled int    `json:"disabled"`
}

type AIMCPContextPlane struct {
	Enabled               bool                    `json:"enabled"`
	Available             bool                    `json:"available"`
	BridgeRunning         bool                    `json:"bridgeRunning"`
	BridgeAvailable       bool                    `json:"bridgeAvailable"`
	ToolCount             int                     `json:"toolCount"`
	EnabledToolCount      int                     `json:"enabledToolCount"`
	DisabledToolCount     int                     `json:"disabledToolCount"`
	ToolGroups            []AIMCPToolGroupSummary `json:"toolGroups,omitempty"`
	MemoryBackend         string                  `json:"memoryBackend,omitempty"`
	MemoryContextPath     string                  `json:"memoryContextPath,omitempty"`
	MnemonicSharedContext bool                    `json:"mnemonicSharedContext"`
	ExecutionState        string                  `json:"executionState"`
	ApprovalSummary       string                  `json:"approvalSummary,omitempty"`
	DataCategories        []string                `json:"dataCategories,omitempty"`
	RedactionSummary      string                  `json:"redactionSummary,omitempty"`
	UpdatedAt             string                  `json:"updatedAt"`
}

type AIContextRequest struct {
	RequestID       string                 `json:"requestId,omitempty"`
	DocumentVersion string                 `json:"documentVersion,omitempty"`
	Capability      AIProviderCapability   `json:"capability"`
	OptInSource     string                 `json:"optInSource,omitempty"`
	Prompt          string                 `json:"prompt,omitempty"`
	FilePath        string                 `json:"filePath,omitempty"`
	Language        string                 `json:"language,omitempty"`
	Line            int                    `json:"line,omitempty"`
	Column          int                    `json:"column,omitempty"`
	LineText        string                 `json:"lineText,omitempty"`
	TextBefore      string                 `json:"textBefore,omitempty"`
	TextAfter       string                 `json:"textAfter,omitempty"`
	FullText        string                 `json:"fullText,omitempty"`
	Selection       string                 `json:"selection,omitempty"`
	TerminalInput   string                 `json:"terminalInput,omitempty"`
	TerminalWorkDir string                 `json:"terminalWorkDir,omitempty"`
	IncludeMnemonic bool                   `json:"includeMnemonic"`
	IncludeMCP      bool                   `json:"includeMCP"`
	IncludeSkills   bool                   `json:"includeSkills"`
	ContextItems    []AIContextItemRequest `json:"contextItems,omitempty"`
	MaxBytes        int                    `json:"maxBytes,omitempty"`
	MaxSnippets     int                    `json:"maxSnippets,omitempty"`
}

type AIContextSnippet struct {
	Type     string `json:"type"`
	Path     string `json:"path,omitempty"`
	Language string `json:"language,omitempty"`
	Content  string `json:"content"`
}

type AIContextSnapshot struct {
	ID                string                      `json:"id"`
	RequestID         string                      `json:"requestId,omitempty"`
	DocumentVersion   string                      `json:"documentVersion,omitempty"`
	Capability        AIProviderCapability        `json:"capability"`
	ProjectPathHash   string                      `json:"projectPathHash,omitempty"`
	ProjectSessionID  string                      `json:"projectSessionId,omitempty"`
	FilePath          string                      `json:"filePath,omitempty"`
	Language          string                      `json:"language,omitempty"`
	Line              int                         `json:"line,omitempty"`
	Column            int                         `json:"column,omitempty"`
	Prompt            string                      `json:"prompt,omitempty"`
	TerminalInput     string                      `json:"terminalInput,omitempty"`
	TerminalWorkDir   string                      `json:"terminalWorkDir,omitempty"`
	Snippets          []AIContextSnippet          `json:"snippets"`
	SnippetBreakdown  []AIContextSnippetBreakdown `json:"snippetBreakdown,omitempty"`
	ContextItems      []AIContextItemDisclosure   `json:"contextItems,omitempty"`
	MCPContext        *AIMCPContextPlane          `json:"mcpContext,omitempty"`
	Mnemonic          []AIMnemonicEntry           `json:"mnemonic,omitempty"`
	Skills            []AISkillContext            `json:"skills,omitempty"`
	DataCategories    []string                    `json:"dataCategories"`
	Redaction         AIRedactionSummary          `json:"redaction"`
	ProviderEnvelope  *AIProviderEnvelope         `json:"providerEnvelope,omitempty"`
	Disclosure        AIContextDisclosure         `json:"disclosure"`
	DisclosureSummary AIContextDisclosureSummary  `json:"disclosureSummary"`
	ApprovalSummary   AIApprovalSummary           `json:"approvalSummary"`
	ByteSize          int                         `json:"byteSize"`
	CreatedAt         string                      `json:"createdAt"`
}

type AIContextSummary struct {
	ID                string                      `json:"id"`
	RequestID         string                      `json:"requestId,omitempty"`
	DocumentVersion   string                      `json:"documentVersion,omitempty"`
	Capability        AIProviderCapability        `json:"capability"`
	ProjectSessionID  string                      `json:"projectSessionId,omitempty"`
	FilePath          string                      `json:"filePath,omitempty"`
	Language          string                      `json:"language,omitempty"`
	SnippetCount      int                         `json:"snippetCount"`
	MnemonicCount     int                         `json:"mnemonicCount"`
	SkillCount        int                         `json:"skillCount"`
	MCPIncluded       bool                        `json:"mcpIncluded"`
	MCPContext        *AIMCPContextPlane          `json:"mcpContext,omitempty"`
	SnippetBreakdown  []AIContextSnippetBreakdown `json:"snippetBreakdown,omitempty"`
	ContextItems      []AIContextItemDisclosure   `json:"contextItems,omitempty"`
	DataCategories    []string                    `json:"dataCategories"`
	Redaction         AIRedactionSummary          `json:"redaction"`
	DisclosureSummary AIContextDisclosureSummary  `json:"disclosureSummary"`
	ByteSize          int                         `json:"byteSize"`
	CreatedAt         string                      `json:"createdAt"`
}

type AIRedactionSummary struct {
	SecretsRedacted   int      `json:"secretsRedacted"`
	PathsRedacted     int      `json:"pathsRedacted"`
	Truncated         bool     `json:"truncated"`
	OriginalBytes     int      `json:"originalBytes"`
	SanitizedBytes    int      `json:"sanitizedBytes"`
	BlockedCategories []string `json:"blockedCategories,omitempty"`
	AppliedRules      []string `json:"appliedRules,omitempty"`
}

type AISkillContext struct {
	SkillID            string   `json:"skillId"`
	Name               string   `json:"name"`
	Description        string   `json:"description,omitempty"`
	SourceKind         string   `json:"sourceKind"`
	TrustState         string   `json:"trustState"`
	State              string   `json:"state,omitempty"`
	ContentHash        string   `json:"contentHash,omitempty"`
	DigestVersion      int      `json:"digestVersion"`
	Summary            string   `json:"summary"`
	ActivationRules    []string `json:"activationRules,omitempty"`
	OperatingReminders []string `json:"operatingReminders,omitempty"`
	AvoidRules         []string `json:"avoidRules,omitempty"`
	ToolHints          []string `json:"toolHints,omitempty"`
	VerificationHints  []string `json:"verificationHints,omitempty"`
	ResourcesIndex     []string `json:"resourcesIndex,omitempty"`
	TopicMatch         string   `json:"topicMatch,omitempty"`
	Confidence         float64  `json:"confidence,omitempty"`
	ActivatedAt        string   `json:"activatedAt,omitempty"`
	LastUsedAt         string   `json:"lastUsedAt,omitempty"`
	DecayDeadline      string   `json:"decayDeadline,omitempty"`
}

type AIMnemonicEntry struct {
	ID             string                   `json:"id"`
	Type           string                   `json:"type"`
	Source         string                   `json:"source,omitempty"`
	Tags           []string                 `json:"tags,omitempty"`
	Content        string                   `json:"content"`
	Importance     int                      `json:"importance"`
	Confidence     float64                  `json:"confidence"`
	Trust          string                   `json:"trust,omitempty"`
	OriginKind     string                   `json:"originKind,omitempty"`
	Generated      bool                     `json:"generated"`
	Superseded     bool                     `json:"superseded"`
	Pinned         bool                     `json:"pinned"`
	IsLatest       bool                     `json:"isLatest"`
	Decay          float64                  `json:"decay"`
	LastAccessedAt string                   `json:"lastAccessedAt,omitempty"`
	AccessCount    int                      `json:"accessCount"`
	Provenance     map[string]string        `json:"provenance,omitempty"`
	Relationships  []AIMnemonicRelationship `json:"relationships,omitempty"`
	CreatedAt      string                   `json:"createdAt"`
	UpdatedAt      string                   `json:"updatedAt,omitempty"`
}

type AIMnemonicRelationship struct {
	ID        string `json:"id,omitempty"`
	FromID    string `json:"fromId"`
	ToID      string `json:"toId"`
	Type      string `json:"type"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type AIMnemonicSearchRequest struct {
	Query             string   `json:"query,omitempty"`
	Tags              []string `json:"tags,omitempty"`
	Limit             int      `json:"limit,omitempty"`
	IncludeUntrusted  bool     `json:"includeUntrusted"`
	IncludeGenerated  bool     `json:"includeGenerated"`
	IncludeSuperseded bool     `json:"includeSuperseded"`
}

type AIMnemonicEntryInput struct {
	ID            string                   `json:"id,omitempty"`
	Type          string                   `json:"type,omitempty"`
	Source        string                   `json:"source,omitempty"`
	Tags          []string                 `json:"tags,omitempty"`
	Content       string                   `json:"content"`
	Importance    int                      `json:"importance,omitempty"`
	Confidence    float64                  `json:"confidence,omitempty"`
	Trust         string                   `json:"trust,omitempty"`
	Pinned        bool                     `json:"pinned"`
	IsLatest      bool                     `json:"isLatest"`
	Decay         float64                  `json:"decay,omitempty"`
	Provenance    map[string]string        `json:"provenance,omitempty"`
	Relationships []AIMnemonicRelationship `json:"relationships,omitempty"`
}

type AIMnemonicEntryPatch struct {
	Type          string                   `json:"type,omitempty"`
	Source        string                   `json:"source,omitempty"`
	Tags          []string                 `json:"tags,omitempty"`
	Content       string                   `json:"content,omitempty"`
	Importance    *int                     `json:"importance,omitempty"`
	Confidence    *float64                 `json:"confidence,omitempty"`
	Trust         string                   `json:"trust,omitempty"`
	Pinned        *bool                    `json:"pinned,omitempty"`
	IsLatest      *bool                    `json:"isLatest,omitempty"`
	Decay         *float64                 `json:"decay,omitempty"`
	Provenance    map[string]string        `json:"provenance,omitempty"`
	Relationships []AIMnemonicRelationship `json:"relationships,omitempty"`
}

type AIMnemonicInspectionEntry struct {
	Entry     AIMnemonicEntry `json:"entry"`
	State     string          `json:"state"`
	Reason    string          `json:"reason,omitempty"`
	UsedInRun bool            `json:"usedInRun"`
}

type AIMnemonicInspection struct {
	RunID      string                      `json:"runId,omitempty"`
	Used       []AIMnemonicInspectionEntry `json:"used"`
	Candidates []AIMnemonicInspectionEntry `json:"candidates"`
	Pinned     []AIMnemonicInspectionEntry `json:"pinned"`
	Stale      []AIMnemonicInspectionEntry `json:"stale"`
	Superseded []AIMnemonicInspectionEntry `json:"superseded"`
	UpdatedAt  string                      `json:"updatedAt"`
}

type AIMnemonicWriteProposalRequest struct {
	RunID  string               `json:"runId"`
	Entry  AIMnemonicEntryInput `json:"entry"`
	Reason string               `json:"reason,omitempty"`
}

type AIMnemonicWriteProposalPayload struct {
	Entry            AIMnemonicEntryInput `json:"entry"`
	Reason           string               `json:"reason,omitempty"`
	RequiresApproval bool                 `json:"requiresApproval"`
}

type AIMnemonicWriteProposalResult struct {
	Artifact         AIChatRunArtifact              `json:"artifact"`
	Payload          AIMnemonicWriteProposalPayload `json:"payload"`
	Status           string                         `json:"status"`
	RequiresApproval bool                           `json:"requiresApproval"`
}

type AIMnemonicApproveProposalRequest struct {
	ArtifactID string `json:"artifactId"`
	ReviewedBy string `json:"reviewedBy,omitempty"`
	Trust      string `json:"trust,omitempty"`
	Pinned     bool   `json:"pinned"`
}

type AIEgressRecord struct {
	ID               string               `json:"id"`
	RequestID        string               `json:"requestId"`
	ProviderID       string               `json:"providerId"`
	ProviderKind     string               `json:"providerKind"`
	Endpoint         string               `json:"endpoint,omitempty"`
	Model            string               `json:"model,omitempty"`
	ReasoningEffort  string               `json:"reasoningEffort,omitempty"`
	Capability       AIProviderCapability `json:"capability"`
	ProjectPathHash  string               `json:"projectPathHash,omitempty"`
	ProjectSessionID string               `json:"projectSessionId,omitempty"`
	DataCategories   []string             `json:"dataCategories"`
	Redaction        AIRedactionSummary   `json:"redaction"`
	Status           string               `json:"status"`
	LatencyMs        int64                `json:"latencyMs,omitempty"`
	ErrorClass       string               `json:"errorClass,omitempty"`
	OptInSource      string               `json:"optInSource,omitempty"`
	Canceled         bool                 `json:"canceled"`
	CreatedAt        string               `json:"createdAt"`
	RunID            string               `json:"runId,omitempty"`
	Source           string               `json:"source,omitempty"`
	ChatAction       AIChatAction         `json:"chatAction,omitempty"`
	InputTokens      int                  `json:"inputTokens,omitempty"`
	OutputTokens     int                  `json:"outputTokens,omitempty"`
	TotalTokens      int                  `json:"totalTokens,omitempty"`
	EstimatedTokens  bool                 `json:"estimatedTokens,omitempty"`
	TokenSource      string               `json:"tokenSource,omitempty"`
	CostMicros       int64                `json:"costMicros,omitempty"`
	CostCurrency     string               `json:"costCurrency,omitempty"`
	CostEstimated    bool                 `json:"costEstimated,omitempty"`
	CostSource       string               `json:"costSource,omitempty"`
	BudgetDecision   string               `json:"budgetDecision,omitempty"`
	BudgetReason     string               `json:"budgetReason,omitempty"`
	ToolProfile      string               `json:"toolProfile,omitempty"`
	ToolSchemaCount  int                  `json:"toolSchemaCount,omitempty"`
	ToolSupportKind  string               `json:"toolSupportKind,omitempty"`
}

type AIChatAction string

const (
	AIChatActionAsk    AIChatAction = "ask"
	AIChatActionDebug  AIChatAction = "debug"
	AIChatActionPlan   AIChatAction = "plan"
	AIChatActionBuild  AIChatAction = "build"
	AIChatActionReview AIChatAction = "review"
)

type AIToolPolicy string

const (
	AIToolPolicyReadOnly         AIToolPolicy = "read_only_context"
	AIToolPolicyProposalOnly     AIToolPolicy = "tool_proposal_only"
	AIToolPolicyApprovalRequired AIToolPolicy = "approval_required"
)

type AIToolRiskLevel string

const (
	AIToolRiskLow      AIToolRiskLevel = "low"
	AIToolRiskMedium   AIToolRiskLevel = "medium"
	AIToolRiskHigh     AIToolRiskLevel = "high"
	AIToolRiskHardDeny AIToolRiskLevel = "hard_deny"
)

type AIToolProposalStatus string

const (
	AIToolProposalStatusProposed AIToolProposalStatus = "proposed"
	AIToolProposalStatusBlocked  AIToolProposalStatus = "blocked"
)

type AIToolHardDenyReason string

const (
	AIToolHardDenyReasonSecrets             AIToolHardDenyReason = "secrets"
	AIToolHardDenyReasonSensitivePaths      AIToolHardDenyReason = "sensitive_paths"
	AIToolHardDenyReasonNonLoopbackNetwork  AIToolHardDenyReason = "non_loopback_network"
	AIToolHardDenyReasonFrontierCloudEgress AIToolHardDenyReason = "frontier_cloud_egress"
	AIToolHardDenyReasonDestructiveShell    AIToolHardDenyReason = "destructive_shell_commands"
	AIToolHardDenyReasonTerminalFileWrite   AIToolHardDenyReason = "terminal_file_write"
	AIToolHardDenyReasonOutsideProjectWrite AIToolHardDenyReason = "outside_project_writes"
)

type AIToolExecutionState string

const (
	AIToolExecutionStateNotExecutable AIToolExecutionState = "not_executable_in_this_slice"
)

type AIToolProposal struct {
	ID                     string               `json:"id"`
	Name                   string               `json:"name"`
	Description            string               `json:"description"`
	Policy                 AIToolPolicy         `json:"policy"`
	Arguments              map[string]string    `json:"arguments,omitempty"`
	Kind                   AIToolKind           `json:"kind"`
	ScopeSummary           string               `json:"scopeSummary,omitempty"`
	RiskLevel              AIToolRiskLevel      `json:"riskLevel"`
	TargetPaths            []string             `json:"targetPaths,omitempty"`
	CommandPreview         string               `json:"commandPreview,omitempty"`
	MCPToolName            string               `json:"mcpToolName,omitempty"`
	ApprovalModeRequired   AIApprovalMode       `json:"approvalModeRequired"`
	AllowedByCurrentPolicy bool                 `json:"allowedByCurrentPolicy"`
	HardDenyReason         AIToolHardDenyReason `json:"hardDenyReason,omitempty"`
	ApprovalToken          string               `json:"approvalToken,omitempty"`
	Status                 AIToolProposalStatus `json:"status"`
	ExecutionState         AIToolExecutionState `json:"executionState"`
}

type AIEgressSummary struct {
	RecordID        string               `json:"recordId,omitempty"`
	Status          string               `json:"status,omitempty"`
	ProviderID      string               `json:"providerId,omitempty"`
	ProviderKind    string               `json:"providerKind,omitempty"`
	Endpoint        string               `json:"endpoint,omitempty"`
	Model           string               `json:"model,omitempty"`
	ReasoningEffort string               `json:"reasoningEffort,omitempty"`
	Capability      AIProviderCapability `json:"capability,omitempty"`
	DataCategories  []string             `json:"dataCategories,omitempty"`
	Redaction       AIRedactionSummary   `json:"redaction"`
	LatencyMs       int64                `json:"latencyMs,omitempty"`
	Canceled        bool                 `json:"canceled"`
	ErrorClass      string               `json:"errorClass,omitempty"`
	CreatedAt       string               `json:"createdAt,omitempty"`
	RunID           string               `json:"runId,omitempty"`
	Source          string               `json:"source,omitempty"`
	ChatAction      AIChatAction         `json:"chatAction,omitempty"`
	InputTokens     int                  `json:"inputTokens,omitempty"`
	OutputTokens    int                  `json:"outputTokens,omitempty"`
	TotalTokens     int                  `json:"totalTokens,omitempty"`
	EstimatedTokens bool                 `json:"estimatedTokens,omitempty"`
	TokenSource     string               `json:"tokenSource,omitempty"`
	CostMicros      int64                `json:"costMicros,omitempty"`
	CostCurrency    string               `json:"costCurrency,omitempty"`
	CostEstimated   bool                 `json:"costEstimated,omitempty"`
	CostSource      string               `json:"costSource,omitempty"`
	ToolProfile     string               `json:"toolProfile,omitempty"`
	ToolSchemaCount int                  `json:"toolSchemaCount,omitempty"`
	ToolSupportKind string               `json:"toolSupportKind,omitempty"`
}

type AIToolProposalSummary struct {
	Total                int `json:"total"`
	AllowedByPolicy      int `json:"allowedByPolicy"`
	HardDenied           int `json:"hardDenied"`
	NotExecutableInSlice int `json:"notExecutableInSlice"`
}

type AIMnemonicInclusionSummary struct {
	Requested bool     `json:"requested"`
	Enabled   bool     `json:"enabled"`
	Included  bool     `json:"included"`
	Count     int      `json:"count"`
	Trusts    []string `json:"trusts,omitempty"`
}

type AIExternalAgentRunSummary struct {
	RuntimeID          string   `json:"runtimeId,omitempty"`
	ProviderID         string   `json:"providerId,omitempty"`
	Model              string   `json:"model,omitempty"`
	ReasoningEffort    string   `json:"reasoningEffort,omitempty"`
	RuntimeFamily      string   `json:"runtimeFamily,omitempty"`
	Operation          string   `json:"operation,omitempty"`
	Transport          string   `json:"transport,omitempty"`
	EndpointClass      string   `json:"endpointClass,omitempty"`
	RuntimeBinary      string   `json:"runtimeBinary,omitempty"`
	RuntimeVersion     string   `json:"runtimeVersion,omitempty"`
	AdapterVersion     string   `json:"adapterVersion,omitempty"`
	ProtocolVersion    string   `json:"protocolVersion,omitempty"`
	CompatibilityRange string   `json:"compatibilityRange,omitempty"`
	AuthStatus         string   `json:"authStatus,omitempty"`
	AuthFlow           bool     `json:"authFlow,omitempty"`
	Status             string   `json:"status,omitempty"`
	HealthStatus       string   `json:"healthStatus,omitempty"`
	ProofState         string   `json:"proofState,omitempty"`
	ProofReason        string   `json:"proofReason,omitempty"`
	PreflightStatus    string   `json:"preflightStatus,omitempty"`
	ConsentStatus      string   `json:"consentStatus,omitempty"`
	ToolPolicy         string   `json:"toolPolicy,omitempty"`
	SandboxPolicy      string   `json:"sandboxPolicy,omitempty"`
	ArtifactState      string   `json:"artifactState,omitempty"`
	PromptTransport    string   `json:"promptTransport,omitempty"`
	FallbackRuntime    bool     `json:"fallbackRuntime,omitempty"`
	ThreadID           string   `json:"threadId,omitempty"`
	TurnID             string   `json:"turnId,omitempty"`
	FirstEventType     string   `json:"firstEventType,omitempty"`
	FirstEventAt       string   `json:"firstEventAt,omitempty"`
	LastEventAt        string   `json:"lastEventAt,omitempty"`
	FailureCode        string   `json:"failureCode,omitempty"`
	ExitCode           int      `json:"exitCode,omitempty"`
	CapturedDiffID     string   `json:"capturedDiffId,omitempty"`
	BaselineID         string   `json:"baselineId,omitempty"`
	TranscriptID       string   `json:"transcriptId,omitempty"`
	BlockedReason      string   `json:"blockedReason,omitempty"`
	SourceLinks        []string `json:"sourceLinks,omitempty"`
}

type AIChatRunNotice struct {
	Severity       string `json:"severity"`
	Title          string `json:"title"`
	Message        string `json:"message,omitempty"`
	Details        string `json:"details,omitempty"`
	Source         string `json:"source,omitempty"`
	Tag            string `json:"tag,omitempty"`
	NotificationID string `json:"notificationId,omitempty"`
}

type AIChatRunEnvelope struct {
	ID                  string                     `json:"id"`
	SessionID           string                     `json:"sessionId"`
	ProjectSessionID    string                     `json:"projectSessionId,omitempty"`
	Action              AIChatAction               `json:"action"`
	ProfileID           string                     `json:"profileId,omitempty"`
	WorkflowID          string                     `json:"workflowId,omitempty"`
	Status              string                     `json:"status"`
	RuntimeFamily       string                     `json:"runtimeFamily,omitempty"`
	ProviderID          string                     `json:"providerId,omitempty"`
	Model               string                     `json:"model,omitempty"`
	ReasoningEffort     string                     `json:"reasoningEffort,omitempty"`
	Error               string                     `json:"error,omitempty"`
	RunNotice           *AIChatRunNotice           `json:"runNotice,omitempty"`
	CanCancel           bool                       `json:"canCancel"`
	ContextSummary      *AIContextSummary          `json:"contextSummary,omitempty"`
	ProviderEnvelope    *AIProviderEnvelope        `json:"providerEnvelope,omitempty"`
	EgressSummary       *AIEgressSummary           `json:"egressSummary,omitempty"`
	DisclosureSummary   AIContextDisclosureSummary `json:"disclosureSummary"`
	ApprovalSummary     AIApprovalSummary          `json:"approvalSummary"`
	ConsentSummary      AIConsentSummary           `json:"consentSummary"`
	ToolProposals       []AIToolProposal           `json:"toolProposals,omitempty"`
	ToolProposalSummary AIToolProposalSummary      `json:"toolProposalSummary"`
	MnemonicInclusion   AIMnemonicInclusionSummary `json:"mnemonicInclusion"`
	Timeline            []AIRunTimelineEvent       `json:"timeline,omitempty"`
	AgentRuntime        *AIExternalAgentRunSummary `json:"agentRuntime,omitempty"`
	Revision            int64                      `json:"revision"`
	CreatedAt           string                     `json:"createdAt"`
	UpdatedAt           string                     `json:"updatedAt"`
}

type AIChatRun struct {
	ID                string                     `json:"id"`
	SessionID         string                     `json:"sessionId"`
	ProjectSessionID  string                     `json:"projectSessionId,omitempty"`
	Action            AIChatAction               `json:"action"`
	ProfileID         string                     `json:"profileId,omitempty"`
	WorkflowID        string                     `json:"workflowId,omitempty"`
	Status            string                     `json:"status"`
	RuntimeFamily     string                     `json:"runtimeFamily,omitempty"`
	ProviderID        string                     `json:"providerId,omitempty"`
	Model             string                     `json:"model,omitempty"`
	ReasoningEffort   string                     `json:"reasoningEffort,omitempty"`
	UserPrompt        string                     `json:"userPrompt,omitempty"`
	Response          string                     `json:"response,omitempty"`
	Error             string                     `json:"error,omitempty"`
	ContextSummary    *AIContextSummary          `json:"contextSummary,omitempty"`
	ToolProposals     []AIToolProposal           `json:"toolProposals,omitempty"`
	EgressRecordID    string                     `json:"egressRecordId,omitempty"`
	AgentRuntime      *AIExternalAgentRunSummary `json:"agentRuntime,omitempty"`
	MnemonicRequested bool                       `json:"mnemonicRequested"`
	CanCancel         bool                       `json:"canCancel"`
	Revision          int64                      `json:"revision"`
	CreatedAt         string                     `json:"createdAt"`
	UpdatedAt         string                     `json:"updatedAt"`
}

type AIRunTimelineEvent struct {
	ID               string               `json:"id"`
	RunID            string               `json:"runId,omitempty"`
	SessionID        string               `json:"sessionId,omitempty"`
	ProjectSessionID string               `json:"projectSessionId,omitempty"`
	Source           string               `json:"source"`
	Type             string               `json:"type"`
	Status           string               `json:"status,omitempty"`
	Actor            string               `json:"actor,omitempty"`
	ProviderID       string               `json:"providerId,omitempty"`
	Model            string               `json:"model,omitempty"`
	ToolID           string               `json:"toolId,omitempty"`
	ArtifactID       string               `json:"artifactId,omitempty"`
	CorrelationID    string               `json:"correlationId,omitempty"`
	Summary          string               `json:"summary,omitempty"`
	DataCategories   []string             `json:"dataCategories,omitempty"`
	Redaction        AIRedactionSummary   `json:"redaction"`
	Capability       AIProviderCapability `json:"capability,omitempty"`
	CreatedAt        string               `json:"createdAt"`
}

type AIPendingApproval struct {
	ID               string            `json:"id"`
	RunID            string            `json:"runId"`
	SessionID        string            `json:"sessionId"`
	ProjectSessionID string            `json:"projectSessionId,omitempty"`
	ArtifactID       string            `json:"artifactId"`
	ToolID           string            `json:"toolId"`
	Kind             AIToolKind        `json:"kind"`
	Action           AIToolCallAction  `json:"action"`
	Status           string            `json:"status"`
	RiskLevel        AIToolRiskLevel   `json:"riskLevel,omitempty"`
	ApprovalMode     AIApprovalMode    `json:"approvalModeRequired,omitempty"`
	ScopeSummary     string            `json:"scopeSummary,omitempty"`
	TargetPaths      []string          `json:"targetPaths,omitempty"`
	CommandPreview   string            `json:"commandPreview,omitempty"`
	Arguments        map[string]string `json:"arguments,omitempty"`
	Artifact         AIChatRunArtifact `json:"artifact"`
	CreatedAt        string            `json:"createdAt"`
	UpdatedAt        string            `json:"updatedAt"`
}

type AIChatRunArtifactKind string

const (
	AIChatRunArtifactContext       AIChatRunArtifactKind = "context"
	AIChatRunArtifactEgress        AIChatRunArtifactKind = "egress"
	AIChatRunArtifactToolProposal  AIChatRunArtifactKind = "tool_proposal"
	AIChatRunArtifactMemory        AIChatRunArtifactKind = "memory"
	AIChatRunArtifactPatchPreview  AIChatRunArtifactKind = "patch_preview"
	AIChatRunArtifactTerminal      AIChatRunArtifactKind = "terminal_preview"
	AIChatRunArtifactBackground    AIChatRunArtifactKind = "background_agent"
	AIChatRunArtifactAgentTerminal AIChatRunArtifactKind = "agent_terminal"
	AIChatRunArtifactAgentWorktree AIChatRunArtifactKind = "agent_worktree"
)

type AIChatRunArtifact struct {
	ID               string                `json:"id"`
	RunID            string                `json:"runId"`
	SessionID        string                `json:"sessionId"`
	ProjectSessionID string                `json:"projectSessionId,omitempty"`
	Kind             AIChatRunArtifactKind `json:"kind"`
	Status           string                `json:"status"`
	Title            string                `json:"title"`
	Summary          string                `json:"summary,omitempty"`
	PayloadJSON      string                `json:"payloadJson,omitempty"`
	CreatedAt        string                `json:"createdAt"`
	UpdatedAt        string                `json:"updatedAt"`
}

type AIPatchPreviewRequest struct {
	RunID       string `json:"runId"`
	Title       string `json:"title,omitempty"`
	Summary     string `json:"summary,omitempty"`
	UnifiedDiff string `json:"unifiedDiff"`
}

type AIPatchFile struct {
	Path         string `json:"path"`
	Status       string `json:"status"`
	Exists       bool   `json:"exists"`
	OriginalHash string `json:"originalHash,omitempty"`
	Bytes        int    `json:"bytes,omitempty"`
	Mode         uint32 `json:"mode,omitempty"`
}

type AIPatchArtifactPayload struct {
	UnifiedDiff    string        `json:"unifiedDiff"`
	Files          []AIPatchFile `json:"files"`
	CheckReady     bool          `json:"checkReady"`
	CheckError     string        `json:"checkError,omitempty"`
	CheckpointIDs  []string      `json:"checkpointIds,omitempty"`
	Source         string        `json:"source,omitempty"`
	AlreadyApplied bool          `json:"alreadyApplied,omitempty"`
	BaselineID     string        `json:"baselineId,omitempty"`
	ReverseDiff    string        `json:"reverseDiff,omitempty"`
	AppliedAt      string        `json:"appliedAt,omitempty"`
	RolledBackAt   string        `json:"rolledBackAt,omitempty"`
}

type AIPatchPreviewResult struct {
	Artifact AIChatRunArtifact      `json:"artifact"`
	Payload  AIPatchArtifactPayload `json:"payload"`
}

type AIPatchApplyRequest struct {
	ArtifactID string `json:"artifactId"`
}

type AIPatchApplyResult struct {
	ArtifactID    string   `json:"artifactId"`
	Status        string   `json:"status"`
	CheckpointIDs []string `json:"checkpointIds,omitempty"`
	AppliedAt     string   `json:"appliedAt,omitempty"`
	Error         string   `json:"error,omitempty"`
}

type AIPatchRollbackRequest struct {
	CheckpointID string `json:"checkpointId"`
	ArtifactID   string `json:"artifactId,omitempty"`
}

type AIPatchRollbackResult struct {
	CheckpointID  string   `json:"checkpointId"`
	ArtifactID    string   `json:"artifactId,omitempty"`
	CheckpointIDs []string `json:"checkpointIds,omitempty"`
	Path          string   `json:"path"`
	Paths         []string `json:"paths,omitempty"`
	Status        string   `json:"status"`
	RolledBackAt  string   `json:"rolledBackAt"`
}

type AIToolDescriptor struct {
	ID                     string                 `json:"id"`
	Name                   string                 `json:"name"`
	Description            string                 `json:"description"`
	Kind                   AIToolKind             `json:"kind"`
	ExecutionAvailable     bool                   `json:"executionAvailable"`
	DefaultApprovalMode    AIApprovalMode         `json:"defaultApprovalMode"`
	HardDenyCategories     []AIToolHardDenyReason `json:"hardDenyCategories,omitempty"`
	RequiresArtifactReview bool                   `json:"requiresArtifactReview"`
}

type AIToolCallAction string

const (
	AIToolCallActionPreview       AIToolCallAction = "preview"
	AIToolCallActionExecute       AIToolCallAction = "execute"
	AIToolCallActionDeny          AIToolCallAction = "deny"
	AIToolCallActionApproveOnce   AIToolCallAction = "approve_once"
	AIToolCallActionApproveForRun AIToolCallAction = "approve_for_run"
)

type AIToolCallRequest struct {
	RunID       string            `json:"runId,omitempty"`
	RunRevision int64             `json:"runRevision,omitempty"`
	ToolID      string            `json:"toolId"`
	Action      AIToolCallAction  `json:"action"`
	Arguments   map[string]string `json:"arguments,omitempty"`
}

type AIToolAuditRecord struct {
	ID                     string               `json:"id"`
	RunID                  string               `json:"runId,omitempty"`
	ArtifactID             string               `json:"artifactId,omitempty"`
	ToolID                 string               `json:"toolId"`
	Kind                   AIToolKind           `json:"kind"`
	Action                 AIToolCallAction     `json:"action"`
	Status                 string               `json:"status"`
	ScopeSummary           string               `json:"scopeSummary,omitempty"`
	CommandPreview         string               `json:"commandPreview,omitempty"`
	TargetPaths            []string             `json:"targetPaths,omitempty"`
	MCPToolName            string               `json:"mcpToolName,omitempty"`
	ApprovalModeRequired   AIApprovalMode       `json:"approvalModeRequired"`
	AllowedByCurrentPolicy bool                 `json:"allowedByCurrentPolicy"`
	HardDenyReason         AIToolHardDenyReason `json:"hardDenyReason,omitempty"`
	OutputPreview          string               `json:"outputPreview,omitempty"`
	Error                  string               `json:"error,omitempty"`
	CreatedAt              string               `json:"createdAt"`
}

type AIToolCallResult struct {
	ID            string            `json:"id"`
	ToolID        string            `json:"toolId"`
	Kind          AIToolKind        `json:"kind"`
	Action        AIToolCallAction  `json:"action"`
	Status        string            `json:"status"`
	ArtifactID    string            `json:"artifactId,omitempty"`
	OutputPreview string            `json:"outputPreview,omitempty"`
	Arguments     map[string]string `json:"arguments,omitempty"`
	Error         string            `json:"error,omitempty"`
	Audit         AIToolAuditRecord `json:"audit"`
	CreatedAt     string            `json:"createdAt"`
}

type AIToolApprovalGrant struct {
	ID               string     `json:"id"`
	ProjectSessionID string     `json:"projectSessionId,omitempty"`
	RunID            string     `json:"runId,omitempty"`
	ToolID           string     `json:"toolId"`
	Kind             AIToolKind `json:"kind"`
	Scope            string     `json:"scope"`
	ArgumentsHash    string     `json:"argumentsHash"`
	GrantedBy        string     `json:"grantedBy,omitempty"`
	GrantedAt        string     `json:"grantedAt"`
	ExpiresAt        string     `json:"expiresAt,omitempty"`
	UsedAt           string     `json:"usedAt,omitempty"`
}

type AIChatActionDescriptor struct {
	ID                   AIChatAction `json:"id"`
	Name                 string       `json:"name"`
	Description          string       `json:"description"`
	BuiltIn              bool         `json:"builtIn"`
	MayProposeTools      bool         `json:"mayProposeTools"`
	ExpectsToolProposals bool         `json:"expectsToolProposals"`
	ReadOnlyIntent       bool         `json:"readOnlyIntent"`
	ShowPlanStructure    bool         `json:"showPlanStructure"`
	ExecutionUnavailable bool         `json:"executionUnavailable"`
	MutationAllowed      bool         `json:"mutationAllowed"`
	RequiresApproval     bool         `json:"requiresApproval"`
	ToolKinds            []AIToolKind `json:"toolKinds,omitempty"`
	ApprovalBoundary     string       `json:"approvalBoundary,omitempty"`
}

type AIAgentProfileDescriptor struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	BuiltIn     bool         `json:"builtIn"`
	Enabled     bool         `json:"enabled"`
	Action      AIChatAction `json:"action,omitempty"`
	ReadOnly    bool         `json:"readOnly"`
	Approval    string       `json:"approval,omitempty"`
	ToolKinds   []AIToolKind `json:"toolKinds,omitempty"`
}

type AIPromptWorkflowDescriptor struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Slash       string       `json:"slash,omitempty"`
	Action      AIChatAction `json:"action"`
	Description string       `json:"description"`
	BuiltIn     bool         `json:"builtIn"`
	ProfileID   string       `json:"profileId,omitempty"`
	ToolKinds   []AIToolKind `json:"toolKinds,omitempty"`
}

type AIContextProviderDescriptor struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Capability  AIProviderCapability `json:"capability,omitempty"`
	Enabled     bool                 `json:"enabled"`
	Available   bool                 `json:"available"`
	LocalOnly   bool                 `json:"localOnly"`
}

type AIEmbeddingProviderDescriptor struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Local     bool   `json:"local"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

type AIEmbeddingStatus struct {
	Status    string                          `json:"status"`
	Reason    string                          `json:"reason"`
	Providers []AIEmbeddingProviderDescriptor `json:"providers"`
	UpdatedAt string                          `json:"updatedAt"`
}

type AIModelCapabilityDescriptor struct {
	ProviderID              string                 `json:"providerId"`
	ProviderName            string                 `json:"providerName,omitempty"`
	Model                   string                 `json:"model"`
	Local                   bool                   `json:"local"`
	Frontier                bool                   `json:"frontier"`
	ContextWindow           int                    `json:"contextWindow,omitempty"`
	Streaming               bool                   `json:"streaming"`
	Capabilities            []AIProviderCapability `json:"capabilities"`
	ToolSupport             bool                   `json:"toolSupport"`
	ToolSupportKind         string                 `json:"toolSupportKind,omitempty"`
	ToolSupportReason       string                 `json:"toolSupportReason,omitempty"`
	StructuredOutputSupport bool                   `json:"structuredOutputSupport"`
	PatchGenerationSupport  bool                   `json:"patchGenerationSupport"`
	LowLatency              bool                   `json:"lowLatency"`
	CostTier                string                 `json:"costTier,omitempty"`
	CapabilitySource        string                 `json:"capabilitySource,omitempty"`
	ProbeStatus             string                 `json:"probeStatus,omitempty"`
	ProbeCheckedAt          string                 `json:"probeCheckedAt,omitempty"`
	ProbeError              string                 `json:"probeError,omitempty"`
	VerifiedToolSupport     bool                   `json:"verifiedToolSupport,omitempty"`
	VisionSupport           bool                   `json:"visionSupport"`
	CodeEditQuality         string                 `json:"codeEditQuality"`
	RecommendedModes        []AIChatAction         `json:"recommendedModes,omitempty"`
}

type AIModelCapabilityProbeRequest struct {
	ProviderID string `json:"providerId"`
	Model      string `json:"model,omitempty"`
	Force      bool   `json:"force"`
}

type AIModelCapabilityProbeResult struct {
	ProviderID              string `json:"providerId"`
	Model                   string `json:"model"`
	Status                  string `json:"status"`
	ToolSupport             bool   `json:"toolSupport"`
	ToolSupportKind         string `json:"toolSupportKind,omitempty"`
	StructuredOutputSupport bool   `json:"structuredOutputSupport"`
	PatchGenerationSupport  bool   `json:"patchGenerationSupport"`
	LatencyMs               int64  `json:"latencyMs,omitempty"`
	Error                   string `json:"error,omitempty"`
	EgressRecordID          string `json:"egressRecordId,omitempty"`
	CapabilitySource        string `json:"capabilitySource"`
	CheckedAt               string `json:"checkedAt"`
	ExpiresAt               string `json:"expiresAt,omitempty"`
}

type AIBackgroundAgentPreviewRequest struct {
	RunID     string       `json:"runId,omitempty"`
	Prompt    string       `json:"prompt"`
	Action    AIChatAction `json:"action,omitempty"`
	ProfileID string       `json:"profileId,omitempty"`
}

type AIBackgroundAgentPreviewPayload struct {
	Prompt             string           `json:"prompt"`
	Action             AIChatAction     `json:"action,omitempty"`
	ProfileID          string           `json:"profileId,omitempty"`
	ProjectPathHash    string           `json:"projectPathHash,omitempty"`
	ContextSummary     AIContextSummary `json:"contextSummary"`
	IsolatedSnapshot   bool             `json:"isolatedSnapshot"`
	ExecutionAvailable bool             `json:"executionAvailable"`
	Status             string           `json:"status"`
	Logs               []string         `json:"logs,omitempty"`
}

type AIBackgroundAgentPreviewResult struct {
	Artifact AIChatRunArtifact               `json:"artifact"`
	Payload  AIBackgroundAgentPreviewPayload `json:"payload"`
	Status   string                          `json:"status"`
}

type AIChatRunRequest struct {
	SessionID       string           `json:"sessionId,omitempty"`
	Action          AIChatAction     `json:"action"`
	ProfileID       string           `json:"profileId,omitempty"`
	WorkflowID      string           `json:"workflowId,omitempty"`
	Prompt          string           `json:"prompt"`
	RuntimeFamily   string           `json:"runtimeFamily,omitempty"`
	ProviderID      string           `json:"providerId,omitempty"`
	Model           string           `json:"model,omitempty"`
	ReasoningEffort string           `json:"reasoningEffort,omitempty"`
	IncludeMnemonic bool             `json:"includeMnemonic"`
	IncludeMCP      bool             `json:"includeMCP"`
	IncludeSkills   bool             `json:"includeSkills"`
	MaxTokens       int              `json:"maxTokens,omitempty"`
	Context         AIContextRequest `json:"context,omitempty"`
}

type AIContinuationResponse struct {
	RequestID       string            `json:"requestId,omitempty"`
	DocumentVersion string            `json:"documentVersion,omitempty"`
	Text            string            `json:"text"`
	ProviderID      string            `json:"providerId,omitempty"`
	Model           string            `json:"model,omitempty"`
	Context         AIContextSnapshot `json:"context"`
	Egress          *AIEgressRecord   `json:"egress,omitempty"`
}

type AIPredictionMode string

const (
	AIPredictionModeOff    AIPredictionMode = "off"
	AIPredictionModeSubtle AIPredictionMode = "subtle"
	AIPredictionModeEager  AIPredictionMode = "eager"
)

type AIPredictionBudgetSettings struct {
	RequestsPerMinute        int `json:"requestsPerMinute"`
	TokensPerMinute          int `json:"tokensPerMinute"`
	TokensPerDay             int `json:"tokensPerDay"`
	RequestsPerFilePerMinute int `json:"requestsPerFilePerMinute"`
}

type AIPredictionSettings struct {
	Enabled         bool                       `json:"enabled"`
	Mode            AIPredictionMode           `json:"mode"`
	ProviderID      string                     `json:"providerId,omitempty"`
	Model           string                     `json:"model,omitempty"`
	IdleMs          int                        `json:"idleMs"`
	MinIntervalMs   int                        `json:"minIntervalMs"`
	MaxPending      int                        `json:"maxPending"`
	MaxOutputTokens int                        `json:"maxOutputTokens"`
	MaxPromptBytes  int                        `json:"maxPromptBytes"`
	Budget          AIPredictionBudgetSettings `json:"budget"`
}

type AIPredictionBudgetSnapshot struct {
	RequestsThisMinute int    `json:"requestsThisMinute"`
	TokensThisMinute   int    `json:"tokensThisMinute"`
	TokensToday        int    `json:"tokensToday"`
	PendingRequests    int    `json:"pendingRequests"`
	MinIntervalLeftMs  int    `json:"minIntervalLeftMs,omitempty"`
	CooldownUntil      string `json:"cooldownUntil,omitempty"`
	CooldownReason     string `json:"cooldownReason,omitempty"`
	BlockedReason      string `json:"blockedReason,omitempty"`
}

type AIPredictionStatus struct {
	Enabled        bool                       `json:"enabled"`
	Settings       AIPredictionSettings       `json:"settings"`
	ProviderID     string                     `json:"providerId,omitempty"`
	Model          string                     `json:"model,omitempty"`
	ProviderReady  bool                       `json:"providerReady"`
	ProviderReason string                     `json:"providerReason,omitempty"`
	Provider       *AIProviderEnvelope        `json:"provider,omitempty"`
	Budget         AIPredictionBudgetSnapshot `json:"budget"`
	Consent        AIConsentSummary           `json:"consent"`
}

func utcNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}
