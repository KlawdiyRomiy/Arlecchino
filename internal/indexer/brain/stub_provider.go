package brain

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"arlecchino/internal/indexer/core"
)

type StubProvider struct {
	mu              sync.RWMutex
	stubs           map[string]*PackageStub
	aliases         map[string]string
	stubsDir        string
	projectRoot     string
	loaded          bool
	runner          func(name string, args ...string) ([]byte, error)
	packageResolver func(language, reference string) string
}

type PackageStub struct {
	Package       string                `json:"package"`
	Language      string                `json:"language"`
	Version       string                `json:"version,omitempty"`
	Aliases       []string              `json:"aliases,omitempty"`
	Exports       map[string]StubExport `json:"exports"`
	Patterns      []StubPattern         `json:"patterns,omitempty"`
	RuntimeSource core.SymbolSource     `json:"-"`
}

type StubExport struct {
	Signature   string   `json:"signature"`
	Returns     string   `json:"returns,omitempty"`
	Description string   `json:"description,omitempty"`
	Popularity  int      `json:"popularity,omitempty"`
	Scaffold    string   `json:"scaffold,omitempty"`
	Kind        string   `json:"kind,omitempty"`
	Parameters  []string `json:"parameters,omitempty"`
}

type StubPattern struct {
	Trigger     string   `json:"trigger"`
	Suggestions []string `json:"suggestions"`
}

func NewStubProvider() *StubProvider {
	homeDir, _ := os.UserHomeDir()
	stubsDir := filepath.Join(homeDir, ".arlecchino", "stubs")

	provider := &StubProvider{
		stubs:    make(map[string]*PackageStub),
		aliases:  make(map[string]string),
		stubsDir: stubsDir,
	}
	provider.runner = provider.defaultStubCommandRunner
	return provider
}

func (p *StubProvider) defaultStubCommandRunner(name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	p.mu.RLock()
	projectRoot := p.projectRoot
	p.mu.RUnlock()
	if projectRoot != "" {
		cmd.Dir = projectRoot
	}
	return cmd.Output()
}

func (p *StubProvider) SetStubsDir(dir string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stubsDir = dir
	p.loaded = false
}

func (p *StubProvider) SetProjectRoot(root string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.projectRoot = strings.TrimSpace(root)
}

func (p *StubProvider) SetPackageResolver(resolver func(language, reference string) string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.packageResolver = resolver
}

func (p *StubProvider) LoadStubs() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.loaded {
		return nil
	}

	if _, err := os.Stat(p.stubsDir); os.IsNotExist(err) {
		return nil
	}

	entries, err := os.ReadDir(p.stubsDir)
	if err != nil {
		return nil
	}

	languages := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			languages = append(languages, entry.Name())
		}
	}
	sort.Strings(languages)

	for _, lang := range languages {
		langDir := filepath.Join(p.stubsDir, lang)
		if _, err := os.Stat(langDir); os.IsNotExist(err) {
			continue
		}

		files, err := os.ReadDir(langDir)
		if err != nil {
			continue
		}

		for _, f := range files {
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".stub.json") {
				stubPath := filepath.Join(langDir, f.Name())
				stub, err := p.loadStubFile(stubPath)
				if err != nil {
					continue
				}
				p.registerStubLocked(lang, stub.Package, stub)
			}
		}
	}

	p.loaded = true
	return nil
}

func (p *StubProvider) loadStubFile(path string) (*PackageStub, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var stub PackageStub
	if err := json.Unmarshal(data, &stub); err != nil {
		return nil, err
	}

	return &stub, nil
}

func (p *StubProvider) GetCompletions(packageName, prefix, language string) []Suggestion {
	p.mu.RLock()
	key := language + "/" + packageName
	stub, ok := p.stubs[key]
	p.mu.RUnlock()
	if !ok {
		return nil
	}

	return buildStubSuggestions(stub, prefix)
}

func (p *StubProvider) UpsertPackageStub(language, packageName string, stub *PackageStub) {
	if stub == nil {
		return
	}
	p.mu.Lock()
	p.registerStubLocked(language, packageName, stub)
	p.mu.Unlock()
}

func (p *StubProvider) registerStubLocked(language, packageName string, stub *PackageStub) {
	clone := *stub
	clone.Language = language
	clone.Package = packageName
	if clone.RuntimeSource == "" {
		clone.RuntimeSource = core.SourceLibrary
	}
	p.stubs[language+"/"+packageName] = &clone
	for _, ref := range stubReferences(&clone) {
		p.aliases[stubReferenceKey(language, ref)] = packageName
	}
}

func stubReferences(stub *PackageStub) []string {
	if stub == nil {
		return nil
	}
	refs := make([]string, 0, len(stub.Aliases)+2)
	refs = append(refs, stub.Package)
	refs = append(refs, stub.Aliases...)
	if stub.Language == "javascript" || stub.Language == "typescript" {
		if ident := jsModuleIdentifier(stub.Package); ident != "" {
			refs = append(refs, ident)
		}
	}
	seen := make(map[string]struct{}, len(refs))
	unique := refs[:0]
	for _, ref := range refs {
		key := strings.ToLower(strings.TrimSpace(ref))
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, strings.TrimSpace(ref))
	}
	return unique
}

func stubReferenceKey(language, reference string) string {
	return language + "/" + strings.ToLower(strings.TrimSpace(reference))
}

func (p *StubProvider) ResolvePackage(reference, language string) string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for candidate := strings.TrimSpace(reference); candidate != ""; candidate = trimReferenceOwner(candidate) {
		if resolved := p.aliases[stubReferenceKey(language, candidate)]; resolved != "" {
			return resolved
		}
	}
	return ""
}

func (p *StubProvider) resolvePackageFromCatalog(language, reference string) string {
	p.mu.RLock()
	resolver := p.packageResolver
	p.mu.RUnlock()
	if resolver == nil {
		return ""
	}
	return strings.TrimSpace(resolver(language, reference))
}

func (p *StubProvider) RememberPackage(language, reference, packageName string) {
	reference = strings.TrimSpace(reference)
	packageName = strings.TrimSpace(packageName)
	if reference == "" || packageName == "" {
		return
	}

	p.mu.Lock()
	p.aliases[stubReferenceKey(language, reference)] = packageName
	p.mu.Unlock()
}

func trimReferenceOwner(reference string) string {
	ref := strings.TrimSpace(strings.TrimSuffix(reference, "()"))
	if ref == "" {
		return ""
	}
	best := -1
	bestLen := 0
	for _, sep := range []string{"->", "::", "."} {
		if idx := strings.LastIndex(ref, sep); idx > best {
			best = idx
			bestLen = len(sep)
		}
	}
	if best == -1 {
		return ""
	}
	trimmed := strings.TrimSpace(ref[:best])
	if trimmed == "" || len(trimmed) == len(ref)-bestLen {
		return ""
	}
	return strings.TrimSuffix(trimmed, "()")
}

func (p *StubProvider) GetContextCompletions(ctx CompletionContext) []Suggestion {
	reference := extractPackageReference(ctx.AccessChain)
	if reference == "" {
		reference = ctx.ParentClass
	}
	if reference == "" {
		return nil
	}

	resolveContent := ctx.Content
	if len(ctx.FullContent) > 0 {
		resolveContent = ctx.FullContent
	}

	resolvedPackage := p.resolveImportPath(ctx.Language, reference, resolveContent)
	packageName := resolvedPackage
	if packageName == "" {
		if ctx.ResolvedNamespace != "" {
			packageName = ctx.ResolvedNamespace
		}
	}
	if packageName == "" {
		packageName = p.resolvePackageFromCatalog(ctx.Language, reference)
		if packageName != "" {
			ctx.ResolvedNamespace = packageName
			p.RememberPackage(ctx.Language, reference, packageName)
		}
	}
	if packageName == "" {
		packageName = p.ResolvePackage(reference, ctx.Language)
		if packageName == "" {
			packageName = reference
		}
	}

	if ctx.Language == "go" && resolvedPackage == "" && strings.TrimSpace(ctx.Prefix) == "" && !p.HasPackage(packageName, ctx.Language) {
		if ctx.ResolvedNamespace == "" {
			return nil
		}
	}

	if ctx.Language == "go" && p.GetCompletions(packageName, ctx.Prefix, ctx.Language) == nil {
		if stub := p.buildGoPackageStub(packageName); stub != nil {
			p.UpsertPackageStub(ctx.Language, packageName, stub)
		}
	}

	return p.GetCompletions(packageName, ctx.Prefix, ctx.Language)
}

func buildStubSuggestions(stub *PackageStub, prefix string) []Suggestion {
	var suggestions []Suggestion
	prefixLower := strings.ToLower(prefix)
	source := stub.RuntimeSource
	if source == "" {
		source = core.SourceStubs
	}

	for name, export := range stub.Exports {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(name), prefixLower) {
			continue
		}

		kind := parseStubKind(export.Kind)
		score := 0.6 + float64(export.Popularity)/1000.0
		if score > 0.95 {
			score = 0.95
		}

		insertText := name
		if export.Scaffold != "" {
			insertText = sanitizeInsertText(export.Scaffold)
			if insertText == "" {
				insertText = name
			}
		}

		suggestions = append(suggestions, Suggestion{
			Text:          name,
			DisplayText:   name,
			Kind:          kind,
			Source:        source,
			Score:         score,
			Detail:        export.Signature,
			Documentation: export.Description,
			InsertText:    insertText,
			Namespace:     stub.Package,
		})
	}

	return suggestions
}

func extractPackageReference(accessChain string) string {
	chain := strings.TrimSpace(accessChain)
	if chain == "" {
		return ""
	}
	chain = strings.TrimSuffix(chain, ".")
	chain = strings.TrimSuffix(chain, "::")
	chain = strings.TrimSuffix(chain, "->")
	return strings.TrimSpace(strings.TrimSuffix(chain, "()"))
}

func cutBeforeAny(value string, seps ...string) string {
	cut := value
	for _, sep := range seps {
		if idx := strings.Index(cut, sep); idx >= 0 {
			cut = cut[:idx]
		}
	}
	return strings.TrimSpace(strings.TrimSuffix(cut, "()"))
}

func (p *StubProvider) resolveImportPath(language, reference string, content []byte) string {
	switch language {
	case "go":
		return resolveGoImportPath(reference, content)
	case "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro":
		return resolveJSImportPath(reference, content)
	case "python":
		return resolvePythonImportPath(reference, content)
	default:
		return ""
	}
}

func resolveGoImportPath(reference string, content []byte) string {
	if reference == "" || len(content) == 0 {
		return ""
	}

	scanner := bufio.NewScanner(strings.NewReader(string(content)))
	inImportBlock := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		if line == "import (" {
			inImportBlock = true
			continue
		}
		if inImportBlock {
			if line == ")" {
				inImportBlock = false
				continue
			}
			alias, path := parseGoImportSpec(line)
			if alias == reference {
				return path
			}
			continue
		}
		if strings.HasPrefix(line, "import ") {
			alias, path := parseGoImportSpec(strings.TrimSpace(strings.TrimPrefix(line, "import ")))
			if alias == reference {
				return path
			}
		}
	}
	return ""
}

func resolveJSImportPath(reference string, content []byte) string {
	if reference == "" || len(content) == 0 {
		return ""
	}

	scanner := bufio.NewScanner(strings.NewReader(string(content)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "import ") || !strings.Contains(line, " from ") {
			continue
		}
		path := firstQuotedImportPath(line)
		if path == "" {
			continue
		}
		head, _, _ := strings.Cut(strings.TrimSpace(strings.TrimPrefix(line, "import ")), " from ")
		head = strings.TrimSpace(head)
		if strings.HasPrefix(head, "* as ") {
			alias := strings.TrimSpace(strings.TrimPrefix(head, "* as "))
			if alias == reference {
				return path
			}
			continue
		}
		if strings.HasPrefix(head, "{") {
			named := strings.TrimSpace(strings.Trim(head, "{}"))
			for _, entry := range strings.Split(named, ",") {
				entry = strings.TrimSpace(entry)
				if entry == "" {
					continue
				}
				original := entry
				alias := entry
				if before, after, ok := strings.Cut(entry, " as "); ok {
					original = strings.TrimSpace(before)
					alias = strings.TrimSpace(after)
				}
				if alias == reference || original == reference {
					return path
				}
			}
			continue
		}
		defaultImport := strings.TrimSpace(strings.Split(head, ",")[0])
		if defaultImport == reference {
			return path
		}
	}
	return ""
}

func resolvePythonImportPath(reference string, content []byte) string {
	if reference == "" || len(content) == 0 {
		return ""
	}

	scanner := bufio.NewScanner(strings.NewReader(string(content)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "import ") {
			body := strings.TrimSpace(strings.TrimPrefix(line, "import "))
			parts := strings.Split(body, ",")
			for _, part := range parts {
				chunk := strings.TrimSpace(part)
				moduleName := chunk
				alias := chunk
				if strings.Contains(chunk, " as ") {
					moduleName, alias, _ = strings.Cut(chunk, " as ")
					moduleName = strings.TrimSpace(moduleName)
					alias = strings.TrimSpace(alias)
				}
				if alias == reference {
					return moduleName
				}
			}
			continue
		}
		if strings.HasPrefix(line, "from ") {
			modulePath, rest, ok := strings.Cut(strings.TrimSpace(strings.TrimPrefix(line, "from ")), " import ")
			if !ok {
				continue
			}
			for _, part := range strings.Split(rest, ",") {
				chunk := strings.TrimSpace(part)
				original := chunk
				alias := chunk
				if before, after, hasAlias := strings.Cut(chunk, " as "); hasAlias {
					original = strings.TrimSpace(before)
					alias = strings.TrimSpace(after)
				}
				if alias == reference || original == reference {
					return strings.TrimSpace(modulePath) + "." + strings.TrimSpace(original)
				}
			}
		}
	}
	return ""
}

func firstQuotedImportPath(line string) string {
	for _, quote := range []byte{'\'', '"'} {
		start := strings.IndexByte(line, quote)
		if start == -1 {
			continue
		}
		end := strings.IndexByte(line[start+1:], quote)
		if end == -1 {
			continue
		}
		return line[start+1 : start+1+end]
	}
	return ""
}

func parseGoImportSpec(spec string) (string, string) {
	trimmed := strings.TrimSpace(strings.TrimSuffix(spec, ")"))
	if trimmed == "" {
		return "", ""
	}
	parts := strings.Fields(trimmed)
	if len(parts) == 1 {
		path := strings.Trim(parts[0], `"`)
		return defaultGoImportAlias(path), path
	}
	if len(parts) < 2 {
		return "", ""
	}
	alias := parts[0]
	path := strings.Trim(parts[1], `"`)
	if alias == "." || alias == "_" {
		return "", path
	}
	return alias, path
}

func defaultGoImportAlias(path string) string {
	parts := strings.Split(path, "/")
	if len(parts) == 0 {
		return path
	}
	last := parts[len(parts)-1]
	if strings.HasPrefix(last, "v") && len(parts) > 1 {
		digitsOnly := true
		for _, r := range last[1:] {
			if r < '0' || r > '9' {
				digitsOnly = false
				break
			}
		}
		if digitsOnly {
			return parts[len(parts)-2]
		}
	}
	return last
}

func (p *StubProvider) buildGoPackageStub(importPath string) *PackageStub {
	if p.runner == nil || strings.TrimSpace(importPath) == "" {
		return nil
	}
	output, err := p.runner("go", "doc", "-all", importPath)
	if err != nil || len(output) == 0 {
		return nil
	}
	return parseGoDocPackageStub(importPath, output)
}

func parseGoDocPackageStub(importPath string, output []byte) *PackageStub {
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	exports := make(map[string]StubExport)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "func ") {
			name, ok := parseGoDocFunction(line)
			if ok {
				exports[name] = StubExport{Signature: line, Description: "dynamic package snapshot", Kind: "function", Popularity: 80}
			}
			continue
		}
		if strings.HasPrefix(line, "type ") {
			name := parseGoDocType(line)
			if name != "" {
				exports[name] = StubExport{Signature: line, Description: "dynamic package snapshot", Kind: "type", Popularity: 70}
			}
		}
	}
	if len(exports) == 0 {
		return nil
	}
	return &PackageStub{Package: importPath, Language: "go", Exports: exports, RuntimeSource: core.SourceLibrary}
}

func parseGoDocFunction(line string) (string, bool) {
	body := strings.TrimSpace(strings.TrimPrefix(line, "func "))
	if body == "" || strings.HasPrefix(body, "(") {
		return "", false
	}
	name := body
	for idx, r := range body {
		if r == '(' || r == '[' || r == ' ' {
			name = body[:idx]
			break
		}
	}
	if !isExportedIdentifier(name) {
		return "", false
	}
	return name, true
}

func parseGoDocType(line string) string {
	body := strings.TrimSpace(strings.TrimPrefix(line, "type "))
	if body == "" {
		return ""
	}
	name := body
	for idx, r := range body {
		if r == ' ' || r == '[' {
			name = body[:idx]
			break
		}
	}
	if !isExportedIdentifier(name) {
		return ""
	}
	return name
}

func isExportedIdentifier(name string) bool {
	if name == "" {
		return false
	}
	r := rune(name[0])
	return r >= 'A' && r <= 'Z'
}

func (p *StubProvider) GetPatternSuggestions(packageName, trigger, language string) []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	key := language + "/" + packageName
	stub, ok := p.stubs[key]
	if !ok {
		return nil
	}

	for _, pattern := range stub.Patterns {
		if pattern.Trigger == trigger {
			return pattern.Suggestions
		}
	}

	return nil
}

func (p *StubProvider) HasPackage(packageName, language string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if _, ok := p.aliases[stubReferenceKey(language, packageName)]; ok {
		return true
	}
	_, ok := p.stubs[language+"/"+packageName]
	return ok
}

func (p *StubProvider) ListPackages(language string) []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var packages []string
	prefix := language + "/"
	for key := range p.stubs {
		if strings.HasPrefix(key, prefix) {
			packages = append(packages, strings.TrimPrefix(key, prefix))
		}
	}
	return packages
}

func parseStubKind(kind string) core.SymbolKind {
	switch strings.ToLower(kind) {
	case "function", "func":
		return core.SymbolKindFunction
	case "method":
		return core.SymbolKindMethod
	case "class":
		return core.SymbolKindClass
	case "interface":
		return core.SymbolKindInterface
	case "constant", "const":
		return core.SymbolKindConstant
	case "variable", "var":
		return core.SymbolKindVariable
	case "property", "field":
		return core.SymbolKindProperty
	case "type":
		return core.SymbolKindType
	default:
		return core.SymbolKindFunction
	}
}

func (p *StubProvider) Stats() map[string]int {
	p.mu.RLock()
	defer p.mu.RUnlock()

	stats := make(map[string]int)
	for key, stub := range p.stubs {
		lang := strings.Split(key, "/")[0]
		stats[lang] += len(stub.Exports)
	}
	return stats
}
