package adapters

import (
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestPHPAdapter_ParsesGroupedAndAliasedUses(t *testing.T) {
	adapter := NewPHPAdapter()
	_, edges, err := adapter.ParseContent("UserController.php", []byte(`<?php
use App\Models\{User, Post as BlogPost};
use App\Services\UserService as Service;

class UserController {}
`))
	if err != nil {
		t.Fatalf("ParseContent: %v", err)
	}
	for _, want := range []string{`App\Models\User`, `App\Models\Post`, `App\Services\UserService`} {
		if !hasPHPEdge(edges, want) {
			t.Fatalf("missing PHP use edge %q: %#v", want, edges)
		}
	}
}

func hasPHPEdge(edges []core.Edge, target string) bool {
	for _, edge := range edges {
		if edge.Kind == core.EdgeKindImports && edge.ToSymbol == target {
			return true
		}
	}
	return false
}
