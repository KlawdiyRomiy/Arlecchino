package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenIntentTraceRecordsQueuedAndEmitted(t *testing.T) {
	tracePath := filepath.Join(t.TempDir(), "open-intent.jsonl")
	t.Setenv(envOpenIntentTracePath, tracePath)

	app := &App{}
	app.dispatchOpenIntent(map[string]any{
		"kind":   "openFile",
		"source": "test",
		"path":   "/tmp/main.go",
	})
	app.markOpenIntentFrontendReady()

	events := readOpenIntentTraceForTest(t, tracePath)
	if len(events) != 2 {
		t.Fatalf("trace event count = %d, want 2: %#v", len(events), events)
	}
	if events[0].Stage != "queued" || events[0].Kind != "openFile" || events[0].Source != "test" {
		t.Fatalf("queued trace = %#v", events[0])
	}
	if events[1].Stage != "emitted" || events[1].Kind != "openFile" || events[1].Source != "test" {
		t.Fatalf("emitted trace = %#v", events[1])
	}
}

func TestDispatchOpenIntentFromOSTargetQueuesAllowedProtocolAndRejectsCommandPayload(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	if err := os.WriteFile(filePath, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	tracePath := filepath.Join(root, "trace.jsonl")
	t.Setenv(envOpenIntentTracePath, tracePath)

	app := &App{}
	if !app.dispatchOpenIntentFromOSTarget(openIntentSourceOSURL, "arlecchino://open?file=main.go", root) {
		t.Fatal("dispatchOpenIntentFromOSTarget allowed protocol = false, want true")
	}
	if app.dispatchOpenIntentFromOSTarget(openIntentSourceOSURL, "arlecchino://open?command=rm%20-rf%20/", root) {
		t.Fatal("dispatchOpenIntentFromOSTarget arbitrary command = true, want false")
	}

	events := readOpenIntentTraceForTest(t, tracePath)
	if len(events) != 2 {
		t.Fatalf("trace event count = %d, want 2: %#v", len(events), events)
	}
	if events[0].Stage != "queued" || events[0].Source != openIntentSourceOSURL || events[0].Kind != "openFile" {
		t.Fatalf("allowed trace = %#v", events[0])
	}
	if events[1].Stage != "rejected" || events[1].Source != openIntentSourceOSURL {
		t.Fatalf("rejected trace = %#v", events[1])
	}
}

func TestDispatchOpenIntentFromOSTargetRejectsProtocolActionsWithoutPendingState(t *testing.T) {
	tracePath := filepath.Join(t.TempDir(), "open-intents.jsonl")
	t.Setenv(envOpenIntentTracePath, tracePath)

	app := &App{}
	if app.dispatchOpenIntentFromOSTarget(openIntentSourceOSURL, "arlecchino://mcp/approve?id=req_123&nonce=state_456", "/") {
		t.Fatal("dispatchOpenIntentFromOSTarget mcp approval without pending state = true, want false")
	}
	if app.dispatchOpenIntentFromOSTarget(openIntentSourceOSURL, "arlecchino://oauth/callback?provider=github&state=state_456&code=secret-code", "/") {
		t.Fatal("dispatchOpenIntentFromOSTarget oauth callback without pending state = true, want false")
	}

	events := readOpenIntentTraceForTest(t, tracePath)
	if len(events) != 2 {
		t.Fatalf("trace event count = %d, want 2: %#v", len(events), events)
	}
	for _, event := range events {
		if event.Stage != "rejected" {
			t.Fatalf("trace event = %#v, want rejected", event)
		}
	}
}

func TestPrepareExternalOpenIntentAllowsPendingProtocolApproval(t *testing.T) {
	app := &App{}
	if !app.registerPendingProtocolMCPApproval("req_123", "state_456") {
		t.Fatal("registerPendingProtocolMCPApproval = false, want true")
	}

	payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", "arlecchino://mcp/approve?id=req_123&nonce=state_456"},
		"/",
	)
	if !ok {
		t.Fatal("buildOpenIntentFromLaunchArgs = false, want true")
	}
	prepared, allowed := app.prepareExternalOpenIntent(payload, openIntentSourceOSURL, "/")
	if !allowed {
		t.Fatal("prepareExternalOpenIntent = false, want true")
	}
	if prepared["source"] != openIntentSourceOSURL || prepared["routeSource"] != "protocol-mcp-approval" {
		t.Fatalf("prepared = %#v, want source and protocol routeSource", prepared)
	}
}

func TestPrepareExternalOpenIntentMarksProtocolFileOutsideProjectReadOnly(t *testing.T) {
	projectRoot := t.TempDir()
	externalRoot := t.TempDir()
	externalFile := filepath.Join(externalRoot, "outside.go")
	if err := os.WriteFile(externalFile, []byte("package outside\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	app := &App{}
	app.setProjectPath(projectRoot)
	payload := openFileIntent(externalFile, 0)
	payload["source"] = "protocol-open"

	prepared, allowed := app.prepareExternalOpenIntent(payload, openIntentSourceOSURL, projectRoot)
	if !allowed {
		t.Fatal("prepareExternalOpenIntent = false, want true")
	}
	if prepared["external"] != true || prepared["readOnly"] != true || prepared["requiresConfirmation"] != true {
		t.Fatalf("prepared = %#v, want external read-only confirmation intent", prepared)
	}
}

func TestDispatchOpenIntentFromOSTargetQueuesFolderAsProject(t *testing.T) {
	root := t.TempDir()
	tracePath := filepath.Join(root, "trace.jsonl")
	t.Setenv(envOpenIntentTracePath, tracePath)

	app := &App{}
	if !app.dispatchOpenIntentFromOSTarget(openIntentSourceOSFile, root, "/") {
		t.Fatal("dispatchOpenIntentFromOSTarget folder = false, want true")
	}

	events := readOpenIntentTraceForTest(t, tracePath)
	if len(events) != 1 {
		t.Fatalf("trace event count = %d, want 1: %#v", len(events), events)
	}
	if events[0].Stage != "queued" || events[0].Source != openIntentSourceOSFile || events[0].Kind != "openProject" {
		t.Fatalf("folder trace = %#v", events[0])
	}
	if events[0].Payload["projectPath"] != root {
		t.Fatalf("projectPath = %#v, want %q", events[0].Payload["projectPath"], root)
	}
}

func TestTraceOpenIntentApplicationEventRecordsHandlerEntry(t *testing.T) {
	tracePath := filepath.Join(t.TempDir(), "open-intent.jsonl")
	t.Setenv(envOpenIntentTracePath, tracePath)

	traceOpenIntentApplicationEvent(openIntentSourceOSURL, "arlecchino://open?file=main.go")

	events := readOpenIntentTraceForTest(t, tracePath)
	if len(events) != 1 {
		t.Fatalf("trace event count = %d, want 1: %#v", len(events), events)
	}
	if events[0].Stage != "application-event" || events[0].Source != openIntentSourceOSURL {
		t.Fatalf("application event trace = %#v", events[0])
	}
	if events[0].Target != "arlecchino://open?file=main.go" {
		t.Fatalf("target = %q, want canonical URL", events[0].Target)
	}
}

func readOpenIntentTraceForTest(t *testing.T, path string) []openIntentTraceEvent {
	t.Helper()

	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("Open trace error = %v", err)
	}
	defer file.Close()

	var events []openIntentTraceEvent
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var event openIntentTraceEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("Unmarshal trace error = %v", err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("Scan trace error = %v", err)
	}
	return events
}
