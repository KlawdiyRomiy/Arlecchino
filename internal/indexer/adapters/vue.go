package adapters

import (
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
	return a.parseLines(path, fileLineIterator(path))
}

func (a *VueAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	return a.parseLines(path, contentLineIterator(content))
}

func (a *VueAdapter) parseLines(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
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

	inScript := false
	inScriptSetup := false
	inMethods := false
	inComputed := false
	braceDepth := 0

	err := iterate(func(lineNum int, line string) error {
		trimmed := strings.TrimSpace(line)

		if a.scriptTagRegex.MatchString(line) {
			inScript = true
			inScriptSetup = strings.Contains(line, "setup")
			return nil
		}
		if trimmed == "</script>" {
			inScript = false
			inScriptSetup = false
			inMethods = false
			inComputed = false
			return nil
		}

		if !inScript {
			return nil
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
			return nil
		}

		if m := a.componentName.FindStringSubmatch(line); m != nil {
			componentSym.Name = m[1]
			componentSym.Line = lineNum
			return nil
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
				return nil
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
				return nil
			}

			if m := a.composableRegex.FindStringSubmatch(line); m != nil {
				edges = append(edges, core.Edge{
					FromSymbol: componentName,
					ToSymbol:   "use" + m[2],
					Kind:       core.EdgeKindCalls,
					FilePath:   path,
					Line:       lineNum,
				})
				return nil
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
				return nil
			}
		} else {
			if strings.Contains(line, "methods:") && strings.Contains(line, "{") {
				inMethods = true
				return nil
			}
			if strings.Contains(line, "computed:") && strings.Contains(line, "{") {
				inComputed = true
				return nil
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
		return nil
	})

	return symbols, edges, err
}
