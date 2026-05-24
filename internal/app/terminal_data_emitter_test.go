package app

import (
	"testing"
	"time"
)

func TestTerminalDataEmitterBatchesUntilFlush(t *testing.T) {
	var emitted [][]byte
	emitter := newTerminalDataEmitter(func(data []byte) {
		emitted = append(emitted, data)
	})
	emitter.flushDelay = time.Hour
	emitter.maxBytes = 1024

	emitter.Push([]byte("hel"))
	emitter.Push([]byte("lo"))

	if len(emitted) != 0 {
		t.Fatalf("emitted before flush = %d, want 0", len(emitted))
	}

	emitter.Flush()
	if len(emitted) != 1 {
		t.Fatalf("emitted after flush = %d, want 1", len(emitted))
	}
	if string(emitted[0]) != "hello" {
		t.Fatalf("emitted payload = %q, want hello", string(emitted[0]))
	}
}

func TestTerminalDataEmitterFlushesAtMaxBytes(t *testing.T) {
	var emitted [][]byte
	emitter := newTerminalDataEmitter(func(data []byte) {
		emitted = append(emitted, data)
	})
	emitter.flushDelay = time.Hour
	emitter.maxBytes = 4

	emitter.Push([]byte("ab"))
	emitter.Push([]byte("cd"))

	if len(emitted) != 1 {
		t.Fatalf("emitted = %d, want 1", len(emitted))
	}
	if string(emitted[0]) != "abcd" {
		t.Fatalf("emitted payload = %q, want abcd", string(emitted[0]))
	}
}
