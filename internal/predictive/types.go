// Package predictive provides context-aware code prediction and generation.
// It analyzes code context using AST and generates intelligent suggestions
// based on patterns, without requiring AI/ML models.
package predictive

import "arlecchino/internal/indexer/core"

type FileContext struct {
	FilePath    string
	Language    string
	Framework   string
	FileType    FileType
	IsEmpty     bool
	HasImports  bool
	Imports     []string
	Namespace   string
	ClassName   string
	ClassParent string
	ClassTraits []string
	Position    Position
	TypedPrefix string
}

// Position represents cursor position context
type Position struct {
	Line       int
	Column     int
	InClass    bool
	InMethod   bool
	InFunction bool
	MethodName string
	Scope      Scope // public, private, protected, package
	Context    PositionContext
}

// PositionContext describes where exactly the cursor is
type PositionContext string

const (
	PositionContextFileStart        PositionContext = "file_start"        // beginning of file
	PositionContextAfterImports     PositionContext = "after_imports"     // after import/use statements
	PositionContextTopLevel         PositionContext = "top_level"         // module/namespace level code (not in class)
	PositionContextClassBody        PositionContext = "class_body"        // inside class, outside methods
	PositionContextMethodBody       PositionContext = "method_body"       // inside method/function
	PositionContextMethodParams     PositionContext = "method_params"     // in method parameters
	PositionContextPropertyDecl     PositionContext = "property_decl"     // declaring property
	PositionContextAssignment       PositionContext = "assignment"        // after = sign
	PositionContextMethodCall       PositionContext = "method_call"       // after -> or .
	PositionContextStaticCall       PositionContext = "static_call"       // after ::
	PositionContextArrayElement     PositionContext = "array_element"     // inside array
	PositionContextString           PositionContext = "string"            // inside string literal
	PositionContextComment          PositionContext = "comment"           // inside comment
	PositionContextFunctionArgument PositionContext = "function_argument" // inside function call arguments
	PositionContextUnknown          PositionContext = "unknown"
)

// Scope represents visibility scope
type Scope string

const (
	ScopePublic    Scope = "public"
	ScopePrivate   Scope = "private"
	ScopeProtected Scope = "protected"
	ScopePackage   Scope = "package" // Go, Java
	ScopeInternal  Scope = "internal"
)

// FileType represents the semantic type of a file
type FileType string

const (
	// Universal types
	FileTypeClass     FileType = "class"
	FileTypeInterface FileType = "interface"
	FileTypeTrait     FileType = "trait"
	FileTypeEnum      FileType = "enum"
	FileTypeTest      FileType = "test"
	FileTypeConfig    FileType = "config"
	FileTypeScript    FileType = "script"
	FileTypeModule    FileType = "module"

	// Web framework types (universal across frameworks)
	FileTypeController   FileType = "controller"
	FileTypeModel        FileType = "model"
	FileTypeView         FileType = "view"
	FileTypeService      FileType = "service"
	FileTypeRepository   FileType = "repository"
	FileTypeMiddleware   FileType = "middleware"
	FileTypeRoute        FileType = "route"
	FileTypeMigration    FileType = "migration"
	FileTypeCommand      FileType = "command"
	FileTypeEvent        FileType = "event"
	FileTypeListener     FileType = "listener"
	FileTypeJob          FileType = "job"
	FileTypePolicy       FileType = "policy"
	FileTypeRequest      FileType = "request"
	FileTypeResource     FileType = "resource"
	FileTypeFactory      FileType = "factory"
	FileTypeSeeder       FileType = "seeder"
	FileTypeProvider     FileType = "provider"
	FileTypeComponent    FileType = "component"
	FileTypeMail         FileType = "mail"
	FileTypeNotification FileType = "notification"

	FileTypeUnknown FileType = "unknown"
)

// Pattern represents a code generation pattern
type Pattern struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Language    string            `json:"language"`            // php, go, typescript, python, *
	Framework   string            `json:"framework,omitempty"` // laravel, django, express, *
	Context     PatternContext    `json:"context"`
	Trigger     PatternTrigger    `json:"trigger"`
	Generator   string            `json:"generator"`            // generator ID
	Template    string            `json:"template,omitempty"`   // inline template (if no generator)
	Priority    int               `json:"priority"`             // higher = more important
	Variables   map[string]string `json:"variables,omitempty"`  // template variables
	Builtin     bool              `json:"-"`                    // true if hardcoded
	IsSkeleton  bool              `json:"isSkeleton,omitempty"` // true if this is a scaffold pattern
}

// PatternContext defines when a pattern applies
type PatternContext struct {
	// Single value match (used by builtin patterns)
	FileType FileType        `json:"fileType,omitempty"`
	Position PositionContext `json:"position,omitempty"`

	// Array match (used by JSON loader)
	Languages  []string `json:"languages,omitempty"`
	Frameworks []string `json:"frameworks,omitempty"`
	FileTypes  []string `json:"fileTypes,omitempty"`
	Positions  []string `json:"positions,omitempty"`

	// Advanced context
	Extends    string   `json:"extends,omitempty"`    // parent class name
	Implements []string `json:"implements,omitempty"` // implemented interfaces
	HasTrait   string   `json:"hasTrait,omitempty"`   // uses specific trait
	InMethod   string   `json:"inMethod,omitempty"`   // inside specific method
	AfterText  string   `json:"afterText,omitempty"`  // regex for text before cursor
	BeforeText string   `json:"beforeText,omitempty"` // regex for text after cursor
}

// PatternTrigger defines what triggers the pattern
type PatternTrigger struct {
	Type  TriggerType `json:"type"`
	Value string      `json:"value,omitempty"`
}

// TriggerType defines how pattern is triggered
type TriggerType string

const (
	TriggerTypeEmpty   TriggerType = "empty"   // empty file or class body
	TriggerTypeText    TriggerType = "text"    // specific text typed
	TriggerTypeRegex   TriggerType = "regex"   // regex match
	TriggerTypeNewLine TriggerType = "newline" // after pressing enter
	TriggerTypeAlways  TriggerType = "always"  // always show if context matches
	TriggerTypePrefix  TriggerType = "prefix"  // user typed specific prefix
	TriggerTypeContext TriggerType = "context" // complex context rules
)

// Suggestion represents a generated code suggestion
type Suggestion struct {
	Text                 string          // full text to insert
	DisplayText          string          // text to show in UI
	Kind                 core.SymbolKind // kind for icon
	Source               core.SymbolSource
	Score                float64
	Detail               string       // additional info
	Pattern              *Pattern     // pattern that generated this
	IsScaffold           bool         // true if this is a full file scaffold
	HasResolvedData      bool         // true if non-default placeholder data was resolved
	UsesFallbackDefaults bool         // true if template still used default placeholder values
	InsertText           string       // snippet with $1, $2 placeholders
	Range                *InsertRange // where to insert (nil = at cursor)
}

// InsertRange defines where to insert the suggestion
type InsertRange struct {
	StartLine   int
	StartColumn int
	EndLine     int
	EndColumn   int
}
