package adapters

import "arlecchino/internal/indexer/core"

// DefaultRegexAdapters returns additional regex-based adapters.
// Currently returns an empty slice - extend as needed for additional languages.
func DefaultRegexAdapters() []core.LanguageAdapter {
	return []core.LanguageAdapter{}
}
