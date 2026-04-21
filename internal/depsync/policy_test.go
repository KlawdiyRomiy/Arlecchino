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
	plan, err := exec.BuildPolicyPlan(project, DefaultPolicy())
	if err != nil {
		t.Fatalf("BuildPolicyPlan failed: %v", err)
	}
	if len(plan.Actions) == 0 {
		t.Fatalf("expected non-empty actions")
	}

	seenLow := false
	seenHigh := false
	for _, action := range plan.Actions {
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
	exec.runner = func(_ string, _ string, _ ...string) ([]byte, error) {
		return []byte("ok"), nil
	}

	result, err := exec.ExecuteWithPolicy(project, ExecuteRequest{
		Policy: Policy{ConsentMode: ConsentModeConfirmEachTime, AutoApproveLowRisk: false},
		DryRun: true,
	})
	if err != nil {
		t.Fatalf("ExecuteWithPolicy failed: %v", err)
	}
	if len(result.Blocked) == 0 {
		t.Fatalf("expected blocked actions without approvals")
	}
	if len(result.Results) != 0 {
		t.Fatalf("expected no runnable actions, got %d", len(result.Results))
	}
}

func TestExecuteWithPolicy_PersistedApprovalAllowsRerun(t *testing.T) {
	project := t.TempDir()
	writeFile(t, filepath.Join(project, "go.mod"), "module example.com/test\ngo 1.26\n")

	exec := NewExecutor()
	runs := 0
	exec.runner = func(_ string, _ string, _ ...string) ([]byte, error) {
		runs++
		return []byte("ok"), nil
	}

	plan, err := exec.BuildPolicyPlan(project, DefaultPolicy())
	if err != nil {
		t.Fatalf("BuildPolicyPlan failed: %v", err)
	}
	var highRiskID string
	for _, action := range plan.Actions {
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
	if _, blocked := first.Blocked[highRiskID]; blocked {
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
	if _, blocked := second.Blocked[highRiskID]; blocked {
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
