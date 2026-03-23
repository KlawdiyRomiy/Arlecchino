package dispatcher

import (
	"strings"
	"sync"
)

type Router struct {
	mu         sync.RWMutex
	tags       *TagRegistry
	actions    *ActionRegistry
	config     DispatcherConfig
	recentCmds []string
}

func NewRouter(config DispatcherConfig) *Router {
	return &Router{
		tags:       NewTagRegistry(),
		actions:    NewActionRegistry(),
		config:     config,
		recentCmds: make([]string, 0, config.RecentCommandsLimit),
	}
}

func (r *Router) Parse(input string) ParsedInput {
	input = strings.TrimSpace(input)
	if input == "" {
		return ParsedInput{Raw: input, Type: InputTypeTerminal}
	}

	if strings.HasPrefix(input, ">>") {
		return r.parseFileSearch(input)
	}

	if strings.HasPrefix(input, ">") {
		return r.parseIDEAction(input)
	}

	if strings.HasPrefix(input, "\"") || strings.HasPrefix(input, "'") {
		return r.parseGrepSearch(input)
	}

	if strings.HasPrefix(input, "#") {
		return r.parseSymbolSearch(input)
	}

	if strings.HasPrefix(input, "@ai ") {
		return r.parseAIQuery(input)
	}

	if strings.HasPrefix(input, "@") {
		return r.parseTagCommand(input)
	}

	return ParsedInput{
		Raw:   input,
		Type:  InputTypeTerminal,
		Query: input,
	}
}

func (r *Router) parseFileSearch(input string) ParsedInput {
	query := strings.TrimPrefix(input, ">>")
	query = strings.TrimSpace(query)
	return ParsedInput{
		Raw:    input,
		Type:   InputTypeFileSearch,
		Prefix: ">>",
		Query:  query,
	}
}

func (r *Router) parseIDEAction(input string) ParsedInput {
	query := strings.TrimPrefix(input, ">")
	query = strings.TrimSpace(query)
	return ParsedInput{
		Raw:    input,
		Type:   InputTypeIDEAction,
		Prefix: ">",
		Query:  query,
	}
}

func (r *Router) parseGrepSearch(input string) ParsedInput {
	query := strings.Trim(input, "\"'")
	prefix := "\""
	if strings.HasPrefix(input, "'") {
		prefix = "'"
	}
	return ParsedInput{
		Raw:    input,
		Type:   InputTypeGrepSearch,
		Prefix: prefix,
		Query:  query,
	}
}

func (r *Router) parseSymbolSearch(input string) ParsedInput {
	query := strings.TrimPrefix(input, "#")
	query = strings.TrimSpace(query)
	return ParsedInput{
		Raw:    input,
		Type:   InputTypeSymbolSearch,
		Prefix: "#",
		Query:  query,
	}
}

func (r *Router) parseAIQuery(input string) ParsedInput {
	query := strings.TrimPrefix(input, "@ai ")
	query = strings.TrimSpace(query)
	return ParsedInput{
		Raw:    input,
		Type:   InputTypeAIQuery,
		Prefix: "@ai",
		Query:  query,
	}
}
func (r *Router) parseTagCommand(input string) ParsedInput {
	parts := strings.SplitN(input, " ", 2)
	tagWithAt := parts[0]
	tagName := strings.TrimPrefix(tagWithAt, "@")

	var args string
	if len(parts) > 1 {
		args = parts[1]
	}

	r.mu.RLock()
	tag := r.tags.Get(tagName)
	r.mu.RUnlock()

	if tag == nil {
		return ParsedInput{
			Raw:     input,
			Type:    InputTypeTerminal,
			Query:   input,
			TagName: tagName,
		}
	}

	expandedCmd := tag.Expansion
	if args != "" {
		trimmedArgs := strings.TrimSpace(args)
		if strings.HasPrefix(strings.ToLower(trimmedArgs), strings.ToLower(tag.Expansion)) {
			expandedCmd = trimmedArgs
		} else {
			expandedCmd = expandedCmd + " " + trimmedArgs
		}
	}

	return ParsedInput{
		Raw:         input,
		Type:        InputTypeTagCommand,
		Prefix:      "@" + tagName,
		Query:       args,
		TagName:     tagName,
		ExpandedCmd: expandedCmd,
		Args:        strings.Fields(args),
	}
}

func (r *Router) GetTags() *TagRegistry {
	return r.tags
}

func (r *Router) GetActions() *ActionRegistry {
	return r.actions
}

func (r *Router) AddRecent(cmd string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, c := range r.recentCmds {
		if c == cmd {
			r.recentCmds = append(r.recentCmds[:i], r.recentCmds[i+1:]...)
			break
		}
	}

	r.recentCmds = append([]string{cmd}, r.recentCmds...)

	if len(r.recentCmds) > r.config.RecentCommandsLimit {
		r.recentCmds = r.recentCmds[:r.config.RecentCommandsLimit]
	}
}

func (r *Router) GetRecent() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]string, len(r.recentCmds))
	copy(result, r.recentCmds)
	return result
}

func (r *Router) GetPinned() []string {
	return r.config.PinnedCommands
}

func (r *Router) SetPinned(cmds []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.config.PinnedCommands = cmds
}
