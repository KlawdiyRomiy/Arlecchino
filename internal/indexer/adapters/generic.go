package adapters

import (
	"regexp"
	"strings"

	"arlecchino/internal/indexer/core"
)

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
	return a.parseLines(path, fileLineIterator(path))
}

func (a *GenericDependencyAdapter) ParseContent(path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	return a.parseLines(path, contentLineIterator(content))
}

func (a *GenericDependencyAdapter) parseLines(path string, iterate indexLineIterator) ([]core.Symbol, []core.Edge, error) {
	// The global registry's legacy MATLAB entry points at .mat workspace data.
	// MATLAB source is handled additively on the shared .m runtime path below;
	// never scan binary MAT files as source text.
	if a.language == "matlab" && dependencyPathHasSuffix(path, ".mat") {
		return nil, nil, nil
	}

	var edges []core.Edge
	seen := make(map[string]struct{}, 8)
	clojureRequireActive := false
	clojureRequireDepth := 0
	delphiUsesActive := false
	var delphiUses strings.Builder
	markupComment := markupCommentNone
	genericBlockComment := false

	err := iterate(func(lineNum int, line string) error {
		if genericLanguageUsesCStyleComments(a.language) {
			line = stripCStyleComments(line, &genericBlockComment)
		}
		if a.language == "html" || a.language == "blade" || a.language == "xml" {
			line = stripMarkupComments(line, &markupComment)
		}
		refs := genericDependencyRefs(a.language, path, line)
		if a.language == "clojure" {
			if marker := strings.Index(line, ":require"); marker >= 0 {
				start := marker
				if start > 0 && line[start-1] == '(' {
					start--
				}
				clojureRequireActive = true
				clojureRequireDepth = strings.Count(line[start:], "(") - strings.Count(line[start:], ")")
			} else if clojureRequireActive {
				clojureRequireDepth += strings.Count(line, "(") - strings.Count(line, ")")
			}
			if clojureRequireActive {
				if match := clojureRequireLinePattern.FindStringSubmatch(line); match != nil {
					refs = append(refs, genericDependencyRef{target: match[1], kind: core.EdgeKindImports})
				}
				if clojureRequireDepth <= 0 {
					clojureRequireActive = false
				}
			}
		}
		if a.language == "delphi" {
			trimmed := strings.TrimSpace(line)
			usesPrefix := len(trimmed) >= len("uses") && strings.EqualFold(trimmed[:len("uses")], "uses")
			usesBoundary := len(trimmed) == len("uses") || (len(trimmed) > len("uses") && (trimmed[len("uses")] == ' ' || trimmed[len("uses")] == '\t'))
			if !delphiUsesActive && usesPrefix && usesBoundary {
				delphiUsesActive = true
				delphiUses.Reset()
				delphiUses.WriteString(strings.TrimSpace(trimmed[len("uses"):]))
			} else if delphiUsesActive {
				delphiUses.WriteByte(' ')
				delphiUses.WriteString(trimmed)
			}
			if delphiUsesActive {
				value := delphiUses.String()
				if end := strings.Index(value, ";"); end >= 0 {
					for _, target := range delphiUseTargets(value[:end]) {
						refs = append(refs, genericDependencyRef{target: target, kind: core.EdgeKindImports})
					}
					delphiUsesActive = false
					delphiUses.Reset()
				}
			}
		}

		for _, ref := range refs {
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
		return nil
	})

	return nil, edges, err
}

type genericDependencyRef struct {
	target string
	kind   core.EdgeKind
}

var (
	cIncludePattern           = regexp.MustCompile(`^\s*#\s*(?:include|import)\s+["<]([^">]+)[">]`)
	assemblyInclude           = regexp.MustCompile(`(?i)^\s*(?:%include|include|\.include|\.incbin|incbin)\s+["<]?([^"'>\s]+)`)
	jvmImportPattern          = regexp.MustCompile(`^\s*import\s+(?:static\s+)?([A-Za-z_][\w.*]*(?:\.[A-Za-z_][\w*]*)*)\s*;?`)
	csharpUsingPattern        = regexp.MustCompile(`^\s*using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;?`)
	fsharpOpenPattern         = regexp.MustCompile(`^\s*open\s+([A-Z][\w.]*)`)
	fsharpLoadPattern         = regexp.MustCompile(`^\s*#load\s+["']([^"']+)["']`)
	rustUsePattern            = regexp.MustCompile(`^\s*(?:pub\s+)?use\s+([^;]+);`)
	rustModPattern            = regexp.MustCompile(`^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;`)
	quotedImportPattern       = regexp.MustCompile(`^\s*(?:import|export)\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']`)
	dartPartPattern           = regexp.MustCompile(`^\s*part\s+["']([^"']+)["']`)
	phpUsePattern             = regexp.MustCompile(`^\s*use\s+([^;]+)`)
	swiftImportPattern        = regexp.MustCompile(`^\s*import\s+([A-Za-z_]\w*)`)
	luaRequirePattern         = regexp.MustCompile(`\brequire\s*(?:\(\s*)?["']([^"']+)["']`)
	perlImportPattern         = regexp.MustCompile(`^\s*(?:use|require)\s+(?:["']([^"']+)["']|([A-Za-z_][\w:]*))`)
	elixirImportPattern       = regexp.MustCompile(`^\s*(?:alias|import|require|use)\s+([A-Z][\w.]+)`)
	gleamImportPattern        = regexp.MustCompile(`^\s*import\s+([a-z][\w./]*)(?:\s+as\s+\w+)?`)
	erlangIncludePattern      = regexp.MustCompile(`^-include(?:_lib)?\s*\(\s*["']([^"']+)["']\s*\)`)
	haskellImportPattern      = regexp.MustCompile(`^\s*import\s+(?:qualified\s+)?([A-Z][\w.']*)`)
	juliaImportPattern        = regexp.MustCompile(`^\s*(?:using|import)\s+(\.*[A-Za-z_][\w.]*)`)
	juliaIncludePattern       = regexp.MustCompile(`\binclude(?:_dependency)?\s*\(\s*["']([^"']+)["']`)
	clojureRequirePattern     = regexp.MustCompile(`\(:require\s+\[([^\s\]]+)`)
	clojureRequireLinePattern = regexp.MustCompile(`^\s*\[\s*([A-Za-z0-9_.-]+)`)
	clojureLoadPattern        = regexp.MustCompile(`\bload-file\s+["']([^"']+)["']`)
	ocamlOpenPattern          = regexp.MustCompile(`^\s*open\s+([A-Z]\w*)`)
	vbImportPattern           = regexp.MustCompile(`(?i)^\s*Imports\s+([A-Za-z_][\w.]*)`)
	vbExternalSource          = regexp.MustCompile(`(?i)^\s*#ExternalSource\s*\(\s*"([^"]+)"`)
	vbaImplementsPattern      = regexp.MustCompile(`(?i)^\s*Implements\s+([A-Za-z_]\w*)`)
	zigImportPattern          = regexp.MustCompile(`@import\s*\(\s*"([^"]+)"\s*\)`)
	gdscriptPathPattern       = regexp.MustCompile(`^\s*extends\s+["']([^"']+)["']|(?:preload|load)\s*\(\s*["']([^"']+)["']\s*\)`)
	shaderIncludePattern      = regexp.MustCompile(`^\s*#\s*(?:include|import)\s+["<]([^">]+)[">]`)
	cssImportPattern          = regexp.MustCompile(`@import\s+(?:url\(\s*)?["']?([^"')\s]+)`)
	sassModulePattern         = regexp.MustCompile(`@(?:use|forward)\s+["']([^"']+)["']`)
	cssURLPattern             = regexp.MustCompile(`url\(\s*["']?([^"')]+)["']?\s*\)`)
	htmlAttrPattern           = regexp.MustCompile(`\b(?:src|href|poster|action|data|xlink:href)=["']([^"']+)["']`)
	mdLinkPattern             = regexp.MustCompile(`!?\[[^\]]*\]\(([^)]+)\)`)
	refPattern                = regexp.MustCompile(`["']?\$ref["']?\s*[:=]\s*["']([^"']+)["']`)
	configPathPattern         = regexp.MustCompile(`(?i)^\s*["']?[A-Za-z0-9_.-]*(?:file|path|schema|config|include|source)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?([^"',\]\s]+)`)
	terraformSource           = regexp.MustCompile(`\bsource\s*=\s*"([^"]+)"`)
	nginxIncludePattern       = regexp.MustCompile(`^\s*include\s+([^;]+);`)
	bladeViewPattern          = regexp.MustCompile(`@(include|extends|component|each)\s*\(\s*["']([^"']+)["']`)
	cmakeIncludePattern       = regexp.MustCompile(`^\s*(?:include|add_subdirectory)\s*\(\s*([^\s)]+)`)
	makeIncludePattern        = regexp.MustCompile(`^\s*(?:-?include|sinclude)\s+(.+)`)
	dockerPathPattern         = regexp.MustCompile(`^\s*(?:COPY|ADD)\s+(?:--[^\s]+\s+)*([^\s]+)`)
	latexInputPattern         = regexp.MustCompile(`\\(?:input|include)\{([^}]+)\}`)
	latexResourcePattern      = regexp.MustCompile(`\\(?:includegraphics|addbibresource|bibliography|usepackage)(?:\[[^\]]*\])?\{([^}]+)\}`)
	shellSourcePattern        = regexp.MustCompile(`^\s*(?:source|\.)\s+([^\s]+)`)
	powershellImport          = regexp.MustCompile(`^\s*(?:\.|Import-Module)\s+([^\s]+)`)
	powershellUsing           = regexp.MustCompile(`(?i)^\s*using\s+module\s+["']?([^"'\s]+)`)
	protobufImportPattern     = regexp.MustCompile(`^\s*import\s+(?:(?:public|weak)\s+)?["']([^"']+)["']`)
	graphqlImportPattern      = regexp.MustCompile(`^\s*#\s*import\s+["']([^"']+)["']`)
	sqlIncludePattern         = regexp.MustCompile(`(?i)^\s*(?:\\i|\\include|source|read)\s+["']?([^"';\s]+)`)
	sqlAtPattern              = regexp.MustCompile(`^\s*@@?\s*["']?([^"';\s]+)`)
	adaWithPattern            = regexp.MustCompile(`^\s*with\s+([A-Za-z_][\w.]*)\s*;`)
	fortranIncludePattern     = regexp.MustCompile(`^\s*include\s+["']([^"']+)["']`)
	fortranUsePattern         = regexp.MustCompile(`(?i)^\s*use(?:\s*,[^:]*)?\s*(?:::\s*)?([A-Za-z_]\w*)`)
	cobolCopyPattern          = regexp.MustCompile(`(?i)^\s*COPY\s+["']?([^"'.\s]+)["']?`)
	delphiUsesPattern         = regexp.MustCompile(`^\s*uses\s+([^;]+);`)
	lispLoadPattern           = regexp.MustCompile(`\b(?:load|require)\s+["']([^"']+)["']`)
	prologConsultPattern      = regexp.MustCompile(`^\s*:-\s*(?:consult|ensure_loaded|use_module)\(\s*['"]([^'"]+)['"]`)
	prologListPattern         = regexp.MustCompile(`^\s*:-\s*\[\s*["']?([^,"'\]\s]+)`)
	rSourcePattern            = regexp.MustCompile(`\bsource\s*\(\s*["']([^"']+)["']`)
	matlabRunPattern          = regexp.MustCompile(`\b(?:run|addpath)\s*\(\s*["']([^"']+)["']`)
	diffGitPattern            = regexp.MustCompile(`^diff\s+--git\s+a/(\S+)\s+b/(\S+)`)
	diffPathPattern           = regexp.MustCompile(`^(?:---|\+\+\+)\s+[ab]/(.+)$`)
)

func genericDependencyRefs(language string, path string, line string) []genericDependencyRef {
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
	if language == "diff" {
		refs = appendDiffRefs(refs, line, add)
	}
	if isGenericCommentLine(trimmed) {
		return refs
	}

	// Some system languages share a runtime-owned extension. Keep the global
	// language registry unchanged and add only syntax that is unambiguous on
	// the line being parsed.
	switch {
	case language == "objectivec" && dependencyPathHasSuffix(path, ".m"):
		refs = appendCodeRegexRefs(refs, line, matlabRunPattern, core.EdgeKindImports, add)
	case language == "perl" && dependencyPathHasSuffix(path, ".pl"):
		refs = appendPrologRefs(refs, line, add)
	case language == "latex" && dependencyPathHasSuffix(path, ".cls"):
		refs = appendVBADirectRefs(refs, line, add)
	}
	if language == "markdown" && dependencyPathHasSuffix(path, ".mdx") {
		refs = appendRegexRefs(refs, line, quotedImportPattern, core.EdgeKindImports, add)
	}
	if language == "r" && (dependencyPathHasSuffix(path, ".rmd") || dependencyPathHasSuffix(path, ".qmd")) {
		refs = appendRegexRefs(refs, line, mdLinkPattern, core.EdgeKindReferences, add)
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
		if m := fsharpLoadPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		if m := fsharpOpenPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "rust":
		if m := rustModPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		if m := rustUsePattern.FindStringSubmatch(line); m != nil {
			for _, target := range rustUseTargets(m[1]) {
				refs = add(refs, target, core.EdgeKindImports)
			}
		}
	case "dart", "solidity", "svelte", "astro":
		if m := quotedImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		if language == "dart" {
			refs = appendRegexRefs(refs, line, dartPartPattern, core.EdgeKindImports, add)
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
		refs = appendCodeRegexRefs(refs, line, luaRequirePattern, core.EdgeKindImports, add)
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
		refs = appendCodeRegexRefs(refs, line, juliaIncludePattern, core.EdgeKindImports, add)
		if m := juliaImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "clojure":
		if m := clojureRequirePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		refs = appendCodeRegexRefs(refs, line, clojureLoadPattern, core.EdgeKindImports, add)
	case "ocaml":
		if m := ocamlOpenPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "vb":
		if m := vbImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		if m := vbExternalSource.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindReferences)
		}
	case "vba":
		refs = appendVBADirectRefs(refs, line, add)
	case "ada":
		if m := adaWithPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "fortran":
		if m := fortranIncludePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		if m := fortranUsePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "cobol":
		if m := cobolCopyPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "delphi":
		if m := delphiUsesPattern.FindStringSubmatch(line); m != nil {
			for _, target := range delphiUseTargets(m[1]) {
				refs = add(refs, target, core.EdgeKindImports)
			}
		}
	case "lisp":
		if m := lispLoadPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "prolog":
		refs = appendPrologRefs(refs, line, add)
	case "zig":
		refs = appendCodeRegexRefs(refs, line, zigImportPattern, core.EdgeKindImports, add)
	case "wgsl", "glsl":
		if m := shaderIncludePattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
	case "gdscript":
		if m := gdscriptPathPattern.FindStringSubmatchIndex(line); len(m) >= 6 && dependencyTokenOutsideQuotedString(line, m[0]) {
			refs = add(refs, firstNonEmpty(capturedDependencyGroup(line, m, 1), capturedDependencyGroup(line, m, 2)), core.EdgeKindImports)
		}
	case "html", "blade", "xml":
		refs = appendAttributeRefs(refs, line, add)
		if language == "blade" {
			refs = appendBladeRefs(refs, line, add)
		}
	case "css", "scss", "sass", "less":
		if m := cssImportPattern.FindStringSubmatch(line); m != nil {
			refs = add(refs, m[1], core.EdgeKindImports)
		}
		refs = appendCodeRegexRefs(refs, line, cssURLPattern, core.EdgeKindReferences, add)
		if language == "scss" || language == "sass" {
			refs = appendCodeRegexRefs(refs, line, sassModulePattern, core.EdgeKindImports, add)
		}
	case "markdown":
		refs = appendRegexRefs(refs, line, mdLinkPattern, core.EdgeKindReferences, add)
	case "json", "yaml", "toml", "ini", "env", "nginx":
		refs = appendRegexRefs(refs, line, refPattern, core.EdgeKindReferences, add)
		refs = appendRegexRefs(refs, line, configPathPattern, core.EdgeKindReferences, add)
		if language == "nginx" {
			refs = appendRegexRefs(refs, line, nginxIncludePattern, core.EdgeKindReferences, add)
		}
	case "terraform":
		refs = appendCodeRegexRefs(refs, line, terraformSource, core.EdgeKindReferences, add)
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
		refs = appendRegexRefs(refs, line, powershellUsing, core.EdgeKindImports, add)
	case "sql":
		refs = appendRegexRefs(refs, line, sqlIncludePattern, core.EdgeKindReferences, add)
		refs = appendRegexRefs(refs, line, sqlAtPattern, core.EdgeKindReferences, add)
	case "graphql":
		// GraphQL imports are encoded as comments, so they are handled before
		// generic comment filtering.
	case "r":
		refs = appendCodeRegexRefs(refs, line, rSourcePattern, core.EdgeKindImports, add)
	case "matlab":
		refs = appendCodeRegexRefs(refs, line, matlabRunPattern, core.EdgeKindImports, add)
	case "diff":
		refs = appendDiffRefs(refs, line, add)
	}
	return refs
}

func appendDiffRefs(refs []genericDependencyRef, line string, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	if m := diffGitPattern.FindStringSubmatch(line); m != nil {
		refs = add(refs, m[1], core.EdgeKindReferences)
		refs = add(refs, m[2], core.EdgeKindReferences)
	}
	if m := diffPathPattern.FindStringSubmatch(line); m != nil {
		refs = add(refs, m[1], core.EdgeKindReferences)
	}
	return refs
}

func appendPrologRefs(refs []genericDependencyRef, line string, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	refs = appendRegexRefs(refs, line, prologConsultPattern, core.EdgeKindImports, add)
	return appendRegexRefs(refs, line, prologListPattern, core.EdgeKindImports, add)
}

func appendVBADirectRefs(refs []genericDependencyRef, line string, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	if m := vbaImplementsPattern.FindStringSubmatch(line); m != nil {
		refs = add(refs, m[1], core.EdgeKindImplements)
	}
	if m := vbExternalSource.FindStringSubmatch(line); m != nil {
		refs = add(refs, m[1], core.EdgeKindReferences)
	}
	return refs
}

func appendBladeRefs(refs []genericDependencyRef, line string, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	for _, match := range bladeViewPattern.FindAllStringSubmatch(line, -1) {
		kind := core.EdgeKindRenders
		if match[1] == "extends" {
			kind = core.EdgeKindExtends
		}
		refs = add(refs, match[2], kind)
	}
	return refs
}

func rustUseTargets(value string) []string {
	value = strings.TrimSpace(value)
	if open := strings.Index(value, "{"); open >= 0 {
		if close := strings.LastIndex(value, "}"); close > open {
			prefix := strings.TrimSuffix(strings.TrimSpace(value[:open]), "::")
			items := strings.Split(value[open+1:close], ",")
			targets := make([]string, 0, len(items))
			for _, item := range items {
				item = strings.TrimSpace(strings.SplitN(item, " as ", 2)[0])
				if item == "" || item == "self" {
					if prefix != "" {
						targets = append(targets, prefix)
					}
					continue
				}
				targets = append(targets, prefix+"::"+item)
			}
			return targets
		}
	}
	return []string{strings.TrimSpace(strings.SplitN(value, " as ", 2)[0])}
}

func delphiUseTargets(value string) []string {
	targets := make([]string, 0, 4)
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		lower := strings.ToLower(item)
		if marker := strings.Index(lower, " in "); marker >= 0 {
			path := strings.TrimSpace(item[marker+4:])
			path = strings.Trim(path, `"'`)
			if path != "" {
				targets = append(targets, path)
				continue
			}
		}
		if fields := strings.Fields(item); len(fields) > 0 {
			targets = append(targets, fields[0])
		}
	}
	return targets
}

func dependencyPathHasSuffix(path string, suffix string) bool {
	return strings.HasSuffix(strings.ToLower(strings.ReplaceAll(path, "\\", "/")), strings.ToLower(suffix))
}

func appendAttributeRefs(refs []genericDependencyRef, line string, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	for _, match := range htmlAttrPattern.FindAllStringSubmatchIndex(line, -1) {
		if len(match) >= 4 && match[2] >= 0 {
			refs = add(refs, line[match[2]:match[3]], core.EdgeKindReferences)
		}
	}
	return refs
}

func appendRegexRefs(refs []genericDependencyRef, line string, pattern *regexp.Regexp, kind core.EdgeKind, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	for _, match := range pattern.FindAllStringSubmatchIndex(line, -1) {
		if len(match) >= 4 && match[2] >= 0 {
			refs = add(refs, line[match[2]:match[3]], kind)
		}
	}
	return refs
}

func appendCodeRegexRefs(refs []genericDependencyRef, line string, pattern *regexp.Regexp, kind core.EdgeKind, add func([]genericDependencyRef, string, core.EdgeKind) []genericDependencyRef) []genericDependencyRef {
	for _, match := range pattern.FindAllStringSubmatchIndex(line, -1) {
		if len(match) >= 4 && match[2] >= 0 && dependencyTokenOutsideQuotedString(line, match[0]) {
			refs = add(refs, line[match[2]:match[3]], kind)
		}
	}
	return refs
}

func capturedDependencyGroup(line string, indexes []int, group int) string {
	start := group * 2
	if start+1 >= len(indexes) || indexes[start] < 0 {
		return ""
	}
	return line[indexes[start]:indexes[start+1]]
}

func genericLanguageUsesCStyleComments(language string) bool {
	switch language {
	case "c", "cpp", "objectivec", "java", "kotlin", "groovy", "scala", "csharp",
		"rust", "dart", "solidity", "svelte", "astro", "php", "swift", "zig",
		"wgsl", "glsl", "css", "scss", "sass", "less", "json", "protobuf",
		"terraform", "sql":
		return true
	default:
		return false
	}
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
