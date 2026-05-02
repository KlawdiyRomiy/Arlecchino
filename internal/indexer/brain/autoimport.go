package brain

import (
	"regexp"
	"strings"
	"unicode"

	"arlecchino/internal/indexer/core"
)

type AutoImporter struct {
	phpUseRegex   *regexp.Regexp
	goImportRegex *regexp.Regexp
	tsImportRegex *regexp.Regexp
	pyImportRegex *regexp.Regexp
	pyFromRegex   *regexp.Regexp
	rustUseRegex  *regexp.Regexp
	rubyRequireRe *regexp.Regexp
	planner       *ImportEditPlanner
}

var (
	cImportHeaders = map[string]string{
		"calloc":  "stdlib.h",
		"free":    "stdlib.h",
		"malloc":  "stdlib.h",
		"qsort":   "stdlib.h",
		"realloc": "stdlib.h",
		"printf":  "stdio.h",
		"sprintf": "stdio.h",
		"fprintf": "stdio.h",
		"scanf":   "stdio.h",
		"strlen":  "string.h",
		"strcmp":  "string.h",
		"strcpy":  "string.h",
		"memcpy":  "string.h",
	}
	cppImportHeaders = map[string]string{
		"map":           "map",
		"vector":        "vector",
		"string":        "string",
		"set":           "set",
		"unordered_map": "unordered_map",
		"cout":          "iostream",
		"cin":           "iostream",
		"cerr":          "iostream",
		"clog":          "iostream",
		"endl":          "iostream",
	}
)

func NewAutoImporter() *AutoImporter {
	return &AutoImporter{
		phpUseRegex:   regexp.MustCompile(`^\s*use\s+[^;]+;`),
		goImportRegex: regexp.MustCompile(`^\s*import\s+(?:\(|")`),
		tsImportRegex: regexp.MustCompile(`^\s*import\s+`),
		pyImportRegex: regexp.MustCompile(`^\s*(?:import|from)\s+`),
		pyFromRegex:   regexp.MustCompile(`^\s*from\s+\S+\s+import\s+`),
		rustUseRegex:  regexp.MustCompile(`^\s*use\s+`),
		rubyRequireRe: regexp.MustCompile(`^\s*require\s+`),
		planner:       NewImportEditPlanner(),
	}
}

func (ai *AutoImporter) GenerateImportEdit(symbol *core.Symbol, ctx CompletionContext) *core.TextEdit {
	namespace := symbol.Namespace

	if namespace == "" {
		namespace = ai.extractNamespaceFromName(symbol.Name, ctx.Language)
	}

	namespace = ai.normalizeImportNamespace(symbol, namespace, ctx)
	if namespace == "" {
		return nil
	}

	importStmt := ai.generateImportStatement(symbol, namespace, ctx.Language, ctx)
	if importStmt == "" {
		return nil
	}

	content := importEditContent(ctx)

	currentNS := ai.extractCurrentNamespace(content, ctx.Language)
	if namespace == currentNS {
		return nil
	}

	if ai.planner != nil && ai.planner.HasImport(content, ctx.Language, importStmt) {
		return nil
	}

	if ai.planner == nil && ai.hasImport(content, ctx.Language, namespace, symbol.Name, importStmt) {
		return nil
	}

	insertLine := ai.findImportInsertLine(content, ctx.Language)
	if ai.planner != nil {
		if edit, changed := ai.planner.PlanImportEdit(ctx, importStmt, insertLine); changed && edit != nil {
			return edit
		}
		if edit := ai.planner.FallbackInsertEdit(importStmt, insertLine); edit != nil {
			return edit
		}
	}

	return &core.TextEdit{
		StartLine:   insertLine,
		StartColumn: 1,
		EndLine:     insertLine,
		EndColumn:   1,
		Text:        importStmt + "\n",
	}
}

func (ai *AutoImporter) extractNamespaceFromName(name, language string) string {
	switch language {
	case "go":
		if idx := strings.Index(name, "."); idx > 0 {
			return name[:idx]
		}
	case "php", "php-laravel":
		if idx := strings.LastIndex(name, "\\"); idx > 0 {
			return name[:idx]
		}
	case "python":
		if idx := strings.LastIndex(name, "."); idx > 0 {
			return name[:idx]
		}
	case "rust":
		if idx := strings.LastIndex(name, "::"); idx > 0 {
			return name[:idx]
		}
	case "typescript", "javascript", "typescriptreact", "javascriptreact":
		if idx := strings.Index(name, "."); idx > 0 {
			return name[:idx]
		}
	}
	return ""
}

func (ai *AutoImporter) normalizeImportNamespace(symbol *core.Symbol, namespace string, ctx CompletionContext) string {
	if ctx.Language != "c" && ctx.Language != "cpp" {
		return namespace
	}

	return ai.headerForSymbol(symbol, namespace, ctx.Language)
}

func (ai *AutoImporter) extractCurrentNamespace(content []byte, language string) string {
	lines := strings.Split(string(content), "\n")

	switch language {
	case "php", "php-laravel":
		for _, line := range lines {
			if strings.HasPrefix(strings.TrimSpace(line), "namespace ") {
				parts := strings.TrimPrefix(strings.TrimSpace(line), "namespace ")
				parts = strings.TrimSuffix(parts, ";")
				return strings.TrimSpace(parts)
			}
		}
	case "go":
		for _, line := range lines {
			if strings.HasPrefix(strings.TrimSpace(line), "package ") {
				parts := strings.TrimPrefix(strings.TrimSpace(line), "package ")
				return strings.TrimSpace(parts)
			}
		}
	}
	return ""
}

func (ai *AutoImporter) hasImport(content []byte, language, namespace, name, importStmt string) bool {
	contentStr := string(content)
	lines := relevantImportLines(contentStr, language)
	trimmedStmt := strings.TrimSpace(importStmt)
	for _, line := range lines {
		trimmedLine := strings.TrimSpace(line)
		if trimmedStmt != "" && trimmedLine == trimmedStmt {
			return true
		}
	}

	switch language {
	case "php", "php-laravel":
		fullImport := qualifyImportPath(namespace, name, "\\")
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.Contains(trimmed, "use "+fullImport) ||
				(strings.Contains(trimmed, "use "+namespace+"\\{") && strings.Contains(trimmed, name)) {
				return true
			}
		}
	case "go":
		for _, line := range lines {
			if strings.Contains(line, `"`+namespace+`"`) {
				return true
			}
		}
	case "typescript", "javascript", "typescriptreact", "javascriptreact":
		for _, line := range lines {
			if strings.Contains(line, "from '"+namespace+"'") ||
				strings.Contains(line, `from "`+namespace+`"`) {
				return true
			}
		}
	case "python":
		for _, line := range lines {
			if strings.Contains(line, "from "+namespace+" import") ||
				strings.Contains(line, "import "+namespace) {
				return true
			}
		}
	case "rust":
		fullImport := qualifyImportPath(namespace, name, "::")
		for _, line := range lines {
			if strings.Contains(line, "use "+fullImport) {
				return true
			}
		}
	case "ruby":
		for _, line := range lines {
			if strings.Contains(line, "require '"+namespace+"'") ||
				strings.Contains(line, `require "`+namespace+`"`) {
				return true
			}
		}
	case "c", "cpp":
		for _, line := range lines {
			if strings.Contains(line, "#include <"+namespace+">") {
				return true
			}
		}
	}
	return false
}

func relevantImportLines(content, language string) []string {
	lines := strings.Split(content, "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if isCommentOnlyLine(trimmed, language) {
			continue
		}
		result = append(result, line)
	}
	return result
}

func isCommentOnlyLine(trimmed, language string) bool {
	if trimmed == "" {
		return false
	}
	switch language {
	case "python", "ruby", "bash", "shell":
		return strings.HasPrefix(trimmed, "#")
	case "html", "xml":
		return strings.HasPrefix(trimmed, "<!--")
	default:
		return strings.HasPrefix(trimmed, "//") ||
			strings.HasPrefix(trimmed, "/*") ||
			strings.HasPrefix(trimmed, "*") ||
			strings.HasPrefix(trimmed, "*/")
	}
}

func (ai *AutoImporter) findImportInsertLine(content []byte, language string) int {
	lines := strings.Split(string(content), "\n")
	lastImportLine := 0
	inImportBlock := false

	switch language {
	case "php", "php-laravel":
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "namespace ") {
				lastImportLine = i + 2
			}
			if ai.phpUseRegex.MatchString(line) {
				lastImportLine = i + 2
			}
		}
		if lastImportLine == 0 {
			for i, line := range lines {
				if strings.HasPrefix(strings.TrimSpace(line), "<?php") {
					lastImportLine = i + 2
					break
				}
			}
		}

	case "go":
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "import (") {
				inImportBlock = true
				lastImportLine = i + 1
			}
			if inImportBlock {
				if trimmed == ")" {
					return i + 1
				}
				if strings.HasPrefix(trimmed, `"`) || strings.HasPrefix(trimmed, "_") {
					lastImportLine = i + 2
				}
			}
			if strings.HasPrefix(trimmed, "import \"") {
				lastImportLine = i + 2
			}
			if strings.HasPrefix(trimmed, "package ") && lastImportLine == 0 {
				lastImportLine = i + 2
			}
		}

	case "typescript", "javascript", "typescriptreact", "javascriptreact":
		for i, line := range lines {
			if ai.tsImportRegex.MatchString(line) {
				lastImportLine = i + 2
			}
		}
		if lastImportLine == 0 {
			lastImportLine = 1
		}

	case "python":
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if ai.pyImportRegex.MatchString(line) {
				lastImportLine = i + 2
			}
			if strings.HasPrefix(trimmed, "\"\"\"") || strings.HasPrefix(trimmed, "'''") {
				continue
			}
		}
		if lastImportLine == 0 {
			lastImportLine = 1
		}

	case "rust":
		for i, line := range lines {
			if ai.rustUseRegex.MatchString(line) {
				lastImportLine = i + 2
			}
		}
		if lastImportLine == 0 {
			lastImportLine = 1
		}

	case "ruby":
		for i, line := range lines {
			if ai.rubyRequireRe.MatchString(line) {
				lastImportLine = i + 2
			}
		}
		if lastImportLine == 0 {
			lastImportLine = 1
		}

	case "c", "cpp":
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "#pragma once") || strings.HasPrefix(trimmed, "#include ") {
				lastImportLine = i + 2
			}
		}
		if lastImportLine == 0 {
			lastImportLine = 1
		}
	}

	if lastImportLine == 0 {
		lastImportLine = 1
	}
	return lastImportLine
}

func (ai *AutoImporter) generateImportStatement(symbol *core.Symbol, namespace, language string, ctx CompletionContext) string {
	name := symbol.Name
	switch language {
	case "php", "php-laravel":
		if ai.shouldUseOwnerImport(ctx, namespace) {
			return "use " + namespace + ";"
		}
		return "use " + qualifyImportPath(namespace, name, "\\") + ";"
	case "go":
		return `import "` + namespace + `"`
	case "typescript", "javascript", "typescriptreact", "javascriptreact":
		if isJSImportModuleSuggestion(symbol, namespace) {
			return "import " + name + " from '" + namespace + "';"
		}
		return "import { " + name + " } from '" + namespace + "';"
	case "python":
		if ai.shouldUseOwnerImport(ctx, namespace) {
			return "import " + namespace
		}
		if symbol.Kind == core.SymbolKindModule || symbol.Kind == core.SymbolKindPackage {
			return "import " + namespace
		}
		return "from " + namespace + " import " + name
	case "rust":
		if ai.shouldUseOwnerImport(ctx, namespace) {
			return "use " + namespace + ";"
		}
		if symbol.Kind == core.SymbolKindModule || symbol.Kind == core.SymbolKindPackage {
			return "use " + namespace + ";"
		}
		return "use " + qualifyImportPath(namespace, name, "::") + ";"
	case "ruby":
		return "require '" + namespace + "'"
	case "cpp", "c":
		return "#include <" + namespace + ">"
	}
	return ""
}

func (ai *AutoImporter) ShouldAutoImport(symbol *core.Symbol, ctx CompletionContext) bool {
	if ctx.InImport {
		return false
	}

	if symbol.Namespace != "" {
		return true
	}

	if symbol.Kind == core.SymbolKindModule || symbol.Kind == core.SymbolKindPackage {
		return symbol.Name != ""
	}

	if strings.Contains(symbol.Name, ".") || strings.Contains(symbol.Name, "\\") || strings.Contains(symbol.Name, "::") {
		return true
	}

	return false
}

func qualifyImportPath(namespace, name, sep string) string {
	if namespace == "" || name == "" || namespace == name || strings.HasSuffix(namespace, sep+name) {
		return namespace
	}
	return namespace + sep + name
}

func isJSImportModuleSuggestion(symbol *core.Symbol, namespace string) bool {
	if symbol == nil {
		return false
	}
	if symbol.Kind == core.SymbolKindModule || symbol.Kind == core.SymbolKindPackage {
		return true
	}
	identifier := jsModuleIdentifier(namespace)
	return identifier != "" && symbol.Name == identifier
}

func jsModuleIdentifier(namespace string) string {
	raw := strings.TrimSpace(namespace)
	if raw == "" {
		return ""
	}
	if idx := strings.LastIndex(raw, "/"); idx >= 0 {
		raw = raw[idx+1:]
	}
	raw = strings.TrimPrefix(raw, "@")
	if raw == "" {
		return ""
	}

	var b strings.Builder
	upperNext := false
	for _, r := range raw {
		switch {
		case unicode.IsLetter(r) || r == '_' || r == '$':
			if upperNext && b.Len() > 0 {
				b.WriteRune(unicode.ToUpper(r))
			} else {
				b.WriteRune(unicode.ToLower(r))
			}
			upperNext = false
		case unicode.IsDigit(r):
			if b.Len() == 0 {
				b.WriteByte('_')
			}
			b.WriteRune(r)
			upperNext = false
		default:
			upperNext = b.Len() > 0
		}
	}
	return b.String()
}

func (ai *AutoImporter) shouldUseOwnerImport(ctx CompletionContext, namespace string) bool {
	owner := extractPackageReference(ctx.AccessChain)
	if owner == "" {
		return false
	}
	ownerLower := strings.ToLower(strings.TrimSpace(owner))
	namespaceLower := strings.ToLower(strings.TrimSpace(namespace))
	if ownerLower == "" || namespaceLower == "" {
		return false
	}
	return namespaceLower == ownerLower || namespaceHasTokenSuffix(namespaceLower, ownerLower)
}

func (ai *AutoImporter) headerForSymbol(symbol *core.Symbol, namespace, language string) string {
	if symbol == nil {
		return ""
	}

	nameLower := strings.ToLower(strings.TrimSpace(symbol.Name))
	namespaceLower := strings.ToLower(strings.TrimSpace(namespace))

	if language == "c" {
		if header, ok := cHeaderMappings()[nameLower]; ok {
			return header
		}
		return ""
	}

	if language != "cpp" {
		return namespace
	}

	if header, ok := cppHeaderMappings()[nameLower]; ok {
		return header
	}
	if strings.HasPrefix(namespaceLower, "std::") {
		candidate := strings.TrimPrefix(namespaceLower, "std::")
		if idx := strings.Index(candidate, "::"); idx >= 0 {
			candidate = candidate[:idx]
		}
		if header, ok := cppHeaderMappings()[candidate]; ok {
			return header
		}
	}
	return ""
}

func cHeaderMappings() map[string]string {
	return cImportHeaders
}

func cppHeaderMappings() map[string]string {
	return cppImportHeaders
}
