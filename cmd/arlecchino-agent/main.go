// arlecchino-agent is the non-interactive entry point for the versioned
// Arlecchino Agent Protocol. It intentionally emits JSON Lines only, making
// it suitable for CI and adapter-conformance replay without a desktop window.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/ai"
)

func main() {
	var (
		operation        string
		projectRoot      string
		settingsPath     string
		sessionID        string
		runID            string
		prompt           string
		action           string
		expectedRevision int64
		idempotencyKey   string
		allowMutation    bool
		wait             bool
	)
	flag.StringVar(&operation, "operation", "start", "Protocol operation: start, resume, fork, steer, queue, cancel, get")
	flag.StringVar(&projectRoot, "project", ".", "Project root")
	flag.StringVar(&settingsPath, "settings", "", "Optional AI settings file")
	flag.StringVar(&sessionID, "session", "cli", "Chat session id")
	flag.StringVar(&runID, "run", "", "Run id for resume, fork, steer, cancel, or get")
	flag.StringVar(&prompt, "prompt", "", "User prompt or follow-up text")
	flag.StringVar(&action, "action", "", "Mode: ask, debug, plan, build, or review (defaults to ask; resume/fork inherit when omitted)")
	flag.Int64Var(&expectedRevision, "expected-revision", 0, "Expected run revision for steer")
	flag.StringVar(&idempotencyKey, "idempotency-key", "", "Optional idempotency key for steer or queue")
	flag.BoolVar(&allowMutation, "allow-mutation", false, "Explicitly allow a Build turn in this noninteractive CLI; does not bypass tool approvals")
	flag.BoolVar(&wait, "wait", true, "For start/resume/fork, stream run state until terminal")
	flag.Parse()

	root, err := filepath.Abs(filepath.Clean(projectRoot))
	if err != nil {
		emitFatal(err)
	}
	var outputMu sync.Mutex
	emit := func(event ai.AIAgentProtocolEvent) {
		outputMu.Lock()
		defer outputMu.Unlock()
		_ = json.NewEncoder(os.Stdout).Encode(event)
	}
	service := ai.NewService(ai.ServiceOptions{
		SettingsPath: settingsPath,
		Emit: func(name string, payload any) {
			emit(ai.AIAgentProtocolEvent{Version: ai.ArlecchinoAgentProtocolV1, Type: name, Payload: payload})
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := service.Start(ctx); err != nil {
		emitFatal(err)
	}
	defer service.Close()
	if _, err := service.OpenProject("cli", root); err != nil {
		emitFatal(err)
	}

	response, err := service.ExecuteAgentProtocol(ai.WithAgentProtocolNonInteractivePolicy(ctx, allowMutation), "cli", ai.AIAgentProtocolRequest{
		Version:          ai.ArlecchinoAgentProtocolV1,
		Operation:        operation,
		SessionID:        sessionID,
		RunID:            runID,
		Prompt:           prompt,
		Action:           ai.AIChatAction(strings.TrimSpace(action)),
		ExpectedRevision: expectedRevision,
		IdempotencyKey:   idempotencyKey,
	})
	if err != nil {
		emitFatal(err)
	}
	emit(ai.AIAgentProtocolEvent{Version: ai.ArlecchinoAgentProtocolV1, Type: "protocol.response", RunID: protocolResponseRunID(response), Payload: response})
	if !wait || response.Run == nil || terminalStatus(response.Run.Status) {
		return
	}
	streamRun(ctx, service, emit, response.Run.ID)
}

func streamRun(ctx context.Context, service *ai.Service, emit func(ai.AIAgentProtocolEvent), runID string) {
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	var lastRevision int64 = -1
	for {
		run, err := service.GetChatRun("cli", runID)
		if err != nil {
			emit(ai.AIAgentProtocolEvent{Version: ai.ArlecchinoAgentProtocolV1, Type: "run.error", RunID: runID, Payload: map[string]string{"error": err.Error()}})
			return
		}
		if run.Revision != lastRevision || terminalStatus(run.Status) {
			lastRevision = run.Revision
			emit(ai.AIAgentProtocolEvent{Version: ai.ArlecchinoAgentProtocolV1, Type: "run.updated", RunID: run.ID, Status: run.Status, Payload: run})
		}
		if terminalStatus(run.Status) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func protocolResponseRunID(response ai.AIAgentProtocolResponse) string {
	if response.Run != nil {
		return response.Run.ID
	}
	if response.Steer != nil {
		return response.Steer.RunID
	}
	return ""
}

func terminalStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "completed", "error", "canceled", "blocked":
		return true
	default:
		return false
	}
}

func emitFatal(err error) {
	_ = json.NewEncoder(os.Stdout).Encode(ai.AIAgentProtocolEvent{
		Version: ai.ArlecchinoAgentProtocolV1,
		Type:    "protocol.error",
		Payload: map[string]string{"error": fmt.Sprint(err)},
	})
	os.Exit(1)
}
