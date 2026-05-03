package autocomplete

import (
	"path/filepath"
	"sort"
	"strings"

	lspregistry "arlecchino/internal/lsp"
)

type LanguageResolution struct {
	OriginalID   string `json:"originalId"`
	CanonicalID  string `json:"canonicalId"`
	LSPID        string `json:"lspId"`
	IndexID      string `json:"indexId"`
	PredictiveID string `json:"predictiveId"`
	KeywordID    string `json:"keywordId"`
	FillID       string `json:"fillId"`
}

type CapabilityTier string

const (
	TierNative     CapabilityTier = "native"
	TierHybrid     CapabilityTier = "hybrid"
	TierLSPOnly    CapabilityTier = "lsp-only"
	TierSyntaxOnly CapabilityTier = "syntax-only"
	TierUnknown    CapabilityTier = "unknown"
)

type CapabilitySources struct {
	Syntax       bool `json:"syntax"`
	LSPDeclared  bool `json:"lspDeclared"`
	LSPAvailable bool `json:"lspAvailable"`
	Index        bool `json:"index"`
	Local        bool `json:"local"`
	Predictive   bool `json:"predictive"`
	Imports      bool `json:"imports"`
	Stubs        bool `json:"stubs"`
	Keywords     bool `json:"keywords"`
	FillAll      bool `json:"fillAll"`
}

type LanguageCapability struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Extensions    []string          `json:"extensions"`
	CanonicalID   string            `json:"canonicalId"`
	Tier          CapabilityTier    `json:"tier"`
	Sources       CapabilitySources `json:"sources"`
	LSPServerID   string            `json:"lspServerId"`
	LSPInstalled  bool              `json:"lspInstalled"`
	LSPCanInstall bool              `json:"lspCanInstall"`
	LSPInstalling bool              `json:"lspInstalling"`
	Notes         []string          `json:"notes"`
}

type LSPAvailabilityFunc func(language string) bool

func Resolve(originalLanguage, filePath string) LanguageResolution {
	original := normalizeToken(originalLanguage)
	canonical := canonicalLanguageID(original, filePath)
	if original == "" {
		original = canonical
	}
	if original == "" {
		original = "unknown"
	}
	if canonical == "" {
		canonical = original
	}

	return LanguageResolution{
		OriginalID:   original,
		CanonicalID:  canonical,
		LSPID:        lspLanguage(canonical),
		IndexID:      indexLanguage(canonical),
		PredictiveID: predictiveLanguage(canonical),
		KeywordID:    keywordLanguage(canonical),
		FillID:       fillLanguage(canonical),
	}
}

func (r LanguageResolution) LocalID() string {
	return localLanguage(r.CanonicalID)
}

func (r LanguageResolution) StubID() string {
	return stubLanguage(r.CanonicalID)
}

func BuildLanguageCapabilities(lspAvailable LSPAvailabilityFunc) []LanguageCapability {
	languages := lspregistry.GetAllLanguages()
	result := make([]LanguageCapability, 0, len(languages))
	for _, info := range languages {
		if info == nil {
			continue
		}
		result = append(result, CapabilityForLanguage(info.ID, "", lspAvailable))
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].ID < result[j].ID
	})
	return result
}

func CapabilityForLanguage(language, filePath string, lspAvailable LSPAvailabilityFunc) LanguageCapability {
	resolution := Resolve(language, filePath)
	info := lspregistry.GetLanguageByID(resolution.CanonicalID)
	if info == nil && filePath != "" {
		info = lspregistry.GetLanguageByFilename(filepath.Base(filePath))
	}

	id := resolution.OriginalID
	name := resolution.CanonicalID
	var extensions []string
	lspServerID := ""
	if info != nil {
		id = info.ID
		name = info.Name
		extensions = append([]string(nil), info.Extensions...)
		lspServerID = info.LSPServerID
	}

	sources := CapabilitySources{
		Syntax:      info != nil && info.CodeMirrorID != "",
		LSPDeclared: info != nil && info.LSPServerID != "",
		Index:       supportsIndex(resolution.IndexID),
		Local:       supportsLocal(resolution.LocalID()),
		Predictive:  supportsPredictive(resolution.PredictiveID),
		Imports:     supportsImports(resolution.CanonicalID),
		Stubs:       supportsStubs(resolution.StubID()),
		Keywords:    supportsKeywords(resolution.KeywordID),
		FillAll:     supportsFill(resolution.FillID),
	}
	if sources.LSPDeclared && lspAvailable != nil {
		sources.LSPAvailable = lspAvailable(resolution.LSPID)
	}

	capability := LanguageCapability{
		ID:          id,
		Name:        name,
		Extensions:  extensions,
		CanonicalID: resolution.CanonicalID,
		Tier:        capabilityTier(sources),
		Sources:     sources,
		LSPServerID: lspServerID,
		Notes:       capabilityNotes(resolution, sources),
	}
	return capability
}

func canonicalLanguageID(language, filePath string) string {
	language = normalizeToken(language)
	if language == "php-laravel" {
		return "php"
	}
	if shouldInferFromPath(language) {
		if inferred := inferLanguageFromPath(filePath); inferred != "" {
			return inferred
		}
		if language != "" {
			return language
		}
		return "unknown"
	}
	if info := lspregistry.GetLanguageByID(language); info != nil {
		return info.ID
	}
	for _, candidate := range lspregistry.LanguageCandidates(language) {
		if info := lspregistry.GetLanguageByID(candidate); info != nil {
			return info.ID
		}
	}
	if inferred := inferLanguageFromPath(filePath); inferred != "" {
		return inferred
	}
	return language
}

func inferLanguageFromPath(filePath string) string {
	if strings.TrimSpace(filePath) == "" {
		return ""
	}
	base := filepath.Base(filePath)
	if strings.HasSuffix(strings.ToLower(base), ".blade.php") {
		return "blade"
	}
	if info := lspregistry.GetLanguageByFilename(base); info != nil {
		return info.ID
	}
	if ext := filepath.Ext(base); ext != "" {
		if info := lspregistry.GetLanguageByExtension(ext); info != nil {
			return info.ID
		}
	}
	return ""
}

func shouldInferFromPath(language string) bool {
	switch language {
	case "", "unknown", "plaintext", "plain", "text":
		return true
	default:
		return false
	}
}

func normalizeToken(language string) string {
	return lspregistry.NormalizeLanguageToken(language)
}

func lspLanguage(canonical string) string {
	if canonical == "" || canonical == "unknown" || canonical == "plaintext" {
		return ""
	}
	return canonical
}

func indexLanguage(canonical string) string {
	switch canonical {
	case "typescript", "typescriptreact", "javascript", "javascriptreact":
		return "typescript"
	case "php", "go", "python", "ruby", "vue":
		return canonical
	default:
		return ""
	}
}

func predictiveLanguage(canonical string) string {
	switch canonical {
	case "typescript", "typescriptreact", "astro":
		return "typescript"
	case "php", "go", "python", "ruby", "vue":
		return canonical
	default:
		return ""
	}
}

func keywordLanguage(canonical string) string {
	switch canonical {
	case "typescriptreact":
		return "typescript"
	case "javascriptreact", "vue", "svelte":
		return "javascript"
	case "astro":
		return "typescript"
	case "scss", "sass", "less":
		return "css"
	case "shell", "sh", "zsh", "fish":
		return "bash"
	default:
		return canonical
	}
}

func fillLanguage(canonical string) string {
	switch canonical {
	case "typescriptreact":
		return "typescript"
	case "javascriptreact":
		return "javascript"
	case "astro":
		return "typescript"
	case "php", "go", "python", "typescript", "javascript":
		return canonical
	default:
		return ""
	}
}

func localLanguage(canonical string) string {
	return fillLanguage(canonical)
}

func stubLanguage(canonical string) string {
	switch canonical {
	case "typescriptreact", "astro":
		return "typescript"
	case "javascriptreact", "vue", "svelte":
		return "javascript"
	default:
		return canonical
	}
}

func supportsIndex(language string) bool {
	switch language {
	case "php", "go", "typescript", "python", "ruby", "vue":
		return true
	default:
		return false
	}
}

func supportsLocal(language string) bool {
	switch language {
	case "php", "go", "typescript", "javascript", "python":
		return true
	default:
		return false
	}
}

func supportsPredictive(language string) bool {
	switch language {
	case "php", "go", "typescript", "python", "ruby", "vue":
		return true
	default:
		return false
	}
}

func supportsImports(canonical string) bool {
	switch canonical {
	case "go", "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "css", "scss", "sass", "less",
		"python", "php", "rust", "ruby", "java", "kotlin", "groovy", "scala", "dart", "swift", "csharp", "fsharp", "terraform":
		return true
	default:
		return false
	}
}

func supportsStubs(language string) bool {
	switch language {
	case "javascript", "typescript", "python", "php", "go", "ruby", "rust", "java", "csharp", "swift", "kotlin", "scala", "dart", "cpp", "c":
		return true
	default:
		return false
	}
}

func supportsKeywords(language string) bool {
	switch language {
	case "python", "go", "php", "blade", "astro", "typescript", "javascript", "java", "csharp", "clojure", "rust", "css", "scala", "groovy", "erlang", "bash", "dockerfile", "yaml", "terraform", "makefile", "nginx", "ini", "env", "html", "vue", "svelte":
		return true
	default:
		return false
	}
}

func supportsFill(language string) bool {
	return supportsLocal(language)
}

func capabilityTier(sources CapabilitySources) CapabilityTier {
	deepNativeCount := 0
	for _, enabled := range []bool{sources.Index, sources.Local, sources.Predictive, sources.FillAll} {
		if enabled {
			deepNativeCount++
		}
	}
	switch {
	case deepNativeCount >= 3:
		return TierNative
	case deepNativeCount > 0:
		return TierHybrid
	case sources.LSPAvailable:
		return TierLSPOnly
	case sources.Syntax:
		return TierSyntaxOnly
	default:
		return TierUnknown
	}
}

func capabilityNotes(resolution LanguageResolution, sources CapabilitySources) []string {
	var notes []string
	if sources.LSPDeclared && !sources.LSPAvailable {
		notes = append(notes, "LSP server is declared but not available in the active manager")
	}
	if resolution.CanonicalID == "blade" {
		notes = append(notes, "Blade uses HTML LSP plus Laravel-specific completions when available")
	}
	if capabilityTier(sources) == TierLSPOnly {
		notes = append(notes, "Autocomplete is LSP-first; native semantic sources are limited")
	}
	if capabilityTier(sources) == TierUnknown {
		notes = append(notes, "No language-specific autocomplete sources are configured")
	}
	return notes
}
