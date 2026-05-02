package autocomplete

import "testing"

func TestResolveLanguage(t *testing.T) {
	tests := []struct {
		name       string
		language   string
		filePath   string
		canonical  string
		lsp        string
		index      string
		predictive string
		keyword    string
		fill       string
	}{
		{name: "typescript", language: "typescript", filePath: "app.ts", canonical: "typescript", lsp: "typescript", index: "typescript", predictive: "typescript", keyword: "typescript", fill: "typescript"},
		{name: "typescript react", language: "typescriptreact", filePath: "app.tsx", canonical: "typescriptreact", lsp: "typescriptreact", index: "typescript", predictive: "typescript", keyword: "typescript", fill: "typescript"},
		{name: "javascript", language: "javascript", filePath: "app.js", canonical: "javascript", lsp: "javascript", index: "typescript", predictive: "", keyword: "javascript", fill: "javascript"},
		{name: "javascript react", language: "javascriptreact", filePath: "app.jsx", canonical: "javascriptreact", lsp: "javascriptreact", index: "typescript", predictive: "", keyword: "javascript", fill: "javascript"},
		{name: "vue", language: "vue", filePath: "App.vue", canonical: "vue", lsp: "vue", index: "vue", predictive: "vue", keyword: "javascript", fill: ""},
		{name: "svelte", language: "svelte", filePath: "App.svelte", canonical: "svelte", lsp: "svelte", index: "", predictive: "", keyword: "javascript", fill: ""},
		{name: "astro", language: "astro", filePath: "page.astro", canonical: "astro", lsp: "astro", index: "", predictive: "typescript", keyword: "typescript", fill: "typescript"},
		{name: "blade", language: "blade", filePath: "welcome.blade.php", canonical: "blade", lsp: "blade", index: "", predictive: "", keyword: "blade", fill: ""},
		{name: "scss", language: "scss", filePath: "style.scss", canonical: "scss", lsp: "scss", index: "", predictive: "", keyword: "css", fill: ""},
		{name: "sass", language: "sass", filePath: "style.sass", canonical: "sass", lsp: "sass", index: "", predictive: "", keyword: "css", fill: ""},
		{name: "less", language: "less", filePath: "style.less", canonical: "less", lsp: "less", index: "", predictive: "", keyword: "css", fill: ""},
		{name: "shell alias", language: "sh", filePath: "script.sh", canonical: "bash", lsp: "bash", index: "", predictive: "", keyword: "bash", fill: ""},
		{name: "ruby", language: "ruby", filePath: "app.rb", canonical: "ruby", lsp: "ruby", index: "ruby", predictive: "ruby", keyword: "ruby", fill: ""},
		{name: "rust", language: "rust", filePath: "main.rs", canonical: "rust", lsp: "rust", index: "", predictive: "", keyword: "rust", fill: ""},
		{name: "unknown remains unknown", language: "unknown", filePath: "README.unknown", canonical: "unknown", lsp: "", index: "", predictive: "", keyword: "unknown", fill: ""},
		{name: "infer from path", language: "", filePath: "component.tsx", canonical: "typescriptreact", lsp: "typescriptreact", index: "typescript", predictive: "typescript", keyword: "typescript", fill: "typescript"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Resolve(tt.language, tt.filePath)
			if got.CanonicalID != tt.canonical || got.LSPID != tt.lsp || got.IndexID != tt.index ||
				got.PredictiveID != tt.predictive || got.KeywordID != tt.keyword || got.FillID != tt.fill {
				t.Fatalf("Resolve()=%+v", got)
			}
		})
	}
}

func TestCapabilityTiers(t *testing.T) {
	available := map[string]bool{
		"php":        true,
		"go":         true,
		"typescript": true,
		"python":     true,
		"rust":       true,
		"java":       true,
		"cpp":        true,
	}
	hasLSP := func(language string) bool {
		return available[language]
	}

	for _, language := range []string{"php", "go", "python", "typescript"} {
		t.Run(language+" native", func(t *testing.T) {
			got := CapabilityForLanguage(language, "", hasLSP)
			if got.Tier != TierNative && got.Tier != TierHybrid {
				t.Fatalf("expected native or hybrid tier for %s, got %+v", language, got)
			}
		})
	}

	for _, language := range []string{"rust", "java", "cpp"} {
		t.Run(language+" lsp only", func(t *testing.T) {
			got := CapabilityForLanguage(language, "", hasLSP)
			if got.Tier != TierLSPOnly {
				t.Fatalf("expected lsp-only tier for %s, got %+v", language, got)
			}
		})
		t.Run(language+" syntax only", func(t *testing.T) {
			got := CapabilityForLanguage(language, "", nil)
			if got.Tier != TierSyntaxOnly {
				t.Fatalf("expected syntax-only tier for %s, got %+v", language, got)
			}
		})
	}
}
