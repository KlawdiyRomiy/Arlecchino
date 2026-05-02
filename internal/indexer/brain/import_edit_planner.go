package brain

import (
	"fmt"
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

type ImportEditPlanner struct{}

type phpImportIntent struct {
	kind   string
	prefix string
	item   string
}

type esImportIntent struct {
	typeOnly bool
	module   string
	item     string
	quote    string
}

type moduleItemIntent struct {
	keyword string
	module  string
	item    string
}

var (
	phpSingleUsePattern    = regexp.MustCompile(`^use\s+(?:(function|const)\s+)?(.+);$`)
	phpGroupedUsePattern   = regexp.MustCompile(`^use\s+(?:(function|const)\s+)?(.+?)\\\{(.+)\};$`)
	esNamedImportPattern   = regexp.MustCompile(`^import\s+(type\s+)?\{\s*(.+?)\s*\}\s+from\s+(['"])(.+)(['"]);?$`)
	pyFromImportPattern    = regexp.MustCompile(`^from\s+([^\s]+)\s+import\s+(.+)$`)
	rustGroupedUsePattern  = regexp.MustCompile(`^use\s+(.+)::\{(.+)\};$`)
	rustSingleUsePattern   = regexp.MustCompile(`^use\s+(.+);$`)
	scalaGroupedPattern    = regexp.MustCompile(`^import\s+(.+)\.\{(.+)\}$`)
	scalaSinglePattern     = regexp.MustCompile(`^import\s+(.+)\.([^.\s{}]+)$`)
	dartShowPattern        = regexp.MustCompile(`^import\s+(['"])(.+)(['"])\s+show\s+(.+);$`)
	juliaSpecificPattern   = regexp.MustCompile(`^(using|import)\s+(.+):\s*(.+)$`)
	juliaModulePattern     = regexp.MustCompile(`^(using|import)\s+(.+)$`)
	haskellImportPattern   = regexp.MustCompile(`^import\s+([A-Z][A-Za-z0-9_.']*)\s+\((.+)\)$`)
	clojureImportPattern   = regexp.MustCompile(`^\(:import\s+\[([^\]\s]+)\s+(.+)\]\)$`)
	erlangImportPattern    = regexp.MustCompile(`^-import\(([^,\s]+),\s*\[(.+)\]\)\.$`)
	fortranUseOnlyPattern  = regexp.MustCompile(`(?i)^use\s+([a-z_][a-z0-9_]*),\s*only\s*:\s*(.+)$`)
	adaWithPattern         = regexp.MustCompile(`(?i)^with\s+(.+);$`)
	delphiUsesPattern      = regexp.MustCompile(`(?i)^uses\s+(.+);$`)
	matlabImportPattern    = regexp.MustCompile(`^import\s+(.+)$`)
	latexUsePackagePattern = regexp.MustCompile(`^\\usepackage\{(.+)\}$`)
	perlUseQWPattern       = regexp.MustCompile(`^use\s+([A-Za-z_][A-Za-z0-9_:]*)\s+qw\((.+)\);$`)
)

func NewImportEditPlanner() *ImportEditPlanner {
	return &ImportEditPlanner{}
}

func (p *ImportEditPlanner) PlanImportEdit(ctx CompletionContext, importStmt string, fallbackLine int) (*core.TextEdit, bool) {
	stmt, ok := cleanImportStatement(importStmt)
	if !ok {
		return nil, false
	}

	content := importEditContent(ctx)
	language := normalizeGroupedImportLanguage(ctx.Language)

	switch language {
	case "go":
		return p.planGo(content, stmt)
	case "php":
		return p.planPHP(content, stmt)
	case "es":
		return p.planES(content, stmt)
	case "python":
		return p.planPython(content, stmt)
	case "rust":
		return p.planRust(content, stmt)
	case "scala":
		return p.planScala(content, stmt)
	case "dart":
		return p.planDart(content, stmt)
	case "julia":
		return p.planJulia(content, stmt)
	case "haskell":
		return p.planHaskell(content, stmt)
	case "clojure":
		return p.planClojure(content, stmt)
	case "erlang":
		return p.planErlang(content, stmt)
	case "fortran":
		return p.planFortran(content, stmt)
	case "ada":
		return p.planAda(content, stmt)
	case "delphi":
		return p.planDelphi(content, stmt)
	case "matlab":
		return p.planMatlab(content, stmt)
	case "latex":
		return p.planLatex(content, stmt)
	case "perl":
		return p.planPerl(content, stmt)
	default:
		_ = fallbackLine
		return nil, false
	}
}

func (p *ImportEditPlanner) FallbackInsertEdit(importStmt string, fallbackLine int) *core.TextEdit {
	stmt, ok := cleanImportStatement(importStmt)
	if !ok || fallbackLine <= 0 {
		return nil
	}
	return &core.TextEdit{
		StartLine:   fallbackLine,
		StartColumn: 1,
		EndLine:     fallbackLine,
		EndColumn:   1,
		Text:        stmt + "\n",
	}
}

func (p *ImportEditPlanner) NormalizeTextEdits(ctx CompletionContext, edits []core.TextEdit) []core.TextEdit {
	if len(edits) == 0 {
		return edits
	}

	normalized := make([]core.TextEdit, 0, len(edits))
	for _, edit := range edits {
		stmt, ok := cleanImportStatement(edit.Text)
		if !ok || !looksLikeImportStatement(ctx.Language, stmt) {
			normalized = append(normalized, edit)
			continue
		}

		if planned, changed := p.PlanImportEdit(ctx, stmt, edit.StartLine); changed && planned != nil {
			normalized = append(normalized, *planned)
			continue
		}
		normalized = append(normalized, edit)
	}
	return normalized
}

func (p *ImportEditPlanner) HasImport(content []byte, language, importStmt string) bool {
	stmt, ok := cleanImportStatement(importStmt)
	if !ok {
		return false
	}

	lines := splitImportLines(content)
	normalized := normalizeGroupedImportLanguage(language)
	switch normalized {
	case "go":
		spec, ok := parsePlannerGoImportSpec(stmt)
		return ok && goSpecExists(lines, spec)
	case "php":
		intent, ok := parsePHPSingleUse(stmt)
		return ok && phpImportExists(lines, intent)
	case "es":
		if intent, ok := parseESNamedImport(stmt); ok {
			return esNamedImportExists(lines, intent)
		}
	case "python":
		return pythonImportExists(lines, stmt)
	case "rust":
		intent, ok := parseRustSingleUse(stmt)
		return ok && rustImportExists(lines, intent)
	case "scala":
		intent, ok := parseScalaSingle(stmt)
		return ok && moduleItemExists(lines, intent, parseScalaSingle, parseScalaGrouped)
	case "dart":
		intent, ok := parseDartShow(stmt)
		return ok && dartShowExists(lines, intent)
	case "julia":
		return juliaImportExists(lines, stmt)
	case "haskell":
		intent, ok := parseHaskellImport(stmt)
		return ok && moduleItemExists(lines, intent, parseHaskellImport, nil)
	case "clojure":
		intent, ok := parseClojureImport(stmt)
		return ok && moduleItemExists(lines, intent, parseClojureImport, nil)
	case "erlang":
		intent, ok := parseErlangImport(stmt)
		return ok && moduleItemExists(lines, intent, parseErlangImport, nil)
	case "fortran":
		intent, ok := parseFortranUseOnly(stmt)
		return ok && moduleItemExists(lines, intent, parseFortranUseOnly, nil)
	case "ada":
		return listStatementExists(lines, stmt, parseAdaWith)
	case "delphi":
		return listStatementExists(lines, stmt, parseDelphiUses)
	case "matlab":
		return listStatementExists(lines, stmt, parseMatlabImport)
	case "latex":
		return listStatementExists(lines, stmt, parseLatexUsePackage)
	case "perl":
		intent, ok := parsePerlUseQW(stmt)
		return ok && moduleItemExists(lines, intent, parsePerlUseQW, nil)
	}

	for _, line := range lines {
		if strings.TrimSpace(line) == stmt {
			return true
		}
	}
	return false
}

func (p *ImportEditPlanner) planGo(content []byte, stmt string) (*core.TextEdit, bool) {
	spec, ok := parsePlannerGoImportSpec(stmt)
	if !ok {
		return nil, false
	}
	lines := splitImportLines(content)

	for i, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), "import (") {
			continue
		}
		for j := i + 1; j < len(lines); j++ {
			trimmed := strings.TrimSpace(lines[j])
			if trimmed == ")" {
				return insertAtLine(j+1, "\t"+spec+"\n"), true
			}
			if trimmed == spec {
				return nil, false
			}
		}
	}

	for i, line := range lines {
		existing, ok := parseGoSingleImportLine(strings.TrimSpace(line))
		if !ok || existing == spec {
			continue
		}
		text := "import (\n\t" + existing + "\n\t" + spec + "\n)"
		return replaceLine(i, line, text), true
	}

	return nil, false
}

func (p *ImportEditPlanner) planPHP(content []byte, stmt string) (*core.TextEdit, bool) {
	intent, ok := parsePHPSingleUse(stmt)
	if !ok {
		return nil, false
	}
	lines := splitImportLines(content)

	for i, line := range lines {
		grouped, ok := parsePHPGroupedUse(strings.TrimSpace(line))
		if !ok || grouped.kind != intent.kind || grouped.prefix != intent.prefix {
			continue
		}
		items := appendUnique(splitCommaList(grouped.item), intent.item)
		return replaceLine(i, line, formatPHPGroupedUse(intent.kind, intent.prefix, items)), true
	}

	for i, line := range lines {
		existing, ok := parsePHPSingleUse(strings.TrimSpace(line))
		if !ok || existing.kind != intent.kind || existing.prefix != intent.prefix || existing.item == intent.item {
			continue
		}
		items := appendUnique([]string{existing.item}, intent.item)
		return replaceLine(i, line, formatPHPGroupedUse(intent.kind, intent.prefix, items)), true
	}

	return nil, false
}

func (p *ImportEditPlanner) planES(content []byte, stmt string) (*core.TextEdit, bool) {
	intent, ok := parseESNamedImport(stmt)
	if !ok {
		return nil, false
	}
	lines := splitImportLines(content)
	for i, line := range lines {
		existing, ok := parseESNamedImport(strings.TrimSpace(line))
		if !ok || existing.module != intent.module || existing.typeOnly != intent.typeOnly {
			continue
		}
		items := splitCommaList(existing.item)
		for _, item := range splitCommaList(intent.item) {
			items = appendUnique(items, item)
		}
		return replaceLine(i, line, formatESNamedImport(intent, items)), true
	}
	return nil, false
}

func (p *ImportEditPlanner) planPython(content []byte, stmt string) (*core.TextEdit, bool) {
	lines := splitImportLines(content)
	if module, item, ok := parsePythonFromImport(stmt); ok {
		for i, line := range lines {
			existingModule, existingItems, ok := parsePythonFromImportItems(strings.TrimSpace(line))
			if !ok || existingModule != module {
				continue
			}
			items := appendUnique(existingItems, item)
			return replaceLine(i, line, "from "+module+" import ("+strings.Join(items, ", ")+")"), true
		}
		return nil, false
	}

	if imports, ok := parsePythonImportItems(stmt); ok && len(imports) == 1 {
		for i, line := range lines {
			existing, ok := parsePythonImportItems(strings.TrimSpace(line))
			if !ok {
				continue
			}
			items := appendUnique(existing, imports[0])
			return replaceLine(i, line, "import "+strings.Join(items, ", ")), true
		}
	}
	return nil, false
}

func (p *ImportEditPlanner) planRust(content []byte, stmt string) (*core.TextEdit, bool) {
	intent, ok := parseRustSingleUse(stmt)
	if !ok {
		return nil, false
	}
	lines := splitImportLines(content)
	for i, line := range lines {
		grouped, ok := parseRustGroupedUse(strings.TrimSpace(line))
		if !ok || grouped.module != intent.module {
			continue
		}
		items := appendUnique(splitCommaList(grouped.item), intent.item)
		return replaceLine(i, line, "use "+intent.module+"::{"+strings.Join(items, ", ")+"};"), true
	}
	for i, line := range lines {
		existing, ok := parseRustSingleUse(strings.TrimSpace(line))
		if !ok || existing.module != intent.module || existing.item == intent.item {
			continue
		}
		items := appendUnique([]string{existing.item}, intent.item)
		return replaceLine(i, line, "use "+intent.module+"::{"+strings.Join(items, ", ")+"};"), true
	}
	return nil, false
}

func (p *ImportEditPlanner) planScala(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planModuleItem(content, stmt, parseScalaSingle, parseScalaGrouped, func(intent moduleItemIntent, items []string) string {
		return "import " + intent.module + ".{" + strings.Join(items, ", ") + "}"
	})
}

func (p *ImportEditPlanner) planDart(content []byte, stmt string) (*core.TextEdit, bool) {
	intent, ok := parseDartShow(stmt)
	if !ok {
		return nil, false
	}
	lines := splitImportLines(content)
	for i, line := range lines {
		existing, ok := parseDartShow(strings.TrimSpace(line))
		if !ok || existing.module != intent.module {
			continue
		}
		items := splitCommaList(existing.item)
		for _, item := range splitCommaList(intent.item) {
			items = appendUnique(items, item)
		}
		return replaceLine(i, line, fmt.Sprintf("import %s%s%s show %s;", existing.keyword, intent.module, existing.keyword, strings.Join(items, ", "))), true
	}
	return nil, false
}

func (p *ImportEditPlanner) planJulia(content []byte, stmt string) (*core.TextEdit, bool) {
	lines := splitImportLines(content)
	if intent, ok := parseJuliaSpecific(stmt); ok {
		for i, line := range lines {
			existing, ok := parseJuliaSpecific(strings.TrimSpace(line))
			if !ok || existing.keyword != intent.keyword || existing.module != intent.module {
				continue
			}
			items := splitCommaList(existing.item)
			for _, item := range splitCommaList(intent.item) {
				items = appendUnique(items, item)
			}
			return replaceLine(i, line, intent.keyword+" "+intent.module+": "+strings.Join(items, ", ")), true
		}
		return nil, false
	}
	if intent, ok := parseJuliaModule(stmt); ok {
		for i, line := range lines {
			existing, ok := parseJuliaModule(strings.TrimSpace(line))
			if !ok || existing.keyword != intent.keyword {
				continue
			}
			items := appendUnique(splitCommaList(existing.module), intent.module)
			return replaceLine(i, line, intent.keyword+" "+strings.Join(items, ", ")), true
		}
	}
	return nil, false
}

func (p *ImportEditPlanner) planHaskell(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planModuleItem(content, stmt, parseHaskellImport, nil, func(intent moduleItemIntent, items []string) string {
		return "import " + intent.module + " (" + strings.Join(items, ", ") + ")"
	})
}

func (p *ImportEditPlanner) planClojure(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planModuleItem(content, stmt, parseClojureImport, nil, func(intent moduleItemIntent, items []string) string {
		return "(:import [" + intent.module + " " + strings.Join(items, " ") + "])"
	})
}

func (p *ImportEditPlanner) planErlang(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planModuleItem(content, stmt, parseErlangImport, nil, func(intent moduleItemIntent, items []string) string {
		return "-import(" + intent.module + ",[" + strings.Join(items, ", ") + "])."
	})
}

func (p *ImportEditPlanner) planFortran(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planModuleItem(content, stmt, parseFortranUseOnly, nil, func(intent moduleItemIntent, items []string) string {
		return "use " + intent.module + ", only: " + strings.Join(items, ", ")
	})
}

func (p *ImportEditPlanner) planAda(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planListStatement(content, stmt, parseAdaWith, func(items []string) string {
		return "with " + strings.Join(items, ", ") + ";"
	})
}

func (p *ImportEditPlanner) planDelphi(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planListStatement(content, stmt, parseDelphiUses, func(items []string) string {
		return "uses " + strings.Join(items, ", ") + ";"
	})
}

func (p *ImportEditPlanner) planMatlab(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planListStatement(content, stmt, parseMatlabImport, func(items []string) string {
		return "import " + strings.Join(items, " ")
	})
}

func (p *ImportEditPlanner) planLatex(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planListStatement(content, stmt, parseLatexUsePackage, func(items []string) string {
		return "\\usepackage{" + strings.Join(items, ",") + "}"
	})
}

func (p *ImportEditPlanner) planPerl(content []byte, stmt string) (*core.TextEdit, bool) {
	return p.planModuleItem(content, stmt, parsePerlUseQW, nil, func(intent moduleItemIntent, items []string) string {
		return "use " + intent.module + " qw(" + strings.Join(items, " ") + ");"
	})
}

func (p *ImportEditPlanner) planModuleItem(
	content []byte,
	stmt string,
	parseSingle func(string) (moduleItemIntent, bool),
	parseGrouped func(string) (moduleItemIntent, bool),
	format func(moduleItemIntent, []string) string,
) (*core.TextEdit, bool) {
	intent, ok := parseSingle(stmt)
	if !ok {
		return nil, false
	}
	separator := listSeparatorForIntent(intent)
	newItems := splitList(intent.item, separator)
	lines := splitImportLines(content)
	for i, line := range lines {
		if parseGrouped != nil {
			grouped, ok := parseGrouped(strings.TrimSpace(line))
			if ok && grouped.keyword == intent.keyword && grouped.module == intent.module {
				items := splitList(grouped.item, separator)
				for _, item := range newItems {
					items = appendUnique(items, item)
				}
				return replaceLine(i, line, format(intent, items)), true
			}
		}
		existing, ok := parseSingle(strings.TrimSpace(line))
		if !ok || existing.keyword != intent.keyword || existing.module != intent.module {
			continue
		}
		items := splitList(existing.item, separator)
		for _, item := range newItems {
			items = appendUnique(items, item)
		}
		return replaceLine(i, line, format(intent, items)), true
	}
	return nil, false
}

func (p *ImportEditPlanner) planListStatement(
	content []byte,
	stmt string,
	parse func(string) ([]string, bool),
	format func([]string) string,
) (*core.TextEdit, bool) {
	newItems, ok := parse(stmt)
	if !ok || len(newItems) == 0 {
		return nil, false
	}
	lines := splitImportLines(content)
	for i, line := range lines {
		existing, ok := parse(strings.TrimSpace(line))
		if !ok {
			continue
		}
		items := existing
		for _, item := range newItems {
			items = appendUnique(items, item)
		}
		return replaceLine(i, line, format(items)), true
	}
	return nil, false
}

func importEditContent(ctx CompletionContext) []byte {
	if len(ctx.FullContent) > 0 {
		return ctx.FullContent
	}
	return ctx.Content
}

func normalizeGroupedImportLanguage(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "php", "php-laravel":
		return "php"
	case "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "solidity":
		return "es"
	case "go", "python", "rust", "scala", "dart", "julia", "haskell", "clojure", "erlang", "fortran", "ada", "matlab", "latex", "perl":
		return strings.ToLower(strings.TrimSpace(language))
	case "delphi", "pascal":
		return "delphi"
	default:
		return strings.ToLower(strings.TrimSpace(language))
	}
}

func looksLikeImportStatement(language, stmt string) bool {
	switch normalizeGroupedImportLanguage(language) {
	case "go":
		return strings.HasPrefix(stmt, "import ")
	case "php":
		return strings.HasPrefix(stmt, "use ")
	case "es":
		return strings.HasPrefix(stmt, "import ")
	case "python":
		return strings.HasPrefix(stmt, "import ") || strings.HasPrefix(stmt, "from ")
	case "rust":
		return strings.HasPrefix(stmt, "use ")
	case "scala":
		return strings.HasPrefix(stmt, "import ")
	case "dart":
		return strings.HasPrefix(stmt, "import ")
	case "julia":
		return strings.HasPrefix(stmt, "using ") || strings.HasPrefix(stmt, "import ")
	case "haskell":
		return strings.HasPrefix(stmt, "import ")
	case "clojure":
		return strings.HasPrefix(stmt, "(:import ") || strings.HasPrefix(stmt, "(:require ")
	case "erlang":
		return strings.HasPrefix(stmt, "-import(")
	case "fortran":
		return strings.HasPrefix(strings.ToLower(stmt), "use ")
	case "ada":
		return strings.HasPrefix(strings.ToLower(stmt), "with ")
	case "delphi":
		return strings.HasPrefix(strings.ToLower(stmt), "uses ")
	case "matlab":
		return strings.HasPrefix(stmt, "import ")
	case "latex":
		return strings.HasPrefix(stmt, "\\usepackage")
	case "perl":
		return strings.HasPrefix(stmt, "use ")
	default:
		return false
	}
}

func cleanImportStatement(text string) (string, bool) {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	nonEmpty := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			nonEmpty = append(nonEmpty, trimmed)
		}
	}
	if len(nonEmpty) != 1 {
		return "", false
	}
	return nonEmpty[0], true
}

func splitImportLines(content []byte) []string {
	if len(content) == 0 {
		return nil
	}
	return strings.Split(string(content), "\n")
}

func insertAtLine(line int, text string) *core.TextEdit {
	return &core.TextEdit{StartLine: line, StartColumn: 1, EndLine: line, EndColumn: 1, Text: text}
}

func replaceLine(index int, line string, text string) *core.TextEdit {
	return &core.TextEdit{
		StartLine:   index + 1,
		StartColumn: 1,
		EndLine:     index + 1,
		EndColumn:   len(line) + 1,
		Text:        text,
	}
}

func appendUnique(items []string, item string) []string {
	item = strings.TrimSpace(item)
	if item == "" {
		return items
	}
	for _, existing := range items {
		if strings.TrimSpace(existing) == item {
			return items
		}
	}
	return append(items, item)
}

func splitCommaList(raw string) []string {
	return splitList(raw, ",")
}

func splitList(raw, separator string) []string {
	parts := strings.Split(raw, separator)
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item != "" {
			items = append(items, item)
		}
	}
	return items
}

func parsePlannerGoImportSpec(stmt string) (string, bool) {
	trimmed := strings.TrimSpace(stmt)
	if !strings.HasPrefix(trimmed, "import ") {
		return "", false
	}
	body := strings.TrimSpace(strings.TrimPrefix(trimmed, "import "))
	if body == "" || strings.HasPrefix(body, "(") || !strings.Contains(body, `"`) {
		return "", false
	}
	return body, true
}

func parseGoSingleImportLine(line string) (string, bool) {
	return parsePlannerGoImportSpec(line)
}

func goSpecExists(lines []string, spec string) bool {
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == spec {
			return true
		}
		if existing, ok := parseGoSingleImportLine(trimmed); ok && existing == spec {
			return true
		}
	}
	return false
}

func parsePHPSingleUse(stmt string) (phpImportIntent, bool) {
	matches := phpSingleUsePattern.FindStringSubmatch(stmt)
	if len(matches) != 3 || strings.Contains(matches[2], "{") {
		return phpImportIntent{}, false
	}
	fullPath := strings.TrimSpace(matches[2])
	idx := strings.LastIndex(fullPath, "\\")
	if idx <= 0 || idx == len(fullPath)-1 {
		return phpImportIntent{}, false
	}
	return phpImportIntent{kind: matches[1], prefix: fullPath[:idx], item: fullPath[idx+1:]}, true
}

func parsePHPGroupedUse(stmt string) (phpImportIntent, bool) {
	matches := phpGroupedUsePattern.FindStringSubmatch(stmt)
	if len(matches) != 4 {
		return phpImportIntent{}, false
	}
	return phpImportIntent{kind: matches[1], prefix: strings.TrimSpace(matches[2]), item: strings.TrimSpace(matches[3])}, true
}

func formatPHPGroupedUse(kind, prefix string, items []string) string {
	if kind != "" {
		kind += " "
	}
	return "use " + kind + prefix + "\\{" + strings.Join(items, ", ") + "};"
}

func phpImportExists(lines []string, intent phpImportIntent) bool {
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if existing, ok := parsePHPSingleUse(trimmed); ok && existing.kind == intent.kind && existing.prefix == intent.prefix && existing.item == intent.item {
			return true
		}
		if grouped, ok := parsePHPGroupedUse(trimmed); ok && grouped.kind == intent.kind && grouped.prefix == intent.prefix {
			for _, item := range splitCommaList(grouped.item) {
				if item == intent.item {
					return true
				}
			}
		}
	}
	return false
}

func parseESNamedImport(stmt string) (esImportIntent, bool) {
	matches := esNamedImportPattern.FindStringSubmatch(stmt)
	if len(matches) != 6 || matches[3] != matches[5] {
		return esImportIntent{}, false
	}
	items := splitCommaList(matches[2])
	if len(items) == 0 {
		return esImportIntent{}, false
	}
	return esImportIntent{typeOnly: strings.TrimSpace(matches[1]) != "", module: matches[4], item: strings.Join(items, ", "), quote: matches[3]}, true
}

func formatESNamedImport(intent esImportIntent, items []string) string {
	typePrefix := ""
	if intent.typeOnly {
		typePrefix = "type "
	}
	return "import " + typePrefix + "{ " + strings.Join(items, ", ") + " } from " + intent.quote + intent.module + intent.quote + ";"
}

func esNamedImportExists(lines []string, intent esImportIntent) bool {
	for _, line := range lines {
		existing, ok := parseESNamedImport(strings.TrimSpace(line))
		if !ok || existing.module != intent.module || existing.typeOnly != intent.typeOnly {
			continue
		}
		for _, item := range splitCommaList(existing.item) {
			if item == intent.item {
				return true
			}
		}
	}
	return false
}

func parsePythonFromImport(stmt string) (string, string, bool) {
	module, items, ok := parsePythonFromImportItems(stmt)
	if !ok || len(items) != 1 || items[0] == "*" {
		return "", "", false
	}
	return module, items[0], true
}

func parsePythonFromImportItems(stmt string) (string, []string, bool) {
	matches := pyFromImportPattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return "", nil, false
	}
	rawItems := strings.TrimSpace(matches[2])
	rawItems = strings.TrimPrefix(rawItems, "(")
	rawItems = strings.TrimSuffix(rawItems, ")")
	items := splitCommaList(rawItems)
	if len(items) == 0 {
		return "", nil, false
	}
	return matches[1], items, true
}

func parsePythonImportItems(stmt string) ([]string, bool) {
	if !strings.HasPrefix(stmt, "import ") {
		return nil, false
	}
	items := splitCommaList(strings.TrimSpace(strings.TrimPrefix(stmt, "import ")))
	if len(items) == 0 {
		return nil, false
	}
	for _, item := range items {
		if strings.Contains(item, " as ") {
			return nil, false
		}
	}
	return items, true
}

func pythonImportExists(lines []string, stmt string) bool {
	if module, item, ok := parsePythonFromImport(stmt); ok {
		for _, line := range lines {
			existingModule, items, ok := parsePythonFromImportItems(strings.TrimSpace(line))
			if !ok || existingModule != module {
				continue
			}
			for _, existing := range items {
				if existing == item || existing == "*" {
					return true
				}
			}
		}
		return false
	}
	if imports, ok := parsePythonImportItems(stmt); ok {
		for _, line := range lines {
			existing, ok := parsePythonImportItems(strings.TrimSpace(line))
			if !ok {
				continue
			}
			for _, want := range imports {
				for _, got := range existing {
					if got == want {
						return true
					}
				}
			}
		}
	}
	return false
}

func parseRustSingleUse(stmt string) (moduleItemIntent, bool) {
	if matches := rustGroupedUsePattern.FindStringSubmatch(stmt); len(matches) == 3 {
		return moduleItemIntent{}, false
	}
	matches := rustSingleUsePattern.FindStringSubmatch(stmt)
	if len(matches) != 2 {
		return moduleItemIntent{}, false
	}
	path := strings.TrimSpace(matches[1])
	idx := strings.LastIndex(path, "::")
	if idx <= 0 || idx == len(path)-2 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "use", module: path[:idx], item: path[idx+2:]}, true
}

func parseRustGroupedUse(stmt string) (moduleItemIntent, bool) {
	matches := rustGroupedUsePattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "use", module: matches[1], item: matches[2]}, true
}

func rustImportExists(lines []string, intent moduleItemIntent) bool {
	return moduleItemExists(lines, intent, parseRustSingleUse, parseRustGroupedUse)
}

func parseScalaSingle(stmt string) (moduleItemIntent, bool) {
	matches := scalaSinglePattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "import", module: matches[1], item: matches[2]}, true
}

func parseScalaGrouped(stmt string) (moduleItemIntent, bool) {
	matches := scalaGroupedPattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "import", module: matches[1], item: matches[2]}, true
}

func parseDartShow(stmt string) (moduleItemIntent, bool) {
	matches := dartShowPattern.FindStringSubmatch(stmt)
	if len(matches) != 5 || matches[1] != matches[3] {
		return moduleItemIntent{}, false
	}
	items := splitCommaList(matches[4])
	if len(items) == 0 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: matches[1], module: matches[2], item: strings.Join(items, ", ")}, true
}

func dartShowExists(lines []string, intent moduleItemIntent) bool {
	for _, line := range lines {
		existing, ok := parseDartShow(strings.TrimSpace(line))
		if !ok || existing.module != intent.module {
			continue
		}
		for _, item := range splitCommaList(existing.item) {
			if item == intent.item {
				return true
			}
		}
	}
	return false
}

func parseJuliaSpecific(stmt string) (moduleItemIntent, bool) {
	matches := juliaSpecificPattern.FindStringSubmatch(stmt)
	if len(matches) != 4 {
		return moduleItemIntent{}, false
	}
	items := splitCommaList(matches[3])
	if len(items) == 0 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: matches[1], module: strings.TrimSpace(matches[2]), item: strings.Join(items, ", ")}, true
}

func parseJuliaModule(stmt string) (moduleItemIntent, bool) {
	matches := juliaModulePattern.FindStringSubmatch(stmt)
	if len(matches) != 3 || strings.Contains(matches[2], ":") {
		return moduleItemIntent{}, false
	}
	items := splitCommaList(matches[2])
	if len(items) == 0 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: matches[1], module: strings.Join(items, ", ")}, true
}

func juliaImportExists(lines []string, stmt string) bool {
	if intent, ok := parseJuliaSpecific(stmt); ok {
		return moduleItemExists(lines, intent, parseJuliaSpecific, nil)
	}
	if intent, ok := parseJuliaModule(stmt); ok {
		for _, line := range lines {
			existing, ok := parseJuliaModule(strings.TrimSpace(line))
			if !ok || existing.keyword != intent.keyword {
				continue
			}
			for _, item := range splitCommaList(existing.module) {
				if item == intent.module {
					return true
				}
			}
		}
	}
	return false
}

func parseHaskellImport(stmt string) (moduleItemIntent, bool) {
	matches := haskellImportPattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return moduleItemIntent{}, false
	}
	items := splitCommaList(matches[2])
	if len(items) == 0 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "import", module: matches[1], item: strings.Join(items, ", ")}, true
}

func parseClojureImport(stmt string) (moduleItemIntent, bool) {
	matches := clojureImportPattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return moduleItemIntent{}, false
	}
	items := splitList(matches[2], " ")
	if len(items) == 0 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "clojure", module: matches[1], item: strings.Join(items, " ")}, true
}

func parseErlangImport(stmt string) (moduleItemIntent, bool) {
	matches := erlangImportPattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return moduleItemIntent{}, false
	}
	items := splitCommaList(matches[2])
	if len(items) == 0 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "erlang", module: matches[1], item: strings.Join(items, ", ")}, true
}

func parseFortranUseOnly(stmt string) (moduleItemIntent, bool) {
	matches := fortranUseOnlyPattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return moduleItemIntent{}, false
	}
	items := splitCommaList(matches[2])
	if len(items) == 0 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "fortran", module: matches[1], item: strings.Join(items, ", ")}, true
}

func parseAdaWith(stmt string) ([]string, bool) {
	matches := adaWithPattern.FindStringSubmatch(stmt)
	if len(matches) != 2 {
		return nil, false
	}
	return splitCommaList(matches[1]), true
}

func parseDelphiUses(stmt string) ([]string, bool) {
	matches := delphiUsesPattern.FindStringSubmatch(stmt)
	if len(matches) != 2 {
		return nil, false
	}
	return splitCommaList(matches[1]), true
}

func parseMatlabImport(stmt string) ([]string, bool) {
	matches := matlabImportPattern.FindStringSubmatch(stmt)
	if len(matches) != 2 {
		return nil, false
	}
	return splitList(matches[1], " "), true
}

func parseLatexUsePackage(stmt string) ([]string, bool) {
	matches := latexUsePackagePattern.FindStringSubmatch(stmt)
	if len(matches) != 2 {
		return nil, false
	}
	return splitCommaList(matches[1]), true
}

func parsePerlUseQW(stmt string) (moduleItemIntent, bool) {
	matches := perlUseQWPattern.FindStringSubmatch(stmt)
	if len(matches) != 3 {
		return moduleItemIntent{}, false
	}
	items := splitList(matches[2], " ")
	if len(items) == 0 {
		return moduleItemIntent{}, false
	}
	return moduleItemIntent{keyword: "perl", module: matches[1], item: strings.Join(items, " ")}, true
}

func moduleItemExists(
	lines []string,
	intent moduleItemIntent,
	parseSingle func(string) (moduleItemIntent, bool),
	parseGrouped func(string) (moduleItemIntent, bool),
) bool {
	separator := listSeparatorForIntent(intent)
	wanted := splitList(intent.item, separator)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if existing, ok := parseSingle(trimmed); ok && existing.keyword == intent.keyword && existing.module == intent.module {
			for _, want := range wanted {
				for _, item := range splitList(existing.item, separator) {
					if item == want {
						return true
					}
				}
			}
		}
		if parseGrouped != nil {
			if existing, ok := parseGrouped(trimmed); ok && existing.keyword == intent.keyword && existing.module == intent.module {
				for _, want := range wanted {
					for _, item := range splitCommaList(existing.item) {
						if item == want {
							return true
						}
					}
				}
			}
		}
	}
	return false
}

func listStatementExists(lines []string, stmt string, parse func(string) ([]string, bool)) bool {
	items, ok := parse(stmt)
	if !ok {
		return false
	}
	for _, line := range lines {
		existing, ok := parse(strings.TrimSpace(line))
		if !ok {
			continue
		}
		for _, want := range items {
			for _, got := range existing {
				if got == want {
					return true
				}
			}
		}
	}
	return false
}

func listSeparatorForIntent(intent moduleItemIntent) string {
	switch intent.keyword {
	case "clojure", "perl":
		return " "
	default:
		return ","
	}
}
