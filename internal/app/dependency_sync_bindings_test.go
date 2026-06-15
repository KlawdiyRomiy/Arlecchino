package app

import (
	"reflect"
	"testing"

	"arlecchino/internal/depsync"
)

func TestDependencyOutcomeLanguages_CoversJVMAndDedupes(t *testing.T) {
	outcomes := []depsync.ActionOutcome{
		{
			Status: depsync.OutcomeCompleted,
			Action: depsync.Action{
				Ecosystem: "jvm",
			},
		},
		{
			Status: depsync.OutcomeCompleted,
			Action: depsync.Action{
				Ecosystem: "java",
			},
		},
		{
			Status: depsync.OutcomeFailed,
			Action: depsync.Action{
				Ecosystem: "go",
			},
		},
	}

	got := dependencyOutcomeLanguages(outcomes)
	want := []string{"java", "kotlin", "scala"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("dependencyOutcomeLanguages()=%#v want %#v", got, want)
	}
}

func TestDependencyOutcomeLanguages_EmptyMeansGlobalRefresh(t *testing.T) {
	if got := dependencyOutcomeLanguages(nil); got != nil {
		t.Fatalf("empty outcomes should request manager-wide refresh, got %#v", got)
	}
}
