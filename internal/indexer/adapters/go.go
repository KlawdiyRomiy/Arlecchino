package adapters

import (
	"bufio"
	"bytes"
	"os"
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

type GoAdapter struct {
	packageRegex   *regexp.Regexp
	importRegex    *regexp.Regexp
	funcRegex      *regexp.Regexp
	methodRegex    *regexp.Regexp
	structRegex    *regexp.Regexp
	interfaceRegex *regexp.Regexp
	typeRegex      *regexp.Regexp
	constRegex     *regexp.Regexp
	varRegex       *regexp.Regexp
	fieldRegex     *regexp.Regexp
}

func NewGoAdapter() *GoAdapter {
	return &GoAdapter{
		packageRegex:   regexp.MustCompile(`^package\s+(\w+)`),
		importRegex:    regexp.MustCompile(`^\s*(?:import\s+)?"([^"]+)"`),
		funcRegex:      regexp.MustCompile(`^func\s+(\w+)\s*\(`),
		methodRegex:    regexp.MustCompile(`^func\s+\(\s*\w+\s+\*?(\w+)\s*\)\s+(\w+)\s*\(`),
		structRegex:    regexp.MustCompile(`^type\s+(\w+)\s+struct\s*\{`),
		interfaceRegex: regexp.MustCompile(`^type\s+(\w+)\s+interface\s*\{`),
		typeRegex:      regexp.MustCompile(`^type\s+(\w+)\s+(\w+)`),
		constRegex:     regexp.MustCompile(`^\s*(\w+)\s*(?:=|$)`),
		varRegex:       regexp.MustCompile(`^var\s+(\w+)`),
		fieldRegex:     regexp.MustCompile(`^\s+(\w+)\s+(\S+)`),
	}
}

func (a *GoAdapter) Language() string {
	return "go"
}

func (a *GoAdapter) Extensions() []string {
	return []string{".go", ".mod", ".sum", ".work"}
}

func (a *GoAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	return a.ParseContent(path, content)
}

func (a *GoAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	var symbols []core.Symbol
	var edges []core.Edge

	scanner := bufio.NewScanner(bytes.NewReader(content))
	var packageName string
	var inImportBlock bool
	var inConstBlock bool
	var inStructBlock bool
	var currentStruct string
	var currentStructID string
	var braceDepth int
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if m := a.packageRegex.FindStringSubmatch(line); m != nil {
			packageName = m[1]
			symbols = append(symbols, core.Symbol{
				Name:     packageName,
				Kind:     core.SymbolKindPackage,
				Language: "go",
				FilePath: path,
				Line:     lineNum,
				Source:   core.SourceIndex,
			})
			continue
		}

		if trimmed == "import (" {
			inImportBlock = true
			continue
		}
		if inImportBlock {
			if trimmed == ")" {
				inImportBlock = false
				continue
			}
			if m := a.importRegex.FindStringSubmatch(line); m != nil {
				edges = append(edges, core.Edge{
					FromSymbol: path,
					ToSymbol:   m[1],
					Kind:       core.EdgeKindImports,
					FilePath:   path,
					Line:       lineNum,
				})
			}
			continue
		}

		if strings.HasPrefix(trimmed, "import \"") {
			if m := a.importRegex.FindStringSubmatch(trimmed); m != nil {
				edges = append(edges, core.Edge{
					FromSymbol: path,
					ToSymbol:   m[1],
					Kind:       core.EdgeKindImports,
					FilePath:   path,
					Line:       lineNum,
				})
			}
			continue
		}

		if trimmed == "const (" {
			inConstBlock = true
			continue
		}
		if inConstBlock {
			if trimmed == ")" {
				inConstBlock = false
				continue
			}
			if m := a.constRegex.FindStringSubmatch(trimmed); m != nil && m[1] != "_" {
				symbols = append(symbols, core.Symbol{
					Name:      m[1],
					Kind:      core.SymbolKindConstant,
					Language:  "go",
					Namespace: packageName,
					FilePath:  path,
					Line:      lineNum,
					Source:    core.SourceIndex,
				})
			}
			continue
		}

		if m := a.methodRegex.FindStringSubmatch(line); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[2],
				Kind:      core.SymbolKindMethod,
				Language:  "go",
				Namespace: packageName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
				Extra:     map[string]string{"receiver": m[1]},
			})
			continue
		}

		if m := a.funcRegex.FindStringSubmatch(line); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindFunction,
				Language:  "go",
				Namespace: packageName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			})
			continue
		}

		if m := a.structRegex.FindStringSubmatch(line); m != nil {
			currentStruct = m[1]
			sym := core.Symbol{
				Name:      currentStruct,
				Kind:      core.SymbolKindStruct,
				Language:  "go",
				Namespace: packageName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			}
			currentStructID = sym.ID
			symbols = append(symbols, sym)
			inStructBlock = true
			braceDepth = 1
			continue
		}

		if inStructBlock {
			braceDepth += strings.Count(line, "{") - strings.Count(line, "}")
			if braceDepth <= 0 {
				inStructBlock = false
				currentStruct = ""
				currentStructID = ""
				continue
			}

			if m := a.fieldRegex.FindStringSubmatch(line); m != nil {
				fieldName := m[1]
				fieldType := m[2]
				if fieldName != "" && fieldName[0] >= 'A' && fieldName[0] <= 'Z' {
					symbols = append(symbols, core.Symbol{
						Name:      fieldName,
						Kind:      core.SymbolKindProperty,
						Language:  "go",
						Namespace: currentStruct,
						FilePath:  path,
						Line:      lineNum,
						ParentID:  currentStructID,
						Source:    core.SourceIndex,
						Extra:     map[string]string{"type": fieldType},
					})
				}
			}
			continue
		}

		if m := a.interfaceRegex.FindStringSubmatch(line); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindInterface,
				Language:  "go",
				Namespace: packageName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			})
			continue
		}

		if m := a.typeRegex.FindStringSubmatch(line); m != nil && !strings.Contains(line, "struct") && !strings.Contains(line, "interface") {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindType,
				Language:  "go",
				Namespace: packageName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			})
			continue
		}

		if m := a.varRegex.FindStringSubmatch(line); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindVariable,
				Language:  "go",
				Namespace: packageName,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			})
		}

		_ = currentStructID
	}

	return symbols, edges, scanner.Err()
}
