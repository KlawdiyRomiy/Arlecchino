package terminal

import (
	"testing"
)

func TestParseLineSemanticEvents_PreviewURL(t *testing.T) {
	cases := []struct {
		name         string
		line         string
		wantPreview  int
		wantMessages []string
		wantTrigger  bool
		triggerSev   string
	}{
		{
			name:         "basic localhost http",
			line:         "Server running at http://localhost:3000",
			wantPreview:  1,
			wantMessages: []string{"http://localhost:3000"},
		},
		{
			name:         "vite output with trailing slash",
			line:         "  Local:   http://localhost:5173/",
			wantPreview:  1,
			wantMessages: []string{"http://localhost:5173/"},
		},
		{
			name:         "127.0.0.1 with path",
			line:         "http://127.0.0.1:8080/api",
			wantPreview:  1,
			wantMessages: []string{"http://127.0.0.1:8080/api"},
		},
		{
			name:         "0.0.0.0",
			line:         "http://0.0.0.0:4000",
			wantPreview:  1,
			wantMessages: []string{"http://0.0.0.0:4000"},
		},
		{
			name:         "ipv6 loopback",
			line:         "http://[::1]:3000",
			wantPreview:  1,
			wantMessages: []string{"http://[::1]:3000"},
		},
		{
			name:         "https scheme",
			line:         "https://localhost:8443",
			wantPreview:  1,
			wantMessages: []string{"https://localhost:8443"},
		},
		{
			name:         "two urls on one line",
			line:         "Available at http://localhost:3000 and http://localhost:3001",
			wantPreview:  2,
			wantMessages: []string{"http://localhost:3000", "http://localhost:3001"},
		},
		{
			name:        "external host — not matched",
			line:        "http://example.com:3000",
			wantPreview: 0,
		},
		{
			name:        "no scheme — not matched",
			line:        "localhost:3000",
			wantPreview: 0,
		},
		{
			name:        "ftp scheme — not matched",
			line:        "ftp://localhost:3000",
			wantPreview: 0,
		},
		{
			name:        "empty line",
			line:        "",
			wantPreview: 0,
		},
		{
			name:        "no urls",
			line:        "no urls here",
			wantPreview: 0,
		},
		{
			name:         "error line with url",
			line:         "error: http://localhost:3000 failed",
			wantPreview:  1,
			wantMessages: []string{"http://localhost:3000"},
			wantTrigger:  true,
			triggerSev:   "error",
		},
		{
			name:         "url with query string",
			line:         "http://localhost:3000?query=1",
			wantPreview:  1,
			wantMessages: []string{"http://localhost:3000?query=1"},
		},
		{
			name:         "url with fragment",
			line:         "http://localhost:3000#section",
			wantPreview:  1,
			wantMessages: []string{"http://localhost:3000#section"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			events := parseLineSemanticEvents(tc.line)

			var previewEvents []SemanticEvent
			var triggerEvent *SemanticEvent
			for i := range events {
				switch events[i].Kind {
				case "preview_url":
					previewEvents = append(previewEvents, events[i])
				case "trigger":
					triggerEvent = &events[i]
				}
			}

			if len(previewEvents) != tc.wantPreview {
				t.Errorf("preview_url events: got %d, want %d (events: %+v)", len(previewEvents), tc.wantPreview, previewEvents)
			}

			for i, wantMsg := range tc.wantMessages {
				if i >= len(previewEvents) {
					t.Errorf("missing preview_url[%d]: want message %q", i, wantMsg)
					continue
				}
				if previewEvents[i].Message != wantMsg {
					t.Errorf("preview_url[%d].Message = %q, want %q", i, previewEvents[i].Message, wantMsg)
				}
				if previewEvents[i].Severity != "info" {
					t.Errorf("preview_url[%d].Severity = %q, want %q", i, previewEvents[i].Severity, "info")
				}
			}

			if tc.wantTrigger && triggerEvent == nil {
				t.Errorf("expected trigger event, got none")
			}
			if tc.wantTrigger && triggerEvent != nil && triggerEvent.Severity != tc.triggerSev {
				t.Errorf("trigger.Severity = %q, want %q", triggerEvent.Severity, tc.triggerSev)
			}
		})
	}
}

func TestParseOSCSemanticEvent_PreviewSignal(t *testing.T) {
	cases := []struct {
		name        string
		payload     string
		wantOK      bool
		wantKind    string
		wantMessage string
	}{
		{
			name:        "basic preview signal",
			payload:     "555;preview=http://localhost:3000",
			wantOK:      true,
			wantKind:    "preview_url",
			wantMessage: "http://localhost:3000",
		},
		{
			name:        "https with path",
			payload:     "555;preview=https://localhost:8443/dashboard",
			wantOK:      true,
			wantKind:    "preview_url",
			wantMessage: "https://localhost:8443/dashboard",
		},
		{
			name:    "empty url after prefix",
			payload: "555;preview=",
			wantOK:  false,
		},
		{
			name:    "different key",
			payload: "555;other=stuff",
			wantOK:  false,
		},
		{
			name:     "image ref still works",
			payload:  "1337;File=inline=1",
			wantOK:   true,
			wantKind: "image_ref",
		},
		{
			name:    "whitespace-only url",
			payload: "555;preview=   ",
			wantOK:  false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			event, ok := parseOSCSemanticEvent(tc.payload)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v (payload=%q)", ok, tc.wantOK, tc.payload)
			}
			if !tc.wantOK {
				return
			}
			if event.Kind != tc.wantKind {
				t.Errorf("Kind = %q, want %q", event.Kind, tc.wantKind)
			}
			if tc.wantMessage != "" && event.Message != tc.wantMessage {
				t.Errorf("Message = %q, want %q", event.Message, tc.wantMessage)
			}
		})
	}
}

func TestSemanticParserConsume_URLInChunk(t *testing.T) {
	cases := []struct {
		name        string
		chunk       []byte
		wantCount   int
		wantMessage string
	}{
		{
			name:        "url in plain text chunk with newline",
			chunk:       []byte("Listening on http://localhost:8080\n"),
			wantCount:   1,
			wantMessage: "http://localhost:8080",
		},
		{
			name:        "osc 555 preview signal",
			chunk:       []byte("\x1b]555;preview=http://localhost:4000\x07"),
			wantCount:   1,
			wantMessage: "http://localhost:4000",
		},
		{
			name:      "no url",
			chunk:     []byte("starting server...\n"),
			wantCount: 0,
		},
		{
			name:      "empty chunk",
			chunk:     []byte{},
			wantCount: 0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parser := newSemanticParser()
			_, semanticEvents := parser.Consume(tc.chunk)

			var previewEvents []SemanticEvent
			for _, e := range semanticEvents {
				if e.Kind == "preview_url" {
					previewEvents = append(previewEvents, e)
				}
			}

			if len(previewEvents) != tc.wantCount {
				t.Errorf("preview_url count = %d, want %d (all events: %+v)", len(previewEvents), tc.wantCount, semanticEvents)
			}
			if tc.wantMessage != "" {
				if len(previewEvents) == 0 {
					t.Fatalf("no preview_url events, expected message %q", tc.wantMessage)
				}
				if previewEvents[0].Message != tc.wantMessage {
					t.Errorf("Message = %q, want %q", previewEvents[0].Message, tc.wantMessage)
				}
			}
		})
	}
}

func TestSemanticParser_ParsesOSC133AcrossChunks(t *testing.T) {
	parser := newSemanticParser()

	eventsA, _ := parser.Consume([]byte("\x1b]133;"))
	if len(eventsA) != 0 {
		t.Fatalf("unexpected shell events before terminator: got %d", len(eventsA))
	}

	eventsB, _ := parser.Consume([]byte("A\x07"))
	if len(eventsB) != 1 {
		t.Fatalf("unexpected shell event count: got %d want 1", len(eventsB))
	}

	if eventsB[0].Type != "prompt_start" {
		t.Fatalf("unexpected shell event type: got %q want %q", eventsB[0].Type, "prompt_start")
	}
}

func TestSemanticParser_ParsesOSC7CurrentDirectory(t *testing.T) {
	parser := newSemanticParser()
	events, _ := parser.Consume([]byte("\x1b]7;file:///Users/a1/Documents/Arlecchino\x07"))

	if len(events) != 1 {
		t.Fatalf("unexpected shell event count: got %d want 1", len(events))
	}

	if events[0].Type != "cwd" {
		t.Fatalf("unexpected shell event type: got %q want %q", events[0].Type, "cwd")
	}

	if events[0].CWD != "/Users/a1/Documents/Arlecchino" {
		t.Fatalf("unexpected cwd: got %q", events[0].CWD)
	}
}

func TestSemanticParser_EmitsFileReferenceAndTrigger(t *testing.T) {
	parser := newSemanticParser()
	_, semanticEvents := parser.Consume([]byte("ERROR src/main.go:42:7 undefined symbol\n"))

	if len(semanticEvents) < 2 {
		t.Fatalf("expected trigger and file_ref events, got %d", len(semanticEvents))
	}

	if semanticEvents[0].Kind != "trigger" || semanticEvents[0].Severity != "error" {
		t.Fatalf("unexpected trigger event: %+v", semanticEvents[0])
	}

	var fileRef SemanticEvent
	found := false
	for _, event := range semanticEvents {
		if event.Kind == "file_ref" {
			fileRef = event
			found = true
			break
		}
	}

	if !found {
		t.Fatal("file_ref event not found")
	}

	if fileRef.Path != "src/main.go" || fileRef.Line != 42 || fileRef.Column != 7 {
		t.Fatalf("unexpected file_ref event: %+v", fileRef)
	}
}

func TestSemanticParser_EmitsImageSemanticEvent(t *testing.T) {
	parser := newSemanticParser()
	_, semanticEvents := parser.Consume([]byte("\x1b]1337;File=inline=1;width=10:AAAA\x07"))

	if len(semanticEvents) == 0 {
		t.Fatal("expected semantic events for OSC 1337 image payload")
	}

	if semanticEvents[0].Kind != "image_ref" {
		t.Fatalf("unexpected semantic kind: got %q", semanticEvents[0].Kind)
	}
}
