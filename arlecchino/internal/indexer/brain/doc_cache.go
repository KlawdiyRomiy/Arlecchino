package brain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type DocCache struct {
	mu       sync.RWMutex
	cacheDir string
	entries  map[string]*CachedDoc
	maxAge   time.Duration
}

type CachedDoc struct {
	Entry     *DocEntry
	Version   string
	CachedAt  time.Time
	ExpiresAt time.Time
}

func NewDocCache(cacheDir string) *DocCache {
	if cacheDir == "" {
		home, _ := os.UserHomeDir()
		cacheDir = filepath.Join(home, ".arlecchino", "doc_cache")
	}
	_ = os.MkdirAll(cacheDir, 0755)

	return &DocCache{
		cacheDir: cacheDir,
		entries:  make(map[string]*CachedDoc),
		maxAge:   7 * 24 * time.Hour,
	}
}

func (c *DocCache) Get(packageName, symbolName, version string) *DocEntry {
	key := c.cacheKey(packageName, symbolName, version)

	c.mu.RLock()
	if cached, ok := c.entries[key]; ok {
		if time.Now().Before(cached.ExpiresAt) {
			c.mu.RUnlock()
			return cached.Entry
		}
	}
	c.mu.RUnlock()

	entry := c.loadFromDisk(key)
	if entry != nil && time.Now().Before(entry.ExpiresAt) {
		c.mu.Lock()
		c.entries[key] = entry
		c.mu.Unlock()
		return entry.Entry
	}

	return nil
}

func (c *DocCache) Set(packageName, symbolName, version string, entry *DocEntry) {
	key := c.cacheKey(packageName, symbolName, version)

	var expiresAt time.Time
	if c.isVersioned(version) {
		expiresAt = time.Now().Add(365 * 24 * time.Hour)
	} else {
		expiresAt = time.Now().Add(c.maxAge)
	}

	cached := &CachedDoc{
		Entry:     entry,
		Version:   version,
		CachedAt:  time.Now(),
		ExpiresAt: expiresAt,
	}

	c.mu.Lock()
	c.entries[key] = cached
	c.mu.Unlock()

	c.saveToDisk(key, cached)
}

func (c *DocCache) isVersioned(version string) bool {
	if version == "" || version == "latest" || version == "main" || version == "master" {
		return false
	}
	return true
}

func (c *DocCache) cacheKey(packageName, symbolName, version string) string {
	return packageName + "/" + symbolName + "@" + version
}

func (c *DocCache) loadFromDisk(key string) *CachedDoc {
	filePath := c.keyToPath(key)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	var cached CachedDoc
	if err := json.Unmarshal(data, &cached); err != nil {
		return nil
	}

	return &cached
}

func (c *DocCache) saveToDisk(key string, cached *CachedDoc) {
	filePath := c.keyToPath(key)

	dir := filepath.Dir(filePath)
	_ = os.MkdirAll(dir, 0755)

	data, err := json.Marshal(cached)
	if err != nil {
		return
	}

	_ = os.WriteFile(filePath, data, 0644)
}

func (c *DocCache) keyToPath(key string) string {
	safe := make([]byte, len(key))
	for i, ch := range key {
		if ch == '/' || ch == '@' || ch == ':' {
			safe[i] = '_'
		} else {
			safe[i] = byte(ch)
		}
	}
	return filepath.Join(c.cacheDir, string(safe)+".json")
}

func (c *DocCache) Clear() {
	c.mu.Lock()
	c.entries = make(map[string]*CachedDoc)
	c.mu.Unlock()

	entries, _ := os.ReadDir(c.cacheDir)
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".json" {
			_ = os.Remove(filepath.Join(c.cacheDir, entry.Name()))
		}
	}
}

func (c *DocCache) CleanupExpired() {
	c.mu.Lock()
	now := time.Now()
	for key, cached := range c.entries {
		if now.After(cached.ExpiresAt) {
			delete(c.entries, key)
		}
	}
	c.mu.Unlock()

	entries, _ := os.ReadDir(c.cacheDir)
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		path := filepath.Join(c.cacheDir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		var cached CachedDoc
		if err := json.Unmarshal(data, &cached); err != nil {
			_ = os.Remove(path)
			continue
		}

		if now.After(cached.ExpiresAt) {
			_ = os.Remove(path)
		}
	}
}

func (c *DocCache) Stats() (total int, memoryKB int64) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	total = len(c.entries)
	for _, cached := range c.entries {
		data, _ := json.Marshal(cached)
		memoryKB += int64(len(data))
	}
	memoryKB /= 1024
	return
}
