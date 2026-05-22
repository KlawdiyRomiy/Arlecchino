package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

const codexAppServerProtocolVersion = "codex-app-server-v2-jsonrpc"

var codexAppServerDisabledFeatures = []string{
	"apps",
	"plugins",
	"enable_mcp_apps",
	"builtin_mcp",
	"hooks",
	"plugin_hooks",
}

type codexRPCMessage struct {
	ID     any            `json:"id,omitempty"`
	Method string         `json:"method,omitempty"`
	Params map[string]any `json:"params,omitempty"`
	Result map[string]any `json:"result,omitempty"`
	Error  *codexRPCError `json:"error,omitempty"`
}

type codexRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type codexAppServerSession struct {
	cmd         *exec.Cmd
	stdin       io.WriteCloser
	emit        func(Event)
	runID       string
	writeMu     sync.Mutex
	pendingMu   sync.Mutex
	pending     map[string]chan codexRPCMessage
	nextID      int64
	transcript  transcriptBuffer
	observer    *codexAppServerObserver
	processMu   sync.Mutex
	processErr  error
	processSet  bool
	processDone chan error
}

type codexAppServerObserver struct {
	runID        string
	emit         func(Event)
	mu           sync.Mutex
	threadID     string
	turnID       string
	firstEvent   bool
	completed    bool
	blockedError string
	done         chan struct{}
	finalMessage strings.Builder
}

func (a *CodexAdapter) runAppServer(ctx context.Context, req RunRequest, emit func(Event)) Result {
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

	cmd := exec.CommandContext(ctx, binary, codexAppServerArgs(req)...)
	cmd.Dir = req.ProjectRoot
	cmd.Env = codexAppServerProcessEnv(
		"ARLECCHINO_EXTERNAL_AGENT_RUN_ID="+req.RunID,
		"ARLECCHINO_EXTERNAL_AGENT_RUNTIME_FAMILY="+RuntimeFamilyStructuredAgent,
		"ARLECCHINO_EXTERNAL_AGENT_TRANSPORT="+TransportAppServerSTDIO,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, Transport: TransportAppServerSTDIO, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, Transport: TransportAppServerSTDIO, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, Transport: TransportAppServerSTDIO, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	if err := cmd.Start(); err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, Transport: TransportAppServerSTDIO, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	session := &codexAppServerSession{
		cmd:         cmd,
		stdin:       stdin,
		emit:        emit,
		runID:       req.RunID,
		pending:     map[string]chan codexRPCMessage{},
		observer:    newCodexAppServerObserver(req.RunID, emit),
		processDone: make(chan error, 1),
	}
	defer session.shutdown()
	go func() {
		session.processDone <- cmd.Wait()
	}()
	session.startReaders(stdout, stderr)

	emit(Event{
		RunID:     req.RunID,
		Type:      EventStatus,
		Status:    "runtime_proof",
		Text:      "Codex app-server stdio process started with JSON-RPC input on stdin.",
		Payload:   map[string]any{"transport": TransportAppServerSTDIO, "argvPrompt": false, "protocol": codexAppServerProtocolVersion},
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})

	preflightCtx, cancelPreflight := context.WithTimeout(ctx, 20*time.Second)
	defer cancelPreflight()
	if _, err := session.request(preflightCtx, "initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "arlecchino",
			"title":   "Arlecchino",
			"version": codexAdapterVersion,
		},
		"capabilities": map[string]any{"experimentalApi": true},
	}); err != nil {
		return session.errorResult("Codex app-server initialize failed.", err, startedAt)
	}

	sandbox := codexSandboxForAction(req.Action)
	threadResult, err := session.request(preflightCtx, "thread/start", map[string]any{
		"cwd":               req.ProjectRoot,
		"sandbox":           sandbox,
		"approvalPolicy":    "never",
		"approvalsReviewer": "user",
		"baseInstructions":  "Arlecchino is the host runtime. Do not treat provider-native approvals, direct writes, or raw prose as Arlecchino approval.",
		"model":             codexModelForRequest(req.Model),
		"ephemeral":         true,
		"threadSource":      "user",
	})
	if err != nil {
		return session.errorResult("Codex app-server thread start failed.", err, startedAt)
	}
	threadID := stringFromPath(threadResult, "thread", "id")
	if threadID == "" {
		return session.errorResult("Codex app-server did not return a thread id.", nil, startedAt)
	}
	session.observer.setThreadID(threadID)

	turnParams := map[string]any{
		"threadId":       threadID,
		"cwd":            req.ProjectRoot,
		"approvalPolicy": "never",
		"input":          []map[string]any{codexAppServerTextInput(req.Prompt)},
		"model":          codexModelForRequest(req.Model),
		"sandboxPolicy":  codexAppServerSandboxPolicy(req.Action, req.ProjectRoot),
	}
	if effort := codexReasoningEffortForRequest(req.ReasoningEffort); effort != "" {
		turnParams["effort"] = effort
	}
	turnResult, err := session.request(preflightCtx, "turn/start", turnParams)
	if err != nil {
		return session.errorResult("Codex app-server turn start failed.", err, startedAt)
	}
	if turnID := stringFromPath(turnResult, "turn", "id"); turnID != "" {
		session.observer.setTurnID(turnID)
	}
	threadID, turnID := session.observer.ids()
	emit(Event{
		RunID:  req.RunID,
		Type:   EventStatus,
		Status: "runtime_proof",
		Text:   "Codex app-server thread and turn are active under Arlecchino runtime policy.",
		Payload: map[string]any{
			"transport":       TransportAppServerSTDIO,
			"protocol":        codexAppServerProtocolVersion,
			"threadId":        threadID,
			"turnId":          turnID,
			"sandboxPolicy":   codexSandboxForAction(req.Action),
			"reasoningEffort": codexReasoningEffortForRequest(req.ReasoningEffort),
			"argvPrompt":      false,
		},
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})

	select {
	case <-ctx.Done():
		_ = session.interruptTurn(context.Background())
		return Result{Status: "canceled", Message: "Codex app-server run was canceled.", ExitCode: 0, Transport: TransportAppServerSTDIO, Transcript: session.transcript.String(), StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	case <-session.observer.done:
	case waitErr := <-session.processDone:
		session.noteProcessDone(waitErr)
		finishedAt := time.Now().UTC().Format(time.RFC3339)
		exitCode := exitCodeFromWaitErr(waitErr)
		errText := "Codex app-server process exited before a terminal turn event."
		if waitErr != nil {
			errText = FormatExitError(exitCode, firstNonEmpty(session.transcript.String(), waitErr.Error()))
		}
		return Result{Status: "error", Message: "Codex app-server exited before completing the turn.", Error: sanitizeCLIStatusLine(errText), ExitCode: exitCode, Transport: TransportAppServerSTDIO, Transcript: session.transcript.String(), StartedAt: startedAt, FinishedAt: finishedAt}
	}
	finishedAt := time.Now().UTC().Format(time.RFC3339)
	if errText := session.observer.errorText(); errText != "" {
		return Result{Status: "error", Message: "Codex app-server run blocked.", Error: errText, ExitCode: -1, Transport: TransportAppServerSTDIO, Transcript: session.transcript.String(), StartedAt: startedAt, FinishedAt: finishedAt}
	}
	return Result{Status: "completed", Message: session.observer.FinalMessage(), ExitCode: 0, Transport: TransportAppServerSTDIO, Transcript: session.transcript.String(), StartedAt: startedAt, FinishedAt: finishedAt}
}

func (s *codexAppServerSession) startReaders(stdout io.Reader, stderr io.Reader) {
	go func() {
		readLineStream(stdout, func(rawLine []byte) {
			s.transcript.Write(codexAppServerTranscriptLine(rawLine))
			s.transcript.Write([]byte("\n"))
			s.handleLine(rawLine)
		}, func(err error) {
			s.emit(NewEvent(s.runID, EventStatus, "stream_closed", sanitizeCLIStatusLine(err.Error()), nil))
		})
	}()
	go func() {
		readBoundedLineStream(stderr, codexTranscriptLimit, func(rawLine []byte) {
			line := redactTerminalChunk(rawLine)
			s.transcript.Write(line)
			s.transcript.Write([]byte("\n"))
			if text := sanitizeCLIStatusLine(string(line)); text != "" {
				s.emit(NewEvent(s.runID, EventStatus, "stderr", text, nil))
			}
		}, func(err error) {
			s.emit(NewEvent(s.runID, EventStatus, "stream_closed", sanitizeCLIStatusLine(err.Error()), nil))
		})
	}()
}

func codexAppServerTranscriptLine(rawLine []byte) []byte {
	var decoded any
	decoder := json.NewDecoder(bytes.NewReader(rawLine))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		return redactTerminalChunk(rawLine)
	}
	encoded, err := json.Marshal(redactCodexAppServerTranscriptValue(decoded, false))
	if err != nil {
		return redactTerminalChunk(rawLine)
	}
	return redactTerminalChunk(encoded)
}

func redactCodexAppServerTranscriptValue(value any, redact bool) any {
	switch typed := value.(type) {
	case map[string]any:
		redactMap := redact || codexAppServerTranscriptMapIsUserInput(typed)
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			lowerKey := strings.ToLower(key)
			if codexAppServerTranscriptAlwaysSensitiveKey(lowerKey) || (redactMap && codexAppServerTranscriptUserSensitiveKey(lowerKey)) {
				out[key] = "[redacted user input]"
				continue
			}
			out[key] = redactCodexAppServerTranscriptValue(child, redactMap)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, child := range typed {
			out[i] = redactCodexAppServerTranscriptValue(child, redact)
		}
		return out
	case string:
		if redact {
			return "[redacted user input]"
		}
		return typed
	default:
		return typed
	}
}

func codexAppServerTranscriptMapIsUserInput(value map[string]any) bool {
	for _, key := range []string{"type", "role", "kind"} {
		switch strings.ToLower(strings.TrimSpace(stringValue(value[key]))) {
		case "user", "usermessage", "user_message", "input_text", "inputtext":
			return true
		}
	}
	return false
}

func codexAppServerTranscriptAlwaysSensitiveKey(key string) bool {
	switch key {
	case "input", "prompt", "prompts", "context", "messages", "baseinstructions":
		return true
	default:
		return false
	}
}

func codexAppServerTranscriptUserSensitiveKey(key string) bool {
	switch key {
	case "text", "content", "message", "messages", "delta", "input", "prompt":
		return true
	default:
		return false
	}
}

func (s *codexAppServerSession) request(ctx context.Context, method string, params map[string]any) (map[string]any, error) {
	id := s.nextRequestID()
	ch := make(chan codexRPCMessage, 1)
	s.pendingMu.Lock()
	s.pending[id] = ch
	s.pendingMu.Unlock()
	defer func() {
		s.pendingMu.Lock()
		delete(s.pending, id)
		s.pendingMu.Unlock()
	}()
	if err := s.write(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case msg := <-ch:
		if msg.Error != nil {
			return nil, fmt.Errorf("%s", sanitizeCLIStatusLine(msg.Error.Message))
		}
		return msg.Result, nil
	}
}

func (s *codexAppServerSession) nextRequestID() string {
	s.nextID++
	return fmt.Sprintf("arlecchino-%d", s.nextID)
}

func (s *codexAppServerSession) write(value any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	encoder := json.NewEncoder(s.stdin)
	return encoder.Encode(value)
}

func (s *codexAppServerSession) writeResponse(id any, result any) {
	if id == nil {
		return
	}
	_ = s.write(map[string]any{"id": id, "result": result})
}

func (s *codexAppServerSession) writeError(id any, code int, message string) {
	if id == nil {
		return
	}
	_ = s.write(map[string]any{"id": id, "error": map[string]any{"code": code, "message": message}})
}

func (s *codexAppServerSession) handleLine(line []byte) {
	var msg codexRPCMessage
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.UseNumber()
	if err := decoder.Decode(&msg); err != nil {
		s.emit(Event{
			RunID:     s.runID,
			Type:      EventStatus,
			Status:    "notice.diagnostic",
			Text:      "Codex app-server emitted malformed JSON; event was kept as bounded transcript evidence.",
			Payload:   map[string]any{"failureCode": FailureProtocolDrift},
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}
	if msg.Method != "" && msg.ID != nil {
		s.handleServerRequest(msg)
		return
	}
	if msg.ID != nil {
		key := requestIDKey(msg.ID)
		s.pendingMu.Lock()
		ch := s.pending[key]
		s.pendingMu.Unlock()
		if ch != nil {
			ch <- msg
		}
		return
	}
	if msg.Method != "" {
		s.observer.Observe(msg.Method, msg.Params)
	}
}

func (s *codexAppServerSession) handleServerRequest(msg codexRPCMessage) {
	text := sanitizedEventText(codexEventText(msg.Params))
	if text == "" {
		text = "Codex app-server requested provider-native action."
	}
	switch msg.Method {
	case "execCommandApproval", "applyPatchApproval":
		s.emit(Event{RunID: s.runID, Type: EventStatus, Status: "approval.blocked", Text: text, Payload: codexAppServerBlockedPayload(msg.Method, msg.Params, FailureProviderApprovalBypass), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		s.observer.block("Codex app-server requested a provider-native approval that must be represented as an Arlecchino proposal before it can proceed.")
		s.writeResponse(msg.ID, map[string]any{"decision": "denied"})
	case "item/commandExecution/requestApproval":
		s.emit(Event{RunID: s.runID, Type: EventStatus, Status: "approval.blocked", Text: text, Payload: codexAppServerBlockedPayload(msg.Method, msg.Params, FailureProviderApprovalBypass), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		s.observer.block("Codex app-server requested command approval outside Arlecchino approval mapping.")
		s.writeResponse(msg.ID, map[string]any{"decision": "cancel"})
	case "item/fileChange/requestApproval":
		s.emit(Event{RunID: s.runID, Type: EventStatus, Status: "approval.blocked", Text: text, Payload: codexAppServerBlockedPayload(msg.Method, msg.Params, FailureProviderApprovalBypass), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		s.observer.block("Codex app-server requested file-change approval outside Arlecchino patch artifact mapping.")
		s.writeResponse(msg.ID, map[string]any{"decision": "cancel"})
	case "item/permissions/requestApproval":
		s.emit(Event{RunID: s.runID, Type: EventStatus, Status: "approval.blocked", Text: text, Payload: codexAppServerBlockedPayload(msg.Method, msg.Params, FailureExpandedPermissionDenied), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		s.observer.block("Codex app-server requested expanded permissions outside Arlecchino policy.")
		s.writeResponse(msg.ID, map[string]any{"permissions": map[string]any{}, "scope": "turn", "strictAutoReview": true})
	default:
		s.emit(Event{RunID: s.runID, Type: EventStatus, Status: "server_request.blocked", Text: text, Payload: codexAppServerBlockedPayload(msg.Method, msg.Params, FailureUnsupportedHostCallback), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		s.observer.block("Codex app-server requested an unsupported host callback: " + msg.Method)
		s.writeError(msg.ID, -32601, "unsupported Arlecchino app-server callback")
	}
}

func (s *codexAppServerSession) interruptTurn(ctx context.Context) error {
	threadID, turnID := s.observer.ids()
	if threadID == "" || turnID == "" {
		return nil
	}
	interruptCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_, err := s.request(interruptCtx, "turn/interrupt", map[string]any{"threadId": threadID, "turnId": turnID})
	return err
}

func (s *codexAppServerSession) shutdown() {
	_ = s.stdin.Close()
	s.signalProcessGroup(syscall.SIGTERM)
	if s.waitForProcess(2 * time.Second) {
		return
	}
	s.signalProcessGroup(syscall.SIGKILL)
	s.waitForProcess(500 * time.Millisecond)
}

func (s *codexAppServerSession) noteProcessDone(err error) {
	s.processMu.Lock()
	defer s.processMu.Unlock()
	if s.processSet {
		return
	}
	s.processErr = err
	s.processSet = true
}

func (s *codexAppServerSession) processDoneRecorded() bool {
	s.processMu.Lock()
	defer s.processMu.Unlock()
	return s.processSet
}

func (s *codexAppServerSession) waitForProcess(timeout time.Duration) bool {
	if s == nil || s.processDone == nil || s.processDoneRecorded() {
		return true
	}
	if timeout <= 0 {
		select {
		case err := <-s.processDone:
			s.noteProcessDone(err)
			return true
		default:
			return false
		}
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-s.processDone:
		s.noteProcessDone(err)
		return true
	case <-timer.C:
		return s.processDoneRecorded()
	}
}

func (s *codexAppServerSession) signalProcessGroup(signal syscall.Signal) {
	if s == nil || s.cmd == nil || s.cmd.Process == nil || s.processDoneRecorded() {
		return
	}
	pid := s.cmd.Process.Pid
	if pid <= 0 {
		_ = s.cmd.Process.Signal(signal)
		return
	}
	_ = syscall.Kill(-pid, signal)
}

func (s *codexAppServerSession) errorResult(message string, err error, startedAt string) Result {
	text := message
	if err != nil {
		text = message + " " + err.Error()
	}
	return Result{Status: "error", Message: message, Error: sanitizeCLIStatusLine(text), ExitCode: -1, Transport: TransportAppServerSTDIO, Transcript: s.transcript.String(), StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
}

func newCodexAppServerObserver(runID string, emit func(Event)) *codexAppServerObserver {
	return &codexAppServerObserver{
		runID: strings.TrimSpace(runID),
		emit:  emit,
		done:  make(chan struct{}),
	}
}

func (o *codexAppServerObserver) Observe(method string, params map[string]any) {
	if o == nil || o.emit == nil {
		return
	}
	o.emitFirstProviderEvent(method)
	if method == "thread/started" {
		if id := stringFromPath(params, "thread", "id"); id != "" {
			o.setThreadID(id)
		}
	}
	if method == "turn/started" {
		if id := stringFromPath(params, "turn", "id"); id != "" {
			o.setTurnID(id)
		}
	}
	text := codexAppServerStatusText(method, params)
	switch method {
	case "item/agentMessage/delta":
		text = codexAppServerAgentMessageDeltaText(params)
		if text != "" {
			o.appendMessageDelta(text)
			o.emit(Event{RunID: o.runID, Type: EventMessage, Status: "message.delta", Text: text, Payload: codexAppServerEventPayload(method, params), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
			return
		}
	case "item/completed":
		text = codexAppServerCompletedMessageText(params)
		if text != "" {
			o.setFinalMessage(text)
			o.emit(Event{RunID: o.runID, Type: EventMessage, Status: "message.final", Text: text, Payload: codexAppServerEventPayload(method, params), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
			return
		}
	case "turn/completed":
		if failed, reason := codexAppServerTurnFailure(params); failed {
			if reason == "" {
				reason = firstNonEmpty(text, "Codex app-server turn failed.")
			}
			o.emit(Event{RunID: o.runID, Type: EventError, Status: "turn.failed", Text: reason, Payload: codexAppServerBlockedPayload(method, params, FailureProviderError), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
			o.block(reason)
			return
		}
		o.emit(Event{RunID: o.runID, Type: EventStatus, Status: method, Text: firstNonEmpty(text, "Codex app-server turn completed."), Payload: codexAppServerEventPayload(method, params), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
		o.complete()
		return
	case "error":
		text = firstNonEmpty(codexAppServerErrorText(params), text, "Codex app-server emitted an error.")
		o.block(text)
	}
	o.emit(Event{RunID: o.runID, Type: EventStatus, Status: method, Text: firstNonEmpty(text, "Codex app-server event received."), Payload: codexAppServerEventPayload(method, params), CreatedAt: time.Now().UTC().Format(time.RFC3339)})
}

func (o *codexAppServerObserver) emitFirstProviderEvent(method string) {
	o.mu.Lock()
	if o.firstEvent {
		o.mu.Unlock()
		return
	}
	o.firstEvent = true
	o.mu.Unlock()
	o.emit(Event{
		RunID:     o.runID,
		Type:      EventStatus,
		Status:    "first_provider_event",
		Text:      "First Codex app-server event received.",
		Payload:   map[string]any{"providerEventType": strings.TrimSpace(method)},
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (o *codexAppServerObserver) setThreadID(threadID string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if strings.TrimSpace(threadID) != "" {
		o.threadID = strings.TrimSpace(threadID)
	}
}

func (o *codexAppServerObserver) setTurnID(turnID string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if strings.TrimSpace(turnID) != "" {
		o.turnID = strings.TrimSpace(turnID)
	}
}

func (o *codexAppServerObserver) ids() (string, string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.threadID, o.turnID
}

func (o *codexAppServerObserver) appendMessageDelta(text string) {
	if text == "" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.finalMessage.WriteString(text)
}

func (o *codexAppServerObserver) setFinalMessage(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.finalMessage.Reset()
	o.finalMessage.WriteString(text)
}

func (o *codexAppServerObserver) FinalMessage() string {
	if o == nil {
		return ""
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return strings.TrimSpace(o.finalMessage.String())
}

func (o *codexAppServerObserver) block(message string) {
	o.mu.Lock()
	if o.blockedError == "" {
		o.blockedError = strings.TrimSpace(message)
	}
	alreadyCompleted := o.completed
	o.completed = true
	o.mu.Unlock()
	if !alreadyCompleted {
		close(o.done)
	}
}

func (o *codexAppServerObserver) complete() {
	o.mu.Lock()
	alreadyCompleted := o.completed
	o.completed = true
	o.mu.Unlock()
	if !alreadyCompleted {
		close(o.done)
	}
}

func (o *codexAppServerObserver) errorText() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return strings.TrimSpace(o.blockedError)
}

func requestIDKey(id any) string {
	switch typed := id.(type) {
	case json.Number:
		return typed.String()
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func codexModelForRequest(model string) any {
	model = strings.TrimSpace(model)
	if model == "" || model == codexDefaultModelID {
		return nil
	}
	return model
}

func codexAppServerArgs(req RunRequest) []string {
	args := []string{"app-server", "--listen", "stdio://", "-c", "mcp_servers={}"}
	for _, feature := range codexAppServerDisabledFeatures {
		args = append(args, "--disable", feature)
	}
	if effort := codexReasoningEffortForRequest(req.ReasoningEffort); effort != "" {
		args = append(args, "-c", "model_reasoning_effort=\""+effort+"\"")
	}
	return args
}

func codexAppServerTextInput(prompt string) map[string]any {
	return map[string]any{
		"type":          "text",
		"text":          prompt,
		"text_elements": []map[string]any{},
	}
}

func codexAppServerSandboxPolicy(action string, root string) map[string]any {
	switch codexSandboxForAction(action) {
	case "workspace-write":
		return map[string]any{"type": "workspaceWrite", "networkAccess": false, "writableRoots": []string{root}, "excludeTmpdirEnvVar": false, "excludeSlashTmp": false}
	default:
		return map[string]any{"type": "readOnly", "networkAccess": false}
	}
}

func codexAppServerBlockedPayload(method string, params map[string]any, failureCode string) map[string]any {
	payload := codexAppServerEventPayload(method, params)
	payload["failureCode"] = failureCode
	return payload
}

func codexAppServerEventPayload(method string, params map[string]any) map[string]any {
	payload := map[string]any{"providerEventType": strings.TrimSpace(method)}
	if threadID := firstNonEmpty(stringFromPath(params, "thread", "id"), stringFromPath(params, "threadId")); threadID != "" {
		payload["threadId"] = threadID
	}
	if turnID := firstNonEmpty(stringFromPath(params, "turn", "id"), stringFromPath(params, "turnId")); turnID != "" {
		payload["turnId"] = turnID
	}
	if itemID := firstNonEmpty(stringFromPath(params, "item", "id"), stringFromPath(params, "itemId")); itemID != "" {
		payload["itemId"] = itemID
	}
	if itemType := codexAppServerItemKind(params); itemType != "" {
		payload["itemType"] = itemType
	}
	if status := firstNonEmpty(stringFromPath(params, "turn", "status"), stringFromPath(params, "status")); status != "" {
		payload["status"] = sanitizedEventText(status)
	}
	return payload
}

func codexAppServerStatusText(method string, params map[string]any) string {
	switch method {
	case "thread/started":
		return "Codex app-server thread started."
	case "turn/started":
		return "Codex app-server turn started."
	case "turn/completed":
		return "Codex app-server turn completed."
	case "item/started", "item/completed":
		if kind := codexAppServerItemKind(params); kind != "" {
			return "Codex app-server " + strings.TrimPrefix(method, "item/") + " " + kind + " item."
		}
	case "item/reasoning/textDelta":
		return "Codex app-server reasoning delta received."
	case "thread/realtime/transcript/delta":
		return "Codex app-server transcript delta received."
	case "error":
		return codexAppServerErrorText(params)
	}
	return "Codex app-server event received."
}

func codexAppServerItemKind(params map[string]any) string {
	return sanitizedEventText(firstNonEmpty(
		stringFromPath(params, "item", "type"),
		stringFromPath(params, "item", "kind"),
		stringFromPath(params, "item", "role"),
		stringFromPath(params, "message", "role"),
	))
}

func codexAppServerErrorText(params map[string]any) string {
	return sanitizedEventText(firstNonEmpty(
		stringFromPath(params, "error", "message"),
		stringFromPath(params, "error"),
		stringFromPath(params, "message"),
	))
}

func stringFromPath(value map[string]any, path ...string) string {
	var current any = value
	for _, key := range path {
		mapping, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = mapping[key]
	}
	return stringValue(current)
}

func codexAppServerAgentMessageDeltaText(params map[string]any) string {
	return sanitizedMessageText(firstNonEmpty(
		stringFromPath(params, "delta"),
		stringFromPath(params, "message", "delta"),
		stringFromPath(params, "message", "text"),
		stringFromPath(params, "message", "content"),
		stringFromPath(params, "text"),
	))
}

func codexAppServerCompletedMessageText(params map[string]any) string {
	if !codexAppServerCompletedItemIsAssistantMessage(params) {
		return ""
	}
	return sanitizedMessageText(firstNonEmpty(
		stringFromPath(params, "item", "text"),
		stringFromPath(params, "item", "content"),
		stringFromPath(params, "item", "message", "text"),
		stringFromPath(params, "item", "message", "content"),
		stringFromPath(params, "message", "text"),
		stringFromPath(params, "message", "content"),
		stringFromPath(params, "text"),
	))
}

func codexAppServerCompletedItemIsAssistantMessage(params map[string]any) bool {
	kind := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		stringFromPath(params, "item", "type"),
		stringFromPath(params, "item", "kind"),
		stringFromPath(params, "item", "role"),
		stringFromPath(params, "message", "role"),
	)))
	if kind == "" {
		return stringFromPath(params, "item", "text") != "" ||
			stringFromPath(params, "item", "content") != "" ||
			stringFromPath(params, "item", "message", "text") != "" ||
			stringFromPath(params, "item", "message", "content") != "" ||
			stringFromPath(params, "message", "text") != "" ||
			stringFromPath(params, "message", "content") != ""
	}
	if codexNonAnswerKind(kind) {
		return false
	}
	return kind == "message" ||
		kind == "assistant" ||
		strings.Contains(kind, "assistant") ||
		strings.Contains(kind, "agent_message") ||
		strings.Contains(kind, "agentmessage")
}

func codexAppServerTurnFailure(params map[string]any) (bool, string) {
	status := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		stringFromPath(params, "turn", "status"),
		stringFromPath(params, "status"),
	)))
	switch status {
	case "failed", "error", "interrupted", "canceled", "cancelled":
		reason := sanitizedEventText(firstNonEmpty(
			stringFromPath(params, "turn", "error", "message"),
			stringFromPath(params, "turn", "error"),
			stringFromPath(params, "error", "message"),
			stringFromPath(params, "error"),
			stringFromPath(params, "turn", "message"),
			stringFromPath(params, "message"),
		))
		if reason == "" {
			reason = "Codex app-server turn ended with status " + status + "."
		}
		return true, reason
	default:
		return false, ""
	}
}

func codexNonAnswerKind(kind string) bool {
	kind = strings.ToLower(strings.TrimSpace(kind))
	return strings.Contains(kind, "reason") ||
		strings.Contains(kind, "command") ||
		strings.Contains(kind, "exec") ||
		strings.Contains(kind, "file") ||
		strings.Contains(kind, "tool") ||
		strings.Contains(kind, "patch") ||
		strings.Contains(kind, "diff") ||
		strings.Contains(kind, "transcript")
}

func exitCodeFromWaitErr(waitErr error) int {
	if waitErr == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}
