package predictive

import (
	"path/filepath"
	"regexp"
	"strings"
)

var placeholderRegex = regexp.MustCompile(`\$([A-Z][A-Z0-9_]*)`)

type SmartFill interface {
	ResolvePlaceholders(template string, ctx *FileContext) string
	ResolveOne(placeholder string, ctx *FileContext) string
}

type PlaceholderResolver struct {
	resolvers map[string]func(*FileContext) string
}

func NewPlaceholderResolver() *PlaceholderResolver {
	r := &PlaceholderResolver{
		resolvers: make(map[string]func(*FileContext) string),
	}
	r.registerBuiltinResolvers()
	return r
}

func (r *PlaceholderResolver) registerBuiltinResolvers() {
	r.resolvers["CONTROLLER"] = resolveController
	r.resolvers["MODEL"] = resolveModel
	r.resolvers["METHOD"] = resolveMethod
	r.resolvers["PATH"] = resolvePath
	r.resolvers["RESOURCE"] = resolveResource
	r.resolvers["NAME"] = resolveName
	r.resolvers["TABLE"] = resolveTable
	r.resolvers["COLUMN"] = resolveColumn
	r.resolvers["FIELD"] = resolveField
	r.resolvers["RELATION"] = resolveRelation
	r.resolvers["TYPE"] = resolveType
	r.resolvers["REQUEST"] = resolveRequest
	r.resolvers["MIDDLEWARE"] = resolveMiddleware
	r.resolvers["VIEW"] = resolveView
	r.resolvers["VAR"] = resolveVar
	r.resolvers["EVENT"] = resolveEvent
	r.resolvers["PARAMS"] = resolveParams
	r.resolvers["ATTRIBUTE"] = resolveAttribute
	r.resolvers["RULES"] = resolveRules
	r.resolvers["VALUE"] = resolveValue
	r.resolvers["ROUTES"] = resolveRoutes
	r.resolvers["BEFORE"] = resolveBefore
	r.resolvers["AFTER"] = resolveAfter
	r.resolvers["BODY"] = resolveBody
}

func (r *PlaceholderResolver) ResolvePlaceholders(template string, ctx *FileContext) string {
	if ctx == nil {
		return template
	}

	return placeholderRegex.ReplaceAllStringFunc(template, func(match string) string {
		placeholder := strings.TrimPrefix(match, "$")
		return r.ResolveOne(placeholder, ctx)
	})
}

func (r *PlaceholderResolver) ResolveOne(placeholder string, ctx *FileContext) string {
	if resolver, ok := r.resolvers[placeholder]; ok {
		if value := resolver(ctx); value != "" {
			return value
		}
	}
	return defaultValue(placeholder)
}

func (r *PlaceholderResolver) Register(placeholder string, fn func(*FileContext) string) {
	r.resolvers[placeholder] = fn
}

func resolveController(ctx *FileContext) string {
	if ctx.ClassName != "" && strings.HasSuffix(ctx.ClassName, "Controller") {
		return ctx.ClassName
	}

	className := classNameFromFilePath(ctx.FilePath)
	if strings.HasSuffix(className, "Controller") {
		return className
	}

	modelName := extractModelFromFileName(ctx.FilePath)
	if modelName != "" {
		return modelName + "Controller"
	}

	return ""
}

func resolveModel(ctx *FileContext) string {
	if ctx.ClassName != "" {
		name := ctx.ClassName
		name = strings.TrimSuffix(name, "Controller")
		name = strings.TrimSuffix(name, "Service")
		name = strings.TrimSuffix(name, "Repository")
		name = strings.TrimSuffix(name, "Request")
		name = strings.TrimSuffix(name, "Resource")
		name = singularize(name)
		if name != ctx.ClassName && name != "" {
			return name
		}
	}

	modelName := extractModelFromFileName(ctx.FilePath)
	if modelName != "" {
		return singularize(modelName)
	}

	return ""
}

func resolveMethod(ctx *FileContext) string {
	if ctx.Position.MethodName != "" {
		return ctx.Position.MethodName
	}
	return ""
}

func resolvePath(ctx *FileContext) string {
	if ctx.FileType == FileTypeRoute {
		fileName := filepath.Base(ctx.FilePath)
		fileName = strings.TrimSuffix(fileName, filepath.Ext(fileName))
		if fileName == "web" || fileName == "api" || fileName == "console" || fileName == "channels" {
			return ""
		}
		return strings.ToLower(fileName)
	}

	modelName := resolveModel(ctx)
	if modelName != "" {
		return strings.ToLower(modelName) + "s"
	}

	fileName := filepath.Base(ctx.FilePath)
	fileName = strings.TrimSuffix(fileName, filepath.Ext(fileName))
	if strings.HasSuffix(strings.ToLower(fileName), "controller") {
		name := fileName[:len(fileName)-10]
		return strings.ToLower(name)
	}

	return ""
}

func resolveResource(ctx *FileContext) string {
	modelName := resolveModel(ctx)
	if modelName != "" {
		return strings.ToLower(modelName) + "s"
	}
	return ""
}

func resolveName(ctx *FileContext) string {
	if ctx.ClassName != "" {
		return ctx.ClassName
	}
	return classNameFromFilePath(ctx.FilePath)
}

func resolveTable(ctx *FileContext) string {
	fileName := filepath.Base(ctx.FilePath)

	if strings.Contains(fileName, "create_") && strings.Contains(fileName, "_table") {
		name := extractTableFromMigration(fileName)
		if name != "" {
			return name
		}
	}

	modelName := resolveModel(ctx)
	if modelName != "" {
		return strings.ToLower(pluralize(modelName))
	}

	return ""
}

func resolveColumn(ctx *FileContext) string {
	return ""
}

func resolveField(ctx *FileContext) string {
	return ""
}

func resolveRelation(ctx *FileContext) string {
	return ""
}

func resolveType(ctx *FileContext) string {
	if ctx.Language == "php" {
		return "string"
	}
	return ""
}

func resolveRequest(ctx *FileContext) string {
	modelName := resolveModel(ctx)
	if modelName != "" {
		return modelName + "Request"
	}
	return "Request"
}

func resolveMiddleware(ctx *FileContext) string {
	return ""
}

func resolveView(ctx *FileContext) string {
	modelName := resolveModel(ctx)
	if modelName != "" {
		return strings.ToLower(modelName) + "s.index"
	}
	return ""
}

func resolveVar(ctx *FileContext) string {
	modelName := resolveModel(ctx)
	if modelName != "" {
		return strings.ToLower(modelName) + "s"
	}
	return "data"
}

func resolveEvent(ctx *FileContext) string {
	return ""
}

func resolveParams(ctx *FileContext) string {
	return ""
}

func resolveAttribute(ctx *FileContext) string {
	return ""
}

func resolveRules(ctx *FileContext) string {
	return "string"
}

func resolveValue(ctx *FileContext) string {
	return ""
}

func resolveRoutes(ctx *FileContext) string {
	return ""
}

func resolveBefore(ctx *FileContext) string {
	return ""
}

func resolveAfter(ctx *FileContext) string {
	return ""
}

func resolveBody(ctx *FileContext) string {
	return ""
}

func defaultValue(placeholder string) string {
	defaults := map[string]string{
		"CONTROLLER": "Controller",
		"MODEL":      "Model",
		"METHOD":     "index",
		"PATH":       "path",
		"RESOURCE":   "resources",
		"NAME":       "name",
		"TABLE":      "table_name",
		"COLUMN":     "column_name",
		"FIELD":      "field",
		"RELATION":   "relation",
		"TYPE":       "string",
		"REQUEST":    "Request",
		"MIDDLEWARE": "auth",
		"VIEW":       "view.name",
		"VAR":        "data",
		"EVENT":      "Event",
		"PARAMS":     "",
		"ATTRIBUTE":  "attribute",
		"RULES":      "string",
		"VALUE":      "value",
		"ROUTES":     "",
		"BEFORE":     "",
		"AFTER":      "",
		"BODY":       "",
		"ZERO_VALUE": "${1:nil}",
		"CONTEXT":    "${2:context}",
		"ERROR":      "${3:err}",
		"VARIABLE":   "${4:v}",
		"EXPRESSION": "${5:expr}",
	}

	if v, ok := defaults[placeholder]; ok {
		return v
	}
	return "$" + placeholder
}

func classNameFromFilePath(filePath string) string {
	base := filepath.Base(filePath)
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)

	name = strings.TrimSuffix(name, ".blade")

	return toPascalCaseSmartFill(name)
}

func extractModelFromFileName(filePath string) string {
	base := filepath.Base(filePath)
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)

	suffixes := []string{"Controller", "Service", "Repository", "Request", "Resource", "Test", "Factory", "Seeder"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(name, suffix) {
			return strings.TrimSuffix(name, suffix)
		}
	}

	name = strings.TrimSuffix(name, ".blade")

	return toPascalCaseSmartFill(name)
}

func extractTableFromMigration(fileName string) string {
	name := strings.TrimSuffix(fileName, ".php")
	parts := strings.Split(name, "_")

	createIdx := -1
	tableIdx := -1
	for i, p := range parts {
		if p == "create" {
			createIdx = i
		}
		if p == "table" {
			tableIdx = i
		}
	}

	if createIdx >= 0 && tableIdx > createIdx {
		tableParts := parts[createIdx+1 : tableIdx]
		return strings.Join(tableParts, "_")
	}

	return ""
}

func toPascalCaseSmartFill(s string) string {
	parts := regexp.MustCompile(`[-_\s]+`).Split(s, -1)
	var result strings.Builder

	for _, part := range parts {
		if len(part) > 0 {
			result.WriteString(strings.ToUpper(string(part[0])))
			if len(part) > 1 {
				result.WriteString(part[1:])
			}
		}
	}

	return result.String()
}

func singularize(word string) string {
	if word == "" {
		return word
	}

	if strings.HasSuffix(word, "ies") {
		return strings.TrimSuffix(word, "ies") + "y"
	}
	if strings.HasSuffix(word, "ses") || strings.HasSuffix(word, "xes") ||
		strings.HasSuffix(word, "ches") || strings.HasSuffix(word, "shes") {
		return strings.TrimSuffix(word, "es")
	}
	if strings.HasSuffix(word, "s") && !strings.HasSuffix(word, "ss") && len(word) > 2 {
		return strings.TrimSuffix(word, "s")
	}

	return word
}

func pluralize(word string) string {
	if word == "" {
		return word
	}

	if strings.HasSuffix(word, "y") && len(word) > 1 {
		vowels := "aeiouAEIOU"
		if !strings.ContainsRune(vowels, rune(word[len(word)-2])) {
			return strings.TrimSuffix(word, "y") + "ies"
		}
	}

	if strings.HasSuffix(word, "s") || strings.HasSuffix(word, "x") ||
		strings.HasSuffix(word, "ch") || strings.HasSuffix(word, "sh") {
		return word + "es"
	}

	return word + "s"
}
