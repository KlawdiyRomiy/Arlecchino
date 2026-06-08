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
	importDescriptorIdentifierRe      = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)
	importDescriptorESPathRe          = regexp.MustCompile(`^[@A-Za-z0-9_./:-]+$`)
	importDescriptorDottedPathRe      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$`)
	importDescriptorDartPathRe        = regexp.MustCompile(`^(?:dart:[A-Za-z0-9_./-]+|package:[A-Za-z0-9_./-]+)$`)
	importDescriptorSwiftModuleRe     = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	importDescriptorPHPPathRe         = regexp.MustCompile(`^[A-Za-z_\\][A-Za-z0-9_\\]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*$`)
	importDescriptorRustPathRe        = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_:]*(?:\:\:[A-Za-z_][A-Za-z0-9_]*)*$`)
	importDescriptorRubyPathRe        = regexp.MustCompile(`^[A-Za-z0-9_./-]+$`)
	importDescriptorCIncludePathRe    = regexp.MustCompile(`^[A-Za-z0-9_./-]+$`)
	importDescriptorESNamedStmtRe     = regexp.MustCompile(`^import\s+(?:type\s+)?\{\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)*\s*\}\s+from\s+['"][^'"\r\n]+['"];?$`)
	importDescriptorESDefaultStmtRe   = regexp.MustCompile(`^import\s+[A-Za-z_$][A-Za-z0-9_$]*\s+from\s+['"][^'"\r\n]+['"];?$`)
	importDescriptorESNamespaceStmtRe = regexp.MustCompile(`^import\s+\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*\s+from\s+['"][^'"\r\n]+['"];?$`)
	importDescriptorESSideEffectRe    = regexp.MustCompile(`^import\s+['"][^'"\r\n]+['"];?$`)
	importDescriptorJavaStmtRe        = regexp.MustCompile(`^import\s+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*;$`)
	importDescriptorScalaStmtRe       = regexp.MustCompile(`^import\s+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\.\{[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*\})?$`)
	importDescriptorDartStmtRe        = regexp.MustCompile(`^import\s+['"](?:dart:[A-Za-z0-9_./-]+|package:[A-Za-z0-9_./-]+)['"](?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?;?$`)
	importDescriptorCSharpStmtRe      = regexp.MustCompile(`^using\s+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*;$`)
	importDescriptorSwiftStmtRe       = regexp.MustCompile(`^import\s+[A-Za-z_][A-Za-z0-9_]*$`)
	importDescriptorGoStmtRe          = regexp.MustCompile(`^import\s+"[^"\r\n]+"$`)
	importDescriptorPHPStmtRe         = regexp.MustCompile(`^use\s+[A-Za-z_\\][A-Za-z0-9_\\]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?;$`)
	importDescriptorPythonStmtRe      = regexp.MustCompile(`^(?:import\s+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|from\s+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s+import\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)$`)
	importDescriptorRustStmtRe        = regexp.MustCompile(`^use\s+[A-Za-z_][A-Za-z0-9_:]*(?:\:\:\{[A-Za-z0-9_,\s]+\})?;$`)
	importDescriptorRubyStmtRe        = regexp.MustCompile(`^require(?:_relative)?\s+['"][A-Za-z0-9_./-]+['"]$`)
	importDescriptorCIncludeStmtRe    = regexp.MustCompile(`^#include\s+[<"][A-Za-z0-9_./-]+[>"]$`)
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
	return ai.GenerateImportEditWithDescriptor(symbol, ctx, nil)
}

func (ai *AutoImporter) GenerateImportEditWithDescriptor(symbol *core.Symbol, ctx CompletionContext, descriptor *ImportDescriptor) *core.TextEdit {
	if symbol == nil {
		return nil
	}
	namespace := symbol.Namespace
	importStmt := ""
	descriptorBacked := descriptor != nil && !descriptor.Empty()

	if descriptorBacked {
		namespace = strings.TrimSpace(descriptor.Path)
		importStmt = ai.importStatementFromDescriptor(symbol, descriptor, ctx.Language)
		if importStmt == "" {
			return nil
		}
	} else if namespace == "" {
		namespace = ai.extractNamespaceFromName(symbol.Name, ctx.Language)
	}

	if importStmt == "" {
		namespace = ai.normalizeImportNamespace(symbol, namespace, ctx)
	}
	if namespace == "" && importStmt == "" {
		return nil
	}

	if importStmt == "" {
		importStmt = ai.generateImportStatement(symbol, namespace, ctx.Language, ctx)
	}
	if strings.TrimSpace(importStmt) == "" {
		return nil
	}

	content := importEditContent(ctx)

	currentNS := ai.extractCurrentNamespace(content, ctx.Language)
	if namespace != "" && namespace == currentNS {
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

func (ai *AutoImporter) GenerateImportEditForSuggestion(s Suggestion, ctx CompletionContext) *core.TextEdit {
	sym := &core.Symbol{
		Name:      s.Text,
		Kind:      s.Kind,
		Language:  ctx.Language,
		Namespace: s.Namespace,
	}
	return ai.GenerateImportEditWithDescriptor(sym, ctx, s.Import)
}

func (ai *AutoImporter) importStatementFromDescriptor(symbol *core.Symbol, descriptor *ImportDescriptor, language string) string {
	if descriptor == nil || descriptor.Empty() {
		return ""
	}
	if statement := strings.TrimSpace(descriptor.Statement); statement != "" {
		if stmt, ok := safeDescriptorImportStatement(language, statement); ok {
			return stmt
		}
		return ""
	}

	path, ok := safeDescriptorImportPath(language, descriptor.Path)
	if !ok {
		return ""
	}
	mode := strings.ToLower(strings.TrimSpace(descriptor.Mode))
	importSymbol := strings.TrimSpace(descriptor.Symbol)
	if importSymbol == "" && symbol != nil {
		importSymbol = strings.TrimSpace(symbol.Name)
	}

	switch normalizeImportLanguage(language) {
	case "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "solidity":
		if mode != "side-effect" {
			var symbolOK bool
			importSymbol, symbolOK = safeDescriptorImportSymbol(importSymbol)
			if !symbolOK {
				return ""
			}
		}
		switch mode {
		case "default":
			return safeGeneratedDescriptorStatement(language, "import "+importSymbol+" from '"+path+"';")
		case "namespace":
			return safeGeneratedDescriptorStatement(language, "import * as "+importSymbol+" from '"+path+"';")
		case "side-effect":
			return safeGeneratedDescriptorStatement(language, "import '"+path+"';")
		default:
			return safeGeneratedDescriptorStatement(language, "import { "+importSymbol+" } from '"+path+"';")
		}
	case "java", "kotlin", "groovy":
		return safeGeneratedDescriptorStatement(language, "import "+path+";")
	case "scala":
		return safeGeneratedDescriptorStatement(language, "import "+path)
	case "dart":
		return safeGeneratedDescriptorStatement(language, "import '"+path+"';")
	case "csharp":
		return safeGeneratedDescriptorStatement(language, "using "+path+";")
	case "swift":
		return safeGeneratedDescriptorStatement(language, "import "+path)
	case "go":
		return safeGeneratedDescriptorStatement(language, `import "`+path+`"`)
	case "php", "php-laravel":
		return safeGeneratedDescriptorStatement(language, "use "+path+";")
	case "python":
		if mode == "module" || mode == "package" || importSymbol == "" || strings.HasSuffix(path, "."+importSymbol) {
			return safeGeneratedDescriptorStatement(language, "import "+path)
		}
		importSymbol, symbolOK := safeDescriptorImportSymbol(importSymbol)
		if !symbolOK {
			return ""
		}
		return safeGeneratedDescriptorStatement(language, "from "+path+" import "+importSymbol)
	case "rust":
		if mode == "module" || mode == "package" || importSymbol == "" || strings.HasSuffix(path, "::"+importSymbol) {
			return safeGeneratedDescriptorStatement(language, "use "+path+";")
		}
		importSymbol, symbolOK := safeDescriptorImportSymbol(importSymbol)
		if !symbolOK {
			return ""
		}
		return safeGeneratedDescriptorStatement(language, "use "+path+"::"+importSymbol+";")
	case "ruby":
		return safeGeneratedDescriptorStatement(language, "require '"+path+"'")
	case "c", "cpp":
		return safeGeneratedDescriptorStatement(language, "#include <"+path+">")
	}

	return ""
}

func safeGeneratedDescriptorStatement(language, statement string) string {
	if stmt, ok := safeDescriptorImportStatement(language, statement); ok {
		return stmt
	}
	return ""
}

func safeDescriptorImportStatement(language, statement string) (string, bool) {
	stmt, ok := cleanImportStatement(statement)
	if !ok || !safeDescriptorScalar(stmt) {
		return "", false
	}

	switch normalizeImportLanguage(language) {
	case "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "solidity":
		if importDescriptorESNamedStmtRe.MatchString(stmt) ||
			importDescriptorESDefaultStmtRe.MatchString(stmt) ||
			importDescriptorESNamespaceStmtRe.MatchString(stmt) ||
			importDescriptorESSideEffectRe.MatchString(stmt) {
			return stmt, true
		}
	case "java", "kotlin", "groovy":
		if importDescriptorJavaStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "scala":
		if importDescriptorScalaStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "dart":
		if importDescriptorDartStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "csharp":
		if importDescriptorCSharpStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "swift":
		if importDescriptorSwiftStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "go":
		if importDescriptorGoStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "php", "php-laravel":
		if importDescriptorPHPStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "python":
		if importDescriptorPythonStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "rust":
		if importDescriptorRustStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "ruby":
		if importDescriptorRubyStmtRe.MatchString(stmt) {
			return stmt, true
		}
	case "c", "cpp":
		if importDescriptorCIncludeStmtRe.MatchString(stmt) {
			return stmt, true
		}
	}

	return "", false
}

func safeDescriptorImportPath(language, path string) (string, bool) {
	path = strings.TrimSpace(path)
	if path == "" || !safeDescriptorScalar(path) {
		return "", false
	}

	switch normalizeImportLanguage(language) {
	case "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "solidity":
		return path, importDescriptorESPathRe.MatchString(path)
	case "java", "kotlin", "groovy", "scala", "csharp":
		return path, importDescriptorDottedPathRe.MatchString(path)
	case "dart":
		return path, importDescriptorDartPathRe.MatchString(path)
	case "swift":
		return path, importDescriptorSwiftModuleRe.MatchString(path)
	case "go":
		return path, importDescriptorESPathRe.MatchString(path)
	case "php", "php-laravel":
		return path, importDescriptorPHPPathRe.MatchString(path)
	case "python":
		return path, importDescriptorDottedPathRe.MatchString(path)
	case "rust":
		return path, importDescriptorRustPathRe.MatchString(path)
	case "ruby":
		return path, importDescriptorRubyPathRe.MatchString(path)
	case "c", "cpp":
		return path, importDescriptorCIncludePathRe.MatchString(path)
	default:
		return "", false
	}
}

func safeDescriptorImportSymbol(symbol string) (string, bool) {
	symbol = strings.TrimSpace(symbol)
	if symbol == "" || !safeDescriptorScalar(symbol) {
		return "", false
	}
	return symbol, importDescriptorIdentifierRe.MatchString(symbol)
}

func safeDescriptorScalar(value string) bool {
	if strings.ContainsAny(value, "\r\n\x00") {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func (ai *AutoImporter) extractNamespaceFromName(name, language string) string {
	switch normalizeImportLanguage(language) {
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
	case "typescript", "javascript", "typescriptreact", "javascriptreact", "vue", "svelte", "astro", "solidity":
		if idx := strings.Index(name, "."); idx > 0 {
			return name[:idx]
		}
	}
	return ""
}

func (ai *AutoImporter) normalizeImportNamespace(symbol *core.Symbol, namespace string, ctx CompletionContext) string {
	language := normalizeImportLanguage(ctx.Language)
	if language != "c" && language != "cpp" {
		return namespace
	}

	return ai.headerForSymbol(symbol, namespace, language)
}

func (ai *AutoImporter) extractCurrentNamespace(content []byte, language string) string {
	lines := strings.Split(string(content), "\n")

	switch normalizeImportLanguage(language) {
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

	switch normalizeImportLanguage(language) {
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
	case "typescript", "javascript", "typescriptreact", "javascriptreact", "vue", "svelte", "astro", "solidity":
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
	switch normalizeImportLanguage(language) {
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

	switch normalizeImportLanguage(language) {
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

	case "typescript", "javascript", "typescriptreact", "javascriptreact", "vue", "svelte", "astro", "solidity":
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

	case "java", "kotlin", "groovy", "scala":
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "package ") && lastImportLine == 0 {
				lastImportLine = i + 2
			}
			if strings.HasPrefix(trimmed, "import ") {
				lastImportLine = i + 2
			}
		}

	case "csharp":
		for i, line := range lines {
			if strings.HasPrefix(strings.TrimSpace(line), "using ") {
				lastImportLine = i + 2
			}
		}

	case "swift", "dart":
		for i, line := range lines {
			if strings.HasPrefix(strings.TrimSpace(line), "import ") {
				lastImportLine = i + 2
			}
		}
	}

	if lastImportLine == 0 {
		lastImportLine = 1
	}
	return lastImportLine
}

func (ai *AutoImporter) generateImportStatement(symbol *core.Symbol, namespace, language string, ctx CompletionContext) string {
	name := symbol.Name
	switch normalizeImportLanguage(language) {
	case "php", "php-laravel":
		if ai.shouldUseOwnerImport(ctx, namespace) {
			return "use " + namespace + ";"
		}
		return "use " + qualifyImportPath(namespace, name, "\\") + ";"
	case "go":
		return `import "` + namespace + `"`
	case "typescript", "javascript", "typescriptreact", "javascriptreact", "vue", "svelte", "astro", "solidity":
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

	if ai.ShouldAutoImportWithDescriptor(symbol, ctx, nil) {
		return true
	}

	return false
}

func (ai *AutoImporter) ShouldAutoImportWithDescriptor(symbol *core.Symbol, ctx CompletionContext, descriptor *ImportDescriptor) bool {
	if ctx.InImport || symbol == nil {
		return false
	}

	if descriptor != nil && !descriptor.Empty() {
		return ai.importStatementFromDescriptor(symbol, descriptor, ctx.Language) != ""
	}

	if symbol.Namespace != "" {
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

func normalizeImportLanguage(language string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	switch language {
	case "php-laravel":
		return "php"
	default:
		return language
	}
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
