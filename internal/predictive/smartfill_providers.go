package predictive

import (
	"path/filepath"
	"strings"
	"sync"
)

type SymbolInfo struct {
	Name      string
	Kind      string
	Namespace string
	FilePath  string
	Line      int
	Signature string
}

type SymbolProvider interface {
	QuerySymbols(query SymbolQuery) []SymbolInfo
	GetProjectRoot() string
}

type SymbolQuery struct {
	Name      string
	Kind      string
	Language  string
	Namespace string
	FilePath  string
	Limit     int
}

type ResolverFunc func(ctx *FileContext, sp SymbolProvider) string

type PluginResolverProvider interface {
	GetResolvers() map[string]ResolverFunc
	Name() string
}

type EnhancedPlaceholderResolver struct {
	mu              sync.RWMutex
	basicResolvers  map[string]func(*FileContext) string
	indexResolvers  map[string]ResolverFunc
	pluginResolvers map[string]ResolverFunc
	symbolProvider  SymbolProvider
	relationships   *FileRelationshipAnalyzer
}

type ResolutionStats struct {
	PluginHits  int
	IndexHits   int
	BasicHits   int
	DefaultHits int
}

func (s ResolutionStats) HasResolvedData() bool {
	return s.PluginHits+s.IndexHits+s.BasicHits > 0
}

func (s ResolutionStats) UsesFallbackDefaults() bool {
	return s.DefaultHits > 0
}

type resolutionSource uint8

const (
	resolutionSourceNone resolutionSource = iota
	resolutionSourcePlugin
	resolutionSourceIndex
	resolutionSourceBasic
	resolutionSourceDefault
)

func NewEnhancedPlaceholderResolver() *EnhancedPlaceholderResolver {
	r := &EnhancedPlaceholderResolver{
		basicResolvers:  make(map[string]func(*FileContext) string),
		indexResolvers:  make(map[string]ResolverFunc),
		pluginResolvers: make(map[string]ResolverFunc),
		relationships:   NewFileRelationshipAnalyzer(),
	}
	r.registerBuiltinResolvers()
	r.registerIndexAwareResolvers()
	return r
}

func (r *EnhancedPlaceholderResolver) SetSymbolProvider(sp SymbolProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.symbolProvider = sp
	r.relationships.SetSymbolProvider(sp)
}

func (r *EnhancedPlaceholderResolver) RegisterPluginProvider(provider PluginResolverProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for name, resolver := range provider.GetResolvers() {
		r.pluginResolvers[name] = resolver
	}
}

func (r *EnhancedPlaceholderResolver) RegisterPluginResolver(placeholder string, fn ResolverFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pluginResolvers[placeholder] = fn
}

func (r *EnhancedPlaceholderResolver) ResolvePlaceholders(template string, ctx *FileContext) string {
	resolved, _ := r.ResolvePlaceholdersWithStats(template, ctx)
	return resolved
}

func (r *EnhancedPlaceholderResolver) ResolvePlaceholdersWithStats(template string, ctx *FileContext) (string, ResolutionStats) {
	if ctx == nil {
		return template, ResolutionStats{}
	}

	r.mu.RLock()
	sp := r.symbolProvider
	r.mu.RUnlock()

	stats := ResolutionStats{}
	resolved := placeholderRegex.ReplaceAllStringFunc(template, func(match string) string {
		placeholder := strings.TrimPrefix(match, "$")
		value, source := r.resolveOneWithSource(placeholder, ctx, sp)
		switch source {
		case resolutionSourcePlugin:
			stats.PluginHits++
		case resolutionSourceIndex:
			stats.IndexHits++
		case resolutionSourceBasic:
			stats.BasicHits++
		case resolutionSourceDefault:
			stats.DefaultHits++
		}
		return value
	})

	return resolved, stats
}

func (r *EnhancedPlaceholderResolver) ResolveOne(placeholder string, ctx *FileContext) string {
	r.mu.RLock()
	sp := r.symbolProvider
	r.mu.RUnlock()
	value, _ := r.resolveOneWithSource(placeholder, ctx, sp)
	return value
}

func (r *EnhancedPlaceholderResolver) resolveOne(placeholder string, ctx *FileContext, sp SymbolProvider) string {
	value, _ := r.resolveOneWithSource(placeholder, ctx, sp)
	return value
}

func (r *EnhancedPlaceholderResolver) resolveOneWithSource(placeholder string, ctx *FileContext, sp SymbolProvider) (string, resolutionSource) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if resolver, ok := r.pluginResolvers[placeholder]; ok {
		if value := resolver(ctx, sp); value != "" {
			return value, resolutionSourcePlugin
		}
	}

	if sp != nil {
		if resolver, ok := r.indexResolvers[placeholder]; ok {
			if value := resolver(ctx, sp); value != "" {
				return value, resolutionSourceIndex
			}
		}
	}

	if resolver, ok := r.basicResolvers[placeholder]; ok {
		if value := resolver(ctx); value != "" {
			return value, resolutionSourceBasic
		}
	}

	return defaultValue(placeholder), resolutionSourceDefault
}

func (r *EnhancedPlaceholderResolver) registerBuiltinResolvers() {
	r.basicResolvers["CONTROLLER"] = resolveController
	r.basicResolvers["MODEL"] = resolveModel
	r.basicResolvers["METHOD"] = resolveMethod
	r.basicResolvers["PATH"] = resolvePath
	r.basicResolvers["RESOURCE"] = resolveResource
	r.basicResolvers["NAME"] = resolveName
	r.basicResolvers["TABLE"] = resolveTable
	r.basicResolvers["COLUMN"] = resolveColumn
	r.basicResolvers["FIELD"] = resolveField
	r.basicResolvers["RELATION"] = resolveRelation
	r.basicResolvers["TYPE"] = resolveType
	r.basicResolvers["REQUEST"] = resolveRequest
	r.basicResolvers["MIDDLEWARE"] = resolveMiddleware
	r.basicResolvers["VIEW"] = resolveView
	r.basicResolvers["VAR"] = resolveVar
	r.basicResolvers["EVENT"] = resolveEvent
	r.basicResolvers["PARAMS"] = resolveParams
	r.basicResolvers["ATTRIBUTE"] = resolveAttribute
	r.basicResolvers["RULES"] = resolveRules
	r.basicResolvers["VALUE"] = resolveValue
	r.basicResolvers["ROUTES"] = resolveRoutes
	r.basicResolvers["BEFORE"] = resolveBefore
	r.basicResolvers["AFTER"] = resolveAfter
	r.basicResolvers["BODY"] = resolveBody
}

func (r *EnhancedPlaceholderResolver) registerIndexAwareResolvers() {
	r.indexResolvers["CONTROLLER"] = resolveControllerFromIndex
	r.indexResolvers["MODEL"] = resolveModelFromIndex
	r.indexResolvers["REQUEST"] = resolveRequestFromIndex
	r.indexResolvers["MIDDLEWARE"] = resolveMiddlewareFromIndex
	r.indexResolvers["EVENT"] = resolveEventFromIndex
	r.indexResolvers["RELATION"] = r.resolveRelationFromIndex
}

func resolveControllerFromIndex(ctx *FileContext, sp SymbolProvider) string {
	if ctx.ClassName != "" && strings.HasSuffix(ctx.ClassName, "Controller") {
		return ctx.ClassName
	}

	modelName := extractModelFromFileName(ctx.FilePath)
	if modelName == "" {
		return ""
	}

	controllerName := modelName + "Controller"
	symbols := sp.QuerySymbols(SymbolQuery{
		Name:     controllerName,
		Kind:     "class",
		Language: ctx.Language,
		Limit:    1,
	})

	if len(symbols) > 0 {
		return symbols[0].Name
	}

	symbols = sp.QuerySymbols(SymbolQuery{
		Name:     singularize(modelName) + "Controller",
		Kind:     "class",
		Language: ctx.Language,
		Limit:    1,
	})

	if len(symbols) > 0 {
		return symbols[0].Name
	}

	return ""
}

func resolveModelFromIndex(ctx *FileContext, sp SymbolProvider) string {
	baseName := ""
	if ctx.ClassName != "" {
		baseName = ctx.ClassName
		baseName = strings.TrimSuffix(baseName, "Controller")
		baseName = strings.TrimSuffix(baseName, "Service")
		baseName = strings.TrimSuffix(baseName, "Repository")
		baseName = strings.TrimSuffix(baseName, "Request")
		baseName = strings.TrimSuffix(baseName, "Resource")
	} else {
		baseName = extractModelFromFileName(ctx.FilePath)
	}

	if baseName == "" {
		return ""
	}

	modelName := singularize(baseName)

	symbols := sp.QuerySymbols(SymbolQuery{
		Name:     modelName,
		Kind:     "class",
		Language: ctx.Language,
		Limit:    5,
	})

	for _, sym := range symbols {
		if isModelClass(sym, ctx.Framework) {
			return sym.Name
		}
	}

	if len(symbols) > 0 {
		return symbols[0].Name
	}

	return ""
}

func isModelClass(sym SymbolInfo, framework string) bool {
	if sym.Kind == "model" {
		return true
	}

	switch framework {
	case "laravel":
		if strings.Contains(sym.Namespace, "Models") ||
			strings.Contains(sym.FilePath, "/Models/") ||
			strings.Contains(sym.FilePath, "\\Models\\") {
			return true
		}
	case "django":
		if strings.Contains(sym.FilePath, "models.py") {
			return true
		}
	case "rails":
		if strings.Contains(sym.FilePath, "/models/") {
			return true
		}
	}

	return false
}

func resolveRequestFromIndex(ctx *FileContext, sp SymbolProvider) string {
	modelName := resolveModelFromIndex(ctx, sp)
	if modelName == "" {
		modelName = resolveModel(ctx)
	}

	if modelName == "" {
		return ""
	}

	requestName := modelName + "Request"
	symbols := sp.QuerySymbols(SymbolQuery{
		Name:     requestName,
		Kind:     "class",
		Language: ctx.Language,
		Limit:    1,
	})

	if len(symbols) > 0 {
		return symbols[0].Name
	}

	for _, suffix := range []string{"StoreRequest", "UpdateRequest", "CreateRequest"} {
		symbols = sp.QuerySymbols(SymbolQuery{
			Name:     modelName + suffix,
			Kind:     "class",
			Language: ctx.Language,
			Limit:    1,
		})
		if len(symbols) > 0 {
			return symbols[0].Name
		}
	}

	return ""
}

func resolveMiddlewareFromIndex(ctx *FileContext, sp SymbolProvider) string {
	symbols := sp.QuerySymbols(SymbolQuery{
		Kind:     "class",
		Language: ctx.Language,
		Limit:    20,
	})

	var middlewares []string
	for _, sym := range symbols {
		if strings.HasSuffix(sym.Name, "Middleware") ||
			strings.Contains(sym.FilePath, "/Middleware/") ||
			strings.Contains(sym.FilePath, "\\Middleware\\") {
			middlewares = append(middlewares, strings.TrimSuffix(sym.Name, "Middleware"))
		}
	}

	commonMiddlewares := []string{"auth", "guest", "verified", "throttle", "api", "web"}
	for _, m := range commonMiddlewares {
		for _, existing := range middlewares {
			if strings.EqualFold(existing, m) {
				return strings.ToLower(m)
			}
		}
	}

	if len(middlewares) > 0 {
		return strings.ToLower(middlewares[0])
	}

	return ""
}

func resolveEventFromIndex(ctx *FileContext, sp SymbolProvider) string {
	modelName := resolveModelFromIndex(ctx, sp)
	if modelName == "" {
		modelName = resolveModel(ctx)
	}

	if modelName == "" {
		return ""
	}

	for _, suffix := range []string{"Created", "Updated", "Deleted", "Event"} {
		eventName := modelName + suffix
		symbols := sp.QuerySymbols(SymbolQuery{
			Name:     eventName,
			Kind:     "class",
			Language: ctx.Language,
			Limit:    1,
		})
		if len(symbols) > 0 {
			return symbols[0].Name
		}
	}

	return ""
}

func (r *EnhancedPlaceholderResolver) resolveRelationFromIndex(ctx *FileContext, sp SymbolProvider) string {
	if ctx.ClassName == "" {
		return ""
	}

	related := r.relationships.FindRelatedModels(ctx.ClassName, ctx.FilePath, sp)
	if len(related) > 0 {
		return strings.ToLower(related[0])
	}

	return ""
}

type FileRelationshipAnalyzer struct {
	mu             sync.RWMutex
	cache          map[string][]string
	symbolProvider SymbolProvider
}

func NewFileRelationshipAnalyzer() *FileRelationshipAnalyzer {
	return &FileRelationshipAnalyzer{
		cache: make(map[string][]string),
	}
}

func (a *FileRelationshipAnalyzer) SetSymbolProvider(sp SymbolProvider) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.symbolProvider = sp
}

func (a *FileRelationshipAnalyzer) FindRelatedModels(className, filePath string, sp SymbolProvider) []string {
	if sp == nil {
		return nil
	}

	a.mu.RLock()
	if cached, ok := a.cache[className]; ok {
		a.mu.RUnlock()
		return cached
	}
	a.mu.RUnlock()

	var related []string

	models := sp.QuerySymbols(SymbolQuery{
		Kind:  "class",
		Limit: 50,
	})

	modelName := strings.TrimSuffix(className, "Controller")
	modelName = strings.TrimSuffix(modelName, "Service")
	modelName = singularize(modelName)

	for _, sym := range models {
		if sym.Name == modelName || sym.Name == className {
			continue
		}

		if isLikelyRelated(modelName, sym.Name) {
			related = append(related, sym.Name)
		}
	}

	a.mu.Lock()
	a.cache[className] = related
	a.mu.Unlock()

	return related
}

func isLikelyRelated(model1, model2 string) bool {
	commonPairs := map[string][]string{
		"User":     {"Post", "Comment", "Profile", "Order", "Role"},
		"Post":     {"Comment", "Category", "Tag", "Author"},
		"Order":    {"OrderItem", "Product", "Customer", "Payment"},
		"Product":  {"Category", "OrderItem", "Review", "Variant"},
		"Category": {"Product", "Post", "Subcategory"},
		"Comment":  {"User", "Post", "Reply"},
	}

	if pairs, ok := commonPairs[model1]; ok {
		for _, p := range pairs {
			if p == model2 {
				return true
			}
		}
	}

	if strings.HasPrefix(model2, model1) || strings.HasSuffix(model2, model1) {
		return true
	}

	return false
}

func (a *FileRelationshipAnalyzer) InferRelationshipType(from, to string) string {
	toPlural := pluralize(to)
	fromPlural := pluralize(from)

	if strings.HasPrefix(to, from) {
		return "hasMany"
	}

	if strings.HasSuffix(fromPlural, toPlural) || toPlural == from+"s" {
		return "belongsTo"
	}

	return "hasMany"
}

func (a *FileRelationshipAnalyzer) FindControllerForModel(modelName string, sp SymbolProvider) *SymbolInfo {
	if sp == nil {
		return nil
	}

	symbols := sp.QuerySymbols(SymbolQuery{
		Name:  modelName + "Controller",
		Kind:  "class",
		Limit: 1,
	})

	if len(symbols) > 0 {
		return &symbols[0]
	}

	symbols = sp.QuerySymbols(SymbolQuery{
		Name:  pluralize(modelName) + "Controller",
		Kind:  "class",
		Limit: 1,
	})

	if len(symbols) > 0 {
		return &symbols[0]
	}

	return nil
}

func (a *FileRelationshipAnalyzer) FindServiceForModel(modelName string, sp SymbolProvider) *SymbolInfo {
	if sp == nil {
		return nil
	}

	for _, suffix := range []string{"Service", "Repository"} {
		symbols := sp.QuerySymbols(SymbolQuery{
			Name:  modelName + suffix,
			Kind:  "class",
			Limit: 1,
		})
		if len(symbols) > 0 {
			return &symbols[0]
		}
	}

	return nil
}

func GetRelatedFilePath(currentPath string, targetType string, sp SymbolProvider) string {
	dir := filepath.Dir(currentPath)
	base := filepath.Base(currentPath)
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)

	name = strings.TrimSuffix(name, "Controller")
	name = strings.TrimSuffix(name, "Service")
	name = strings.TrimSuffix(name, "Request")

	var targetDir string
	var targetSuffix string

	switch targetType {
	case "controller":
		targetDir = strings.Replace(dir, "/Models", "/Http/Controllers", 1)
		targetSuffix = "Controller"
	case "model":
		targetDir = strings.Replace(dir, "/Http/Controllers", "/Models", 1)
		targetDir = strings.Replace(targetDir, "/Services", "/Models", 1)
		targetSuffix = ""
	case "service":
		targetDir = strings.Replace(dir, "/Models", "/Services", 1)
		targetDir = strings.Replace(targetDir, "/Http/Controllers", "/Services", 1)
		targetSuffix = "Service"
	case "request":
		targetDir = strings.Replace(dir, "/Http/Controllers", "/Http/Requests", 1)
		targetSuffix = "Request"
	default:
		return ""
	}

	return filepath.Join(targetDir, name+targetSuffix+ext)
}
