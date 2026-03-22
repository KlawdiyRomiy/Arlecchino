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

type LaravelAdapter struct {
	*PHPAdapter
	routeRegex      *regexp.Regexp
	bladeDirective  *regexp.Regexp
	bladeInclude    *regexp.Regexp
	bladeExtends    *regexp.Regexp
	bladeComponent  *regexp.Regexp
	configRegex     *regexp.Regexp
	envRegex        *regexp.Regexp
	facadeUse       *regexp.Regexp
	middlewareRegex *regexp.Regexp
	livewireMount   *regexp.Regexp
	eventDispatch   *regexp.Regexp
}

func NewLaravelAdapter() *LaravelAdapter {
	return &LaravelAdapter{
		PHPAdapter:      NewPHPAdapter(),
		routeRegex:      regexp.MustCompile(`Route::(get|post|put|patch|delete|options|any)\s*\(\s*['"]([^'"]+)['"]\s*,`),
		bladeDirective:  regexp.MustCompile(`@(\w+)\s*(?:\(([^)]*)\))?`),
		bladeInclude:    regexp.MustCompile(`@include\s*\(\s*['"]([^'"]+)['"]`),
		bladeExtends:    regexp.MustCompile(`@extends\s*\(\s*['"]([^'"]+)['"]`),
		bladeComponent:  regexp.MustCompile(`<x-([a-z0-9\-\.]+)`),
		configRegex:     regexp.MustCompile(`config\s*\(\s*['"]([^'"]+)['"]`),
		envRegex:        regexp.MustCompile(`env\s*\(\s*['"]([^'"]+)['"]`),
		facadeUse:       regexp.MustCompile(`([A-Z][a-z]+)::\w+`),
		middlewareRegex: regexp.MustCompile(`->middleware\s*\(\s*\[?['"]?([^'"\])]+)`),
		livewireMount:   regexp.MustCompile(`mount\s*\(\s*\)`),
		eventDispatch:   regexp.MustCompile(`event\s*\(\s*new\s+(\w+)`),
	}
}

func (a *LaravelAdapter) Language() string {
	return "php-laravel"
}

func (a *LaravelAdapter) Extensions() []string {
	return []string{".php", ".blade.php"}
}

func (a *LaravelAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	return a.ParseContent(path, content)
}

func (a *LaravelAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	if strings.HasSuffix(path, ".blade.php") {
		return a.parseBlade(path, content)
	}

	if a.isRouteFile(path) {
		return a.parseRouteFile(path, content)
	}

	if a.isController(path) {
		return a.parseController(path, content)
	}

	if a.isModel(path) {
		return a.parseModel(path, content)
	}

	if a.isLivewireComponent(path) {
		return a.parseLivewire(path, content)
	}

	return a.PHPAdapter.ParseContent(path, content)
}

func (a *LaravelAdapter) parseBlade(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	var symbols []core.Symbol
	var edges []core.Edge

	viewName := a.extractViewName(path)
	symbols = append(symbols, core.Symbol{
		Name:     viewName,
		Kind:     core.SymbolKindView,
		Language: "blade",
		FilePath: path,
		Line:     1,
		Source:   core.SourceIndex,
	})

	scanner := bufio.NewScanner(bytes.NewReader(content))
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

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

		for _, m := range a.bladeComponent.FindAllStringSubmatch(line, -1) {
			edges = append(edges, core.Edge{
				FromSymbol: viewName,
				ToSymbol:   "component:" + m[1],
				Kind:       core.EdgeKindUses,
				FilePath:   path,
				Line:       lineNum,
			})
		}
	}

	return symbols, edges, nil
}

func (a *LaravelAdapter) parseRouteFile(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	symbols, edges, err := a.PHPAdapter.ParseContent(path, content)
	if err != nil {
		return nil, nil, err
	}

	scanner := bufio.NewScanner(bytes.NewReader(content))
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

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
	}

	return symbols, edges, nil
}

func (a *LaravelAdapter) parseController(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	symbols, edges, err := a.PHPAdapter.ParseContent(path, content)
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

func (a *LaravelAdapter) parseModel(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	symbols, edges, err := a.PHPAdapter.ParseContent(path, content)
	if err != nil {
		return nil, nil, err
	}

	for i := range symbols {
		if symbols[i].Kind == core.SymbolKindClass {
			symbols[i].Kind = core.SymbolKindModel
		}
	}

	fillableRegex := regexp.MustCompile(`protected\s+\$fillable\s*=\s*\[([^\]]+)\]`)
	if m := fillableRegex.FindSubmatch(content); m != nil {
		fields := string(m[1])
		for _, field := range strings.Split(fields, ",") {
			field = strings.Trim(strings.TrimSpace(field), "'\"")
			if field != "" {
				symbols = append(symbols, core.Symbol{
					Name:     field,
					Kind:     core.SymbolKindField,
					Language: "php-laravel",
					FilePath: path,
					Source:   core.SourceIndex,
					Extra:    map[string]string{"fillable": "true"},
				})
			}
		}
	}

	return symbols, edges, nil
}

func (a *LaravelAdapter) parseLivewire(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	symbols, edges, err := a.PHPAdapter.ParseContent(path, content)
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
