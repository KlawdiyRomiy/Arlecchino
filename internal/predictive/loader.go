package predictive

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// PatternFile represents a JSON pattern file
type PatternFile struct {
	Version     string        `json:"version"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Language    string        `json:"language"`
	Framework   string        `json:"framework"`
	Patterns    []JSONPattern `json:"patterns"`
}

// JSONPattern represents a pattern in JSON format
type JSONPattern struct {
	ID          string             `json:"id"`
	Description string             `json:"description"`
	Context     JSONPatternContext `json:"context"`
	Trigger     JSONPatternTrigger `json:"trigger"`
	Template    string             `json:"template"`
	Generator   string             `json:"generator,omitempty"`
	Priority    int                `json:"priority"`
	IsSkeleton  bool               `json:"isSkeleton,omitempty"`
	Variables   map[string]string  `json:"variables,omitempty"`
}

// JSONPatternContext represents context conditions in JSON
type JSONPatternContext struct {
	Languages  []string `json:"languages,omitempty"`
	Frameworks []string `json:"frameworks,omitempty"`
	FileTypes  []string `json:"fileTypes,omitempty"`
	Positions  []string `json:"positions,omitempty"`
}

// JSONPatternTrigger represents trigger conditions in JSON
type JSONPatternTrigger struct {
	Type  string `json:"type"`
	Value string `json:"value,omitempty"`
}

// Loader loads patterns from JSON files
type Loader struct{}

// NewLoader creates a new pattern loader
func NewLoader() *Loader {
	return &Loader{}
}

// LoadFile loads patterns from a single JSON file
func (l *Loader) LoadFile(path string) ([]Pattern, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read pattern file: %w", err)
	}

	var file PatternFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("failed to parse pattern file: %w", err)
	}

	patterns := make([]Pattern, len(file.Patterns))
	for i, jp := range file.Patterns {
		patterns[i] = l.convertPattern(jp, file)
	}

	return patterns, nil
}

// LoadDir loads all pattern files from a directory
func (l *Loader) LoadDir(dir string) ([]Pattern, error) {
	var allPatterns []Pattern

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		// Only process .json files
		if !strings.HasSuffix(path, ".json") {
			return nil
		}

		patterns, err := l.LoadFile(path)
		if err != nil {
			// Log error but continue loading other files
			fmt.Printf("Warning: failed to load pattern file %s: %v\n", path, err)
			return nil
		}

		allPatterns = append(allPatterns, patterns...)
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to walk pattern directory: %w", err)
	}

	return allPatterns, nil
}

// convertPattern converts a JSON pattern to internal Pattern format
func (l *Loader) convertPattern(jp JSONPattern, file PatternFile) Pattern {
	p := Pattern{
		ID:          jp.ID,
		Description: jp.Description,
		Template:    jp.Template,
		Generator:   jp.Generator,
		Priority:    jp.Priority,
		IsSkeleton:  jp.IsSkeleton,
		Variables:   jp.Variables,
	}

	// Convert context
	p.Context = PatternContext{
		Languages:  jp.Context.Languages,
		Frameworks: jp.Context.Frameworks,
		FileTypes:  l.convertFileTypes(jp.Context.FileTypes),
		Positions:  l.convertPositions(jp.Context.Positions),
	}

	// Apply file-level defaults
	if len(p.Context.Languages) == 0 && file.Language != "" {
		p.Context.Languages = []string{file.Language}
	}
	if len(p.Context.Frameworks) == 0 && file.Framework != "" {
		p.Context.Frameworks = []string{file.Framework}
	}

	// Convert trigger
	p.Trigger = l.convertTrigger(jp.Trigger)

	return p
}

// convertFileTypes converts string file types to FileType constants
func (l *Loader) convertFileTypes(types []string) []string {
	result := make([]string, len(types))
	for i, t := range types {
		result[i] = l.normalizeFileType(t)
	}
	return result
}

// normalizeFileType normalizes a file type string
func (l *Loader) normalizeFileType(t string) string {
	switch strings.ToLower(t) {
	case "controller":
		return string(FileTypeController)
	case "model":
		return string(FileTypeModel)
	case "view":
		return string(FileTypeView)
	case "component":
		return string(FileTypeComponent)
	case "service":
		return string(FileTypeService)
	case "repository":
		return string(FileTypeRepository)
	case "interface":
		return string(FileTypeInterface)
	case "trait":
		return string(FileTypeTrait)
	case "middleware":
		return string(FileTypeMiddleware)
	case "migration":
		return string(FileTypeMigration)
	case "seeder":
		return string(FileTypeSeeder)
	case "factory":
		return string(FileTypeFactory)
	case "test":
		return string(FileTypeTest)
	case "config":
		return string(FileTypeConfig)
	case "route":
		return string(FileTypeRoute)
	case "command":
		return string(FileTypeCommand)
	case "event":
		return string(FileTypeEvent)
	case "listener":
		return string(FileTypeListener)
	case "job":
		return string(FileTypeJob)
	case "mail":
		return string(FileTypeMail)
	case "notification":
		return string(FileTypeNotification)
	case "policy":
		return string(FileTypePolicy)
	case "request":
		return string(FileTypeRequest)
	case "resource":
		return string(FileTypeResource)
	default:
		return string(FileTypeUnknown)
	}
}

// convertPositions converts string positions to PositionContext constants
func (l *Loader) convertPositions(positions []string) []string {
	result := make([]string, len(positions))
	for i, p := range positions {
		result[i] = l.normalizePosition(p)
	}
	return result
}

// normalizePosition normalizes a position string
func (l *Loader) normalizePosition(p string) string {
	switch strings.ToLower(p) {
	case "file_start":
		return string(PositionContextFileStart)
	case "after_imports":
		return string(PositionContextAfterImports)
	case "top_level":
		return string(PositionContextTopLevel)
	case "class_body":
		return string(PositionContextClassBody)
	case "method_body":
		return string(PositionContextMethodBody)
	case "method_params":
		return string(PositionContextMethodParams)
	case "property_decl":
		return string(PositionContextPropertyDecl)
	case "assignment":
		return string(PositionContextAssignment)
	case "method_call":
		return string(PositionContextMethodCall)
	case "static_call":
		return string(PositionContextStaticCall)
	case "array_element":
		return string(PositionContextArrayElement)
	case "string":
		return string(PositionContextString)
	case "comment":
		return string(PositionContextComment)
	default:
		return string(PositionContextUnknown)
	}
}

// convertTrigger converts a JSON trigger to PatternTrigger
func (l *Loader) convertTrigger(jt JSONPatternTrigger) PatternTrigger {
	pt := PatternTrigger{
		Value: jt.Value,
	}

	switch strings.ToLower(jt.Type) {
	case "empty":
		pt.Type = TriggerTypeEmpty
	case "text":
		pt.Type = TriggerTypeText
	case "regex":
		pt.Type = TriggerTypeRegex
	case "newline":
		pt.Type = TriggerTypeNewLine
	case "always":
		pt.Type = TriggerTypeAlways
	default:
		pt.Type = TriggerTypeText
	}

	return pt
}

// ValidatePatternFile validates a pattern file structure
func (l *Loader) ValidatePatternFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	var file PatternFile
	if err := json.Unmarshal(data, &file); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}

	// Validate required fields
	if file.Version == "" {
		return fmt.Errorf("missing 'version' field")
	}

	if len(file.Patterns) == 0 {
		return fmt.Errorf("no patterns defined")
	}

	// Validate each pattern
	for i, p := range file.Patterns {
		if p.ID == "" {
			return fmt.Errorf("pattern %d: missing 'id' field", i)
		}
		if p.Description == "" {
			return fmt.Errorf("pattern %d (%s): missing 'description' field", i, p.ID)
		}
		if p.Template == "" && p.Generator == "" {
			return fmt.Errorf("pattern %d (%s): must have either 'template' or 'generator'", i, p.ID)
		}
	}

	return nil
}

// GenerateExampleFile generates an example pattern file
func (l *Loader) GenerateExampleFile() []byte {
	example := PatternFile{
		Version:     "1.0",
		Name:        "Custom Laravel Patterns",
		Description: "Custom code patterns for Laravel projects",
		Language:    "php",
		Framework:   "laravel",
		Patterns: []JSONPattern{
			{
				ID:          "custom_api_resource",
				Description: "API Resource with pagination",
				Context: JSONPatternContext{
					FileTypes: []string{"resource"},
					Positions: []string{"class_body"},
				},
				Trigger: JSONPatternTrigger{
					Type:  "text",
					Value: "toArray",
				},
				Template: `public function toArray(Request $request): array
{
    return [
        'id' => $this->id,
        'created_at' => $this->created_at->toISOString(),
        'updated_at' => $this->updated_at->toISOString(),
        $1
    ];
}`,
				Priority: 100,
			},
			{
				ID:          "custom_scope",
				Description: "Eloquent scope method",
				Context: JSONPatternContext{
					FileTypes: []string{"model"},
					Positions: []string{"class_body"},
				},
				Trigger: JSONPatternTrigger{
					Type:  "text",
					Value: "scope",
				},
				Template: `public function scope${name}(Builder $query): Builder
{
    return $query->where($1);
}`,
				Priority:  90,
				Variables: map[string]string{"name": "Active"},
			},
		},
	}

	data, _ := json.MarshalIndent(example, "", "    ")
	return data
}
