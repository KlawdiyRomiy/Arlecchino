package adapters

import (
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestVueAdapter_ParseContent(t *testing.T) {
	adapter := NewVueAdapter()

	tests := []struct {
		name          string
		filePath      string
		content       string
		wantSymbols   []string
		wantKinds     []core.SymbolKind
		wantEdgeCount int
	}{
		{
			name:     "Composition API with script setup",
			filePath: "UserProfile.vue",
			content: `<script setup>
import { ref, computed } from 'vue'
import { useUser } from '@/composables/useUser'

const name = ref('')
const age = ref(0)

const { user, loading } = useUser()

function handleSubmit() {
  console.log(name.value)
}
</script>

<template>
  <div>{{ name }}</div>
</template>`,
			wantSymbols:   []string{"UserProfile", "name", "age", "handleSubmit"},
			wantKinds:     []core.SymbolKind{core.SymbolKindClass, core.SymbolKindProperty, core.SymbolKindProperty, core.SymbolKindMethod},
			wantEdgeCount: 3,
		},
		{
			name:     "Options API",
			filePath: "Counter.vue",
			content: `<script>
export default {
  name: 'CounterComponent',
  data() {
    return {
      count: 0
    }
  },
  computed: {
    doubled() {
      return this.count * 2
    }
  },
  methods: {
    increment() {
      this.count++
    },
    decrement() {
      this.count--
    }
  }
}
</script>`,
			wantSymbols:   []string{"Counter", "doubled", "increment"},
			wantKinds:     []core.SymbolKind{core.SymbolKindClass, core.SymbolKindProperty, core.SymbolKindMethod},
			wantEdgeCount: 0,
		},
		{
			name:     "Simple component with imports",
			filePath: "Button.vue",
			content: `<script setup>
import { defineProps } from 'vue'
import BaseButton from './BaseButton.vue'

const props = defineProps(['label', 'disabled'])
</script>`,
			wantSymbols:   []string{"Button"},
			wantKinds:     []core.SymbolKind{core.SymbolKindClass},
			wantEdgeCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			symbols, edges, err := adapter.ParseContent(tt.filePath, []byte(tt.content))
			if err != nil {
				t.Fatalf("ParseContent error: %v", err)
			}

			if len(symbols) < len(tt.wantSymbols) {
				t.Errorf("got %d symbols, want at least %d", len(symbols), len(tt.wantSymbols))
				for i, s := range symbols {
					t.Logf("  symbol[%d]: %s (%s)", i, s.Name, s.Kind)
				}
			}

			for i, want := range tt.wantSymbols {
				if i >= len(symbols) {
					t.Errorf("missing symbol[%d]: want %q", i, want)
					continue
				}
				if symbols[i].Name != want {
					t.Errorf("symbol[%d].Name = %q, want %q", i, symbols[i].Name, want)
				}
				if symbols[i].Kind != tt.wantKinds[i] {
					t.Errorf("symbol[%d].Kind = %v, want %v", i, symbols[i].Kind, tt.wantKinds[i])
				}
			}

			if len(edges) != tt.wantEdgeCount {
				t.Errorf("got %d edges, want %d", len(edges), tt.wantEdgeCount)
				for i, e := range edges {
					t.Logf("  edge[%d]: %s -> %s (%s)", i, e.FromSymbol, e.ToSymbol, e.Kind)
				}
			}
		})
	}
}

func TestVueAdapter_Extensions(t *testing.T) {
	adapter := NewVueAdapter()
	exts := adapter.Extensions()

	if len(exts) != 1 || exts[0] != ".vue" {
		t.Errorf("Extensions() = %v, want [\".vue\"]", exts)
	}
}

func TestVueAdapter_Language(t *testing.T) {
	adapter := NewVueAdapter()
	if adapter.Language() != "vue" {
		t.Errorf("Language() = %q, want %q", adapter.Language(), "vue")
	}
}
