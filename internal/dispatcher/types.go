package dispatcher

type InputType int

const (
	InputTypeTerminal InputType = iota
	InputTypeIDEAction
	InputTypeFileSearch
	InputTypeGrepSearch
	InputTypeSymbolSearch
	InputTypeAIQuery
	InputTypeTagCommand
)

type ParsedInput struct {
	Raw         string
	Type        InputType
	Prefix      string
	Query       string
	TagName     string
	ExpandedCmd string
	Args        []string
}

type DispatchResult struct {
	Success     bool
	Output      string
	Error       string
	ResultType  ResultType
	Items       []ResultItem
	Preview     string
	ShouldClose bool
}

type ResultType int

const (
	ResultTypeNone ResultType = iota
	ResultTypeTerminalOutput
	ResultTypeFileList
	ResultTypeSymbolList
	ResultTypeActionExecuted
	ResultTypeError
)

type ResultItem struct {
	ID          string
	Icon        string
	Title       string
	Subtitle    string
	Action      string
	ActionLabel string
	FilePath    string
	Line        int
	Score       float64
}

type TagDefinition struct {
	Name        string
	Expansion   string
	Description string
	Framework   string
}

type IDEAction struct {
	Name        string
	Description string
	Icon        string
	Handler     string
	Keybinding  string
}

type DispatcherConfig struct {
	EnableTerminalPreview bool
	EnableARLE            bool
	MaxResults            int
	DebounceMs            int
	PinnedCommands        []string
	RecentCommandsLimit   int
}

func DefaultConfig() DispatcherConfig {
	return DispatcherConfig{
		EnableTerminalPreview: true,
		EnableARLE:            true,
		MaxResults:            20,
		DebounceMs:            100,
		PinnedCommands:        []string{},
		RecentCommandsLimit:   10,
	}
}
