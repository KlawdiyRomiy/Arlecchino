package indexer

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var (
	dbInitMutex sync.Mutex
)

type CacheEntry struct {
	ID          uint   `gorm:"primaryKey"`
	ProjectPath string `gorm:"index:idx_project_kind"`
	Kind        string `gorm:"index:idx_project_kind"`
	Data        string
	UpdatedAt   time.Time `gorm:"index"`
}

type Cache struct {
	db *gorm.DB
}

func NewCache(projectPath string) (*Cache, error) {
	dbInitMutex.Lock()
	defer dbInitMutex.Unlock()

	cacheDir := filepath.Join(projectPath, ".arlecchino")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(cacheDir, "metadata-cache.db")
	db, err := openSQLite(dbPath)
	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(&CacheEntry{}); err != nil {
		return nil, err
	}

	return &Cache{db: db}, nil
}

func openSQLite(dbPath string) (*gorm.DB, error) {
	dsn := fmt.Sprintf("file:%s?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000&_cache_size=-20000&_foreign_keys=on", dbPath)
	return gorm.Open(sqlite.Open(dsn), &gorm.Config{})
}

func (c *Cache) Get(projectPath, kind string) (data string, ts time.Time, ok bool, err error) {
	if c == nil || c.db == nil {
		return "", time.Time{}, false, nil
	}
	var entry CacheEntry
	result := c.db.Where("project_path = ? AND kind = ?", projectPath, kind).First(&entry)
	if result.Error != nil {
		return "", time.Time{}, false, nil
	}
	return entry.Data, entry.UpdatedAt, true, nil
}

func (c *Cache) Set(projectPath, kind, data string, ts time.Time) error {
	if c == nil || c.db == nil {
		return nil
	}
	entry := CacheEntry{
		ProjectPath: projectPath,
		Kind:        kind,
		Data:        data,
		UpdatedAt:   ts,
	}
	return c.db.Where("project_path = ? AND kind = ?", projectPath, kind).Assign(entry).FirstOrCreate(&entry).Error
}

func (c *Cache) Delete(projectPath string, kinds ...string) {
	if c == nil || c.db == nil {
		return
	}
	if len(kinds) == 0 {
		c.db.Where("project_path = ?", projectPath).Delete(&CacheEntry{})
		return
	}
	c.db.Where("project_path = ? AND kind IN ?", projectPath, kinds).Delete(&CacheEntry{})
}
