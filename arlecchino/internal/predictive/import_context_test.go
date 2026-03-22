package predictive

import "testing"

func TestDetectImportContextFromText(t *testing.T) {
	tests := []struct {
		name     string
		language string
		text     string
		want     bool
	}{
		{name: "go import", language: "go", text: "import \"fm", want: true},
		{name: "go grouped import", language: "go", text: "import (", want: true},
		{name: "javascript import from", language: "javascript", text: "import React from \"rea", want: true},
		{name: "typescript import from", language: "typescript", text: "import { QueryClient } from \"@tan", want: true},
		{name: "astro frontmatter import", language: "astro", text: "---\nimport React from \"rea", want: true},
		{name: "css import", language: "css", text: "@import \"tailw", want: true},
		{name: "python import", language: "python", text: "import pan", want: true},
		{name: "python from import", language: "python", text: "from pan", want: true},
		{name: "php use", language: "php", text: "<?php\nuse guzz", want: true},
		{name: "rust use", language: "rust", text: "use tok", want: true},
		{name: "ruby require", language: "ruby", text: "require \"far", want: true},
		{name: "java import", language: "java", text: "import org.spring", want: true},
		{name: "csharp using", language: "csharp", text: "using Newt", want: true},
		{name: "fsharp open", language: "fsharp", text: "open Newt", want: true},
		{name: "dart import", language: "dart", text: "import 'di", want: true},
		{name: "swift import", language: "swift", text: "import Ala", want: true},
		{name: "empty text", language: "go", text: "", want: false},
		{name: "non import line", language: "javascript", text: "const value = rea", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := DetectImportContextFromText(tt.text, tt.language); got != tt.want {
				t.Fatalf("DetectImportContextFromText(%q, %q) = %v, want %v", tt.text, tt.language, got, tt.want)
			}
		})
	}
}
