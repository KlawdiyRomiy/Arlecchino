package terminal

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type ShellEvent struct {
	Type     string
	CWD      string
	ExitCode *int
	Raw      string
}

type SemanticEvent struct {
	Kind     string
	Path     string
	Line     int
	Column   int
	Severity string
	Message  string
	source   semanticSource
}

type semanticSource uint8

const (
	semanticSourceText semanticSource = iota
	semanticSourceOSC
)

type semanticParser struct {
	inOSC       bool
	oscData     []byte
	oscSawESC   bool
	lineTail    string
	maxTailSize int
}

var (
	ansiCSIRegex      = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
	fileRefRegex      = regexp.MustCompile(`([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?`)
	errorRegex        = regexp.MustCompile(`(?i)\b(error|fatal|panic|exception)\b`)
	warnRegex         = regexp.MustCompile(`(?i)\b(warn|warning)\b`)
	localhostURLRegex = regexp.MustCompile(`https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{1,5}(?:[/?#]\S*)?`)
)

func newSemanticParser() *semanticParser {
	return &semanticParser{maxTailSize: 2048}
}

func (p *semanticParser) Consume(chunk []byte) ([]ShellEvent, []SemanticEvent) {
	if len(chunk) == 0 {
		return nil, nil
	}

	shellEvents := make([]ShellEvent, 0, 2)
	oscSemanticEvents := make([]SemanticEvent, 0, 1)
	textBytes := make([]byte, 0, len(chunk))

	for i := 0; i < len(chunk); i++ {
		b := chunk[i]

		if p.inOSC {
			if b == 0x07 {
				payload := string(p.oscData)
				if event, ok := parseOSCEvent(payload); ok {
					shellEvents = append(shellEvents, event)
				} else if event, ok := parseOSCSemanticEvent(payload); ok {
					oscSemanticEvents = append(oscSemanticEvents, event)
				}
				p.resetOSC()
				continue
			}

			if p.oscSawESC {
				if b == '\\' {
					payload := string(p.oscData)
					if event, ok := parseOSCEvent(payload); ok {
						shellEvents = append(shellEvents, event)
					} else if event, ok := parseOSCSemanticEvent(payload); ok {
						oscSemanticEvents = append(oscSemanticEvents, event)
					}
					p.resetOSC()
					continue
				}

				p.oscData = append(p.oscData, 0x1b)
				p.oscSawESC = false
			}

			if b == 0x1b {
				p.oscSawESC = true
				continue
			}

			p.oscData = append(p.oscData, b)
			continue
		}

		if b == 0x1b && i+1 < len(chunk) && chunk[i+1] == ']' {
			p.inOSC = true
			i++
			continue
		}

		textBytes = append(textBytes, b)
	}

	semanticEvents := append(oscSemanticEvents, p.parseSemanticsFromText(textBytes)...)
	return shellEvents, semanticEvents
}

func (p *semanticParser) resetOSC() {
	p.inOSC = false
	p.oscData = p.oscData[:0]
	p.oscSawESC = false
}

func parseOSCEvent(payload string) (ShellEvent, bool) {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return ShellEvent{}, false
	}

	if strings.HasPrefix(payload, "133;") {
		parts := strings.Split(payload, ";")
		if len(parts) < 2 {
			return ShellEvent{}, false
		}

		event := ShellEvent{Type: shellEventType(parts[1]), Raw: payload}
		if event.Type == "" {
			return ShellEvent{}, false
		}

		if event.Type == "command_end" && len(parts) >= 3 {
			if code, err := strconv.Atoi(parts[2]); err == nil {
				event.ExitCode = &code
			}
		}

		return event, true
	}

	if strings.HasPrefix(payload, "7;") {
		cwd := strings.TrimPrefix(payload, "7;")
		parsed, err := url.Parse(cwd)
		if err != nil || parsed == nil || parsed.Scheme != "file" {
			return ShellEvent{}, false
		}

		decodedPath, err := url.PathUnescape(parsed.Path)
		if err != nil {
			decodedPath = parsed.Path
		}

		if decodedPath == "" {
			return ShellEvent{}, false
		}

		return ShellEvent{Type: "cwd", CWD: decodedPath, Raw: payload}, true
	}

	return ShellEvent{}, false
}

func parseOSCSemanticEvent(payload string) (SemanticEvent, bool) {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return SemanticEvent{}, false
	}

	if strings.HasPrefix(payload, "555;preview=") {
		previewURL := strings.TrimSpace(strings.TrimPrefix(payload, "555;preview="))
		if previewURL != "" {
			return SemanticEvent{Kind: "preview_url", Message: previewURL, Severity: "info", source: semanticSourceOSC}, true
		}
		return SemanticEvent{}, false
	}

	if strings.HasPrefix(payload, "1337;File=") {
		return SemanticEvent{Kind: "image_ref", Message: payload}, true
	}

	return SemanticEvent{}, false
}

func shellEventType(code string) string {
	switch code {
	case "A":
		return "prompt_start"
	case "B":
		return "command_start"
	case "C":
		return "command_exec"
	case "D":
		return "command_end"
	default:
		return ""
	}
}

func (p *semanticParser) parseSemanticsFromText(text []byte) []SemanticEvent {
	if len(text) == 0 {
		return nil
	}

	cleaned := ansiCSIRegex.ReplaceAllString(string(text), "")
	combined := p.lineTail + cleaned
	parts := strings.Split(combined, "\n")

	if len(parts) == 0 {
		p.lineTail = ""
		return nil
	}

	p.lineTail = parts[len(parts)-1]
	if len(p.lineTail) > p.maxTailSize {
		p.lineTail = p.lineTail[len(p.lineTail)-p.maxTailSize:]
	}

	events := make([]SemanticEvent, 0)
	for _, line := range parts[:len(parts)-1] {
		trimmed := strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if trimmed == "" {
			continue
		}
		events = append(events, parseLineSemanticEvents(trimmed)...)
	}

	return events
}

func parseLineSemanticEvents(line string) []SemanticEvent {
	events := make([]SemanticEvent, 0, 2)

	if errorRegex.MatchString(line) {
		events = append(events, SemanticEvent{Kind: "trigger", Severity: "error", Message: line})
	} else if warnRegex.MatchString(line) {
		events = append(events, SemanticEvent{Kind: "trigger", Severity: "warning", Message: line})
	}

	matches := fileRefRegex.FindAllStringSubmatch(line, -1)
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}

		path := match[1]
		lineNumber, err := strconv.Atoi(match[2])
		if err != nil || lineNumber <= 0 {
			continue
		}

		column := 0
		if len(match) >= 4 && match[3] != "" {
			if parsedColumn, parseErr := strconv.Atoi(match[3]); parseErr == nil {
				column = parsedColumn
			}
		}

		events = append(events, SemanticEvent{
			Kind:   "file_ref",
			Path:   path,
			Line:   lineNumber,
			Column: column,
		})
	}

	urls := localhostURLRegex.FindAllString(line, 2)
	for _, u := range urls {
		events = append(events, SemanticEvent{
			Kind:     "preview_url",
			Message:  u,
			Severity: "info",
			source:   semanticSourceText,
		})
	}

	return events
}
