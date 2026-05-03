package main

import (
	"arlecchino/internal/autocomplete"
	lspregistry "arlecchino/internal/lsp"
)

type LanguagePrediction struct {
	Language   string  `json:"language"`
	Confidence float32 `json:"confidence"`
}

func (a *App) DetectLanguage(code string) []LanguagePrediction {
	if a.langDetector == nil || !a.langDetector.IsLoaded() {
		return []LanguagePrediction{{Language: "unknown", Confidence: 0}}
	}

	predictions := a.langDetector.DetectTopK(code, 3)
	result := make([]LanguagePrediction, len(predictions))
	for i, p := range predictions {
		result[i] = LanguagePrediction{
			Language:   p.Language,
			Confidence: p.Confidence,
		}
	}
	return result
}

func (a *App) DetectLanguageFromFile(filePath string, content string) string {
	if language := knownCanonicalLanguage("", filePath); language != "" {
		return language
	}

	if a.langDetector != nil && a.langDetector.IsLoaded() && content != "" {
		lang, conf := a.langDetector.Detect(content)
		if conf > 0.7 {
			if language := knownCanonicalLanguage(lang, filePath); language != "" {
				return language
			}
		}
	}

	return "unknown"
}

func knownCanonicalLanguage(language, filePath string) string {
	resolution := autocomplete.Resolve(language, filePath)
	if lspregistry.GetLanguageByID(resolution.CanonicalID) == nil {
		return ""
	}
	return resolution.CanonicalID
}

func (a *App) GetSupportedLanguages() []string {
	if a.langDetector == nil {
		return []string{}
	}
	return a.langDetector.SupportedLanguages()
}

func (a *App) IsLangDetectorLoaded() bool {
	return a.langDetector != nil && a.langDetector.IsLoaded()
}
