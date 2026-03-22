package brain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type ProjectLearner struct {
	mu       sync.RWMutex
	dataDir  string
	projects map[string]*ProjectData
	dirty    bool
}

type ProjectData struct {
	ID          string                  `json:"id"`
	SymbolUsage map[string]*SymbolStats `json:"symbol_usage"`
	UpdatedAt   time.Time               `json:"updated_at"`
}

type SymbolStats struct {
	Symbol   string    `json:"symbol"`
	UseCount int       `json:"use_count"`
	LastUsed time.Time `json:"last_used"`
	Contexts []string  `json:"contexts,omitempty"`
	AvgScore float64   `json:"avg_score"`
}

func NewProjectLearner(dataDir string) *ProjectLearner {
	pl := &ProjectLearner{
		dataDir:  dataDir,
		projects: make(map[string]*ProjectData),
	}

	pl.loadAll()
	return pl
}

func (pl *ProjectLearner) loadAll() {
	projectsDir := filepath.Join(pl.dataDir, "projects")
	if _, err := os.Stat(projectsDir); os.IsNotExist(err) {
		return
	}

	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		adapterPath := filepath.Join(projectsDir, entry.Name(), "adapter.json")
		data, err := os.ReadFile(adapterPath)
		if err != nil {
			continue
		}

		var pd ProjectData
		if err := json.Unmarshal(data, &pd); err != nil {
			continue
		}

		pl.projects[pd.ID] = &pd
	}
}

func (pl *ProjectLearner) GetBoost(projectID, symbol string) float64 {
	pl.mu.RLock()
	defer pl.mu.RUnlock()

	pd, ok := pl.projects[projectID]
	if !ok {
		return 0.0
	}

	stats, ok := pd.SymbolUsage[symbol]
	if !ok {
		return 0.0
	}

	recency := time.Since(stats.LastUsed)
	recencyFactor := 1.0
	if recency > 24*time.Hour {
		recencyFactor = 0.5
	} else if recency > 7*24*time.Hour {
		recencyFactor = 0.2
	}

	frequencyFactor := float64(stats.UseCount) / 100.0
	if frequencyFactor > 1.0 {
		frequencyFactor = 1.0
	}

	return (frequencyFactor*0.7 + recencyFactor*0.3) * stats.AvgScore
}

func (pl *ProjectLearner) Record(projectID, symbol string, ctx CompletionContext) {
	pl.mu.Lock()
	defer pl.mu.Unlock()

	pd, ok := pl.projects[projectID]
	if !ok {
		pd = &ProjectData{
			ID:          projectID,
			SymbolUsage: make(map[string]*SymbolStats),
		}
		pl.projects[projectID] = pd
	}

	stats, ok := pd.SymbolUsage[symbol]
	if !ok {
		stats = &SymbolStats{
			Symbol:   symbol,
			Contexts: make([]string, 0, 10),
			AvgScore: 1.0,
		}
		pd.SymbolUsage[symbol] = stats
	}

	stats.UseCount++
	stats.LastUsed = time.Now()

	contextKey := ctx.Language + ":" + ctx.Scope
	if len(stats.Contexts) < 10 {
		found := false
		for _, c := range stats.Contexts {
			if c == contextKey {
				found = true
				break
			}
		}
		if !found {
			stats.Contexts = append(stats.Contexts, contextKey)
		}
	}

	pd.UpdatedAt = time.Now()
	pl.dirty = true
}

func (pl *ProjectLearner) Flush() {
	pl.mu.Lock()
	defer pl.mu.Unlock()

	if !pl.dirty {
		return
	}

	projectsDir := filepath.Join(pl.dataDir, "projects")
	os.MkdirAll(projectsDir, 0755)

	for _, pd := range pl.projects {
		projectHash := hashProjectID(pd.ID)
		projectDir := filepath.Join(projectsDir, projectHash)
		os.MkdirAll(projectDir, 0755)

		data, err := json.MarshalIndent(pd, "", "  ")
		if err != nil {
			continue
		}

		adapterPath := filepath.Join(projectDir, "adapter.json")
		os.WriteFile(adapterPath, data, 0644)
	}

	pl.dirty = false
}

func (pl *ProjectLearner) Count() int {
	pl.mu.RLock()
	defer pl.mu.RUnlock()

	total := 0
	for _, pd := range pl.projects {
		total += len(pd.SymbolUsage)
	}
	return total
}

func hashProjectID(id string) string {
	h := uint32(0)
	for _, c := range id {
		h = h*31 + uint32(c)
	}
	return filepath.Base(id) + "_" + string(rune('a'+h%26))
}
