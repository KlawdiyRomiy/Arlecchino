package dispatcher

import "testing"

func TestRouterParse_QuotedAtCommandFallsBackToTerminal(t *testing.T) {
	router := NewRouter(DefaultConfig())
	input := `@"plan" stabilize detector pipeline`
	parsed := router.Parse(input)

	if parsed.Type != InputTypeTerminal {
		t.Fatalf("Type = %v, want %v", parsed.Type, InputTypeTerminal)
	}
	if parsed.Query != input {
		t.Fatalf("Query = %q, want %q", parsed.Query, input)
	}
}

func TestRouterParse_TagCommandStillWorks(t *testing.T) {
	router := NewRouter(DefaultConfig())
	parsed := router.Parse(`@git status`)

	if parsed.Type != InputTypeTagCommand {
		t.Fatalf("Type = %v, want %v", parsed.Type, InputTypeTagCommand)
	}
	if parsed.ExpandedCmd == "" {
		t.Fatal("ExpandedCmd is empty")
	}
}

func TestDispatcherDispatch_QuotedAtCommandFallsBackToTerminal(t *testing.T) {
	dispatcher := New(DefaultConfig())
	input := `@"spawn" codex write tests --task-scope=task:71`
	result := dispatcher.Dispatch(input)

	if !result.Success {
		t.Fatalf("Success = false, error = %q", result.Error)
	}
	if result.ResultType != ResultTypeTerminalOutput {
		t.Fatalf("ResultType = %v, want %v", result.ResultType, ResultTypeTerminalOutput)
	}
	if result.Output != input {
		t.Fatalf("Output = %q, want %q", result.Output, input)
	}
}
