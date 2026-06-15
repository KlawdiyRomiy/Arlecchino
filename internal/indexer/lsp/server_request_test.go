package lsp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type nopWriteCloser struct {
	mu sync.Mutex
	bytes.Buffer
}

func (w *nopWriteCloser) Close() error {
	return nil
}

func (w *nopWriteCloser) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.Buffer.Write(p)
}

func (w *nopWriteCloser) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.Buffer.String()
}

func TestServerRequestWithContext_CleansPendingOnCancel(t *testing.T) {
	w := &nopWriteCloser{}
	s := &Server{
		stdin:   w,
		pending: make(map[int]chan *Response),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	_, err := s.requestWithContext(ctx, "textDocument/completion", map[string]any{"x": 1})
	if err == nil {
		t.Fatalf("expected error on context cancel")
	}

	s.mu.Lock()
	pending := len(s.pending)
	s.mu.Unlock()
	if pending != 0 {
		t.Fatalf("expected pending map to be empty, got %d", pending)
	}
}

func TestReadLoopRespondsToServerRequestAndProcessesDiagnostics(t *testing.T) {
	stdoutReader, stdoutWriter := io.Pipe()
	stdin := &nopWriteCloser{}
	notifications := make(chan string, 1)
	s := &Server{
		stdin:   stdin,
		stdout:  stdoutReader,
		running: true,
		pending: make(map[int]chan *Response),
		onNotify: func(method string, _ json.RawMessage) {
			notifications <- method
		},
	}

	go s.readLoop()
	t.Cleanup(func() {
		s.running = false
		_ = stdoutWriter.Close()
		_ = stdoutReader.Close()
	})

	writeProtocolMessage(t, stdoutWriter, map[string]any{
		"jsonrpc": "2.0",
		"id":      17,
		"method":  "workspace/configuration",
		"params": map[string]any{
			"items": []any{
				map[string]any{"section": "typescript"},
				map[string]any{"section": "python"},
			},
		},
	})

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if output := stdin.String(); strings.Contains(output, `"id":17`) && strings.Contains(output, `"result":[{},{}]`) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	output := stdin.String()
	if !strings.Contains(output, `"id":17`) {
		t.Fatalf("expected response to server request, got %q", output)
	}
	if !strings.Contains(output, `"result":[{},{}]`) {
		t.Fatalf("expected empty configuration results, got %q", output)
	}

	writeProtocolMessage(t, stdoutWriter, map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/publishDiagnostics",
		"params": map[string]any{
			"uri":         "file:///tmp/read-loop.go",
			"diagnostics": []any{},
		},
	})

	select {
	case method := <-notifications:
		if method != "textDocument/publishDiagnostics" {
			t.Fatalf("expected publishDiagnostics notification, got %q", method)
		}
	case <-time.After(time.Second):
		t.Fatal("expected publishDiagnostics notification")
	}
}

func TestServerCompleteWithContext_UsesInvokedFallbackAfterEmptyAccessTrigger(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionResponse(t, stdoutWriter, triggerRequest.ID, false)

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionResponse(t, stdoutWriter, invokedRequest.ID, false, "Println", "Printf")

	result := waitForCompletionResult(t, done)
	if !result.response.UsedInvokedFallback {
		t.Fatal("expected invoked fallback to be accepted")
	}
	if result.response.InvokedFallbackReason != "empty" {
		t.Fatalf("fallback reason = %q, want empty", result.response.InvokedFallbackReason)
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "Println,Printf" {
		t.Fatalf("labels = %v, want [Println Printf]", got)
	}
}

func TestServerCompleteWithContext_UsesInvokedFallbackWhenAccessTriggerUnsupported(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, nil)

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionResponse(t, stdoutWriter, invokedRequest.ID, false, "Now", "Since")

	result := waitForCompletionResult(t, done)
	if !result.response.UsedInvokedFallback {
		t.Fatal("expected unsupported access trigger to use invoked fallback")
	}
	if result.response.InvokedFallbackReason != "unsupported-trigger" {
		t.Fatalf("fallback reason = %q, want unsupported-trigger", result.response.InvokedFallbackReason)
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "Now,Since" {
		t.Fatalf("labels = %v, want [Now Since]", got)
	}
	for _, item := range result.response.Items {
		if !item.FallbackOnly {
			t.Fatalf("expected unsupported-trigger item %q to be marked fallback-only", item.Label)
		}
	}
}

func TestServerCompleteWithContext_UsesInvokedFallbackAfterAccessTriggerError(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionErrorResponse(t, stdoutWriter, triggerRequest.ID, "trigger failed")

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionResponse(t, stdoutWriter, invokedRequest.ID, false, "Println", "Printf")

	result := waitForCompletionResult(t, done)
	if !result.response.UsedInvokedFallback {
		t.Fatal("expected invoked fallback to be accepted")
	}
	if result.response.InvokedFallbackReason != "error" {
		t.Fatalf("fallback reason = %q, want error", result.response.InvokedFallbackReason)
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "Println,Printf" {
		t.Fatalf("labels = %v, want [Println Printf]", got)
	}
}

func TestServerCompleteWithContext_UsesInvokedFallbackForIncompleteAccessTrigger(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionResponse(t, stdoutWriter, triggerRequest.ID, true, "Print")

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionResponse(t, stdoutWriter, invokedRequest.ID, false, "Printf", "Println", "Print")

	result := waitForCompletionResult(t, done)
	if !result.response.UsedInvokedFallback {
		t.Fatal("expected invoked fallback to be accepted")
	}
	if result.response.InvokedFallbackReason != "incomplete" {
		t.Fatalf("fallback reason = %q, want incomplete", result.response.InvokedFallbackReason)
	}
	if result.response.IsIncomplete {
		t.Fatal("expected complete fallback result")
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "Printf,Println,Print" {
		t.Fatalf("labels = %v, want fallback labels without duplicates", got)
	}
	for _, item := range result.response.Items {
		if item.Label == "Print" && item.FallbackOnly {
			t.Fatal("expected overlapping trigger item to remain trusted")
		}
		if (item.Label == "Printf" || item.Label == "Println") && !item.FallbackOnly {
			t.Fatalf("expected fallback-only item %q to be marked fallback-only", item.Label)
		}
	}
}

func TestServerCompleteWithContext_MergesTriggerSideEffectsIntoInvokedFallback(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionItemResponse(t, stdoutWriter, triggerRequest.ID, true, map[string]any{
		"label":      "Print",
		"kind":       2,
		"insertText": "Print()",
		"additionalTextEdits": []map[string]any{{
			"range": map[string]any{
				"start": map[string]any{"line": 1, "character": 0},
				"end":   map[string]any{"line": 1, "character": 0},
			},
			"newText": "import \"fmt\"\n",
		}},
		"command": map[string]any{
			"title":   "apply import",
			"command": "gopls.applyImport",
		},
		"data": map[string]any{"id": "trigger-print"},
	})

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionItemResponse(t, stdoutWriter, invokedRequest.ID, false, map[string]any{
		"label":      "Printf",
		"kind":       2,
		"insertText": "Printf()",
	}, map[string]any{
		"label":      "Print",
		"kind":       2,
		"insertText": "Print()",
	})

	result := waitForCompletionResult(t, done)
	if !result.response.UsedInvokedFallback {
		t.Fatal("expected invoked fallback to be accepted")
	}
	var printItem *CompletionItem
	for i := range result.response.Items {
		if result.response.Items[i].Label == "Print" {
			printItem = &result.response.Items[i]
			break
		}
	}
	if printItem == nil {
		t.Fatalf("expected Print item in merged response, got labels=%v", completionLabels(result.response.Items))
	}
	if printItem.FallbackOnly {
		t.Fatal("expected overlapping trigger item to remain trusted")
	}
	if len(printItem.AdditionalTextEdits) != 1 || printItem.AdditionalTextEdits[0].NewText != "import \"fmt\"\n" {
		t.Fatalf("expected trigger import edit to survive fallback merge, got %#v", printItem.AdditionalTextEdits)
	}
	if printItem.Command == nil || printItem.Command.Command != "gopls.applyImport" {
		t.Fatalf("expected trigger command to survive fallback merge, got %#v", printItem.Command)
	}
	if printItem.Data == nil {
		t.Fatal("expected trigger data to survive fallback merge")
	}
}

func TestCompletionItemsHaveCompatibleMemberIdentityRejectsConflictingSideEffects(t *testing.T) {
	base := CompletionItem{
		Label:      "Print",
		Kind:       2,
		InsertText: "Print()",
		AdditionalTextEdits: []TextEdit{{
			Range: Range{
				Start: Position{Line: 1, Character: 0},
				End:   Position{Line: 1, Character: 0},
			},
			NewText: "import \"fmt\"\n",
		}},
	}
	withoutSideEffects := CompletionItem{
		Label:      "Print",
		Kind:       2,
		InsertText: "Print()",
	}
	conflicting := CompletionItem{
		Label:      "Print",
		Kind:       2,
		InsertText: "Print()",
		AdditionalTextEdits: []TextEdit{{
			Range: Range{
				Start: Position{Line: 1, Character: 0},
				End:   Position{Line: 1, Character: 0},
			},
			NewText: "import \"log\"\n",
		}},
	}

	if !completionItemsHaveCompatibleMemberIdentity(base, withoutSideEffects) {
		t.Fatal("expected side-effect-bearing trigger item to be compatible with plain fallback item")
	}
	if completionItemsHaveCompatibleMemberIdentity(base, conflicting) {
		t.Fatal("did not expect different import edits to be compatible")
	}
}

func TestServerCompleteWithContext_RejectsDisjointInvokedFallbackForIncompleteAccessTrigger(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionResponse(t, stdoutWriter, triggerRequest.ID, true, "LocalMember")

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionResponse(t, stdoutWriter, invokedRequest.ID, false, "GlobalFunction")

	result := waitForCompletionResult(t, done)
	if result.response.UsedInvokedFallback {
		t.Fatal("did not expect disjoint invoked fallback to be accepted")
	}
	if !result.response.InvokedFallbackRejected {
		t.Fatal("expected disjoint invoked fallback to be marked rejected")
	}
	if result.response.InvokedFallbackRejectedReason != "disjoint" {
		t.Fatalf("rejected reason = %q, want disjoint", result.response.InvokedFallbackRejectedReason)
	}
	if !result.response.IsIncomplete {
		t.Fatal("expected original incomplete trigger response to be preserved")
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "LocalMember" {
		t.Fatalf("labels = %v, want original trigger labels", got)
	}
}

func TestServerCompleteWithContext_RejectsLabelOverlapInvokedFallbackWithDifferentIdentity(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionItemResponse(t, stdoutWriter, triggerRequest.ID, true, map[string]any{
		"label":      "Close",
		"kind":       2,
		"insertText": "Close()",
	})

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionItemResponse(t, stdoutWriter, invokedRequest.ID, false, map[string]any{
		"label":      "Close",
		"kind":       3,
		"insertText": "Close",
	}, map[string]any{
		"label": "GlobalFunction",
		"kind":  3,
	})

	result := waitForCompletionResult(t, done)
	if result.response.UsedInvokedFallback {
		t.Fatal("did not expect label-overlap fallback with different identity to be accepted")
	}
	if !result.response.InvokedFallbackRejected {
		t.Fatal("expected label-overlap fallback to be marked rejected")
	}
	if result.response.InvokedFallbackRejectedReason != "not-superset" {
		t.Fatalf("rejected reason = %q, want not-superset", result.response.InvokedFallbackRejectedReason)
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "Close" {
		t.Fatalf("labels = %v, want original trigger labels", got)
	}
}

func TestServerCompleteWithContext_RejectsSameLabelKindFallbackWithDifferentDetail(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionItemResponse(t, stdoutWriter, triggerRequest.ID, true, map[string]any{
		"label":      "Close",
		"kind":       2,
		"detail":     "func (*Receiver).Close()",
		"insertText": "Close()",
	})

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionItemResponse(t, stdoutWriter, invokedRequest.ID, false, map[string]any{
		"label":      "Close",
		"kind":       2,
		"detail":     "func (*Other).Close()",
		"insertText": "Close()",
	}, map[string]any{
		"label": "GlobalFunction",
		"kind":  3,
	})

	result := waitForCompletionResult(t, done)
	if result.response.UsedInvokedFallback {
		t.Fatal("did not expect same-label fallback with different detail to be accepted")
	}
	if !result.response.InvokedFallbackRejected {
		t.Fatal("expected same-label fallback with different detail to be marked rejected")
	}
	if result.response.InvokedFallbackRejectedReason != "not-superset" {
		t.Fatalf("rejected reason = %q, want not-superset", result.response.InvokedFallbackRejectedReason)
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "Close" {
		t.Fatalf("labels = %v, want original trigger labels", got)
	}
}

func TestServerCompleteWithContext_AcceptsInvokedFallbackWithEquivalentSnippetMember(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(context.Background(), "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionItemResponse(t, stdoutWriter, triggerRequest.ID, true, map[string]any{
		"label":      "Close",
		"kind":       2,
		"insertText": "Close(${1:err})",
		"filterText": "C",
	})

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")
	writeCompletionItemResponse(t, stdoutWriter, invokedRequest.ID, false, map[string]any{
		"label":      "Close",
		"kind":       2,
		"insertText": "Close()",
		"filterText": "Close",
	}, map[string]any{
		"label": "GlobalFunction",
		"kind":  3,
	})

	result := waitForCompletionResult(t, done)
	if result.err != nil {
		t.Fatalf("completeWithContext error: %v", result.err)
	}
	if !result.response.UsedInvokedFallback {
		t.Fatal("expected equivalent invoked fallback to be accepted")
	}
	if result.response.InvokedFallbackRejected {
		t.Fatalf("did not expect fallback rejected: %s", result.response.InvokedFallbackRejectedReason)
	}
	if result.response.InvokedFallbackReason != "incomplete" {
		t.Fatalf("fallback reason = %q, want incomplete", result.response.InvokedFallbackReason)
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "Close,GlobalFunction" {
		t.Fatalf("labels = %v, want invoked fallback labels", got)
	}
	for _, item := range result.response.Items {
		if item.Label == "Close" && item.FallbackOnly {
			t.Fatal("expected equivalent fallback item to remain trusted")
		}
		if item.Label == "GlobalFunction" && !item.FallbackOnly {
			t.Fatal("expected fallback-only global item to be marked fallback-only")
		}
	}
}

func TestServerCompleteWithContext_PreservesIncompleteAccessTriggerWhenInvokedFallbackTimesOut(t *testing.T) {
	server, stdin, stdoutWriter := newCompletionTestServer(t, []string{"."})

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
	defer cancel()

	done := make(chan completionCallResult, 1)
	go func() {
		response, err := server.completeWithContext(ctx, "/tmp/main.go", 0, 4, CompletionTrigger{
			TriggerKind:              completionTriggerCharacter,
			TriggerCharacter:         ".",
			RetryInvokedOnEmpty:      true,
			RetryInvokedOnIncomplete: true,
			AccessMemberIntent:       true,
		})
		done <- completionCallResult{response: response, err: err}
	}()

	triggerRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 0)
	assertCompletionTrigger(t, triggerRequest, completionTriggerCharacter, ".")
	writeCompletionResponse(t, stdoutWriter, triggerRequest.ID, true, "LocalMember")

	invokedRequest := waitForOutboundRequest(t, stdin, "textDocument/completion", 1)
	assertCompletionTrigger(t, invokedRequest, completionTriggerInvoked, "")

	result := waitForCompletionResult(t, done)
	if result.err != nil {
		t.Fatalf("expected original trigger response to survive fallback timeout, got err=%v", result.err)
	}
	if result.response.UsedInvokedFallback {
		t.Fatal("did not expect timed-out fallback to be accepted")
	}
	if !result.response.InvokedFallbackRejected {
		t.Fatal("expected timed-out fallback to be marked rejected")
	}
	if result.response.InvokedFallbackRejectedReason != "timeout" {
		t.Fatalf("rejected reason = %q, want timeout", result.response.InvokedFallbackRejectedReason)
	}
	if !result.response.IsIncomplete {
		t.Fatal("expected original incomplete trigger response to be preserved")
	}
	if got := completionLabels(result.response.Items); strings.Join(got, ",") != "LocalMember" {
		t.Fatalf("labels = %v, want original trigger labels", got)
	}
}

type completionCallResult struct {
	response CompletionResponse
	err      error
}

func newCompletionTestServer(t *testing.T, triggerCharacters []string) (*Server, *nopWriteCloser, *io.PipeWriter) {
	t.Helper()
	stdoutReader, stdoutWriter := io.Pipe()
	stdin := &nopWriteCloser{}
	server := &Server{
		stdin:   stdin,
		stdout:  stdoutReader,
		running: true,
		pending: make(map[int]chan *Response),
		capabilities: ServerCapabilities{
			CompletionProvider: &CompletionProviderCapability{
				TriggerCharacters: triggerCharacters,
			},
		},
	}
	go server.readLoop()
	t.Cleanup(func() {
		server.running = false
		_ = stdoutWriter.Close()
		_ = stdoutReader.Close()
	})
	return server, stdin, stdoutWriter
}

func waitForOutboundRequest(t *testing.T, writer *nopWriteCloser, method string, index int) Request {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		requests := parseOutboundRequests(t, writer.String())
		matches := make([]Request, 0, len(requests))
		for _, request := range requests {
			if request.Method == method {
				matches = append(matches, request)
			}
		}
		if len(matches) > index {
			return matches[index]
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for outbound %s request #%d; output=%q", method, index, writer.String())
	return Request{}
}

func parseOutboundRequests(t *testing.T, output string) []Request {
	t.Helper()
	var requests []Request
	for {
		headerIdx := strings.Index(output, "Content-Length: ")
		if headerIdx < 0 {
			return requests
		}
		output = output[headerIdx+len("Content-Length: "):]
		lineEnd := strings.Index(output, "\r\n")
		if lineEnd < 0 {
			return requests
		}
		length, err := strconv.Atoi(strings.TrimSpace(output[:lineEnd]))
		if err != nil {
			t.Fatalf("parse content length %q: %v", output[:lineEnd], err)
		}
		headerEnd := strings.Index(output, "\r\n\r\n")
		if headerEnd < 0 {
			return requests
		}
		bodyStart := headerEnd + len("\r\n\r\n")
		if len(output) < bodyStart+length {
			return requests
		}
		body := output[bodyStart : bodyStart+length]
		var request Request
		if err := json.Unmarshal([]byte(body), &request); err != nil {
			t.Fatalf("unmarshal outbound request %q: %v", body, err)
		}
		requests = append(requests, request)
		output = output[bodyStart+length:]
	}
}

func assertCompletionTrigger(t *testing.T, request Request, kind int, character string) {
	t.Helper()
	params, ok := request.Params.(map[string]any)
	if !ok {
		t.Fatalf("completion params = %T, want map", request.Params)
	}
	contextValue, ok := params["context"].(map[string]any)
	if !ok {
		t.Fatalf("completion context = %T, want map", params["context"])
	}
	gotKind, ok := contextValue["triggerKind"].(float64)
	if !ok {
		t.Fatalf("triggerKind = %T, want number", contextValue["triggerKind"])
	}
	if int(gotKind) != kind {
		t.Fatalf("triggerKind = %d, want %d", int(gotKind), kind)
	}
	gotCharacter, hasCharacter := contextValue["triggerCharacter"].(string)
	if character == "" {
		if hasCharacter {
			t.Fatalf("triggerCharacter = %q, want absent", gotCharacter)
		}
		return
	}
	if !hasCharacter || gotCharacter != character {
		t.Fatalf("triggerCharacter = %q, want %q", gotCharacter, character)
	}
}

func writeCompletionResponse(t *testing.T, writer io.Writer, id int, incomplete bool, labels ...string) {
	t.Helper()
	items := make([]map[string]any, 0, len(labels))
	for _, label := range labels {
		items = append(items, map[string]any{
			"label": label,
			"kind":  2,
		})
	}
	writeProtocolMessage(t, writer, map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result": map[string]any{
			"isIncomplete": incomplete,
			"items":        items,
		},
	})
}

func writeCompletionItemResponse(t *testing.T, writer io.Writer, id int, incomplete bool, items ...map[string]any) {
	t.Helper()
	writeProtocolMessage(t, writer, map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result": map[string]any{
			"isIncomplete": incomplete,
			"items":        items,
		},
	})
}

func writeCompletionErrorResponse(t *testing.T, writer io.Writer, id int, message string) {
	t.Helper()
	writeProtocolMessage(t, writer, map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error": map[string]any{
			"code":    -32000,
			"message": message,
		},
	})
}

func waitForCompletionResult(t *testing.T, done <-chan completionCallResult) completionCallResult {
	t.Helper()
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("completion returned error: %v", result.err)
		}
		return result
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for completion result")
		return completionCallResult{}
	}
}

func completionLabels(items []CompletionItem) []string {
	labels := make([]string, 0, len(items))
	for _, item := range items {
		labels = append(labels, item.Label)
	}
	return labels
}

func writeProtocolMessage(t *testing.T, writer io.Writer, message any) {
	t.Helper()
	data, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal protocol message: %v", err)
	}
	if _, err := writer.Write([]byte("Content-Length: " + stringLength(data) + "\r\n\r\n")); err != nil {
		t.Fatalf("write protocol header: %v", err)
	}
	if _, err := writer.Write(data); err != nil {
		t.Fatalf("write protocol body: %v", err)
	}
}

func stringLength(data []byte) string {
	return strconv.Itoa(len(data))
}
