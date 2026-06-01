package adapters

import (
	"bufio"
	"bytes"
	"os"
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

const genericDependencyMaxBytes = 512 << 10

type GenericDependencyAdapter struct {
	language   string
	extensions []string
}

func NewGenericDependencyAdapter(language string, extensions []string) *GenericDependencyAdapter {
	return &GenericDependencyAdapter{
		language:   language,
		extensions: append([]string(nil), extensions...),
	}
}

func (a *GenericDependencyAdapter) Language() string {
	return a.language
}

func (a *GenericDependencyAdapter) Extensions() []string {
	return append([]string(nil), a.extensions...)
}

func (a *GenericDependencyAdapter) ParseFile(path string) ([]core.Symbol, []core.Edge, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	return a.ParseContent(path, content)
}

func (a *GenericDependencyAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	if len(content) > genericDependencyMaxBytes {
		return nil, nil, nil
	}

	var edges []core.Edge
	seen := make(map[string]struct{}, 8)
	scanner := bufio.NewScanner(bytes.NewReader(content))
	scanner.Buffer(make([]byte, 0, 64*1024), genericDependencyMaxBytes)

	lineNum := 0
	for scanner.Scan() {
		lineNum++
		line := scanner.Text()
		for _, ref := range genericDependencyRefs(a.language, line) {
			key := string(ref.kind) + "\x00" + ref.target
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			edges = append(edges, core.Edge{
				FromSymbol: path,
				ToSymbol:   ref.target,
				Kind:       ref.kind,
				FilePath:   path,
				Line:       lineNum,
			})
		}
	}

	return nil, edges, scanner.Err()
}

type genericDependencyRef struct {
	target string
	kind   core.EdgeKind
}

var (
	cIncludePattern       = regexp.MustCompile(`^\s*#\s*(?:include|import)\s+["<]([^">]+)[">]`)
	assemblyInclude       = regexp.MustCompile(`(?i)^\s*(?:%include|include|\.include|\.incbin|incbin)\s+["<]?([^"'>\s]+)`)
	jvmImportPattern      = regexp.MustCompile(`^\s*import\s+(?:static\s+)?([A-Za-z_][\w.*]*(?:\.[A-Za-z_][\w*]*)*)\s*;?`)
	csharpUsingPattern    = regexp.MustCompile(`^\s*using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;?`)
	fsharpOpenPattern     = regexp.MustCompile(`^\s*open\s+([A-Z][\w.]*)`)
	rustUsePattern        = regexp.MustCompile(`^\s*(?:pub\s+)?use\s+([^;]+);`)
	rustModPattern        = regexp.MustCompile(`^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;`)
	quotedImportPattern   = regexp.MustCompile(`^\s*(?:import|export)\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']`)
	phpUsePattern         = regexp.MustCompile(`^\s*use\s+([^;]+)`)
	swiftImportPattern    = regexp.MustCompile(`^\s*import\s+([A-Za-z_]\w*)`)
	luaRequirePattern     = regexp.MustCompile(`\brequire\s*(?:\(\s*)?["']([^"']+)["']`)
	perlImportPattern     = regexp.MustCompile(`^\s*(?:use|require)\s+(?:["']([^"']+)["']|([A-Za-z_][\w:]*))`)
	elixirImportPattern   = regexp.MustCompile(`^\s*(?:alias|import|require|use)\s+([A-Z][\w.]+)`)
	gleamImportPattern    = regexp.MustCompile(`^\s*import\s+([a-z][\w./]*)(?:\s+as\s+\w+)?`)
	erlangIncludePattern  = regexp.MustCompile(`^-include(?:_lib)?\s*\(\s*["']([^"']+)["']\s*\)`)
	haskellImportPattern  = regexp.MustCompile(`^\s*import\s+(?:qualified\s+)?([A-Z][\w.']*)`)
	juliaImportPattern    = regexp.MustCompile(`^\s*(?:using|import)\s+([A-Za-z_][\w.]*)`)
	clojureRequirePattern = regexp.MustCompile(`\(:require\s+\[([^\s\]]+)`)
	ocamlOpenPattern      = regexp.MustCompile(`^\s*open\s+([A-Z]\w*)`)
	vbImportPattern       = regexp.MustCompile(`(?i)^\s*Imports\s+([A-Za-z_][\w.]*)`)
	vbExternalSource      = regexp.MustCompile(`(?i)^\s*#ExternalSource\s*\(\s*"([^"]+)"`)
	zigImportPattern      = regexp.MustCompile(`@import\s*\(\s*"([^"]+)"\s*\)`)
	gdscriptPathPattern   = regexp.MustCompile(`^\s*(?:extends|class_name)?\s*["']([^"']+)["']|(?:preload|load)\s*\(\s*["']([^"']+)["']\s*\)`)
	shaderIncludePattern  = regexp.MustCompile(`^\s*#\s*(?:include|import)\s+["<]([^">]+)[">]`)
	cssImportPattern      = regexp.MustCompile(`@import\s+(?:url\(\s*)?["']?([^"')\s]+)`)
	cssURLPattern         = regexp.MustCompile(`url\(\s*["']?([^"')]+)["']?\s*\)`)
	htmlAttrPattern       = regexp.MustCompile(`\b(?:src|href|poster|action|data|xlink:href)=["']([^"']+)["']`)
	mdLinkPattern         = regexp.MustCompile(`!?\[[^\]]*\]\(([^)]+)\)`)
	refPattern            = regexp.MustCompile(`["']?\$ref["']?\s*[:=]\s*["']([^"']+)["']`)
	configPathPattern     = regexp.MustCompile(`(?i)^\s*["']?[A-Za-z0-9_.-]*(?:file|path|schema|config|include|source)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?([^"',\]\s]+)`)
	terraformSource       = regexp.MustCompile(`\bsource\s*=\s*"([^"]+)"`)
	nginxIncludePattern   = regexp.MustCompile(`^\s*include\s+([^;]+);`)
	cmakeIncludePattern   = regexp.MustCompile(`^\s*(?:include|add_subdirectory)\s*\(\s*([^\s)]+)`)
	makeIncludePattern    = regexp.MustCompile(`^\s*(?:-?include|sinclude)\s+(.+)`)
	dockerPathPattern     = regexp.MustCompile(`^\s*(?:COPY|ADD)\s+(?:--[^\s]+\s+)*([^\s]+)`)
	latexInputPattern     = regexp.MustCompile(`\\(?:input|include)\{([^}]+)\}`)
	latexResourcePattern  = regexp.MustCompile(`\\(?:includegraphics|addbibresource|bibliography|usepackage)(?:\[[^\]]*\])?\{([^}]+)\}`)
	shellSourcePattern    = regexp.MustCompile(`^\s*(?:source|\.)\s+([^\s]+)`)
	powershellImport      = regexp.MustCompile(`^\s*(?:\.|Import-Module)\s+([^\s]+)`)
	protobufImportPattern = regexp.MustCompile(`^\s*import\s+(?:(?:public|weak)\s+)?["']([^"']+)["']`)
	graphqlImportPattern  = regexp.MustCompile(`^\s*#\s*import\s+["']([^"']+)["']`)
	sqlIncludePattern     = regexp.MustCompile(`(?i)^\s*(?:\\i|\\include|source|read)\s+["']?([^"';\s]+)`)
	sqlAtPattern          = regexp.MustCompile(`^\s*@@?\s*["']?([^"';\s]+)`)
	adaWithPattern        = regexp.MustCompile(`^\s*with\s+([A-Za-z_][\w.]*)\s*;`)
	fortranIncludePattern = regexp.MustCompile(`^\s*include\s+["']([^"']+)["']`)
	cobolCopyPattern      = regexp.MustCompile(`(?i)^\s*COPY\s+["']?([^"'.\s]+)["']?`)
	delphiUsesPattern     = regexp.MustCompile(`^\s*uses\s+([^;]+);`)
	lispLoadPattern       = regexp.MustCompile(`\b(?:load|require)\s+["']([^"']+)["']`)
	prologConsultPattern  = regexp.MustCompile(`^\s*:-\s*(?:consult|ensure_loaded)\(\s*['"]([^'"]+)['"]\s*\)`)
	rSourcePattern        = regexp.MustCompile(`\bsource\s*\(\s*["']([^"']+)["']`)
	matlabRunPattern      = regexp.MustCompile(`\b(?:run|addpath)\s*\(\s*["']([^"']+)["']`)
	diffGitPattern        = regexp.MustCompile(`^diff\s+--git\s+a/(\S+)\s+b/(\S+)`)
	diffPathPattern       = regexp.MustCompile(`^(?:---|\+\+\+)\s+[ab]/(.+)$`)
)

func genericDependencyRefs(language string, line string) []genericDependencyRef {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return nil
	}

	add := func(refs []genericDependencyRef, target string, kind core.EdgeKind) []genericDependencyRef {
		target = cleanGenericDependencyTarget(target)
		if target == "" || target == "." || target == ".." {
			return refs
		}
		return append(refs, genericDependencyRef{target: target, kind: kind})
	}

	var refs []genericDependencyRef
	if language == "graphql" {
		refs = appendRegexRefs(refs, line, graphqlImportPattern, core.EdgeKindReferences, add)
	}
	if isGenericCommentLine(trimmed) {
		return refs
	}

	switch language {
	case "c", "cpp", "objectivec":
		if m := cIncludePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "assembly":
		if m := assemblyInclude.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "java", "kotlin", "groovy", "scala":
		if m := jvmImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, strings.TrimSuffix(m[1], ".*"), core.EdgeKindImports)
		}
	case "csharp":
		if m := csharpUsingPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "fsharp":
		if m := fsharpOpenPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "rust":
		if m := rustModPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		if m := rustUsePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, strings.TrimSpace(strings.Trim(m[1], "{}")), core.EdgeKindImports)
		}
	case "dart", "solidity", "svelte", "astro":
		if m := quotedImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "php":
		if m := phpUsePattern.FindStringSubmatch(line); m != nil {
			for _, part := range phpUseTargets(m[1]) {
				refs = add(refs, part, core.EdgeKindImports)
			}
		}
	case "protobuf":
		if m := protobufImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "swift":
		if m := swiftImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "lua":
		if m := luaRequirePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "perl":
		if m := perlImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, firstNonEmpty(m[1], m[2]), core.EdgeKindImports)
		}
	case "elixir":
		if m := elixirImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "gleam":
		if m := gleamImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "erlang":
		if m := erlangIncludePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "haskell":
		if m := haskellImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "julia":
		if m := juliaImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "clojure":
		if m := clojureRequirePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "ocaml":
		if m := ocamlOpenPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "vb", "vba":
		if m := vbImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		if m := vbExternalSource.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindReferences)
		}
	case "ada":
		if m := adaWithPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "fortran":
		if m := fortranIncludePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "cobol":
		if m := cobolCopyPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "delphi":
		if m := delphiUsesPattern.FindStringSubmatch(line); m != nil {
			for _, part := range strings.Split(m[1], ",") {
				refs = add(refs, part, core.EdgeKindImports)
			}
		}
	case "lisp":
		if m := lispLoadPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "prolog":
		if m := prologConsultPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "zig":
		if m := zigImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "wgsl", "glsl":
		if m := shaderIncludePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "gdscript":
		if m := gdscriptPathPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, firstNonEmpty(m[1], m[2]), core.EdgeKindImports)
		}
	case "html", "blade", "xml":
		refs = appendAttributeRefs(refs, line, add)
	case "css", "scss", "sass", "less":
		if m := cssImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		refs = appendRegexRefs(refs, line, cssURLPattern, core.EdgeKindReferences, add)
	case "markdown":
		refs = appendRegexRefs(refs, line, mdLinkPattern, core.EdgeKindReferences, add)
	case "json", "yaml", "toml", "ini", "env", "nginx":
		refs = appendRegexRefs(refs, line, refPattern, core.EdgeKindReferences, add)
		refs = appendRegexRefs(refs, line, configPathPattern, core.EdgeKindReferences, add)
		if language == "nginx" {
			refs = appendRegexRefs(refs, line, nginxIncludePattern, core.EdgeKindReferences, add)
		}
	case "terraform":
		refs = appendRegexRefs(refs, line, terraformSource, core.EdgeKindReferences, add)
	case "cmake":
		if m := cmakeIncludePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "makefile":
		if m := makeIncludePattern.FindStringSubmatch(line); m != nil {
			for _, part := range strings.Fields(m[1]) {
				refs = add(refs, part, core.EdgeKindImports)
			}
		}
	case "dockerfile":
		if m := dockerPathPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindReferences)
		}
	case "latex":
		refs = appendRegexRefs(refs, line, latexInputPattern, core.EdgeKindReferences, add)
		refs = appendRegexRefs(refs, line, latexResourcePattern, core.EdgeKindReferences, add)
	case "bash":
		if m := shellSourcePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "powershell":
		if m := powershellImport.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "sql":
		refs = appendRegexRefs(refs, line, sqlIncludePattern, core.EdgeKindReferences, add)
		refs = appendRegexRefs(refs, line, sqlAtPattern, core.EdgeKindReferences, add)
	case "graphql":
		// GraphQL imports are encoded as comments, so they are handled before
		// generic comment filtering.
	case "r":
		if m := rSourcePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "matlab":
		if m := matlabRunPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "diff":
		if m := diffGitPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindReferences)
			refs = add(refs, m[2], core.EdgeKindReferences)
		}
		if m := diffPathPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindReferences)
		}
	}
	return refs
}

func appendAttributeRefs(refs []genericDependencyRef, line string, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	for _, m := range htmlAttrPattern.FindAllStringSubmatch(line, -1) {
		refs = add(refs, m[1], core.EdgeKindReferences)
	}
	return refs
}

func appendRegexRefs(refs []genericDependencyRef, line string, pattern *regexp.Regexp, kind core.EdgeKind, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	for _, m := range pattern.FindAllStringSubmatch(line, -1) {
		if len(m) > 1 {
			refs = add(refs, m[1], kind)
		}
	}
	return refs
}

func cleanGenericDependencyTarget(target string) string {
	target = strings.TrimSpace(target)
	target = strings.Trim(target, `"'<>`)
	target = strings.TrimRight(target, ",;")
	return strings.TrimSpace(target)
}

func isGenericCommentLine(line string) bool {
	return strings.HasPrefix(line, "//") ||
		strings.HasPrefix(line, "# ") ||
		strings.HasPrefix(line, "--") ||
		strings.HasPrefix(line, ";")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
