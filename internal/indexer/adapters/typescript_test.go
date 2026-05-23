package adapters

import (
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestTypeScriptAdapter_ParsesImportEdges(t *testing.T) {
	adapter := NewTypeScriptAdapter()
	_, edges, err := adapter.ParseContent("main.ts", []byte(`
import React from 'react'
import type { User } from './types'
import './global.css'
export { Button } from './Button'
const page = await import('./pages/Home')
`))
	if err != nil {
		t.Fatalf("ParseContent: %v", err)
	}
	for _, want := range []string{"react", "./types", "./global.css", "./Button", "./pages/Home"} {
		if !hasTypeScriptImport(edges, want) {
			t.Fatalf("missing import edge %q: %#v", want, edges)
		}
	}
}

func hasTypeScriptImport(edges []core.Edge, target string) bool {
	for _, edge := range edges {
		if edge.Kind == core.EdgeKindImports && edge.ToSymbol == target {
			return true
		}
	}
	return false
}
