package terminal

import (
	"testing"
	"time"
)

func TestTUIModeDetector_AltScreenEnterExit(t *testing.T) {
	var events []TUIModeEvent
	detector := NewTUIModeDetector(func(event TUIModeEvent) {
		events = append(events, event)
	})

	detector.Consume([]byte("\x1b[?1049h"))
	detector.Consume([]byte("\x1b[?1049l"))

	if len(events) != 2 {
		t.Fatalf("expected 2 mode events, got %d", len(events))
	}

	if !events[0].Active || events[0].Mode != TerminalModeAgentTUI {
		t.Fatalf("expected first event to enter agent_tui mode, got %+v", events[0])
	}

	if events[1].Active || events[1].Mode != TerminalModeShell {
		t.Fatalf("expected second event to exit tui mode, got %+v", events[1])
	}
}

func TestTUIModeDetector_MouseAndCursorHeuristic(t *testing.T) {
	var events []TUIModeEvent
	detector := NewTUIModeDetector(func(event TUIModeEvent) {
		events = append(events, event)
	})

	detector.Consume([]byte("\x1b[?1000h"))
	detector.Consume([]byte("\x1b[?25l"))

	if len(events) != 1 {
		t.Fatalf("expected 1 mode event, got %d", len(events))
	}

	if !events[0].Active || events[0].Mode != TerminalModeAgentTUI {
		t.Fatalf("expected agent_tui activation by heuristic, got %+v", events[0])
	}
}

func TestTUIModeDetector_FragmentedSequence(t *testing.T) {
	var events []TUIModeEvent
	detector := NewTUIModeDetector(func(event TUIModeEvent) {
		events = append(events, event)
	})

	detector.Consume([]byte("\x1b[?10"))
	detector.Consume([]byte("49h"))

	if len(events) != 1 {
		t.Fatalf("expected 1 mode event after fragmented sequence, got %d", len(events))
	}

	if !events[0].Active || events[0].Mode != TerminalModeAgentTUI {
		t.Fatalf("expected fragmented sequence to activate agent_tui mode, got %+v", events[0])
	}
}

func TestTUIModeDetector_TrimsOversizedRemainder(t *testing.T) {
	detector := NewTUIModeDetector(nil)

	longFragment := make([]byte, maxModeRemainder+16)
	longFragment[0] = 0x1b
	longFragment[1] = '['
	longFragment[2] = '?'
	for i := 3; i < len(longFragment); i++ {
		longFragment[i] = '1'
	}

	detector.Consume(longFragment)

	if len(detector.remainder) != 0 {
		t.Fatalf("expected oversized remainder to be cleared, got %d", len(detector.remainder))
	}
}

func TestTUIModeDetector_CursorRepaintHeuristicForInlineCLI(t *testing.T) {
	var events []TUIModeEvent
	detector := NewTUIModeDetector(func(event TUIModeEvent) {
		events = append(events, event)
	})

	detector.Consume([]byte("\x1b[?25l"))
	detector.Consume([]byte("\x1b[2K\r"))

	if len(events) != 1 {
		t.Fatalf("expected 1 mode event after cursor+repaint sequence, got %d", len(events))
	}

	if !events[0].Active || events[0].Mode != TerminalModeAgentTUI {
		t.Fatalf("expected inline repaint to activate agent_tui mode, got %+v", events[0])
	}

	detector.Consume([]byte("\x1b[?25h"))

	if len(events) != 2 {
		t.Fatalf("expected shell fallback after cursor restore, got %d events", len(events))
	}

	if events[1].Active || events[1].Mode != TerminalModeShell {
		t.Fatalf("expected shell event after cursor restore, got %+v", events[1])
	}
}

func TestTUIModeDetector_FocusQueryHeuristicForInlineCLI(t *testing.T) {
	var events []TUIModeEvent
	detector := NewTUIModeDetector(func(event TUIModeEvent) {
		events = append(events, event)
	})

	detector.Consume([]byte("\x1b[?2004h\x1b[?1004h\x1b[6n"))

	if len(events) != 1 {
		t.Fatalf("expected 1 mode event after focus+query sequence, got %d", len(events))
	}

	if !events[0].Active || events[0].Mode != TerminalModeAgentTUI {
		t.Fatalf("expected focus+query to activate agent_tui mode, got %+v", events[0])
	}

	detector.Consume([]byte("\x1b[?1004l\x1b[?2004l"))

	if len(events) != 2 {
		t.Fatalf("expected shell fallback after focus mode off, got %d events", len(events))
	}

	if events[1].Active || events[1].Mode != TerminalModeShell {
		t.Fatalf("expected shell event after focus mode off, got %+v", events[1])
	}
}

func TestTUIModeDetector_CallbackCanReenterConsume(t *testing.T) {
	done := make(chan struct{}, 1)

	var detector *TUIModeDetector
	detector = NewTUIModeDetector(func(event TUIModeEvent) {
		if event.Mode != TerminalModeAgentTUI || !event.Active {
			return
		}

		detector.Consume([]byte("\x1b[?1049l"))
		select {
		case done <- struct{}{}:
		default:
		}
	})

	detector.Consume([]byte("\x1b[?1049h"))

	select {
	case <-done:
	case <-time.After(750 * time.Millisecond):
		t.Fatalf("callback reentrant Consume() timed out, detector callback may still run under lock")
	}
}

func TestTUIModeDetector_ForceAgentCLIThenFallbackToShell(t *testing.T) {
	var events []TUIModeEvent
	detector := NewTUIModeDetector(func(event TUIModeEvent) {
		events = append(events, event)
	})
	detector.agentLaunchHintTTL = 20 * time.Millisecond

	detector.Force(TUIModeEvent{Mode: TerminalModeAgentCLI, Active: true, Reason: "agent-launch"})

	if len(events) != 1 {
		t.Fatalf("expected force mode to emit one event, got %d", len(events))
	}
	if !events[0].Active || events[0].Mode != TerminalModeAgentCLI {
		t.Fatalf("expected first forced event to be agent_cli mode, got %+v", events[0])
	}
	if events[0].Confidence <= 0 || len(events[0].SourceSignals) == 0 {
		t.Fatalf("expected force event to include confidence and source signals, got %+v", events[0])
	}

	time.Sleep(25 * time.Millisecond)
	detector.Consume([]byte("shell prompt\r\n"))

	if len(events) != 2 {
		t.Fatalf("expected shell fallback event after plain output, got %d", len(events))
	}
	if events[1].Active || events[1].Mode != TerminalModeShell {
		t.Fatalf("expected second event to be shell mode fallback, got %+v", events[1])
	}
}

func TestTUIModeDetector_AltScreenIncludesSourceSignals(t *testing.T) {
	var events []TUIModeEvent
	detector := NewTUIModeDetector(func(event TUIModeEvent) {
		events = append(events, event)
	})

	detector.Consume([]byte("\x1b[?1049h"))

	if len(events) != 1 {
		t.Fatalf("expected one event for alt-screen enter, got %d", len(events))
	}

	if events[0].Mode != TerminalModeAgentTUI || !events[0].Active {
		t.Fatalf("expected agent_tui activation event, got %+v", events[0])
	}
	if events[0].Confidence <= 0 {
		t.Fatalf("expected positive confidence, got %+v", events[0])
	}
	if len(events[0].SourceSignals) == 0 {
		t.Fatalf("expected source signals, got %+v", events[0])
	}
}
