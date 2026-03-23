package brain

import (
	"crypto/md5"
	"encoding/hex"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/indexer/core"
)

type PersistentUsageTracker struct {
	mu            sync.RWMutex
	store         *core.Store
	memory        *EnhancedUsageTracker
	recentChain   []string
	maxChainLen   int
	flushInterval time.Duration
	lastFlush     time.Time
	pendingUsages map[string]int
	pendingChains map[string]int
}

func NewPersistentUsageTracker(store *core.Store) *PersistentUsageTracker {
	return &PersistentUsageTracker{
		store:         store,
		memory:        NewEnhancedUsageTracker(),
		recentChain:   make([]string, 0, 5),
		maxChainLen:   5,
		flushInterval: 30 * time.Second,
		lastFlush:     time.Now(),
		pendingUsages: make(map[string]int),
		pendingChains: make(map[string]int),
	}
}

func (t *PersistentUsageTracker) Record(text, filePath, language, context string, kind core.SymbolKind) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.memory.Record(text, filePath, language, context, kind)

	contextHash := t.hashContext(filePath, context)
	key := text + "|" + contextHash
	t.pendingUsages[key]++

	t.updateChain(text)

	if time.Since(t.lastFlush) > t.flushInterval {
		t.flushLocked()
	}
}

func (t *PersistentUsageTracker) RecordPair(first, second string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.memory.RecordPair(first, second)
}

func (t *PersistentUsageTracker) updateChain(symbol string) {
	t.recentChain = append(t.recentChain, symbol)
	if len(t.recentChain) > t.maxChainLen {
		t.recentChain = t.recentChain[1:]
	}

	if len(t.recentChain) >= 2 {
		chain := strings.Join(t.recentChain, "->")
		t.pendingChains[chain]++
	}
}

func (t *PersistentUsageTracker) GetScore(text string, kind core.SymbolKind, filePath, language, context string) float64 {
	t.mu.RLock()
	memoryScore := t.memory.GetScore(text, kind, filePath, language, context)
	t.mu.RUnlock()

	dbScore := 0.0
	if t.store != nil {
		usages, err := t.store.GetSymbolUsage(text, 10)
		if err == nil && len(usages) > 0 {
			totalCount := 0
			for _, u := range usages {
				totalCount += u.UseCount
			}
			dbScore = float64(totalCount) / 100.0
			if dbScore > 0.5 {
				dbScore = 0.5
			}
		}
	}

	return memoryScore + dbScore
}

func (t *PersistentUsageTracker) GetPairScore(first, second string) float64 {
	return t.memory.GetPairScore(first, second)
}

func (t *PersistentUsageTracker) GetChainPredictions(prefix string, limit int) []string {
	if t.store == nil {
		return nil
	}

	coocs, err := t.store.GetCooccurrences(prefix, limit)
	if err != nil {
		return nil
	}

	results := make([]string, 0, len(coocs))
	for _, c := range coocs {
		parts := strings.Split(c.Chain, "->")
		if len(parts) > 0 {
			results = append(results, parts[len(parts)-1])
		}
	}
	return results
}

func (t *PersistentUsageTracker) GetFrequencyScore(symbolName string) float64 {
	if t.store == nil {
		return 0
	}

	usages, err := t.store.GetSymbolUsage(symbolName, 100)
	if err != nil {
		return 0
	}

	totalCount := 0
	for _, u := range usages {
		totalCount += u.UseCount
	}

	score := float64(totalCount) / 50.0
	if score > 1.0 {
		score = 1.0
	}
	return score
}

func (t *PersistentUsageTracker) GetCooccurrenceScore(previous []string, candidate string) float64 {
	if t.store == nil || len(previous) == 0 {
		return 0
	}

	maxScore := 0.0

	for i := len(previous) - 1; i >= 0 && i >= len(previous)-3; i-- {
		chainPrefix := strings.Join(previous[i:], "->")
		fullChain := chainPrefix + "->" + candidate

		coocs, err := t.store.GetCooccurrences(chainPrefix, 20)
		if err != nil {
			continue
		}

		for _, c := range coocs {
			if c.Chain == fullChain {
				score := float64(c.Count) / 30.0
				weight := 1.0 / float64(len(previous)-i)
				weighted := score * weight
				if weighted > maxScore {
					maxScore = weighted
				}
				break
			}
		}
	}

	if maxScore > 1.0 {
		maxScore = 1.0
	}
	return maxScore
}

func (t *PersistentUsageTracker) Flush() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.flushLocked()
}

func (t *PersistentUsageTracker) flushLocked() {
	if t.store == nil {
		return
	}

	for key, count := range t.pendingUsages {
		parts := strings.SplitN(key, "|", 2)
		if len(parts) != 2 {
			continue
		}
		symbolName, contextHash := parts[0], parts[1]

		for i := 0; i < count; i++ {
			_ = t.store.RecordSymbolUsage(symbolName, contextHash)
		}
	}
	t.pendingUsages = make(map[string]int)

	for chain, count := range t.pendingChains {
		for i := 0; i < count; i++ {
			_ = t.store.RecordCooccurrence(chain)
		}
	}
	t.pendingChains = make(map[string]int)

	t.lastFlush = time.Now()
}

func (t *PersistentUsageTracker) hashContext(filePath, context string) string {
	key := filePath + "|" + context
	hash := md5.Sum([]byte(key))
	return hex.EncodeToString(hash[:8])
}

func (t *PersistentUsageTracker) Cleanup(maxAge time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.memory.Cleanup(maxAge)

	if t.store != nil {
		_ = t.store.CleanupOldUsage(maxAge)
	}
}

func (t *PersistentUsageTracker) GetContextPrediction(context string, limit int) []string {
	return t.memory.GetContextPrediction(context, limit)
}

func (t *PersistentUsageTracker) ResetChain() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.recentChain = t.recentChain[:0]
}

func (t *PersistentUsageTracker) GetRecentChain() []string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	result := make([]string, len(t.recentChain))
	copy(result, t.recentChain)
	return result
}
