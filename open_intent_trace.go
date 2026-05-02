package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const envOpenIntentTracePath = "ARLECCHINO_OPEN_INTENT_TRACE"

type openIntentTraceEvent struct {
	Stage     string         `json:"stage"`
	Source    string         `json:"source,omitempty"`
	Kind      string         `json:"kind,omitempty"`
	Target    string         `json:"target,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
	Timestamp string         `json:"timestamp"`
}

func traceOpenIntent(stage string, payload map[string]any) {
	tracePath := strings.TrimSpace(os.Getenv(envOpenIntentTracePath))
	if tracePath == "" {
		return
	}

	stage = strings.TrimSpace(stage)
	if stage == "" {
		stage = "unknown"
	}

	entry := openIntentTraceEvent{
		Stage:     stage,
		Payload:   cloneOpenIntentPayload(payload),
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if payload != nil {
		if source, ok := payload["source"].(string); ok {
			entry.Source = strings.TrimSpace(source)
		}
		if kind, ok := payload["kind"].(string); ok {
			entry.Kind = strings.TrimSpace(kind)
		}
		if target, ok := payload["target"].(string); ok {
			entry.Target = strings.TrimSpace(target)
		}
	}

	_ = os.MkdirAll(filepath.Dir(tracePath), 0o755)
	file, err := os.OpenFile(tracePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer file.Close()

	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_, _ = file.Write(append(data, '\n'))
}
