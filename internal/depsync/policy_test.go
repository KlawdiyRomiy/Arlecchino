package depsync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildPolicyPlan_AnnotatesActions(t *testing.T) {
	project := t.TempDir()
	writeFile(t, filepath.Join(project, "go.mod"), "module example.com/test\ngo 1.26\n")

	exec := NewExecutor()
	plan, err := exec.BuildPolicyPlan(project, PolicyPlanRequest{Policy: DefaultPolicy()})
	if err != nil {
		t.Fatalf("BuildPolicyPlan failed: %v", err)
	}
	actions := policyPlanActions(plan)
	if len(actions) == 0 {
		t.Fatalf("expected non-empty actions")
	}

	seenLow := false
	seenHigh := false
	for _, action := range actions {
		if action.ID == "" {
			t.Fatalf("action id should not be empty")
		}
		if action.Capability == "" {
			t.Fatalf("action capability should not be empty: %#v", action)
		}
		if action.MutationRisk == "" {
			t.Fatalf("action mutation risk should not be empty: %#v", action)
		}
		if action.MutationRisk == RiskLow {
			seenLow = true
		}
		if action.MutationRisk == RiskHigh {
			seenHigh = true
		}
	}
	if !seenLow || !seenHigh {
		t.Fatalf("expected both low and high risk actions, got low=%v high=%v", seenLow, seenHigh)
	}
}

func TestExecuteWithPolicy_BlocksWithoutConsent(t *testing.T) {
	project := t.TempDir()
	writeFile(t, filepath.Join(project, "go.mod"), "module example.com/test\ngo 1.26\n")

	exec := NewExecutor()
	exec.runner = func(resolvedCommand) ([]byte, error) {
		return []byte("ok"), nil
	}

	result, err := exec.ExecuteWithPolicy(project, ExecuteRequest{
		Policy: Policy{ConsentMode: ConsentModeConfirmEachTime, AutoApproveLowRisk: false},
		DryRun: true,
	})
	if err != nil {
		t.Fatalf("ExecuteWithPolicy failed: %v", err)
	}
	if countPolicyOutcomes(result, OutcomeBlocked) == 0 {
		t.Fatalf("expected blocked actions without approvals")
	}
	if countPolicyOutcomes(result, OutcomePlanned)+countPolicyOutcomes(result, OutcomeCompleted) != 0 {
		t.Fatalf("expected no runnable actions, got %#v", result.Outcomes)
	}
}

func TestExecuteWithPolicy_PersistedApprovalAllowsRerun(t *testing.T) {
	project := t.TempDir()
	writeFile(t, filepath.Join(project, "go.mod"), "module example.com/test\ngo 1.26\n")

	exec := NewExecutor()
	runs := 0
	exec.runner = func(resolvedCommand) ([]byte, error) {
		runs++
		return []byte("ok"), nil
	}

	plan, err := exec.BuildPolicyPlan(project, PolicyPlanRequest{Policy: DefaultPolicy()})
	if err != nil {
		t.Fatalf("BuildPolicyPlan failed: %v", err)
	}
	var highRiskID string
	for _, action := range policyPlanActions(plan) {
		if action.MutationRisk == RiskHigh {
			highRiskID = action.ID
			break
		}
	}
	if highRiskID == "" {
		t.Fatalf("expected at least one high risk action")
	}

	first, err := exec.ExecuteWithPolicy(project, ExecuteRequest{
		Policy:            DefaultPolicy(),
		ApprovedActionIDs: []string{highRiskID},
		PersistApprovals:  true,
		DryRun:            true,
	})
	if err != nil {
		t.Fatalf("first ExecuteWithPolicy failed: %v", err)
	}
	if got := policyOutcomeForAction(first, highRiskID); got == nil || got.Status == OutcomeBlocked {
		t.Fatalf("approved action should not be blocked")
	}

	statePath := filepath.Join(project, ".arlecchino", "dependency-consent.json")
	if _, err := os.Stat(statePath); err != nil {
		t.Fatalf("expected consent state file to be created")
	}

	second, err := exec.ExecuteWithPolicy(project, ExecuteRequest{
		Policy: DefaultPolicy(),
		DryRun: true,
	})
	if err != nil {
		t.Fatalf("second ExecuteWithPolicy failed: %v", err)
	}
	if got := policyOutcomeForAction(second, highRiskID); got == nil || got.Status == OutcomeBlocked {
		t.Fatalf("persisted approval should allow action")
	}
	if runs != 0 {
		t.Fatalf("dry-run should not execute runner")
	}

	ids, err := exec.ListApprovedActions(project)
	if err != nil {
		t.Fatalf("ListApprovedActions failed: %v", err)
	}
	found := false
	for _, id := range ids {
		if strings.TrimSpace(id) == highRiskID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected persisted approval id in list")
	}
}

func policyPlanActions(plan PolicyPlan) []Action {
	actions := make([]Action, 0, len(plan.RunnableActions)+len(plan.UnavailableActions))
	for _, descriptor := range plan.RunnableActions {
		actions = append(actions, descriptor.Action)
	}
	for _, descriptor := range plan.UnavailableActions {
		actions = append(actions, descriptor.Action)
	}
	return actions
}

func countPolicyOutcomes(result ExecuteResult, status OutcomeStatus) int {
	count := 0
	for _, outcome := range result.Outcomes {
		if outcome.Status == status {
			count++
		}
	}
	return count
}

func policyOutcomeForAction(result ExecuteResult, actionID string) *ActionOutcome {
	for i := range result.Outcomes {
		if result.Outcomes[i].ActionID == actionID {
			return &result.Outcomes[i]
		}
	}
	return nil
}
