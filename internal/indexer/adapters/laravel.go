package adapters

import (
	"path/filepath"
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

type LaravelAdapter struct {
	*PHPAdapter
	routeRegex              *regexp.Regexp
	bladeDirective          *regexp.Regexp
	bladeInclude            *regexp.Regexp
	bladeExtends            *regexp.Regexp
	bladeComponent          *regexp.Regexp
	bladeComponentDirective *regexp.Regexp
	bladeEach               *regexp.Regexp
	configRegex             *regexp.Regexp
	envRegex                *regexp.Regexp
	facadeUse               *regexp.Regexp
	middlewareRegex         *regexp.Regexp
	livewireMount           *regexp.Regexp
	eventDispatch           *regexp.Regexp
}

func NewLaravelAdapter() *LaravelAdapter {
	return &LaravelAdapter{
		PHPAdapter:              NewPHPAdapter(),
		routeRegex:              regexp.MustCompile(`Route::(get|post|put|patch|delete|options|any)\s*\(\s*['"]([^'"]+)['"]\s*,`),
		bladeDirective:          regexp.MustCompile(`@(\w+)\s*(?:\(([^)]*)\))?`),
		bladeInclude:            regexp.MustCompile(`@include\s*\(\s*['"]([^'"]+)['"]`),
		bladeExtends:            regexp.MustCompile(`@extends\s*\(\s*['"]([^'"]+)['"]`),
		bladeComponent:          regexp.MustCompile(`<x-([a-z0-9\-\.]+)`),
		bladeComponentDirective: regexp.MustCompile(`@component\s*\(\s*['"]([^'"]+)['"]`),
		bladeEach:               regexp.MustCompile(`@each\s*\(\s*['"]([^'"]+)['"]`),
		configRegex:             regexp.MustCompile(`config\s*\(\s*['"]([^'"]+)['"]`),
		envRegex:                regexp.MustCompile(`env\s*\(\s*['"]([^'"]+)['"]`),
		facadeUse:               regexp.MustCompile(`([A-Z][a-z]+)::\w+`),
		middlewareRegex:         regexp.MustCompile(`->middleware\s*\(\s*\[?['"]?([^'"\])]+)`),
		livewireMount:           regexp.MustCompile(`mount\s*\(\s*\)`),
		eventDispatch:           regexp.MustCompile(`event\s*\(\s*new\s+(\w+)`),
	}
}

func (a *LaravelAdapter) Language() string {
	return "php-laravel"
}

func (a *LaravelAdapter) Extensions() []string {
	return []string{".php", ".phtml", ".php3", ".php4", ".php5", ".phps", ".blade.php"}
}

func (a *LaravelAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	return a.parseLines(path, fileLineIterator(path))
}

func (a *LaravelAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	return a.parseLines(path, contentLineIterator(content))
}

func (a *LaravelAdapter) parseLines(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
	if strings.HasSuffix(path, ".blade.php") {
		return a.parseBlade(path, iterate)
	}

	if a.isRouteFile(path) {
		return a.parseRouteFile(path, iterate)
	}

	if a.isController(path) {
		return a.parseController(path, iterate)
	}

	if a.isModel(path) {
		return a.parseModel(path, iterate)
	}

	if a.isLivewireComponent(path) {
		return a.parseLivewire(path, iterate)
	}

	return a.PHPAdapter.parseLines(path, iterate)
}

func (a *LaravelAdapter) parseBlade(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
	var symbols []core.Symbol
	var edges []core.Edge
	markupComment := markupCommentNone

	viewName := a.extractViewName(path)
	symbols = append(symbols, core.Symbol{
		Name:     viewName,
		Kind:     core.SymbolKindView,
		Language: "blade",
		FilePath: path,
		Line:     1,
		Source:   core.SourceIndex,
	})

	err := iterate(func(lineNum int, line string) error {
		line = stripMarkupComments(line, &markupComment)
		if strings.TrimSpace(line) == "" {
			return nil
		}
		for _, m := range htmlAttrPattern.FindAllStringSubmatch(line, -1) {
			edges = append(edges, core.Edge{
				FromSymbol: viewName,
				ToSymbol:   m[1],
				Kind:       core.EdgeKindReferences,
				FilePath:   path,
				Line:       lineNum,
			})
		}

		if m := a.bladeExtends.FindStringSubmatch(line); m != nil {
			edges = append(edges, core.Edge{
				FromSymbol: viewName,
				ToSymbol:   m[1],
				Kind:       core.EdgeKindExtends,
				FilePath:   path,
				Line:       lineNum,
			})
		}

		if m := a.bladeInclude.FindStringSubmatch(line); m != nil {
			edges = append(edges, core.Edge{
				FromSymbol: viewName,
				ToSymbol:   m[1],
				Kind:       core.EdgeKindRenders,
				FilePath:   path,
				Line:       lineNum,
			})
		}

		for _, pattern := range []*regexp.Regexp{a.bladeComponentDirective, a.bladeEach} {
			if m := pattern.FindStringSubmatch(line); m != nil {
				edges = append(edges, core.Edge{
					FromSymbol: viewName,
					ToSymbol:   m[1],
					Kind:       core.EdgeKindRenders,
					FilePath:   path,
					Line:       lineNum,
				})
			}
		}

		for _, m := range a.bladeComponent.FindAllStringSubmatch(line, -1) {
			edges = append(edges, core.Edge{
				FromSymbol: viewName,
				ToSymbol:   "component:" + m[1],
				Kind:       core.EdgeKindUses,
				FilePath:   path,
				Line:       lineNum,
			})
		}
		return nil
	})

	return symbols, edges, err
}

func (a *LaravelAdapter) parseRouteFile(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
	symbols, edges, err := a.PHPAdapter.parseLines(path, iterate)
	if err != nil {
		return nil, nil, err
	}

	err = iterate(func(lineNum int, line string) error {
		if m := a.routeRegex.FindStringSubmatch(line); m != nil {
			method := strings.ToUpper(m[1])
			uri := m[2]

			symbols = append(symbols, core.Symbol{
				Name:     uri,
				Kind:     core.SymbolKindRoute,
				Language: "php-laravel",
				FilePath: path,
				Line:     lineNum,
				Source:   core.SourceIndex,
				Extra: map[string]string{
					"method": method,
					"uri":    uri,
				},
			})
		}
		return nil
	})

	return symbols, edges, err
}

func (a *LaravelAdapter) parseController(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
	symbols, edges, err := a.PHPAdapter.parseLines(path, iterate)
	if err != nil {
		return nil, nil, err
	}

	for i := range symbols {
		if symbols[i].Kind == core.SymbolKindClass {
			symbols[i].Kind = core.SymbolKindController
		}
	}

	return symbols, edges, nil
}

func (a *LaravelAdapter) parseModel(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
	symbols, edges, err := a.PHPAdapter.parseLines(path, iterate)
	if err != nil {
		return nil, nil, err
	}

	for i := range symbols {
		if symbols[i].Kind == core.SymbolKindClass {
			symbols[i].Kind = core.SymbolKindModel
		}
	}

	fillableSymbols, fillableErr := a.extractFillableSymbols(path, iterate)
	if fillableErr != nil {
		return nil, nil, fillableErr
	}
	symbols = append(symbols, fillableSymbols...)

	return symbols, edges, nil
}

func (a *LaravelAdapter) parseLivewire(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
	symbols, edges, err := a.PHPAdapter.parseLines(path, iterate)
	if err != nil {
		return nil, nil, err
	}

	for i := range symbols {
		if symbols[i].Kind == core.SymbolKindClass {
			symbols[i].Kind = core.SymbolKindComponent
			symbols[i].Extra = map[string]string{"framework": "livewire"}
		}
	}

	return symbols, edges, nil
}

func (a *LaravelAdapter) extractFillableSymbols(path string, iterate indexLineIterator) ([]core.Symbol, error) {
	var symbols []core.Symbol
	var fields strings.Builder
	inFillable := false
	startLine := 0

	appendFields := func(lineNum int) {
		for _, field := range strings.Split(fields.String(), ",") {
			field = strings.Trim(strings.TrimSpace(field), "'\"")
			if field != "" {
				symbols = append(symbols, core.Symbol{
					Name:     field,
					Kind:     core.SymbolKindField,
					Language: "php-laravel",
					FilePath: path,
					Line:     lineNum,
					Source:   core.SourceIndex,
					Extra:    map[string]string{"fillable": "true"},
				})
			}
		}
		fields.Reset()
		startLine = 0
	}

	err := iterate(func(lineNum int, line string) error {
		fragment := line
		if !inFillable {
			idx := strings.Index(fragment, "$fillable")
			if idx < 0 {
				return nil
			}
			fragment = fragment[idx:]
			open := strings.Index(fragment, "[")
			if open < 0 {
				return nil
			}
			inFillable = true
			startLine = lineNum
			fragment = fragment[open+1:]
		}

		if close := strings.Index(fragment, "]"); close >= 0 {
			fields.WriteString(fragment[:close])
			appendFields(lineNum)
			inFillable = false
			return nil
		}

		if fields.Len() > 0 {
			fields.WriteByte('\n')
		}
		fields.WriteString(fragment)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if inFillable && fields.Len() > 0 {
		appendFields(startLine)
	}
	return symbols, nil
}

func (a *LaravelAdapter) isRouteFile(path string) bool {
	return strings.Contains(path, "/routes/") ||
		strings.HasSuffix(path, "routes.php")
}

func (a *LaravelAdapter) isController(path string) bool {
	return strings.Contains(path, "/Controllers/") ||
		strings.HasSuffix(path, "Controller.php")
}

func (a *LaravelAdapter) isModel(path string) bool {
	return strings.Contains(path, "/Models/") ||
		(strings.Contains(path, "/app/") && !strings.Contains(path, "/Http/"))
}

func (a *LaravelAdapter) isLivewireComponent(path string) bool {
	return strings.Contains(path, "/Livewire/") ||
		strings.Contains(path, "/livewire/")
}

func (a *LaravelAdapter) extractViewName(path string) string {
	viewsDir := "/resources/views/"
	idx := strings.Index(path, viewsDir)
	if idx < 0 {
		return filepath.Base(path)
	}

	viewPath := path[idx+len(viewsDir):]
	viewPath = strings.TrimSuffix(viewPath, ".blade.php")
	viewPath = strings.ReplaceAll(viewPath, "/", ".")
	return viewPath
}
