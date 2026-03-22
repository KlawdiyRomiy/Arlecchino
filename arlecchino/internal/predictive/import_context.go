package predictive

import "strings"

func DetectImportContextFromText(textBefore, language string) bool {
	if textBefore == "" {
		return false
	}

	line := importContextLine(textBefore)
	if line == "" {
		return false
	}

	switch normalizeImportContextLanguage(language) {
	case "go":
		return strings.HasPrefix(line, "import ") || strings.HasPrefix(line, "import(") || strings.HasPrefix(line, "import (")
	case "node":
		return strings.HasPrefix(line, "import ") || strings.HasPrefix(line, "export ") || strings.HasPrefix(line, "@import ")
	case "python":
		return strings.HasPrefix(line, "import ") || strings.HasPrefix(line, "from ")
	case "php", "rust":
		return strings.HasPrefix(line, "use ")
	case "ruby":
		return strings.HasPrefix(line, "require ") || strings.HasPrefix(line, "require_relative ")
	case "jvm", "dart", "swift":
		return strings.HasPrefix(line, "import ")
	case "dotnet":
		return strings.HasPrefix(line, "using ") || strings.HasPrefix(line, "open ")
	default:
		return false
	}
}

func importContextLine(textBefore string) string {
	textBefore = strings.TrimRight(textBefore, " \t\r\n")
	if textBefore == "" {
		return ""
	}
	idx := strings.LastIndexByte(textBefore, '\n')
	if idx >= 0 {
		textBefore = textBefore[idx+1:]
	}
	return strings.ToLower(strings.TrimSpace(textBefore))
}

func normalizeImportContextLanguage(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "css", "scss", "sass", "less":
		return "node"
	case "java", "kotlin", "groovy", "scala":
		return "jvm"
	case "csharp", "fsharp":
		return "dotnet"
	default:
		return strings.ToLower(strings.TrimSpace(language))
	}
}
