package brain

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
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
		{Text: "useState", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "react", ProofKind: "receiver-member"},
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
		{Text: "create", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "axios", ProofKind: "receiver-member"},
		{Text: "interceptors", Kind: core.SymbolKindProperty, Source: core.SourceLibrary, Namespace: "axios", ProofKind: "receiver-member"},
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

func TestVirtualAccessImportPlan_UsesCatalogOwnerWithoutLibraryMembers(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache: map[string]dependencyCacheEntry{
				"go": {
					fingerprint: "",
					entries: []dependencyEntry{{
						Name:   "crypto/sha256",
						Kind:   core.SymbolKindPackage,
						Source: core.SourceLibrary,
						Owner:  "sha256",
					}},
				},
			},
			cacheStatus: map[string]string{},
		},
	}

	content := []byte(`package main

func main() {
	sha256.
}
`)
	ctx := CompletionContext{
		FilePath:     "/tmp/main.go",
		Language:     "go",
		AccessChain:  "sha256.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         4,
		Column:       9,
	}

	plan, ok := brain.virtualAccessImportPlan(ctx, "go")
	if !ok {
		t.Fatal("expected virtual import plan")
	}
	if plan.library != "crypto/sha256" {
		t.Fatalf("expected crypto/sha256 library, got %q", plan.library)
	}
	if !strings.Contains(plan.content, `import "crypto/sha256"`) {
		t.Fatalf("expected virtual content to include import, got:\n%s", plan.content)
	}
	if plan.virtualLine != ctx.Line+1 {
		t.Fatalf("expected cursor line to move by one import line, got virtual=%d original=%d", plan.virtualLine, ctx.Line)
	}
	if plan.filePath == ctx.FilePath || !strings.HasSuffix(plan.filePath, ".go") {
		t.Fatalf("expected separate virtual Go file path, got %q", plan.filePath)
	}
}

func TestVirtualAccessImportPlan_UsesProjectIndexOwnerWithoutDependencyCatalog(t *testing.T) {
	root := t.TempDir()
	engine, err := core.NewEngine(core.EngineConfig{
		ProjectID:   "project-import-owner",
		ProjectRoot: root,
		DBPath:      filepath.Join(root, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	if err := engine.Store().SaveSymbols([]core.Symbol{{
		Name:       "client",
		Kind:       core.SymbolKindPackage,
		Language:   "go",
		Namespace:  "example.com/app/internal/client",
		FilePath:   filepath.Join(root, "internal", "client", "client.go"),
		Source:     core.SourceIndex,
		Confidence: 0.95,
	}}); err != nil {
		t.Fatalf("SaveSymbols: %v", err)
	}

	brain := NewPredictionBrain(engine, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions.catalog = &dependencyCatalog{
		cache:       map[string]dependencyCacheEntry{"go": {fingerprint: "", entries: nil}},
		cacheStatus: map[string]string{},
	}

	content := []byte(`package main

func main() {
	client.
}
`)
	ctx := CompletionContext{
		FilePath:     filepath.Join(root, "cmd", "app", "main.go"),
		Language:     "go",
		AccessChain:  "client.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         4,
		Column:       9,
	}

	plan, ok := brain.virtualAccessImportPlan(ctx, "go")
	if !ok {
		t.Fatal("expected project-index virtual import plan")
	}
	if plan.library != "example.com/app/internal/client" {
		t.Fatalf("expected project import path, got %q", plan.library)
	}
	if !strings.Contains(plan.content, `import "example.com/app/internal/client"`) {
		t.Fatalf("expected virtual content to include project import, got:\n%s", plan.content)
	}
}

func TestVirtualAccessImportPlan_RejectsAmbiguousProjectOwners(t *testing.T) {
	root := t.TempDir()
	engine, err := core.NewEngine(core.EngineConfig{
		ProjectID:   "ambiguous-project-import-owner",
		ProjectRoot: root,
		DBPath:      filepath.Join(root, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	if err := engine.Store().SaveSymbols([]core.Symbol{
		{
			Name:       "client",
			Kind:       core.SymbolKindPackage,
			Language:   "go",
			Namespace:  "example.com/app/client",
			FilePath:   filepath.Join(root, "client", "client.go"),
			Source:     core.SourceIndex,
			Confidence: 0.95,
		},
		{
			Name:       "client",
			Kind:       core.SymbolKindPackage,
			Language:   "go",
			Namespace:  "example.com/app/other/client",
			FilePath:   filepath.Join(root, "other", "client", "client.go"),
			Source:     core.SourceIndex,
			Confidence: 0.95,
		},
	}); err != nil {
		t.Fatalf("SaveSymbols: %v", err)
	}

	brain := NewPredictionBrain(engine, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions.catalog = &dependencyCatalog{
		cache:       map[string]dependencyCacheEntry{"go": {fingerprint: "", entries: nil}},
		cacheStatus: map[string]string{},
	}

	content := []byte("package main\n\nfunc main() {\n\tclient.\n}\n")
	ctx := CompletionContext{
		FilePath:     filepath.Join(root, "main.go"),
		Language:     "go",
		AccessChain:  "client.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         4,
		Column:       9,
	}

	if plan, ok := brain.virtualAccessImportPlan(ctx, "go"); ok {
		t.Fatalf("expected ambiguous project owner to be rejected, got %#v", plan)
	}
}

func TestVirtualAccessImportCompletionItems_MapTextEditsAndCarryRealImport(t *testing.T) {
	importEdit := core.TextEdit{
		StartLine:   2,
		StartColumn: 1,
		EndLine:     2,
		EndColumn:   1,
		Text:        "import \"log\"\n",
	}
	rawTextEdit, err := json.Marshal(lsp.TextEdit{
		Range: lsp.Range{
			Start: lsp.Position{Line: 4, Character: 6},
			End:   lsp.Position{Line: 4, Character: 6},
		},
		NewText: "Fatal",
	})
	if err != nil {
		t.Fatalf("marshal text edit: %v", err)
	}

	items := virtualAccessImportCompletionItems([]lsp.CompletionItem{{
		Label:        "Fatal",
		Kind:         2,
		TextEdit:     rawTextEdit,
		Command:      &lsp.Command{Title: "format", Command: "format"},
		Data:         map[string]any{"uri": "virtual"},
		FallbackOnly: true,
	}}, importEdit, 5, 1)

	if len(items) != 1 {
		t.Fatalf("expected one item, got %d", len(items))
	}
	item := items[0]
	if item.FallbackOnly {
		t.Fatal("expected virtual import LSP item to be trusted as a member")
	}
	if item.Command != nil || item.Data != nil {
		t.Fatalf("expected virtual URI side effects to be stripped, got command=%#v data=%#v", item.Command, item.Data)
	}
	if len(item.AdditionalTextEdits) != 1 {
		t.Fatalf("expected real import edit, got %#v", item.AdditionalTextEdits)
	}
	if item.AdditionalTextEdits[0].Range.Start.Line != 1 || item.AdditionalTextEdits[0].NewText != importEdit.Text {
		t.Fatalf("unexpected import edit: %#v", item.AdditionalTextEdits[0])
	}

	var mapped lsp.TextEdit
	if err := json.Unmarshal(item.TextEdit, &mapped); err != nil {
		t.Fatalf("unmarshal mapped text edit: %v", err)
	}
	if mapped.Range.Start.Line != 3 || mapped.Range.End.Line != 3 {
		t.Fatalf("expected primary text edit to map back to original line 4, got %#v", mapped.Range)
	}
}

func TestAttachGeneratedAccessImportEdit_EnrichesTrustedUnresolvedLSPMembers(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache: map[string]dependencyCacheEntry{
				"go": {
					fingerprint: "",
					entries: []dependencyEntry{{
						Name:   "log",
						Kind:   core.SymbolKindPackage,
						Source: core.SourceLibrary,
					}},
				},
			},
			cacheStatus: map[string]string{},
		},
	}

	content := []byte(`package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	log.
}
`)
	rawTextEdit, err := json.Marshal(lsp.TextEdit{
		Range: lsp.Range{
			Start: lsp.Position{Line: 3, Character: 5},
			End:   lsp.Position{Line: 3, Character: 5},
		},
		NewText: "Fatal",
	})
	if err != nil {
		t.Fatalf("marshal text edit: %v", err)
	}

	ctx := CompletionContext{
		FilePath:     "/tmp/main.go",
		Language:     "go",
		AccessChain:  "log.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         12,
		Column:       6,
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "go", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{{
			Label:    "Fatal",
			Kind:     2,
			Detail:   `func (from "log")`,
			TextEdit: rawTextEdit,
			Command:  &lsp.Command{Title: "noop", Command: "noop"},
			Data:     map[string]any{"uri": "file:///tmp/main.go"},
		}},
	})
	if !ok {
		t.Fatal("expected generated import edit to attach to trusted LSP member")
	}
	if len(result.Items) != 1 {
		t.Fatalf("expected one item, got %d", len(result.Items))
	}
	item := result.Items[0]
	if len(item.AdditionalTextEdits) != 1 {
		t.Fatalf("expected generated import edit, got %#v", item.AdditionalTextEdits)
	}
	if !strings.Contains(item.AdditionalTextEdits[0].NewText, `"log"`) {
		t.Fatalf("expected log import edit, got %#v", item.AdditionalTextEdits[0])
	}
	if string(item.TextEdit) != string(rawTextEdit) {
		t.Fatalf("expected real-document text edit to remain unmapped, got %s want %s", item.TextEdit, rawTextEdit)
	}
	if item.Command == nil || item.Data == nil {
		t.Fatalf("expected normal LSP side effects to be preserved, got command=%#v data=%#v", item.Command, item.Data)
	}
}

func TestAttachGeneratedAccessImportEdit_UsesLSPImportEvidenceWhenCatalogMissing(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache:       map[string]dependencyCacheEntry{"go": {fingerprint: "", entries: nil}},
			cacheStatus: map[string]string{},
		},
	}

	content := []byte(`package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	log.
}
`)
	ctx := CompletionContext{
		FilePath:     "/tmp/main.go",
		Language:     "go",
		AccessChain:  "log.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         12,
		Column:       6,
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "go", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{{
			Label:  "Fatalf",
			Kind:   2,
			Detail: `func (from "log")`,
		}},
	})
	if !ok {
		t.Fatal("expected generated import edit from LSP import evidence")
	}
	if len(result.Items) != 1 || len(result.Items[0].AdditionalTextEdits) != 1 {
		t.Fatalf("expected one generated import edit, got %#v", result.Items)
	}
	if got := result.Items[0].AdditionalTextEdits[0].NewText; !strings.Contains(got, `"log"`) || strings.Contains(got, `import "log"`) {
		t.Fatalf("expected log import inserted into existing import block, got %q", got)
	}
}

func TestAttachGeneratedAccessImportEdit_RejectsAmbiguousLSPImportEvidence(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache:       map[string]dependencyCacheEntry{"go": {fingerprint: "", entries: nil}},
			cacheStatus: map[string]string{},
		},
	}

	content := []byte("package main\n\nfunc main() {\n\tlog.\n}\n")
	ctx := CompletionContext{
		FilePath:     "/tmp/main.go",
		Language:     "go",
		AccessChain:  "log.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         4,
		Column:       6,
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "go", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{
			{Label: "Fatal", Kind: 2, Detail: `func (from "alpha/log")`},
			{Label: "Fatalf", Kind: 2, Detail: `func (from "beta/log")`},
		},
	})
	if ok {
		t.Fatalf("expected ambiguous LSP import evidence to be rejected, got %#v", result.Items)
	}
	for _, item := range result.Items {
		if len(item.AdditionalTextEdits) != 0 {
			t.Fatalf("expected no generated imports for ambiguous evidence, got %#v", result.Items)
		}
	}
}

func TestAttachGeneratedAccessImportEdit_DoesNotInventImportWithoutCatalogOwner(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache:       map[string]dependencyCacheEntry{"typescript": {fingerprint: "", entries: nil}},
			cacheStatus: map[string]string{},
		},
	}

	content := []byte(`axios.
`)
	ctx := CompletionContext{
		FilePath:     "/tmp/main.ts",
		Language:     "typescript",
		AccessChain:  "axios.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         1,
		Column:       7,
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "typescript", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{{Label: "get", Kind: 2}},
	})
	if ok {
		t.Fatalf("expected no generated import without catalog owner, got %#v", result.Items)
	}
	if len(result.Items) != 1 || len(result.Items[0].AdditionalTextEdits) != 0 {
		t.Fatalf("expected LSP item to stay untouched, got %#v", result.Items)
	}
}

func TestAttachGeneratedAccessImportEdit_DoesNotAttachToLocalReceiverWithoutImportEvidence(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache: map[string]dependencyCacheEntry{
				"typescript": {
					fingerprint: "",
					entries: []dependencyEntry{{
						Name:   "router",
						Kind:   core.SymbolKindModule,
						Source: core.SourceLibrary,
					}},
				},
			},
			cacheStatus: map[string]string{},
		},
	}

	content := []byte(`router.
`)
	ctx := CompletionContext{
		FilePath:     "/tmp/main.ts",
		Language:     "typescript",
		AccessChain:  "router.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         1,
		Column:       8,
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "typescript", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{{
			Label:  "handle",
			Kind:   2,
			Detail: "func()",
		}},
	})
	if ok {
		t.Fatalf("expected no generated import for local receiver-like item, got %#v", result.Items)
	}
	if len(result.Items) != 1 || len(result.Items[0].AdditionalTextEdits) != 0 {
		t.Fatalf("expected LSP item to stay untouched, got %#v", result.Items)
	}
}

func TestAttachGeneratedAccessImportEdit_DoesNotAttachForAmbiguousCatalogOwner(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache: map[string]dependencyCacheEntry{
				"node": {
					fingerprint: "",
					entries: []dependencyEntry{
						{Name: "alpha/client", Kind: core.SymbolKindModule, Source: core.SourceLibrary, Owner: "client"},
						{Name: "beta/client", Kind: core.SymbolKindModule, Source: core.SourceLibrary, Owner: "client"},
					},
				},
			},
			cacheStatus: map[string]string{},
		},
	}

	content := []byte(`client.
`)
	ctx := CompletionContext{
		FilePath:     "/tmp/main.ts",
		Language:     "typescript",
		AccessChain:  "client.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         1,
		Column:       8,
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "typescript", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{{
			Label:  "connect",
			Kind:   2,
			Detail: `func (from "client")`,
		}},
	})
	if ok {
		t.Fatalf("expected no generated import for ambiguous owner, got %#v", result.Items)
	}
	if len(result.Items) != 1 || len(result.Items[0].AdditionalTextEdits) != 0 {
		t.Fatalf("expected LSP item to stay untouched, got %#v", result.Items)
	}
}

func TestAttachGeneratedAccessImportEdit_DoesNotBypassAmbiguousProjectOwnerWithLSPEvidence(t *testing.T) {
	root := t.TempDir()
	engine, err := core.NewEngine(core.EngineConfig{
		ProjectID:   "ambiguous-project-lsp-evidence-owner",
		ProjectRoot: root,
		DBPath:      filepath.Join(root, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	if err := engine.Store().SaveSymbols([]core.Symbol{
		{
			Name:       "client",
			Kind:       core.SymbolKindPackage,
			Language:   "go",
			Namespace:  "example.com/app/client",
			FilePath:   filepath.Join(root, "client", "client.go"),
			Source:     core.SourceIndex,
			Confidence: 0.95,
		},
		{
			Name:       "client",
			Kind:       core.SymbolKindPackage,
			Language:   "go",
			Namespace:  "example.com/app/other/client",
			FilePath:   filepath.Join(root, "other", "client", "client.go"),
			Source:     core.SourceIndex,
			Confidence: 0.95,
		},
	}); err != nil {
		t.Fatalf("SaveSymbols: %v", err)
	}

	brain := NewPredictionBrain(engine, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions.catalog = &dependencyCatalog{
		cache:       map[string]dependencyCacheEntry{"go": {fingerprint: "", entries: nil}},
		cacheStatus: map[string]string{},
	}

	content := []byte("package main\n\nfunc main() {\n\tclient.\n}\n")
	ctx := CompletionContext{
		FilePath:     filepath.Join(root, "main.go"),
		Language:     "go",
		AccessChain:  "client.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         4,
		Column:       9,
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "go", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{{
			Label:  "Dial",
			Kind:   2,
			Detail: `func (from "client")`,
		}},
	})
	if ok {
		t.Fatalf("expected no generated import for ambiguous project owner, got %#v", result.Items)
	}
	if len(result.Items) != 1 || len(result.Items[0].AdditionalTextEdits) != 0 {
		t.Fatalf("expected LSP item to stay untouched, got %#v", result.Items)
	}
}

func TestAttachGeneratedAccessImportEdit_PreservesLSPEditsAndEnrichesTrustedMissingItems(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache: map[string]dependencyCacheEntry{
				"go": {
					fingerprint: "",
					entries: []dependencyEntry{{
						Name:   "log",
						Kind:   core.SymbolKindPackage,
						Source: core.SourceLibrary,
					}},
				},
			},
			cacheStatus: map[string]string{},
		},
	}

	content := []byte(`package main

func main() {
	log.
}
`)
	ctx := CompletionContext{
		FilePath:     "/tmp/main.go",
		Language:     "go",
		AccessChain:  "log.",
		IsMethodCall: true,
		Content:      content,
		FullContent:  content,
		Line:         4,
		Column:       6,
	}
	lspImportEdit := lsp.TextEdit{
		Range:   lsp.Range{Start: lsp.Position{Line: 1, Character: 0}, End: lsp.Position{Line: 1, Character: 0}},
		NewText: "import \"log\"\n\n",
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "go", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{
			{
				Label:               "Print",
				Kind:                2,
				Detail:              `func (from "log")`,
				AdditionalTextEdits: []lsp.TextEdit{lspImportEdit},
			},
			{
				Label:  "Fatal",
				Kind:   2,
				Detail: "func Fatal(v ...any)",
			},
			{
				Label:        "fallbackOnlyMethod",
				Kind:         2,
				Detail:       "func()",
				FallbackOnly: true,
			},
		},
	})
	if !ok {
		t.Fatal("expected generated import edit to attach to trusted missing item")
	}
	if len(result.Items) != 3 {
		t.Fatalf("expected three items, got %d", len(result.Items))
	}
	if len(result.Items[0].AdditionalTextEdits) != 1 || result.Items[0].AdditionalTextEdits[0].NewText != lspImportEdit.NewText {
		t.Fatalf("expected existing LSP import edit to survive unchanged, got %#v", result.Items[0].AdditionalTextEdits)
	}
	if len(result.Items[1].AdditionalTextEdits) != 1 || !strings.Contains(result.Items[1].AdditionalTextEdits[0].NewText, `"log"`) {
		t.Fatalf("expected generated log import edit on detail-less trusted item, got %#v", result.Items[1].AdditionalTextEdits)
	}
	if len(result.Items[2].AdditionalTextEdits) != 0 {
		t.Fatalf("expected fallback-only item to stay without generated import, got %#v", result.Items[2].AdditionalTextEdits)
	}
}

func TestAttachGeneratedAccessImportEdit_SkipsAlreadyResolvedOwner(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 50, MinConfidence: 0.1})
	brain.importCompletions = &ImportCompletionProvider{
		catalog: &dependencyCatalog{
			cache: map[string]dependencyCacheEntry{
				"go": {
					fingerprint: "",
					entries: []dependencyEntry{{
						Name:   "log",
						Kind:   core.SymbolKindPackage,
						Source: core.SourceLibrary,
					}},
				},
			},
			cacheStatus: map[string]string{},
		},
	}

	ctx := CompletionContext{
		FilePath:          "/tmp/main.go",
		Language:          "go",
		AccessChain:       "log.",
		IsMethodCall:      true,
		ResolvedNamespace: "log",
		Content:           []byte("package main\n"),
		FullContent:       []byte("package main\n"),
		Line:              1,
		Column:            1,
	}
	result, ok := brain.attachGeneratedAccessImportEdit(ctx, "go", lsp.CompletionResponse{
		Items: []lsp.CompletionItem{{
			Label:  "Fatal",
			Kind:   2,
			Detail: `func (from "log")`,
		}},
	})
	if ok {
		t.Fatalf("expected no generated import for resolved owner, got %#v", result.Items)
	}
	if len(result.Items) != 1 || len(result.Items[0].AdditionalTextEdits) != 0 {
		t.Fatalf("expected item to stay untouched, got %#v", result.Items)
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

	match := Suggestion{Text: "string", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "zod", ProofKind: "receiver-member"}
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

	match := Suggestion{Text: "string", Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: "zod", ProofKind: "receiver-member"}
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
				{Text: tt.want, Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: tt.resolvedNamespace, ProofKind: "receiver-member"},
				{Text: tt.noise, Kind: core.SymbolKindFunction, Source: core.SourceLibrary, Namespace: tt.noiseNamespace, ProofKind: "receiver-member"},
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
