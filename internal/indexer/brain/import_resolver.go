package brain

import (
	"crypto/sha1"
	"encoding/hex"
	"regexp"
	"strings"
	"sync"
	"time"
)

type ImportChainResolver struct {
	mu         sync.RWMutex
	cache      map[string]*importCache
	maxEntries int
	cacheTTL   time.Duration

	phpUsePattern            *regexp.Regexp
	phpAliasPattern          *regexp.Regexp
	tsImportPattern          *regexp.Regexp
	pyImportPattern          *regexp.Regexp
	pyFromPattern            *regexp.Regexp
	goImportPattern          *regexp.Regexp
	rustUsePattern           *regexp.Regexp
	dartImportPattern        *regexp.Regexp
	csUsingAliasPattern      *regexp.Regexp
	cppNamespaceAliasPattern *regexp.Regexp
}

type importCache struct {
	imports    map[string]string
	contentKey string
	cachedAt   time.Time
}

func importContentKey(content []byte) string {
	sum := sha1.Sum(content)
	return hex.EncodeToString(sum[:])
}

func NewImportChainResolver() *ImportChainResolver {
	return &ImportChainResolver{
		cache:                    make(map[string]*importCache),
		maxEntries:               200,
		cacheTTL:                 2 * time.Minute,
		phpUsePattern:            regexp.MustCompile(`^\s*use\s+([^\s;]+?)(?:\s+as\s+(\w+))?\s*;`),
		phpAliasPattern:          regexp.MustCompile(`^\s*use\s+([^\s{;]+)\s*\{([^}]+)\}`),
		tsImportPattern:          regexp.MustCompile(`(?s)\bimport\s+(?:type\s+)?(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+['"]([^'"]+)['"]`),
		pyImportPattern:          regexp.MustCompile(`^\s*import\s+(\S+)(?:\s+as\s+(\w+))?`),
		pyFromPattern:            regexp.MustCompile(`^\s*from\s+(\S+)\s+import\s+(.+)`),
		goImportPattern:          regexp.MustCompile(`^\s*(?:import\s+)?(?:(\w+)\s+)?["']([^"']+)["']`),
		rustUsePattern:           regexp.MustCompile(`^\s*use\s+([^;]+);`),
		dartImportPattern:        regexp.MustCompile(`^\s*import\s+['"]([^'"]+)['"](?:\s+as\s+(\w+))?`),
		csUsingAliasPattern:      regexp.MustCompile(`^\s*using\s+(\w+)\s*=\s*([^;]+);`),
		cppNamespaceAliasPattern: regexp.MustCompile(`^\s*namespace\s+(\w+)\s*=\s*([^;]+);`),
	}
}

func (r *ImportChainResolver) ResolveClassName(filePath string, content []byte, shortName, language string) string {
	imports := r.ParseImports(filePath, content, language)
	if fullPath, ok := imports[shortName]; ok {
		return fullPath
	}
	return ""
}

func (r *ImportChainResolver) ParseImports(filePath string, content []byte, language string) map[string]string {
	r.mu.RLock()
	cached, ok := r.cache[filePath]
	r.mu.RUnlock()

	contentKey := importContentKey(content)
	contentStr := string(content)
	if ok && time.Since(cached.cachedAt) < r.cacheTTL && cached.contentKey == contentKey {
		return cached.imports
	}

	imports := r.parseImportsForLanguage(contentStr, language)

	r.mu.Lock()
	r.cache[filePath] = &importCache{
		imports:    imports,
		contentKey: contentKey,
		cachedAt:   time.Now(),
	}
	r.cleanupCacheLocked()
	r.mu.Unlock()

	return imports
}

func (r *ImportChainResolver) parseImportsForLanguage(content, language string) map[string]string {
	switch language {
	case "php", "php-laravel":
		return r.parsePHPImports(content)
	case "typescript", "typescriptreact", "javascript", "javascriptreact":
		return r.parseTSImports(content)
	case "python":
		return r.parsePythonImports(content)
	case "go":
		return r.parseGoImports(content)
	case "rust":
		return r.parseRustImports(content)
	case "dart":
		return r.parseDartImports(content)
	case "csharp", "cs":
		return r.parseCSharpImports(content)
	case "cpp", "c++", "c":
		return r.parseCppImports(content)
	default:
		return make(map[string]string)
	}
}

func (r *ImportChainResolver) parsePHPImports(content string) map[string]string {
	imports := make(map[string]string)
	lines := strings.Split(content, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if strings.HasPrefix(line, "class ") || strings.HasPrefix(line, "interface ") ||
			strings.HasPrefix(line, "trait ") || strings.HasPrefix(line, "function ") {
			break
		}

		if matches := r.phpUsePattern.FindStringSubmatch(line); len(matches) >= 2 {
			fullPath := matches[1]
			shortName := ""
			if len(matches) >= 3 && matches[2] != "" {
				shortName = matches[2]
			} else {
				parts := strings.Split(fullPath, "\\")
				shortName = parts[len(parts)-1]
			}
			imports[shortName] = fullPath
			continue
		}

		if matches := r.phpAliasPattern.FindStringSubmatch(line); len(matches) >= 3 {
			basePath := matches[1]
			groupItems := matches[2]
			for _, item := range strings.Split(groupItems, ",") {
				item = strings.TrimSpace(item)
				if item == "" {
					continue
				}
				parts := strings.Split(item, " as ")
				className := strings.TrimSpace(parts[0])
				shortName := className
				if len(parts) > 1 {
					shortName = strings.TrimSpace(parts[1])
				}
				imports[shortName] = basePath + className
			}
		}
	}

	return imports
}

func (r *ImportChainResolver) parseTSImports(content string) map[string]string {
	imports := make(map[string]string)

	for _, matches := range r.tsImportPattern.FindAllStringSubmatch(content, -1) {
		if len(matches) < 6 {
			continue
		}
		modulePath := matches[5]
		if matches[1] != "" {
			addTSNamedImports(imports, matches[1], modulePath)
			continue
		}
		if matches[2] != "" {
			imports[matches[2]] = modulePath
			continue
		}
		if matches[3] != "" {
			imports[matches[3]] = modulePath
		}
		if len(matches) > 4 && matches[4] != "" {
			addTSNamedImports(imports, matches[4], modulePath)
		}
	}

	return imports
}

func addTSNamedImports(imports map[string]string, names, modulePath string) {
	for _, name := range strings.Split(names, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		name = strings.TrimSpace(strings.TrimPrefix(name, "type "))
		parts := strings.Split(name, " as ")
		originalName := strings.TrimSpace(parts[0])
		shortName := originalName
		if len(parts) > 1 {
			shortName = strings.TrimSpace(parts[1])
		}
		if shortName != "" {
			imports[shortName] = modulePath
		}
	}
}

func (r *ImportChainResolver) parsePythonImports(content string) map[string]string {
	imports := make(map[string]string)
	lines := strings.Split(content, "\n")

	for _, line := range lines {
		if matches := r.pyFromPattern.FindStringSubmatch(line); len(matches) >= 3 {
			modulePath := matches[1]
			importPart := matches[2]
			for _, name := range strings.Split(importPart, ",") {
				name = strings.TrimSpace(name)
				parts := strings.Split(name, " as ")
				originalName := strings.TrimSpace(parts[0])
				shortName := originalName
				if len(parts) > 1 {
					shortName = strings.TrimSpace(parts[1])
				}
				imports[shortName] = modulePath + "." + originalName
			}
			continue
		}

		if matches := r.pyImportPattern.FindStringSubmatch(line); len(matches) >= 2 {
			modulePath := strings.TrimSpace(matches[1])
			shortName := modulePath
			if idx := strings.LastIndex(modulePath, "."); idx >= 0 {
				shortName = modulePath[idx+1:]
			}
			if len(matches) > 2 && strings.TrimSpace(matches[2]) != "" {
				shortName = strings.TrimSpace(matches[2])
			}
			imports[shortName] = modulePath
		}
	}

	return imports
}

func (r *ImportChainResolver) parseGoImports(content string) map[string]string {
	imports := make(map[string]string)
	lines := strings.Split(content, "\n")
	inImportBlock := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "import (") {
			inImportBlock = true
			continue
		}
		if inImportBlock && trimmed == ")" {
			inImportBlock = false
			continue
		}

		if inImportBlock || strings.HasPrefix(trimmed, "import ") {
			if matches := r.goImportPattern.FindStringSubmatch(line); len(matches) >= 3 {
				pkgPath := matches[2]
				alias := matches[1]
				pkgName := inferGoImportPackageName(pkgPath)
				if alias != "" {
					imports[alias] = pkgPath
				} else {
					imports[pkgName] = pkgPath
				}
			}
		}
	}

	return imports
}

func inferGoImportPackageName(pkgPath string) string {
	parts := strings.Split(strings.Trim(pkgPath, "/"), "/")
	if len(parts) == 0 {
		return pkgPath
	}
	name := parts[len(parts)-1]
	if regexp.MustCompile(`^v\d+$`).MatchString(name) && len(parts) > 1 {
		return parts[len(parts)-2]
	}
	if matches := regexp.MustCompile(`^(.+)\.v\d+$`).FindStringSubmatch(name); len(matches) == 2 {
		return matches[1]
	}
	return name
}

func (r *ImportChainResolver) parseRustImports(content string) map[string]string {
	imports := make(map[string]string)
	lines := strings.Split(content, "\n")

	for _, line := range lines {
		if matches := r.rustUsePattern.FindStringSubmatch(line); len(matches) >= 2 {
			usePath := strings.TrimSpace(matches[1])
			parts := strings.Split(usePath, "::")
			if len(parts) > 0 {
				shortName := parts[len(parts)-1]
				if strings.Contains(shortName, "{") {
					basePath := strings.Join(parts[:len(parts)-1], "::")
					shortName = strings.Trim(shortName, "{}")
					for _, name := range strings.Split(shortName, ",") {
						originalName, alias := parseRustUseName(name)
						if originalName == "" {
							continue
						}
						imports[alias] = basePath + "::" + originalName
					}
				} else {
					originalName, alias := parseRustUseName(shortName)
					if originalName == "" {
						continue
					}
					if alias != originalName {
						imports[alias] = strings.Join(append(parts[:len(parts)-1], originalName), "::")
					} else {
						imports[alias] = usePath
					}
				}
			}
		}
	}

	return imports
}

func parseRustUseName(name string) (string, string) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", ""
	}
	parts := strings.Split(name, " as ")
	originalName := strings.TrimSpace(parts[0])
	alias := originalName
	if len(parts) > 1 {
		alias = strings.TrimSpace(parts[1])
	}
	if originalName == "" || alias == "" {
		return "", ""
	}
	return originalName, alias
}

func (r *ImportChainResolver) parseDartImports(content string) map[string]string {
	imports := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		matches := r.dartImportPattern.FindStringSubmatch(line)
		if len(matches) < 2 {
			continue
		}
		path := strings.TrimSpace(matches[1])
		alias := ""
		if len(matches) > 2 {
			alias = strings.TrimSpace(matches[2])
		}
		if alias != "" {
			imports[alias] = path
			continue
		}
		if base := dartImportBaseName(path); base != "" {
			imports[base] = path
		}
	}
	return imports
}

func dartImportBaseName(path string) string {
	path = strings.TrimSuffix(strings.TrimSpace(path), ".dart")
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		path = path[idx+1:]
	}
	return strings.TrimSpace(path)
}

func (r *ImportChainResolver) parseCSharpImports(content string) map[string]string {
	imports := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		if matches := r.csUsingAliasPattern.FindStringSubmatch(line); len(matches) == 3 {
			imports[strings.TrimSpace(matches[1])] = strings.TrimSpace(matches[2])
			continue
		}
	}
	return imports
}

func (r *ImportChainResolver) parseCppImports(content string) map[string]string {
	imports := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		matches := r.cppNamespaceAliasPattern.FindStringSubmatch(line)
		if len(matches) == 3 {
			imports[strings.TrimSpace(matches[1])] = strings.TrimSpace(matches[2])
		}
	}
	return imports
}

func (r *ImportChainResolver) InvalidateCache(filePath string) {
	r.mu.Lock()
	delete(r.cache, filePath)
	r.mu.Unlock()
}

func (r *ImportChainResolver) ClearCache() {
	r.mu.Lock()
	r.cache = make(map[string]*importCache)
	r.mu.Unlock()
}

func (r *ImportChainResolver) Stats() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.cache)
}

func (r *ImportChainResolver) cleanupCacheLocked() {
	if len(r.cache) <= r.maxEntries {
		return
	}

	now := time.Now()
	for key, cached := range r.cache {
		if now.Sub(cached.cachedAt) > r.cacheTTL {
			delete(r.cache, key)
		}
	}

	for len(r.cache) > r.maxEntries {
		var oldestKey string
		var oldestTime time.Time
		first := true
		for key, cached := range r.cache {
			if first || cached.cachedAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = cached.cachedAt
				first = false
			}
		}
		if oldestKey == "" {
			break
		}
		delete(r.cache, oldestKey)
	}
}
