package core

import (
	"bufio"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const (
	symbolBatchSize = 40
	edgeBatchSize   = 100
	fileBatchSize   = 100
)

var (
	coreDBInitMutex sync.Mutex
)

type Store struct {
	db        *gorm.DB
	mu        sync.RWMutex
	projectID string
}

func NewStore(dbPath string, projectID string) (*Store, error) {
	coreDBInitMutex.Lock()
	defer coreDBInitMutex.Unlock()

	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	db, err := openStoreDB(dbPath)
	if err != nil {
		if !isSQLiteDatabaseCorruption(err) {
			return nil, err
		}
		if quarantineErr := quarantineCorruptStoreDB(dbPath); quarantineErr != nil {
			return nil, fmt.Errorf("%w; quarantine corrupt db: %v", err, quarantineErr)
		}
		db, err = openStoreDB(dbPath)
		if err != nil {
			return nil, err
		}
	}

	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)

	return &Store{
		db:        db,
		projectID: projectID,
	}, nil
}

func openStoreDB(dbPath string) (*gorm.DB, error) {
	db, err := gorm.Open(sqlite.Open(dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000&_busy_timeout=10000"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	if err := db.AutoMigrate(&Symbol{}, &Edge{}, &File{}, &Project{}, &CommandHistory{}, &CommandOutput{}, &SymbolUsage{}, &Cooccurrence{}); err != nil {
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return db, nil
}

func isSQLiteDatabaseCorruption(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not a database") ||
		strings.Contains(msg, "database disk image is malformed") ||
		strings.Contains(msg, "malformed")
}

func quarantineCorruptStoreDB(dbPath string) error {
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	stamp := time.Now().UTC().Format("20060102T150405Z")
	for _, suffix := range []string{"", "-wal", "-shm"} {
		path := dbPath + suffix
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		target := nextQuarantinePath(dbPath, suffix, stamp)
		if err := os.Rename(path, target); err != nil {
			return err
		}
	}
	return nil
}

func nextQuarantinePath(dbPath string, suffix string, stamp string) string {
	base := dbPath + ".corrupt-" + stamp + suffix
	if _, err := os.Stat(base); os.IsNotExist(err) {
		return base
	}
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s.%d", base, i)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
}

func (s *Store) SaveSymbols(symbols []Symbol) error {
	if len(symbols) == 0 {
		return nil
	}
	if err := s.prepareSymbols(symbols); err != nil {
		return err
	}

	s.mu.RLock()
	db := s.db
	s.mu.RUnlock()

	return db.Transaction(func(tx *gorm.DB) error {
		return tx.Clauses(clause.OnConflict{UpdateAll: true}).
			CreateInBatches(symbols, symbolBatchSize).Error
	})
}

func (s *Store) SaveEdges(edges []Edge) error {
	if len(edges) == 0 {
		return nil
	}
	s.prepareEdges(edges)

	s.mu.RLock()
	db := s.db
	s.mu.RUnlock()

	return db.Transaction(func(tx *gorm.DB) error {
		return tx.CreateInBatches(edges, edgeBatchSize).Error
	})
}

func (s *Store) prepareSymbols(symbols []Symbol) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.prepareSymbolsLocked(symbols)
}

func (s *Store) prepareSymbolsLocked(symbols []Symbol) error {
	for i := range symbols {
		symbols[i].ProjectID = s.projectID
		if symbols[i].ID == "" {
			symbols[i].ID = s.symbolID(&symbols[i])
		}
		if len(symbols[i].Extra) > 0 {
			data, err := json.Marshal(symbols[i].Extra)
			if err != nil {
				return err
			}
			symbols[i].ExtraJSON = string(data)
		}
	}

	return nil
}

func (s *Store) prepareEdges(edges []Edge) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.prepareEdgesLocked(edges)
}

func (s *Store) prepareEdgesLocked(edges []Edge) {
	for i := range edges {
		edges[i].ProjectID = s.projectID
	}
}

func (s *Store) ReplaceFileIndex(path string, language string, symbols []Symbol, edges []Edge) error {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.prepareSymbolsLocked(symbols); err != nil {
		return err
	}
	s.prepareEdgesLocked(edges)

	file := File{
		Path:       path,
		Language:   language,
		Kind:       classifyFileKind(path, language),
		Hash:       fileFingerprint(info),
		Size:       info.Size(),
		HasSymbols: len(symbols) > 0,
	}
	s.prepareFileLocked(&file)

	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ? AND file_path = ?", s.projectID, path).Delete(&Symbol{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND file_path = ?", s.projectID, path).Delete(&Edge{}).Error; err != nil {
			return err
		}
		if len(symbols) > 0 {
			if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).
				CreateInBatches(symbols, symbolBatchSize).Error; err != nil {
				return err
			}
		}
		if len(edges) > 0 {
			if err := tx.CreateInBatches(edges, edgeBatchSize).Error; err != nil {
				return err
			}
		}
		return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&file).Error
	})
}

func (s *Store) SaveFile(f File) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.prepareFileLocked(&f)
	return s.db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&f).Error
}

func (s *Store) SaveFiles(files []File) error {
	if len(files) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range files {
		s.prepareFileLocked(&files[i])
	}

	return s.db.Clauses(clause.OnConflict{UpdateAll: true}).
		CreateInBatches(files, fileBatchSize).Error
}

func (s *Store) prepareFileLocked(f *File) {
	f.ProjectID = s.projectID
	if f.ID == "" {
		f.ID = s.fileID(f.Path)
	}
}

func (s *Store) GetFile(path string) (*File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var f File
	id := s.fileID(path)
	err := s.db.Where("id = ?", id).First(&f).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &f, err
}

func (s *Store) DeleteFileSymbols(filePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.db.Where("project_id = ? AND file_path = ?", s.projectID, filePath).Delete(&Symbol{}).Error
}

func (s *Store) DeleteFileEdges(filePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.db.Where("project_id = ? AND file_path = ?", s.projectID, filePath).Delete(&Edge{}).Error
}

func (s *Store) QuerySymbols(query SymbolQuery) ([]Symbol, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tx := s.db.Where("project_id = ?", s.projectID)

	if query.Name != "" {
		tx = tx.Where("name LIKE ?", query.Name+"%")
	}
	if query.Kind != "" {
		tx = tx.Where("kind = ?", query.Kind)
	}
	if query.Language != "" {
		tx = tx.Where("language = ?", query.Language)
	}
	if query.Namespace != "" {
		tx = tx.Where("namespace = ?", query.Namespace)
	}
	if query.FilePath != "" {
		tx = tx.Where("file_path = ?", query.FilePath)
	}
	if query.ParentID != "" {
		tx = tx.Where("parent_id = ?", query.ParentID)
	}
	if !query.IncludePending {
		tx = tx.Where("is_pending = ?", false)
	}
	if query.Limit > 0 {
		tx = tx.Limit(query.Limit)
	}

	var symbols []Symbol
	err := tx.Order("name ASC").Find(&symbols).Error
	if err != nil {
		return nil, err
	}

	for i := range symbols {
		if symbols[i].ExtraJSON != "" {
			_ = json.Unmarshal([]byte(symbols[i].ExtraJSON), &symbols[i].Extra)
		}
	}

	return symbols, nil
}

func (s *Store) QuerySymbolsByFiles(paths []string) (map[string][]Symbol, error) {
	if len(paths) == 0 {
		return nil, nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var symbols []Symbol
	err := s.db.Where("project_id = ? AND file_path IN ? AND parent_id = ''", s.projectID, paths).
		Order("file_path, name ASC").Limit(len(paths) * 50).Find(&symbols).Error
	if err != nil {
		return nil, err
	}

	result := make(map[string][]Symbol, len(paths))
	for i := range symbols {
		if symbols[i].ExtraJSON != "" {
			_ = json.Unmarshal([]byte(symbols[i].ExtraJSON), &symbols[i].Extra)
		}
		result[symbols[i].FilePath] = append(result[symbols[i].FilePath], symbols[i])
	}
	return result, nil
}

func (s *Store) QueryEdges(query EdgeQuery) ([]Edge, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tx := s.db.Where("project_id = ?", s.projectID)

	if query.FromSymbol != "" {
		tx = tx.Where("from_symbol = ?", query.FromSymbol)
	}
	if query.ToSymbol != "" {
		tx = tx.Where("to_symbol = ?", query.ToSymbol)
	}
	if query.Kind != "" {
		tx = tx.Where("kind = ?", query.Kind)
	}
	if query.FilePath != "" {
		tx = tx.Where("file_path = ?", query.FilePath)
	}
	if query.Limit > 0 {
		tx = tx.Limit(query.Limit)
	}

	var edges []Edge
	return edges, tx.Find(&edges).Error
}

func (s *Store) FindDependants(basename string, limit int) ([]Edge, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tx := s.db.Where("project_id = ? AND to_symbol LIKE ?", s.projectID, "%"+basename)
	if limit > 0 {
		tx = tx.Limit(limit)
	}

	var edges []Edge
	return edges, tx.Find(&edges).Error
}

func (s *Store) ResolveImportFiles(toSymbols []string) (map[string]string, error) {
	if len(toSymbols) == 0 {
		return nil, nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var results []struct {
		Namespace string
		Name      string
		FilePath  string
	}

	err := s.db.Model(&Symbol{}).
		Select("namespace, name, file_path").
		Where("project_id = ? AND (namespace || '\\' || name) IN ?", s.projectID, toSymbols).
		Find(&results).Error
	if err != nil {
		return nil, err
	}

	resolved := make(map[string]string, len(results))
	for _, r := range results {
		key := r.Namespace + `\` + r.Name
		resolved[key] = r.FilePath
	}

	if len(resolved) < len(toSymbols) {
		var byName []struct {
			Name     string
			FilePath string
		}
		unresolved := make([]string, 0, len(toSymbols)-len(resolved))
		for _, ts := range toSymbols {
			if _, ok := resolved[ts]; !ok {
				unresolved = append(unresolved, ts)
			}
		}
		if len(unresolved) > 0 {
			s.db.Model(&Symbol{}).
				Select("name, file_path").
				Where("project_id = ? AND name IN ?", s.projectID, unresolved).
				Find(&byName)
			for _, r := range byName {
				if _, exists := resolved[r.Name]; !exists {
					resolved[r.Name] = r.FilePath
				}
			}
		}
	}

	if len(resolved) < len(toSymbols) {
		segments := make([]string, 0, len(toSymbols)-len(resolved))
		segToImport := make(map[string]string, cap(segments))
		for _, ts := range toSymbols {
			if _, ok := resolved[ts]; ok {
				continue
			}
			lastSlash := strings.LastIndex(ts, "/")
			if lastSlash < 0 {
				continue
			}
			seg := ts[lastSlash+1:]
			if seg != "" && segToImport[seg] == "" {
				segments = append(segments, seg)
				segToImport[seg] = ts
			}
		}
		if len(segments) > 0 {
			var byPkg []struct {
				Name     string
				FilePath string
			}
			s.db.Model(&Symbol{}).
				Select("name, file_path").
				Where("project_id = ? AND kind = ? AND name IN ?", s.projectID, SymbolKindPackage, segments).
				Find(&byPkg)
			for _, r := range byPkg {
				importKey := segToImport[r.Name]
				if importKey != "" {
					if _, exists := resolved[importKey]; !exists {
						resolved[importKey] = r.FilePath
					}
				}
			}
		}
	}

	return resolved, nil
}

func (s *Store) AllSymbolsByKind(kind SymbolKind) ([]Symbol, error) {
	return s.QuerySymbols(SymbolQuery{Kind: kind})
}

func (s *Store) FindSymbolByID(id string) (*Symbol, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var sym Symbol
	err := s.db.Where("id = ?", id).First(&sym).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if sym.ExtraJSON != "" {
		_ = json.Unmarshal([]byte(sym.ExtraJSON), &sym.Extra)
	}
	return &sym, nil
}

func (s *Store) UpdateSymbolPending(id string, isPending bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Model(&Symbol{}).Where("id = ?", id).Update("is_pending", isPending).Error
}

// DeleteSymbol removes a symbol by ID
func (s *Store) DeleteSymbol(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Where("id = ?", id).Delete(&Symbol{}).Error
}

func (s *Store) RecordCommandUsage(projectID, command, workDir string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var existing CommandHistory
	result := s.db.Where("project_id = ? AND command = ?", projectID, command).First(&existing)

	if result.Error == gorm.ErrRecordNotFound {
		newEntry := CommandHistory{
			ProjectID:  projectID,
			Command:    command,
			WorkDir:    workDir,
			Frequency:  1,
			LastUsedAt: time.Now(),
		}
		return s.db.Create(&newEntry).Error
	}

	existing.Frequency++
	existing.LastUsedAt = time.Now()
	existing.WorkDir = workDir
	return s.db.Save(&existing).Error
}

func (s *Store) GetTopCommands(projectID, prefix string, limit int) ([]CommandHistory, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var commands []CommandHistory
	query := s.db.Where("project_id = ?", projectID)

	if prefix != "" {
		query = query.Where("command LIKE ?", prefix+"%")
	}

	err := query.
		Order("frequency DESC, last_used_at DESC").
		Limit(limit).
		Find(&commands).Error

	return commands, err
}

func (s *Store) ImportHistoryFromFile(filePath, workDir string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	batch := make([]CommandHistory, 0, 100)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		command := s.parseHistoryLine(line)
		if command == "" {
			continue
		}

		batch = append(batch, CommandHistory{
			ProjectID:  s.projectID,
			Command:    command,
			WorkDir:    workDir,
			Frequency:  1,
			LastUsedAt: time.Now(),
		})

		if len(batch) >= 100 {
			if err := s.db.CreateInBatches(batch, 100).Error; err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		if err := s.db.CreateInBatches(batch, 100).Error; err != nil {
			return err
		}
	}

	return scanner.Err()
}

func (s *Store) parseHistoryLine(line string) string {
	if strings.Contains(line, ":") && len(line) > 15 {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) == 3 {
			return strings.TrimSpace(parts[2])
		}
	}
	return line
}

func (s *Store) SaveCommandOutput(command, output string, exitCode int, execTime time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry := CommandOutput{
		ProjectID: s.projectID,
		Command:   command,
		Output:    output,
		ExitCode:  exitCode,
		ExecTime:  execTime,
		CachedAt:  time.Now(),
	}

	return s.db.Create(&entry).Error
}

func (s *Store) GetCachedOutput(command string, maxAge time.Duration) (*CommandOutput, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var output CommandOutput
	cutoff := time.Now().Add(-maxAge)

	err := s.db.
		Where("project_id = ? AND command = ? AND cached_at > ?", s.projectID, command, cutoff).
		Order("cached_at DESC").
		First(&output).Error

	if err != nil {
		return nil, err
	}

	return &output, nil
}

func (s *Store) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func (s *Store) RecordSymbolUsage(symbolName, contextHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var existing SymbolUsage
	result := s.db.Where("project_id = ? AND symbol_name = ? AND context_hash = ?",
		s.projectID, symbolName, contextHash).First(&existing)

	if result.Error == gorm.ErrRecordNotFound {
		return s.db.Create(&SymbolUsage{
			ProjectID:   s.projectID,
			SymbolName:  symbolName,
			ContextHash: contextHash,
			UseCount:    1,
			LastUsedAt:  time.Now(),
		}).Error
	}

	existing.UseCount++
	existing.LastUsedAt = time.Now()
	return s.db.Save(&existing).Error
}

func (s *Store) GetSymbolUsage(symbolName string, limit int) ([]SymbolUsage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var usages []SymbolUsage
	err := s.db.Where("project_id = ? AND symbol_name = ?", s.projectID, symbolName).
		Order("use_count DESC, last_used_at DESC").
		Limit(limit).
		Find(&usages).Error
	return usages, err
}

func (s *Store) GetTopUsedSymbols(prefix string, limit int) ([]SymbolUsage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var usages []SymbolUsage
	query := s.db.Where("project_id = ?", s.projectID)
	if prefix != "" {
		query = query.Where("symbol_name LIKE ?", prefix+"%")
	}
	err := query.Order("use_count DESC, last_used_at DESC").
		Limit(limit).
		Find(&usages).Error
	return usages, err
}

func (s *Store) RecordCooccurrence(chain string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var existing Cooccurrence
	result := s.db.Where("project_id = ? AND chain = ?", s.projectID, chain).First(&existing)

	if result.Error == gorm.ErrRecordNotFound {
		return s.db.Create(&Cooccurrence{
			ProjectID: s.projectID,
			Chain:     chain,
			Count:     1,
		}).Error
	}

	existing.Count++
	return s.db.Save(&existing).Error
}

func (s *Store) GetCooccurrences(chainPrefix string, limit int) ([]Cooccurrence, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var coocs []Cooccurrence
	err := s.db.Where("project_id = ? AND chain LIKE ?", s.projectID, chainPrefix+"%").
		Order("count DESC").
		Limit(limit).
		Find(&coocs).Error
	return coocs, err
}

func (s *Store) CleanupOldUsage(maxAge time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	return s.db.Where("project_id = ? AND last_used_at < ?", s.projectID, cutoff).
		Delete(&SymbolUsage{}).Error
}

func (s *Store) symbolID(sym *Symbol) string {
	key := fmt.Sprintf("%s:%s:%s:%s:%d", s.projectID, sym.FilePath, sym.Kind, sym.Name, sym.Line)
	hash := md5.Sum([]byte(key))
	return hex.EncodeToString(hash[:])
}

func (s *Store) fileID(path string) string {
	key := fmt.Sprintf("%s:%s", s.projectID, path)
	hash := md5.Sum([]byte(key))
	return hex.EncodeToString(hash[:])
}

type SymbolQuery struct {
	Name           string
	Kind           SymbolKind
	Language       string
	Namespace      string
	FilePath       string
	ParentID       string
	IncludePending bool
	Limit          int
}

type EdgeQuery struct {
	FromSymbol string
	ToSymbol   string
	Kind       EdgeKind
	FilePath   string
	Limit      int
}

type CommandHistory struct {
	ID         uint      `gorm:"primaryKey"`
	ProjectID  string    `gorm:"index:idx_cmd_project;size:512"`
	Command    string    `gorm:"index:idx_cmd_project;size:1024"`
	WorkDir    string    `gorm:"size:1024"`
	Frequency  int       `gorm:"index;default:1"`
	LastUsedAt time.Time `gorm:"index"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type CommandOutput struct {
	ID        uint   `gorm:"primaryKey"`
	ProjectID string `gorm:"index:idx_cmd_output;size:512"`
	Command   string `gorm:"index:idx_cmd_output;size:1024"`
	Output    string `gorm:"type:text"`
	ExitCode  int
	ExecTime  time.Duration
	CachedAt  time.Time `gorm:"index"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// SymbolUsage tracks per-project symbol usage for SmartRanker frequency scoring
type SymbolUsage struct {
	ID          uint      `gorm:"primaryKey"`
	ProjectID   string    `gorm:"uniqueIndex:idx_symbol_usage_unique;size:512"`
	SymbolName  string    `gorm:"uniqueIndex:idx_symbol_usage_unique;index:idx_symbol_name;size:512"`
	ContextHash string    `gorm:"uniqueIndex:idx_symbol_usage_unique;size:128"` // file/class context
	UseCount    int       `gorm:"default:1"`
	LastUsedAt  time.Time `gorm:"index"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (s *Store) GetAllFiles() (map[string]File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var files []File
	if err := s.db.Where("project_id = ?", s.projectID).Find(&files).Error; err != nil {
		return nil, err
	}
	m := make(map[string]File, len(files))
	for _, f := range files {
		m[f.Path] = f
	}
	return m, nil
}

func (s *Store) DeleteFileMeta(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := s.fileID(path)
	return s.db.Where("id = ?", id).Delete(&File{}).Error
}

func (s *Store) SearchFiles(prefix string, limit int) ([]File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var files []File
	query := s.db.Where("project_id = ?", s.projectID)

	if prefix != "" {
		query = query.Where("path LIKE ?", "%"+prefix+"%")
	}

	if limit > 0 {
		query = query.Limit(limit)
	}

	err := query.Order("path ASC").Find(&files).Error
	return files, err
}

func (s *Store) SearchFilesInDir(dirPath string, limit int) ([]File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cleanDir := filepath.Clean(dirPath)
	pattern := escapeLikePattern(cleanDir)
	if !strings.HasSuffix(pattern, string(filepath.Separator)) {
		pattern += string(filepath.Separator)
	}

	var files []File
	query := s.db.Where("project_id = ?", s.projectID)
	query = query.Where("path = ? OR path LIKE ? ESCAPE '\\'", cleanDir, pattern+"%")

	if limit > 0 {
		query = query.Limit(limit)
	}

	err := query.Order("path ASC").Find(&files).Error
	return files, err
}

func escapeLikePattern(value string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return replacer.Replace(value)
}

func (s *Store) SearchDirectories(prefix string, limit int) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var paths []string
	subquery := s.db.Model(&File{}).
		Select("DISTINCT SUBSTR(path, 1, LENGTH(path) - LENGTH(SUBSTR(path, INSTR(path, '/') + 1))) as dir_path").
		Where("project_id = ? AND path LIKE '%/%'", s.projectID)

	if prefix != "" {
		subquery = subquery.Where("path LIKE ?", prefix+"%")
	}

	if limit > 0 {
		subquery = subquery.Limit(limit)
	}

	err := subquery.Pluck("dir_path", &paths).Error
	return paths, err
}

type Cooccurrence struct {
	ID        uint   `gorm:"primaryKey"`
	ProjectID string `gorm:"uniqueIndex:idx_cooccurrence_unique;index:idx_cooccurrence_project;size:512"`
	Chain     string `gorm:"uniqueIndex:idx_cooccurrence_unique;index:idx_cooccurrence_chain;size:1024"` // up to 5 symbols: "Route::->get->middleware->name"
	Count     int    `gorm:"default:1"`
	CreatedAt time.Time
	UpdatedAt time.Time
}
