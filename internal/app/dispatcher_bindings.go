package app

import (
	"context"
	"path/filepath"
	"time"

	"arlecchino/internal/dispatcher"
	"arlecchino/internal/terminal"
)

var globalDispatcher *dispatcher.Dispatcher

func initDispatcher() {
	if globalDispatcher == nil {
		globalDispatcher = dispatcher.New(dispatcher.DefaultConfig())
	}
}

func (a *App) InitDispatcherForProject() {
	initDispatcher()
	projectPath := a.GetCurrentProjectPath()
	if projectPath != "" {
		globalDispatcher.SetProjectPath(projectPath)
	}
	if engine := a.activeCoreEngine(); engine != nil {
		globalDispatcher.SetIndexEngine(engine)
	}
	if a.carapaceProvider != nil {
		globalDispatcher.SetCarapaceProvider(a.carapaceProvider)
	}

	ideEmitter := dispatcher.NewIDEEventEmitterWithEmit(a.ctx, func(event string, data ...interface{}) error {
		a.emitEvent(event, data...)
		return nil
	})
	ideEmitter.RegisterHandlers(globalDispatcher)
}

func (a *App) SearchFiles(pattern string) []ResultItemJS {
	a.logInfof("[Activation] subsystem=search reason=%s project=%s mode=files", activationSearchOpen, filepath.Base(a.GetCurrentProjectPath()))
	initDispatcher()
	a.InitDispatcherForProject()
	if globalDispatcher == nil {
		return nil
	}
	result := globalDispatcher.DispatchContext(a.dispatcherContext(), ">>"+pattern)
	return toItemsJS(result.Items)
}

func (a *App) SearchContent(query string) []ResultItemJS {
	a.logInfof("[Activation] subsystem=search reason=%s project=%s mode=content", activationSearchOpen, filepath.Base(a.GetCurrentProjectPath()))
	initDispatcher()
	a.InitDispatcherForProject()
	if globalDispatcher == nil {
		return nil
	}
	result := globalDispatcher.DispatchContext(a.dispatcherContext(), "\""+query+"\"")
	return toItemsJS(result.Items)
}

func (a *App) SearchSymbols(query string) []ResultItemJS {
	a.logInfof("[Activation] subsystem=search reason=%s project=%s mode=symbols", activationSearchOpen, filepath.Base(a.GetCurrentProjectPath()))
	initDispatcher()
	a.InitDispatcherForProject()
	if globalDispatcher == nil {
		return nil
	}
	result := globalDispatcher.Dispatch("#" + query)
	return toItemsJS(result.Items)
}

func (a *App) GetSearchIndexStatus() dispatcher.SearchBackendStatus {
	initDispatcher()
	a.InitDispatcherForProject()
	if globalDispatcher == nil {
		return dispatcher.SearchBackendStatus{Name: "linear", Ready: false, Fallback: true, Message: "dispatcher is not initialized"}
	}
	return globalDispatcher.SearchStatus()
}

func (a *App) RebuildSearchIndex() dispatcher.SearchBackendStatus {
	a.logInfof("[Activation] subsystem=search reason=%s project=%s mode=rebuild", activationSearchOpen, filepath.Base(a.GetCurrentProjectPath()))
	initDispatcher()
	a.InitDispatcherForProject()
	if globalDispatcher == nil {
		return dispatcher.SearchBackendStatus{Name: "linear", Ready: false, Fallback: true, Message: "dispatcher is not initialized"}
	}
	if err := globalDispatcher.RebuildSearch(a.dispatcherContext()); err != nil {
		status := globalDispatcher.SearchStatus()
		status.Message = err.Error()
		return status
	}
	return globalDispatcher.SearchStatus()
}

func (a *App) dispatcherContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

type DispatcherResultJS struct {
	Success     bool           `json:"success"`
	Output      string         `json:"output"`
	Error       string         `json:"error"`
	ResultType  int            `json:"resultType"`
	Items       []ResultItemJS `json:"items"`
	Preview     string         `json:"preview"`
	ShouldClose bool           `json:"shouldClose"`
}

type ResultItemJS struct {
	ID          string  `json:"id"`
	Icon        string  `json:"icon"`
	Title       string  `json:"title"`
	Subtitle    string  `json:"subtitle"`
	Action      string  `json:"action"`
	ActionLabel string  `json:"actionLabel"`
	FilePath    string  `json:"filePath"`
	Line        int     `json:"line"`
	Score       float64 `json:"score"`
}

func (a *App) DispatchCommand(input string) DispatcherResultJS {
	initDispatcher()
	result := globalDispatcher.Dispatch(input)
	return toResultJS(result)
}

func (a *App) GetDispatcherSuggestions(input string) []ResultItemJS {
	initDispatcher()
	items := globalDispatcher.GetSuggestions(input)
	return toItemsJS(items)
}

func (a *App) GetDispatcherRecent() []ResultItemJS {
	initDispatcher()
	items := globalDispatcher.GetRecent()
	return toItemsJS(items)
}

func (a *App) GetDispatcherPinned() []ResultItemJS {
	initDispatcher()
	items := globalDispatcher.GetPinned()
	return toItemsJS(items)
}

func (a *App) ExpandTag(input string) string {
	initDispatcher()
	return globalDispatcher.ExpandTag(input)
}

func (a *App) PinCommand(cmd string) {
	initDispatcher()
	globalDispatcher.Pin(cmd)
}

func (a *App) UnpinCommand(cmd string) {
	initDispatcher()
	globalDispatcher.Unpin(cmd)
}

type TerminalPreviewJS struct {
	Output    string `json:"output"`
	Error     string `json:"error"`
	IsSafe    bool   `json:"isSafe"`
	ExitCode  int    `json:"exitCode"`
	Truncated bool   `json:"truncated"`
}

func (a *App) GetTerminalPreview(command string) TerminalPreviewJS {
	if command == "" {
		return TerminalPreviewJS{IsSafe: false}
	}

	parsed, err := terminal.ParseShellInput(command)
	if err != nil || parsed == nil {
		return TerminalPreviewJS{IsSafe: false, Error: "parse error"}
	}

	executor := terminal.NewSafeExecutor()
	if !executor.IsSafe(parsed) {
		return TerminalPreviewJS{IsSafe: false}
	}

	workDir := a.GetCurrentProjectPath()
	if workDir == "" {
		workDir = "."
	}

	result, err := executor.Execute(parsed, workDir, 500*time.Millisecond)
	if err != nil {
		return TerminalPreviewJS{IsSafe: true, Error: err.Error()}
	}

	return TerminalPreviewJS{
		Output:    result.Output,
		Error:     result.Error,
		IsSafe:    true,
		ExitCode:  result.ExitCode,
		Truncated: result.Truncated,
	}
}

func toResultJS(r dispatcher.DispatchResult) DispatcherResultJS {
	return DispatcherResultJS{
		Success:     r.Success,
		Output:      r.Output,
		Error:       r.Error,
		ResultType:  int(r.ResultType),
		Items:       toItemsJS(r.Items),
		Preview:     r.Preview,
		ShouldClose: r.ShouldClose,
	}
}

func toItemsJS(items []dispatcher.ResultItem) []ResultItemJS {
	result := make([]ResultItemJS, len(items))
	for i, item := range items {
		result[i] = ResultItemJS{
			ID:          item.ID,
			Icon:        item.Icon,
			Title:       item.Title,
			Subtitle:    item.Subtitle,
			Action:      item.Action,
			ActionLabel: item.ActionLabel,
			FilePath:    item.FilePath,
			Line:        item.Line,
			Score:       item.Score,
		}
	}
	return result
}
