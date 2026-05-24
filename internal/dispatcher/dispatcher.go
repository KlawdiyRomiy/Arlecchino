package dispatcher

import (
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/terminal"
	"context"
	"sync"
)

type Dispatcher struct {
	mu               sync.RWMutex
	router           *Router
	config           DispatcherConfig
	handlers         map[string]ActionHandler
	searchEngine     *SearchEngine
	symbolSearcher   *SymbolSearcher
	termPredictor    *terminal.CommandPredictor
	termHistoryCache *terminal.HistoryCache
	carapaceProvider *terminal.CarapaceProvider
}

type ActionHandler func(action *IDEAction) error

func New(config DispatcherConfig) *Dispatcher {
	return &Dispatcher{
		router:           NewRouter(config),
		config:           config,
		handlers:         make(map[string]ActionHandler),
		termHistoryCache: terminal.NewHistoryCache(),
	}
}

func (d *Dispatcher) SetProjectPath(path string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.searchEngine = NewSearchEngine(path)
}

func (d *Dispatcher) SearchStatus() SearchBackendStatus {
	d.mu.RLock()
	engine := d.searchEngine
	d.mu.RUnlock()
	if engine == nil {
		return SearchBackendStatus{Name: "linear", Ready: false, Fallback: true, Message: "search engine is not initialized"}
	}
	return engine.Status()
}

func (d *Dispatcher) RebuildSearch(ctx context.Context) error {
	d.mu.RLock()
	engine := d.searchEngine
	d.mu.RUnlock()
	if engine == nil {
		return nil
	}
	return engine.Rebuild(ctx)
}

func (d *Dispatcher) SetIndexEngine(engine *core.Engine) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.symbolSearcher = NewSymbolSearcher(engine)
}

func (d *Dispatcher) SetCarapaceProvider(provider *terminal.CarapaceProvider) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.carapaceProvider = provider
}

func (d *Dispatcher) Parse(input string) ParsedInput {
	return d.router.Parse(input)
}

func (d *Dispatcher) Dispatch(input string) DispatchResult {
	return d.DispatchContext(context.Background(), input)
}

func (d *Dispatcher) DispatchContext(ctx context.Context, input string) DispatchResult {
	if ctx == nil {
		ctx = context.Background()
	}
	parsed := d.Parse(input)

	switch parsed.Type {
	case InputTypeIDEAction:
		return d.dispatchIDEAction(parsed)
	case InputTypeTagCommand:
		return d.dispatchTagCommand(parsed)
	case InputTypeFileSearch:
		return d.dispatchFileSearch(ctx, parsed)
	case InputTypeGrepSearch:
		return d.dispatchGrepSearch(ctx, parsed)
	case InputTypeSymbolSearch:
		return d.dispatchSymbolSearch(parsed)
	case InputTypeAIQuery:
		return d.dispatchAIQuery(parsed)
	default:
		return d.dispatchTerminal(parsed)
	}
}

func (d *Dispatcher) dispatchIDEAction(parsed ParsedInput) DispatchResult {
	actions := d.router.GetActions().Match(parsed.Query)
	if len(actions) == 0 {
		return DispatchResult{
			Success:    false,
			Error:      "No matching action found",
			ResultType: ResultTypeError,
		}
	}

	if len(actions) == 1 && parsed.Query == actions[0].Name {
		action := actions[0]
		d.mu.RLock()
		handler := d.handlers[action.Handler]
		d.mu.RUnlock()

		if handler != nil {
			if err := handler(action); err != nil {
				return DispatchResult{
					Success:    false,
					Error:      err.Error(),
					ResultType: ResultTypeError,
				}
			}
		}

		d.router.AddRecent(">" + action.Name)
		return DispatchResult{
			Success:     true,
			ResultType:  ResultTypeActionExecuted,
			ShouldClose: true,
		}
	}

	items := make([]ResultItem, len(actions))
	for i, action := range actions {
		items[i] = ResultItem{
			ID:          action.Handler,
			Icon:        action.Icon,
			Title:       action.Name,
			Subtitle:    action.Description,
			Action:      "execute",
			ActionLabel: action.Keybinding,
		}
	}

	return DispatchResult{
		Success:    true,
		ResultType: ResultTypeSymbolList,
		Items:      items,
	}
}

func (d *Dispatcher) dispatchTagCommand(parsed ParsedInput) DispatchResult {
	d.router.AddRecent(parsed.Raw)
	return DispatchResult{
		Success:     true,
		Output:      parsed.ExpandedCmd,
		ResultType:  ResultTypeTerminalOutput,
		Preview:     parsed.ExpandedCmd,
		ShouldClose: true,
	}
}

func (d *Dispatcher) dispatchFileSearch(ctx context.Context, parsed ParsedInput) DispatchResult {
	d.mu.RLock()
	engine := d.searchEngine
	d.mu.RUnlock()

	var items []ResultItem
	if engine != nil && parsed.Query != "" {
		items = engine.SearchFilesContext(ctx, parsed.Query)
	}

	return DispatchResult{
		Success:    true,
		ResultType: ResultTypeFileList,
		Items:      items,
	}
}

func (d *Dispatcher) dispatchGrepSearch(ctx context.Context, parsed ParsedInput) DispatchResult {
	d.mu.RLock()
	engine := d.searchEngine
	d.mu.RUnlock()

	var items []ResultItem
	if engine != nil && parsed.Query != "" {
		items = engine.SearchContentContext(ctx, parsed.Query, false)
	}

	return DispatchResult{
		Success:    true,
		ResultType: ResultTypeFileList,
		Items:      items,
	}
}

func (d *Dispatcher) dispatchSymbolSearch(parsed ParsedInput) DispatchResult {
	d.mu.RLock()
	searcher := d.symbolSearcher
	d.mu.RUnlock()

	var items []ResultItem
	if searcher != nil && parsed.Query != "" {
		items = searcher.Search(parsed.Query, d.config.MaxResults)
	}

	return DispatchResult{
		Success:    true,
		ResultType: ResultTypeSymbolList,
		Items:      items,
	}
}

func (d *Dispatcher) dispatchAIQuery(parsed ParsedInput) DispatchResult {
	return DispatchResult{
		Success:    true,
		ResultType: ResultTypeSymbolList,
		Items:      aiQuerySuggestions(parsed.Query),
	}
}

func (d *Dispatcher) dispatchTerminal(parsed ParsedInput) DispatchResult {
	d.router.AddRecent(parsed.Raw)
	return DispatchResult{
		Success:     true,
		Output:      parsed.Query,
		ResultType:  ResultTypeTerminalOutput,
		ShouldClose: true,
	}
}

func (d *Dispatcher) GetSuggestions(input string) []ResultItem {
	parsed := d.Parse(input)
	var items []ResultItem

	switch parsed.Type {
	case InputTypeIDEAction:
		actions := d.router.GetActions().Match(parsed.Query)
		for _, action := range actions {
			items = append(items, ResultItem{
				ID:          action.Handler,
				Icon:        action.Icon,
				Title:       ">" + action.Name,
				Subtitle:    action.Description,
				Action:      "execute",
				ActionLabel: action.Keybinding,
			})
		}

	case InputTypeTagCommand:
		items = append(items, ResultItem{
			ID:       "expanded",
			Icon:     "terminal",
			Title:    parsed.ExpandedCmd,
			Subtitle: "Run in terminal",
			Action:   "execute",
		})

	case InputTypeAIQuery:
		items = append(items, aiQuerySuggestions(parsed.Query)...)

	default:
		if input != "" && input[0] == '@' {
			tagPrefix := input[1:]
			if spaceIdx := indexOf(tagPrefix, ' '); spaceIdx != -1 {
				tagPrefix = tagPrefix[:spaceIdx]
			}
			tags := d.router.GetTags().Match(tagPrefix)
			for _, tag := range tags {
				items = append(items, ResultItem{
					ID:       tag.Name,
					Icon:     "at-sign",
					Title:    "@" + tag.Name,
					Subtitle: tag.Description + " → " + tag.Expansion,
					Action:   "complete",
				})
			}
		}

		if input != "" && parsed.Type == InputTypeTerminal {
			items = append(items, d.getTerminalPredictions(input)...)
		}
	}

	return items
}

func aiQuerySuggestions(query string) []ResultItem {
	modes := []struct {
		id       string
		slash    string
		title    string
		subtitle string
	}{
		{id: "ai-chat", slash: "/chat", title: "@ai /chat", subtitle: "Chat with visible project context"},
		{id: "ai-plan", slash: "/plan", title: "@ai /plan", subtitle: "Create a read-only implementation plan"},
		{id: "ai-debug", slash: "/debug", title: "@ai /debug", subtitle: "Investigate failures with evidence"},
		{id: "ai-build", slash: "/build", title: "@ai /build", subtitle: "Draft approval-gated implementation work"},
		{id: "ai-review", slash: "/review", title: "@ai /review", subtitle: "Review current changes without mutation"},
	}

	queryLower := toLower(query)
	items := make([]ResultItem, 0, len(modes))
	for _, mode := range modes {
		if queryLower != "" && !containsSubstring(toLower(mode.title+" "+mode.subtitle), queryLower) {
			continue
		}
		items = append(items, ResultItem{
			ID:       mode.id,
			Icon:     "sparkles",
			Title:    mode.title,
			Subtitle: mode.subtitle,
			Action:   "complete",
		})
	}
	return items
}

func (d *Dispatcher) getTerminalPredictions(input string) []ResultItem {
	var items []ResultItem
	seen := make(map[string]bool)

	staticPredictions := terminal.GetStaticPredictions(input)
	for _, pred := range staticPredictions {
		if !seen[pred.Text] {
			seen[pred.Text] = true
			items = append(items, ResultItem{
				ID:       pred.Text,
				Icon:     "terminal",
				Title:    pred.Text,
				Subtitle: "Command suggestion",
				Action:   "execute",
				Score:    pred.Confidence,
			})
		}
	}

	d.mu.RLock()
	historyCache := d.termHistoryCache
	d.mu.RUnlock()

	if historyCache != nil {
		historyPredictions := historyCache.FuzzyMatch(input, 5)
		for _, pred := range historyPredictions {
			if !seen[pred.Text] {
				seen[pred.Text] = true
				items = append(items, ResultItem{
					ID:       pred.Text,
					Icon:     "clock",
					Title:    pred.Text,
					Subtitle: "From history",
					Action:   "execute",
					Score:    pred.Confidence,
				})
			}
		}
	}

	return items
}

func (d *Dispatcher) GetRecent() []ResultItem {
	recent := d.router.GetRecent()
	items := make([]ResultItem, len(recent))
	for i, cmd := range recent {
		items[i] = ResultItem{
			ID:       cmd,
			Icon:     "clock",
			Title:    cmd,
			Subtitle: "Recent",
			Action:   "execute",
		}
	}
	return items
}

func (d *Dispatcher) GetPinned() []ResultItem {
	pinned := d.router.GetPinned()
	items := make([]ResultItem, len(pinned))
	for i, cmd := range pinned {
		items[i] = ResultItem{
			ID:       cmd,
			Icon:     "pin",
			Title:    cmd,
			Subtitle: "Pinned",
			Action:   "execute",
		}
	}
	return items
}

func (d *Dispatcher) Pin(cmd string) {
	pinned := d.router.GetPinned()
	for _, p := range pinned {
		if p == cmd {
			return
		}
	}
	d.router.SetPinned(append(pinned, cmd))
}

func (d *Dispatcher) Unpin(cmd string) {
	pinned := d.router.GetPinned()
	var newPinned []string
	for _, p := range pinned {
		if p != cmd {
			newPinned = append(newPinned, p)
		}
	}
	d.router.SetPinned(newPinned)
}

func (d *Dispatcher) RegisterHandler(handlerName string, handler ActionHandler) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.handlers[handlerName] = handler
}

func (d *Dispatcher) ExpandTag(input string) string {
	return d.router.GetTags().Expand(input)
}

func indexOf(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}
