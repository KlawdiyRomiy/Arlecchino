package adapters

import "strings"

// stripCStyleComments removes line and block comments while preserving quoted
// strings. The block state is carried across lines so dependency-looking text
// inside multiline comments is never indexed.
func stripCStyleComments(line string, inBlock *bool) string {
	var result strings.Builder
	result.Grow(len(line))

	var quote byte
	escaped := false
	for i := 0; i < len(line); i++ {
		if *inBlock {
			if line[i] == '*' && i+1 < len(line) && line[i+1] == '/' {
				*inBlock = false
				i++
			}
			continue
		}

		ch := line[i]
		if quote != 0 {
			result.WriteByte(ch)
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == quote {
				quote = 0
			}
			continue
		}

		switch {
		case ch == '/' && i+1 < len(line) && line[i+1] == '/':
			return result.String()
		case ch == '/' && i+1 < len(line) && line[i+1] == '*':
			*inBlock = true
			i++
		case ch == '\'', ch == '"', ch == '`':
			quote = ch
			result.WriteByte(ch)
		default:
			result.WriteByte(ch)
		}
	}

	return result.String()
}

func dependencyTokenOutsideQuotedString(line string, tokenStart int) bool {
	var quote byte
	escaped := false
	for i := 0; i < tokenStart && i < len(line); i++ {
		ch := line[i]
		if quote != 0 {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == quote {
				quote = 0
			}
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			quote = ch
		}
	}
	return quote == 0
}

// stripDelimitedLiteral removes a multiline quoted region while retaining code
// before and after it. It is used for JavaScript/TypeScript template literals,
// whose contents must not be interpreted as dependency syntax.
func stripDelimitedLiteral(line string, active *bool, delimiter byte) string {
	var result strings.Builder
	result.Grow(len(line))

	var quote byte
	escaped := false
	for i := 0; i < len(line); i++ {
		ch := line[i]
		if *active {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == delimiter {
				*active = false
			}
			continue
		}

		if quote != 0 {
			result.WriteByte(ch)
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == quote {
				quote = 0
			}
			continue
		}

		if ch == '\'' || ch == '"' {
			quote = ch
			result.WriteByte(ch)
			continue
		}
		if ch == delimiter {
			*active = true
			continue
		}
		result.WriteByte(ch)
	}

	return result.String()
}

type markupCommentKind uint8

const (
	markupCommentNone markupCommentKind = iota
	markupCommentHTML
	markupCommentBlade
)

func stripMarkupComments(line string, active *markupCommentKind) string {
	var result strings.Builder
	result.Grow(len(line))

	for len(line) > 0 {
		if *active != markupCommentNone {
			closing := "-->"
			if *active == markupCommentBlade {
				closing = "--}}"
			}
			end := strings.Index(line, closing)
			if end < 0 {
				return result.String()
			}
			line = line[end+len(closing):]
			*active = markupCommentNone
			continue
		}

		htmlStart := strings.Index(line, "<!--")
		bladeStart := strings.Index(line, "{{--")
		start := -1
		kind := markupCommentNone
		switch {
		case htmlStart >= 0 && (bladeStart < 0 || htmlStart < bladeStart):
			start = htmlStart
			kind = markupCommentHTML
		case bladeStart >= 0:
			start = bladeStart
			kind = markupCommentBlade
		}
		if start < 0 {
			result.WriteString(line)
			break
		}
		result.WriteString(line[:start])
		line = line[start+4:]
		*active = kind
	}

	return result.String()
}
