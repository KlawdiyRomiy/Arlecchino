package app

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"arlecchino/internal/plugins"
)

// Definition Navigation - Framework-aware Go To Definition with smart pattern recognition

// DefinitionResult represents a single Go to Definition result
type DefinitionResult struct {
	Path        string `json:"path"`
	Line        int    `json:"line"`
	Context     string `json:"context"`
	DisplayPath string `json:"displayPath"`
}

func (a *App) routeEntries() []plugins.RouteEntry {
	provider := a.getDefinitionProvider()
	if provider == nil {
		return nil
	}
	routes, err := provider.RouteEntries()
	if err != nil {
		return nil
	}
	return routes
}

func (a *App) viewEntries() []plugins.ViewEntry {
	provider := a.getDefinitionProvider()
	if provider == nil {
		return nil
	}
	views, err := provider.ViewEntries()
	if err != nil {
		return nil
	}
	return views
}

func (a *App) modelEntries() map[string]plugins.ModelEntry {
	provider := a.getDefinitionProvider()
	if provider == nil {
		return nil
	}
	models, err := provider.ModelEntries()
	if err != nil {
		return nil
	}
	return models
}

// GoToDefinition finds definition for a symbol at given position
// Uses indexed data for fast lookup, falls back to LSP
func (a *App) GoToDefinition(filePath string, content string, line int, column int, word string, beforeWord string, afterWord string) ([]DefinitionResult, error) {
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" {
		return nil, fmt.Errorf("no project opened")
	}

	var results []DefinitionResult
	tryLSPDefinition := func() bool {
		if a.activeLSPManager() == nil {
			return false
		}

		lspLine := line
		if lspLine > 0 {
			lspLine--
		}
		if lspLine < 0 {
			lspLine = 0
		}
		lspColumn := column
		if lspColumn < 0 {
			lspColumn = 0
		}

		lspResults, err := a.LSPGoToDefinition(filePath, content, lspLine, lspColumn)
		if err != nil || len(lspResults) == 0 {
			return false
		}

		for _, r := range lspResults {
			results = append(results, DefinitionResult{
				Path:        r.Path,
				Line:        r.Line,
				Context:     "LSP Definition",
				DisplayPath: getDisplayPath(r.Path, projectPath),
			})
		}
		return len(results) > 0
	}

	// 0. Check PHP use statements: use App\Models\User; or use Laravel\Socialite\Facades\Socialite;
	// Handle both partial click (on word) and full namespace
	if matchesPattern(beforeWord, `\buse\s+`) || matchesPattern(beforeWord, `^[\w\\]+\\$`) {
		// Try to extract full namespace from the line
		fullNamespace := extractFullUseStatement(beforeWord, word, afterWord)
		if fullNamespace != "" {
			resolvedPath := a.resolveNamespaceToPath(fullNamespace, projectPath)
			if resolvedPath != "" {
				results = append(results, DefinitionResult{
					Path:        resolvedPath,
					Line:        1,
					Context:     fmt.Sprintf("Class: %s", getClassNameFromNamespace(fullNamespace)),
					DisplayPath: getDisplayPath(resolvedPath, projectPath),
				})
				return results, nil
			}
			// Try vendor path for external packages
			vendorPath := a.resolveVendorNamespace(fullNamespace, projectPath)
			if vendorPath != "" {
				results = append(results, DefinitionResult{
					Path:        vendorPath,
					Line:        1,
					Context:     fmt.Sprintf("Vendor: %s", getClassNameFromNamespace(fullNamespace)),
					DisplayPath: getDisplayPath(vendorPath, projectPath),
				})
				return results, nil
			}
		}
	}

	// 0.5. Check config() pattern: config('app.name'), config("database.default")
	if matchesPattern(beforeWord, `config\s*\(\s*['"]`) {
		fullConfigKey := extractConfigKey(beforeWord, word, afterWord)
		if fullConfigKey != "" {
			configResult := a.resolveConfigKey(fullConfigKey, projectPath)
			if configResult != nil {
				results = append(results, *configResult)
				return results, nil
			}
		}
	}

	// 0.6. Check env() pattern: env('APP_NAME'), env("DB_HOST")
	if matchesPattern(beforeWord, `env\s*\(\s*['"]`) {
		envKey := extractEnvKey(beforeWord, word, afterWord)
		if envKey != "" {
			// Go to .env file and find the key
			envPath := projectPath + "/.env"
			if _, err := os.Stat(envPath); err == nil {
				envLine := a.findEnvKeyLine(envPath, envKey)
				results = append(results, DefinitionResult{
					Path:        envPath,
					Line:        envLine,
					Context:     fmt.Sprintf("ENV: %s", envKey),
					DisplayPath: ".env",
				})
				return results, nil
			}
		}
	}

	// 1. Check middleware patterns: ->middleware("auth"), ->middleware(["auth", "verified"])
	if matchesPattern(beforeWord, `middleware\s*\(\s*\[?\s*['"]`) || matchesPattern(beforeWord, `['"]\s*,\s*['"]`) {
		middlewarePath := a.resolveMiddleware(word, projectPath)
		if middlewarePath != "" {
			results = append(results, DefinitionResult{
				Path:        middlewarePath,
				Line:        1,
				Context:     fmt.Sprintf("Middleware: %s", word),
				DisplayPath: getDisplayPath(middlewarePath, projectPath),
			})
			return results, nil
		}
	}

	// 2. Check route name definition: ->name("profile.edit") - find all usages
	if matchesPattern(beforeWord, `->name\s*\(\s*['"]`) {
		// Extract full route name from quotes
		fullRouteName := extractRouteName(beforeWord, word, afterWord)
		if fullRouteName != "" {
			// Find all usages of this route name in the project
			usages := a.findRouteNameUsages(fullRouteName, projectPath)
			for _, usage := range usages {
				results = append(results, usage)
			}
			// Also add the route definition itself
			for _, route := range a.routeEntries() {
				if route.Name == fullRouteName {
					results = append(results, DefinitionResult{
						Path:        route.FilePath,
						Line:        route.LineNumber,
						Context:     fmt.Sprintf("Route definition: %s", route.Name),
						DisplayPath: getDisplayPath(route.FilePath, projectPath),
					})
				}
			}
			if len(results) > 0 {
				return results, nil
			}
		}
	}

	// 3. Check route patterns: route('name')
	if matchesPattern(beforeWord, `route\(['"]`) {
		// Extract full route name from quotes
		fullRouteName := extractRouteName(beforeWord, word, afterWord)
		if fullRouteName != "" {
			for _, route := range a.routeEntries() {
				if route.Name == fullRouteName {
					// Если есть путь к контроллеру, используем его
					if route.ControllerPath != "" {
						results = append(results, DefinitionResult{
							Path:        route.ControllerPath,
							Line:        route.ActionLine,
							Context:     fmt.Sprintf("Route: %s → %s@%s", route.Name, route.Controller, route.Action),
							DisplayPath: getDisplayPath(route.ControllerPath, projectPath),
						})
					} else {
						// Иначе показываем файл routes
						results = append(results, DefinitionResult{
							Path:        route.FilePath,
							Line:        route.LineNumber,
							Context:     fmt.Sprintf("Route: %s", route.Name),
							DisplayPath: getDisplayPath(route.FilePath, projectPath),
						})
					}
				}
			}
			if len(results) > 0 {
				return results, nil
			}
		}
	}

	// 2. Check Blade x-components: <x-layout>, <x-alert>, <x-forms.input>
	bladeComponent := extractBladeComponent(beforeWord, word, afterWord)
	if bladeComponent != "" {
		componentPath := resolveBladeComponent(bladeComponent, projectPath)
		if componentPath != "" {
			results = append(results, DefinitionResult{
				Path:        componentPath,
				Line:        1,
				Context:     fmt.Sprintf("Component: x-%s", bladeComponent),
				DisplayPath: getDisplayPath(componentPath, projectPath),
			})
			return results, nil
		}
	}

	// 3. Check view patterns: view('name'), view("name"), @extends('name'), etc
	viewPatternMatch := matchesPattern(beforeWord, `(view|@extends|@include|@includeIf|@includeWhen|@component)\s*\(\s*['"]`)
	if viewPatternMatch {
		fullViewName := extractViewName(beforeWord, word, afterWord)
		if fullViewName != "" {
			for _, view := range a.viewEntries() {
				if view.Name == fullViewName {
					results = append(results, DefinitionResult{
						Path:        view.Path,
						Line:        1,
						Context:     fmt.Sprintf("View: %s", view.Name),
						DisplayPath: getDisplayPath(view.Path, projectPath),
					})
				}
			}

			// If not found in index, try to construct path directly
			if len(results) == 0 {
				viewPath := constructViewPath(fullViewName, projectPath)
				if viewPath != "" {
					results = append(results, DefinitionResult{
						Path:        viewPath,
						Line:        1,
						Context:     fmt.Sprintf("View: %s", fullViewName),
						DisplayPath: getDisplayPath(viewPath, projectPath),
					})
				}
			}

			if len(results) > 0 {
				return results, nil
			}
		}
	}

	if tryLSPDefinition() {
		return results, nil
	}

	// 4. Check model static calls: User::find(), User::where()
	if matchesPattern(afterWord, `^::`) && !matchesPattern(afterWord, `^::class`) {
		models := a.modelEntries()
		if model, ok := models[word]; ok {
			results = append(results, DefinitionResult{
				Path:        model.FilePath,
				Line:        1,
				Context:     fmt.Sprintf("Model: %s", model.Name),
				DisplayPath: getDisplayPath(model.FilePath, projectPath),
			})
			return results, nil
		}
	}

	// 5. Check Controller::class pattern
	if matchesPattern(afterWord, `^::class`) {
		// Ищем контроллер
		controllerPath := a.findController(word)
		if controllerPath != "" {
			results = append(results, DefinitionResult{
				Path:        controllerPath,
				Line:        1,
				Context:     fmt.Sprintf("Controller: %s", word),
				DisplayPath: getDisplayPath(controllerPath, projectPath),
			})
			return results, nil
		}

		// Ищем модель
		models := a.modelEntries()
		if model, ok := models[word]; ok {
			results = append(results, DefinitionResult{
				Path:        model.FilePath,
				Line:        1,
				Context:     fmt.Sprintf("Model: %s", model.Name),
				DisplayPath: getDisplayPath(model.FilePath, projectPath),
			})
			return results, nil
		}
	}

	// 5. Check [Controller::class, 'method'] pattern - go to method
	if matchesPattern(beforeWord, `\[\w+Controller::class,\s*['"]`) && matchesPattern(afterWord, `^['"]\s*\]`) {
		// word is the method name, need to find controller from beforeWord
		controllerMatch := matchAndCapture(beforeWord, `\[(\w+Controller)::class`)
		if controllerMatch != "" {
			controllerPath := a.findController(controllerMatch)
			if controllerPath != "" {
				methodLine := a.findMethodLine(controllerPath, word)
				results = append(results, DefinitionResult{
					Path:        controllerPath,
					Line:        methodLine,
					Context:     fmt.Sprintf("Method: %s@%s", controllerMatch, word),
					DisplayPath: getDisplayPath(controllerPath, projectPath),
				})
				return results, nil
			}
		}
	}

	// 6. Check model relationships: $this->hasMany(), $this->belongsTo()
	if matchesPattern(beforeWord, `\$this->(hasMany|hasOne|belongsTo|belongsToMany|morphTo|morphMany)\(`) {
		// word is the related model
		models := a.modelEntries()
		if model, ok := models[word]; ok {
			results = append(results, DefinitionResult{
				Path:        model.FilePath,
				Line:        1,
				Context:     fmt.Sprintf("Related Model: %s", model.Name),
				DisplayPath: getDisplayPath(model.FilePath, projectPath),
			})
			return results, nil
		}
	}

	// 6.5. Check $variable->method() pattern - try to resolve from current file context
	if matchesPattern(beforeWord, `\$\w+->\s*$`) && matchesPattern(afterWord, `^\(`) {
		// word is a method name being called
		// Try to find the method in the current file first (for $this->method())
		if matchesPattern(beforeWord, `\$this->\s*$`) {
			methodLine := a.findMethodLine(filePath, word)
			if methodLine > 1 {
				results = append(results, DefinitionResult{
					Path:        filePath,
					Line:        methodLine,
					Context:     fmt.Sprintf("Method: %s", word),
					DisplayPath: getDisplayPath(filePath, projectPath),
				})
				return results, nil
			}
		}
	}

	// 6.6. Check new ClassName() pattern
	if matchesPattern(beforeWord, `new\s+$`) && matchesPattern(afterWord, `^\(`) {
		// word is the class being instantiated
		// Check models
		models := a.modelEntries()
		if model, ok := models[word]; ok {
			results = append(results, DefinitionResult{
				Path:        model.FilePath,
				Line:        1,
				Context:     fmt.Sprintf("Model: %s", model.Name),
				DisplayPath: getDisplayPath(model.FilePath, projectPath),
			})
			return results, nil
		}
		// Try to resolve as any class
		resolvedPath := a.resolveNamespaceToPath("App\\"+word, projectPath)
		if resolvedPath != "" {
			results = append(results, DefinitionResult{
				Path:        resolvedPath,
				Line:        1,
				Context:     fmt.Sprintf("Class: %s", word),
				DisplayPath: getDisplayPath(resolvedPath, projectPath),
			})
			return results, nil
		}
	}

	return results, nil
}

// findController ищет файл контроллера рекурсивно
func (a *App) findController(controllerName string) string {
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" {
		return ""
	}

	controllersDir := projectPath + "/app/Http/Controllers"
	fileName := controllerName + ".php"

	var foundPath string
	filepath.Walk(controllersDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() == fileName {
			foundPath = path
			return filepath.SkipAll
		}
		return nil
	})

	return foundPath
}

// findMethodLine ищет строку метода в файле
func (a *App) findMethodLine(filePath, methodName string) int {
	file, err := os.Open(filePath)
	if err != nil {
		return 1
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineNum := 0
	pattern := regexp.MustCompile(`function\s+` + regexp.QuoteMeta(methodName) + `\s*\(`)

	for scanner.Scan() {
		lineNum++
		if pattern.MatchString(scanner.Text()) {
			return lineNum
		}
	}

	return 1
}

// Helper functions
func matchesPattern(text, pattern string) bool {
	re := regexp.MustCompile(pattern)
	return re.MatchString(text)
}

func matchAndCapture(text, pattern string) string {
	re := regexp.MustCompile(pattern)
	matches := re.FindStringSubmatch(text)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

func getDisplayPath(fullPath, projectPath string) string {
	if len(fullPath) > len(projectPath) && fullPath[:len(projectPath)] == projectPath {
		return fullPath[len(projectPath)+1:]
	}
	return fullPath
}

// extractNamespace extracts namespace from "use App\Models\" pattern
func extractNamespace(beforeWord string) string {
	re := regexp.MustCompile(`\buse\s+([\w\\]+)$`)
	matches := re.FindStringSubmatch(beforeWord)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

// resolveNamespaceToPath converts PSR-4 namespace to file path
func (a *App) resolveNamespaceToPath(namespace string, projectPath string) string {
	// Common Laravel namespace mappings
	mappings := map[string]string{
		"App\\Models\\":            projectPath + "/app/Models/",
		"App\\Http\\Controllers\\": projectPath + "/app/Http/Controllers/",
		"App\\Http\\Requests\\":    projectPath + "/app/Http/Requests/",
		"App\\Http\\Resources\\":   projectPath + "/app/Http/Resources/",
		"App\\Http\\Middleware\\":  projectPath + "/app/Http/Middleware/",
		"App\\Events\\":            projectPath + "/app/Events/",
		"App\\Listeners\\":         projectPath + "/app/Listeners/",
		"App\\Jobs\\":              projectPath + "/app/Jobs/",
		"App\\Mail\\":              projectPath + "/app/Mail/",
		"App\\Notifications\\":     projectPath + "/app/Notifications/",
		"App\\Policies\\":          projectPath + "/app/Policies/",
		"App\\Providers\\":         projectPath + "/app/Providers/",
		"App\\Console\\Commands\\": projectPath + "/app/Console/Commands/",
		"App\\Exceptions\\":        projectPath + "/app/Exceptions/",
		"App\\View\\Components\\":  projectPath + "/app/View/Components/",
		"App\\Services\\":          projectPath + "/app/Services/",
		"App\\Repositories\\":      projectPath + "/app/Repositories/",
		"App\\Traits\\":            projectPath + "/app/Traits/",
		"App\\Enums\\":             projectPath + "/app/Enums/",
		"App\\":                    projectPath + "/app/",
		"Database\\Factories\\":    projectPath + "/database/factories/",
		"Database\\Seeders\\":      projectPath + "/database/seeders/",
		"Tests\\Feature\\":         projectPath + "/tests/Feature/",
		"Tests\\Unit\\":            projectPath + "/tests/Unit/",
	}

	// Try to match namespace prefixes
	for prefix, basePath := range mappings {
		if strings.HasPrefix(namespace, prefix) {
			relativePath := strings.TrimPrefix(namespace, prefix)
			// Convert namespace separators to path separators
			relativePath = strings.ReplaceAll(relativePath, "\\", "/")
			fullPath := basePath + relativePath + ".php"

			// Check if file exists
			if _, err := os.Stat(fullPath); err == nil {
				return fullPath
			}

			// Try searching recursively in the base directory
			fileName := filepath.Base(relativePath) + ".php"
			if fileName != ".php" {
				foundPath := a.findFileRecursively(basePath, fileName)
				if foundPath != "" {
					return foundPath
				}
			}
		}
	}

	return ""
}

// findFileRecursively searches for a file in directory recursively
func (a *App) findFileRecursively(dir, fileName string) string {
	var foundPath string
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() == fileName {
			foundPath = path
			return filepath.SkipAll
		}
		return nil
	})
	return foundPath
}

// extractRouteName extracts full route name from context
// e.g., from route("profile.edit") or ->name("profile.edit") extracts "profile.edit"
func extractRouteName(beforeWord, word, afterWord string) string {
	combined := beforeWord + word + afterWord

	// Pattern: route('xxx.yyy') or ->name('xxx.yyy')
	re := regexp.MustCompile(`(?:route|->name)\s*\(\s*['"]([^'"]+)['"]`)
	matches := re.FindStringSubmatch(combined)
	if len(matches) > 1 {
		return matches[1]
	}

	return ""
}

// extractViewName extracts full view name from context
// e.g., from view("profile.index") extracts "profile.index"
func extractViewName(beforeWord, word, afterWord string) string {
	// Try to find the opening quote before the word
	// beforeWord ends with something like: view("  or  view('
	// afterWord starts with something like: ")  or  ')

	// Find what's between quotes
	// Pattern: view('xxx.yyy') or view("xxx.yyy")
	combined := beforeWord + word + afterWord

	// Try single quotes first
	re := regexp.MustCompile(`(?:view|@extends|@include|@includeIf|@includeWhen|@component)\s*\(\s*['"]([^'"]+)['"]`)
	matches := re.FindStringSubmatch(combined)
	if len(matches) > 1 {
		return matches[1]
	}

	return ""
}

// constructViewPath builds file path from view name
// e.g., "profile.index" -> "/path/to/project/resources/views/profile/index.blade.php"
func constructViewPath(viewName, projectPath string) string {
	// Convert dots to path separators
	relativePath := strings.ReplaceAll(viewName, ".", string(filepath.Separator))
	fullPath := filepath.Join(projectPath, "resources", "views", relativePath+".blade.php")

	// Check if file exists
	if _, err := os.Stat(fullPath); err == nil {
		return fullPath
	}

	return ""
}

// extractBladeComponent extracts component name from <x-component> tag
// e.g., "<x-layout>" -> "layout", "<x-forms.input" -> "forms.input"
// Returns empty string for x-slot (special directive, not a component)
func extractBladeComponent(beforeWord, word, afterWord string) string {
	combined := beforeWord + word + afterWord

	// Pattern for opening tags: <x-component-name or <x-namespace.component
	// Also handles closing tags: </x-component-name>
	re := regexp.MustCompile(`</?x-([a-zA-Z0-9._-]+)`)
	matches := re.FindStringSubmatch(combined)
	if len(matches) > 1 {
		componentName := matches[1]
		// Skip x-slot as it's a special directive, not a component
		if strings.HasPrefix(componentName, "slot") {
			return ""
		}
		return componentName
	}

	return ""
}

// resolveBladeComponent finds the file path for a Blade component
// Supports:
// - Anonymous components: resources/views/components/alert.blade.php
// - Nested components: resources/views/components/forms/input.blade.php (x-forms.input)
// - Class-based components: app/View/Components/Alert.php
func resolveBladeComponent(componentName, projectPath string) string {
	// Convert dots and dashes to path separators for nested components
	// x-forms.input -> forms/input
	// x-alert-box -> alert-box (dashes stay in filename)
	relativePath := strings.ReplaceAll(componentName, ".", string(filepath.Separator))

	// 1. Check anonymous component in resources/views/components/
	viewPath := filepath.Join(projectPath, "resources", "views", "components", relativePath+".blade.php")
	if _, err := os.Stat(viewPath); err == nil {
		return viewPath
	}

	// 2. Check if it's a directory with index.blade.php
	indexPath := filepath.Join(projectPath, "resources", "views", "components", relativePath, "index.blade.php")
	if _, err := os.Stat(indexPath); err == nil {
		return indexPath
	}

	// 3. Check class-based component in app/View/Components/
	// Convert to PascalCase for class name
	className := toPascalCase(componentName)
	classPath := filepath.Join(projectPath, "app", "View", "Components", className+".php")
	if _, err := os.Stat(classPath); err == nil {
		return classPath
	}

	// 4. Check nested class-based component
	// x-forms.input -> app/View/Components/Forms/Input.php
	parts := strings.Split(componentName, ".")
	if len(parts) > 1 {
		var pathParts []string
		for _, part := range parts {
			pathParts = append(pathParts, toPascalCase(part))
		}
		nestedClassPath := filepath.Join(projectPath, "app", "View", "Components", filepath.Join(pathParts...)+".php")
		if _, err := os.Stat(nestedClassPath); err == nil {
			return nestedClassPath
		}
	}

	return ""
}

// toPascalCase converts kebab-case or snake_case to PascalCase
// e.g., "alert-box" -> "AlertBox", "input_field" -> "InputField"
func toPascalCase(s string) string {
	// Split by dash or underscore
	re := regexp.MustCompile(`[-_]`)
	parts := re.Split(s, -1)

	var result strings.Builder
	for _, part := range parts {
		if len(part) > 0 {
			result.WriteString(strings.ToUpper(string(part[0])))
			if len(part) > 1 {
				result.WriteString(part[1:])
			}
		}
	}

	return result.String()
}

// resolveMiddleware finds the middleware file path
// Supports built-in Laravel middleware and custom middleware
func (a *App) resolveMiddleware(middlewareName string, projectPath string) string {
	// Laravel built-in middleware mappings
	laravelMiddleware := map[string]string{
		"auth":             "vendor/laravel/framework/src/Illuminate/Auth/Middleware/Authenticate.php",
		"auth.basic":       "vendor/laravel/framework/src/Illuminate/Auth/Middleware/AuthenticateWithBasicAuth.php",
		"auth.session":     "vendor/laravel/framework/src/Illuminate/Session/Middleware/AuthenticateSession.php",
		"cache.headers":    "vendor/laravel/framework/src/Illuminate/Http/Middleware/SetCacheHeaders.php",
		"can":              "vendor/laravel/framework/src/Illuminate/Auth/Middleware/Authorize.php",
		"guest":            "vendor/laravel/framework/src/Illuminate/Auth/Middleware/RedirectIfAuthenticated.php",
		"password.confirm": "vendor/laravel/framework/src/Illuminate/Auth/Middleware/RequirePassword.php",
		"precognitive":     "vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/HandlePrecognitiveRequests.php",
		"signed":           "vendor/laravel/framework/src/Illuminate/Routing/Middleware/ValidateSignature.php",
		"throttle":         "vendor/laravel/framework/src/Illuminate/Routing/Middleware/ThrottleRequests.php",
		"verified":         "vendor/laravel/framework/src/Illuminate/Auth/Middleware/EnsureEmailIsVerified.php",
	}

	// Check if it's a Laravel built-in middleware
	if path, ok := laravelMiddleware[middlewareName]; ok {
		fullPath := filepath.Join(projectPath, path)
		if _, err := os.Stat(fullPath); err == nil {
			return fullPath
		}
	}

	// Check custom middleware in app/Http/Middleware/
	// Convert middleware name to possible file names
	possibleNames := []string{
		middlewareName + ".php",
		toPascalCase(middlewareName) + ".php",
		strings.Title(middlewareName) + ".php",
	}

	middlewareDir := filepath.Join(projectPath, "app", "Http", "Middleware")
	for _, name := range possibleNames {
		fullPath := filepath.Join(middlewareDir, name)
		if _, err := os.Stat(fullPath); err == nil {
			return fullPath
		}
	}

	// Search recursively in middleware directory
	var foundPath string
	filepath.Walk(middlewareDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		// Check if file contains the middleware class
		baseName := strings.TrimSuffix(info.Name(), ".php")
		if strings.EqualFold(baseName, middlewareName) || strings.EqualFold(baseName, toPascalCase(middlewareName)) {
			foundPath = path
			return filepath.SkipAll
		}
		return nil
	})

	return foundPath
}

// findRouteNameUsages finds all usages of a route name in the project
func (a *App) findRouteNameUsages(routeName string, projectPath string) []DefinitionResult {
	var results []DefinitionResult

	// Directories to search
	searchDirs := []string{
		filepath.Join(projectPath, "app"),
		filepath.Join(projectPath, "resources", "views"),
		filepath.Join(projectPath, "tests"),
	}

	// Patterns to match route usage
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`route\s*\(\s*['"]` + regexp.QuoteMeta(routeName) + `['"]\s*[,)]`),
		regexp.MustCompile(`Redirect::route\s*\(\s*['"]` + regexp.QuoteMeta(routeName) + `['"]`),
		regexp.MustCompile(`redirect\(\)->route\s*\(\s*['"]` + regexp.QuoteMeta(routeName) + `['"]`),
		regexp.MustCompile(`to_route\s*\(\s*['"]` + regexp.QuoteMeta(routeName) + `['"]`),
	}

	for _, dir := range searchDirs {
		filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}

			// Only search in PHP and Blade files
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".php" {
				return nil
			}

			// Read file content
			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}

			lines := strings.Split(string(content), "\n")
			for lineNum, line := range lines {
				for _, pattern := range patterns {
					if pattern.MatchString(line) {
						// Determine context
						context := "route('" + routeName + "')"
						if strings.Contains(line, "Redirect::route") {
							context = "Redirect::route('" + routeName + "')"
						} else if strings.Contains(line, "redirect") {
							context = "redirect()->route('" + routeName + "')"
						}

						results = append(results, DefinitionResult{
							Path:        path,
							Line:        lineNum + 1,
							Context:     context,
							DisplayPath: getDisplayPath(path, projectPath),
						})
						break // Only one match per line
					}
				}
			}

			return nil
		})
	}

	return results
}

// extractConfigKey extracts full config key from context
// e.g., from config('app.name') extracts "app.name"
func extractConfigKey(beforeWord, word, afterWord string) string {
	combined := beforeWord + word + afterWord
	re := regexp.MustCompile(`config\s*\(\s*['"]([^'"]+)['"]`)
	matches := re.FindStringSubmatch(combined)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

// extractEnvKey extracts ENV key from context
// e.g., from env('APP_NAME') extracts "APP_NAME"
func extractEnvKey(beforeWord, word, afterWord string) string {
	combined := beforeWord + word + afterWord
	re := regexp.MustCompile(`env\s*\(\s*['"]([^'"]+)['"]`)
	matches := re.FindStringSubmatch(combined)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

// resolveConfigKey finds config file and line for a config key
// e.g., "app.name" -> config/app.php line containing 'name'
func (a *App) resolveConfigKey(configKey string, projectPath string) *DefinitionResult {
	parts := strings.SplitN(configKey, ".", 2)
	if len(parts) == 0 {
		return nil
	}

	configFile := parts[0]
	configPath := filepath.Join(projectPath, "config", configFile+".php")

	if _, err := os.Stat(configPath); err != nil {
		return nil
	}

	line := 1
	if len(parts) > 1 {
		// Find the specific key in config file
		nestedKey := parts[1]
		keyParts := strings.Split(nestedKey, ".")
		firstKey := keyParts[0]
		line = a.findConfigKeyLine(configPath, firstKey)
	}

	return &DefinitionResult{
		Path:        configPath,
		Line:        line,
		Context:     fmt.Sprintf("Config: %s", configKey),
		DisplayPath: "config/" + configFile + ".php",
	}
}

// findConfigKeyLine finds line number for a config key in file
func (a *App) findConfigKeyLine(filePath, key string) int {
	file, err := os.Open(filePath)
	if err != nil {
		return 1
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineNum := 0
	pattern := regexp.MustCompile(`['"]` + regexp.QuoteMeta(key) + `['"]\s*=>`)

	for scanner.Scan() {
		lineNum++
		if pattern.MatchString(scanner.Text()) {
			return lineNum
		}
	}

	return 1
}

// findEnvKeyLine finds line number for an ENV key in .env file
func (a *App) findEnvKeyLine(filePath, key string) int {
	file, err := os.Open(filePath)
	if err != nil {
		return 1
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineNum := 0
	prefix := key + "="

	for scanner.Scan() {
		lineNum++
		if strings.HasPrefix(scanner.Text(), prefix) {
			return lineNum
		}
	}

	return 1
}

// extractFullUseStatement extracts the full namespace from a use statement
// e.g., "use Laravel\Socialite\Facades\Socialite;" -> "Laravel\Socialite\Facades\Socialite"
func extractFullUseStatement(beforeWord, word, afterWord string) string {
	combined := beforeWord + word + afterWord

	// Pattern: use Namespace\Path\ClassName;
	re := regexp.MustCompile(`\buse\s+([\w\\]+);?`)
	matches := re.FindStringSubmatch(combined)
	if len(matches) > 1 {
		return strings.TrimSuffix(matches[1], ";")
	}

	// If beforeWord contains partial namespace, combine
	if strings.Contains(beforeWord, "\\") {
		// Extract namespace from beforeWord
		nsRe := regexp.MustCompile(`([\w\\]+)\\$`)
		nsMatches := nsRe.FindStringSubmatch(beforeWord)
		if len(nsMatches) > 1 {
			return nsMatches[1] + "\\" + word
		}
	}

	return ""
}

// getClassNameFromNamespace extracts class name from full namespace
// e.g., "Laravel\Socialite\Facades\Socialite" -> "Socialite"
func getClassNameFromNamespace(namespace string) string {
	parts := strings.Split(namespace, "\\")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return namespace
}

// resolveVendorNamespace resolves a namespace to a vendor package file
func (a *App) resolveVendorNamespace(namespace string, projectPath string) string {
	// Convert namespace to potential vendor path
	// Laravel\Socialite\Facades\Socialite -> vendor/laravel/socialite/src/Facades/Socialite.php
	parts := strings.Split(namespace, "\\")
	if len(parts) < 2 {
		return ""
	}

	// Common vendor mappings
	vendorMappings := map[string]string{
		"Laravel":    "laravel",
		"Illuminate": "laravel/framework/src/Illuminate",
		"Symfony":    "symfony",
		"Carbon":     "nesbot/carbon/src/Carbon",
		"Livewire":   "livewire/livewire/src",
		"Inertia":    "inertiajs/inertia-laravel/src",
	}

	vendorPrefix := ""
	startIndex := 0

	// Check if first part matches a known vendor
	if mapped, ok := vendorMappings[parts[0]]; ok {
		vendorPrefix = mapped
		startIndex = 1

		// Special case for Laravel packages
		if parts[0] == "Laravel" && len(parts) > 1 {
			packageName := strings.ToLower(parts[1])
			vendorPrefix = "laravel/" + packageName + "/src"
			startIndex = 2
		}
	}

	if vendorPrefix == "" {
		// Try to guess: first part lowercase as vendor, second as package
		vendorPrefix = strings.ToLower(parts[0]) + "/" + strings.ToLower(parts[1]) + "/src"
		startIndex = 2
	}

	// Build remaining path
	remainingPath := strings.Join(parts[startIndex:], "/")
	if remainingPath != "" {
		fullPath := filepath.Join(projectPath, "vendor", vendorPrefix, remainingPath+".php")
		if _, err := os.Stat(fullPath); err == nil {
			return fullPath
		}
	}

	// Try with class name only
	className := parts[len(parts)-1]
	searchPath := filepath.Join(projectPath, "vendor", vendorPrefix)

	var foundPath string
	filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() == className+".php" {
			foundPath = path
			return filepath.SkipAll
		}
		return nil
	})

	return foundPath
}
