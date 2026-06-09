package adapters

import (
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

type RubyAdapter struct {
	requireRegex  *regexp.Regexp
	classRegex    *regexp.Regexp
	moduleRegex   *regexp.Regexp
	methodRegex   *regexp.Regexp
	classMethod   *regexp.Regexp
	attrRegex     *regexp.Regexp
	constantRegex *regexp.Regexp
	aliasRegex    *regexp.Regexp
	includeRegex  *regexp.Regexp
	extendRegex   *regexp.Regexp
	prependRegex  *regexp.Regexp
}

func NewRubyAdapter() *RubyAdapter {
	return &RubyAdapter{
		requireRegex:  regexp.MustCompile(`^\s*require(?:_relative)?\s+['"]([^'"]+)['"]`),
		classRegex:    regexp.MustCompile(`^\s*class\s+([A-Z]\w*)\s*(?:<\s*([A-Z][\w:]*))?\s*$`),
		moduleRegex:   regexp.MustCompile(`^\s*module\s+([A-Z]\w*)`),
		methodRegex:   regexp.MustCompile(`^\s*def\s+(\w+[?!=]?)`),
		classMethod:   regexp.MustCompile(`^\s*def\s+self\.(\w+[?!=]?)`),
		attrRegex:     regexp.MustCompile(`^\s*attr_(?:accessor|reader|writer)\s+(.+)`),
		constantRegex: regexp.MustCompile(`^\s*([A-Z][A-Z_0-9]+)\s*=`),
		aliasRegex:    regexp.MustCompile(`^\s*alias(?:_method)?\s+:?(\w+)`),
		includeRegex:  regexp.MustCompile(`^\s*include\s+([A-Z]\w*)`),
		extendRegex:   regexp.MustCompile(`^\s*extend\s+([A-Z]\w*)`),
		prependRegex:  regexp.MustCompile(`^\s*prepend\s+([A-Z]\w*)`),
	}
}

func (a *RubyAdapter) Language() string {
	return "ruby"
}

func (a *RubyAdapter) Extensions() []string {
	return []string{".rb", ".rake", ".gemspec", ".ru", ".erb"}
}

func (a *RubyAdapter) extractNamespace(filePath string) string {
	filePath = strings.ReplaceAll(filePath, "\\", "/")

	parts := strings.Split(filePath, "/")
	var namespaceParts []string

	inLib := false
	for _, part := range parts {
		if part == "lib" || part == "app" {
			inLib = true
			continue
		}
		if inLib && part != "" {
			if strings.HasSuffix(part, ".rb") || strings.HasSuffix(part, ".rake") {
				break
			}
			namespaceParts = append(namespaceParts, strings.Title(part))
		}
	}

	return strings.Join(namespaceParts, "::")
}

func (a *RubyAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	return a.parseLines(path, fileLineIterator(path))
}

func (a *RubyAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	return a.parseLines(path, contentLineIterator(content))
}

func (a *RubyAdapter) parseLines(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
	var symbols []core.Symbol
	var edges []core.Edge

	namespace := a.extractNamespace(path)

	var scopeStack []struct {
		name     string
		kind     string
		symbolID string
	}
	methodDepth := 0

	currentScope := func() string {
		if len(scopeStack) == 0 {
			return namespace
		}
		var names []string
		for _, s := range scopeStack {
			names = append(names, s.name)
		}
		if namespace != "" {
			return namespace + "::" + strings.Join(names, "::")
		}
		return strings.Join(names, "::")
	}

	currentParentID := func() string {
		if len(scopeStack) == 0 {
			return ""
		}
		return scopeStack[len(scopeStack)-1].symbolID
	}

	err := iterate(func(lineNum int, line string) error {
		trimmed := strings.TrimSpace(line)

		if trimmed == "end" {
			if methodDepth > 0 {
				methodDepth--
			} else if len(scopeStack) > 0 {
				scopeStack = scopeStack[:len(scopeStack)-1]
			}
			return nil
		}

		if m := a.requireRegex.FindStringSubmatch(line); m != nil {
			edges = append(edges, core.Edge{
				FromSymbol: path,
				ToSymbol:   m[1],
				Kind:       core.EdgeKindImports,
				FilePath:   path,
				Line:       lineNum,
			})
			return nil
		}

		if m := a.moduleRegex.FindStringSubmatch(line); m != nil {
			sym := core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindModule,
				Language:  "ruby",
				Namespace: currentScope(),
				FilePath:  path,
				Line:      lineNum,
				ParentID:  currentParentID(),
				Source:    core.SourceIndex,
			}
			symbols = append(symbols, sym)
			scopeStack = append(scopeStack, struct {
				name     string
				kind     string
				symbolID string
			}{m[1], "module", sym.ID})
			return nil
		}

		if m := a.classRegex.FindStringSubmatch(line); m != nil {
			sym := core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindClass,
				Language:  "ruby",
				Namespace: currentScope(),
				FilePath:  path,
				Line:      lineNum,
				ParentID:  currentParentID(),
				Source:    core.SourceIndex,
			}
			if m[2] != "" {
				sym.Extra = map[string]string{"extends": m[2]}
				edges = append(edges, core.Edge{
					FromSymbol: m[1],
					ToSymbol:   m[2],
					Kind:       core.EdgeKindExtends,
					FilePath:   path,
					Line:       lineNum,
				})
			}
			symbols = append(symbols, sym)
			scopeStack = append(scopeStack, struct {
				name     string
				kind     string
				symbolID string
			}{m[1], "class", sym.ID})
			return nil
		}

		if m := a.classMethod.FindStringSubmatch(line); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindMethod,
				Language:  "ruby",
				Namespace: currentScope(),
				FilePath:  path,
				Line:      lineNum,
				ParentID:  currentParentID(),
				Source:    core.SourceIndex,
				Extra:     map[string]string{"static": "true"},
			})
			methodDepth++
			return nil
		}

		if m := a.methodRegex.FindStringSubmatch(line); m != nil {
			kind := core.SymbolKindFunction
			if len(scopeStack) > 0 {
				kind = core.SymbolKindMethod
			}
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      kind,
				Language:  "ruby",
				Namespace: currentScope(),
				FilePath:  path,
				Line:      lineNum,
				ParentID:  currentParentID(),
				Source:    core.SourceIndex,
			})
			methodDepth++
			return nil
		}

		if m := a.attrRegex.FindStringSubmatch(line); m != nil {
			attrs := strings.Split(m[1], ",")
			for _, attr := range attrs {
				attr = strings.TrimSpace(attr)
				attr = strings.TrimPrefix(attr, ":")
				attr = strings.Trim(attr, "'\"")
				if attr != "" {
					symbols = append(symbols, core.Symbol{
						Name:      attr,
						Kind:      core.SymbolKindProperty,
						Language:  "ruby",
						Namespace: currentScope(),
						FilePath:  path,
						Line:      lineNum,
						ParentID:  currentParentID(),
						Source:    core.SourceIndex,
					})
				}
			}
			return nil
		}

		if m := a.constantRegex.FindStringSubmatch(line); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindConstant,
				Language:  "ruby",
				Namespace: currentScope(),
				FilePath:  path,
				Line:      lineNum,
				ParentID:  currentParentID(),
				Source:    core.SourceIndex,
			})
			return nil
		}

		if m := a.includeRegex.FindStringSubmatch(line); m != nil {
			edges = append(edges, core.Edge{
				FromSymbol: currentScope(),
				ToSymbol:   m[1],
				Kind:       core.EdgeKindImplements,
				FilePath:   path,
				Line:       lineNum,
			})
			return nil
		}

		if m := a.extendRegex.FindStringSubmatch(line); m != nil {
			edges = append(edges, core.Edge{
				FromSymbol: currentScope(),
				ToSymbol:   m[1],
				Kind:       core.EdgeKindImplements,
				FilePath:   path,
				Line:       lineNum,
			})
			return nil
		}
		return nil
	})

	return symbols, edges, err
}
