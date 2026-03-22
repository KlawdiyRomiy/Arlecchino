package terminal

import (
	"fmt"
	"reflect"
	"testing"
)

func TestSessionHandleOutputChunk_BuffersUntilCallbackRegistered(t *testing.T) {
	session := &Session{}

	session.handleOutputChunk([]byte("first"))
	session.handleOutputChunk([]byte("second"))

	received := make([]string, 0, 2)
	session.SetOnData(func(data []byte) {
		received = append(received, string(data))
	})

	if !reflect.DeepEqual(received, []string{"first", "second"}) {
		t.Fatalf("unexpected replayed chunks: got %v", received)
	}
}

func TestSessionHandleOutputChunk_DeliversImmediatelyWhenCallbackExists(t *testing.T) {
	session := &Session{}

	received := make([]string, 0, 2)
	session.SetOnData(func(data []byte) {
		received = append(received, string(data))
	})

	session.handleOutputChunk([]byte("hello"))
	session.handleOutputChunk([]byte("world"))

	if !reflect.DeepEqual(received, []string{"hello", "world"}) {
		t.Fatalf("unexpected received chunks: got %v", received)
	}
}

func TestSessionHandleOutputChunk_DropsOldestWhenBufferIsFull(t *testing.T) {
	session := &Session{}

	for index := 0; index < maxPendingOutputChunks+10; index++ {
		session.handleOutputChunk([]byte(fmt.Sprintf("chunk-%03d", index)))
	}

	received := make([]string, 0, maxPendingOutputChunks)
	session.SetOnData(func(data []byte) {
		received = append(received, string(data))
	})

	if len(received) != maxPendingOutputChunks {
		t.Fatalf("unexpected buffered chunk count: got %d want %d", len(received), maxPendingOutputChunks)
	}

	wantFirst := "chunk-010"
	if received[0] != wantFirst {
		t.Fatalf("unexpected first chunk after overflow: got %q want %q", received[0], wantFirst)
	}

	wantLast := fmt.Sprintf("chunk-%03d", maxPendingOutputChunks+9)
	if received[len(received)-1] != wantLast {
		t.Fatalf("unexpected last chunk after overflow: got %q want %q", received[len(received)-1], wantLast)
	}
}

func TestSessionSetOnData_ReplaysBufferedOutputBeforeNewChunks(t *testing.T) {
	session := &Session{}
	session.handleOutputChunk([]byte("first"))

	received := make([]string, 0, 3)
	session.SetOnData(func(data []byte) {
		received = append(received, string(data))
		if string(data) == "first" {
			session.handleOutputChunk([]byte("second"))
		}
	})

	wantAfterReplay := []string{"first", "second"}
	if !reflect.DeepEqual(received, wantAfterReplay) {
		t.Fatalf("unexpected replay order: got %v want %v", received, wantAfterReplay)
	}

	session.handleOutputChunk([]byte("third"))
	wantFinal := []string{"first", "second", "third"}
	if !reflect.DeepEqual(received, wantFinal) {
		t.Fatalf("unexpected final delivery order: got %v want %v", received, wantFinal)
	}
}
