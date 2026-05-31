package depsync

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type ConsentMode string

const (
	ConsentModeConfirmOncePerProject ConsentMode = "confirm-once-per-project"
	ConsentModeConfirmEachTime       ConsentMode = "confirm-each-time"
	ConsentModeNeverAuto             ConsentMode = "never-auto"
)

type DependencyCapability string

const (
	CapabilityResolveOnly        DependencyCapability = "resolve_only"
	CapabilityDeclareAndLock     DependencyCapability = "declare_and_lock"
	CapabilityDeclareAndInstall  DependencyCapability = "declare_and_install"
	CapabilityInitInfrastructure DependencyCapability = "init_plugins_modules"
)

type MutationRisk string

const (
	RiskLow    MutationRisk = "low"
	RiskMedium MutationRisk = "medium"
	RiskHigh   MutationRisk = "high"
)

type Policy struct {
	ConsentMode        ConsentMode `json:"consentMode"`
	AutoApproveLowRisk bool        `json:"autoApproveLowRisk"`
}

type Action struct {
	ID              string               `json:"id"`
	Ecosystem       string               `json:"ecosystem"`
	Tool            string               `json:"tool"`
	Manifest        string               `json:"manifest"`
	Label           string               `json:"label"`
	Executable      string               `json:"executable"`
	Args            string               `json:"args"`
	Safe            bool                 `json:"safe"`
	Capability      DependencyCapability `json:"capability"`
	MutationRisk    MutationRisk         `json:"mutationRisk"`
	RequiresConsent bool                 `json:"requiresConsent"`
}

type PolicyPlan struct {
	ProjectPath string   `json:"projectPath"`
	Policy      Policy   `json:"policy"`
	Actions     []Action `json:"actions"`
}

type ExecuteRequest struct {
	Policy            Policy   `json:"policy"`
	ApprovedActionIDs []string `json:"approvedActionIds"`
	PersistApprovals  bool     `json:"persistApprovals"`
	DryRun            bool     `json:"dryRun"`
}

type ExecuteResult struct {
	Results map[string]string `json:"results"`
	Blocked map[string]string `json:"blocked"`
}

type consentState struct {
	Approved map[string]bool `json:"approved"`
}

func DefaultPolicy() Policy {
	return Policy{
		ConsentMode:        ConsentModeConfirmOncePerProject,
		AutoApproveLowRisk: true,
	}
}

func normalizePolicy(policy Policy) Policy {
	if policy.ConsentMode == "" {
		policy.ConsentMode = ConsentModeConfirmOncePerProject
	}
	if !policy.AutoApproveLowRisk {
		return policy
	}
	return policy
}

func (e *Executor) BuildPolicyPlan(projectPath string, policy Policy) (PolicyPlan, error) {
	if strings.TrimSpace(projectPath) == "" {
		return PolicyPlan{}, fmt.Errorf("project path is required")
	}
	policy = normalizePolicy(policy)
	managers, err := detectManagers(projectPath, ModeManual)
	if err != nil {
		return PolicyPlan{}, err
	}
	actions := flattenActions(managers)
	for i := range actions {
		actions[i].RequiresConsent = actionRequiresConsent(actions[i], policy)
	}
	return PolicyPlan{ProjectPath: projectPath, Policy: policy, Actions: actions}, nil
}

func (e *Executor) ExecuteWithPolicy(projectPath string, req ExecuteRequest) (ExecuteResult, error) {
	if strings.TrimSpace(projectPath) == "" {
		return ExecuteResult{}, fmt.Errorf("project path is required")
	}
	policy := normalizePolicy(req.Policy)
	plan, err := e.BuildPolicyPlan(projectPath, policy)
	if err != nil {
		return ExecuteResult{}, err
	}

	validActionIDs := make(map[string]bool, len(plan.Actions))
	for _, action := range plan.Actions {
		if id := strings.TrimSpace(action.ID); id != "" {
			validActionIDs[id] = true
		}
	}

	approved := make(map[string]bool, len(req.ApprovedActionIDs))
	for _, id := range req.ApprovedActionIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" && validActionIDs[trimmed] {
			approved[trimmed] = true
		}
	}

	if policy.ConsentMode == ConsentModeConfirmOncePerProject {
		persisted, loadErr := loadConsentState(projectPath)
		if loadErr == nil {
			for id := range persisted.Approved {
				if validActionIDs[id] {
					approved[id] = true
				}
			}
		}
	}

	result := ExecuteResult{
		Results: make(map[string]string, len(plan.Actions)),
		Blocked: make(map[string]string),
	}

	for _, action := range plan.Actions {
		workDir, workDirErr := manifestWorkDir(projectPath, action.Manifest)
		if !canRunAction(action, policy, approved) {
			result.Blocked[action.ID] = "consent required"
			continue
		}

		if req.DryRun {
			result.Results[action.ID] = "planned"
			continue
		}

		if workDirErr != nil {
			result.Results[action.ID] = fmt.Sprintf("skipped: %v", workDirErr)
			continue
		}

		if !commandAvailable(projectPath, workDir, action.Executable) {
			result.Results[action.ID] = fmt.Sprintf("skipped: missing executable %s", action.Executable)
			continue
		}

		out, runErr := e.runner(workDir, action.Executable, splitArgs(action.Args)...)
		result.Results[action.ID] = strings.TrimSpace(string(out))
		if runErr != nil {
			message := fmt.Sprintf("failed: %v", runErr)
			if trimmed := strings.TrimSpace(string(out)); trimmed != "" {
				message += "\n" + trimmed
			}
			result.Results[action.ID] = message
		}
	}

	if req.PersistApprovals && policy.ConsentMode == ConsentModeConfirmOncePerProject && len(approved) > 0 {
		state := consentState{Approved: make(map[string]bool, len(approved))}
		for id := range approved {
			if validActionIDs[id] {
				state.Approved[id] = true
			}
		}
		if saveErr := saveConsentState(projectPath, state); saveErr != nil {
			result.Blocked["consent:persist"] = saveErr.Error()
		}
	}

	return result, nil
}

func (e *Executor) ListApprovedActions(projectPath string) ([]string, error) {
	state, err := loadConsentState(projectPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	ids := make([]string, 0, len(state.Approved))
	for id, approved := range state.Approved {
		if approved {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (e *Executor) ClearApprovedActions(projectPath string) error {
	if strings.TrimSpace(projectPath) == "" {
		return fmt.Errorf("project path is required")
	}
	err := os.Remove(consentStatePath(projectPath))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func flattenActions(managers []Manager) []Action {
	actions := make([]Action, 0, 24)
	for _, manager := range managers {
		for _, cmd := range manager.Commands {
			capability := cmd.Capability
			risk := cmd.MutationRisk
			if capability == "" || risk == "" {
				capability, risk = inferActionMetadata(manager.Ecosystem, cmd)
			}
			id := buildActionID(manager, cmd)
			actions = append(actions, Action{
				ID:           id,
				Ecosystem:    manager.Ecosystem,
				Tool:         manager.Tool,
				Manifest:     manager.Manifest,
				Label:        cmd.Label,
				Executable:   cmd.Executable,
				Args:         cmd.Args,
				Safe:         cmd.Safe,
				Capability:   capability,
				MutationRisk: risk,
			})
		}
	}
	return actions
}

func inferActionMetadata(ecosystem string, cmd Command) (DependencyCapability, MutationRisk) {
	label := strings.ToLower(cmd.Label)
	args := strings.ToLower(cmd.Args)
	if ecosystem == "terraform" || strings.Contains(args, "terraform init") {
		if strings.Contains(args, "-upgrade") || strings.Contains(label, "upgrade") {
			return CapabilityInitInfrastructure, RiskHigh
		}
		return CapabilityInitInfrastructure, RiskMedium
	}
	if strings.Contains(label, "update") || strings.Contains(label, "upgrade") || strings.Contains(args, " -u") || strings.Contains(args, "--upgrade") {
		return CapabilityDeclareAndLock, RiskHigh
	}
	if cmd.Safe {
		return CapabilityResolveOnly, RiskLow
	}
	return CapabilityDeclareAndInstall, RiskMedium
}

func actionRequiresConsent(action Action, policy Policy) bool {
	if policy.ConsentMode == ConsentModeNeverAuto {
		return true
	}
	if action.MutationRisk == RiskLow && policy.AutoApproveLowRisk {
		return false
	}
	return true
}

func canRunAction(action Action, policy Policy, approved map[string]bool) bool {
	if !actionRequiresConsent(action, policy) {
		return true
	}
	return approved[action.ID]
}

func consentStatePath(projectPath string) string {
	return filepath.Join(projectPath, ".arlecchino", "dependency-consent.json")
}

func loadConsentState(projectPath string) (consentState, error) {
	path := consentStatePath(projectPath)
	data, err := os.ReadFile(path)
	if err != nil {
		return consentState{}, err
	}
	if len(data) == 0 {
		return consentState{Approved: make(map[string]bool)}, nil
	}
	var state consentState
	if err := json.Unmarshal(data, &state); err != nil {
		return consentState{}, err
	}
	if state.Approved == nil {
		state.Approved = make(map[string]bool)
	}
	return state, nil
}

func saveConsentState(projectPath string, state consentState) error {
	path := consentStatePath(projectPath)
	if state.Approved == nil {
		state.Approved = make(map[string]bool)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
