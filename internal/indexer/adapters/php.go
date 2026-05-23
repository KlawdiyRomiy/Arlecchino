package adapters

import (
	"bufio"
	"bytes"
	"os"
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

type PHPAdapter struct {
	classRegex     *regexp.Regexp
	functionRegex  *regexp.Regexp
	methodRegex    *regexp.Regexp
	propertyRegex  *regexp.Regexp
	namespaceRegex *regexp.Regexp
	useRegex       *regexp.Regexp
	interfaceRegex *regexp.Regexp
	traitRegex     *regexp.Regexp
	constRegex     *regexp.Regexp
}

func NewPHPAdapter() *PHPAdapter {
	return &PHPAdapter{
		namespaceRegex: regexp.MustCompile(`^\s*namespace\s+([^;]+)`),
		classRegex:     regexp.MustCompile(`^\s*(?:abstract\s+|final\s+)?class\s+(\w+)`),
		interfaceRegex: regexp.MustCompile(`^\s*interface\s+(\w+)`),
		traitRegex:     regexp.MustCompile(`^\s*trait\s+(\w+)`),
		functionRegex:  regexp.MustCompile(`^\s*function\s+(\w+)\s*\(`),
		methodRegex:    regexp.MustCompile(`^\s*(?:public|protected|private)\s+(?:static\s+)?function\s+(\w+)\s*\(`),
		propertyRegex:  regexp.MustCompile(`^\s*(?:public|protected|private)\s+(?:static\s+)?(?:\??\w+\s+)?\$(\w+)`),
		useRegex:       regexp.MustCompile(`^\s*use\s+([^;]+)`),
		constRegex:     regexp.MustCompile(`^\s*(?:public|protected|private)?\s*const\s+(\w+)`),
	}
}

func (a *PHPAdapter) Language() string {
	return "php"
}

func (a *PHPAdapter) Extensions() []string {
	return []string{".php"}
}

func (a *PHPAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	return a.ParseContent(path, content)
}

func (a *PHPAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	var symbols []core.Symbol
	var edges []core.Edge

	scanner := bufio.NewScanner(bytes.NewReader(content))
	var namespace string
	var currentClass string
	var currentClassID string
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		if m := a.namespaceRegex.FindStringSubmatch(line); m != nil {
			namespace = m[1]
			continue
		}

		if m := a.classRegex.FindStringSubmatch(line); m != nil {
			currentClass = m[1]
			sym := core.Symbol{
				Name:      currentClass,
				Kind:      core.SymbolKindClass,
				Language:  "php",
				Namespace: namespace,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			}
			currentClassID = sym.ID
			symbols = append(symbols, sym)
			continue
		}

		if m := a.interfaceRegex.FindStringSubmatch(line); m != nil {
			currentClass = m[1]
			sym := core.Symbol{
				Name:      currentClass,
				Kind:      core.SymbolKindInterface,
				Language:  "php",
				Namespace: namespace,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			}
			currentClassID = sym.ID
			symbols = append(symbols, sym)
			continue
		}

		if m := a.traitRegex.FindStringSubmatch(line); m != nil {
			currentClass = m[1]
			sym := core.Symbol{
				Name:      currentClass,
				Kind:      core.SymbolKindTrait,
				Language:  "php",
				Namespace: namespace,
				FilePath:  path,
				Line:      lineNum,
				Source:    core.SourceIndex,
			}
			currentClassID = sym.ID
			symbols = append(symbols, sym)
			continue
		}

		if m := a.methodRegex.FindStringSubmatch(line); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindMethod,
				Language:  "php",
				Namespace: namespace,
				FilePath:  path,
				Line:      lineNum,
				ParentID:  currentClassID,
				Source:    core.SourceIndex,
			})
			continue
		}

		if currentClass == "" {
			if m := a.functionRegex.FindStringSubmatch(line); m != nil {
				symbols = append(symbols, core.Symbol{
					Name:      m[1],
					Kind:      core.SymbolKindFunction,
					Language:  "php",
					Namespace: namespace,
					FilePath:  path,
					Line:      lineNum,
					Source:    core.SourceIndex,
				})
				continue
			}
		}

		if m := a.propertyRegex.FindStringSubmatch(line); m != nil && currentClass != "" {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindProperty,
				Language:  "php",
				Namespace: namespace,
				FilePath:  path,
				Line:      lineNum,
				ParentID:  currentClassID,
				Source:    core.SourceIndex,
			})
			continue
		}

		if m := a.constRegex.FindStringSubmatch(line); m != nil {
			symbols = append(symbols, core.Symbol{
				Name:      m[1],
				Kind:      core.SymbolKindConstant,
				Language:  "php",
				Namespace: namespace,
				FilePath:  path,
				Line:      lineNum,
				ParentID:  currentClassID,
				Source:    core.SourceIndex,
			})
			continue
		}

		if m := a.useRegex.FindStringSubmatch(line); m != nil && currentClass == "" {
			for _, target := range phpUseTargets(m[1]) {
				edges = append(edges, core.Edge{
					FromSymbol: path,
					ToSymbol:   target,
					Kind:       core.EdgeKindImports,
					FilePath:   path,
					Line:       lineNum,
				})
			}
		}
	}

	return symbols, edges, scanner.Err()
}

func phpUseTargets(value string) []string {
	value = strings.TrimSpace(value)
	value = strings.TrimSuffix(value, ";")
	if value == "" {
		return nil
	}

	if open := strings.Index(value, "{"); open >= 0 {
		close := strings.Index(value[open:], "}")
		if close < 0 {
			return []string{strings.TrimSpace(value)}
		}
		base := strings.TrimSpace(value[:open])
		inner := value[open+1 : open+close]
		targets := make([]string, 0, 4)
		for _, item := range strings.Split(inner, ",") {
			item = strings.TrimSpace(stripPHPUseAlias(item))
			if item != "" {
				targets = append(targets, base+item)
			}
		}
		return targets
	}

	parts := strings.Split(value, ",")
	targets := make([]string, 0, len(parts))
	for _, part := range parts {
		target := strings.TrimSpace(stripPHPUseAlias(part))
		if target != "" {
			targets = append(targets, target)
		}
	}
	return targets
}

func stripPHPUseAlias(value string) string {
	fields := strings.Fields(value)
	for i, field := range fields {
		if strings.EqualFold(field, "as") {
			return strings.Join(fields[:i], " ")
		}
	}
	return value
}
