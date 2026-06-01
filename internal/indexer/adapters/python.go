package adapters

import (
	"bufio"
	"bytes"
	"os"
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

type PythonAdapter struct {
	importRegex     *regexp.Regexp
	fromImport      *regexp.Regexp
	classRegex      *regexp.Regexp
	funcRegex       *regexp.Regexp
	methodRegex     *regexp.Regexp
	decoratorRegex  *regexp.Regexp
	assignRegex     *regexp.Regexp
	typeHintRegex   *regexp.Regexp
	selfAssignRegex *regexp.Regexp
	classAttrRegex  *regexp.Regexp
}

func NewPythonAdapter() *PythonAdapter {
	return &PythonAdapter{
		importRegex:     regexp.MustCompile(`^import\s+(\S+)`),
		fromImport:      regexp.MustCompile(`^from\s+(\S+)\s+import`),
		classRegex:      regexp.MustCompile(`^class\s+(\w+)`),
		funcRegex:       regexp.MustCompile(`^def\s+(\w+)\s*\(`),
		methodRegex:     regexp.MustCompile(`^\s+def\s+(\w+)\s*\(`),
		decoratorRegex:  regexp.MustCompile(`^@(\w+)`),
		assignRegex:     regexp.MustCompile(`^([A-Z][A-Z_0-9]+)\s*=`),
		typeHintRegex:   regexp.MustCompile(`^\s{4}(\w+)\s*:\s*(\w+)`),
		selfAssignRegex: regexp.MustCompile(`self\.(\w+)\s*=`),
		classAttrRegex:  regexp.MustCompile(`^\s{4}(\w+)\s*=`),
	}
}

func (a *PythonAdapter) Language() string {
	return "python"
}

func (a *PythonAdapter) Extensions() []string {
	return []string{".py", ".pyi", ".pyw", ".pyx"}
}

func (a *PythonAdapter) extractNamespace(filePath string) string {
	filePath = strings.ReplaceAll(filePath, "\\", "/")

	parts := strings.Split(filePath, "/")
	var namespaceParts []string

	inPackage := false
	for _, part := range parts {
		if part == "src" || part == "lib" || part == "app" {
			inPackage = true
			continue
		}
		if inPackage && part != "" {
			if strings.HasSuffix(part, ".py") || strings.HasSuffix(part, ".pyi") {
				break
			}
			namespaceParts = append(namespaceParts, part)
		}
	}

	if len(namespaceParts) == 0 {
		for i := len(parts) - 2; i >= 0 && i >= len(parts)-3; i-- {
			if parts[i] != "" && !strings.HasSuffix(parts[i], ".py") {
				namespaceParts = append([]string{parts[i]}, namespaceParts...)
			}
		}
	}

	return strings.Join(namespaceParts, ".")
}

func (a *PythonAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	return a.ParseContent(path, content)
}

func (a *PythonAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	var symbols []core.Symbol
	var edges []core.Edge

	namespace := a.extractNamespace(path)

	scanner := bufio.NewScanner(bytes.NewReader(content))
	var currentClass string
	var currentClassID string
	var lastDecorator string
	var inInitMethod bool
	var seenProperties = make(map[string]bool)
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if m := a.decoratorRegex.FindStringSubmatch(trimmed); m != nil {
			lastDecorator = m[1]
			symbols = append(symbols, core.Symbol{
				Name:     m[1],
				Kind:     core.SymbolKindDecorator,
				Language: "python",
				FilePath: path,
				Line:     lineNum,
				Source:   core.SourceIndex,
			})
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

		if m := a.fromImport.FindStringSubmatch(trimmed); m != nil {
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
			sym := core.Symbol{
				Name:      currentClass,
				Kind:      core.SymbolKindClass,
				Language:  "python",
				Namespace: namespace,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			}
			currentClassID = sym.ID
			symbols = append(symbols, sym)
			lastDecorator = ""
			inInitMethod = false
			seenProperties = make(map[string]bool)
			continue
		}

		if currentClass == "" {
			if m := a.funcRegex.FindStringSubmatch(line); m != nil {
				extra := make(map[string]string)
				if lastDecorator != "" {
					extra["decorator"] = lastDecorator
				}
				symbols = append(symbols, core.Symbol{
					Name:     m[1],
					Kind:     core.SymbolKindFunction,
					Language: "python",
					FilePath: path,
					Line:     lineNum,
					Source:   core.SourceIndex,
					Extra:    extra,
				})
				lastDecorator = ""
				continue
			}
		}

		if currentClass != "" && (strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "\t")) {
			if m := a.methodRegex.FindStringSubmatch(line); m != nil {
				methodName := m[1]
				extra := make(map[string]string)
				if lastDecorator != "" {
					extra["decorator"] = lastDecorator
					if lastDecorator == "staticmethod" || lastDecorator == "classmethod" || lastDecorator == "property" {
						extra["type"] = lastDecorator
					}
				}
				symbols = append(symbols, core.Symbol{
					Name:      methodName,
					Kind:      core.SymbolKindMethod,
					Language:  "python",
					Namespace: currentClass,
					FilePath:  path,
					Line:      lineNum,
					ParentID:  currentClassID,
					Source:    core.SourceIndex,
					Extra:     extra,
				})
				inInitMethod = methodName == "__init__"
				lastDecorator = ""
				continue
			}

			if m := a.typeHintRegex.FindStringSubmatch(line); m != nil {
				propName := m[1]
				propType := m[2]
				if !seenProperties[propName] && propName != "" && propName[0] != '_' {
					seenProperties[propName] = true
					symbols = append(symbols, core.Symbol{
						Name:      propName,
						Kind:      core.SymbolKindProperty,
						Language:  "python",
						Namespace: currentClass,
						FilePath:  path,
						Line:      lineNum,
						ParentID:  currentClassID,
						Source:    core.SourceIndex,
						Extra:     map[string]string{"type": propType},
					})
				}
				continue
			}

			if inInitMethod {
				if m := a.selfAssignRegex.FindStringSubmatch(line); m != nil {
					propName := m[1]
					if !seenProperties[propName] && propName != "" && propName[0] != '_' {
						seenProperties[propName] = true
						symbols = append(symbols, core.Symbol{
							Name:      propName,
							Kind:      core.SymbolKindProperty,
							Language:  "python",
							Namespace: currentClass,
							FilePath:  path,
							Line:      lineNum,
							ParentID:  currentClassID,
							Source:    core.SourceIndex,
						})
					}
				}
			}
		}

		if m := a.assignRegex.FindStringSubmatch(trimmed); m != nil && currentClass == "" {
			symbols = append(symbols, core.Symbol{
				Name:     m[1],
				Kind:     core.SymbolKindConstant,
				Language: "python",
				FilePath: path,
				Line:     lineNum,
				Source:   core.SourceIndex,
			})
		}

		if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") && currentClass != "" && trimmed != "" && !strings.HasPrefix(trimmed, "#") {
			currentClass = ""
			currentClassID = ""
		}
	}

	return symbols, edges, scanner.Err()
}
