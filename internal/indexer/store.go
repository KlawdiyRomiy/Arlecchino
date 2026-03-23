package indexer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"gorm.io/gorm"
)

// Store maintains the structured index for one or many projects ("spaces").
// Data lives in the same .arlecchino/index-cache.db with WAL tuning.
type Store struct {
	db *gorm.DB
}

// ProjectRecord identifies a root project/space. ID is the absolute project path by default.
type ProjectRecord struct {
	ID        string    `gorm:"primaryKey;size:512"`
	Root      string    `gorm:"size:1024"`
	Labels    string    `gorm:"size:2048"` // JSON-encoded map of arbitrary tags (e.g. version, framework)
	UpdatedAt time.Time `gorm:"index"`
}

type RouteRecord struct {
	ID             uint   `gorm:"primaryKey"`
	ProjectID      string `gorm:"index"`
	Name           string `gorm:"index"`
	Method         string `gorm:"index"`
	URI            string `gorm:"index"`
	Action         string
	Controller     string `gorm:"index"`
	MiddlewareJSON string `gorm:"type:text"`
	FilePath       string `gorm:"size:1024"`
	LineNumber     int
	ControllerPath string `gorm:"size:1024"`
	ActionLine     int
	UpdatedAt      time.Time `gorm:"index"`
}

type ControllerRecord struct {
	ID        uint      `gorm:"primaryKey"`
	ProjectID string    `gorm:"index"`
	Name      string    `gorm:"index"`
	Namespace string    `gorm:"index"`
	FilePath  string    `gorm:"size:1024"`
	Methods   string    `gorm:"type:text"` // JSON array of method names/lines/signatures
	UpdatedAt time.Time `gorm:"index"`
}

type ModelRecord struct {
	ID                uint      `gorm:"primaryKey"`
	ProjectID         string    `gorm:"index"`
	Name              string    `gorm:"index"`
	Namespace         string    `gorm:"index"`
	Table             string    `gorm:"index"`
	FilePath          string    `gorm:"size:1024"`
	FillableJSON      string    `gorm:"type:text"`
	HiddenJSON        string    `gorm:"type:text"`
	CastsJSON         string    `gorm:"type:text"`
	FieldsJSON        string    `gorm:"type:text"`
	RelationshipsJSON string    `gorm:"type:text"`
	AccessorsJSON     string    `gorm:"type:text"`
	MutatorsJSON      string    `gorm:"type:text"`
	ScopesJSON        string    `gorm:"type:text"`
	UpdatedAt         time.Time `gorm:"index"`
}

type MigrationRecord struct {
	ID         uint      `gorm:"primaryKey"`
	ProjectID  string    `gorm:"index"`
	Name       string    `gorm:"index"`
	FilePath   string    `gorm:"size:1024"`
	Table      string    `gorm:"index"`
	FieldsJSON string    `gorm:"type:text"`
	UpdatedAt  time.Time `gorm:"index"`
}

type ViewRecord struct {
	ID          uint      `gorm:"primaryKey"`
	ProjectID   string    `gorm:"index"`
	Name        string    `gorm:"index"`
	Path        string    `gorm:"size:1024"`
	RelPath     string    `gorm:"size:1024"`
	IsLayout    bool      `gorm:"index"`
	IsComponent bool      `gorm:"index"`
	UpdatedAt   time.Time `gorm:"index"`
}

type BladeComponentRecord struct {
	ID        uint      `gorm:"primaryKey"`
	ProjectID string    `gorm:"index"`
	Name      string    `gorm:"index"`
	Class     string    `gorm:"index"`
	Path      string    `gorm:"size:1024"`
	Template  string    `gorm:"size:1024"`
	PropsJSON string    `gorm:"type:text"`
	SlotsJSON string    `gorm:"type:text"`
	UpdatedAt time.Time `gorm:"index"`
}

type LivewireComponentRecord struct {
	ID          uint      `gorm:"primaryKey"`
	ProjectID   string    `gorm:"index"`
	Name        string    `gorm:"index"`
	Class       string    `gorm:"index"`
	Path        string    `gorm:"size:1024"`
	View        string    `gorm:"index"`
	PropsJSON   string    `gorm:"type:text"`
	MethodsJSON string    `gorm:"type:text"`
	UpdatedAt   time.Time `gorm:"index"`
}

type ConfigRecord struct {
	ID          uint   `gorm:"primaryKey"`
	ProjectID   string `gorm:"index"`
	Key         string `gorm:"index"`
	Value       string `gorm:"type:text"`
	File        string
	Description string    `gorm:"type:text"`
	UpdatedAt   time.Time `gorm:"index"`
}

type EnvRecord struct {
	ID        uint      `gorm:"primaryKey"`
	ProjectID string    `gorm:"index"`
	Key       string    `gorm:"index"`
	Value     string    `gorm:"type:text"`
	UpdatedAt time.Time `gorm:"index"`
}

type PolicyRecord struct {
	ID          uint      `gorm:"primaryKey"`
	ProjectID   string    `gorm:"index"`
	Name        string    `gorm:"index"`
	Class       string    `gorm:"index"`
	FilePath    string    `gorm:"size:1024"`
	MethodsJSON string    `gorm:"type:text"`
	UpdatedAt   time.Time `gorm:"index"`
}

type FormRequestRecord struct {
	ID         uint      `gorm:"primaryKey"`
	ProjectID  string    `gorm:"index"`
	Name       string    `gorm:"index"`
	Class      string    `gorm:"index"`
	FilePath   string    `gorm:"size:1024"`
	RulesJSON  string    `gorm:"type:text"`
	Authorizes bool      `gorm:"index"`
	UpdatedAt  time.Time `gorm:"index"`
}

type EventRecord struct {
	ID          uint      `gorm:"primaryKey"`
	ProjectID   string    `gorm:"index"`
	Name        string    `gorm:"index"`
	Class       string    `gorm:"index"`
	FilePath    string    `gorm:"size:1024"`
	PayloadJSON string    `gorm:"type:text"`
	UpdatedAt   time.Time `gorm:"index"`
}

type ListenerRecord struct {
	ID         uint      `gorm:"primaryKey"`
	ProjectID  string    `gorm:"index"`
	Name       string    `gorm:"index"`
	Class      string    `gorm:"index"`
	FilePath   string    `gorm:"size:1024"`
	EventsJSON string    `gorm:"type:text"`
	UpdatedAt  time.Time `gorm:"index"`
}

type EnumRecord struct {
	ID        uint   `gorm:"primaryKey"`
	ProjectID string `gorm:"index"`
	Name      string `gorm:"index"`
	Backed    bool
	Type      string    `gorm:"index"`
	CasesJSON string    `gorm:"type:text"`
	FilePath  string    `gorm:"size:1024"`
	UpdatedAt time.Time `gorm:"index"`
}

type JsComponentRecord struct {
	ID        uint      `gorm:"primaryKey"`
	ProjectID string    `gorm:"index"`
	Name      string    `gorm:"index"`
	Framework string    `gorm:"index"` // react/vue/svelte
	Path      string    `gorm:"size:1024"`
	Export    string    `gorm:"index"`
	PropsJSON string    `gorm:"type:text"`
	UpdatedAt time.Time `gorm:"index"`
}

type TailwindClassRecord struct {
	ID        uint      `gorm:"primaryKey"`
	ProjectID string    `gorm:"index"`
	ClassName string    `gorm:"index"`
	Source    string    `gorm:"size:512"` // file reference
	UpdatedAt time.Time `gorm:"index"`
}

type ComposerPackageRecord struct {
	ID        uint   `gorm:"primaryKey"`
	ProjectID string `gorm:"index"`
	Name      string `gorm:"index"`
	Version   string
	Type      string    `gorm:"index"`
	Provider  string    `gorm:"index"`
	UpdatedAt time.Time `gorm:"index"`
}

func NewStore(projectPath string) (*Store, error) {
	dbInitMutex.Lock()
	defer dbInitMutex.Unlock()

	cacheDir := filepath.Join(projectPath, ".arlecchino")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(cacheDir, "index-cache.db")
	db, err := openSQLite(dbPath)
	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(
		&ProjectRecord{},
		&RouteRecord{},
		&ControllerRecord{},
		&ModelRecord{},
		&MigrationRecord{},
		&ViewRecord{},
		&BladeComponentRecord{},
		&LivewireComponentRecord{},
		&ConfigRecord{},
		&EnvRecord{},
		&PolicyRecord{},
		&FormRequestRecord{},
		&EventRecord{},
		&ListenerRecord{},
		&EnumRecord{},
		&JsComponentRecord{},
		&TailwindClassRecord{},
		&ComposerPackageRecord{},
	); err != nil {
		return nil, err
	}

	return &Store{db: db}, nil
}

// UpsertProject registers or updates a project root with optional labels metadata.
func (s *Store) UpsertProject(id, root string, labels map[string]string) error {
	if s == nil || s.db == nil {
		return nil
	}
	labelsJSON, _ := json.Marshal(labels)
	rec := ProjectRecord{ID: id, Root: root, Labels: string(labelsJSON), UpdatedAt: time.Now()}
	return s.db.Where("id = ?", id).Assign(rec).FirstOrCreate(&rec).Error
}

// ResetProject wipes all indexed data for a project.
func (s *Store) ResetProject(id string) error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		tables := []interface{}{
			&RouteRecord{}, &ControllerRecord{}, &ModelRecord{}, &MigrationRecord{}, &ViewRecord{},
			&BladeComponentRecord{}, &LivewireComponentRecord{}, &ConfigRecord{}, &EnvRecord{},
			&PolicyRecord{}, &FormRequestRecord{}, &EventRecord{}, &ListenerRecord{}, &EnumRecord{},
			&JsComponentRecord{}, &TailwindClassRecord{}, &ComposerPackageRecord{},
		}
		for _, tbl := range tables {
			if err := tx.Where("project_id = ?", id).Delete(tbl).Error; err != nil {
				return err
			}
		}
		return tx.Where("id = ?", id).Delete(&ProjectRecord{}).Error
	})
}

func (s *Store) ReplaceRoutes(projectID string, routes []RouteRecord) error {
	return s.replace(projectID, &RouteRecord{}, routes)
}

func (s *Store) ReplaceControllers(projectID string, controllers []ControllerRecord) error {
	return s.replace(projectID, &ControllerRecord{}, controllers)
}

func (s *Store) ReplaceModels(projectID string, models []ModelRecord) error {
	return s.replace(projectID, &ModelRecord{}, models)
}

func (s *Store) ReplaceMigrations(projectID string, migrations []MigrationRecord) error {
	return s.replace(projectID, &MigrationRecord{}, migrations)
}

func (s *Store) ReplaceViews(projectID string, views []ViewRecord) error {
	return s.replace(projectID, &ViewRecord{}, views)
}

func (s *Store) ReplaceBladeComponents(projectID string, comps []BladeComponentRecord) error {
	return s.replace(projectID, &BladeComponentRecord{}, comps)
}

func (s *Store) ReplaceLivewireComponents(projectID string, comps []LivewireComponentRecord) error {
	return s.replace(projectID, &LivewireComponentRecord{}, comps)
}

func (s *Store) ReplaceConfig(projectID string, cfg []ConfigRecord) error {
	return s.replace(projectID, &ConfigRecord{}, cfg)
}

func (s *Store) ReplaceEnv(projectID string, envs []EnvRecord) error {
	return s.replace(projectID, &EnvRecord{}, envs)
}

func (s *Store) ReplacePolicies(projectID string, policies []PolicyRecord) error {
	return s.replace(projectID, &PolicyRecord{}, policies)
}

func (s *Store) ReplaceFormRequests(projectID string, forms []FormRequestRecord) error {
	return s.replace(projectID, &FormRequestRecord{}, forms)
}

func (s *Store) ReplaceEvents(projectID string, events []EventRecord) error {
	return s.replace(projectID, &EventRecord{}, events)
}

func (s *Store) ReplaceListeners(projectID string, listeners []ListenerRecord) error {
	return s.replace(projectID, &ListenerRecord{}, listeners)
}

func (s *Store) ReplaceEnums(projectID string, enums []EnumRecord) error {
	return s.replace(projectID, &EnumRecord{}, enums)
}

func (s *Store) ReplaceJsComponents(projectID string, comps []JsComponentRecord) error {
	return s.replace(projectID, &JsComponentRecord{}, comps)
}

func (s *Store) ReplaceTailwindClasses(projectID string, classes []TailwindClassRecord) error {
	return s.replace(projectID, &TailwindClassRecord{}, classes)
}

func (s *Store) ReplaceComposerPackages(projectID string, packages []ComposerPackageRecord) error {
	return s.replace(projectID, &ComposerPackageRecord{}, packages)
}

func (s *Store) replace(projectID string, table interface{}, rows interface{}) error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ?", projectID).Delete(table).Error; err != nil {
			return err
		}
		if rows == nil {
			return nil
		}
		return tx.Create(rows).Error
	})
}

func (s *Store) GetControllers(projectID string) []ControllerRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []ControllerRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetModels(projectID string) []ModelRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []ModelRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetRoutes(projectID string) []RouteRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []RouteRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetViews(projectID string) []ViewRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []ViewRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetMigrations(projectID string) []MigrationRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []MigrationRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetFormRequests(projectID string) []FormRequestRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []FormRequestRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetPolicies(projectID string) []PolicyRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []PolicyRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetEvents(projectID string) []EventRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []EventRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetListeners(projectID string) []ListenerRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []ListenerRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetComposerPackages(projectID string) []ComposerPackageRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []ComposerPackageRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetLivewireComponents(projectID string) []LivewireComponentRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []LivewireComponentRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetBladeComponents(projectID string) []BladeComponentRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []BladeComponentRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetJsComponents(projectID string) []JsComponentRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []JsComponentRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetConfig(projectID string) []ConfigRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []ConfigRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetEnv(projectID string) []EnvRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []EnvRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) GetEnums(projectID string) []EnumRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var records []EnumRecord
	s.db.Where("project_id = ?", projectID).Find(&records)
	return records
}

func (s *Store) FindMigrationByTable(projectID, table string) *MigrationRecord {
	if s == nil || s.db == nil {
		return nil
	}
	var record MigrationRecord
	if err := s.db.Where("project_id = ? AND table_name = ?", projectID, table).First(&record).Error; err != nil {
		return nil
	}
	return &record
}
