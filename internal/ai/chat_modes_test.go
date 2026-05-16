package ai

import (
	"context"
	"strings"
	"sync"
	"testing"

	"arlecchino/internal/ai/providers"
)

type recordingChatProvider struct {
	mu           sync.Mutex
	descriptor   providers.AIProviderDescriptor
	text         string
	streamChunks []string
	calls        int
	requests     []providers.GenerationRequest
}

func (p *recordingChatProvider) Descriptor() providers.AIProviderDescriptor {
	return p.descriptor
}

func (p *recordingChatProvider) ListModels(context.Context) ([]providers.AIModelDescriptor, error) {
	return p.descriptor.Models, nil
}

func (p *recordingChatProvider) HealthCheck(context.Context) providers.AIProviderDescriptor {
	descriptor := p.descriptor
	descriptor.Status = providers.ProviderStatusReady
	return descriptor
}

func (p *recordingChatProvider) Generate(_ context.Context, req providers.GenerationRequest, sink providers.TokenSink) (providers.GenerationResponse, error) {
	p.mu.Lock()
	p.calls++
	p.requests = append(p.requests, req)
	p.mu.Unlock()

	text := p.text
	if len(p.streamChunks) > 0 {
		text = strings.Join(p.streamChunks, "")
	}
	if sink != nil {
		if len(p.streamChunks) > 0 {
			for _, chunk := range p.streamChunks {
				if err := sink(chunk); err != nil {
					return providers.GenerationResponse{Text: text, Model: p.descriptor.DefaultModel}, err
				}
			}
		} else if err := sink(text); err != nil {
			return providers.GenerationResponse{Text: text, Model: p.descriptor.DefaultModel}, err
		}
	}
	return providers.GenerationResponse{Text: text, Model: p.descriptor.DefaultModel}, nil
}

func (p *recordingChatProvider) callCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

func (p *recordingChatProvider) requestAt(index int) providers.GenerationRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.requests[index]
}

type chatPayloadEventLog struct {
	mu     sync.Mutex
	names  []string
	tokens []string
}

func (l *chatPayloadEventLog) emit(name string, payload any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.names = append(l.names, name)
	if name != "ai:chat:token" {
		return
	}
	if data, ok := payload.(map[string]any); ok {
		if token, ok := data["token"].(string); ok {
			l.tokens = append(l.tokens, token)
		}
	}
}

func (l *chatPayloadEventLog) tokenText() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.tokens, "")
}

func replaceLocalProviderWithRecorder(t *testing.T, service *Service, text string, streamChunks []string) *recordingChatProvider {
	t.Helper()
	descriptor := service.descriptors["local-test"]
	provider := &recordingChatProvider{
		descriptor:   descriptor,
		text:         text,
		streamChunks: streamChunks,
	}
	service.providers[descriptor.ID] = provider
	return provider
}

func TestSmallTalkBuildAndDebugDoNotAttachToolProposals(t *testing.T) {
	for _, action := range []AIChatAction{AIChatActionBuild, AIChatActionDebug} {
		t.Run(string(action), func(t *testing.T) {
			service := newTestService(t, nil)
			provider := replaceLocalProviderWithRecorder(t, service, "generated output", nil)
			if _, err := service.OpenProject("main", t.TempDir()); err != nil {
				t.Fatalf("OpenProject: %v", err)
			}
			run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
				Action: action,
				Prompt: "Привет",
			})
			if err != nil {
				t.Fatalf("StartChatRun: %v", err)
			}
			final := waitForRunStatus(t, service, run.ID)
			if final.Status != "completed" {
				t.Fatalf("final run = %#v", final)
			}
			if provider.callCount() != 0 {
				t.Fatalf("small talk should not call provider, calls = %d", provider.callCount())
			}
			if len(final.ToolProposals) != 0 {
				t.Fatalf("small talk should not expose tool proposals: %#v", final.ToolProposals)
			}
			envelope, err := service.GetChatRunEnvelope("main", run.ID)
			if err != nil {
				t.Fatalf("GetChatRunEnvelope: %v", err)
			}
			if len(envelope.ToolProposals) != 0 || envelope.ToolProposalSummary.Total != 0 {
				t.Fatalf("small talk envelope should not expose tool proposals: %#v", envelope)
			}
		})
	}
}

func TestPreflightChatPromptsDoNotCallProviderOrAttachTools(t *testing.T) {
	cases := []struct {
		name string
		req  AIChatRunRequest
		want string
	}{
		{
			name: "plan-label",
			req:  AIChatRunRequest{Action: AIChatActionPlan, Prompt: "План?"},
			want: "Сейчас выбран режим Plan.",
		},
		{
			name: "build-label",
			req:  AIChatRunRequest{Action: AIChatActionBuild, Prompt: "Билд?"},
			want: "Сейчас выбран режим Build.",
		},
		{
			name: "debug-label",
			req:  AIChatRunRequest{Action: AIChatActionDebug, Prompt: "Дебаг?"},
			want: "Сейчас выбран режим Debug.",
		},
		{
			name: "ambiguous-short",
			req:  AIChatRunRequest{Action: AIChatActionBuild, Prompt: "Чего?"},
			want: "Уточни, что нужно",
		},
		{
			name: "small-talk",
			req:  AIChatRunRequest{Action: AIChatActionBuild, Prompt: "Привет"},
			want: "Привет. Чем помочь?",
		},
		{
			name: "runtime-state",
			req:  AIChatRunRequest{Action: AIChatActionDebug, Prompt: "В каком ты щас режиме?"},
			want: "Сейчас я работаю в режиме Debug.",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			events := &chatPayloadEventLog{}
			service := newTestService(t, events.emit)
			provider := replaceLocalProviderWithRecorder(t, service, "provider output", nil)
			if _, err := service.OpenProject("main", t.TempDir()); err != nil {
				t.Fatalf("OpenProject: %v", err)
			}
			run, err := service.StartChatRun(context.Background(), "main", tc.req)
			if err != nil {
				t.Fatalf("StartChatRun: %v", err)
			}
			final := waitForRunStatus(t, service, run.ID)
			if final.Status != "completed" {
				t.Fatalf("final run = %#v", final)
			}
			if !strings.Contains(final.Response, tc.want) {
				t.Fatalf("response = %q, want to contain %q", final.Response, tc.want)
			}
			if provider.callCount() != 0 {
				t.Fatalf("preflight prompt should not call provider, calls = %d", provider.callCount())
			}
			if final.EgressRecordID != "" {
				t.Fatalf("preflight prompt should not create egress record: %#v", final)
			}
			if final.ContextSummary != nil {
				t.Fatalf("preflight prompt should not build context: %#v", final.ContextSummary)
			}
			if len(final.ToolProposals) != 0 {
				t.Fatalf("preflight prompt should not expose tool proposals: %#v", final.ToolProposals)
			}
			if events.tokenText() != "" {
				t.Fatalf("preflight prompt should not stream tokens: %q", events.tokenText())
			}
		})
	}
}

func TestConcreteBuildAndDebugPromptsStillUseProviderAndProposals(t *testing.T) {
	for _, action := range []AIChatAction{AIChatActionBuild, AIChatActionDebug} {
		t.Run(string(action), func(t *testing.T) {
			service := newTestService(t, nil)
			provider := replaceLocalProviderWithRecorder(t, service, "concrete response", nil)
			if _, err := service.OpenProject("main", t.TempDir()); err != nil {
				t.Fatalf("OpenProject: %v", err)
			}
			prompt := "Добавь обработку Escape в dropdown настроек."
			if action == AIChatActionDebug {
				prompt = "Почему диагностика показывает ошибку panic в indexer?"
			}
			run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
				Action: action,
				Prompt: prompt,
			})
			if err != nil {
				t.Fatalf("StartChatRun: %v", err)
			}
			final := waitForRunStatus(t, service, run.ID)
			if final.Status != "completed" {
				t.Fatalf("final run = %#v", final)
			}
			if provider.callCount() != 1 {
				t.Fatalf("concrete prompt should call provider once, calls = %d", provider.callCount())
			}
			if len(final.ToolProposals) == 0 {
				t.Fatalf("concrete %s prompt should expose reviewable proposals", action)
			}
			request := provider.requestAt(0)
			if strings.Contains(strings.ToLower(request.Prompt), "user intent:") {
				t.Fatalf("chat provider prompt should not contain User intent label: %q", request.Prompt)
			}
			for _, stop := range request.Stop {
				if strings.Contains(strings.ToLower(stop), "user intent") {
					t.Fatalf("chat stop sequences should not contain User intent: %#v", request.Stop)
				}
			}
		})
	}
}

func TestModeSystemPromptsShareIdentityAndSmallTalkBoundary(t *testing.T) {
	for _, action := range []AIChatAction{
		AIChatActionAsk,
		AIChatActionPlan,
		AIChatActionBuild,
		AIChatActionDebug,
	} {
		prompt := systemPromptForAction(action)
		for _, want := range []string{
			"same identity across Ask, Plan, Build, and Debug",
			"Match the user's language",
			"only a greeting",
		} {
			if !strings.Contains(prompt, want) {
				t.Fatalf("%s prompt missing %q: %s", action, want, prompt)
			}
		}
	}
}

func TestProviderInternalEchoIsSanitized(t *testing.T) {
	req := AIChatRunRequest{
		Action: AIChatActionBuild,
		Prompt: "Добавь обработку Escape в dropdown настроек.",
	}
	systemEcho := systemPromptForAction(req.Action) + "\n" + chatModeBoundaryPrompt(req)
	for _, tc := range []struct {
		name string
		text string
	}{
		{name: "system", text: systemEcho},
		{name: "prompt-label", text: "Request:\n" + req.Prompt},
		{name: "exact-user-prompt", text: req.Prompt},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := newTestService(t, nil)
			replaceLocalProviderWithRecorder(t, service, tc.text, nil)
			if _, err := service.OpenProject("main", t.TempDir()); err != nil {
				t.Fatalf("OpenProject: %v", err)
			}
			run, err := service.StartChatRun(context.Background(), "main", req)
			if err != nil {
				t.Fatalf("StartChatRun: %v", err)
			}
			final := waitForRunStatus(t, service, run.ID)
			if final.Status != "completed" {
				t.Fatalf("final run = %#v", final)
			}
			for _, forbidden := range []string{
				"You are Arlecchino",
				"Mode boundary:",
				"Request:",
				req.Prompt,
			} {
				if strings.Contains(final.Response, forbidden) {
					t.Fatalf("response leaked %q: %q", forbidden, final.Response)
				}
			}
			if strings.TrimSpace(final.Response) == "" {
				t.Fatalf("sanitized echo should return fallback response")
			}
		})
	}
}

func TestLoadedChatRunInternalEchoIsSanitized(t *testing.T) {
	req := AIChatRunRequest{
		Action: AIChatActionDebug,
		Prompt: "Почему диагностика показывает panic?",
	}
	run := normalizeChatRunForDisplay(AIChatRun{
		Action:     req.Action,
		UserPrompt: req.Prompt,
		Response:   systemPromptForAction(req.Action) + "\n" + chatModeBoundaryPrompt(req),
	})
	if strings.Contains(run.Response, "You are Arlecchino") || strings.Contains(run.Response, "Mode boundary:") {
		t.Fatalf("loaded run leaked internal prompt echo: %q", run.Response)
	}
	if strings.TrimSpace(run.Response) == "" {
		t.Fatalf("loaded internal prompt echo should return fallback response")
	}
}

func TestStreamingInternalEchoDoesNotEmitTokenEvents(t *testing.T) {
	events := &chatPayloadEventLog{}
	service := newTestService(t, events.emit)
	req := AIChatRunRequest{
		Action: AIChatActionBuild,
		Prompt: "Добавь обработку Escape в dropdown настроек.",
	}
	replaceLocalProviderWithRecorder(t, service, "", []string{
		"You are ",
		"Arlecchino, the local-first codebase assistant inside the IDE.",
		" Mode boundary: Build may produce patch artifacts.",
	})
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", req)
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	if final.Status != "completed" {
		t.Fatalf("final run = %#v", final)
	}
	if tokenText := events.tokenText(); tokenText != "" {
		t.Fatalf("internal prompt echo should not be emitted as token events: %q", tokenText)
	}
	if strings.Contains(final.Response, "You are Arlecchino") || strings.Contains(final.Response, "Mode boundary:") {
		t.Fatalf("final response leaked internal prompt echo: %q", final.Response)
	}
}

func TestStreamingPromptPrefixThatDivergesIsEmitted(t *testing.T) {
	events := &chatPayloadEventLog{}
	service := newTestService(t, events.emit)
	req := AIChatRunRequest{
		Action: AIChatActionBuild,
		Prompt: "Добавь обработку Escape в dropdown настроек.",
	}
	want := "Добавь обработку Escape можно так: обновить обработчик."
	replaceLocalProviderWithRecorder(t, service, "", []string{
		"Добавь ",
		"обработку ",
		"Escape можно так: обновить обработчик.",
	})
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", req)
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	if final.Status != "completed" {
		t.Fatalf("final run = %#v", final)
	}
	if tokenText := events.tokenText(); tokenText != want {
		t.Fatalf("legitimate prompt-prefix stream was not emitted: got %q, want %q", tokenText, want)
	}
	if final.Response != want {
		t.Fatalf("final response = %q, want %q", final.Response, want)
	}
}

func TestStreamingExactPromptEchoPrefixIsStrippedBeforeTokenEvents(t *testing.T) {
	events := &chatPayloadEventLog{}
	service := newTestService(t, events.emit)
	req := AIChatRunRequest{
		Action: AIChatActionBuild,
		Prompt: "Добавь обработку Escape в dropdown настроек.",
	}
	answer := "Можно обновить обработчик закрытия dropdown."
	replaceLocalProviderWithRecorder(t, service, "", []string{req.Prompt + "\n\n" + answer})
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", req)
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	if final.Status != "completed" {
		t.Fatalf("final run = %#v", final)
	}
	if tokenText := events.tokenText(); tokenText != answer {
		t.Fatalf("token stream should strip exact prompt echo prefix: got %q, want %q", tokenText, answer)
	}
	if strings.Contains(final.Response, req.Prompt) {
		t.Fatalf("final response leaked exact prompt echo prefix: %q", final.Response)
	}
}

func TestRuntimeStateQuestionsUseBackendStateWithoutProvider(t *testing.T) {
	for _, action := range []AIChatAction{
		AIChatActionAsk,
		AIChatActionPlan,
		AIChatActionBuild,
		AIChatActionDebug,
	} {
		t.Run(string(action), func(t *testing.T) {
			service := newTestService(t, nil)
			if _, err := service.OpenProject("main", t.TempDir()); err != nil {
				t.Fatalf("OpenProject: %v", err)
			}
			run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
				Action: action,
				Prompt: "В каком ты щас режиме?",
			})
			if err != nil {
				t.Fatalf("StartChatRun: %v", err)
			}
			final := waitForRunStatus(t, service, run.ID)
			want := "Сейчас я работаю в режиме " + chatActionDisplayName(action) + "."
			if final.Response != want {
				t.Fatalf("response = %q, want %q", final.Response, want)
			}
			if final.EgressRecordID != "" {
				t.Fatalf("runtime state question should not call provider: %#v", final)
			}
			if len(final.ToolProposals) != 0 {
				t.Fatalf("runtime state question should not expose tool proposals: %#v", final.ToolProposals)
			}
		})
	}
}

func TestRuntimeStateQuestionsCanReportProviderModelAndProfile(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		Action:     AIChatActionDebug,
		Prompt:     "what current mode, provider, model and profile are you using?",
		ProviderID: "local-test",
		Model:      "local-model",
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	for _, want := range []string{
		"mode: Debug",
		"provider: local-test",
		"model: local-model",
		"profile: debug-operator",
	} {
		if !strings.Contains(final.Response, want) {
			t.Fatalf("response missing %q: %q", want, final.Response)
		}
	}
	if final.EgressRecordID != "" {
		t.Fatalf("runtime state question should not call provider: %#v", final)
	}
	if len(final.ToolProposals) != 0 {
		t.Fatalf("runtime state question should not expose tool proposals: %#v", final.ToolProposals)
	}
}

func TestSmallTalkToolProposalsAreHiddenWhenLoadingOldRuns(t *testing.T) {
	for _, prompt := range []string{"Привет", "В каком ты щас режиме?", "Билд?", "Чего?"} {
		run := normalizeChatRunToolProposals(AIChatRun{
			UserPrompt: prompt,
			ToolProposals: []AIToolProposal{
				{
					ID:             "old-proposal",
					Name:           "apply_code_change",
					ExecutionState: AIToolExecutionStateNotExecutable,
				},
			},
		})
		if len(run.ToolProposals) != 0 {
			t.Fatalf("old non-actionable proposals should be hidden: %#v", run.ToolProposals)
		}
	}
}
