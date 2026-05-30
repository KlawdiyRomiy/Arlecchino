package importcaps

import "strings"

type AutoImportLevel string

const (
	AutoImportNative        AutoImportLevel = "native"
	AutoImportPartialNative AutoImportLevel = "partial-native"
	AutoImportLSPOnly       AutoImportLevel = "lsp-only"
	AutoImportNone          AutoImportLevel = "none"
)

var importContextLanguages = map[string]struct{}{
	"go": {}, "javascript": {}, "typescript": {}, "javascriptreact": {}, "typescriptreact": {},
	"vue": {}, "svelte": {}, "astro": {}, "css": {}, "scss": {}, "sass": {}, "less": {},
	"python": {}, "php": {}, "rust": {}, "ruby": {}, "java": {}, "kotlin": {}, "groovy": {},
	"scala": {}, "dart": {}, "swift": {}, "csharp": {}, "fsharp": {},
}

var dependencyImportLanguages = map[string]struct{}{
	"go": {}, "javascript": {}, "typescript": {}, "javascriptreact": {}, "typescriptreact": {},
	"vue": {}, "svelte": {}, "astro": {}, "css": {}, "scss": {}, "sass": {}, "less": {},
	"python": {}, "php": {}, "rust": {}, "ruby": {}, "java": {}, "kotlin": {}, "groovy": {},
	"scala": {}, "dart": {}, "swift": {}, "csharp": {}, "fsharp": {}, "terraform": {},
}

var nativeAutoImportLanguages = map[string]struct{}{
	"go": {}, "php": {}, "javascript": {}, "typescript": {}, "javascriptreact": {},
	"typescriptreact": {}, "python": {}, "rust": {}, "ruby": {}, "vue": {}, "svelte": {},
	"astro": {}, "solidity": {},
}

var partialNativeAutoImportLanguages = map[string]struct{}{
	"c": {}, "cpp": {}, "java": {}, "kotlin": {}, "scala": {}, "dart": {}, "csharp": {}, "swift": {},
}

var importEditNormalizationLanguages = map[string]struct{}{
	"go": {}, "php": {}, "javascript": {}, "typescript": {}, "javascriptreact": {}, "typescriptreact": {},
	"vue": {}, "svelte": {}, "astro": {}, "solidity": {},
	"python": {}, "rust": {}, "scala": {}, "dart": {}, "julia": {}, "haskell": {}, "clojure": {},
	"erlang": {}, "fortran": {}, "ada": {}, "matlab": {}, "latex": {}, "perl": {}, "delphi": {},
	"pascal": {},
}

var lspAutoImportEditLanguages = map[string]struct{}{
	"go": {}, "javascript": {}, "typescript": {}, "javascriptreact": {}, "typescriptreact": {},
	"vue": {}, "svelte": {}, "astro": {}, "python": {}, "php": {}, "rust": {}, "ruby": {},
	"java": {}, "kotlin": {}, "groovy": {}, "scala": {}, "dart": {}, "swift": {},
	"csharp": {}, "fsharp": {}, "c": {}, "cpp": {}, "objectivec": {}, "solidity": {},
}

func SupportsImportContext(language string) bool {
	_, ok := importContextLanguages[Normalize(language)]
	return ok
}

func SupportsDependencyImports(language string) bool {
	_, ok := dependencyImportLanguages[Normalize(language)]
	return ok
}

func SupportsNativeAutoImport(language string) bool {
	level := AutoImportLevelFor(language, false)
	return level == AutoImportNative || level == AutoImportPartialNative
}

func SupportsLSPAutoImportEdits(language string, lspDeclared bool) bool {
	if !lspDeclared {
		return false
	}
	_, ok := lspAutoImportEditLanguages[Normalize(language)]
	return ok
}

func SupportsImportEditNormalization(language string) bool {
	_, ok := importEditNormalizationLanguages[Normalize(language)]
	return ok
}

func AutoImportLevelFor(language string, lspDeclared bool) AutoImportLevel {
	language = Normalize(language)
	if _, ok := nativeAutoImportLanguages[language]; ok {
		return AutoImportNative
	}
	if _, ok := partialNativeAutoImportLanguages[language]; ok {
		return AutoImportPartialNative
	}
	if SupportsLSPAutoImportEdits(language, lspDeclared) {
		return AutoImportLSPOnly
	}
	return AutoImportNone
}

func NativeLanguages() []string {
	return keys(nativeAutoImportLanguages)
}

func PartialNativeLanguages() []string {
	return keys(partialNativeAutoImportLanguages)
}

func ImportEditNormalizationLanguages() []string {
	return keys(importEditNormalizationLanguages)
}

func Normalize(language string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	switch language {
	case "php-laravel":
		return "php"
	case "tsx":
		return "typescriptreact"
	case "jsx":
		return "javascriptreact"
	default:
		return language
	}
}

func keys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for key := range values {
		result = append(result, key)
	}
	return result
}
