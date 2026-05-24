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

func TestRouterParse_AICommandWithoutPrompt(t *testing.T) {
	router := NewRouter(DefaultConfig())
	parsed := router.Parse(`@ai`)

	if parsed.Type != InputTypeAIQuery {
		t.Fatalf("Type = %v, want %v", parsed.Type, InputTypeAIQuery)
	}
	if parsed.Query != "" {
		t.Fatalf("Query = %q, want empty", parsed.Query)
	}
}

func TestRouterParse_GrepQuotePrefixes(t *testing.T) {
	router := NewRouter(DefaultConfig())

	tests := []struct {
		name   string
		input  string
		prefix string
		query  string
	}{
		{name: "double quote", input: `"needle"`, prefix: `"`, query: "needle"},
		{name: "single quote", input: `'needle'`, prefix: `'`, query: "needle"},
		{name: "guillemet", input: `«needle»`, prefix: `«`, query: "needle"},
		{name: "guillemet without closer", input: `«needle`, prefix: `«`, query: "needle"},
		{name: "curly double quote", input: `“needle”`, prefix: `“`, query: "needle"},
		{name: "curly single quote", input: `‘needle’`, prefix: `‘`, query: "needle"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed := router.Parse(tt.input)

			if parsed.Type != InputTypeGrepSearch {
				t.Fatalf("Type = %v, want %v", parsed.Type, InputTypeGrepSearch)
			}
			if parsed.Prefix != tt.prefix {
				t.Fatalf("Prefix = %q, want %q", parsed.Prefix, tt.prefix)
			}
			if parsed.Query != tt.query {
				t.Fatalf("Query = %q, want %q", parsed.Query, tt.query)
			}
		})
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
