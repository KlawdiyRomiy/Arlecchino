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

func TestSourceBonus_UnresolvedMemberAccessPrefersLSPOverLibrary(t *testing.T) {
	brain := &PredictionBrain{}
	ctx := CompletionContext{
		Language:     "swift",
		AccessChain:  "URLSession.",
		IsMethodCall: true,
	}

	lspBonus := brain.sourceBonus(core.SourceLSP, ctx)
	libraryBonus := brain.sourceBonus(core.SourceLibrary, ctx)
	if lspBonus <= libraryBonus {
		t.Fatalf("expected unresolved member access to prefer LSP over library, got lsp=%v library=%v", lspBonus, libraryBonus)
	}
}

func TestPredictionBrain_Complete_BuiltinLibraryAccessDoesNotReturnMembersAtOperator(t *testing.T) {
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
			for _, suggestion := range suggestions {
				if suggestion.Text == tt.want && suggestion.Source == core.SourceLibrary {
					t.Fatalf("expected no library suggestion for %s, got %#v", tt.accessChain, suggestion)
				}
			}
		})
	}
}

func TestResolveAccessChain_DoesNotFallBackToDependencyCatalog(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
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
		filePath string
	}{
		{
			name:     "go short import owner",
			language: "go",
			access:   "sonic.",
			content:  []byte("package main\n\nfunc main() {\n\tsonic.\n}\n"),
			filePath: "main.go",
		},
		{
			name:     "php static owner last segment",
			language: "php",
			access:   "Carbon::",
			content:  []byte("<?php\n\nCarbon::\n"),
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
			if ctx.ResolvedNamespace != "" {
				t.Fatalf("expected no heuristic resolved namespace, got %q", ctx.ResolvedNamespace)
			}
		})
	}
}

func TestPredictionBrain_Complete_UnresolvedGoLibraryAccessDoesNotUseResolverNamespace(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  false,
	})

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
	for _, suggestion := range suggestions {
		if suggestion.Text == "Encode" || suggestion.Text == "Decode" {
			if suggestion.Source == core.SourceLibrary {
				t.Fatalf("expected no unresolved library member suggestion, got %#v", suggestion)
			}
		}
	}
}

func TestPredictionBrain_Complete_ImportedGoLibraryAccessDoesNotUseLibraryFallback(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  false,
	})

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
	trace := brain.LastCompletionTrace()
	if trace.ResolvedNamespace != "github.com/gin-contrib/sse" {
		t.Fatalf("expected existing Go import proof in trace, got %#v", trace)
	}
	assertNoSuggestionFromSource(t, suggestions, "Encode", core.SourceLibrary)
	assertNoSuggestionFromSource(t, suggestions, "Decode", core.SourceLibrary)
}

func TestPredictionBrain_Complete_UsesFullContentForGoAliasWithoutLibraryFallback(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  false,
	})

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
	trace := brain.LastCompletionTrace()
	if trace.ResolvedNamespace != "gopkg.in/telebot.v3" {
		t.Fatalf("expected existing Go import proof from full content in trace, got %#v", trace)
	}
	assertNoSuggestionFromSource(t, suggestions, "Send", core.SourceLibrary)
	assertNoSuggestionFromSource(t, suggestions, "StopPoller", core.SourceLibrary)
}

func TestResolveAccessChain_UsesFullContentForTypeScriptNamespaceAlias(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
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

func assertHasSuggestion(t *testing.T, suggestions []Suggestion, wantText string, wantSource core.SymbolSource) {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.Text == wantText && suggestion.Source == wantSource {
			return
		}
	}
	t.Fatalf("expected suggestion %q from %s, got %#v", wantText, wantSource, suggestions)
}

func assertNoSuggestionFromSource(t *testing.T, suggestions []Suggestion, text string, sources ...core.SymbolSource) {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.Text != text {
			continue
		}
		for _, source := range sources {
			if suggestion.Source == source {
				t.Fatalf("expected no suggestion %q from %s, got %#v", text, source, suggestions)
			}
		}
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

func TestFilterByContext_ResolvedNamespace_KeepsLSPProofAndDropsMismatchedLibrary(t *testing.T) {
	brain := &PredictionBrain{}
	tests := []struct {
		name              string
		language          string
		accessChain       string
		resolvedNamespace string
		want              string
		noiseNamespace    string
		noise             string
	}{
		{name: "typescript zod", language: "typescript", accessChain: "z.", resolvedNamespace: "zod", want: "string", noiseNamespace: "axios", noise: "create"},
		{name: "python requests", language: "python", accessChain: "requests.", resolvedNamespace: "requests", want: "get", noiseNamespace: "json", noise: "dumps"},
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
				{Text: tt.noise, Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: tt.noiseNamespace},
				{Text: "label", Kind: core.SymbolKindFunction, Source: core.SourceLSP},
				{Text: "library", Kind: core.SymbolKindFunction, Source: core.SourceLSP},
			}

			filtered := brain.filterByContext(ctx, suggestions)
			if len(filtered) != 3 {
				t.Fatalf("expected namespace-aware library suggestion plus LSP proof, got %#v", filtered)
			}
			assertHasSuggestion(t, filtered, tt.want, core.SourceLibrary)
			assertHasSuggestion(t, filtered, "label", core.SourceLSP)
			assertHasSuggestion(t, filtered, "library", core.SourceLSP)
			assertNoSuggestionFromSource(t, filtered, tt.noise, core.SourceLibrary)
		})
	}
}
