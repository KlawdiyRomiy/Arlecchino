package brain

import (
	"fmt"
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestStubProvider_GetContextCompletions_ResolvesGoImportAlias(t *testing.T) {
	provider := NewStubProvider()
	provider.UpsertPackageStub("go", "charm.land/bubbletea/v2", &PackageStub{
		Package:  "charm.land/bubbletea/v2",
		Language: "go",
		Exports: map[string]StubExport{
			"NewProgram": {
				Signature:   "func NewProgram(model Model, opts ...ProgramOption) *Program",
				Description: "Create a new Bubble Tea program",
				Kind:        "function",
				Popularity:  100,
			},
			"Quit": {
				Signature:   "func Quit() Msg",
				Description: "Quit the active program",
				Kind:        "function",
				Popularity:  90,
			},
		},
	})

	ctx := CompletionContext{
		Language:    "go",
		Prefix:      "New",
		AccessChain: "tea.",
		Content: []byte(`package main

import tea "charm.land/bubbletea/v2"

func main() {
	tea.
}
`),
	}

	suggestions := provider.GetContextCompletions(ctx)
	assertSuggestionText(t, suggestions, "NewProgram")
	assertSuggestionSource(t, suggestions, "NewProgram", core.SourceLibrary)
	assertSuggestionNamespace(t, suggestions, "NewProgram", "charm.land/bubbletea/v2")
}

func TestStubProvider_GetContextCompletions_BuildsGoStdlibSnapshot(t *testing.T) {
	provider := NewStubProvider()
	provider.runner = func(name string, args ...string) ([]byte, error) {
		if name != "go" {
			return nil, fmt.Errorf("unexpected command %q", name)
		}
		if len(args) != 3 || args[0] != "doc" || args[1] != "-all" || args[2] != "fmt" {
			return nil, fmt.Errorf("unexpected args %#v", args)
		}
		return []byte("func Println(a ...any) (n int, err error)\ntype Formatter interface{}\n"), nil
	}

	ctx := CompletionContext{
		Language:    "go",
		Prefix:      "Print",
		AccessChain: "fmt.",
		Content: []byte(`package main

import "fmt"

func main() {
	fmt.
}
`),
	}

	suggestions := provider.GetContextCompletions(ctx)
	assertSuggestionText(t, suggestions, "Println")
	assertSuggestionSource(t, suggestions, "Println", core.SourceLibrary)
	assertSuggestionNamespace(t, suggestions, "Println", "fmt")
	if !provider.HasPackage("fmt", "go") {
		t.Fatalf("expected stdlib package stub to be cached")
	}
}

func TestStubProvider_GetContextCompletions_ResolvesJSImportAlias(t *testing.T) {
	provider := NewStubProvider()
	provider.UpsertPackageStub("typescript", "react", &PackageStub{
		Package:  "react",
		Language: "typescript",
		Exports: map[string]StubExport{
			"useState": {Signature: "function useState<T>(initial: T): [T, Dispatch<T>]", Kind: "function", Popularity: 100},
		},
	})

	ctx := CompletionContext{
		Language:    "typescript",
		Prefix:      "use",
		AccessChain: "React.",
		Content: []byte(`import * as React from 'react'

React.
`),
	}

	suggestions := provider.GetContextCompletions(ctx)
	assertSuggestionText(t, suggestions, "useState")
	assertSuggestionSource(t, suggestions, "useState", core.SourceLibrary)
	assertSuggestionNamespace(t, suggestions, "useState", "react")
}

func TestStubProvider_GetContextCompletions_ResolvesPythonImportAlias(t *testing.T) {
	provider := NewStubProvider()
	provider.UpsertPackageStub("python", "pandas", &PackageStub{
		Package:  "pandas",
		Language: "python",
		Exports: map[string]StubExport{
			"DataFrame": {Signature: "class DataFrame", Kind: "class", Popularity: 100},
		},
	})

	ctx := CompletionContext{
		Language:    "python",
		Prefix:      "Dat",
		AccessChain: "pd.",
		Content: []byte(`import pandas as pd

pd.
`),
	}

	suggestions := provider.GetContextCompletions(ctx)
	assertSuggestionText(t, suggestions, "DataFrame")
	assertSuggestionSource(t, suggestions, "DataFrame", core.SourceLibrary)
	assertSuggestionNamespace(t, suggestions, "DataFrame", "pandas")
}

func assertSuggestionNamespace(t *testing.T, suggestions []Suggestion, wantText, wantNamespace string) {
	t.Helper()
	for _, suggestion := range suggestions {
		if suggestion.Text == wantText {
			if suggestion.Namespace != wantNamespace {
				t.Fatalf("suggestion %q namespace=%q want %q", wantText, suggestion.Namespace, wantNamespace)
			}
			return
		}
	}
	t.Fatalf("expected suggestion %q", wantText)
}
