package predictive

import (
	"path/filepath"
	"regexp"
	"strings"

	lspregistry "arlecchino/internal/lsp"
)

// ContextAnalyzer analyzes code context using Tree-sitter and heuristics
type ContextAnalyzer struct {
	ast *ASTAnalyzer
}

// NewContextAnalyzer creates a new context analyzer
func NewContextAnalyzer() *ContextAnalyzer {
	return &ContextAnalyzer{
		ast: NewASTAnalyzer(),
	}
}

// Analyze analyzes the given file content and returns context
func (a *ContextAnalyzer) Analyze(filePath string, content []byte, line, column int) *FileContext {
	ctx := &FileContext{
		FilePath: filePath,
		Language: a.detectLanguage(filePath),
		Position: Position{
			Line:    line,
			Column:  column,
			Context: PositionContextUnknown,
		},
	}

	// Check if file is empty
	contentText := string(content)
	trimmed := strings.TrimSpace(contentText)
	ctx.IsEmpty = len(trimmed) == 0 || a.isOnlyBoilerplate(trimmed, ctx.Language)

	// Detect file type from path
	ctx.FileType = a.detectFileType(filePath)

	// Detect framework
	ctx.Framework = a.detectFramework(filePath, contentText)

	// Use Tree-sitter AST analysis for precise context
	if a.ast != nil {
		astCtx, err := a.ast.AnalyzePosition(ctx.Language, content, line, column)
		if err == nil && astCtx != nil {
			// Apply AST context
			ctx.ClassName = astCtx.ClassName
			ctx.ClassParent = astCtx.ParentClass
			ctx.ClassTraits = astCtx.Uses
			ctx.Namespace = astCtx.Namespace
			ctx.Imports = astCtx.Imports
			ctx.HasImports = len(astCtx.Imports) > 0
			ctx.Position.InClass = astCtx.InClass
			ctx.Position.InMethod = astCtx.InMethod
			ctx.Position.InFunction = astCtx.InFunction
			ctx.Position.MethodName = astCtx.MethodName
			ctx.Position.Context = astCtx.Context
			if astCtx.Scope != "" {
				ctx.Position.Scope = Scope(astCtx.Scope)
			}
		} else {
			// Fallback to heuristic analysis
			a.analyzeContent(ctx, content, line, column)
		}
	} else {
		// Fallback to heuristic analysis
		a.analyzeContent(ctx, content, line, column)
	}

	return ctx
}

// detectLanguage detects programming language from file extension
func (a *ContextAnalyzer) detectLanguage(filePath string) string {
	lowerPath := strings.ToLower(filePath)
	baseName := strings.ToLower(filepath.Base(filePath))

	// Handle blade templates
	if strings.HasSuffix(lowerPath, ".blade.php") {
		return "blade"
	}

	// Handle .env variants
	if strings.HasPrefix(baseName, ".env") {
		return "env"
	}

	if lang := lspregistry.GetLanguageByFilename(baseName); lang != nil {
		return lang.ID
	}

	ext := strings.ToLower(filepath.Ext(lowerPath))
	if ext != "" {
		if lang := lspregistry.GetLanguageByExtension(ext); lang != nil {
			return lang.ID
		}
	}

	return "unknown"
}

// isOnlyBoilerplate checks if content is just boilerplate (<?php, package, etc.)
func (a *ContextAnalyzer) isOnlyBoilerplate(content, language string) bool {
	lines := strings.Split(content, "\n")
	meaningfulLines := 0

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		// Skip boilerplate
		switch language {
		case "php":
			if trimmed == "<?php" || strings.HasPrefix(trimmed, "namespace ") ||
				strings.HasPrefix(trimmed, "use ") || strings.HasPrefix(trimmed, "//") ||
				strings.HasPrefix(trimmed, "/*") || strings.HasPrefix(trimmed, "*") {
				continue
			}
		case "go":
			if strings.HasPrefix(trimmed, "package ") || strings.HasPrefix(trimmed, "import ") ||
				strings.HasPrefix(trimmed, "//") {
				continue
			}
		case "typescript", "javascript":
			if strings.HasPrefix(trimmed, "import ") || strings.HasPrefix(trimmed, "export ") ||
				strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "/*") {
				continue
			}
		case "python":
			if strings.HasPrefix(trimmed, "import ") || strings.HasPrefix(trimmed, "from ") ||
				strings.HasPrefix(trimmed, "#") || trimmed == "\"\"\"" || trimmed == "'''" {
				continue
			}
		}
		meaningfulLines++
	}

	return meaningfulLines == 0
}

// detectFileType detects semantic file type from path
func (a *ContextAnalyzer) detectFileType(filePath string) FileType {
	lowerPath := strings.ToLower(filePath)
	base := strings.ToLower(filepath.Base(filePath))

	// Special case: All .blade.php files are views (Blade templates)
	// Must check BEFORE pattern matching to avoid "test.blade.php" → FileTypeTest
	if strings.HasSuffix(lowerPath, ".blade.php") {
		return FileTypeView
	}

	// Universal patterns
	patterns := []struct {
		pattern  string
		fileType FileType
	}{
		// Controllers
		{"controller", FileTypeController},
		{"controllers/", FileTypeController},
		// Models
		{"model", FileTypeModel},
		{"models/", FileTypeModel},
		{"entities/", FileTypeModel},
		// Services
		{"service", FileTypeService},
		{"services/", FileTypeService},
		// Repositories
		{"repository", FileTypeRepository},
		{"repositories/", FileTypeRepository},
		// Middleware
		{"middleware", FileTypeMiddleware},
		// Routes
		{"route", FileTypeRoute},
		{"routes/", FileTypeRoute},
		// Migrations
		{"migration", FileTypeMigration},
		{"migrations/", FileTypeMigration},
		// Tests
		{"test", FileTypeTest},
		{"tests/", FileTypeTest},
		{"_test.go", FileTypeTest},
		{".spec.", FileTypeTest},
		{".test.", FileTypeTest},
		// Commands
		{"command", FileTypeCommand},
		{"commands/", FileTypeCommand},
		// Events
		{"event", FileTypeEvent},
		{"events/", FileTypeEvent},
		// Listeners
		{"listener", FileTypeListener},
		{"listeners/", FileTypeListener},
		// Jobs
		{"job", FileTypeJob},
		{"jobs/", FileTypeJob},
		// Policies
		{"policy", FileTypePolicy},
		{"policies/", FileTypePolicy},
		// Requests
		{"request", FileTypeRequest},
		{"requests/", FileTypeRequest},
		// Resources
		{"resource", FileTypeResource},
		{"resources/", FileTypeResource},
		// Factories
		{"factory", FileTypeFactory},
		{"factories/", FileTypeFactory},
		// Seeders
		{"seeder", FileTypeSeeder},
		{"seeders/", FileTypeSeeder},
		// Providers
		{"provider", FileTypeProvider},
		{"providers/", FileTypeProvider},
		// Components
		{"component", FileTypeComponent},
		{"components/", FileTypeComponent},
		// Config
		{"config", FileTypeConfig},
		// Views
		{"view", FileTypeView},
		{"views/", FileTypeView},
		{"templates/", FileTypeView},
	}

	for _, p := range patterns {
		if strings.Contains(lowerPath, p.pattern) {
			return p.fileType
		}
	}

	// Check by file name patterns
	if strings.HasSuffix(base, "controller.php") || strings.HasSuffix(base, "controller.go") ||
		strings.HasSuffix(base, "controller.ts") || strings.HasSuffix(base, "controller.py") {
		return FileTypeController
	}

	return FileTypeUnknown
}

// detectFramework detects the framework being used
func (a *ContextAnalyzer) detectFramework(filePath, content string) string {
	lowerPath := strings.ToLower(filePath)
	lowerContent := strings.ToLower(content)

	// PHP frameworks
	if strings.Contains(lowerPath, ".php") {
		if strings.Contains(lowerContent, "illuminate\\") ||
			strings.Contains(lowerContent, "laravel") ||
			strings.Contains(lowerPath, "app/http/controllers") {
			return "laravel"
		}
		if strings.Contains(lowerContent, "symfony\\") {
			return "symfony"
		}
	}

	// Python frameworks
	if strings.Contains(lowerPath, ".py") {
		if strings.Contains(lowerContent, "from django") || strings.Contains(lowerContent, "import django") {
			return "django"
		}
		if strings.Contains(lowerContent, "from flask") || strings.Contains(lowerContent, "import flask") {
			return "flask"
		}
		if strings.Contains(lowerContent, "from fastapi") {
			return "fastapi"
		}
	}

	// TypeScript/JavaScript frameworks
	if strings.Contains(lowerPath, ".ts") || strings.Contains(lowerPath, ".js") {
		if strings.Contains(lowerContent, "@nestjs/") {
			return "nestjs"
		}
		if strings.Contains(lowerContent, "from 'express'") || strings.Contains(lowerContent, "require('express')") {
			return "express"
		}
		if strings.Contains(lowerContent, "from 'next") || strings.Contains(lowerPath, "pages/") {
			return "nextjs"
		}
		if strings.Contains(lowerContent, "from 'vue'") || strings.Contains(lowerPath, ".vue") {
			return "vue"
		}
		if strings.Contains(lowerContent, "from 'react'") || strings.Contains(lowerContent, "from \"react\"") {
			return "react"
		}
	}

	// Go frameworks
	if strings.Contains(lowerPath, ".go") {
		if strings.Contains(lowerContent, "github.com/gin-gonic/gin") {
			return "gin"
		}
		if strings.Contains(lowerContent, "github.com/gofiber/fiber") {
			return "fiber"
		}
		if strings.Contains(lowerContent, "github.com/labstack/echo") {
			return "echo"
		}
	}

	// Ruby frameworks
	if strings.Contains(lowerPath, ".rb") {
		if strings.Contains(lowerContent, "applicationcontroller") ||
			strings.Contains(lowerContent, "activerecord") ||
			strings.Contains(lowerContent, "applicationrecord") ||
			strings.Contains(lowerPath, "app/controllers") ||
			strings.Contains(lowerPath, "app/models") {
			return "rails"
		}
		if strings.Contains(lowerContent, "sinatra") {
			return "sinatra"
		}
	}

	// Vue files
	if strings.Contains(lowerPath, ".vue") {
		return "vue"
	}

	return ""
}

// analyzeContent performs detailed content analysis
func (a *ContextAnalyzer) analyzeContent(ctx *FileContext, content []byte, line, column int) {
	text := string(content)
	lines := strings.Split(text, "\n")

	// Analyze imports/use statements
	ctx.Imports = a.extractImports(text, ctx.Language)
	ctx.HasImports = len(ctx.Imports) > 0

	// Analyze class/namespace
	a.analyzeClass(ctx, text, ctx.Language)

	// Analyze position context
	a.analyzePosition(ctx, lines, line, column, ctx.Language)
}

// extractImports extracts import statements
func (a *ContextAnalyzer) extractImports(content, language string) []string {
	var imports []string
	var regex *regexp.Regexp

	switch language {
	case "php":
		regex = regexp.MustCompile(`(?m)^use\s+([^;]+);`)
	case "go":
		// Handle both single and grouped imports
		singleRegex := regexp.MustCompile(`(?m)^import\s+"([^"]+)"`)
		groupRegex := regexp.MustCompile(`(?s)import\s*\(\s*([^)]+)\)`)

		for _, m := range singleRegex.FindAllStringSubmatch(content, -1) {
			imports = append(imports, m[1])
		}
		for _, m := range groupRegex.FindAllStringSubmatch(content, -1) {
			lines := strings.Split(m[1], "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "\"") {
					line = strings.Trim(line, "\"")
					imports = append(imports, line)
				}
			}
		}
		return imports
	case "typescript", "javascript":
		regex = regexp.MustCompile(`(?m)^import\s+.*from\s+['"]([^'"]+)['"]`)
	case "python":
		regex = regexp.MustCompile(`(?m)^(?:from\s+(\S+)\s+import|import\s+(\S+))`)
	default:
		return imports
	}

	if regex != nil {
		for _, m := range regex.FindAllStringSubmatch(content, -1) {
			if len(m) > 1 && m[1] != "" {
				imports = append(imports, m[1])
			}
		}
	}

	return imports
}

// analyzeClass extracts class information
func (a *ContextAnalyzer) analyzeClass(ctx *FileContext, content, language string) {
	switch language {
	case "php":
		// Namespace
		if m := regexp.MustCompile(`namespace\s+([^;]+);`).FindStringSubmatch(content); m != nil {
			ctx.Namespace = m[1]
		}
		// Class
		if m := regexp.MustCompile(`(?:abstract\s+|final\s+)?class\s+(\w+)`).FindStringSubmatch(content); m != nil {
			ctx.ClassName = m[1]
		}
		// Extends
		if m := regexp.MustCompile(`class\s+\w+\s+extends\s+(\w+)`).FindStringSubmatch(content); m != nil {
			ctx.ClassParent = m[1]
		}
		// Traits
		traitRegex := regexp.MustCompile(`use\s+([^;{]+)[;{]`)
		for _, m := range traitRegex.FindAllStringSubmatch(content, -1) {
			traits := strings.Split(m[1], ",")
			for _, t := range traits {
				t = strings.TrimSpace(t)
				if !strings.Contains(t, "\\") || strings.Contains(t, "Trait") {
					ctx.ClassTraits = append(ctx.ClassTraits, t)
				}
			}
		}

	case "go":
		// Package
		if m := regexp.MustCompile(`package\s+(\w+)`).FindStringSubmatch(content); m != nil {
			ctx.Namespace = m[1]
		}
		// Struct (as class equivalent)
		if m := regexp.MustCompile(`type\s+(\w+)\s+struct`).FindStringSubmatch(content); m != nil {
			ctx.ClassName = m[1]
		}

	case "typescript", "javascript":
		// Class
		if m := regexp.MustCompile(`class\s+(\w+)`).FindStringSubmatch(content); m != nil {
			ctx.ClassName = m[1]
		}
		// Extends
		if m := regexp.MustCompile(`class\s+\w+\s+extends\s+(\w+)`).FindStringSubmatch(content); m != nil {
			ctx.ClassParent = m[1]
		}

	case "python":
		// Class
		if m := regexp.MustCompile(`class\s+(\w+)`).FindStringSubmatch(content); m != nil {
			ctx.ClassName = m[1]
		}
		// Inherits
		if m := regexp.MustCompile(`class\s+\w+\s*\(([^)]+)\)`).FindStringSubmatch(content); m != nil {
			parents := strings.Split(m[1], ",")
			if len(parents) > 0 {
				ctx.ClassParent = strings.TrimSpace(parents[0])
			}
		}
	}
}

// analyzePosition determines cursor position context
func (a *ContextAnalyzer) analyzePosition(ctx *FileContext, lines []string, line, column int, language string) {
	if line <= 0 || line > len(lines) {
		return
	}

	currentLine := ""
	if line <= len(lines) {
		currentLine = lines[line-1]
	}

	// Get text before cursor on current line
	textBefore := ""
	if column > 0 && column <= len(currentLine) {
		textBefore = currentLine[:column-1]
	} else if len(currentLine) > 0 {
		textBefore = currentLine
	}
	textBefore = strings.TrimSpace(textBefore)

	// Check for method/function context by scanning backwards
	braceCount := 0
	inClass := false
	inMethod := false
	methodName := ""

	for i := line - 1; i >= 0; i-- {
		l := lines[i]
		braceCount += strings.Count(l, "}") - strings.Count(l, "{")

		// Check for method/function declaration
		if !inMethod {
			switch language {
			case "php":
				if m := regexp.MustCompile(`function\s+(\w+)\s*\(`).FindStringSubmatch(l); m != nil {
					if braceCount <= 0 {
						inMethod = true
						methodName = m[1]
					}
				}
			case "go":
				if m := regexp.MustCompile(`func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(`).FindStringSubmatch(l); m != nil {
					if braceCount <= 0 {
						inMethod = true
						methodName = m[1]
					}
				}
			case "typescript", "javascript":
				if m := regexp.MustCompile(`(?:function\s+(\w+)|(\w+)\s*(?:=\s*)?(?:async\s*)?\([^)]*\)\s*(?:=>|{))`).FindStringSubmatch(l); m != nil {
					if braceCount <= 0 {
						inMethod = true
						if m[1] != "" {
							methodName = m[1]
						} else {
							methodName = m[2]
						}
					}
				}
			case "python":
				if m := regexp.MustCompile(`def\s+(\w+)\s*\(`).FindStringSubmatch(l); m != nil {
					inMethod = true
					methodName = m[1]
				}
			}
		}

		// Check for class declaration
		if !inClass {
			switch language {
			case "php", "typescript", "javascript":
				if regexp.MustCompile(`class\s+\w+`).MatchString(l) {
					inClass = true
				}
			case "go":
				if regexp.MustCompile(`type\s+\w+\s+struct`).MatchString(l) {
					inClass = true
				}
			case "python":
				if regexp.MustCompile(`class\s+\w+`).MatchString(l) {
					inClass = true
				}
			}
		}
	}

	ctx.Position.InClass = inClass
	ctx.Position.InMethod = inMethod
	ctx.Position.MethodName = methodName

	// Determine position context
	if ctx.IsEmpty {
		ctx.Position.Context = PositionContextFileStart
		return
	}

	switch {
	case strings.HasSuffix(textBefore, "->") || strings.HasSuffix(textBefore, "."):
		ctx.Position.Context = PositionContextMethodCall
	case strings.HasSuffix(textBefore, "::"):
		ctx.Position.Context = PositionContextStaticCall
	case strings.HasSuffix(textBefore, "="):
		ctx.Position.Context = PositionContextAssignment
	case strings.Contains(textBefore, "(") && !strings.Contains(textBefore, ")"):
		ctx.Position.Context = PositionContextMethodParams
	case inMethod:
		ctx.Position.Context = PositionContextMethodBody
	case inClass && !inMethod:
		ctx.Position.Context = PositionContextClassBody
	case !inClass && !inMethod && ctx.HasImports:
		if len(textBefore) > 0 {
			ctx.Position.Context = PositionContextTopLevel
		} else {
			ctx.Position.Context = PositionContextAfterImports
		}
	case !inClass && !inMethod && len(textBefore) > 0:
		ctx.Position.Context = PositionContextTopLevel
	default:
		ctx.Position.Context = PositionContextUnknown
	}

	// Detect scope
	scopeRegex := regexp.MustCompile(`(public|private|protected)\s+`)
	if m := scopeRegex.FindStringSubmatch(textBefore); m != nil {
		ctx.Position.Scope = Scope(m[1])
	}
}

// ExtractCurrentPrefix extracts the word/prefix being typed from text before cursor.
// It handles special cases like strings (view('xxx'), config('xxx'), etc.)
// and falls back to extracting the last identifier.
// This is a fallback when Tree-sitter AST extraction fails.
func ExtractCurrentPrefix(textBefore string) string {
	if len(textBefore) == 0 {
		return ""
	}

	lastSingleQuote := strings.LastIndex(textBefore, "'")
	lastDoubleQuote := strings.LastIndex(textBefore, "\"")

	lastQuote := max(lastSingleQuote, lastDoubleQuote)

	if lastQuote >= 0 {
		afterQuote := textBefore[lastQuote+1:]
		quoteChar := textBefore[lastQuote]
		if !strings.Contains(afterQuote, string(quoteChar)) {
			return afterQuote
		}
	}

	prefix := ""
	for i := len(textBefore) - 1; i >= 0; i-- {
		c := textBefore[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
			prefix = string(c) + prefix
		} else {
			break
		}
	}
	return prefix
}

// ExtractCurrentPrefixWithLanguage is a language-aware prefix extractor for fallback cases.
func ExtractCurrentPrefixWithLanguage(textBefore, language string) string {
	if len(textBefore) == 0 {
		return ""
	}

	if inString, value, _ := DetectStringContextFromText(textBefore); inString {
		return value
	}

	prefix := ""
	for i := len(textBefore) - 1; i >= 0; i-- {
		c := textBefore[i]
		if isPrefixCharForLanguage(c, language) {
			prefix = string(c) + prefix
		} else {
			break
		}
	}
	return prefix
}

func isPrefixCharForLanguage(c byte, language string) bool {
	switch language {
	case "css", "scss", "sass", "less":
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '#' || c == '.' || c == '@'
	case "astro", "html", "vue", "svelte":
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == ':' || c == '@'
	case "blade":
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '@' || c == ':'
	case "bash", "shell":
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '$'
	default:
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$'
	}
}

type stringContextPattern struct {
	pattern *regexp.Regexp
	context string
}

var stringContextPatterns = []stringContextPattern{
	{pattern: regexp.MustCompile(`Route::(?:get|post|put|patch|delete|any|options)\s*\([^\)]*['"]([^'"]*)$`), context: "path"},
	{pattern: regexp.MustCompile(`Route::match\s*\([^\)]*['"]([^'"]*)$`), context: "path"},
	{pattern: regexp.MustCompile(`\broute\s*\(\s*['"]([^'"]*)$`), context: "route"},
	{pattern: regexp.MustCompile(`\bview\s*\(\s*['"]([^'"]*)$`), context: "view"},
	{pattern: regexp.MustCompile(`\bconfig\s*\(\s*['"]([^'"]*)$`), context: "config"},
	{pattern: regexp.MustCompile(`\btrans\s*\(\s*['"]([^'"]*)$`), context: "trans"},
	{pattern: regexp.MustCompile(`\b__\s*\(\s*['"]([^'"]*)$`), context: "trans"},
	{pattern: regexp.MustCompile(`\basset\s*\(\s*['"]([^'"]*)$`), context: "path"},
	{pattern: regexp.MustCompile(`\burl\s*\(\s*['"]([^'"]*)$`), context: "path"},
	{pattern: regexp.MustCompile(`\bredirect\s*\(\s*['"]([^'"]*)$`), context: "path"},
	{pattern: regexp.MustCompile(`\benv\s*\(\s*['"]([^'"]*)$`), context: "config"},
	{pattern: regexp.MustCompile(`@include\s*\(\s*['"]([^'"]*)$`), context: "view"},
	{pattern: regexp.MustCompile(`@extends\s*\(\s*['"]([^'"]*)$`), context: "view"},
	{pattern: regexp.MustCompile(`@component\s*\(\s*['"]([^'"]*)$`), context: "view"},
	{pattern: regexp.MustCompile(`->name\s*\(\s*['"]([^'"]*)$`), context: "route"},
	{pattern: regexp.MustCompile(`->middleware\s*\(\s*['"]([^'"]*)$`), context: "route"},
	{pattern: regexp.MustCompile(`\bfrom\s+['"]([^'"]*)$`), context: "import"},
	{pattern: regexp.MustCompile(`\brequire\s*\(\s*['"]([^'"]*)$`), context: "import"},
}

// DetectStringContextFromText provides a heuristic string context when AST is unavailable.
func DetectStringContextFromText(textBefore string) (bool, string, string) {
	if textBefore == "" {
		return false, "", ""
	}

	lastSingleQuote := strings.LastIndex(textBefore, "'")
	lastDoubleQuote := strings.LastIndex(textBefore, "\"")
	lastQuote := max(lastSingleQuote, lastDoubleQuote)
	if lastQuote < 0 {
		return false, "", ""
	}

	quoteChar := textBefore[lastQuote]
	afterQuote := textBefore[lastQuote+1:]
	if strings.Contains(afterQuote, string(quoteChar)) {
		return false, "", ""
	}

	for _, entry := range stringContextPatterns {
		if match := entry.pattern.FindStringSubmatch(textBefore); match != nil {
			return true, match[1], entry.context
		}
	}

	if strings.HasPrefix(afterQuote, "./") || strings.HasPrefix(afterQuote, "../") || strings.HasPrefix(afterQuote, "/") || strings.Contains(afterQuote, "/") {
		return true, afterQuote, "path"
	}

	return true, afterQuote, ""
}
