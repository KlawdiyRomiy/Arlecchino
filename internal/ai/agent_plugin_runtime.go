package ai

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// AgentPluginRuntimeProtocolV1 is deliberately a small JSONL host protocol.
// Plugins receive neither a project path nor an IDE API: every requested host
// action is mediated below through the normal tool gateway.
const AgentPluginRuntimeProtocolV1 = "arlecchino-agent-plugin-runtime/v1"

const (
	maxAgentPluginWireBytes       = 64 * 1024
	maxAgentPluginRequests        = 256
	maxAgentPluginToolCalls       = 32
	maxAgentPluginSubscriptions   = 16
	maxAgentPluginWidgetValue     = 4 * 1024
	defaultAgentPluginRunTimeout  = 30 * time.Second
	maxAgentPluginRunTimeout      = 120 * time.Second
	maxAgentPluginStderrBytes     = 16 * 1024
	maxAgentPluginArgumentBytes   = 16 * 1024
	maxAgentPluginArgumentEntries = 32
)

var agentPluginRuntimeTopics = map[string]struct{}{
	"runtime.status": {},
	"tool.result":    {},
	"host.notice":    {},
}

// AIAgentPluginHostEvent is a bounded, typed event that a sandboxed plugin
// may receive only after it subscribes to its topic. It never carries a raw
// runtime transcript or implicit project context.
type AIAgentPluginHostEvent struct {
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// AIAgentPluginRuntimeRequest runs one reviewed plugin turn. RunID is
// required so every tool proposal is attached to the normal chat-run audit
// and approval boundary.
type AIAgentPluginRuntimeRequest struct {
	RunID  string                   `json:"runId"`
	Events []AIAgentPluginHostEvent `json:"events,omitempty"`
}

// AIAgentPluginRuntimeResult is host-owned execution evidence. A completed
// result only means the sandbox protocol completed; it does not imply that a
// requested tool was approved or executed.
type AIAgentPluginRuntimeResult struct {
	PluginID      string   `json:"pluginId"`
	RunID         string   `json:"runId"`
	Status        string   `json:"status"`
	ToolCallCount int      `json:"toolCallCount"`
	Subscriptions []string `json:"subscriptions,omitempty"`
	WidgetIDs     []string `json:"widgetIds,omitempty"`
	StartedAt     string   `json:"startedAt"`
	CompletedAt   string   `json:"completedAt"`
	Error         string   `json:"error,omitempty"`
}

// AIAgentPluginWidget is data-only. The host deliberately does not accept
// HTML, JavaScript, URLs, or arbitrary widget layouts from a plugin process.
type AIAgentPluginWidget struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Value    string `json:"value"`
	Priority int    `json:"priority,omitempty"`
}

type agentPluginWireMessage struct {
	Version   string               `json:"version,omitempty"`
	Type      string               `json:"type"`
	ID        string               `json:"id,omitempty"`
	Topics    []string             `json:"topics,omitempty"`
	Topic     string               `json:"topic,omitempty"`
	Payload   json.RawMessage      `json:"payload,omitempty"`
	ToolID    string               `json:"toolId,omitempty"`
	Action    AIToolCallAction     `json:"action,omitempty"`
	Arguments map[string]string    `json:"arguments,omitempty"`
	Widget    *AIAgentPluginWidget `json:"widget,omitempty"`
	Key       string               `json:"key,omitempty"`
	ValueJSON string               `json:"valueJson,omitempty"`
	Result    *AIToolCallResult    `json:"result,omitempty"`
	Error     string               `json:"error,omitempty"`
}

type agentPluginSandboxProcess struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	stderr  io.ReadCloser
	cleanup func()
}

// This private seam lets focused tests exercise the protocol without ever
// weakening the production launcher. Production always requires an OS
// sandbox; there is intentionally no unsandboxed fallback.
type agentPluginSandboxStarter func(context.Context, string, AIAgentPluginRunner) (*agentPluginSandboxProcess, error)

// RunAgentPluginSandbox starts a signed, enabled plugin in an operating-system
// sandbox. On hosts without the required sandbox facility it fails closed and
// records that fact instead of running plugin code with IDE privileges.
func (s *Service) RunAgentPluginSandbox(ctx context.Context, projectID, pluginID string, req AIAgentPluginRuntimeRequest) (AIAgentPluginRuntimeResult, error) {
	return s.runAgentPluginSandboxWithStarter(ctx, projectID, pluginID, req, startAgentPluginSandbox)
}

func (s *Service) runAgentPluginSandboxWithStarter(ctx context.Context, projectID, pluginID string, req AIAgentPluginRuntimeRequest, starter agentPluginSandboxStarter) (AIAgentPluginRuntimeResult, error) {
	project := s.project(normalizeProjectID(projectID))
	pluginID = strings.TrimSpace(pluginID)
	req.RunID = strings.TrimSpace(req.RunID)
	if project == nil || project.AgentPlugins == nil {
		return AIAgentPluginRuntimeResult{}, fmt.Errorf("AI project session is not open")
	}
	record, found, err := project.AgentPlugins.Get(pluginID)
	if err != nil {
		return AIAgentPluginRuntimeResult{}, err
	}
	if !found || !record.Enabled || !record.Reviewed {
		return AIAgentPluginRuntimeResult{}, fmt.Errorf("plugin %q must be reviewed and enabled before it can run", pluginID)
	}
	// JSONL storage is an audit ledger, not a trust boundary. Revalidate the
	// persisted signed manifest before every process launch so a modified ledger
	// cannot swap the reviewed runner or widen capabilities.
	if err := validateAgentPluginManifest(record.Manifest); err != nil {
		s.emitAgentPluginEvent(project, pluginID, "runtime_blocked", "Persisted plugin manifest no longer verifies.", req.RunID)
		return AIAgentPluginRuntimeResult{}, fmt.Errorf("persisted plugin manifest is invalid: %w", err)
	}
	if req.RunID == "" {
		return AIAgentPluginRuntimeResult{}, fmt.Errorf("plugin runtime requires a chat run id")
	}
	if _, err := s.GetChatRun(project.ID, req.RunID); err != nil {
		return AIAgentPluginRuntimeResult{}, err
	}
	if len(record.Manifest.Runner.Command) == 0 {
		s.emitAgentPluginEvent(project, pluginID, "runtime_blocked", "Plugin has no signed sandbox runner.", req.RunID)
		return AIAgentPluginRuntimeResult{}, fmt.Errorf("plugin %q has no signed sandbox runner", pluginID)
	}
	if agentPluginPathWithinProject(project.ProjectRoot, record.Manifest.Runner.Command[0]) {
		s.emitAgentPluginEvent(project, pluginID, "runtime_blocked", "Plugin runner inside the active project is not permitted.", req.RunID)
		return AIAgentPluginRuntimeResult{}, fmt.Errorf("plugin runner must not be located inside the active project")
	}
	if starter == nil {
		return AIAgentPluginRuntimeResult{}, fmt.Errorf("plugin sandbox launcher is unavailable")
	}

	hostEvents, err := normalizeAgentPluginHostEvents(req.Events)
	if err != nil {
		return AIAgentPluginRuntimeResult{}, err
	}
	hostEvents = append([]AIAgentPluginHostEvent{{Topic: "runtime.status", Payload: json.RawMessage(`{"status":"started"}`)}}, hostEvents...)
	timeout := agentPluginRunnerTimeout(record.Manifest.Runner)
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	result := AIAgentPluginRuntimeResult{PluginID: pluginID, RunID: req.RunID, Status: "running", StartedAt: utcNow()}
	process, err := starter(runCtx, project.ProjectRoot, record.Manifest.Runner)
	if err != nil {
		result.Status = "blocked"
		result.CompletedAt = utcNow()
		result.Error = "sandbox launcher unavailable"
		s.emitAgentPluginEvent(project, pluginID, "runtime_blocked", "Plugin sandbox launcher is unavailable.", req.RunID)
		return result, err
	}
	defer process.cleanup()
	if process == nil || process.cmd == nil || process.stdin == nil || process.stdout == nil || process.stderr == nil {
		return AIAgentPluginRuntimeResult{}, fmt.Errorf("plugin sandbox launcher returned an incomplete process")
	}
	defer process.stdin.Close()
	defer process.stdout.Close()
	defer process.stderr.Close()
	go func() {
		// Stderr is intentionally not surfaced to the model, UI, or plugin. It
		// is drained only so a misbehaving process cannot block itself.
		_, _ = io.Copy(io.Discard, io.LimitReader(process.stderr, maxAgentPluginStderrBytes))
	}()

	s.emitAgentPluginEvent(project, pluginID, "runtime_started", "Sandboxed plugin runtime started.", req.RunID)
	var writeMu sync.Mutex
	send := func(message agentPluginWireMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return writeAgentPluginWireMessage(process.stdin, message)
	}
	if err := send(agentPluginWireMessage{
		Version: AgentPluginRuntimeProtocolV1,
		Type:    "host.hello",
		Payload: mustMarshalAgentPluginPayload(map[string]any{
			"pluginId":     pluginID,
			"runId":        req.RunID,
			"capabilities": record.Manifest.Capabilities,
		}),
	}); err != nil {
		_ = process.cmd.Process.Kill()
		_ = process.cmd.Wait()
		return s.finishAgentPluginRuntime(project, result, "crashed", "Plugin sandbox did not accept host input."), err
	}

	subscriptions := map[string]struct{}{}
	widgetIDs := map[string]struct{}{}
	toolCalls := 0
	requestCount := 0
	helloSeen := false
	completed := false
	var protocolErr error

	sendSubscribedEvent := func(event AIAgentPluginHostEvent) error {
		if _, subscribed := subscriptions[event.Topic]; !subscribed {
			return nil
		}
		return send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "event", Topic: event.Topic, Payload: event.Payload})
	}

	scanner := bufio.NewScanner(process.stdout)
	scanner.Buffer(make([]byte, 4*1024), maxAgentPluginWireBytes)
	for scanner.Scan() {
		requestCount++
		if requestCount > maxAgentPluginRequests {
			protocolErr = fmt.Errorf("plugin runtime exceeded the request limit")
			break
		}
		message, err := parseAgentPluginWireMessage(scanner.Bytes())
		if err != nil {
			protocolErr = err
			break
		}
		if !helloSeen {
			if message.Type != "plugin.hello" || message.Version != AgentPluginRuntimeProtocolV1 {
				protocolErr = fmt.Errorf("plugin did not establish the required runtime protocol")
				break
			}
			helloSeen = true
			if err := send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "host.ready"}); err != nil {
				protocolErr = err
				break
			}
			continue
		}
		if message.Version != "" && message.Version != AgentPluginRuntimeProtocolV1 {
			protocolErr = fmt.Errorf("plugin sent an unsupported protocol version")
			break
		}

		switch message.Type {
		case "subscribe":
			if !pluginHasCapability(record.Manifest, AIAgentPluginCapabilityEvents) {
				_ = sendAgentPluginProtocolError(send, message.ID, "events.read capability was not granted")
				continue
			}
			if err := addAgentPluginSubscriptions(subscriptions, message.Topics); err != nil {
				_ = sendAgentPluginProtocolError(send, message.ID, err.Error())
				continue
			}
			if err := send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "subscription.accepted", ID: message.ID, Topics: sortedAgentPluginTopics(subscriptions)}); err != nil {
				protocolErr = err
				break
			}
			for _, event := range hostEvents {
				if err := sendSubscribedEvent(event); err != nil {
					protocolErr = err
					break
				}
			}
		case "tool.call":
			if toolCalls >= maxAgentPluginToolCalls {
				_ = sendAgentPluginProtocolError(send, message.ID, "plugin runtime exceeded the tool-call limit")
				continue
			}
			toolCalls++
			result.ToolCallCount = toolCalls
			toolResult := s.executeAgentPluginToolCall(runCtx, project, record.Manifest, req.RunID, message)
			if err := send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "tool.result", ID: message.ID, Result: &toolResult}); err != nil {
				protocolErr = err
				break
			}
			payload := mustMarshalAgentPluginPayload(toolResult)
			if err := sendSubscribedEvent(AIAgentPluginHostEvent{Topic: "tool.result", Payload: payload}); err != nil {
				protocolErr = err
				break
			}
		case "widget.register":
			if !pluginHasCapability(record.Manifest, AIAgentPluginCapabilityStatusWidget) || message.Widget == nil {
				_ = sendAgentPluginProtocolError(send, message.ID, "status.widget capability was not granted")
				continue
			}
			widget, err := validateAgentPluginWidget(record.Manifest, *message.Widget)
			if err != nil {
				_ = sendAgentPluginProtocolError(send, message.ID, err.Error())
				continue
			}
			widgetIDs[widget.ID] = struct{}{}
			s.emitEvent("ai:plugin:widget", map[string]any{"pluginId": pluginID, "runId": req.RunID, "widget": widget})
			s.emitAgentPluginEvent(project, pluginID, "widget_registered", "Plugin registered a validated data-only status widget.", req.RunID)
			if err := send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "widget.accepted", ID: message.ID, Widget: &widget}); err != nil {
				protocolErr = err
				break
			}
		case "storage.get":
			if !pluginHasCapability(record.Manifest, AIAgentPluginCapabilityStorage) {
				_ = sendAgentPluginProtocolError(send, message.ID, "storage capability was not granted")
				continue
			}
			value, err := s.GetAgentPluginStorage(project.ID, pluginID, message.Key)
			if err != nil {
				_ = sendAgentPluginProtocolError(send, message.ID, "plugin storage value is unavailable")
				continue
			}
			if err := send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "storage.result", ID: message.ID, Key: value.Key, ValueJSON: value.ValueJSON}); err != nil {
				protocolErr = err
				break
			}
		case "storage.put":
			if !pluginHasCapability(record.Manifest, AIAgentPluginCapabilityStorage) {
				_ = sendAgentPluginProtocolError(send, message.ID, "storage capability was not granted")
				continue
			}
			value, err := s.PutAgentPluginStorage(project.ID, AIAgentPluginStorageValue{PluginID: pluginID, Key: message.Key, ValueJSON: message.ValueJSON})
			if err != nil {
				_ = sendAgentPluginProtocolError(send, message.ID, "plugin storage value was rejected")
				continue
			}
			if err := send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "storage.result", ID: message.ID, Key: value.Key, ValueJSON: value.ValueJSON}); err != nil {
				protocolErr = err
				break
			}
		case "complete":
			completed = true
			if err := send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "host.complete", ID: message.ID}); err != nil {
				protocolErr = err
			}
			// The host closes stdin after the loop. A complete message does not
			// let a plugin keep a warm, unbounded sidecar alive.
			break
		default:
			_ = sendAgentPluginProtocolError(send, message.ID, "unsupported plugin runtime request")
		}
		if protocolErr != nil || completed {
			break
		}
	}
	if scanErr := scanner.Err(); scanErr != nil && protocolErr == nil {
		protocolErr = fmt.Errorf("plugin runtime output is invalid or exceeds the message limit")
	}
	_ = process.stdin.Close()
	if protocolErr != nil || !completed || runCtx.Err() != nil {
		_ = process.cmd.Process.Kill()
	}
	waitErr := process.cmd.Wait()

	result.Subscriptions = sortedAgentPluginTopics(subscriptions)
	result.WidgetIDs = sortedAgentPluginTopics(widgetIDs)
	if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		return s.finishAgentPluginRuntime(project, result, "timed_out", "Plugin sandbox exceeded its reviewed time limit."), nil
	}
	if errors.Is(runCtx.Err(), context.Canceled) {
		return s.finishAgentPluginRuntime(project, result, "canceled", "Plugin sandbox was canceled."), nil
	}
	if protocolErr != nil {
		return s.finishAgentPluginRuntime(project, result, "protocol_error", "Plugin sandbox protocol failed."), protocolErr
	}
	if waitErr != nil || !completed {
		return s.finishAgentPluginRuntime(project, result, "crashed", "Plugin sandbox exited without a completed protocol turn."), nil
	}
	return s.finishAgentPluginRuntime(project, result, "completed", "Sandboxed plugin runtime completed."), nil
}

func (s *Service) finishAgentPluginRuntime(project *ProjectSession, result AIAgentPluginRuntimeResult, status, summary string) AIAgentPluginRuntimeResult {
	result.Status = status
	result.CompletedAt = utcNow()
	s.emitAgentPluginEvent(project, result.PluginID, "runtime_"+status, summary, result.RunID)
	s.emitEvent("ai:plugin:runtime", result)
	return result
}

func (s *Service) executeAgentPluginToolCall(ctx context.Context, project *ProjectSession, manifest AIAgentPluginManifest, runID string, message agentPluginWireMessage) AIToolCallResult {
	arguments, err := normalizeAgentPluginToolArguments(message.Arguments)
	if err != nil {
		return blockedAgentPluginToolResult(message, err.Error())
	}
	if reason := agentPluginToolPermission(manifest, message.ToolID, message.Action, s); reason != "" {
		return blockedAgentPluginToolResult(message, reason)
	}
	result, err := s.ExecuteToolCall(ctx, project.ID, AIToolCallRequest{RunID: runID, ToolID: message.ToolID, Action: message.Action, Arguments: arguments})
	if err != nil {
		return blockedAgentPluginToolResult(message, "host tool call was rejected")
	}
	return result
}

func blockedAgentPluginToolResult(message agentPluginWireMessage, reason string) AIToolCallResult {
	return AIToolCallResult{ToolID: strings.TrimSpace(message.ToolID), Action: message.Action, Status: "blocked", Error: sanitizedDisplayText(reason), CreatedAt: utcNow()}
}

func agentPluginToolPermission(manifest AIAgentPluginManifest, toolID string, action AIToolCallAction, service *Service) string {
	if action != AIToolCallActionPreview && action != AIToolCallActionExecute {
		return "plugins may request preview or read-only execution only; approval grants belong to the user"
	}
	descriptor, found := service.toolDescriptor(toolID)
	if !found || !descriptor.ExecutionAvailable {
		return "requested host tool is unavailable"
	}
	if pluginHasCapability(manifest, AIAgentPluginCapabilityContextRead) && agentPluginReadToolIDs[toolID] {
		return ""
	}
	if action == AIToolCallActionPreview && pluginHasCapability(manifest, AIAgentPluginCapabilityToolPropose) && agentPluginPreviewToolIDs[toolID] {
		return ""
	}
	return "plugin capability does not permit this host tool request"
}

var agentPluginReadToolIDs = map[string]bool{
	"context.read":     true,
	"diagnostics.read": true,
	"semantic.query":   true,
	"file.read_range":  true,
	"workspace.grep":   true,
	"git.preview":      true,
	"memory.search":    true,
	"memory.context":   true,
}

var agentPluginPreviewToolIDs = map[string]bool{
	"file.patch.preview":  true,
	"file.edit.preview":   true,
	"file.create.preview": true,
	"terminal.preview":    true,
	"mcp.preview":         true,
	"subagent.preview":    true,
}

func normalizeAgentPluginToolArguments(arguments map[string]string) (map[string]string, error) {
	if len(arguments) > maxAgentPluginArgumentEntries {
		return nil, fmt.Errorf("plugin tool arguments exceed the entry limit")
	}
	normalized := make(map[string]string, len(arguments))
	total := 0
	for key, value := range arguments {
		key = strings.TrimSpace(key)
		if key == "" || len(key) > 96 || len(value) > 8*1024 {
			return nil, fmt.Errorf("plugin tool arguments are invalid")
		}
		total += len(key) + len(value)
		if total > maxAgentPluginArgumentBytes {
			return nil, fmt.Errorf("plugin tool arguments exceed the size limit")
		}
		normalized[key] = value
	}
	// A plugin cannot turn an otherwise bounded context read into an implicit
	// Mnemonic, MCP, or skill export merely by supplying these toggles.
	if _, requested := normalized["mnemonic"]; requested {
		normalized["mnemonic"] = "false"
	}
	if _, requested := normalized["mcp"]; requested {
		normalized["mcp"] = "false"
	}
	if _, requested := normalized["skills"]; requested {
		normalized["skills"] = "false"
	}
	return normalized, nil
}

func validateAgentPluginWidget(manifest AIAgentPluginManifest, widget AIAgentPluginWidget) (AIAgentPluginWidget, error) {
	widget.ID = strings.TrimSpace(widget.ID)
	allowed := false
	for _, widgetID := range manifest.WidgetIDs {
		if widget.ID == widgetID {
			allowed = true
			break
		}
	}
	if !allowed {
		return AIAgentPluginWidget{}, fmt.Errorf("widget id is not declared by the reviewed manifest")
	}
	widget.Kind = strings.TrimSpace(widget.Kind)
	switch widget.Kind {
	case "status", "metric", "text":
	default:
		return AIAgentPluginWidget{}, fmt.Errorf("widget kind is not supported")
	}
	if len(widget.Title) == 0 || len(widget.Title) > 160 || len(widget.Value) > maxAgentPluginWidgetValue || widget.Priority < 0 || widget.Priority > 100 {
		return AIAgentPluginWidget{}, fmt.Errorf("widget data exceeds host limits")
	}
	widget.Title = sanitizedDisplayText(widget.Title)
	widget.Value = sanitizedDisplayText(widget.Value)
	if widget.Title == "" {
		return AIAgentPluginWidget{}, fmt.Errorf("widget title is empty")
	}
	return widget, nil
}

func addAgentPluginSubscriptions(subscriptions map[string]struct{}, topics []string) error {
	if len(topics) == 0 {
		return fmt.Errorf("plugin subscription has no topics")
	}
	for _, topic := range topics {
		topic = strings.TrimSpace(topic)
		if _, allowed := agentPluginRuntimeTopics[topic]; !allowed {
			return fmt.Errorf("plugin subscription topic is not allowed")
		}
		if _, exists := subscriptions[topic]; !exists && len(subscriptions) >= maxAgentPluginSubscriptions {
			return fmt.Errorf("plugin subscription limit exceeded")
		}
		subscriptions[topic] = struct{}{}
	}
	return nil
}

func sortedAgentPluginTopics(values map[string]struct{}) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func normalizeAgentPluginHostEvents(events []AIAgentPluginHostEvent) ([]AIAgentPluginHostEvent, error) {
	if len(events) > maxAgentPluginSubscriptions {
		return nil, fmt.Errorf("plugin host event limit exceeded")
	}
	normalized := make([]AIAgentPluginHostEvent, 0, len(events))
	for _, event := range events {
		event.Topic = strings.TrimSpace(event.Topic)
		if _, allowed := agentPluginRuntimeTopics[event.Topic]; !allowed {
			return nil, fmt.Errorf("plugin host event topic is not allowed")
		}
		if len(event.Payload) == 0 {
			event.Payload = json.RawMessage(`{}`)
		}
		if len(event.Payload) > maxAgentPluginWireBytes/2 || !json.Valid(event.Payload) {
			return nil, fmt.Errorf("plugin host event payload is invalid")
		}
		normalized = append(normalized, event)
	}
	return normalized, nil
}

func parseAgentPluginWireMessage(line []byte) (agentPluginWireMessage, error) {
	if len(line) == 0 || len(line) > maxAgentPluginWireBytes {
		return agentPluginWireMessage{}, fmt.Errorf("plugin runtime message exceeds the size limit")
	}
	var message agentPluginWireMessage
	if err := json.Unmarshal(line, &message); err != nil || strings.TrimSpace(message.Type) == "" {
		return agentPluginWireMessage{}, fmt.Errorf("plugin runtime message is invalid")
	}
	message.Type = strings.TrimSpace(message.Type)
	message.ID = strings.TrimSpace(message.ID)
	if len(message.ID) > 128 {
		return agentPluginWireMessage{}, fmt.Errorf("plugin runtime request id is invalid")
	}
	return message, nil
}

func writeAgentPluginWireMessage(writer io.Writer, message agentPluginWireMessage) error {
	payload, err := json.Marshal(message)
	if err != nil || len(payload) > maxAgentPluginWireBytes {
		return fmt.Errorf("plugin runtime host message is invalid")
	}
	_, err = writer.Write(append(payload, '\n'))
	return err
}

func sendAgentPluginProtocolError(send func(agentPluginWireMessage) error, id, reason string) error {
	return send(agentPluginWireMessage{Version: AgentPluginRuntimeProtocolV1, Type: "error", ID: strings.TrimSpace(id), Error: sanitizedDisplayText(reason)})
}

func mustMarshalAgentPluginPayload(value any) json.RawMessage {
	payload, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return payload
}

func agentPluginRunnerTimeout(runner AIAgentPluginRunner) time.Duration {
	if runner.TimeoutSeconds <= 0 {
		return defaultAgentPluginRunTimeout
	}
	return time.Duration(runner.TimeoutSeconds) * time.Second
}

func validateAgentPluginRunner(runner AIAgentPluginRunner) error {
	if len(runner.Command) == 0 {
		if strings.TrimSpace(runner.SHA256) != "" || runner.TimeoutSeconds != 0 {
			return fmt.Errorf("plugin runner metadata requires a command")
		}
		return nil
	}
	if len(runner.Command) > 33 || !filepath.IsAbs(runner.Command[0]) || strings.TrimSpace(runner.Command[0]) == "" {
		return fmt.Errorf("plugin runner requires a bounded absolute executable path")
	}
	for _, argument := range runner.Command {
		if strings.TrimSpace(argument) == "" || len(argument) > 4096 || strings.IndexByte(argument, 0) >= 0 {
			return fmt.Errorf("plugin runner command contains an invalid argument")
		}
	}
	if runner.TimeoutSeconds < 0 || runner.TimeoutSeconds > int(maxAgentPluginRunTimeout/time.Second) {
		return fmt.Errorf("plugin runner timeout must not exceed %d seconds", int(maxAgentPluginRunTimeout/time.Second))
	}
	wantedHash := strings.ToLower(strings.TrimSpace(runner.SHA256))
	if len(wantedHash) != sha256.Size*2 {
		return fmt.Errorf("plugin runner requires a SHA-256 executable hash")
	}
	if _, err := hex.DecodeString(wantedHash); err != nil {
		return fmt.Errorf("plugin runner SHA-256 hash is invalid")
	}
	info, err := os.Lstat(runner.Command[0])
	if err != nil || !info.Mode().IsRegular() || info.Mode()&0o111 == 0 {
		return fmt.Errorf("plugin runner executable is unavailable")
	}
	file, err := os.Open(runner.Command[0])
	if err != nil {
		return fmt.Errorf("plugin runner executable is unavailable")
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil || !strings.EqualFold(hex.EncodeToString(digest.Sum(nil)), wantedHash) {
		return fmt.Errorf("plugin runner executable hash does not match the reviewed manifest")
	}
	return nil
}

func agentPluginPathWithinProject(projectRoot, path string) bool {
	projectRoot, err := filepath.EvalSymlinks(projectRoot)
	if err != nil {
		projectRoot, err = filepath.Abs(projectRoot)
		if err != nil {
			return true
		}
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		path, err = filepath.Abs(path)
		if err != nil {
			return true
		}
	}
	rel, err := filepath.Rel(projectRoot, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func startAgentPluginSandbox(ctx context.Context, projectRoot string, runner AIAgentPluginRunner) (*agentPluginSandboxProcess, error) {
	if runtime.GOOS != "darwin" {
		return nil, fmt.Errorf("sandboxed plugin runtime is supported only by the macOS application host")
	}
	sandboxExec, err := exec.LookPath("sandbox-exec")
	if err != nil {
		return nil, fmt.Errorf("macOS sandbox-exec is unavailable")
	}
	workDir, err := os.MkdirTemp("", "arlecchino-agent-plugin-")
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(workDir, 0o700); err != nil {
		_ = os.RemoveAll(workDir)
		return nil, err
	}
	profile := agentPluginSandboxProfile(runner.Command[0], workDir)
	profilePath := filepath.Join(workDir, "sandbox.sb")
	if err := os.WriteFile(profilePath, []byte(profile), 0o600); err != nil {
		_ = os.RemoveAll(workDir)
		return nil, err
	}
	args := []string{"-p", profile, runner.Command[0]}
	args = append(args, runner.Command[1:]...)
	cmd := exec.CommandContext(ctx, sandboxExec, args...)
	cmd.Dir = workDir
	cmd.Env = []string{
		"HOME=" + workDir,
		"TMPDIR=" + workDir,
		"PATH=/usr/bin:/bin",
		"LANG=C",
		"ARLECCHINO_AGENT_PLUGIN_PROTOCOL=" + AgentPluginRuntimeProtocolV1,
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = os.RemoveAll(workDir)
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		_ = os.RemoveAll(workDir)
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = os.RemoveAll(workDir)
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stderr.Close()
		_ = os.RemoveAll(workDir)
		return nil, err
	}
	return &agentPluginSandboxProcess{cmd: cmd, stdin: stdin, stdout: stdout, stderr: stderr, cleanup: func() { _ = os.RemoveAll(workDir) }}, nil
}

func agentPluginSandboxProfile(executable, workDir string) string {
	quote := func(path string) string {
		path = strings.ReplaceAll(path, `\`, `\\`)
		return strings.ReplaceAll(path, `"`, `\"`)
	}
	return fmt.Sprintf(`(version 1)
(deny default)
(deny network*)
(deny process-fork)
(allow process-exec)
(allow file-read* (subpath "%s") (subpath "%s") (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/private/var/db/timezone"))
(allow file-write* (subpath "%s"))`, quote(filepath.Dir(executable)), quote(workDir), quote(workDir))
}
