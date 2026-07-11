package agents

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"arlecchino/internal/ai/providers"

	"github.com/creack/pty"
)

const (
	codexAdapterID           = "agent-cli-codex"
	codexAdapterKind         = "codex_cli"
	codexDefaultModelID      = "codex-cli-default"
	codexTranscriptLimit     = 64 * 1024
	codexProtocolLineLimit   = 1024 * 1024
	codexShortProbeTimeout   = 2 * time.Second
	codexModelCatalogTimeout = 10 * time.Second
	codexDescriptorCacheTTL  = 2 * time.Minute
	codexAdapterVersion      = "arlecchino-codex-runtime-v1"
	codexCompatibilityRange  = "codex-cli 0.144.x app-server v2"
)

var secretLikeTerminalPattern = regexp.MustCompile(`(?i)(bearer\s+|api[_-]?key\s*[:=]\s*["']?|token\s*[:=]\s*["']?|secret\s*[:=]\s*["']?|password\s*[:=]\s*["']?)[A-Za-z0-9._\-+/=]{8,}["']?`)
var emailLikeTerminalPattern = regexp.MustCompile(`(?i)[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}`)

type CodexAdapter struct {
	binary   string
	mu       sync.Mutex
	probeMu  sync.Mutex
	cached   Descriptor
	cachedAt time.Time
}

type codexOutputObserver struct {
	seen map[string]bool
}

type codexModelCatalog struct {
	Models []codexCatalogModel `json:"models"`
}

type codexCatalogModel struct {
	Slug                     string                `json:"slug"`
	DisplayName              string                `json:"display_name"`
	Visibility               string                `json:"visibility"`
	Upgrade                  any                   `json:"upgrade"`
	SupportedReasoningLevels []codexReasoningLevel `json:"supported_reasoning_levels"`
}

type codexReasoningLevel struct {
	Effort string `json:"effort"`
}

func NewCodexAdapter() *CodexAdapter {
	return &CodexAdapter{binary: strings.TrimSpace(os.Getenv("ARLECCHINO_CODEX_CLI_BINARY"))}
}

func (a *CodexAdapter) ID() string {
	return codexAdapterID
}

func (a *CodexAdapter) Descriptor(ctx context.Context) Descriptor {
	a.mu.Lock()
	if !a.cachedAt.IsZero() && time.Since(a.cachedAt) < codexDescriptorCacheTTL {
		cached := a.cached
		a.mu.Unlock()
		return cached
	}
	a.mu.Unlock()

	a.probeMu.Lock()
	defer a.probeMu.Unlock()

	a.mu.Lock()
	if !a.cachedAt.IsZero() && time.Since(a.cachedAt) < codexDescriptorCacheTTL {
		cached := a.cached
		a.mu.Unlock()
		return cached
	}
	a.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	descriptor := Descriptor{
		ID:                 codexAdapterID,
		Name:               "Codex",
		Kind:               codexAdapterKind,
		RuntimeFamily:      RuntimeFamilyStructuredAgent,
		Transport:          TransportAppServerSTDIO,
		Binary:             "codex",
		EndpointClass:      EndpointClassLocalProcess,
		AuthMode:           providers.ProviderAuthModeOAuth,
		AuthStatus:         "unknown",
		BillingMode:        "provider_account",
		LegalBasis:         "first_party_codex_cli",
		RiskTier:           "provider_owned_agent",
		RuntimeVersion:     "unknown",
		AdapterVersion:     codexAdapterVersion,
		ProtocolVersion:    codexAppServerProtocolVersion,
		CompatibilityRange: codexCompatibilityRange,
		Capabilities: []providers.AIProviderCapability{
			providers.CapabilityChat,
			providers.CapabilityPatchGeneration,
			providers.CapabilityStructuredOutput,
		},
		SupportedActions: []string{"ask", "plan", "build", "debug", "review"},
		Models:           []providers.AIModelDescriptor{},
		DefaultModel:     "",
		Status:           providers.ProviderStatusError,
		Reason:           "Codex CLI was not checked.",
		SourceLinks:      []string{"https://developers.openai.com/codex/app-server", "https://developers.openai.com/codex/noninteractive"},
		LastCheckedAt:    now,
	}
	binary, err := a.binaryPath()
	if err != nil {
		descriptor.Status = providers.ProviderStatusError
		descriptor.Reason = "Codex CLI binary was not found on PATH."
		return a.cacheDescriptor(descriptor)
	}
	descriptor.Binary = binary
	version, versionErr := runShortCommand(ctx, binary, "--version")
	if versionErr != nil {
		descriptor.Status = providers.ProviderStatusError
		descriptor.Reason = "Codex CLI version check failed."
		return a.cacheDescriptor(descriptor)
	}
	if strings.TrimSpace(version) != "" {
		descriptor.RuntimeVersion = sanitizeCLIStatusLine(version)
		descriptor.Reason = sanitizeCLIStatusLine(version)
	}
	auth, authErr := runShortCommand(ctx, binary, "login", "status")
	if authErr != nil {
		descriptor.Status = providers.ProviderStatusNeedsAuth
		descriptor.AuthStatus = "needs_auth"
		descriptor.Reason = "Sign in with the official Codex CLI flow."
		descriptor.Models = []providers.AIModelDescriptor{}
		descriptor.DefaultModel = ""
		return a.cacheDescriptor(descriptor)
	}
	descriptor.Status = providers.ProviderStatusReady
	descriptor.AuthStatus = "ready"
	if auth = sanitizeCLIStatusLine(auth); auth != "" {
		descriptor.Reason = auth
	}
	models, modelsErr := codexAccountModels(ctx, binary)
	if modelsErr != nil {
		descriptor.Status = providers.ProviderStatusDegraded
		descriptor.Reason = "Codex account is authenticated, but the account model catalog could not be read."
		if detail := sanitizeCLIStatusLine(modelsErr.Error()); detail != "" {
			descriptor.Reason = "Codex account is authenticated, but the account model catalog could not be read: " + detail
		}
		descriptor.Models = []providers.AIModelDescriptor{}
		descriptor.DefaultModel = ""
		return a.cacheDescriptor(descriptor)
	}
	if len(models) == 0 {
		descriptor.Status = providers.ProviderStatusDegraded
		descriptor.Reason = "Codex account model catalog returned no selectable models."
		descriptor.Models = []providers.AIModelDescriptor{}
		descriptor.DefaultModel = ""
		return a.cacheDescriptor(descriptor)
	}
	descriptor.Models = models
	descriptor.DefaultModel = firstCodexModelID(models)
	return a.cacheDescriptor(descriptor)
}

func (a *CodexAdapter) cacheDescriptor(descriptor Descriptor) Descriptor {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cached = descriptor
	a.cachedAt = time.Now()
	return descriptor
}

func (a *CodexAdapter) Invalidate() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cached = Descriptor{}
	a.cachedAt = time.Time{}
}

func (a *CodexAdapter) Run(ctx context.Context, req RunRequest, emit func(Event)) Result {
	if req.RuntimeFamily == RuntimeFamilyStructuredAgent || req.Transport == TransportAppServerSTDIO {
		return a.runAppServer(ctx, req, emit)
	}
	startedAt := time.Now().UTC().Format(time.RFC3339)
	binary, err := a.binaryPath()
	if err != nil {
		return UnsupportedResult(err.Error())
	}
	if strings.TrimSpace(req.ProjectRoot) == "" {
		return UnsupportedResult("project root is required")
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return UnsupportedResult("agent prompt is empty")
	}

	sandbox := codexSandboxForAction(req.Action)
	args := codexExecArgs(req, sandbox, codexDisableFeatureArgs(ctx, binary))
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = req.ProjectRoot
	cmd.Env = codexProcessEnv(
		"ARLECCHINO_EXTERNAL_AGENT_RUN_ID="+req.RunID,
		"ARLECCHINO_EXTERNAL_AGENT_RUNTIME_FAMILY="+RuntimeFamilyJSONLExec,
		"ARLECCHINO_EXTERNAL_AGENT_TRANSPORT=jsonl_exec",
	)
	cmd.Stdin = strings.NewReader(req.Prompt)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, Transport: TransportJSONLExec, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, Transport: TransportJSONLExec, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	if err := cmd.Start(); err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, Transport: TransportJSONLExec, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}

	emit(Event{
		RunID:     req.RunID,
		Type:      EventStatus,
		Status:    "runtime_proof",
		Text:      "Codex exec JSONL process started with prompt/context on stdin.",
		Payload:   map[string]any{"transport": TransportJSONLExec, "sandbox": sandbox, "protocol": "codex-exec-jsonl", "argvPrompt": false},
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})

	cancelWatcherDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			terminateProcessGroup(cmd.Process)
		case <-cancelWatcherDone:
		}
	}()

	var transcript transcriptBuffer
	var stderrBuffer transcriptBuffer
	observer := newCodexJSONLObserver(req.RunID, emit)
	var readDone sync.WaitGroup
	readDone.Add(2)
	go func() {
		defer readDone.Done()
		readLineStream(stdout, func(rawLine []byte) {
			transcript.Write(redactTerminalChunk(rawLine))
			transcript.Write([]byte("\n"))
			observer.Observe(rawLine)
		}, func(scanErr error) {
			emit(NewEvent(req.RunID, EventStatus, "stream_closed", sanitizeCLIStatusLine(scanErr.Error()), nil))
		})
	}()
	go func() {
		defer readDone.Done()
		readBoundedLineStream(stderr, codexTranscriptLimit, func(rawLine []byte) {
			line := redactTerminalChunk(rawLine)
			stderrBuffer.Write(line)
			stderrBuffer.Write([]byte("\n"))
			if text := sanitizeCLIStatusLine(string(line)); text != "" {
				emit(NewEvent(req.RunID, EventStatus, "stderr", text, nil))
			}
		}, func(scanErr error) {
			emit(NewEvent(req.RunID, EventStatus, "stream_closed", sanitizeCLIStatusLine(scanErr.Error()), nil))
		})
	}()

	waitErr := cmd.Wait()
	close(cancelWatcherDone)
	readDone.Wait()

	exitCode := 0
	if waitErr != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	finishedAt := time.Now().UTC().Format(time.RFC3339)
	if ctx.Err() != nil {
		return Result{
			Status:     "canceled",
			Message:    "Codex JSONL run was canceled.",
			ExitCode:   exitCode,
			Transport:  TransportJSONLExec,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	if waitErr != nil {
		errText := strings.TrimSpace(stderrBuffer.String())
		if errText == "" {
			errText = transcript.String()
		}
		return Result{
			Status:     "error",
			Message:    "Codex JSONL run failed.",
			Error:      FormatExitError(exitCode, errText),
			ExitCode:   exitCode,
			Transport:  TransportJSONLExec,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	if errText := observer.ErrorText(); errText != "" {
		return Result{
			Status:     "error",
			Message:    "Codex JSONL run reported a provider error.",
			Error:      errText,
			ExitCode:   exitCode,
			Transport:  TransportJSONLExec,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	return Result{
		Status:     "completed",
		Message:    observer.FinalMessage(),
		ExitCode:   exitCode,
		Transport:  TransportJSONLExec,
		Transcript: transcript.String(),
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
	}
}

type codexJSONLObserver struct {
	runID          string
	emit           func(Event)
	firstEventSeen bool
	finalMessage   strings.Builder
	errorText      string
	pendingMessage string
	pendingPayload map[string]any
}

func newCodexJSONLObserver(runID string, emit func(Event)) *codexJSONLObserver {
	return &codexJSONLObserver{
		runID: strings.TrimSpace(runID),
		emit:  emit,
	}
}

func (o *codexJSONLObserver) Observe(line []byte) {
	if o == nil || o.emit == nil || len(bytes.TrimSpace(line)) == 0 {
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(line, &payload); err != nil {
		o.emit(Event{
			RunID:     o.runID,
			Type:      EventStatus,
			Status:    "notice.diagnostic",
			Text:      "Codex emitted malformed JSONL; event was kept as bounded transcript evidence.",
			Payload:   map[string]any{"failureCode": FailureProtocolDrift},
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}
	eventType := strings.TrimSpace(stringValue(payload["type"]))
	if eventType == "" {
		eventType = "unknown"
	}
	if !o.firstEventSeen {
		o.firstEventSeen = true
		o.emit(Event{
			RunID:     o.runID,
			Type:      EventStatus,
			Status:    "first_provider_event",
			Text:      "First Codex JSONL event received.",
			Payload:   map[string]any{"providerEventType": eventType},
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		})
	}
	deltaText := codexJSONLDeltaMessageText(eventType, payload)
	finalText := codexJSONLFinalMessageText(eventType, payload)
	switch {
	case strings.Contains(eventType, "error"):
		payload["failureCode"] = FailureProviderError
		text := codexJSONLErrorText(payload)
		o.markError(text)
		o.emit(Event{RunID: o.runID, Type: EventError, Status: "error", Text: text, Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
	case strings.Contains(eventType, "approval") || strings.Contains(eventType, "command") || strings.Contains(eventType, "file") || strings.Contains(eventType, "tool"):
		o.emit(Event{RunID: o.runID, Type: EventStatus, Status: eventType, Text: codexJSONLStatusText(eventType, payload), Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
	case deltaText != "":
		o.appendMessageDelta(deltaText)
		o.emit(Event{RunID: o.runID, Type: EventMessage, Status: "message.delta", Text: deltaText, Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
	case finalText != "":
		o.stageMessageCandidate(finalText, payload)
		if strings.Contains(eventType, "turn.completed") {
			o.flushPendingFinalMessage()
			o.emit(Event{RunID: o.runID, Type: EventStatus, Status: eventType, Text: "Codex JSONL turn completed.", Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		}
	case strings.Contains(eventType, "message") || strings.Contains(eventType, "item.completed") || strings.Contains(eventType, "turn.completed"):
		if failed, reason := codexJSONLTurnFailure(payload); failed {
			payload["failureCode"] = FailureProviderError
			o.markError(reason)
			o.emit(Event{RunID: o.runID, Type: EventError, Status: "turn.failed", Text: reason, Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		} else {
			if strings.Contains(eventType, "turn.completed") {
				o.flushPendingFinalMessage()
			}
			o.emit(Event{RunID: o.runID, Type: EventStatus, Status: eventType, Text: "Codex JSONL event received.", Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		}
	case strings.Contains(eventType, "delta"):
		if text := sanitizedEventText(codexJSONLNonAnswerStatusText(payload)); text != "" {
			o.emit(Event{RunID: o.runID, Type: EventStatus, Status: eventType, Text: text, Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		} else {
			o.emit(Event{RunID: o.runID, Type: EventStatus, Status: eventType, Text: "Codex JSONL delta event received.", Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		}
	default:
		o.emit(Event{RunID: o.runID, Type: EventStatus, Status: eventType, Text: codexJSONLStatusText(eventType, payload), Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
	}
}

func (o *codexJSONLObserver) stageMessageCandidate(text string, payload map[string]any) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	if o.pendingMessage != "" {
		o.emit(Event{
			RunID:     o.runID,
			Type:      EventMessage,
			Status:    "message.commentary",
			Text:      o.pendingMessage,
			Payload:   o.pendingPayload,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		})
	}
	o.pendingMessage = text
	o.pendingPayload = payload
}

func (o *codexJSONLObserver) flushPendingFinalMessage() {
	if strings.TrimSpace(o.pendingMessage) == "" {
		return
	}
	text := o.pendingMessage
	payload := o.pendingPayload
	o.pendingMessage = ""
	o.pendingPayload = nil
	o.setFinalMessage(text)
	o.emit(Event{
		RunID:     o.runID,
		Type:      EventMessage,
		Status:    "message.final",
		Text:      text,
		Payload:   payload,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func codexJSONLDeltaMessageText(eventType string, payload map[string]any) string {
	lower := strings.ToLower(strings.TrimSpace(eventType))
	if !strings.Contains(lower, "delta") || codexNonAnswerKind(lower) || codexJSONLPayloadIsNonAnswer(payload) {
		return ""
	}
	if lower == "item.delta" || strings.Contains(lower, "message") || strings.Contains(lower, "agent") || strings.Contains(lower, "assistant") {
		return sanitizedMessageText(firstMessageFragment(
			stringValue(payload["delta"]),
			stringFromPath(payload, "message", "delta"),
			stringFromPath(payload, "message", "text"),
			stringFromPath(payload, "message", "content"),
			stringFromPath(payload, "item", "message", "delta"),
			stringFromPath(payload, "item", "message", "text"),
			stringFromPath(payload, "item", "message", "content"),
		))
	}
	return ""
}

func codexJSONLFinalMessageText(eventType string, payload map[string]any) string {
	lower := strings.ToLower(strings.TrimSpace(eventType))
	if codexNonAnswerKind(lower) || codexJSONLPayloadIsNonAnswer(payload) {
		return ""
	}
	if failed, _ := codexJSONLTurnFailure(payload); failed {
		return ""
	}
	if !(strings.Contains(lower, "message") || strings.Contains(lower, "item.completed") || strings.Contains(lower, "turn.completed")) {
		return ""
	}
	return sanitizedMessageText(firstNonEmpty(
		stringFromPath(payload, "message", "text"),
		stringFromPath(payload, "message", "content"),
		stringFromPath(payload, "item", "text"),
		stringFromPath(payload, "item", "content"),
		stringFromPath(payload, "item", "message", "text"),
		stringFromPath(payload, "item", "message", "content"),
		stringValue(payload["text"]),
	))
}

func codexJSONLPayloadIsNonAnswer(payload map[string]any) bool {
	kind := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		stringFromPath(payload, "item", "type"),
		stringFromPath(payload, "item", "kind"),
		stringFromPath(payload, "item", "role"),
		stringFromPath(payload, "message", "role"),
		stringValue(payload["item_type"]),
		stringValue(payload["role"]),
	)))
	return codexNonAnswerKind(kind)
}

func codexJSONLTurnFailure(payload map[string]any) (bool, string) {
	status := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		stringFromPath(payload, "turn", "status"),
		stringValue(payload["status"]),
	)))
	switch status {
	case "failed", "error", "interrupted", "canceled", "cancelled":
		reason := sanitizedEventText(firstNonEmpty(
			stringFromPath(payload, "turn", "error", "message"),
			stringFromPath(payload, "turn", "error"),
			stringFromPath(payload, "error", "message"),
			stringValue(payload["error"]),
			stringFromPath(payload, "message", "text"),
		))
		if reason == "" {
			reason = "Codex JSONL turn ended with status " + status + "."
		}
		return true, reason
	default:
		return false, ""
	}
}

func codexJSONLNonAnswerStatusText(payload map[string]any) string {
	kind := firstNonEmpty(
		stringFromPath(payload, "item", "type"),
		stringFromPath(payload, "item", "kind"),
		stringFromPath(payload, "item", "role"),
		stringValue(payload["type"]),
	)
	if kind == "" {
		return "Codex JSONL non-answer delta event received."
	}
	return "Codex JSONL non-answer delta received for " + sanitizedEventText(kind) + "."
}

func codexJSONLStatusText(eventType string, payload map[string]any) string {
	kind := firstNonEmpty(
		stringFromPath(payload, "item", "type"),
		stringFromPath(payload, "item", "kind"),
		stringFromPath(payload, "item", "role"),
	)
	if kind != "" {
		return "Codex JSONL " + sanitizedEventText(eventType) + " event received for " + sanitizedEventText(kind) + "."
	}
	return "Codex JSONL " + sanitizedEventText(eventType) + " event received."
}

func codexJSONLErrorText(payload map[string]any) string {
	return firstNonEmpty(sanitizedEventText(firstNonEmpty(
		stringFromPath(payload, "error", "message"),
		stringValue(payload["error"]),
		stringFromPath(payload, "message", "text"),
	)), "Codex JSONL emitted an error.")
}

func (o *codexJSONLObserver) appendMessageDelta(text string) {
	if text == "" {
		return
	}
	o.finalMessage.WriteString(text)
}

func (o *codexJSONLObserver) setFinalMessage(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	o.finalMessage.Reset()
	o.finalMessage.WriteString(text)
}

func (o *codexJSONLObserver) markError(text string) {
	if o == nil || strings.TrimSpace(o.errorText) != "" {
		return
	}
	o.errorText = sanitizedEventText(text)
}

func (o *codexJSONLObserver) ErrorText() string {
	if o == nil {
		return ""
	}
	return strings.TrimSpace(o.errorText)
}

func (o *codexJSONLObserver) FinalMessage() string {
	if o == nil {
		return ""
	}
	return strings.TrimSpace(o.finalMessage.String())
}

func codexSandboxForAction(action string) string {
	switch strings.TrimSpace(action) {
	case "build":
		return "workspace-write"
	default:
		return "read-only"
	}
}

func codexExecArgs(req RunRequest, sandbox string, disableFeatureArgs []string) []string {
	args := []string{
		"exec",
		"--ignore-user-config",
		"--json",
		"--color", "never",
		"-C", req.ProjectRoot,
		"-s", sandbox,
		"-c", "mcp_servers={}",
	}
	args = append(args, disableFeatureArgs...)
	if model := strings.TrimSpace(req.Model); model != "" && model != codexDefaultModelID {
		args = append(args, "-m", model)
	}
	if effort := codexReasoningEffortForRequest(req.ReasoningEffort); effort != "" {
		args = append(args, "-c", "model_reasoning_effort=\""+effort+"\"")
	}
	return append(args, "-")
}

func codexAccountModels(ctx context.Context, binary string) ([]providers.AIModelDescriptor, error) {
	output, err := runCommandWithTimeout(ctx, codexModelCatalogTimeout, binary, codexDebugModelsArgs(codexDisableFeatureArgs(ctx, binary))...)
	if err != nil {
		return nil, err
	}
	return codexModelsFromCatalogJSON([]byte(output))
}

func codexDebugModelsArgs(disableFeatureArgs []string) []string {
	args := []string{"debug", "models", "-c", "mcp_servers={}"}
	args = append(args, disableFeatureArgs...)
	return args
}

func codexModelsFromCatalogJSON(data []byte) ([]providers.AIModelDescriptor, error) {
	var catalog codexModelCatalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		return nil, err
	}
	models := make([]providers.AIModelDescriptor, 0, len(catalog.Models))
	for _, model := range catalog.Models {
		id := strings.TrimSpace(model.Slug)
		if id == "" || model.Upgrade != nil || strings.EqualFold(strings.TrimSpace(model.Visibility), "hide") {
			continue
		}
		models = append(models, providers.EnrichModelDescriptor("codex", providers.AIModelDescriptor{
			ID:               id,
			DisplayName:      firstNonEmpty(model.DisplayName, id),
			Streaming:        true,
			PatchGeneration:  true,
			StructuredOutput: true,
			ReasoningEfforts: codexReasoningEfforts(model.SupportedReasoningLevels),
			AccountScoped:    true,
		}))
	}
	return models, nil
}

func codexReasoningEfforts(levels []codexReasoningLevel) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, level := range levels {
		effort := codexReasoningEffortForRequest(level.Effort)
		if effort == "" || seen[effort] {
			continue
		}
		seen[effort] = true
		out = append(out, effort)
	}
	return out
}

func codexReasoningEffortForRequest(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "low", "medium", "high", "xhigh":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func firstCodexModelID(models []providers.AIModelDescriptor) string {
	if len(models) == 0 {
		return ""
	}
	return strings.TrimSpace(models[0].ID)
}

func codexEventText(payload map[string]any) string {
	values := collectCodexText(payload, 0)
	return strings.Join(values, "\n")
}

func collectCodexText(value any, depth int) []string {
	if depth > 6 {
		return nil
	}
	switch typed := value.(type) {
	case string:
		return []string{typed}
	case []any:
		out := []string{}
		for _, item := range typed {
			out = append(out, collectCodexText(item, depth+1)...)
		}
		return out
	case map[string]any:
		out := []string{}
		for _, key := range []string{"text", "delta", "message", "error", "summary", "output"} {
			if next, ok := typed[key]; ok {
				out = append(out, collectCodexText(next, depth+1)...)
			}
		}
		for _, key := range []string{"item", "content", "payload"} {
			if next, ok := typed[key]; ok {
				out = append(out, collectCodexText(next, depth+1)...)
			}
		}
		return out
	default:
		return nil
	}
}

func sanitizedEventText(value string) string {
	lines := nonEmptyUniqueLines(value)
	if len(lines) == 0 {
		return ""
	}
	return truncateString(strings.Join(lines, "\n"), 2000)
}

func sanitizedMessageText(value string) string {
	value = string(redactTerminalChunk([]byte(value)))
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return value
}

func nonEmptyUniqueLines(value string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line = sanitizeCLIStatusLine(line)
		if line == "" || seen[line] {
			continue
		}
		seen[line] = true
		out = append(out, line)
	}
	return out
}

func stringValue(value any) string {
	if typed, ok := value.(string); ok {
		return typed
	}
	return ""
}

func truncateString(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	if limit <= 3 {
		return string(runes[:limit])
	}
	return string(runes[:limit-3]) + "..."
}

func readLineStream(reader io.Reader, onLine func([]byte), onError func(error)) {
	readBoundedLineStream(reader, codexProtocolLineLimit, onLine, onError)
}

func readBoundedLineStream(reader io.Reader, maxLine int, onLine func([]byte), onError func(error)) {
	if maxLine <= 0 {
		maxLine = codexTranscriptLimit
	}
	buffered := bufio.NewReaderSize(reader, 16*1024)
	line := make([]byte, 0, min(maxLine, 16*1024))
	truncated := false
	emitLine := func() {
		clean := bytes.TrimRight(line, "\r\n")
		if truncated {
			clean = append(append([]byte(nil), clean...), []byte("... [truncated]")...)
		}
		if len(clean) > 0 && onLine != nil {
			onLine(append([]byte(nil), clean...))
		}
		line = line[:0]
		truncated = false
	}
	for {
		fragment, err := buffered.ReadSlice('\n')
		if len(fragment) > 0 {
			if remaining := maxLine - len(line); remaining > 0 {
				if len(fragment) <= remaining {
					line = append(line, fragment...)
				} else {
					line = append(line, fragment[:remaining]...)
					truncated = true
				}
			} else {
				truncated = true
			}
		}
		switch {
		case err == nil:
			emitLine()
		case errors.Is(err, bufio.ErrBufferFull):
			truncated = true
		case errors.Is(err, io.EOF):
			if len(line) > 0 || truncated {
				emitLine()
			}
			return
		default:
			if len(line) > 0 || truncated {
				emitLine()
			}
			if onError != nil {
				onError(err)
			}
			return
		}
	}
}

func (a *CodexAdapter) RunAuth(ctx context.Context, req AuthRequest, emit func(Event)) Result {
	startedAt := time.Now().UTC().Format(time.RFC3339)
	binary, err := a.binaryPath()
	if err != nil {
		return UnsupportedResult(err.Error())
	}
	rows := req.Rows
	if rows == 0 {
		rows = 30
	}
	cols := req.Cols
	if cols == 0 {
		cols = 110
	}
	workdir := strings.TrimSpace(req.ProjectRoot)
	if workdir == "" {
		if home, homeErr := os.UserHomeDir(); homeErr == nil {
			workdir = home
		}
	}
	cmd := exec.CommandContext(ctx, binary, "login")
	if workdir != "" {
		cmd.Dir = workdir
	}
	cmd.Env = codexProcessEnv(
		"ARLECCHINO_EXTERNAL_AGENT_AUTH_RUN_ID="+req.RunID,
		"ARLECCHINO_EXTERNAL_AGENT_RUNTIME_FAMILY="+RuntimeFamilyInteractiveFallback,
		"ARLECCHINO_EXTERNAL_AGENT_TRANSPORT="+TransportPTYFallback,
	)

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	defer ptmx.Close()

	if req.RegisterInput != nil {
		req.RegisterInput(req.RunID, func(data []byte) error {
			_, writeErr := ptmx.Write(data)
			return writeErr
		}, func(nextRows uint16, nextCols uint16) error {
			if nextRows == 0 || nextCols == 0 {
				return nil
			}
			return pty.Setsize(ptmx, &pty.Winsize{Rows: nextRows, Cols: nextCols})
		})
		defer req.RegisterInput(req.RunID, nil, nil)
	}

	emit(NewEvent(req.RunID, EventStatus, "auth_started", "Agent CLI authentication process started.", nil))
	var transcript transcriptBuffer
	observer := newCodexOutputObserver()
	var readDone sync.WaitGroup
	readDone.Add(1)
	go func() {
		defer readDone.Done()
		buffer := make([]byte, 4096)
		for {
			n, readErr := ptmx.Read(buffer)
			if n > 0 {
				chunk := redactTerminalChunk(buffer[:n])
				transcript.Write(chunk)
				emit(NewEvent(req.RunID, EventTerminalData, "stream", "", chunk))
				observer.Observe(req.RunID, transcript.String(), emit)
			}
			if readErr != nil {
				if !errors.Is(readErr, io.EOF) {
					emit(NewEvent(req.RunID, EventStatus, "stream_closed", sanitizeCLIStatusLine(readErr.Error()), nil))
				}
				return
			}
		}
	}()

	waitCh := make(chan error, 1)
	go func() {
		waitCh <- cmd.Wait()
	}()

	var waitErr error
	select {
	case <-ctx.Done():
		terminateProcessGroup(cmd.Process)
		waitErr = <-waitCh
	case waitErr = <-waitCh:
	}
	_ = ptmx.Close()
	readDone.Wait()

	exitCode := 0
	if waitErr != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	finishedAt := time.Now().UTC().Format(time.RFC3339)
	if ctx.Err() != nil {
		return Result{
			Status:     "canceled",
			Message:    "Agent CLI authentication was canceled.",
			ExitCode:   exitCode,
			Transport:  TransportPTYFallback,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	if waitErr != nil {
		return Result{
			Status:     "error",
			Message:    "Agent CLI authentication failed.",
			Error:      FormatExitError(exitCode, transcript.String()),
			ExitCode:   exitCode,
			Transport:  TransportPTYFallback,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	a.Invalidate()
	return Result{
		Status:     "completed",
		Message:    "Agent CLI authentication completed.",
		ExitCode:   exitCode,
		Transport:  TransportPTYFallback,
		Transcript: transcript.String(),
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
	}
}

func codexProcessEnv(extra ...string) []string {
	env := filteredCodexEnv()
	env = appendCodexCommonProcessEnv(env, extra...)
	return env
}

func codexDiscoveryProcessEnv(extra ...string) []string {
	env := filteredCodexEnv()
	env = removeEnvKey(env, "CODEX_API_KEY")
	env = appendCodexCommonProcessEnv(env, extra...)
	return env
}

func codexAppServerProcessEnv(extra ...string) []string {
	env := filteredCodexEnv()
	env = appendCodexCommonProcessEnv(env, extra...)
	return env
}

func appendCodexCommonProcessEnv(env []string, extra ...string) []string {
	env = append(env,
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"NO_UPDATE_NOTIFIER=1",
		"GIT_TERMINAL_PROMPT=0",
		"GH_PROMPT_DISABLED=1",
		"ARLECCHINO_EXTERNAL_AGENT_UI=gui",
	)
	return append(env, extra...)
}

func removeEnvKey(env []string, keys ...string) []string {
	blocked := make(map[string]bool, len(keys))
	for _, key := range keys {
		blocked[key] = true
	}
	filtered := env[:0]
	for _, entry := range env {
		key, _, ok := strings.Cut(entry, "=")
		if ok && blocked[key] {
			continue
		}
		filtered = append(filtered, entry)
	}
	return filtered
}

func filteredCodexEnv() []string {
	allowed := []string{
		"PATH",
		"HOME",
		"USER",
		"LOGNAME",
		"SHELL",
		"TMPDIR",
		"LANG",
		"LC_ALL",
		"XDG_CONFIG_HOME",
		"CODEX_HOME",
		"CODEX_API_KEY",
	}
	env := make([]string, 0, len(allowed))
	pathIncluded := false
	for _, key := range allowed {
		value, ok := os.LookupEnv(key)
		if !ok {
			continue
		}
		if key == "PATH" {
			value = codexAugmentedPathValue(value)
		}
		if strings.ContainsAny(value, "\x00\r\n") {
			continue
		}
		if key == "PATH" {
			pathIncluded = true
		}
		env = append(env, key+"="+value)
	}
	if !pathIncluded {
		if path := codexAugmentedPathValue(""); path != "" && !strings.ContainsAny(path, "\x00\r\n") {
			env = append(env, "PATH="+path)
		}
	}
	return env
}

func newCodexOutputObserver() *codexOutputObserver {
	return &codexOutputObserver{seen: map[string]bool{}}
}

func (o *codexOutputObserver) Observe(runID string, transcript string, emit func(Event)) {
	if o == nil || emit == nil {
		return
	}
	text := normalizeCodexTerminalText(transcript)
	if text == "" {
		return
	}
	if strings.Contains(text, "Do you trust the contents of this directory?") {
		path := extractCodexPromptValue(text, `(?m)^\s*>?\s*You are in\s+(.+)$`)
		message := "Codex is asking whether to trust this project directory before loading project-local config, hooks, and exec policies."
		if path != "" {
			message += " Directory: " + path
		}
		o.emitOnce(runID, "trust_project_prompt", message, emit)
	}
	if strings.Contains(text, "Codex just got an upgrade") || strings.Contains(text, "Update now (runs") {
		o.emitOnce(runID, "update_prompt", "Codex CLI is showing an update prompt. The current run needs a GUI decision before continuing.", emit)
	}
	if strings.Contains(text, "MCP server is not logged in") || strings.Contains(text, "MCP startup incomplete") {
		o.emitOnce(runID, "mcp_notice", "Codex reported MCP startup or account notices. Arlecchino keeps them as runtime notices, not chat output.", emit)
	}
	if strings.Contains(text, "needs your approval") || strings.Contains(text, "Approval requested") || strings.Contains(text, "requires approval by policy") {
		o.emitOnce(runID, "approval_prompt", "Codex is asking for an approval through the provider CLI.", emit)
	}
	if strings.Contains(text, "Your session has expired") || strings.Contains(text, "Please reauthenticate") {
		o.emitOnce(runID, "auth_required", "Codex reports that the provider account needs authentication.", emit)
	}
}

func (o *codexOutputObserver) emitOnce(runID string, status string, text string, emit func(Event)) {
	if o.seen[status] {
		return
	}
	o.seen[status] = true
	emit(NewEvent(runID, EventStatus, status, sanitizeCLIStatusLine(text), nil))
}

func normalizeCodexTerminalText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.TrimSpace(value)
}

func extractCodexPromptValue(text string, pattern string) string {
	matches := regexp.MustCompile(pattern).FindStringSubmatch(text)
	if len(matches) < 2 {
		return ""
	}
	return strings.TrimSpace(matches[1])
}

func (a *CodexAdapter) binaryPath() (string, error) {
	if binary := strings.TrimSpace(a.binary); binary != "" {
		if !filepath.IsAbs(binary) && !strings.ContainsRune(binary, os.PathSeparator) {
			if path, err := codexLookPath(binary); err == nil {
				return path, nil
			}
		}
		return binary, nil
	}
	return codexLookPath("codex")
}

func codexLookPath(name string) (string, error) {
	path, err := exec.LookPath(name)
	if err != nil {
		for _, dir := range codexSearchDirs() {
			candidate := filepath.Join(dir, name)
			if codexExecutableFileExists(candidate) {
				return candidate, nil
			}
		}
		return "", errors.New(name + " not found in PATH or common CLI directories")
	}
	return path, nil
}

func codexSearchDirs() []string {
	return codexSearchDirsForPath(os.Getenv("PATH"))
}

func codexSearchDirsForPath(pathValue string) []string {
	dirs := []string{}
	seen := map[string]bool{}
	add := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" || seen[path] {
			return
		}
		seen[path] = true
		dirs = append(dirs, path)
	}
	addGlob := func(pattern string) {
		matches, _ := filepath.Glob(pattern)
		for i := len(matches) - 1; i >= 0; i-- {
			add(matches[i])
		}
	}

	for _, path := range filepath.SplitList(pathValue) {
		add(path)
	}
	if npmPrefix := strings.TrimSpace(os.Getenv("NPM_CONFIG_PREFIX")); npmPrefix != "" {
		add(filepath.Join(npmPrefix, "bin"))
	}
	if home, _ := os.UserHomeDir(); home != "" {
		add(filepath.Join(home, ".local", "bin"))
		add(filepath.Join(home, ".npm-global", "bin"))
		add(filepath.Join(home, ".volta", "bin"))
		add(filepath.Join(home, ".asdf", "shims"))
		add(filepath.Join(home, ".local", "share", "mise", "shims"))
		add(filepath.Join(home, ".config", "mise", "shims"))
		add(filepath.Join(home, "Library", "pnpm"))
		add(filepath.Join(home, ".local", "share", "pnpm"))
		add(filepath.Join(home, "go", "bin"))
		addGlob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin"))
	}
	add("/opt/homebrew/bin")
	add("/opt/homebrew/sbin")
	add("/usr/local/bin")
	add("/usr/local/sbin")
	add("/usr/bin")
	add("/bin")
	add("/usr/sbin")
	add("/sbin")
	add("/Applications/Codex.app/Contents/Resources")
	return dirs
}

func codexAugmentedPathValue(current string) string {
	return strings.Join(codexSearchDirsForPath(current), string(os.PathListSeparator))
}

func codexExecutableFileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0111 != 0
}

func runShortCommand(parent context.Context, binary string, args ...string) (string, error) {
	return runCommandWithTimeout(parent, codexShortProbeTimeout, binary, args...)
}

func runCommandWithTimeout(parent context.Context, timeout time.Duration, binary string, args ...string) (string, error) {
	if timeout <= 0 {
		timeout = codexShortProbeTimeout
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Env = codexDiscoveryProcessEnv()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil && cmd.Process != nil {
		terminateProcessGroup(cmd.Process)
	}
	if err != nil {
		return string(output), err
	}
	return string(output), nil
}

func terminateProcessGroup(process *os.Process) {
	if process == nil {
		return
	}
	pid := process.Pid
	if pid <= 0 {
		_ = process.Kill()
		return
	}
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	timer := time.NewTimer(1500 * time.Millisecond)
	defer timer.Stop()
	<-timer.C
	_ = syscall.Kill(-pid, syscall.SIGKILL)
}

func redactTerminalChunk(data []byte) []byte {
	if len(data) == 0 {
		return nil
	}
	redacted := secretLikeTerminalPattern.ReplaceAll(data, []byte("${1}<redacted>"))
	redacted = emailLikeTerminalPattern.ReplaceAll(redacted, []byte("<account>"))
	return append([]byte(nil), redacted...)
}

func sanitizeCLIStatusLine(value string) string {
	value = string(redactTerminalChunk([]byte(value)))
	value = strings.ReplaceAll(value, "\r\n", "\n")
	lines := strings.Split(value, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(line, "@") {
			line = "CLI account status detected."
		}
		kept = append(kept, line)
		if len(kept) >= 2 {
			break
		}
	}
	return strings.Join(kept, " ")
}

type transcriptBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *transcriptBuffer) Write(chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.buffer.Len()+len(chunk) > codexTranscriptLimit {
		excess := b.buffer.Len() + len(chunk) - codexTranscriptLimit
		current := b.buffer.Bytes()
		if excess < len(current) {
			next := append([]byte(nil), current[excess:]...)
			b.buffer.Reset()
			_, _ = b.buffer.Write(next)
		} else {
			b.buffer.Reset()
		}
	}
	_, _ = b.buffer.Write(chunk)
}

func (b *transcriptBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return strings.TrimSpace(b.buffer.String())
}
