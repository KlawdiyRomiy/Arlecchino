package adapters

import (
	"bufio"
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

type TypeScriptAdapter struct {
	importRegex    *regexp.Regexp
	classRegex     *regexp.Regexp
	interfaceRegex *regexp.Regexp
	typeRegex      *regexp.Regexp
	enumRegex      *regexp.Regexp
	functionRegex  *regexp.Regexp
	arrowFuncRegex *regexp.Regexp
	methodRegex    *regexp.Regexp
	propertyRegex  *regexp.Regexp
	constRegex     *regexp.Regexp
	letRegex       *regexp.Regexp
	exportRegex    *regexp.Regexp
	decoratorRegex *regexp.Regexp
	componentRegex *regexp.Regexp
}

func NewTypeScriptAdapter() *TypeScriptAdapter {
	return &TypeScriptAdapter{
		importRegex:    regexp.MustCompile(`^import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]`),
		classRegex:     regexp.MustCompile(`^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)`),
		interfaceRegex: regexp.MustCompile(`^(?:export\s+)?interface\s+(\w+)`),
		typeRegex:      regexp.MustCompile(`^(?:export\s+)?type\s+(\w+)`),
		enumRegex:      regexp.MustCompile(`^(?:export\s+)?(?:const\s+)?enum\s+(\w+)`),
		functionRegex:  regexp.MustCompile(`^(?:export\s+)?(?:async\s+)?function\s+(\w+)`),
		arrowFuncRegex: regexp.MustCompile(`^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(`),
		methodRegex:    regexp.MustCompile(`^\s+(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*\(`),
		propertyRegex:  regexp.MustCompile(`^\s+(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:readonly\s+)?(\w+)\s*[?:;=]`),
		constRegex:     regexp.MustCompile(`^(?:export\s+)?const\s+(\w+)\s*[=:]`),
		letRegex:       regexp.MustCompile(`^(?:export\s+)?let\s+(\w+)\s*[=:]`),
		exportRegex:    regexp.MustCompile(`^export\s+(?:default\s+)?(?:class|function|const|let|interface|type|enum)\s+(\w+)`),
		decoratorRegex: regexp.MustCompile(`^@(\w+)`),
		componentRegex: regexp.MustCompile(`(?:function|const)\s+(\w+).*(?:React\.FC|JSX\.Element|ReactElement)`),
	}
}

func (a *TypeScriptAdapter) Language() string {
	return "typescript"
}

func (a *TypeScriptAdapter) Extensions() []string {
	return []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
}

func (a *TypeScriptAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	return a.ParseContent(path, content)
}

func (a *TypeScriptAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	var symbols []core.Symbol
	var edges []core.Edge

	scanner := bufio.NewScanner(bytes.NewReader(content))
	var currentClass string
	var currentClassID string
	var lastDecorator string
	lineNum := 0

	moduleName := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if m := a.decoratorRegex.FindStringSubmatch(trimmed); m != nil {
			lastDecorator = m[1]
			continue
		}

		if m := a.importRegex.FindStringSubmatch(trimmed); m != nil {
			edges = append(edges, core.Edge{
				FromSymbol: path,
				ToSymbol:   m[1],
				Kind:       core.EdgeKindImports,
				FilePath:   path,
				Line:       lineNum,
			})
			continue
		}

		if m := a.classRegex.FindStringSubmatch(trimmed); m != nil {
			currentClass = m[1]
			kind := core.SymbolKindClass
			extra := make(map[string]string)
			if lastDecorator == "Component" || lastDecorator == "Injectable" {
				kind = core.SymbolKindComponent
				extra["decorator"] = lastDecorator
			}
			sym := core.Symbol{
				Name:      currentClass,
				Kind:      kind,
				Language:  "typescript",
				Namespace: moduleName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
				Extra:     extra,
			}
			currentClassID = sym.ID
			symbols = append(symbols, sym)
			lastDecorator = ""
			continue
		}

		if m := a.interfaceRegex.FindStringSubmatch(trimmed); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindInterface,
				Language:  "typescript",
				Namespace: moduleName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			})
			continue
		}

		if m := a.typeRegex.FindStringSubmatch(trimmed); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindType,
				Language:  "typescript",
				Namespace: moduleName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			})
			continue
		}

		if m := a.enumRegex.FindStringSubmatch(trimmed); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindEnum,
				Language:  "typescript",
				Namespace: moduleName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			})
			continue
		}

		if m := a.functionRegex.FindStringSubmatch(trimmed); m != nil && currentClass == "" {
			kind := core.SymbolKindFunction
			if a.isReactComponent(line) {
				kind = core.SymbolKindComponent
			}
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      kind,
				Language:  "typescript",
				Namespace: moduleName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			})
			continue
		}

		if currentClass != "" {
			if m := a.methodRegex.FindStringSubmatch(line); m != nil && m[1] != "if" && m[1] != "for" && m[1] != "while" {
				symbols = append(symbols, core.Symbol{
					Name:      m[1],
					Kind:      core.SymbolKindMethod,
					Language:  "typescript",
					Namespace: moduleName,
					FilePath:  path,
					Line:      lineNum,
					ParentID:  currentClassID,
					Source:    core.SourceIndex,
				})
				continue
			}

			if m := a.propertyRegex.FindStringSubmatch(line); m != nil {
				symbols = append(symbols, core.Symbol{
					Name:      m[1],
					Kind:      core.SymbolKindProperty,
					Language:  "typescript",
					Namespace: moduleName,
					FilePath:  path,
					Line:      lineNum,
					ParentID:  currentClassID,
					Source:    core.SourceIndex,
				})
				continue
			}
		}

		if currentClass == "" {
			if m := a.arrowFuncRegex.FindStringSubmatch(trimmed); m != nil {
				kind := core.SymbolKindFunction
				if a.isReactComponent(line) || strings.Contains(path, ".tsx") {
					kind = core.SymbolKindComponent
				}
				symbols = append(symbols, core.Symbol{
					Name:      m[1],
					Kind:      kind,
					Language:  "typescript",
					Namespace: moduleName,
					FilePath:  path,
					Line:      lineNum,
					Source:    core.SourceIndex,
				})
				continue
			}

			if m := a.constRegex.FindStringSubmatch(trimmed); m != nil && !strings.Contains(line, "=>") && !strings.Contains(line, "function") {
				symbols = append(symbols, core.Symbol{
					Name:      m[1],
					Kind:      core.SymbolKindConstant,
					Language:  "typescript",
					Namespace: moduleName,
					FilePath:  path,
					Line:      lineNum,
					Source:    core.SourceIndex,
				})
			}
		}

		if trimmed == "}" && currentClass != "" {
			currentClass = ""
			currentClassID = ""
		}
	}

	return symbols, edges, scanner.Err()
}

func (a *TypeScriptAdapter) isReactComponent(line string) bool {
	return strings.Contains(line, "React.FC") ||
		strings.Contains(line, "JSX.Element") ||
		strings.Contains(line, "ReactElement") ||
		strings.Contains(line, ": FC<") ||
		strings.Contains(line, "ReactNode")
}
