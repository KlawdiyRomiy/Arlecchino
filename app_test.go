package main

import "testing"

func TestEnvFlagEnabled(t *testing.T) {
	t.Setenv("ARLECCHINO_TEST_FLAG", "true")
	if !envFlagEnabled("ARLECCHINO_TEST_FLAG") {
		t.Fatalf("envFlagEnabled(true) = false, want true")
	}

	t.Setenv("ARLECCHINO_TEST_FLAG", "  ON ")
	if !envFlagEnabled("ARLECCHINO_TEST_FLAG") {
		t.Fatalf("envFlagEnabled(ON) = false, want true")
	}

	t.Setenv("ARLECCHINO_TEST_FLAG", "0")
	if envFlagEnabled("ARLECCHINO_TEST_FLAG") {
		t.Fatalf("envFlagEnabled(0) = true, want false")
	}
}
