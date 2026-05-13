package ai

import (
	"fmt"
	"strings"
	"time"
)

const (
	fullAccessDefaultTTL = 30 * time.Minute
	fullAccessMaxTTL     = time.Hour
)

func DefaultApprovalPolicy() AIApprovalPolicy {
	return AIApprovalPolicy{
		Mode:               AIApprovalModeAskEachTime,
		AllowedToolKinds:   defaultAllowedToolKinds(),
		HardDenyCategories: defaultHardDenyCategories(),
	}
}

func DefaultConsentPolicy() AIConsentPolicy {
	now := utcNow()
	return AIConsentPolicy{
		LocalProvidersAccepted:    true,
		RemoteProvidersAccepted:   false,
		FrontierProvidersAccepted: false,
		AcceptedAt:                now,
		UpdatedAt:                 now,
	}
}

func (s *Service) GetApprovalPolicy(projectID string) (AIApprovalPolicy, error) {
	project := s.project(projectID)
	if project == nil {
		return AIApprovalPolicy{}, fmt.Errorf("AI project session is not open")
	}
	return s.approvalPolicyForProject(project), nil
}

func (s *Service) SaveApprovalPolicy(projectID string, policy AIApprovalPolicy) (AIApprovalPolicy, error) {
	project := s.project(projectID)
	if project == nil {
		return AIApprovalPolicy{}, fmt.Errorf("AI project session is not open")
	}
	policy.ProjectSessionID = project.ID
	policy.ProjectPathHash = hashProjectPath(project.ProjectRoot)
	policy.Scope = AIApprovalScope{
		ProjectSessionID: policy.ProjectSessionID,
		ProjectPathHash:  policy.ProjectPathHash,
	}
	normalized := normalizeApprovalPolicy(policy)
	normalized.UpdatedAt = utcNow()
	if normalized.Mode == AIApprovalModeFullAccess {
		now := time.Now().UTC()
		normalized.GrantedAt = firstNonEmpty(normalized.GrantedAt, now.Format(time.RFC3339))
		normalized.GrantedBy = firstNonEmpty(normalized.GrantedBy, "user")
		normalized.RevokedAt = ""
		expiresAt, err := parsePolicyTime(normalized.ExpiresAt)
		if err != nil || !expiresAt.After(now) {
			expiresAt = now.Add(fullAccessDefaultTTL)
		}
		if expiresAt.After(now.Add(fullAccessMaxTTL)) {
			expiresAt = now.Add(fullAccessMaxTTL)
		}
		normalized.ExpiresAt = expiresAt.Format(time.RFC3339)
	} else {
		normalized.ExpiresAt = ""
		normalized.GrantedAt = ""
		normalized.GrantedBy = ""
		normalized.RevokedAt = ""
	}
	s.mu.Lock()
	settings := s.settings
	settings.ApprovalPolicy = normalized
	saved, path, err := SaveSettings(s.settingsPath, settings)
	if err != nil {
		s.mu.Unlock()
		return AIApprovalPolicy{}, err
	}
	s.settings = saved
	s.settingsPath = path
	stored := s.settings.ApprovalPolicy
	s.mu.Unlock()
	stored = s.approvalPolicyForProject(project)
	s.emitEvent("ai:approval:policy-updated", stored)
	return stored, nil
}

func (s *Service) RevokeApprovalPolicy(projectID string) (AIApprovalPolicy, error) {
	project := s.project(projectID)
	if project == nil {
		return AIApprovalPolicy{}, fmt.Errorf("AI project session is not open")
	}
	policy := s.approvalPolicyForProject(project)
	policy.Mode = AIApprovalModeAskEachTime
	policy.RevokedAt = utcNow()
	policy.ExpiresAt = ""
	policy.UpdatedAt = policy.RevokedAt
	s.mu.Lock()
	settings := s.settings
	settings.ApprovalPolicy = policy
	saved, path, err := SaveSettings(s.settingsPath, settings)
	if err != nil {
		s.mu.Unlock()
		return AIApprovalPolicy{}, err
	}
	s.settings = saved
	s.settingsPath = path
	stored := s.settings.ApprovalPolicy
	s.mu.Unlock()
	stored = s.approvalPolicyForProject(project)
	s.emitEvent("ai:approval:policy-revoked", stored)
	return stored, nil
}

func (s *Service) GetConsentPolicy() AIConsentPolicy {
	return normalizeConsentPolicy(s.currentSettings().ConsentPolicy)
}

func (s *Service) SaveConsentPolicy(policy AIConsentPolicy) (AIConsentPolicy, error) {
	normalized := normalizeConsentPolicy(policy)
	normalized.UpdatedAt = utcNow()
	if normalized.LocalProvidersAccepted && normalized.AcceptedAt == "" {
		normalized.AcceptedAt = normalized.UpdatedAt
	}
	s.mu.Lock()
	settings := s.settings
	settings.ConsentPolicy = normalized
	saved, path, err := SaveSettings(s.settingsPath, settings)
	if err != nil {
		s.mu.Unlock()
		return AIConsentPolicy{}, err
	}
	s.settings = saved
	s.settingsPath = path
	stored := s.settings.ConsentPolicy
	s.mu.Unlock()
	s.emitEvent("ai:consent:policy-updated", stored)
	return stored, nil
}

func (s *Service) approvalPolicyForProject(project *ProjectSession) AIApprovalPolicy {
	policy := normalizeApprovalPolicy(s.currentSettings().ApprovalPolicy)
	if project == nil {
		return policy
	}
	projectHash := hashProjectPath(project.ProjectRoot)
	if policy.ProjectSessionID != project.ID || policy.ProjectPathHash != projectHash {
		policy = DefaultApprovalPolicy()
	}
	policy.ProjectSessionID = project.ID
	policy.ProjectPathHash = projectHash
	policy.Scope = AIApprovalScope{
		ProjectSessionID: project.ID,
		ProjectPathHash:  projectHash,
	}
	return policy
}

func (s *Service) approvalSummaryForProject(project *ProjectSession) AIApprovalSummary {
	policy := s.approvalPolicyForProject(project)
	fullAccessActive := false
	if policy.Mode == AIApprovalModeFullAccess && policy.RevokedAt == "" {
		if expiresAt, err := parsePolicyTime(policy.ExpiresAt); err == nil && expiresAt.After(time.Now().UTC()) {
			fullAccessActive = true
		}
	}
	return AIApprovalSummary{
		Mode:               policy.Mode,
		FullAccessActive:   fullAccessActive,
		ProjectSessionID:   policy.ProjectSessionID,
		ProjectPathHash:    policy.ProjectPathHash,
		ExpiresAt:          policy.ExpiresAt,
		RevokedAt:          policy.RevokedAt,
		AllowedToolKinds:   policy.AllowedToolKinds,
		HardDenyCategories: policy.HardDenyCategories,
	}
}

func (s *Service) consentSummary() AIConsentSummary {
	policy := normalizeConsentPolicy(s.currentSettings().ConsentPolicy)
	return AIConsentSummary{
		LocalProvidersAccepted:    policy.LocalProvidersAccepted,
		RemoteProvidersAccepted:   policy.RemoteProvidersAccepted,
		FrontierProvidersAccepted: policy.FrontierProvidersAccepted,
		PolicySource:              "user_settings",
	}
}

func normalizeApprovalPolicy(policy AIApprovalPolicy) AIApprovalPolicy {
	switch policy.Mode {
	case AIApprovalModeReadOnlyAllowed, AIApprovalModeFullAccess:
	default:
		policy.Mode = AIApprovalModeAskEachTime
	}
	policy.ProjectSessionID = strings.TrimSpace(firstNonEmpty(policy.ProjectSessionID, policy.Scope.ProjectSessionID))
	policy.ProjectPathHash = strings.TrimSpace(firstNonEmpty(policy.ProjectPathHash, policy.Scope.ProjectPathHash))
	policy.Scope = AIApprovalScope{
		ProjectSessionID: policy.ProjectSessionID,
		ProjectPathHash:  policy.ProjectPathHash,
	}
	policy.ExpiresAt = strings.TrimSpace(policy.ExpiresAt)
	policy.GrantedAt = strings.TrimSpace(policy.GrantedAt)
	policy.GrantedBy = strings.TrimSpace(policy.GrantedBy)
	policy.RevokedAt = strings.TrimSpace(policy.RevokedAt)
	policy.AllowedToolKinds = normalizeToolKinds(policy.AllowedToolKinds)
	policy.HardDenyCategories = normalizeHardDenyCategories(policy.HardDenyCategories)
	if policy.Mode == AIApprovalModeFullAccess && (policy.ProjectSessionID == "" || policy.ProjectPathHash == "") {
		policy.Mode = AIApprovalModeAskEachTime
	}
	return policy
}

func normalizeConsentPolicy(policy AIConsentPolicy) AIConsentPolicy {
	if policy.AcceptedAt == "" && policy.LocalProvidersAccepted {
		policy.AcceptedAt = utcNow()
	}
	if policy.UpdatedAt == "" {
		policy.UpdatedAt = utcNow()
	}
	policy.LocalProvidersAccepted = true
	policy.RemoteProvidersAccepted = false
	policy.FrontierProvidersAccepted = false
	for i := range policy.ProviderPolicies {
		provider := &policy.ProviderPolicies[i]
		provider.ProviderID = strings.TrimSpace(provider.ProviderID)
		provider.ProviderKind = strings.TrimSpace(provider.ProviderKind)
		provider.Endpoint = strings.TrimSpace(provider.Endpoint)
		provider.Model = strings.TrimSpace(provider.Model)
		provider.Allowed = provider.Local && !provider.Frontier
		if provider.UpdatedAt == "" {
			provider.UpdatedAt = policy.UpdatedAt
		}
	}
	return policy
}

func normalizeToolKinds(input []AIToolKind) []AIToolKind {
	if len(input) == 0 {
		return defaultAllowedToolKinds()
	}
	allowed := map[AIToolKind]struct{}{
		AIToolKindContextRead:  {},
		AIToolKindFileWrite:    {},
		AIToolKindTerminal:     {},
		AIToolKindMCP:          {},
		AIToolKindSubagent:     {},
		AIToolKindNetworkLocal: {},
	}
	seen := map[AIToolKind]struct{}{}
	output := []AIToolKind{}
	for _, kind := range input {
		kind = AIToolKind(strings.TrimSpace(string(kind)))
		if _, ok := allowed[kind]; !ok {
			continue
		}
		if _, ok := seen[kind]; ok {
			continue
		}
		seen[kind] = struct{}{}
		output = append(output, kind)
	}
	if len(output) == 0 {
		return defaultAllowedToolKinds()
	}
	return output
}

func normalizeHardDenyCategories(input []AIApprovalHardDeny) []AIApprovalHardDeny {
	seen := map[AIApprovalHardDeny]struct{}{}
	output := []AIApprovalHardDeny{}
	for _, category := range defaultHardDenyCategories() {
		seen[category] = struct{}{}
		output = append(output, category)
	}
	for _, category := range input {
		category = AIApprovalHardDeny(strings.TrimSpace(string(category)))
		if category == "" {
			continue
		}
		if _, ok := seen[category]; ok {
			continue
		}
		seen[category] = struct{}{}
		output = append(output, category)
	}
	return output
}

func defaultAllowedToolKinds() []AIToolKind {
	return []AIToolKind{
		AIToolKindContextRead,
		AIToolKindFileWrite,
		AIToolKindTerminal,
		AIToolKindMCP,
		AIToolKindSubagent,
		AIToolKindNetworkLocal,
	}
}

func defaultHardDenyCategories() []AIApprovalHardDeny {
	return []AIApprovalHardDeny{
		AIApprovalHardDenySecrets,
		AIApprovalHardDenySensitivePaths,
		AIApprovalHardDenyNonLoopbackNetwork,
		AIApprovalHardDenyFrontierCloudEgress,
		AIApprovalHardDenyDestructiveShell,
		AIApprovalHardDenyOutsideProjectWrite,
	}
}

func parsePolicyTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("empty policy time")
	}
	return time.Parse(time.RFC3339, value)
}

func toolKindAllowed(kind AIToolKind, allowed []AIToolKind) bool {
	for _, candidate := range allowed {
		if candidate == kind {
			return true
		}
	}
	return false
}
