package brain

import (
	"strings"
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestFilterByContext_MethodCall_UsesResolvedNamespace(t *testing.T) {
	brain := &PredictionBrain{}
	ctx := CompletionContext{
		Language:          "typescript",
		AccessChain:       "React.",
		IsMethodCall:      true,
		ResolvedNamespace: "react",
	}

	suggestions := []Suggestion{
		{Text: "useState", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "react"},
		{Text: "create", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "axios"},
		{Text: "localHelper", Kind: core.SymbolKindFunction, Source: core.SourceLocal},
	}

	filtered := brain.filterByContext(ctx, suggestions)
	if len(filtered) != 1 {
		t.Fatalf("expected 1 filtered suggestion, got %d: %#v", len(filtered), filtered)
	}
	if filtered[0].Text != "useState" {
		t.Fatalf("expected useState suggestion, got %q", filtered[0].Text)
	}
}

func TestFilterByContext_MethodCall_DropsUnresolvedLibraryNoise(t *testing.T) {
	brain := &PredictionBrain{}
	ctx := CompletionContext{
		Language:     "go",
		AccessChain:  "tea.",
		IsMethodCall: true,
	}

	suggestions := []Suggestion{
		{Text: "NewCipher", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "crypto/tea"},
		{Text: "HasPrefix", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "strings"},
		{Text: "localHelper", Kind: core.SymbolKindFunction, Source: core.SourceLocal},
	}

	filtered := brain.filterByContext(ctx, suggestions)
	if len(filtered) != 0 {
		t.Fatalf("expected no suggestions for unresolved tea access, got %#v", filtered)
	}
}

func TestFilterByContext_MethodCall_DropsPackageNoiseWhenMembersExist(t *testing.T) {
	brain := &PredictionBrain{}
	ctx := CompletionContext{
		Language:          "typescript",
		AccessChain:       "HTTP.",
		IsMethodCall:      true,
		ResolvedNamespace: "axios",
	}

	suggestions := []Suggestion{
		{Text: "axios", Kind: core.SymbolKindModule, Source: core.SourceLibrary, Namespace: "axios"},
		{Text: "create", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "axios"},
		{Text: "interceptors", Kind: core.SymbolKindProperty, Source: core.SourceLibrary, Namespace: "axios"},
	}

	filtered := brain.filterByContext(ctx, suggestions)
	if len(filtered) != 2 {
		t.Fatalf("expected only member suggestions, got %#v", filtered)
	}
	for _, suggestion := range filtered {
		if suggestion.Kind == core.SymbolKindModule || suggestion.Kind == core.SymbolKindPackage {
			t.Fatalf("expected module/package noise to be dropped, got %#v", filtered)
		}
	}
}

func TestSourceBonus_UnresolvedMemberAccessPrefersLibraryOverLSP(t *testing.T) {
	brain := &PredictionBrain{}
	ctx := CompletionContext{
		Language:     "swift",
		AccessChain:  "URLSession.",
		IsMethodCall: true,
	}

	lspBonus := brain.sourceBonus(core.SourceLSP, ctx)
	libraryBonus := brain.sourceBonus(core.SourceLibrary, ctx)
	if lspBonus >= libraryBonus {
		t.Fatalf("expected unresolved member access to prefer library over LSP, got lsp=%v library=%v", lspBonus, libraryBonus)
	}
}

func TestStubProvider_GetContextCompletions_GoUnresolvedEmptyPrefixSkipsDynamicBuild(t *testing.T) {
	provider := NewStubProvider()
	called := false
	provider.runner = func(name string, args ...string) ([]byte, error) {
		called = true
		return []byte("func NewCipher(key []byte)\n"), nil
	}

	ctx := CompletionContext{
		Language:    "go",
		Prefix:      "",
		AccessChain: "tea.",
		Content: []byte(`package main

func main() {
	tea.
}
`),
	}

	suggestions := provider.GetContextCompletions(ctx)
	if called {
		t.Fatal("expected unresolved bare go access with empty prefix to skip dynamic go doc build")
	}
	if len(suggestions) != 0 {
		t.Fatalf("expected no suggestions, got %#v", suggestions)
	}
}

func TestPredictionBrain_Complete_BuiltinLibraryAccessReturnsMembersAtOperator(t *testing.T) {
	tests := []struct {
		name        string
		language    string
		accessChain string
		want        string
	}{
		{name: "go package", language: "go", accessChain: "fmt.", want: "Println"},
		{name: "typescript namespace", language: "typescript", accessChain: "z.", want: "string"},
		{name: "python module", language: "python", accessChain: "requests.", want: "get"},
		{name: "php static class", language: "php", accessChain: "Carbon::", want: "parse"},
		{name: "ruby module", language: "ruby", accessChain: "JSON.", want: "parse"},
		{name: "swift type", language: "swift", accessChain: "URLSession.", want: "shared"},
		{name: "dart package", language: "dart", accessChain: "http.", want: "get"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			brain := NewPredictionBrain(nil, BrainConfig{
				MaxSuggestions:    50,
				MinConfidence:     0.1,
				EnableLSP:         false,
				EnableVirtual:     false,
				EnableSpeculative: false,
				EnablePredictive:  false,
			})
			ctx := CompletionContext{
				Language:     tt.language,
				Prefix:       "",
				AccessChain:  tt.accessChain,
				IsMethodCall: strings.Contains(tt.accessChain, ".") || strings.Contains(tt.accessChain, "->"),
				IsStaticCall: strings.Contains(tt.accessChain, "::"),
			}

			suggestions := brain.Complete(ctx)
			assertHasSuggestion(t, suggestions, tt.want, core.SourceLibrary)
		})
	}
}

func TestResolveAccessChain_FallsBackToDependencyCatalog(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.stubProvider = NewStubProvider()
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache: map[string]dependencyCacheEntry{
				"go": {
					fingerprint: "",
					entries: []dependencyEntry{{
						Name:   "github.com/bytedance/sonic",
						Kind:   core.SymbolKindPackage,
						Source: core.SourceLibrary,
					}},
				},
				"php": {
					fingerprint: "",
					entries: []dependencyEntry{{
						Name:   "nesbot/carbon",
						Kind:   core.SymbolKindPackage,
						Source: core.SourceLibrary,
					}},
				},
			},
		},
	}

	tests := []struct {
		name     string
		language string
		access   string
		content  []byte
		want     string
		filePath string
	}{
		{
			name:     "go short import owner",
			language: "go",
			access:   "sonic.",
			content:  []byte("package main\n\nfunc main() {\n\tsonic.\n}\n"),
			want:     "github.com/bytedance/sonic",
			filePath: "main.go",
		},
		{
			name:     "php static owner last segment",
			language: "php",
			access:   "Carbon::",
			content:  []byte("<?php\n\nCarbon::\n"),
			want:     "nesbot/carbon",
			filePath: "test.php",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := CompletionContext{
				FilePath:    tt.filePath,
				Language:    tt.language,
				AccessChain: tt.access,
				Content:     tt.content,
			}

			brain.ResolveAccessChain(&ctx)
			if ctx.ResolvedNamespace != tt.want {
				t.Fatalf("expected resolved namespace %q, got %q", tt.want, ctx.ResolvedNamespace)
			}
		})
	}
}

func TestStubProvider_GetContextCompletions_GoResolvedNamespaceBypassesEmptyPrefixGuard(t *testing.T) {
	provider := NewStubProvider()
	var commandArgs []string
	provider.runner = func(name string, args ...string) ([]byte, error) {
		commandArgs = append([]string{name}, args...)
		return []byte("func Marshal(v any) ([]byte, error)\n"), nil
	}

	ctx := CompletionContext{
		Language:          "go",
		Prefix:            "",
		AccessChain:       "sonic.",
		ResolvedNamespace: "github.com/bytedance/sonic",
		Content: []byte(`package main

func main() {
	sonic.
}
`),
	}

	suggestions := provider.GetContextCompletions(ctx)
	if len(commandArgs) == 0 {
		t.Fatal("expected dynamic go doc lookup to run for manifest-resolved package")
	}
	if got := commandArgs[len(commandArgs)-1]; got != "github.com/bytedance/sonic" {
		t.Fatalf("expected go doc to use full import path, got args %#v", commandArgs)
	}
	if len(suggestions) == 0 {
		t.Fatalf("expected suggestions, got %#v", suggestions)
	}
	if suggestions[0].Namespace != "github.com/bytedance/sonic" {
		t.Fatalf("expected full namespace on suggestions, got %#v", suggestions)
	}
}

func TestStubProvider_GetContextCompletions_GoResolverFallbackUsesFullImportPath(t *testing.T) {
	provider := NewStubProvider()
	provider.SetPackageResolver(func(language, reference string) string {
		if language == "go" && reference == "sse" {
			return "github.com/gin-contrib/sse"
		}
		return ""
	})

	var commandArgs []string
	provider.runner = func(name string, args ...string) ([]byte, error) {
		commandArgs = append([]string{name}, args...)
		return []byte("func Encode(w any, event any) error\nfunc Decode(data []byte) (Event, error)\n"), nil
	}

	ctx := CompletionContext{
		Language:    "go",
		Prefix:      "",
		AccessChain: "sse.",
		Content: []byte(`package main

func main() {
	sse.
}
`),
	}

	suggestions := provider.GetContextCompletions(ctx)
	if len(commandArgs) == 0 {
		t.Fatal("expected dynamic go doc lookup to run for resolver fallback package")
	}
	if got := commandArgs[len(commandArgs)-1]; got != "github.com/gin-contrib/sse" {
		t.Fatalf("expected go doc to use resolver fallback import path, got args %#v", commandArgs)
	}
	if len(suggestions) == 0 {
		t.Fatalf("expected suggestions, got %#v", suggestions)
	}
	if suggestions[0].Namespace != "github.com/gin-contrib/sse" {
		t.Fatalf("expected full namespace on suggestions, got %#v", suggestions)
	}
	if got := provider.ResolvePackage("sse", "go"); got != "github.com/gin-contrib/sse" {
		t.Fatalf("expected resolver fallback to be memoized, got %q", got)
	}
}

func TestFromStubs_GoSuggestionsGainImportEdits(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.stubProvider = NewStubProvider()
	brain.stubProvider.runner = func(name string, args ...string) ([]byte, error) {
		return []byte("func HasPrefix(s, prefix string) bool\nfunc HasSuffix(s, suffix string) bool\n"), nil
	}

	ctx := CompletionContext{
		FilePath:    "main.go",
		Language:    "go",
		Prefix:      "Ha",
		AccessChain: "strings.",
		Content: []byte(`package main

func main() {
	strings.Ha
}
`),
	}

	suggestions := brain.fromStubs(ctx)
	var target *Suggestion
	for i := range suggestions {
		if suggestions[i].Text == "HasPrefix" {
			target = &suggestions[i]
			break
		}
	}
	if target == nil {
		t.Fatalf("expected HasPrefix suggestion, got %#v", suggestions)
	}
	if len(target.AdditionalTextEdits) == 0 {
		t.Fatalf("expected import edit for HasPrefix, got %#v", target)
	}
	if got := target.AdditionalTextEdits[0].Text; got != "import \"strings\"\n" {
		t.Fatalf("expected go import edit, got %q", got)
	}
}

func TestPredictionBrain_Complete_UnresolvedGoLibraryAccessUsesResolverNamespace(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  false,
	})
	brain.stubProvider = NewStubProvider()
	brain.stubProvider.SetPackageResolver(func(language, reference string) string {
		if language == "go" && reference == "sse" {
			return "github.com/gin-contrib/sse"
		}
		return ""
	})
	brain.stubProvider.runner = func(name string, args ...string) ([]byte, error) {
		return []byte("func Encode(w any, event any) error\nfunc Decode(data []byte) (Event, error)\n"), nil
	}

	ctx := CompletionContext{
		FilePath:     "main.go",
		Language:     "go",
		Prefix:       "",
		AccessChain:  "sse.",
		IsMethodCall: true,
		Content: []byte(`package main

func main() {
	sse.
}
`),
		Line:   4,
		Column: 5,
	}

	suggestions := brain.Complete(ctx)
	assertHasSuggestion(t, suggestions, "Encode", core.SourceLibrary)
	assertHasSuggestion(t, suggestions, "Decode", core.SourceLibrary)
}

func TestPredictionBrain_Complete_ImportedGoLibraryAccessReturnsMembers(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  false,
	})
	brain.stubProvider = NewStubProvider()
	brain.stubProvider.runner = func(name string, args ...string) ([]byte, error) {
		return []byte("func Encode(w any, event any) error\nfunc Decode(data []byte) (Event, error)\n"), nil
	}

	ctx := CompletionContext{
		FilePath:     "main.go",
		Language:     "go",
		Prefix:       "",
		AccessChain:  "sse.",
		IsMethodCall: true,
		Content: []byte(`package main

import sse "github.com/gin-contrib/sse"

func main() {
	sse.
}
`),
		Line:   6,
		Column: 5,
	}

	suggestions := brain.Complete(ctx)
	assertHasSuggestion(t, suggestions, "Encode", core.SourceLibrary)
	assertHasSuggestion(t, suggestions, "Decode", core.SourceLibrary)
}

func TestPredictionBrain_Complete_UsesFullContentForGoAliasOutsideWindow(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  false,
	})
	brain.stubProvider = NewStubProvider()
	brain.stubProvider.runner = func(name string, args ...string) ([]byte, error) {
		return []byte("func Send(recipient any, what any, opts ...any) error\nfunc StopPoller()\n"), nil
	}

	fullContent := []byte(`package main

import tele "gopkg.in/telebot.v3"

func main() {
	tele.
}
`)

	ctx := CompletionContext{
		FilePath:     "main.go",
		Language:     "go",
		Prefix:       "",
		AccessChain:  "tele.",
		IsMethodCall: true,
		Content: []byte(`func main() {
	tele.
}
`),
		FullContent: fullContent,
		Line:        6,
		Column:      6,
	}

	suggestions := brain.Complete(ctx)
	assertHasSuggestion(t, suggestions, "Send", core.SourceLibrary)
	assertHasSuggestion(t, suggestions, "StopPoller", core.SourceLibrary)
}

func TestResolveAccessChain_UsesFullContentForTypeScriptNamespaceAlias(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.stubProvider = NewStubProvider()
	ctx := CompletionContext{
		FilePath:    "component.tsx",
		Language:    "typescript",
		AccessChain: "React.",
		Content: []byte(`function Demo() {
	return React.
}
`),
		FullContent: []byte(`import * as React from 'react';

function Demo() {
	return React.
}
`),
	}

	brain.ResolveAccessChain(&ctx)
	if ctx.ResolvedNamespace != "react" {
		t.Fatalf("expected React alias to resolve to react, got %q", ctx.ResolvedNamespace)
	}
}

func TestFromStubs_SuggestsBarePackagesWithDefaultJSImport(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.stubProvider = NewStubProvider()
	brain.stubProvider.UpsertPackageStub("typescript", "axios", &PackageStub{
		Package:  "axios",
		Language: "typescript",
		Exports: map[string]StubExport{
			"create": {Signature: "function create(config?: AxiosRequestConfig): AxiosInstance", Kind: "function"},
		},
	})

	ctx := CompletionContext{
		FilePath:  "src/app.ts",
		Language:  "typescript",
		Prefix:    "ax",
		Content:   []byte("const client = ax\n"),
		Column:    17,
		Line:      1,
		InImport:  false,
		InString:  false,
		InComment: false,
	}

	suggestions := brain.fromStubs(ctx)
	var target *Suggestion
	for i := range suggestions {
		if suggestions[i].Text == "axios" {
			target = &suggestions[i]
			break
		}
	}
	if target == nil {
		t.Fatalf("expected axios package suggestion, got %#v", suggestions)
	}
	if target.Kind != core.SymbolKindModule {
		t.Fatalf("expected axios to be a module suggestion, got %s", target.Kind)
	}
	if len(target.AdditionalTextEdits) == 0 {
		t.Fatalf("expected default import edit for axios, got %#v", target)
	}
	if got := target.AdditionalTextEdits[0].Text; got != "import axios from 'axios';\n" {
		t.Fatalf("expected default axios import, got %q", got)
	}
}

func TestResolveAccessChain_UsesStubAliasNamespace(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.stubProvider = NewStubProvider()
	brain.stubProvider.UpsertPackageStub("typescript", "zod", &PackageStub{
		Package:  "zod",
		Language: "typescript",
		Aliases:  []string{"z"},
		Exports: map[string]StubExport{
			"string": {Signature: "function string(): ZodString", Kind: "function"},
		},
	})

	ctx := CompletionContext{
		FilePath:    "schema.ts",
		Language:    "typescript",
		AccessChain: "z.",
		Content:     []byte("const schema = z.st\n"),
	}

	brain.ResolveAccessChain(&ctx)
	if ctx.ResolvedNamespace != "zod" {
		t.Fatalf("expected z alias to resolve to zod, got %q", ctx.ResolvedNamespace)
	}
}

func assertHasSuggestion(t *testing.T, suggestions []Suggestion, wantText string, wantSource core.SymbolSource) {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.Text == wantText && suggestion.Source == wantSource {
			return
		}
	}
	t.Fatalf("expected suggestion %q from %s, got %#v", wantText, wantSource, suggestions)
}

func TestStubProvider_GetContextCompletions_UsesAliases(t *testing.T) {
	provider := NewStubProvider()
	provider.UpsertPackageStub("typescript", "zod", &PackageStub{
		Package:  "zod",
		Language: "typescript",
		Aliases:  []string{"z"},
		Exports: map[string]StubExport{
			"string": {Signature: "function string(): ZodString", Kind: "function"},
			"object": {Signature: "function object(shape: any): ZodObject", Kind: "function"},
		},
	})

	ctx := CompletionContext{
		Language:    "typescript",
		Prefix:      "st",
		AccessChain: "z.",
		Content:     []byte("const schema = z.st\n"),
	}

	suggestions := provider.GetContextCompletions(ctx)
	if len(suggestions) == 0 {
		t.Fatal("expected alias-backed zod suggestions, got none")
	}
	if suggestions[0].Namespace != "zod" {
		t.Fatalf("expected zod namespace, got %#v", suggestions)
	}
	hasString := false
	for _, suggestion := range suggestions {
		if suggestion.Text == "string" {
			hasString = true
			break
		}
	}
	if !hasString {
		t.Fatalf("expected string suggestion, got %#v", suggestions)
	}
}

func TestStubProvider_ResolvePackage_TrimsMemberChainsToKnownOwner(t *testing.T) {
	provider := NewStubProvider()
	provider.UpsertPackageStub("javascript", "console", &PackageStub{
		Package:  "console",
		Language: "javascript",
		Exports: map[string]StubExport{
			"log": {Signature: "function log(...args: any[]): void", Kind: "function"},
		},
	})

	if got := provider.ResolvePackage("console.log", "javascript"); got != "console" {
		t.Fatalf("expected console.log chain to resolve to console package, got %q", got)
	}
}

func TestDetectPackageName_PreservesNestedOwners(t *testing.T) {
	brain := &PredictionBrain{}
	tests := []struct {
		name        string
		accessChain string
		want        string
	}{
		{name: "python nested module", accessChain: "os.path.", want: "os.path"},
		{name: "php static owner", accessChain: "Carbon::", want: "Carbon"},
		{name: "cpp nested owner", accessChain: "std::vector::", want: "std::vector"},
		{name: "java nested owner", accessChain: "System.out.", want: "System.out"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := brain.detectPackageName(CompletionContext{AccessChain: tt.accessChain})
			if got != tt.want {
				t.Fatalf("detectPackageName() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAutoImporter_GenerateImportEdit_PythonMemberUsesModuleImport(t *testing.T) {
	ai := NewAutoImporter()
	edit := ai.GenerateImportEdit(&core.Symbol{
		Name:      "dumps",
		Kind:      core.SymbolKindFunction,
		Namespace: "json",
	}, CompletionContext{
		Language:     "python",
		AccessChain:  "json.",
		IsMethodCall: true,
		Content:      []byte("def main():\n    return json.du\n"),
	})
	if edit == nil {
		t.Fatal("expected import edit for json.dumps")
	}
	if edit.Text != "import json\n" {
		t.Fatalf("expected module import for member access, got %q", edit.Text)
	}
}

func TestAutoImporter_GenerateImportEdit_PHPStaticMemberUsesOwnerImport(t *testing.T) {
	ai := NewAutoImporter()
	edit := ai.GenerateImportEdit(&core.Symbol{
		Name:      "now",
		Kind:      core.SymbolKindMethod,
		Namespace: "Carbon\\Carbon",
	}, CompletionContext{
		Language:     "php",
		AccessChain:  "Carbon::",
		IsStaticCall: true,
		Content:      []byte("<?php\n\nCarbon::n\n"),
	})
	if edit == nil {
		t.Fatal("expected import edit for Carbon::now")
	}
	if edit.Text != "use Carbon\\Carbon;\n" {
		t.Fatalf("expected owner import for static member access, got %q", edit.Text)
	}
}

func TestAutoImporter_GenerateImportEdit_CHeaderMappings(t *testing.T) {
	ai := NewAutoImporter()
	tests := []struct {
		name string
		sym  core.Symbol
		want string
	}{
		{name: "malloc", sym: core.Symbol{Name: "malloc", Kind: core.SymbolKindFunction}, want: "#include <stdlib.h>\n"},
		{name: "printf", sym: core.Symbol{Name: "printf", Kind: core.SymbolKindFunction}, want: "#include <stdio.h>\n"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			edit := ai.GenerateImportEdit(&tt.sym, CompletionContext{
				Language: "c",
				Content:  []byte("int main(void) {\n    return 0;\n}\n"),
			})
			if edit == nil {
				t.Fatal("expected include edit")
			}
			if edit.Text != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, edit.Text)
			}
		})
	}
}

func TestAutoImporter_GenerateImportEdit_CPPHeaderMappings(t *testing.T) {
	ai := NewAutoImporter()
	tests := []struct {
		name string
		sym  core.Symbol
		want string
	}{
		{name: "std map", sym: core.Symbol{Name: "map", Kind: core.SymbolKindClass, Namespace: "std::map"}, want: "#include <map>\n"},
		{name: "std vector", sym: core.Symbol{Name: "vector", Kind: core.SymbolKindClass, Namespace: "std::vector"}, want: "#include <vector>\n"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			edit := ai.GenerateImportEdit(&tt.sym, CompletionContext{
				Language: "cpp",
				Content:  []byte("int main() {\n    return 0;\n}\n"),
			})
			if edit == nil {
				t.Fatal("expected include edit")
			}
			if edit.Text != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, edit.Text)
			}
		})
	}
}

func TestContextMatchScore_UsesResolvedNamespace(t *testing.T) {
	brain := &PredictionBrain{}
	ctx := CompletionContext{
		Language:          "typescript",
		AccessChain:       "z.",
		IsMethodCall:      true,
		ResolvedNamespace: "zod",
	}

	match := Suggestion{Text: "string", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "zod"}
	noise := Suggestion{Text: "label", Kind: core.SymbolKindFunction, Source: core.SourceLSP}

	if got, wantMin := brain.contextMatchScore(ctx, &match), 0.9; got < wantMin {
		t.Fatalf("expected strong context score for resolved namespace, got %.2f", got)
	}
	if gotNoise := brain.contextMatchScore(ctx, &noise); gotNoise >= brain.contextMatchScore(ctx, &match) {
		t.Fatalf("expected resolved namespace match to outrank empty-namespace noise, match=%.2f noise=%.2f", brain.contextMatchScore(ctx, &match), gotNoise)
	}
}

func TestSmartRanker_ContextScore_UsesResolvedNamespace(t *testing.T) {
	ranker := NewSmartRanker(nil, nil)
	ctx := RankingContext{
		Language:          "typescript",
		AccessChain:       "z.",
		IsMethodCall:      true,
		ResolvedNamespace: "zod",
	}

	match := Suggestion{Text: "string", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "zod"}
	noise := Suggestion{Text: "label", Kind: core.SymbolKindFunction, Source: core.SourceLSP}

	matchScore := ranker.contextScore(&match, ctx)
	noiseScore := ranker.contextScore(&noise, ctx)
	if matchScore <= noiseScore {
		t.Fatalf("expected resolved namespace context score to beat noise, match=%.2f noise=%.2f", matchScore, noiseScore)
	}
	if strings.Contains(match.Namespace, "/") && matchScore <= 0.5 {
		t.Fatalf("expected non-trivial context score for namespace-aware match, got %.2f", matchScore)
	}
}

func TestFilterByContext_ResolvedNamespace_DropsEmptyNamespaceLSPNoise(t *testing.T) {
	brain := &PredictionBrain{}
	tests := []struct {
		name              string
		language          string
		accessChain       string
		resolvedNamespace string
		want              string
	}{
		{name: "typescript zod", language: "typescript", accessChain: "z.", resolvedNamespace: "zod", want: "string"},
		{name: "python requests", language: "python", accessChain: "requests.", resolvedNamespace: "requests", want: "get"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := CompletionContext{
				Language:          tt.language,
				AccessChain:       tt.accessChain,
				IsMethodCall:      true,
				ResolvedNamespace: tt.resolvedNamespace,
			}

			suggestions := []Suggestion{
				{Text: tt.want, Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: tt.resolvedNamespace},
				{Text: "label", Kind: core.SymbolKindFunction, Source: core.SourceLSP},
				{Text: "library", Kind: core.SymbolKindFunction, Source: core.SourceLSP},
			}

			filtered := brain.filterByContext(ctx, suggestions)
			if len(filtered) != 1 {
				t.Fatalf("expected only namespace-aware suggestion, got %#v", filtered)
			}
			if filtered[0].Text != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, filtered[0].Text)
			}
		})
	}
}

func TestFromStubs_BuiltInRubyJSONGetsRequireEdit(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.stubProvider = NewStubProviderWithBuiltins()

	ctx := CompletionContext{
		FilePath:    "main.rb",
		Language:    "ruby",
		Prefix:      "p",
		AccessChain: "JSON.",
		Content: []byte(`def parse_payload(payload)
	JSON.p
end
`),
	}

	suggestions := brain.fromStubs(ctx)
	var target *Suggestion
	for i := range suggestions {
		if suggestions[i].Text == "parse" {
			target = &suggestions[i]
			break
		}
	}
	if target == nil {
		t.Fatalf("expected JSON.parse suggestion, got %#v", suggestions)
	}
	if len(target.AdditionalTextEdits) == 0 {
		t.Fatalf("expected require edit for JSON.parse, got %#v", target)
	}
	if got := target.AdditionalTextEdits[0].Text; got != "require 'json'\n" {
		t.Fatalf("expected ruby require edit, got %q", got)
	}
}

func TestFromStubs_BuiltInAxiosSuggestionGetsDefaultImport(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.stubProvider = NewStubProviderWithBuiltins()

	ctx := CompletionContext{
		FilePath:  "src/app.ts",
		Language:  "typescript",
		Prefix:    "ax",
		Content:   []byte("const client = ax\n"),
		Column:    17,
		Line:      1,
		InImport:  false,
		InString:  false,
		InComment: false,
	}

	suggestions := brain.fromStubs(ctx)
	var target *Suggestion
	for i := range suggestions {
		if suggestions[i].Text == "axios" {
			target = &suggestions[i]
			break
		}
	}
	if target == nil {
		t.Fatalf("expected built-in axios package suggestion, got %#v", suggestions)
	}
	if len(target.AdditionalTextEdits) == 0 {
		t.Fatalf("expected default import edit for built-in axios, got %#v", target)
	}
	if got := target.AdditionalTextEdits[0].Text; got != "import axios from 'axios';\n" {
		t.Fatalf("expected built-in axios import, got %q", got)
	}
}
