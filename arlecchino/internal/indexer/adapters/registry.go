package adapters

import (
	"arlecchino/internal/indexer/core"
)

func RegisterAll(engine *core.PredictionEngine, framework string) {
	engine.RegisterAdapter(NewGoAdapter())
	engine.RegisterAdapter(NewTypeScriptAdapter())
	engine.RegisterAdapter(NewPythonAdapter())
	engine.RegisterAdapter(NewRubyAdapter())
	engine.RegisterAdapter(NewVueAdapter())
	for _, adapter := range DefaultRegexAdapters() {
		engine.RegisterAdapter(adapter)
	}

	switch framework {
	case "laravel":
		engine.RegisterAdapter(NewLaravelAdapter())
	default:
		engine.RegisterAdapter(NewPHPAdapter())
	}
}

func AllAdapters(framework string) []core.LanguageAdapter {
	adapters := []core.LanguageAdapter{
		NewGoAdapter(),
		NewTypeScriptAdapter(),
		NewPythonAdapter(),
		NewRubyAdapter(),
		NewVueAdapter(),
	}
	adapters = append(adapters, DefaultRegexAdapters()...)

	switch framework {
	case "laravel":
		adapters = append(adapters, NewLaravelAdapter())
	default:
		adapters = append(adapters, NewPHPAdapter())
	}

	return adapters
}
