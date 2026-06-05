package depsync

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"arlecchino/internal/toolchain"
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

type FlatPolicyPlan struct {
	ProjectPath string   `json:"projectPath"`
	Policy      Policy   `json:"policy"`
	Actions     []Action `json:"actions"`
}

type PolicyPlanRequest struct {
	Policy Policy `json:"policy"`
}

type AvailabilityState string

const (
	AvailabilityRunnable    AvailabilityState = "runnable"
	AvailabilityUnavailable AvailabilityState = "unavailable"
)

type ActionDescriptor struct {
	Action             Action            `json:"action"`
	ManifestDir        string            `json:"manifestDir"`
	AvailabilityState  AvailabilityState `json:"availabilityState"`
	AvailabilityReason string            `json:"availabilityReason,omitempty"`
	RequiresConsent    bool              `json:"requiresConsent"`
	ApprovalEligible   bool              `json:"approvalEligible"`
}

type PolicyPlan struct {
	ProjectPath         string             `json:"projectPath"`
	Policy              Policy             `json:"policy"`
	RunnableActions     []ActionDescriptor `json:"runnableActions"`
	UnavailableActions  []ActionDescriptor `json:"unavailableActions"`
	DiscoveryWarnings   []string           `json:"discoveryWarnings,omitempty"`
	DiscoveryIncomplete bool               `json:"discoveryIncomplete"`
}

type ExecuteRequest struct {
	Policy            Policy   `json:"policy"`
	ApprovedActionIDs []string `json:"approvedActionIds"`
	PersistApprovals  bool     `json:"persistApprovals"`
	DryRun            bool     `json:"dryRun"`
}

type FlatExecuteResult struct {
	Results map[string]string `json:"results"`
	Blocked map[string]string `json:"blocked"`
}

type OutcomeStatus string

const (
	OutcomeCompleted   OutcomeStatus = "completed"
	OutcomeFailed      OutcomeStatus = "failed"
	OutcomeBlocked     OutcomeStatus = "blocked"
	OutcomeUnavailable OutcomeStatus = "unavailable"
	OutcomePlanned     OutcomeStatus = "planned"
)

type ActionOutcome struct {
	ActionID string        `json:"actionId"`
	Action   Action        `json:"action"`
	Status   OutcomeStatus `json:"status"`
	Message  string        `json:"message"`
}

type ExecuteResult struct {
	Outcomes []ActionOutcome `json:"outcomes"`
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

func (e *Executor) BuildFlatPolicyPlan(projectPath string, policy Policy) (FlatPolicyPlan, error) {
	if strings.TrimSpace(projectPath) == "" {
		return FlatPolicyPlan{}, fmt.Errorf("project path is required")
	}
	policy = normalizePolicy(policy)
	managers, err := detectManagers(projectPath, ModeManual)
	if err != nil {
		return FlatPolicyPlan{}, err
	}
	actions := flattenActions(managers)
	for i := range actions {
		actions[i].RequiresConsent = actionRequiresConsent(actions[i], policy)
	}
	return FlatPolicyPlan{ProjectPath: projectPath, Policy: policy, Actions: actions}, nil
}

func (e *Executor) BuildPolicyPlan(projectPath string, req PolicyPlanRequest) (PolicyPlan, error) {
	if strings.TrimSpace(projectPath) == "" {
		return PolicyPlan{}, fmt.Errorf("project path is required")
	}
	policy := normalizePolicy(req.Policy)
	managers, discovery, err := detectManagersWithReport(projectPath, ModeManual)
	if err != nil {
		return PolicyPlan{}, err
	}
	actions := flattenActions(managers)

	plan := PolicyPlan{
		ProjectPath:         projectPath,
		Policy:              policy,
		DiscoveryWarnings:   append([]string(nil), discovery.Warnings...),
		DiscoveryIncomplete: discovery.Incomplete,
	}

	for _, action := range actions {
		descriptor := e.actionDescriptor(projectPath, action, policy)
		if descriptor.AvailabilityState == AvailabilityRunnable {
			plan.RunnableActions = append(plan.RunnableActions, descriptor)
		} else {
			plan.UnavailableActions = append(plan.UnavailableActions, descriptor)
		}
	}

	return plan, nil
}

func (e *Executor) actionDescriptor(projectPath string, action Action, policy Policy) ActionDescriptor {
	action.RequiresConsent = actionRequiresConsent(action, policy)
	descriptor := ActionDescriptor{
		Action:            action,
		AvailabilityState: AvailabilityRunnable,
		RequiresConsent:   action.RequiresConsent,
		ApprovalEligible:  action.RequiresConsent,
	}

	workDir, err := manifestWorkDir(projectPath, action.Manifest)
	if err != nil {
		descriptor.AvailabilityState = AvailabilityUnavailable
		descriptor.AvailabilityReason = err.Error()
		descriptor.ApprovalEligible = false
		return descriptor
	}
	if rel, relErr := filepath.Rel(filepath.Clean(projectPath), workDir); relErr == nil {
		rel = filepath.ToSlash(filepath.Clean(rel))
		if rel == "." {
			descriptor.ManifestDir = "."
		} else {
			descriptor.ManifestDir = rel
		}
	}
	if descriptor.ManifestDir == "" {
		descriptor.ManifestDir = filepath.ToSlash(filepath.Dir(filepath.FromSlash(action.Manifest)))
		if descriptor.ManifestDir == "." || descriptor.ManifestDir == "" {
			descriptor.ManifestDir = "."
		}
	}

	if reason := commandAvailability(projectPath, workDir, action.Executable); reason != "" {
		descriptor.AvailabilityState = AvailabilityUnavailable
		descriptor.AvailabilityReason = reason
		descriptor.ApprovalEligible = false
		return descriptor
	}

	return descriptor
}

func (e *Executor) ExecuteWithFlatPolicy(projectPath string, req ExecuteRequest) (FlatExecuteResult, error) {
	if strings.TrimSpace(projectPath) == "" {
		return FlatExecuteResult{}, fmt.Errorf("project path is required")
	}
	policy := normalizePolicy(req.Policy)
	plan, err := e.BuildFlatPolicyPlan(projectPath, policy)
	if err != nil {
		return FlatExecuteResult{}, err
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

	result := FlatExecuteResult{
		Results: make(map[string]string, len(plan.Actions)),
		Blocked: make(map[string]string),
	}
	failedUpdateGroups := make(map[string]bool)

	for _, action := range plan.Actions {
		workDir, workDirErr := manifestWorkDir(projectPath, action.Manifest)
		groupKey := followUpActionGroup(action.Ecosystem, action.Manifest, action.Executable)
		if shouldSkipAfterFailedUpdate(action.Ecosystem, action.Label, failedUpdateGroups[groupKey]) {
			result.Results[action.ID] = "skipped: previous update failed"
			continue
		}
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

		resolution := commandResolution(projectPath, workDir, action.Executable)
		if !resolution.Available() {
			result.Results[action.ID] = "skipped: " + resolution.Reason
			continue
		}

		out, runErr := e.runner(resolvedCommand{
			dir:        workDir,
			executable: resolution.Path,
			args:       splitArgs(action.Args),
			env:        toolchain.CommandEnv(resolution),
		})
		result.Results[action.ID] = strings.TrimSpace(string(out))
		if runErr != nil {
			message := fmt.Sprintf("failed: %v", runErr)
			if trimmed := strings.TrimSpace(string(out)); trimmed != "" {
				message += "\n" + trimmed
			}
			result.Results[action.ID] = message
			if isUpdatePrerequisiteAction(action.Ecosystem, action.Label) {
				failedUpdateGroups[groupKey] = true
			}
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

func (e *Executor) ExecuteWithPolicy(projectPath string, req ExecuteRequest) (ExecuteResult, error) {
	if strings.TrimSpace(projectPath) == "" {
		return ExecuteResult{}, fmt.Errorf("project path is required")
	}
	policy := normalizePolicy(req.Policy)
	plan, err := e.BuildPolicyPlan(projectPath, PolicyPlanRequest{Policy: policy})
	if err != nil {
		return ExecuteResult{}, err
	}

	validRunnableIDs := make(map[string]bool, len(plan.RunnableActions))
	for _, descriptor := range plan.RunnableActions {
		if id := strings.TrimSpace(descriptor.Action.ID); id != "" {
			validRunnableIDs[id] = true
		}
	}

	approved := make(map[string]bool, len(req.ApprovedActionIDs))
	for _, id := range req.ApprovedActionIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" && validRunnableIDs[trimmed] {
			approved[trimmed] = true
		}
	}

	if policy.ConsentMode == ConsentModeConfirmOncePerProject {
		persisted, loadErr := loadConsentState(projectPath)
		if loadErr == nil {
			for id := range persisted.Approved {
				if validRunnableIDs[id] {
					approved[id] = true
				}
			}
		}
	}

	result := ExecuteResult{
		Outcomes: make([]ActionOutcome, 0, len(plan.RunnableActions)+len(plan.UnavailableActions)),
	}
	failedUpdateGroups := make(map[string]bool)

	for _, descriptor := range plan.RunnableActions {
		action := descriptor.Action
		outcome := ActionOutcome{ActionID: action.ID, Action: action}
		groupKey := followUpActionGroup(action.Ecosystem, action.Manifest, action.Executable)
		if shouldSkipAfterFailedUpdate(action.Ecosystem, action.Label, failedUpdateGroups[groupKey]) {
			outcome.Status = OutcomeBlocked
			outcome.Message = "skipped: previous update failed"
			result.Outcomes = append(result.Outcomes, outcome)
			continue
		}
		if !canRunAction(action, policy, approved) {
			outcome.Status = OutcomeBlocked
			outcome.Message = "consent required"
			result.Outcomes = append(result.Outcomes, outcome)
			continue
		}

		if req.DryRun {
			outcome.Status = OutcomePlanned
			outcome.Message = "planned"
			result.Outcomes = append(result.Outcomes, outcome)
			continue
		}

		workDir, workDirErr := manifestWorkDir(projectPath, action.Manifest)
		if workDirErr != nil {
			outcome.Status = OutcomeUnavailable
			outcome.Message = workDirErr.Error()
			result.Outcomes = append(result.Outcomes, outcome)
			continue
		}
		resolution := commandResolution(projectPath, workDir, action.Executable)
		if reason := resolution.Reason; reason != "" {
			outcome.Status = OutcomeUnavailable
			outcome.Message = reason
			result.Outcomes = append(result.Outcomes, outcome)
			continue
		}

		out, runErr := e.runner(resolvedCommand{
			dir:        workDir,
			executable: resolution.Path,
			args:       splitArgs(action.Args),
			env:        toolchain.CommandEnv(resolution),
		})
		message := strings.TrimSpace(string(out))
		if runErr != nil {
			outcome.Status = OutcomeFailed
			outcome.Message = fmt.Sprintf("failed: %v", runErr)
			if message != "" {
				outcome.Message += "\n" + message
			}
			result.Outcomes = append(result.Outcomes, outcome)
			if isUpdatePrerequisiteAction(action.Ecosystem, action.Label) {
				failedUpdateGroups[groupKey] = true
			}
			continue
		}
		outcome.Status = OutcomeCompleted
		if message == "" {
			message = "completed"
		}
		outcome.Message = message
		result.Outcomes = append(result.Outcomes, outcome)
	}

	for _, descriptor := range plan.UnavailableActions {
		result.Outcomes = append(result.Outcomes, ActionOutcome{
			ActionID: descriptor.Action.ID,
			Action:   descriptor.Action,
			Status:   OutcomeUnavailable,
			Message:  descriptor.AvailabilityReason,
		})
	}

	if req.PersistApprovals && policy.ConsentMode == ConsentModeConfirmOncePerProject && len(approved) > 0 {
		state := consentState{Approved: make(map[string]bool, len(approved))}
		for id := range approved {
			if validRunnableIDs[id] {
				state.Approved[id] = true
			}
		}
		if saveErr := saveConsentState(projectPath, state); saveErr != nil {
			result.Outcomes = append(result.Outcomes, ActionOutcome{
				ActionID: "consent:persist",
				Status:   OutcomeBlocked,
				Message:  saveErr.Error(),
			})
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
			cmd.Capability = capability
			cmd.MutationRisk = risk
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
