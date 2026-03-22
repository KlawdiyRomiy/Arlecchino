package adapters

import (
	"bufio"
	"bytes"
	"os"
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

type VueAdapter struct {
	scriptTagRegex   *regexp.Regexp
	templateTagRegex *regexp.Regexp
	styleTagRegex    *regexp.Regexp
	importRegex      *regexp.Regexp
	exportDefault    *regexp.Regexp
	componentName    *regexp.Regexp
	defineComponent  *regexp.Regexp
	propsRegex       *regexp.Regexp
	emitsRegex       *regexp.Regexp
	dataRegex        *regexp.Regexp
	methodRegex      *regexp.Regexp
	computedRegex    *regexp.Regexp
	watchRegex       *regexp.Regexp
	refRegex         *regexp.Regexp
	reactiveRegex    *regexp.Regexp
	composableRegex  *regexp.Regexp
}

func NewVueAdapter() *VueAdapter {
	return &VueAdapter{
		scriptTagRegex:   regexp.MustCompile(`<script[^>]*(?:setup)?[^>]*>`),
		templateTagRegex: regexp.MustCompile(`<template[^>]*>`),
		styleTagRegex:    regexp.MustCompile(`<style[^>]*>`),
		importRegex:      regexp.MustCompile(`import\s+(?:{[^}]+}|[^'"]+)\s+from\s+['"]([^'"]+)['"]`),
		exportDefault:    regexp.MustCompile(`export\s+default\s+`),
		componentName:    regexp.MustCompile(`name:\s*['"](\w+)['"]`),
		defineComponent:  regexp.MustCompile(`defineComponent\s*\(\s*{`),
		propsRegex:       regexp.MustCompile(`(?:defineProps|props)\s*[:(]\s*(?:{|\[)`),
		emitsRegex:       regexp.MustCompile(`(?:defineEmits|emits)\s*[:(]\s*\[`),
		dataRegex:        regexp.MustCompile(`data\s*\(\s*\)\s*{`),
		methodRegex:      regexp.MustCompile(`^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*{`),
		computedRegex:    regexp.MustCompile(`computed:\s*{`),
		watchRegex:       regexp.MustCompile(`watch:\s*{`),
		refRegex:         regexp.MustCompile(`(?:const|let)\s+(\w+)\s*=\s*ref\s*[<(]`),
		reactiveRegex:    regexp.MustCompile(`(?:const|let)\s+(\w+)\s*=\s*reactive\s*[<(]`),
		composableRegex:  regexp.MustCompile(`(?:const|let)\s+{([^}]+)}\s*=\s*use(\w+)\s*\(`),
	}
}

func (a *VueAdapter) Language() string {
	return "vue"
}

func (a *VueAdapter) Extensions() []string {
	return []string{".vue"}
}

func (a *VueAdapter) extractComponentName(filePath string) string {
	filePath = strings.ReplaceAll(filePath, "\\", "/")
	parts := strings.Split(filePath, "/")
	if len(parts) == 0 {
		return ""
	}
	filename := parts[len(parts)-1]
	return strings.TrimSuffix(filename, ".vue")
}

func (a *VueAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	return a.ParseContent(path, content)
}

func (a *VueAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	var symbols []core.Symbol
	var edges []core.Edge

	componentName := a.extractComponentName(path)

	componentSym := core.Symbol{
		Name:     componentName,
		Kind:     core.SymbolKindClass,
		Language: "vue",
		FilePath: path,
		Line:     1,
		Source:   core.SourceIndex,
	}
	symbols = append(symbols, componentSym)

	scanner := bufio.NewScanner(bytes.NewReader(content))
	lineNum := 0
	inScript := false
	inScriptSetup := false
	inMethods := false
	inComputed := false
	braceDepth := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if a.scriptTagRegex.MatchString(line) {
			inScript = true
			inScriptSetup = strings.Contains(line, "setup")
			continue
		}
		if trimmed == "</script>" {
			inScript = false
			inScriptSetup = false
			inMethods = false
			inComputed = false
			continue
		}

		if !inScript {
			continue
		}

		braceDepth += strings.Count(line, "{") - strings.Count(line, "}")

		if m := a.importRegex.FindStringSubmatch(line); m != nil {
			edges = append(edges, core.Edge{
				FromSymbol: componentName,
				ToSymbol:   m[1],
				Kind:       core.EdgeKindImports,
				FilePath:   path,
				Line:       lineNum,
			})
			continue
		}

		if m := a.componentName.FindStringSubmatch(line); m != nil {
			componentSym.Name = m[1]
			componentSym.Line = lineNum
			continue
		}

		if inScriptSetup {
			if m := a.refRegex.FindStringSubmatch(line); m != nil {
				symbols = append(symbols, core.Symbol{
					Name:      m[1],
					Kind:      core.SymbolKindProperty,
					Language:  "vue",
					Namespace: componentName,
					FilePath:  path,
					Line:      lineNum,
					ParentID:  componentSym.ID,
					Source:    core.SourceIndex,
					Extra:     map[string]string{"reactive": "ref"},
				})
				continue
			}

			if m := a.reactiveRegex.FindStringSubmatch(line); m != nil {
				symbols = append(symbols, core.Symbol{
					Name:      m[1],
					Kind:      core.SymbolKindProperty,
					Language:  "vue",
					Namespace: componentName,
					FilePath:  path,
					Line:      lineNum,
					ParentID:  componentSym.ID,
					Source:    core.SourceIndex,
					Extra:     map[string]string{"reactive": "reactive"},
				})
				continue
			}

			if m := a.composableRegex.FindStringSubmatch(line); m != nil {
				edges = append(edges, core.Edge{
					FromSymbol: componentName,
					ToSymbol:   "use" + m[2],
					Kind:       core.EdgeKindCalls,
					FilePath:   path,
					Line:       lineNum,
				})
				continue
			}

			if strings.HasPrefix(trimmed, "function ") || strings.HasPrefix(trimmed, "const ") && strings.Contains(line, "= (") || strings.Contains(trimmed, "async function") {
				funcMatch := regexp.MustCompile(`(?:function|const)\s+(\w+)`).FindStringSubmatch(line)
				if funcMatch != nil && !strings.Contains(line, "= ref") && !strings.Contains(line, "= reactive") && !strings.Contains(line, "= computed") {
					symbols = append(symbols, core.Symbol{
						Name:      funcMatch[1],
						Kind:      core.SymbolKindMethod,
						Language:  "vue",
						Namespace: componentName,
						FilePath:  path,
						Line:      lineNum,
						ParentID:  componentSym.ID,
						Source:    core.SourceIndex,
					})
				}
				continue
			}
		} else {
			if strings.Contains(line, "methods:") && strings.Contains(line, "{") {
				inMethods = true
				continue
			}
			if strings.Contains(line, "computed:") && strings.Contains(line, "{") {
				inComputed = true
				continue
			}

			if inMethods && braceDepth > 1 {
				if m := a.methodRegex.FindStringSubmatch(line); m != nil {
					symbols = append(symbols, core.Symbol{
						Name:      m[1],
						Kind:      core.SymbolKindMethod,
						Language:  "vue",
						Namespace: componentName,
						FilePath:  path,
						Line:      lineNum,
						ParentID:  componentSym.ID,
						Source:    core.SourceIndex,
					})
				}
			}

			if inComputed && braceDepth > 1 {
				computedMatch := regexp.MustCompile(`^\s*(\w+)\s*(?:\(\)|:)`).FindStringSubmatch(line)
				if computedMatch != nil {
					symbols = append(symbols, core.Symbol{
						Name:      computedMatch[1],
						Kind:      core.SymbolKindProperty,
						Language:  "vue",
						Namespace: componentName,
						FilePath:  path,
						Line:      lineNum,
						ParentID:  componentSym.ID,
						Source:    core.SourceIndex,
						Extra:     map[string]string{"computed": "true"},
					})
				}
			}
		}
	}

	return symbols, edges, scanner.Err()
}
