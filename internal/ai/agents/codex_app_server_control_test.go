package agents

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestCodexBuildWorkspaceWriteRequiresExplicitHostGrant(t *testing.T) {
	request := RunRequest{Action: "build", ProjectRoot: "/tmp/project"}
	if sandbox := codexSandboxForRun(request); sandbox != "read-only" {
		t.Fatalf("default Build sandbox = %q, want read-only", sandbox)
	}
	params := codexAppServerTurnParams(request, "thread-1")
	if params["approvalPolicy"] != "on-request" {
		t.Fatalf("default Build approval policy = %#v, want on-request", params["approvalPolicy"])
	}
	policy, ok := params["sandboxPolicy"].(map[string]any)
	if !ok || policy["type"] != "readOnly" {
		t.Fatalf("default Build sandbox policy = %#v", params["sandboxPolicy"])
	}

	request.AllowWorkspaceWrite = true
	if sandbox := codexSandboxForRun(request); sandbox != "workspace-write" {
		t.Fatalf("explicitly granted Build sandbox = %q, want workspace-write", sandbox)
	}
	params = codexAppServerTurnParams(request, "thread-1")
	if params["approvalPolicy"] != "never" {
		t.Fatalf("explicitly granted Build approval policy = %#v, want never", params["approvalPolicy"])
	}
	policy, ok = params["sandboxPolicy"].(map[string]any)
	if !ok || policy["type"] != "workspaceWrite" {
		t.Fatalf("explicitly granted Build sandbox policy = %#v", params["sandboxPolicy"])
	}
}

func TestCodexAppServerSteerParamsUseCurrentSchema(t *testing.T) {
	params := codexAppServerSteerParams("thread-1", "turn-1", "Keep this UI-only.", "message-1")
	if params["threadId"] != "thread-1" || params["expectedTurnId"] != "turn-1" || params["clientUserMessageId"] != "message-1" {
		t.Fatalf("steer params = %#v", params)
	}
	input, ok := params["input"].([]map[string]any)
	if !ok || len(input) != 1 || input[0]["type"] != "text" || input[0]["text"] != "Keep this UI-only." {
		t.Fatalf("steer input = %#v", params["input"])
	}
	if _, ok := params["turnId"]; ok {
		t.Fatalf("steer params included stale turnId field: %#v", params)
	}
}

func TestCodexAppServerInterruptWinsOverInFlightSteer(t *testing.T) {
	writer := &codexAppServerControlWriter{
		requests:     make(chan codexRPCMessage, 2),
		steerRelease: make(chan struct{}),
	}
	session := &codexAppServerSession{
		runID:    "run-app-server",
		stdin:    writer,
		emit:     func(Event) {},
		pending:  map[string]chan codexRPCMessage{},
		observer: newCodexAppServerObserver("run-app-server", func(Event) {}),
	}
	writer.session = session
	session.observer.setThreadID("thread-1")
	session.observer.setTurnID("turn-1")

	steerDone := make(chan struct {
		result SteerResult
		err    error
	}, 1)
	go func() {
		result, err := session.Steer(context.Background(), SteerRequest{Message: "Stay in the UI layer.", IdempotencyKey: "steer-1"})
		steerDone <- struct {
			result SteerResult
			err    error
		}{result: result, err: err}
	}()

	select {
	case request := <-writer.requests:
		if request.Method != "turn/steer" {
			t.Fatalf("first request = %q, want turn/steer", request.Method)
		}
	case <-time.After(time.Second):
		t.Fatal("steer request was not sent")
	}

	interruptDone := make(chan error, 1)
	go func() { interruptDone <- session.Interrupt(context.Background()) }()
	select {
	case request := <-writer.requests:
		if request.Method != "turn/interrupt" {
			t.Fatalf("second request = %q, want turn/interrupt", request.Method)
		}
	case <-time.After(time.Second):
		t.Fatal("interrupt was blocked by an in-flight steer")
	}
	select {
	case err := <-interruptDone:
		if err != nil {
			t.Fatalf("Interrupt: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("interrupt did not complete")
	}

	close(writer.steerRelease)
	select {
	case outcome := <-steerDone:
		if outcome.err == nil || outcome.result.State != "rejected" {
			t.Fatalf("late steer outcome = %#v / %v, want rejected", outcome.result, outcome.err)
		}
	case <-time.After(time.Second):
		t.Fatal("steer did not finish after interruption")
	}
}

type codexAppServerControlWriter struct {
	session      *codexAppServerSession
	requests     chan codexRPCMessage
	steerRelease chan struct{}
}

func (w *codexAppServerControlWriter) Write(data []byte) (int, error) {
	var request codexRPCMessage
	if err := json.Unmarshal(data, &request); err != nil {
		return 0, err
	}
	w.requests <- request
	go func() {
		if request.Method == "turn/steer" {
			<-w.steerRelease
		}
		result := map[string]any{}
		if request.Method == "turn/steer" {
			result["turnId"] = "turn-2"
		}
		response, _ := json.Marshal(codexRPCMessage{ID: request.ID, Result: result})
		w.session.handleLine(response)
	}()
	return len(data), nil
}

func (w *codexAppServerControlWriter) Close() error {
	return nil
}
