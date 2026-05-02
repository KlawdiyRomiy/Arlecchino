package brain

import (
	"strings"
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestImportEditPlanner_GoConvertsSingleImportToBlock(t *testing.T) {
	planner := NewImportEditPlanner()
	ctx := CompletionContext{
		Language: "go",
		FullContent: []byte(`package main

import "time"

func main() {}
`),
	}

	edit, changed := planner.PlanImportEdit(ctx, `import "fmt"`, 3)
	if !changed || edit == nil {
		t.Fatal("expected grouped Go import edit")
	}
	if edit.StartLine != 3 || edit.Text != "import (\n\t\"time\"\n\t\"fmt\"\n)" {
		t.Fatalf("unexpected Go edit: %#v", edit)
	}
}

func TestImportEditPlanner_GoInsertsIntoExistingBlock(t *testing.T) {
	planner := NewImportEditPlanner()
	ctx := CompletionContext{
		Language: "go",
		FullContent: []byte(`package main

import (
	"time"
)

func main() {}
`),
	}

	edit, changed := planner.PlanImportEdit(ctx, `import "fmt"`, 4)
	if !changed || edit == nil {
		t.Fatal("expected Go block insertion")
	}
	if edit.StartLine != 5 || edit.Text != "\t\"fmt\"\n" {
		t.Fatalf("unexpected Go block edit: %#v", edit)
	}
}

func TestImportEditPlanner_GroupedLanguageMatrix(t *testing.T) {
	tests := []struct {
		name     string
		language string
		content  string
		stmt     string
		want     string
	}{
		{name: "php", language: "php", content: "<?php\nuse App\\Models\\User;\n", stmt: "use App\\Models\\Post;", want: "use App\\Models\\{User, Post};"},
		{name: "typescript", language: "typescript", content: "import { useState } from 'react';\n", stmt: "import { useMemo } from 'react';", want: "import { useState, useMemo } from 'react';"},
		{name: "javascriptreact", language: "javascriptreact", content: "import { useState } from \"react\";\n", stmt: "import { useMemo } from \"react\";", want: "import { useState, useMemo } from \"react\";"},
		{name: "solidity", language: "solidity", content: "import { A } from \"./lib.sol\";\n", stmt: "import { B } from \"./lib.sol\";", want: "import { A, B } from \"./lib.sol\";"},
		{name: "python from", language: "python", content: "from os import path\n", stmt: "from os import environ", want: "from os import (path, environ)"},
		{name: "python import", language: "python", content: "import os\n", stmt: "import sys", want: "import os, sys"},
		{name: "rust", language: "rust", content: "use std::fmt;\n", stmt: "use std::io;", want: "use std::{fmt, io};"},
		{name: "scala", language: "scala", content: "import scala.collection.mutable.ListBuffer\n", stmt: "import scala.collection.mutable.Map", want: "import scala.collection.mutable.{ListBuffer, Map}"},
		{name: "dart", language: "dart", content: "import 'dart:math' show Random;\n", stmt: "import 'dart:math' show max;", want: "import 'dart:math' show Random, max;"},
		{name: "julia", language: "julia", content: "using Foo: a\n", stmt: "using Foo: b", want: "using Foo: a, b"},
		{name: "haskell", language: "haskell", content: "import Data.List (nub)\n", stmt: "import Data.List (sort)", want: "import Data.List (nub, sort)"},
		{name: "clojure", language: "clojure", content: "(:import [java.util Date])\n", stmt: "(:import [java.util UUID])", want: "(:import [java.util Date UUID])"},
		{name: "erlang", language: "erlang", content: "-import(lists,[map/2]).\n", stmt: "-import(lists,[foldl/3]).", want: "-import(lists,[map/2, foldl/3])."},
		{name: "fortran", language: "fortran", content: "use iso_c_binding, only: c_int\n", stmt: "use iso_c_binding, only: c_double", want: "use iso_c_binding, only: c_int, c_double"},
		{name: "ada", language: "ada", content: "with Ada.Text_IO;\n", stmt: "with Ada.Strings;", want: "with Ada.Text_IO, Ada.Strings;"},
		{name: "delphi", language: "delphi", content: "uses SysUtils;\n", stmt: "uses Classes;", want: "uses SysUtils, Classes;"},
		{name: "matlab", language: "matlab", content: "import java.util.Currency\n", stmt: "import java.lang.String", want: "import java.util.Currency java.lang.String"},
		{name: "latex", language: "latex", content: "\\usepackage{amsmath}\n", stmt: "\\usepackage{graphicx}", want: "\\usepackage{amsmath,graphicx}"},
		{name: "perl", language: "perl", content: "use List::Util qw(sum);\n", stmt: "use List::Util qw(max);", want: "use List::Util qw(sum max);"},
	}

	planner := NewImportEditPlanner()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			edit, changed := planner.PlanImportEdit(CompletionContext{
				Language:    tt.language,
				FullContent: []byte(tt.content),
			}, tt.stmt, 1)
			if !changed || edit == nil {
				t.Fatalf("expected grouped edit")
			}
			if edit.Text != tt.want {
				t.Fatalf("edit.Text = %q, want %q", edit.Text, tt.want)
			}
		})
	}
}

func TestImportEditPlanner_FallbackLanguagesStayPerLine(t *testing.T) {
	planner := NewImportEditPlanner()
	for _, language := range []string{"ruby", "c", "cpp", "java", "kotlin", "csharp", "fsharp", "swift"} {
		t.Run(language, func(t *testing.T) {
			edit, changed := planner.PlanImportEdit(CompletionContext{
				Language:    language,
				FullContent: []byte("require 'json'\n"),
			}, "require 'time'", 1)
			if changed || edit != nil {
				t.Fatalf("expected no grouped edit for %s, got %#v", language, edit)
			}
		})
	}
}

func TestImportEditPlanner_NormalizesSafeLSPEdit(t *testing.T) {
	planner := NewImportEditPlanner()
	edits := planner.NormalizeTextEdits(CompletionContext{
		Language: "go",
		FullContent: []byte(`package main

import "time"

func main() {}
`),
	}, []core.TextEdit{{
		StartLine:   5,
		StartColumn: 1,
		EndLine:     5,
		EndColumn:   1,
		Text:        "import \"fmt\"\n",
	}})

	if len(edits) != 1 {
		t.Fatalf("expected one edit, got %d", len(edits))
	}
	if edits[0].StartLine != 3 || edits[0].Text != "import (\n\t\"time\"\n\t\"fmt\"\n)" {
		t.Fatalf("unexpected normalized LSP edit: %#v", edits[0])
	}
}

func TestAutoImporter_UsesFullContentForGroupedImports(t *testing.T) {
	ai := NewAutoImporter()
	edit := ai.GenerateImportEdit(&core.Symbol{
		Name:      "Println",
		Kind:      core.SymbolKindFunction,
		Namespace: "fmt",
	}, CompletionContext{
		Language: "go",
		Content:  []byte("func main() {\n\tfmt.Println()\n}\n"),
		FullContent: []byte(`package main

import "time"

func main() {
	fmt.Println()
}
`),
	})

	if edit == nil {
		t.Fatal("expected import edit")
	}
	if edit.StartLine != 3 || edit.Text != "import (\n\t\"time\"\n\t\"fmt\"\n)" {
		t.Fatalf("unexpected full-content import edit: %#v", edit)
	}
}

func TestAutoImporter_MergesSameModuleNamedImports(t *testing.T) {
	ai := NewAutoImporter()
	edit := ai.GenerateImportEdit(&core.Symbol{
		Name:      "useMemo",
		Kind:      core.SymbolKindFunction,
		Namespace: "react",
	}, CompletionContext{
		Language:    "typescript",
		FullContent: []byte("import { useState } from 'react';\n\nconst value = useMemo\n"),
	})

	if edit == nil {
		t.Fatal("expected import edit")
	}
	if !strings.Contains(edit.Text, "useState, useMemo") {
		t.Fatalf("expected merged named import, got %#v", edit)
	}
}
