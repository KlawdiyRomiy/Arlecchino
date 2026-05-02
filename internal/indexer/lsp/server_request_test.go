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
