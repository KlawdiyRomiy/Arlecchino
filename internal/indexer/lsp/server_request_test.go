package lsp

import (
	"bytes"
	"context"
	"testing"
	"time"
)

type nopWriteCloser struct {
	bytes.Buffer
}

func (w *nopWriteCloser) Close() error {
	return nil
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
