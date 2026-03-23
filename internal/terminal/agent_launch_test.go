package terminal

import (
	"testing"
	"time"
)

func TestIsAgentLaunchCommand(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{name: "opencode", input: "opencode", want: true},
		{name: "opencode with args", input: "opencode --model claude-opus-4.6", want: true},
		{name: "absolute path", input: "/usr/local/bin/opencode", want: true},
		{name: "wrapped by env", input: "env FOO=1 opencode", want: true},
		{name: "claude", input: "claude", want: true},
		{name: "codex", input: "codex --help", want: true},
		{name: "aider", input: "aider .", want: true},
		{name: "agenthub", input: "agenthub", want: true},
		{name: "wrapped by command", input: "command agenthub --mode orchestrator", want: true},
		{name: "wrapped by nohup", input: "nohup agenthub --profile default", want: true},
		{name: "qwen code", input: "qwen-code --unsafe-mode", want: true},
		{name: "gemini cli", input: "gemini-cli", want: true},
		{name: "copilot", input: "copilot --help", want: true},
		{name: "non agent command", input: "npm run dev", want: false},
		{name: "editor command", input: "vim main.go", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsAgentLaunchCommand(tt.input)
			if got != tt.want {
				t.Fatalf("IsAgentLaunchCommand(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsPreviewCandidateCommand(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{name: "npm run dev", input: "npm run dev", want: true},
		{name: "npm preview", input: "npm preview", want: true},
		{name: "pnpm dev", input: "pnpm dev", want: true},
		{name: "yarn dev", input: "yarn dev", want: true},
		{name: "bun run dev", input: "bun run dev", want: true},
		{name: "vite bare", input: "vite", want: true},
		{name: "vite preview", input: "vite preview --host", want: true},
		{name: "vite build", input: "vite build", want: false},
		{name: "npx vite", input: "npx vite --host", want: true},
		{name: "next dev", input: "next dev", want: true},
		{name: "next build", input: "next build", want: false},
		{name: "artisan serve", input: "php artisan serve", want: true},
		{name: "python http server", input: "python -m http.server 8000", want: true},
		{name: "python http server without module flag", input: "python http.server 8000", want: false},
		{name: "python other module", input: "python -m pytest", want: false},
		{name: "agent cli is not preview candidate", input: "opencode", want: false},
		{name: "npm install", input: "npm install", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsPreviewCandidateCommand(tt.input)
			if got != tt.want {
				t.Fatalf("IsPreviewCandidateCommand(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestSessionReserveAgentGuideInjectionForInput_OnAgentEnter(t *testing.T) {
	session := &Session{}

	if session.ReserveAgentGuideInjectionForInput([]byte("opencode")) {
		t.Fatalf("typing command without enter should not reserve injection")
	}

	if !session.ReserveAgentGuideInjectionForInput([]byte("\r")) {
		t.Fatalf("enter on agent launch command should reserve injection")
	}
}

func TestSessionReserveAgentGuideInjectionForInput_DeduplicatesUntilShellReset(t *testing.T) {
	session := &Session{}

	session.ReserveAgentGuideInjectionForInput([]byte("opencode"))
	if !session.ReserveAgentGuideInjectionForInput([]byte("\r")) {
		t.Fatalf("first agent launch should reserve injection")
	}

	session.ReserveAgentGuideInjectionForInput([]byte("claude"))
	if session.ReserveAgentGuideInjectionForInput([]byte("\r")) {
		t.Fatalf("second launch without shell reset should be deduplicated")
	}

	session.resetAgentGuideInjection(TUIModeEvent{Mode: TerminalModeShell, Active: false, Reason: "shell"})

	session.ReserveAgentGuideInjectionForInput([]byte("claude"))
	if !session.ReserveAgentGuideInjectionForInput([]byte("\r")) {
		t.Fatalf("agent launch after shell reset should reserve injection")
	}
}

func TestSessionTrackAgentLaunchForInput_ActivatesTUIModeOnEnter(t *testing.T) {
	session := &Session{}

	shouldReserve, shouldActivate := session.TrackAgentLaunchForInput([]byte("opencode"), false)
	if shouldReserve {
		t.Fatalf("typing command without enter should not reserve guide injection")
	}
	if shouldActivate {
		t.Fatalf("typing command without enter should not activate tui mode")
	}

	shouldReserve, shouldActivate = session.TrackAgentLaunchForInput([]byte("\r"), false)
	if shouldReserve {
		t.Fatalf("guide injection should stay disabled when reserve flag is false")
	}
	if !shouldActivate {
		t.Fatalf("agent launch enter should activate tui mode fallback")
	}
}

func TestSessionTrackAgentLaunchForInput_DeduplicatesGuideButKeepsTUIActivation(t *testing.T) {
	session := &Session{}

	firstReserve, firstActivate := session.TrackAgentLaunchForInput([]byte("opencode\r"), true)
	if !firstReserve {
		t.Fatalf("first agent launch should reserve guide injection")
	}
	if !firstActivate {
		t.Fatalf("first agent launch should activate tui mode fallback")
	}

	secondReserve, secondActivate := session.TrackAgentLaunchForInput([]byte("claude\r"), true)
	if secondReserve {
		t.Fatalf("second launch without shell reset should not reserve guide injection")
	}
	if !secondActivate {
		t.Fatalf("second launch should still activate tui mode fallback")
	}
}

func TestSessionTrackAgentLaunchForInput_MarksPreviewCandidateOnEnter(t *testing.T) {
	session := &Session{}

	_, shouldActivate := session.TrackAgentLaunchForInput([]byte("npm run dev"), false)
	if shouldActivate {
		t.Fatalf("preview candidate typing should not activate agent tui mode")
	}
	if !session.previewCandidateUntil.IsZero() {
		t.Fatalf("preview candidate should not activate before enter")
	}

	session.TrackAgentLaunchForInput([]byte("\r"), false)
	if session.previewCandidateUntil.IsZero() {
		t.Fatalf("preview candidate should be activated after enter")
	}
	if !session.previewCandidateUntil.After(time.Now()) {
		t.Fatalf("preview candidate deadline should be in the future")
	}
}

func TestSessionResetAgentGuideInjection_ClearsPreviewCandidateState(t *testing.T) {
	session := &Session{previewCandidateUntil: time.Now().Add(time.Minute)}

	session.resetAgentGuideInjection(TUIModeEvent{Mode: TerminalModeShell, Active: false, Reason: "shell"})

	if !session.previewCandidateUntil.IsZero() {
		t.Fatalf("preview candidate deadline should be cleared on shell reset")
	}
}

func TestSessionFilterSemanticEvent_PreviewURLRequiresCandidateWindow(t *testing.T) {
	session := &Session{}
	event := SemanticEvent{Kind: "preview_url", Message: "http://localhost:3000", source: semanticSourceText}

	if _, ok := session.filterSemanticEvent(event, time.Now()); ok {
		t.Fatalf("plain preview_url should be ignored without preview candidate window")
	}

	session.previewCandidateUntil = time.Now().Add(time.Minute)
	filtered, ok := session.filterSemanticEvent(event, time.Now())
	if !ok {
		t.Fatalf("plain preview_url should pass inside preview candidate window")
	}
	if filtered.Message != event.Message {
		t.Fatalf("filtered preview_url message = %q, want %q", filtered.Message, event.Message)
	}

	session.previewCandidateUntil = time.Now().Add(-time.Second)
	if _, ok := session.filterSemanticEvent(event, time.Now()); ok {
		t.Fatalf("plain preview_url should be ignored after preview candidate expires")
	}
	if _, ok := session.filterSemanticEvent(
		SemanticEvent{Kind: "preview_url", Message: "http://localhost:4000", source: semanticSourceOSC},
		time.Now(),
	); !ok {
		t.Fatalf("OSC preview_url should bypass preview candidate gating")
	}
	if _, ok := session.filterSemanticEvent(
		SemanticEvent{Kind: "trigger", Message: "error", source: semanticSourceText},
		time.Now(),
	); !ok {
		t.Fatalf("non-preview semantic events should always pass through")
	}
}
