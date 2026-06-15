package adapters

import (
	"strings"
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestAdapters_ParseContentContinuesAfterLongLines(t *testing.T) {
	longLine := strings.Repeat("x", 70*1024)
	withLongLines := func(valid string) []byte {
		return []byte(longLine + "\n" + valid + "\n" + longLine + "\n")
	}

	tests := []struct {
		name       string
		parse      func([]byte) ([]core.Symbol, []core.Edge, error)
		wantSymbol string
		wantEdge   string
	}{
		{
			name: "go",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewGoAdapter().ParseContent("main.go", append([]byte("package main\n"), content...))
			},
			wantSymbol: "AfterLongLine",
		},
		{
			name: "typescript",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewTypeScriptAdapter().ParseContent("sample.ts", content)
			},
			wantSymbol: "afterLongLine",
		},
		{
			name: "python",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewPythonAdapter().ParseContent("sample.py", content)
			},
			wantSymbol: "after_long_line",
		},
		{
			name: "php",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewPHPAdapter().ParseContent("sample.php", append([]byte("<?php\n"), content...))
			},
			wantSymbol: "afterLongLine",
		},
		{
			name: "ruby",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewRubyAdapter().ParseContent("sample.rb", content)
			},
			wantSymbol: "after_long_line",
		},
		{
			name: "vue",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewVueAdapter().ParseContent("Sample.vue", content)
			},
			wantSymbol: "afterLongLine",
			wantEdge:   "vue",
		},
		{
			name: "laravel blade",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewLaravelAdapter().ParseContent("/project/resources/views/welcome.blade.php", content)
			},
			wantSymbol: "welcome",
			wantEdge:   "partials.nav",
		},
		{
			name: "laravel route",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewLaravelAdapter().ParseContent("/project/routes/web.php", append([]byte("<?php\n"), content...))
			},
			wantSymbol: "/after-long-line",
		},
		{
			name: "generic dependency",
			parse: func(content []byte) ([]core.Symbol, []core.Edge, error) {
				return NewGenericDependencyAdapter("rust", []string{".rs"}).ParseContent("sample.rs", content)
			},
			wantEdge: "crate::after_long_line",
		},
	}

	validContent := map[string]string{
		"go":                 "func AfterLongLine() {}",
		"typescript":         "export function afterLongLine() {}",
		"python":             "def after_long_line():\n    pass",
		"php":                "function afterLongLine() {}",
		"ruby":               "def after_long_line\nend",
		"vue":                "<script setup>\nimport { ref } from 'vue'\nfunction afterLongLine() {}\n</script>",
		"laravel blade":      "@extends('layouts.app')\n@include('partials.nav')",
		"laravel route":      "Route::get('/after-long-line', function () {});",
		"generic dependency": "use crate::after_long_line;",
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			symbols, edges, err := tt.parse(withLongLines(validContent[tt.name]))
			if err != nil {
				t.Fatalf("ParseContent: %v", err)
			}
			if tt.wantSymbol != "" && !containsSymbol(symbols, tt.wantSymbol) {
				t.Fatalf("missing symbol %q after long line: %#v", tt.wantSymbol, symbols)
			}
			if tt.wantEdge != "" && !containsEdge(edges, tt.wantEdge) {
				t.Fatalf("missing edge %q after long line: %#v", tt.wantEdge, edges)
			}
		})
	}
}

func TestGenericDependencyAdapter_ParseContentDoesNotSkipLargeFiles(t *testing.T) {
	content := strings.Repeat("x", 600*1024) + "\nuse crate::after_large_file;\n"

	_, edges, err := NewGenericDependencyAdapter("rust", []string{".rs"}).ParseContent("sample.rs", []byte(content))
	if err != nil {
		t.Fatalf("ParseContent: %v", err)
	}
	if !containsEdge(edges, "crate::after_large_file") {
		t.Fatalf("missing edge from large generic file: %#v", edges)
	}
}

func containsSymbol(symbols []core.Symbol, name string) bool {
	for _, symbol := range symbols {
		if symbol.Name == name {
			return true
		}
	}
	return false
}

func containsEdge(edges []core.Edge, target string) bool {
	for _, edge := range edges {
		if edge.ToSymbol == target {
			return true
		}
	}
	return false
}
