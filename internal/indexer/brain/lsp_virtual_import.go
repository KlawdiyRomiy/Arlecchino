package brain

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
)

type virtualAccessImportPlan struct {
	owner          string
	library        string
	filePath       string
	content        string
	importEdit     core.TextEdit
	virtualLine    int
	lineDelta      int
	originalLine   int
	originalColumn int
}

type accessImportIdentity struct {
	owner      string
	library    string
	symbol     core.Symbol
	descriptor *ImportDescriptor
	producer   string
}

func shouldUseVirtualAccessImportLSP(ctx CompletionContext, result lsp.CompletionResponse) bool {
	if !isAccessCompletionRequest(ctx) || ctx.InImport || strings.TrimSpace(ctx.ResolvedNamespace) != "" {
		return false
	}
	if len(result.Items) == 0 {
		return true
	}
	if lspCompletionAccessMemberProofKind(ctx, result) == "lsp-fallback-member" {
		return true
	}
	for _, item := range result.Items {
		if !item.FallbackOnly {
			return false
		}
	}
	return true
}

func shouldAttachGeneratedAccessImportEdit(ctx CompletionContext, result lsp.CompletionResponse) bool {
	if !isAccessCompletionRequest(ctx) || ctx.InImport || strings.TrimSpace(ctx.ResolvedNamespace) != "" {
		return false
	}
	if len(result.Items) == 0 || lspCompletionAccessMemberProofKind(ctx, result) != "lsp-member" {
		return false
	}
	for _, item := range result.Items {
		if item.FallbackOnly {
			continue
		}
		if len(item.AdditionalTextEdits) == 0 {
			return true
		}
	}
	return false
}

func (b *PredictionBrain) attachGeneratedAccessImportEdit(completionCtx CompletionContext, lspLanguage string, result lsp.CompletionResponse) (lsp.CompletionResponse, bool) {
	if !shouldAttachGeneratedAccessImportEdit(completionCtx, result) {
		return result, false
	}
	plan, ok := b.virtualAccessImportPlan(completionCtx, lspLanguage)
	if !ok {
		plan, ok = b.lspEvidenceAccessImportPlan(completionCtx, lspLanguage, result.Items)
		if !ok {
			return result, false
		}
	}
	items, changed := generatedAccessImportCompletionItems(result.Items, plan.importEdit, plan.owner, plan.library)
	if !changed {
		return result, false
	}
	result.Items = items
	return result, true
}

func (b *PredictionBrain) completeWithVirtualAccessImportLSP(ctx context.Context, completionCtx CompletionContext, lspLanguage string) (lsp.CompletionResponse, bool) {
	if b == nil || b.lspManager == nil {
		return lsp.CompletionResponse{}, false
	}
	plan, ok := b.virtualAccessImportPlan(completionCtx, lspLanguage)
	if !ok {
		return lsp.CompletionResponse{}, false
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx = lsp.WithColdStartAllowed(ctx, false)

	opened, err := b.lspManager.DidOpenTransientWithContext(ctx, lspLanguage, plan.filePath, plan.content)
	if err != nil {
		debugLogf("[LSP] virtual import open failed lang=%s owner=%s library=%s: %v", lspLanguage, plan.owner, plan.library, err)
		return lsp.CompletionResponse{}, false
	}
	if !opened {
		return lsp.CompletionResponse{}, false
	}
	defer func() {
		if err := b.lspManager.DidCloseTransient(lspLanguage, plan.filePath); err != nil {
			debugLogf("[LSP] virtual import close failed lang=%s owner=%s file=%s: %v", lspLanguage, plan.owner, filepath.Base(plan.filePath), err)
		}
	}()

	result, err := b.lspManager.CompleteWithTriggerResult(
		ctx,
		lspLanguage,
		plan.filePath,
		plan.virtualLine,
		plan.originalColumn,
		lspCompletionTrigger(completionCtx),
	)
	if err != nil {
		debugLogf("[LSP] virtual import completion failed lang=%s owner=%s library=%s: %v", lspLanguage, plan.owner, plan.library, err)
		return lsp.CompletionResponse{}, false
	}
	if len(result.Items) == 0 {
		return lsp.CompletionResponse{}, false
	}

	result.Items = virtualAccessImportCompletionItems(result.Items, plan.importEdit, plan.virtualLine, plan.lineDelta)
	result.UsedInvokedFallback = false
	result.InvokedFallbackReason = ""
	result.InvokedFallbackRejected = false
	result.InvokedFallbackRejectedReason = ""
	return result, true
}

func (b *PredictionBrain) virtualAccessImportPlan(ctx CompletionContext, lspLanguage string) (*virtualAccessImportPlan, bool) {
	if b == nil || b.autoImporter == nil {
		return nil, false
	}
	if !isAccessCompletionRequest(ctx) || ctx.InImport || strings.TrimSpace(ctx.ResolvedNamespace) != "" {
		return nil, false
	}
	contentBytes := importEditContent(ctx)
	if len(contentBytes) == 0 {
		return nil, false
	}

	owner := strings.TrimSpace(extractPackageReference(ctx.AccessChain))
	if owner == "" {
		return nil, false
	}
	resolution := completionLanguageResolution(ctx)
	catalogLanguage := strings.TrimSpace(resolution.CanonicalID)
	if catalogLanguage == "" {
		catalogLanguage = strings.TrimSpace(ctx.Language)
	}
	identity, ok := b.resolveAccessImportIdentity(ctx, catalogLanguage, owner)
	if !ok {
		return nil, false
	}

	importCtx := withResolvedLanguage(ctx)
	if catalogLanguage != "" {
		importCtx.Language = catalogLanguage
	}
	importEdit := b.autoImporter.GenerateImportEditWithDescriptor(&identity.symbol, importCtx, identity.descriptor)
	if importEdit == nil {
		return nil, false
	}

	content := string(contentBytes)
	virtualContent, ok := applyCoreTextEditToContent(content, *importEdit)
	if !ok || virtualContent == content {
		return nil, false
	}

	lineDelta := coreTextEditLineDelta(*importEdit)
	virtualLine := ctx.Line
	if importEdit.StartLine <= ctx.Line {
		virtualLine += lineDelta
	}
	if virtualLine < 1 {
		virtualLine = 1
	}

	return &virtualAccessImportPlan{
		owner:          identity.owner,
		library:        identity.library,
		filePath:       virtualAccessImportFilePath(ctx.FilePath, lspLanguage, identity.owner, identity.library, virtualContent),
		content:        virtualContent,
		importEdit:     *importEdit,
		virtualLine:    virtualLine,
		lineDelta:      lineDelta,
		originalLine:   ctx.Line,
		originalColumn: ctx.Column,
	}, true
}

func (b *PredictionBrain) lspEvidenceAccessImportPlan(ctx CompletionContext, lspLanguage string, items []lsp.CompletionItem) (*virtualAccessImportPlan, bool) {
	if b == nil || b.autoImporter == nil {
		return nil, false
	}
	if !isAccessCompletionRequest(ctx) || ctx.InImport || strings.TrimSpace(ctx.ResolvedNamespace) != "" {
		return nil, false
	}
	owner := strings.TrimSpace(extractPackageReference(ctx.AccessChain))
	if owner == "" {
		return nil, false
	}
	catalogLanguage := strings.TrimSpace(completionLanguageResolution(ctx).CanonicalID)
	if catalogLanguage == "" {
		catalogLanguage = strings.TrimSpace(lspLanguage)
	}
	if catalogLanguage == "" {
		catalogLanguage = strings.TrimSpace(ctx.Language)
	}
	if b.accessImportOwnerAmbiguous(ctx, catalogLanguage, owner) {
		return nil, false
	}
	library, ok := uniqueLSPImportEvidenceLibrary(items, owner, lspLanguage)
	if !ok {
		return nil, false
	}
	importCtx := withResolvedLanguage(ctx)
	if lspLanguage != "" {
		importCtx.Language = lspLanguage
	}
	symbolKind := core.SymbolKindPackage
	if normalizeDependencyLanguage(lspLanguage) == "node" {
		symbolKind = core.SymbolKindModule
	}
	importEdit := b.autoImporter.GenerateImportEditWithDescriptor(&core.Symbol{
		Name:      owner,
		Kind:      symbolKind,
		Language:  importCtx.Language,
		Namespace: library,
	}, importCtx, &ImportDescriptor{
		Path:   library,
		Symbol: owner,
		Mode:   dependencyImportDescriptorMode(lspLanguage, symbolKind),
	})
	if importEdit == nil {
		return nil, false
	}
	return &virtualAccessImportPlan{
		owner:      owner,
		library:    library,
		importEdit: *importEdit,
	}, true
}

func (b *PredictionBrain) accessImportOwnerAmbiguous(ctx CompletionContext, catalogLanguage, owner string) bool {
	if b == nil {
		return false
	}
	if b.importCompletions != nil && b.importCompletions.catalog != nil {
		if b.importCompletions.catalog.OwnerResolutionAmbiguous(catalogLanguage, owner) {
			return true
		}
	}
	return b.projectAccessImportOwnerAmbiguous(ctx, catalogLanguage, owner)
}

func (b *PredictionBrain) resolveAccessImportIdentity(ctx CompletionContext, catalogLanguage, owner string) (*accessImportIdentity, bool) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil, false
	}
	if b != nil && b.importCompletions != nil && b.importCompletions.catalog != nil {
		if library := b.importCompletions.catalog.ResolveLibraryByOwner(catalogLanguage, owner); library != "" {
			symbolKind := core.SymbolKindPackage
			if normalizeDependencyLanguage(catalogLanguage) == "node" {
				symbolKind = core.SymbolKindModule
			}
			return &accessImportIdentity{
				owner:    owner,
				library:  library,
				producer: "dependency-importable",
				symbol: core.Symbol{
					Name:      owner,
					Kind:      symbolKind,
					Language:  catalogLanguage,
					Namespace: library,
				},
				descriptor: &ImportDescriptor{
					Path:   library,
					Symbol: owner,
					Mode:   dependencyImportDescriptorMode(catalogLanguage, symbolKind),
				},
			}, true
		}
	}
	return b.resolveProjectAccessImportIdentity(ctx, catalogLanguage, owner)
}

func dependencyImportDescriptorMode(language string, kind core.SymbolKind) string {
	switch normalizeDependencyLanguage(language) {
	case "node":
		if kind == core.SymbolKindModule || kind == core.SymbolKindPackage {
			return "default"
		}
	case "go", "python", "rust":
		return "module"
	case "ruby":
		return "require"
	}
	return ""
}

func (b *PredictionBrain) resolveProjectAccessImportIdentity(ctx CompletionContext, catalogLanguage, owner string) (*accessImportIdentity, bool) {
	if b == nil || b.engine == nil {
		return nil, false
	}
	indexLanguage := strings.TrimSpace(completionLanguageResolution(ctx).IndexID)
	if indexLanguage == "" {
		indexLanguage = strings.TrimSpace(catalogLanguage)
	}
	if indexLanguage == "" {
		indexLanguage = strings.TrimSpace(ctx.Language)
	}
	if indexLanguage == "" {
		return nil, false
	}

	symbols, err := b.engine.Query(core.SymbolQuery{
		Name:           owner,
		Language:       indexLanguage,
		Limit:          100,
		IncludePending: true,
	})
	if err != nil || len(symbols) == 0 {
		return nil, false
	}

	var selected *accessImportIdentity
	selectedKey := ""
	for _, sym := range symbols {
		if !projectSymbolMatchesAccessOwner(sym, owner) {
			continue
		}
		identity, ok := b.projectSymbolAccessImportIdentity(ctx, catalogLanguage, owner, sym)
		if !ok {
			continue
		}
		key := accessImportIdentityKey(identity)
		if key == "" {
			continue
		}
		if selected == nil {
			selected = identity
			selectedKey = key
			continue
		}
		if selectedKey != key {
			return nil, false
		}
	}
	if selected == nil {
		return nil, false
	}
	return selected, true
}

func (b *PredictionBrain) projectAccessImportOwnerAmbiguous(ctx CompletionContext, catalogLanguage, owner string) bool {
	if b == nil || b.engine == nil {
		return false
	}
	indexLanguage := strings.TrimSpace(completionLanguageResolution(ctx).IndexID)
	if indexLanguage == "" {
		indexLanguage = strings.TrimSpace(catalogLanguage)
	}
	if indexLanguage == "" {
		indexLanguage = strings.TrimSpace(ctx.Language)
	}
	if indexLanguage == "" {
		return false
	}

	symbols, err := b.engine.Query(core.SymbolQuery{
		Name:           owner,
		Language:       indexLanguage,
		Limit:          100,
		IncludePending: true,
	})
	if err != nil || len(symbols) == 0 {
		return false
	}

	selectedKey := ""
	for _, sym := range symbols {
		if !projectSymbolMatchesAccessOwner(sym, owner) {
			continue
		}
		identity, ok := b.projectSymbolAccessImportIdentity(ctx, catalogLanguage, owner, sym)
		if !ok {
			continue
		}
		key := accessImportIdentityKey(identity)
		if key == "" {
			continue
		}
		if selectedKey == "" {
			selectedKey = key
			continue
		}
		if selectedKey != key {
			return true
		}
	}
	return false
}

func projectSymbolMatchesAccessOwner(sym core.Symbol, owner string) bool {
	ownerLower := strings.ToLower(strings.Trim(strings.TrimSpace(owner), "\\"))
	if ownerLower == "" {
		return false
	}
	for _, candidate := range []string{sym.Name, filepath.Base(sym.Namespace), dependencyEntryBaseName(sym.Namespace)} {
		candidate = strings.ToLower(strings.Trim(strings.TrimSpace(candidate), "\\"))
		if candidate == ownerLower {
			return true
		}
	}
	if strings.Contains(sym.Namespace, "\\") {
		parts := strings.Split(sym.Namespace, "\\")
		if len(parts) > 0 && strings.ToLower(strings.TrimSpace(parts[len(parts)-1])) == ownerLower {
			return true
		}
	}
	return false
}

func (b *PredictionBrain) projectSymbolAccessImportIdentity(ctx CompletionContext, language, owner string, sym core.Symbol) (*accessImportIdentity, bool) {
	if sameFilePath(sym.FilePath, ctx.FilePath) {
		return nil, false
	}
	normalized := normalizeImportLanguage(language)
	if normalized == "" {
		normalized = normalizeImportLanguage(ctx.Language)
	}
	if descriptor := importDescriptorFromSymbolExtra(sym); descriptor != nil {
		return projectImportIdentityFromDescriptor(language, owner, sym, descriptor)
	}
	switch normalized {
	case "go":
		if sym.Kind != core.SymbolKindPackage && sym.Kind != core.SymbolKindModule {
			return nil, false
		}
		path := strings.TrimSpace(sym.Namespace)
		if path == "" || !goInternalImportVisible(ctx.FilePath, sym.FilePath, path) {
			return nil, false
		}
		return &accessImportIdentity{
			owner:    owner,
			library:  path,
			producer: "project-importable",
			symbol: core.Symbol{
				Name:      owner,
				Kind:      core.SymbolKindPackage,
				Language:  language,
				Namespace: path,
				FilePath:  sym.FilePath,
			},
			descriptor: &ImportDescriptor{Path: path, Symbol: owner, Mode: "module"},
		}, true
	case "php", "php-laravel":
		full := phpProjectImportPath(sym)
		if full == "" {
			return nil, false
		}
		return &accessImportIdentity{
			owner:    owner,
			library:  full,
			producer: "project-importable",
			symbol: core.Symbol{
				Name:      owner,
				Kind:      sym.Kind,
				Language:  language,
				Namespace: full,
				FilePath:  sym.FilePath,
			},
			descriptor: &ImportDescriptor{Statement: "use " + full + ";", Path: full, Symbol: owner},
		}, true
	case "python":
		path := strings.TrimSpace(sym.Namespace)
		if path == "" {
			return nil, false
		}
		mode := ""
		if sym.Kind == core.SymbolKindPackage || sym.Kind == core.SymbolKindModule || strings.EqualFold(dependencyEntryBaseName(path), owner) {
			mode = "module"
		}
		return projectImportIdentityFromDescriptor(language, owner, sym, &ImportDescriptor{Path: path, Symbol: sym.Name, Mode: mode})
	case "rust":
		path := strings.TrimSpace(sym.Namespace)
		if path == "" {
			return nil, false
		}
		mode := ""
		if sym.Kind == core.SymbolKindPackage || sym.Kind == core.SymbolKindModule || strings.HasSuffix(path, "::"+owner) {
			mode = "module"
		}
		return projectImportIdentityFromDescriptor(language, owner, sym, &ImportDescriptor{Path: path, Symbol: sym.Name, Mode: mode})
	case "ruby":
		path := strings.TrimSpace(sym.Namespace)
		if path == "" {
			return nil, false
		}
		return projectImportIdentityFromDescriptor(language, owner, sym, &ImportDescriptor{Path: path, Symbol: owner, Mode: "require"})
	case "java", "kotlin", "groovy", "scala":
		path := dottedProjectSymbolImportPath(sym)
		if path == "" {
			return nil, false
		}
		return projectImportIdentityFromDescriptor(language, owner, sym, &ImportDescriptor{Path: path, Symbol: sym.Name})
	case "csharp":
		path := strings.TrimSpace(sym.Namespace)
		if path == "" {
			return nil, false
		}
		return projectImportIdentityFromDescriptor(language, owner, sym, &ImportDescriptor{Path: path, Symbol: sym.Name})
	case "swift", "dart":
		path := strings.TrimSpace(sym.Namespace)
		if path == "" {
			return nil, false
		}
		return projectImportIdentityFromDescriptor(language, owner, sym, &ImportDescriptor{Path: path, Symbol: sym.Name})
	}
	return nil, false
}

func projectImportIdentityFromDescriptor(language, owner string, sym core.Symbol, descriptor *ImportDescriptor) (*accessImportIdentity, bool) {
	if descriptor == nil || descriptor.Empty() {
		return nil, false
	}
	ai := NewAutoImporter()
	checkSymbol := core.Symbol{Name: owner, Kind: sym.Kind, Language: language, Namespace: strings.TrimSpace(descriptor.Path), FilePath: sym.FilePath}
	if !ai.ShouldAutoImportWithDescriptor(&checkSymbol, CompletionContext{Language: language}, descriptor) {
		return nil, false
	}
	return &accessImportIdentity{
		owner:      owner,
		library:    accessImportDescriptorLibrary(descriptor),
		producer:   "project-importable",
		symbol:     checkSymbol,
		descriptor: cloneImportDescriptor(descriptor),
	}, true
}

func importDescriptorFromSymbolExtra(sym core.Symbol) *ImportDescriptor {
	if len(sym.Extra) == 0 {
		return nil
	}
	descriptor := &ImportDescriptor{
		Path:      firstSymbolExtra(sym.Extra, "importPath", "import_path", "modulePath", "module_path", "path"),
		Statement: firstSymbolExtra(sym.Extra, "importStatement", "import_statement", "statement"),
		Symbol:    firstSymbolExtra(sym.Extra, "importSymbol", "import_symbol", "exportName", "export_name", "symbol"),
		Mode:      firstSymbolExtra(sym.Extra, "importMode", "import_mode", "mode"),
	}
	if descriptor.Empty() {
		return nil
	}
	return descriptor
}

func firstSymbolExtra(extra map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(extra[key]); value != "" {
			return value
		}
	}
	return ""
}

func accessImportDescriptorLibrary(descriptor *ImportDescriptor) string {
	if descriptor == nil {
		return ""
	}
	if path := strings.TrimSpace(descriptor.Path); path != "" {
		return path
	}
	statement := strings.TrimSpace(descriptor.Statement)
	if statement == "" {
		return ""
	}
	return statement
}

func accessImportIdentityKey(identity *accessImportIdentity) string {
	if identity == nil {
		return ""
	}
	return strings.Join([]string{
		strings.TrimSpace(identity.producer),
		strings.TrimSpace(identity.library),
		importDescriptorIdentity(identity.descriptor),
		strings.TrimSpace(identity.symbol.Namespace),
		string(identity.symbol.Kind),
	}, "\x00")
}

func sameFilePath(left, right string) bool {
	if left == "" || right == "" {
		return false
	}
	leftClean, leftErr := filepath.Abs(left)
	rightClean, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return filepath.Clean(left) == filepath.Clean(right)
	}
	return filepath.Clean(leftClean) == filepath.Clean(rightClean)
}

func goInternalImportVisible(currentFilePath, packageFilePath, importPath string) bool {
	importPath = strings.TrimSpace(importPath)
	if !strings.Contains(importPath, "/internal/") && !strings.HasPrefix(importPath, "internal/") {
		return true
	}
	if currentFilePath == "" || packageFilePath == "" {
		return false
	}
	packageDir := filepath.Dir(packageFilePath)
	currentDir := filepath.Dir(currentFilePath)
	internalIndex := strings.Index(filepath.ToSlash(packageDir), "/internal/")
	if internalIndex < 0 {
		if strings.HasSuffix(filepath.ToSlash(packageDir), "/internal") {
			internalIndex = len(filepath.ToSlash(packageDir)) - len("/internal")
		} else {
			return false
		}
	}
	parentSlash := filepath.ToSlash(packageDir)[:internalIndex]
	if parentSlash == "" {
		return false
	}
	parent := filepath.FromSlash(parentSlash)
	rel, err := filepath.Rel(parent, currentDir)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func phpProjectImportPath(sym core.Symbol) string {
	namespace := strings.Trim(strings.TrimSpace(sym.Namespace), "\\")
	name := strings.Trim(strings.TrimSpace(sym.Name), "\\")
	if namespace == "" {
		return ""
	}
	if name == "" || strings.HasSuffix(strings.ToLower(namespace), "\\"+strings.ToLower(name)) {
		return namespace
	}
	return namespace + "\\" + name
}

func dottedProjectSymbolImportPath(sym core.Symbol) string {
	namespace := strings.TrimSpace(sym.Namespace)
	name := strings.TrimSpace(sym.Name)
	if namespace == "" {
		return ""
	}
	if name == "" || strings.HasSuffix(strings.ToLower(namespace), "."+strings.ToLower(name)) {
		return namespace
	}
	return namespace + "." + name
}

func virtualAccessImportCompletionItems(items []lsp.CompletionItem, importEdit core.TextEdit, virtualLine, lineDelta int) []lsp.CompletionItem {
	if len(items) == 0 {
		return nil
	}
	result := make([]lsp.CompletionItem, len(items))
	importTextEdit := coreTextEditToLSP(importEdit)
	for i, item := range items {
		item.TextEdit = mapVirtualCompletionTextEdit(item.TextEdit, virtualLine, lineDelta)
		item.AdditionalTextEdits = []lsp.TextEdit{importTextEdit}
		item.Command = nil
		item.Data = nil
		item.FallbackOnly = false
		result[i] = item
	}
	return result
}

func generatedAccessImportCompletionItems(items []lsp.CompletionItem, importEdit core.TextEdit, owner, library string) ([]lsp.CompletionItem, bool) {
	if len(items) == 0 {
		return nil, false
	}
	result := make([]lsp.CompletionItem, len(items))
	importTextEdit := coreTextEditToLSP(importEdit)
	changed := false
	listHasImportEvidence := false
	for _, item := range items {
		if item.FallbackOnly {
			continue
		}
		if len(item.AdditionalTextEdits) > 0 || lspItemHasImportOwnerEvidence(item, owner, library) {
			listHasImportEvidence = true
			break
		}
	}
	for i, item := range items {
		if !item.FallbackOnly && len(item.AdditionalTextEdits) == 0 && listHasImportEvidence {
			item.AdditionalTextEdits = []lsp.TextEdit{importTextEdit}
			changed = true
		}
		result[i] = item
	}
	return result, changed
}

func uniqueLSPImportEvidenceLibrary(items []lsp.CompletionItem, owner, language string) (string, bool) {
	matches := make(map[string]struct{})
	for _, item := range items {
		if item.FallbackOnly {
			continue
		}
		for _, text := range lspItemImportEvidenceText(item) {
			for _, library := range importEvidenceLibraries(text) {
				if importEvidenceLibraryMatchesOwner(language, owner, library) {
					matches[library] = struct{}{}
				}
			}
		}
	}
	if len(matches) != 1 {
		return "", false
	}
	for library := range matches {
		return library, true
	}
	return "", false
}

func importEvidenceLibraries(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	var libraries []string
	for _, pattern := range []string{`from "`, `from '`, `import("`, `import('`, `module "`, `module '`} {
		quote := pattern[len(pattern)-1]
		offset := 0
		lowerText := strings.ToLower(text)
		lowerPattern := strings.ToLower(pattern)
		for {
			index := strings.Index(lowerText[offset:], lowerPattern)
			if index < 0 {
				break
			}
			start := offset + index + len(pattern)
			end := strings.IndexByte(text[start:], quote)
			if end < 0 {
				break
			}
			library := strings.TrimSpace(text[start : start+end])
			if library != "" && safeDescriptorScalar(library) {
				libraries = append(libraries, library)
			}
			offset = start + end + 1
		}
	}
	return dedupeStringSlice(libraries)
}

func importEvidenceLibraryMatchesOwner(language, owner, library string) bool {
	owner = strings.ToLower(strings.Trim(strings.TrimSpace(owner), "\\"))
	library = strings.TrimSpace(library)
	if owner == "" || library == "" {
		return false
	}
	candidates := []string{
		strings.ToLower(library),
		strings.ToLower(filepath.Base(library)),
		dependencyEntryBaseName(library),
	}
	if normalizeDependencyLanguage(language) == "node" {
		candidates = append(candidates, strings.ToLower(jsModuleIdentifier(library)))
	}
	if strings.Contains(library, "\\") {
		parts := strings.Split(library, "\\")
		candidates = append(candidates, strings.ToLower(strings.TrimSpace(parts[len(parts)-1])))
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == owner {
			return true
		}
	}
	return false
}

func dedupeStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func lspItemHasImportOwnerEvidence(item lsp.CompletionItem, owner, library string) bool {
	for _, text := range lspItemImportEvidenceText(item) {
		if importEvidenceTextMatchesLibrary(text, owner, library) {
			return true
		}
	}
	return false
}

func lspItemImportEvidenceText(item lsp.CompletionItem) []string {
	texts := []string{item.Detail}
	if item.LabelDetails != nil {
		texts = append(texts, item.LabelDetails.Detail, item.LabelDetails.Description)
	}
	return texts
}

func importEvidenceTextMatchesLibrary(text, owner, library string) bool {
	text = strings.ToLower(strings.TrimSpace(text))
	if text == "" {
		return false
	}
	for _, candidate := range importEvidenceCandidates(owner, library) {
		if candidate == "" {
			continue
		}
		if strings.Contains(text, `from "`+candidate+`"`) ||
			strings.Contains(text, `from '`+candidate+`'`) ||
			strings.Contains(text, `import("`+candidate+`")`) ||
			strings.Contains(text, `import('`+candidate+`')`) ||
			strings.Contains(text, `module "`+candidate+`"`) ||
			strings.Contains(text, `module '`+candidate+`'`) ||
			containsUnquotedImportEvidence(text, "from ", candidate) {
			return true
		}
	}
	return false
}

func importEvidenceCandidates(owner, library string) []string {
	raw := []string{owner, library}
	if base := strings.TrimSpace(filepath.Base(library)); base != "." && base != string(filepath.Separator) {
		raw = append(raw, base)
	}
	seen := map[string]struct{}{}
	candidates := make([]string, 0, len(raw))
	for _, value := range raw {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		candidates = append(candidates, value)
	}
	return candidates
}

func containsUnquotedImportEvidence(text, prefix, candidate string) bool {
	search := prefix + candidate
	offset := 0
	for {
		index := strings.Index(text[offset:], search)
		if index < 0 {
			return false
		}
		start := offset + index
		end := start + len(search)
		if importEvidenceBoundary(text, start-1) && importEvidenceBoundary(text, end) {
			return true
		}
		offset = end
	}
}

func importEvidenceBoundary(text string, index int) bool {
	if index < 0 || index >= len(text) {
		return true
	}
	ch := text[index]
	return !(ch == '_' || ch == '-' || ch == '.' || ch == '/' || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'))
}

func mapVirtualCompletionTextEdit(raw json.RawMessage, virtualLine, lineDelta int) json.RawMessage {
	if len(raw) == 0 || lineDelta == 0 || virtualLine <= 0 {
		return raw
	}

	var payload struct {
		Range   *lsp.Range `json:"range,omitempty"`
		Insert  *lsp.Range `json:"insert,omitempty"`
		Replace *lsp.Range `json:"replace,omitempty"`
		NewText string     `json:"newText,omitempty"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return raw
	}
	if payload.Range == nil && payload.Insert == nil && payload.Replace == nil {
		return raw
	}

	anchorLine := virtualLine - 1
	if payload.Range != nil {
		mapped := mapVirtualRangeToOriginal(*payload.Range, anchorLine, lineDelta)
		payload.Range = &mapped
	}
	if payload.Insert != nil {
		mapped := mapVirtualRangeToOriginal(*payload.Insert, anchorLine, lineDelta)
		payload.Insert = &mapped
	}
	if payload.Replace != nil {
		mapped := mapVirtualRangeToOriginal(*payload.Replace, anchorLine, lineDelta)
		payload.Replace = &mapped
	}

	mapped, err := json.Marshal(payload)
	if err != nil {
		return raw
	}
	return mapped
}

func mapVirtualRangeToOriginal(r lsp.Range, anchorLine, lineDelta int) lsp.Range {
	r.Start.Line = mapVirtualLineToOriginal(r.Start.Line, anchorLine, lineDelta)
	r.End.Line = mapVirtualLineToOriginal(r.End.Line, anchorLine, lineDelta)
	return r
}

func mapVirtualLineToOriginal(line, anchorLine, lineDelta int) int {
	if lineDelta == 0 || line < anchorLine {
		return line
	}
	line -= lineDelta
	if line < 0 {
		return 0
	}
	return line
}

func coreTextEditToLSP(edit core.TextEdit) lsp.TextEdit {
	return lsp.TextEdit{
		Range: lsp.Range{
			Start: lsp.Position{Line: maxInt(edit.StartLine-1, 0), Character: maxInt(edit.StartColumn-1, 0)},
			End:   lsp.Position{Line: maxInt(edit.EndLine-1, 0), Character: maxInt(edit.EndColumn-1, 0)},
		},
		NewText: edit.Text,
	}
}

func applyCoreTextEditToContent(content string, edit core.TextEdit) (string, bool) {
	start, ok := textOffsetForLineColumn(content, edit.StartLine, edit.StartColumn)
	if !ok {
		return "", false
	}
	end, ok := textOffsetForLineColumn(content, edit.EndLine, edit.EndColumn)
	if !ok || end < start {
		return "", false
	}
	return content[:start] + edit.Text + content[end:], true
}

func textOffsetForLineColumn(content string, targetLine, targetColumn int) (int, bool) {
	if targetLine < 1 || targetColumn < 1 {
		return 0, false
	}
	line := 1
	column := 1
	for offset, r := range content {
		if line == targetLine && column == targetColumn {
			return offset, true
		}
		if r == '\n' {
			line++
			column = 1
			continue
		}
		column++
	}
	if line == targetLine && column == targetColumn {
		return len(content), true
	}
	return 0, false
}

func coreTextEditLineDelta(edit core.TextEdit) int {
	replacedLines := edit.EndLine - edit.StartLine
	if replacedLines < 0 {
		replacedLines = 0
	}
	return strings.Count(edit.Text, "\n") - replacedLines
}

func virtualAccessImportFilePath(filePath, lspLanguage, owner, library, content string) string {
	dir := filepath.Dir(filePath)
	if filePath == "" || dir == "." {
		dir = os.TempDir()
	}
	ext := filepath.Ext(filePath)
	base := strings.TrimSuffix(filepath.Base(filePath), ext)
	if base == "" || base == "." || base == string(filepath.Separator) {
		base = "completion"
	}
	if ext == "" {
		ext = ".tmp"
	}

	sum := md5.Sum([]byte(lspLanguage + "\x00" + owner + "\x00" + library + "\x00" + content))
	token := hex.EncodeToString(sum[:])[:10]
	return filepath.Join(dir, "."+sanitizeVirtualImportPathPart(base)+"-arlecchino-import-"+sanitizeVirtualImportPathPart(owner)+"-"+token+ext)
}

func sanitizeVirtualImportPathPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "completion"
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '_' || r == '-' || r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "completion"
	}
	return b.String()
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
