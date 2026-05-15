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
	parsed := d.Parse(input)

	switch parsed.Type {
	case InputTypeIDEAction:
		return d.dispatchIDEAction(parsed)
	case InputTypeTagCommand:
		return d.dispatchTagCommand(parsed)
	case InputTypeFileSearch:
		return d.dispatchFileSearch(parsed)
	case InputTypeGrepSearch:
		return d.dispatchGrepSearch(parsed)
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

func (d *Dispatcher) dispatchFileSearch(parsed ParsedInput) DispatchResult {
	d.mu.RLock()
	engine := d.searchEngine
	d.mu.RUnlock()

	var items []ResultItem
	if engine != nil && parsed.Query != "" {
		items = engine.SearchFiles(parsed.Query)
	}

	return DispatchResult{
		Success:    true,
		ResultType: ResultTypeFileList,
		Items:      items,
	}
}

func (d *Dispatcher) dispatchGrepSearch(parsed ParsedInput) DispatchResult {
	d.mu.RLock()
	engine := d.searchEngine
	d.mu.RUnlock()

	var items []ResultItem
	if engine != nil && parsed.Query != "" {
		items = engine.SearchContent(parsed.Query, false)
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
		Items: []ResultItem{{
			ID:       "ai-unavailable",
			Icon:     "sparkles",
			Title:    "AI недоступен",
			Subtitle: "AI-функции будут добавлены в будущих версиях",
			Action:   "none",
		}},
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
		items = append(items, ResultItem{
			ID:       "ai-unavailable",
			Icon:     "sparkles",
			Title:    "AI недоступен",
			Subtitle: "AI-функции будут добавлены в будущих версиях",
			Action:   "none",
		})

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
