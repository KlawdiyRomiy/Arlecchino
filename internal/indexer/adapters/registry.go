package adapters

import (
	"sort"
	"strings"

	"arlecchino/internal/indexer/core"
	lspregistry "arlecchino/internal/lsp"
)

func RegisterAll(engine *core.PredictionEngine, framework string) {
	for _, adapter := range AllAdapters(framework) {
		engine.RegisterAdapter(adapter)
	}
}

func AllAdapters(framework string) []core.LanguageAdapter {
	specialized := []core.LanguageAdapter{
		NewGoAdapter(),
		NewTypeScriptAdapter(),
		NewPythonAdapter(),
		NewRubyAdapter(),
		NewVueAdapter(),
	}

	switch framework {
	case "laravel":
		specialized = append(specialized, NewLaravelAdapter())
	default:
		specialized = append(specialized, NewPHPAdapter())
	}
	specialized = append(specialized, DefaultRegexAdapters()...)

	adapters := append([]core.LanguageAdapter(nil), specialized...)
	owned := adapterOwnedExtensions(specialized)
	languages := lspregistry.GetARLESupportedLanguages()
	sort.Slice(languages, func(i, j int) bool { return languages[i].ID < languages[j].ID })

	for _, info := range languages {
		if info == nil {
			continue
		}
		extensions := make([]string, 0, len(info.Extensions))
		for _, ext := range info.Extensions {
			key := strings.ToLower(strings.TrimSpace(ext))
			if key == "" {
				continue
			}
			if _, ok := owned[key]; ok {
				continue
			}
			owned[key] = struct{}{}
			extensions = append(extensions, ext)
		}
		if len(extensions) == 0 {
			continue
		}
		adapters = append(adapters, NewGenericDependencyAdapter(info.ID, extensions))
	}
	return adapters
}

func adapterOwnedExtensions(adapters []core.LanguageAdapter) map[string]struct{} {
	owned := make(map[string]struct{}, len(adapters)*4)
	for _, adapter := range adapters {
		for _, ext := range adapter.Extensions() {
			key := strings.ToLower(strings.TrimSpace(ext))
			if key != "" {
				owned[key] = struct{}{}
			}
		}
	}
	return owned
}
