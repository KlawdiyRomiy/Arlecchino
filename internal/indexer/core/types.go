package core

import "time"

type SymbolKind string

const (
	SymbolKindClass      SymbolKind = "class"
	SymbolKindInterface  SymbolKind = "interface"
	SymbolKindTrait      SymbolKind = "trait"
	SymbolKindFunction   SymbolKind = "function"
	SymbolKindMethod     SymbolKind = "method"
	SymbolKindProperty   SymbolKind = "property"
	SymbolKindVariable   SymbolKind = "variable"
	SymbolKindConstant   SymbolKind = "constant"
	SymbolKindEnum       SymbolKind = "enum"
	SymbolKindEnumCase   SymbolKind = "enum_case"
	SymbolKindStruct     SymbolKind = "struct"
	SymbolKindField      SymbolKind = "field"
	SymbolKindType       SymbolKind = "type"
	SymbolKindModule     SymbolKind = "module"
	SymbolKindPackage    SymbolKind = "package"
	SymbolKindNamespace  SymbolKind = "namespace"
	SymbolKindComponent  SymbolKind = "component"
	SymbolKindDecorator  SymbolKind = "decorator"
	SymbolKindRoute      SymbolKind = "route"
	SymbolKindView       SymbolKind = "view"
	SymbolKindModel      SymbolKind = "model"
	SymbolKindController SymbolKind = "controller"
	SymbolKindMiddleware SymbolKind = "middleware"
	SymbolKindMigration  SymbolKind = "migration"
	SymbolKindConfig     SymbolKind = "config"
	SymbolKindTest       SymbolKind = "test"
	SymbolKindSnippet    SymbolKind = "snippet"
	SymbolKindText       SymbolKind = "text"
)

type SymbolSource string

const (
	SourceIndex      SymbolSource = "index"
	SourceAST        SymbolSource = "ast"
	SourceLSP        SymbolSource = "lsp"
	SourceLibrary    SymbolSource = "library"
	SourceVirtual    SymbolSource = "virtual"
	SourcePredictive SymbolSource = "predictive"
	SourceLocal      SymbolSource = "local"
	SourceFillAll    SymbolSource = "fill_all"
	SourceKeywords   SymbolSource = "keywords"
)

type FileKind string

const (
	FileKindUnknown FileKind = "unknown"
	FileKindSource  FileKind = "source"
	FileKindConfig  FileKind = "config"
	FileKindText    FileKind = "text"
	FileKindAsset   FileKind = "asset"
	FileKindBinary  FileKind = "binary"
)

type Symbol struct {
	ID         string     `gorm:"primaryKey;size:512"`
	ProjectID  string     `gorm:"index;size:512"`
	Name       string     `gorm:"index;size:256"`
	Kind       SymbolKind `gorm:"index;size:64"`
	Language   string     `gorm:"index;size:32"`
	Namespace  string     `gorm:"index;size:512"`
	FilePath   string     `gorm:"size:1024"`
	Line       int        `gorm:"index"`
	Column     int
	EndLine    int
	EndColumn  int
	Signature  string       `gorm:"size:1024"`
	DocComment string       `gorm:"type:text"`
	Source     SymbolSource `gorm:"size:32"`
	IsPending  bool         `gorm:"index"`
	Confidence float64
	ParentID   string            `gorm:"index;size:512"`
	Extra      map[string]string `gorm:"-"`
	ExtraJSON  string            `gorm:"type:text"`
	UpdatedAt  time.Time         `gorm:"index"`
}

type TextEdit struct {
	StartLine   int    `json:"startLine"`
	StartColumn int    `json:"startColumn"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
	Text        string `json:"text"`
}

type StringContextType string

const (
	StringContextNone   StringContextType = ""
	StringContextRoute  StringContextType = "route"
	StringContextView   StringContextType = "view"
	StringContextConfig StringContextType = "config"
	StringContextImport StringContextType = "import"
	StringContextPath   StringContextType = "path"
	StringContextTrans  StringContextType = "trans"
)

type EdgeKind string

const (
	EdgeKindImports    EdgeKind = "imports"
	EdgeKindExtends    EdgeKind = "extends"
	EdgeKindImplements EdgeKind = "implements"
	EdgeKindUses       EdgeKind = "uses"
	EdgeKindCalls      EdgeKind = "calls"
	EdgeKindReturns    EdgeKind = "returns"
	EdgeKindDeclares   EdgeKind = "declares"
	EdgeKindReferences EdgeKind = "references"
	EdgeKindRoutes     EdgeKind = "routes"
	EdgeKindRenders    EdgeKind = "renders"
)

type Edge struct {
	ID         uint     `gorm:"primaryKey"`
	ProjectID  string   `gorm:"index;size:512"`
	FromSymbol string   `gorm:"index;size:512"`
	ToSymbol   string   `gorm:"index;size:512"`
	Kind       EdgeKind `gorm:"index;size:64"`
	FilePath   string   `gorm:"index;size:1024"`
	Line       int
	Extra      string    `gorm:"type:text"`
	UpdatedAt  time.Time `gorm:"index"`
}

type File struct {
	ID         string   `gorm:"primaryKey;size:1024"`
	ProjectID  string   `gorm:"index;size:512"`
	Path       string   `gorm:"index;size:1024"`
	Language   string   `gorm:"index;size:32"`
	Kind       FileKind `gorm:"index;size:32"`
	Hash       string   `gorm:"size:64"`
	Size       int64
	HasSymbols bool      `gorm:"index"`
	UpdatedAt  time.Time `gorm:"index"`
}

type Project struct {
	ID        string    `gorm:"primaryKey;size:512"`
	Root      string    `gorm:"size:1024"`
	Name      string    `gorm:"size:256"`
	Languages string    `gorm:"size:512"`
	Framework string    `gorm:"size:128"`
	Labels    string    `gorm:"size:2048"`
	UpdatedAt time.Time `gorm:"index"`
}

type JobKind string

const (
	JobKindFull       JobKind = "full"
	JobKindSingleFile JobKind = "single_file"
	JobKindLanguage   JobKind = "language"
	JobKindFramework  JobKind = "framework"
	JobKindSymbols    JobKind = "symbols"
	JobKindEdges      JobKind = "edges"
)

type Job struct {
	ProjectID   string
	ProjectRoot string
	Kind        JobKind
	FilePath    string
	Language    string
	Priority    int
	BatchID     int64
	EnqueuedAt  time.Time
}
