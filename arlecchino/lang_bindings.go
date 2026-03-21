package main

import (
	"path/filepath"
	"strings"
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
	ext := strings.ToLower(filepath.Ext(filePath))
	extMap := map[string]string{
		".py": "Python", ".js": "JavaScript", ".ts": "TypeScript",
		".go": "Go", ".rs": "Rust", ".php": "PHP", ".rb": "Ruby",
		".java": "Java", ".kt": "Kotlin", ".swift": "Swift",
		".c": "C", ".cpp": "C++", ".h": "C", ".hpp": "C++",
		".cs": "C#", ".scala": "Scala", ".sh": "Shell",
		".sql": "SQL", ".html": "HTML", ".json": "JSON",
		".yaml": "YAML", ".yml": "YAML", ".xml": "XML",
		".md": "Markdown", ".toml": "TOML",
	}

	if lang, ok := extMap[ext]; ok {
		return lang
	}

	if a.langDetector != nil && a.langDetector.IsLoaded() && content != "" {
		lang, conf := a.langDetector.Detect(content)
		if conf > 0.7 {
			return lang
		}
	}

	return "unknown"
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
