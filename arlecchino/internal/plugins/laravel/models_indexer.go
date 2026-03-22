package laravel

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type ModelField struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Default  string `json:"default,omitempty"`
}

type ModelRelationship struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Model  string `json:"model"`
	Method string `json:"method"`
}

type ModelIndexInfo struct {
	Name          string              `json:"name"`
	Table         string              `json:"table"`
	Fields        []ModelField        `json:"fields"`
	Fillable      []string            `json:"fillable"`
	Hidden        []string            `json:"hidden"`
	Casts         map[string]string   `json:"casts"`
	Relationships []ModelRelationship `json:"relationships"`
	FilePath      string              `json:"filePath"`
}

type ModelsIndexer struct {
	projectPath string
}

func NewModelsIndexer(projectPath string) *ModelsIndexer {
	return &ModelsIndexer{projectPath: projectPath}
}

func (m *ModelsIndexer) Index() (map[string]ModelIndexInfo, error) {
	models := make(map[string]ModelIndexInfo)
	modelsDir := filepath.Join(m.projectPath, "app", "Models")

	if _, err := os.Stat(modelsDir); os.IsNotExist(err) {
		return models, nil
	}

	err := filepath.Walk(modelsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".php") {
			return err
		}

		modelInfo, err := m.parseModel(path)
		if err == nil && modelInfo.Name != "" {
			models[modelInfo.Name] = modelInfo
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	m.enrichWithMigrationData(models)
	return models, nil
}

func (m *ModelsIndexer) parseModel(filePath string) (ModelIndexInfo, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return ModelIndexInfo{}, err
	}
	defer file.Close()

	info := ModelIndexInfo{
		FilePath:      filePath,
		Casts:         make(map[string]string),
		Fields:        []ModelField{},
		Fillable:      []string{},
		Hidden:        []string{},
		Relationships: []ModelRelationship{},
	}

	scanner := bufio.NewScanner(file)
	var content strings.Builder
	for scanner.Scan() {
		content.WriteString(scanner.Text() + "\n")
	}
	text := content.String()

	info.Name = m.extractClassName(text)
	info.Table = m.extractTableName(text, info.Name)
	info.Fillable = m.extractArrayProperty(text, "fillable")
	info.Hidden = m.extractArrayProperty(text, "hidden")
	info.Casts = m.extractCasts(text)
	info.Relationships = m.extractRelationships(text)

	return info, nil
}

func (m *ModelsIndexer) extractClassName(content string) string {
	pattern := regexp.MustCompile(`class\s+(\w+)\s+extends`)
	matches := pattern.FindStringSubmatch(content)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

func (m *ModelsIndexer) extractTableName(content, modelName string) string {
	pattern := regexp.MustCompile(`protected\s+\$table\s*=\s*['"]([^'"]+)['"]`)
	matches := pattern.FindStringSubmatch(content)
	if len(matches) > 1 {
		return matches[1]
	}
	return m.pluralize(m.snakeCase(modelName))
}

func (m *ModelsIndexer) extractArrayProperty(content, propertyName string) []string {
	pattern := regexp.MustCompile(`protected\s+\$` + propertyName + `\s*=\s*\[([\s\S]*?)\]`)
	matches := pattern.FindStringSubmatch(content)
	if len(matches) < 2 {
		return []string{}
	}

	items := []string{}
	itemPattern := regexp.MustCompile(`['"]([^'"]+)['"]`)
	for _, match := range itemPattern.FindAllStringSubmatch(matches[1], -1) {
		if len(match) > 1 {
			items = append(items, match[1])
		}
	}
	return items
}

func (m *ModelsIndexer) extractCasts(content string) map[string]string {
	casts := make(map[string]string)
	pattern := regexp.MustCompile(`protected\s+\$casts\s*=\s*\[([\s\S]*?)\]`)
	matches := pattern.FindStringSubmatch(content)
	if len(matches) < 2 {
		return casts
	}

	castPattern := regexp.MustCompile(`['"]([^'"]+)['"]\s*=>\s*['"]([^'"]+)['"]`)
	for _, match := range castPattern.FindAllStringSubmatch(matches[1], -1) {
		if len(match) > 2 {
			casts[match[1]] = match[2]
		}
	}
	return casts
}

func (m *ModelsIndexer) extractRelationships(content string) []ModelRelationship {
	relationships := []ModelRelationship{}
	relationTypes := []string{"hasOne", "hasMany", "belongsTo", "belongsToMany", "morphTo", "morphMany"}

	for _, relType := range relationTypes {
		pattern := regexp.MustCompile(`function\s+(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{\s*return\s+\$this->` + relType + `\((\w+)::class`)
		matches := pattern.FindAllStringSubmatch(content, -1)

		for _, match := range matches {
			if len(match) > 2 {
				relationships = append(relationships, ModelRelationship{
					Name:   match[1],
					Type:   relType,
					Model:  match[2],
					Method: match[1] + "()",
				})
			}
		}
	}

	return relationships
}

func (m *ModelsIndexer) enrichWithMigrationData(models map[string]ModelIndexInfo) {
	migrationsDir := filepath.Join(m.projectPath, "database", "migrations")
	if _, err := os.Stat(migrationsDir); os.IsNotExist(err) {
		return
	}

	for modelName, modelInfo := range models {
		migrationPath := m.findMigrationForTable(migrationsDir, modelInfo.Table)
		if migrationPath != "" {
			fields := m.parseMigration(migrationPath)
			modelInfo.Fields = fields
			models[modelName] = modelInfo
		}
	}
}

func (m *ModelsIndexer) findMigrationForTable(migrationsDir, tableName string) string {
	var foundPath string
	filepath.Walk(migrationsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".php") {
			return err
		}

		file, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "create('"+tableName+"'") || strings.Contains(line, `create("`+tableName+`"`) {
				foundPath = path
				return filepath.SkipAll
			}
		}
		return nil
	})
	return foundPath
}

func (m *ModelsIndexer) parseMigration(filePath string) []ModelField {
	file, err := os.Open(filePath)
	if err != nil {
		return []ModelField{}
	}
	defer file.Close()

	fields := []ModelField{}
	scanner := bufio.NewScanner(file)
	insideSchema := false

	typePatterns := map[string]*regexp.Regexp{
		"string":     regexp.MustCompile(`\$table->string\(['"](\w+)['"]`),
		"text":       regexp.MustCompile(`\$table->text\(['"](\w+)['"]`),
		"integer":    regexp.MustCompile(`\$table->integer\(['"](\w+)['"]`),
		"bigInteger": regexp.MustCompile(`\$table->bigInteger\(['"](\w+)['"]`),
		"boolean":    regexp.MustCompile(`\$table->boolean\(['"](\w+)['"]`),
		"date":       regexp.MustCompile(`\$table->date\(['"](\w+)['"]`),
		"datetime":   regexp.MustCompile(`\$table->datetime\(['"](\w+)['"]`),
		"timestamp":  regexp.MustCompile(`\$table->timestamp\(['"](\w+)['"]`),
		"json":       regexp.MustCompile(`\$table->json\(['"](\w+)['"]`),
		"decimal":    regexp.MustCompile(`\$table->decimal\(['"](\w+)['"]`),
	}

	for scanner.Scan() {
		line := scanner.Text()

		if strings.Contains(line, "Schema::create") || strings.Contains(line, "Schema::table") {
			insideSchema = true
			continue
		}

		if insideSchema && strings.Contains(line, "});") {
			break
		}

		if !insideSchema {
			continue
		}

		for typeName, pattern := range typePatterns {
			matches := pattern.FindStringSubmatch(line)
			if len(matches) > 1 {
				field := ModelField{
					Name:     matches[1],
					Type:     typeName,
					Nullable: strings.Contains(line, "->nullable()"),
				}

				defaultPattern := regexp.MustCompile(`->default\(['"']?([^'")]+)['"']?\)`)
				if defaultMatches := defaultPattern.FindStringSubmatch(line); len(defaultMatches) > 1 {
					field.Default = defaultMatches[1]
				}

				fields = append(fields, field)
				break
			}
		}
	}

	return fields
}

func (m *ModelsIndexer) snakeCase(s string) string {
	var result strings.Builder
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result.WriteRune('_')
		}
		result.WriteRune(r)
	}
	return strings.ToLower(result.String())
}

func (m *ModelsIndexer) pluralize(s string) string {
	if strings.HasSuffix(s, "y") {
		return strings.TrimSuffix(s, "y") + "ies"
	}
	if strings.HasSuffix(s, "s") || strings.HasSuffix(s, "x") || strings.HasSuffix(s, "ch") || strings.HasSuffix(s, "sh") {
		return s + "es"
	}
	return s + "s"
}

func (m *ModelsIndexer) ExportJSON(models map[string]ModelIndexInfo) (string, error) {
	if len(models) == 0 {
		return "{}", nil
	}

	data, err := json.MarshalIndent(models, "", "  ")
	if err != nil {
		return "", err
	}

	result := string(data)
	if result == "" {
		return "{}", nil
	}

	return result, nil
}
