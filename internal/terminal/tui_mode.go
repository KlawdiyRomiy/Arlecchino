package terminal

import (
	"strings"
	"sync"
	"time"
)

const (
	TerminalModeShell    = "shell"
	TerminalModeAgentCLI = "agent_cli"
	TerminalModeAgentTUI = "agent_tui"
	TerminalModeTUI      = TerminalModeAgentTUI
	maxModeRemainder     = 256

	defaultAgentLaunchHintTTL = 1500 * time.Millisecond
	defaultAgentExitDebounce  = 350 * time.Millisecond
)

type TUIModeEvent struct {
	Mode          string
	Active        bool
	Reason        string
	Confidence    float64
	SourceSignals []string
}

type TUIModeDetector struct {
	mu             sync.Mutex
	onChange       func(event TUIModeEvent)
	remainder      []byte
	altScreen      bool
	cursorHidden   bool
	bracketedPaste bool
	focusMode      bool
	syncOutput     bool
	mouseModes     map[string]bool
	repaintSignals int
	querySignals   int
	active         bool
	mode           string
	reason         string
	confidence     float64
	sourceSignals  []string
	exitSignal     bool

	agentLaunchHintUntil time.Time
	lastInteractiveAt    time.Time
	agentLaunchHintTTL   time.Duration
	exitDebounce         time.Duration
}

func NewTUIModeDetector(onChange func(event TUIModeEvent)) *TUIModeDetector {
	return &TUIModeDetector{
		onChange:           onChange,
		mouseModes:         make(map[string]bool),
		mode:               TerminalModeShell,
		reason:             "shell",
		confidence:         1,
		sourceSignals:      []string{"init:shell"},
		agentLaunchHintTTL: defaultAgentLaunchHintTTL,
		exitDebounce:       defaultAgentExitDebounce,
	}
}

func (d *TUIModeDetector) Force(event TUIModeEvent) {
	normalizedEvent := normalizeTUIModeEvent(event)

	d.mu.Lock()
	now := time.Now()
	if normalizedEvent.Active && normalizedEvent.Mode == TerminalModeAgentCLI {
		d.agentLaunchHintUntil = now.Add(d.agentLaunchHintTTL)
	}
	if normalizedEvent.Active && normalizedEvent.Mode == TerminalModeAgentTUI {
		d.lastInteractiveAt = now
	}

	if !d.setStateLocked(
		normalizedEvent.Mode,
		normalizedEvent.Active,
		normalizedEvent.Reason,
		normalizedEvent.Confidence,
		normalizedEvent.SourceSignals,
	) {
		d.mu.Unlock()
		return
	}

	onChange := d.onChange
	d.mu.Unlock()

	if onChange != nil {
		onChange(normalizedEvent)
	}
}

func normalizeTUIModeEvent(event TUIModeEvent) TUIModeEvent {
	reason := strings.TrimSpace(event.Reason)
	if !event.Active {
		if reason == "" {
			reason = "shell"
		}
		return TUIModeEvent{
			Mode:          TerminalModeShell,
			Active:        false,
			Reason:        reason,
			Confidence:    normalizeConfidence(event.Confidence, 1),
			SourceSignals: normalizeSignals(event.SourceSignals, "forced:shell"),
		}
	}

	mode := strings.TrimSpace(event.Mode)
	switch mode {
	case "", "tui":
		mode = TerminalModeAgentTUI
	case TerminalModeAgentCLI, TerminalModeAgentTUI:
	default:
		mode = TerminalModeAgentTUI
	}

	if reason == "" {
		reason = "forced"
	}

	defaultConfidence := 0.9
	if mode == TerminalModeAgentCLI {
		defaultConfidence = 0.72
	}

	return TUIModeEvent{
		Mode:          mode,
		Active:        true,
		Reason:        reason,
		Confidence:    normalizeConfidence(event.Confidence, defaultConfidence),
		SourceSignals: normalizeSignals(event.SourceSignals, "forced:"+mode),
	}
}

func normalizeConfidence(value, fallback float64) float64 {
	if value <= 0 {
		value = fallback
	}
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func normalizeSignals(signals []string, fallback string) []string {
	if len(signals) == 0 {
		return []string{fallback}
	}
	return cloneSignals(signals)
}

func (d *TUIModeDetector) Consume(data []byte) {
	if len(data) == 0 {
		return
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	stream := make([]byte, 0, len(d.remainder)+len(data))
	stream = append(stream, d.remainder...)
	stream = append(stream, data...)
	d.remainder = nil
	d.collectInlineSignals(stream)

	for i := 0; i < len(stream); i++ {
		if stream[i] != 0x1b {
			continue
		}

		if i+1 >= len(stream) {
			d.remainder = append(d.remainder, stream[i:]...)
			d.trimRemainder()
			d.emitIfChanged()
			return
		}

		if stream[i+1] != '[' {
			continue
		}

		complete := false
		for j := i + 2; j < len(stream); j++ {
			ch := stream[j]
			if (ch >= '0' && ch <= '9') || ch == ';' || ch == '?' {
				continue
			}

			if ch == 'h' || ch == 'l' {
				d.applyCSIPrivateMode(stream[i : j+1])
				i = j
				complete = true
				break
			}

			complete = true
			break
		}

		if complete {
			continue
		}

		d.remainder = append(d.remainder, stream[i:]...)
		d.trimRemainder()
		d.emitIfChanged()
		return
	}

	d.emitIfChanged()
}

func (d *TUIModeDetector) trimRemainder() {
	if len(d.remainder) <= maxModeRemainder {
		return
	}
	d.remainder = nil
}

func (d *TUIModeDetector) collectInlineSignals(stream []byte) {
	lineRepaintSignals := 0

	for i := 0; i < len(stream); i++ {
		if stream[i] == '\r' {
			lineRepaintSignals++
			continue
		}

		if stream[i] != 0x1b || i+1 >= len(stream) || stream[i+1] != '[' {
			continue
		}

		for j := i + 2; j < len(stream); j++ {
			ch := stream[j]
			if (ch >= '0' && ch <= '9') || ch == ';' || ch == '?' {
				continue
			}

			params := string(stream[i+2 : j])

			switch ch {
			case 'K', 'J', 'H', 'f', 'G':
				lineRepaintSignals++
			case 'n':
				if params == "6" {
					d.querySignals++
					if d.querySignals > 8 {
						d.querySignals = 8
					}
				}
			}

			i = j
			break
		}
	}

	if lineRepaintSignals == 0 {
		return
	}

	d.repaintSignals += lineRepaintSignals
	if d.repaintSignals > 8 {
		d.repaintSignals = 8
	}
}

func (d *TUIModeDetector) applyCSIPrivateMode(sequence []byte) {
	if len(sequence) < 5 {
		return
	}

	if sequence[0] != 0x1b || sequence[1] != '[' || sequence[2] != '?' {
		return
	}

	action := sequence[len(sequence)-1]
	if action != 'h' && action != 'l' {
		return
	}

	enable := action == 'h'
	params := string(sequence[3 : len(sequence)-1])
	if params == "" {
		return
	}

	for _, mode := range strings.Split(params, ";") {
		switch mode {
		case "47", "1047", "1049":
			d.altScreen = enable
			if !enable {
				d.exitSignal = true
			}
		case "1000", "1002", "1003", "1006":
			if enable {
				d.mouseModes[mode] = true
			} else {
				delete(d.mouseModes, mode)
				d.exitSignal = true
			}
		case "25":
			if enable {
				d.cursorHidden = false
				d.repaintSignals = 0
				d.exitSignal = true
			} else {
				d.cursorHidden = true
			}
		case "2004":
			d.bracketedPaste = enable
			if !enable {
				d.exitSignal = true
			}
		case "1004":
			d.focusMode = enable
			if !enable {
				d.querySignals = 0
				d.exitSignal = true
			}
		case "2026":
			d.syncOutput = enable
			if !enable {
				d.exitSignal = true
			}
		}
	}

	d.emitIfChanged()
}

func (d *TUIModeDetector) emitIfChanged() {
	mouseEnabled := len(d.mouseModes) > 0
	repaintInteractive := d.cursorHidden && d.repaintSignals >= 2
	focusQueryInteractive := d.focusMode && d.querySignals >= 1
	syncRepaintInteractive := d.syncOutput && d.repaintSignals >= 2
	inlineInteractive := (mouseEnabled && (d.cursorHidden || d.bracketedPaste)) || repaintInteractive || focusQueryInteractive || syncRepaintInteractive
	outputInteractive := d.altScreen || inlineInteractive

	outputReason := ""
	outputSignals := make([]string, 0, 2)
	if d.altScreen {
		outputReason = "alternate-screen"
		outputSignals = append(outputSignals, "output:alternate-screen")
	} else if focusQueryInteractive {
		outputReason = "focus-query"
		outputSignals = append(outputSignals, "output:focus-query")
	} else if syncRepaintInteractive {
		outputReason = "sync-repaint"
		outputSignals = append(outputSignals, "output:sync-repaint")
	} else if repaintInteractive {
		outputReason = "cursor-repaint"
		outputSignals = append(outputSignals, "output:cursor-repaint")
	} else if mouseEnabled && d.cursorHidden {
		outputReason = "mouse-cursor"
		outputSignals = append(outputSignals, "output:mouse-cursor")
	} else if mouseEnabled && d.bracketedPaste {
		outputReason = "mouse-bracketed-paste"
		outputSignals = append(outputSignals, "output:mouse-bracketed-paste")
	}

	now := time.Now()
	exitSignal := d.exitSignal
	d.exitSignal = false

	if outputInteractive {
		d.lastInteractiveAt = now
		sourceSignals := outputSignals
		if now.Before(d.agentLaunchHintUntil) {
			sourceSignals = append(sourceSignals, "input:agent-launch")
		}
		d.emitStateLocked(
			TerminalModeAgentTUI,
			true,
			outputReason,
			confidenceForReason(outputReason),
			sourceSignals,
		)
		return
	}

	if d.active &&
		d.mode == TerminalModeAgentTUI &&
		!exitSignal &&
		d.reason != "alternate-screen" &&
		!d.lastInteractiveAt.IsZero() &&
		now.Sub(d.lastInteractiveAt) < d.exitDebounce {
		d.emitStateLocked(
			TerminalModeAgentTUI,
			true,
			"hysteresis",
			0.66,
			[]string{"hysteresis:agent_tui_exit"},
		)
		return
	}

	if now.Before(d.agentLaunchHintUntil) {
		d.emitStateLocked(
			TerminalModeAgentCLI,
			true,
			"agent-launch",
			0.72,
			[]string{"input:agent-launch"},
		)
		return
	}

	if !d.active && d.mode == TerminalModeShell {
		return
	}

	d.emitStateLocked(
		TerminalModeShell,
		false,
		"shell",
		1,
		[]string{"output:shell"},
	)
}

func confidenceForReason(reason string) float64 {
	switch reason {
	case "alternate-screen":
		return 0.98
	case "focus-query", "sync-repaint":
		return 0.9
	case "cursor-repaint":
		return 0.88
	case "mouse-cursor", "mouse-bracketed-paste":
		return 0.84
	default:
		return 0.8
	}
}

func (d *TUIModeDetector) emitStateLocked(mode string, active bool, reason string, confidence float64, sourceSignals []string) {
	if !d.setStateLocked(mode, active, reason, confidence, sourceSignals) {
		return
	}

	if d.onChange == nil {
		return
	}

	event := TUIModeEvent{
		Mode:          d.mode,
		Active:        d.active,
		Reason:        d.reason,
		Confidence:    d.confidence,
		SourceSignals: cloneSignals(d.sourceSignals),
	}

	onChange := d.onChange
	d.mu.Unlock()
	onChange(event)
	d.mu.Lock()
}

func (d *TUIModeDetector) setStateLocked(mode string, active bool, reason string, confidence float64, sourceSignals []string) bool {
	wasActive := d.active

	normalizedMode := mode
	if !active {
		normalizedMode = TerminalModeShell
	}

	normalizedReason := strings.TrimSpace(reason)
	if normalizedReason == "" {
		if active {
			normalizedReason = "runtime"
		} else {
			normalizedReason = "shell"
		}
	}

	normalizedConfidence := normalizeConfidence(confidence, 1)
	normalizedSignals := normalizeSignals(sourceSignals, "runtime:"+normalizedMode)

	if d.active == active &&
		d.mode == normalizedMode &&
		d.reason == normalizedReason &&
		d.confidence == normalizedConfidence &&
		sameSignals(d.sourceSignals, normalizedSignals) {
		return false
	}

	d.active = active
	d.mode = normalizedMode
	d.reason = normalizedReason
	d.confidence = normalizedConfidence
	d.sourceSignals = normalizedSignals

	if wasActive && !active {
		d.repaintSignals = 0
		d.querySignals = 0
		d.lastInteractiveAt = time.Time{}
		d.agentLaunchHintUntil = time.Time{}
	}

	return true
}

func cloneSignals(source []string) []string {
	if len(source) == 0 {
		return nil
	}
	cloned := make([]string, len(source))
	copy(cloned, source)
	return cloned
}

func sameSignals(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func isAgentMode(mode string) bool {
	switch mode {
	case TerminalModeAgentCLI, TerminalModeAgentTUI:
		return true
	default:
		return false
	}
}
