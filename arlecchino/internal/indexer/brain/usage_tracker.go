package brain

import (
	"sync"
	"time"

	"arlecchino/internal/indexer/core"
)

type EnhancedUsageTracker struct {
	mu          sync.RWMutex
	entries     map[string]*EnhancedUsageEntry
	contextHits map[string]int
	pairUsage   map[string]int
}

type EnhancedUsageEntry struct {
	Text       string
	Kind       core.SymbolKind
	Count      int
	LastUsed   time.Time
	ByFile     map[string]int
	ByLanguage map[string]int
	ByContext  map[string]int
}

func NewEnhancedUsageTracker() *EnhancedUsageTracker {
	return &EnhancedUsageTracker{
		entries:     make(map[string]*EnhancedUsageEntry),
		contextHits: make(map[string]int),
		pairUsage:   make(map[string]int),
	}
}

func (t *EnhancedUsageTracker) Record(text, filePath, language, context string, kind core.SymbolKind) {
	t.mu.Lock()
	defer t.mu.Unlock()

	key := text + "|" + string(kind)
	entry, ok := t.entries[key]
	if !ok {
		entry = &EnhancedUsageEntry{
			Text:       text,
			Kind:       kind,
			ByFile:     make(map[string]int),
			ByLanguage: make(map[string]int),
			ByContext:  make(map[string]int),
		}
		t.entries[key] = entry
	}

	entry.Count++
	entry.LastUsed = time.Now()
	entry.ByFile[filePath]++
	entry.ByLanguage[language]++
	if context != "" {
		entry.ByContext[context]++
	}

	if context != "" {
		t.contextHits[context+"|"+text]++
	}
}

func (t *EnhancedUsageTracker) RecordPair(first, second string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pairUsage[first+"|"+second]++
}

func (t *EnhancedUsageTracker) GetScore(text string, kind core.SymbolKind, filePath, language, context string) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()

	return t.getScoreLocked(time.Now(), text, kind, filePath, language, context)
}

func (t *EnhancedUsageTracker) GetScoreAt(now time.Time, text string, kind core.SymbolKind, filePath, language, context string) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()

	return t.getScoreLocked(now, text, kind, filePath, language, context)
}

func (t *EnhancedUsageTracker) getScoreLocked(now time.Time, text string, kind core.SymbolKind, filePath, language, context string) float64 {

	key := text + "|" + string(kind)
	entry, ok := t.entries[key]
	if !ok {
		return 0
	}

	score := 0.0

	globalScore := float64(entry.Count) / 100
	if globalScore > 0.3 {
		globalScore = 0.3
	}
	score += globalScore

	if fileCount, ok := entry.ByFile[filePath]; ok {
		fileScore := float64(fileCount) / 20
		if fileScore > 0.4 {
			fileScore = 0.4
		}
		score += fileScore
	}

	if langCount, ok := entry.ByLanguage[language]; ok {
		langScore := float64(langCount) / 50
		if langScore > 0.2 {
			langScore = 0.2
		}
		score += langScore
	}

	if context != "" {
		if ctxCount, ok := entry.ByContext[context]; ok {
			ctxScore := float64(ctxCount) / 30
			if ctxScore > 0.3 {
				ctxScore = 0.3
			}
			score += ctxScore
		}
	}

	recency := now.Sub(entry.LastUsed)
	switch {
	case recency < 30*time.Second:
		score += 0.5
	case recency < time.Minute:
		score += 0.4
	case recency < 5*time.Minute:
		score += 0.3
	case recency < 30*time.Minute:
		score += 0.2
	case recency < time.Hour:
		score += 0.1
	}

	if score > 1.5 {
		score = 1.5
	}

	return score
}

func (t *EnhancedUsageTracker) GetPairScore(first, second string) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()

	count := t.pairUsage[first+"|"+second]
	score := float64(count) / 20
	if score > 0.5 {
		score = 0.5
	}
	return score
}

func (t *EnhancedUsageTracker) GetContextPrediction(context string, limit int) []string {
	t.mu.RLock()
	defer t.mu.RUnlock()

	type scored struct {
		text  string
		count int
	}

	var matches []scored
	prefix := context + "|"
	for key, count := range t.contextHits {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			text := key[len(prefix):]
			matches = append(matches, scored{text, count})
		}
	}

	for i := 0; i < len(matches)-1; i++ {
		for j := i + 1; j < len(matches); j++ {
			if matches[j].count > matches[i].count {
				matches[i], matches[j] = matches[j], matches[i]
			}
		}
	}

	result := make([]string, 0, limit)
	for i := 0; i < len(matches) && i < limit; i++ {
		result = append(result, matches[i].text)
	}
	return result
}

func (t *EnhancedUsageTracker) Cleanup(maxAge time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for key, entry := range t.entries {
		if entry.LastUsed.Before(cutoff) {
			delete(t.entries, key)
		}
	}
}
