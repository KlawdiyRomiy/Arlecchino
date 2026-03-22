package indexer

import (
	"strings"
)

type ParsedCommand struct {
	Raw      string
	Prefix   string
	Command  string
	Argument string
	Flags    map[string]string
	Valid    bool
}

type CommandParser struct {
	registry *CommandRegistry
}

func NewCommandParser(registry *CommandRegistry) *CommandParser {
	return &CommandParser{registry: registry}
}

func (p *CommandParser) Parse(input string) *ParsedCommand {
	result := &ParsedCommand{
		Raw:   input,
		Flags: make(map[string]string),
	}

	input = strings.TrimSpace(input)
	if input == "" {
		return result
	}

	tokens := tokenize(input)
	if len(tokens) == 0 {
		return result
	}

	idx := 0

	// Detect prefix: "php artisan", "composer", "git"
	switch tokens[idx] {
	case "php":
		idx++
		if idx < len(tokens) && tokens[idx] == "artisan" {
			result.Prefix = "artisan"
			idx++
		}
	case "composer":
		result.Prefix = "composer"
		idx++
	case "git":
		result.Prefix = "git"
		idx++
	}

	if idx >= len(tokens) {
		return result
	}

	result.Command = tokens[idx]
	idx++

	for idx < len(tokens) {
		token := tokens[idx]
		if strings.HasPrefix(token, "--") {
			key := token
			val := "true"
			if eqIdx := strings.Index(token, "="); eqIdx > 0 {
				key = token[:eqIdx]
				val = token[eqIdx+1:]
			} else if idx+1 < len(tokens) && !strings.HasPrefix(tokens[idx+1], "-") {
				if def := p.flagNeedsValue(result.Command, key); def {
					idx++
					val = tokens[idx]
				}
			}
			result.Flags[key] = val
		} else if strings.HasPrefix(token, "-") && len(token) >= 2 {
			key := token
			val := "true"
			if idx+1 < len(tokens) && !strings.HasPrefix(tokens[idx+1], "-") {
				if def := p.shortFlagNeedsValue(result.Command, key); def {
					idx++
					val = tokens[idx]
				}
			}
			result.Flags[key] = val
		} else if result.Argument == "" {
			result.Argument = token
		}
		idx++
	}

	if p.registry.Get(result.Command) != nil {
		result.Valid = true
	}

	return result
}

func (p *CommandParser) flagNeedsValue(cmdName, flag string) bool {
	cmd := p.registry.Get(cmdName)
	if cmd == nil {
		return false
	}
	for _, f := range cmd.Flags {
		if f.Name == flag {
			return f.HasValue
		}
	}
	return false
}

func (p *CommandParser) shortFlagNeedsValue(cmdName, short string) bool {
	cmd := p.registry.Get(cmdName)
	if cmd == nil {
		return false
	}
	for _, f := range cmd.Flags {
		if f.Short == short {
			return f.HasValue
		}
	}
	return false
}

func (p *CommandParser) Suggest(input string) []Suggestion {
	parsed := p.Parse(input)
	var suggestions []Suggestion

	tokens := tokenize(strings.TrimSpace(input))
	if len(tokens) == 0 {
		return suggestions
	}

	// Handle prefix completions when typing first word
	if len(tokens) == 1 {
		first := tokens[0]

		// "php" -> suggest "artisan"
		if first == "php" {
			suggestions = append(suggestions, Suggestion{
				Text:        "artisan",
				Description: "Laravel Artisan CLI",
				Kind:        "prefix",
			})
			return suggestions
		}

		// Partial "composer" match
		if first != "composer" && strings.HasPrefix("composer", first) {
			suggestions = append(suggestions, Suggestion{
				Text:        "composer",
				Description: "PHP dependency manager",
				Kind:        "prefix",
			})
		}

		// Partial "git" match
		if first != "git" && strings.HasPrefix("git", first) {
			suggestions = append(suggestions, Suggestion{
				Text:        "git",
				Description: "Version control",
				Kind:        "prefix",
			})
		}

		if len(suggestions) > 0 {
			return suggestions
		}
	}

	// Handle "php" -> "artisan" completion for second token
	if tokens[0] == "php" && len(tokens) == 2 {
		if tokens[1] != "artisan" && strings.HasPrefix("artisan", tokens[1]) {
			suggestions = append(suggestions, Suggestion{
				Text:        "artisan",
				Description: "Laravel Artisan CLI",
				Kind:        "prefix",
			})
			return suggestions
		}
	}

	// No prefix detected yet
	if parsed.Prefix == "" {
		return suggestions
	}

	// Suggest commands for the detected prefix
	if parsed.Command == "" {
		for _, cmd := range p.registry.ByPrefix(parsed.Prefix) {
			suggestions = append(suggestions, Suggestion{
				Text:        cmd.Name,
				Description: cmd.Description,
				Kind:        "command",
			})
		}
		return suggestions
	}

	// Partial command match
	if !parsed.Valid {
		matches := p.registry.MatchByPrefix(parsed.Prefix, parsed.Command)
		for _, cmd := range matches {
			suggestions = append(suggestions, Suggestion{
				Text:        cmd.Name,
				Description: cmd.Description,
				Kind:        "command",
			})
		}
		return suggestions
	}

	// Valid command - suggest flags
	cmd := p.registry.Get(parsed.Command)
	if cmd == nil {
		return suggestions
	}

	for _, flag := range cmd.Flags {
		if _, exists := parsed.Flags[flag.Name]; exists {
			continue
		}
		if flag.Short != "" {
			if _, exists := parsed.Flags[flag.Short]; exists {
				continue
			}
		}
		text := flag.Name
		if flag.Short != "" {
			text = flag.Short + ", " + flag.Name
		}
		suggestions = append(suggestions, Suggestion{
			Text:        text,
			Description: flag.Description,
			Kind:        "flag",
		})
	}

	return suggestions
}

type Suggestion struct {
	Text        string
	Description string
	Kind        string
}

func tokenize(input string) []string {
	var tokens []string
	var current strings.Builder
	inQuote := false
	quoteChar := rune(0)

	for _, r := range input {
		if inQuote {
			if r == quoteChar {
				inQuote = false
			} else {
				current.WriteRune(r)
			}
			continue
		}

		if r == '"' || r == '\'' {
			inQuote = true
			quoteChar = r
			continue
		}

		if r == ' ' || r == '\t' {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			continue
		}

		current.WriteRune(r)
	}

	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	return tokens
}
